# Manual workbench exploration

Not run in CI. Use the app locally with Workbench chat and varied prompts.

**High-value automated coverage** lives in:

- `e2e/unified-chat-workbench-period.spec.ts` (mocked MTD scope)
- `e2e/unified-chat-workbench-live.spec.ts` (optional live LLM, `@live`)

Example prompts to try by hand:

- YTD snapshot on empty canvas
- Single MTD KPI
- Follow-up: “Switch the whole dashboard to year-to-date”
- Presentation from populated canvas
- All-time KPI (no date filter)
- Rename one widget in the group
