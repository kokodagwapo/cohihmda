/**
 * One-time cleanup: remove platform staff shadow user records from tenant databases.
 *
 * Shadow users were created by the old ensurePlatformUserShadow() mechanism so
 * platform admins could satisfy FK constraints when interacting with tenant data.
 * Migration 084 dropped those FKs, so the shadow rows are no longer needed.
 *
 * This script:
 *   1. Fetches all platform staff IDs from the management DB (coheus_users).
 *   2. Iterates over every active tenant DB.
 *   3. Deletes shadow user rows whose id matches a platform staff UUID,
 *      plus any rows with the old @coheus.internal fallback email.
 *
 * Usage:
 *   cd server
 *   npx tsx scripts/cleanup-shadow-users.ts            # dry-run (default)
 *   npx tsx scripts/cleanup-shadow-users.ts --apply     # actually delete
 */

import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: "../.env" });
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local" });

const { Pool } = pg;

const dryRun = !process.argv.includes("--apply");

const connString =
  process.env.MANAGEMENT_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/coheus_management";

const isLocalDb =
  (connString.includes("localhost") || connString.includes("127.0.0.1")) &&
  !process.env.FORCE_SSL;

console.log(
  `Management DB: ${connString.replace(/:[^:@]+@/, ":****@")}  (${dryRun ? "DRY RUN" : "APPLYING CHANGES"})`
);

const managementPool = new Pool({
  connectionString: connString,
  ssl: isLocalDb ? false : { rejectUnauthorized: false },
});

async function main() {
  // 1. Get all platform staff IDs
  const staffResult = await managementPool.query(
    `SELECT id, email, role FROM coheus_users
     WHERE role IN ('super_admin', 'platform_admin', 'support')`
  );
  const staffIds = staffResult.rows.map((r: any) => r.id as string);
  console.log(
    `\nFound ${staffIds.length} platform staff:`,
    staffResult.rows.map((r: any) => `${r.email} (${r.role})`).join(", ")
  );

  if (staffIds.length === 0) {
    console.log("No platform staff found — nothing to clean up.");
    return;
  }

  // 2. Get all active tenants
  const tenantsResult = await managementPool.query(
    `SELECT id, name, slug, database_name, database_host, database_port,
            database_user, database_password_encrypted
     FROM coheus_tenants WHERE status = 'active'`
  );
  console.log(`Found ${tenantsResult.rows.length} active tenants.\n`);

  let totalDeleted = 0;

  // When tunneling, override host/port/credentials to use the local tunnel
  const tunnelHost = process.env.TUNNEL_HOST;
  const tunnelPort = process.env.TUNNEL_PORT;
  const overrideUser = process.env.DB_OVERRIDE_USER;
  const overridePass = process.env.DB_OVERRIDE_PASS;

  for (const tenant of tenantsResult.rows) {
    const host = tunnelHost || (tenant.database_host || "localhost").trim();
    const port = tunnelPort
      ? parseInt(tunnelPort)
      : parseInt(tenant.database_port || "5432");
    const rawHost =
      host === "localhost" || host === "127.0.0.1" ? "127.0.0.1" : host;
    const useSsl =
      (rawHost !== "127.0.0.1" && rawHost !== "localhost") ||
      !!process.env.FORCE_SSL;

    const tenantPool = new Pool({
      host: rawHost,
      port,
      database: tenant.database_name,
      user: overrideUser || tenant.database_user || process.env.DB_USER || "postgres",
      password: overridePass || tenant.database_password_encrypted || process.env.DB_PASSWORD || "postgres",
      ssl: useSsl ? { rejectUnauthorized: false } : false,
      max: 2,
    });

    try {
      // Find shadow users: platform staff IDs OR @coheus.internal emails
      const shadowResult = await tenantPool.query(
        `SELECT id, email, role FROM public.users
         WHERE id = ANY($1) OR email LIKE 'platform-%@coheus.internal'`,
        [staffIds]
      );

      if (shadowResult.rows.length === 0) {
        console.log(`  [${tenant.name}] No shadow users found.`);
        continue;
      }

      console.log(
        `  [${tenant.name}] Found ${shadowResult.rows.length} shadow user(s):`
      );
      for (const row of shadowResult.rows) {
        console.log(`    - ${row.email} (role: ${row.role}, id: ${row.id})`);
      }

      if (dryRun) {
        console.log(`    (dry run — skipping deletion)`);
        totalDeleted += shadowResult.rows.length;
        continue;
      }

      const ids = shadowResult.rows.map((r: any) => r.id as string);

      // Clean up related records, then the user row itself.
      // Nullify any created_by/updated_by FKs that use ON DELETE SET NULL or RESTRICT.
      const nullifyCols = [
        { table: "tenant_calculations", cols: ["created_by", "updated_by"] },
        { table: "tenant_config_versions", cols: ["created_by", "published_by"] },
        { table: "tenant_config_widgets", cols: ["created_by"] },
        { table: "tenant_config_thresholds", cols: ["created_by"] },
        { table: "tenant_config_filters", cols: ["created_by"] },
        { table: "tenant_config_personas", cols: ["created_by"] },
        { table: "rag_knowledge_base", cols: ["created_by"] },
        { table: "fallout_alert_rules", cols: ["created_by"] },
        { table: "user_groups", cols: ["created_by"] },
        { table: "sso_login_history", cols: ["user_id"] },
        { table: "encompass_sync_history", cols: ["triggered_by"] },
        { table: "encompass_users", cols: ["cohi_user_id"] },
      ];
      for (const { table, cols } of nullifyCols) {
        for (const col of cols) {
          await tenantPool
            .query(`UPDATE public.${table} SET ${col} = NULL WHERE ${col} = ANY($1)`, [ids])
            .catch(() => {}); // table may not exist in every tenant
        }
      }

      await tenantPool.query(
        "DELETE FROM public.chat_history WHERE user_id = ANY($1)",
        [ids]
      );
      await tenantPool.query(
        "DELETE FROM public.chat_sessions WHERE user_id = ANY($1)",
        [ids]
      );
      await tenantPool.query(
        "DELETE FROM public.canvas_share_entries WHERE user_id = ANY($1)",
        [ids]
      );
      await tenantPool.query(
        "UPDATE public.canvas_share_entries SET shared_by = NULL WHERE shared_by = ANY($1)",
        [ids]
      );
      await tenantPool.query(
        "DELETE FROM public.workbench_canvases WHERE user_id = ANY($1)",
        [ids]
      );
      await tenantPool.query(
        "DELETE FROM public.distribution_schedules WHERE created_by = ANY($1)",
        [ids]
      );
      await tenantPool.query(
        "DELETE FROM public.distribution_recipient_lists WHERE created_by = ANY($1)",
        [ids]
      );
      const delResult = await tenantPool.query(
        "DELETE FROM public.users WHERE id = ANY($1)",
        [ids]
      );

      console.log(`    Deleted ${delResult.rowCount} shadow user(s).`);
      totalDeleted += delResult.rowCount ?? 0;
    } catch (err: any) {
      console.error(
        `  [${tenant.name}] ERROR: ${err.message}`
      );
    } finally {
      await tenantPool.end();
    }
  }

  console.log(
    `\nDone. ${dryRun ? "Would delete" : "Deleted"} ${totalDeleted} shadow user(s) total.`
  );
  if (dryRun) {
    console.log("Re-run with --apply to actually delete them.");
  }
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(() => managementPool.end());
