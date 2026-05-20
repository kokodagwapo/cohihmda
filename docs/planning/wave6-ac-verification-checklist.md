# Wave 6 — AC verification checklist (COHI-403–406)

Maps Jira acceptance criteria to automated evidence. Staging manual sign-off uses the Wave 5 flag bundle in [unified-chat-rollout.md](./unified-chat-rollout.md).

| Story | AC | Evidence |
|-------|-----|----------|
| COHI-403 | 1 | `e2e/unified-chat-history.spec.ts` — folders depth ≤5 |
| COHI-403 | 2 | `e2e/unified-chat-history.spec.ts` — POST folder mutation |
| COHI-403 | 3 | `e2e/unified-chat-history.spec.ts` — Full History search/filter/pagination |
| COHI-403 | 4 | `e2e/unified-chat-history.spec.ts` — legacy redirects |
| COHI-404 | 1–4 | `e2e/unified-chat-cohi386.spec.ts`, `e2e/unified-chat-shell.spec.ts` |
| COHI-405 | 1–4 | `e2e/unified-chat-ia.spec.ts` |
| COHI-406 | 1–4 | `e2e/unified-chat-modes.spec.ts` |
| COHI-396 | 1 | `e2e/unified-chat-surfaces.spec.ts` |
| COHI-397 | 1–4 | All `e2e/unified-chat-*.spec.ts` + replay CLI |
