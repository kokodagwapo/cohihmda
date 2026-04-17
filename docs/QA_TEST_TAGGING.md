# QA Test Tagging

This document defines how Playwright tests are tagged for the hybrid QA pipeline.

## Required tags

Every Playwright test title must include:

- One suite tag: `@smoke`, `@critical`, or `@regression`
- At least one Jira tag in `@COHI-123` format when the test verifies a specific ticket

Example:

```ts
test("@critical @COHI-77 opens the workbench agents panel", async ({ userPage }) => {
  // ...
});
```

## Why the Jira tag exists

The QA runner reads Jira keys directly from Playwright test titles and uses them to:

- group run results by issue
- create one Confluence QA page per Jira issue
- scope failed-test evidence to the right ticket
- detect evidence gaps when a commit mentions a ticket but no tagged test covers it

If a test is not tagged, the runner cannot reliably prove which Jira issue it verifies.

## Tag format rules

- Jira tags must match `@PROJECT-123`
- For this repo today, the expected project prefix is usually `@COHI-*`
- Lowercase or malformed tags like `@cohi-77` or `@COHI77` are rejected by CI
- A test may carry more than one Jira tag if it truly verifies more than one ticket

Example:

```ts
test("@critical @COHI-77 @COHI-96 saves the canvas and refreshes linked widgets", async () => {
  // ...
});
```

## Existing spec allowlist

This repo has a checked-in allowlist for older spec files that predate the Jira-tag requirement.

- New spec files are not allowed onto the allowlist
- Existing allowlisted files should be tagged down over time
- CI will fail if the allowlist grows or if an allowlisted file no longer needs the exemption

## Local validation

Run the tag lint before push:

```bash
npm run lint:qa:test-tags
```

Optional Jira existence validation can be enabled in CI by setting:

```bash
QA_LINT_VERIFY_JIRA=true
```

When that flag is enabled, the lint cross-checks tagged Jira keys against Atlassian.
