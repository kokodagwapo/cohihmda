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

function decodeAccessTokenPayload(token: string): Record<string, unknown> | null {
  try {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) return null;
    const json = Buffer.from(payloadPart, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function getEmailFromAccessToken(token: string): string | null {
  const payload = decodeAccessTokenPayload(token);
  if (!payload) return null;
  const raw = payload.email ?? payload.username ?? payload["cognito:username"];
  return typeof raw === "string" ? raw : null;
}

/**
 * POST /api/auth/mfa/setup
 * Begin MFA setup -- returns the TOTP secret and a QR code URI.
 * Requires a valid Cognito access token in the request body.
 */
router.post("/setup", async (req: AuthRequest, res) => {
  try {
    if (!cognitoAuth.isCognitoAuthEnabled()) {
      return res.status(400).json({ error: "MFA is not available in local dev mode" });
    }

    const { cognitoAccessToken } = z
      .object({ cognitoAccessToken: z.string().min(1) })
      .parse(req.body);

    const { secretCode } = await cognitoAuth.setupMfa(cognitoAccessToken);

    const tokenEmail = getEmailFromAccessToken(cognitoAccessToken) || "user";
    const issuer = encodeURIComponent("Cohi");
    const email = encodeURIComponent(tokenEmail);
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
router.post("/setup/confirm", async (req: AuthRequest, res) => {
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

router.delete("/", authenticateToken, async (_req: AuthRequest, res) => {
  return res.status(403).json({
    error: "MFA is mandatory and cannot be disabled. Switch methods instead.",
  });
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

    const { mfaEnabled, mfaMethod } = await cognitoAuth.getUser(email);

    return res.json({ mfaEnabled, mfaMethod, available: true });
  } catch (error: any) {
    logError("[MFA] Status check error", error, { userId: req.userId });
    return res.json({ mfaEnabled: false, mfaMethod: null, available: true });
  }
});

/**
 * POST /api/auth/mfa/email/setup
 * Enable Cognito-managed email MFA for a user.
 */
router.post("/email/setup", async (req: AuthRequest, res) => {
  try {
    const { cognitoAccessToken } = z
      .object({
        cognitoAccessToken: z.string().min(1),
      })
      .parse(req.body);

    await cognitoAuth.enableEmailMfaWithAccessToken(cognitoAccessToken);
    return res.json({ success: true });
  } catch (error: any) {
    logError("[MFA] Email setup error", error, {});
    return res.status(error.statusCode || 400).json({
      error: error.message || "Failed to enable email MFA",
    });
  }
});

/**
 * PUT /api/auth/mfa/method
 * Switch MFA method (mandatory MFA means switch-only, no disable).
 */
router.put("/method", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { method } = z
      .object({
        method: z.enum(["totp", "email"]),
      })
      .parse(req.body);

    if (!req.userEmail) {
      return res.status(400).json({ error: "User email not available" });
    }

    await cognitoAuth.setPreferredMfaMethod(req.userEmail, method);
    return res.json({
      success: true,
      mfaMethod: method,
      message: `MFA method switched to ${method}`,
    });
  } catch (error: any) {
    logError("[MFA] Method switch error", error, { userId: req.userId });
    const statusCode = error.statusCode || 400;
    return res.status(statusCode).json({ error: error.message || "Failed to switch MFA method" });
  }
});

export default router;
