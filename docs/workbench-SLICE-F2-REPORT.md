# Slice F2 live verify (tracked)

Gitignored runtime copy: `test-results/more-live/SLICE-F2-REPORT.md`

| ID | Suite | Case | Status | Observed |
|----|-------|------|--------|----------|
| M17 | more-live | Chart type line | works | lineCurve=true |
| M18 | more-live | Duplicate widget | works | widgets 6→7 |
| M21 | more-live | All-time KPI | broken | Updated dashboard group |
| M22 | more-live | Remove pull-through | works | gone=true |
| M23 | more-live | WAC on board-ready | broken | wac=false |
| M24 | more-live | Chart type bar | rough | barRect=false footer=false |
| U02 | unique-live | Chart type line | works | lineCurve=true |
| U04 | unique-live | Toolbar duplicate | works | widgets 6→7 |
| U07 | unique-live | L6M period | works | Updated dashboard period |
| U08 | unique-live | Remove volume | works | gone=true |
| U09 | unique-live | PT remove+readd | works | ok |
| U10 | unique-live | Duplicate 2nd widget | works | widgets 6→7 |

## Auth (F1)

- Refreshed: `npx tsx e2e/manual-auth-setup.ts` — success (2026-05-25)
- globalSetup: `e2e/manual-auth-global-setup.ts`

## Post-F3 re-run (M21/M23/M24)

| ID | Status | Notes |
|----|--------|-------|
| M21 | broken | Footer still "Updated dashboard group" — restart backend to load F3 reconcile |
| M23 | broken | WAC add turn — restart backend |
| M24 | rough→F4 broken | barRect=false — restart backend |

## F5/F6 regression

- NR01–NR08 + E01–E05: **13/13 passed** after toolbar extract
- Handler unit tests: **20/20 passed**
- `WorkbenchCanvas.tsx`: **5096 lines** (target &lt;1500 not met; toolbar + layout still inline)

## Reconcile pipeline log

_Not captured (enable `WORKBENCH_RECONCILE_DEBUG=1` if M24 still fails after F3)._
