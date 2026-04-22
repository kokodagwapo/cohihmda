# Cohi — Testing Strategy

> Last updated: April 2026
> Related: `docs/QA_RUNBOOK.md`, `docs/AI_AC_VALIDATOR_RUNBOOK.md`, `docs/due-diligence/27-CODE-QUALITY-QA-AND-DEPENDENCY-STATUS.md`

---

## 1. Principles

1. **Deterministic tests are the primary evidence.** Every shipped feature must have committed, reviewed, repeatable Playwright E2E tests that produce the same result on every run. These tests are the SOC 2 control artifact.
2. **AI-assisted validation is supplementary, not a gate.** The LLM-based AC validator generates exploratory plans from Jira acceptance criteria. It is useful for coverage discovery and first-pass smoke checks on new features, but it is non-deterministic and must not be the sole evidence for any shipped feature.
3. **Traceability is mandatory.** Every E2E test is tagged with its Jira ticket key (`@COHI-{N}`). The QA pipeline automatically links test results, screenshots, and artifacts back to the Jira issue and its Confluence QA page.
4. **Tests use stable selectors.** Tests must use `data-testid`, `role`, `id`, `h1`/`h2` elements, or well-known class patterns (e.g., `.recharts-wrapper`). Bare `getByText()` on strings that appear in multiple DOM locations is fragile and should be avoided.
5. **Evidence must be reproducible.** An auditor or reviewer should be able to re-run any test suite against the deployed dev environment and get the same pass/fail result, independent of LLM model behavior, prompt drift, or AC text formatting.

---

## 2. Two-Tier QA Model

### Tier 1: Deterministic Playwright Tests (Primary Evidence)

| Property | Value |
|----------|-------|
| Location | `e2e/*.spec.ts` |
| Framework | Playwright (Chromium) |
| Tag convention | `@smoke`, `@critical`, `@regression`, `@COHI-{N}` |
| Execution | Every PR (smoke), every dev deploy (critical), nightly (regression) |
| Evidence output | JUnit XML, screenshots, traces, Playwright HTML report |
| SOC 2 role | **Primary control evidence** — same test, same result, traceable to Jira |

**When to write a Tier 1 test:**
- Every feature story (`@COHI-{N}`) must have at least one `@critical` tagged E2E test before the story is marked Done.
- Every bug fix must have a regression test that reproduces the original failure and confirms the fix.
- High-risk business workflows (auth, data mutations, role boundaries) must have dedicated `@critical` tests.

**What makes a good Tier 1 test:**
- Navigates to a known route using `userPage.goto()`.
- Asserts on stable DOM anchors (`h1`, `#CohiInsights`, `[role='dialog']`, `.recharts-wrapper`).
- Tests a single user flow end-to-end (select → focus → verify → clear → verify).
- Captures a screenshot on completion (Playwright does this automatically for failures).
- Runs in under 30 seconds on CI.

### Tier 2: AI AC Validator (Exploratory Supplement)

| Property | Value |
|----------|-------|
| Location | `server/scripts/qa/ai/` |
| Trigger | `ai-qa-dev` custom pipeline, manual or scheduled |
| Input | Jira issue AC block (numbered `[CATEGORY]` statements) |
| Execution | LLM generates a Playwright-like plan; `planExecutor.ts` runs it headlessly |
| Evidence output | Per-step pass/fail, screenshots, signed evidence manifest |
| SOC 2 role | **Supplementary coverage signal** — advisory, not the gate |

**When the AC validator adds value:**
- Early-stage features with no E2E test yet — quickly checks if the page renders and basic interactions work.
- Generating a draft test plan that a developer can review and harden into a Tier 1 spec.
- Catching obvious regressions across many pages in a single run without writing per-page tests.

**When the AC validator should not be relied upon:**
- As the sole evidence for a shipped feature. The plan changes every run.
- For complex multi-step interactions (drag-select, modal state, KPI math). The LLM picks fragile selectors.
- When the AC text is ambiguous or uses "OR" conditions — the LLM will pick the wrong branch.

---

## 3. Evidence Flow for SOC 2

```
Feature Branch → PR with @COHI-{N} tagged E2E tests
       ↓
  Merge to dev → CI runs critical suite
       ↓
  QA Pipeline → Playwright results + screenshots uploaded to S3
       ↓
  QA Runner → Links results to Jira issue, creates/updates Confluence QA page
       ↓
  (Optional) AC Validator → Exploratory LLM evidence added to same Confluence page
       ↓
  Human Review → Approve or reject evidence in Jira workflow
       ↓
  Release Branch → Merge to main, production deploy
```

### What an auditor sees per feature:

1. **Jira ticket** — story, acceptance criteria, status transitions.
2. **Confluence QA page** — build number, suite run results, per-test pass/fail, screenshots, related commits.
3. **S3 artifacts** — Playwright HTML report, trace files, evidence manifests.
4. **Bitbucket PR** — code diff, E2E test diff, CI green status.
5. **Audit ledger** — recorded in the application database via `aiAgentOrchestrator.startAction`, linking each QA run to its issue, build, and evidence hashes.

### SOC 2 control mapping:

| SOC 2 Criterion | Control | Evidence |
|-----------------|---------|----------|
| CC8.1 (Change Management) | All changes require PR + CI validation | Bitbucket PR history, pipeline run status |
| CC7.1 (System Operations) | Automated testing runs on every deploy | `bitbucket-pipelines.yml`, Playwright results |
| CC7.2 (Monitoring) | QA pipeline links evidence to Jira issues | Confluence QA pages, Jira comments |
| CC5.1 (Control Activities) | Deterministic tests with stable selectors | `e2e/*.spec.ts` committed in repo |
| CC4.1 (Monitoring Activities) | Nightly regression suite, issue-tagged evidence | Pipeline schedule, `@regression` suite |

---

## 4. Test Tagging Convention

Every E2E test title must include at least one tag:

| Tag | Meaning | Execution Lane |
|-----|---------|---------------|
| `@smoke` | Fast confidence check (< 5s) | Every PR |
| `@critical` | Core business flow or auth/role boundary | Every dev deploy |
| `@regression` | Broader route/behavior validation | Nightly |
| `@COHI-{N}` | Links test to a specific Jira ticket | QA pipeline evidence linking |

A test can have multiple tags: `@critical @COHI-327 focus dashboard scopes to selected loan officers`.

The QA runner discovers `@COHI-{N}` tags via the `resultParser.ts` regex and links results to the corresponding Jira issue and Confluence QA page automatically.

---

## 5. Feature QA Checklist

Before marking a story as Done:

- [ ] At least one `@critical @COHI-{N}` E2E test exists in `e2e/*.spec.ts`.
- [ ] Test uses stable selectors (not bare `getByText` on ambiguous strings).
- [ ] Test passes locally (`npm run test:e2e:critical`).
- [ ] Test passes in CI on the dev deploy pipeline.
- [ ] Confluence QA page for the ticket shows tagged test results with screenshots.
- [ ] (Optional) AC validator ran and produced supplementary evidence.

---

## 6. When to Invest in the AC Validator vs Deterministic Tests

| Scenario | Recommendation |
|----------|---------------|
| New feature, no tests yet | Run AC validator for quick smoke signal; write Tier 1 tests before merging |
| Feature shipped, needs SOC 2 evidence | Write Tier 1 tests — AC validator output alone is not sufficient |
| Broad regression check across 20+ routes | AC validator adds value (cheap breadth); complement with `@regression` route-render tests |
| Complex interaction (drag, modal, multi-step state) | Write Tier 1 tests — LLM-generated plans are too fragile for these |
| Simple "page renders" check | Either works; Tier 1 is trivial to write and more reliable |
| Auditor asks for evidence of a specific feature | Point to the Tier 1 test, its CI run, and the Confluence QA page |
