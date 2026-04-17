# QA Runbook

This runbook defines how QA is executed for Cohi today and how new features must be tested going forward.

Related docs:

- `docs/QA_TEST_TAGGING.md`
- `docs/QA_ACCEPTANCE_CRITERIA_CONVENTION.md`
- `docs/AI_AC_VALIDATOR_RUNBOOK.md`

## Objectives

- Catch regressions before deployment.
- Keep CI fast for PRs and deep for scheduled validation.
- Make test ownership and expectations explicit for every feature.

## Test Layers

- `@smoke`: Fast confidence checks on core routes and critical availability.
- `@critical`: High-risk business workflows, auth/role controls, and key flows.
- `@regression`: Broad route-by-route validation and deeper data/behavior checks.

Primary commands:

- `npm run test:e2e:smoke`
- `npm run test:e2e:critical`
- `npm run test:e2e:regression`
- `npm run test:e2e`
- `npm run lint:qa:test-tags`

## Bitbucket Execution Model

- **Pull Requests / merges:** run `@smoke` (blocking).
- **Dev deploy pipeline:** run `@critical` in Chromium (blocking).
- **Hybrid QA pipeline (`ai-qa-dev`):** runs regression reporting for issue-tagged Playwright evidence, and optionally the AC validator when `QA_ENABLE_AC_VALIDATOR=true`.
- **Nightly schedule on dev:** run `@regression` (blocking for nightly signal).
- **Cross-browser (Firefox/WebKit):** run in nightly/regression lane, not PR gate.
- **Artifacts always retained:** traces, screenshots, videos, junit reports.

## Release QA Checklist

- Smoke suite green.
- Critical suite green in Chromium.
- No new flaky tests introduced by the release.
- Role/access checks verified for new privileged actions.
- Data-contract checks pass for newly touched APIs.
- Required deployment variables present and valid.
- Rollback path verified for risky changes.

## New Feature Procedure (Required)

For every feature:

1. Define acceptance criteria with testable outcomes.
2. Add tests at the right layers:
   - Unit tests for local logic.
   - Integration/API contract tests for service behavior.
   - E2E tests for user-critical paths and role boundaries.
3. Tag E2E coverage with `@smoke`, `@critical`, or `@regression`.
4. Add stable selectors (`data-testid`) as part of implementation.
5. Ensure test data setup/cleanup exists (reuse E2E provisioning where possible).
6. Update route coverage documentation in `e2e/route-matrix.md` when new routes are added.
7. Merge only when required gates pass for the change scope.

## Bug Handling Policy

- No bug closes without an automated regression test (where technically possible).
- For high-severity incidents: add failing test first, then fix, then keep test permanently.

## Flakiness Policy

- Keep flaky rate under agreed threshold (recommended: <2% rerun failure rate).
- Quarantine persistently flaky tests into a non-blocking lane until fixed.
- Any new flaky test introduced by a PR is treated as a release-blocking issue.

## Recommended Next QA Investments

- API contract suites (schema + required fields) for critical endpoints.
- Accessibility checks (axe) on top critical routes.
- Lightweight visual regression snapshots on high-value dashboards.
- Basic performance guardrails (page/API thresholds) for key journeys.
- Ownership map for tests by feature area/team.

