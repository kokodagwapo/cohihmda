# QA Agent V2 SOC 2 Controls

## Purpose

This document maps the autonomous QA agent design to the main SOC 2 themes the team cares about: controlled execution, evidence integrity, and reviewer accountability.

## Control Summary

- Fail-closed registration: every autonomous QA action starts with an `ai_control_plane.audit_ledger` row before planning or execution.
- Deterministic plan validation: generated plans are schema-validated, step-limited, allowlisted, and classified as `readonly`, `self_scoped`, or `broad_scope`.
- Explicit elevation boundary: broad-scope plans require a signed `QA_AC_ALLOW_BROAD_SCOPE_TOKEN` before they can run.
- QA-scoped mutation tagging: writes carry `qaAgentRunTag` so fixture resources and evidence can be correlated and torn down safely.
- Signed evidence package: screenshots, HARs, DOM snapshots, downloads, and manifest data are hashed and signed with `QA_EVIDENCE_SIGNING_SECRET`.
- Human evidence approval: executed runs move to `pending_evidence_review`; approval or rejection is recorded separately from execution.
- Teardown enforcement: QA fixtures are deleted after execution, with optional hard-fail behavior through `QA_AC_REQUIRE_TEARDOWN_SUCCESS=true`.

## Auditor Notes

- The agent is not trusted to self-approve.
- Mutation authority is narrower than a normal admin user because plan validation and approval gates run before execution.
- Reviewers can trace a run from Jira issue to ledger action to evidence manifest to S3 artifact set.

## Operational Expectations

- Use a dedicated QA tenant or QA-scoped resources for autonomous write flows.
- Keep production autonomous execution disabled unless an explicit approval policy exists.
- Rotate the evidence-signing and webhook secrets through Secrets Manager according to the normal platform secret rotation policy.
