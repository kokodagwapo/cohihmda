import { randomUUID } from "crypto";
import { pool as managementPool } from "../config/managementDatabase.js";
import { tenantDbManager } from "../config/tenantDatabaseManager.js";
import { sendDailyBriefNewsletterEmail } from "./emailService.js";
import {
  loadEmailTemplate,
  replacePlaceholders,
} from "./emailTemplateLoader.js";

export type ReleaseNoteCategory = "feature" | "improvement" | "fix";

export interface ReleaseNoteEmailEntry {
  id: string;
  title: string;
  description: string;
  category: ReleaseNoteCategory;
  link: string | null;
  linkLabel: string | null;
  sortOrder: number;
}

export interface ReleaseNoteEmailPayload {
  id: string;
  version: string;
  title: string;
  publishedAt: string | null;
  entries: ReleaseNoteEmailEntry[];
}

type ReleaseNotesRecipient = {
  userId: string;
  email: string;
  fullName: string | null;
  unsubscribeToken: string;
};

export interface ReleaseNotesEmailSendResult {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  failures: Array<{ email: string; error: string }>;
}

function getFrontendUrl(): string {
  const fallback = "https://cohi.coheus1.com";
  const raw = process.env.FRONTEND_URL || fallback;
  const candidates = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const publicUrl = candidates.find(
    (value) => !value.includes("localhost") && !value.includes("127.0.0.1"),
  );
  return publicUrl || fallback;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildEntriesHtml(entries: ReleaseNoteEmailEntry[]): string {
  const grouped: Record<ReleaseNoteCategory, ReleaseNoteEmailEntry[]> = {
    feature: [],
    improvement: [],
    fix: [],
  };
  for (const entry of entries) {
    grouped[entry.category].push(entry);
  }

  const sections: Array<{ key: ReleaseNoteCategory; title: string }> = [
    { key: "feature", title: "New" },
    { key: "improvement", title: "Improved" },
    { key: "fix", title: "Fixed" },
  ];

  return sections
    .filter((section) => grouped[section.key].length > 0)
    .map((section) => {
      const cards = grouped[section.key]
        .map((entry) => {
          const cta =
            entry.link && entry.link.trim()
              ? `<a class="entry-link" href="${entry.link}">${escapeHtml(
                  entry.linkLabel?.trim() || "Learn more",
                )}</a>`
              : "";
          return `
            <div class="entry-card">
              <div class="entry-title">${escapeHtml(entry.title)}</div>
              <div class="entry-description">${escapeHtml(entry.description)}</div>
              ${cta}
            </div>
          `;
        })
        .join("\n");

      return `
        <div class="entry-group">
          <div class="entry-group-title">${section.title}</div>
          ${cards}
        </div>
      `;
    })
    .join("\n");
}

async function buildEmailHtml(
  note: ReleaseNoteEmailPayload,
  unsubscribeUrl: string,
): Promise<string> {
  const template = await loadEmailTemplate("release-notes.html");
  const entriesHtml = buildEntriesHtml(note.entries);
  if (template) {
    return replacePlaceholders(template, {
      VERSION: escapeHtml(note.version),
      TITLE: escapeHtml(note.title),
      ENTRIES_HTML: entriesHtml,
      UNSUBSCRIBE_URL: unsubscribeUrl,
    });
  }

  console.warn(
    "[ReleaseNotesEmail] release-notes.html template missing; using fallback HTML.",
  );
  return `<!DOCTYPE html>
<html><body>
  <h1>Cohi Release Notes - ${escapeHtml(note.version)}</h1>
  <h2>${escapeHtml(note.title)}</h2>
  ${entriesHtml}
  <p><a href="${unsubscribeUrl}">Unsubscribe</a></p>
</body></html>`;
}

function buildEmailText(note: ReleaseNoteEmailPayload, unsubscribeUrl: string): string {
  const lines: string[] = [`Cohi Release Notes - ${note.version}`, note.title, ""];
  for (const entry of note.entries) {
    lines.push(`- [${entry.category}] ${entry.title}`);
    lines.push(`  ${entry.description}`);
    if (entry.link) {
      lines.push(`  ${entry.link}`);
    }
  }
  lines.push("");
  lines.push(`Unsubscribe: ${unsubscribeUrl}`);
  return lines.join("\n");
}

async function getEligibleRecipients(): Promise<ReleaseNotesRecipient[]> {
  const tenantResult = await managementPool.query(
    `SELECT id
     FROM coheus_tenants
     WHERE status = 'active'`,
  );

  const recipientsByEmail = new Map<
    string,
    { userId: string; email: string; fullName: string | null }
  >();

  for (const row of tenantResult.rows as Array<{ id: string }>) {
    try {
      const tenantPool = await tenantDbManager.getTenantPool(row.id);
      const usersResult = await tenantPool.query(
        `SELECT id, email, full_name
         FROM users
         WHERE is_active = true
           AND email IS NOT NULL
           AND COALESCE(access_mode, 'full') <> 'canvas_only'`,
      );
      for (const user of usersResult.rows as Array<{
        id: string;
        email: string;
        full_name: string | null;
      }>) {
        const normalizedEmail = user.email.trim().toLowerCase();
        if (!normalizedEmail || !normalizedEmail.includes("@")) continue;
        if (!recipientsByEmail.has(normalizedEmail)) {
          recipientsByEmail.set(normalizedEmail, {
            userId: user.id,
            email: user.email.trim(),
            fullName: user.full_name ?? null,
          });
        }
      }
    } catch (error) {
      console.warn("[ReleaseNotesEmail] Skipping tenant recipient lookup:", {
        tenantId: row.id,
        error: (error as Error).message,
      });
    }
  }

  const recipients: ReleaseNotesRecipient[] = [];
  for (const recipient of recipientsByEmail.values()) {
    const prefResult = await managementPool.query(
      `SELECT preference_value
       FROM user_preferences
       WHERE user_id = $1
         AND preference_key = 'emailPreferences'
       LIMIT 1`,
      [recipient.userId],
    );

    const existingPrefs =
      (prefResult.rows[0]?.preference_value as Record<string, unknown>) || {};
    const releaseNotesPrefs = (existingPrefs.releaseNotes ||
      {}) as Record<string, unknown>;
    const enabled = releaseNotesPrefs.enabled !== false;
    if (!enabled) {
      continue;
    }

    const tokenValue = existingPrefs.unsubscribeToken;
    const unsubscribeToken =
      typeof tokenValue === "string" && tokenValue.trim()
        ? tokenValue.trim()
        : randomUUID();

    if (unsubscribeToken !== tokenValue) {
      const updatedPrefs = {
        ...existingPrefs,
        releaseNotes: {
          enabled: true,
          ...releaseNotesPrefs,
        },
        unsubscribeToken,
      };
      await managementPool.query(
        `INSERT INTO user_preferences (user_id, preference_key, preference_value)
         VALUES ($1, 'emailPreferences', $2::jsonb)
         ON CONFLICT (user_id, preference_key)
         DO UPDATE SET preference_value = $2::jsonb, updated_at = NOW()`,
        [recipient.userId, JSON.stringify(updatedPrefs)],
      );
    }

    recipients.push({
      ...recipient,
      unsubscribeToken,
    });
  }

  return recipients;
}

export async function sendReleaseNotesEmail(
  note: ReleaseNoteEmailPayload,
): Promise<ReleaseNotesEmailSendResult> {
  const recipients = await getEligibleRecipients();
  if (recipients.length === 0) {
    return { attempted: 0, sent: 0, failed: 0, skipped: 0, failures: [] };
  }

  const baseUrl = getFrontendUrl();
  const subject = `Cohi Release Notes - ${note.version}`;
  const failures: Array<{ email: string; error: string }> = [];
  let sent = 0;

  for (const recipient of recipients) {
    const unsubscribeUrl = `${baseUrl}/unsubscribe/${recipient.unsubscribeToken}?type=release_notes&utm_source=release_notes&utm_medium=email`;
    const html = await buildEmailHtml(note, unsubscribeUrl);
    const text = buildEmailText(note, unsubscribeUrl);
    try {
      await sendDailyBriefNewsletterEmail({
        to: recipient.email,
        subject,
        html,
        text,
        unsubscribeUrl,
        emailType: "release_notes",
        containsPii: false,
        userId: recipient.userId,
        strict: true,
      });
      sent += 1;
    } catch (error) {
      failures.push({
        email: recipient.email,
        error: (error as Error).message || "Unknown error",
      });
    }
  }

  return {
    attempted: recipients.length,
    sent,
    failed: failures.length,
    skipped: 0,
    failures,
  };
}
