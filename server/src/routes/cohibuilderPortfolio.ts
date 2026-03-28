/**
 * Persist Toll / builder backlog import rows for Capture Analysis (Cohi Builder).
 * Uses the main app Postgres pool; creates table lazily if missing.
 */
import { Router } from "express";
import { pool } from "../config/database.js";
import { authenticateToken, AuthRequest } from "../middleware/auth.js";

const router = Router();

const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS cohibuilder_portfolio_import (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  import_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

async function ensureTable(): Promise<void> {
  if (process.env.SKIP_DB === "true") return;
  await pool.query(TABLE_SQL);
}

router.get("/", async (_req, res) => {
  try {
    if (process.env.SKIP_DB === "true") {
      return res.json({ importRows: [], persisted: false });
    }
    await ensureTable();
    const r = await pool.query(
      `SELECT import_rows, updated_at FROM cohibuilder_portfolio_import WHERE id = 1`,
    );
    const row = r.rows[0];
    const importRows = Array.isArray(row?.import_rows) ? row.import_rows : [];
    return res.json({
      importRows,
      updatedAt: row?.updated_at ?? null,
      persisted: true,
    });
  } catch (e: any) {
    console.warn("[cohibuilder/portfolio] GET failed:", e?.message || e);
    return res.json({ importRows: [], persisted: false, error: "db_unavailable" });
  }
});

router.put("/", authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (process.env.SKIP_DB === "true") {
      return res.status(503).json({
        error: "Database disabled",
        message: "Set SKIP_DB=false and configure Postgres to persist imports.",
      });
    }
    const body = req.body as { importRows?: unknown };
    if (!Array.isArray(body.importRows)) {
      return res.status(400).json({ error: "importRows array required" });
    }
    await ensureTable();
    await pool.query(
      `INSERT INTO cohibuilder_portfolio_import (id, import_rows, updated_at)
       VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET import_rows = EXCLUDED.import_rows, updated_at = NOW()`,
      [JSON.stringify(body.importRows)],
    );
    return res.json({ ok: true, count: body.importRows.length });
  } catch (e: any) {
    console.error("[cohibuilder/portfolio] PUT failed:", e);
    return res.status(500).json({ error: e?.message || "save_failed" });
  }
});

export default router;
