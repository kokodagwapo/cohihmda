# Workbench maximal regression matrix

Scenario ledger is written at `test-results/workbench-regression/LEDGER.md` during live runs.

## Dimensions

| Dimension | Values |
|-----------|--------|
| Surface | `dashboard_canvas`, `dashboard_new`, `chat_home`, `data_chat`, `workbench_hub` |
| Chat mode | Workbench, Chat, Research, Insight builder |
| Canvas | saved+populated, new draft, second tab |
| Session | fresh, resumed, new-thread-after-turn |
| History | clock toggle, threads button, scoped API fetch |
| Scope UX | auto-sync, tab-switch prompt, pin, new-canvas preflight |

## Wave 1 — Baseline (W1-xx)

| ID | Case |
|----|------|
| W1-01 | Open seeded canvas → history + threads controls visible |
| W1-02 | Canvas history API scoped (not global_session) |
| W1-03 | Send turn → scope chip visible |
| W1-04 | New chat clears prior turn (no reload loop) |
| W1-05 | Tab switch → scope dialog → pin banner |
| W1-06 | Explicit new-canvas phrase → intent dialog |
| W1-07 | New chat + executive starter → intent dialog + Cancel |
| W1-08 | Auto-load latest thread when opening canvas (marker in transcript) |
| W1-09 | Switch chat on tab → loads canvas B thread |
| W1-10 | New canvas dialog → dismiss restores input |
| W1-11 | Threads button opens scoped sidebar |
| W1-12 | Workbench mode on dashboard_new shell |

## Wave 2 — Cross-surface / mode (W2-xx)

| ID | Case |
|----|------|
| W2-01 | chat_home → Workbench mode shell visible |
| W2-02 | chat_home → Chat mode send stub turn |
| W2-03 | data_chat shell + chat input |
| W2-04 | workbench_hub shell + hub ask placeholder |
| W2-05 | dashboard: Workbench → Chat → history scoped on dashboard |
| W2-06 | dashboard: Chat mode history uses canvas scope on dashboard path |
| W2-07 | dashboard_new: workbench prompt cards or input |
| W2-08 | Second canvas tab + scope chip updates |
| W2-09 | dashboard canvas: Research mode switch (no crash) |
| W2-10 | dashboard canvas: Insight builder switch (no crash) |
| W2-11 | chat_home: switch to Workbench then back to Chat |
| W2-12 | data_chat: select Workbench mode |

## Wave 3 — Edge / failure (W3-xx)

| ID | Case |
|----|------|
| W3-01 | New chat then greenfield typed message → new-canvas dialog |
| W3-02 | New canvas dialog Cancel → no send |
| W3-03 | Rapid tab switch A→B→A no hang |
| W3-04 | History open twice stable |
| W3-05 | New chat on empty seeded canvas |
| W3-06 | Pinned banner → Switch chat button visible |
| W3-07 | Scope chip click after mode switch to Workbench |
| W3-08 | Concurrent history fetch only canvas scope |

## Wave 4 — Soak (W4-xx)

Repeats critical W1 paths twice in one run to catch flakes. Run order in spec: W4-01 → W4-02 → **W4-04** → W4-03 (starter dialog before tab-pin soak avoids pinned-state leakage).

| ID | Case |
|----|------|
| W4-01 | Repeat W1-04 new chat empty |
| W4-02 | Repeat W1-02 scoped history |
| W4-03 | Repeat W1-05 tab switch pin |
| W4-04 | Repeat W1-07 starter new-canvas |

## Run

```bash
npx tsx e2e/manual-auth-setup.ts
npm run test:workbench-regression
```

Or per wave:

```bash
npx playwright test e2e/manual/workbench-regression-wave1.spec.ts --config=playwright.manual-live.config.ts
```
