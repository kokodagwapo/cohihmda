# Cohi — Code Quality, QA, and Dependency Status

> Supplemental exhibit for technical due diligence response package
> Prepared: April 20, 2026

---

## 1. Purpose

This appendix consolidates the repository-backed evidence for:

- test coverage metrics
- static analysis status
- QA process maturity
- dependency freshness
- technical debt relevant to diligence

---

## 2. Current Testing and QA Model

The current QA model follows a **two-tier strategy** defined in `docs/TESTING_STRATEGY.md`, with operational details in `docs/QA_RUNBOOK.md` and CI configuration in `bitbucket-pipelines.yml`.

### Test Layers

| Layer | Current Tooling | SOC 2 Role | Evidence |
|------|------------------|------------|----------|
| Frontend unit | Vitest + React Testing Library | Supporting | `package.json`, `docs/due-diligence/02-SDLC-METHODOLOGY.md` |
| Backend unit | Vitest | Supporting | `server/package.json`, `server/vitest.config.ts` |
| Backend integration | Vitest + Supertest + Postgres service container | Supporting | `bitbucket-pipelines.yml` |
| **E2E (Tier 1 — primary evidence)** | **Playwright (`@smoke`, `@critical`, `@regression`, `@COHI-{N}`)** | **Primary** | **`e2e/*.spec.ts`, `docs/TESTING_STRATEGY.md`, `bitbucket-pipelines.yml`** |
| AI-assisted QA (Tier 2 — supplementary) | Hybrid `ai-qa-dev` custom pipeline with human evidence review | Supplementary | `bitbucket-pipelines.yml`, `docs/AI_AC_VALIDATOR_RUNBOOK.md`, `server/scripts/qa/aiQaRunner.ts` |

### Two-Tier QA Strategy

Cohi's testing strategy explicitly separates **deterministic tests** (Tier 1) from **AI-assisted exploratory validation** (Tier 2):

- **Tier 1 (Deterministic Playwright Tests):** Committed, reviewed, repeatable E2E specs tagged with Jira ticket keys. These run identically every time and produce consistent evidence. Every shipped feature requires at least one `@critical @COHI-{N}` tagged test. This is the primary SOC 2 evidence layer.

- **Tier 2 (AI AC Validator):** An LLM reads Jira acceptance criteria and generates a Playwright-like plan at runtime. Useful for exploratory coverage and draft test generation, but non-deterministic — the plan changes between runs. Evidence from Tier 2 is supplementary and advisory, not the gate for shipping.

The full rationale, conventions, and SOC 2 evidence flow are documented in `docs/TESTING_STRATEGY.md`.

### QA Execution Model

| Lane | Current Use | Tier |
|------|-------------|------|
| PR validation | build + unit/integration tests + Playwright smoke | Tier 1 |
| Dev deploy gate | Playwright critical suite (includes `@COHI-{N}` tagged tests) | Tier 1 |
| Nightly / deeper coverage | regression suite | Tier 1 |
| Hybrid AI QA | exploratory issue validation with approval workflow | Tier 2 |

---

## 3. Coverage Status

### Backend Coverage

Local evidence captured on April 20, 2026 and summarized in `docs/due-diligence/22-ENGINEERING-EVIDENCE-REGISTER.md`:

| Metric | Result |
|--------|--------|
| Test files passed | `40` |
| Tests passed | `606` |
| Function coverage | `75%` |
| Branch coverage | `67.62%` |
| Statement coverage | `1.52%` |
| Line coverage | `1.52%` |

### Interpretation

Backend tests are active and broad enough to produce meaningful branch/function numbers, but the configured coverage include paths and route-heavy code layout mean line and statement coverage are still low in aggregate.

### Frontend Coverage

The root coverage command currently fails because the frontend toolchain is missing `@vitest/coverage-v8`.

| Area | Current Status |
|------|----------------|
| Frontend coverage command | Not currently runnable without the missing plugin |
| Frontend coverage artifact | Not attached |
| Diligence position | Coverage exists as a process expectation, but frontend reporting is still a tooling gap |

---

## 4. Static Analysis and Security Scanning

### Static Analysis

| Control | Current State |
|--------|---------------|
| ESLint config | Present in `eslint.config.js` |
| Full local lint | Available, but produces a large existing backlog |
| CI lint gate | `lint:test-tags` only, not full repo ESLint |

As captured in `docs/due-diligence/22-ENGINEERING-EVIDENCE-REGISTER.md`, a local full lint run produced:

- `4,055` total problems
- `3,800` errors
- `255` warnings

This should be read as a technical debt signal, not as evidence that linting is absent.

### Security Scanning

`docs/due-diligence/13-SECURITY-SCANNING.md` remains the authoritative scan summary:

| Scan Type | Current State |
|----------|---------------|
| ECR image scan | Active |
| `npm audit` | Manual / available locally |
| SAST | Gap |
| DAST | Gap |
| Pen test | Planned, not yet completed |
| Secret scanning | Planned |

---

## 5. AI QA Control Plane Evidence

The AI QA controls serve as a **supplementary (Tier 2) evidence layer** alongside the primary deterministic Playwright tests (Tier 1). See `docs/TESTING_STRATEGY.md` for the full two-tier rationale.

### Repo-Backed Control Signals

| Control | Evidence |
|--------|----------|
| Two-tier testing strategy documented | `docs/TESTING_STRATEGY.md` |
| Deterministic E2E tests tagged per Jira ticket | `e2e/*.spec.ts` with `@COHI-{N}` tags |
| Hybrid QA pipeline exists | `bitbucket-pipelines.yml` custom pipeline `ai-qa-dev` |
| Human evidence review gate | `docs/AI_AC_VALIDATOR_RUNBOOK.md`, `server/scripts/qa/ai/acValidator.ts` |
| Pending evidence review workflow | `server/scripts/qa/aiQaRunner.ts`, `server/scripts/qa/poll-jira-approvals.ts` |
| Signed evidence package design | `server/scripts/qa/ai/evidencePackager.ts` and related tests |
| Approval boundary for broad-scope actions | Pipeline variable `QA_AC_ALLOW_BROAD_SCOPE_TOKEN` |
| QA artifact retention path | S3 bucket, `test-results/ac-validator/...` conventions |

### Diligence Position

The primary SOC 2 evidence for any shipped feature is the deterministic Tier 1 Playwright test suite — committed, reviewed, and producing identical results on every CI run. The AI AC validator adds supplementary exploratory coverage and is useful for discovering untested paths, but its non-deterministic nature means it should not be presented as the sole evidence for any control.

Reviewers asking for proof of a specific feature's testing should be directed to:
1. The `@COHI-{N}` tagged E2E test in `e2e/*.spec.ts` and its CI run results.
2. The Confluence QA page for that Jira ticket (automatically generated by the QA runner).
3. The S3-hosted Playwright HTML report for the build.

---

## 6. Dependency Freshness Snapshot

The package already includes an OSS and vulnerability view in `docs/due-diligence/06-OPEN-SOURCE-DEPENDENCIES.md`. This appendix adds the freshness view from `npm outdated`.

### Snapshot Summary

| Area | Outdated Packages | Major-Version Gaps |
|------|-------------------|--------------------|
| Frontend | `85` | `27` |
| Backend | `27` | `9` |

### Main Interpretation

- the repo is active and dependency management is ongoing
- there is a meaningful backlog of upgrades, especially on the frontend
- dependency update automation is not currently documented in-repo

### Freshness Risk Themes

| Theme | Current Signal |
|------|----------------|
| Patch/minor lag | Common across linting, AWS SDK, UI libraries, and test tooling |
| Major upgrade backlog | Present in selected React ecosystem, Stripe, Express, Zod, and related libraries |
| Automation gap | No Renovate or Dependabot config is documented in the repo |

---

## 7. Technical Debt Summary for Diligence

| Debt Item | Current Impact | Source |
|-----------|----------------|--------|
| Frontend coverage tooling gap | Limits completeness of test coverage reporting | `docs/due-diligence/22-ENGINEERING-EVIDENCE-REGISTER.md` |
| Full lint not CI-gated | Makes static analysis posture look weaker than process docs imply | `bitbucket-pipelines.yml`, `docs/due-diligence/22-ENGINEERING-EVIDENCE-REGISTER.md` |
| Security scanning maturity gap | SAST/DAST/pen test evidence still incomplete | `docs/due-diligence/13-SECURITY-SCANNING.md` |
| Dependency freshness handled manually | Upgrade cadence is visible, but automation is not | `docs/due-diligence/06-OPEN-SOURCE-DEPENDENCIES.md`, `docs/due-diligence/22-ENGINEERING-EVIDENCE-REGISTER.md` |
| AI QA build evidence not attached in package | Control design is strong, but external reviewers may still ask for a concrete run artifact | `bitbucket-pipelines.yml`, QA control docs |

---

## 8. Reviewer Notes

- The repo shows real testing discipline and a credible QA operating model
- The biggest remaining gap is packaging current outputs and gating more of them in CI
- The package should present this appendix together with `docs/due-diligence/13-SECURITY-SCANNING.md` and `docs/due-diligence/22-ENGINEERING-EVIDENCE-REGISTER.md`
