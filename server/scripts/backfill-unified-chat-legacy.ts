/**
 * Idempotent backfill: link research_sessions → unified_chat_conversations (COHI-395).
 * Manual run: npx tsx server/scripts/backfill-unified-chat-legacy.ts --tenant=<tenantId>
 */
import { tenantDbManager } from "../src/config/tenantDatabaseManager.js";

async function main() {
  const tenantArg = process.argv.find((a) => a.startsWith("--tenant="));
  const tenantId = tenantArg?.split("=")[1];
  if (!tenantId) {
    console.error("Usage: --tenant=<tenantId>");
    process.exit(1);
  }
  const pool = await tenantDbManager.getTenantPool(tenantId);
  const sessions = await pool.query(
    `SELECT id, user_id, topic, created_at, updated_at FROM public.research_sessions ORDER BY created_at ASC`,
  );
  let inserted = 0;
  let skipped = 0;
  for (const s of sessions.rows) {
    const exists = await pool.query(
      `SELECT 1 FROM public.unified_chat_conversations WHERE legacy_ref = $1 AND user_id = $2::uuid LIMIT 1`,
      [s.id, s.user_id],
    );
    if (exists.rows.length > 0) {
      skipped++;
      continue;
    }
    await pool.query(
      `INSERT INTO public.unified_chat_conversations (
        user_id, scope_type, scope_key, title, chat_type, legacy_ref, legacy_source, messages, created_at, updated_at
      ) VALUES ($1::uuid, 'global_session', NULL, $2, 'research', $3, 'research_lab', '[]'::jsonb, $4, $5)`,
      [
        s.user_id,
        (s.topic || "Research").slice(0, 200),
        s.id,
        s.created_at,
        s.updated_at ?? s.created_at,
      ],
    );
    inserted++;
  }
  console.log(JSON.stringify({ tenantId, inserted, skipped, total: sessions.rows.length }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
