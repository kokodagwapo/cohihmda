/**
 * Idempotent backfill: link research_sessions → unified_chat_conversations (COHI-395).
 * Manual run: npm run backfill:unified-chat-legacy -- --tenant=<tenantId>
 * All tenants: npm run backfill:unified-chat-legacy -- --all
 */
import { backfillUnifiedChatLegacyForTenant } from "../src/services/chat/backfillUnifiedChatLegacy.js";

async function main() {
  const tenantArg = process.argv.find((a) => a.startsWith("--tenant="));
  const tenantId = tenantArg?.split("=")[1];
  if (!tenantId) {
    console.error("Usage: --tenant=<tenantId>  (or use backfillUnifiedChatCli.ts --all)");
    process.exit(1);
  }
  const result = await backfillUnifiedChatLegacyForTenant(tenantId);
  console.log(JSON.stringify(result));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
