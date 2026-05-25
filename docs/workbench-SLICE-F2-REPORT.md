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

## Reconcile pipeline log

_Not captured (enable `WORKBENCH_RECONCILE_DEBUG=1` if M24 still fails after F3)._
