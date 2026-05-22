#!/usr/bin/env node
/**
 * Backfill unified chat legacy research sessions for one or all active tenants.
 *
 * Usage:
 *   npx tsx src/migrations/backfillUnifiedChatCli.ts --all
 *   npx tsx src/migrations/backfillUnifiedChatCli.ts --tenant=<id-or-slug>
 *
 * In ECS (compiled):
 *   node dist/migrations/backfillUnifiedChatCli.js --all
 *
 * Opt-out: UNIFIED_CHAT_LEGACY_BACKFILL_ENABLED=false
 */

import pg from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { backfillUnifiedChatLegacyForTenant } from "../services/chat/backfillUnifiedChatLegacy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../../.env") });

const { Pool } = pg;

const isRemoteHost =
  process.env.DB_HOST &&
  process.env.DB_HOST !== "localhost" &&
  process.env.DB_HOST !== "127.0.0.1";

const DB_CONFIG = {
  host: (process.env.DB_HOST || "localhost").trim(),
  port: parseInt(process.env.DB_PORT || "5432", 10),
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  ssl: isRemoteHost ? { rejectUnauthorized: false } : false,
};

const MANAGEMENT_DB = process.env.MANAGEMENT_DB_NAME || "coheus_management";

interface TenantInfo {
  id: string;
  slug: string;
}

async function getActiveTenants(): Promise<TenantInfo[]> {
  const pool = new Pool({ ...DB_CONFIG, database: MANAGEMENT_DB });
  try {
    const result = await pool.query(`
      SELECT id, slug
      FROM coheus_tenants
      WHERE status = 'active'
      ORDER BY slug
    `);
    return result.rows;
  } finally {
    await pool.end();
  }
}

function isEnabled(): boolean {
  const flag = process.env.UNIFIED_CHAT_LEGACY_BACKFILL_ENABLED;
  if (flag === "false" || flag === "0") return false;
  return true;
}

async function main(): Promise<void> {
  if (!isEnabled()) {
    console.log(
      JSON.stringify({
        skipped: true,
        reason: "UNIFIED_CHAT_LEGACY_BACKFILL_ENABLED is false",
      }),
    );
    return;
  }

  const tenantArg = process.argv.find((a) => a.startsWith("--tenant="));
  const tenantId = tenantArg?.split("=")[1];
  const runAll = process.argv.includes("--all");

  if (!tenantId && !runAll) {
    console.error("Usage: backfillUnifiedChatCli.ts --all | --tenant=<id-or-slug>");
    process.exit(1);
  }

  const tenants = runAll
    ? await getActiveTenants()
    : [{ id: tenantId!, slug: tenantId! }];

  if (tenants.length === 0) {
    console.log(JSON.stringify({ tenants: 0, results: [] }));
    return;
  }

  const results = [];
  let hadError = false;

  for (const tenant of tenants) {
    const key = tenant.slug || tenant.id;
    try {
      const result = await backfillUnifiedChatLegacyForTenant(key);
      results.push(result);
      console.log(JSON.stringify(result));
    } catch (err: unknown) {
      hadError = true;
      const message = err instanceof Error ? err.message : String(err);
      const failure = { tenantId: key, error: message };
      results.push(failure);
      console.error(JSON.stringify(failure));
    }
  }

  console.log(
    JSON.stringify({
      tenants: tenants.length,
      inserted: results.reduce(
        (sum, r) => sum + ("inserted" in r ? r.inserted : 0),
        0,
      ),
      skipped: results.reduce(
        (sum, r) => sum + ("skipped" in r ? r.skipped : 0),
        0,
      ),
      orphaned: results.reduce(
        (sum, r) => sum + ("orphaned" in r ? r.orphaned : 0),
        0,
      ),
    }),
  );

  if (hadError) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
