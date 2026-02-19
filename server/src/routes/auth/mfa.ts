/**
 * MFA Routes
 * Setup, verify, disable, and status endpoints for TOTP MFA via Cognito.
 */

import { Router } from "express";
import { z } from "zod";
import { authenticateToken } from "../../middleware/auth.js";
import type { AuthRequest } from "../../middleware/auth.js";
import * as cognitoAuth from "../../services/cognito/cognitoAuthService.js";
import { logError, logInfo } from "../../services/logger.js";
import { auditLog } from "../../services/auditLogger.js";

const router = Router();

/**
 * POST /api/auth/mfa/setup
 * Begin MFA setup -- returns the TOTP secret and a QR code URI.
 * Requires a valid Cognito access token in the request body.
 */
router.post("/setup", authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (!cognitoAuth.isCognitoAuthEnabled()) {
      return res.status(400).json({ error: "MFA is not available in local dev mode" });
    }

    const { cognitoAccessToken } = z
      .object({ cognitoAccessToken: z.string().min(1) })
      .parse(req.body);

    const { secretCode } = await cognitoAuth.setupMfa(cognitoAccessToken);

    const issuer = encodeURIComponent("Cohi");
    const email = encodeURIComponent(req.userEmail || "user");
    const otpauthUri = `otpauth://totp/${issuer}:${email}?secret=${secretCode}&issuer=${issuer}`;

    logInfo("[MFA] Setup initiated", { userId: req.userId });

    return res.json({
      secret: secretCode,
      qrCodeUri: otpauthUri,
    });
  } catch (error: any) {
    logError("[MFA] Setup error", error, { userId: req.userId });
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ error: error.message || "Failed to setup MFA" });
  }
});

/**
 * POST /api/auth/mfa/setup/confirm
 * Verify the TOTP code and enable MFA for the user.
 */
router.post("/setup/confirm", authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (!cognitoAuth.isCognitoAuthEnabled()) {
      return res.status(400).json({ error: "MFA is not available in local dev mode" });
    }

    const { cognitoAccessToken, code } = z
      .object({
        cognitoAccessToken: z.string().min(1),
        code: z.string().length(6, "MFA code must be 6 digits"),
      })
      .parse(req.body);

    await cognitoAuth.verifyMfaSetup(cognitoAccessToken, code);

    await auditLog({
      userId: req.userId || null,
      userEmail: req.userEmail || null,
      userRole: req.userRole || null,
      tenantId: req.tenantId || null,
      action: "mfa_enabled",
      resource: "auth",
      description: "MFA enabled via TOTP authenticator app",
      status: "success",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    }).catch(() => {});

    logInfo("[MFA] Setup confirmed and enabled", { userId: req.userId });

    return res.json({ success: true, message: "MFA has been enabled" });
  } catch (error: any) {
    logError("[MFA] Setup confirm error", error, { userId: req.userId });
    const statusCode = error.statusCode || 400;
    return res.status(statusCode).json({ error: error.message || "Failed to verify MFA code" });
  }
});

/**
 * DELETE /api/auth/mfa
 * Disable MFA for the current user.
 */
router.delete("/", authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (!cognitoAuth.isCognitoAuthEnabled()) {
      return res.status(400).json({ error: "MFA is not available in local dev mode" });
    }

    const email = req.userEmail;
    if (!email) {
      return res.status(400).json({ error: "User email not available" });
    }

    await cognitoAuth.disableMfa(email);

    await auditLog({
      userId: req.userId || null,
      userEmail: email,
      userRole: req.userRole || null,
      tenantId: req.tenantId || null,
      action: "mfa_disabled",
      resource: "auth",
      description: "MFA disabled",
      status: "success",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    }).catch(() => {});

    logInfo("[MFA] Disabled", { userId: req.userId });

    return res.json({ success: true, message: "MFA has been disabled" });
  } catch (error: any) {
    logError("[MFA] Disable error", error, { userId: req.userId });
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ error: error.message || "Failed to disable MFA" });
  }
});

/**
 * GET /api/auth/mfa/status
 * Check whether MFA is enabled for the current user.
 */
router.get("/status", authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (!cognitoAuth.isCognitoAuthEnabled()) {
      return res.json({ mfaEnabled: false, available: false });
    }

    const email = req.userEmail;
    if (!email) {
      return res.json({ mfaEnabled: false, available: true });
    }

    const { mfaEnabled } = await cognitoAuth.getUser(email);

    return res.json({ mfaEnabled, available: true });
  } catch (error: any) {
    logError("[MFA] Status check error", error, { userId: req.userId });
    return res.json({ mfaEnabled: false, available: true });
  }
});

export default router;
