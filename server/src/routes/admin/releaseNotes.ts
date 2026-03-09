// Marko Petrovic - 03/05/2026

import { Router, Response } from "express";
import { promisify } from "util";
import { exec as execCb } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { authenticateToken, AuthRequest } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import {
  sendReleaseNotesEmail,
  type ReleaseNoteEmailPayload,
  type ReleaseNoteCategory,
} from "../../services/releaseNotesEmailService.js";
import { pool as managementPool } from "../../config/managementDatabase.js";
import {
  callOpenAI,
  getOpenAIKey,
  type OpenAIChatMessage,
} from "../../services/ai/cohiChatService.js";

const exec = promisify(execCb);
const router = Router();
const requirePlatformAdmin = requireRole("super_admin", "platform_admin");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../..");

type NoteRow = {
  id: string;
  version: string;
  title: string;
  is_draft: boolean;
  published_at: string | null;
  email_sent_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type EntryRow = {
  id: string;
  release_note_id: string;
  title: string;
  description: string;
  category: ReleaseNoteCategory;
  link: string | null;
  link_label: string | null;
  sort_order: number;
};

type UpsertEntryInput = {
  title: string;
  description: string;
  category: ReleaseNoteCategory;
  link?: string | null;
  linkLabel?: string | null;
  sortOrder?: number;
};

type ReleaseNoteImportItem = {
  version?: unknown;
  title?: unknown;
  isDraft?: unknown;
  is_draft?: unknown;
  publishedAt?: unknown;
  published_at?: unknown;
  emailSentAt?: unknown;
  email_sent_at?: unknown;
  entries?: unknown;
};

type ReleaseNotesImportOptions = {
  overwriteAll: boolean;
  replaceMatching: boolean;
};

function isNonNull<T>(value: T | null): value is T {
  return value !== null;
}

function normalizeEntries(raw: unknown): UpsertEntryInput[] {
  if (!Array.isArray(raw)) return [];
  const validCategories = new Set(["feature", "improvement", "fix"]);
  return raw
    .map((entry, idx) => {
      const item = (entry || {}) as Record<string, unknown>;
      const categoryRaw = String(item.category || "").toLowerCase();
      const category = validCategories.has(categoryRaw)
        ? (categoryRaw as ReleaseNoteCategory)
        : "improvement";
      const title = String(item.title || "").trim();
      const description = String(item.description || "").trim();
      if (!title || !description) return null;
      return {
        title,
        description,
        category,
        link: item.link ? String(item.link).trim() : null,
        linkLabel: item.linkLabel ? String(item.linkLabel).trim() : null,
        sortOrder:
          typeof item.sortOrder === "number" ? item.sortOrder : Number(idx),
      };
    })
    .filter(isNonNull);
}

function normalizeImportOptions(raw: unknown): ReleaseNotesImportOptions {
  const options = (raw || {}) as Record<string, unknown>;
  return {
    overwriteAll: options.overwriteAll === true,
    replaceMatching: options.replaceMatching !== false,
  };
}

function normalizeImportItems(raw: unknown): Array<{
  version: string;
  title: string;
  isDraft: boolean;
  publishedAt: string | null;
  emailSentAt: string | null;
  entries: UpsertEntryInput[];
}> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const note = (item || {}) as ReleaseNoteImportItem;
      const version = String(note.version || "").trim();
      const title = String(note.title || "").trim();
      if (!version || !title) return null;

      const entries = normalizeEntries(note.entries);
      if (entries.length === 0) return null;

      const isDraftRaw =
        typeof note.isDraft === "boolean"
          ? note.isDraft
          : typeof note.is_draft === "boolean"
            ? note.is_draft
            : true;
      const publishedAtRaw =
        (note.publishedAt as string | null | undefined) ??
        (note.published_at as string | null | undefined) ??
        null;
      const emailSentAtRaw =
        (note.emailSentAt as string | null | undefined) ??
        (note.email_sent_at as string | null | undefined) ??
        null;

      const publishedAt = publishedAtRaw ? String(publishedAtRaw) : null;
      const emailSentAt = emailSentAtRaw ? String(emailSentAtRaw) : null;

      return {
        version,
        title,
        isDraft: isDraftRaw,
        publishedAt,
        emailSentAt,
        entries,
      };
    })
    .filter(isNonNull);
}

async function getEntriesByNoteId(noteId: string): Promise<EntryRow[]> {
  const result = await managementPool.query(
    `SELECT id, release_note_id, title, description, category, link, link_label, sort_order
     FROM release_note_entries
     WHERE release_note_id = $1
     ORDER BY sort_order ASC, created_at ASC`,
    [noteId],
  );
  return result.rows as EntryRow[];
}

function toReleaseNoteEmailPayload(
  note: NoteRow,
  entries: EntryRow[],
): ReleaseNoteEmailPayload {
  return {
    id: note.id,
    version: note.version,
    title: note.title,
    publishedAt: note.published_at,
    entries: entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      description: entry.description,
      category: entry.category,
      link: entry.link,
      linkLabel: entry.link_label,
      sortOrder: entry.sort_order,
    })),
  };
}

router.get(
  "/export",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const notesResult = await managementPool.query(
        `SELECT id, version, title, is_draft, published_at, email_sent_at, created_by, created_at, updated_at
         FROM release_notes
         ORDER BY COALESCE(published_at, created_at) DESC`,
      );

      const notes = [];
      for (const row of notesResult.rows as NoteRow[]) {
        const entries = await getEntriesByNoteId(row.id);
        notes.push({
          version: row.version,
          title: row.title,
          isDraft: row.is_draft,
          publishedAt: row.published_at,
          emailSentAt: row.email_sent_at,
          entries: entries.map((entry) => ({
            title: entry.title,
            description: entry.description,
            category: entry.category,
            link: entry.link,
            linkLabel: entry.link_label,
            sortOrder: entry.sort_order,
          })),
        });
      }

      return res.json({
        version: "1.0",
        exportedAt: new Date().toISOString(),
        exportedBy: req.userEmail || req.userId || "unknown",
        notes,
      });
    } catch (error: any) {
      console.error("[ReleaseNotesAdmin] export error:", error);
      return res.status(500).json({ error: "Failed to export release notes" });
    }
  },
);

router.post(
  "/import",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    const client = await managementPool.connect();
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const importData = (body.importData || body) as Record<string, unknown>;
      const options = normalizeImportOptions(body.options);
      const notes = normalizeImportItems(importData.notes);

      if (notes.length === 0) {
        return res.status(400).json({
          error:
            "No valid release notes found in import payload. Each note must include version, title, and at least one entry.",
        });
      }

      let imported = 0;
      let updated = 0;
      let skipped = 0;

      await client.query("BEGIN");

      if (options.overwriteAll) {
        await client.query("DELETE FROM release_notes");
      }

      for (const note of notes) {
        const existing = await client.query(
          `SELECT id
           FROM release_notes
           WHERE version = $1 AND title = $2
           LIMIT 1`,
          [note.version, note.title],
        );

        let releaseNoteId: string | null = null;
        if (existing.rows.length > 0) {
          if (!options.replaceMatching) {
            skipped += 1;
            continue;
          }

          releaseNoteId = String(existing.rows[0].id);
          await client.query(
            `UPDATE release_notes
             SET is_draft = $2,
                 published_at = $3,
                 email_sent_at = $4,
                 updated_at = NOW()
             WHERE id = $1`,
            [releaseNoteId, note.isDraft, note.publishedAt, note.emailSentAt],
          );
          await client.query(
            `DELETE FROM release_note_entries
             WHERE release_note_id = $1`,
            [releaseNoteId],
          );
          updated += 1;
        } else {
          const created = await client.query(
            `INSERT INTO release_notes (version, title, is_draft, published_at, email_sent_at, created_by, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
             RETURNING id`,
            [
              note.version,
              note.title,
              note.isDraft,
              note.publishedAt,
              note.emailSentAt,
              req.userId || null,
            ],
          );
          releaseNoteId = String(created.rows[0].id);
          imported += 1;
        }

        for (const [idx, entry] of note.entries.entries()) {
          await client.query(
            `INSERT INTO release_note_entries (release_note_id, title, description, category, link, link_label, sort_order, created_at, updated_at)
             VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''), $7, NOW(), NOW())`,
            [
              releaseNoteId,
              entry.title,
              entry.description,
              entry.category,
              entry.link || null,
              entry.linkLabel || null,
              entry.sortOrder ?? idx,
            ],
          );
        }
      }

      await client.query("COMMIT");
      return res.json({
        success: true,
        result: {
          imported,
          updated,
          skipped,
          totalProcessed: notes.length,
        },
      });
    } catch (error: any) {
      await client.query("ROLLBACK");
      console.error("[ReleaseNotesAdmin] import error:", error);
      return res.status(500).json({ error: "Failed to import release notes" });
    } finally {
      client.release();
    }
  },
);

router.get(
  "/",
  authenticateToken,
  requirePlatformAdmin,
  async (_req: AuthRequest, res: Response) => {
    try {
      const result = await managementPool.query(
        `SELECT rn.id, rn.version, rn.title, rn.is_draft, rn.published_at, rn.email_sent_at, rn.created_by, rn.created_at, rn.updated_at,
                COUNT(rne.id)::int AS entry_count
         FROM release_notes rn
         LEFT JOIN release_note_entries rne ON rne.release_note_id = rn.id
         GROUP BY rn.id
         ORDER BY COALESCE(rn.published_at, rn.created_at) DESC`,
      );
      res.json({ notes: result.rows });
    } catch (error: any) {
      console.error("[ReleaseNotesAdmin] list error:", error);
      res.status(500).json({ error: "Failed to list release notes" });
    }
  },
);

router.get(
  "/:id",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id;
      const noteResult = await managementPool.query(
        `SELECT id, version, title, is_draft, published_at, email_sent_at, created_by, created_at, updated_at
         FROM release_notes
         WHERE id = $1
         LIMIT 1`,
        [id],
      );
      if (noteResult.rows.length === 0) {
        return res.status(404).json({ error: "Release note not found" });
      }
      const note = noteResult.rows[0] as NoteRow;
      const entries = await getEntriesByNoteId(note.id);
      res.json({ note, entries });
    } catch (error: any) {
      console.error("[ReleaseNotesAdmin] get error:", error);
      res.status(500).json({ error: "Failed to load release note" });
    }
  },
);

router.post(
  "/",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    const client = await managementPool.connect();
    try {
      const version = String(req.body?.version || "").trim();
      const title = String(req.body?.title || "").trim();
      const entries = normalizeEntries(req.body?.entries);
      if (!version || !title) {
        return res
          .status(400)
          .json({ error: "Version and title are required" });
      }

      await client.query("BEGIN");
      const noteInsert = await client.query(
        `INSERT INTO release_notes (version, title, is_draft, created_by, created_at, updated_at)
         VALUES ($1, $2, true, $3, NOW(), NOW())
         RETURNING id, version, title, is_draft, published_at, email_sent_at, created_by, created_at, updated_at`,
        [version, title, req.userId || null],
      );
      const note = noteInsert.rows[0] as NoteRow;

      for (const [idx, entry] of entries.entries()) {
        await client.query(
          `INSERT INTO release_note_entries (release_note_id, title, description, category, link, link_label, sort_order, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''), $7, NOW(), NOW())`,
          [
            note.id,
            entry.title,
            entry.description,
            entry.category,
            entry.link || null,
            entry.linkLabel || null,
            entry.sortOrder ?? idx,
          ],
        );
      }

      await client.query("COMMIT");
      const savedEntries = await getEntriesByNoteId(note.id);
      res.status(201).json({ note, entries: savedEntries });
    } catch (error: any) {
      await client.query("ROLLBACK");
      console.error("[ReleaseNotesAdmin] create error:", error);
      res.status(500).json({ error: "Failed to create release note" });
    } finally {
      client.release();
    }
  },
);

router.put(
  "/:id",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    const client = await managementPool.connect();
    try {
      const id = req.params.id;
      const version = String(req.body?.version || "").trim();
      const title = String(req.body?.title || "").trim();
      const entries = normalizeEntries(req.body?.entries);
      if (!version || !title) {
        return res
          .status(400)
          .json({ error: "Version and title are required" });
      }

      const checkResult = await client.query(
        `SELECT id, is_draft
         FROM release_notes
         WHERE id = $1
         LIMIT 1`,
        [id],
      );
      if (checkResult.rows.length === 0) {
        return res.status(404).json({ error: "Release note not found" });
      }
      if (!checkResult.rows[0].is_draft) {
        return res
          .status(400)
          .json({ error: "Only draft release notes can be updated" });
      }

      await client.query("BEGIN");
      const updateResult = await client.query(
        `UPDATE release_notes
         SET version = $2, title = $3, updated_at = NOW()
         WHERE id = $1
         RETURNING id, version, title, is_draft, published_at, email_sent_at, created_by, created_at, updated_at`,
        [id, version, title],
      );
      const note = updateResult.rows[0] as NoteRow;

      await client.query(
        `DELETE FROM release_note_entries
         WHERE release_note_id = $1`,
        [id],
      );

      for (const [idx, entry] of entries.entries()) {
        await client.query(
          `INSERT INTO release_note_entries (release_note_id, title, description, category, link, link_label, sort_order, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''), $7, NOW(), NOW())`,
          [
            id,
            entry.title,
            entry.description,
            entry.category,
            entry.link || null,
            entry.linkLabel || null,
            entry.sortOrder ?? idx,
          ],
        );
      }

      await client.query("COMMIT");
      const savedEntries = await getEntriesByNoteId(note.id);
      res.json({ note, entries: savedEntries });
    } catch (error: any) {
      await client.query("ROLLBACK");
      console.error("[ReleaseNotesAdmin] update error:", error);
      res.status(500).json({ error: "Failed to update release note" });
    } finally {
      client.release();
    }
  },
);

router.delete(
  "/:id",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id;
      const result = await managementPool.query(
        `DELETE FROM release_notes
         WHERE id = $1
           AND is_draft = true
         RETURNING id`,
        [id],
      );
      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ error: "Draft release note not found or already published" });
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error("[ReleaseNotesAdmin] delete error:", error);
      res.status(500).json({ error: "Failed to delete release note" });
    }
  },
);

router.post(
  "/:id/publish",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id;
      const result = await managementPool.query(
        `UPDATE release_notes
         SET is_draft = false,
             published_at = COALESCE(published_at, NOW()),
             updated_at = NOW()
         WHERE id = $1
           AND is_draft = true
         RETURNING id, version, title, is_draft, published_at, email_sent_at, created_by, created_at, updated_at`,
        [id],
      );
      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ error: "Draft release note not found or already published" });
      }
      res.json({ note: result.rows[0] });
    } catch (error: any) {
      console.error("[ReleaseNotesAdmin] publish error:", error);
      res.status(500).json({ error: "Failed to publish release note" });
    }
  },
);

router.post(
  "/:id/send-email",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id;
      const forceResend = Boolean(req.body?.forceResend);
      const noteResult = await managementPool.query(
        `SELECT id, version, title, is_draft, published_at, email_sent_at, created_by, created_at, updated_at
         FROM release_notes
         WHERE id = $1
         LIMIT 1`,
        [id],
      );
      if (noteResult.rows.length === 0) {
        return res.status(404).json({ error: "Release note not found" });
      }
      const note = noteResult.rows[0] as NoteRow;
      if (note.is_draft) {
        return res
          .status(400)
          .json({
            error: "Release note must be published before sending email",
          });
      }
      if (note.email_sent_at && !forceResend) {
        return res
          .status(400)
          .json({
            error:
              "Release note email has already been sent. Set forceResend=true to send again.",
          });
      }

      const entries = await getEntriesByNoteId(note.id);
      if (entries.length === 0) {
        return res
          .status(400)
          .json({ error: "Release note must include at least one entry" });
      }

      const payload = toReleaseNoteEmailPayload(note, entries);
      const sendResult = await sendReleaseNotesEmail(payload);

      if (sendResult.attempted === 0) {
        return res.status(400).json({
          error:
            "No eligible recipients found. Check active users and release notes email preferences.",
          result: sendResult,
        });
      }

      if (sendResult.sent === 0) {
        return res.status(502).json({
          error: "Release note email send failed for all recipients.",
          result: sendResult,
        });
      }

      if (sendResult.failed > 0) {
        return res.status(502).json({
          error:
            "Release note email was only partially delivered. Resolve failures and resend.",
          result: sendResult,
        });
      }

      await managementPool.query(
        `UPDATE release_notes
         SET email_sent_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [note.id],
      );

      res.json({ success: true, result: sendResult });
    } catch (error: any) {
      console.error("[ReleaseNotesAdmin] send-email error:", error);
      res.status(500).json({ error: "Failed to send release note email" });
    }
  },
);

function buildFallbackDraftFromCommits(commits: string[]): Array<{
  title: string;
  description: string;
  category: ReleaseNoteCategory;
}> {
  return commits.slice(0, 8).map((line) => {
    const subject = line.replace(/^[a-f0-9]{7,}\s+/i, "").trim();
    const normalized = line.toLowerCase();
    const category: ReleaseNoteCategory = normalized.includes("fix")
      ? "fix"
      : normalized.includes("feat") || normalized.includes("add")
        ? "feature"
        : "improvement";
    const title = subject.slice(0, 90);
    return {
      title,
      description: `From commit: ${subject.slice(0, 180)}`,
      category,
    };
  });
}

type CommitInfo = { sha: string; subject: string };

function parseCommitInfo(commitLines: string[]): CommitInfo[] {
  return commitLines
    .map((line) => {
      const match = line.match(/^([a-f0-9]{7,})\s+(.+)$/i);
      if (!match) return null;
      const sha = match[1].toLowerCase();
      const subject = match[2].trim();
      if (!sha || !subject) return null;
      return { sha, subject };
    })
    .filter((value): value is CommitInfo => value !== null);
}

function normalizeAiGroundedEntries(
  raw: unknown,
  commitMap: Map<string, CommitInfo>,
): UpsertEntryInput[] {
  if (!Array.isArray(raw)) return [];
  const validCategories = new Set(["feature", "improvement", "fix"]);

  const normalized = raw
    .map((entry, idx) => {
      const item = (entry || {}) as Record<string, unknown>;
      const sourceCommit = String(item.sourceCommit || "").trim().toLowerCase();
      const evidence = String(item.evidence || "").trim().toLowerCase();
      const commit = commitMap.get(sourceCommit);
      if (!commit) return null;
      if (!evidence || !commit.subject.toLowerCase().includes(evidence)) return null;

      const title = String(item.title || "").trim();
      const description = String(item.description || "").trim();
      if (!title || !description) return null;

      const categoryRaw = String(item.category || "").toLowerCase();
      const category = validCategories.has(categoryRaw)
        ? (categoryRaw as ReleaseNoteCategory)
        : "improvement";

      return {
        title,
        description,
        category,
        link: null,
        linkLabel: null,
        sortOrder: typeof item.sortOrder === "number" ? item.sortOrder : Number(idx),
      };
    })
    .filter(isNonNull);

  return normalizeEntries(normalized);
}

function parseCommitLinesFromEnvSince(
  sinceIso: string,
  encoded?: string,
): string[] {
  const raw = String(encoded || "").trim();
  if (!raw) return [];

  let decoded = "";
  try {
    decoded = Buffer.from(raw, "base64").toString("utf8");
  } catch {
    return [];
  }

  if (!decoded.trim()) return [];

  const sinceMs = Date.parse(sinceIso);
  return decoded
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([^|]+)\|([a-f0-9]+)\|(.*)$/i);
      if (!match) return null;
      const commitDate = match[1]?.trim();
      const sha = match[2]?.trim();
      const subject = match[3]?.trim();
      if (!commitDate || !sha || !subject) return null;
      const commitMs = Date.parse(commitDate);
      if (
        Number.isFinite(sinceMs) &&
        Number.isFinite(commitMs) &&
        commitMs < sinceMs
      ) {
        return null;
      }
      return `${sha} ${subject}`;
    })
    .filter((line): line is string => Boolean(line));
}

router.post(
  "/generate-draft",
  authenticateToken,
  requirePlatformAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const sinceInput = String(req.body?.since || "").trim();
      const commitsInput = String(req.body?.commits || "").trim();
      let since = sinceInput;

      if (!since) {
        const lastPublished = await managementPool.query(
          `SELECT published_at
           FROM release_notes
           WHERE is_draft = false
             AND published_at IS NOT NULL
           ORDER BY published_at DESC
           LIMIT 1`,
        );
        since =
          lastPublished.rows[0]?.published_at ||
          new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      }

      let commitLines: string[] = [];
      let gitUnavailableReason: string | null = null;
      if (commitsInput) {
        commitLines = commitsInput
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
      } else {
        commitLines = parseCommitLinesFromEnvSince(
          since,
          process.env.RELEASE_NOTES_COMMITS_B64,
        );

        try {
          if (commitLines.length === 0) {
            const command = `git log --oneline --no-merges --since="${since}"`;
            const { stdout } = await exec(command, { cwd: repoRoot });
            commitLines = stdout
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean);
          }
        } catch (error: any) {
          gitUnavailableReason = error?.message || "git log unavailable";
          console.warn(
            "[ReleaseNotesAdmin] git log unavailable in this environment; waiting for manual commits input",
            gitUnavailableReason,
          );
        }
      }

      if (commitLines.length === 0) {
        return res.json({
          entries: [],
          since,
          commitsCount: 0,
          warning: gitUnavailableReason
            ? "Unable to read git history in this environment. Provide commit messages manually or ensure CI commit payload is configured."
            : null,
        });
      }

      const fallbackEntries = buildFallbackDraftFromCommits(commitLines);
      const commitInfo = parseCommitInfo(commitLines);
      const commitMap = new Map(commitInfo.map((item) => [item.sha, item]));

      try {
        const apiKey = await getOpenAIKey();
        const prompt = `You are drafting user-facing release notes for a SaaS product.

Return ONLY strict JSON in this shape:
{
  "entries": [
    {
      "title": "string",
      "description": "string",
      "category": "feature|improvement|fix",
      "sourceCommit": "commit sha from list below",
      "evidence": "exact short phrase copied from the commit subject"
    }
  ]
}

Rules:
- Use concise, customer-safe language.
- Exclude internal/devops/infrastructure-only items.
- Do NOT invent features, behavior, or outcomes that are not explicitly present in commits.
- Every entry MUST map to one commit from the list via sourceCommit.
- evidence MUST be an exact phrase copied from that commit subject.
- If uncertain, omit the entry.
- Keep each title under 90 chars.
- Keep each description under 220 chars.
- Max 12 entries.

Commits:
${commitLines.join("\n")}`;

        const messages: OpenAIChatMessage[] = [
          { role: "user", content: prompt },
        ];
        const aiRaw = await callOpenAI(messages, apiKey, {
          temperature: 0,
          jsonMode: true,
          maxTokens: 1800,
        });
        const parsed = JSON.parse(aiRaw) as {
          entries?: Array<{
            title?: string;
            description?: string;
            category?: string;
            sourceCommit?: string;
            evidence?: string;
          }>;
        };
        const aiEntries = normalizeAiGroundedEntries(parsed.entries, commitMap);
        if (aiEntries.length > 0) {
          return res.json({
            entries: aiEntries,
            since,
            commitsCount: commitLines.length,
            aiGrounded: true,
          });
        }
      } catch (error: any) {
        console.warn(
          "[ReleaseNotesAdmin] AI draft fallback used:",
          error.message,
        );
      }

      return res.json({
        entries: fallbackEntries,
        since,
        commitsCount: commitLines.length,
        aiGrounded: false,
        warning:
          "AI draft did not meet grounding checks. Returned commit-based fallback instead.",
      });
    } catch (error: any) {
      console.error("[ReleaseNotesAdmin] generate-draft error:", error);
      res.status(500).json({ error: "Failed to generate release note draft" });
    }
  },
);

export default router;
