/**
 * Diagnose research_artifacts vs schema_migrations for a tenant.
 * Usage: npx tsx scripts/check-research-artifacts.ts [tenant-id-or-slug]
 */
import pg from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

const tenantArg =
  process.argv[2] || "ebfc0cb3-4620-43a9-b146-8edcd287ff94";

const mgmt = new pg.Pool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: parseInt(process.env.DB_PORT || "5432", 10),
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  database: process.env.MANAGEMENT_DB_NAME || "coheus_management",
});

const isUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    tenantArg,
  );

const tenantRes = await mgmt.query(
  `SELECT id, slug, database_name, database_host, database_port
   FROM coheus_tenants
   WHERE ${isUuid ? "id" : "slug"} = $1`,
  [tenantArg],
);

if (tenantRes.rows.length === 0) {
  console.error("Tenant not found:", tenantArg);
  process.exit(1);
}

const tenant = tenantRes.rows[0] as {
  id: string;
  slug: string;
  database_name: string;
  database_host: string;
  database_port: number;
};

console.log("Tenant:", tenant.slug, tenant.id);
console.log("Database:", tenant.database_name, "@", tenant.database_host);

const tenantPool = new pg.Pool({
  host: tenant.database_host || process.env.DB_HOST || "127.0.0.1",
  port: tenant.database_port || parseInt(process.env.DB_PORT || "5432", 10),
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  database: tenant.database_name,
});

const tableCheck = await tenantPool.query(`
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'research_artifacts'
`);

const mig111 = await tenantPool.query(
  `SELECT version, name, applied_at FROM schema_migrations WHERE version = '111'`,
);

const migCurrent = await tenantPool.query(
  `SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 5`,
);

const pendingAfter111 = await tenantPool.query(
  `SELECT COUNT(*)::int AS c FROM schema_migrations WHERE version > '111'`,
);

console.log("\nresearch_artifacts table exists:", tableCheck.rows.length > 0);
console.log("Migration 111 in schema_migrations:", mig111.rows[0] ?? "NO");
console.log("Latest migrations:", migCurrent.rows);
console.log("Migrations after 111:", pendingAfter111.rows[0]?.c);

await tenantPool.end();
await mgmt.end();
