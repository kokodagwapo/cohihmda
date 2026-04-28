/**
 * Print top unknown loan-book actors + Encompass fuzzy hints for a tenant (local support).
 *
 * Usage (from server/):
 *   npx tsx scripts/debug-actor-unknowns.ts <tenant_slug> [channel_group] [limit]
 *
 * Slugs are stored lowercase in `coheus_tenants` (e.g. `hfm`, not `HFM`).
 *
 * Requires server/.env with management DB + tenant credentials (same as API).
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { tenantDbManager } from "../src/config/tenantDatabaseManager.js";
import { listUnknownLoanActorsDebug } from "../src/services/actorStatusService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env") });

async function main() {
  const slug = process.argv[2] || process.env.TENANT_SLUG;
  if (!slug) {
    console.error("Usage: npx tsx scripts/debug-actor-unknowns.ts <tenant_slug> [channel_group] [limit]");
    process.exit(1);
  }
  const channelGroup = process.argv[3];
  const limit = process.argv[4] ? Number.parseInt(process.argv[4], 10) : 20;

  const pool = await tenantDbManager.getTenantPool(slug);
  if (!pool) {
    console.error(`No pool for tenant slug: ${slug}`);
    process.exit(1);
  }

  const out = await listUnknownLoanActorsDebug(pool, {
    channelGroup: channelGroup || undefined,
    limit: Number.isFinite(limit) ? limit : 20,
  });
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
