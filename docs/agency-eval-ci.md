# Workbench agency eval (CI)

The **agency-eval** check runs offline reconcile anchors — no LLM, no browser. It guards that workbench action augmentation stays stable when server reconcile code or client workbench libs change.

## When it runs

GitHub Actions workflow [`.github/workflows/agency-eval.yml`](../.github/workflows/agency-eval.yml) on pull requests that touch:

- `server/src/services/workbench/**`
- `server/src/routes/cohiWorkbench.ts`
- `src/lib/workbench/**`

## Local run

```bash
cd server
npm ci
npm run agency-eval
```

Expect `Agency eval: N passed, 0 failed` (currently ~21 anchors).

## Updating anchors

Anchors live under `server/src/services/workbench/agencyEval/`. When you intentionally change reconcile behavior:

1. Run `npm run agency-eval` locally and confirm diffs are expected.
2. Update the anchor fixture or expected actions in the eval harness.
3. Re-run until all anchors pass before merging.

## What it does *not* cover

- Playwright live workbench specs (see `e2e/manual/workbench-*-live.spec.ts`)
- Canvas UI refactors in `src/components/workbench/` unless they also change `src/lib/workbench/**`
