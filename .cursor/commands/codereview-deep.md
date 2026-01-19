# Deep Code Review

## Purpose
Comprehensive review of code changes including security, performance, architecture, and quality.

## Prerequisites
- Git repository with remote configured
- Baseline branch exists
- Time allocated for thorough review (30+ minutes)

## Process

### 1. Fetch and Identify Baseline
```bash
git fetch origin
```
Determine baseline branch (same as quick review).

### 2. Get Comprehensive Diff Information
```bash
# Statistics
git diff --stat <baseline>...HEAD

# Full diff
git diff <baseline>...HEAD

# List of changed files
git diff --name-only <baseline>...HEAD

# List of changed files with status
git diff --name-status <baseline>...HEAD
```

### 3. Review Categories

#### A. Security Review
- [ ] Secrets management (no hardcoded secrets)
- [ ] Authentication (proper auth checks)
- [ ] Authorization (proper permission checks)
- [ ] Input validation (all inputs validated)
- [ ] Injection prevention (SQL, NoSQL, command, XSS)
- [ ] SSRF prevention (URL validation)
- [ ] File upload safety (type, size, path validation)
- [ ] Session/token handling (secure storage, expiration)
- [ ] CORS configuration (not too permissive)
- [ ] Logging safety (no secrets/PII in logs)
- [ ] Dependency security (no known vulnerabilities)
- [ ] Rate limiting (on sensitive endpoints)
- [ ] Multi-tenant isolation (tenant_id filtering)
- [ ] PII protection (encryption, redaction)

#### B. Performance Review
- [ ] N+1 queries (loops making DB calls)
- [ ] Large payloads (unbounded arrays)
- [ ] Blocking operations (synchronous I/O in hot paths)
- [ ] Missing timeouts (external API calls)
- [ ] Inefficient algorithms (nested loops, O(n²) operations)
- [ ] Missing caching (expensive computations)
- [ ] Memory leaks (unclosed connections, listeners)

#### C. Architecture Review
- [ ] Boundary violations (wrong layer dependencies)
- [ ] Circular dependencies
- [ ] Service boundaries (clear separation)
- [ ] Data access patterns (proper abstraction)
- [ ] External service integration (proper abstraction)

#### D. Code Quality Review
- [ ] Error handling (errors handled, not ignored)
- [ ] Logging (appropriate levels, no secrets)
- [ ] Code comments (explain why, not what)
- [ ] Type safety (no `any` types, proper types)
- [ ] Function size (reasonable length)
- [ ] Duplication (acceptable or problematic?)
- [ ] Naming consistency (follows patterns)

#### E. Testing Review
- [ ] Tests added for new code
- [ ] Tests updated for changed code
- [ ] Test quality (test what they claim to test)
- [ ] Coverage (adequate for risk level)

#### F. Documentation Review
- [ ] Code comments (where needed)
- [ ] API documentation (if APIs changed)
- [ ] README updates (if setup changed)
- [ ] Migration notes (if breaking changes)

### 4. Context Expansion (Limited)
Only expand context to:
- Validate correctness of changes
- Assess risk spillover to related files
- Understand dependencies
- Verify security implications

Do NOT expand context to:
- Review unrelated code
- Suggest improvements to unchanged code
- Refactor code outside the diff

### 5. Report Format

```
DEEP CODE REVIEW
================

Baseline: <baseline-branch>
Files Changed: <count>
Lines Added: <count>
Lines Removed: <count>

Changed Files:
<list of files>

SECURITY FINDINGS:
Severity: Critical / High / Medium / Low
Location: <file>:<line>
Issue: <description>
Current Code: <code snippet>
Risk: <what could happen>
Fix: <suggestion>

[Repeat for each finding]

PERFORMANCE FINDINGS:
[Same format as security]

ARCHITECTURE FINDINGS:
[Same format as security]

CODE QUALITY FINDINGS:
[Same format as security]

TESTING FINDINGS:
[Same format as security]

DOCUMENTATION FINDINGS:
[Same format as security]

SUMMARY:
- Critical: <count>
- High: <count>
- Medium: <count>
- Low: <count>

RECOMMENDATIONS:
- [Prioritized list of recommendations]
```

## Rules
- Review ONLY code in the diff
- Evidence-based findings only
- Severity must match actual risk
- Provide concrete fixes, not vague suggestions
- Do NOT review unchanged code


