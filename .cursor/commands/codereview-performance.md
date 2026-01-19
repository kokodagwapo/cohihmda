# Performance Code Review

## Purpose
Focused performance review of code changes. Identifies performance risks and bottlenecks.

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

### 3. Get Performance-Relevant Diff
```bash
git diff <baseline>...HEAD
```

### 4. Performance Review Checklist

Review the diff for:

#### N+1 Query Patterns
- [ ] Loops making database queries
- [ ] Loops making API calls
- [ ] Missing eager loading
- [ ] Missing batching

#### Large Payloads
- [ ] Unbounded arrays in responses
- [ ] Large objects in memory
- [ ] Missing pagination
- [ ] Missing streaming

#### Blocking Operations
- [ ] Synchronous I/O in request handlers
- [ ] Synchronous file operations
- [ ] Blocking database calls
- [ ] CPU-intensive operations in hot paths

#### Missing Timeouts
- [ ] External API calls without timeouts
- [ ] Database queries without timeouts
- [ ] File operations without timeouts

#### Inefficient Algorithms
- [ ] Nested loops (O(n²) or worse)
- [ ] Inefficient data structures
- [ ] Unnecessary iterations
- [ ] Redundant computations

#### Missing Caching
- [ ] Expensive computations not cached
- [ ] External API calls not cached
- [ ] Database queries not cached
- [ ] Repeated calculations

#### Memory Issues
- [ ] Unclosed connections
- [ ] Unremoved event listeners
- [ ] Memory leaks
- [ ] Large objects kept in memory

#### Render Performance (Frontend)
- [ ] Large component trees
- [ ] Unnecessary re-renders
- [ ] Heavy computations in render
- [ ] Missing memoization

#### Database Performance
- [ ] Missing indexes (if schema changed)
- [ ] Inefficient queries
- [ ] Missing query optimization
- [ ] Full table scans

### 5. Findings Format

For each performance finding:

```
PERFORMANCE FINDING #<number>
Severity: High / Medium / Low
Category: <category from checklist>
Location: <file>:<line-range>

Diff:
<relevant diff lines>

Issue:
<clear description>

Performance Impact:
<what performance problem this could cause>

Evidence:
<why this is a performance risk>

Fix:
<suggestion for optimization>

Measurement:
<how to measure if fix improves performance>
```

### 6. Report Format

```
PERFORMANCE CODE REVIEW
=======================

Baseline: <baseline-branch>
Review Date: <date>

Files Changed: <count>
Lines Added: <count>
Lines Removed: <count>

PERFORMANCE FINDINGS:
[Use findings format above]

SEVERITY SUMMARY:
- High: <count> (likely performance problem)
- Medium: <count> (possible performance problem)
- Low: <count> (minor optimization opportunity)

RECOMMENDATIONS:
1. [Prioritized recommendation]
2. [Prioritized recommendation]

NOTE:
Performance concerns are based on code patterns in the diff.
Actual performance should be measured with profiling tools.
```

## Rules
- Review ONLY code in the diff
- Base findings on code patterns, not speculation
- Only flag performance risks that are present in the diff
- Do NOT optimize code that isn't a bottleneck
- Do NOT review unchanged code


