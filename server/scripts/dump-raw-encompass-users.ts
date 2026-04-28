import axios from "axios";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { pool as managementPool } from "../src/config/managementDatabase.js";
import { tenantDbManager } from "../src/config/tenantDatabaseManager.js";
import { getEncompassCredentials } from "../src/services/encompassCredentialsService.js";
import { EncompassApiService } from "../src/services/encompassApiService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env") });

async function main() {
  const tenantSlug = process.argv[2] || "hfm";
  const terms = process.argv.slice(3).map((term) => term.toLowerCase());

  const tenantResult = await managementPool.query(
    "SELECT id, slug FROM coheus_tenants WHERE slug = $1 AND status = 'active'",
    [tenantSlug],
  );
  const tenant = tenantResult.rows[0];
  if (!tenant) throw new Error(`Active tenant not found: ${tenantSlug}`);

  const tenantPool = await tenantDbManager.getTenantPool(tenantSlug);
  if (!tenantPool) throw new Error(`Tenant pool not found: ${tenantSlug}`);

  const connectionResult = await tenantPool.query(
    `SELECT id, name
     FROM public.los_connections
     WHERE is_active = true
     ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
     LIMIT 1`,
  );
  const connection = connectionResult.rows[0];
  if (!connection) throw new Error(`No active los_connections row for ${tenantSlug}`);

  const credentials = await getEncompassCredentials(tenant.id, connection.id);
  const apiServer = credentials.ApiServer || "https://api.elliemae.com";
  const service = new EncompassApiService(tenantPool);
  const accessToken = await (service as any).getEncompassAccessToken(
    tenant.id,
    connection.id,
  );

  const allUsers: any[] = [];
  let start = 0;
  const limit = 250;
  while (true) {
    const response = await axios.get(`${apiServer}/encompass/v3/users`, {
      headers: { Authorization: accessToken },
      params: {
        orgId: 0,
        isRecursive: true,
        entities: "all",
        start,
        limit,
      },
    });
    const payload = response.data;
    const pageUsers = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload?.users)
          ? payload.users
          : [];
    allUsers.push(...pageUsers);
    if (pageUsers.length === 0 || pageUsers.length < limit) break;
    start += limit;
  }

  const matches = terms.length
    ? allUsers.filter((user) => {
        const text = JSON.stringify(user).toLowerCase();
        return terms.some((term) => text.includes(term));
      })
    : allUsers.slice(0, 20);

  console.log(JSON.stringify({
    tenantSlug,
    tenantId: tenant.id,
    connection: { id: connection.id, name: connection.name },
    totalRawUsers: allUsers.length,
    searchedTerms: terms,
    matches,
    sampleKeys: allUsers[0] ? Object.keys(allUsers[0]).sort() : [],
    firstFiveRawUsers: terms.length ? undefined : allUsers.slice(0, 5),
  }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error.response?.data || error);
  process.exit(1);
});
