# Architecture Code Review

## Purpose
Review code changes for architecture boundary violations, dependency issues, and structural problems.

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

### 3. Get Architecture-Relevant Diff
```bash
git diff <baseline>...HEAD
```

### 4. Architecture Review Checklist

Review the diff for:

#### Boundary Violations
- [ ] Imports that cross boundaries in wrong direction
- [ ] Business logic in presentation layer
- [ ] Direct database access outside infrastructure layer
- [ ] Presentation code in application layer

#### Dependency Issues
- [ ] Circular dependencies
- [ ] Infrastructure depending on application/presentation
- [ ] Application depending on presentation
- [ ] Missing abstractions (direct dependencies)

#### Service Boundaries
- [ ] Services directly accessing other services' data
- [ ] Missing service interfaces
- [ ] Tight coupling between services
- [ ] Shared state between services

#### Data Access Patterns
- [ ] Direct SQL/ORM in presentation layer
- [ ] Missing repository/data access layer
- [ ] Business logic in data access layer
- [ ] Data access not abstracted

#### External Service Integration
- [ ] Direct service clients in application layer
- [ ] Missing service abstractions
- [ ] Hardcoded service URLs/credentials
- [ ] Missing error handling for external services

#### Code Organization
- [ ] Files in wrong directories
- [ ] Inconsistent naming patterns
- [ ] Missing module boundaries
- [ ] Unclear responsibilities

### 5. Findings Format

For each architecture finding:

```
ARCHITECTURE FINDING #<number>
Severity: High / Medium / Low
Category: <category from checklist>
Location: <file>:<line-range>

Diff:
<relevant diff lines>

Issue:
<clear description>

Architecture Violation:
<what boundary or pattern is violated>

Impact:
<why this is a problem>

Fix:
<suggestion for architectural improvement>

Migration:
<how to fix without breaking changes>
```

### 6. Report Format

```
ARCHITECTURE CODE REVIEW
========================

Baseline: <baseline-branch>
Review Date: <date>

Files Changed: <count>
Lines Added: <count>
Lines Removed: <count>

OBSERVED STRUCTURE:
- Layers: [what layers are observed in changed files]
- Dependencies: [what dependencies are observed]

ARCHITECTURE FINDINGS:
[Use findings format above]

SEVERITY SUMMARY:
- High: <count> (architectural violation)
- Medium: <count> (architectural concern)
- Low: <count> (minor improvement)

UNCERTAINTY:
[List any uncertainties about architecture]

RECOMMENDATIONS:
1. [Prioritized recommendation]
2. [Prioritized recommendation]

NOTE:
Architecture review is based on observed patterns in the diff.
Full architecture review may require examining the entire codebase.
```

## Rules
- Review ONLY code in the diff
- Base findings on observed patterns, not assumptions
- Identify boundaries from existing code, don't invent them
- Flag violations only if they're in the diff
- Do NOT review unchanged code


