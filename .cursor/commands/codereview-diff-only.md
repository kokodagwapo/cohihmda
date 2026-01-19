# Diff-Only Code Review

## Purpose
Strict diff-based review with zero context expansion. Reviews ONLY what changed.

## Prerequisites
- Git repository with remote configured
- Baseline branch exists

## Process

### 1. Fetch Baseline
```bash
git fetch origin
```

### 2. Identify Baseline Branch
- Check for `origin/main`
- If not found, check for `origin/master`
- If not found, check for `origin/trunk`
- If not found, use `origin/HEAD`

### 3. Get Diff
```bash
git diff <baseline>...HEAD
```

### 4. Review Rules (STRICT)

#### What to Review
- **ONLY** lines that appear in the diff (marked with `+` or `-`)
- **ONLY** files that appear in the diff
- **ONLY** code that was added, removed, or modified

#### What NOT to Review
- **NO** context expansion
- **NO** review of unchanged code
- **NO** review of files not in the diff
- **NO** assumptions about related code
- **NO** suggestions for code outside the diff

### 5. Review Checklist

For each change in the diff:

- [ ] **Added Code** (`+` lines):
  - Security issues?
  - Performance issues?
  - Quality issues?
  - Missing tests?

- [ ] **Removed Code** (`-` lines):
  - Breaking changes?
  - Missing cleanup?
  - Orphaned code left behind?

- [ ] **Modified Code** (both `+` and `-`):
  - Behavior changes?
  - Breaking changes?
  - Security regressions?
  - Performance regressions?

### 6. Findings Format

For each finding:

```
Finding #<number>
Type: Security / Performance / Quality / Breaking
Severity: Critical / High / Medium / Low
Location: <file>:<line-range>
Change: Added / Removed / Modified

Diff Context:
<show relevant diff lines>

Issue:
<description of the issue>

Risk:
<what could go wrong>

Fix:
<minimal fix suggestion>
```

### 7. Report Format

```
DIFF-ONLY CODE REVIEW
=====================

Baseline: <baseline-branch>
Review Scope: ONLY lines in diff

Files Changed:
<list>

Changes Summary:
- Added: <count> lines
- Removed: <count> lines
- Modified: <count> lines

FINDINGS:
[Use findings format above]

UNCERTAINTY:
[List any uncertainties - things that cannot be determined from diff alone]

NO CONTEXT EXPANSION:
This review did not examine:
- Unchanged code
- Related files not in diff
- System architecture
- External dependencies
```

## Rules (MANDATORY)
- **ZERO** context expansion
- **ONLY** review diff lines
- **NO** assumptions about related code
- **NO** suggestions for code outside diff
- If information is missing, state uncertainty


