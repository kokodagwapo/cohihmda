import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { pool as managementPool } from "../src/config/managementDatabase.js";
import { tenantDbManager } from "../src/config/tenantDatabaseManager.js";
import { createEncompassUserSyncService } from "../src/services/encompassUserSyncService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env") });

async function main() {
  const tenantSlug = process.argv[2] || "hfm";
  const tenant = (await managementPool.query(
    "SELECT id, slug FROM coheus_tenants WHERE slug = $1 AND status = 'active'",
    [tenantSlug],
  )).rows[0];
  if (!tenant) throw new Error(`Tenant not found: ${tenantSlug}`);

  const tenantPool = await tenantDbManager.getTenantPool(tenantSlug);
  if (!tenantPool) throw new Error(`No tenant pool: ${tenantSlug}`);

  const connection = (await tenantPool.query(
    "SELECT id, name FROM los_connections WHERE is_active = true LIMIT 1",
  )).rows[0];
  if (!connection) throw new Error(`No active LOS connection: ${tenantSlug}`);

  const service = createEncompassUserSyncService(tenantPool, tenant.id);
  const result = await service.syncUsers(connection.id);
  console.log(JSON.stringify({ tenant, connection, result }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
