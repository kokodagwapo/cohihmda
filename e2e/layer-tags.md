# Playwright Layer Tags

The E2E suite uses title tags for CI selection:

- `@smoke`: fast route and core availability checks (PR gate, Chromium).
- `@critical`: high-risk business workflows and role/security flows.
- `@regression`: broad route-by-route coverage for nightly or scheduled runs.

Run commands:

- `npm run test:e2e:smoke`
- `npm run test:e2e:critical`
- `npm run test:e2e:regression`
- `npm run test:e2e` (full suite)
