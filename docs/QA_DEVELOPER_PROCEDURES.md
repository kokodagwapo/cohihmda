# Cohi — QA Developer Procedures

> Last updated: April 2026
> Related: `docs/TESTING_STRATEGY.md`, `docs/QA_RUNBOOK.md`, `docs/AI_AC_VALIDATOR_RUNBOOK.md`

This document is the practical reference for developers. It tells you exactly what to do, when to do it, and what pipeline settings to use. For the strategic rationale behind these procedures, see `docs/TESTING_STRATEGY.md`.

---

## 1. Before You Start a Feature

- [ ] Jira ticket exists with numbered acceptance criteria.
- [ ] AC items use the `[CATEGORY]` tag format if you plan to also run the AI AC validator: `1. [ROUTE] Navigating to /some-page renders...` (categories: `ROUTE`, `UI`, `API`, `ASSERTION`, `STATE`).
- [ ] You know which route(s) the feature touches.

---

## 2. During Development

### Branch naming

```
feature/COHI-{N}-{short-description}
bugfix/COHI-{N}-{short-description}
```

Branch from `dev`, not `main`. See `docs/TESTING_STRATEGY.md` for the gitflow model.

### Local E2E environment setup

Playwright local auth setup reads E2E credentials from process environment, and the repo now auto-loads:

- `.env.e2e`
- `.env.e2e.local`

for local runs only. CI can still inject environment variables directly, which take precedence over the local files.

Recommended setup:

1. Copy `.env.e2e.example` to `.env.e2e.local`
2. Fill in your tenant-admin credentials and TOTP secret
3. Run the env checker before your first local E2E run

```bash
cp .env.e2e.example .env.e2e.local
npm run e2e:check-env
```

Required variables for local Playwright auth refresh:

- `E2E_ADMIN_EMAIL`
- `E2E_ADMIN_PASSWORD`
- `E2E_ADMIN_TOTP_SECRET`

Common optional variables:

- `E2E_BASE_URL` defaults to `http://localhost:5000`
- `E2E_ADMIN_TENANT_SLUG`
- `E2E_MANAGED_EMAIL_PREFIX`
- `E2E_PLATFORM_ADMIN_EMAIL`
- `E2E_PLATFORM_ADMIN_PASSWORD`
- `E2E_PLATFORM_ADMIN_TOTP_SECRET`

Notes:

- `.env.e2e.local` is for local developer machines only and must never be committed.
- The Playwright global setup provisions fresh tenant users and rewrites `e2e/.auth/*.json` for each run, so you should treat those auth files as disposable artifacts, not hand-maintained session files.
- If E2E auth seems stale, re-run `npm run e2e:check-env` and then any Playwright command to regenerate the auth state.

### Write your E2E test alongside the feature

Create a spec file in `e2e/` following the project conventions:

```typescript
import { test, expect } from "./fixtures";

test.describe("Feature Name (COHI-{N})", () => {
  test("@critical @COHI-{N} descriptive test name", async ({ userPage }) => {
    await userPage.goto("/your-route", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

    // Use stable selectors
    await expect(userPage.locator("h1")).toContainText("Page Title");
    await expect(userPage.locator("#stable-id")).toBeVisible();
    await expect(userPage.getByRole("button", { name: "Action" })).toBeEnabled();
  });
});
```

### Selector priority (most stable → least stable)

| Priority | Selector type | Example | When to use |
|----------|--------------|---------|-------------|
| 1 | `id` attribute | `#CohiInsights`, `#ttc-kpi-total-revenue` | Always preferred when available |
| 2 | ARIA role | `getByRole("button", { name: "Focus Dashboard" })` | Buttons, dialogs, tabs, headings |
| 3 | Semantic HTML | `locator("h1")`, `locator("table")` | Page titles, data tables |
| 4 | `data-testid` | `getByTestId("user-menu-trigger")` | Custom test hooks you add |
| 5 | Well-known library class | `.recharts-wrapper`, `.recharts-bar-rectangle` | Third-party chart/widget containers |
| 6 | `getByText()` (scoped) | `dialog.getByText("Save")` | Only inside a scoped parent |

**Avoid:**
- Bare `getByText()` on strings that appear in navigation, sidebars, and page content simultaneously.
- Tailwind class selectors that change with design updates (e.g., `bg-violet-50`).
- Index-based selectors (`.nth(3)`) unless the DOM order is guaranteed.

### Test tagging rules

Every test title **must** include:

| Tag | Required? | Purpose |
|-----|-----------|---------|
| `@smoke` or `@critical` or `@regression` | Yes | Controls which CI lane runs it |
| `@COHI-{N}` | Yes for feature/bug tests | Links evidence to the Jira ticket |

Example: `"@critical @COHI-327 focus dashboard scopes to selected loan officers"`

### Run tests locally before pushing

```bash
# Check that local E2E secrets are present
npm run e2e:check-env

# Run just your new spec
npx playwright test e2e/your-spec.spec.ts --project=chromium

# Run the full critical suite
npm run test:e2e:critical

# Run with UI for debugging
npm run test:e2e:ui
```

---

## 3. Pull Request Checklist

Before requesting review:

- [ ] At least one `@critical @COHI-{N}` E2E test exists for the feature.
- [ ] Test uses stable selectors (see priority table above).
- [ ] Test passes locally: `npx playwright test e2e/your-spec.spec.ts --project=chromium`.
- [ ] Commit messages include the Jira key (e.g., `COHI-327 feat: add actor focus mode`).
- [ ] PR targets `dev`, not `main`.

---

## 4. After Merge to Dev — Running the QA Pipeline

### Standard run (deterministic tests only — recommended)

Go to Bitbucket → Pipelines → Run pipeline → Custom: `ai-qa-dev`

| Field | Value | Notes |
|-------|-------|-------|
| Branch | `dev` | |
| QA_SUITE | `critical` | |
| QA_ENABLE_AC_VALIDATOR | `false` | Deterministic tests are the primary evidence |
| QA_COMMIT_RANGE | `HEAD~1..HEAD` | Just the merge commit |
| Everything else | (leave blank/default) | |

**What happens:** Playwright runs the critical suite, the QA runner discovers your `@COHI-{N}` tags, uploads screenshots to S3, creates/updates Confluence QA pages per issue, and posts status comments on Jira.

### Extended run (deterministic + AI validator)

Use this when you want supplementary exploratory evidence or are testing AC validator behavior.

| Field | Value | Notes |
|-------|-------|-------|
| Branch | `dev` | |
| QA_SUITE | `critical` | |
| QA_ENABLE_AC_VALIDATOR | `true` | |
| QA_AC_DRY_RUN | `false` | |
| QA_COMMIT_RANGE | `HEAD~N..HEAD` | N = number of commits to scan for Jira keys |
| QA_AC_MAX_STEPS_PER_ISSUE | `60` | Default 25 is too low for tickets with 15+ AC items |
| QA_AC_MAX_WRITES_PER_ISSUE | `30` | Default 10 is too low for interaction-heavy features |
| QA_AC_MAX_WRITES_PER_RUN | `60` | Default 25; raise when validating multiple issues |

### Commit range guidance

| Scenario | QA_COMMIT_RANGE | Alternative |
|----------|----------------|-------------|
| Just merged one PR | `HEAD~1..HEAD` | |
| Merged two PRs | `HEAD~2..HEAD` | |
| Not sure how many commits | (leave empty) | Set `QA_COMMIT_LOOKBACK=20` |
| Want specific hash range | `{old_hash}..HEAD` | Use `git log --oneline origin/dev -10` to find the boundary |

The runner discovers Jira keys by scanning commit messages in the range for the pattern `COHI-{N}`. It also discovers keys from `@COHI-{N}` test tags in the Playwright results. Both sources are merged.

---

## 5. Reading Pipeline Results

### In the pipeline log

Look for these lines:

```
[QaRunner] Discovered Jira issues from commit history: COHI-327, COHI-328
[QaRunner] Discovered Jira issues from test tags: COHI-327, COHI-328
```

If your ticket is missing, your commit messages don't contain the key or your tests aren't tagged.

### On Jira

The QA Agent posts a status comment on each discovered issue:

```
[QA Agent] Latest Status — Build #NNN PASSED
Suite: critical | Env: dev | Duration: Xs | Pass rate: N%
Tagged tests: M verified this build
QA evidence: https://teraverde.atlassian.net/wiki/spaces/SRS/pages/...
```

### On Confluence

Each issue gets a QA page under the SRS space with:
- Build summary table (environment, suite, pass rate, duration)
- Per-test results with pass/fail status
- Related commits
- Screenshots (when Confluence attachment permissions are configured)
- AC validator results (if enabled)

---

## 6. Decision Framework — Deterministic vs AI-Assisted Testing

Not every feature can be tested the same way. Use this framework to decide what kind of test to write.

### Decision table

| Feature type | Deterministic test? | AI AC validator? | Why |
|-------------|-------------------|-----------------|-----|
| **Static UI** (page renders, layout, buttons, panels) | Yes — primary evidence | Optional supplement | DOM structure is stable and predictable |
| **User interaction flow** (click, select, focus, modal open/close) | Yes — primary evidence | Optional supplement | Interaction outcomes are deterministic given the same state |
| **Data-driven dashboard** (KPIs, charts, tables from API) | Yes — assert structure, not exact values | Optional supplement | Assert that cards/charts render and contain non-zero numeric values; don't hardcode specific dollar amounts since data changes between syncs |
| **LLM-powered chat** (Cohi Chat, Workbench Cohi panel) | Partial — test the shell, not the response content | Yes — useful here | You CAN deterministically test: panel opens, input field accepts text, send button works, a response container appears, no console errors. You CANNOT deterministically test: the exact response text, insight quality, or reasoning output. The AI validator can exploratorily verify that the chat produces a non-empty response. |
| **AI-generated insights** (CohiPromptsCard, dashboard insights) | Partial — test rendering, not content | Yes — useful here | Deterministically assert: insight section renders, cards have headline + understory structure, drill-down modal opens. Don't assert on specific insight text — it changes every generation cycle. The AI validator can verify that insight text "makes sense" (though this is subjective). |
| **Research Lab / Investigation sessions** | Partial — test the shell and lifecycle | Yes — useful here | Deterministically test: page loads, input accepts text, investigation starts, follow-up behavior works (COHI-106 already does this). Don't test specific research output content. |
| **PDF/PowerPoint/CSV export** | Yes — primary evidence | No | Assert that clicking export produces a downloaded file with the expected extension and non-zero size. Content validation is deterministic if you control the input data. |
| **Role/permission boundaries** | Yes — primary evidence | No | Assert that tenant_admin can access X, tenant_user is blocked from Y. These are fully deterministic. |
| **Webhook/sync/background job** | API contract tests (Vitest) | No | Test the API shape, status codes, and database state changes. Not a Playwright E2E concern. |

### Testing LLM-backed features in practice

The key insight: **separate the container from the content.**

**Container (deterministic — Tier 1):**
- The chat panel opens when the user clicks the Cohi button
- The input field accepts text and the send button becomes enabled
- After sending, a response container appears in the chat thread
- The response container is not empty (`.textContent().length > 0`)
- No console errors during the interaction
- The panel can be closed and reopened without state corruption

**Content (non-deterministic — Tier 2 or manual):**
- The response is relevant to the prompt
- The insight headline accurately summarizes the data
- The research investigation produces useful findings

Example spec for an LLM-backed feature:

```typescript
test("@critical @COHI-{N} Cohi Chat panel sends a message and receives a response", async ({
  userPage,
}) => {
  await userPage.goto("/workbench", { waitUntil: "domcontentloaded" });

  // Open the Cohi panel — container test
  const cohiButton = userPage.getByRole("button", { name: /cohi/i });
  await expect(cohiButton).toBeVisible({ timeout: 10_000 });
  await cohiButton.click();

  // Chat input renders — container test
  const chatInput = userPage.locator("textarea, input[type='text']")
    .filter({ hasText: /ask|type|message/i })
    .first();
  // Fall back to any visible textarea inside the panel
  const input = (await chatInput.count()) > 0
    ? chatInput
    : userPage.locator("[role='dialog'] textarea, [data-panel] textarea").first();
  await expect(input).toBeVisible({ timeout: 5_000 });

  // Type and send — interaction test
  await input.fill("What is the total funded volume?");
  const sendButton = userPage.getByRole("button", { name: /send|submit/i }).first();
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  // A response appears — container test (NOT content test)
  // We assert the response container exists and has text, but we do NOT
  // assert what the text says because the LLM response is non-deterministic.
  const responseContainer = userPage.locator("[data-chat-response], [class*='message'], [class*='response']").last();
  await expect(responseContainer).toBeVisible({ timeout: 30_000 });
  const responseText = await responseContainer.textContent();
  expect(responseText?.length).toBeGreaterThan(10);
});
```

### When the AI AC validator adds real value

The validator shines on LLM-backed features specifically because it can:
1. Generate a plan that sends a chat message and subjectively evaluates whether the response "contains relevant financial data" (something a deterministic test cannot do).
2. Exercise insight cards and check whether the headline/understory "relate to the chart data" (a judgment call).
3. Run exploratory paths through the Research Lab that would take too long to script manually.

For these features, the recommended approach is:
- **Tier 1:** Write deterministic tests for the container/shell/lifecycle (must pass every run).
- **Tier 2:** Run the AC validator for the content/quality signal (advisory, may vary between runs).
- **Manual QA:** For critical releases, a human reviews the actual LLM output quality.

### Summary rule of thumb

> If the output changes every time you refresh the page with the same inputs, test the **container** deterministically and use the AI validator (or manual QA) for the **content**.

---

## 7. Troubleshooting

### My test passes locally but fails in CI

1. **Auth issue:** CI uses stored Playwright auth state from `e2e/.auth/admin.json`. Make sure your route doesn't require a specific tenant that the CI admin account doesn't have.
2. **Timing:** Add `waitForLoadState("networkidle")` or increase timeouts for async data.
3. **Viewport:** CI runs headless Chromium at 1280x720 (Playwright default with our config). Test responsive layouts if your feature uses breakpoints.

### My Jira ticket doesn't appear in the QA results

1. Check that your commit message contains the Jira key (e.g., `COHI-327`) in uppercase.
2. Check that your commit is within the `QA_COMMIT_RANGE` you specified.
3. Check that your E2E test title includes `@COHI-327`.

### The AC validator failed but my deterministic tests passed

This is expected and fine. The AC validator is Tier 2 (supplementary). The deterministic test pass is your primary evidence. The AC validator failure is informational — it means the LLM-generated plan had issues, not that your feature is broken.

### Confluence pages show "Evidence gap: no tests currently verify this issue"

Your tests aren't tagged with `@COHI-{N}` or the tag format is wrong. The runner extracts tags using the regex `\b[A-Z][A-Z0-9]+-\d+\b` from test titles. Make sure the tag is uppercase and hyphenated: `@COHI-327`, not `@cohi-327` or `@COHI327`.

### Screenshots not appearing on Confluence pages

The QA Agent service account needs "Add Attachments" permission on the SRS Confluence space. This is an admin-level space permission, not a page-level one. Contact the platform admin to grant it.

---

## 8. Quick Reference Card

```
Feature workflow:
  1. Branch from dev: feature/COHI-{N}-description
  2. Write feature code
  3. Write e2e/your-feature.spec.ts with @critical @COHI-{N} tags
  4. Test locally: npx playwright test e2e/your-feature.spec.ts
  5. Push, open PR to dev
  6. After merge: run ai-qa-dev pipeline
     - QA_SUITE=critical
     - QA_ENABLE_AC_VALIDATOR=false
     - QA_COMMIT_RANGE=HEAD~1..HEAD
  7. Verify: Jira comment shows "PASSED", Confluence QA page has tagged test results
  8. Story is Done when Tier 1 tests pass in CI
```
