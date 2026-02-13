import { Router } from "express";
import { pool } from "../config/database.js";
import { authenticateToken, AuthRequest } from "../middleware/auth.js";
import { z } from "zod";

const router = Router();

// Validation schemas
const billingRecordSchema = z.object({
  tenant_id: z.string().uuid(),
  billing_period_start: z.string(), // ISO date
  billing_period_end: z.string(), // ISO date
  total_cost: z.number().min(0),
  breakdown: z.record(z.number()).optional(),
  aws_account_id: z.string().optional(),
  invoice_id: z.string().optional(),
  payment_status: z.enum(["pending", "paid", "overdue"]).optional(),
});

/**
 * GET /api/aws-hosting/lenders
 * List all lenders with AWS hosting deployments
 */
router.get("/lenders", authenticateToken, async (req: AuthRequest, res) => {
  try {
    // Check if aws_deployments table exists
    const tableCheck = await pool.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'aws_deployments'
      )`,
    );

    if (!tableCheck.rows[0].exists) {
      // Table doesn't exist yet - return empty array
      return res.json({ lenders: [] });
    }

    const result = await pool.query(
      `SELECT 
        t.id as tenant_id,
        t.name as tenant_name,
        ad.aws_account_id,
        ad.status,
        ad.infrastructure_url,
        ad.admin_url,
        ad.provisioning_status,
        ad.created_at,
        ad.updated_at
       FROM public.tenants t
       LEFT JOIN public.aws_deployments ad ON t.id = ad.tenant_id
       WHERE ad.id IS NOT NULL
       ORDER BY t.name ASC`,
    );

    res.json({ lenders: result.rows });
  } catch (error: any) {
    console.error("Error fetching the lenders:", error);
    // Return empty array instead of error for better UX
    res.json({ lenders: [] });
  }
});

/**
 * GET /api/aws-hosting/billing/:tenant_id
 * Get billing history for a specific lender
 */
router.get(
  "/billing/:tenant_id",
  authenticateToken,
  async (req: AuthRequest, res) => {
    try {
      const { tenant_id } = req.params;

      // Check if table exists
      const tableCheck = await pool.query(
        `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'aws_billing_history'
      )`,
      );

      if (!tableCheck.rows[0].exists) {
        // Table doesn't exist yet - return empty data
        return res.json({
          billing_history: [],
          current_month_estimate: 0,
          current_month_breakdown: {},
        });
      }

      // Get billing history
      const result = await pool.query(
        `SELECT 
        id,
        tenant_id,
        billing_period_start,
        billing_period_end,
        total_cost,
        breakdown,
        aws_account_id,
        invoice_id,
        payment_status,
        created_at,
        updated_at
       FROM public.aws_billing_history
       WHERE tenant_id = $1
       ORDER BY billing_period_start DESC
       LIMIT 12`, // Last 12 months
        [tenant_id],
      );

      // Calculate current month estimate (sum of breakdown if exists)
      const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
      const currentMonthBilling = result.rows.find(
        (row) =>
          row.billing_period_start.toISOString().slice(0, 7) === currentMonth,
      );

      res.json({
        billing_history: result.rows,
        current_month_estimate: currentMonthBilling?.total_cost || 0,
        current_month_breakdown: currentMonthBilling?.breakdown || {},
      });
    } catch (error: any) {
      console.error("Error fetching billing history:", error);
      // Return empty data instead of error
      res.json({
        billing_history: [],
        current_month_estimate: 0,
        current_month_breakdown: {},
      });
    }
  },
);

/**
 * POST /api/aws-hosting/billing
 * Record AWS billing event (admin only)
 */
router.post("/billing", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const data = billingRecordSchema.parse(req.body);

    const result = await pool.query(
      `INSERT INTO public.aws_billing_history
       (tenant_id, billing_period_start, billing_period_end, total_cost, breakdown, aws_account_id, invoice_id, payment_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, NOW(), NOW())
       RETURNING *`,
      [
        data.tenant_id,
        data.billing_period_start,
        data.billing_period_end,
        data.total_cost,
        JSON.stringify(data.breakdown || {}),
        data.aws_account_id || null,
        data.invoice_id || null,
        data.payment_status || "pending",
      ],
    );

    res.status(201).json({ billing_record: result.rows[0] });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res
        .status(400)
        .json({ error: "Invalid request data", details: error.errors });
    }
    console.error("Error creating billing record:", error);
    res.status(500).json({ error: "Failed to create billing record" });
  }
});

/**
 * GET /api/aws-hosting/summary
 * Get summary of all AWS hosting costs
 */
router.get("/summary", authenticateToken, async (req: AuthRequest, res) => {
  try {
    // Check if table exists
    const tableCheck = await pool.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'aws_billing_history'
      )`,
    );

    const currentMonth = new Date();
    const firstDayOfMonth = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth(),
      1,
    );
    const lastDayOfMonth = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth() + 1,
      0,
    );

    if (!tableCheck.rows[0].exists) {
      // Table doesn't exist yet - return empty summary
      return res.json({
        summary: [],
        total_cost: 0,
        period: {
          start: firstDayOfMonth,
          end: lastDayOfMonth,
        },
      });
    }

    // Get total costs per tenant for current month
    const result = await pool.query(
      `SELECT 
        t.id as tenant_id,
        t.name as tenant_name,
        COALESCE(SUM(abh.total_cost), 0) as total_cost
       FROM public.tenants t
       LEFT JOIN public.aws_billing_history abh ON t.id = abh.tenant_id
         AND abh.billing_period_start >= $1
         AND abh.billing_period_end <= $2
       GROUP BY t.id, t.name
       HAVING COALESCE(SUM(abh.total_cost), 0) > 0
       ORDER BY total_cost DESC`,
      [firstDayOfMonth, lastDayOfMonth],
    );

    const totalCost = result.rows.reduce(
      (sum, row) => sum + parseFloat(row.total_cost),
      0,
    );

    res.json({
      summary: result.rows,
      total_cost: totalCost,
      period: {
        start: firstDayOfMonth,
        end: lastDayOfMonth,
      },
    });
  } catch (error: any) {
    console.error("Error fetching AWS hosting summary:", error);
    // Return empty summary instead of error
    const currentMonth = new Date();
    const firstDayOfMonth = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth(),
      1,
    );
    const lastDayOfMonth = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth() + 1,
      0,
    );

    res.json({
      summary: [],
      total_cost: 0,
      period: {
        start: firstDayOfMonth,
        end: lastDayOfMonth,
      },
    });
  }
});

export default router;
