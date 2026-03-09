import pg from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { decryptField } from "../src/services/encryption.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env") });

const { Pool } = pg;

type TenantRow = {
  id: string;
  slug: string;
  name: string;
  database_name: string;
  database_host: string;
  database_port: number;
  database_user: string | null;
  database_password_encrypted: string | null;
};

const REQUIRED_LOANS_COLUMNS = [
  "loan_id",
  "loan_number",
  "loan_amount",
  "application_date",
  "funding_date",
  "closing_date",
  "current_loan_status",
  "lock_date",
  "lock_expiration_date",
  "branch",
  "broker_lender_name",
  "channel",
  "investor",
  "loan_officer",
  "account_executive",
  "cd_lender_credits",
  "pa_sell_amt",
  "line_800_total_borrower_paid_amount",
  "line_800_total_seller_paid_amount",
  "fee_details_line_804_borrower_amount_appraisal_fee",
  "fees_interest_borr",
  "purchase_adv_expected_int_pymt_from_investor",
  "pa_payout_1",
  "pa_payout_2",
  "pa_payout_3",
  "lender_credits",
] as const;

function isRemoteHost(host: string): boolean {
  return host !== "localhost" && host !== "127.0.0.1";
}

async function getActiveTenants(managementPool: pg.Pool): Promise<TenantRow[]> {
  const result = await managementPool.query(
    `SELECT id, slug, name, database_name, database_host, database_port, database_user, database_password_encrypted
     FROM coheus_tenants
     WHERE status = 'active'
     ORDER BY slug`
  );
  return result.rows as TenantRow[];
}

async function getMissingColumns(tenantPool: pg.Pool): Promise<string[]> {
  const result = await tenantPool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'loans'`
  );

  const present = new Set((result.rows as Array<{ column_name: string }>).map((r) => r.column_name));
  return REQUIRED_LOANS_COLUMNS.filter((c) => !present.has(c));
}

async function main(): Promise<void> {
  const mgmtHost = (process.env.DB_HOST || "localhost").trim();
  const mgmtPort = parseInt(process.env.DB_PORT || "5432", 10);
  const mgmtUser = process.env.DB_USER || "postgres";
  const mgmtPassword = process.env.DB_PASSWORD || "postgres";
  const managementDb = process.env.MANAGEMENT_DB_NAME || "coheus_management";
  const mgmtSsl = isRemoteHost(mgmtHost) ? { rejectUnauthorized: false } : false;

  const managementPool = new Pool({
    host: mgmtHost,
    port: mgmtPort,
    user: mgmtUser,
    password: mgmtPassword,
    database: managementDb,
    ssl: mgmtSsl,
    max: 3,
  });

  const failures: Array<{ slug: string; id: string; reason: string }> = [];
  const missingByTenant: Array<{ slug: string; id: string; missing: string[] }> = [];

  try {
    const tenants = await getActiveTenants(managementPool);
    console.log(`Auditing pricing schema for ${tenants.length} active tenants...`);

    for (const tenant of tenants) {
      const host = (tenant.database_host || mgmtHost).trim();
      const port = tenant.database_port || mgmtPort;
      const user = (tenant.database_user || mgmtUser).trim();
      let password = mgmtPassword;

      if (tenant.database_password_encrypted) {
        try {
          const decrypted = await decryptField(tenant.database_password_encrypted);
          if (decrypted) password = decrypted;
        } catch {
          // Fall back to DB_PASSWORD if decryption unavailable in local env.
        }
      }

      const tenantPool = new Pool({
        host,
        port,
        user,
        password,
        database: tenant.database_name,
        ssl: isRemoteHost(host) ? { rejectUnauthorized: false } : false,
        max: 2,
        connectionTimeoutMillis: 8000,
      });

      try {
        const missing = await getMissingColumns(tenantPool);
        if (missing.length > 0) {
          missingByTenant.push({ slug: tenant.slug, id: tenant.id, missing });
        }
      } catch (error: any) {
        failures.push({
          slug: tenant.slug,
          id: tenant.id,
          reason: error?.message || "unknown connection/query failure",
        });
      } finally {
        await tenantPool.end().catch(() => {});
      }
    }
  } finally {
    await managementPool.end();
  }

  console.log("");
  console.log("=== Pricing Schema Audit Summary ===");
  console.log(`Tenants with missing columns: ${missingByTenant.length}`);
  console.log(`Tenants with connection/query failures: ${failures.length}`);

  if (missingByTenant.length > 0) {
    console.log("");
    console.log("Tenants missing required loans columns:");
    for (const row of missingByTenant) {
      console.log(`- ${row.slug} (${row.id})`);
      console.log(`  Missing: ${row.missing.join(", ")}`);
    }
  }

  if (failures.length > 0) {
    console.log("");
    console.log("Tenants with connectivity/query failures:");
    for (const row of failures) {
      console.log(`- ${row.slug} (${row.id})`);
      console.log(`  Error: ${row.reason}`);
    }
  }

  if (missingByTenant.length > 0 || failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Audit failed:", error);
  process.exit(1);
});
