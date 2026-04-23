import { pool as managementPool } from "../config/managementDatabase.js";
import { sendEmail } from "./emailService.js";

type NotifyInput = {
  feedbackId: string;
  area: string;
  description: string;
  submitterEmail: string;
  submitterUserId: string;
  tenantId: string;
  tenantName: string;
};

type NotifyResult = {
  recipients: string[];
  sent: string[];
  failed: Array<{ email: string; error: string }>;
};

const RETRY_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFeedbackDetailUrl(feedbackId: string): string {
  const rawBase = process.env.FRONTEND_URL?.trim() || "";
  const base = rawBase.endsWith("/") ? rawBase.slice(0, -1) : rawBase;
  return base ? `${base}/feedback/${feedbackId}` : `/feedback/${feedbackId}`;
}

export async function resolveFeedbackNotificationRecipientEmails(): Promise<string[]> {
  try {
    const result = await managementPool.query(
      `SELECT email
       FROM feedback_notification_recipients
       WHERE email IS NOT NULL
         AND TRIM(email) <> ''`
    );

    return Array.from(
      new Set(
        result.rows
          .map((row: { email?: string }) => String(row.email || "").trim().toLowerCase())
          .filter(Boolean)
      )
    );
  } catch (error: any) {
    // If migrations have not been run yet, avoid breaking feedback submission.
    if (error?.code === "42P01") {
      return [];
    }
    throw error;
  }
}

async function sendToRecipient(email: string, input: NotifyInput): Promise<void> {
  const detailUrl = getFeedbackDetailUrl(input.feedbackId);
  const subject = `[Feedback] New ${input.area} submission from ${input.submitterEmail}`;
  const safeDescription = input.description.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `
    <p>A new feedback submission has been received.</p>
    <ul>
      <li><strong>Area:</strong> ${input.area}</li>
      <li><strong>Description:</strong> ${safeDescription}</li>
      <li><strong>Submitter Email:</strong> ${input.submitterEmail}</li>
      <li><strong>Tenant:</strong> ${input.tenantName} (${input.tenantId})</li>
    </ul>
    <p><a href="${detailUrl}">Open feedback detail</a></p>
  `;
  const text = [
    "A new feedback submission has been received.",
    `Area: ${input.area}`,
    `Description: ${input.description}`,
    `Submitter Email: ${input.submitterEmail}`,
    `Tenant: ${input.tenantName} (${input.tenantId})`,
    `Open feedback detail: ${detailUrl}`,
  ].join("\n");

  await sendEmail({
    to: email,
    subject,
    html,
    text,
    strict: true,
    emailType: "user_feedback_notification",
    containsPii: true,
    userId: input.submitterUserId,
    tenantId: input.tenantId,
  });
}

export async function notifySuperAdminsOfFeedback(input: NotifyInput): Promise<NotifyResult> {
  const recipients = await resolveFeedbackNotificationRecipientEmails();
  if (recipients.length === 0) {
    return { recipients: [], sent: [], failed: [] };
  }

  const sent: string[] = [];
  const failed: Array<{ email: string; error: string }> = [];

  const firstPass = await Promise.allSettled(
    recipients.map(async (email) => {
      await sendToRecipient(email, input);
      return email;
    })
  );

  firstPass.forEach((result, idx) => {
    const email = recipients[idx];
    if (result.status === "fulfilled") {
      sent.push(email);
      return;
    }
    failed.push({ email, error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
  });

  if (failed.length > 0) {
    await sleep(RETRY_DELAY_MS);
    const retryTargets = [...failed];
    failed.length = 0;
    const retryPass = await Promise.allSettled(
      retryTargets.map(async ({ email }) => {
        await sendToRecipient(email, input);
        return email;
      })
    );
    retryPass.forEach((result, idx) => {
      const email = retryTargets[idx].email;
      if (result.status === "fulfilled") {
        sent.push(email);
        return;
      }
      failed.push({ email, error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
    });
  }

  return { recipients, sent, failed };
}
