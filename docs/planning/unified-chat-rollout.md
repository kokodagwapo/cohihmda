# Unified Cohi Chat — rollout and rollback (COHI-398)

## Feature flags

| Layer | Variable | Effect when disabled |
| ----- | -------- | --------------------- |
| API | `UNIFIED_CHAT_ENABLED=false` | `GET`/`POST`/`DELETE` under `/api/chat/v1/*` returns 404 (non-production default follows `unifiedChatConfig`). |
| API persistence | `UNIFIED_CHAT_PERSIST=false` | Skip appending turns to `unified_chat_conversations` from the v1 route. |
| History dual-read | `UNIFIED_CHAT_HISTORY_DUAL_READ=true` | `GET /api/chat/v1/conversations` and `listCanonicalHistory` merge legacy `research_sessions` rows alongside unified rows (COHI-395 §11.3). When unset/false, only unified rows are returned. |
| Frontend | `VITE_UNIFIED_CHAT=true` | `useCohiChat`, `useWorkbenchCohi`, and hub Ask surfaces call `/api/chat/v1/messages` instead of legacy routes. |
| E2E override | `sessionStorage.cohi_force_unified_chat = "1"` | Forces the unified client path without a rebuild (used by Playwright). |
| E2E / debug | `localStorage.cohi_e2e_legacy_chat_only = "1"` | Overrides `VITE_UNIFIED_CHAT` — keeps legacy `/api/cohi-chat/*` (session history + ask). Used by persistence E2E while unified is on locally. |

## Rollout sequence

1. **Internal tenants:** Enable server unified routes; validate with manual smoke and `@critical @COHI-386` E2E.
2. **Beta tenants:** Set `VITE_UNIFIED_CHAT=true` for selected tenants or environments; monitor error rates on `/api/chat/v1/messages` and related v1 routes (`/conversations`, `/permissions`, `messages:stream`).
3. **General availability:** Enable Vite flag tenant-wide or globally after parity checks pass.

## Rollback

- Turn off `VITE_UNIFIED_CHAT` (or omit it). Clients revert to `/api/cohi-chat/*`, `/api/cohi-chat/workbench`, and `/api/workbench/ai/query` on hub pages.
- Set `UNIFIED_CHAT_ENABLED=false` to disable the gateway without removing code.

## Monitoring (architecture §11.4 checklist)

- Track 4xx/5xx rate and latency for `POST /api/chat/v1/messages`, `POST /api/chat/v1/messages:stream`, and conversation CRUD.
- Compare duplicate `clientMessageId` (409) volume — idempotency collisions.
- Alert on validation failures (`validation_error` / 400) spikes after deploys.

## Idempotency (`clientMessageId`)

- **Default:** Tenant DB table `unified_chat_idempotency_keys` (see tenant migration **129**). Rows include `expires_at` (10 days from insert). Safe across multiple app instances.
- **Dev / emergency:** Set `UNIFIED_CHAT_IDEMPOTENCY=memory` to use the legacy in-process map (single-instance only).
- If migration **129** has not been applied and env is not `memory`, inserts fall back to in-memory with a console warning.

### Idempotency cleanup (manual SQL — Wave 3, no in-app scheduler)

No background job sweeps `unified_chat_idempotency_keys` in Wave 3. Operators run the cleanup on a schedule (cron / Aurora maintenance window) against each tenant DB:

```sql
DELETE FROM public.unified_chat_idempotency_keys
WHERE expires_at < NOW();
```

Rerun is safe (`DELETE` is idempotent). A later epic can promote this to a worker if the table grows fast; until then the 10-day TTL keeps it bounded for typical chat volumes.

## COHI-389 AC3 — platform tenant (deferred Wave 4)

`assertPlatformTenantScope` is **not** wired into v1 request handling until the unified request schema defines cross-tenant / `platformTenantId` inputs. See `docs/planning/wave4-jira-implementation-status.md`.

## Limitations (until hardened)

- **Sessions:** With `VITE_UNIFIED_CHAT=true`, use `GET /api/chat/v1/conversations` via `UnifiedChatClient` / `useCohiChat.fetchSessions` (W1-7).

## Prompt module overrides (COHI-390 AC3)

`server/src/services/chat/promptComposer.ts` resolves a deterministic module set per `chat_type` / `surface` / `scope`. **Precedence rule (locked):** **repo default < tenant override**. Tenant overrides are not yet stored as DB rows; when added, the composer should read the override (if any) for a given `module.id` and substitute the rendered text while keeping the same `module.id@version` audit key. Until that ships, `bundleHash` reflects repo-only modules; an override that mutates rendered text must bump the module `version` (or include a tenant suffix) so audit attribution stays accurate.

## SQL router (COHI-392 AC2) — documented bypasses

`server/src/services/chat/sqlAndMetricsRouter.ts` exports `SQL_ROUTER_KNOWN_BYPASS_PATHS` listing legacy SQL execution sites that do not yet pass through `runSqlThroughRouter`. Shrink the list over time as each call site is wired through the gate; any new SQL access for `chat_type=research` must be added through the router (Wave 3 lock).

## Golden replay

See `scripts/replay/unified-chat-golden-prompts.json` for staging replay prompts.

## Legacy Research backfill runbook (COHI-395 §11.5)

`server/scripts/backfill-unified-chat-legacy.ts` walks `research_sessions` per tenant and inserts a matching `unified_chat_conversations` row (`chat_type=research`, `legacy_source=research_lab`, `legacy_ref=<session.id>`) when one does not already exist. Run per tenant:

```bash
npx tsx server/scripts/backfill-unified-chat-legacy.ts --tenant=<tenantId>
```

The script prints a single JSON line summary: `{ tenantId, inserted, skipped, total }`. Use that to monitor progress.

| Step | Action |
| ---- | ------ |
| Pre-flight | Confirm tenant migrations **122**, **129**, **130** applied. |
| Metrics | Log `inserted` / `skipped` / `total` per tenant; alert if `inserted` is unexpectedly **0** when `total > 0`. |
| Pause | If errors exceed ~5% of `total` for a tenant, stop further tenants and inspect logs before continuing. |
| Rollback | Reverse a tenant with `DELETE FROM public.unified_chat_conversations WHERE legacy_source = 'research_lab' AND messages = '[]'::jsonb;` — only deletes script-inserted shells, not user messages. |
| Verify | After backfill, `GET /api/chat/v1/conversations?chat_type=research` with `UNIFIED_CHAT_HISTORY_DUAL_READ=true` should match `research_sessions` counts; spot-check a few rows. |

## Wave 5 — centralization UX flag bundle (COHI-404–406)

Staging demo for the meeting-spec shell, history, IA, and modes UX. This is **separate** from Wave 6 production cutover (**COHI-398**).

| Layer | Variable | Wave 5 usage |
| ----- | -------- | ------------- |
| Frontend | `VITE_UNIFIED_CHAT=true` | Required: horizontal shell, v1 send/history, mode selector, sidebar §6.4 sections |
| API | `UNIFIED_CHAT_ENABLED=true` | Required: `/api/chat/v1/*` routes |
| API | `UNIFIED_CHAT_PERSIST=true` | Required for durable history/folders |
| History | `UNIFIED_CHAT_HISTORY_DUAL_READ=true` | Required on staging before **403**/**405** history QA (merged Research rows) |
| Tenant DB | Migrations **129**, **130**, **131** | Idempotency, `folder_id` / legacy columns, `unified_chat_folders` |

**Staging checklist (after flags + backfill):**

1. Apply migration **131** per tenant (`unified_chat_folders`).
2. Run `backfill-unified-chat-legacy.ts` per tenant (see above).
3. Enable the flag bundle on staging; reload the app (Vite env is build-time).
4. Spot-check: shell expand modes, Research auto full-page, `/chat/history`, legacy `/research-lab` and `/research?session=` redirects, sidebar Folders/History, Communications Center in top nav (no Research Lab pill), `GET /api/chat/v1/permissions` gating chat types.
5. Network tab: user sends use `POST /api/chat/v1/messages:stream` only (no `/api/cohi-chat/ask` on global chat).

**Rollback (Wave 5 UI only):** Set `VITE_UNIFIED_CHAT` off and redeploy the frontend; server flags can stay on. Users revert to the right-rail / legacy Research entry until re-enabled.
