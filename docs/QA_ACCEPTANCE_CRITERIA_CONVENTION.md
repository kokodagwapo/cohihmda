# QA Acceptance Criteria Convention

This document defines the Jira description format required by the AI AC Validator.

## Workflow

1. An upstream LLM drafts the acceptance criteria.
2. A human reviewer approves the Jira description.
3. The QA pipeline reads the approved Acceptance Criteria block and generates a deterministic validation plan.

The validator is strict on structure and tolerant only to minor formatting drift like whitespace or `1)` vs `1.` numbering.

## Canonical format

Acceptance criteria live in the Jira description under an `Acceptance Criteria` heading.

```md
## Acceptance Criteria

1. [ROUTE] Navigating to /workbench/agents renders a heading "Agents"
2. [API] GET /api/cohi-workbench/agents returns 200 with at least one record
3. [UI] Clicking the "New Agent" button opens a dialog with a name field
4. [ASSERTION] The dialog submit button is disabled until the name field is non-empty
```

## Allowed categories

- `[ROUTE]`
- `[UI]`
- `[API]`
- `[ASSERTION]`
- `[STATE]`
- `[MUTATION]`

## Authoring rules

- One numbered statement per line.
- One verifiable behavior per statement.
- Prefer explicit routes, labels, button names, and API paths.
- If a write is required, state the smallest safe mutation explicitly and prefer QA-scoped resources the agent can delete afterward.
- Do not use markdown tables inside the Acceptance Criteria block.
- Include enough product detail that a human tester could execute the scenario without guessing.

## Minimum viable AC bar

Reviewers should reject the Jira description unless all of these are true:

- The block exists under an `Acceptance Criteria` heading.
- Every line is numbered and uses a valid category tag.
- There is at least one `[ASSERTION]` or `[ROUTE]` statement.
- Routes, labels, and API paths are concrete enough to test.
- Any `[MUTATION]` statement describes a self-scoped action plus the expected post-write verification.
- No markdown tables or free-form essays are embedded in the block.

## Upstream prompt snippet

Use this in the upstream AC-generation workflow:

```text
When you write Jira acceptance criteria, emit a section titled "Acceptance Criteria".
Inside it, produce a numbered list where every line starts with one of:
[ROUTE], [UI], [API], [ASSERTION], [STATE], [MUTATION]

Rules:
- one verifiable statement per line
- no markdown tables
- use exact routes, labels, and API paths where possible
- keep the list short, concrete, and testable
- if a write is required, make it self-scoped and describe how the result should be verified
```

## Tagging contract

Autonomous QA writes are tagged with `qaAgentRunTag` so seeded fixtures, created canvases, uploaded documents, and related artifacts can be correlated and torn down safely after the run.

## Parse-failure behavior

If the validator cannot parse the block:

- the issue is marked `parse_error` in the QA evidence
- the Jira issue receives a comment asking for the block to be normalized
- no fallback interpretation is attempted
