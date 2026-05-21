# Wave 6 — staging validation log (COHI-397 / COHI-398)

Use after Wave 5 flag bundle is enabled on staging.

## Unmocked smoke

| Check | Command / action | Pass |
| ----- | ---------------- | ---- |
| Critical E2E | `npm run test:e2e:critical` against staging `E2E_BASE_URL` | ☐ |
| Replay harness | `COHI_REPLAY_AUTH_TOKEN=… COHI_API_BASE_URL=… npm run replay:unified-chat` | ☐ |
| Pass rate ≥ 95% | From replay JSON `passRate` | ☐ |

## Legacy URL spot-check (N sessions)

Fixture: `e2e/fixtures/legacy-research-sessions.json`. Replace ids with real staging `research_sessions.id` values before running.

| Session id | `/research-lab?session=` → `/insights?resume=&mode=research` | Resume loads in shell |
| ---------- | -------------------------------------------------------------- | --------------------- |
| 1 | ☐ | ☐ |
| 2 | ☐ | ☐ |

## Notes

Record environment build ids, flag values, and owner in COHI-398 when complete.
