import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import {
  pool,
  retryQuery,
  handleDatabaseError,
} from "../config/database.js";
import { authenticateToken, AuthRequest } from "../middleware/auth.js";

const router = Router();

const buildShareUrl = (token: string, origin?: string) => {
  const base =
    process.env.FRONTEND_URL ||
    origin ||
    "https://d2wvs4i87rs881.cloudfront.net";
  return `${base.replace(/\/$/, "")}/share/${token}`;
};

router.post("/", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const {
      targetType,
      targetId,
      tenantId,
      label,
      pin,
      targetUrl,
      expiresAt,
    } = req.body || {};

    if (!targetType || !targetUrl) {
      return res.status(400).json({ error: "Missing targetType or targetUrl" });
    }
    if (!pin || !/^\d{6,}$/.test(String(pin))) {
      return res
        .status(400)
        .json({ error: "PIN must be at least 6 digits" });
    }

    const token = crypto.randomBytes(16).toString("hex");
    const pinHash = await bcrypt.hash(String(pin), 10);

    await retryQuery(
      () =>
        pool.query(
          `INSERT INTO share_links (
            token, target_type, target_id, tenant_id, target_url, label, pin_hash, expires_at, created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            token,
            targetType,
            targetId || null,
            tenantId || null,
            targetUrl,
            label || null,
            pinHash,
            expiresAt ? new Date(expiresAt) : null,
            userId,
          ]
        ),
      3,
      500
    );

    res.json({ url: buildShareUrl(token, req.headers.origin), token });
  } catch (error: any) {
    if (handleDatabaseError(error, res, "Failed to create share link")) {
      return;
    }
    res.status(500).json({ error: error.message || "Failed to create share link" });
  }
});

router.post("/validate", async (req, res) => {
  try {
    const { token, pin } = req.body || {};
    if (!token || !pin) {
      return res.status(400).json({ error: "Missing token or pin" });
    }

    const result = await retryQuery(
      () =>
        pool.query(
          `SELECT token, target_url, label, target_type, target_id, tenant_id, pin_hash, expires_at
           FROM share_links
           WHERE token = $1`,
          [token]
        ),
      3,
      500
    );

    const share = result.rows[0];
    if (!share) return res.status(404).json({ error: "Share link not found" });
    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return res.status(410).json({ error: "Share link expired" });
    }

    const valid = await bcrypt.compare(String(pin), share.pin_hash);
    if (!valid) return res.status(401).json({ error: "Invalid PIN" });

    res.json({
      targetUrl: share.target_url,
      label: share.label,
      targetType: share.target_type,
      targetId: share.target_id,
      tenantId: share.tenant_id,
    });
  } catch (error: any) {
    if (handleDatabaseError(error, res, "Failed to validate share link")) {
      return;
    }
    res.status(500).json({ error: error.message || "Failed to validate share link" });
  }
});

export default router;
