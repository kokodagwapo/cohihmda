// @ts-nocheck
/**
 * AWS Provisioning Service
 * Handles automated provisioning of AWS infrastructure for per-lender deployments
 * Uses AWS Organizations + CloudFormation StackSets
 */

import { OrganizationsClient, CreateAccountCommand, DescribeCreateAccountStatusCommand } from '@aws-sdk/client-organizations';
import { CloudFormationClient, CreateStackInstancesCommand, DescribeStackInstanceCommand, ListStackInstancesCommand } from '@aws-sdk/client-cloudformation';
import { pool } from '../config/database.js';
import crypto from 'crypto';

const organizationsClient = new OrganizationsClient({ region: process.env.AWS_REGION || 'us-east-1' });
const cloudFormationClient = new CloudFormationClient({ region: process.env.AWS_REGION || 'us-east-1' });

const MASTER_ACCOUNT_ID = process.env.AWS_ORGANIZATIONS_MASTER_ACCOUNT_ID || '';
const STACKSET_NAME = process.env.CLOUDFORMATION_STACKSET_NAME || 'CoheusPlatformStack';
const PROVISIONING_TIMEOUT = 30 * 60 * 1000; // 30 minutes

/**
 * Retry a function with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

interface ProvisioningResult {
  awsAccountId: string;
  stackId: string;
  infrastructureUrl: string;
  adminUrl: string;
  backendUrl: string;
}

/**
 * Generate a secure random password
 */
function generateSecurePassword(length: number = 16): string {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  const randomBytes = crypto.randomBytes(length);
  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset[randomBytes[i] % charset.length];
  }
  return password;
}

/**
 * Create AWS account via AWS Organizations
 */
async function createAWSAccount(lenderName: string, email: string): Promise<string> {
  try {
    if (!MASTER_ACCOUNT_ID) {
      throw new Error('AWS_ORGANIZATIONS_MASTER_ACCOUNT_ID environment variable is not set');
    }

    const accountName = `Coheus-${lenderName.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 50)}`;
    // AWS Organizations requires unique email per account
    // Use timestamp to ensure uniqueness
    const emailPrefix = email.split('@')[0];
    const timestamp = Date.now();
    const accountEmail = `${emailPrefix}+coheus-${timestamp}@${email.split('@')[1]}`;

    console.log(`Creating AWS account: ${accountName} with email: ${accountEmail}`);

    const command = new CreateAccountCommand({
      AccountName: accountName,
      Email: accountEmail,
      RoleName: 'CoheusMasterRole',
    });

    const response = await organizationsClient.send(command);
    const createAccountRequestId = response.CreateAccountStatusId;

    if (!createAccountRequestId) {
      throw new Error('Failed to get CreateAccountStatusId from AWS Organizations');
    }

    // Poll for account creation (max 10 minutes)
    const maxAttempts = 60; // 60 attempts * 10 seconds = 10 minutes
    let attempts = 0;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds

      const statusCommand = new DescribeCreateAccountStatusCommand({
        CreateAccountRequestId: createAccountRequestId,
      });

      const statusResponse = await organizationsClient.send(statusCommand);
      const status = statusResponse.CreateAccountStatus?.State;

      if (status === 'SUCCEEDED') {
        const accountId = statusResponse.CreateAccountStatus?.AccountId;
        if (accountId) {
          console.log(`✅ AWS account created: ${accountId}`);
          return accountId;
        }
      } else if (status === 'FAILED') {
        const failureReason = statusResponse.CreateAccountStatus?.FailureReason;
        throw new Error(`AWS account creation failed: ${failureReason}`);
      }

      attempts++;
      console.log(`Waiting for AWS account creation... (attempt ${attempts}/${maxAttempts})`);
    }

    throw new Error('AWS account creation timed out after 10 minutes');
  } catch (error: any) {
    console.error('Error creating AWS account:', error);
    throw new Error(`Failed to create AWS account: ${error.message}`);
  }
}

/**
 * Deploy CloudFormation StackSet to lender's AWS account
 */
async function deployStackSet(awsAccountId: string, tenantId: string): Promise<string> {
  try {
    if (!STACKSET_NAME) {
      throw new Error('CLOUDFORMATION_STACKSET_NAME environment variable is not set');
    }

    console.log(`Deploying StackSet ${STACKSET_NAME} to account ${awsAccountId}`);

    const stackInstanceName = `Coheus-${tenantId.substring(0, 8)}`;

    const command = new CreateStackInstancesCommand({
      StackSetName: STACKSET_NAME,
      Accounts: [awsAccountId],
      Regions: [process.env.AWS_REGION || 'us-east-1'],
      ParameterOverrides: [
        { ParameterKey: 'TenantId', ParameterValue: tenantId },
        { ParameterKey: 'Environment', ParameterValue: 'production' },
        { ParameterKey: 'LenderName', ParameterValue: `Tenant-${tenantId.substring(0, 8)}` },
      ],
      OperationPreferences: {
        FailureToleranceCount: 0,
        MaxConcurrentCount: 1,
      },
    });

    await cloudFormationClient.send(command);

    // Poll for stack instance creation (max 20 minutes)
    const maxAttempts = 120; // 120 attempts * 10 seconds = 20 minutes
    let attempts = 0;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds

      const listCommand = new ListStackInstancesCommand({
        StackSetName: STACKSET_NAME,
        StackInstanceAccount: awsAccountId,
        StackInstanceRegion: process.env.AWS_REGION || 'us-east-1',
      });

      const listResponse = await cloudFormationClient.send(listCommand);
      const stackInstance = listResponse.Summaries?.[0];

      if (stackInstance) {
        const detailedStatus = stackInstance.StackInstanceStatus?.DetailedStatus;
        const status = stackInstance.StackInstanceStatus?.Status;

        if (detailedStatus === 'SUCCEEDED' || status === 'CURRENT') {
          const stackId = stackInstance.StackId;
          if (stackId) {
            console.log(`✅ StackSet deployed successfully: ${stackId}`);
            return stackId;
          }
        } else if (detailedStatus === 'FAILED' || status === 'FAILED') {
          throw new Error(`StackSet deployment failed: ${stackInstance.StackInstanceStatus?.StatusReason || 'Unknown error'}`);
        }
      }

      attempts++;
      console.log(`Waiting for StackSet deployment... (attempt ${attempts}/${maxAttempts})`);
    }

    throw new Error('StackSet deployment timed out after 20 minutes');
  } catch (error: any) {
    console.error('Error deploying StackSet:', error);
    throw new Error(`Failed to deploy StackSet: ${error.message}`);
  }
}

/**
 * Get infrastructure URLs from CloudFormation stack outputs
 */
async function getInfrastructureUrls(awsAccountId: string, stackId: string): Promise<{
  infrastructureUrl: string;
  adminUrl: string;
  backendUrl: string;
}> {
  try {
    // Query CloudFormation stack outputs
    const { DescribeStacksCommand } = await import('@aws-sdk/client-cloudformation');
    
    // Extract stack name from stack ID (format: arn:aws:cloudformation:region:account:stack/name/id)
    const stackName = stackId.includes('/') ? stackId.split('/')[1] : stackId;
    
    const command = new DescribeStacksCommand({
      StackName: stackName,
    });

    const response = await cloudFormationClient.send(command);
    const stack = response.Stacks?.[0];
    const outputs = stack?.Outputs || [];

    // Extract URLs from stack outputs
    const infrastructureUrl = outputs.find(o => o.OutputKey === 'InfrastructureUrl')?.OutputValue || '';
    const adminUrl = outputs.find(o => o.OutputKey === 'AdminUrl')?.OutputValue || '';
    const backendUrl = outputs.find(o => o.OutputKey === 'BackendUrl')?.OutputValue || '';

    if (infrastructureUrl && adminUrl && backendUrl) {
      return {
        infrastructureUrl,
        adminUrl,
        backendUrl,
      };
    }

    // Fallback: construct URLs based on naming convention if outputs not available
    // Use CloudFront distribution domain from stack outputs or construct
    const cloudFrontDomain = outputs.find(o => o.OutputKey === 'CloudFrontDomain')?.OutputValue;
    const baseUrl = cloudFrontDomain ? `https://${cloudFrontDomain}` : `https://coheus-${stackName.toLowerCase()}.cloudfront.net`;
    
    return {
      infrastructureUrl: baseUrl,
      adminUrl: `${baseUrl}/admin`,
      backendUrl: `${baseUrl}/api`,
    };
  } catch (error: any) {
    console.error('Error getting infrastructure URLs from CloudFormation:', error);
    // Fallback to constructed URLs
    const stackName = stackId.includes('/') ? stackId.split('/')[1] : stackId;
    const baseUrl = `https://coheus-${stackName.toLowerCase()}.cloudfront.net`;
    
    return {
      infrastructureUrl: baseUrl,
      adminUrl: `${baseUrl}/admin`,
      backendUrl: `${baseUrl}/api`,
    };
  }
}

/**
 * Create admin user in tenant's database.
 * When Cognito is enabled, the user is also created in Cognito with
 * a permanent password (no invite email — the password is returned
 * for external delivery as part of the provisioning output).
 */
async function createLenderAdmin(
  tenantId: string,
  email: string,
  lenderName: string
): Promise<{ username: string; password: string }> {
  try {
    const password = generateSecurePassword(16);
    const bcrypt = await import('bcryptjs');
    const crypto = await import('crypto');
    const cognitoAuth = await import('./cognito/cognitoAuthService.js');

    let cognitoSub: string | null = null;

    if (cognitoAuth.isCognitoAuthEnabled()) {
      try {
        const result = await cognitoAuth.createUser(email, password, lenderName, false);
        cognitoSub = result.cognitoSub;
      } catch (cognitoErr: any) {
        if (cognitoErr.code === 'USER_EXISTS') {
          try {
            const existing = await cognitoAuth.getUser(email);
            cognitoSub = existing.cognitoSub;
          } catch { cognitoSub = null; }
        } else {
          throw cognitoErr;
        }
      }
    }

    const hashedPassword = cognitoAuth.isCognitoAuthEnabled()
      ? crypto.randomBytes(32).toString('hex')
      : await bcrypt.hash(password, 10);

    const userResult = await pool.query(
      `INSERT INTO public.users (email, password_hash, role, is_active, created_at, cognito_sub)
       VALUES ($1, $2, $3, true, NOW(), $4)
       RETURNING id, email`,
      [email, hashedPassword, 'tenant_admin', cognitoSub]
    );

    const userId = userResult.rows[0].id;

    await pool.query(
      `INSERT INTO public.profiles (user_id, full_name, tenant_id, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE
       SET full_name = EXCLUDED.full_name, tenant_id = EXCLUDED.tenant_id`,
      [userId, lenderName, tenantId]
    );

    console.log(`Admin user created for tenant ${tenantId}${cognitoSub ? ' (Cognito linked)' : ''}`);

    return {
      username: email,
      password: password,
    };
  } catch (error: any) {
    console.error('Error creating admin user:', error);
    throw new Error(`Failed to create admin user: ${error.message}`);
  }
}

/**
 * Main provisioning function - orchestrates the entire process
 */
export async function provisionLenderInfrastructure(
  tenantId: string,
  lenderName: string,
  lenderEmail: string,
  checkoutSessionId: string
): Promise<ProvisioningResult> {
  let awsAccountId: string | null = null;
  let stackId: string | null = null;

  try {
    // Create deployment record
    await pool.query(
      `INSERT INTO public.aws_deployments 
       (tenant_id, status, provisioning_status, provisioning_started_at)
       VALUES ($1, 'provisioning', 'account_creation', NOW())
       ON CONFLICT (tenant_id) DO UPDATE
       SET status = 'provisioning', provisioning_status = 'account_creation', 
           provisioning_started_at = NOW(), updated_at = NOW()`,
      [tenantId]
    );

    // Update subscription provisioning status
    await pool.query(
      `UPDATE public.tenant_subscriptions
       SET provisioning_status = 'in_progress',
           stripe_checkout_session_id = $2,
           updated_at = NOW()
       WHERE tenant_id = $1`,
      [tenantId, checkoutSessionId]
    );

    const startTime = Date.now();
    
    // Step 1: Create AWS account (3-5 minutes) with retry
    console.log(`Step 1: Creating AWS account for tenant ${tenantId}...`);
    awsAccountId = await retryWithBackoff(
      () => createAWSAccount(lenderName, lenderEmail),
      3,
      5000
    );
    
    // Check timeout
    if (Date.now() - startTime > PROVISIONING_TIMEOUT) {
      throw new Error('Provisioning timeout exceeded 30 minutes');
    }

    await pool.query(
      `UPDATE public.aws_deployments
       SET aws_account_id = $2, provisioning_status = 'stack_deployment', updated_at = NOW()
       WHERE tenant_id = $1`,
      [tenantId, awsAccountId]
    );

    await pool.query(
      `UPDATE public.tenant_subscriptions
       SET aws_account_id = $2, updated_at = NOW()
       WHERE tenant_id = $1`,
      [tenantId, awsAccountId]
    );

    // Step 2: Deploy CloudFormation StackSet (10-15 minutes) with retry
    console.log(`Step 2: Deploying infrastructure to account ${awsAccountId}...`);
    stackId = await retryWithBackoff(
      () => deployStackSet(awsAccountId!, tenantId),
      3,
      10000
    );
    
    // Check timeout
    if (Date.now() - startTime > PROVISIONING_TIMEOUT) {
      throw new Error('Provisioning timeout exceeded 30 minutes');
    }

    await pool.query(
      `UPDATE public.aws_deployments
       SET stack_id = $2, provisioning_status = 'admin_setup', updated_at = NOW()
       WHERE tenant_id = $1`,
      [tenantId, stackId]
    );

    // Step 3: Get infrastructure URLs
    const urls = await getInfrastructureUrls(awsAccountId, stackId);

    // Step 4: Create admin user with retry
    console.log(`Step 4: Creating admin user for tenant ${tenantId}...`);
    const adminCredentials = await retryWithBackoff(
      () => createLenderAdmin(tenantId, lenderEmail, lenderName),
      3,
      2000
    );

    // Step 5: Update deployment record as completed
    await pool.query(
      `UPDATE public.aws_deployments
       SET status = 'active',
           provisioning_status = 'completed',
           stack_id = $2,
           infrastructure_url = $3,
           admin_url = $4,
           backend_url = $5,
           provisioning_completed_at = NOW(),
           updated_at = NOW()
       WHERE tenant_id = $1`,
      [tenantId, stackId, urls.infrastructureUrl, urls.adminUrl, urls.backendUrl]
    );

    await pool.query(
      `UPDATE public.tenant_subscriptions
       SET provisioning_status = 'completed', updated_at = NOW()
       WHERE tenant_id = $1`,
      [tenantId]
    );

    // Store admin credentials in metadata (temporary - will be sent via email)
    await pool.query(
      `UPDATE public.aws_deployments
       SET metadata = jsonb_build_object(
         'admin_username', $2,
         'admin_password', $3
       ),
       updated_at = NOW()
       WHERE tenant_id = $1`,
      [tenantId, adminCredentials.username, adminCredentials.password]
    );

    console.log(`✅ Provisioning completed for tenant ${tenantId}`);

    return {
      awsAccountId,
      stackId,
      ...urls,
    };
  } catch (error: any) {
    console.error(`❌ Provisioning failed for tenant ${tenantId}:`, error);

    // Update deployment record with error
    await pool.query(
      `UPDATE public.aws_deployments
       SET status = 'failed',
           error_message = $2,
           updated_at = NOW()
       WHERE tenant_id = $1`,
      [tenantId, error.message || 'Unknown error']
    ).catch(console.error);

    await pool.query(
      `UPDATE public.tenant_subscriptions
       SET provisioning_status = 'failed', updated_at = NOW()
       WHERE tenant_id = $1`,
      [tenantId]
    ).catch(console.error);

    // Send error notification email
    try {
      const { sendProvisioningErrorEmail } = await import('./emailService.js');
      await sendProvisioningErrorEmail(lenderEmail, lenderName, error.message || 'Unknown error');
    } catch (emailError: any) {
      console.error('Failed to send error notification email:', emailError);
    }

    throw error;
  }
}

/**
 * Get provisioning status for a tenant
 */
export async function getProvisioningStatus(tenantId: string): Promise<{
  status: string;
  provisioningStatus: string | null;
  progress: number;
  estimatedTimeRemaining: number | null;
  errorMessage: string | null;
  infrastructureUrl: string | null;
  adminUrl: string | null;
}> {
  const result = await pool.query(
    `SELECT 
      status,
      provisioning_status,
      error_message,
      infrastructure_url,
      admin_url,
      provisioning_started_at,
      provisioning_completed_at
     FROM public.aws_deployments
     WHERE tenant_id = $1`,
    [tenantId]
  );

  if (result.rows.length === 0) {
    return {
      status: 'pending',
      provisioningStatus: null,
      progress: 0,
      estimatedTimeRemaining: null,
      errorMessage: null,
      infrastructureUrl: null,
      adminUrl: null,
    };
  }

  const deployment = result.rows[0];
  let progress = 0;
  let estimatedTimeRemaining: number | null = null;

  if (deployment.provisioning_status === 'account_creation') {
    progress = 25;
    estimatedTimeRemaining = 5 * 60; // 5 minutes
  } else if (deployment.provisioning_status === 'stack_deployment') {
    progress = 50;
    estimatedTimeRemaining = 15 * 60; // 15 minutes
  } else if (deployment.provisioning_status === 'admin_setup') {
    progress = 75;
    estimatedTimeRemaining = 2 * 60; // 2 minutes
  } else if (deployment.provisioning_status === 'completed') {
    progress = 100;
    estimatedTimeRemaining = 0;
  }

  return {
    status: deployment.status,
    provisioningStatus: deployment.provisioning_status,
    progress,
    estimatedTimeRemaining,
    errorMessage: deployment.error_message,
    infrastructureUrl: deployment.infrastructure_url,
    adminUrl: deployment.admin_url,
  };
}
