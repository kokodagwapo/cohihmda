import { Router } from "express";
import { authenticateToken, AuthRequest } from "../middleware/auth.js";
import { attachTenantContext, getTenantContext } from "../middleware/tenantContext.js";
import { requireRole } from "../middleware/rbac.js";
import {
  getFalloutAlertConfig,
  sendFalloutAlerts,
  upsertFalloutAlertConfig,
} from "../services/falloutAlertService.js";
import { resolveFrontendUrl } from "../utils/frontendUrl.js";

const router = Router();
const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const requireFalloutAlertAdmin = requireRole(
  "tenant_admin",
  "super_admin",
  "platform_admin",
);

router.get(
  "/config",
  authenticateToken,
  attachTenantContext,
  requireFalloutAlertAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const config = await getFalloutAlertConfig(tenantPool);
      res.json({
        config: config ?? {
          enabled: false,
          min_risk_score: 75,
          frequency: "daily_digest",
          include_risk_levels: ["Very High", "High"],
          custom_message: null,
          notify_managers: false,
          target_encompass_user_ids: [],
          manager_user_ids: [],
        },
      });
    } catch (error: unknown) {
      res.status(500).json({ error: getErrorMessage(error, "Failed to load fallout alert config") });
    }
  },
);

router.put(
  "/config",
  authenticateToken,
  attachTenantContext,
  requireFalloutAlertAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const body = req.body ?? {};

      const minRiskScoreRaw = Number(body.min_risk_score);
      const minRiskScore = Number.isFinite(minRiskScoreRaw)
        ? Math.max(0, Math.min(100, Math.round(minRiskScoreRaw)))
        : undefined;
      const allowedFrequencies = new Set(["realtime", "daily_digest", "weekly_digest"]);
      const frequency = typeof body.frequency === "string" && allowedFrequencies.has(body.frequency)
        ? body.frequency
        : undefined;
      const levels = Array.isArray(body.include_risk_levels)
        ? body.include_risk_levels.filter((v: unknown) => typeof v === "string")
        : undefined;
      const targetEncompassUserIds = Array.isArray(body.target_encompass_user_ids)
        ? body.target_encompass_user_ids.filter((v: unknown) => typeof v === "string")
        : undefined;
      const managerUserIds = Array.isArray(body.manager_user_ids)
        ? body.manager_user_ids.filter((v: unknown) => typeof v === "string")
        : undefined;

      const config = await upsertFalloutAlertConfig(tenantPool, {
        createdBy: req.userId ?? null,
        enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
        min_risk_score: minRiskScore,
        frequency: frequency as "realtime" | "daily_digest" | "weekly_digest" | undefined,
        include_risk_levels: levels as string[] | undefined,
        custom_message: typeof body.custom_message === "string" ? body.custom_message : undefined,
        notify_managers:
          typeof body.notify_managers === "boolean" ? body.notify_managers : undefined,
        target_encompass_user_ids: targetEncompassUserIds as string[] | undefined,
        manager_user_ids: managerUserIds as string[] | undefined,
      });

      res.json({ config });
    } catch (error: unknown) {
      res.status(500).json({ error: getErrorMessage(error, "Failed to update fallout alert config") });
    }
  },
);

router.get(
  "/recipient-options",
  authenticateToken,
  attachTenantContext,
  requireFalloutAlertAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const [loanOfficersResult, activeLoanCountsResult, managersResult, branchesResult] = await Promise.all([
        tenantPool.query(
          `SELECT DISTINCT
             encompass_user_id,
             COALESCE(full_name, NULLIF(TRIM(first_name || ' ' || last_name), ''), username, encompass_user_id) AS display_name,
             email
           FROM public.encompass_users
           WHERE is_enabled = true
             AND email IS NOT NULL
           ORDER BY display_name ASC`,
        ),
        tenantPool.query(
          `SELECT
             loan_officer_id,
             loan_officer,
             COUNT(*)::int AS active_loan_count
           FROM public.loans
           WHERE current_loan_status = 'Active Loan'
             AND (is_archived IS DISTINCT FROM TRUE)
           GROUP BY loan_officer_id, loan_officer`,
        ),
        tenantPool.query(
          `SELECT id, COALESCE(full_name, email) AS display_name, email, role
           FROM public.users
           WHERE role = 'tenant_admin'
             AND email IS NOT NULL
             AND is_active = true
           ORDER BY display_name ASC`,
        ),
        tenantPool.query(
          `SELECT DISTINCT branch
           FROM public.loans
           WHERE branch IS NOT NULL
             AND TRIM(branch) <> ''
           ORDER BY branch ASC`,
        ),
      ]);
      const activeCountById = new Map<string, number>();
      const activeCountByName = new Map<string, number>();
      for (const row of activeLoanCountsResult.rows as Array<{
        loan_officer_id: string | null;
        loan_officer: string | null;
        active_loan_count: number;
      }>) {
        if (row.loan_officer_id) {
          activeCountById.set(String(row.loan_officer_id), Number(row.active_loan_count) || 0);
        }
        if (row.loan_officer) {
          activeCountByName.set(row.loan_officer.trim().toLowerCase(), Number(row.active_loan_count) || 0);
        }
      }

      const loanOfficers = (loanOfficersResult.rows as Array<{
        encompass_user_id: string;
        display_name: string;
        email: string;
      }>).map((row) => ({
        ...row,
        active_loan_count:
          activeCountById.get(row.encompass_user_id) ??
          activeCountByName.get(row.display_name.trim().toLowerCase()) ??
          0,
      }));

      res.json({
        loanOfficers,
        managers: managersResult.rows,
        branches: (branchesResult.rows as Array<{ branch: string }>).map((row) => row.branch),
      });
    } catch (error: unknown) {
      res.status(500).json({ error: getErrorMessage(error, "Failed to load recipient options") });
    }
  },
);

router.post(
  "/send-now",
  authenticateToken,
  attachTenantContext,
  requireFalloutAlertAdmin,
  async (req: AuthRequest, res) => {
    try {
      const tenantContext = getTenantContext(req);
      const config = await getFalloutAlertConfig(tenantContext.tenantPool);
      if (!config) {
        return res.status(400).json({
          error: "Fallout alert config not found",
          message: "Save fallout alert settings before sending alerts.",
        });
      }
      const testRecipientEmailsRaw: string[] = Array.isArray(req.body?.test_recipient_emails)
        ? req.body.test_recipient_emails.filter((value: unknown) => typeof value === "string")
        : [];
      const testRecipientEmails: string[] = Array.from(
        new Set(
          testRecipientEmailsRaw
            .map((email: string) => email.trim().toLowerCase())
            .filter((email: string) => email.length > 0),
        ),
      );
      const invalidTestEmail = testRecipientEmails.find((email: string) => !EMAIL_REGEX.test(email));
      if (invalidTestEmail) {
        return res.status(400).json({
          error: "Invalid test recipient email",
          message: `Invalid email address: ${invalidTestEmail}`,
        });
      }

      const hasLoTargets =
        Array.isArray(config.target_encompass_user_ids) &&
        config.target_encompass_user_ids.length > 0;
      const managerNotificationsEnabled = Boolean(config.notify_managers);
      const sendManagerCards = Boolean(req.body?.send_manager_cards);
      const managerCardBranchFilters = Array.isArray(req.body?.manager_card_branch_filters)
        ? req.body.manager_card_branch_filters
            .filter((value: unknown) => typeof value === "string")
            .map((value: string) => value.trim())
            .filter((value: string) => value.length > 0)
        : [];
      const managerCardScopeToTargetLos =
        typeof req.body?.manager_card_scope_to_target_los === "boolean"
          ? req.body.manager_card_scope_to_target_los
          : true;
      const hasManualTestRecipients = testRecipientEmails.length > 0;
      if (!hasLoTargets && !managerNotificationsEnabled && !hasManualTestRecipients && !sendManagerCards) {
        return res.status(400).json({
          error: "No recipients selected",
          message:
            "Select at least one loan officer, enable manager notifications, enable manager cards, or add test recipient emails.",
        });
      }

      const appBaseUrl =
        process.env.APP_BASE_URL || resolveFrontendUrl();
      const sendResult = await sendFalloutAlerts({
        tenantPool: tenantContext.tenantPool,
        tenantId: tenantContext.tenantId,
        tenantSlug: tenantContext.tenantInfo.slug,
        appBaseUrl,
        config,
        testRecipientEmails,
        managerCardDelivery: {
          enabled: sendManagerCards,
          branchFilters: managerCardBranchFilters,
          scopeToTargetLos: managerCardScopeToTargetLos,
        },
      });

      res.json({
        message: "Fallout alert distribution completed",
        ...sendResult,
      });
    } catch (error: unknown) {
      res.status(500).json({ error: getErrorMessage(error, "Failed to send fallout alerts") });
    }
  },
);

router.get(
  "/responses",
  authenticateToken,
  attachTenantContext,
  requireFalloutAlertAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const limitRaw = Number(req.query.limit);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.round(limitRaw))) : 50;
      const result = await tenantPool.query(
        `SELECT *
         FROM (
           SELECT DISTINCT ON (r.token_id)
             r.id,
             r.alert_batch_id,
             r.loan_id,
             l.loan_number,
             COALESCE(
               NULLIF(TRIM(eu.full_name), ''),
               NULLIF(TRIM(l.loan_officer), ''),
               r.recipient_email
             ) AS loan_officer,
             r.encompass_user_id,
             r.recipient_email,
             r.response,
             r.response_note,
             r.ip_address,
             r.user_agent,
             r.responded_at,
             r.created_at
           FROM public.fallout_alert_responses r
           LEFT JOIN public.loans l ON l.loan_id = r.loan_id
           LEFT JOIN public.encompass_users eu ON eu.encompass_user_id = r.encompass_user_id
           ORDER BY r.token_id, r.responded_at DESC, r.created_at DESC
         ) latest
         ORDER BY latest.responded_at DESC, latest.created_at DESC
         LIMIT $1`,
        [limit],
      );
      res.json({ responses: result.rows });
    } catch (error: unknown) {
      res.status(500).json({ error: getErrorMessage(error, "Failed to fetch fallout alert responses") });
    }
  },
);

export default router;
