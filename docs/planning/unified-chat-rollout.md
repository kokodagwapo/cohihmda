# Unified Cohi Chat — rollout and rollback (COHI-398)

## Feature flags

| Layer | Variable | Effect when disabled |
| ----- | -------- | --------------------- |
| API | `UNIFIED_CHAT_ENABLED=false` | `POST /api/chat/v1/*` returns 404 (non-production default follows `unifiedChatConfig`). |
| API persistence | `UNIFIED_CHAT_PERSIST=false` | Skip appending turns to `unified_chat_conversations` from the v1 route. |
| Frontend | `VITE_UNIFIED_CHAT=true` | `useCohiChat`, `useWorkbenchCohi`, and hub Ask surfaces call `/api/chat/v1/messages` instead of legacy routes. |
| E2E override | `sessionStorage.cohi_force_unified_chat = "1"` | Forces the unified client path without a rebuild (used by Playwright). |
| E2E / debug | `localStorage.cohi_e2e_legacy_chat_only = "1"` | Overrides `VITE_UNIFIED_CHAT` — keeps legacy `/api/cohi-chat/*` (session history + ask). Used by persistence E2E while unified is on locally. |

## Rollout sequence

1. **Internal tenants:** Enable server unified routes; validate with manual smoke and `@critical @COHI-386` E2E.
2. **Beta tenants:** Set `VITE_UNIFIED_CHAT=true` for selected tenants or environments; monitor error rates on `/api/chat/v1/messages`.
3. **General availability:** Enable Vite flag tenant-wide or globally after parity checks pass.

## Rollback

- Turn off `VITE_UNIFIED_CHAT` (or omit it). Clients revert to `/api/cohi-chat/*`, `/api/cohi-chat/workbench`, and `/api/workbench/ai/query` on hub pages.
- Set `UNIFIED_CHAT_ENABLED=false` to disable the gateway without removing code.

## Monitoring (architecture §11.4 checklist)

- Track 4xx/5xx rate and latency for `POST /api/chat/v1/messages`.
- Compare duplicate `clientMessageId` (409) volume — idempotency collisions.
- Alert on validation failures (`validation_error` / 400) spikes after deploys.

## Limitations (until hardened)

- **Idempotency:** In-memory dedupe for `clientMessageId` is single-instance only; replace with Redis or Postgres for multi-node deployments.
- **Sessions:** With `VITE_UNIFIED_CHAT=true`, legacy chat session sidebar uses empty list until unified session APIs are wired.

## Legacy research backfill (dev deploy)

After tenant migrations, the **dev** Bitbucket pipeline runs an idempotent backfill that links `research_sessions` → `unified_chat_conversations` for every active tenant:

- **Every dev branch deploy:** `scripts/bitbucket/run-unified-chat-backfill.sh` (even frontend-only pushes)
- **After migrations:** same script is also invoked from `run-migrations.sh` when `BITBUCKET_DEPLOYMENT_ENVIRONMENT=dev`
- **Manual custom pipeline:** `run-unified-chat-backfill-dev`
- **CLI (local or ECS):** `node dist/migrations/backfillUnifiedChatCli.js --all`
- **Opt-out:** set `UNIFIED_CHAT_LEGACY_BACKFILL_ENABLED=false` on the Bitbucket dev deployment

Manual single-tenant run from repo:

```bash
cd server
npm run backfill:unified-chat-legacy -- --tenant=<tenant-slug>
```

Production deploy does **not** run this automatically.

### Why backfill might not run (troubleshooting)

| Symptom | Likely cause |
| -------- | ------------- |
| Log says `Skipping Migrations (no backend/infra changes)` and no backfill block | Old pipeline YAML — backfill now runs in a **separate** step on every dev deploy |
| `backfillUnifiedChatCli.js` / module not found in ECS | Backend with the backfill code was never deployed; run **backend-dev** or push `server/` changes |
| `ECS Exec is not enabled` | Enable execute-command on the dev ECS service |
| Pipeline fails on FK / user_id | Orphan `research_sessions` — fixed by skipping rows without a matching `users` row |
| `UNIFIED_CHAT_LEGACY_BACKFILL_ENABLED=false` | Bitbucket dev deployment variable disables the job |

## Golden replay

See `scripts/replay/unified-chat-golden-prompts.json` for staging replay prompts.
