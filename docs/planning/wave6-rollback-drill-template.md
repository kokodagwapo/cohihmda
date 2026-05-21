# Unified chat rollback drill template (COHI-398 AC2)

| Field | Value |
| ----- | ----- |
| Date | |
| Environment | staging |
| Frontend build | |
| API build | |
| Operator | |

## Steps

1. Set `VITE_UNIFIED_CHAT=false` → redeploy frontend.
2. Set `UNIFIED_CHAT_ENABLED=false` → restart API pods.
3. Verify `/data-chat` uses legacy ask (no `POST /api/chat/v1/messages:stream` on send).
4. Verify workbench legacy embedded panel if applicable.

## Outcome

- [ ] Pass — rollback under 15 minutes
- [ ] Fail — notes:

## Sign-off

Jira COHI-398 comment link:
