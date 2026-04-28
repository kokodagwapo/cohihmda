import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { tenantDbManager } from "../src/config/tenantDatabaseManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env") });

async function main() {
  const tenantPool = await tenantDbManager.getTenantPool(process.argv[2] || "hfm");
  if (!tenantPool) throw new Error("No tenant pool");

  const connections = await tenantPool.query(
    `SELECT lc.id, lc.name, lc.is_active, lc.last_synced_at, COUNT(eu.id)::int AS cached_users
     FROM public.los_connections lc
     LEFT JOIN public.encompass_users eu ON eu.los_connection_id = lc.id
     GROUP BY lc.id, lc.name, lc.is_active, lc.last_synced_at
     ORDER BY lc.is_active DESC, lc.updated_at DESC NULLS LAST`,
  );
  const wantedIds = [
    "j_obrecht",
    "r_wohlert",
    "j.howald",
    "j.erb",
    "s.rosen",
    "p_hughes",
  ];
  const users = await tenantPool.query(
    `SELECT los_connection_id,
            encompass_user_id,
            username,
            first_name,
            middle_name,
            last_name,
            full_name,
            encompass_full_name,
            is_enabled,
            encompass_last_login,
            last_synced_at
     FROM public.encompass_users
     WHERE encompass_user_id = ANY($1::text[])
        OR username = ANY($1::text[])
     ORDER BY encompass_user_id`,
    [wantedIds],
  );
  const recentSyncLogs = await tenantPool.query(
    `SELECT los_connection_id, status, users_fetched, users_added, users_updated, users_disabled, started_at, completed_at, error_message
     FROM public.encompass_user_sync_log
     ORDER BY started_at DESC
     LIMIT 10`,
  );

  console.log(JSON.stringify({
    connections: connections.rows,
    wantedCachedUsers: users.rows,
    recentSyncLogs: recentSyncLogs.rows,
  }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
