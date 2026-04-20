# AI AC Validator Runbook

## Purpose

The AI AC Validator adds issue-specific acceptance-criteria evidence to the existing QA pipeline.

It now supports deterministic autonomous execution, including safe self-scoped writes, while preserving a human evidence-approval checkpoint. It:

1. reads approved Acceptance Criteria from Jira
2. redacts the input
3. asks OpenAI for a strict JSON test plan
4. validates the plan against deny-lists and guardrails
5. seeds a disposable QA fixture set for the target issue
6. executes the plan deterministically
7. packages signed evidence artifacts
8. moves the Jira issue into Evidence Review for human approval
9. tears down the QA-scoped resources it created

## Enablement

The validator is gated by:

```bash
QA_ENABLE_AC_VALIDATOR=true
```

Default is `false`.

## Required environment

- `OPENAI_API_KEY`
- `QA_AC_OPENAI_MODEL` default `gpt-5.4`
- `QA_AC_OPENAI_FALLBACK_MODEL` default `gpt-5.3`
- `QA_AC_MAX_TOKENS_PER_RUN`
- `QA_AC_MAX_STEPS_PER_ISSUE`
- `QA_AC_MAX_ISSUES_PER_RUN`
- `QA_AC_MAX_WRITES_PER_ISSUE`
- `QA_AC_MAX_WRITES_PER_RUN`
- `QA_AC_MAX_DURATION_SEC_PER_ISSUE`
- `QA_AC_REQUIRE_TEARDOWN_SUCCESS`
- `QA_AC_URL_ALLOWLIST`
- `QA_EVIDENCE_SIGNING_SECRET`
- `JIRA_WEBHOOK_SECRET`
- `QA_LEDGER_BACKEND_URL` — required when the validator runs outside the
  backend process (e.g. Bitbucket pipelines). Points at the deployed
  backend (`https://cohi-dev.coheus1.com`) so that fail-closed audit-ledger
  writes go through `/api/internal/ai-ledger` instead of a direct pg
  connection. `run-ai-qa.sh` defaults this to `E2E_BASE_URL` automatically.
  Uses the same `QA_RUNNER_API_KEY` / `QA_RUNNER_HMAC_SECRET` pair as
  `/api/internal/qa-run`.
- `QA_AC_SKIP_ISSUES` — comma-separated Jira keys to skip (e.g.
  `COHI-106,COHI-14,COHI-13`). Use this for infrastructure/meta tickets
  whose acceptance criteria describe architecture rather than user-visible
  behavior an agent could exercise. Skipped issues produce an
  `inconclusive` result with `approvalStatus=skipped_opt_out` instead of a
  noisy `parse_error`.
- `E2E_PLATFORM_ADMIN_EMAIL`, `E2E_PLATFORM_ADMIN_PASSWORD`,
  `E2E_PLATFORM_ADMIN_TOTP_SECRET` — credentials for a dedicated
  `platform_admin` (or `super_admin`) account in `coheus_users`. Required for
  any AC that calls platform-scoped admin routes (see
  `PLATFORM_ADMIN_API_PATH_PREFIXES` in `planExecutor.ts`, e.g.
  `/api/admin/global-knowledge/*`, `/api/admin/platform-settings/*`,
  `/api/admin/ai-prompts/*`, etc.). The Playwright global-setup signs this
  account in with no tenant context and writes the storage state to
  `e2e/.auth/platform-admin.json`; `planExecutor` then transparently switches
  to this token for `api` steps whose `path` matches the platform prefix
  list.
  - **Use a different email than `E2E_ADMIN_EMAIL`.** Both tables enforce
    email uniqueness independently, but re-using the same email across
    `coheus_users` and the tenant `users` table produces ambiguous login
    behavior (platform admin wins when no `tenantSlug` is sent, tenant admin
    wins otherwise), which will silently break `role-access.spec.ts`
    coverage.
  - Suggested email: `qa-platform-admin@coheus.test` (or
    `qa-platform-admin@teraverde.local`) with role `platform_admin` and MFA
    enrolled.
  - If these envs are not set, the Playwright setup skips the platform-admin
    login and `planExecutor` falls back to the tenant-admin token. ACs that
    require platform-admin will 403, which surfaces as an AC failure but
    does not crash the pipeline.
- `QA_AC_PLATFORM_ADMIN_STORAGE_PATH` — optional override for the
  platform-admin storage state path. Defaults to
  `e2e/.auth/platform-admin.json`.

## Execution safety model

The validator supports:

- `goto`
- `api` with `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`
- `click`
- `fill`
- `assert`
- `waitFor`
- `upload`
- `select`
- `press`
- `expectDownload`

Plans are classified into:

- `readonly`
- `self_scoped`
- `broad_scope`

Broad-scope plans require a valid `QA_AC_ALLOW_BROAD_SCOPE_TOKEN` before execution. Executed plans move to `pending_evidence_review` until a human reviewer approves or rejects the evidence.

## Audit trail

Each issue validation records:

- model name and fallback use
- token counts
- prompt hash
- plan hash
- execution result hash
- per-statement pass/fail status
- evidence manifest hash + signature
- writes performed
- elevated steps
- approval status (`auto_self_scoped`, `human_pre_approved`, `pending_pre_approval`, `pending_evidence_review`)

## Debugging rejected or failed runs

1. Check the Confluence QA page for the issue.
2. Check Jira comments for parse errors or evidence-gap notes.
3. Inspect the audit ledger row for the issue validation metadata.
4. Re-run with `QA_ENABLE_AC_VALIDATOR=true` against the same issue after fixing the Jira AC block.
5. If the run reached `pending_evidence_review`, inspect the evidence manifest and either approve or reject it in Jira.

## Replay guidance

The validator stores hashes for the redacted prompt, plan, and result payloads so the run can be correlated later even when the LLM response is not kept verbatim.

## SOC 2 posture

Current controls include:

- fail-closed orchestrator
- HMAC-protected runner ingestion
- redacted AI inputs
- pinned model with fallback
- deny-listed plan validation
- immutable audit rows
- signed evidence manifests
- webhook/poller-based approval state sync
- teardown enforcement for QA-scoped fixtures

See `docs/QA_AGENT_V2_SOC2_CONTROLS.md` for the control mapping summary.

## Rollout

1. Merge with `QA_ENABLE_AC_VALIDATOR=false`.
2. Confirm regression-only QA pages still land on the correct Jira issues.
3. Run `QA_ENABLE_AC_VALIDATOR=true` with `QA_AC_DRY_RUN=true` in dev.
4. Enable real execution for a small issue set and review the evidence package by hand.
5. Keep production autonomous execution disabled unless a separate approval policy is in place.
