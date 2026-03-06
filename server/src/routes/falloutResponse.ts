import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { tenantDbManager } from "../config/tenantDatabaseManager.js";
import {
  FalloutAlertResponseType,
  saveFalloutTokenResponse,
} from "../services/falloutAlertService.js";

const router = Router();
const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const falloutResponseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "production" ? 30 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many fallout response attempts from this IP, please try again later.",
});

function renderHtml(title: string, body: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; margin: 0; padding: 24px; color: #0f172a; }
      .card { max-width: 640px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; }
      h1 { margin: 0 0 10px; font-size: 24px; }
      p { margin: 0; color: #334155; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${title}</h1>
      <p>${body}</p>
    </div>
  </body>
</html>`;
}

router.get(
  "/:tenantSlug/:token",
  falloutResponseLimiter,
  async (req: Request, res: Response) => {
    try {
      const tenantSlug = String(req.params.tenantSlug || "").trim();
      const token = String(req.params.token || "").trim();
      const actionRaw = String(req.query.action || "").trim().toLowerCase();

      if (!tenantSlug || !token) {
        return res.status(400).send(renderHtml("Invalid link", "This response link is invalid."));
      }

      const allowed = new Set(["acknowledged", "working_on_it", "need_help"]);
      if (!allowed.has(actionRaw)) {
        return res
          .status(400)
          .send(renderHtml("Invalid action", "Please use one of the action buttons from your email."));
      }

      const tenantPool = await tenantDbManager.getTenantPool(tenantSlug);
      const responseResult = await saveFalloutTokenResponse({
        tenantPool,
        token,
        action: actionRaw as FalloutAlertResponseType,
        ipAddress: req.ip ?? null,
        userAgent: req.get("user-agent") ?? null,
      });

      if (responseResult.status === "invalid") {
        return res
          .status(404)
          .send(renderHtml("Link not found", "This response link is invalid or has already been removed."));
      }
      if (responseResult.status === "expired") {
        return res
          .status(410)
          .send(renderHtml("Link expired", "This response link has expired. Please request a new alert email."));
      }
      if (responseResult.status !== "ok") {
        return res
          .status(400)
          .send(renderHtml("Invalid response", "Unable to process this response link."));
      }

      const message = responseResult.alreadyResponded
        ? "Your response has been updated."
        : "Your response has been recorded. Thank you.";
      return res.status(200).send(renderHtml("Response saved", message));
    } catch (error: unknown) {
      return res
        .status(500)
        .send(renderHtml("Something went wrong", getErrorMessage(error, "Unable to process your response.")));
    }
  },
);

export default router;
