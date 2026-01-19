# Release Risk Assessment

## Purpose
Assess the risk of releasing code changes to production. Identifies breaking changes, migration needs, and rollback complexity.

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

### 3. Get Release-Relevant Diff
```bash
git diff <baseline>...HEAD
```

### 4. Risk Assessment Checklist

Review the diff for:

#### Breaking Changes
- [ ] API contract changes (request/response format)
- [ ] Database schema changes (migrations needed)
- [ ] Configuration changes (env vars, config files)
- [ ] Dependency changes (new/removed dependencies)
- [ ] Behavior changes (different output for same input)

#### Migration Requirements
- [ ] Database migrations needed
- [ ] Data migration needed
- [ ] Configuration updates needed
- [ ] Deployment steps required
- [ ] Rollback migrations available

#### Rollback Complexity
- [ ] Easy rollback (revert commit)
- [ ] Medium rollback (revert + data migration)
- [ ] Hard rollback (revert + complex migration)
- [ ] Impossible rollback (data already modified)

#### Deployment Risk
- [ ] High risk (critical path, many users affected)
- [ ] Medium risk (some users affected)
- [ ] Low risk (isolated feature, few users)

#### Testing Coverage
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] E2E tests added/updated
- [ ] Manual testing completed
- [ ] Staging environment tested

#### Monitoring & Observability
- [ ] Logging added for new features
- [ ] Metrics added for monitoring
- [ ] Error tracking configured
- [ ] Alerts configured (if needed)

### 5. Risk Findings Format

For each risk finding:

```
RISK FINDING #<number>
Severity: Critical / High / Medium / Low
Category: Breaking Change / Migration / Rollback / Deployment / Testing
Location: <file>:<line-range>

Diff:
<relevant diff lines>

Issue:
<clear description>

Risk:
<what could go wrong in production>

Impact:
<who/what would be affected>

Mitigation:
<how to reduce risk>

Rollback Plan:
<how to rollback if issues occur>
```

### 6. Report Format

```
RELEASE RISK ASSESSMENT
=======================

Baseline: <baseline-branch>
Review Date: <date>
Target Release: <version/branch>

Files Changed: <count>
Lines Added: <count>
Lines Removed: <count>

RISK SUMMARY:
- Critical: <count> (block release)
- High: <count> (fix before release)
- Medium: <count> (monitor after release)
- Low: <count> (acceptable risk)

BREAKING CHANGES:
[List any breaking changes]

MIGRATION REQUIREMENTS:
[List any migrations needed]

ROLLBACK COMPLEXITY:
- Easy: [changes that are easy to rollback]
- Medium: [changes that require some effort to rollback]
- Hard: [changes that are difficult to rollback]

DEPLOYMENT RISK:
- Overall Risk: Critical / High / Medium / Low
- Affected Users: <estimate>
- Affected Features: <list>

TESTING STATUS:
- Unit Tests: Pass / Fail / Missing
- Integration Tests: Pass / Fail / Missing
- E2E Tests: Pass / Fail / Missing
- Manual Testing: Complete / Incomplete

MONITORING:
- Logging: Added / Missing
- Metrics: Added / Missing
- Alerts: Configured / Missing

RISK FINDINGS:
[Use risk findings format above]

RECOMMENDATIONS:
1. [Prioritized recommendation]
2. [Prioritized recommendation]

RELEASE DECISION:
- [ ] Safe to release
- [ ] Fix issues before release
- [ ] Requires additional testing
- [ ] Requires migration plan
- [ ] Requires rollback plan
```

## Rules
- Review ONLY code in the diff
- Base risk assessment on actual changes, not speculation
- Identify risks that are present in the diff
- Provide concrete mitigation and rollback plans
- Do NOT review unchanged code


