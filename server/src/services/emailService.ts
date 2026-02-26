/**
 * Email Service
 * Handles sending emails for subscription and provisioning updates
 * Supports AWS SES, SendGrid, and Resend
 */

import { logEmailSend } from "./emailAuditLogger.js";

const SES_CONFIGURATION_SET = process.env.SES_CONFIGURATION_SET || "my-first-configuration-set";

const EMAIL_MAX_RETRIES = 3;
const EMAIL_RETRY_DELAY_MS = 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = EMAIL_MAX_RETRIES): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const waitMs = EMAIL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`Email send attempt ${attempt}/${maxAttempts} failed, retrying in ${waitMs}ms:`, err);
        await delay(waitMs);
      }
    }
  }
  throw lastError;
}

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** For audit log; when set, a row is written to email_send_log. */
  emailType?: string;
  containsPii?: boolean;
  userId?: string | null;
  tenantId?: string | null;
}

export interface DailyBriefEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** When set, email is sent with List-Unsubscribe / List-Unsubscribe-Post headers (CAN-SPAM). */
  unsubscribeUrl?: string;
  /** For audit log. */
  emailType?: string;
  containsPii?: boolean;
  userId?: string | null;
  tenantId?: string | null;
}

/**
 * Send email using configured provider.
 * Returns SES MessageId when using SES (for delivery tracking in AWS console).
 */
async function sendEmail(options: EmailOptions): Promise<string | undefined> {
  const emailProvider = process.env.EMAIL_PROVIDER || "ses"; // ses, sendgrid, resend

  try {
    switch (emailProvider) {
      case "ses":
        return await withRetry(() => sendViaSES(options));
      case "sendgrid":
        await withRetry(() => sendViaSendGrid(options));
        return undefined;
      case "resend":
        await withRetry(() => sendViaResend(options));
        return undefined;
      default:
        console.warn(
          `Unknown email provider: ${emailProvider}. Email not sent.`,
        );
        console.log("Email would be sent:", options);
        return undefined;
    }
  } catch (error: unknown) {
    console.error("Error sending email after retries:", error);
    // Don't throw - email failures shouldn't break the flow
    // Log for manual retry
    return undefined;
  }
}

export async function sendDailyBriefNewsletterEmail(
  options: DailyBriefEmailOptions,
): Promise<string | undefined> {
  const auditOpts = {
    emailType: options.emailType ?? "daily_brief",
    containsPii: options.containsPii ?? false,
    userId: options.userId ?? null,
    tenantId: options.tenantId ?? null,
  };
  if (options.unsubscribeUrl) {
    await sendDailyBriefWithUnsubscribe(options);
    await logEmailSend({
      recipientEmail: options.to,
      ...auditOpts,
    });
    return undefined;
  }
  return sendEmail({ ...options, ...auditOpts });
}

/**
 * Send daily brief with List-Unsubscribe and List-Unsubscribe-Post headers (CAN-SPAM).
 * Uses raw MIME for SES so we can set custom headers.
 */
async function sendDailyBriefWithUnsubscribe(options: DailyBriefEmailOptions): Promise<void> {
  const emailProvider = process.env.EMAIL_PROVIDER || "ses";
  const listUnsubscribe = `<${options.unsubscribeUrl}>`;
  const listUnsubscribePost = "List-Unsubscribe=One-Click";

  try {
    if (emailProvider === "ses") {
      await withRetry(() =>
        sendDailyBriefWithUnsubscribeSES(options, listUnsubscribe, listUnsubscribePost),
      );
    } else if (emailProvider === "sendgrid") {
      await withRetry(() =>
        sendDailyBriefWithUnsubscribeSendGrid(options, listUnsubscribe, listUnsubscribePost),
      );
    } else if (emailProvider === "resend") {
      await withRetry(() =>
        sendDailyBriefWithUnsubscribeResend(options, listUnsubscribe, listUnsubscribePost),
      );
    } else {
      await sendEmail(options);
    }
  } catch (error: unknown) {
    console.error("Error sending daily brief with unsubscribe after retries:", error);
  }
}

async function sendDailyBriefWithUnsubscribeSES(
  options: DailyBriefEmailOptions,
  listUnsubscribe: string,
  listUnsubscribePost: string
): Promise<void> {
  const { SESClient, SendRawEmailCommand } = await import("@aws-sdk/client-ses");
  const sesClient = new SESClient({
    region: process.env.AWS_SES_REGION || "us-east-1",
  });
  const from = process.env.EMAIL_FROM_ADDRESS || "noreply@coheus.com";
  const boundary = "boundary_" + Math.random().toString(36).slice(2);
  const subject = Buffer.from(options.subject, "utf-8").toString("base64");
  const encodedSubject = "=?UTF-8?B?" + subject + "?=";

  const rawMessage = [
    `From: ${from}`,
    `To: ${options.to}`,
    `Subject: ${encodedSubject}`,
    "List-Unsubscribe: " + listUnsubscribe,
    "List-Unsubscribe-Post: " + listUnsubscribePost,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    options.text || "",
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    options.html,
    "",
    `--${boundary}--`,
  ].join("\r\n");

  const command = new SendRawEmailCommand({
    RawMessage: { Data: Buffer.from(rawMessage, "utf-8") },
    ConfigurationSetName: SES_CONFIGURATION_SET,
  });
  const result = await sesClient.send(command);
  console.log(
    `✅ Daily brief sent via SES to ${options.to} (with List-Unsubscribe) MessageId=${result.MessageId ?? "n/a"}`
  );
}

async function sendDailyBriefWithUnsubscribeSendGrid(
  options: DailyBriefEmailOptions,
  listUnsubscribe: string,
  listUnsubscribePost: string
): Promise<void> {
  const sgMail = (await import("@sendgrid/mail")) as { setApiKey: (k: string) => void; send: (o: unknown) => Promise<unknown> };
  sgMail.setApiKey(process.env.SENDGRID_API_KEY || "");
  await sgMail.send({
    to: options.to,
    from: process.env.EMAIL_FROM_ADDRESS || "noreply@coheus.com",
    subject: options.subject,
    html: options.html,
    text: options.text,
    headers: {
      "List-Unsubscribe": listUnsubscribe,
      "List-Unsubscribe-Post": listUnsubscribePost,
    },
  });
  console.log(`✅ Daily brief sent via SendGrid to ${options.to} (with List-Unsubscribe)`);
}

async function sendDailyBriefWithUnsubscribeResend(
  options: DailyBriefEmailOptions,
  listUnsubscribe: string,
  listUnsubscribePost: string
): Promise<void> {
  const resendModule = await import("resend");
  const resend = new resendModule.Resend(process.env.RESEND_API_KEY || "");
  await resend.emails.send({
    from: process.env.EMAIL_FROM_ADDRESS || "noreply@coheus.com",
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
    headers: {
      "List-Unsubscribe": listUnsubscribe,
      "List-Unsubscribe-Post": listUnsubscribePost,
    },
  });
  console.log(`✅ Daily brief sent via Resend to ${options.to} (with List-Unsubscribe)`);
}

/**
 * Send email via AWS SES
 */
async function sendViaSES(options: EmailOptions): Promise<string | undefined> {
  const region = process.env.AWS_SES_REGION || "us-east-1";
  const from = process.env.EMAIL_FROM_ADDRESS || "noreply@coheus.com";
  try {
    const { SESClient, SendEmailCommand } = await import("@aws-sdk/client-ses");
    const sesClient = new SESClient({ region });

    const command = new SendEmailCommand({
      Source: from,
      Destination: {
        ToAddresses: [options.to],
      },
      Message: {
        Subject: {
          Data: options.subject,
          Charset: "UTF-8",
        },
        Body: {
          Html: {
            Data: options.html,
            Charset: "UTF-8",
          },
          Text: options.text
            ? {
                Data: options.text,
                Charset: "UTF-8",
              }
            : undefined,
        },
      },
      ConfigurationSetName: SES_CONFIGURATION_SET,
    });

    const result = await sesClient.send(command);
    const messageId = result.MessageId;
    console.log(`✅ Email sent via SES to ${options.to} | MessageId=${messageId ?? "n/a"} | From=${from} | Region=${region} | ConfigSet=${SES_CONFIGURATION_SET}`);
    return messageId ?? undefined;
  } catch (error: unknown) {
    console.error(`❌ SES email error (To=${options.to} From=${from} Region=${region} ConfigSet=${SES_CONFIGURATION_SET}):`, error);
    throw error;
  }
}

/**
 * Send email via SendGrid
 */
async function sendViaSendGrid(options: EmailOptions): Promise<void> {
  try {
    // Dynamic import to avoid requiring SendGrid if not used
    const sgMail = (await import("@sendgrid/mail")) as { setApiKey: (k: string) => void; send: (o: Record<string, unknown>) => Promise<unknown> };
    sgMail.setApiKey(process.env.SENDGRID_API_KEY || "");

    await sgMail.send({
      to: options.to,
      from: process.env.EMAIL_FROM_ADDRESS || "noreply@coheus.com",
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    console.log(`✅ Email sent via SendGrid to ${options.to}`);
  } catch (error: any) {
    console.error("SendGrid email error:", error);
    throw error;
  }
}

/**
 * Send email via Resend
 */
async function sendViaResend(options: EmailOptions): Promise<void> {
  try {
    const resendModule = (await import("resend")) as any;
    const { Resend } = resendModule;
    const resend = new Resend(process.env.RESEND_API_KEY || "");

    await resend.emails.send({
      from: process.env.EMAIL_FROM_ADDRESS || "noreply@coheus.com",
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    console.log(`✅ Email sent via Resend to ${options.to}`);
  } catch (error: unknown) {
    console.error("Resend email error:", error);
    throw error;
  }
}

/**
 * Send provisioning started email
 */
export async function sendProvisioningStartedEmail(
  email: string,
  lenderName: string,
  deploymentType: string,
): Promise<void> {
  const isPerLender = deploymentType === "per_lender_aws";

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #334155; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; }
        .content { background: white; padding: 30px; border: 1px solid #e2e8f0; border-top: none; }
        .footer { background: #f8fafc; padding: 20px; text-align: center; color: #64748b; font-size: 12px; border-radius: 0 0 8px 8px; }
        .button { display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px; margin-top: 20px; }
        .timeline { margin: 20px 0; }
        .timeline-item { padding: 10px 0; border-left: 2px solid #e2e8f0; padding-left: 20px; margin-left: 10px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 style="margin: 0; font-weight: 300;">Welcome to Coheus, ${lenderName}!</h1>
        </div>
        <div class="content">
          <p>Thank you for subscribing to Coheus. Your payment has been processed successfully.</p>
          
          ${
            isPerLender
              ? `
            <h2 style="color: #1e40af; margin-top: 30px;">Infrastructure Provisioning</h2>
            <p>We're setting up your dedicated AWS infrastructure. This process typically takes <strong>15-25 minutes</strong> and includes:</p>
            <div class="timeline">
              <div class="timeline-item">
                <strong>AWS Account Creation</strong> (3-5 minutes)<br>
                Creating your dedicated AWS account via AWS Organizations
              </div>
              <div class="timeline-item">
                <strong>Infrastructure Deployment</strong> (10-15 minutes)<br>
                Deploying S3, CloudFront, Elastic Beanstalk, RDS, and KMS
              </div>
              <div class="timeline-item">
                <strong>Admin Setup</strong> (2 minutes)<br>
                Creating your admin user and credentials
              </div>
            </div>
            <p>You'll receive another email when your infrastructure is ready with your admin credentials.</p>
          `
              : `
            <h2 style="color: #1e40af; margin-top: 30px;">Ready to Use</h2>
            <p>Your subscription is active and you can start using the platform immediately.</p>
            <a href="${process.env.FRONTEND_URL || "https://d2wvs4i87rs881.cloudfront.net"}/admin" class="button">Access Admin Panel</a>
          `
          }
          
          <h2 style="color: #1e40af; margin-top: 30px;">What's Next?</h2>
          <ul>
            <li>Configure your Loan Origination System (LOS) connection</li>
            <li>Set up vendor integrations</li>
            <li>Invite your team members</li>
            <li>Start processing loans</li>
          </ul>
          
          <p style="margin-top: 30px;">If you have any questions, please don't hesitate to reach out to our support team.</p>
        </div>
        <div class="footer">
          <p>© 2026 Coheus. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Welcome to Coheus, ${lenderName}!

Thank you for subscribing to Coheus. Your payment has been processed successfully.

${
  isPerLender
    ? `
Infrastructure Provisioning:
We're setting up your dedicated AWS infrastructure. This process typically takes 15-25 minutes.

You'll receive another email when your infrastructure is ready with your admin credentials.
`
    : `
Your subscription is active and you can start using the platform immediately.
Access your admin panel: ${process.env.FRONTEND_URL || "https://d2wvs4i87rs881.cloudfront.net"}/admin
`
}

What's Next?
- Configure your Loan Origination System (LOS) connection
- Set up vendor integrations
- Invite your team members
- Start processing loans

If you have any questions, please contact our support team.

© 2026 Coheus. All rights reserved.
  `;

  await sendEmail({
    to: email,
    subject: `Welcome to Coheus${isPerLender ? " - Infrastructure Provisioning Started" : ""}`,
    html,
    text,
    emailType: "provisioning_started",
    containsPii: false,
  });
}

/**
 * Send admin credentials email
 */
export async function sendAdminCredentialsEmail(
  email: string,
  adminUrl: string,
  username: string,
  password: string,
  lenderName: string,
): Promise<void> {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #334155; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; }
        .content { background: white; padding: 30px; border: 1px solid #e2e8f0; border-top: none; }
        .footer { background: #f8fafc; padding: 20px; text-align: center; color: #64748b; font-size: 12px; border-radius: 0 0 8px 8px; }
        .button { display: inline-block; padding: 12px 24px; background: #10b981; color: white; text-decoration: none; border-radius: 6px; margin-top: 20px; }
        .credentials { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 20px; margin: 20px 0; }
        .credential-item { margin: 10px 0; }
        .credential-label { font-weight: 600; color: #475569; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
        .credential-value { font-family: 'Courier New', monospace; font-size: 14px; color: #1e293b; background: white; padding: 8px 12px; border-radius: 4px; border: 1px solid #cbd5e1; }
        .warning { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 style="margin: 0; font-weight: 300;">Your Coheus Admin is Ready!</h1>
        </div>
        <div class="content">
          <p>Hi ${lenderName},</p>
          <p>Great news! Your dedicated AWS infrastructure has been provisioned and your admin panel is ready to use.</p>
          
          <div class="credentials">
            <div class="credential-item">
              <div class="credential-label">Admin URL</div>
              <div class="credential-value">${adminUrl}</div>
            </div>
            <div class="credential-item">
              <div class="credential-label">Username</div>
              <div class="credential-value">${username}</div>
            </div>
            <div class="credential-item">
              <div class="credential-label">Temporary Password</div>
              <div class="credential-value">${password}</div>
            </div>
          </div>
          
          <div class="warning">
            <strong>⚠️ Security Notice:</strong> Please change your password immediately after your first login. This is a temporary password.
          </div>
          
          <a href="${adminUrl}" class="button">Access Admin Panel</a>
          
          <h2 style="color: #1e40af; margin-top: 30px;">Getting Started</h2>
          <ol>
            <li><strong>Log in</strong> using the credentials above</li>
            <li><strong>Change your password</strong> in the admin settings</li>
            <li><strong>Configure your LOS connection</strong> in the LOS Settings section</li>
            <li><strong>Set up vendor integrations</strong> in Synapse Connect</li>
            <li><strong>Invite your team</strong> in the Users section</li>
          </ol>
          
          <h2 style="color: #1e40af; margin-top: 30px;">Your Dedicated Infrastructure</h2>
          <p>You now have your own AWS account with:</p>
          <ul>
            <li>Dedicated database (RDS PostgreSQL)</li>
            <li>Isolated compute resources (Elastic Beanstalk)</li>
            <li>Global CDN (CloudFront)</li>
            <li>Encrypted storage (S3 with KMS)</li>
            <li>Direct AWS billing (you pay AWS directly)</li>
          </ul>
          
          <p style="margin-top: 30px;">If you have any questions or need assistance, our support team is here to help.</p>
        </div>
        <div class="footer">
          <p>© 2026 Coheus. All rights reserved.</p>
          <p style="margin-top: 10px; font-size: 11px;">This email contains sensitive credentials. Please keep it secure.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Your Coheus Admin is Ready!

Hi ${lenderName},

Great news! Your dedicated AWS infrastructure has been provisioned and your admin panel is ready to use.

Admin URL: ${adminUrl}
Username: ${username}
Temporary Password: ${password}

⚠️ SECURITY NOTICE: Please change your password immediately after your first login. This is a temporary password.

Getting Started:
1. Log in using the credentials above
2. Change your password in the admin settings
3. Configure your LOS connection in the LOS Settings section
4. Set up vendor integrations in Synapse Connect
5. Invite your team in the Users section

Your Dedicated Infrastructure:
- Dedicated database (RDS PostgreSQL)
- Isolated compute resources (Elastic Beanstalk)
- Global CDN (CloudFront)
- Encrypted storage (S3 with KMS)
- Direct AWS billing (you pay AWS directly)

If you have any questions or need assistance, our support team is here to help.

© 2026 Coheus. All rights reserved.

This email contains sensitive credentials. Please keep it secure.
  `;

  await sendEmail({
    to: email,
    subject: "Your Coheus Admin Credentials - Infrastructure Ready",
    html,
    text,
    emailType: "admin_credentials",
    containsPii: true,
  });
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
  email: string,
  resetUrl: string,
  userName?: string,
): Promise<void> {
  const displayName = userName || email.split("@")[0];

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #334155; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; }
        .content { background: white; padding: 30px; border: 1px solid #e2e8f0; border-top: none; }
        .footer { background: #f8fafc; padding: 20px; text-align: center; color: #64748b; font-size: 12px; border-radius: 0 0 8px 8px; }
        .button { display: inline-block; padding: 14px 28px; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; font-weight: 500; }
        .warning { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px; }
        .code-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 15px; font-family: monospace; word-break: break-all; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 style="margin: 0; font-weight: 300;">Reset Your Password</h1>
        </div>
        <div class="content">
          <p>Hi ${displayName},</p>
          <p>We received a request to reset your password for your Cohi account. Click the button below to create a new password:</p>
          
          <div style="text-align: center;">
            <a href="${resetUrl}" class="button">Reset Password</a>
          </div>
          
          <div class="warning">
            <strong>⏰ This link expires in 1 hour</strong><br>
            For security reasons, this password reset link will expire in 1 hour. If you need to reset your password after that, please request a new link.
          </div>
          
          <p>If the button doesn't work, copy and paste this link into your browser:</p>
          <div class="code-box">${resetUrl}</div>
          
          <p style="margin-top: 20px; color: #64748b; font-size: 14px;">
            If you didn't request this password reset, you can safely ignore this email. Your password will remain unchanged.
          </p>
        </div>
        <div class="footer">
          <p>© 2026 Cohi. All rights reserved.</p>
          <p style="margin-top: 10px; font-size: 11px;">This is an automated message. Please do not reply to this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Reset Your Password

Hi ${displayName},

We received a request to reset your password for your Cohi account.

Click this link to reset your password:
${resetUrl}

⏰ This link expires in 1 hour.

If you didn't request this password reset, you can safely ignore this email.

© 2026 Cohi. All rights reserved.
  `;

  await sendEmail({
    to: email,
    subject: "Reset Your Cohi Password",
    html,
    text,
    emailType: "password_reset",
    containsPii: false,
  });
}

/**
 * Send user invitation email
 */
export async function sendUserInvitationEmail(
  email: string,
  inviteUrl: string,
  tenantName: string,
  inviterName?: string,
): Promise<void> {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #334155; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; }
        .content { background: white; padding: 30px; border: 1px solid #e2e8f0; border-top: none; }
        .footer { background: #f8fafc; padding: 20px; text-align: center; color: #64748b; font-size: 12px; border-radius: 0 0 8px 8px; }
        .button { display: inline-block; padding: 14px 28px; background: #10b981; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; font-weight: 500; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 style="margin: 0; font-weight: 300;">You're Invited to Cohi!</h1>
        </div>
        <div class="content">
          <p>Hello!</p>
          <p>${inviterName ? `${inviterName} has invited you` : "You have been invited"} to join <strong>${tenantName}</strong> on Cohi.</p>
          
          <p>Cohi is a powerful loan analytics platform that helps you track performance, manage your pipeline, and gain insights into your lending operations.</p>
          
          <div style="text-align: center;">
            <a href="${inviteUrl}" class="button">Accept Invitation</a>
          </div>
          
          <p style="margin-top: 20px; color: #64748b; font-size: 14px;">
            This invitation link will expire in 7 days. If you have questions, please contact your administrator.
          </p>
        </div>
        <div class="footer">
          <p>© 2026 Cohi. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
You're Invited to Cohi!

${inviterName ? `${inviterName} has invited you` : "You have been invited"} to join ${tenantName} on Cohi.

Click this link to accept your invitation:
${inviteUrl}

This invitation expires in 7 days.

© 2026 Cohi. All rights reserved.
  `;

  await sendEmail({
    to: email,
    subject: `You're invited to join ${tenantName} on Cohi`,
    html,
    text,
    emailType: "user_invitation",
    containsPii: false,
  });
}

/**
 * Send provisioning error notification
 */
export async function sendProvisioningErrorEmail(
  email: string,
  lenderName: string,
  errorMessage: string,
): Promise<void> {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #334155; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; }
        .content { background: white; padding: 30px; border: 1px solid #e2e8f0; border-top: none; }
        .footer { background: #f8fafc; padding: 20px; text-align: center; color: #64748b; font-size: 12px; border-radius: 0 0 8px 8px; }
        .error-box { background: #fef2f2; border: 1px solid #fecaca; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0; border-radius: 4px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 style="margin: 0; font-weight: 300;">Provisioning Issue</h1>
        </div>
        <div class="content">
          <p>Hi ${lenderName},</p>
          <p>We encountered an issue while provisioning your AWS infrastructure. Don't worry - our team has been notified and is working on resolving this.</p>
          
          <div class="error-box">
            <strong>Error Details:</strong><br>
            ${errorMessage}
          </div>
          
          <p><strong>What happens next?</strong></p>
          <ul>
            <li>Our engineering team will investigate the issue</li>
            <li>We'll retry the provisioning automatically</li>
            <li>You'll receive an email once the issue is resolved</li>
            <li>If the issue persists, we'll contact you directly</li>
          </ul>
          
          <p>Your subscription is still active, and we're committed to getting your infrastructure set up as quickly as possible.</p>
          
          <p>If you have any questions or concerns, please contact our support team.</p>
        </div>
        <div class="footer">
          <p>© 2026 Coheus. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Provisioning Issue

Hi ${lenderName},

We encountered an issue while provisioning your AWS infrastructure. Don't worry - our team has been notified and is working on resolving this.

Error Details:
${errorMessage}

What happens next?
- Our engineering team will investigate the issue
- We'll retry the provisioning automatically
- You'll receive an email once the issue is resolved
- If the issue persists, we'll contact you directly

Your subscription is still active, and we're committed to getting your infrastructure set up as quickly as possible.

If you have any questions or concerns, please contact our support team.

© 2026 Coheus. All rights reserved.
  `;

  await sendEmail({
    to: email,
    subject: "Coheus Infrastructure Provisioning - Action Required",
    html,
    text,
    emailType: "provisioning_error",
    containsPii: false,
  });
}

/**
 * Send loan card email with inline image
 * Uses provider-specific methods for attachments with Content-ID
 */
export async function sendLoanCardEmail(
  to: string,
  subject: string,
  loanId: string,
  officerName: string,
  imageBase64: string,
): Promise<void> {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #334155; margin: 0; padding: 20px; }
        .container { max-width: 640px; margin: 0 auto; }
        .intro { margin-bottom: 20px; color: #64748b; font-size: 14px; }
        .card-img { max-width: 100%; height: auto; display: block; border-radius: 8px; }
        .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <p class="intro">Loan card for ${loanId}${officerName ? ` (${officerName})` : ""}:</p>
        <img src="cid:cardImage" alt="Loan card" class="card-img" />
        <div class="footer">
          <p>Sent from Coheus</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `Loan card for ${loanId}${officerName ? ` (${officerName})` : ""}. View the attached image for full details. — Sent from Coheus`;

  const emailProvider = process.env.EMAIL_PROVIDER || "ses";

  try {
    switch (emailProvider) {
      case "ses":
        await sendLoanCardViaSES(to, subject, html, text, imageBase64);
        break;
      case "sendgrid":
        await sendLoanCardViaSendGrid(to, subject, html, text, imageBase64);
        break;
      case "resend":
        await sendLoanCardViaResend(to, subject, html, text, imageBase64);
        break;
      default:
        console.warn(`Unknown email provider: ${emailProvider}. Loan card email not sent.`);
        return;
    }
    await logEmailSend({
      recipientEmail: to,
      emailType: "loan_card",
      containsPii: true,
      metadata: { loanId },
    });
  } catch (error: unknown) {
    console.error("Loan card email error:", error);
    throw error;
  }
}

async function sendLoanCardViaSES(
  to: string,
  subject: string,
  html: string,
  text: string,
  imageBase64: string,
): Promise<void> {
  const { SESClient, SendRawEmailCommand } = await import("@aws-sdk/client-ses");
  const sesClient = new SESClient({
    region: process.env.AWS_SES_REGION || "us-east-1",
  });

  const boundary1 = "boundary1_" + Math.random().toString(36).slice(2);
  const boundary2 = "boundary2_" + Math.random().toString(36).slice(2);
  const from = process.env.EMAIL_FROM_ADDRESS || "noreply@coheus.com";

  const rawMessage = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/related; boundary="${boundary1}"`,
    "",
    `--${boundary1}`,
    `Content-Type: multipart/alternative; boundary="${boundary2}"`,
    "",
    `--${boundary2}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    text,
    "",
    `--${boundary2}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    html,
    "",
    `--${boundary2}--`,
    `--${boundary1}`,
    'Content-Type: image/png; name="card.png"',
    'Content-Disposition: inline; filename="card.png"',
    "Content-ID: <cardImage>",
    "Content-Transfer-Encoding: base64",
    "",
    imageBase64,
    "",
    `--${boundary1}--`,
  ].join("\r\n");

  const command = new SendRawEmailCommand({
    RawMessage: {
      Data: Buffer.from(rawMessage, "utf-8"),
    },
  });

  await sesClient.send(command);
  console.log(`✅ Loan card email sent via SES to ${to}`);
}

async function sendLoanCardViaSendGrid(
  to: string,
  subject: string,
  html: string,
  text: string,
  imageBase64: string,
): Promise<void> {
  const sgMail = (await import("@sendgrid/mail")) as { setApiKey: (k: string) => void; send: (o: Record<string, unknown>) => Promise<unknown> };
  sgMail.setApiKey(process.env.SENDGRID_API_KEY || "");

  await sgMail.send({
    to,
    from: process.env.EMAIL_FROM_ADDRESS || "noreply@coheus.com",
    subject,
    html,
    text,
    attachments: [
      {
        content: imageBase64,
        filename: "card.png",
        type: "image/png",
        disposition: "inline",
        content_id: "cardImage",
      },
    ],
  });

  console.log(`✅ Loan card email sent via SendGrid to ${to}`);
}

async function sendLoanCardViaResend(
  to: string,
  subject: string,
  html: string,
  text: string,
  imageBase64: string,
): Promise<void> {
  const resendModule = await import("resend");
  const { Resend } = resendModule;
  const resend = new Resend(process.env.RESEND_API_KEY || "");

  await resend.emails.send({
    from: process.env.EMAIL_FROM_ADDRESS || "noreply@coheus.com",
    to,
    subject,
    html,
    text,
    attachments: [
      {
        content: imageBase64,
        filename: "card.png",
        content_id: "cardImage",
      },
    ],
  });

  console.log(`✅ Loan card email sent via Resend to ${to}`);
}
