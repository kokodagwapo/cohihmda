/**
 * Loans API Routes
 * Provides endpoints for querying loan data from the database
 *
 * =============================================================================
 * BACKEND ROUTES CONSOLIDATION NOTICE
 * =============================================================================
 * Several endpoints have been migrated to dedicated route files:
 *
 * SCORECARD ENDPOINTS (use /api/scorecard/* instead):
 *   /api/loans/sales-scorecard -> /api/scorecard/sales
 *   /api/loans/operations-scorecard -> /api/scorecard/operations
 *   /api/loans/operations-scorecard-trends -> /api/scorecard/operations-trends
 *   /api/loans/sales-trends -> /api/scorecard/sales-trends
 *   /api/loans/sales-trends/drilldown/:loName -> /api/scorecard/sales-trends/drilldown/:loName
 *
 * TOPTIERING ENDPOINTS (use /api/toptiering/* instead):
 *   /api/loans/toptiering -> /api/toptiering
 *   /api/loans/toptiering-comparison -> /api/toptiering/comparison
 *
 * PREDICTIONS ENDPOINTS (use /api/predictions/* instead):
 *   /api/loans/predict -> /api/predictions (POST)
 *   /api/loans/predict/status -> /api/predictions/status
 *   /api/loans/predictions -> /api/predictions (GET)
 *   /api/loans/:loanId/recommendations -> /api/predictions/:loanId/recommendations
 *
 * The old endpoints below are kept for backward compatibility but should be
 * considered DEPRECATED. Frontend hooks have been updated to use the new routes.
 * =============================================================================
 */

import { Router } from "express";
import fs from "fs";
import { pool, retryQuery, handleDatabaseError } from "../config/database.js";
import { authenticateToken, AuthRequest } from "../middleware/auth.js";
import {
  attachTenantContext,
  getTenantContext,
} from "../middleware/tenantContext.js";
import { apiLimiter } from "../middleware/rateLimiter.js";
import { logError, logWarn, logInfo, logDebug } from "../services/logger.js";
import {
  getLoanAccessContext,
  getUserLoanAccessFilter,
  type LoanAccessContext,
} from "../services/userLoanAccessService.js";
import { sendLoanCardEmail } from "../services/emailService.js";
import {
  isActorMissing,
  filterByChannel,
  buildChannelWhereClause,
  buildChannelGroupCaseExpr,
  buildActorNotMissingClause,
  calcLoanRevenue,
  calcLoanComplexity,
  type LoanComplexityData,
  getVMaxDate,
  formatDateForSQL,
  formatMonthKey,
  assignTTSTier,
  OPERATIONS_ACTOR_CONFIGS,
  SALES_ACTOR_CONFIGS,
  REVENUE_SQL_EXPRESSION,
  buildDimensionFilterWhereClause,
  type ActorConfig,
  type ActorMissingMode,
} from "../utils/scorecard-utils.js";
import { getStaffingUnitTargets } from "../utils/staffingUnitTargets.js";

// Helper function to calculate days between dates
function daysBetween(
  date1: Date | string | null,
  date2: Date | string | null,
): number | null {
  if (!date1 || !date2) return null;
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return null;
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

/** Map a loan row to LoanComplexityData for calcLoanComplexity. */
function toLoanComplexityData(l: any): LoanComplexityData {
  return {
    loan_type: l.loan_type,
    loan_purpose: l.loan_purpose,
    loan_amount:
      l.loan_amount != null && l.loan_amount !== ""
        ? parseFloat(l.loan_amount)
        : undefined,
    fico_score:
      l.fico_score != null && l.fico_score !== ""
        ? parseInt(String(l.fico_score), 10)
        : undefined,
    ltv_ratio:
      l.ltv_ratio != null && l.ltv_ratio !== ""
        ? parseFloat(l.ltv_ratio)
        : undefined,
    be_dti_ratio:
      l.be_dti_ratio != null && l.be_dti_ratio !== ""
        ? parseFloat(l.be_dti_ratio)
        : undefined,
    occupancy_type: l.occupancy_type,
    borr_self_employed: l.borr_self_employed,
    non_qm: l.non_qm,
  };
}

/**
 * Helper to add deprecation headers to response.
 * Sets standard deprecation headers per RFC 8594.
 * @param res - Express response object
 * @param newEndpoint - The new endpoint to use instead
 */
function addDeprecationHeaders(res: any, newEndpoint: string): void {
  res.setHeader("Deprecation", "true");
  res.setHeader("Sunset", "2026-06-01");
  res.setHeader("Link", `<${newEndpoint}>; rel="successor-version"`);
  logWarn(`Deprecated endpoint called. Use ${newEndpoint} instead.`);
}

const router = Router();

/**
 * GET /api/loans/schema
 * Get the schema/columns of the loans table for dynamic table rendering
 */
router.get(
  "/schema",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantPool = getTenantContext(req).tenantPool;

      // Get column information from information_schema
      const result = await tenantPool.query(`
      SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'loans'
      ORDER BY ordinal_position
    `);

      // Map to friendly column info
      const columns = result.rows.map((col) => ({
        name: col.column_name,
        type: col.data_type,
        nullable: col.is_nullable === "YES",
        // Generate a display name from column_name
        displayName: col.column_name
          .replace(/_/g, " ")
          .replace(/\b\w/g, (l: string) => l.toUpperCase()),
        // Categorize columns for UI grouping
        category: categorizeColumn(col.column_name),
      }));

      res.json({ columns });
    } catch (error: any) {
      logError("Error fetching loans schema", error, { userId: req.userId });
      res
        .status(500)
        .json({ error: error.message || "Failed to fetch loans schema" });
    }
  },
);

/**
 * POST /api/loans/email-card
 * Send loan card as email with inline image
 * Body: { to: string, loanId: string, officerName?: string, imageBase64: string }
 */
router.post(
  "/email-card",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { to, loanId, officerName, imageBase64 } = req.body;
      if (!to || typeof to !== "string" || !to.trim()) {
        return res
          .status(400)
          .json({ error: "Recipient email (to) is required" });
      }
      if (!loanId || typeof loanId !== "string" || !loanId.trim()) {
        return res.status(400).json({ error: "Loan ID is required" });
      }
      if (!imageBase64 || typeof imageBase64 !== "string") {
        return res
          .status(400)
          .json({ error: "Image data (imageBase64) is required" });
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(to.trim())) {
        return res
          .status(400)
          .json({ error: "Invalid recipient email address" });
      }
      const subject = `Loan Update: ${loanId}${officerName ? ` - ${officerName}` : ""}`;
      await sendLoanCardEmail(
        to.trim(),
        subject,
        loanId,
        officerName || "",
        imageBase64,
      );
      res.json({ success: true, message: "Email sent" });
    } catch (error: any) {
      logError("Error sending loan card email", error, { userId: req.userId });
      res.status(500).json({ error: error.message || "Failed to send email" });
    }
  },
);

// Helper function to categorize columns
function categorizeColumn(columnName: string): string {
  if (["id", "loan_id", "loan_number", "guid"].includes(columnName))
    return "identifier";
  if (columnName.includes("date") || columnName.includes("_at")) return "date";
  if (
    columnName.includes("amount") ||
    columnName.includes("rate") ||
    columnName.includes("ltv") ||
    columnName.includes("dti") ||
    columnName.includes("price") ||
    columnName.includes("value") ||
    columnName.includes("fee") ||
    columnName.includes("income") ||
    columnName.includes("assets")
  )
    return "financial";
  if (
    columnName.includes("property") ||
    columnName.includes("county") ||
    columnName.includes("state") ||
    columnName.includes("city") ||
    columnName.includes("zip") ||
    columnName.includes("street")
  )
    return "property";
  if (
    columnName.includes("borrower") ||
    columnName.includes("borr_") ||
    columnName.includes("co_borr")
  )
    return "borrower";
  if (
    columnName.includes("officer") ||
    columnName.includes("processor") ||
    columnName.includes("underwriter") ||
    columnName.includes("closer")
  )
    return "team";
  if (columnName.includes("status") || columnName.includes("milestone"))
    return "status";
  if (
    columnName.includes("loan_type") ||
    columnName.includes("loan_purpose") ||
    columnName.includes("loan_program") ||
    columnName.includes("product")
  )
    return "loan_details";
  if (
    columnName.includes("branch") ||
    columnName.includes("channel") ||
    columnName.includes("investor") ||
    columnName.includes("nmls")
  )
    return "organization";
  return "other";
}

/**
 * GET /api/loans/distinct-values/:column
 * Get distinct values for a specific column (for filter dropdowns).
 *
 * Optional query params for cascading filters:
 *   ?filterBy=<column>&filterValue=<value>
 * Example: /distinct-values/loan_officer?filterBy=branch&filterValue=Downtown
 * Returns only loan officers that belong to the "Downtown" branch.
 */
router.get(
  "/distinct-values/:column",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantPool = getTenantContext(req).tenantPool;
      const column = req.params.column as string;

      // Whitelist of columns that can be queried for distinct values (prevent SQL injection)
      const allowedColumns = [
        "current_loan_status",
        "loan_type",
        "loan_purpose",
        "loan_program",
        "product_type",
        "property_state",
        "property_city",
        "property_county",
        "property_type",
        "occupancy_type",
        "branch",
        "channel",
        "investor",
        "loan_officer",
        "processor",
        "underwriter",
        "closer",
        "lien_position",
        "refinance_cash_out_type",
        "atr_loan_type",
        "qm_loan_type",
      ];

      if (!allowedColumns.includes(column)) {
        return res
          .status(400)
          .json({ error: "Invalid column for distinct values query" });
      }

      // Optional cascading filter: narrow results by another column's value
      const filterBy = req.query.filterBy as string | undefined;
      const filterValue = req.query.filterValue as string | undefined;

      let query: string;
      let params: string[];

      if (filterBy && filterValue && allowedColumns.includes(filterBy)) {
        // Cascading: e.g. loan_officer WHERE branch = $1
        query = `SELECT DISTINCT ${column} as value FROM public.loans WHERE ${column} IS NOT NULL AND ${column} != '' AND ${filterBy} = $1 ORDER BY ${column} LIMIT 100`;
        params = [filterValue];
      } else {
        query = `SELECT DISTINCT ${column} as value FROM public.loans WHERE ${column} IS NOT NULL AND ${column} != '' ORDER BY ${column} LIMIT 100`;
        params = [];
      }

      const result = await tenantPool.query(query, params);

      res.json({ values: result.rows.map((r) => r.value) });
    } catch (error: any) {
      logError("Error fetching distinct values", error, {
        userId: req.userId,
        column: req.params.column,
      });
      res
        .status(500)
        .json({ error: error.message || "Failed to fetch distinct values" });
    }
  },
);

/**
 * GET /api/loans/channels
 * Get distinct channel values with counts for channel selector dropdown
 * Returns both the raw channel values and consolidated channel groups
 *
 * Channel Grouping Logic (derived from actual data patterns):
 * - "Retail" group: channels containing "retail" (direct origination by company LOs)
 * - "TPO" group: channels containing "broker", "wholesale", "correspondent", "tpo" (third-party origination)
 * - Individual channels shown as-is when not matching known patterns
 * - "99-Missing" for loans with null/empty channels (Qlik convention)
 */
router.get(
  "/channels",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantPool = getTenantContext(req).tenantPool;

      // Get distinct channels with counts from actual data
      // Channel grouping: TPO requires BOTH a TPO channel pattern AND populated account_executive.
      // Loans with a TPO channel but no AE are classified as Retail (brokered-retail).
      const channelGroupExpr = buildChannelGroupCaseExpr();
      const result = await tenantPool.query(`
      SELECT 
        COALESCE(NULLIF(TRIM(channel), ''), '99-Missing') as channel,
        COUNT(*) as loan_count,
        ${channelGroupExpr} as channel_group
      FROM public.loans 
      GROUP BY 
        COALESCE(NULLIF(TRIM(channel), ''), '99-Missing'),
        ${channelGroupExpr}
      ORDER BY 
        CASE WHEN COALESCE(NULLIF(TRIM(channel), ''), '99-Missing') = '99-Missing' THEN 1 ELSE 0 END,
        COUNT(*) DESC
    `);

      // Get consolidated groups with totals
      const groupResult = await tenantPool.query(`
      SELECT * FROM (
        SELECT 
          ${channelGroupExpr} as channel_group,
          COUNT(*) as loan_count
        FROM public.loans 
        GROUP BY 1
      ) grouped
      WHERE loan_count > 0
      ORDER BY 
        CASE channel_group
          WHEN 'Retail' THEN 1
          WHEN 'TPO' THEN 2
          WHEN '99-Missing' THEN 98
          WHEN 'Other' THEN 99
          ELSE 50
        END,
        loan_count DESC
    `);

      res.json({
        channels: result.rows.map((r) => ({
          channel: r.channel,
          channelGroup: r.channel_group,
          loanCount: parseInt(r.loan_count),
        })),
        channelGroups: groupResult.rows.map((r) => ({
          group: r.channel_group,
          loanCount: parseInt(r.loan_count),
        })),
      });
    } catch (error: any) {
      logError("Error fetching channels", error, { userId: req.userId });
      res
        .status(500)
        .json({ error: error.message || "Failed to fetch channels" });
    }
  },
);

/**
 * GET /api/loans
 * Get loans for authenticated tenant with optional filters
 * Uses tenant-specific database (no tenant_id in WHERE clause)
 * Applies user-level loan access filtering based on role and Encompass mapping
 */
router.get(
  "/",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantPool = getTenantContext(req).tenantPool;

      // Parse query parameters
      const {
        limit = "50",
        offset = "0",
        sort_by = "created_at",
        sort_order = "desc",
        search,
        ...filterParams
      } = req.query;

      // Build WHERE clause dynamically
      const conditions: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      // Apply user-level loan access filter (based on role and encompass_user_id mapping)
      if (req.userId) {
        const accessFilter = await getUserLoanAccessFilter(
          req.userId,
          tenantPool,
          {
            loanTableAlias: "", // No alias for simple queries
            startParamIndex: paramIndex,
          },
        );

        if (accessFilter) {
          if (accessFilter.sql === "FALSE") {
            // User has no loan access - return empty result
            logDebug(
              "[Loans] User has no loan access, returning empty result",
              { userId: req.userId },
            );
            return res.json({
              loans: [],
              total: 0,
              limit: parseInt(limit as string),
              offset: parseInt(offset as string),
            });
          }
          conditions.push(accessFilter.sql);
          params.push(...accessFilter.params);
          paramIndex += accessFilter.paramOffset;
          logDebug("[Loans] Applied user loan access filter", {
            userId: req.userId,
            filter: accessFilter.sql,
          });
        }
      }

      // Exclude archived loans by default
      conditions.push("(is_archived IS DISTINCT FROM TRUE)");

      // Handle search across multiple fields
      if (search && typeof search === "string" && search.trim()) {
        const searchTerm = `%${search.trim().toLowerCase()}%`;
        conditions.push(`(
        LOWER(COALESCE(loan_id, '')) LIKE $${paramIndex} OR
        LOWER(COALESCE(loan_number, '')) LIKE $${paramIndex} OR
        LOWER(COALESCE(current_loan_status, '')) LIKE $${paramIndex} OR
        LOWER(COALESCE(loan_type, '')) LIKE $${paramIndex} OR
        LOWER(COALESCE(loan_officer, '')) LIKE $${paramIndex} OR
        LOWER(COALESCE(branch, '')) LIKE $${paramIndex} OR
        LOWER(COALESCE(property_city, '')) LIKE $${paramIndex} OR
        LOWER(COALESCE(property_state, '')) LIKE $${paramIndex}
      )`);
        params.push(searchTerm);
        paramIndex++;
      }

      // Handle specific column filters
      const filterableColumns = [
        "current_loan_status",
        "loan_type",
        "loan_purpose",
        "loan_program",
        "product_type",
        "property_state",
        "property_city",
        "property_county",
        "property_type",
        "occupancy_type",
        "branch",
        "channel",
        "investor",
        "loan_officer",
        "processor",
        "underwriter",
        "closer",
        "lien_position",
        "refinance_cash_out_type",
      ];

      for (const [key, value] of Object.entries(filterParams)) {
        if (
          filterableColumns.includes(key) &&
          value &&
          typeof value === "string"
        ) {
          conditions.push(`${key} = $${paramIndex}`);
          params.push(value);
          paramIndex++;
        }
      }

      // Handle date range filters with configurable date field
      // date_field: which date column to filter on (default: started_date, fallback to application_date, then created_at)
      const allowedDateFields = [
        "started_date",
        "application_date",
        "closing_date",
        "funding_date",
        "lock_date",
        "credit_pull_date",
        "approval_date",
        "created_at",
      ];
      const dateField =
        filterParams.date_field &&
        allowedDateFields.includes(filterParams.date_field as string)
          ? (filterParams.date_field as string)
          : "started_date"; // Default to started_date

      if (
        filterParams.start_date &&
        typeof filterParams.start_date === "string"
      ) {
        // Use COALESCE to handle nulls - try the selected field, then fall back to created_at
        conditions.push(`COALESCE(${dateField}, created_at) >= $${paramIndex}`);
        params.push(filterParams.start_date);
        paramIndex++;
      }
      if (filterParams.end_date && typeof filterParams.end_date === "string") {
        conditions.push(`COALESCE(${dateField}, created_at) <= $${paramIndex}`);
        params.push(filterParams.end_date);
        paramIndex++;
      }

      // Handle amount range filters
      if (
        filterParams.min_amount &&
        typeof filterParams.min_amount === "string"
      ) {
        conditions.push(`loan_amount >= $${paramIndex}`);
        params.push(parseFloat(filterParams.min_amount));
        paramIndex++;
      }
      if (
        filterParams.max_amount &&
        typeof filterParams.max_amount === "string"
      ) {
        conditions.push(`loan_amount <= $${paramIndex}`);
        params.push(parseFloat(filterParams.max_amount));
        paramIndex++;
      }

      // Handle null/empty field filters
      // null_fields: comma-separated list of columns that should be NULL/empty
      // not_null_fields: comma-separated list of columns that should NOT be NULL/empty
      const nullableColumns = [
        "started_date",
        "application_date",
        "closing_date",
        "funding_date",
        "lock_date",
        "credit_pull_date",
        "approval_date",
        "ctc_date",
        "docs_out_date",
        "docs_signing_date",
        "loan_officer",
        "processor",
        "underwriter",
        "closer",
        "fico_score",
        "interest_rate",
        "loan_amount",
        "property_state",
        "property_city",
        "branch",
      ];

      if (
        filterParams.null_fields &&
        typeof filterParams.null_fields === "string"
      ) {
        const nullFields = filterParams.null_fields
          .split(",")
          .filter((f) => nullableColumns.includes(f.trim()));
        nullFields.forEach((field) => {
          conditions.push(
            `(${field.trim()} IS NULL OR ${field.trim()}::text = '')`,
          );
        });
      }

      if (
        filterParams.not_null_fields &&
        typeof filterParams.not_null_fields === "string"
      ) {
        const notNullFields = filterParams.not_null_fields
          .split(",")
          .filter((f) => nullableColumns.includes(f.trim()));
        notNullFields.forEach((field) => {
          conditions.push(
            `(${field.trim()} IS NOT NULL AND ${field.trim()}::text != '')`,
          );
        });
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      // Validate sort column (prevent SQL injection)
      const allowedSortColumns = [
        "loan_id",
        "loan_number",
        "loan_amount",
        "current_loan_status",
        "loan_type",
        "application_date",
        "closing_date",
        "funding_date",
        "lock_date",
        "created_at",
        "property_state",
        "property_city",
        "branch",
        "loan_officer",
        "interest_rate",
      ];
      const sortColumn = allowedSortColumns.includes(sort_by as string)
        ? sort_by
        : "created_at";
      const sortDirection = sort_order === "asc" ? "ASC" : "DESC";

      // Execute main query - select only the columns needed for list views
      // Note: raw_data column has been removed from the schema (migration 009)
      // Only select columns that exist in the tenant schema (see migrations/tenant/)
      const query = `
      SELECT 
        loan_id, loan_number, loan_amount, interest_rate,
        loan_type, loan_purpose, channel, property_type, property_state, property_city,
        property_street, property_zip, occupancy_type,
        application_date, lock_date, lock_expiration_date, closing_date, estimated_closing_date, funding_date,
        current_loan_status, branch, loan_officer, underwriter, closer, processor,
        fico_score, be_dti_ratio, ltv_ratio, cltv,
        created_at, updated_at
      FROM public.loans 
      ${whereClause}
      ORDER BY ${sortColumn} ${sortDirection} NULLS LAST
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
      params.push(parseInt(limit as string), parseInt(offset as string));

      const result = await tenantPool.query(query, params);

      // Get total count for pagination
      const countParams = params.slice(0, -2); // Remove limit and offset
      const countQuery = `SELECT COUNT(*) FROM public.loans ${whereClause}`;
      const countResult = await tenantPool.query(countQuery, countParams);
      const total = parseInt(countResult.rows[0].count);

      res.json({
        loans: result.rows,
        total,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        page:
          Math.floor(parseInt(offset as string) / parseInt(limit as string)) +
          1,
        totalPages: Math.ceil(total / parseInt(limit as string)),
      });
    } catch (error: any) {
      logError("Error fetching loans", error, { userId: req.userId });

      // Handle database connection errors
      if (handleDatabaseError(error, res, "Failed to fetch loans")) {
        return;
      }

      res.status(500).json({ error: error.message || "Failed to fetch loans" });
    }
  },
);

/**
 * GET /api/loans/detail-list
 * Returns all loans for the Loan Detail table with a wide set of columns.
 * Optional filters (workbench): date_field, date_from, date_to, branch, loan_officer,
 * and dimension filters (loan_purpose, channel, loan_type, property_state, etc.).
 * Query: limit, offset, date_field, date_from, date_to, branch, loan_officer, plus any whitelisted dimension column.
 */
const DETAIL_LIST_DATE_COLUMNS: Record<string, string> = {
  application_date: "application_date",
  started_date: "started_date",
  funding_date: "funding_date",
  closing_date: "closing_date",
  credit_pull_date: "credit_pull_date",
  investor_lock_date: "investor_lock_date",
  investor_purchase_date: "investor_purchase_date",
};

/** Whitelist of columns allowed as dimension filters (ADD FILTER DIMENSION). Must exist on public.loans. branch/loan_officer applied above. */
const DETAIL_LIST_DIMENSION_FILTER_COLUMNS: Record<string, string> = {
  channel: "channel",
  loan_type: "loan_type",
  loan_purpose: "loan_purpose",
  property_state: "property_state",
  property_county: "property_county",
  occupancy_type: "occupancy_type",
  property_type: "property_type",
  current_loan_status: "current_loan_status",
  investor: "investor",
  investor_name: "investor", // frontend sends investor_name, map to DB column investor
};
router.get(
  "/detail-list",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantPool = getTenantContext(req).tenantPool;
      const limit = Math.min(
        Math.max(parseInt((req.query.limit as string) || "100", 10) || 100, 1),
        5000,
      );
      const offset = Math.max(parseInt((req.query.offset as string) || "0", 10) || 0);

      const conditions: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      if (req.userId) {
        const accessFilter = await getUserLoanAccessFilter(
          req.userId,
          tenantPool,
          { loanTableAlias: "", startParamIndex: paramIndex },
        );
        if (accessFilter) {
          if (accessFilter.sql === "FALSE") {
            return res.json({
              loans: [],
              total: 0,
              limit,
              offset,
              page: 1,
              totalPages: 0,
            });
          }
          conditions.push(accessFilter.sql);
          params.push(...accessFilter.params);
          paramIndex += accessFilter.paramOffset;
        }
      }

      // Exclude archived loans
      conditions.push("(is_archived IS DISTINCT FROM TRUE)");

      const dateField = (req.query.date_field as string) || "application_date";
      const dateFrom = req.query.date_from as string | undefined;
      const dateTo = req.query.date_to as string | undefined;
      const branch = req.query.branch as string | undefined;
      const loanOfficer = req.query.loan_officer as string | undefined;

      if (dateFrom && dateTo && DETAIL_LIST_DATE_COLUMNS[dateField]) {
        conditions.push(
          `(${DETAIL_LIST_DATE_COLUMNS[dateField]} IS NOT NULL AND ${DETAIL_LIST_DATE_COLUMNS[dateField]}::date >= $${paramIndex} AND ${DETAIL_LIST_DATE_COLUMNS[dateField]}::date <= $${paramIndex + 1})`,
        );
        params.push(dateFrom, dateTo);
        paramIndex += 2;
      }
      if (branch && branch !== "all") {
        conditions.push(`branch = $${paramIndex}`);
        params.push(branch);
        paramIndex += 1;
      }
      if (loanOfficer && loanOfficer !== "all") {
        conditions.push(`loan_officer = $${paramIndex}`);
        params.push(loanOfficer);
        paramIndex += 1;
      }

      // Apply additional dimension filters (loan_purpose, channel, etc.) from workbench "ADD FILTER DIMENSION"
      for (const [queryKey, dbColumn] of Object.entries(
        DETAIL_LIST_DIMENSION_FILTER_COLUMNS,
      )) {
        const value = req.query[queryKey] as string | undefined;
        if (value && value !== "all") {
          conditions.push(`${dbColumn} = $${paramIndex}`);
          params.push(value);
          paramIndex += 1;
        }
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const selectColumns = [
        "loan_id",
        "loan_number",
        "loan_amount",
        "interest_rate",
        "fico_score",
        "ltv_ratio",
        "be_dti_ratio",
        "channel",
        "branch",
        "loan_officer",
        "processor",
        "underwriter",
        "closer",
        "investor",
        "property_street",
        "property_city",
        "property_state",
        "property_county",
        "property_zip",
        "loan_term",
        "current_loan_status",
        "current_milestone",
        "loan_folder",
        "loan_type",
        "loan_program",
        "loan_purpose",
        "occupancy_type",
        "property_type",
        "lien_position",
        "started_date",
        "credit_pull_date",
        "application_date",
        "loan_estimate_sent_date",
        "loan_estimate_received_date",
        "uw_final_approval_date",
        "uw_suspended_date",
        "uw_denied_date",
        "denial_date",
        "investor_lock_date",
        "lock_expiration_date",
        "lock_days",
        "estimated_closing_date",
        "ctc_date",
        "closing_disclosure_sent_date",
        "closing_disclosure_received_date",
        "closing_date",
        "funding_date",
        "investor_purchase_date",
        "shipped_date",
        "mers_min",
        "number_of_months_interest_only_payments",
        "income_total_mo_income",
        "origination_points",
        "orig_fee_borr_pd",
        "subject_property_type_fannie_mae",
        "fees_va_fund_fee_borr",
        "fha_lender_id",
        "fees_loan_discount_fee",
        "fees_loan_discount_fee_borr",
        "rush_closing_on_file",
        "scrub_rating_of_file",
      ].join(", ");

      const query = `
        SELECT ${selectColumns}
        FROM public.loans
        ${whereClause}
        ORDER BY COALESCE(application_date, started_date, created_at) DESC NULLS LAST
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      params.push(limit, offset);

      const result = await tenantPool.query(query, params);
      const countParams = params.slice(0, -2);
      const countQuery = `SELECT COUNT(*) FROM public.loans ${whereClause}`;
      const countResult = await tenantPool.query(countQuery, countParams);
      const total = parseInt(countResult.rows[0].count, 10);

      res.json({
        loans: result.rows,
        total,
        limit,
        offset,
        page: Math.floor(offset / limit) + 1,
        totalPages: Math.ceil(total / limit) || 1,
      });
    } catch (error: any) {
      logError("Error fetching loan detail list", error, { userId: req.userId });
      if (handleDatabaseError(error, res, "Failed to fetch loan detail list")) {
        return;
      }
      res
        .status(500)
        .json({ error: error.message || "Failed to fetch loan detail list" });
    }
  },
);

/**
 * GET /api/loans/stats
 * Get aggregated loan statistics for business overview
 * Uses tenant-specific database via attachTenantContext middleware
 * Respects user-level loan access filtering
 */
router.get(
  "/stats",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantContext = getTenantContext(req);
      const tenantPool = tenantContext.tenantPool;
      const tenantId = tenantContext.tenantId;

      // Get user's loan access context
      const accessCtx = await getLoanAccessContext(req, tenantPool);

      // If user has no access, return empty stats
      if (accessCtx.hasNoAccess) {
        return res.json({
          total: 0,
          active: 0,
          closed: 0,
          locked: 0,
          byLoanType: {},
          byStatus: {},
          avgLoanAmount: 0,
          avgInterestRate: 0,
          totalVolume: 0,
          avgCycleTime: 0,
          pullThroughRate: 0,
          creditPulls: 0,
          activeVolume: 0,
          closedVolume: 0,
          lockedVolume: 0,
        });
      }

      // REFACTORED: Use metricsService for efficient SQL-based metrics computation
      // with user access filtering
      const { queryMetrics, queryMetricGroupedBy } =
        await import("../services/metrics/metricsService.js");
      const accessFilter = accessCtx.getFilter("l");

      // Build access clause for direct queries
      const { accessClause, accessParams, nextParamIndex } =
        accessCtx.buildWhereClause("l");

      // Fetch core metrics in parallel using metricsService with access filter
      const [metrics, byLoanTypeData, byStatusData, volumeMetrics] =
        await Promise.all([
          // Core counts
          queryMetrics(
            tenantPool,
            [
              "active_loans",
              "closed_loans",
              "locked_loans",
              "total_units",
              "avg_cycle_time",
              "pull_through_rate",
            ],
            { userAccessFilter: accessFilter },
          ),
          // Group by loan type
          queryMetricGroupedBy(tenantPool, "total_units", "loan_type", {
            userAccessFilter: accessFilter,
          }),
          // Group by status (use custom query for current_loan_status)
          tenantPool.query(
            `
        SELECT 
          COALESCE(l.current_loan_status, 'Unknown') as status,
          COUNT(*) as count,
          SUM(l.loan_amount) as volume
        FROM public.loans l
        WHERE 1=1 ${accessClause}
        GROUP BY l.current_loan_status
        ORDER BY COUNT(*) DESC
      `,
            accessParams,
          ),
          // Volume metrics - use single efficient query with access filter
          tenantPool.query(
            `
        SELECT 
          SUM(l.loan_amount) as total_volume,
          AVG(l.loan_amount) as avg_loan_amount,
          AVG(CASE WHEN l.interest_rate > 0 THEN l.interest_rate END) as avg_interest_rate,
          COUNT(CASE WHEN l.credit_pull_date IS NOT NULL THEN 1 END) as credit_pulls,
          SUM(CASE 
            WHEN l.current_loan_status = 'Active Loan' 
            AND l.application_date IS NOT NULL 
            AND l.application_date::text != ''
            AND (l.is_archived IS DISTINCT FROM TRUE)
            THEN l.loan_amount ELSE 0 END) as active_volume,
          SUM(CASE WHEN l.funding_date IS NOT NULL THEN l.loan_amount ELSE 0 END) as closed_volume,
          SUM(CASE WHEN l.lock_date IS NOT NULL THEN l.loan_amount ELSE 0 END) as locked_volume
        FROM public.loans l
        WHERE 1=1 ${accessClause}
      `,
            accessParams,
          ),
        ]);

      // Extract metric values
      const activeLoans = Number(metrics.active_loans?.value || 0);
      const closedLoans = Number(metrics.closed_loans?.value || 0);
      const lockedLoans = Number(metrics.locked_loans?.value || 0);
      const totalLoans = Number(metrics.total_units?.value || 0);
      const avgCycleTime = Math.round(
        Number(metrics.avg_cycle_time?.value || 0),
      );
      const pullThroughRate = parseFloat(
        Number(metrics.pull_through_rate?.value || 0).toFixed(1),
      );

      // Build byLoanType from grouped metrics
      const byLoanType: Record<string, { count: number; volume: number }> = {};

      // Get volume by loan type with separate query (with access filter)
      const volumeByTypeResult = await tenantPool.query(
        `
      SELECT 
        COALESCE(l.loan_type, 'Other') as loan_type,
        COUNT(*) as count,
        SUM(l.loan_amount) as volume
      FROM public.loans l
      WHERE 1=1 ${accessClause}
      GROUP BY l.loan_type
    `,
        accessParams,
      );

      volumeByTypeResult.rows.forEach((row: any) => {
        byLoanType[row.loan_type || "Other"] = {
          count: parseInt(row.count || 0),
          volume: parseFloat(row.volume || 0),
        };
      });

      // Build byStatus from query results
      const byStatus: Record<string, { count: number; volume: number }> = {};
      byStatusData.rows.forEach((row: any) => {
        byStatus[row.status] = {
          count: parseInt(row.count || 0),
          volume: parseFloat(row.volume || 0),
        };
      });

      // Extract volume metrics
      const volumeRow = volumeMetrics.rows[0] || {};
      const totalVolume = parseFloat(volumeRow.total_volume || 0);
      const avgLoanAmount = parseFloat(volumeRow.avg_loan_amount || 0);
      const avgInterestRate = parseFloat(volumeRow.avg_interest_rate || 0);
      const creditPulls = parseInt(volumeRow.credit_pulls || 0);
      const activeVolume = parseFloat(volumeRow.active_volume || 0);
      const closedVolume = parseFloat(volumeRow.closed_volume || 0);
      const lockedVolume = parseFloat(volumeRow.locked_volume || 0);

      logDebug("Stats API (metricsService)", {
        tenantId,
        total: totalLoans,
        active: activeLoans,
        closed: closedLoans,
        locked: lockedLoans,
        avgCycleTime,
        pullThroughRate,
      });

      res.json({
        total: totalLoans,
        active: activeLoans,
        closed: closedLoans,
        locked: lockedLoans,
        byLoanType,
        byStatus,
        avgLoanAmount,
        avgInterestRate,
        totalVolume,
        avgCycleTime,
        pullThroughRate,
        creditPulls,
        activeVolume,
        closedVolume,
        lockedVolume,
      });
    } catch (error: any) {
      logError("Error fetching loan statistics", error, { userId: req.userId });

      // Handle database connection errors
      if (handleDatabaseError(error, res, "Failed to fetch loan statistics")) {
        return;
      }

      res
        .status(500)
        .json({ error: error.message || "Failed to fetch loan statistics" });
    }
  },
);

/**
 * GET /api/loans/active-loans-count
 * Get active loans count with optional date and channel filtering.
 *
 * Query params:
 *   - startDate: ISO date string (optional) - filter application_date >= startDate
 *   - endDate: ISO date string (optional) - filter application_date < endDate
 *   - period: string (optional) - rolling period shorthand (rolling_3_months, rolling_6_months, etc.)
 *   - consolidated_channel: string (optional) - filter by channel (Retail, TPO, 99-missing, or specific channel). Omit or "All" for no filter. Matches Executive Dashboard / metrics.
 *
 * Active loan definition (matches METRICS_CATALOG.active_loans):
 *   current_loan_status = 'Active Loan' AND application_date IS NOT NULL AND application_date::text != '' AND (is_archived IS DISTINCT FROM TRUE)
 */
router.get(
  "/active-loans-count",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantContext = getTenantContext(req);
      const tenantPool = tenantContext.tenantPool;

      // Get user's loan access context
      const accessCtx = await getLoanAccessContext(req, tenantPool);

      // If user has no access, return 0
      if (accessCtx.hasNoAccess) {
        return res.json({
          count: 0,
          volume: 0,
          dateFilter: null,
        });
      }

      // Parse date filter params
      let startDate: string | null = null;
      let endDate: string | null = null;

      // Handle period shorthand (rolling_3_months, rolling_6_months, etc.)
      const period = req.query.period as string | undefined;
      if (period) {
        const now = new Date();
        endDate = now.toISOString().split("T")[0]; // Today

        if (period === "rolling_3_months") {
          const start = new Date(
            now.getFullYear(),
            now.getMonth() - 3,
            now.getDate(),
          );
          startDate = start.toISOString().split("T")[0];
        } else if (period === "rolling_6_months") {
          const start = new Date(
            now.getFullYear(),
            now.getMonth() - 6,
            now.getDate(),
          );
          startDate = start.toISOString().split("T")[0];
        } else if (period === "rolling_12_months") {
          const start = new Date(
            now.getFullYear(),
            now.getMonth() - 12,
            now.getDate(),
          );
          startDate = start.toISOString().split("T")[0];
        } else if (period === "rolling_18_months") {
          const start = new Date(
            now.getFullYear(),
            now.getMonth() - 18,
            now.getDate(),
          );
          startDate = start.toISOString().split("T")[0];
        }
        // If period is not recognized, no date filter is applied (all time)
      } else {
        // Use explicit startDate/endDate if provided
        startDate = (req.query.startDate as string) || null;
        endDate = (req.query.endDate as string) || null;
      }

      // Build access clause
      const { accessClause, accessParams, nextParamIndex } =
        accessCtx.buildWhereClause("l");

      // Build date filter clause
      let dateClause = "";
      const params = [...accessParams];
      let paramIdx = nextParamIndex;

      if (startDate) {
        dateClause += ` AND l.application_date >= $${paramIdx}::date`;
        params.push(startDate);
        paramIdx++;
      }
      if (endDate) {
        dateClause += ` AND l.application_date < $${paramIdx}::date`;
        params.push(endDate);
        paramIdx++;
      }

      // Optional channel filter - same logic as metrics POST /query (consolidated_channel)
      // When provided, active count matches Executive Dashboard Active Loans card
      let channelClause = "";
      const consolidatedChannel = (req.query.consolidated_channel as string)?.trim();
      if (consolidatedChannel) {
        const cc = consolidatedChannel.toLowerCase();
        const tpoPat = `(l.channel ILIKE '%broker%' OR l.channel ILIKE '%brokered%' OR l.channel ILIKE '%wholesale%' OR l.channel ILIKE '%correspondent%' OR l.channel ILIKE '%corresp%' OR l.channel ILIKE '%tpo%')`;
        if (cc === "retail") {
          channelClause = ` AND ((l.channel ILIKE '%retail%') OR (${tpoPat} AND (l.account_executive IS NULL OR TRIM(l.account_executive) = '')))`;
        } else if (cc === "tpo") {
          channelClause = ` AND (${tpoPat} AND l.account_executive IS NOT NULL AND TRIM(l.account_executive) != '')`;
        } else if (cc === "99-missing") {
          channelClause = ` AND (l.channel IS NULL OR TRIM(l.channel) = '')`;
        } else if (cc !== "all" && cc !== "*") {
          channelClause = ` AND LOWER(TRIM(l.channel)) = LOWER($${paramIdx})`;
          params.push(consolidatedChannel);
          paramIdx++;
        }
      }

      // Query active loans count with date and optional channel filter
      // This is the EXACT same definition as METRICS_CATALOG.active_loans
      const result = await tenantPool.query(
        `
        SELECT 
          COUNT(*) as count,
          COALESCE(SUM(l.loan_amount), 0) as volume
        FROM public.loans l
        WHERE l.current_loan_status = 'Active Loan'
          AND l.application_date IS NOT NULL
          AND l.application_date::text != ''
          AND (l.is_archived IS DISTINCT FROM TRUE)
          ${accessClause}
          ${dateClause}
          ${channelClause}
        `,
        params,
      );

      const row = result.rows[0] || {};
      const count = parseInt(row.count || "0", 10);
      const volume = parseFloat(row.volume || "0");

      logDebug("Active loans count API", {
        count,
        volume,
        startDate,
        endDate,
        period,
      });

      res.json({
        count,
        volume,
        dateFilter:
          startDate || endDate ? { startDate, endDate, period } : null,
      });
    } catch (error: any) {
      logError("Error fetching active loans count", error, {
        userId: req.userId,
      });

      if (
        handleDatabaseError(error, res, "Failed to fetch active loans count")
      ) {
        return;
      }

      res
        .status(500)
        .json({ error: error.message || "Failed to fetch active loans count" });
    }
  },
);

/**
 * GET /api/loans/funnel
 * Get funnel data calculated from loans
 * Uses tenant-specific database via attachTenantContext (same as metrics endpoints)
 * Respects user-level loan access filtering
 */
router.get(
  "/funnel",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantContext = getTenantContext(req);
      const tenantPool = tenantContext.tenantPool;
      const tenantId = tenantContext.tenantId;

      // Get user's loan access context
      const accessCtx = await getLoanAccessContext(req, tenantPool);

      // If user has no access, return empty funnel data
      if (accessCtx.hasNoAccess) {
        return res.json({
          summary: {
            loansStarted: 0,
            withRespaApp: 0,
            noRespaApp: 0,
            originated: 0,
            falloutWithdrawn: 0,
            falloutDenied: 0,
          },
          stages: [],
          filters: {},
          debug: { accessFiltered: true, noAccess: true },
        });
      }

      // Parse optional filters
      const yearFilter = req.query.year
        ? parseInt(req.query.year as string)
        : null;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const loanOfficerId = req.query.loan_officer_id as string | undefined;
      const branch = req.query.branch as string | undefined;
      const loanType = req.query.loan_type as string | undefined;
      const channel = req.query.channel as string | undefined;
      // channelGroup allows filtering by consolidated channel (Retail, TPO, etc.)
      // Matches Qlik logic: if(WildMatch(Channel,'*Retail*','*Brok*')>=1,'Retail', if(Wildmatch(Channel,'*Whole*','*Corresp*')>=1,'TPO', Channel))
      const channelGroup = req.query.channel_group as string | undefined;
      // Option to exclude "Out of Range" loans
      // NOTE: The Qlik "Loans Started" waterfall does NOT apply Out of Range filter by default
      // The Out of Range filter is a UI toggle that users can optionally enable
      // Default: false (include all loans, matching Qlik's default funnel behavior)
      const excludeOutOfRange = req.query.exclude_out_of_range === "true"; // Default: false

      // Build WHERE clause for optional filters (no tenant_id needed - tenant DB is already isolated)
      const conditions: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      // Add user access filter first
      const {
        accessClause: rawAccessClause,
        accessParams: rawAccessParams,
        nextParamIndex,
      } = accessCtx.buildWhereClause("", paramIndex);

      if (rawAccessClause) {
        // Remove the leading "AND " for direct inclusion in conditions
        const accessCondition = rawAccessClause.replace(/^AND\s+/, "");
        if (accessCondition && accessCondition !== "FALSE") {
          conditions.push(accessCondition);
          params.push(...rawAccessParams);
          paramIndex = nextParamIndex;
        }
      }

      // Exclude archived loans (matches Qlik Active Loan Flag definition)
      conditions.push("(is_archived IS DISTINCT FROM TRUE)");

      // Handle date filtering - MUST use started_date (not application_date)
      // Qlik Logic: Loans Started is filtered by [Started Year], then RESPA App Status is calculated
      // from those started loans based on whether application_date exists
      if (startDate && endDate) {
        // Custom date range filter on started_date
        // Use COALESCE to fall back to created_at only if started_date is NULL
        conditions.push(`COALESCE(started_date, created_at) >= $${paramIndex}`);
        params.push(startDate);
        paramIndex++;
        conditions.push(`COALESCE(started_date, created_at) <= $${paramIndex}`);
        params.push(endDate);
        paramIndex++;
      } else if (yearFilter) {
        // Year filter on started_date
        conditions.push(
          `EXTRACT(YEAR FROM COALESCE(started_date, created_at)) = $${paramIndex}`,
        );
        params.push(yearFilter);
        paramIndex++;
      }
      if (loanOfficerId) {
        conditions.push(`loan_officer_id = $${paramIndex}`);
        params.push(loanOfficerId);
        paramIndex++;
      }
      if (branch) {
        conditions.push(`branch = $${paramIndex}`);
        params.push(branch);
        paramIndex++;
      }
      if (loanType) {
        conditions.push(`loan_type = $${paramIndex}`);
        params.push(loanType);
        paramIndex++;
      }

      // Channel filter - exact match
      if (channel) {
        conditions.push(`channel = $${paramIndex}`);
        params.push(channel);
        paramIndex++;
      }

      // Channel Group filter - consolidated channel (Retail, TPO, etc.)
      // TPO requires BOTH a TPO channel pattern AND populated account_executive.
      // Loans with a TPO channel but no AE are classified as Retail.
      if (channelGroup) {
        const clause = buildChannelWhereClause(channelGroup);
        if (clause) {
          // buildChannelWhereClause returns "AND ..." — strip leading "AND " for conditions array
          conditions.push(clause.replace(/^AND\s+/i, ""));
        }
      }

      // Out of Range Exclusion (Qlik default behavior)
      // From Transform.qvs lines 671-675:
      //   if([Interest Rate]<=0 OR [Interest Rate]>=15, 'Yes', 'No') as [Interest Rate Out of Range Flag],
      //   if([FICO Score]<350 OR [FICO Score]>=900, 'Yes', 'No') as [FICO Out of Range Flag],
      //   if([LTV Ratio]>=110 OR [LTV Ratio]<=0, 'Yes', 'No') as [LTV Out of Range Flag],
      //   if([BE DTI Ratio]>=70 OR [BE DTI Ratio]<=0, 'Yes', 'No') as [DTI Out of Range Flag],
      //
      // IMPORTANT: Upper bounds use STRICT inequality (<), not inclusive (<=)
      if (excludeOutOfRange) {
        // FICO Score: In Range = 350 <= x < 900 (Out of Range = < 350 OR >= 900)
        conditions.push(
          `(fico_score IS NULL OR (fico_score >= 350 AND fico_score < 900))`,
        );
        // Interest Rate: In Range = 0 < x < 15 (Out of Range = <= 0 OR >= 15)
        conditions.push(
          `(interest_rate IS NULL OR (interest_rate > 0 AND interest_rate < 15))`,
        );
        // LTV Ratio: In Range = 0 < x < 110 (Out of Range = <= 0 OR >= 110)
        conditions.push(
          `(ltv_ratio IS NULL OR (ltv_ratio > 0 AND ltv_ratio < 110))`,
        );
        // BE DTI Ratio: In Range = 0 < x < 70 (Out of Range = <= 0 OR >= 70)
        conditions.push(
          `(be_dti_ratio IS NULL OR (be_dti_ratio > 0 AND be_dti_ratio < 70))`,
        );
      }

      const dimensionFilterClause = buildDimensionFilterWhereClause(
        req.query as Record<string, any>,
        '',
        new Set(['channel_group', 'tenant_id', 'branch', 'loan_officer_id', 'loan_type', 'channel', 'year', 'startDate', 'endDate']),
      );

      let whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      if (dimensionFilterClause) {
        whereClause = whereClause
          ? `${whereClause} ${dimensionFilterClause}`
          : `WHERE 1=1 ${dimensionFilterClause}`;
      }

      logInfo("[Funnel] Querying tenant database", {
        whereClause,
        params,
        tenantId,
        tenantName: tenantContext.tenantInfo.name,
        excludeOutOfRange,
        dateFilter: { startDate, endDate, yearFilter },
        channelFilter: { channel, channelGroup },
      });

      // Compute all funnel metrics in a single SQL aggregate query.
      // Each metric is a COUNT/SUM with a FILTER clause matching the original JS logic.
      // status_lower is used to avoid repeating LOWER(TRIM(COALESCE(...))) everywhere.
      const has_app = `application_date IS NOT NULL AND TRIM(COALESCE(application_date::text, '')) <> ''`;
      const no_app = `application_date IS NULL OR TRIM(COALESCE(application_date::text, '')) = ''`;
      const is_originated = `(status_lower LIKE '%originated%' OR status_lower LIKE '%purchased%')`;
      const is_withdrawn = `(status_lower LIKE '%withdraw%' OR status_lower LIKE '%not accepted%' OR status_lower LIKE '%incomp%')`;
      const is_denied = `status_lower LIKE '%denied%'`;

      const aggregateQuery = `
        SELECT
          COUNT(*)                                                            AS started_units,
          COALESCE(SUM(loan_amount::numeric), 0)                             AS started_volume,

          COUNT(*)           FILTER (WHERE ${has_app})                        AS respa_app_units,
          COALESCE(SUM(loan_amount::numeric) FILTER (WHERE ${has_app}), 0)   AS respa_app_volume,

          COUNT(*)           FILTER (WHERE ${no_app})                         AS no_respa_app_units,
          COALESCE(SUM(loan_amount::numeric) FILTER (WHERE ${no_app}), 0)    AS no_respa_app_volume,

          COUNT(*)           FILTER (WHERE status_lower = 'active loan' AND ${has_app}) AS still_active_units,
          COALESCE(SUM(loan_amount::numeric) FILTER (WHERE status_lower = 'active loan' AND ${has_app}), 0) AS still_active_volume,

          COUNT(*)           FILTER (WHERE ${is_originated})                  AS originated_units,
          COALESCE(SUM(loan_amount::numeric) FILTER (WHERE ${is_originated}), 0) AS originated_volume,

          COUNT(*)           FILTER (WHERE ${is_withdrawn} AND NOT ${is_originated}) AS fallout_withdrawn_units,
          COALESCE(SUM(loan_amount::numeric) FILTER (WHERE ${is_withdrawn} AND NOT ${is_originated}), 0) AS fallout_withdrawn_volume,

          COUNT(*)           FILTER (WHERE ${is_denied} AND NOT ${is_originated}) AS fallout_denied_units,
          COALESCE(SUM(loan_amount::numeric) FILTER (WHERE ${is_denied} AND NOT ${is_originated}), 0) AS fallout_denied_volume
        FROM (
          SELECT loan_amount, application_date, current_loan_status,
                 LOWER(TRIM(COALESCE(current_loan_status, ''))) AS status_lower
          FROM public.loans
          ${whereClause}
        ) sub
      `;

      const funnelResult = await retryQuery(
        () => tenantPool.query(aggregateQuery, params),
        2,
        500,
      );

      const r = funnelResult.rows[0];
      const toNum = (v: any) => Number(v) || 0;

      const startedUnits = toNum(r.started_units);
      const startedVolume = toNum(r.started_volume);
      const respaAppUnits = toNum(r.respa_app_units);
      const respaAppVolume = toNum(r.respa_app_volume);
      const noRespaAppUnits = toNum(r.no_respa_app_units);
      const noRespaAppVolume = toNum(r.no_respa_app_volume);
      const stillActiveUnits = toNum(r.still_active_units);
      const stillActiveVolume = toNum(r.still_active_volume);
      const originatedUnits = toNum(r.originated_units);
      const originatedVolume = toNum(r.originated_volume);
      const falloutWithdrawnUnits = toNum(r.fallout_withdrawn_units);
      const falloutWithdrawnVolume = toNum(r.fallout_withdrawn_volume);
      const falloutDeniedUnits = toNum(r.fallout_denied_units);
      const falloutDeniedVolume = toNum(r.fallout_denied_volume);

      const revenueRate = 0.01;

      logInfo("[Funnel] Aggregate funnel breakdown", {
        dateFilter: { startDate, endDate, yearFilter },
        startedUnits,
        respaAppUnits,
        noRespaAppUnits,
        stillActiveUnits,
        originatedUnits,
        falloutWithdrawnUnits,
        falloutDeniedUnits,
        startedVolume,
        tenantId,
      });

      res.json({
        loansStarted: {
          units: startedUnits,
          volume: startedVolume,
          revenue: startedVolume * revenueRate,
        },
        stillActive: {
          units: stillActiveUnits,
          volume: stillActiveVolume,
          revenue: stillActiveVolume * revenueRate,
        },
        originated: {
          units: originatedUnits,
          volume: originatedVolume,
          revenue: originatedVolume * revenueRate,
        },
        falloutWithdrawn: {
          units: falloutWithdrawnUnits,
          volume: falloutWithdrawnVolume,
          lostRevenue: falloutWithdrawnVolume * revenueRate,
        },
        falloutDenied: {
          units: falloutDeniedUnits,
          volume: falloutDeniedVolume,
          lostRevenue: falloutDeniedVolume * revenueRate,
        },
        respaApp: {
          units: respaAppUnits,
          volume: respaAppVolume,
          revenue: respaAppVolume * revenueRate,
        },
        noRespaApp: {
          units: noRespaAppUnits,
          volume: noRespaAppVolume,
          lostRevenue: noRespaAppVolume * revenueRate,
        },
      });
    } catch (error: any) {
      logError("Error calculating funnel data", error, { userId: req.userId });

      // Handle database connection errors
      if (handleDatabaseError(error, res, "Failed to calculate funnel data")) {
        return;
      }

      res
        .status(500)
        .json({ error: error.message || "Failed to calculate funnel data" });
    }
  },
);

/**
 * GET /api/loans/company-overview
 * Get company overview metrics (Active Loans, Submitted MTD, Funded MTD, Aging, Loan Types)
 * Supports date range and channel filtering
 */
router.get(
  "/company-overview",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { tenantId, tenantPool } = getTenantContext(req);

      // Parse date range and channel filters from query params
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const channelGroup = req.query.channel_group as string | undefined;

      const now = new Date();
      // Use provided date range or default to current month
      const effectiveStartDate = startDate
        ? new Date(startDate)
        : new Date(now.getFullYear(), now.getMonth(), 1);
      const effectiveEndDate = endDate ? new Date(endDate) : now;

      // Use shared utility for channel filtering
      const channelClause = buildChannelWhereClause(channelGroup);
      const whereClause = `1=1 ${channelClause} AND (is_archived IS DISTINCT FROM TRUE)`;

      logInfo("[CompanyOverview] Query params", {
        tenantId,
        startDate: effectiveStartDate.toISOString(),
        endDate: effectiveEndDate.toISOString(),
        channelGroup,
      });

      // OPTIMIZED: Add date filtering at SQL level to reduce data volume
      // Filter to loans that have any date within the relevant period (plus some buffer for active loans)
      const startDateStr = formatDateForSQL(effectiveStartDate);
      const endDateStr = formatDateForSQL(effectiveEndDate);

      // Compute all company-overview metrics via SQL aggregates.
      // A CTE pre-computes boolean flags so each row is only classified once.
      const excludedStatuses = `('WITHDRAWN','CANCELLED','DENIED','DECLINED','REJECTED','ORIGINATED','FUNDED','CLOSED','COMPLETE','COMPLETED')`;

      const overviewQuery = `
        WITH base AS (
          SELECT
            loan_amount::numeric                        AS amount,
            COALESCE(interest_rate::numeric, 0)         AS rate,
            loan_type,
            application_date,
            funding_date,
            -- Active = not closed by dates AND status not in excluded set
            (closing_date IS NULL AND funding_date IS NULL
             AND UPPER(TRIM(COALESCE(status, ''))) NOT IN ${excludedStatuses}
            ) AS is_active,
            CASE WHEN application_date IS NOT NULL
              THEN (CURRENT_DATE - application_date::date) END AS age_days
          FROM loans
          WHERE ${whereClause}
            AND (
              application_date >= $1 OR funding_date >= $1 OR closing_date >= $1
              OR (funding_date IS NULL AND closing_date IS NULL)
            )
        )
        SELECT
          -- Active (is_active AND app date in range or null)
          COUNT(*)     FILTER (WHERE is_active AND (application_date IS NULL OR (application_date >= $1 AND application_date <= $2))) AS active_count,
          COALESCE(SUM(amount) FILTER (WHERE is_active AND (application_date IS NULL OR (application_date >= $1 AND application_date <= $2))), 0) AS active_volume,
          CASE WHEN COALESCE(SUM(amount) FILTER (WHERE is_active AND (application_date IS NULL OR (application_date >= $1 AND application_date <= $2))), 0) > 0
            THEN SUM(amount * rate) FILTER (WHERE is_active AND (application_date IS NULL OR (application_date >= $1 AND application_date <= $2)))
                 / SUM(amount)      FILTER (WHERE is_active AND (application_date IS NULL OR (application_date >= $1 AND application_date <= $2)))
            ELSE 0 END AS active_wac,

          -- Submitted MTD
          COUNT(*)     FILTER (WHERE application_date >= $1 AND application_date <= $2) AS submitted_count,
          COALESCE(SUM(amount) FILTER (WHERE application_date >= $1 AND application_date <= $2), 0) AS submitted_volume,
          CASE WHEN COALESCE(SUM(amount) FILTER (WHERE application_date >= $1 AND application_date <= $2), 0) > 0
            THEN SUM(amount * rate) FILTER (WHERE application_date >= $1 AND application_date <= $2)
                 / SUM(amount)      FILTER (WHERE application_date >= $1 AND application_date <= $2)
            ELSE 0 END AS submitted_wac,

          -- Funded MTD
          COUNT(*)     FILTER (WHERE funding_date >= $1 AND funding_date <= $2) AS funded_count,
          COALESCE(SUM(amount) FILTER (WHERE funding_date >= $1 AND funding_date <= $2), 0) AS funded_volume,
          CASE WHEN COALESCE(SUM(amount) FILTER (WHERE funding_date >= $1 AND funding_date <= $2), 0) > 0
            THEN SUM(amount * rate) FILTER (WHERE funding_date >= $1 AND funding_date <= $2)
                 / SUM(amount)      FILTER (WHERE funding_date >= $1 AND funding_date <= $2)
            ELSE 0 END AS funded_wac,

          -- Aging buckets (active loans with application_date)
          COUNT(*) FILTER (WHERE is_active AND (application_date IS NULL OR (application_date >= $1 AND application_date <= $2)) AND age_days BETWEEN 0 AND 15)   AS aging_0_15,
          COUNT(*) FILTER (WHERE is_active AND (application_date IS NULL OR (application_date >= $1 AND application_date <= $2)) AND age_days BETWEEN 16 AND 30)  AS aging_16_30,
          COUNT(*) FILTER (WHERE is_active AND (application_date IS NULL OR (application_date >= $1 AND application_date <= $2)) AND age_days BETWEEN 31 AND 45)  AS aging_31_45,
          COUNT(*) FILTER (WHERE is_active AND (application_date IS NULL OR (application_date >= $1 AND application_date <= $2)) AND age_days BETWEEN 46 AND 60)  AS aging_46_60,
          COUNT(*) FILTER (WHERE is_active AND (application_date IS NULL OR (application_date >= $1 AND application_date <= $2)) AND age_days BETWEEN 61 AND 90)  AS aging_61_90,
          COUNT(*) FILTER (WHERE is_active AND (application_date IS NULL OR (application_date >= $1 AND application_date <= $2)) AND age_days > 90)               AS aging_over_90
        FROM base
      `;

      // By-type distributions (tiny result sets)
      const byTypeQuery = (dateCol: string) => `
        SELECT COALESCE(loan_type, 'Other') AS loan_type, COUNT(*) AS count
        FROM loans
        WHERE ${whereClause} AND ${dateCol} >= $1 AND ${dateCol} <= $2
        GROUP BY COALESCE(loan_type, 'Other')
      `;

      const [overviewResult, submittedTypeResult, fundedTypeResult] =
        await Promise.all([
          retryQuery(
            () => tenantPool.query(overviewQuery, [startDateStr, endDateStr]),
            2,
            500,
          ),
          retryQuery(
            () =>
              tenantPool.query(byTypeQuery("application_date"), [
                startDateStr,
                endDateStr,
              ]),
            2,
            500,
          ),
          retryQuery(
            () =>
              tenantPool.query(byTypeQuery("funding_date"), [
                startDateStr,
                endDateStr,
              ]),
            2,
            500,
          ),
        ]);

      const m = overviewResult.rows[0];
      const toNum = (v: any) => Number(v) || 0;

      const submittedByType: Record<string, number> = {};
      for (const row of submittedTypeResult.rows) {
        submittedByType[row.loan_type] = Number(row.count);
      }
      const fundedByType: Record<string, number> = {};
      for (const row of fundedTypeResult.rows) {
        fundedByType[row.loan_type] = Number(row.count);
      }

      logInfo("[CompanyOverview] Results", {
        activeCount: toNum(m.active_count),
        submittedCount: toNum(m.submitted_count),
        fundedCount: toNum(m.funded_count),
        dateRange: {
          start: effectiveStartDate.toISOString(),
          end: effectiveEndDate.toISOString(),
        },
      });

      res.json({
        activeLoans: {
          count: toNum(m.active_count),
          volume: toNum(m.active_volume),
          avgInterestRate: toNum(m.active_wac),
        },
        submittedMTD: {
          count: toNum(m.submitted_count),
          volume: toNum(m.submitted_volume),
          avgInterestRate: toNum(m.submitted_wac),
        },
        fundedMTD: {
          count: toNum(m.funded_count),
          volume: toNum(m.funded_volume),
          avgInterestRate: toNum(m.funded_wac),
        },
        aging: {
          "0-15": toNum(m.aging_0_15),
          "16-30": toNum(m.aging_16_30),
          "31-45": toNum(m.aging_31_45),
          "46-60": toNum(m.aging_46_60),
          "61-90": toNum(m.aging_61_90),
          ">90": toNum(m.aging_over_90),
        },
        submittedByType,
        fundedByType,
      });
    } catch (error: any) {
      logError("Error fetching company overview", error, {
        userId: req.userId,
      });
      res
        .status(500)
        .json({ error: error.message || "Failed to fetch company overview" });
    }
  },
);

/**
 * GET /api/loans/operations-overview
 * Get operations overview metrics (Cycle Time, Active Pipeline, Processing Efficiency, Turn Time by Stage)
 * Supports date range and channel filtering
 */
router.get(
  "/operations-overview",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { tenantId, tenantPool } = getTenantContext(req);

      // Parse date range and channel filters from query params
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const channelGroup = req.query.channel_group as string | undefined;

      const now = new Date();
      // Use provided date range or default to current year
      const effectiveStartDate = startDate
        ? new Date(startDate)
        : new Date(now.getFullYear(), 0, 1);
      const effectiveEndDate = endDate ? new Date(endDate) : now;

      // Build WHERE clause for channel filtering (no tenant_id -- tenant DB is already scoped)
      const conditions: string[] = ["1=1"];
      const params: any[] = [];

      // Channel Group filter - consolidated channel (Retail, TPO, etc.)
      // TPO requires BOTH a TPO channel pattern AND populated account_executive.
      // Loans with a TPO channel but no AE are classified as Retail.
      if (channelGroup && channelGroup !== "All") {
        const clause = buildChannelWhereClause(channelGroup);
        if (clause) {
          conditions.push(clause.replace(/^AND\s+/i, ""));
        }
      }

      const whereClause = conditions.join(" AND ");

      logInfo("[OperationsOverview] Query params", {
        tenantId,
        startDate: effectiveStartDate.toISOString(),
        endDate: effectiveEndDate.toISOString(),
        channelGroup,
      });

      // Get all loans with channel filter applied
      const loansResult = await retryQuery(
        () =>
          tenantPool.query(
            `SELECT 
          loan_id, loan_amount, loan_type, current_loan_status, channel,
          application_date, closing_date, lock_date, funding_date, ctc_date, interest_rate
         FROM public.loans 
         WHERE ${whereClause}
         ORDER BY application_date DESC`,
            params,
          ),
        2,
        500,
      );

      const allLoans = loansResult.rows;

      // Active Pipeline - smart detection, filtered by date range
      const activeLoans = allLoans.filter((l) => {
        const status = (l.current_loan_status || "").toString().toUpperCase();
        const isActive = ![
          "CLOSED",
          "FUNDED",
          "ORIGINATED",
          "WITHDRAWN",
          "DENIED",
          "COMPLETED",
          "PURCHASED",
        ].some((s) => status.includes(s));

        if (!isActive) return false;

        // Filter by application date within date range
        if (l.application_date) {
          const appDate = new Date(l.application_date);
          return appDate >= effectiveStartDate && appDate <= effectiveEndDate;
        }
        return true;
      });
      const activeVolume = activeLoans.reduce(
        (sum, l) => sum + parseFloat(l.loan_amount || 0),
        0,
      );

      // Calculate average cycle time (application to closing/funding) for loans within date range
      const loansWithDates = allLoans.filter((l) => {
        if (!l.application_date) return false;
        const fundDate = l.funding_date || l.closing_date;
        if (!fundDate) return false;

        // Filter by funding date within date range
        const fundDateObj = new Date(fundDate);
        return (
          fundDateObj >= effectiveStartDate && fundDateObj <= effectiveEndDate
        );
      });

      const cycleTimes = loansWithDates
        .map((l) => {
          const fundDate = l.funding_date || l.closing_date;
          return daysBetween(l.application_date, fundDate);
        })
        .filter((d) => d !== null && d > 0) as number[];

      const avgCycleTime =
        cycleTimes.length > 0
          ? Math.round(
              cycleTimes.reduce((sum, d) => sum + d, 0) / cycleTimes.length,
            )
          : 43; // Default fallback

      // Processing Efficiency (loans processed within target timeframe)
      // Target: 35 days, calculate percentage within target
      const targetCycleTime = 35;
      const withinTarget = cycleTimes.filter(
        (d) => d <= targetCycleTime,
      ).length;
      const processingEfficiency =
        cycleTimes.length > 0
          ? Math.round((withinTarget / cycleTimes.length) * 100)
          : 87; // Default fallback

      // Turn Time by Stage - calculate actual times from milestone dates when available
      // Qlik uses NetworkDays function but we'll use calendar days for simplicity
      const appToLockTarget = 10;
      const lockToCTCTarget = 15;
      const ctcToFundingTarget = 10;

      // Calculate actual turn times from milestone dates
      const appToLockTimes = loansWithDates
        .filter((l) => l.application_date && l.lock_date)
        .map((l) => daysBetween(l.application_date, l.lock_date))
        .filter((d) => d !== null && d > 0) as number[];

      const lockToCTCTimes = loansWithDates
        .filter((l) => l.lock_date && l.ctc_date)
        .map((l) => daysBetween(l.lock_date, l.ctc_date))
        .filter((d) => d !== null && d > 0) as number[];

      const ctcToFundingTimes = loansWithDates
        .filter((l) => l.ctc_date && (l.funding_date || l.closing_date))
        .map((l) => daysBetween(l.ctc_date, l.funding_date || l.closing_date))
        .filter((d) => d !== null && d > 0) as number[];

      // Calculate averages or estimate from cycle time if no milestone dates available
      const appToLockActual =
        appToLockTimes.length > 0
          ? Math.round(
              appToLockTimes.reduce((sum, d) => sum + d, 0) /
                appToLockTimes.length,
            )
          : Math.round(avgCycleTime * 0.28);

      const lockToCTCActual =
        lockToCTCTimes.length > 0
          ? Math.round(
              lockToCTCTimes.reduce((sum, d) => sum + d, 0) /
                lockToCTCTimes.length,
            )
          : Math.round(avgCycleTime * 0.42);

      const ctcToFundingActual =
        ctcToFundingTimes.length > 0
          ? Math.round(
              ctcToFundingTimes.reduce((sum, d) => sum + d, 0) /
                ctcToFundingTimes.length,
            )
          : Math.round(avgCycleTime * 0.3);

      logInfo("[OperationsOverview] Results", {
        activeCount: activeLoans.length,
        avgCycleTime,
        processingEfficiency,
        dateRange: {
          start: effectiveStartDate.toISOString(),
          end: effectiveEndDate.toISOString(),
        },
      });

      res.json({
        avgCycleTime: {
          current: avgCycleTime,
          target: targetCycleTime,
        },
        activePipeline: {
          count: activeLoans.length,
          volume: activeVolume,
        },
        processingEfficiency: {
          current: processingEfficiency,
          target: 90,
        },
        turnTimeByStage: {
          appToLock: {
            target: appToLockTarget,
            actual: appToLockActual,
            overTarget: appToLockActual - appToLockTarget,
            percentOver: Math.round(
              ((appToLockActual - appToLockTarget) / appToLockTarget) * 100,
            ),
          },
          lockToCTC: {
            target: lockToCTCTarget,
            actual: lockToCTCActual,
            overTarget: lockToCTCActual - lockToCTCTarget,
            percentOver: Math.round(
              ((lockToCTCActual - lockToCTCTarget) / lockToCTCTarget) * 100,
            ),
          },
          ctcToFunding: {
            target: ctcToFundingTarget,
            actual: ctcToFundingActual,
            overTarget: ctcToFundingActual - ctcToFundingTarget,
            percentOver: Math.round(
              ((ctcToFundingActual - ctcToFundingTarget) / ctcToFundingTarget) *
                100,
            ),
          },
        },
      });
    } catch (error: any) {
      logError("Error fetching operations overview", error, {
        userId: req.userId,
      });
      res.status(500).json({
        error: error.message || "Failed to fetch operations overview",
      });
    }
  },
);

/**
 * GET /api/loans/toptiering
 * Get TopTiering data for Sales Scorecard with Pareto-based tier assignment
 *
 * Based on Qlik logic:
 * - DateType = 'Funding' (uses funding_date or closing_date)
 * - Sort actors by revenue descending
 * - Calculate cumulative % of total revenue
 * - Assign tiers: Top (<=65%), Second (65-90%), Bottom (>90%)
 *
 * Query Parameters:
 * - actor: 'branch' | 'loan_officer' (default: 'branch')
 * - startDate: ISO date string
 * - endDate: ISO date string
 * - channel_group: Optional channel filter
 */
router.get(
  "/toptiering",
  authenticateToken,
  apiLimiter,
  async (req: AuthRequest, res) => {
    // DEPRECATED: Use /api/toptiering instead
    addDeprecationHeaders(res, "/api/toptiering");
    try {
      // Get tenant_id from query parameter or profile
      let tenantId = req.query.tenant_id as string | undefined;

      if (!tenantId) {
        // Fall back to getting tenant_id from profile
        const profileResult = await pool.query(
          "SELECT tenant_id FROM public.profiles WHERE user_id = $1",
          [req.userId],
        );

        if (
          profileResult.rows.length === 0 ||
          !profileResult.rows[0].tenant_id
        ) {
          return res.status(404).json({ error: "Tenant not found" });
        }
        tenantId = profileResult.rows[0].tenant_id;
      }

      const actor = (req.query.actor as string) || "branch";
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const channelGroup = req.query.channel_group as string | undefined;

      // Validate actor type
      if (!["branch", "loan_officer"].includes(actor)) {
        return res.status(400).json({
          error: 'Invalid actor type. Must be "branch" or "loan_officer"',
        });
      }

      // Determine the grouping column based on actor type
      const actorColumn = actor === "branch" ? "branch" : "loan_officer";

      // Build date range filter
      const now = new Date();
      const effectiveEndDate = endDate ? new Date(endDate) : now;
      const effectiveStartDate = startDate
        ? new Date(startDate)
        : new Date(now.getFullYear(), 0, 1);

      logInfo("[TopTiering] Starting query", {
        actor,
        tenantId,
        dateRange: {
          start: effectiveStartDate.toISOString(),
          end: effectiveEndDate.toISOString(),
        },
        channelGroup,
      });

      // OPTIMIZED: Use SQL filtering for date and channel instead of JavaScript
      const channelClause = buildChannelWhereClause(channelGroup);
      const startDateStr = formatDateForSQL(effectiveStartDate);
      const endDateStr = formatDateForSQL(effectiveEndDate);

      // PHASE 1: Fetch FUNDED loans with SQL filtering (main data)
      const fundedLoansResult = await retryQuery(
        () =>
          pool.query(
            `SELECT 
          loan_id, loan_amount, loan_type, current_loan_status, channel,
          funding_date, closing_date, application_date, started_date,
          branch, loan_officer, fico_score, ltv_ratio, be_dti_ratio,
          origination_points, orig_fee_borr_pd, orig_fees_seller, cd_lender_credits,
          rate_lock_buy_side_base_price_rate
         FROM public.loans 
         WHERE tenant_id = $1
           AND funding_date IS NOT NULL
           AND funding_date >= $2
           AND funding_date <= $3
           ${channelClause}`,
            [tenantId, startDateStr, endDateStr],
          ),
        2,
        500,
      );
      const fundedLoans = fundedLoansResult.rows;

      // PHASE 2: Fetch LOST OPPORTUNITY loans with SQL filtering
      const lostOpportunityResult = await retryQuery(
        () =>
          pool.query(
            `SELECT 
          loan_id, loan_amount, current_loan_status, channel,
          application_date, branch, loan_officer,
          origination_points, orig_fee_borr_pd, orig_fees_seller, cd_lender_credits,
          rate_lock_buy_side_base_price_rate
         FROM public.loans 
         WHERE tenant_id = $1
           AND application_date >= $2
           AND application_date <= $3
           AND (
             current_loan_status ILIKE '%withdraw%' OR
             current_loan_status ILIKE '%cancelled%' OR
             current_loan_status ILIKE '%not accepted%' OR
             current_loan_status ILIKE '%incomplete%'
           )
           ${channelClause}`,
            [tenantId, startDateStr, endDateStr],
          ),
        2,
        500,
      );
      const lostOpportunityLoans = lostOpportunityResult.rows;

      // PHASE 3: Fetch DENIED loans with SQL filtering
      const deniedResult = await retryQuery(
        () =>
          pool.query(
            `SELECT 
          loan_id, application_date, branch, loan_officer
         FROM public.loans 
         WHERE tenant_id = $1
           AND application_date >= $2
           AND application_date <= $3
           AND (current_loan_status ILIKE '%denied%' OR current_loan_status ILIKE '%declined%')
           ${channelClause}`,
            [tenantId, startDateStr, endDateStr],
          ),
        2,
        500,
      );
      const deniedLoans = deniedResult.rows;

      // PHASE 4: Fetch STARTED loans for pull-through calculation
      const startedResult = await retryQuery(
        () =>
          pool.query(
            `SELECT 
          loan_id, branch, loan_officer
         FROM public.loans 
         WHERE tenant_id = $1
           AND COALESCE(started_date, application_date) >= $2
           AND COALESCE(started_date, application_date) <= $3
           ${channelClause}`,
            [tenantId, startDateStr, endDateStr],
          ),
        2,
        500,
      );
      const startedLoans = startedResult.rows;

      logInfo("[TopTiering] Fetched loans with SQL filtering", {
        fundedInRange: fundedLoans.length,
        lostOpportunity: lostOpportunityLoans.length,
        denied: deniedLoans.length,
        started: startedLoans.length,
      });

      // Helper to calculate revenue for a loan (use shared utility)
      const calcRevenue = (l: any): number => {
        return calcLoanRevenue({
          rate_lock_buy_side_base_price_rate:
            l.rate_lock_buy_side_base_price_rate,
          loan_amount: l.loan_amount,
          orig_fee_borr_pd: l.orig_fee_borr_pd,
          orig_fees_seller: l.orig_fees_seller,
          cd_lender_credits: l.cd_lender_credits,
        });
      };

      // Helper to calculate turn time for a loan
      const calcTurnTime = (l: any): number | null => {
        const appDate = l.application_date;
        const fundDate = l.funding_date || l.closing_date;
        if (!appDate || !fundDate) return null;
        const diffMs =
          new Date(fundDate).getTime() - new Date(appDate).getTime();
        return Math.round(diffMs / (1000 * 60 * 60 * 24)); // days
      };

      // PHASE 6: Group funded loans by actor and calculate metrics
      const actorMap = new Map<
        string,
        {
          loans: any[];
          revenue: number;
          volume: number;
          units: number;
          turnTimes: number[];
          ficoWeighted: { sum: number; weight: number };
          ltvWeighted: { sum: number; weight: number };
          dtiWeighted: { sum: number; weight: number };
        }
      >();

      fundedLoans.forEach((l: any) => {
        const actorName = l[actorColumn];
        if (isActorMissing(actorName)) return; // Use shared utility

        if (!actorMap.has(actorName)) {
          actorMap.set(actorName, {
            loans: [],
            revenue: 0,
            volume: 0,
            units: 0,
            turnTimes: [],
            ficoWeighted: { sum: 0, weight: 0 },
            ltvWeighted: { sum: 0, weight: 0 },
            dtiWeighted: { sum: 0, weight: 0 },
          });
        }

        const actor = actorMap.get(actorName)!;
        const loanAmount = parseFloat(l.loan_amount) || 0;
        const revenue = calcRevenue(l);
        const turnTime = calcTurnTime(l);

        actor.loans.push(l);
        actor.revenue += revenue;
        actor.volume += loanAmount;
        actor.units += 1;

        if (turnTime !== null && turnTime > 0) {
          actor.turnTimes.push(turnTime);
        }

        // Weighted averages (weight by loan amount)
        if (l.fico_score && loanAmount > 0) {
          actor.ficoWeighted.sum += parseFloat(l.fico_score) * loanAmount;
          actor.ficoWeighted.weight += loanAmount;
        }
        if (l.ltv_ratio && loanAmount > 0) {
          actor.ltvWeighted.sum += parseFloat(l.ltv_ratio) * loanAmount;
          actor.ltvWeighted.weight += loanAmount;
        }
        if (l.be_dti_ratio && loanAmount > 0) {
          actor.dtiWeighted.sum += parseFloat(l.be_dti_ratio) * loanAmount;
          actor.dtiWeighted.weight += loanAmount;
        }
      });

      // PHASE 7: Calculate totals and sort by revenue for tier assignment
      const actorMetrics = Array.from(actorMap.entries())
        .map(([name, data]) => ({
          name,
          revenue: data.revenue,
          volume: data.volume,
          units: data.units,
          revenueBps:
            data.volume > 0 ? (data.revenue / data.volume) * 10000 : 0,
          revenuePerLoan: data.units > 0 ? data.revenue / data.units : 0,
          avgTurnTime:
            data.turnTimes.length > 0
              ? data.turnTimes.reduce((a, b) => a + b, 0) /
                data.turnTimes.length
              : 0,
          waFico:
            data.ficoWeighted.weight > 0
              ? data.ficoWeighted.sum / data.ficoWeighted.weight
              : 0,
          waLtv:
            data.ltvWeighted.weight > 0
              ? data.ltvWeighted.sum / data.ltvWeighted.weight
              : 0,
          waDti:
            data.dtiWeighted.weight > 0
              ? data.dtiWeighted.sum / data.dtiWeighted.weight
              : 0,
        }))
        .sort((a, b) => b.revenue - a.revenue);

      // Calculate total revenue for tier assignment
      const totalRevenue = actorMetrics.reduce((sum, a) => sum + a.revenue, 0);
      const totalVolume = actorMetrics.reduce((sum, a) => sum + a.volume, 0);
      const totalUnits = actorMetrics.reduce((sum, a) => sum + a.units, 0);

      // Assign tiers based on cumulative revenue percentage
      let cumulativeRevenue = 0;
      const actors = actorMetrics.map((a) => {
        cumulativeRevenue += a.revenue;
        const cumulativePercent =
          totalRevenue > 0 ? (cumulativeRevenue / totalRevenue) * 100 : 0;

        let tier: "top" | "second" | "bottom";
        if (cumulativePercent <= 65) {
          tier = "top";
        } else if (cumulativePercent <= 90) {
          tier = "second";
        } else {
          tier = "bottom";
        }

        return {
          ...a,
          cumulativePercent,
          tier,
        };
      });

      // PHASE 8: Calculate Lost Opportunity metrics by actor
      const lostOpportunityByActor = new Map<
        string,
        { units: number; revenue: number }
      >();
      const deniedByActor = new Map<string, number>();

      lostOpportunityLoans.forEach((l: any) => {
        const actorName = l[actorColumn];
        if (isActorMissing(actorName)) return; // Use shared utility

        if (!lostOpportunityByActor.has(actorName)) {
          lostOpportunityByActor.set(actorName, { units: 0, revenue: 0 });
        }
        const lo = lostOpportunityByActor.get(actorName)!;
        lo.units += 1;
        lo.revenue += calcRevenue(l);
      });

      deniedLoans.forEach((l: any) => {
        const actorName = l[actorColumn];
        if (isActorMissing(actorName)) return; // Use shared utility
        deniedByActor.set(actorName, (deniedByActor.get(actorName) || 0) + 1);
      });

      // PHASE 9: Calculate tier summaries
      const topTierActors = actors.filter((a) => a.tier === "top");
      const secondTierActors = actors.filter((a) => a.tier === "second");
      const bottomTierActors = actors.filter((a) => a.tier === "bottom");

      const calcTierSummary = (tierActors: typeof actors) => {
        const tierNames = new Set(tierActors.map((a) => a.name));

        // Lost opportunity for this tier
        let lostUnits = 0;
        let lostRevenue = 0;
        let deniedUnits = 0;

        tierNames.forEach((name) => {
          const lo = lostOpportunityByActor.get(name);
          if (lo) {
            lostUnits += lo.units;
            lostRevenue += lo.revenue;
          }
          deniedUnits += deniedByActor.get(name) || 0;
        });

        // Started loans for this tier (for pull-through)
        const tierStartedLoans = startedLoans.filter((l: any) =>
          tierNames.has(l[actorColumn]),
        );
        const tierFundedCount = tierActors.reduce((sum, a) => sum + a.units, 0);
        const pullThrough =
          tierStartedLoans.length > 0
            ? (tierFundedCount / tierStartedLoans.length) * 100
            : 0;

        // Calculate averages
        const validTurnTimes = tierActors.filter((a) => a.avgTurnTime > 0);
        const validFicos = tierActors.filter((a) => a.waFico > 0);
        const validLtvs = tierActors.filter((a) => a.waLtv > 0);
        const validDtis = tierActors.filter((a) => a.waDti > 0);

        return {
          count: tierActors.length,
          revenue: tierActors.reduce((sum, a) => sum + a.revenue, 0),
          volume: tierActors.reduce((sum, a) => sum + a.volume, 0),
          units: tierActors.reduce((sum, a) => sum + a.units, 0),
          percent:
            totalRevenue > 0
              ? (tierActors.reduce((sum, a) => sum + a.revenue, 0) /
                  totalRevenue) *
                100
              : 0,
          avgTurnTime:
            validTurnTimes.length > 0
              ? validTurnTimes.reduce((sum, a) => sum + a.avgTurnTime, 0) /
                validTurnTimes.length
              : 0,
          waFico:
            validFicos.length > 0
              ? validFicos.reduce((sum, a) => sum + a.waFico, 0) /
                validFicos.length
              : 0,
          waLtv:
            validLtvs.length > 0
              ? validLtvs.reduce((sum, a) => sum + a.waLtv, 0) /
                validLtvs.length
              : 0,
          waDti:
            validDtis.length > 0
              ? validDtis.reduce((sum, a) => sum + a.waDti, 0) /
                validDtis.length
              : 0,
          lostOpportunityUnits: lostUnits,
          lostOpportunityRevenue: lostRevenue,
          deniedUnits: deniedUnits,
          pullThrough: pullThrough,
        };
      };

      const tierSummary = {
        topTier: calcTierSummary(topTierActors),
        secondTier: calcTierSummary(secondTierActors),
        bottomTier: calcTierSummary(bottomTierActors),
      };

      // Overall totals including lost opportunity metrics
      const totalLostOpportunityUnits = lostOpportunityLoans.length;
      const totalLostOpportunityRevenue = lostOpportunityLoans.reduce(
        (sum: number, l: any) => sum + calcRevenue(l),
        0,
      );
      const totalDeniedUnits = deniedLoans.length;
      const totalPullThrough =
        startedLoans.length > 0
          ? (fundedLoans.length / startedLoans.length) * 100
          : 0;

      // Calculate overall weighted averages
      const allTurnTimes = actors.filter((a) => a.avgTurnTime > 0);
      const allFicos = actors.filter((a) => a.waFico > 0);
      const allLtvs = actors.filter((a) => a.waLtv > 0);
      const allDtis = actors.filter((a) => a.waDti > 0);

      const totals = {
        revenue: totalRevenue,
        volume: totalVolume,
        units: totalUnits,
        avgTurnTime:
          allTurnTimes.length > 0
            ? allTurnTimes.reduce((sum, a) => sum + a.avgTurnTime, 0) /
              allTurnTimes.length
            : 0,
        waFico:
          allFicos.length > 0
            ? allFicos.reduce((sum, a) => sum + a.waFico, 0) / allFicos.length
            : 0,
        waLtv:
          allLtvs.length > 0
            ? allLtvs.reduce((sum, a) => sum + a.waLtv, 0) / allLtvs.length
            : 0,
        waDti:
          allDtis.length > 0
            ? allDtis.reduce((sum, a) => sum + a.waDti, 0) / allDtis.length
            : 0,
        lostOpportunityUnits: totalLostOpportunityUnits,
        lostOpportunityRevenue: totalLostOpportunityRevenue,
        deniedUnits: totalDeniedUnits,
        pullThrough: totalPullThrough,
      };

      logInfo("[TopTiering] Results", {
        actor,
        actorCount: actors.length,
        dateRange: {
          start: effectiveStartDate.toISOString(),
          end: effectiveEndDate.toISOString(),
        },
        tierCounts: {
          top: topTierActors.length,
          second: secondTierActors.length,
          bottom: bottomTierActors.length,
        },
        totals: {
          revenue: totalRevenue,
          volume: totalVolume,
          units: totalUnits,
        },
        lostOpportunity: {
          units: totalLostOpportunityUnits,
          revenue: totalLostOpportunityRevenue,
        },
        denied: totalDeniedUnits,
        pullThrough: totalPullThrough,
      });

      res.json({
        actors,
        totals,
        tierSummary,
        dateRange: {
          startDate: effectiveStartDate.toISOString(),
          endDate: effectiveEndDate.toISOString(),
        },
      });
    } catch (error: any) {
      logError("Error fetching toptiering data", error, { userId: req.userId });
      res
        .status(500)
        .json({ error: error.message || "Failed to fetch toptiering data" });
    }
  },
);

/**
 * GET /api/loans/sales-scorecard
 * Get TTS (TopTiering Score) Sales Scorecard data with weighted scoring system
 *
 * DOCUMENTATION: See docs/TTS_TOPTIERING_SCORE_SPECIFICATION.md for complete specification
 *
 * Based on Qlik Performance App "Sales Scorecard" sheet
 *
 * IMPORTANT: Qlik Discrepancy Documented
 * ======================================
 * Our TTS scores may differ from Qlik by ~5-15 points due to a discovered inconsistency
 * in the Qlik app where vCCA_ScorecardVolumeAvg etc. use different (stale) values than
 * what's displayed in summary tables. Our implementation is internally consistent -
 * display values match calculation values. See docs for full analysis.
 *
 * TTS Formula:
 * TTS = (VolumeRating×2 + MarginRating×2 + TurnTimeRating×0.5 +
 *        PullThroughRating×1.5 + UnitRating×2 + ConcessionRating×2) / TotalWeight
 *
 * Where TotalWeight = 8 (concession excluded) or 10 (concession included)
 * Concession is excluded when company average concession = 0
 *
 * Weights: Volume=2, Margin=2, TurnTime=0.5, PullThrough=1.5, Unit=2, Concession=2
 *
 * Rating Formula: (Actor Value / Company Avg) × 100 (where 100 = average)
 * Turn Time uses INVERSE: (1/ActorTurnTime) / Avg(1/TurnTime) × 100
 *
 * Date Range: Rolling 13 Months (current month + 12 previous) from vMaxDate
 * vMaxDate = max(last_modified_date) from database
 *
 * Query Parameters:
 * - actor: 'branch' | 'loan_officer' (default: 'loan_officer')
 * - startDate: ISO date string (default: 13 months ago - rolling 13 months)
 * - endDate: ISO date string (default: today)
 * - channel_group: Optional channel filter (e.g., 'Retail')
 */
router.get(
  "/sales-scorecard",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    // DEPRECATED: Use /api/scorecard/sales instead
    addDeprecationHeaders(res, "/api/scorecard/sales");
    try {
      // Get tenant pool from context (same as other loan endpoints)
      const tenantPool = getTenantContext(req).tenantPool;

      const actor = (req.query.actor as string) || "loan_officer";
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      // Qlik TTS scorecard uses vCCA_ChannelGroup = 'Retail' by default
      // Frontend should pass channel_group - if not provided, include all channels
      const channelGroup = req.query.channel_group as string | undefined;

      // Validate actor type
      if (!["branch", "loan_officer"].includes(actor)) {
        return res.status(400).json({
          error: 'Invalid actor type. Must be "branch" or "loan_officer"',
        });
      }

      const actorColumn = actor === "branch" ? "branch" : "loan_officer";

      // isActorMissing is now imported from shared utilities

      // CRITICAL: TTS Score uses Rolling13MonthFlag, NOT [Date Interval]={'Last 12 Months'}
      //
      // Rolling13MonthFlag definition (Script.csv line 1838):
      //   If([$(_field)]>$(vMaxDate),'No',
      //      if([$(_field)]>=AddMonths(MonthEnd($(vMaxDate)),-13,1),'Yes','No'))
      //
      // IMPORTANT: vMaxDate in Qlik is the MAX date in the data (max funding_date), NOT today!
      //   Let vMaxDate = Num(Peek('MaxDate', 0, 'MinMax'));
      //
      // This means:
      //   - End date: vMaxDate (max funding_date in data)
      //   - Start date: First day of month, 13 months before MonthEnd(vMaxDate)
      //   - INCLUDES the month of vMaxDate and goes back 13 months from end of that month
      //
      // Example if vMaxDate = Jan 20, 2026 (most recent loan):
      //   - MonthEnd(Jan 20, 2026) = Jan 31, 2026
      //   - AddMonths(Jan 31, 2026, -13, 1) = Dec 1, 2024 (first day, 13 months before end of Jan)
      //   - Range: Dec 1, 2024 to Jan 20, 2026

      // Get vMaxDate from data
      // CRITICAL: Qlik uses Max("Last Modified Date"), NOT max funding_date!
      // "Last Modified Date" represents when the loan record was last modified in Encompass
      // We use updated_at as a proxy for this, OR we can look at the max of several date fields
      // Also get date distribution to debug
      const maxDateResult = await tenantPool.query(`
      SELECT 
        MAX(funding_date) as max_funding_date,
        MAX(funding_date)::text as max_funding_date_raw,
        MAX(updated_at) as max_updated_at,
        MAX(updated_at)::text as max_updated_at_raw,
        COUNT(*) FILTER (WHERE funding_date >= CURRENT_DATE - INTERVAL '7 days') as funded_last_7_days,
        COUNT(*) FILTER (WHERE funding_date >= '2026-01-01') as funded_jan_2026,
        COUNT(*) FILTER (WHERE funding_date >= '2024-12-01') as funded_since_dec_2024
      FROM public.loans 
      WHERE funding_date IS NOT NULL
    `);

      // CRITICAL: Qlik uses Max("Last Modified Date") for vMaxDate, NOT max funding_date!
      // "Last Modified Date" in Encompass = when the loan record was last modified IN ENCOMPASS
      // This is stored in the Qlik data model and may differ from our updated_at
      //
      // Qlik vMaxDate = 46044.503159722 (Excel serial date) ≈ January 17, 2026
      // To convert: Qlik uses Excel dates where 1 = Jan 1, 1900
      //
      // For now, check if there's a last_modified_date field, otherwise use a query to find
      // the actual max date that matches Qlik's logic
      const rawMaxFundingDate = maxDateResult.rows[0]?.max_funding_date_raw;
      const rawMaxUpdatedAt = maxDateResult.rows[0]?.max_updated_at_raw;

      // Check if we have a last_modified_date field from Encompass
      const lastModifiedResult = await tenantPool.query(`
      SELECT 
        MAX(last_modified_date) as max_last_modified,
        MAX(last_modified_date)::text as max_last_modified_raw
      FROM public.loans 
      WHERE last_modified_date IS NOT NULL
    `);

      let vMaxDate: Date;
      const rawLastModified = lastModifiedResult.rows[0]?.max_last_modified_raw;

      if (lastModifiedResult.rows[0]?.max_last_modified) {
        // Use last_modified_date if available (matches Qlik's "Last Modified Date")
        vMaxDate = new Date(lastModifiedResult.rows[0].max_last_modified);
      } else if (maxDateResult.rows[0]?.max_updated_at) {
        // Fall back to updated_at
        vMaxDate = new Date(maxDateResult.rows[0].max_updated_at);
      } else {
        vMaxDate = new Date();
      }

      // End date: vMaxDate (max last_modified_date in data, matching Qlik)
      const effectiveEndDate = vMaxDate;
      // Start date: First day of the month, 12 months before vMaxDate's month
      // "Rolling 13 Months" = current month + 12 previous months = 13 months total
      // For vMaxDate = Jan 22, 2026: Start = Jan 1, 2025 (NOT Dec 1, 2024)
      // Jan 2025 to Jan 2026 = 13 months
      const monthEndOfVMaxDate = new Date(
        vMaxDate.getFullYear(),
        vMaxDate.getMonth() + 1,
        0,
      ); // Last day of vMaxDate's month
      const twelveMonthsBeforeVMaxDateMonth = new Date(
        vMaxDate.getFullYear(),
        vMaxDate.getMonth() - 12,
        1,
      );
      const effectiveStartDate = twelveMonthsBeforeVMaxDateMonth;

      // Also need today's date for "current production" check (last 30 days from today)
      const now = new Date();

      // Get detailed loan counts for debugging date range issues
      // Also get monthly breakdown to compare with Qlik
      const detailedCountsResult = await tenantPool.query(
        `
      SELECT 
        COUNT(*) FILTER (WHERE funding_date IS NOT NULL AND funding_date >= '2024-12-01' AND funding_date <= $1) as funded_in_range,
        COUNT(*) FILTER (WHERE funding_date IS NOT NULL AND funding_date >= '2024-12-01' AND funding_date <= '2025-12-31') as funded_dec24_to_dec25,
        COUNT(*) FILTER (WHERE funding_date IS NOT NULL AND funding_date >= '2025-01-01' AND funding_date <= '2025-12-31') as funded_2025_only,
        COUNT(*) FILTER (WHERE funding_date IS NOT NULL AND funding_date >= '2024-12-01' AND funding_date <= '2024-12-31') as funded_dec_2024,
        COUNT(*) FILTER (WHERE funding_date IS NOT NULL AND funding_date >= '2026-01-01') as funded_jan_2026_plus
      FROM public.loans
    `,
        [vMaxDate],
      );

      // Get monthly breakdown for Retail channel to compare with Qlik
      // Note: "Retail" only includes channels with "retail" - "brokered" is TPO
      const monthlyBreakdown = await tenantPool.query(
        `
      SELECT 
        TO_CHAR(funding_date, 'YYYY-MM') as month,
        COUNT(*) as loan_count
      FROM public.loans
      WHERE funding_date IS NOT NULL
        AND funding_date >= '2024-12-01'
        AND funding_date <= $1
        AND channel ILIKE '%retail%'
      GROUP BY TO_CHAR(funding_date, 'YYYY-MM')
      ORDER BY month
    `,
        [vMaxDate],
      );

      const monthlyData = monthlyBreakdown.rows.reduce((acc: any, row: any) => {
        acc[row.month] = parseInt(row.loan_count);
        return acc;
      }, {});

      // Date range log simplified
      logInfo("[SalesScorecard] DateRange", {
        start: effectiveStartDate.toISOString().split("T")[0],
        end: effectiveEndDate.toISOString().split("T")[0],
      });

      // TTS Weight Configuration - matches Qlik eCCA_TVI_Score_13_Months formula (6 components)
      // From TTS_FORMULA_FINDINGS.md: Qlik uses ALL 6 components with NO compound scaling
      // Weights from XML (divided by 10): Volume=2, Margin=2, TurnTime=0.5, PullThrough=1.5, Unit=2, Concession=2
      // Compound scaling is COMMENTED OUT in Qlik - do NOT multiply by VolumeRating/100 or MarginRating/100
      const weightConfig = {
        volume: 2, // 20% / 10 - Volume Rating weight
        margin: 2, // 20% / 10 - Margin Rating weight
        turnTime: 0.5, // 5% / 10 - Turn Time Rating weight (NO compound scaling)
        pullThrough: 1.5, // 15% / 10 - Pull Through Rating weight (NO compound scaling)
        unit: 2, // 20% / 10 - Unit Rating weight
        concession: 2, // 20% / 10 - Concession Rating weight (conditional)
      };
      // TASK 6: Concession inclusion will be calculated after company averages are computed
      // (moved to after companyAverages calculation)

      // Starting log simplified
      logInfo("[SalesScorecard] Start", { actor, channel: channelGroup });

      // OPTIMIZED: Use SQL filtering for date, channel, and actor instead of JavaScript
      const channelClause = buildChannelWhereClause(channelGroup);
      const startDateStr = formatDateForSQL(effectiveStartDate);
      const endDateStr = formatDateForSQL(effectiveEndDate);

      // PHASE 1: Fetch FUNDED loans with SQL filtering (main data for scorecard)
      // Note: DateType={'Funding'} in Qlik - we filter by funding_date
      // Branch Concession from Qlik: "Branch Price Concession" (Fields.3375) - stored as percentage
      // Added rate_lock_buy_side_base_price_rate for Revenue calculation per Qlik Transform.qvs
      const fundedLoansResult = await retryQuery(
        () =>
          tenantPool.query(
            `SELECT 
          loan_id, loan_amount, loan_type, loan_purpose, current_loan_status, channel,
          funding_date, closing_date, application_date, started_date,
          branch, loan_officer, fico_score, ltv_ratio, be_dti_ratio,
          origination_points, orig_fee_borr_pd, orig_fees_seller, cd_lender_credits,
          branch_price_concession, occupancy_type, borr_self_employed,
          rate_lock_buy_side_base_price_rate,
          number_of_conditions, date_warehoused, investor_status, investor_purchase_date
         FROM loans
         WHERE funding_date IS NOT NULL
           AND funding_date >= $1
           AND funding_date <= $2
           AND ${actorColumn} IS NOT NULL
           AND TRIM(${actorColumn}) != ''
           AND UPPER(TRIM(${actorColumn})) NOT IN ('99-MISSING', 'MISSING', 'NO LO FOUND', 'NO LOAN OFFICER', 'NO BRANCH FOUND', 'UNKNOWN')
           AND UPPER(TRIM(${actorColumn})) NOT LIKE '99-%'
           ${channelClause}`,
            [startDateStr, endDateStr],
          ),
        2,
        500,
      );
      const fundedLoans = fundedLoansResult.rows;

      // PHASE 2: Fetch supporting data for pull-through, lost opportunity, etc.
      // These need application_date range, not funding_date
      const supportingLoansResult = await retryQuery(
        () =>
          tenantPool.query(
            `SELECT 
          loan_id, loan_amount, loan_type, loan_purpose, current_loan_status, channel,
          funding_date, closing_date, application_date, started_date,
          branch, loan_officer, fico_score, ltv_ratio, be_dti_ratio,
          origination_points, orig_fee_borr_pd, orig_fees_seller, cd_lender_credits,
          rate_lock_buy_side_base_price_rate
         FROM loans
         WHERE COALESCE(started_date, application_date) >= $1
           AND COALESCE(started_date, application_date) <= $2
           ${channelClause}`,
            [startDateStr, endDateStr],
          ),
        2,
        500,
      );
      const channelFilteredLoans = supportingLoansResult.rows;

      // Data count (simplified)
      logInfo("[SalesScorecard] Data", {
        funded: fundedLoans.length,
        supporting: channelFilteredLoans.length,
      });

      // PHASE 4: Filter for STARTED loans in date range (for pull-through)
      const startedLoans = channelFilteredLoans.filter((l: any) => {
        const startedDate = l.started_date || l.application_date;
        if (!startedDate) return false;
        const sd = new Date(startedDate);
        return sd >= effectiveStartDate && sd <= effectiveEndDate;
      });

      // Total applications in date range - used as denominator for Lost Opp % and Denied %
      // Qlik uses DateType={'Application'} which counts all loans with application_date in range
      const totalApplications = channelFilteredLoans.filter((l: any) => {
        const appDate = l.application_date;
        if (!appDate) return false;
        const ad = new Date(appDate);
        return ad >= effectiveStartDate && ad <= effectiveEndDate;
      }).length;

      // PHASE 5: Filter for LOST OPPORTUNITY loans (withdrawn/cancelled - NOT denied) in date range
      // Qlik: [Current Loan Status]*={"*withdraw*","*not accepted*","*incomp*"}
      // Note: Denied loans are counted SEPARATELY in Qlik
      const lostOpportunityLoans = channelFilteredLoans.filter((l: any) => {
        const status = (l.current_loan_status || "").toUpperCase();
        // Lost Opportunity = withdrawn, not accepted, incomplete, cancelled (but NOT denied)
        const isLostOpportunity =
          status.includes("WITHDRAWN") ||
          status.includes("CANCELLED") ||
          status.includes("NOT ACCEPTED") ||
          status.includes("INCOMPLETE");
        if (!isLostOpportunity) return false;

        // Use application_date for lost opportunities
        const appDate = l.application_date;
        if (!appDate) return false;
        const ad = new Date(appDate);
        return ad >= effectiveStartDate && ad <= effectiveEndDate;
      });

      // Denied loans - separate from lost opportunity per Qlik
      // Qlik: [Current Loan Status]*={"*denied*"}
      const deniedLoans = channelFilteredLoans.filter((l: any) => {
        const status = (l.current_loan_status || "").toUpperCase();
        if (!status.includes("DENIED") && !status.includes("DECLINED"))
          return false;

        const appDate = l.application_date;
        if (!appDate) return false;
        const ad = new Date(appDate);
        return ad >= effectiveStartDate && ad <= effectiveEndDate;
      });

      // Additional debug: count loans by date type and missing LO
      // Note: fundedLoans now only includes loans with funding_date (to match Qlik's DateType='Funding')
      const loansWithClosingDate = fundedLoans.filter(
        (l: any) => l.closing_date,
      ).length;
      const loansWithoutClosingDate = fundedLoans.filter(
        (l: any) => !l.closing_date,
      ).length;
      const debugTotalVolume = fundedLoans.reduce(
        (sum: number, l: any) => sum + (parseFloat(l.loan_amount) || 0),
        0,
      );
      const loansWithZeroAmount = fundedLoans.filter(
        (l: any) => !l.loan_amount || parseFloat(l.loan_amount) === 0,
      ).length;

      // Debug: count loans excluded due to missing LO
      const fundedLoansBeforeMissingFilter = channelFilteredLoans.filter(
        (l: any) => {
          if (!l.funding_date) return false;
          const fd = new Date(l.funding_date);
          return fd >= effectiveStartDate && fd <= effectiveEndDate;
        },
      ).length;
      const loansExcludedDueToMissingLO =
        fundedLoansBeforeMissingFilter - fundedLoans.length;

      // Count loans with valid Base Buy rate (for revenue calculation per Qlik filter)
      const loansWithValidBaseBuy = fundedLoans.filter((l: any) => {
        const baseBuy = parseFloat(l.rate_lock_buy_side_base_price_rate) || 0;
        return baseBuy > 0;
      }).length;

      // Simplified loan counts log
      logInfo("[SalesScorecard] Loans", {
        funded: fundedLoans.length,
        withBaseBuy: loansWithValidBaseBuy,
      });

      // Helper functions
      // NOTE: calcLoanRevenue is imported from scorecard-utils.ts for consistency across the codebase
      // Revenue calculation per Qlik Transform.qvs: [Base Buy ($)] + Orig Fee Borr Pd + Orig Fees Seller - CD Lender Credits

      const calcTurnTime = (l: any): number | null => {
        const appDate = l.application_date;
        // Qlik uses [App-Close] for turn time, which is application_date to closing_date
        // The DateType={'Funding'} filter selects WHICH loans to include (funded loans)
        // But the turn time metric itself uses closing_date, not funding_date
        // See: Avg(Aggr(Avg({<[App-Close]*={"">0""},DateType*={'Funding'}...>}[App-Close]),[Loan Officer]))
        const closeDate = l.closing_date;
        if (!appDate || !closeDate) return null; // Exclude loans without closing_date
        const diffMs =
          new Date(closeDate).getTime() - new Date(appDate).getTime();
        return Math.round(diffMs / (1000 * 60 * 60 * 24));
      };

      // PHASE 6: Group funded loans by actor and calculate raw metrics
      interface ActorMetrics {
        units: number;
        volume: number;
        revenue: number;
        marginBpsValues: number[]; // Margin (BPS) values per loan for averaging
        concessions: number[]; // Price concessions for concession rating
        turnTimes: number[];
        complexityScores: number[]; // Loan complexity scores per Qlik
        fundedCount: number;
        startedCount: number;
        applicationCount: number; // Total applications for this actor (for pull-through denominator)
        pullThroughFundedCount: number; // Loans with funding date (for pull-through numerator)
        lostOpportunityUnits: number;
        lostOpportunityRevenue: number;
        deniedUnits: number;
        ficoWeighted: { sum: number; weight: number };
        ltvWeighted: { sum: number; weight: number };
        dtiWeighted: { sum: number; weight: number };
      }

      const actorMap = new Map<string, ActorMetrics>();

      // Count started loans per actor (legacy - kept for compatibility)
      const actorStartedCount = new Map<string, number>();
      startedLoans.forEach((l: any) => {
        const actorName = l[actorColumn];
        if (isActorMissing(actorName)) return; // Use helper function for consistent filtering
        actorStartedCount.set(
          actorName,
          (actorStartedCount.get(actorName) || 0) + 1,
        );
      });

      // Count applications per actor (for pull-through calculation)
      // Qlik Pull Through formula from Expressions.csv line 1391-1450:
      //   Numerator: Count({<DateType*={'Application'}, Rolling13MonthFlag*={Yes}, [Active Loan Flag]*={No},
      //                     [Pull Through Originated Flag]*={Yes}, ...>}[Loan Number])
      //   Denominator: Count({<DateType*={'Application'}, Rolling13MonthFlag*={Yes}, [Active Loan Flag]*={No}, ...>}[Loan Number])
      // Key points:
      //   - BOTH use DateType={'Application'} (application_date) in rolling 13-month window
      //   - BOTH filter by [Active Loan Flag]={No} (inactive loans only)
      //   - Numerator adds [Pull Through Originated Flag]={Yes} (has funding_date)
      const actorApplicationCountForPullThrough = new Map<string, number>(); // Denominator: all inactive loans
      const actorFundedCountForPullThrough = new Map<string, number>(); // Numerator: inactive loans with funding

      channelFilteredLoans.forEach((l: any) => {
        const actorName = l[actorColumn];
        if (isActorMissing(actorName)) return; // Use helper function for consistent filtering

        // Check application date is in the rolling 13-month window
        const appDate = l.application_date;
        if (!appDate) return;
        const ad = new Date(appDate);
        if (ad < effectiveStartDate || ad > effectiveEndDate) return;

        // Check if loan is inactive ([Active Loan Flag]={No})
        // Qlik's Active Loan Flag definition (from transform-logic.md):
        //   if("Current Loan Status" = 'Active Loan' AND Len([Application Date])>0, 'Yes', 'No')
        // So [Active Loan Flag]={No} means: status !== 'Active Loan' OR no application date
        // Since we already filtered for application_date above, we just check status
        const status = (l.current_loan_status || "").toUpperCase().trim();
        const isActiveLoan = status === "ACTIVE LOAN";
        const isInactive = !isActiveLoan; // Any status other than 'Active Loan' is inactive

        if (!isInactive) return; // Skip active loans

        // Qlik uses funding_date for [Pull Through Originated Flag], NOT closing_date
        const hasFundingDate = !!l.funding_date;

        // Count as application (denominator) - all inactive loans with application_date in range
        actorApplicationCountForPullThrough.set(
          actorName,
          (actorApplicationCountForPullThrough.get(actorName) || 0) + 1,
        );

        // Count if funded (numerator) - [Pull Through Originated Flag]={Yes} = has funding_date
        // Qlik's Pull Through Originated Flag is set based on funding_date, not closing_date
        if (hasFundingDate) {
          actorFundedCountForPullThrough.set(
            actorName,
            (actorFundedCountForPullThrough.get(actorName) || 0) + 1,
          );
        }
      });

      // Count lost opportunity loans per actor
      const actorLostOpportunity = new Map<
        string,
        { units: number; revenue: number }
      >();
      lostOpportunityLoans.forEach((l: any) => {
        const actorName = l[actorColumn];
        if (isActorMissing(actorName)) return; // Use helper function for consistent filtering

        if (!actorLostOpportunity.has(actorName)) {
          actorLostOpportunity.set(actorName, { units: 0, revenue: 0 });
        }
        const data = actorLostOpportunity.get(actorName)!;
        data.units += 1;
        data.revenue += calcLoanRevenue(l);
      });

      // Count denied loans per actor
      const actorDenied = new Map<string, number>();
      deniedLoans.forEach((l: any) => {
        const actorName = l[actorColumn];
        if (isActorMissing(actorName)) return; // Use helper function for consistent filtering
        actorDenied.set(actorName, (actorDenied.get(actorName) || 0) + 1);
      });

      // Process funded loans
      fundedLoans.forEach((l: any) => {
        const actorName = l[actorColumn];
        if (isActorMissing(actorName)) return; // Use helper function for consistent filtering

        if (!actorMap.has(actorName)) {
          const lostOpp = actorLostOpportunity.get(actorName) || {
            units: 0,
            revenue: 0,
          };
          actorMap.set(actorName, {
            units: 0,
            volume: 0,
            revenue: 0,
            marginBpsValues: [],
            concessions: [],
            turnTimes: [],
            complexityScores: [],
            fundedCount: 0,
            startedCount: actorStartedCount.get(actorName) || 0,
            applicationCount:
              actorApplicationCountForPullThrough.get(actorName) || 0, // Application count for pull-through denominator (inactive loans with app_date in range)
            pullThroughFundedCount:
              actorFundedCountForPullThrough.get(actorName) || 0, // Funded count for pull-through numerator (inactive loans with funding_date)
            lostOpportunityUnits: lostOpp.units,
            lostOpportunityRevenue: lostOpp.revenue,
            deniedUnits: actorDenied.get(actorName) || 0,
            ficoWeighted: { sum: 0, weight: 0 },
            ltvWeighted: { sum: 0, weight: 0 },
            dtiWeighted: { sum: 0, weight: 0 },
          });
        }

        const actorData = actorMap.get(actorName)!;
        const loanAmount = parseFloat(l.loan_amount) || 0;
        const revenue = calcLoanRevenue(l);
        const turnTime = calcTurnTime(l);

        // Qlik filters by [Rate Lock Buy Side Base Price Rate] > 0 for revenue calculations
        // Only include loans with a valid Base Buy price in revenue totals
        const baseBuy = parseFloat(l.rate_lock_buy_side_base_price_rate) || 0;
        const hasValidBaseBuy = baseBuy > 0;

        actorData.units += 1;
        actorData.volume += loanAmount;
        actorData.fundedCount += 1;

        // Revenue: Only include loans with Rate Lock Buy Side Base Price Rate > 0
        // Per Qlik: sum({<[Rate Lock Buy Side Base Price Rate] = {">0"}>}[Revenue])
        if (hasValidBaseBuy) {
          actorData.revenue += revenue;

          // Track Margin (BPS) per loan for Qlik Margin Rating calculation
          // Qlik uses Avg([Margin (BPS)]) per actor, NOT total revenue
          // Margin BPS = (Revenue / Loan Amount) * 10000
          if (loanAmount > 0) {
            const marginBps = (revenue / loanAmount) * 10000;
            actorData.marginBpsValues.push(marginBps);
          }
        }

        if (turnTime !== null && turnTime > 0) {
          actorData.turnTimes.push(turnTime);
        }

        // Track price concessions from Qlik: Branch Concession ($) = (Branch Concession / 100) * Loan Amount
        // Qlik only uses Branch Concession for TTS calculations (Corporate Concession is loaded but not used)
        // The database stores branch_price_concession as a percentage (e.g., 0.25 = 0.25%)
        const branchConcessionPct = parseFloat(l.branch_price_concession) || 0;

        if (branchConcessionPct !== 0 && loanAmount > 0) {
          // Calculate Branch Concession ($): (Branch Concession / 100) * Loan Amount
          const concessionDollars = (branchConcessionPct / 100) * loanAmount;
          actorData.concessions.push(concessionDollars);
        }

        // Track loan complexity score (canonical calcLoanComplexity from scorecard-utils)
        const complexityScore = calcLoanComplexity(toLoanComplexityData(l));
        actorData.complexityScores.push(complexityScore);

        // Complexity logging removed for cleaner output

        // Weighted averages
        if (l.fico_score && loanAmount > 0) {
          actorData.ficoWeighted.sum += parseFloat(l.fico_score) * loanAmount;
          actorData.ficoWeighted.weight += loanAmount;
        }
        if (l.ltv_ratio && loanAmount > 0) {
          actorData.ltvWeighted.sum += parseFloat(l.ltv_ratio) * loanAmount;
          actorData.ltvWeighted.weight += loanAmount;
        }
        if (l.be_dti_ratio && loanAmount > 0) {
          actorData.dtiWeighted.sum += parseFloat(l.be_dti_ratio) * loanAmount;
          actorData.dtiWeighted.weight += loanAmount;
        }
      });

      // PHASE 7: Calculate company-wide averages and totals
      // Calculate totals for lost opportunity and denied (company-wide)
      const totalLostOpportunityUnits = lostOpportunityLoans.length;
      const totalLostOpportunityRevenue = lostOpportunityLoans.reduce(
        (sum: number, l: any) => sum + calcLoanRevenue(l),
        0,
      );
      const totalDeniedUnits = deniedLoans.length;

      // Calculate company-wide weighted averages
      let totalFicoWeightedSum = 0,
        totalFicoWeight = 0;
      let totalLtvWeightedSum = 0,
        totalLtvWeight = 0;
      let totalDtiWeightedSum = 0,
        totalDtiWeight = 0;
      // New metrics for summary table
      let totalWhDaysWeightedSum = 0,
        totalWhDaysWeight = 0;
      let totalConditionsSum = 0,
        totalConditionsCount = 0;

      fundedLoans.forEach((l: any) => {
        const loanAmount = parseFloat(l.loan_amount) || 0;
        if (l.fico_score && loanAmount > 0) {
          totalFicoWeightedSum += parseFloat(l.fico_score) * loanAmount;
          totalFicoWeight += loanAmount;
        }
        if (l.ltv_ratio && loanAmount > 0) {
          totalLtvWeightedSum += parseFloat(l.ltv_ratio) * loanAmount;
          totalLtvWeight += loanAmount;
        }
        // WA DTI - Qlik filters with [DTI Out of Range Flag]={No}, typical DTI is 0-100%
        if (l.be_dti_ratio && loanAmount > 0) {
          const dtiRatio = parseFloat(l.be_dti_ratio);
          // Filter out unreasonable DTI values (Qlik uses DTI Out of Range Flag)
          // Valid DTI range: 0-100% (some edge cases up to 150%)
          if (dtiRatio > 0 && dtiRatio <= 150) {
            totalDtiWeightedSum += dtiRatio * loanAmount;
            totalDtiWeight += loanAmount;
          }
        }

        // WA W-H Days (Warehouse Holding Days) - Qlik filter: [Investor Status] != 'Purchased', Channel != 'Brokered'
        // Qlik Transform.qvs line 180-181:
        // If(Len("Investor Purchase Date")>0, "Investor Purchase Date" - "Funding Date",
        // If(Len("Investor Purchase Date")=0 AND Len("Funding Date")>0, vMaxDate - "Funding Date", 0))
        const investorStatus = (l.investor_status || "").toLowerCase();
        const channel = (l.channel || "").toLowerCase();
        const isPurchased = investorStatus.includes("purchased");
        const isBrokered = channel.includes("broker");

        // Calculate W-H Days using Qlik's exact logic
        if (l.funding_date && loanAmount > 0 && !isPurchased && !isBrokered) {
          const fundingDate = new Date(l.funding_date);
          let whDays = 0;

          if (l.investor_purchase_date) {
            // Has purchase date: W-H Days = Investor Purchase Date - Funding Date
            const purchaseDate = new Date(l.investor_purchase_date);
            whDays =
              (purchaseDate.getTime() - fundingDate.getTime()) /
              (1000 * 60 * 60 * 24);
          } else {
            // No purchase date but has funding date: W-H Days = vMaxDate - Funding Date
            // vMaxDate is effectiveEndDate (max date in our data range)
            whDays =
              (effectiveEndDate.getTime() - fundingDate.getTime()) /
              (1000 * 60 * 60 * 24);
          }

          if (whDays >= 0 && whDays < 365) {
            // Sanity check: exclude unreasonable values
            totalWhDaysWeightedSum += whDays * loanAmount;
            totalWhDaysWeight += loanAmount;
          }
        }

        // Average Conditions
        if (
          l.number_of_conditions !== null &&
          l.number_of_conditions !== undefined
        ) {
          const conditions = parseInt(l.number_of_conditions) || 0;
          if (conditions >= 0) {
            totalConditionsSum += conditions;
            totalConditionsCount++;
          }
        }
      });

      // Calculate denied revenue (revenue from denied loans)
      const totalDeniedRevenue = deniedLoans.reduce(
        (sum: number, l: any) => sum + calcLoanRevenue(l),
        0,
      );

      // Debug: Log W-H Days calculation info
      const loansWithInvestorPurchaseDate = fundedLoans.filter(
        (l: any) => l.investor_purchase_date,
      ).length;
      const loansWithValidWhDays = fundedLoans.filter((l: any) => {
        if (!l.funding_date) return false;
        const investorStatus = (l.investor_status || "").toLowerCase();
        const channel = (l.channel || "").toLowerCase();
        return (
          !investorStatus.includes("purchased") && !channel.includes("broker")
        );
      }).length;
      logInfo("[SalesScorecard] W-H Days Debug", {
        loansWithInvestorPurchaseDate,
        loansWithValidWhDays,
        totalWhDaysWeight: totalWhDaysWeight.toFixed(0),
        avgWhDays:
          totalWhDaysWeight > 0
            ? (totalWhDaysWeightedSum / totalWhDaysWeight).toFixed(2)
            : "N/A",
      });

      // Aggregate metrics across all actors
      // Qlik Rating Formulas require TOTALS per actor, then average of totals

      // TASK 5: Current Production Filter
      // IMPORTANT: After extensive analysis, the Qlik company averages appear to include ALL actors
      // with production in the date range, not just those with "current production" (last 30 days).
      // The Current Production Check in Qlik is used for DISPLAYING values (showing Null for inactive),
      // but the company AVERAGES include all actors with [CCA Scorecard ...] > 0.
      //
      // Evidence: Qlik shows avgUnitsPerActor=44.48, which with our data (1957 funded loans)
      // implies ~44 actors. If we filter to 32 actors, we get avgUnitsPerActor=61.2.
      //
      // DISABLING current production filter for company averages - include all actors with production
      // The Current Production filter only affects which actors are SHOWN in the UI, not the averages.

      // Use all actors with production in the date range for company averages
      const filteredActorMap = new Map<string, ActorMetrics>();
      actorMap.forEach((data, name) => {
        // Include all actors that have funded loans in the date range
        // Qlik's vCCA_ScorecardVolumeAvg uses: [CCA Scorecard Volume] *= {">0"}
        // which includes ALL actors with volume > 0 in the date range
        if (data.units > 0) {
          filteredActorMap.set(name, data);
        }
      });

      // Still track current production for display purposes (which actors to show)
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // Use TODAY, not effectiveEndDate
      const actorsWithCurrentProduction = new Set<string>();
      channelFilteredLoans.forEach((l: any) => {
        const actorName = l[actorColumn];
        if (isActorMissing(actorName)) return;

        const fundDate = l.funding_date ? new Date(l.funding_date) : null;
        const appDate = l.application_date
          ? new Date(l.application_date)
          : null;
        const status = (l.current_loan_status || "").toUpperCase();
        const isActive =
          !status.includes("WITHDRAWN") &&
          !status.includes("DENIED") &&
          !status.includes("CANCELLED") &&
          !status.includes("DECLINED") &&
          !status.includes("ORIGINATED") &&
          !status.includes("PURCHASED") &&
          !fundDate;

        // Current production = funded loan in last 30 days OR active loan in last 30 days (from TODAY)
        if (fundDate && fundDate >= thirtyDaysAgo && fundDate <= now) {
          actorsWithCurrentProduction.add(actorName);
        } else if (
          isActive &&
          appDate &&
          appDate >= thirtyDaysAgo &&
          appDate <= now
        ) {
          actorsWithCurrentProduction.add(actorName);
        }
      });

      // Use filteredActorMap size (actors with current production) for actor count
      const actorCount = filteredActorMap.size;

      // Return empty response if no actors found (after filtering for current production)
      if (actorCount === 0) {
        return res.json({
          actors: [],
          companyAverages: {
            avgLoanAmount: 0,
            avgRevenue: 0,
            avgPullThrough: 0,
            avgTurnTime: 0,
          },
          weightConfig,
          tierSummary: {
            top: createEmptyTierSummary(),
            second: createEmptyTierSummary(),
            bottom: createEmptyTierSummary(),
          },
          totals: {
            actorCount: 0,
            units: 0,
            volume: 0,
            revenue: 0,
            revenueBps: 0,
            avgTurnTime: 0,
            pullThrough: 0,
            waFico: 0,
            waLtv: 0,
            waDti: 0,
            waWhDays: 0,
            avgConditions: 0,
            lostOpportunityUnits: 0,
            lostOpportunityUnitsPercent: 0,
            lostOpportunityRevenue: 0,
            deniedUnits: 0,
            deniedUnitsPercent: 0,
            deniedRevenue: 0,
            lostOpportunityAndDeniedRevenue: 0,
            lostOpportunityAndDeniedRevenueBps: 0,
            avgLoRevenue: 0,
            avgLoUnits: 0,
            avgLoUnitsPerMonth: 0,
            avgLoVolume: 0,
            avgLoVolumePerMonth: 0,
            avgTtsScore: 0,
            loanComplexityScore: 100,
          },
          dateRange: {
            startDate: effectiveStartDate.toISOString(),
            endDate: effectiveEndDate.toISOString(),
          },
        });
      }

      let totalUnits = 0;
      let totalVolume = 0;
      let totalRevenue = 0;
      let totalPullThroughSum = 0;
      let pullThroughCount = 0;
      let totalInverseTurnTimeSum = 0; // Sum of (1/turn_time) for Qlik formula
      let turnTimeActorCount = 0;
      let totalConcessionPerActor = 0; // Sum of total concessions per actor
      let concessionActorCount = 0;
      let totalAvgMarginBpsPerActor = 0; // Sum of Avg Margin BPS per actor
      let marginBpsActorCount = 0;

      // Track separate counts for each metric (only actors with value > 0)
      let unitsActorCount = 0;
      let volumeActorCount = 0;
      let revenueActorCount = 0;

      filteredActorMap.forEach((data) => {
        // TASK 4: Qlik filters by [CCA Scorecard ...] *= {">0"} - only include actors with value > 0
        if (data.units > 0) {
          totalUnits += data.units;
          unitsActorCount++;
        }
        if (data.volume > 0) {
          totalVolume += data.volume;
          volumeActorCount++;
        }
        if (data.revenue > 0) {
          totalRevenue += data.revenue;
          revenueActorCount++;
        }

        // Margin BPS per actor - Qlik uses Avg([Margin (BPS)]) per actor
        // vScorecardMarginAvg = Avg(Aggr(Avg([Margin (BPS)]), Actor))
        // Only include actors with margin BPS values > 0
        if (data.marginBpsValues.length > 0) {
          const avgMarginBps =
            data.marginBpsValues.reduce((a, b) => a + b, 0) /
            data.marginBpsValues.length;
          if (avgMarginBps > 0) {
            totalAvgMarginBpsPerActor += avgMarginBps;
            marginBpsActorCount++;
          }
        }

        // TASK 2: Pull-through per actor (percentage) - use correct data from pull-through calculation
        // Qlik uses: application_date for inactive loans, not started_date/funding_date
        const actorPullThrough =
          data.applicationCount > 0
            ? (data.pullThroughFundedCount / data.applicationCount) * 100
            : 0;
        if (actorPullThrough > 0) {
          totalPullThroughSum += actorPullThrough;
          pullThroughCount++;
        }

        // Turn time per actor - Qlik uses INVERSE: Pow(TurnTime, -1)
        // vCCA_ScorecardTurnTimeAvg = Avg(Aggr(Pow([Scorecard TurnTime], -1), Actor))
        // Only include actors with turn times > 0
        if (data.turnTimes.length > 0) {
          const avgTurnTime =
            data.turnTimes.reduce((a, b) => a + b, 0) / data.turnTimes.length;
          if (avgTurnTime > 0) {
            totalInverseTurnTimeSum += 1 / avgTurnTime; // Inverse for Qlik formula
            turnTimeActorCount++;
          }
        }

        // Concession per actor - use TOTAL concession for this actor
        // Only include actors with concessions > 0
        if (data.concessions.length > 0) {
          const totalActorConcession = data.concessions.reduce(
            (a, b) => a + b,
            0,
          );
          if (totalActorConcession > 0) {
            totalConcessionPerActor += totalActorConcession;
            concessionActorCount++;
          }
        }
      });

      // Calculate company-wide averages PER ACTOR (not per loan) for ratings
      // Qlik formulas: Rating = (Actor Value / Avg Actor Value) × 100
      // TASK 4: Each average should divide by the count of actors with that metric > 0, not total actor count
      const avgUnitsPerActor =
        unitsActorCount > 0 ? totalUnits / unitsActorCount : 0;
      const avgVolumePerActor =
        volumeActorCount > 0 ? totalVolume / volumeActorCount : 0;
      const avgRevenuePerActor =
        revenueActorCount > 0 ? totalRevenue / revenueActorCount : 0;
      const avgConcessionPerActor =
        concessionActorCount > 0
          ? totalConcessionPerActor / concessionActorCount
          : 0;
      const avgInverseTurnTime =
        turnTimeActorCount > 0
          ? totalInverseTurnTimeSum / turnTimeActorCount
          : 1 / 30;
      const avgPullThroughPerActor =
        pullThroughCount > 0 ? totalPullThroughSum / pullThroughCount : 70;
      // Margin BPS average: Avg of (Avg Margin BPS per actor) across all actors
      const avgMarginBpsPerActor =
        marginBpsActorCount > 0
          ? totalAvgMarginBpsPerActor / marginBpsActorCount
          : 100;

      // Qlik's exact reference values (from Variables.csv export)
      // Use our calculated averages (Qlik reference values from export were stale)
      const companyAverages = {
        avgUnitsPerActor,
        avgVolumePerActor,
        avgRevenuePerActor,
        avgMarginBpsPerActor,
        avgConcessionPerActor,
        avgPullThrough: avgPullThroughPerActor,
        avgInverseTurnTime,
        avgLoanAmount: totalUnits > 0 ? totalVolume / totalUnits : 0,
        avgRevenue: totalUnits > 0 ? totalRevenue / totalUnits : 0,
      };

      // TASK 6: Concession inclusion logic - Qlik: vCCA_ScorecardIncludeConcession = (vCCA_ScorecardConcessionAvg = 0) + 2
      // In Qlik: True = -1, False = 0
      // If ConcessionAvg = 0: (-1) + 2 = 1 → Pick(1, 0, 2) = 0 → EXCLUDED, weight = 8
      // If ConcessionAvg ≠ 0: 0 + 2 = 2 → Pick(2, 0, 2) = 2 → INCLUDED, weight = 10
      // Concession is included ONLY when average concession is NOT zero
      const includeConcession = companyAverages.avgConcessionPerActor !== 0;
      const totalWeight = includeConcession
        ? weightConfig.volume +
          weightConfig.margin +
          weightConfig.turnTime +
          weightConfig.pullThrough +
          weightConfig.unit +
          weightConfig.concession // = 10
        : weightConfig.volume +
          weightConfig.margin +
          weightConfig.turnTime +
          weightConfig.pullThrough +
          weightConfig.unit; // = 8

      // Company-wide pull-through - Qlik uses average of per-actor pull-through rates
      // The Qlik formula: Avg(Aggr(Count(Funded Inactive)/Count(All Inactive), Actor))
      // avgPullThroughPerActor is calculated above using correct formula with inactive loans
      const companyPullThrough = avgPullThroughPerActor;

      // Company-wide average turn time
      const companyTurnTimes = fundedLoans
        .map((l: any) => calcTurnTime(l))
        .filter((t): t is number => t !== null && t > 0);
      const companyAvgTurnTime =
        companyTurnTimes.length > 0
          ? companyTurnTimes.reduce((a, b) => a + b, 0) /
            companyTurnTimes.length
          : 30;

      // TTS calculation summary log
      // Note: Our averages intentionally differ from Qlik's vCCA_ScorecardVolumeAvg etc.
      // See docs/TTS_TOPTIERING_SCORE_SPECIFICATION.md for detailed explanation of Qlik discrepancies
      logInfo("[SalesScorecard] TTS Summary", {
        actors: filteredActorMap.size,
        totalUnits,
        totalVolume: Math.round(totalVolume),
        avgVolumePerActor: Math.round(avgVolumePerActor),
        avgUnitsPerActor: avgUnitsPerActor.toFixed(2),
        totalWeight,
        includeConcession,
      });

      // PHASE 8: Calculate TTS score for each actor
      interface ActorScore {
        name: string;
        units: number;
        volume: number;
        revenue: number;
        revenueBps: number;
        pullThrough: number;
        avgTurnTime: number;
        waFico: number;
        waLtv: number;
        waDti: number;
        lostOpportunityUnits: number;
        lostOpportunityRevenue: number;
        deniedUnits: number;
        ttsScore: number;
        avgComplexity: number; // Loan complexity score per Qlik Transform.qvs
        tier: "top" | "second" | "bottom";
      }

      const actorScores: ActorScore[] = [];

      actorMap.forEach((data, name) => {
        // Calculate actor's values for ratings
        // Pull Through per Qlik Expressions.csv line 1391-1450:
        //   = Count({DateType={'Application'}, Rolling13MonthFlag={Yes}, [Active Loan Flag]={No}, [Pull Through Originated Flag]={Yes}})
        //     / Count({DateType={'Application'}, Rolling13MonthFlag={Yes}, [Active Loan Flag]={No}})
        // Both use application_date in rolling 13-month window, filter inactive loans only
        // Numerator: inactive loans with funding_date ([Pull Through Originated Flag]={Yes})
        // Denominator: all inactive loans with application_date in range
        const actorPullThrough =
          data.applicationCount > 0
            ? (data.pullThroughFundedCount / data.applicationCount) * 100
            : companyAverages.avgPullThrough;
        const actorAvgTurnTime =
          data.turnTimes.length > 0
            ? data.turnTimes.reduce((a, b) => a + b, 0) / data.turnTimes.length
            : 0;
        const actorTotalConcession =
          data.concessions.length > 0
            ? data.concessions.reduce((a, b) => a + b, 0)
            : 0;

        // Calculate all 6 ratings per Qlik TTS Formula Documentation
        // Qlik ratings use TOTALS per actor compared to AVG TOTALS across actors
        // Rating = (Actor Total Value / Avg Total Value Per Actor) × 100
        // A rating of 100 = average performance

        // 1. Unit Rating: Actor's total units vs avg units per actor
        // Qlik: [Scorecard Output Units] / vScorecardUnitsAverage * 100
        const unitRating =
          companyAverages.avgUnitsPerActor > 0
            ? (data.units / companyAverages.avgUnitsPerActor) * 100
            : 100;

        // 2. Volume Rating: Actor's TOTAL volume vs avg TOTAL volume per actor
        // Qlik: [CCA Scorecard Volume] / vCCA_ScorecardVolumeAvg * 100
        // [CCA Scorecard Volume] = Sum of Loan Amount for the actor
        const volumeRating =
          companyAverages.avgVolumePerActor > 0
            ? (data.volume / companyAverages.avgVolumePerActor) * 100
            : 100;

        // 3. Margin Rating: Actor's TOTAL revenue dollars vs avg TOTAL revenue per actor
        // From TTS_FORMULA_FINDINGS.md: Uses Revenue in DOLLARS, not BPS
        // Qlik: [CCA Scorecard Margin $] / vCCA_ScorecardMarginAvg * 100
        // [CCA Scorecard Margin $] = Sum([Revenue]) per actor
        const marginRating =
          companyAverages.avgRevenuePerActor > 0
            ? (data.revenue / companyAverages.avgRevenuePerActor) * 100
            : 100;

        // 4. Concession Rating: Actor's TOTAL concession vs avg TOTAL concession per actor
        const concessionRating =
          companyAverages.avgConcessionPerActor > 0
            ? (actorTotalConcession / companyAverages.avgConcessionPerActor) *
              100
            : 100;

        // 5. Pull-Through Rating: Actor's pull-through % vs avg pull-through %
        // Qlik: [CCA Scorecard PullThrough] / vCCA_ScorecardPullThroughAvg * 100
        const pullThroughRating =
          companyAverages.avgPullThrough > 0
            ? (actorPullThrough / companyAverages.avgPullThrough) * 100
            : 100;

        // 6. Turn Time Rating: Uses INVERSE formula (shorter time = better rating)
        // Qlik: Pow([CCA Scorecard TurnTime], -1) / vCCA_ScorecardTurnTimeAvg * 100
        // Where vCCA_ScorecardTurnTimeAvg = Avg(Aggr(Pow([Scorecard TurnTime], -1), Actor))
        // Actor Rating = (1/ActorTurnTime) / Avg(1/AllActorTurnTimes) * 100
        const actorInverseTurnTime =
          actorAvgTurnTime > 0 ? 1 / actorAvgTurnTime : 0;
        const turnTimeRating =
          companyAverages.avgInverseTurnTime > 0 && actorInverseTurnTime > 0
            ? (actorInverseTurnTime / companyAverages.avgInverseTurnTime) * 100
            : 100;

        // Calculate TTS score using Qlik's eCCA_TVI_Score_13_Months formula (6 components, NO compound scaling)
        // From TTS_FORMULA_FINDINGS.md: Compound scaling is COMMENTED OUT in Qlik
        // TTS = (VolumeRating×VolumeWeight + MarginRating×MarginWeight + TurnTimeRating×TurnTimeWeight
        //        + PullThroughRating×PullThroughWeight + UnitRating×UnitWeight + ConcessionRating×ConcessionWeight)
        //      / totalWeight
        // Concession is conditional via Pick(vCCA_ScorecardIncludeConcession, 0, value)
        const concessionComponent = includeConcession
          ? concessionRating * weightConfig.concession
          : 0;

        const ttsScore =
          (volumeRating * weightConfig.volume +
            marginRating * weightConfig.margin +
            turnTimeRating * weightConfig.turnTime + // NO compound scaling (commented out in Qlik)
            pullThroughRating * weightConfig.pullThrough + // NO compound scaling (commented out in Qlik)
            unitRating * weightConfig.unit +
            concessionComponent) /
          totalWeight;

        // Debug log for Stanley (top performer reference)
        // Note: Qlik's TTS scores use inconsistent average values - see docs/TTS_TOPTIERING_SCORE_SPECIFICATION.md
        if (name.toLowerCase().includes("stanley")) {
          logInfo("[SalesScorecard] Stanley TTS Debug", {
            units: data.units,
            volume: Math.round(data.volume),
            revenue: Math.round(data.revenue),
            pullThrough: actorPullThrough.toFixed(2) + "%",
            turnTime: actorAvgTurnTime.toFixed(1) + " days",
            ratings: {
              volume: volumeRating.toFixed(2),
              margin: marginRating.toFixed(2),
              unit: unitRating.toFixed(2),
              pullThrough: pullThroughRating.toFixed(2),
              turnTime: turnTimeRating.toFixed(2),
            },
            ttsScore: ttsScore.toFixed(2),
            // Note: Qlik shows ~382 but uses different (inconsistent) average values
            qlikReference: "382.3 (uses different averages - see docs)",
          });
        }

        // Calculate weighted averages
        const waFico =
          data.ficoWeighted.weight > 0
            ? data.ficoWeighted.sum / data.ficoWeighted.weight
            : 0;
        const waLtv =
          data.ltvWeighted.weight > 0
            ? data.ltvWeighted.sum / data.ltvWeighted.weight
            : 0;
        const waDti =
          data.dtiWeighted.weight > 0
            ? data.dtiWeighted.sum / data.dtiWeighted.weight
            : 0;

        // Revenue in basis points
        const revenueBps =
          data.volume > 0 ? (data.revenue / data.volume) * 10000 : 0;

        // Average loan complexity for this actor
        // Raw complexity is 0.0 to ~0.6, but Qlik displays as: (1 + rawComplexity) * 100
        // So 0.14 raw → 114.0 displayed
        const rawAvgComplexity =
          data.complexityScores.length > 0
            ? data.complexityScores.reduce((sum, c) => sum + c, 0) /
              data.complexityScores.length
            : 0;
        const avgComplexity = (1 + rawAvgComplexity) * 100;

        actorScores.push({
          name,
          units: data.units,
          volume: data.volume,
          revenue: data.revenue,
          revenueBps,
          pullThrough: actorPullThrough,
          avgTurnTime: actorAvgTurnTime,
          waFico,
          waLtv,
          waDti,
          lostOpportunityUnits: data.lostOpportunityUnits,
          lostOpportunityRevenue: data.lostOpportunityRevenue,
          deniedUnits: data.deniedUnits,
          ttsScore,
          avgComplexity,
          tier: "top", // Will be assigned below
        });
      });

      // PHASE 9: Assign tiers based on TTS SCORE THRESHOLDS (from Qlik vCCA_TVI_13MonthTiersDim)
      // - Top Tier: TTS >= 120
      // - Second Tier: TTS >= 80 (and < 120)
      // - Bottom Tier: TTS < 80
      // Filter out LOs with 0 units (no production) - they shouldn't be in the scorecard
      const actorsWithProduction = actorScores.filter((a) => a.units > 0);
      actorsWithProduction.sort((a, b) => b.ttsScore - a.ttsScore);

      actorsWithProduction.forEach((actor) => {
        if (actor.ttsScore >= 120) {
          actor.tier = "top";
        } else if (actor.ttsScore >= 80) {
          actor.tier = "second";
        } else {
          actor.tier = "bottom";
        }
      });

      // PHASE 10: Calculate tier summaries
      function createEmptyTierSummary() {
        return {
          count: 0,
          units: 0,
          unitsPercent: 0,
          volume: 0,
          volumePercent: 0,
          revenue: 0,
          revenueBps: 0,
          avgTurnTime: 0,
          pullThrough: 0,
          waFico: 0,
          waLtv: 0,
          waDti: 0,
          waWhDays: 0,
          avgConditions: 0,
          lostOpportunityUnits: 0,
          lostOpportunityUnitsPercent: 0,
          lostOpportunityRevenue: 0,
          deniedUnits: 0,
          deniedUnitsPercent: 0,
          deniedRevenue: 0,
          lostOpportunityAndDeniedRevenue: 0,
          lostOpportunityAndDeniedRevenueBps: 0,
          avgLoRevenue: 0,
          avgLoUnits: 0,
          avgLoUnitsPerMonth: 0,
          avgLoVolume: 0,
          avgLoVolumePerMonth: 0,
          avgTtsScore: 0,
          loanComplexityScore: 0,
        };
      }

      function calcTierSummary(
        tierActors: ActorScore[],
        tierDeniedRevenue: number,
        tierWhDaysData: { sum: number; weight: number },
        tierConditionsData: { sum: number; count: number },
        totalApps: number,
      ) {
        if (tierActors.length === 0) return createEmptyTierSummary();

        const tierUnits = tierActors.reduce((sum, a) => sum + a.units, 0);
        const tierVolume = tierActors.reduce((sum, a) => sum + a.volume, 0);
        const tierRevenue = tierActors.reduce((sum, a) => sum + a.revenue, 0);
        const tierLostUnits = tierActors.reduce(
          (sum, a) => sum + a.lostOpportunityUnits,
          0,
        );
        const tierLostRevenue = tierActors.reduce(
          (sum, a) => sum + a.lostOpportunityRevenue,
          0,
        );
        const tierDenied = tierActors.reduce(
          (sum, a) => sum + a.deniedUnits,
          0,
        );

        // Weighted averages for the tier
        let tierFicoSum = 0,
          tierFicoWeight = 0;
        let tierLtvSum = 0,
          tierLtvWeight = 0;
        let tierDtiSum = 0,
          tierDtiWeight = 0;

        tierActors.forEach((a) => {
          if (a.waFico > 0 && a.volume > 0) {
            tierFicoSum += a.waFico * a.volume;
            tierFicoWeight += a.volume;
          }
          if (a.waLtv > 0 && a.volume > 0) {
            tierLtvSum += a.waLtv * a.volume;
            tierLtvWeight += a.volume;
          }
          // Filter DTI to valid range (0-150%) - matches the Qlik [DTI Out of Range Flag] filter
          if (a.waDti > 0 && a.waDti <= 150 && a.volume > 0) {
            tierDtiSum += a.waDti * a.volume;
            tierDtiWeight += a.volume;
          }
        });

        // Average turn time and pull-through for tier
        const tierTurnTimes = tierActors.filter((a) => a.avgTurnTime > 0);
        const avgTurnTime =
          tierTurnTimes.length > 0
            ? tierTurnTimes.reduce((sum, a) => sum + a.avgTurnTime, 0) /
              tierTurnTimes.length
            : 0;

        const tierPullThroughs = tierActors.filter((a) => a.pullThrough > 0);
        const avgPullThrough =
          tierPullThroughs.length > 0
            ? tierPullThroughs.reduce((sum, a) => sum + a.pullThrough, 0) /
              tierPullThroughs.length
            : 0;

        // Average loan complexity for tier (weighted by units)
        // Note: avgComplexity already has the (1 + raw) * 100 formula applied
        const tierComplexityActors = tierActors.filter(
          (a: any) => a.avgComplexity !== undefined && a.avgComplexity > 0,
        );
        const tierAvgComplexity =
          tierComplexityActors.length > 0
            ? tierComplexityActors.reduce(
                (sum: number, a: any) => sum + a.avgComplexity * a.units,
                0,
              ) / tierUnits
            : 100; // Default to 100 (which is (1 + 0) * 100)

        // New metrics calculations
        const lostOppAndDeniedRevenue = tierLostRevenue + tierDeniedRevenue;
        const avgLoVolume =
          tierActors.length > 0 ? tierVolume / tierActors.length : 0;
        const avgLoUnits =
          tierActors.length > 0 ? tierUnits / tierActors.length : 0;
        // Rolling 13 months period
        const monthsPeriod = 13;

        return {
          count: tierActors.length,
          units: tierUnits,
          unitsPercent: totalUnits > 0 ? (tierUnits / totalUnits) * 100 : 0,
          volume: tierVolume,
          volumePercent: totalVolume > 0 ? (tierVolume / totalVolume) * 100 : 0,
          revenue: tierRevenue,
          revenueBps: tierVolume > 0 ? (tierRevenue / tierVolume) * 10000 : 0,
          avgTurnTime,
          pullThrough: avgPullThrough,
          waFico: tierFicoWeight > 0 ? tierFicoSum / tierFicoWeight : 0,
          waLtv: tierLtvWeight > 0 ? tierLtvSum / tierLtvWeight : 0,
          waDti: tierDtiWeight > 0 ? tierDtiSum / tierDtiWeight : 0,
          waWhDays:
            tierWhDaysData.weight > 0
              ? tierWhDaysData.sum / tierWhDaysData.weight
              : 0,
          avgConditions:
            tierConditionsData.count > 0
              ? tierConditionsData.sum / tierConditionsData.count
              : 0,
          lostOpportunityUnits: tierLostUnits,
          // Qlik: Lost Opp % = Tier Lost Opp / Total Applications
          lostOpportunityUnitsPercent:
            totalApps > 0 ? (tierLostUnits / totalApps) * 100 : 0,
          lostOpportunityRevenue: tierLostRevenue,
          deniedUnits: tierDenied,
          // Qlik: Denied % = Tier Denied / Total Applications
          deniedUnitsPercent:
            totalApps > 0 ? (tierDenied / totalApps) * 100 : 0,
          deniedRevenue: tierDeniedRevenue,
          lostOpportunityAndDeniedRevenue: lostOppAndDeniedRevenue,
          lostOpportunityAndDeniedRevenueBps:
            tierVolume > 0 ? (lostOppAndDeniedRevenue / tierVolume) * 10000 : 0,
          avgLoRevenue:
            tierActors.length > 0 ? tierRevenue / tierActors.length : 0,
          avgLoUnits,
          avgLoUnitsPerMonth: avgLoUnits / monthsPeriod,
          avgLoVolume,
          avgLoVolumePerMonth: avgLoVolume / monthsPeriod,
          avgTtsScore:
            tierActors.length > 0
              ? tierActors.reduce((sum, a) => sum + a.ttsScore, 0) /
                tierActors.length
              : 0,
          loanComplexityScore: tierAvgComplexity,
        };
      }

      // Helper function to calculate tier-specific data from loans
      function calcTierSpecificData(
        tierActors: ActorScore[],
        loans: any[],
        actorColumn: string,
        maxDate: Date,
      ) {
        const tierActorNames = new Set(tierActors.map((a) => a.name));
        let whDaysSum = 0,
          whDaysWeight = 0;
        let conditionsSum = 0,
          conditionsCount = 0;
        let deniedRev = 0;

        // Calculate WA W-H Days and Avg Conditions from funded loans belonging to tier actors
        loans.forEach((l: any) => {
          const actorName = l[actorColumn];
          if (!tierActorNames.has(actorName)) return;

          const loanAmount = parseFloat(l.loan_amount) || 0;

          // WA W-H Days - Qlik Transform.qvs line 180-181:
          // If investor_purchase_date exists: W-H Days = investor_purchase_date - funding_date
          // Else if funded but not purchased: W-H Days = vMaxDate - funding_date
          const investorStatus = (l.investor_status || "").toLowerCase();
          const channel = (l.channel || "").toLowerCase();
          const isPurchased = investorStatus.includes("purchased");
          const isBrokered = channel.includes("broker");

          if (l.funding_date && loanAmount > 0 && !isPurchased && !isBrokered) {
            const fundingDate = new Date(l.funding_date);
            let whDays = 0;

            if (l.investor_purchase_date) {
              const purchaseDate = new Date(l.investor_purchase_date);
              whDays =
                (purchaseDate.getTime() - fundingDate.getTime()) /
                (1000 * 60 * 60 * 24);
            } else {
              whDays =
                (maxDate.getTime() - fundingDate.getTime()) /
                (1000 * 60 * 60 * 24);
            }

            if (whDays >= 0 && whDays < 365) {
              whDaysSum += whDays * loanAmount;
              whDaysWeight += loanAmount;
            }
          }

          // Average Conditions
          if (
            l.number_of_conditions !== null &&
            l.number_of_conditions !== undefined
          ) {
            const conditions = parseInt(l.number_of_conditions) || 0;
            if (conditions >= 0) {
              conditionsSum += conditions;
              conditionsCount++;
            }
          }
        });

        // Calculate denied revenue from denied loans belonging to tier actors
        deniedLoans.forEach((l: any) => {
          const actorName = l[actorColumn];
          if (!tierActorNames.has(actorName)) return;
          deniedRev += calcLoanRevenue(l);
        });

        return {
          deniedRevenue: deniedRev,
          whDaysData: { sum: whDaysSum, weight: whDaysWeight },
          conditionsData: { sum: conditionsSum, count: conditionsCount },
        };
      }

      // Calculate tier summaries with additional metrics
      const topActors = actorsWithProduction.filter((a) => a.tier === "top");
      const secondActors = actorsWithProduction.filter(
        (a) => a.tier === "second",
      );
      const bottomActors = actorsWithProduction.filter(
        (a) => a.tier === "bottom",
      );

      const topTierData = calcTierSpecificData(
        topActors,
        fundedLoans,
        actorColumn,
        effectiveEndDate,
      );
      const secondTierData = calcTierSpecificData(
        secondActors,
        fundedLoans,
        actorColumn,
        effectiveEndDate,
      );
      const bottomTierData = calcTierSpecificData(
        bottomActors,
        fundedLoans,
        actorColumn,
        effectiveEndDate,
      );

      const tierSummary = {
        top: calcTierSummary(
          topActors,
          topTierData.deniedRevenue,
          topTierData.whDaysData,
          topTierData.conditionsData,
          totalApplications,
        ),
        second: calcTierSummary(
          secondActors,
          secondTierData.deniedRevenue,
          secondTierData.whDaysData,
          secondTierData.conditionsData,
          totalApplications,
        ),
        bottom: calcTierSummary(
          bottomActors,
          bottomTierData.deniedRevenue,
          bottomTierData.whDaysData,
          bottomTierData.conditionsData,
          totalApplications,
        ),
      };

      // Debug: Find actors with TTS <= 0 (Qlik excludes these from count)
      const actorsWithTTSZeroOrLess = actorsWithProduction.filter(
        (a) => a.ttsScore <= 0,
      );
      const actorsWithTTSPositive = actorsWithProduction.filter(
        (a) => a.ttsScore > 0,
      );

      // Calculate units only for actors with TTS > 0 (matching Qlik's filter)
      const unitsForTTSPositiveActors = actorsWithTTSPositive.reduce(
        (sum, a) => sum + a.units,
        0,
      );

      // Results summary simplified
      logInfo("[SalesScorecard] Results", {
        actors: actorsWithProduction.length,
        totalUnits: actorsWithProduction.reduce((sum, a) => sum + a.units, 0),
      });

      // Calculate company-wide totals
      // Average complexity weighted by units across all actors
      // Note: avgComplexity already has the (1 + raw) * 100 formula applied
      const complexityActors = actorsWithProduction.filter(
        (a: any) => a.avgComplexity > 0,
      );
      const totalComplexityWeighted = complexityActors.reduce(
        (sum: number, a: any) => sum + a.avgComplexity * a.units,
        0,
      );
      const avgComplexityTotal =
        totalUnits > 0 ? totalComplexityWeighted / totalUnits : 100;

      // Calculate additional totals for new metrics
      const lostOppAndDeniedRevenueTotal =
        totalLostOpportunityRevenue + totalDeniedRevenue;
      const avgLoVolumeTotal =
        actorsWithProduction.length > 0
          ? totalVolume / actorsWithProduction.length
          : 0;
      const avgLoUnitsTotal =
        actorsWithProduction.length > 0
          ? totalUnits / actorsWithProduction.length
          : 0;
      const monthsPeriod = 13; // Rolling 13 months

      const totals = {
        actorCount: actorsWithProduction.length, // Use filtered count
        units: totalUnits,
        volume: totalVolume,
        revenue: totalRevenue,
        revenueBps: totalVolume > 0 ? (totalRevenue / totalVolume) * 10000 : 0,
        avgTurnTime: companyAvgTurnTime,
        pullThrough: companyPullThrough,
        waFico:
          totalFicoWeight > 0 ? totalFicoWeightedSum / totalFicoWeight : 0,
        waLtv: totalLtvWeight > 0 ? totalLtvWeightedSum / totalLtvWeight : 0,
        waDti: totalDtiWeight > 0 ? totalDtiWeightedSum / totalDtiWeight : 0,
        waWhDays:
          totalWhDaysWeight > 0
            ? totalWhDaysWeightedSum / totalWhDaysWeight
            : 0,
        avgConditions:
          totalConditionsCount > 0
            ? totalConditionsSum / totalConditionsCount
            : 0,
        lostOpportunityUnits: totalLostOpportunityUnits,
        // Qlik: Lost Opp % = Lost Opp Loans / Total Applications (DateType='Application')
        lostOpportunityUnitsPercent:
          totalApplications > 0
            ? (totalLostOpportunityUnits / totalApplications) * 100
            : 0,
        lostOpportunityRevenue: totalLostOpportunityRevenue,
        deniedUnits: totalDeniedUnits,
        // Qlik: Denied % = Denied Loans / Total Applications
        deniedUnitsPercent:
          totalApplications > 0
            ? (totalDeniedUnits / totalApplications) * 100
            : 0,
        deniedRevenue: totalDeniedRevenue,
        lostOpportunityAndDeniedRevenue: lostOppAndDeniedRevenueTotal,
        lostOpportunityAndDeniedRevenueBps:
          totalVolume > 0
            ? (lostOppAndDeniedRevenueTotal / totalVolume) * 10000
            : 0,
        avgLoRevenue:
          actorsWithProduction.length > 0
            ? totalRevenue / actorsWithProduction.length
            : 0,
        avgLoUnits: avgLoUnitsTotal,
        avgLoUnitsPerMonth: avgLoUnitsTotal / monthsPeriod,
        avgLoVolume: avgLoVolumeTotal,
        avgLoVolumePerMonth: avgLoVolumeTotal / monthsPeriod,
        avgTtsScore:
          actorsWithProduction.length > 0
            ? actorsWithProduction.reduce((sum, a) => sum + a.ttsScore, 0) /
              actorsWithProduction.length
            : 0,
        loanComplexityScore: avgComplexityTotal,
      };

      res.json({
        actors: actorsWithProduction, // Only include LOs with production (units > 0)
        companyAverages,
        weightConfig,
        tierSummary,
        totals,
        dateRange: {
          startDate: effectiveStartDate.toISOString(),
          endDate: effectiveEndDate.toISOString(),
        },
      });
    } catch (error: any) {
      logError("Error fetching sales scorecard data", error, {
        userId: req.userId,
      });
      res.status(500).json({
        error: error.message || "Failed to fetch sales scorecard data",
      });
    }
  },
);

/**
 * GET /api/loans/operations-scorecard
 * Get Operations Scorecard data for Processors, Underwriters, and Closers
 *
 * DOCUMENTATION: See docs/OPERATIONS_SCORECARD_SPECIFICATION.md for complete specification
 *
 * TTS Formula (Operations):
 * OPS_TTS = (UnitRating × 0.70 + TurnTimeRating × 0.15 + ComplexityRating × 0.15) / 1.0
 *
 * Weights: Units = 70%, Turn Time = 15%, Loan Complexity = 15%
 *
 * Each actor type uses different milestone dates (from Homestead CoheusConfig.xml TriggerDateFields):
 * - Processor: output = approval_date (Qlik: [Sent To Underwriting] = Log.MS.Date.Approval)
 * - Underwriter: output = closing_date (Qlik: [Sent To Closing] = Fields.748)
 * - Closer: output = disbursement_date (Qlik: [End Date to indicate Loan Closed/Funded] = Fields.1997)
 *
 * Query Parameters:
 * - actor_type: 'processor' | 'underwriter' | 'closer' (default: 'underwriter')
 * - date_range: '3-months' | '6-months' | '12-months' (default: '3-months')
 * - channel_group: Optional channel filter
 */
router.get(
  "/operations-scorecard",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    // DEPRECATED: Use /api/scorecard/operations instead
    addDeprecationHeaders(res, "/api/scorecard/operations");
    try {
      const tenantPool = getTenantContext(req).tenantPool;

      // Parse query parameters
      const actorType = (req.query.actor_type as string) || "underwriter";
      const dateRange = (req.query.date_range as string) || "3-months";
      const channelGroup = req.query.channel_group as string | undefined;

      // Validate actor type
      if (!["processor", "underwriter", "closer"].includes(actorType)) {
        return res.status(400).json({
          error:
            'Invalid actor_type. Must be "processor", "underwriter", or "closer"',
        });
      }

      // Validate date range
      const monthsMap: Record<string, number> = {
        "3-months": 3,
        "6-months": 6,
        "12-months": 12,
      };
      const monthsBack = monthsMap[dateRange] || 3;

      // Use shared actor configuration
      const config = OPERATIONS_ACTOR_CONFIGS[actorType];

      // isActorMissing is now imported from shared utilities (uses 'strict' mode for operations)

      // Get vMaxDate from data - using same logic as SalesScorecard for consistency
      // CRITICAL: Qlik uses Max("Last Modified Date"), NOT max funding_date!
      const maxDateResult = await tenantPool.query(`
      SELECT 
        MAX(funding_date) as max_funding_date,
        MAX(updated_at) as max_updated_at
      FROM public.loans 
      WHERE funding_date IS NOT NULL
    `);

      // Check if we have a last_modified_date field from Encompass
      const lastModifiedResult = await tenantPool.query(`
      SELECT 
        MAX(last_modified_date) as max_last_modified
      FROM public.loans 
      WHERE last_modified_date IS NOT NULL
    `);

      let vMaxDate: Date;
      if (lastModifiedResult.rows[0]?.max_last_modified) {
        // Use last_modified_date if available (matches Qlik's "Last Modified Date")
        vMaxDate = new Date(lastModifiedResult.rows[0].max_last_modified);
      } else if (maxDateResult.rows[0]?.max_updated_at) {
        // Fall back to updated_at
        vMaxDate = new Date(maxDateResult.rows[0].max_updated_at);
      } else if (maxDateResult.rows[0]?.max_funding_date) {
        // Fall back to max funding_date
        vMaxDate = new Date(maxDateResult.rows[0].max_funding_date);
      } else {
        vMaxDate = new Date();
      }

      // Calculate date range
      // For vMaxDate = Jan 22, 2026 and monthsBack = 12:
      //   Start = Jan 1, 2025 (first day of month 12 months before)
      //   End = Jan 22, 2026 (INCLUSIVE)
      const effectiveEndDate = new Date(vMaxDate);
      const effectiveStartDate = new Date(
        vMaxDate.getFullYear(),
        vMaxDate.getMonth() - monthsBack,
        1,
      );

      // Detailed date range logging for debugging Qlik discrepancies
      logInfo("[OpsScorecard] Date range calculation", {
        vMaxDate: vMaxDate.toISOString(),
        vMaxDateSource: lastModifiedResult.rows[0]?.max_last_modified
          ? "last_modified_date"
          : maxDateResult.rows[0]?.max_updated_at
            ? "updated_at"
            : maxDateResult.rows[0]?.max_funding_date
              ? "funding_date"
              : "current_date",
        effectiveStartDate: effectiveStartDate.toISOString(),
        effectiveEndDate: effectiveEndDate.toISOString(),
        monthsBack,
        dateRangeLabel: `${effectiveStartDate.toLocaleDateString("en-US", {
          month: "short",
          year: "numeric",
        })} to ${effectiveEndDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })} (INCLUSIVE)`,
      });

      logInfo("[OpsScorecard] Start", {
        actorType,
        dateRange,
        channel: channelGroup,
      });

      // TTS Weight Configuration for Operations (70/15/15)
      const weightConfig = {
        unit: 0.7,
        turnTime: 0.15,
        complexity: 0.15,
      };

      // OPTIMIZED: Use SQL filtering for date, channel, and actor
      const channelClause = buildChannelWhereClause(channelGroup);
      const startDateStr = formatDateForSQL(effectiveStartDate);
      const endDateStr = formatDateForSQL(effectiveEndDate);

      // Fetch loans with SQL filtering
      // CRITICAL: Match Qlik's EXACT date filter syntax: >= start AND < end (EXCLUSIVE end date)
      const outputLoansResult = await tenantPool.query(
        `
      SELECT 
        loan_id,
        COALESCE(loan_number, loan_id::text) as loan_number,
        loan_amount, loan_type, loan_purpose, current_loan_status, channel,
        processor, underwriter, closer,
        submitted_to_processing_date,
        submitted_to_underwriting_date,
        processing_date,
        approval_date,
        closing_date,
        disbursement_date,
        funding_date,
        application_date,
        fico_score, ltv_ratio, be_dti_ratio,
        occupancy_type, borr_self_employed
      FROM loans
      WHERE ${config.outputDateField} IS NOT NULL
        AND ${config.outputDateField} >= $1
        AND ${config.outputDateField} < $2
        AND ${config.actorColumn} IS NOT NULL
        AND TRIM(${config.actorColumn}) != ''
        AND UPPER(TRIM(${config.actorColumn})) != '99-MISSING'
        ${channelClause}
    `,
        [startDateStr, endDateStr],
      );

      const outputLoans = outputLoansResult.rows;
      logInfo("[OpsScorecard] Loans in range (SQL filtered)", {
        outputLoans: outputLoans.length,
        actorColumn: config.actorColumn,
        outputDateField: config.outputDateField,
      });

      logInfo("[OpsScorecard] Loans in range", {
        outputLoans: outputLoans.length,
        actorColumn: config.actorColumn,
        outputDateField: config.outputDateField,
      });

      // Helper: Calculate turn time in days
      const calcTurnTime = (l: any): number | null => {
        const startDate = l[config.turnTimeStartField];
        const endDate = l[config.turnTimeEndField];
        if (!startDate || !endDate) return null;
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
        const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
        return days > 0 ? days : null;
      };

      // Aggregate by actor
      // CRITICAL: Use Set to track DISTINCT loan_numbers (Qlik uses COUNT(DISTINCT [Loan Number]))
      interface OpsActorMetrics {
        name: string;
        units: number;
        volume: number;
        turnTimes: number[];
        complexityScores: number[];
        // Additional metrics
        governmentLoans: number;
        purchaseLoans: number;
        approvedLoans: number;
        deniedLoans: number;
        totalDecisions: number;
        ficoWeightedSum: number;
        ficoWeight: number;
        ltvWeightedSum: number;
        ltvWeight: number;
        seenLoanNumbers: Set<string>; // Track distinct loan numbers
      }

      const actorMap = new Map<string, OpsActorMetrics>();

      outputLoans.forEach((l: any) => {
        const actorName = l[config.actorColumn];
        if (isActorMissing(actorName)) return;

        const loanNumber = String(l.loan_number || l.loan_id); // Use loan_number for distinct counting
        const loanAmount = parseFloat(l.loan_amount) || 0;
        const turnTime = calcTurnTime(l);
        const complexity = calcLoanComplexity(toLoanComplexityData(l));

        if (!actorMap.has(actorName)) {
          actorMap.set(actorName, {
            name: actorName,
            units: 0,
            volume: 0,
            turnTimes: [],
            complexityScores: [],
            governmentLoans: 0,
            purchaseLoans: 0,
            approvedLoans: 0,
            deniedLoans: 0,
            totalDecisions: 0,
            ficoWeightedSum: 0,
            ficoWeight: 0,
            ltvWeightedSum: 0,
            ltvWeight: 0,
            seenLoanNumbers: new Set(),
          });
        }

        const actor = actorMap.get(actorName)!;

        // CRITICAL: Only count units for DISTINCT loan numbers
        if (!actor.seenLoanNumbers.has(loanNumber)) {
          actor.seenLoanNumbers.add(loanNumber);
          actor.units++; // Count distinct loans only
        }

        // Volume is still summed for all rows
        actor.volume += loanAmount;

        if (turnTime !== null && turnTime > 0) {
          actor.turnTimes.push(turnTime);
        }
        actor.complexityScores.push(complexity);

        // Loan type tracking
        const loanType = (l.loan_type || "").toUpperCase();
        if (
          loanType.includes("FHA") ||
          loanType.includes("VA") ||
          loanType.includes("USDA")
        ) {
          actor.governmentLoans++;
        }

        const loanPurpose = (l.loan_purpose || "").toUpperCase();
        if (loanPurpose.includes("PURCHASE")) {
          actor.purchaseLoans++;
        }

        // Status tracking (primarily for underwriters)
        const status = (l.current_loan_status || "").toUpperCase();
        if (
          status.includes("APPROV") ||
          status.includes("ORIGINATED") ||
          status.includes("FUNDED")
        ) {
          actor.approvedLoans++;
          actor.totalDecisions++;
        } else if (status.includes("DENIED") || status.includes("DECLINED")) {
          actor.deniedLoans++;
          actor.totalDecisions++;
        }

        // Weighted averages
        if (l.fico_score && loanAmount > 0) {
          actor.ficoWeightedSum += parseFloat(l.fico_score) * loanAmount;
          actor.ficoWeight += loanAmount;
        }
        if (l.ltv_ratio && loanAmount > 0) {
          actor.ltvWeightedSum += parseFloat(l.ltv_ratio) * loanAmount;
          actor.ltvWeight += loanAmount;
        }
      });

      // Calculate company averages
      const actors = Array.from(actorMap.values()).filter((a) => a.units > 0);
      const actorCount = actors.length;

      if (actorCount === 0) {
        return res.json({
          actors: [],
          tierSummary: {
            top: createEmptyOpsTierSummary(),
            second: createEmptyOpsTierSummary(),
            bottom: createEmptyOpsTierSummary(),
          },
          totals: createEmptyOpsTierSummary(),
          companyAverages: { avgUnits: 0, avgTurnTime: 0, avgComplexity: 100 },
          weightConfig,
          dateRange: {
            start: effectiveStartDate.toISOString(),
            end: effectiveEndDate.toISOString(),
            months: monthsBack,
          },
        });
      }

      // Company averages
      const totalUnits = actors.reduce((sum, a) => sum + a.units, 0);
      const totalVolume = actors.reduce((sum, a) => sum + a.volume, 0);
      const avgUnitsPerActor = totalUnits / actorCount;

      // Turn time average (inverse formula like sales-scorecard)
      let totalInverseTurnTime = 0;
      let turnTimeActorCount = 0;
      actors.forEach((a) => {
        if (a.turnTimes.length > 0) {
          const avgTurnTime =
            a.turnTimes.reduce((sum, t) => sum + t, 0) / a.turnTimes.length;
          if (avgTurnTime > 0) {
            totalInverseTurnTime += 1 / avgTurnTime;
            turnTimeActorCount++;
          }
        }
      });
      const avgInverseTurnTime =
        turnTimeActorCount > 0 ? totalInverseTurnTime / turnTimeActorCount : 0;
      const avgTurnTime =
        actors.reduce((sum, a) => {
          if (a.turnTimes.length === 0) return sum;
          return (
            sum + a.turnTimes.reduce((s, t) => s + t, 0) / a.turnTimes.length
          );
        }, 0) /
        Math.max(1, actors.filter((a) => a.turnTimes.length > 0).length);

      // Complexity average
      const avgComplexity =
        actors.reduce((sum, a) => {
          if (a.complexityScores.length === 0) return sum;
          return (
            sum +
            a.complexityScores.reduce((s, c) => s + c, 0) /
              a.complexityScores.length
          );
        }, 0) / actorCount;

      const companyAverages = {
        avgUnits: avgUnitsPerActor,
        avgTurnTime: avgTurnTime,
        avgComplexity: avgComplexity,
      };

      // Calculate TTS scores and metrics for each actor
      const actorsWithMetrics = actors.map((a) => {
        const actorAvgTurnTime =
          a.turnTimes.length > 0
            ? a.turnTimes.reduce((sum, t) => sum + t, 0) / a.turnTimes.length
            : 0;
        const actorAvgComplexity =
          a.complexityScores.length > 0
            ? a.complexityScores.reduce((sum, c) => sum + c, 0) /
              a.complexityScores.length
            : 100;

        // Calculate ratings (for TTS score display)
        const unitRating =
          avgUnitsPerActor > 0 ? (a.units / avgUnitsPerActor) * 100 : 100;

        // Turn time rating (inverse - lower is better)
        let turnTimeRating = 100;
        if (actorAvgTurnTime > 0 && avgInverseTurnTime > 0) {
          const actorInverseTurnTime = 1 / actorAvgTurnTime;
          turnTimeRating = (actorInverseTurnTime / avgInverseTurnTime) * 100;
        }

        const complexityRating =
          avgComplexity > 0 ? (actorAvgComplexity / avgComplexity) * 100 : 100;

        // Calculate TTS (kept for display purposes)
        const ttsScore =
          unitRating * weightConfig.unit +
          turnTimeRating * weightConfig.turnTime +
          complexityRating * weightConfig.complexity;

        return {
          name: a.name,
          units: a.units,
          volume: a.volume,
          avgUnitsPerMonth: a.units / monthsBack,
          avgDays: actorAvgTurnTime,
          loanComplexityScore: actorAvgComplexity,
          approvedPercent:
            a.totalDecisions > 0
              ? (a.approvedLoans / a.totalDecisions) * 100
              : 0,
          deniedPercent:
            a.totalDecisions > 0 ? (a.deniedLoans / a.totalDecisions) * 100 : 0,
          governmentPercent:
            a.units > 0 ? (a.governmentLoans / a.units) * 100 : 0,
          purchasePercent: a.units > 0 ? (a.purchaseLoans / a.units) * 100 : 0,
          waFico: a.ficoWeight > 0 ? a.ficoWeightedSum / a.ficoWeight : 0,
          waLtv: a.ltvWeight > 0 ? a.ltvWeightedSum / a.ltvWeight : 0,
          ttsScore,
          // Ratings for debugging
          unitRating,
          turnTimeRating,
          complexityRating,
        };
      });

      // TIER ASSIGNMENT: TTS Score thresholds (matching Qlik "13 Month TVI Score Tiers" logic)
      // From Qlik Dimensions.csv:
      //   If(Avg(TVI_Score) >= 120, 'Top Tier',
      //   If(Avg(TVI_Score) >= 80, 'Second Tier', 'Bottom Tier'))
      const actorsWithTTS = actorsWithMetrics.map((a) => {
        // Qlik tier thresholds based on TTS/TVI score
        let tier: "top" | "second" | "bottom";
        if (a.ttsScore >= 120) tier = "top";
        else if (a.ttsScore >= 80) tier = "second";
        else tier = "bottom";

        return { ...a, tier };
      });

      // Sort by TTS score for display
      actorsWithTTS.sort((a, b) => b.ttsScore - a.ttsScore);

      // Helper: Create tier summary
      function createOpsTierSummary(
        tierActors: typeof actorsWithTTS,
        allActors: typeof actorsWithTTS,
      ) {
        if (tierActors.length === 0) {
          return createEmptyOpsTierSummary();
        }

        const tierUnits = tierActors.reduce((sum, a) => sum + a.units, 0);
        const tierVolume = tierActors.reduce((sum, a) => sum + a.volume, 0);
        const totalUnits = allActors.reduce((sum, a) => sum + a.units, 0);

        const turnTimeActors = tierActors.filter((a) => a.avgDays > 0);
        const avgTurnTime =
          turnTimeActors.length > 0
            ? turnTimeActors.reduce((sum, a) => sum + a.avgDays, 0) /
              turnTimeActors.length
            : 0;

        return {
          count: tierActors.length,
          units: tierUnits,
          unitsPercent: totalUnits > 0 ? (tierUnits / totalUnits) * 100 : 0,
          volume: tierVolume,
          loanComplexityScore:
            tierActors.reduce((sum, a) => sum + a.loanComplexityScore, 0) /
            tierActors.length,
          avgUnitsPerMonth: tierUnits / monthsBack / tierActors.length,
          avgDays: avgTurnTime,
          compensation: "-",
          costPerFile: "-",
          approvedPercent:
            tierActors.reduce((sum, a) => sum + a.approvedPercent, 0) /
            tierActors.length,
          deniedPercent:
            tierActors.reduce((sum, a) => sum + a.deniedPercent, 0) /
            tierActors.length,
          governmentPercent:
            tierActors.reduce((sum, a) => sum + a.governmentPercent, 0) /
            tierActors.length,
          purchasePercent:
            tierActors.reduce((sum, a) => sum + a.purchasePercent, 0) /
            tierActors.length,
          waFico: Math.round(
            tierActors.reduce((sum, a) => sum + a.waFico, 0) /
              tierActors.length,
          ),
          waLtv:
            tierActors.reduce((sum, a) => sum + a.waLtv, 0) / tierActors.length,
          avgTtsScore:
            tierActors.reduce((sum, a) => sum + a.ttsScore, 0) /
            tierActors.length,
        };
      }

      // Group by tier
      const topActors = actorsWithTTS.filter((a) => a.tier === "top");
      const secondActors = actorsWithTTS.filter((a) => a.tier === "second");
      const bottomActors = actorsWithTTS.filter((a) => a.tier === "bottom");

      const tierSummary = {
        top: createOpsTierSummary(topActors, actorsWithTTS),
        second: createOpsTierSummary(secondActors, actorsWithTTS),
        bottom: createOpsTierSummary(bottomActors, actorsWithTTS),
      };

      // Calculate totals
      const totals = createOpsTierSummary(actorsWithTTS, actorsWithTTS);
      totals.count = actorCount;

      logInfo("[OpsScorecard] Results", {
        actorType,
        actorCount,
        totalUnits,
        tiers: {
          top: topActors.length,
          second: secondActors.length,
          bottom: bottomActors.length,
        },
      });

      // DEBUG: Add comprehensive debug info to compare with Qlik
      const _debug = {
        qlikExpected: {
          vCurrentDateAsDate: "1/22/2026",
          vOpsScorecardMonthRange: 12,
          startDate: "Jan 1, 2025 (MonthStart(AddMonths(1/22/2026, -12)))",
          endDate: "Jan 22, 2026 (EXCLUSIVE, using <)",
          processorUnits: 2087,
          underwriterUnits: 2171,
          closerUnits: 1305,
        },
        ourCalculation: {
          vMaxDate: vMaxDate.toISOString(),
          vMaxDateFormatted: `${
            vMaxDate.getMonth() + 1
          }/${vMaxDate.getDate()}/${vMaxDate.getFullYear()}`,
          vMaxDateSource: lastModifiedResult.rows[0]?.max_last_modified
            ? "last_modified_date"
            : maxDateResult.rows[0]?.max_updated_at
              ? "updated_at"
              : maxDateResult.rows[0]?.max_funding_date
                ? "funding_date"
                : "current_date",
          startDate: effectiveStartDate.toISOString(),
          startDateFormatted: `${
            effectiveStartDate.getMonth() + 1
          }/${effectiveStartDate.getDate()}/${effectiveStartDate.getFullYear()}`,
          endDate: effectiveEndDate.toISOString(),
          endDateFormatted: `${
            effectiveEndDate.getMonth() + 1
          }/${effectiveEndDate.getDate()}/${effectiveEndDate.getFullYear()}`,
          monthsBack,
        },
        filterPipeline: {
          loansMatchingFilters: outputLoans.length, // Now filtered at SQL level
          distinctLoanNumbers: totalUnits,
          actorColumn: config.actorColumn,
          outputDateField: config.outputDateField,
        },
      };

      res.json({
        actors: actorsWithTTS,
        tierSummary,
        totals,
        companyAverages,
        weightConfig,
        dateRange: {
          start: effectiveStartDate.toISOString(),
          end: effectiveEndDate.toISOString(),
          months: monthsBack,
        },
        _debug, // REMOVE THIS AFTER DEBUGGING
      });
    } catch (error: any) {
      logError("Error fetching operations scorecard data", error, {
        userId: req.userId,
      });
      res.status(500).json({
        error: error.message || "Failed to fetch operations scorecard data",
      });
    }
  },
);

// Helper function for empty ops tier summary
function createEmptyOpsTierSummary() {
  return {
    count: 0,
    units: 0,
    unitsPercent: 0,
    volume: 0,
    loanComplexityScore: 100,
    avgUnitsPerMonth: 0,
    avgDays: 0,
    compensation: "-",
    costPerFile: "-",
    approvedPercent: 0,
    deniedPercent: 0,
    governmentPercent: 0,
    purchasePercent: 0,
    waFico: 0,
    waLtv: 0,
    avgTtsScore: 0,
  };
}

/**
 * GET /api/loans/operations-scorecard-trends
 * Get Operations Scorecard Trends data - monthly performance breakdown by actor
 *
 * DOCUMENTATION: See docs/OPERATION_SCORECARD_TRENDS_SPECIFICATION.md for complete specification
 *
 * This endpoint provides monthly performance trends for operations staff in a pivot table format.
 * Unlike /operations-scorecard which summarizes by tier, this endpoint shows month-by-month breakdown.
 *
 * Features:
 * - Rolling 13 months of data (default)
 * - Per-actor, per-month metrics: units, volume, turn time, complexity, conversion
 * - Monthly totals
 * - TTS-based tier assignment
 * - KPI summary
 *
 * Query Parameters:
 * - actor_type: 'processor' | 'underwriter' | 'closer' (default: 'underwriter')
 * - months: Number of months to include (default: 13)
 * - channel_group: Optional channel filter
 * - target_units: Monthly target for vs-target calculation (default: 25)
 */
router.get(
  "/operations-scorecard-trends",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    // DEPRECATED: Use /api/scorecard/operations-trends instead
    addDeprecationHeaders(res, "/api/scorecard/operations-trends");
    try {
      const tenantPool = getTenantContext(req).tenantPool;

      // Parse query parameters
      const actorType = (req.query.actor_type as string) || "underwriter";
      // CRITICAL: Default to 12 months to match Qlik's vOpsScorecardMonthRange = 12
      const monthsCount = parseInt(req.query.months as string) || 12;
      const channelGroup = req.query.channel_group as string | undefined;

      const targets = await getStaffingUnitTargets(tenantPool);
      const targetUnits =
        actorType === "processor"
          ? targets.processor
          : actorType === "underwriter"
            ? targets.underwriter
            : targets.closer;

      // Validate actor type
      if (!["processor", "underwriter", "closer"].includes(actorType)) {
        return res.status(400).json({
          error:
            'Invalid actor_type. Must be "processor", "underwriter", or "closer"',
        });
      }

      // Use shared actor configuration
      const config = OPERATIONS_ACTOR_CONFIGS[actorType];

      // isActorMissing is now imported from shared utilities (uses 'strict' mode for operations)

      // Get vMaxDate from data - using same logic as SalesScorecard for consistency
      // CRITICAL: Qlik uses Max("Last Modified Date"), NOT max funding_date!
      // "Last Modified Date" represents when the loan record was last modified in Encompass
      const maxDateResult = await tenantPool.query(`
      SELECT 
        MAX(funding_date) as max_funding_date,
        MAX(updated_at) as max_updated_at
      FROM public.loans 
      WHERE funding_date IS NOT NULL
    `);

      // Check if we have a last_modified_date field from Encompass
      const lastModifiedResult = await tenantPool.query(`
      SELECT 
        MAX(last_modified_date) as max_last_modified
      FROM public.loans 
      WHERE last_modified_date IS NOT NULL
    `);

      let vMaxDate: Date;
      if (lastModifiedResult.rows[0]?.max_last_modified) {
        // Use last_modified_date if available (matches Qlik's "Last Modified Date")
        vMaxDate = new Date(lastModifiedResult.rows[0].max_last_modified);
      } else if (maxDateResult.rows[0]?.max_updated_at) {
        // Fall back to updated_at
        vMaxDate = new Date(maxDateResult.rows[0].max_updated_at);
      } else if (maxDateResult.rows[0]?.max_funding_date) {
        // Fall back to max funding_date
        vMaxDate = new Date(maxDateResult.rows[0].max_funding_date);
      } else {
        vMaxDate = new Date();
      }

      // Calculate date range for rolling months
      // "Rolling 13 Months" = current partial month + 12 previous months = 13 months total
      // For vMaxDate = Jan 22, 2026 and monthsCount = 12:
      //   Start = Jan 1, 2025 (first day of month 12 months before)
      //   End = Jan 22, 2026 (INCLUSIVE)
      //   Months covered: Jan 2025 through Jan 2026 = 13 months
      const effectiveEndDate = new Date(vMaxDate);
      const effectiveStartDate = new Date(
        vMaxDate.getFullYear(),
        vMaxDate.getMonth() - monthsCount,
        1,
      );

      // Detailed date range logging for debugging Qlik discrepancies
      logInfo("[OpsScorecardTrends] Date range calculation", {
        vMaxDate: vMaxDate.toISOString(),
        vMaxDateSource: lastModifiedResult.rows[0]?.max_last_modified
          ? "last_modified_date"
          : maxDateResult.rows[0]?.max_updated_at
            ? "updated_at"
            : maxDateResult.rows[0]?.max_funding_date
              ? "funding_date"
              : "current_date",
        effectiveStartDate: effectiveStartDate.toISOString(),
        effectiveEndDate: effectiveEndDate.toISOString(),
        monthsCount,
        dateRangeLabel: `${effectiveStartDate.toLocaleDateString("en-US", {
          month: "short",
          year: "numeric",
        })} to ${effectiveEndDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })} (INCLUSIVE)`,
      });

      logInfo("[OpsScorecardTrends] Start", {
        actorType,
        months: monthsCount,
        channel: channelGroup,
        targetUnits,
      });

      // TTS Weight Configuration for Operations (70/15/15)
      const weightConfig = {
        unit: 0.7,
        turnTime: 0.15,
        complexity: 0.15,
      };

      // OPTIMIZED: Use SQL filtering for date, channel, and actor
      const channelClause = buildChannelWhereClause(channelGroup);
      const startDateStr = formatDateForSQL(effectiveStartDate);
      const endDateStr = formatDateForSQL(effectiveEndDate);

      // Fetch loans with SQL filtering
      // CRITICAL: Match Qlik's EXACT date filter syntax: >= start AND < end (EXCLUSIVE end date)
      const outputLoansResult = await tenantPool.query(
        `
      SELECT 
        loan_id, 
        COALESCE(loan_number, loan_id::text) as loan_number,
        loan_amount, loan_type, loan_purpose, current_loan_status, channel,
        processor, underwriter, closer,
        submitted_to_processing_date,
        submitted_to_underwriting_date,
        processing_date,
        approval_date,
        closing_date,
        disbursement_date,
        funding_date,
        application_date,
        fico_score, ltv_ratio, be_dti_ratio,
        occupancy_type, borr_self_employed
      FROM loans
      WHERE ${config.outputDateField} IS NOT NULL
        AND ${config.outputDateField} >= $1
        AND ${config.outputDateField} < $2
        AND ${config.actorColumn} IS NOT NULL
        AND TRIM(${config.actorColumn}) != ''
        AND UPPER(TRIM(${config.actorColumn})) != '99-MISSING'
        ${channelClause}
    `,
        [startDateStr, endDateStr],
      );

      const outputLoans = outputLoansResult.rows;
      logInfo("[OpsScorecardTrends] Loans in range (SQL filtered)", {
        outputLoans: outputLoans.length,
      });

      // Debug: Check turn time fields availability
      let turnTimeFieldsMissing = 0;
      let turnTimeValid = 0;
      if (outputLoans.length > 0) {
        const sampleLoan = outputLoans[0];
        logInfo("[OpsScorecardTrends] Turn time fields debug", {
          turnTimeStartField: config.turnTimeStartField,
          turnTimeEndField: config.turnTimeEndField,
          sampleStartValue: sampleLoan[config.turnTimeStartField],
          sampleEndValue: sampleLoan[config.turnTimeEndField],
          availableFields: Object.keys(sampleLoan),
        });
      }

      // Helper: Calculate turn time in days
      const calcTurnTime = (l: any): number | null => {
        const startDate = l[config.turnTimeStartField];
        const endDate = l[config.turnTimeEndField];
        if (!startDate || !endDate) {
          turnTimeFieldsMissing++;
          return null;
        }
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
        const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
        if (days > 0) {
          turnTimeValid++;
          return days;
        }
        return null;
      };

      // Helper: Format month key (e.g., "Jan-2026")
      const formatMonthKey = (date: Date): string => {
        const months = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        return `${months[date.getMonth()]}-${date.getFullYear()}`;
      };

      // Generate ordered list of months (most recent first)
      const monthsList: string[] = [];
      for (let i = 0; i < monthsCount; i++) {
        const monthDate = new Date(vMaxDate);
        monthDate.setMonth(monthDate.getMonth() - i);
        monthsList.push(formatMonthKey(monthDate));
      }

      // Aggregate by actor AND by month
      // CRITICAL: Use Set to track DISTINCT loan_numbers (Qlik uses COUNT(DISTINCT [Loan Number]))
      interface ActorMonthData {
        unitsOutput: number;
        volumeOutput: number;
        turnTimes: number[];
        complexityScores: number[];
        approvedLoans: number;
        totalDecisions: number;
        seenLoanNumbers: Set<string>; // Track distinct loan numbers for this month
      }

      interface ActorAggregation {
        name: string;
        totalUnits: number;
        totalVolume: number;
        allTurnTimes: number[];
        allComplexityScores: number[];
        months: Map<string, ActorMonthData>;
        seenLoanNumbers: Set<string>; // Track distinct loan numbers across all months
      }

      const actorMap = new Map<string, ActorAggregation>();

      outputLoans.forEach((l: any) => {
        const actorName = l[config.actorColumn];
        if (isActorMissing(actorName)) return;

        const loanNumber = String(l.loan_number || l.loan_id); // Use loan_number for distinct counting
        const outputDate = new Date(l[config.outputDateField]);
        const monthKey = formatMonthKey(outputDate);

        const loanAmount = parseFloat(l.loan_amount) || 0;
        const turnTime = calcTurnTime(l);
        const complexity = calcLoanComplexity(toLoanComplexityData(l));

        if (!actorMap.has(actorName)) {
          actorMap.set(actorName, {
            name: actorName,
            totalUnits: 0,
            totalVolume: 0,
            allTurnTimes: [],
            allComplexityScores: [],
            months: new Map(),
            seenLoanNumbers: new Set(),
          });
        }

        const actor = actorMap.get(actorName)!;

        // Get or create month data
        if (!actor.months.has(monthKey)) {
          actor.months.set(monthKey, {
            unitsOutput: 0,
            volumeOutput: 0,
            turnTimes: [],
            complexityScores: [],
            approvedLoans: 0,
            totalDecisions: 0,
            seenLoanNumbers: new Set(),
          });
        }

        const monthData = actor.months.get(monthKey)!;

        // CRITICAL: Only count if this loan_number hasn't been seen for this actor in this month
        const monthLoanKey = `${monthKey}:${loanNumber}`;
        if (!monthData.seenLoanNumbers.has(loanNumber)) {
          monthData.seenLoanNumbers.add(loanNumber);
          monthData.unitsOutput++; // Count distinct loans only
        }

        // Only count total units if this loan hasn't been seen for this actor at all
        if (!actor.seenLoanNumbers.has(loanNumber)) {
          actor.seenLoanNumbers.add(loanNumber);
          actor.totalUnits++; // Count distinct loans only
        }

        // Volume, turn times, complexity - still sum/aggregate all rows
        actor.totalVolume += loanAmount;
        if (turnTime !== null) actor.allTurnTimes.push(turnTime);
        actor.allComplexityScores.push(complexity);

        monthData.volumeOutput += loanAmount;
        if (turnTime !== null) monthData.turnTimes.push(turnTime);
        monthData.complexityScores.push(complexity);

        // Track approval status
        const status = (l.current_loan_status || "").toUpperCase();
        if (
          status.includes("APPROV") ||
          status.includes("ORIGINATED") ||
          status.includes("FUNDED")
        ) {
          monthData.approvedLoans++;
          monthData.totalDecisions++;
        } else if (status.includes("DENIED") || status.includes("DECLINED")) {
          monthData.totalDecisions++;
        }
      });

      // Calculate company averages for TTS
      const actors = Array.from(actorMap.values()).filter(
        (a) => a.totalUnits > 0,
      );
      const actorCount = actors.length;

      if (actorCount === 0) {
        return res.json({
          actors: [],
          months: monthsList,
          totals: {},
          tierSummary: {
            top: {
              tier: "top",
              count: 0,
              totalUnits: 0,
              percentOfTotal: 0,
              avgUnitsPerMonth: 0,
              avgDaysPerUnit: 0,
            },
            second: {
              tier: "second",
              count: 0,
              totalUnits: 0,
              percentOfTotal: 0,
              avgUnitsPerMonth: 0,
              avgDaysPerUnit: 0,
            },
            bottom: {
              tier: "bottom",
              count: 0,
              totalUnits: 0,
              percentOfTotal: 0,
              avgUnitsPerMonth: 0,
              avgDaysPerUnit: 0,
            },
          },
          kpis: {
            targetUnitsPerMonth: targetUnits,
            avgUnitsOutput: 0,
            avgVolumeOutput: 0,
            avgLoanComplexityScore: 100,
            avgDays: 0,
          },
          dateRange: {
            start: effectiveStartDate.toISOString(),
            end: effectiveEndDate.toISOString(),
            monthsIncluded: monthsCount,
          },
        });
      }

      // Company averages
      const totalUnits = actors.reduce((sum, a) => sum + a.totalUnits, 0);
      const totalVolume = actors.reduce((sum, a) => sum + a.totalVolume, 0);
      const avgUnitsPerActor = totalUnits / actorCount;

      // Turn time average (inverse formula for TTS rating)
      let totalInverseTurnTime = 0;
      let turnTimeActorCount = 0;
      actors.forEach((a) => {
        if (a.allTurnTimes.length > 0) {
          const avgTurnTime =
            a.allTurnTimes.reduce((sum, t) => sum + t, 0) /
            a.allTurnTimes.length;
          if (avgTurnTime > 0) {
            totalInverseTurnTime += 1 / avgTurnTime;
            turnTimeActorCount++;
          }
        }
      });
      const avgInverseTurnTime =
        turnTimeActorCount > 0 ? totalInverseTurnTime / turnTimeActorCount : 0;

      // SIMPLE average of ALL turn times for KPI display (matches Qlik's Avg([Sent To Closing] - [Sent To Underwriting]))
      // NOT "average of per-actor averages" - Qlik calculates a simple average of all loan turn times
      const allTurnTimes = actors.flatMap((a) => a.allTurnTimes);
      const avgTurnTimeForKPI =
        allTurnTimes.length > 0
          ? allTurnTimes.reduce((sum, t) => sum + t, 0) / allTurnTimes.length
          : 0;

      // Per-actor average (for TTS calculations only)
      const avgTurnTimePerActor =
        actors.reduce((sum, a) => {
          if (a.allTurnTimes.length === 0) return sum;
          return (
            sum +
            a.allTurnTimes.reduce((s, t) => s + t, 0) / a.allTurnTimes.length
          );
        }, 0) /
        Math.max(1, actors.filter((a) => a.allTurnTimes.length > 0).length);

      // Complexity average
      const avgComplexity =
        actors.reduce((sum, a) => {
          if (a.allComplexityScores.length === 0) return sum;
          return (
            sum +
            a.allComplexityScores.reduce((s, c) => s + c, 0) /
              a.allComplexityScores.length
          );
        }, 0) / actorCount;

      // Volume average - only count actors with volume > 0 (matches Qlik's If(Sum=0, Null()) pattern)
      const actorsWithVolume = actors.filter((a) => a.totalVolume > 0);
      const avgVolumePerActor =
        actorsWithVolume.length > 0 ? totalVolume / actorsWithVolume.length : 0;

      // Calculate TTS and metrics for each actor
      const actorsWithMetrics = actors.map((a) => {
        const actorAvgTurnTime =
          a.allTurnTimes.length > 0
            ? a.allTurnTimes.reduce((sum, t) => sum + t, 0) /
              a.allTurnTimes.length
            : 0;
        const actorAvgComplexity =
          a.allComplexityScores.length > 0
            ? a.allComplexityScores.reduce((sum, c) => sum + c, 0) /
              a.allComplexityScores.length
            : 100;

        // Calculate ratings (for TTS score display)
        const unitRating =
          avgUnitsPerActor > 0 ? (a.totalUnits / avgUnitsPerActor) * 100 : 100;

        let turnTimeRating = 100;
        if (actorAvgTurnTime > 0 && avgInverseTurnTime > 0) {
          const actorInverseTurnTime = 1 / actorAvgTurnTime;
          turnTimeRating = (actorInverseTurnTime / avgInverseTurnTime) * 100;
        }

        const complexityRating =
          avgComplexity > 0 ? (actorAvgComplexity / avgComplexity) * 100 : 100;

        // Calculate TTS (kept for display purposes)
        const ttsScore =
          unitRating * weightConfig.unit +
          turnTimeRating * weightConfig.turnTime +
          complexityRating * weightConfig.complexity;

        // Build monthly metrics
        const monthsData: Record<string, any> = {};
        monthsList.forEach((monthKey) => {
          const md = a.months.get(monthKey);
          if (md) {
            const monthAvgDays =
              md.turnTimes.length > 0
                ? md.turnTimes.reduce((s, t) => s + t, 0) / md.turnTimes.length
                : 0;
            const monthAvgComplexity =
              md.complexityScores.length > 0
                ? md.complexityScores.reduce((s, c) => s + c, 0) /
                  md.complexityScores.length
                : 0;
            const conversionPercent =
              md.totalDecisions > 0
                ? (md.approvedLoans / md.totalDecisions) * 100
                : 0;

            monthsData[monthKey] = {
              unitsOutput: md.unitsOutput,
              outputVsTarget: md.unitsOutput - targetUnits,
              avgDays: Math.round(monthAvgDays * 10) / 10,
              conversionPercent: Math.round(conversionPercent * 10) / 10,
              loanComplexityScore: Math.round(monthAvgComplexity * 10) / 10,
              volumeOutput: Math.round(md.volumeOutput),
            };
          } else {
            // No data for this month
            monthsData[monthKey] = {
              unitsOutput: 0,
              outputVsTarget: -targetUnits,
              avgDays: 0,
              conversionPercent: 0,
              loanComplexityScore: 0,
              volumeOutput: 0,
            };
          }
        });

        // TIER ASSIGNMENT: TTS Score thresholds (matching Qlik "13 Month TVI Score Tiers" logic)
        // From Qlik Dimensions.csv:
        //   If(Avg(TVI_Score) >= 120, 'Top Tier',
        //   If(Avg(TVI_Score) >= 80, 'Second Tier', 'Bottom Tier'))
        let tier: "top" | "second" | "bottom";
        if (ttsScore >= 120) tier = "top";
        else if (ttsScore >= 80) tier = "second";
        else tier = "bottom";

        return {
          id: a.name.replace(/\s+/g, "-").toLowerCase(),
          name: a.name,
          totalUnits: a.totalUnits,
          ttsScore: Math.round(ttsScore * 10) / 10,
          tier,
          months: monthsData,
        };
      });

      // Sort by TTS score for display
      const actorsWithTTS = actorsWithMetrics;
      actorsWithTTS.sort((a, b) => b.ttsScore - a.ttsScore);

      // Calculate monthly totals
      const totals: Record<string, any> = {};
      monthsList.forEach((monthKey) => {
        let monthUnits = 0;
        let monthVolume = 0;

        actorsWithTTS.forEach((actor) => {
          const md = actor.months[monthKey];
          if (md) {
            monthUnits += md.unitsOutput;
            monthVolume += md.volumeOutput;
          }
        });

        totals[monthKey] = {
          unitsOutput: monthUnits,
          outputVsTarget: monthUnits - targetUnits * actorCount,
          volumeOutput: monthVolume,
        };
      });

      // Calculate tier summaries
      const createTierSummary = (tierActors: typeof actorsWithTTS) => {
        if (tierActors.length === 0) {
          return {
            tier: "bottom" as const,
            count: 0,
            totalUnits: 0,
            percentOfTotal: 0,
            avgUnitsPerMonth: 0,
            avgDaysPerUnit: 0,
          };
        }

        const tierUnits = tierActors.reduce((sum, a) => {
          return (
            sum +
            Object.values(a.months).reduce(
              (s: number, m: any) => s + (m.unitsOutput || 0),
              0,
            )
          );
        }, 0);

        const avgDays =
          tierActors.reduce((sum, a) => {
            const actorData = actorMap.get(a.name);
            if (!actorData || actorData.allTurnTimes.length === 0) return sum;
            return (
              sum +
              actorData.allTurnTimes.reduce((s, t) => s + t, 0) /
                actorData.allTurnTimes.length
            );
          }, 0) /
          Math.max(
            1,
            tierActors.filter((a) => {
              const actorData = actorMap.get(a.name);
              return actorData && actorData.allTurnTimes.length > 0;
            }).length,
          );

        return {
          tier: tierActors[0]?.tier || ("bottom" as const),
          count: tierActors.length,
          totalUnits: tierUnits,
          percentOfTotal:
            totalUnits > 0
              ? Math.round((tierUnits / totalUnits) * 1000) / 10
              : 0,
          avgUnitsPerMonth:
            Math.round((tierUnits / monthsCount / tierActors.length) * 10) / 10,
          avgDaysPerUnit: Math.round(avgDays * 10) / 10,
        };
      };

      const topActors = actorsWithTTS.filter((a) => a.tier === "top");
      const secondActors = actorsWithTTS.filter((a) => a.tier === "second");
      const bottomActors = actorsWithTTS.filter((a) => a.tier === "bottom");

      const tierSummary = {
        top: { ...createTierSummary(topActors), tier: "top" as const },
        second: { ...createTierSummary(secondActors), tier: "second" as const },
        bottom: { ...createTierSummary(bottomActors), tier: "bottom" as const },
      };

      // KPIs - "Total Monthly Output" = Average Monthly Output
      // This is the average output PER MONTH (total divided by months), NOT per actor
      const avgMonthlyUnits = Math.round(totalUnits / monthsCount);
      const avgMonthlyVolume = Math.round(totalVolume / monthsCount);

      const kpis = {
        targetUnitsPerMonth: targetUnits,
        avgUnitsOutput: avgMonthlyUnits, // Average units per month
        avgVolumeOutput: avgMonthlyVolume, // Average volume per month
        avgLoanComplexityScore: Math.round(avgComplexity * 10) / 10,
        avgDays: Math.round(avgTurnTimeForKPI * 10) / 10,
      };

      logInfo("[OpsScorecardTrends] Results", {
        actorType,
        actorCount,
        totalUnits,
        totalVolume,
        monthsCount,
        tiers: {
          top: topActors.length,
          second: secondActors.length,
          bottom: bottomActors.length,
        },
        kpiDebug: {
          avgUnitsOutput: kpis.avgUnitsOutput,
          avgVolumeOutput: kpis.avgVolumeOutput,
          avgDays: kpis.avgDays,
          allTurnTimesCount: allTurnTimes.length,
          turnTimeFieldsMissing,
          turnTimeValid,
        },
      });

      res.json({
        actors: actorsWithTTS,
        months: monthsList,
        totals,
        tierSummary,
        kpis,
        dateRange: {
          start: effectiveStartDate.toISOString(),
          end: effectiveEndDate.toISOString(),
          monthsIncluded: monthsCount,
        },
        // DEBUG INFO - SQL filtering now handles most of this
        _debug: {
          filterPipeline: {
            loansAfterSQLFilter: outputLoans.length,
          },
          dateRangeDetails: {
            vMaxDate: vMaxDate.toISOString(),
            vMaxDateFormatted: vMaxDate.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            }),
            effectiveStartDate: effectiveStartDate.toISOString(),
            effectiveStartFormatted: effectiveStartDate.toLocaleDateString(
              "en-US",
              { month: "short", day: "numeric", year: "numeric" },
            ),
            effectiveEndDate: effectiveEndDate.toISOString(),
            effectiveEndFormatted: effectiveEndDate.toLocaleDateString(
              "en-US",
              { month: "short", day: "numeric", year: "numeric" },
            ),
            expectedQlikRange: `>=${effectiveStartDate.toLocaleDateString(
              "en-US",
            )}<${effectiveEndDate.toLocaleDateString("en-US")}`,
          },
          actorConfig: {
            actorColumn: config.actorColumn,
            outputDateField: config.outputDateField,
          },
          distinctLoansCount: outputLoans.length,
          actorCount,
          totalDistinctUnits: totalUnits,
        },
      });
    } catch (error: any) {
      logError("Error fetching operations scorecard trends data", error, {
        userId: req.userId,
      });
      res.status(500).json({
        error:
          error.message || "Failed to fetch operations scorecard trends data",
      });
    }
  },
);

/**
 * GET /api/loans/sales-trends
 * Get Sales Trends data for LO performance over 3 or 6 months
 *
 * DOCUMENTATION: See docs/SALES_TRENDS_SPECIFICATION.md for complete specification
 *
 * Features:
 * - Per-LO metrics: units, volume, margin BPS, trend %, turn time
 * - KPI summary: total units, volume, active LOs, avg turn time
 * - Fund type breakdown: Conventional, FHA, VA, USDA, Jumbo
 * - Monthly performance aggregation
 * - Period-over-period trend calculation
 *
 * Query Parameters:
 * - date_range: '3-months' | '6-months' (default: '3-months')
 * - channel_group: Channel filter (default: 'Retail')
 */
router.get(
  "/sales-trends",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantPool = getTenantContext(req).tenantPool;

      // Parse query parameters
      const dateRange = (req.query.date_range as string) || "3-months";
      const channelGroup = (req.query.channel_group as string) || "Retail";
      const monthsBack = dateRange === "6-months" ? 6 : 3;
      const customStartDate = req.query.start_date as string | undefined;
      const customEndDate = req.query.end_date as string | undefined;

      // Calculate date ranges
      // Get vMaxDate equivalent (max last_modified_date in database)
      const maxDateResult = await tenantPool.query(`
      SELECT MAX(COALESCE(last_modified_date, funding_date, application_date, created_at)) as max_date
      FROM public.loans
    `);
      const vMaxDate = maxDateResult.rows[0]?.max_date
        ? new Date(maxDateResult.rows[0].max_date)
        : new Date();

      let currentStartDate: Date;
      let currentEndDate: Date;

      // Use client-supplied custom date range when provided (from DatePeriodPicker custom selection)
      if (customStartDate && customEndDate) {
        const parsedStart = new Date(customStartDate);
        const parsedEnd = new Date(customEndDate);
        if (!isNaN(parsedStart.getTime()) && !isNaN(parsedEnd.getTime())) {
          currentStartDate = parsedStart;
          currentEndDate = parsedEnd;
        } else {
          logWarn(
            "[SalesTrends] Invalid start_date/end_date params, falling back to default",
            { customStartDate, customEndDate },
          );
          currentEndDate = new Date(vMaxDate);
          currentStartDate = new Date(vMaxDate);
          currentStartDate.setMonth(currentStartDate.getMonth() - monthsBack);
          currentStartDate.setDate(1);
        }
      } else {
        // Default: Current period = last N months from vMaxDate
        currentEndDate = new Date(vMaxDate);
        currentStartDate = new Date(vMaxDate);
        currentStartDate.setMonth(currentStartDate.getMonth() - monthsBack);
        currentStartDate.setDate(1); // First day of month
      }

      // Previous period: same duration before current period (for trend calculation)
      const periodDurationMs =
        currentEndDate.getTime() - currentStartDate.getTime();
      const previousEndDate = new Date(currentStartDate);
      previousEndDate.setDate(previousEndDate.getDate() - 1); // Last day before current period
      const previousStartDate = new Date(
        previousEndDate.getTime() - periodDurationMs,
      );

      logInfo("[SalesTrends] Date ranges calculated", {
        dateRange,
        currentPeriod: {
          start: currentStartDate.toISOString(),
          end: currentEndDate.toISOString(),
        },
        previousPeriod: {
          start: previousStartDate.toISOString(),
          end: previousEndDate.toISOString(),
        },
      });

      // Fetch all loans in both periods (current + previous for trend calculation)
      const loansResult = await tenantPool.query(
        `
      SELECT 
        loan_id,
        loan_number,
        loan_amount,
        loan_type,
        loan_purpose,
        funding_date,
        application_date,
        closing_date,
        loan_officer,
        branch,
        channel,
        current_loan_status,
        rate_lock_buy_side_base_price_rate,
        orig_fee_borr_pd,
        orig_fees_seller,
        cd_lender_credits
      FROM public.loans
      WHERE funding_date IS NOT NULL
        AND funding_date >= $1
        AND funding_date <= $2
    `,
        [previousStartDate.toISOString(), currentEndDate.toISOString()],
      );

      const allLoans = loansResult.rows;

      // Apply channel filter
      const channelFilteredLoans = allLoans.filter((l: any) => {
        const channel = (l.channel || "").toLowerCase();
        if (channelGroup.toLowerCase() === "retail") {
          return channel.includes("retail") || channel.includes("brok");
        } else if (channelGroup.toLowerCase() === "tpo") {
          return channel.includes("whole") || channel.includes("corresp");
        }
        return true;
      });

      // isActorMissing and calcLoanRevenue are imported from shared utilities at file top

      // Helper: Calculate turn time in days
      function calcTurnTime(loan: any): number | null {
        if (!loan.closing_date || !loan.application_date) return null;
        const closingDate = new Date(loan.closing_date);
        const appDate = new Date(loan.application_date);
        const days =
          (closingDate.getTime() - appDate.getTime()) / (1000 * 60 * 60 * 24);
        return days > 0 ? days : null;
      }

      // Split loans by period
      const currentPeriodLoans = channelFilteredLoans.filter((l: any) => {
        const fundDate = new Date(l.funding_date);
        return fundDate >= currentStartDate && fundDate <= currentEndDate;
      });

      const previousPeriodLoans = channelFilteredLoans.filter((l: any) => {
        const fundDate = new Date(l.funding_date);
        return fundDate >= previousStartDate && fundDate <= previousEndDate;
      });

      // Filter out missing LOs for current period
      const validCurrentLoans = currentPeriodLoans.filter(
        (l: any) => !isActorMissing(l.loan_officer),
      );
      const validPreviousLoans = previousPeriodLoans.filter(
        (l: any) => !isActorMissing(l.loan_officer),
      );

      // Aggregate per-LO metrics for current period
      interface LOMetrics {
        name: string;
        branch: string;
        units: number;
        volume: number;
        revenue: number;
        turnTimes: number[];
        previousUnits: number;
      }

      const loMap = new Map<string, LOMetrics>();

      // Process current period loans
      validCurrentLoans.forEach((loan: any) => {
        const loName = loan.loan_officer;
        const existing = loMap.get(loName) || {
          name: loName,
          branch: loan.branch || "Unknown",
          units: 0,
          volume: 0,
          revenue: 0,
          turnTimes: [],
          previousUnits: 0,
        };

        existing.units += 1;
        existing.volume += parseFloat(loan.loan_amount || 0);
        existing.revenue += calcLoanRevenue(loan);

        const turnTime = calcTurnTime(loan);
        if (turnTime !== null) {
          existing.turnTimes.push(turnTime);
        }

        loMap.set(loName, existing);
      });

      // Add previous period units for trend calculation
      validPreviousLoans.forEach((loan: any) => {
        const loName = loan.loan_officer;
        const existing = loMap.get(loName);
        if (existing) {
          existing.previousUnits += 1;
        }
      });

      // Calculate TTS scores using the same logic as sales-scorecard
      // For simplicity, we'll use volume-based tier assignment here
      const allLOs = Array.from(loMap.values());
      const totalVolume = allLOs.reduce((sum, lo) => sum + lo.volume, 0);
      const avgVolume = allLOs.length > 0 ? totalVolume / allLOs.length : 0;

      // Build LO response array
      interface LoanOfficerResponse {
        id: string;
        name: string;
        initials: string;
        branch: string;
        branchNumber: string;
        tier: "top" | "2nd" | "bottom";
        closed: number;
        volume: number;
        marginBPS: number;
        trendPercent: number;
        daysAvg: number;
        ttsScore: number;
      }

      // Helper to convert NaN to 0 (NaN becomes null in JSON which breaks the frontend)
      const safeNum = (n: number): number => (isNaN(n) || !isFinite(n) ? 0 : n);

      const loanOfficers: LoanOfficerResponse[] = allLOs
        .filter((lo) => lo.units > 0)
        .map((lo, index) => {
          // Ensure revenue is a valid number (guard against NaN from bad data)
          const safeRevenue = safeNum(lo.revenue);

          // Calculate margin BPS
          const marginBPS =
            lo.volume > 0 ? (safeRevenue / lo.volume) * 10000 : 0;

          // Calculate trend %
          let trendPercent = 0;
          if (lo.previousUnits > 0) {
            trendPercent =
              ((lo.units - lo.previousUnits) / lo.previousUnits) * 100;
          } else if (lo.units > 0) {
            trendPercent = 100; // New production = +100%
          }

          // Calculate avg turn time
          const daysAvg =
            lo.turnTimes.length > 0
              ? lo.turnTimes.reduce((a, b) => a + b, 0) / lo.turnTimes.length
              : 0;

          // Calculate simple TTS score based on volume ratio
          const volumeRating =
            avgVolume > 0 ? (lo.volume / avgVolume) * 100 : 100;
          const ttsScore = volumeRating; // Simplified - in production, use full TTS formula

          // Assign tier based on TTS
          let tier: "top" | "2nd" | "bottom" = "bottom";
          if (ttsScore >= 120) tier = "top";
          else if (ttsScore >= 80) tier = "2nd";

          // Generate initials
          const nameParts = lo.name.split(" ");
          const initials =
            nameParts.length >= 2
              ? `${nameParts[0][0]}${
                  nameParts[nameParts.length - 1][0]
                }`.toUpperCase()
              : lo.name.substring(0, 2).toUpperCase();

          // Extract branch number
          const branchMatch = lo.branch?.match(/\d+/);
          const branchNumber = branchMatch ? branchMatch[0] : "";

          return {
            id: `lo-${index + 1}`,
            name: lo.name,
            initials,
            branch: lo.branch,
            branchNumber,
            tier,
            closed: safeNum(lo.units),
            volume: safeNum(lo.volume),
            marginBPS: Math.round(safeNum(marginBPS)),
            trendPercent: Math.round(safeNum(trendPercent)),
            daysAvg: Math.round(safeNum(daysAvg)),
            ttsScore: Math.round(safeNum(ttsScore)),
          };
        })
        .sort((a, b) => b.ttsScore - a.ttsScore);

      // Calculate KPI metrics
      const totalUnits = loanOfficers.reduce((sum, lo) => sum + lo.closed, 0);
      const totalVolumeKPI = loanOfficers.reduce(
        (sum, lo) => sum + lo.volume,
        0,
      );
      const activeLOs = loanOfficers.length;
      const allTurnTimes = validCurrentLoans
        .map((l: any) => calcTurnTime(l))
        .filter((t): t is number => t !== null);
      const avgTurnTime =
        allTurnTimes.length > 0
          ? Math.round(
              allTurnTimes.reduce((a, b) => a + b, 0) / allTurnTimes.length,
            )
          : 0;

      // Calculate fund type breakdown
      const conformingLimit = 726200; // 2023 conforming loan limit

      interface FundTypeCount {
        name: string;
        value: number;
        fill: string;
      }

      const fundTypeBreakdown: FundTypeCount[] = [
        {
          name: "Conventional",
          value: validCurrentLoans.filter(
            (l: any) =>
              l.loan_type === "Conventional" &&
              parseFloat(l.loan_amount || 0) <= conformingLimit,
          ).length,
          fill: "#3b82f6",
        },
        {
          name: "FHA",
          value: validCurrentLoans.filter((l: any) => l.loan_type === "FHA")
            .length,
          fill: "#10b981",
        },
        {
          name: "VA",
          value: validCurrentLoans.filter((l: any) => l.loan_type === "VA")
            .length,
          fill: "#a855f7",
        },
        {
          name: "USDA",
          value: validCurrentLoans.filter((l: any) => {
            const loanType = (l.loan_type || "").toLowerCase();
            return loanType.includes("farmershome") || loanType === "usda";
          }).length,
          fill: "#f97316",
        },
        {
          name: "Jumbo",
          value: validCurrentLoans.filter(
            (l: any) =>
              l.loan_type === "Conventional" &&
              parseFloat(l.loan_amount || 0) > conformingLimit,
          ).length,
          fill: "#ec4899",
        },
      ];

      // Calculate monthly performance
      interface MonthlyPerf {
        month: string;
        units: number;
        volume: number;
      }

      const monthMap = new Map<string, { units: number; volume: number }>();

      validCurrentLoans.forEach((loan: any) => {
        const fundDate = new Date(loan.funding_date);
        const year = fundDate.getFullYear();
        const monthName = fundDate.toLocaleString("en", { month: "short" });
        const monthKey = `${year}-${monthName}`;

        const existing = monthMap.get(monthKey) || { units: 0, volume: 0 };
        monthMap.set(monthKey, {
          units: existing.units + 1,
          volume: existing.volume + parseFloat(loan.loan_amount || 0),
        });
      });

      const monthlyPerformance: MonthlyPerf[] = Array.from(monthMap.entries())
        .map(([month, data]) => ({ month, ...data }))
        .sort((a, b) => {
          // Parse month strings for sorting
          const parseMonth = (m: string) => {
            const [year, mon] = m.split("-");
            const monthNum = new Date(`${mon} 1, ${year}`).getMonth();
            return parseInt(year) * 12 + monthNum;
          };
          return parseMonth(a.month) - parseMonth(b.month);
        });

      logInfo("[SalesTrends] Response summary", {
        loanOfficerCount: loanOfficers.length,
        totalUnits,
        totalVolume: Math.round(totalVolumeKPI),
        fundTypeBreakdown: fundTypeBreakdown.map((f) => ({
          name: f.name,
          count: f.value,
        })),
        monthlyPeriods: monthlyPerformance.length,
      });

      res.json({
        loanOfficers,
        kpiMetrics: {
          totalUnits,
          totalVolume: totalVolumeKPI,
          activeLOs,
          avgTurnTime,
        },
        fundTypeBreakdown,
        monthlyPerformance,
        dateRange: {
          startDate: currentStartDate.toISOString(),
          endDate: currentEndDate.toISOString(),
          previousStartDate: previousStartDate.toISOString(),
          previousEndDate: previousEndDate.toISOString(),
        },
      });
    } catch (error: any) {
      logError("Error fetching sales trends data", error, {
        userId: req.userId,
      });
      res
        .status(500)
        .json({ error: error.message || "Failed to fetch sales trends data" });
    }
  },
);

/**
 * GET /api/loans/sales-trends/drilldown/:loName
 * Get detailed drilldown data for a specific Loan Officer
 */
router.get(
  "/sales-trends/drilldown/:loName",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantPool = getTenantContext(req).tenantPool;
      const loName = req.params.loName as string;
      const decodedLoName = decodeURIComponent(loName);

      const dateRange = (req.query.date_range as string) || "3-months";
      const channelGroup = (req.query.channel_group as string) || "Retail";
      const monthsBack = dateRange === "6-months" ? 6 : 3;

      // Calculate date range
      const maxDateResult = await tenantPool.query(`
      SELECT MAX(COALESCE(last_modified_date, funding_date, application_date, created_at)) as max_date
      FROM public.loans
    `);
      const vMaxDate = maxDateResult.rows[0]?.max_date
        ? new Date(maxDateResult.rows[0].max_date)
        : new Date();

      const endDate = new Date(vMaxDate);
      const startDate = new Date(vMaxDate);
      startDate.setMonth(startDate.getMonth() - monthsBack);
      startDate.setDate(1);

      // Fetch LO's loans
      const loansResult = await tenantPool.query(
        `
      SELECT 
        loan_id,
        loan_number,
        loan_amount,
        loan_type,
        loan_purpose,
        funding_date,
        application_date,
        closing_date,
        loan_officer,
        branch,
        channel,
        current_loan_status,
        rate_lock_buy_side_base_price_rate,
        orig_fee_borr_pd,
        orig_fees_seller,
        cd_lender_credits
      FROM public.loans
      WHERE loan_officer = $1
        AND funding_date IS NOT NULL
        AND funding_date >= $2
        AND funding_date <= $3
    `,
        [decodedLoName, startDate.toISOString(), endDate.toISOString()],
      );

      const loLoans = loansResult.rows;

      // Apply channel filter
      const filteredLoans = loLoans.filter((l: any) => {
        const channel = (l.channel || "").toLowerCase();
        if (channelGroup.toLowerCase() === "retail") {
          return channel.includes("retail") || channel.includes("brok");
        } else if (channelGroup.toLowerCase() === "tpo") {
          return channel.includes("whole") || channel.includes("corresp");
        }
        return true;
      });

      // Helper functions
      // NOTE: calcLoanRevenue is imported from scorecard-utils.ts for consistency across the codebase

      function calcTurnTime(loan: any): number | null {
        if (!loan.closing_date || !loan.application_date) return null;
        const closingDate = new Date(loan.closing_date);
        const appDate = new Date(loan.application_date);
        const days =
          (closingDate.getTime() - appDate.getTime()) / (1000 * 60 * 60 * 24);
        return days > 0 ? days : null;
      }

      // Calculate summary metrics
      const totalClosed = filteredLoans.length;
      const totalVolume = filteredLoans.reduce(
        (sum: number, l: any) => sum + parseFloat(l.loan_amount || 0),
        0,
      );
      const totalRevenue = filteredLoans.reduce(
        (sum: number, l: any) => sum + calcLoanRevenue(l),
        0,
      );
      const avgMargin =
        totalVolume > 0 ? (totalRevenue / totalVolume) * 10000 : 0;

      const turnTimes = filteredLoans
        .map((l: any) => calcTurnTime(l))
        .filter((t): t is number => t !== null);
      const turnTime =
        turnTimes.length > 0
          ? turnTimes.reduce((a, b) => a + b, 0) / turnTimes.length
          : 0;

      // Get branch rank
      const branchRankResult = await tenantPool.query(
        `
      SELECT loan_officer, COUNT(*) as units
      FROM public.loans
      WHERE branch = (SELECT branch FROM public.loans WHERE loan_officer = $1 LIMIT 1)
        AND funding_date IS NOT NULL
        AND funding_date >= $2
        AND funding_date <= $3
      GROUP BY loan_officer
      ORDER BY units DESC
    `,
        [decodedLoName, startDate.toISOString(), endDate.toISOString()],
      );

      const branchLOs = branchRankResult.rows;
      const branchRank =
        branchLOs.findIndex((r: any) => r.loan_officer === decodedLoName) + 1;
      const branchTotal = branchLOs.length;

      // Calculate monthly details
      interface MonthlyDetail {
        month: string;
        closed: number;
        volume: number;
        margin: number;
        pullThrough: number;
        turnTime: number;
      }

      const monthMap = new Map<string, { loans: any[] }>();

      filteredLoans.forEach((loan: any) => {
        const fundDate = new Date(loan.funding_date);
        const year = fundDate.getFullYear();
        const monthName = fundDate.toLocaleString("en", { month: "short" });
        const monthKey = `${year}-${monthName}`;

        const existing = monthMap.get(monthKey) || { loans: [] };
        existing.loans.push(loan);
        monthMap.set(monthKey, existing);
      });

      const monthlyDetails: MonthlyDetail[] = Array.from(monthMap.entries())
        .map(([month, data]) => {
          const monthLoans = data.loans;
          const monthVolume = monthLoans.reduce(
            (sum: number, l: any) => sum + parseFloat(l.loan_amount || 0),
            0,
          );
          const monthRevenue = monthLoans.reduce(
            (sum: number, l: any) => sum + calcLoanRevenue(l),
            0,
          );
          const monthTurnTimes = monthLoans
            .map((l: any) => calcTurnTime(l))
            .filter((t): t is number => t !== null);

          return {
            month,
            closed: monthLoans.length,
            volume: monthVolume,
            margin:
              monthVolume > 0
                ? Math.round((monthRevenue / monthVolume) * 10000)
                : 0,
            pullThrough: 50, // Would need application data to calculate properly
            turnTime:
              monthTurnTimes.length > 0
                ? Math.round(
                    monthTurnTimes.reduce((a, b) => a + b, 0) /
                      monthTurnTimes.length,
                  )
                : 0,
          };
        })
        .sort((a, b) => {
          const parseMonth = (m: string) => {
            const [year, mon] = m.split("-");
            const monthNum = new Date(`${mon} 1, ${year}`).getMonth();
            return parseInt(year) * 12 + monthNum;
          };
          return parseMonth(b.month) - parseMonth(a.month); // Descending (most recent first)
        });

      // Performance trend (for chart)
      const performanceTrend = monthlyDetails
        .slice()
        .reverse() // Ascending for chart
        .map((d) => ({
          month: d.month.split("-")[1], // Just month abbreviation
          closedUnits: d.closed,
          marginBPS: d.margin,
        }));

      res.json({
        totalClosed,
        totalVolume,
        avgMargin: Math.round(avgMargin),
        turnTime: Math.round(turnTime),
        branchRank,
        branchTotal,
        contact: {
          email: "loan.officer@company.com", // Placeholder - would come from user directory
          phone: "(555) 123-4567",
          location: filteredLoans[0]?.branch || "Unknown",
        },
        monthlyDetails,
        performanceTrend,
      });
    } catch (error: any) {
      logError("Error fetching sales trends drilldown", error, {
        userId: req.userId,
        loName: req.params.loName,
      });
      res.status(500).json({
        error: error.message || "Failed to fetch sales trends drilldown",
      });
    }
  },
);

/**
 * GET /api/loans/toptiering-comparison
 * Get TopTiering Pareto chart data for Branch or Loan Officer comparison
 *
 * Qlik Reference: "TopTiering by" sheet in Performance app
 *
 * This endpoint differs from sales-scorecard in that it uses CUMULATIVE REVENUE PERCENTAGE
 * for tier assignment (50/30/20 split), NOT the TTS weighted composite score.
 *
 * Query Parameters:
 * - actor_type: 'branch' | 'loan-officer' (default: 'loan-officer')
 * - date_range: 'last-year' | 'last-quarter' | 'last-month' | 'ytd' | 'qtd' | 'mtd' | 'custom'
 * - start_date: ISO date string (for custom range)
 * - end_date: ISO date string (for custom range)
 * - channel_group: 'Retail' | 'TPO' | specific channel
 */
router.get(
  "/toptiering-comparison",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    // DEPRECATED: Use /api/toptiering/comparison instead
    addDeprecationHeaders(res, "/api/toptiering/comparison");
    try {
      const tenantPool = getTenantContext(req).tenantPool;

      // Parse query parameters
      const actorType = (req.query.actor_type as string) || "loan-officer";
      const dateRange = (req.query.date_range as string) || "last-year";
      const startDateParam = req.query.start_date as string | undefined;
      const endDateParam = req.query.end_date as string | undefined;
      const channelGroup = req.query.channel_group as string | undefined;

      // Validate actor type
      if (!["branch", "loan-officer"].includes(actorType)) {
        return res.status(400).json({
          error: 'Invalid actor_type. Must be "branch" or "loan-officer"',
        });
      }

      const actorColumn = actorType === "branch" ? "branch" : "loan_officer";
      const actorIdColumn =
        actorType === "branch" ? "branch" : "loan_officer_id";

      // isActorMissing is now imported from shared utilities

      // Get vMaxDate from data (like Qlik's Max("Last Modified Date"))
      const maxDateResult = await tenantPool.query(`
      SELECT 
        MAX(COALESCE(last_modified_date, funding_date)) as max_date,
        MAX(funding_date) as max_funding_date
      FROM public.loans 
      WHERE funding_date IS NOT NULL
    `);

      const vMaxDate = maxDateResult.rows[0]?.max_date
        ? new Date(maxDateResult.rows[0].max_date)
        : new Date();

      // Calculate effective date range based on dateRange parameter
      let effectiveStartDate: Date;
      let effectiveEndDate: Date;
      let dateRangeLabel: string;

      if (dateRange === "custom" && startDateParam && endDateParam) {
        effectiveStartDate = new Date(startDateParam);
        effectiveEndDate = new Date(endDateParam);
        dateRangeLabel = "Custom Range";
      } else {
        effectiveEndDate = new Date(vMaxDate);

        switch (dateRange) {
          case "last-year":
            // Previous calendar year
            effectiveStartDate = new Date(vMaxDate.getFullYear() - 1, 0, 1); // Jan 1 last year
            effectiveEndDate = new Date(vMaxDate.getFullYear() - 1, 11, 31); // Dec 31 last year
            dateRangeLabel = "Last Year";
            break;
          case "last-quarter":
            const currentQuarter = Math.floor(vMaxDate.getMonth() / 3);
            const lastQuarter = currentQuarter - 1;
            if (lastQuarter < 0) {
              effectiveStartDate = new Date(vMaxDate.getFullYear() - 1, 9, 1); // Q4 last year
              effectiveEndDate = new Date(vMaxDate.getFullYear() - 1, 11, 31);
            } else {
              effectiveStartDate = new Date(
                vMaxDate.getFullYear(),
                lastQuarter * 3,
                1,
              );
              effectiveEndDate = new Date(
                vMaxDate.getFullYear(),
                (lastQuarter + 1) * 3,
                0,
              );
            }
            dateRangeLabel = "Last Quarter";
            break;
          case "last-month":
            const lastMonth = new Date(vMaxDate);
            lastMonth.setMonth(lastMonth.getMonth() - 1);
            effectiveStartDate = new Date(
              lastMonth.getFullYear(),
              lastMonth.getMonth(),
              1,
            );
            effectiveEndDate = new Date(
              lastMonth.getFullYear(),
              lastMonth.getMonth() + 1,
              0,
            );
            dateRangeLabel = "Last Month";
            break;
          case "ytd":
            effectiveStartDate = new Date(vMaxDate.getFullYear(), 0, 1);
            effectiveEndDate = new Date(vMaxDate);
            dateRangeLabel = "Year to Date";
            break;
          case "qtd":
            const qStart = Math.floor(vMaxDate.getMonth() / 3) * 3;
            effectiveStartDate = new Date(vMaxDate.getFullYear(), qStart, 1);
            effectiveEndDate = new Date(vMaxDate);
            dateRangeLabel = "Quarter to Date";
            break;
          case "mtd":
            effectiveStartDate = new Date(
              vMaxDate.getFullYear(),
              vMaxDate.getMonth(),
              1,
            );
            effectiveEndDate = new Date(vMaxDate);
            dateRangeLabel = "Month to Date";
            break;
          default:
            // Default to last year
            effectiveStartDate = new Date(vMaxDate.getFullYear() - 1, 0, 1);
            effectiveEndDate = new Date(vMaxDate.getFullYear() - 1, 11, 31);
            dateRangeLabel = "Last Year";
        }
      }

      logInfo("[TopTieringComparison] Start", {
        actorType,
        dateRange,
        channel: channelGroup,
        startDate: effectiveStartDate.toISOString(),
        endDate: effectiveEndDate.toISOString(),
      });

      // Build channel filter condition using corrected grouping
      // TPO requires BOTH a TPO channel pattern AND populated account_executive.
      // Loans with a TPO channel but no AE are classified as Retail.
      const queryParams: any[] = [
        effectiveStartDate.toISOString().split("T")[0],
        effectiveEndDate.toISOString().split("T")[0],
      ];

      let channelCondition = "";
      if (channelGroup) {
        channelCondition = buildChannelWhereClause(channelGroup);
        // Handle individual channel exact-match (uses parameterized query)
        if (
          channelGroup !== "All" &&
          channelGroup !== "Retail" &&
          channelGroup !== "TPO" &&
          channelGroup !== "99-Missing" &&
          channelGroup !== "Other"
        ) {
          // buildChannelWhereClause uses string interpolation for the default case;
          // override with parameterized query for safety
          channelCondition = `AND LOWER(TRIM(channel)) = LOWER($3)`;
          queryParams.push(channelGroup);
        }
      }

      // Fetch aggregated data by actor
      // Revenue formula matches Qlik REVENUE.qvs:
      //   [Base Buy ($)] + [Orig Fee Borr Pd] + [Orig Fees Seller] - [CD Lender Credits]
      //
      // IMPORTANT: [Base Buy ($)] is CALCULATED from rate_lock_buy_side_base_price_rate:
      //   [Base Buy ($)] = ((rate_lock_buy_side_base_price_rate - 100) / 100) * loan_amount
      //
      // NOTE: Do NOT include pa_sell_amt, pa_srp_amt, or pa_payout_* fields - they are NOT in the Qlik formula
      const actorDataQuery = `
      WITH funded_loans AS (
        SELECT 
          ${actorColumn} AS actor_name,
          ${actorIdColumn} AS actor_id,
          loan_id,
          COALESCE(loan_number, loan_id) AS loan_number,  -- Include for DISTINCT counting
          loan_amount,
          funding_date,
          -- Revenue calculation matching Qlik formula (REVENUE.qvs)
          -- [Base Buy ($)] = ((rate_lock_buy_side_base_price_rate - 100) / 100) * loan_amount
          -- Revenue = [Base Buy ($)] + [Orig Fee Borr Pd] + [Orig Fees Seller] - [CD Lender Credits]
          ((COALESCE(rate_lock_buy_side_base_price_rate, 0) - 100) / 100.0) * COALESCE(loan_amount, 0) +
          COALESCE(orig_fee_borr_pd, 0) +
          COALESCE(orig_fees_seller, 0) -
          COALESCE(cd_lender_credits, 0) AS revenue
        FROM public.loans
        WHERE funding_date IS NOT NULL
          AND funding_date >= $1
          AND funding_date <= $2
          AND rate_lock_buy_side_base_price_rate > 0
          ${channelCondition}
      ),
      actor_aggregates AS (
        SELECT 
          actor_name,
          actor_id,
          -- CRITICAL: Use COUNT(DISTINCT) to match Qlik's COUNT(DISTINCT [Loan Number])
          COUNT(DISTINCT COALESCE(loan_number, loan_id)) AS units,
          SUM(loan_amount) AS volume,
          SUM(revenue) AS revenue,
          CASE 
            WHEN SUM(loan_amount) > 0 THEN (SUM(revenue) / SUM(loan_amount)) * 10000 
            ELSE 0 
          END AS revenue_bps,
          CASE 
            WHEN COUNT(DISTINCT COALESCE(loan_number, loan_id)) > 0 THEN SUM(revenue) / COUNT(DISTINCT COALESCE(loan_number, loan_id)) 
            ELSE 0 
          END AS revenue_per_loan
        FROM funded_loans
        WHERE actor_name IS NOT NULL 
          AND actor_name != ''
          AND actor_name NOT ILIKE '99-%'
          AND actor_name NOT ILIKE 'Missing'
          AND actor_name NOT ILIKE 'No LO Found'
          AND actor_name NOT ILIKE 'No Loan Officer'
          AND actor_name NOT ILIKE 'No Branch Found'
          AND actor_name NOT ILIKE 'Unknown'
        GROUP BY actor_name, actor_id
        HAVING SUM(revenue) > 0
      )
      SELECT * FROM actor_aggregates
      ORDER BY revenue DESC
    `;

      const actorDataResult = await tenantPool.query(
        actorDataQuery,
        queryParams,
      );

      // Filter out missing actors (double-check with helper function)
      const rawActors = actorDataResult.rows.filter(
        (row) => !isActorMissing(row.actor_name),
      );

      // Calculate totals
      const totalRevenue = rawActors.reduce(
        (sum, a) => sum + parseFloat(a.revenue || 0),
        0,
      );
      const totalUnits = rawActors.reduce(
        (sum, a) => sum + parseInt(a.units || 0),
        0,
      );
      const totalVolume = rawActors.reduce(
        (sum, a) => sum + parseFloat(a.volume || 0),
        0,
      );

      // Assign tiers based on cumulative revenue percentage (50/30/20 split)
      // Sort by revenue descending (already done in query)
      let cumulativeRevenue = 0;
      const actorsWithTiers = rawActors.map((actor) => {
        const actorRevenue = parseFloat(actor.revenue || 0);
        cumulativeRevenue += actorRevenue;
        const cumulativePercent =
          totalRevenue > 0 ? (cumulativeRevenue / totalRevenue) * 100 : 0;

        // Determine tier based on cumulative revenue percentage
        // The actor that crosses the threshold gets assigned to the lower tier
        let tier: "top" | "second" | "bottom";
        if (cumulativePercent <= 50) {
          tier = "top";
        } else if (cumulativePercent <= 80) {
          tier = "second";
        } else {
          tier = "bottom";
        }

        return {
          id: actor.actor_id || actor.actor_name,
          name: actor.actor_name,
          tier,
          revenue: actorRevenue,
          units: parseInt(actor.units || 0),
          volume: parseFloat(actor.volume || 0),
          revenueBPS: parseFloat(actor.revenue_bps || 0),
          revenuePerLoan: parseFloat(actor.revenue_per_loan || 0),
          cumulativeRevenuePercent: cumulativePercent,
        };
      });

      // Calculate cumulative units percentage
      let cumulativeUnits = 0;
      actorsWithTiers.forEach((actor) => {
        cumulativeUnits += actor.units;
        (actor as any).cumulativeUnitsPercent =
          totalUnits > 0 ? (cumulativeUnits / totalUnits) * 100 : 0;
      });

      // Calculate tier summaries
      const tierSummary = {
        top: {
          count: 0,
          revenue: 0,
          revenuePercent: 0,
          units: 0,
          unitsPercent: 0,
          avgRevenue: 0,
          avgUnits: 0,
        },
        second: {
          count: 0,
          revenue: 0,
          revenuePercent: 0,
          units: 0,
          unitsPercent: 0,
          avgRevenue: 0,
          avgUnits: 0,
        },
        bottom: {
          count: 0,
          revenue: 0,
          revenuePercent: 0,
          units: 0,
          unitsPercent: 0,
          avgRevenue: 0,
          avgUnits: 0,
        },
      };

      actorsWithTiers.forEach((actor) => {
        tierSummary[actor.tier].count += 1;
        tierSummary[actor.tier].revenue += actor.revenue;
        tierSummary[actor.tier].units += actor.units;
      });

      // Calculate percentages and averages for each tier
      (["top", "second", "bottom"] as const).forEach((tier) => {
        const t = tierSummary[tier];
        t.revenuePercent =
          totalRevenue > 0 ? (t.revenue / totalRevenue) * 100 : 0;
        t.unitsPercent = totalUnits > 0 ? (t.units / totalUnits) * 100 : 0;
        t.avgRevenue = t.count > 0 ? t.revenue / t.count : 0;
        t.avgUnits = t.count > 0 ? t.units / t.count : 0;
      });

      // Calculate YoY growth (compare to same period last year)
      let yoyGrowth: number | undefined;
      try {
        const lastYearStart = new Date(effectiveStartDate);
        lastYearStart.setFullYear(lastYearStart.getFullYear() - 1);
        const lastYearEnd = new Date(effectiveEndDate);
        lastYearEnd.setFullYear(lastYearEnd.getFullYear() - 1);

        const lastYearQuery = `
        SELECT SUM(
          COALESCE(origination_points, 0) +
          COALESCE(orig_fee_borr_pd, 0) +
          COALESCE(orig_fees_seller, 0) -
          COALESCE(cd_lender_credits, 0) +
          COALESCE(pa_sell_amt, 0) +
          COALESCE(pa_srp_amt, 0) +
          COALESCE(pa_payout_1, 0) + COALESCE(pa_payout_2, 0) + 
          COALESCE(pa_payout_3, 0) + COALESCE(pa_payout_4, 0) +
          COALESCE(pa_payout_5, 0) + COALESCE(pa_payout_6, 0) +
          COALESCE(pa_payout_7, 0) + COALESCE(pa_payout_8, 0) +
          COALESCE(pa_payout_9, 0) + COALESCE(pa_payout_10, 0) +
          COALESCE(pa_payout_11, 0) + COALESCE(pa_payout_12, 0)
        ) AS last_year_revenue
        FROM public.loans
        WHERE funding_date IS NOT NULL
          AND funding_date >= $1
          AND funding_date <= $2
          AND rate_lock_buy_side_base_price_rate > 0
          ${channelCondition}
      `;

        const lastYearParams = [
          lastYearStart.toISOString().split("T")[0],
          lastYearEnd.toISOString().split("T")[0],
        ];
        if (
          channelGroup &&
          channelGroup !== "Retail" &&
          channelGroup !== "TPO"
        ) {
          lastYearParams.push(channelGroup);
        }

        const lastYearResult = await tenantPool.query(
          lastYearQuery,
          lastYearParams,
        );
        const lastYearRevenue = parseFloat(
          lastYearResult.rows[0]?.last_year_revenue || 0,
        );

        if (lastYearRevenue > 0) {
          yoyGrowth =
            ((totalRevenue - lastYearRevenue) / lastYearRevenue) * 100;
        }
      } catch (e) {
        logWarn("[TopTieringComparison] Failed to calculate YoY growth", {
          error: e,
        });
      }

      // Construct response
      const response = {
        actors: actorsWithTiers,
        totals: {
          revenue: totalRevenue,
          units: totalUnits,
          volume: totalVolume,
          avgRevenueBPS:
            totalVolume > 0 ? (totalRevenue / totalVolume) * 10000 : 0,
          actorCount: actorsWithTiers.length,
          avgRevenuePerActor:
            actorsWithTiers.length > 0
              ? totalRevenue / actorsWithTiers.length
              : 0,
          avgUnitsPerActor:
            actorsWithTiers.length > 0
              ? totalUnits / actorsWithTiers.length
              : 0,
        },
        tierSummary,
        dateRange: {
          start: effectiveStartDate.toISOString().split("T")[0],
          end: effectiveEndDate.toISOString().split("T")[0],
          label: dateRangeLabel,
          periodType: dateRange,
        },
        yoyGrowth,
      };

      logInfo("[TopTieringComparison] Complete", {
        actorCount: actorsWithTiers.length,
        totalRevenue,
        totalUnits,
        tierCounts: {
          top: tierSummary.top.count,
          second: tierSummary.second.count,
          bottom: tierSummary.bottom.count,
        },
      });

      res.json(response);
    } catch (error: any) {
      logError("Error fetching toptiering comparison data", error, {
        userId: req.userId,
      });
      res.status(500).json({
        error: error.message || "Failed to fetch toptiering comparison data",
      });
    }
  },
);

/**
 * POST /api/loans/predict
 * Predict outcomes for active loans - simplified version with instant bucketing
 * Returns signal strength buckets and rule-based risk summaries
 */
router.post(
  "/predict",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    // DEPRECATED: Use POST /api/predictions instead
    addDeprecationHeaders(res, "/api/predictions");
    try {
      const tenantContext = getTenantContext(req);
      const tenantPool = tenantContext.tenantPool;
      const tenantId = tenantContext.tenantId;

      // Get request body - maxLoanAgeMonths filters out loans older than X months
      // Default: 0 (no filter) to match metrics service active_loans definition
      const {
        customPrompt,
        loanIds,
        maxLoanAgeMonths = 0,
        limit = 1000,
      } = req.body;

      // Calculate the age cutoff date upfront for SQL filtering (only if maxLoanAgeMonths > 0)
      const cutoffDate =
        maxLoanAgeMonths && maxLoanAgeMonths > 0
          ? new Date(Date.now() - maxLoanAgeMonths * 30 * 24 * 60 * 60 * 1000)
          : null;

      // Fetch ONLY active loans with essential columns for processing
      // Column names from tenant migrations (see migrations/tenant/)
      // Use EXACT same criteria as metricsService.ts active_loans definition:
      //   current_loan_status = 'Active Loan' AND application_date IS NOT NULL AND application_date::text != '' AND (is_archived IS DISTINCT FROM TRUE)
      const activeLoansQuery = `
      SELECT 
        loan_id, guid, loan_number, loan_amount, interest_rate, loan_type,
        application_date, lock_date, lock_expiration_date, closing_date, estimated_closing_date, funding_date,
        uw_denied_date, uw_suspended_date, last_modified_date,
        current_loan_status, current_milestone, branch, loan_officer,
        fico_score, be_dti_ratio, ltv_ratio, cltv,
        loan_purpose, property_type, occupancy_type, channel,
        underwriter, closer, processor
      FROM public.loans 
      WHERE current_loan_status = 'Active Loan'
        AND application_date IS NOT NULL
        AND application_date::text != ''
        AND (is_archived IS DISTINCT FROM TRUE)
        ${cutoffDate ? `AND application_date >= $1` : ""}
      ORDER BY application_date DESC
      LIMIT ${Math.min(limit, 2000)}
    `;

      logInfo("Predict endpoint query", {
        query: activeLoansQuery.replace(/\s+/g, " ").trim(),
        cutoffDate: cutoffDate?.toISOString() || "none",
        maxLoanAgeMonths,
      });

      const loansResult = await tenantPool.query(
        activeLoansQuery,
        cutoffDate ? [cutoffDate.toISOString().split("T")[0]] : [],
      );
      let activeLoans = loansResult.rows;

      logInfo("Predict endpoint result", {
        activeLoansCount: activeLoans.length,
        sampleStatuses: activeLoans
          .slice(0, 3)
          .map((l) => l.current_loan_status),
      });

      // Historical loans for calibration + pullthrough. Same columns as active so prepareLoanData/bucketing have fico, DTI, LTV, etc.
      const historicalLoansQuery = `
      SELECT 
        loan_id, guid, loan_number, loan_amount, interest_rate, loan_type,
        application_date, lock_date, lock_expiration_date, closing_date, estimated_closing_date, funding_date,
        uw_denied_date, uw_suspended_date, last_modified_date,
        current_loan_status, current_milestone, branch, loan_officer,
        fico_score, be_dti_ratio, ltv_ratio, cltv,
        loan_purpose, property_type, occupancy_type, channel,
        underwriter, closer, processor
      FROM public.loans 
      WHERE current_loan_status != 'Active Loan' OR current_loan_status IS NULL
      ORDER BY application_date DESC
      LIMIT 5000
    `;
      const historicalResult = await tenantPool.query(historicalLoansQuery);
      const allLoans = [...activeLoans, ...historicalResult.rows];

      // Note: Active loan filtering and age filtering already done in SQL above

      // If specific loan IDs provided, filter to those
      if (loanIds && Array.isArray(loanIds) && loanIds.length > 0) {
        const loanIdSet = new Set(loanIds);
        activeLoans = activeLoans.filter((l) => loanIdSet.has(l.loan_id));
      }

      logInfo("Prediction active loans (SQL filtered)", {
        activeLoans: activeLoans.length,
        historicalLoans: allLoans.length - activeLoans.length,
        maxLoanAgeMonths,
        limit,
        cutoffDate: cutoffDate?.toISOString() || "none",
      });

      if (activeLoans.length === 0) {
        return res.json({
          predictions: [],
          bucketedLoans: [],
          bucketSummary: { high: 0, medium: 0, low: 0 },
          summary: {
            totalAnalyzed: 0,
            predictedWithdraw: 0,
            predictedDeny: 0,
            predictedOriginate: 0,
          },
          metadata: {
            model: process.env.PREDICTION_MODEL || "gpt-4o",
            timestamp: new Date().toISOString(),
            processingTimeMs: 0,
          },
        });
      }

      // allLoans already fetched above - use for historical data in prediction service

      // Fetch OpenAI API key from tenant's rag_settings table
      let tenantApiKey: string | undefined;
      try {
        const { decryptAPIKeys } = await import("../services/encryption.js");
        const apiKeyResult = await tenantPool.query(
          `SELECT openai_api_key FROM public.rag_settings LIMIT 1`,
        );
        if (apiKeyResult.rows[0]?.openai_api_key) {
          const decrypted = await decryptAPIKeys({
            openai_api_key: apiKeyResult.rows[0].openai_api_key,
          });
          tenantApiKey = decrypted.openai_api_key || undefined;
        }
      } catch (apiKeyError: any) {
        logInfo(
          "Could not fetch tenant API key, will use environment variable",
          { error: apiKeyError.message },
        );
      }

      // Import and call prediction service
      const { predictLoanOutcomes } =
        await import("../services/dashboard/predictionService.js");

      const result = await predictLoanOutcomes(
        {
          loans: activeLoans,
          allLoans,
          customPrompt,
          tenantId,
          tenantPool, // Pass tenant pool for isolated tenant database queries
        },
        tenantApiKey,
      );

      // DRASTICALLY reduce response size - frontend only needs summary + limited loan data
      // Don't send full bucketed loans - send counts by bucket and only top N loans per bucket
      const LOANS_PER_BUCKET = 50; // Limit loans returned per bucket

      // Extract bucket summary (count per bucket)
      const bucketSummary: Record<string, number> = {};
      if (result.bucketedLoans && Array.isArray(result.bucketedLoans)) {
        result.bucketedLoans.forEach((loan: any) => {
          const bucket = loan.bucket || "unknown";
          bucketSummary[bucket] = (bucketSummary[bucket] || 0) + 1;
        });
      }

      // Only send essential loan fields and limit per bucket
      // Use snake_case to match database column naming convention
      const essentialFields = [
        // Core loan identifiers (snake_case matching DB)
        "loan_id",
        "loan_number",
        "loan_amount",
        "loan_type",

        // Status and dates (snake_case matching DB)
        "bucket",
        "current_loan_status",
        "status",
        "branch",
        "application_date",
        "lock_date",
        "closing_date",
        "funding_date",
        "estimated_closing_date",

        // Credit metrics (snake_case matching DB)
        "fico_score",
        "ltv_ratio",
        "be_dti_ratio",

        // Personnel (snake_case matching DB)
        "loan_officer",
        "underwriter",
        "closer",
        "processor",

        // Rates and market delta details
        "interest_rate",
        "market_rate",
        "marketChangeDelta",
        "lockMarketRate",
        "closeMarketRate",

        // Milestone and time in motion
        "current_milestone",
        "lastCompletedMilestone",
        "milestoneNumber",
        "activeDays",

        // Pullthrough percentages (actual values for display)
        "loPullthroughPercentage",
        "uwPullthroughPercentage",
        "closerPullthroughPercentage",
        "processorPullthroughPercentage",

        // Signal strength fields from bucketing (camelCase - computed fields)
        "creditMetricsSignalStrength",
        "loanCharacteristicsSignalStrength",
        "timeInMotionSignalStrength",
        "mloAeFalloutProneSignalStrength",
        "interestLockVsMarketSignalStrength",
        "uwPullthroughSignalStrength",
        "closerPullthroughSignalStrength",
        "processorPullthroughSignalStrength",
        "ficoScoreSignal",
        "ltvSignal",
        "dtiSignal",
        "loPullthroughSignal",
        "marketChangeDeltaSignal",

        // Risk summary
        "riskSummary",
      ];

      // Group by bucket and take top N from each
      const bucketGroups: Record<string, any[]> = {};
      if (result.bucketedLoans && Array.isArray(result.bucketedLoans)) {
        result.bucketedLoans.forEach((loan: any) => {
          const bucket = loan.bucket || "unknown";
          if (!bucketGroups[bucket]) bucketGroups[bucket] = [];
          if (bucketGroups[bucket].length < LOANS_PER_BUCKET) {
            // Strip to essential fields only
            const stripped: Record<string, any> = {};
            essentialFields.forEach((f) => {
              if (loan[f] !== undefined) stripped[f] = loan[f];
            });
            bucketGroups[bucket].push(stripped);
          }
        });
      }

      // Flatten back to array (limited loans)
      const limitedLoans = Object.values(bucketGroups).flat();

      // Build slim response
      const slimResult = {
        predictions: result.predictions || [],
        bucketedLoans: limitedLoans,
        bucketSummary, // { high: 500, medium: 300, low: 200 }
        totalBucketedLoans: result.bucketedLoans?.length || 0,
        summary: result.summary,
        metadata: result.metadata,
      };

      // Log response structure for debugging
      const responseSize = JSON.stringify(slimResult).length;
      logInfo("Sending prediction response", {
        predictionsCount: slimResult.predictions?.length || 0,
        bucketedLoansCount: slimResult.bucketedLoans?.length || 0,
        totalBucketedLoans: slimResult.totalBucketedLoans,
        bucketSummary,
        summary: slimResult.summary,
        responseSizeBytes: responseSize,
        responseSizeMB: (responseSize / 1024 / 1024).toFixed(2),
      });

      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Length", responseSize.toString());

      res.json(slimResult);
    } catch (error: any) {
      logError("Error predicting loan outcomes", error, { userId: req.userId });

      if (handleDatabaseError(error, res, "Failed to predict loan outcomes")) {
        return;
      }

      res
        .status(500)
        .json({ error: error.message || "Failed to predict loan outcomes" });
    }
  },
);

/**
 * GET /api/loans/predict/status
 * Returns whether the full prediction pipeline is still in progress for this tenant.
 * Frontend polls this after POST /predict until inProgress is false.
 */
router.get(
  "/predict/status",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    // DEPRECATED: Use GET /api/predictions/status instead
    addDeprecationHeaders(res, "/api/predictions/status");
    try {
      const tenantContext = getTenantContext(req);
      const tenantId = tenantContext.tenantId;

      const { getPredictInProgress } =
        await import("../services/dashboard/predictionService.js");
      const inProgress = getPredictInProgress(tenantId ?? null);
      res.json({ inProgress });
    } catch (error: any) {
      logError("Error fetching predict status", error, { userId: req.userId });
      res
        .status(500)
        .json({ error: error.message || "Failed to fetch predict status" });
    }
  },
);

/**
 * GET /api/loans/predictions
 * Fetch stored AI predictions for loans
 * Returns the most recent prediction for each loan
 */
router.get(
  "/predictions",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    // DEPRECATED: Use GET /api/predictions instead
    addDeprecationHeaders(res, "/api/predictions");
    try {
      const tenantContext = getTenantContext(req);
      const tenantPool = tenantContext.tenantPool;

      // Optional filters
      const loanIds = req.query.loanIds
        ? Array.isArray(req.query.loanIds)
          ? req.query.loanIds
          : [req.query.loanIds]
        : null;
      const outcome = req.query.outcome as string | null;
      const limit = parseInt(req.query.limit as string) || 10000;

      // Build query to get most recent prediction for each loan (no tenant_id in tenant DB)
      // Includes bucket and loan_data for full signal strength data on reload
      let query = `
      SELECT DISTINCT ON (loan_id)
        loan_id,
        predicted_outcome,
        confidence,
        reasoning,
        risk_factors,
        bucket,
        loan_data,
        model_version,
        created_at,
        updated_at
      FROM public.loan_predictions
      WHERE 1=1
    `;

      const params: any[] = [];
      let paramIndex = 1;

      if (loanIds && loanIds.length > 0) {
        query += ` AND loan_id = ANY($${paramIndex})`;
        params.push(loanIds);
        paramIndex++;
      }

      if (outcome && ["withdraw", "deny", "originate"].includes(outcome)) {
        query += ` AND predicted_outcome = $${paramIndex}`;
        params.push(outcome);
        paramIndex++;
      }

      query += ` ORDER BY loan_id, created_at DESC LIMIT $${paramIndex}`;
      params.push(limit);

      const result = await tenantPool.query(query, params);

      const predictions = result.rows.map((row) => ({
        loanId: row.loan_id,
        predictedOutcome: row.predicted_outcome,
        confidence: row.confidence,
        reasoning: row.reasoning,
        riskFactors: row.risk_factors || [],
        bucket: row.bucket || "medium",
        loanData: row.loan_data || null,
        modelVersion: row.model_version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));

      res.json({
        predictions,
        count: predictions.length,
        summary: {
          withdraw: predictions.filter((p) => p.predictedOutcome === "withdraw")
            .length,
          deny: predictions.filter((p) => p.predictedOutcome === "deny").length,
          originate: predictions.filter(
            (p) => p.predictedOutcome === "originate",
          ).length,
        },
      });
    } catch (error: any) {
      logError("Error fetching loan predictions", error, {
        userId: req.userId,
      });

      if (handleDatabaseError(error, res, "Failed to fetch loan predictions")) {
        return;
      }

      res
        .status(500)
        .json({ error: error.message || "Failed to fetch loan predictions" });
    }
  },
);

/**
 * POST /api/loans/sync-market-rates
 * Sync market rates from FRED API and store in database
 * Requires authentication
 */
router.post(
  "/sync-market-rates",
  authenticateToken,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const { syncMarketRatesFromFRED } =
        await import("../services/dashboard/marketRateService.js");
      const { startDate, endDate } = req.body;

      logInfo("Syncing market rates from FRED API", {
        userId: req.userId,
        startDate,
        endDate,
      });

      const storedCount = await syncMarketRatesFromFRED(startDate, endDate);

      res.json({
        success: true,
        message: `Successfully synced ${storedCount} market rates from FRED API`,
        storedCount,
      });
    } catch (error: any) {
      logError("Error syncing market rates from FRED", error, {
        userId: req.userId,
      });
      res.status(500).json({
        error: error.message || "Failed to sync market rates from FRED API",
      });
    }
  },
);

/**
 * GET /api/loans/market-rates/current
 * Returns current market rate data for the OBMMI ticker display.
 * Uses cached FRED OBMMIC30YF data from the management database.
 */
router.get(
  "/market-rates/current",
  authenticateToken,
  async (_req: AuthRequest, res) => {
    try {
      const {
        getMostRecentMarketRate,
        getMarketRateForDate,
        initializeMarketRateCache,
      } = await import("../services/dashboard/marketRateService.js");

      await initializeMarketRateCache();
      const currentRate = await getMostRecentMarketRate();

      if (currentRate === null) {
        return res.json({ available: false, rates: [] });
      }

      const today = new Date();
      const fmt = (d: Date) => d.toISOString().split("T")[0];
      const d1 = new Date(today);
      d1.setDate(d1.getDate() - 1);
      const yesterdayRate = await getMarketRateForDate(fmt(d1));
      const delta = yesterdayRate !== null ? currentRate - yesterdayRate : 0;

      return res.json({
        available: true,
        conforming30yr: {
          rate: currentRate,
          delta: Math.round(delta * 1000) / 1000,
          trend: delta > 0.001 ? "up" : delta < -0.001 ? "down" : "flat",
        },
      });
    } catch (error: any) {
      logError("Error fetching current market rates", error);
      return res.status(500).json({ error: "Failed to fetch market rates" });
    }
  },
);

/**
 * GET /api/loans/:loanId/recommendations
 * Get AI-powered recommendations for a specific loan (on-demand)
 * Uses loan signal data to generate actionable recommendations via GPT
 * DEPRECATED: Use /api/predictions/:loanId/recommendations instead
 */
router.get(
  "/:loanId/recommendations",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    // DEPRECATED: Use /api/predictions/:loanId/recommendations instead
    addDeprecationHeaders(
      res,
      `/api/predictions/${req.params.loanId}/recommendations`,
    );
    try {
      const tenantContext = getTenantContext(req);
      const tenantPool = tenantContext.tenantPool;
      const { loanId } = req.params;

      if (!loanId) {
        return res.status(400).json({ error: "Loan ID is required" });
      }

      // Fetch the loan data
      const loanResult = await tenantPool.query(
        `SELECT * FROM public.loans WHERE loan_id = $1`,
        [loanId],
      );

      if (loanResult.rows.length === 0) {
        return res.status(404).json({ error: "Loan not found" });
      }

      const loan = loanResult.rows[0];

      // Fetch OpenAI API key from tenant's rag_settings table
      let apiKey: string | undefined;
      try {
        const { decryptAPIKeys } = await import("../services/encryption.js");
        const apiKeyResult = await tenantPool.query(
          `SELECT openai_api_key FROM public.rag_settings LIMIT 1`,
        );
        if (apiKeyResult.rows[0]?.openai_api_key) {
          const decrypted = await decryptAPIKeys({
            openai_api_key: apiKeyResult.rows[0].openai_api_key,
          });
          apiKey = decrypted.openai_api_key || undefined;
        }
      } catch (apiKeyError: any) {
        logInfo("Could not fetch tenant API key for recommendations", {
          error: apiKeyError.message,
        });
      }

      // Fall back to environment variable if no tenant key
      const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
      const apiKeyToUse = apiKey || OPENAI_API_KEY;

      // Validate API key
      const hasValidApiKey =
        apiKeyToUse &&
        apiKeyToUse.trim().length > 0 &&
        !apiKeyToUse.includes("your-api-key") &&
        apiKeyToUse.trim().startsWith("sk-");

      if (!hasValidApiKey) {
        // Return rule-based recommendations without AI
        const recommendations = generateRuleBasedRecommendations(loan);
        return res.json({
          loanId,
          recommendations,
          source: "rule-based",
          message:
            "AI recommendations unavailable - using rule-based suggestions",
        });
      }

      // Generate AI recommendations
      try {
        const recommendations = await generateAIRecommendations(
          loan,
          apiKeyToUse,
        );
        res.json({
          loanId,
          recommendations,
          source: "ai",
        });
      } catch (aiError: any) {
        logError(
          "AI recommendation generation failed, falling back to rules",
          aiError,
        );
        const recommendations = generateRuleBasedRecommendations(loan);
        res.json({
          loanId,
          recommendations,
          source: "rule-based",
          message: "AI generation failed - using rule-based suggestions",
        });
      }
    } catch (error: any) {
      logError("Error getting loan recommendations", error, {
        userId: req.userId,
        loanId: req.params.loanId,
      });
      res
        .status(500)
        .json({ error: error.message || "Failed to get loan recommendations" });
    }
  },
);

/**
 * Generate rule-based recommendations based on loan characteristics
 */
function generateRuleBasedRecommendations(loan: any): string[] {
  const recommendations: string[] = [];

  // Credit-based recommendations
  const fico = loan.fico_score || loan.credit_score;
  const dti = loan.dti_ratio || loan.dti;
  const ltv = loan.ltv || loan.loan_to_value;

  if (fico && fico < 680) {
    recommendations.push(
      "Consider credit counseling or rapid rescoring to improve FICO score before proceeding",
    );
  }
  if (dti && dti > 43) {
    recommendations.push(
      "High DTI detected - explore debt payoff strategies or income documentation to improve qualification",
    );
  }
  if (ltv && ltv > 80) {
    recommendations.push(
      "High LTV may require PMI - discuss options with borrower including larger down payment",
    );
  }

  // Time-based recommendations
  const appDate = loan.application_date
    ? new Date(loan.application_date)
    : null;
  if (appDate) {
    const daysSinceApp = Math.floor(
      (Date.now() - appDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (daysSinceApp > 30) {
      recommendations.push(
        `Loan has been in pipeline ${daysSinceApp} days - review status and address any outstanding conditions`,
      );
    }
    if (daysSinceApp > 45) {
      recommendations.push(
        "Consider rate lock extension options to protect borrower from market volatility",
      );
    }
  }

  // Loan type recommendations
  const loanType = (loan.loan_type || "").toLowerCase();
  if (loanType.includes("jumbo") || loanType.includes("non-conforming")) {
    recommendations.push(
      "Jumbo loan - ensure all reserve requirements and documentation are complete",
    );
  }
  if (loanType.includes("investment") || loanType.includes("investor")) {
    recommendations.push(
      "Investment property - verify rental income documentation and DSCR requirements",
    );
  }

  // Purpose-based recommendations
  const loanPurpose = (loan.loan_purpose || loan.purpose || "").toLowerCase();
  if (loanPurpose.includes("cash") && loanPurpose.includes("out")) {
    recommendations.push(
      "Cash-out refinance - confirm seasoning requirements and verify use of funds",
    );
  }

  // Default recommendations if none specific
  if (recommendations.length === 0) {
    recommendations.push(
      "Continue monitoring loan progress and maintain regular borrower communication",
    );
    recommendations.push(
      "Ensure all conditions are cleared promptly to minimize pipeline time",
    );
  }

  return recommendations;
}

/**
 * Generate AI-powered recommendations using GPT
 */
async function generateAIRecommendations(
  loan: any,
  apiKey: string,
): Promise<string[]> {
  const loanSummary = {
    loanAmount: loan.loan_amount,
    loanType: loan.loan_type,
    loanPurpose: loan.loan_purpose || loan.purpose,
    fico: loan.fico_score || loan.credit_score,
    dti: loan.dti_ratio || loan.dti,
    ltv: loan.ltv || loan.loan_to_value,
    interestRate: loan.interest_rate,
    applicationDate: loan.application_date,
    currentStatus: loan.current_loan_status || loan.status,
    loanOfficer: loan.loan_officer,
    branch: loan.branch,
    propertyType: loan.property_type,
    occupancy: loan.occupancy_type,
  };

  const prompt = `You are a mortgage loan advisor. Based on the following loan details, provide 3-5 specific, actionable recommendations to help this loan close successfully.

Loan Details:
${JSON.stringify(loanSummary, null, 2)}

Provide recommendations as a JSON array of strings. Focus on:
1. Risk mitigation strategies
2. Communication touchpoints
3. Documentation requirements
4. Timeline optimization
5. Borrower support actions

Return ONLY a JSON array of recommendation strings, no other text.
Example: ["Recommendation 1", "Recommendation 2", "Recommendation 3"]`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a mortgage lending expert. Respond only with valid JSON arrays.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content || "[]";

  try {
    // Parse the JSON response
    const cleanContent = content.replace(/```json\n?|\n?```/g, "").trim();
    const recommendations = JSON.parse(cleanContent);
    return Array.isArray(recommendations) ? recommendations : [];
  } catch (parseError) {
    logError("Failed to parse AI recommendations", parseError);
    return [];
  }
}

// =============================================================================
// OFFICER DETAILS - GET /api/loans/officer-details
// =============================================================================

/**
 * GET /api/loans/officer-details?name=Officer+Name
 * Returns officer-level stats, risk breakdown, and loan details for the LO modal
 */
router.get(
  "/officer-details",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantContext = getTenantContext(req);
      const tenantPool = tenantContext.tenantPool;
      const officerName = (req.query.name as string || "").trim();

      if (!officerName) {
        return res.status(400).json({ error: "name query parameter is required" });
      }

      // Fetch all loans for this officer
      const loansResult = await tenantPool.query(
        `SELECT l.loan_id, l.loan_number, l.loan_amount, l.loan_type, l.loan_purpose,
                l.current_loan_status, l.current_milestone, l.fico_score, l.ltv_ratio, l.be_dti_ratio,
                l.interest_rate, l.application_date, l.lock_date, l.lock_expiration_date,
                l.estimated_closing_date, l.channel,
                l.loan_officer, l.funding_date, l.closing_date
         FROM public.loans l
         WHERE TRIM(l.loan_officer) = $1
           AND l.application_date >= NOW() - INTERVAL '18 months'
         ORDER BY l.application_date DESC`,
        [officerName]
      );

      const allLoans = loansResult.rows;

      // Classify loans
      const activeLoanStatuses = ['ACTIVE LOAN', 'ACTIVE', 'INQUIRY'];
      const withdrawnStatuses = [
        'APPLICATION WITHDRAWN', 'WITHDRAWN', 'APPLICATION APPROVED BUT NOT ACCEPTED',
        'FILE CLOSED FOR INCOMPLETENESS', 'PREAPPROVAL REQUEST APPROVED BUT NOT ACCEPTED'
      ];
      const deniedStatuses = [
        'APPLICATION DENIED', 'DENIED', 'DECLINED',
        'PREAPPROVAL REQUEST DENIED BY FINANCIAL INSTITUTION'
      ];

      const activeLoans = allLoans.filter((l: any) =>
        activeLoanStatuses.includes((l.current_loan_status || '').trim().toUpperCase()));
      const closedLoans = allLoans.filter((l: any) => {
        const status = (l.current_loan_status || '').trim().toUpperCase();
        return !activeLoanStatuses.includes(status) &&
               !withdrawnStatuses.includes(status) &&
               !deniedStatuses.includes(status);
      });
      const falloutLoans = allLoans.filter((l: any) => {
        const status = (l.current_loan_status || '').trim().toUpperCase();
        return withdrawnStatuses.includes(status) || deniedStatuses.includes(status);
      });

      const finalized = closedLoans.length + falloutLoans.length;
      const pullThroughPct = finalized > 0 ? Math.round((closedLoans.length / finalized) * 100) : 0;

      const sumVolume = (loans: any[]) =>
        loans.reduce((sum: number, l: any) => sum + (Number(l.loan_amount) || 0), 0);
      const formatVolume = (v: number) =>
        v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${(v / 1_000).toFixed(0)}K`;

      // Get predictions for active loans
      const activeLoanIds = activeLoans.map((l: any) => l.loan_id);
      let predByLoanId = new Map<string, any>();
      if (activeLoanIds.length > 0) {
        try {
          const predResult = await tenantPool.query(
            `SELECT DISTINCT ON (loan_id) loan_id, predicted_outcome, confidence, reason_codes
             FROM public.loan_predictions
             WHERE loan_id = ANY($1)
             ORDER BY loan_id, created_at DESC`,
            [activeLoanIds]
          );
          predByLoanId = new Map(predResult.rows.map((r: any) => [r.loan_id, r]));
        } catch {
          // loan_predictions may not exist yet
        }
      }

      // Build risk breakdown and loan details
      let veryHigh = 0;
      let medium = 0;
      let low = 0;
      let atRiskVolume = 0;

      const loanDetails = activeLoans.map((l: any) => {
        const pred = predByLoanId.get(l.loan_id);
        const outcome = pred?.predicted_outcome ?? "originate";
        const confidence = pred?.confidence ?? 50;
        let riskLevel = "Low";
        let riskScore = confidence;

        if (outcome === "withdraw" || outcome === "deny") {
          riskLevel = "Very High";
          riskScore = Math.max(riskScore, 85);
          veryHigh++;
          atRiskVolume += Number(l.loan_amount) || 0;
        } else if (confidence >= 60 && confidence < 80) {
          riskLevel = "Medium";
          medium++;
        } else {
          low++;
        }

        const borrower = l.loan_number || l.loan_id;
        const amount = Number(l.loan_amount) || 0;

        return {
          id: l.loan_number || l.loan_id,
          guid: l.loan_id,
          borrower,
          amount: amount >= 1000 ? `$${(amount / 1000).toFixed(0)}K` : `$${amount}`,
          amountValue: amount,
          riskLevel,
          riskScore,
          predictedOutcome: outcome,
          reason: outcome === "withdraw"
            ? "AI predicts loan may be withdrawn"
            : outcome === "deny"
              ? "AI predicts loan may be denied"
              : "Loan appears on track",
          status: l.current_loan_status || "Active",
          loanType: l.loan_type || "N/A",
          lender: l.channel || "N/A",
          ficoScore: l.fico_score != null ? Number(l.fico_score) : null,
          ltvRatio: l.ltv_ratio != null ? Number(l.ltv_ratio) : null,
          dtiRatio: l.be_dti_ratio != null ? Number(l.be_dti_ratio) : null,
        };
      });

      res.json({
        officer: {
          name: officerName,
          email: null,
          phone: null,
          totalLoans: allLoans.length,
          activeLoans: activeLoans.length,
          closedLoans: closedLoans.length,
          pullThrough: `${pullThroughPct}%`,
          totalVolume: formatVolume(sumVolume(allLoans)),
          activeVolume: formatVolume(sumVolume(activeLoans)),
          closedVolume: formatVolume(sumVolume(closedLoans)),
          atRiskVolume: formatVolume(atRiskVolume),
        },
        riskBreakdown: { veryHigh, medium, low },
        loans: loanDetails,
      });
    } catch (error: any) {
      logError("Error fetching officer details", error, { userId: req.userId });
      if (handleDatabaseError(error, res, "Failed to fetch officer details")) return;
      res.status(500).json({ error: error.message || "Failed to fetch officer details" });
    }
  }
);

export default router;
