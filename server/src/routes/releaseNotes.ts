import { Router, Response } from "express";
import { authenticateToken, AuthRequest } from "../middleware/auth.js";
import { pool as managementPool } from "../config/managementDatabase.js";

const router = Router();

router.get(
  "/published",
  authenticateToken,
  async (_req: AuthRequest, res: Response) => {
    try {
      const notesResult = await managementPool.query(
        `SELECT id, version, title, published_at
         FROM release_notes
         WHERE is_draft = false
           AND published_at IS NOT NULL
         ORDER BY published_at DESC
         LIMIT 20`,
      );

      const notes = [];
      for (const note of notesResult.rows as Array<{
        id: string;
        version: string;
        title: string;
        published_at: string;
      }>) {
        const entriesResult = await managementPool.query(
          `SELECT id, title, description, category, link, link_label, sort_order
           FROM release_note_entries
           WHERE release_note_id = $1
           ORDER BY sort_order ASC, created_at ASC`,
          [note.id],
        );
        notes.push({
          id: note.id,
          version: note.version,
          title: note.title,
          publishedAt: note.published_at,
          entries: (entriesResult.rows as Array<{
            id: string;
            title: string;
            description: string;
            category: "feature" | "improvement" | "fix";
            link: string | null;
            link_label: string | null;
            sort_order: number;
          }>).map((entry) => ({
            id: entry.id,
            title: entry.title,
            description: entry.description,
            category: entry.category,
            link: entry.link,
            linkLabel: entry.link_label,
            sortOrder: entry.sort_order,
          })),
        });
      }

      return res.json({ notes });
    } catch (error: any) {
      console.error("[ReleaseNotes] failed to load published notes:", error);
      return res.status(500).json({ error: "Failed to load release notes" });
    }
  },
);

export default router;
