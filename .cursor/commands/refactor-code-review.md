# Refactor Based on Code Review Report

## Purpose
Systematically refactor codebase based on findings from CODE_REVIEW_REPORT.md. Follows incremental, safe refactoring principles with characterization tests and rollback plans.

## Prerequisites
- CODE_REVIEW_REPORT.md has been reviewed
- User has prioritized which issues to address
- Git repository is in clean state (or changes are committed)
- Baseline branch exists for comparison

## Process

### 1. Review and Prioritize

#### Step 1.1: Identify Target Issues
Review CODE_REVIEW_REPORT.md and identify which issues to address:
- [ ] Critical security issues (Phase 1)
- [ ] Architecture improvements (Phase 2)
- [ ] Code quality improvements (Phase 3)
- [ ] Specific file/function refactoring

#### Step 1.2: Select Refactoring Scope
Choose ONE of:
- **Single Issue**: Fix one specific issue from the report
- **File-Based**: Refactor all issues in a specific file
- **Category-Based**: Fix all issues in a category (e.g., all SQL injection issues)
- **Phase-Based**: Follow the action plan phases sequentially

**User must specify**: Which issue(s) to address in this refactoring session.

### 2. Pre-Refactoring Safety Checks

#### Step 2.1: Create Characterization Tests (Required for Medium+ Risk)
Before refactoring, create tests that capture current behavior:

```typescript
// Example: Test current behavior before refactoring
describe('Characterization: Current Loan Query Behavior', () => {
  it('should return loans filtered by tenant_id', async () => {
    // Test current implementation
    // This test will verify refactor doesn't change behavior
  });
});
```

**Rules** (from `.cursor/rules/03-testing.md`):
- Required for risky refactors
- Capture current behavior, not desired behavior
- Use existing test framework patterns

#### Step 2.2: Establish Baseline
```bash
git fetch origin
git diff origin/main...HEAD --stat  # Review what's changed
```

#### Step 2.3: Document Rollback Plan
For each refactoring:
- **How to rollback**: `git revert <commit>` or specific steps
- **When to rollback**: Error conditions, test failures, behavior changes
- **Rollback triggers**: Test failures, increased error rates

### 3. Refactoring by Issue Type

#### Type A: Critical Security Fixes

##### A1. SQL Injection Fix
**Issue**: `src/services/auditLogger.ts:226` - String interpolation in SQL

**Process**:
1. **Create test first**:
```typescript
describe('getRecentFailedLogins SQL Injection Prevention', () => {
  it('should prevent SQL injection via withinMinutes parameter', async () => {
    // Test with malicious input
    const maliciousInput = "1' OR '1'='1";
    // Should not execute arbitrary SQL
  });
});
```

2. **Fix the vulnerability**:
```typescript
// BEFORE (vulnerable):
AND attempted_at > NOW() - INTERVAL '${withinMinutes} minutes'

// AFTER (safe):
AND attempted_at > NOW() - ($1 || ' minutes')::INTERVAL
// Pass withinMinutes as parameter: [withinMinutes]
```

3. **Verify fix**:
- Run SQL injection tests
- Verify parameterized query works
- Check all call sites use safe values

**Rules** (from `.cursor/rules/04-security.md`):
- Use parameterized queries, never concatenate user input
- Test with malicious inputs
- Verify fix blocks the vulnerability

##### A2. Remove Hardcoded Secrets
**Issue**: `src/config/database.ts:745` - Hardcoded admin password

**Process**:
1. **Remove hardcoded password** from migration
2. **Require explicit admin creation**:
   - Create script: `scripts/create-admin-user.js`
   - Use environment variable for initial admin password
   - Document in README

**Rules** (from `.cursor/rules/04-security.md`):
- Never hardcode secrets
- Use environment variables
- Validate secrets at startup

##### A3. Fix Rate Limiting Bypass
**Issue**: `src/routes/auth.ts:89-111` - Admin email bypasses rate limiting

**Process**:
1. **Remove bypass logic**:
```typescript
// BEFORE:
const isAdminEmail = email === 'admin@ailethia.com';
if (!isAdminEmail) {
  // rate limiting check
}

// AFTER:
// Apply rate limiting to ALL users
const recentFailures = await getRecentFailedLogins(email, 15);
if (recentFailures >= 5) {
  // rate limit
}
```

2. **Add account lockout instead** (better security):
```typescript
// After N failures, lock account for X minutes
// Admin can unlock via separate admin endpoint
```

**Rules** (from `.cursor/rules/04-security.md`):
- Rate limiting should apply to all users
- Use account lockout for additional security

#### Type B: Architecture Improvements

##### B1. Extract Business Logic from Routes
**Issue**: Routes contain too much business logic (loans.ts: 1000+ lines)

**Process** (Strangler Pattern - from `.cursor/rules/01-architecture-boundaries.md`):

1. **Identify business logic to extract**:
   - Complex calculations (stats, funnel data)
   - Data transformations
   - Business rules

2. **Create service layer**:
```typescript
// Create: src/services/loanService.ts
export class LoanService {
  async getLoansForTenant(tenantId: string, filters: LoanFilters): Promise<Loan[]> {
    // Business logic here
  }
  
  async calculateLoanStats(loans: Loan[]): Promise<LoanStats> {
    // Stats calculation here
  }
}
```

3. **Refactor route to use service**:
```typescript
// BEFORE (in route):
const loansResult = await pool.query(...);
const loans = loansResult.rows.map(...);
// complex calculations

// AFTER:
const loans = await loanService.getLoansForTenant(tenantId, filters);
const stats = await loanService.calculateLoanStats(loans);
```

4. **Gradual migration**:
   - Keep old code initially
   - Route traffic to new service
   - Verify behavior matches
   - Remove old code

**Rules** (from `.cursor/rules/01-architecture-boundaries.md`):
- Presentation → Application → Infrastructure (one-way)
- Extract to service layer
- Maintain backward compatibility

##### B2. Centralize Tenant Resolution
**Issue**: Duplicate tenant resolution logic across routes

**Process**:
1. **Create utility function**:
```typescript
// Create: src/utils/tenantResolver.ts
export async function getTenantIdForRequest(
  req: AuthRequest
): Promise<string | null> {
  // Centralized logic from loans.ts, admin.ts, etc.
  // Handles super_admin, regular users, etc.
}
```

2. **Replace duplicate code**:
   - Find all instances of tenant resolution
   - Replace with utility function call
   - Test each replacement

**Rules** (from `.cursor/rules/02-style-quality.md`):
- Remove duplication that causes maintenance issues
- Maintain consistency within files

##### B3. Create Query Builder Utility
**Issue**: Dynamic SQL construction is duplicated and error-prone

**Process**:
1. **Create query builder**:
```typescript
// Create: src/utils/queryBuilder.ts
export class QueryBuilder {
  private conditions: string[] = [];
  private params: any[] = [];
  private paramIndex = 1;

  where(field: string, value: any): this {
    this.conditions.push(`${field} = $${this.paramIndex}`);
    this.params.push(value);
    this.paramIndex++;
    return this;
  }

  orderBy(field: string, direction: 'ASC' | 'DESC' = 'ASC'): this {
    // Implementation
    return this;
  }

  limit(count: number): this {
    // Implementation
    return this;
  }

  build(): { query: string; params: any[] } {
    return {
      query: this.conditions.join(' AND '),
      params: this.params
    };
  }
}
```

2. **Refactor existing queries gradually**:
   - Start with one file (e.g., `auditLogger.ts`)
   - Replace dynamic query construction
   - Test thoroughly
   - Move to next file

**Rules** (from `.cursor/rules/04-security.md`):
- Always use parameterized queries
- Validate all parameters

#### Type C: Code Quality Improvements

##### C1. Enable TypeScript Strict Mode
**Issue**: `tsconfig.json` has strict mode disabled

**Process** (Gradual - from `.cursor/rules/02-style-quality.md`):
1. **Start with one rule**:
```json
{
  "noImplicitAny": true
}
```

2. **Fix type errors incrementally**:
   - Fix one file at a time
   - Add type annotations where needed
   - Use `unknown` instead of `any` when type is truly unknown

3. **Enable more rules gradually**:
   - `strictNullChecks: true`
   - `strictFunctionTypes: true`
   - Finally: `strict: true`

**Rules** (from `.cursor/rules/02-style-quality.md`):
- Use types/interfaces when available
- Avoid `any` type; use `unknown` and validate
- Maintain existing patterns

##### C2. Replace console.* with Logger
**Issue**: 298 instances of console.log across 35 files

**Process**:
1. **Identify logger service**: Check if `src/services/logger.ts` exists
2. **Replace incrementally**:
   - One file at a time
   - Replace `console.log` → `logInfo`
   - Replace `console.error` → `logError`
   - Replace `console.warn` → `logWarn`

**Rules** (from `.cursor/rules/02-style-quality.md`):
- Use structured logging when available
- Include context (request ID, user ID, etc.)

##### C3. Extract Magic Numbers/Strings
**Issue**: Hardcoded values throughout codebase

**Process**:
1. **Create constants file**:
```typescript
// Create: src/constants/app.ts
export const JWT_EXPIRY = '7d';
export const REVENUE_RATE = 0.01;
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const DEFAULT_TENANT_NAME = 'Default';
```

2. **Replace hardcoded values**:
   - Find and replace in one file at a time
   - Use constants
   - Test to ensure behavior unchanged

**Rules** (from `.cursor/rules/02-style-quality.md`):
- Maintain consistency within files
- One change per commit when possible

### 4. Implementation Checklist

For each refactoring:

#### Pre-Refactoring
- [ ] Issue identified from CODE_REVIEW_REPORT.md
- [ ] Characterization tests created (if medium+ risk)
- [ ] Baseline established (git diff reviewed)
- [ ] Rollback plan documented
- [ ] User approval obtained

#### During Refactoring
- [ ] Follow existing code patterns (from `.cursor/rules/02-style-quality.md`)
- [ ] Maintain layer boundaries (from `.cursor/rules/01-architecture-boundaries.md`)
- [ ] Use parameterized queries (from `.cursor/rules/04-security.md`)
- [ ] No secrets in code (from `.cursor/rules/04-security.md`)
- [ ] Input validation added (from `.cursor/rules/04-security.md`)
- [ ] Error handling follows existing patterns
- [ ] Logging uses logger service (not console.*)

#### Post-Refactoring
- [ ] All tests pass (characterization + new tests)
- [ ] No new linting errors
- [ ] Code review completed
- [ ] Rollback tested (if applicable)
- [ ] Documentation updated

### 5. Refactoring Workflow

#### Workflow for Single Issue
1. **Select issue** from CODE_REVIEW_REPORT.md
2. **Read relevant rules** from `.cursor/rules/`
3. **Create characterization tests** (if needed)
4. **Implement fix** following rules
5. **Test fix** thoroughly
6. **Verify no regressions**
7. **Commit with clear message**

#### Workflow for File Refactoring
1. **Select file** (e.g., `src/routes/loans.ts`)
2. **List all issues** in that file from report
3. **Prioritize issues** (security first, then architecture, then quality)
4. **Fix issues sequentially** (one per commit)
5. **Test after each fix**
6. **Verify file is improved**

#### Workflow for Category Refactoring
1. **Select category** (e.g., "All SQL injection issues")
2. **List all issues** in category
3. **Fix each issue** (one per commit)
4. **Test after each fix**
5. **Verify category is complete**

### 6. Safety Requirements

#### Required for All Refactorings
- **Characterization tests** for medium+ risk changes
- **Rollback plan** documented
- **Incremental changes** (one issue per commit when possible)
- **Test after each change**

#### Required for Security Fixes
- **Security tests** that verify vulnerability is blocked
- **Negative tests** (test with malicious inputs)
- **Verification** that fix works

#### Required for Architecture Changes
- **Interface/contract** defined before implementation
- **Backward compatibility** maintained during transition
- **Gradual migration** (strangler pattern)

### 7. Verification

#### After Each Refactoring
```bash
# Run tests
npm test

# Check for linting errors
npm run lint

# Verify no regressions
git diff origin/main...HEAD
```

#### Security Fix Verification
- [ ] Vulnerability test passes (exploit is blocked)
- [ ] Normal functionality still works
- [ ] No new security issues introduced

#### Architecture Fix Verification
- [ ] Characterization tests pass
- [ ] New service/utility works correctly
- [ ] Old code can be removed (if applicable)
- [ ] No boundary violations introduced

### 8. Documentation

For each refactoring, document:
- **What was changed**: Issue from report
- **Why it was changed**: Security/quality/maintainability reason
- **How it was changed**: Implementation approach
- **Testing**: What tests were added/updated
- **Rollback**: How to rollback if needed

### 9. Common Patterns

#### Pattern: Extract Service from Route
```typescript
// 1. Create service
// src/services/loanService.ts
export class LoanService {
  async getLoans(tenantId: string, filters: Filters): Promise<Loan[]> {
    // Business logic
  }
}

// 2. Update route
// src/routes/loans.ts
import { LoanService } from '../services/loanService.js';

const loanService = new LoanService();

router.get('/', async (req, res) => {
  const loans = await loanService.getLoans(tenantId, filters);
  res.json({ loans });
});
```

#### Pattern: Fix SQL Injection
```typescript
// BEFORE (vulnerable):
const query = `SELECT * FROM table WHERE field = '${userInput}'`;

// AFTER (safe):
const query = `SELECT * FROM table WHERE field = $1`;
await pool.query(query, [userInput]);
```

#### Pattern: Centralize Duplicate Logic
```typescript
// 1. Create utility
// src/utils/tenantResolver.ts
export async function getTenantId(req: AuthRequest): Promise<string | null> {
  // Centralized logic
}

// 2. Replace duplicates
// In each route file:
const tenantId = await getTenantId(req);
```

## Rules Summary

### From `.cursor/rules/00-global.md`
- Minimal change philosophy
- One change per commit when possible
- Preserve existing behavior unless explicitly changed
- Characterization tests before risky refactors

### From `.cursor/rules/01-architecture-boundaries.md`
- Extract business logic to service layer
- Maintain layer boundaries
- Use strangler pattern for large refactors

### From `.cursor/rules/02-style-quality.md`
- Maintain existing formatting style
- Follow existing naming patterns
- Remove duplication that causes maintenance issues
- Use types/interfaces when available

### From `.cursor/rules/03-testing.md`
- Characterization tests for risky refactors
- Test critical paths and edge cases
- Update tests when behavior changes

### From `.cursor/rules/04-security.md`
- Use parameterized queries (never concatenate)
- Never hardcode secrets
- Validate all input
- Test security fixes with exploit scenarios

### From `.cursor/rules/05-performance.md`
- Only optimize if there's evidence of a problem
- Focus on correctness and security first
- Don't optimize code that isn't proven slow

## Example Usage

### Example 1: Fix SQL Injection
```
User: "Refactor based on code review - fix SQL injection in auditLogger.ts"

Assistant:
1. Identifies issue from report
2. Creates characterization test
3. Implements parameterized query fix
4. Tests fix
5. Verifies vulnerability is blocked
```

### Example 2: Extract Business Logic
```
User: "Refactor loans.ts - extract stats calculation to service"

Assistant:
1. Creates LoanService
2. Moves stats calculation logic
3. Updates route to use service
4. Creates characterization tests
5. Verifies behavior unchanged
```

### Example 3: Enable TypeScript Strict Mode
```
User: "Enable noImplicitAny in tsconfig"

Assistant:
1. Updates tsconfig.json
2. Fixes type errors incrementally (one file at a time)
3. Tests after each file
4. Verifies no regressions
```

## Notes

- **Always start small**: Fix one issue at a time
- **Test incrementally**: Test after each change
- **Follow existing patterns**: Don't introduce new patterns unnecessarily
- **Document changes**: Clear commit messages and documentation
- **Safety first**: Characterization tests and rollback plans for risky changes

