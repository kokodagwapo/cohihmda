# Workbench live critical (CI)

Six Playwright scenarios that must stay green on workbench changes. They use **real LLM + canvas apply**, deterministic test seed, and **fail the job** when REPORT status is `broken` (not silent pass).

## Critical tests

| ID | Spec | What it guards |
|----|------|----------------|
| M06 | more-live | Remove funded volume via chat |
| M17 | more-live | Chart type line |
| M21 | more-live | All-time KPI (`All-time Funded Volume`, `data-filterable=false`) |
| M22 | more-live | Remove pull-through |
| M24 | more-live | Chart type bar |
| U07 | unique-live | Period switch L6M |

## Workflow

[`.github/workflows/workbench-live-critical.yml`](../.github/workflows/workbench-live-critical.yml) runs on PRs that touch workbench paths when GitHub secrets are set:

- `E2E_ADMIN_EMAIL`
- `E2E_ADMIN_PASSWORD`
- `E2E_ADMIN_TOTP_SECRET`

Backend env in CI:

- `WORKBENCH_RECONCILE_DEBUG=1` — reconcile trace on broken rows
- `WORKBENCH_TEST_SEED_ENABLED=1` — `POST /api/cohi-chat/workbench/test-seed`

## Local run

```powershell
# server/.env
WORKBENCH_RECONCILE_DEBUG=1
WORKBENCH_TEST_SEED_ENABLED=1

cd server; npm run dev
# separate shell
npx playwright test e2e/manual/workbench-more-live.spec.ts e2e/manual/workbench-unique-live.spec.ts --grep "M06|M17|M21|M22|M24|U07" --config=playwright.manual-live.config.ts
```

## Assertions

- Canvas state: `data-widget-title` on `[data-testid^="canvas-item-"]` and `[data-testid^="group-widget-"]` ([`e2e/helpers/workbenchCanvasState.ts`](../e2e/helpers/workbenchCanvasState.ts))
- Broken REPORT rows call `expect.soft` so Playwright exits non-zero

## Updating the gate

When adding a new critical row, update:

1. The `--grep` in the workflow
2. This doc table
3. Prefer `seedDeterministicBoard()` unless the test explicitly validates LLM board build
