# Ailethia Voice Feature - AWS Console Deployment Guide

This guide provides step-by-step instructions for deploying and configuring the Ailethia voice feature on AWS using only the AWS Management Console (no CLI commands required).

## Prerequisites

Before starting, ensure you have:
- AWS account with appropriate permissions
- Access to AWS Secrets Manager
- CloudFormation stack deployment permissions
- Frontend build environment set up
- Your AI Gateway API key ready

---

## Step 1: Create/Verify AWS Secrets Manager Secret

The Lambda function requires the AI Gateway API key to be stored in AWS Secrets Manager.

### 1.1 Navigate to AWS Secrets Manager

1. Open the AWS Management Console: https://console.aws.amazon.com/
2. In the top-right corner, select your AWS region (e.g., `us-east-1`)
3. In the search bar at the top, type "Secrets Manager" and select it from the dropdown
4. You should now be on the AWS Secrets Manager dashboard

### 1.2 Check if the Secret Already Exists

1. In the Secrets list, look for a secret named `coheus/ai-gateway-api-key`
2. **If the secret exists:**
   - Click on the secret name to open it
   - Review the details to ensure it's the correct secret
   - If you need to update the value, proceed to **Step 1.4**
   - If the value is correct, proceed to **Step 1.5** to verify permissions
3. **If the secret does NOT exist:**
   - Proceed to **Step 1.3** to create it

### 1.3 Create the Secret (New Secret)

1. Click the **"Store a new secret"** button (orange button in the top-right)
2. **Select secret type:**
   - Choose **"Other type of secret"**
3. **Enter the secret value:**
   - Click on the **"Plaintext"** tab (not the Key/value tab)
   - In the text area, paste or type your AI Gateway API key
   - Example: `sk-...` or your specific API key string
4. Click **"Next"**
5. **Secret name:**
   - In the "Secret name" field, enter: `coheus/ai-gateway-api-key`
   - This must match exactly (case-sensitive)
6. **Description (optional):**
   - Enter: `AI Gateway API key for Ailethia briefing generation`
7. **Encryption key:**
   - Select **"Specify a KMS key alias"**
   - In the dropdown or text field, enter: `alias/coheus-encryption`
   - If this alias doesn't exist, you can:
     - Use the default AWS managed key: `aws/secretsmanager`
     - Or create a KMS key first (see note below)
8. Click **"Next"**
9. **Configure rotation (optional):**
   - Select **"Disable automatic rotation"** (API keys typically don't rotate automatically)
   - Click **"Next"**
10. **Review:**
    - Verify the secret name is: `coheus/ai-gateway-api-key`
    - Verify the encryption key is correct
    - Review the description
11. Click **"Store"**
12. You should see a success message. Note the ARN shown on the success page (you may need it later)

**Note:** If you need to create a KMS key first:
- Navigate to AWS KMS (Key Management Service)
- Click "Create key"
- Choose "Symmetric" key type
- Create an alias: `coheus-encryption`
- Grant permissions to your Lambda execution role
- Return to Secrets Manager and use this alias

### 1.4 Update Existing Secret (If Already Exists)

1. Click on the secret name `coheus/ai-gateway-api-key` in the secrets list
2. Click the **"Retrieve secret value"** button
3. Click the **"Edit"** button (top-right)
4. **Update the secret value:**
   - Select the **"Plaintext"** tab
   - Replace the existing value with your new API key
5. Click **"Save"**
6. Confirm the update when prompted

### 1.5 Verify Secret Permissions

1. With the secret `coheus/ai-gateway-api-key` open, click on the **"Resource permissions"** tab
2. Review the permissions list to ensure your Lambda execution role can access it
3. **If permissions are missing:**
   - Click **"Edit permissions"**
   - Click **"Add a principal"**
   - In the "Principal" field, enter your Lambda execution role ARN:
     - Format: `arn:aws:iam::ACCOUNT_ID:role/coheus-lambda-execution-role-dev`
     - Replace `ACCOUNT_ID` with your AWS account ID
     - Replace `dev` with your stage if different
   - In "Actions", select: `secretsmanager:GetSecretValue`
   - Click **"Save"**
4. **Alternative:** If using resource-based policies, ensure the Lambda role has the `secretsmanager:GetSecretValue` permission in IAM

---

## Step 2: Deploy Lambda Stack with AiGatewayUrl Parameter

Deploy or update the CloudFormation stack with the new configuration.

### 2.1 Navigate to CloudFormation

1. In the AWS Management Console, search for **"CloudFormation"** in the search bar
2. Click on **"CloudFormation"** to open the service
3. Click on **"Stacks"** in the left sidebar

### 2.2 Check if Stack Already Exists

1. In the Stacks list, look for a stack named `coheus-lambda-functions-dev` (or your specific stack name)
2. **If the stack exists:**
   - Click on the stack name to select it
   - Click the **"Update"** button (top-right)
   - Proceed to **Step 2.4**
3. **If the stack does NOT exist:**
   - Click the **"Create stack"** button (top-right)
   - Proceed to **Step 2.3**

### 2.3 Create New Stack

1. **Prerequisite - Prepare template:**
   - Select **"Upload a template file"**
   - Click **"Choose file"**
   - Navigate to and select: `infrastructure/cloudformation/coheus_lambda_functions_stack.yaml`
   - **OR** if the template is already in S3:
     - Select **"Amazon S3 URL"**
     - Enter the S3 URL where your template is stored
2. Click **"Next"** at the bottom

### 2.4 Specify Stack Details

1. **Stack name:**
   - Enter: `coheus-lambda-functions-dev` (or your stage name like `coheus-lambda-functions-prod`)

2. **Parameters section** - Fill in all required parameters:

   - **Stage:**
     - Select: `dev` (or `prod` from the dropdown)
   
   - **AiGatewayUrl:**
     - **This is the critical parameter for Ailethia voice feature**
     - Default value: `https://api.openai.com/v1/chat/completions`
     - **If using a custom AI Gateway:**
       - Replace with your custom URL, e.g., `https://your-custom-gateway.com/v1/chat/completions`
     - **If using OpenAI:**
       - Keep the default value
   
   - **DBHost:**
     - Enter your RDS database endpoint
     - Format: `coheus-db.region.rds.amazonaws.com`
     - Find this in: RDS Console → Databases → Your database → Connectivity & security → Endpoint
   
   - **DBName:**
     - Enter: `coheus` (or your database name)
   
   - **DBUser:**
     - Enter: `coheusadmin` (or your database username)
   
   - **DBPassword:**
     - Enter your database password
     - This field is masked for security
   
   - **DBPort:**
     - Enter: `5432` (default PostgreSQL port)
   
   - **SecurityGroupId:**
     - Enter your Lambda security group ID
     - Format: `sg-0123456789abcdef0`
     - Find this in: EC2 Console → Security Groups → Look for your Lambda security group
   
   - **SubnetId1:**
     - Enter your first private subnet ID
     - Format: `subnet-0123456789abcdef0`
     - Find this in: VPC Console → Subnets → Look for your private subnet
   
   - **SubnetId2:**
     - Enter your second private subnet ID
     - Format: `subnet-0fedcba9876543210`
     - Find this in: VPC Console → Subnets → Look for your second private subnet
   
   - **KMSKeyId:**
     - Enter: `alias/coheus-encryption`
     - Or use the KMS key ID if you have it
   
   - **SiteUrl:**
     - Enter your site URL
     - Example: `https://d2wvs4i87rs881.cloudfront.net`
   
   - **FrontendUrl:**
     - Enter your frontend URL
     - Example: `https://d2wvs4i87rs881.cloudfront.net`

3. Click **"Next"** at the bottom

### 2.5 Configure Stack Options

1. **Tags (optional but recommended):**
   - Click **"Add tag"**
   - Key: `Environment`, Value: `dev` (or your stage)
   - Click **"Add tag"** again
   - Key: `Project`, Value: `coheus`
   - Add any other tags your organization requires

2. **Permissions:**
   - **IAM role:** Leave as default unless you have a specific role for CloudFormation
   - If you need to create IAM resources, ensure the role has `iam:CreateRole` permissions

3. **Stack failure options:**
   - Use default settings (Roll back all stack resources)

4. **Advanced options:**
   - Use defaults unless you have specific requirements
   - **Notification options:** Optional - configure SNS notifications if desired

5. Click **"Next"** at the bottom

### 2.6 Review and Create/Update

1. **Review all settings:**
   - Scroll through and verify:
     - Stack name is correct
     - **AiGatewayUrl parameter is set correctly** (this is critical!)
     - All database parameters are correct
     - All VPC parameters (subnets, security groups) are correct
     - All URLs are correct

2. **Capabilities:**
   - Check the box: **"I acknowledge that AWS CloudFormation might create IAM resources"**
   - This is required because the stack creates IAM roles

3. **Create/Update:**
   - Click **"Create stack"** (for new stack) or **"Update stack"** (for existing stack)

4. **Wait for completion:**
   - You'll be redirected to the stack details page
   - Watch the **"Events"** tab for progress
   - Status will show: `CREATE_IN_PROGRESS` → `CREATE_COMPLETE` (or `UPDATE_IN_PROGRESS` → `UPDATE_COMPLETE`)
   - **This may take 5-15 minutes** depending on the resources being created
   - Refresh the page periodically to see updates

### 2.7 Get API Gateway REST URL from Outputs

1. **After the stack status shows `CREATE_COMPLETE` or `UPDATE_COMPLETE`:**
   - Stay on the stack details page
   - Click on the **"Outputs"** tab (at the top of the page)

2. **Find the API Gateway URL:**
   - Look for an output key named **"ApiGatewayRestUrl"** (or **"RestApiUrl"**)
   - The value will look like: `https://abc123xyz.execute-api.us-east-1.amazonaws.com/dev`
   - **Copy this entire URL** - you'll need it in the next step

3. **Save this URL:**
   - Paste it into a text file or note-taking app
   - Make sure to copy the full URL including `https://` and the stage name at the end

---

## Step 3: Set VITE_API_GATEWAY_REST_URL During Frontend Build

Configure the frontend to use the API Gateway REST URL during the build process.

### 3.1 Get API Gateway URL (If Not Already Saved)

If you didn't save the URL from Step 2.7:

1. Go to AWS CloudFormation Console
2. Click on your stack: `coheus-lambda-functions-dev`
3. Click on the **"Outputs"** tab
4. Find **"ApiGatewayRestUrl"** (or **"RestApiUrl"**)
5. **Copy the full URL** (e.g., `https://abc123xyz.execute-api.us-east-1.amazonaws.com/dev`)

### 3.2 Option A: Set Environment Variable in Local Build

**For Windows (PowerShell):**

1. Open PowerShell
2. Navigate to your project directory:
   ```powershell
   cd C:\path\to\coheus
   ```
3. Set the environment variable:
   ```powershell
   $env:VITE_API_GATEWAY_REST_URL="https://abc123xyz.execute-api.us-east-1.amazonaws.com/dev"
   ```
   (Replace with your actual API Gateway URL)
4. Verify it's set:
   ```powershell
   echo $env:VITE_API_GATEWAY_REST_URL
   ```
5. Build the frontend:
   ```powershell
   npm run build
   ```

**For Windows (Command Prompt):**

1. Open Command Prompt (CMD)
2. Navigate to your project directory:
   ```cmd
   cd C:\path\to\coheus
   ```
3. Set the environment variable:
   ```cmd
   set VITE_API_GATEWAY_REST_URL=https://abc123xyz.execute-api.us-east-1.amazonaws.com/dev
   ```
   (Replace with your actual API Gateway URL)
4. Verify it's set:
   ```cmd
   echo %VITE_API_GATEWAY_REST_URL%
   ```
5. Build the frontend:
   ```cmd
   npm run build
   ```

**For Linux/Mac:**

1. Open Terminal
2. Navigate to your project directory:
   ```bash
   cd /path/to/coheus
   ```
3. Set the environment variable:
   ```bash
   export VITE_API_GATEWAY_REST_URL="https://abc123xyz.execute-api.us-east-1.amazonaws.com/dev"
   ```
   (Replace with your actual API Gateway URL)
4. Verify it's set:
   ```bash
   echo $VITE_API_GATEWAY_REST_URL
   ```
5. Build the frontend:
   ```bash
   npm run build
   ```

### 3.3 Option B: Create/Update .env.production File

1. **Navigate to your project root directory** using File Explorer (Windows) or Finder (Mac)

2. **Create or open the file:**
   - Look for a file named `.env.production`
   - If it doesn't exist, create a new text file with this exact name
   - **Important:** Make sure the file starts with a dot (`.env.production`)

3. **Add the environment variable:**
   - Open the file in a text editor (Notepad, VS Code, etc.)
   - Add this line:
     ```
     VITE_API_GATEWAY_REST_URL=https://abc123xyz.execute-api.us-east-1.amazonaws.com/dev
     ```
   - **Replace** `https://abc123xyz.execute-api.us-east-1.amazonaws.com/dev` with your actual API Gateway URL from Step 2.7

4. **Save the file**

5. **Build the frontend:**
   - Open your terminal/command prompt
   - Navigate to the project directory
   - Run: `npm run build`

### 3.4 Option C: Set in GitHub Actions (CI/CD)

If you're using GitHub Actions for automated deployment:

1. **Go to your GitHub repository:**
   - Open your browser and navigate to: `https://github.com/YOUR_USERNAME/coheus`
   - Replace `YOUR_USERNAME` with your GitHub username

2. **Navigate to Secrets:**
   - Click on **"Settings"** tab (at the top of the repository)
   - In the left sidebar, click **"Secrets and variables"**
   - Click **"Actions"**

3. **Add the secret:**
   - Click **"New repository secret"** button
   - **Name:** Enter exactly: `VITE_API_GATEWAY_REST_URL`
   - **Secret:** Paste your API Gateway URL from Step 2.7
     - Example: `https://abc123xyz.execute-api.us-east-1.amazonaws.com/dev`
   - Click **"Add secret"**

4. **Update your GitHub Actions workflow:**
   - Go back to your repository
   - Navigate to: `.github/workflows/deploy-aws.yml`
   - Click on the file to open it
   - Click **"Edit"** (pencil icon)
   - Find the build step (look for `npm run build` or similar)
   - Update it to include the environment variable:
     ```yaml
     - name: Build frontend
       env:
         VITE_API_GATEWAY_REST_URL: ${{ secrets.VITE_API_GATEWAY_REST_URL }}
       run: |
         npm ci
         npm run build
     ```
   - Click **"Commit changes"**
   - Add a commit message: "Add API Gateway URL to frontend build"
   - Click **"Commit changes"**

### 3.5 Verify Build Configuration

After building, verify the API Gateway URL is included:

1. **Navigate to your build output directory:**
   - Typically: `docs/` or `dist/` folder in your project

2. **Search for the API Gateway URL:**
   - Open the `index.html` file in a text editor
   - Use Find/Search (Ctrl+F or Cmd+F)
   - Search for: `execute-api`
   - You should see your API Gateway URL in the JavaScript code

3. **Alternative verification:**
   - Open your browser's Developer Tools (F12)
   - Go to the Network tab
   - Load your application
   - Look for requests to `execute-api` domain
   - This confirms the frontend is using the API Gateway URL

---

## Step 4: Test the Deployment

### 4.1 Test Lambda Function via API Gateway

1. **Get your API Gateway URL** (from Step 2.7)

2. **Test using a REST client:**
   - Use a tool like Postman, or your browser's developer console
   - **Method:** POST
   - **URL:** `https://YOUR_API_GATEWAY_URL/ailethia-briefing`
   - **Headers:**
     - `Content-Type: application/json`
   - **Body (JSON):**
     ```json
     {
       "businessContext": {
         "dialogues": ["Test briefing message"]
       },
       "type": "briefing"
     }
     ```

3. **Check the response:**
   - You should receive a JSON response with a `script` field
   - If you get an error, check CloudWatch Logs (see Step 4.3)

### 4.2 Test from Frontend Application

1. **Deploy your frontend** to your hosting (S3, CloudFront, etc.)

2. **Open the application** in a browser

3. **Navigate to the Ailethia voice feature:**
   - Look for a "Start Briefing" or similar button
   - Click it

4. **Check browser console:**
   - Press F12 to open Developer Tools
   - Click on the "Console" tab
   - Look for any error messages
   - You should see successful API calls to your API Gateway

5. **Verify functionality:**
   - The briefing should generate
   - Text-to-speech should play the briefing
   - No CORS errors should appear

### 4.3 Check CloudWatch Logs

1. **Navigate to CloudWatch:**
   - In AWS Console, search for "CloudWatch"
   - Click on "CloudWatch"

2. **View Lambda logs:**
   - In the left sidebar, click **"Log groups"**
   - Look for: `/aws/lambda/coheus-ailethia-briefing-dev`
   - Click on it

3. **View recent logs:**
   - Click on the most recent log stream
   - Review the logs for:
     - Successful secret retrieval
     - AI Gateway API calls
     - Any error messages

4. **Look for errors:**
   - If you see "Failed to get secret", check Step 1.5 (permissions)
   - If you see connection errors, check VPC/NAT Gateway configuration
   - If you see API Gateway errors, verify the `AI_GATEWAY_URL` parameter

---

## Troubleshooting

### Issue: "API Gateway REST URL not configured" Error

**Symptoms:** Frontend shows error message about API Gateway URL not being configured

**Solutions:**
1. Verify `VITE_API_GATEWAY_REST_URL` was set during build
2. Check the built files contain the API Gateway URL (see Step 3.5)
3. Rebuild the frontend with the environment variable set
4. Clear browser cache and reload

### Issue: "Failed to get secret" Error in CloudWatch Logs

**Symptoms:** Lambda function logs show "Failed to get secret" or "AccessDenied"

**Solutions:**
1. Go to Secrets Manager → Verify secret `coheus/ai-gateway-api-key` exists
2. Check secret permissions (Step 1.5) - Lambda role needs access
3. Verify KMS key permissions - Lambda role needs decrypt permission
4. Check IAM role has `secretsmanager:GetSecretValue` permission

### Issue: Lambda Timeout or Connection Errors

**Symptoms:** Lambda function times out or can't connect to external APIs

**Solutions:**
1. **Check VPC Configuration:**
   - Go to VPC Console → Subnets
   - Verify Lambda is in private subnets
   - Check route table routes internet traffic through NAT Gateway

2. **Check NAT Gateway:**
   - Go to VPC Console → NAT Gateways
   - Verify NAT Gateway is running and has a public IP
   - Check it's in a public subnet

3. **Check Security Group:**
   - Go to EC2 Console → Security Groups
   - Find your Lambda security group
   - Verify outbound rules allow HTTPS (port 443) to `0.0.0.0/0`

### Issue: CORS Errors in Browser

**Symptoms:** Browser console shows CORS errors when calling API Gateway

**Solutions:**
1. Verify OPTIONS method is configured in API Gateway (should be automatic)
2. Check API Gateway CORS configuration includes your frontend origin
3. Verify Lambda function returns CORS headers (should be automatic)
4. Test OPTIONS preflight request manually

### Issue: AI Gateway API Errors

**Symptoms:** Lambda logs show errors from AI Gateway API

**Solutions:**
1. Verify `AI_GATEWAY_URL` parameter in CloudFormation stack is correct
2. Check the API key in Secrets Manager is valid
3. Verify API key has sufficient credits/quota
4. Check the AI Gateway URL is accessible from Lambda's VPC
5. Review CloudWatch logs for detailed error messages

---

## Production Deployment Checklist

Before deploying to production, verify:

- [ ] Secret `coheus/ai-gateway-api-key` exists in production AWS account
- [ ] Secret is encrypted with production KMS key
- [ ] Lambda execution role has Secrets Manager permissions
- [ ] KMS key allows Lambda role to decrypt
- [ ] VPC/NAT Gateway is configured in production
- [ ] Lambda functions are deployed with `prod` stage
- [ ] `AiGatewayUrl` parameter is set correctly for production
- [ ] API Gateway URL is retrieved from production stack outputs
- [ ] Frontend is built with production API Gateway URL
- [ ] CORS configuration allows production frontend origin
- [ ] CloudWatch alarms are configured for Lambda errors
- [ ] Cost monitoring is set up for Lambda and API Gateway usage

---

## Summary

After completing these steps:

1. ✅ AI Gateway API key is stored in AWS Secrets Manager
2. ✅ Lambda function is deployed with `AI_GATEWAY_URL` environment variable
3. ✅ API Gateway is configured with CORS support
4. ✅ Frontend is built with `VITE_API_GATEWAY_REST_URL` configured
5. ✅ Ailethia voice feature is ready to use on AWS

The Ailethia briefing feature should now work correctly when users interact with it from the deployed frontend application.

---

## Quick Reference

**Key URLs to Save:**
- API Gateway REST URL: `https://YOUR_API_ID.execute-api.REGION.amazonaws.com/STAGE`
- Secret ARN: `arn:aws:secretsmanager:REGION:ACCOUNT_ID:secret:coheus/ai-gateway-api-key-XXXXX`
- Lambda Function: `coheus-ailethia-briefing-STAGE`
- CloudFormation Stack: `coheus-lambda-functions-STAGE`

**Important Parameters:**
- Secret Name: `coheus/ai-gateway-api-key` (exact match required)
- KMS Key: `alias/coheus-encryption`
- Environment Variable: `VITE_API_GATEWAY_REST_URL`
- CloudFormation Parameter: `AiGatewayUrl`
