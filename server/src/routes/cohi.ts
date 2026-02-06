/**
 * COHI API Routes – structured query (responsePlan + dataPayloads) for COHI chat.
 */

import { Router } from "express";
import { authenticateToken, AuthRequest } from "../middleware/auth.js";
import { attachTenantContext } from "../middleware/tenantContext.js";
import { apiLimiter } from "../middleware/rateLimiter.js";
import { checkSectionAccess, type QueryContext } from "../services/ai/queryBuilderService.js";
import { responsePlanner } from "../services/cohi/index.js";

const router = Router();

function buildQueryContext(req: AuthRequest): QueryContext {
  const tenantId = req.tenantContext?.tenantId || (req as any).tenantId;
  if (!tenantId) {
    throw new Error("No tenant context available");
  }
  return {
    userId: req.userId!,
    tenantId,
    userRole: req.userRole || "user",
    userEmail: req.userEmail,
  };
}

/**
 * POST /api/cohi/query
 * Run COHI query: question → intent → fetch data → responsePlan + dataPayloads.
 * Tenant from query param tenant_id or JWT/tenantContext.
 */
router.post(
  "/query",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { question, context } = req.body;
      const tenantId = req.tenantContext?.tenantId || (req.query.tenant_id as string) || (req as any).tenantId;
      const userId = req.userId;

      if (!question || typeof question !== "string") {
        return res.status(400).json({ error: "Question is required" });
      }
      if (!tenantId) {
        return res.status(400).json({ error: "Tenant context required. Set tenant_id query param or use a tenant-scoped session." });
      }
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const queryContext = buildQueryContext(req);
      const hasAccess = await checkSectionAccess("data_chat", queryContext);
      if (!hasAccess) {
        return res.status(403).json({
          error: "Access denied",
          message: "You don't have access to the data chat feature",
        });
      }

      const result = await responsePlanner({
        tenantId,
        userId,
        question: question.trim(),
        context: context || {},
      });

      return res.status(200).json({
        responsePlan: result.responsePlan,
        dataPayloads: result.dataPayloads,
        audit: result.audit,
      });
    } catch (err: any) {
      console.error("[COHI] /query error:", err?.message || err);
      return res.status(500).json({
        error: err?.message || "COHI query failed",
      });
    }
  }
);

export default router;
