# Metric composer rollout status

Implemented in this branch:

- **MetricSpec** (`server/src/services/metrics/metricSpec.ts`) — Zod schema and semantic contract types.
- **composeMetricSql** (`metricQueryComposer.ts`) — deterministic SQL from spec; uses `composeCatalogMetricSnapshotSql` / `composeCatalogMetricGroupedSql` and segmented pull-through builder.
- **metricPlanner** — LLM maps questions → MetricSpec using a reduced metric appendix (`intentRouter`).
- **safeSqlExecutor** — shared execution with `statement_timeout`, concurrency limit, circuit breaker; **research `safeExecuteSQL` delegates here**.
- **metricComposerFlags** — `metric_composer_enabled`, `metric_composer_<surface>_enabled` platform settings + env overrides.
- **Cohi Chat** — when composer enabled, planner → compose → execute before legacy `generateQuery`; loan access on `ChatContext.userAccessFilter`; `executeQuery` uses safe executor + access inject when SQL has no prior placeholders.
- **gatherInsightMetrics** — access filter injection via `injectLoanAccessForLoansAlias`.
- **Migration** `tenant/123_metric_query_traces.sql` + `persistMetricQueryTrace` helper (optional persistence).
- **Tests** — `metricSpec.test.ts`.
- **Rate limits** — `POST /cohi-chat/execute-sql` uses `apiLimiter`; `POST /api/research/sessions` uses `apiLimiter`.

- **Workbench** — `query_data` accepts optional `metricSpec` (composed server-side with loan access); raw SQL uses `ChatContext.userAccessFilter` + parameter placeholder shifting via shared merge (same as Chat).
- **Insights** — `headlineMetricSignature` may use `metricSpec` instead of `sql`; validation composes via `composeMetricSql` then runs `safeExecuteSQL` with params.
- **Research** — `runDataAnalystAgent` receives `tenantId` + `getUserLoanAccessFilter`; queries support optional `metricSpec` (composed with access); freeform SQL merged via `mergeLoanAccessWithParameterizedSql` / extended `safeExecuteSQL` options.
- **Chat `executeQuery`** — always merges loan access including when SQL already uses `$n` (placeholder shift).

Follow-up (optional):

- Wire `persistMetricQueryTrace` into Chat execution paths for full observability.
- Prompt DB entries: extend `cohi_chat.query_generation` text via Admin to mention composer path (defaults file updated lightly).
- Regression pack: expand beyond `metricSpec.test.ts`; optional Docker Postgres integration job.

Environment keys:

- `METRIC_COMPOSER_ENABLED`, `METRIC_COMPOSER_CHAT_ENABLED`, etc.
- Platform settings: `metric_composer_enabled`, `metric_composer_chat_enabled`, ...
