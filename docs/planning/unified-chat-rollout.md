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

**Authenticated entry:** Full-access users land on `/` (fullscreen unified chat). `/insights` remains the insights dashboard. Unauthenticated users are sent to login; public marketing is at `/landing`.

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

## Golden replay (COHI-397 AC3)

Prompts: `scripts/replay/unified-chat-golden-prompts.json`. Policy fixture: `server/scripts/replay/unified-chat-golden-fixture.json`.

| Command | When |
| ------- | ---- |
| `npm run replay:unified-chat:dry` | PR / local — validates fixture JSON only |
| `npm run replay:unified-chat` | Staging pre-cutover — live structural replay |

**Environment (live replay):**

- `COHI_API_BASE_URL` — staging API origin (e.g. `https://api.staging.example.com`)
- `COHI_REPLAY_AUTH_TOKEN` — bearer token for a test user
- `COHI_REPLAY_TENANT_ID` — tenant id (optional; default `tenant-unified-e2e`)
- `COHI_REPLAY_PASS_THRESHOLD` — minimum pass rate (default **0.95**)

**Structural invariants per prompt:** HTTP 200, UUID `conversationId`, non-empty `turn.blocks` with allowed `type` enum, `metadata.promptHash` present.

Store the last green JSON report (pass/fail/passRate) in the COHI-397 Jira comment or QA Confluence page before GA.

## Wave 6 — production cutover (COHI-398)

Wave 6 closes epic **COHI-386** after Wave 5 UX (**COHI-403–406**) AC verification and **COHI-397** E2E + replay gates.

### Production flag bundle

| Phase | Server | Client | History |
| ----- | ------ | ------ | ------- |
| Internal | `UNIFIED_CHAT_ENABLED=true`, `UNIFIED_CHAT_PERSIST=true` | `VITE_UNIFIED_CHAT=true` | `UNIFIED_CHAT_HISTORY_DUAL_READ=true` + per-tenant backfill |
| Beta | Same; optional tenant allowlist | Same | Monitor duplicate legacy/unified rows |
| GA | Global | Global | Dual-read until legacy Research write path retired |

### Cutover checklist (log in COHI-398)

1. Tenant migrations **128–131** applied on all tenant DBs.
2. `backfill-unified-chat-legacy.ts` per tenant; verify counts.
3. `npm run test:e2e:critical` green on dev deploy (unified-chat specs).
4. `npm run replay:unified-chat` on staging — pass rate ≥ **95%** (PM may raise to 100% for deterministic contract tests).
5. Manual spot-check **N=5** legacy Research URLs (`e2e/fixtures/legacy-research-sessions.json` ids on staging).
6. Architecture readiness §282–288: schema/policy tests, security review, P95/cost sign-off.
7. Internal → beta → GA per rollout sequence above.
8. Monitor §11.4 metrics for 48h after each phase.

### Rollback drill (execute once on staging; paste outcome in COHI-398)

| Step | Action | Verify |
| ---- | ------ | ------ |
| 1 | `VITE_UNIFIED_CHAT=false` → redeploy frontend | Legacy right-rail / Research Lab entry returns |
| 2 | `UNIFIED_CHAT_ENABLED=false` → restart API | `POST /api/chat/v1/*` returns 404 |
| 3 | Smoke `/data-chat` | Legacy `/api/cohi-chat/ask` used |
| 4 | Record build ids, timestamps, drill owner | Jira comment + Confluence |

### Observability (COHI-398 AC3)

- Dashboard: error rate + P95 latency for `POST /api/chat/v1/messages` and `POST /api/chat/v1/messages:stream`
- Alert on 4xx/5xx spikes and `clientMessageId` 409 volume after deploys
- Log correlation: `conversationId`, `chat_type`, `policyDecisionId`, `promptHash`

### Legacy route policy (epic AC3)

| Route | GA policy |
| ----- | --------- |
| `/api/cohi-chat/*`, `/api/cohi-chat/workbench`, `/api/workbench/ai/query` | Shim one release window; remove when traffic = 0 |
| `/research-lab`, `/research/session` | Keep redirects until analytics show negligible hits |
| In-research SESSIONS rail | Removed with unified shell (E2E **COHI-406**) |

### COHI-389 AC3 — platform tenant (deferred)

`assertPlatformTenantScope` remains unwired until cross-tenant schema is defined. **Not a Wave 6 blocker** — document PM sign-off on epic closeout (`docs/planning/wave6-epic-closeout.md`).

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
