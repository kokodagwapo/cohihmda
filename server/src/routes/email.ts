/**
 * Public email endpoints (e.g. one-click unsubscribe).
 * No authentication required for unsubscribe.
 */

import { Router, Request, Response } from "express";
import { pool as managementPool } from "../config/managementDatabase.js";

const router = Router();

/**
 * GET /api/email/unsubscribe/:token
 * One-click unsubscribe: disables daily brief for the user who owns this token.
 * Public endpoint (no auth) for CAN-SPAM compliance.
 */
router.get("/unsubscribe/:token", async (req: Request, res: Response) => {
  try {
    const typeRaw = req.query.type;
    const unsubscribeType = String(
      Array.isArray(typeRaw) ? typeRaw[0] || "" : typeRaw || "",
    )
      .trim()
      .toLowerCase();

    const raw = req.params.token;
    const token = (typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] ?? "" : "").trim();
    if (!token) {
      return res.status(400).json({ success: false, error: "Missing unsubscribe token" });
    }

    const result = await managementPool.query(
      `SELECT user_id, preference_value
       FROM user_preferences
       WHERE preference_key = 'emailPreferences'
         AND preference_value->>'unsubscribeToken' = $1
       LIMIT 1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Invalid or expired unsubscribe link",
        alreadyUnsubscribed: true,
      });
    }

    const row = result.rows[0] as { user_id: string; preference_value: Record<string, unknown> };
    const current = row.preference_value as Record<string, unknown>;
    const dailyBrief = (current.dailyBrief as Record<string, unknown>) || {};
    const releaseNotes = (current.releaseNotes as Record<string, unknown>) || {};
    const updateReleaseNotes = unsubscribeType === "release_notes";
    const updated = {
      ...current,
      dailyBrief: updateReleaseNotes
        ? dailyBrief
        : {
            ...dailyBrief,
            enabled: false,
          },
      releaseNotes: updateReleaseNotes
        ? {
            ...releaseNotes,
            enabled: false,
          }
        : releaseNotes,
    };

    await managementPool.query(
      `UPDATE user_preferences
       SET preference_value = $2::jsonb, updated_at = NOW()
       WHERE user_id = $1 AND preference_key = 'emailPreferences'`,
      [row.user_id, JSON.stringify(updated)]
    );

    return res.json({
      success: true,
      message: updateReleaseNotes
        ? "You have been unsubscribed from Cohi release notes emails."
        : "You have been unsubscribed from the Cohi Daily Brief.",
    });
  } catch (err) {
    console.error("[Email] Unsubscribe error:", err);
    return res.status(500).json({ success: false, error: "Failed to process unsubscribe" });
  }
});

export default router;
