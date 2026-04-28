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
  const terms = process.argv.slice(3);
  const patterns = (terms.length ? terms : ["obrecht", "wohlert", "howald", "erb", "rosen"])
    .map((term) => `%${term.toLowerCase()}%`);
  const { rows } = await tenantPool.query(
    `SELECT encompass_user_id, username, first_name, last_name, full_name, email, is_enabled
     FROM public.encompass_users
     WHERE LOWER(COALESCE(encompass_user_id, '')) LIKE ANY($1::text[])
        OR LOWER(COALESCE(username, '')) LIKE ANY($1::text[])
        OR LOWER(COALESCE(first_name, '')) LIKE ANY($1::text[])
        OR LOWER(COALESCE(last_name, '')) LIKE ANY($1::text[])
        OR LOWER(COALESCE(full_name, '')) LIKE ANY($1::text[])
        OR LOWER(COALESCE(email, '')) LIKE ANY($1::text[])
     ORDER BY full_name`,
    [patterns],
  );
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
