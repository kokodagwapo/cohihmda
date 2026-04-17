# AI AC Validator Runbook

## Purpose

The AI AC Validator adds issue-specific acceptance-criteria evidence to the existing QA pipeline.

It does not drive the browser autonomously in open-ended loops. It:

1. reads approved Acceptance Criteria from Jira
2. redacts the input
3. asks OpenAI for a strict JSON test plan
4. validates the plan against deny-lists and guardrails
5. executes the plan deterministically
6. writes evidence back into the QA reporting flow

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
- `QA_AC_URL_ALLOWLIST`

## Read-only safety model

v1 permits only:

- `goto`
- `api` with `GET` or `HEAD`
- `click`
- `fill`
- `assert`

Rejected plans never execute.

## Audit trail

Each issue validation records:

- model name and fallback use
- token counts
- prompt hash
- plan hash
- execution result hash
- per-statement pass/fail status
- approval status (`auto_read_only` in v1)

## Debugging rejected or failed runs

1. Check the Confluence QA page for the issue.
2. Check Jira comments for parse errors or evidence-gap notes.
3. Inspect the audit ledger row for the issue validation metadata.
4. Re-run with `QA_ENABLE_AC_VALIDATOR=true` against the same issue after fixing the Jira AC block.

## Replay guidance

The validator stores hashes for the redacted prompt, plan, and result payloads so the run can be correlated later even when the LLM response is not kept verbatim.

## SOC 2 posture

This is the Tier 1 + Tier 2 version:

- fail-closed orchestrator
- HMAC-protected runner ingestion
- redacted AI inputs
- pinned model with fallback
- deny-listed plan validation
- immutable audit rows

Formal control mapping and longer-term retention policy stay in the deferred SOC 2 backlog.

## Rollout

1. Merge with `QA_ENABLE_AC_VALIDATOR=false`.
2. Confirm regression-only QA pages still land on the correct Jira issues.
3. Flip `QA_ENABLE_AC_VALIDATOR=true` in dev only.
4. Review the first issue-level AC validation by hand in Jira, Confluence, and the audit ledger.
5. Keep prod disabled until the deferred program controls are pulled in.
