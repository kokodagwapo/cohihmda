import crypto from "crypto";
import type { Pool } from "pg";
import { loadEmailTemplate, replacePlaceholders } from "./emailTemplateLoader.js";
import { sendEmail } from "./emailService.js";
import { getPlatformSetting } from "./platformSettingsService.js";

export type FalloutAlertResponseType =
  | "acknowledged"
  | "working_on_it"
  | "need_help";

export interface FalloutAlertConfig {
  id: string;
  enabled: boolean;
  min_risk_score: number;
  frequency: "realtime" | "daily_digest" | "weekly_digest";
  include_risk_levels: string[];
  custom_message: string | null;
  notify_managers: boolean;
  target_encompass_user_ids: string[];
  manager_user_ids: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface RiskLoanRow {
  loan_id: string;
  loan_number: string | null;
  branch: string | null;
  loan_amount: number | null;
  loan_officer: string | null;
  loan_officer_id: string | null;
  estimated_closing_date: string | null;
  risk_score: number;
  risk_level: string;
  predicted_outcome: "withdraw" | "deny" | "originate";
  risk_factors: string[] | null;
}

interface RecipientLoan {
  loanId: string;
  loanNumber: string;
  loanOfficerName: string;
  amount: number | null;
  riskScore: number;
  riskLevel: string;
  predictedOutcome: "withdraw" | "deny" | "originate";
  estimatedClosingDate: string | null;
  riskReasons: string[];
}

interface ResolvedRecipient {
  encompassUserId: string;
  email: string;
  fullName: string | null;
  loans: RecipientLoan[];
}

export interface SendFalloutAlertsResult {
  alertBatchId: string;
  recipientsCount: number;
  sentCount: number;
  failedRecipients: Array<{ email: string; error: string }>;
  skippedLoansCount: number;
  highRiskLoanCount: number;
  devMode: boolean;
  devRedirectedTo?: string[];
  testRecipients: {
    attempted: number;
    sent: number;
    failed: Array<{ email: string; error: string }>;
  };
  managerNotifications: {
    attempted: number;
    sent: number;
    failed: Array<{ email: string; error: string }>;
  };
  managerCardNotifications: {
    attempted: number;
    sent: number;
    failed: Array<{ email: string; error: string }>;
    loanCount: number;
  };
}

function isProductionEnv(): boolean {
  return process.env.NODE_ENV === "production";
}

function getDevAllowedEmailsFromEnv(): string[] {
  const raw = process.env.FALLOUT_DEV_ALLOWED_EMAILS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

async function getDevAllowedEmails(): Promise<string[]> {
  try {
    const dbValue = await getPlatformSetting("fallout_dev_allowed_emails");
    if (dbValue) {
      const parsed = JSON.parse(dbValue);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.filter((e: unknown) => typeof e === "string" && e.trim()).map((e: string) => e.trim().toLowerCase());
      }
    }
  } catch {
    // DB read failed — fall through to env
  }
  return getDevAllowedEmailsFromEnv();
}

async function isEmailRedirectEnabled(): Promise<boolean> {
  try {
    const dbValue = await getPlatformSetting("fallout_email_redirect_enabled");
    if (dbValue !== null && dbValue !== undefined) {
      return dbValue === "true";
    }
  } catch {
    // fall through
  }
  // Safety net: if not production, implicitly redirect
  return !isProductionEnv();
}

/**
 * Returns the effective redirect mode for fallout emails.
 * redirectActive = true means emails should go to the safe list, not real recipients.
 * This can be triggered by:
 *   1. The platform setting `fallout_email_redirect_enabled` being explicitly set to true
 *   2. Running outside of production (NODE_ENV != "production") as a safety net
 */
export async function getFalloutDevMode(): Promise<{ isDevMode: boolean; redirectActive: boolean; allowedEmails: string[] }> {
  const isDevMode = !isProductionEnv();
  const redirectEnabled = await isEmailRedirectEnabled();
  const allowedEmails = redirectEnabled ? await getDevAllowedEmails() : [];
  return { isDevMode, redirectActive: redirectEnabled, allowedEmails };
}

const UUID_V4_OR_V1_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuidLike(value: string): boolean {
  return UUID_V4_OR_V1_REGEX.test(value.trim());
}

async function resolveTenantCreatedByUserId(
  tenantPool: Pool,
  createdBy: string | null | undefined,
): Promise<string | null> {
  if (!createdBy) return null;
  const normalized = createdBy.trim();
  if (!isUuidLike(normalized)) return null;

  const exists = await tenantPool.query<{ id: string }>(
    `SELECT id
     FROM public.users
     WHERE id = $1
     LIMIT 1`,
    [normalized],
  );
  return exists.rows[0]?.id ?? null;
}

function getRiskLevel(score: number): string {
  if (score >= 75) return "Very High";
  if (score >= 50) return "High";
  if (score >= 25) return "Medium";
  return "Low";
}

function toCurrency(amount: number | null): string {
  if (amount == null || Number.isNaN(amount)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function toIsoDate(value: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toISOString().split("T")[0];
}

export async function getFalloutAlertConfig(
  tenantPool: Pool,
): Promise<FalloutAlertConfig | null> {
  const result = await tenantPool.query<FalloutAlertConfig>(
    `SELECT id, enabled, min_risk_score, frequency, include_risk_levels, custom_message,
            notify_managers, target_encompass_user_ids, manager_user_ids, created_by, created_at, updated_at
     FROM public.fallout_alert_config
     ORDER BY created_at DESC
     LIMIT 1`,
  );
  return result.rows[0] ?? null;
}

export async function upsertFalloutAlertConfig(
  tenantPool: Pool,
  input: Partial<FalloutAlertConfig> & { createdBy: string | null },
): Promise<FalloutAlertConfig> {
  const createdByTenantUserId = await resolveTenantCreatedByUserId(
    tenantPool,
    input.createdBy,
  );
  const existing = await getFalloutAlertConfig(tenantPool);
  if (!existing) {
    const insertResult = await tenantPool.query<FalloutAlertConfig>(
      `INSERT INTO public.fallout_alert_config
       (enabled, min_risk_score, frequency, include_risk_levels, custom_message, notify_managers, target_encompass_user_ids, manager_user_ids, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, enabled, min_risk_score, frequency, include_risk_levels, custom_message,
                 notify_managers, target_encompass_user_ids, manager_user_ids, created_by, created_at, updated_at`,
      [
        input.enabled ?? false,
        input.min_risk_score ?? 75,
        input.frequency ?? "daily_digest",
        Array.isArray(input.include_risk_levels)
          ? input.include_risk_levels
          : ["Very High", "High"],
        input.custom_message ?? null,
        input.notify_managers ?? false,
        Array.isArray(input.target_encompass_user_ids) ? input.target_encompass_user_ids : [],
        Array.isArray(input.manager_user_ids) ? input.manager_user_ids : [],
        createdByTenantUserId,
      ],
    );
    return insertResult.rows[0];
  }

  const updateResult = await tenantPool.query<FalloutAlertConfig>(
    `UPDATE public.fallout_alert_config
     SET enabled = COALESCE($2, enabled),
         min_risk_score = COALESCE($3, min_risk_score),
         frequency = COALESCE($4, frequency),
         include_risk_levels = COALESCE($5, include_risk_levels),
         custom_message = $6,
         notify_managers = COALESCE($7, notify_managers),
         target_encompass_user_ids = COALESCE($8, target_encompass_user_ids),
         manager_user_ids = COALESCE($9, manager_user_ids),
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, enabled, min_risk_score, frequency, include_risk_levels, custom_message,
               notify_managers, target_encompass_user_ids, manager_user_ids, created_by, created_at, updated_at`,
    [
      existing.id,
      input.enabled,
      input.min_risk_score,
      input.frequency,
      Array.isArray(input.include_risk_levels) ? input.include_risk_levels : null,
      input.custom_message ?? existing.custom_message,
      input.notify_managers,
      Array.isArray(input.target_encompass_user_ids) ? input.target_encompass_user_ids : null,
      Array.isArray(input.manager_user_ids) ? input.manager_user_ids : null,
    ],
  );
  return updateResult.rows[0];
}

export async function getHighRiskLoansForAlerts(
  tenantPool: Pool,
  config: Pick<FalloutAlertConfig, "min_risk_score" | "include_risk_levels">,
): Promise<RiskLoanRow[]> {
  const minScore = Math.max(0, Math.min(100, Number(config.min_risk_score || 75)));
  const allowedLevels = Array.isArray(config.include_risk_levels) && config.include_risk_levels.length > 0
    ? config.include_risk_levels
    : ["Very High", "High"];

  const result = await tenantPool.query(
    `WITH latest_predictions AS (
      SELECT DISTINCT ON (lp.loan_id)
        lp.loan_id,
        lp.predicted_outcome,
        lp.risk_factors,
        lp.confidence,
        lp.confidence_score,
        lp.loan_data
      FROM public.loan_predictions lp
      ORDER BY lp.loan_id, lp.created_at DESC
    ),
    scored AS (
      SELECT
        l.loan_id,
        l.loan_number,
        l.branch,
        l.loan_amount,
        l.loan_officer,
        l.loan_officer_id,
        l.estimated_closing_date,
        p.predicted_outcome,
        p.risk_factors,
        ROUND(COALESCE(
          CASE
            WHEN jsonb_typeof(p.loan_data->'riskSummary') = 'object'
             AND (p.loan_data->'riskSummary'->>'riskScore') ~ '^[0-9]+(\\.[0-9]+)?$'
            THEN (p.loan_data->'riskSummary'->>'riskScore')::numeric
            ELSE NULL
          END,
          p.confidence_score,
          p.confidence::numeric,
          50
        ))::int AS risk_score
      FROM latest_predictions p
      JOIN public.loans l ON l.loan_id = p.loan_id
      WHERE p.predicted_outcome IN ('withdraw', 'deny')
        AND l.current_loan_status = 'Active Loan'
        AND (l.is_archived IS DISTINCT FROM TRUE)
    )
    SELECT
      loan_id,
      loan_number,
      branch,
      loan_amount,
      loan_officer,
      loan_officer_id,
      estimated_closing_date,
      risk_score,
      CASE
        WHEN risk_score >= 75 THEN 'Very High'
        WHEN risk_score >= 50 THEN 'High'
        WHEN risk_score >= 25 THEN 'Medium'
        ELSE 'Low'
      END AS risk_level,
      predicted_outcome,
      risk_factors
    FROM scored
    WHERE risk_score >= $1
      AND (
        CASE
          WHEN risk_score >= 75 THEN 'Very High'
          WHEN risk_score >= 50 THEN 'High'
          WHEN risk_score >= 25 THEN 'Medium'
          ELSE 'Low'
        END
      ) = ANY($2::text[])
    ORDER BY risk_score DESC`,
    [minScore, allowedLevels],
  );
  return result.rows as RiskLoanRow[];
}

export async function resolveLoanOfficerEmails(
  tenantPool: Pool,
  loans: RiskLoanRow[],
  targetEncompassUserIds?: string[],
): Promise<{ recipients: ResolvedRecipient[]; skippedLoansCount: number }> {
  if (loans.length === 0) return { recipients: [], skippedLoansCount: 0 };
  const loanOfficerIds = Array.from(
    new Set(
      loans
        .map((loan) => loan.loan_officer_id?.trim())
        .filter((v): v is string => Boolean(v)),
    ),
  );
  const loanOfficerNames = Array.from(
    new Set(
      loans
        .map((loan) => loan.loan_officer?.trim().toLowerCase())
        .filter((v): v is string => Boolean(v)),
    ),
  );

  const usersResult = await tenantPool.query<{
    encompass_user_id: string;
    email: string;
    full_name: string | null;
  }>(
    `SELECT encompass_user_id, email, full_name
     FROM public.encompass_users
     WHERE is_enabled = true
       AND email IS NOT NULL
       AND (
         encompass_user_id = ANY($1::text[])
        OR LOWER(full_name) = ANY($2::text[])
       )`,
    [loanOfficerIds, loanOfficerNames],
  );

  const byId = new Map<string, { encompass_user_id: string; email: string; full_name: string | null }>();
  const byName = new Map<string, { encompass_user_id: string; email: string; full_name: string | null }>();
  for (const user of usersResult.rows) {
    byId.set(user.encompass_user_id.trim(), user);
    if (user.full_name) byName.set(user.full_name.trim().toLowerCase(), user);
  }

  const recipientMap = new Map<string, ResolvedRecipient>();
  let skippedLoansCount = 0;
  const targetSet = new Set(
    Array.isArray(targetEncompassUserIds) ? targetEncompassUserIds.filter(Boolean) : [],
  );
  if (targetSet.size === 0) {
    // Explicit targeting is required; no default "all LOs" behavior.
    return { recipients: [], skippedLoansCount: 0 };
  }

  for (const loan of loans) {
    const matched =
      (loan.loan_officer_id ? byId.get(loan.loan_officer_id.trim()) : undefined) ||
      (loan.loan_officer ? byName.get(loan.loan_officer.trim().toLowerCase()) : undefined);

    if (!matched?.email) {
      console.warn(
        `[FalloutAlerts] Unable to resolve LO recipient for loan ${loan.loan_id} (loan_officer_id=${loan.loan_officer_id ?? "null"}, loan_officer=${loan.loan_officer ?? "null"})`,
      );
      skippedLoansCount += 1;
      continue;
    }
    if (targetSet.size > 0 && !targetSet.has(matched.encompass_user_id)) {
      continue;
    }

    const key = `${matched.encompass_user_id}:${matched.email.toLowerCase()}`;
    if (!recipientMap.has(key)) {
      recipientMap.set(key, {
        encompassUserId: matched.encompass_user_id,
        email: matched.email,
        fullName: matched.full_name,
        loans: [],
      });
    }

    recipientMap.get(key)!.loans.push({
      loanId: loan.loan_id,
      loanNumber: loan.loan_number || loan.loan_id,
      loanOfficerName: loan.loan_officer || matched.full_name || "Loan Officer",
      amount: loan.loan_amount,
      riskScore: loan.risk_score,
      riskLevel: loan.risk_level,
      predictedOutcome: loan.predicted_outcome,
      estimatedClosingDate: loan.estimated_closing_date,
      riskReasons: Array.isArray(loan.risk_factors) ? loan.risk_factors : [],
    });
  }

  return { recipients: Array.from(recipientMap.values()), skippedLoansCount };
}

function buildActionUrl(
  appBaseUrl: string,
  tenantSlug: string,
  token: string,
  action: FalloutAlertResponseType,
): string {
  const trimmed = appBaseUrl.replace(/\/+$/, "");
  return `${trimmed}/api/fallout-response/${encodeURIComponent(tenantSlug)}/${encodeURIComponent(token)}?action=${encodeURIComponent(action)}`;
}

function riskBadgeColor(level: string): { bg: string; color: string } {
  switch (level) {
    case "Very High": return { bg: "#ef4444", color: "#ffffff" };
    case "High": return { bg: "#f97316", color: "#ffffff" };
    case "Medium": return { bg: "#eab308", color: "#ffffff" };
    default: return { bg: "#22c55e", color: "#ffffff" };
  }
}

function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case "withdraw": return "Likely Withdraw";
    case "deny": return "Likely Decline";
    case "originate": return "Likely to Close";
    default: return outcome;
  }
}

function buildLoanRowsHtml(
  recipient: ResolvedRecipient,
  tokenByLoanId: Map<string, string>,
  appBaseUrl: string,
  tenantSlug: string,
  isAppUser = false,
): string {
  const appBase = appBaseUrl.replace(/\/+$/, "");
  return recipient.loans
    .map((loan) => {
      const token = tokenByLoanId.get(loan.loanId);
      if (!token) return "";
      const gotItUrl = buildActionUrl(appBaseUrl, tenantSlug, token, "acknowledged");
      const workingUrl = buildActionUrl(appBaseUrl, tenantSlug, token, "working_on_it");
      const helpUrl = buildActionUrl(appBaseUrl, tenantSlug, token, "need_help");
      const loanDetailUrl = `${appBase}/fallout-forecast/loan/${encodeURIComponent(loan.loanId)}`;
      const reasons = loan.riskReasons.slice(0, 3).join(" · ") || "Risk factors not specified";
      const badge = riskBadgeColor(loan.riskLevel);

      const appLinkHtml = isAppUser
        ? `<tr><td style="padding:12px 16px 0 16px;">
             <a href="${loanDetailUrl}" style="font-size:12px;color:#3b82f6;text-decoration:none;font-weight:500;">Open full coaching view ↗</a>
           </td></tr>`
        : "";

      return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="border:1px solid #e2e8f0;border-radius:10px;background:#ffffff;margin:0 0 14px 0;overflow:hidden;">
        <!-- Loan header row -->
        <tr style="background:#f8fafc;">
          <td style="padding:12px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <p style="margin:0;font-size:15px;font-weight:700;color:#0f172a;">
                    Loan #${loan.loanNumber}
                  </p>
                  <p style="margin:3px 0 0;font-size:12px;color:#64748b;">
                    ${loan.loanOfficerName}
                  </p>
                </td>
                <td align="right" valign="top">
                  <span style="display:inline-block;background:${badge.bg};color:${badge.color};border-radius:999px;padding:4px 12px;font-size:11px;font-weight:700;letter-spacing:0.3px;white-space:nowrap;">
                    ${loan.riskLevel} · ${Math.round(loan.riskScore)}
                  </span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Meta row -->
        <tr>
          <td style="padding:10px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="33%" style="font-size:12px;color:#64748b;padding-bottom:4px;">
                  <span style="font-weight:600;color:#475569;">Amount</span><br>${toCurrency(loan.amount)}
                </td>
                <td width="33%" style="font-size:12px;color:#64748b;padding-bottom:4px;">
                  <span style="font-weight:600;color:#475569;">Outlook</span><br>${outcomeLabel(loan.predictedOutcome)}
                </td>
                <td width="34%" style="font-size:12px;color:#64748b;padding-bottom:4px;">
                  <span style="font-weight:600;color:#475569;">Est. Close</span><br>${toIsoDate(loan.estimatedClosingDate)}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Risk reasons row -->
        <tr>
          <td style="padding:0 16px 12px 16px;">
            <p style="margin:0;font-size:12px;color:#64748b;line-height:1.5;border-left:3px solid #e2e8f0;padding-left:10px;">
              ${reasons}
            </p>
          </td>
        </tr>
        <!-- Action buttons row -->
        <tr style="background:#f8fafc;border-top:1px solid #e2e8f0;">
          <td style="padding:12px 16px;">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding-right:8px;">
                  <a href="${gotItUrl}"
                     style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:8px 16px;border-radius:6px;font-size:12px;font-weight:600;letter-spacing:0.2px;">
                    Got it ✓
                  </a>
                </td>
                <td style="padding-right:8px;">
                  <a href="${workingUrl}"
                     style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:8px 16px;border-radius:6px;font-size:12px;font-weight:600;letter-spacing:0.2px;">
                    Working on it
                  </a>
                </td>
                <td>
                  <a href="${helpUrl}"
                     style="display:inline-block;background:#b91c1c;color:#ffffff;text-decoration:none;padding:8px 16px;border-radius:6px;font-size:12px;font-weight:600;letter-spacing:0.2px;">
                    Need help
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        ${appLinkHtml}
      </table>`;
    })
    .join("");
}

function buildManagerLoanCardsHtml({
  loans,
  appBaseUrl,
}: {
  loans: RiskLoanRow[];
  appBaseUrl: string;
}): string {
  const appBase = appBaseUrl.replace(/\/+$/, "");
  if (loans.length === 0) {
    return `<p style="color:#64748b;font-size:13px;">No high-risk loans matched your selected manager card filters.</p>`;
  }

  const cards = loans
    .slice(0, 60)
    .map((loan) => {
      const loanDetailUrl = `${appBase}/fallout-forecast/loan/${encodeURIComponent(loan.loan_id)}`;
      const reasons = Array.isArray(loan.risk_factors)
        ? loan.risk_factors.slice(0, 3).join(", ")
        : "Risk factors not specified";
      return `
        <div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin:0 0 10px;">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
            <a href="${loanDetailUrl}" style="font-weight:700;color:#2563eb;text-decoration:none;">
              Loan #${loan.loan_number || loan.loan_id}
            </a>
            <span style="font-size:11px;padding:2px 8px;border-radius:9999px;background:#fee2e2;color:#991b1b;font-weight:600;">
              ${loan.risk_level} (${loan.risk_score})
            </span>
          </div>
          <div style="font-size:12px;color:#334155;margin-top:6px;">
            <span><strong>LO:</strong> ${loan.loan_officer || "—"}</span>
            <span style="margin-left:10px;"><strong>Branch:</strong> ${loan.branch || "—"}</span>
            <span style="margin-left:10px;"><strong>Amount:</strong> ${toCurrency(loan.loan_amount)}</span>
          </div>
          <div style="font-size:12px;color:#64748b;margin-top:6px;">
            ${reasons}
          </div>
        </div>`;
    })
    .join("");

  const dashboardUrl = `${appBase}/fallout-forecast`;
  return `
    <p style="font-size:14px;color:#475569;">Actionable fallout cards for your selected scope are below.</p>
    ${cards}
    <div style="text-align:center;margin-top:14px;">
      <a href="${dashboardUrl}" style="display:inline-block;padding:10px 20px;background:#3b82f6;color:#fff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;">
        Open Full Fallout Report
      </a>
    </div>`;
}

function buildManagerSummaryHtml({
  alertBatchId,
  highRiskLoans,
  sentCount,
  recipientsCount,
  skippedLoansCount,
  minRiskScore,
  includeLevels,
  appBaseUrl,
}: {
  alertBatchId: string;
  highRiskLoans: RiskLoanRow[];
  sentCount: number;
  recipientsCount: number;
  skippedLoansCount: number;
  minRiskScore: number;
  includeLevels: string[];
  appBaseUrl: string;
}): string {
  const dashboardUrl = `${appBaseUrl.replace(/\/+$/, "")}/fallout-forecast`;

  if (highRiskLoans.length === 0) {
    return `
      <p>No high-risk loans matched the current alert criteria.</p>
      <p style="color:#64748b;font-size:13px;">Min score: ${minRiskScore} &bull; Levels: ${includeLevels.join(", ") || "all"}</p>
      <div style="text-align:center;margin:24px 0 8px;">
        <a href="${dashboardUrl}" style="display:inline-block;padding:12px 28px;background:#3b82f6;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">Open Coheus Dashboard</a>
      </div>`;
  }

  const loGroups = new Map<string, { name: string; loans: RiskLoanRow[] }>();
  for (const loan of highRiskLoans) {
    const key = loan.loan_officer_id || loan.loan_officer || "Unassigned";
    if (!loGroups.has(key)) {
      loGroups.set(key, { name: loan.loan_officer || "Unassigned", loans: [] });
    }
    loGroups.get(key)!.loans.push(loan);
  }

  const riskColor = (score: number) => {
    if (score >= 75) return "#ef4444";
    if (score >= 50) return "#f97316";
    if (score >= 25) return "#eab308";
    return "#22c55e";
  };

  const loanUrl = (loanId: string) =>
    `${appBaseUrl.replace(/\/+$/, "")}/fallout-forecast/loan/${encodeURIComponent(loanId)}`;

  const MAX_LOANS_SHOWN = 50;
  const loansToShow = highRiskLoans.slice(0, MAX_LOANS_SHOWN);
  const truncated = highRiskLoans.length > MAX_LOANS_SHOWN;

  const tableRows = loansToShow
    .map(
      (loan) => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;">
          <a href="${loanUrl(loan.loan_id)}" style="color:#3b82f6;text-decoration:none;font-weight:500;">${loan.loan_number || loan.loan_id.slice(0, 8)}</a>
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;">${loan.loan_officer || "—"}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;">${toCurrency(loan.loan_amount)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;">
          <span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:12px;font-weight:600;color:#fff;background:${riskColor(loan.risk_score)}">
            ${loan.risk_score} — ${loan.risk_level}
          </span>
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;">${loan.predicted_outcome}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;">${toIsoDate(loan.estimated_closing_date)}</td>
      </tr>`,
    )
    .join("");

  return `
    <div style="margin-bottom:20px;">
      <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
        <tr>
          <td style="padding:6px 0;"><strong>High-risk loans:</strong> ${highRiskLoans.length}</td>
          <td style="padding:6px 0;"><strong>LO alerts sent:</strong> ${sentCount}/${recipientsCount}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;"><strong>Loan officers affected:</strong> ${loGroups.size}</td>
          <td style="padding:6px 0;"><strong>Skipped (no LO match):</strong> ${skippedLoansCount}</td>
        </tr>
      </table>
    </div>

    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#f8fafc;">
          <th style="padding:10px;text-align:left;font-size:12px;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Loan #</th>
          <th style="padding:10px;text-align:left;font-size:12px;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Loan Officer</th>
          <th style="padding:10px;text-align:left;font-size:12px;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Amount</th>
          <th style="padding:10px;text-align:left;font-size:12px;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Risk</th>
          <th style="padding:10px;text-align:left;font-size:12px;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Outcome</th>
          <th style="padding:10px;text-align:left;font-size:12px;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0;">Est. Close</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
    ${truncated ? `<p style="color:#64748b;font-size:12px;margin-top:8px;">Showing ${MAX_LOANS_SHOWN} of ${highRiskLoans.length} loans. Open the dashboard to view all.</p>` : ""}

    <div style="text-align:center;margin:24px 0 8px;">
      <a href="${dashboardUrl}" style="display:inline-block;padding:12px 28px;background:#3b82f6;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">Open Coheus Dashboard</a>
    </div>`;
}

export async function sendFalloutAlerts({
  tenantPool,
  tenantId,
  tenantSlug,
  appBaseUrl,
  config,
  testRecipientEmails,
  managerCardDelivery,
}: {
  tenantPool: Pool;
  tenantId: string;
  tenantSlug: string;
  appBaseUrl: string;
  config: Pick<
    FalloutAlertConfig,
    | "min_risk_score"
    | "include_risk_levels"
    | "custom_message"
    | "notify_managers"
    | "target_encompass_user_ids"
    | "manager_user_ids"
  >;
  testRecipientEmails?: string[];
  managerCardDelivery?: {
    enabled?: boolean;
    branchFilters?: string[];
    scopeToTargetLos?: boolean;
  };
}): Promise<SendFalloutAlertsResult> {
  const highRiskLoans = await getHighRiskLoansForAlerts(tenantPool, config);
  console.log(
    `[FalloutAlerts] Found ${highRiskLoans.length} high-risk loans (minScore=${config.min_risk_score}, levels=${
      Array.isArray(config.include_risk_levels)
        ? config.include_risk_levels.join(",")
        : ""
    })`,
  );
  const { recipients: resolvedRecipients, skippedLoansCount } = await resolveLoanOfficerEmails(
    tenantPool,
    highRiskLoans,
    config.target_encompass_user_ids,
  );
  console.log(
    `[FalloutAlerts] Recipient resolution: ${resolvedRecipients.length} resolved, ${skippedLoansCount} skipped`,
  );

  const devMode = !isProductionEnv();
  const redirectActive = await isEmailRedirectEnabled();
  const devAllowedEmails = redirectActive ? await getDevAllowedEmails() : [];

  if (redirectActive && devAllowedEmails.length === 0) {
    console.warn(
      "[FalloutAlerts] EMAIL REDIRECT: Redirect is enabled but no safe email addresses configured. " +
      "Blocking all LO and manager emails to prevent sending to real users. " +
      "Only manual test recipients will be sent.",
    );
  }

  if (redirectActive && devAllowedEmails.length > 0) {
    let redirectIdx = 0;
    for (const recipient of resolvedRecipients) {
      const originalEmail = recipient.email;
      recipient.email = devAllowedEmails[redirectIdx % devAllowedEmails.length];
      recipient.fullName = `[REDIRECTED→${recipient.email}] ${recipient.fullName || originalEmail}`;
      redirectIdx++;
    }
    console.log(
      `[FalloutAlerts] EMAIL REDIRECT: Redirected ${resolvedRecipients.length} LO recipients to ${devAllowedEmails.join(", ")}`,
    );
  } else if (redirectActive) {
    resolvedRecipients.length = 0;
  }

  const manualTestRecipients = Array.from(
    new Set(
      (Array.isArray(testRecipientEmails) ? testRecipientEmails : [])
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ).map<ResolvedRecipient>((email, index) => ({
    encompassUserId: `manual-test-${index + 1}`,
    email,
    fullName: null,
    loans: highRiskLoans.map((loan) => ({
      loanId: loan.loan_id,
      loanNumber: loan.loan_number || loan.loan_id,
      loanOfficerName: loan.loan_officer || "Loan Officer",
      amount: loan.loan_amount,
      riskScore: loan.risk_score,
      riskLevel: loan.risk_level,
      predictedOutcome: loan.predicted_outcome,
      estimatedClosingDate: loan.estimated_closing_date,
      riskReasons: Array.isArray(loan.risk_factors) ? loan.risk_factors : [],
    })),
  }));
  const loRecipientEmailSet = new Set(
    resolvedRecipients.map((recipient) => recipient.email.trim().toLowerCase()),
  );
  const recipients = [
    ...resolvedRecipients,
    ...manualTestRecipients.filter(
      (recipient) => !loRecipientEmailSet.has(recipient.email.trim().toLowerCase()),
    ),
  ];
  const manualTestRecipientSet = new Set(
    manualTestRecipients.map((recipient) => recipient.email.trim().toLowerCase()),
  );
  const alertBatchId = crypto.randomUUID();
  const failedRecipients: Array<{ email: string; error: string }> = [];
  const template = (await loadEmailTemplate("fallout-alert.html")) ?? null;
  let sentCount = 0;
  const testRecipients = {
    attempted: manualTestRecipients.length,
    sent: 0,
    failed: [] as Array<{ email: string; error: string }>,
  };

  // Build set of app user emails to conditionally include app hyperlinks
  const allRecipientEmails = recipients.map((r) => r.email.trim().toLowerCase()).filter(Boolean);
  let appUserEmailSet = new Set<string>();
  if (allRecipientEmails.length > 0) {
    try {
      const appUsersResult = await tenantPool.query<{ email: string }>(
        `SELECT LOWER(email) AS email FROM public.users WHERE LOWER(email) = ANY($1::text[]) AND is_active = true`,
        [allRecipientEmails],
      );
      appUserEmailSet = new Set(appUsersResult.rows.map((r) => r.email));
    } catch {
      // Non-critical — default to no app links if lookup fails
    }
  }

  for (const recipient of recipients) {
    const tokenByLoanId = new Map<string, string>();
    for (const loan of recipient.loans) {
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      await tenantPool.query(
        `INSERT INTO public.fallout_alert_tokens
         (token_hash, alert_batch_id, loan_id, encompass_user_id, recipient_email, expires_at)
         VALUES ($1, $2, $3, $4, $5, NOW() + interval '7 days')`,
        [tokenHash, alertBatchId, loan.loanId, recipient.encompassUserId, recipient.email],
      );
      tokenByLoanId.set(loan.loanId, token);
    }

    const isAppUser = appUserEmailSet.has(recipient.email.trim().toLowerCase());
    const loansHtml = buildLoanRowsHtml(recipient, tokenByLoanId, appBaseUrl, tenantSlug, isAppUser);
    const customMessageHtml = config.custom_message
      ? `<p style="margin:0 0 20px 0;padding:12px 16px;background:#f0f9ff;border-left:3px solid #3b82f6;font-size:14px;color:#1e40af;line-height:1.5;border-radius:0 6px 6px 0;">${config.custom_message}</p>`
      : "";
    const placeholderData = {
      RECIPIENT_NAME: recipient.fullName || recipient.loans[0]?.loanOfficerName || "Loan Officer",
      LOAN_COUNT: String(recipient.loans.length),
      CUSTOM_MESSAGE: customMessageHtml,
      ALERT_DATE: new Date().toISOString().split("T")[0],
      LOANS_HTML: loansHtml,
    };

    const html = template
      ? replacePlaceholders(template, placeholderData)
      : `<p>You have ${placeholderData.LOAN_COUNT} high-risk loans.</p>${loansHtml}`;

    try {
      await sendEmail({
        to: recipient.email,
        subject: `Coheus Fallout Alert — ${recipient.loans.length} High-Risk Loan${recipient.loans.length === 1 ? "" : "s"}`,
        html,
        emailType: "fallout_alert_distribution",
        containsPii: true,
        tenantId,
        strict: true,
      });
      sentCount += 1;
      if (manualTestRecipientSet.has(recipient.email.trim().toLowerCase())) {
        testRecipients.sent += 1;
      }
      console.log(`✅ Fallout alert sent to ${recipient.email} (${recipient.loans.length} loans)`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to send fallout alert email";
      console.error(`❌ Fallout alert failed for ${recipient.email}: ${msg}`);
      failedRecipients.push({
        email: recipient.email,
        error: msg,
      });
      if (manualTestRecipientSet.has(recipient.email.trim().toLowerCase())) {
        testRecipients.failed.push({
          email: recipient.email,
          error: msg,
        });
      }
    }
  }

  const managerNotifications = { attempted: 0, sent: 0, failed: [] as Array<{ email: string; error: string }> };
  const managerCardNotifications = {
    attempted: 0,
    sent: 0,
    failed: [] as Array<{ email: string; error: string }>,
    loanCount: 0,
  };

  if (config.notify_managers) {
    const selectedManagerIds = Array.isArray(config.manager_user_ids)
      ? config.manager_user_ids.filter(Boolean)
      : [];
    const managerQuery =
      selectedManagerIds.length > 0
        ? `SELECT id, email, COALESCE(full_name, email) AS full_name
           FROM public.users
           WHERE id = ANY($1::uuid[])
             AND email IS NOT NULL
             AND is_active = true`
        : `SELECT id, email, COALESCE(full_name, email) AS full_name
           FROM public.users
           WHERE role = 'tenant_admin'
             AND email IS NOT NULL
             AND is_active = true`;
    const managerParams = selectedManagerIds.length > 0 ? [selectedManagerIds] : [];
    const managers = await tenantPool.query<{ id: string; email: string; full_name: string | null }>(
      managerQuery,
      managerParams,
    );
    if (redirectActive) {
      if (devAllowedEmails.length > 0) {
        let mgrIdx = 0;
        for (const mgr of managers.rows) {
          const original = mgr.email;
          mgr.email = devAllowedEmails[mgrIdx % devAllowedEmails.length];
          mgr.full_name = `[REDIRECTED→${mgr.email}] ${mgr.full_name || original}`;
          mgrIdx++;
        }
        console.log(
          `[FalloutAlerts] EMAIL REDIRECT: Redirected ${managers.rows.length} manager emails to ${devAllowedEmails.join(", ")}`,
        );
      } else {
        managers.rows.length = 0;
        console.warn("[FalloutAlerts] EMAIL REDIRECT: Blocked manager emails (no safe email addresses configured)");
      }
    }
    managerNotifications.attempted = managers.rows.length;
    console.log(
      `📧 Manager notification: ${managers.rows.length} managers found (selectedIds=${selectedManagerIds.length}, highRiskLoans=${highRiskLoans.length})`,
    );

    const summaryBody = buildManagerSummaryHtml({
      alertBatchId,
      highRiskLoans,
      sentCount,
      recipientsCount: recipients.length,
      skippedLoansCount,
      minRiskScore: Number(config.min_risk_score || 75),
      includeLevels: Array.isArray(config.include_risk_levels) ? config.include_risk_levels : [],
      appBaseUrl,
    });

    const dateStr = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const subjectLine = highRiskLoans.length > 0
      ? `Coheus Fallout Report — ${highRiskLoans.length} High-Risk Loans`
      : "Coheus Fallout Report — No High-Risk Loans";

    for (const manager of managers.rows) {
      const greeting = manager.full_name || "Manager";
      const introText = highRiskLoans.length > 0
        ? `This is your Coheus Closing Fallout Report. Our model has identified <strong>${highRiskLoans.length} active loan${highRiskLoans.length === 1 ? "" : "s"}</strong> at elevated risk of fallout across <strong>${new Map(highRiskLoans.map((l) => [l.loan_officer_id || l.loan_officer || "?", true])).size} loan officer${new Map(highRiskLoans.map((l) => [l.loan_officer_id || l.loan_officer || "?", true])).size === 1 ? "" : "s"}</strong>. Below is the full breakdown — click any loan number to view it directly in Coheus.`
        : "This is your Coheus Closing Fallout Report. No active loans currently meet the configured risk threshold. You can adjust the minimum risk score and risk levels in the Fallout Alert settings on the dashboard.";

      const managerHtml = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"></head>
        <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#334155;margin:0;padding:0;background:#f1f5f9;">
          <div style="max-width:720px;margin:24px auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
            <div style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);color:white;padding:28px 30px;">
              <table style="width:100%;border-collapse:collapse;">
                <tr>
                  <td>
                    <h1 style="margin:0;font-weight:600;font-size:22px;letter-spacing:-0.3px;">Coheus Fallout Report</h1>
                    <p style="margin:6px 0 0;opacity:0.85;font-size:14px;">${dateStr}</p>
                  </td>
                  <td style="text-align:right;vertical-align:middle;">
                    ${highRiskLoans.length > 0 ? `<span style="display:inline-block;padding:6px 14px;background:rgba(255,255,255,0.2);border-radius:20px;font-size:14px;font-weight:600;">${highRiskLoans.length} Loan${highRiskLoans.length === 1 ? "" : "s"} at Risk</span>` : `<span style="display:inline-block;padding:6px 14px;background:rgba(34,197,94,0.3);border-radius:20px;font-size:14px;font-weight:600;">All Clear</span>`}
                  </td>
                </tr>
              </table>
            </div>
            <div style="padding:24px 30px;">
              <p style="margin-top:0;">Hi ${greeting},</p>
              <p style="color:#475569;font-size:14px;line-height:1.7;">${introText}</p>
              ${summaryBody}
            </div>
            <div style="background:#f8fafc;padding:16px 30px;text-align:center;color:#64748b;font-size:12px;border-top:1px solid #e2e8f0;">
              Coheus &bull; Closing Fallout Intelligence &bull; <a href="${appBaseUrl.replace(/\/+$/, "")}/fallout-forecast" style="color:#3b82f6;text-decoration:none;">Open Dashboard</a>
            </div>
          </div>
        </body>
        </html>`;

      try {
        await sendEmail({
          to: manager.email,
          subject: subjectLine,
          html: managerHtml,
          emailType: "fallout_alert_manager_summary",
          containsPii: true,
          tenantId,
          strict: true,
        });
        managerNotifications.sent += 1;
        console.log(`✅ Manager summary sent to ${manager.email}`);
      } catch (mgrErr: unknown) {
        const msg = mgrErr instanceof Error ? mgrErr.message : "Failed to send manager summary";
        console.error(`❌ Manager summary failed for ${manager.email}: ${msg}`);
        managerNotifications.failed.push({ email: manager.email, error: msg });
      }
    }
  }

  if (managerCardDelivery?.enabled) {
    const selectedManagerIds = Array.isArray(config.manager_user_ids)
      ? config.manager_user_ids.filter(Boolean)
      : [];
    const managerQuery =
      selectedManagerIds.length > 0
        ? `SELECT id, email, COALESCE(full_name, email) AS full_name
           FROM public.users
           WHERE id = ANY($1::uuid[])
             AND email IS NOT NULL
             AND is_active = true`
        : `SELECT id, email, COALESCE(full_name, email) AS full_name
           FROM public.users
           WHERE role = 'tenant_admin'
             AND email IS NOT NULL
             AND is_active = true`;
    const managerParams = selectedManagerIds.length > 0 ? [selectedManagerIds] : [];
    const managers = await tenantPool.query<{ id: string; email: string; full_name: string | null }>(
      managerQuery,
      managerParams,
    );
    if (redirectActive) {
      if (devAllowedEmails.length > 0) {
        let mgrCardIdx = 0;
        for (const mgr of managers.rows) {
          const original = mgr.email;
          mgr.email = devAllowedEmails[mgrCardIdx % devAllowedEmails.length];
          mgr.full_name = `[REDIRECTED→${mgr.email}] ${mgr.full_name || original}`;
          mgrCardIdx++;
        }
        console.log(
          `[FalloutAlerts] EMAIL REDIRECT: Redirected ${managers.rows.length} manager card emails to ${devAllowedEmails.join(", ")}`,
        );
      } else {
        managers.rows.length = 0;
        console.warn("[FalloutAlerts] EMAIL REDIRECT: Blocked manager card emails (no safe email addresses configured)");
      }
    }
    managerCardNotifications.attempted = managers.rows.length;

    const branchFilterSet = new Set(
      (Array.isArray(managerCardDelivery.branchFilters) ? managerCardDelivery.branchFilters : [])
        .map((value) => value.trim())
        .filter(Boolean),
    );
    const targetSet = new Set(
      Array.isArray(config.target_encompass_user_ids) ? config.target_encompass_user_ids.filter(Boolean) : [],
    );
    const scopeToTargetLos = managerCardDelivery.scopeToTargetLos !== false;
    const scopedLoans = highRiskLoans.filter((loan) => {
      if (scopeToTargetLos && targetSet.size > 0) {
        if (!loan.loan_officer_id || !targetSet.has(loan.loan_officer_id)) return false;
      }
      if (branchFilterSet.size > 0) {
        const branch = (loan.branch || "").trim();
        if (!branch || !branchFilterSet.has(branch)) return false;
      }
      return true;
    });
    managerCardNotifications.loanCount = scopedLoans.length;
    const cardsHtml = buildManagerLoanCardsHtml({ loans: scopedLoans, appBaseUrl });

    for (const manager of managers.rows) {
      const greeting = manager.full_name || "Manager";
      const html = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"></head>
        <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#334155;margin:0;padding:0;background:#f1f5f9;">
          <div style="max-width:720px;margin:24px auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
            <div style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);color:white;padding:22px 24px;">
              <h1 style="margin:0;font-weight:600;font-size:20px;">Coheus Fallout Cards</h1>
              <p style="margin:6px 0 0;opacity:0.9;font-size:13px;">
                Scoped cards for selected loan officer and branch filters.
              </p>
            </div>
            <div style="padding:20px 24px;">
              <p style="margin-top:0;">Hi ${greeting},</p>
              ${cardsHtml}
            </div>
          </div>
        </body>
        </html>`;

      try {
        await sendEmail({
          to: manager.email,
          subject: scopedLoans.length > 0
            ? `Coheus Fallout Cards — ${scopedLoans.length} High-Risk Loans`
            : "Coheus Fallout Cards — No Matching Loans",
          html,
          emailType: "fallout_alert_manager_summary",
          containsPii: true,
          tenantId,
          strict: true,
        });
        managerCardNotifications.sent += 1;
      } catch (mgrErr: unknown) {
        const msg = mgrErr instanceof Error ? mgrErr.message : "Failed to send manager cards";
        managerCardNotifications.failed.push({ email: manager.email, error: msg });
      }
    }
  }

  return {
    alertBatchId,
    recipientsCount: recipients.length,
    sentCount,
    failedRecipients,
    skippedLoansCount,
    highRiskLoanCount: highRiskLoans.length,
    devMode: redirectActive,
    devRedirectedTo: redirectActive && devAllowedEmails.length > 0 ? devAllowedEmails : undefined,
    testRecipients,
    managerNotifications,
    managerCardNotifications,
  };
}

/**
 * Send a fallout alert email for a single loan.
 * Resolves the LO via encompass_users, applies email redirect safeguards, and sends using the standard template.
 */
export async function sendSingleFalloutAlert({
  tenantPool,
  tenantId,
  tenantSlug,
  loanId,
  appBaseUrl,
}: {
  tenantPool: Pool;
  tenantId: string;
  tenantSlug: string;
  loanId: string;
  appBaseUrl: string;
}): Promise<{ sent: boolean; recipientEmail: string | null; message: string; devMode: boolean; devRedirectedTo?: string[] }> {
  const loanResult = await tenantPool.query<RiskLoanRow>(
    `SELECT
       l.loan_id,
       l.loan_number,
       l.branch,
       l.loan_amount,
       COALESCE(NULLIF(TRIM(l.loan_officer), ''), eu.full_name) AS loan_officer,
       l.loan_officer_id,
       l.estimated_closing_date,
       COALESCE(p.risk_score, 0)::float AS risk_score,
       COALESCE(p.risk_level, 'Unknown') AS risk_level,
       COALESCE(p.predicted_outcome, 'originate') AS predicted_outcome,
       p.risk_factors
     FROM public.loans l
     LEFT JOIN public.loan_predictions p ON p.loan_id = l.loan_id
     LEFT JOIN public.encompass_users eu ON eu.encompass_user_id = l.loan_officer_id
     WHERE l.loan_id = $1
     LIMIT 1`,
    [loanId],
  );

  const loan = loanResult.rows[0];
  if (!loan) {
    return { sent: false, recipientEmail: null, message: `Loan ${loanId} not found.`, devMode: false };
  }

  const loResult = await tenantPool.query<{
    encompass_user_id: string;
    email: string;
    full_name: string | null;
  }>(
    `SELECT encompass_user_id, email, full_name
     FROM public.encompass_users
     WHERE is_enabled = true
       AND email IS NOT NULL
       AND (
         encompass_user_id = $1
         OR LOWER(full_name) = LOWER($2)
       )
     LIMIT 1`,
    [loan.loan_officer_id ?? "", loan.loan_officer ?? ""],
  );

  const loUser = loResult.rows[0];
  if (!loUser?.email) {
    return {
      sent: false,
      recipientEmail: null,
      message: `No matching LO email found for loan ${loan.loan_number || loanId}.`,
      devMode: false,
    };
  }

  const redirectActive = await isEmailRedirectEnabled();
  const devAllowedEmails = redirectActive ? await getDevAllowedEmails() : [];

  let recipientEmail = loUser.email;
  let recipientName = loUser.full_name || loan.loan_officer || "Loan Officer";
  let devMode = redirectActive;

  if (redirectActive) {
    if (devAllowedEmails.length === 0) {
      return {
        sent: false,
        recipientEmail: loUser.email,
        message: "Email redirect is active but no safe email addresses configured. Email blocked.",
        devMode: true,
      };
    }
    recipientEmail = devAllowedEmails[0];
    recipientName = `[REDIRECTED→${recipientEmail}] ${recipientName}`;
  }

  const config = await getFalloutAlertConfig(tenantPool);
  const alertBatchId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  await tenantPool.query(
    `INSERT INTO public.fallout_alert_tokens
     (token_hash, alert_batch_id, loan_id, encompass_user_id, recipient_email, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + interval '7 days')`,
    [tokenHash, alertBatchId, loanId, loUser.encompass_user_id, recipientEmail],
  );

  const recipient: ResolvedRecipient = {
    encompassUserId: loUser.encompass_user_id,
    email: recipientEmail,
    fullName: recipientName,
    loans: [{
      loanId: loan.loan_id,
      loanNumber: loan.loan_number || loan.loan_id,
      loanOfficerName: loan.loan_officer || loUser.full_name || "Loan Officer",
      amount: loan.loan_amount,
      riskScore: Number(loan.risk_score) || 0,
      riskLevel: loan.risk_level || "Unknown",
      predictedOutcome: (loan.predicted_outcome as "withdraw" | "deny" | "originate") || "originate",
      estimatedClosingDate: loan.estimated_closing_date,
      riskReasons: Array.isArray(loan.risk_factors) ? loan.risk_factors : [],
    }],
  };

  const tokenByLoanId = new Map([[loanId, token]]);
  const template = (await loadEmailTemplate("fallout-alert.html")) ?? null;

  // Check if recipient is an app user to conditionally include app hyperlinks
  let isAppUser = false;
  try {
    const appUserCheck = await tenantPool.query<{ email: string }>(
      `SELECT LOWER(email) AS email FROM public.users WHERE LOWER(email) = $1 AND is_active = true LIMIT 1`,
      [loUser.email.trim().toLowerCase()],
    );
    isAppUser = appUserCheck.rows.length > 0;
  } catch {
    // Non-critical
  }

  const loansHtml = buildLoanRowsHtml(recipient, tokenByLoanId, appBaseUrl, tenantSlug, isAppUser);
  const customMessageHtml = config?.custom_message
    ? `<p style="margin:0 0 20px 0;padding:12px 16px;background:#f0f9ff;border-left:3px solid #3b82f6;font-size:14px;color:#1e40af;line-height:1.5;border-radius:0 6px 6px 0;">${config.custom_message}</p>`
    : "";
  const placeholderData = {
    RECIPIENT_NAME: recipientName,
    LOAN_COUNT: "1",
    CUSTOM_MESSAGE: customMessageHtml,
    ALERT_DATE: new Date().toISOString().split("T")[0],
    LOANS_HTML: loansHtml,
  };
  const html = template
    ? replacePlaceholders(template, placeholderData)
    : `<p>You have a high-risk loan requiring attention.</p>${loansHtml}`;

  await sendEmail({
    to: recipientEmail,
    subject: `Coheus Fallout Alert — Loan ${loan.loan_number || loanId}`,
    html,
    emailType: "fallout_alert_distribution",
    containsPii: true,
    tenantId,
    strict: true,
  });

  return {
    sent: true,
    recipientEmail,
    message: devMode
      ? `Email sent (redirected to ${recipientEmail})`
      : `Fallout alert sent to ${recipientEmail}`,
    devMode,
    devRedirectedTo: devMode && devAllowedEmails.length > 0 ? devAllowedEmails : undefined,
  };
}

export async function saveFalloutTokenResponse({
  tenantPool,
  token,
  action,
  responseNote,
  ipAddress,
  userAgent,
}: {
  tenantPool: Pool;
  token: string;
  action: FalloutAlertResponseType;
  responseNote?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<{ status: "ok"; alreadyResponded: boolean } | { status: "invalid" | "expired" }> {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const lookup = await tenantPool.query<{
    id: string;
    alert_batch_id: string;
    loan_id: string;
    encompass_user_id: string;
    recipient_email: string | null;
    expires_at: string;
    responded_at: string | null;
  }>(
    `SELECT id, alert_batch_id, loan_id, encompass_user_id, recipient_email, expires_at, responded_at
     FROM public.fallout_alert_tokens
     WHERE token_hash = $1
     LIMIT 1`,
    [tokenHash],
  );

  const row = lookup.rows[0];
  if (!row) return { status: "invalid" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { status: "expired" };
  const alreadyResponded = Boolean(row.responded_at);

  await tenantPool.query(
    `UPDATE public.fallout_alert_tokens
     SET response = $2, response_note = $3, responded_at = NOW()
     WHERE id = $1`,
    [row.id, action, responseNote ?? null],
  );

  await tenantPool.query(
    `INSERT INTO public.fallout_alert_responses
     (token_id, alert_batch_id, loan_id, encompass_user_id, recipient_email, response, response_note, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (token_id) DO UPDATE SET
       response = EXCLUDED.response,
       response_note = EXCLUDED.response_note,
       ip_address = EXCLUDED.ip_address,
       user_agent = EXCLUDED.user_agent,
       responded_at = NOW()`,
    [
      row.id,
      row.alert_batch_id,
      row.loan_id,
      row.encompass_user_id,
      row.recipient_email,
      action,
      responseNote ?? null,
      ipAddress ?? null,
      userAgent ?? null,
    ],
  );

  return { status: "ok", alreadyResponded };
}
