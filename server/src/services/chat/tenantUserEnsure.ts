/**
 * Ensure a JWT user id exists in the tenant `public.users` table before
 * unified_chat_conversations INSERT (FK on user_id).
 */

import crypto from "crypto";
import type pg from "pg";
import { pool as managementPool } from "../../config/managementDatabase.js";

export async function ensureTenantUserRow(
  tenantPool: pg.Pool,
  userId: string,
  userEmail?: string | null,
): Promise<boolean> {
  const existing = await tenantPool.query(
    `SELECT 1 FROM public.users WHERE id = $1::uuid LIMIT 1`,
    [userId],
  );
  if (existing.rows.length > 0) return true;

  const email =
    typeof userEmail === "string" && userEmail.trim().length > 0
      ? userEmail.trim().toLowerCase()
      : null;

  if (email) {
    const byEmail = await tenantPool.query(
      `SELECT id FROM public.users WHERE lower(email) = $1 LIMIT 1`,
      [email],
    );
    if (byEmail.rows.length > 0) return true;
  }

  let fullName: string | null = null;
  let role = "user";
  try {
    const mgmt = await managementPool.query(
      `SELECT email, full_name, role FROM coheus_users WHERE id = $1::uuid LIMIT 1`,
      [userId],
    );
    if (mgmt.rows.length > 0) {
      const row = mgmt.rows[0] as {
        email?: string;
        full_name?: string;
        role?: string;
      };
      fullName = row.full_name ?? null;
      role = row.role ?? role;
      if (!email && row.email) {
        const mgmtEmail = String(row.email).trim().toLowerCase();
        const byMgmtEmail = await tenantPool.query(
          `SELECT id FROM public.users WHERE lower(email) = $1 LIMIT 1`,
          [mgmtEmail],
        );
        if (byMgmtEmail.rows.length > 0) return true;
        return insertTenantUser(tenantPool, userId, mgmtEmail, fullName, role);
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[tenantUserEnsure] management lookup failed:", message);
  }

  if (!email) return false;
  return insertTenantUser(tenantPool, userId, email, fullName, role);
}

async function insertTenantUser(
  tenantPool: pg.Pool,
  userId: string,
  email: string,
  fullName: string | null,
  role: string,
): Promise<boolean> {
  const placeholderPassword = crypto.randomBytes(32).toString("hex");
  const tenantRole = ["tenant_admin", "super_admin", "platform_admin"].includes(
    role,
  )
    ? "tenant_admin"
    : "user";
  try {
    await tenantPool.query(
      `
      INSERT INTO public.users (
        id, email, encrypted_password, full_name, role, is_active, persona, loan_scope
      )
      VALUES ($1::uuid, $2, $3, $4, $5, true, 'tenant_user', 'encompass')
      ON CONFLICT (id) DO NOTHING
      `,
      [userId, email, placeholderPassword, fullName, tenantRole],
    );
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[tenantUserEnsure] insert by id failed:", message);
    try {
      await tenantPool.query(
        `
        INSERT INTO public.users (
          email, encrypted_password, full_name, role, is_active, persona, loan_scope
        )
        VALUES ($1, $2, $3, $4, true, 'tenant_user', 'encompass')
        ON CONFLICT (email) DO NOTHING
        `,
        [email, placeholderPassword, fullName ?? email, tenantRole],
      );
      const check = await tenantPool.query(
        `SELECT 1 FROM public.users WHERE lower(email) = $1 LIMIT 1`,
        [email],
      );
      return check.rows.length > 0;
    } catch (err2: unknown) {
      const message2 = err2 instanceof Error ? err2.message : String(err2);
      console.warn("[tenantUserEnsure] insert by email failed:", message2);
      return false;
    }
  }
}
