# Cohi unified chat JSON Schemas

Draft JSON Schema files for the target `/api/chat/v1/*` contract described in [cohi-chat-unified-architecture.md](../cohi-chat-unified-architecture.md).

| File | Purpose |
| ------ | --------- |
| `chat-request.schema.json` | `POST /messages` body |
| `chat-response.schema.json` | Non-streaming assistant turn |
| `chat-event-stream.schema.json` | SSE/streamed events |

Source of truth lives in `server/src/contracts/chat/unifiedChatSchemas.ts`.
Regenerate these JSON files with `cd server && npm run schemas:chat:sync`.
CI/dev check: `cd server && npm run schemas:chat:check`.

Validate examples during implementation with `ajv` or equivalent.

Fields added in second pass: **`clientMessageId`** (idempotency), **`options.planningMode`** (planner vs single-shot); response **`metadata.compactionWatermark`** for long-thread compaction (see architecture doc §14).
