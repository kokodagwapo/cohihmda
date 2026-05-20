# Wave 4 — Jira implementation status (387–402)

Reference: [wave_4_unified_chat plan](~/.cursor/plans/wave_4_unified_chat_29c8ed51.plan.md). **COHI-389 AC3** deferred per locked decision #5.

**Wave 4 closeout (pre–Wave 5):** Client hooks use `POST /messages:stream` via [`unifiedChatSend.ts`](../../src/lib/unifiedChatSend.ts); `chat_type` on workbench sends; `researchShellExpand` metadata for COHI-404; `GET /conversations` resume parses blocks; COHI-402 AC4 route test in `chatV1.test.ts`.

| Story | Status | Notes |
|-------|--------|-------|
| **COHI-387** | Implemented | `/api/chat/v1/*` routes, AJV schemas, OpenAPI `server/openapi/chat-v1.yaml` |
| **COHI-388** | Implemented | Server `block.delta` global + research; **client** stream via `unifiedChatClient.postMessageStream` + hooks |
| **COHI-389** | Partial / defer AC3 | Policy engine + permissions; **AC3 deferred** |
| **COHI-390** | Implemented | `sharedPromptModules.ts`; `promptComposer` + legacy paths |
| **COHI-391** | Implemented | `PolicyDecision.retrieval`; RAG gated in v1 + legacy `/api/cohi-chat/ask` |
| **COHI-392** | Implemented | `safeExecuteSQL` via `runSqlThroughRouter` in research tools |
| **COHI-394** | Implemented | Contract invariants in `unifiedChatWave4.test.ts`; user-visible CTAs → Wave 5 |
| **COHI-395** | Implemented | Dual-read; hub scope ids; rebind API + SDK; rebind UI → Wave 5 |
| **COHI-396** | Implemented | `unifiedChatClient.ts` + `unifiedChatSend.ts`; hooks wired |
| **COHI-401** | Implemented | Gateway + schema validation |
| **COHI-402** | Implemented | Research stream + `researchShellExpand`; AC4 test on `/messages:stream` |

**Staging before Wave 5 history demo:** `VITE_UNIFIED_CHAT=true`, `UNIFIED_CHAT_HISTORY_DUAL_READ=true`, run `backfill-unified-chat-legacy.ts` per [unified-chat-rollout.md](./unified-chat-rollout.md).
