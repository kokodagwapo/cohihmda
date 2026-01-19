# Cursor Workspace Kit Guide

## Overview

This workspace kit provides structured rules, prompts, and commands to help maintain code quality, security, and consistency in a large, evolving codebase. It enforces evidence-based code reviews, prevents hallucination, and ensures safe refactoring practices.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Directory Structure](#directory-structure)
3. [Rules - When and How to Use](#rules---when-and-how-to-use)
4. [Prompts - When and How to Use](#prompts---when-and-how-to-use)
5. [Commands - When and How to Use](#commands---when-and-how-to-use)
6. [Common Workflows](#common-workflows)
7. [Best Practices](#best-practices)
8. [Troubleshooting](#troubleshooting)

---

## Quick Start

### For Code Reviews
1. Open Cursor Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. Type: `@codereview-quick` for fast review
3. Or: `@codereview-deep` for comprehensive review

### For Refactoring
1. Use prompt: `@refactor-safely`
2. Provide required information (scope, risk level, test plan)
3. Follow the structured refactoring process

### For Adding Features
1. Use prompt: `@add-feature`
2. Fill out requirements and acceptance criteria
3. Ensure explicit "what will NOT change" section

---

## Directory Structure

```
.cursor/
├── rules/          # Global behavior rules (always active)
├── prompts/        # Structured prompts for common tasks
└── commands/       # Code review and refactoring commands

architecture.md     # Living architecture documentation
```

### How Cursor Uses These Files

- **Rules** (`.cursor/rules/`): Automatically loaded by Cursor. These guide AI behavior for all interactions.
- **Prompts** (`.cursor/prompts/`): Reference these when starting a task. Use `@<prompt-name>` in chat.
- **Commands** (`.cursor/commands/`): Use `@<command-name>` in chat to execute structured workflows.

---

## Rules - When and How to Use

Rules are **always active** and guide AI behavior automatically. You don't need to invoke them manually.

### 00-global.md
**When**: Always active (automatic)  
**What it does**: 
- Prevents AI from making assumptions about your stack
- Enforces diff-based code reviews
- Requires explicit information before proceeding

**How to use**: No action needed. It's automatically applied to all AI interactions.

**Example**: If you ask "review my code", the AI will automatically:
1. Fetch the baseline branch
2. Review only the diff
3. Not speculate about unrelated code

### 01-architecture-boundaries.md
**When**: Always active (automatic)  
**What it does**:
- Enforces layer boundaries (presentation → application → infrastructure)
- Prevents circular dependencies
- Flags boundary violations in code reviews

**How to use**: No action needed. The AI will automatically check for boundary violations when reviewing code.

**Example**: If code in `src/` directly imports from `server-src/services/`, the AI will flag this as a boundary violation.

### 02-style-quality.md
**When**: Always active (automatic)  
**What it does**:
- Maintains consistency with existing code style
- Flags quality issues (but doesn't block on them)
- Respects "vibe-coded" nature of the codebase

**How to use**: No action needed. The AI will maintain existing style when making changes.

**Example**: If you're editing a file with 2-space indentation, the AI will use 2-space indentation, not 4-space.

### 03-testing.md
**When**: Always active (automatic)  
**What it does**:
- Requires tests for critical/security changes
- Suggests tests based on change risk level
- Doesn't assume test framework

**How to use**: No action needed. When you make changes, the AI will suggest appropriate tests.

**Example**: If you modify authentication code, the AI will require security tests before proceeding.

### 04-security.md
**When**: Always active (automatic)  
**What it does**:
- Flags security vulnerabilities in code changes
- Checks for secrets, injection risks, auth issues
- Provides exploit scenarios for critical findings

**How to use**: No action needed. All code reviews automatically include security checks.

**Example**: If you add SQL query with string concatenation, the AI will flag it as SQL injection risk.

### 05-performance.md
**When**: Always active (automatic)  
**What it does**:
- Identifies performance risks (N+1 queries, blocking operations)
- Only flags issues present in the diff
- Doesn't optimize code that isn't a bottleneck

**How to use**: No action needed. Performance checks are included in code reviews.

**Example**: If you add a loop that makes database queries, the AI will flag it as N+1 query risk.

---

## Prompts - When and How to Use

Prompts are **manually invoked** using `@<prompt-name>` in Cursor chat.

### refactor-safely.md
**When to use**:
- Before refactoring any code
- When changing code structure
- When extracting functions/classes
- When improving code organization

**How to use**:
1. Type: `@refactor-safely` in Cursor chat
2. Provide required information:
   - Scope (what code is being refactored)
   - Risk level (Low/Medium/High/Critical)
   - Before/after behavior statement
   - Test plan
   - Rollback plan
3. The AI will guide you through the refactoring process

**Example**:
```
@refactor-safely

I want to refactor the user authentication module.

Scope:
- Files: server-src/middleware/auth.ts, server-src/services/authService.ts
- Reason: Extract JWT validation logic into a separate service for testability

Current behavior:
- JWT validation happens inline in middleware
- Token expiration is checked but not logged

Desired behavior:
- JWT validation logic moved to authService
- Token expiration logged for security monitoring
- No change to authentication flow

Risk level: Medium

Test plan:
- Characterization tests for current JWT validation behavior
- Unit tests for new authService methods
- Integration tests for middleware using authService

Rollback plan:
- Revert commit if tests fail
- No data migration needed
```

### bug-triage.md
**When to use**:
- When investigating a bug
- When fixing a reported issue
- When debugging unexpected behavior

**How to use**:
1. Type: `@bug-triage` in Cursor chat
2. Provide bug information:
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details
3. The AI will guide you through: reproduce → isolate → lock → fix → verify → monitor

**Example**:
```
@bug-triage

Bug: User cannot log in with valid credentials

Steps to reproduce:
1. Navigate to /login
2. Enter valid email and password
3. Click "Sign In"
4. See error: "Invalid credentials"

Expected behavior:
- User should be logged in and redirected to dashboard

Actual behavior:
- Error message appears, user remains on login page

Environment:
- Browser: Chrome 120
- OS: Windows 11
- Backend: Node.js 20

Frequency: Always
```

### add-feature.md
**When to use**:
- Before implementing a new feature
- When adding new functionality
- When extending existing features

**How to use**:
1. Type: `@add-feature` in Cursor chat
2. Fill out the feature template:
   - Feature description
   - Requirements (functional and non-functional)
   - Acceptance criteria
   - Explicit "what will NOT change"
   - Integration points
   - Constraints
   - Testing requirements
3. The AI will ensure nothing outside scope is changed

**Example**:
```
@add-feature

Feature: Add user profile picture upload

Description:
- Users should be able to upload a profile picture
- Picture should be displayed in user profile and next to user name
- Maximum file size: 2MB
- Supported formats: JPEG, PNG, WebP

Why needed:
- Improve user experience and personalization

Functional requirements:
- Upload button in user profile page
- File validation (type, size)
- Image preview before upload
- Progress indicator during upload
- Error handling for failed uploads

Acceptance criteria:
- [ ] User can select image file from device
- [ ] User can see preview of selected image
- [ ] User can upload image successfully
- [ ] Image appears in user profile after upload

What will NOT change:
- User authentication flow
- User profile data structure (except adding picture URL)
- Existing API endpoints (new endpoint will be added)
```

### architecture-review.md
**When to use**:
- When reviewing architecture changes
- When understanding system structure
- When planning major refactors
- When onboarding new team members

**How to use**:
1. Type: `@architecture-review` in Cursor chat
2. Specify what you want reviewed (component, area, or full system)
3. The AI will analyze based on observed structure only (no assumptions)

**Example**:
```
@architecture-review

Please review the authentication architecture.

Focus areas:
- How authentication flows through the system
- Service boundaries in auth-related code
- Security architecture for authentication
```

---

## Commands - When and How to Use

Commands are **manually invoked** using `@<command-name>` in Cursor chat.

### Code Review Commands

#### codereview-quick.md
**When to use**:
- Quick check before committing
- Pre-merge review
- Fast feedback on changes
- Daily code review workflow

**How to use**:
1. Type: `@codereview-quick` in Cursor chat
2. The AI will automatically:
   - Fetch baseline branch
   - Get diff statistics
   - Review for critical issues only
3. Review takes < 5 minutes

**Example**:
```
@codereview-quick
```

**Output**: Quick report with critical security and breaking issues only.

#### codereview-deep.md
**When to use**:
- Comprehensive PR review
- Before major releases
- Security audit
- Quality assessment

**How to use**:
1. Type: `@codereview-deep` in Cursor chat
2. The AI will review:
   - Security (all categories)
   - Performance
   - Architecture
   - Code quality
   - Testing
   - Documentation
3. Review takes 30+ minutes

**Example**:
```
@codereview-deep
```

**Output**: Comprehensive report with findings in all categories.

#### codereview-diff-only.md
**When to use**:
- Strict diff-based review
- When you want zero context expansion
- When reviewing large PRs
- When you want minimal review scope

**How to use**:
1. Type: `@codereview-diff-only` in Cursor chat
2. The AI will review ONLY lines in the diff
3. No context expansion, no assumptions

**Example**:
```
@codereview-diff-only
```

**Output**: Findings based strictly on diff lines, with explicit uncertainty notes.

#### codereview-security.md
**When to use**:
- Security-focused review
- Before deploying to production
- When handling sensitive data
- Compliance reviews

**How to use**:
1. Type: `@codereview-security` in Cursor chat
2. The AI will check all security categories
3. Provides exploit scenarios for critical/high findings

**Example**:
```
@codereview-security
```

**Output**: Security-focused report with exploit scenarios and verification steps.

#### codereview-performance.md
**When to use**:
- Performance-critical changes
- When optimizing code
- Before high-traffic deployments
- When reviewing database queries

**How to use**:
1. Type: `@codereview-performance` in Cursor chat
2. The AI will identify performance risks in the diff
3. Provides optimization suggestions

**Example**:
```
@codereview-performance
```

**Output**: Performance findings with optimization suggestions.

#### codereview-architecture.md
**When to use**:
- Architecture changes
- When adding new services
- When refactoring across boundaries
- When planning system changes

**How to use**:
1. Type: `@codereview-architecture` in Cursor chat
2. The AI will check for boundary violations and dependency issues
3. Provides architectural recommendations

**Example**:
```
@codereview-architecture
```

**Output**: Architecture findings with migration suggestions.

#### codereview-tests.md
**When to use**:
- Reviewing test code
- Ensuring adequate test coverage
- Before merging test changes
- Quality assessment of tests

**How to use**:
1. Type: `@codereview-tests` in Cursor chat
2. The AI will review test quality and coverage
3. Provides test improvement suggestions

**Example**:
```
@codereview-tests
```

**Output**: Test review with coverage analysis and quality findings.

#### codereview-release-risk.md
**When to use**:
- Before production releases
- Risk assessment for deployments
- Planning release strategy
- Identifying breaking changes

**How to use**:
1. Type: `@codereview-release-risk` in Cursor chat
2. The AI will assess:
   - Breaking changes
   - Migration requirements
   - Rollback complexity
   - Deployment risk
3. Provides release decision recommendation

**Example**:
```
@codereview-release-risk
```

**Output**: Risk assessment with release decision and mitigation plans.

### Refactoring Commands

#### create-characterization-tests.md
**When to use**:
- Before risky refactors
- When you need to lock current behavior
- When refactoring untested code
- Before using strangler pattern

**How to use**:
1. Type: `@create-characterization-tests` in Cursor chat
2. Provide:
   - File path
   - Function/class name
   - What the code does
3. The AI will create tests that capture current behavior

**Example**:
```
@create-characterization-tests

File: server-src/services/authService.ts
Function: validateJWT
Purpose: Validates JWT tokens and returns user information
```

**Output**: Test suite that captures current behavior (not desired behavior).

#### refactor-strangler.md
**When to use**:
- Major refactors
- Replacing legacy code
- Incremental migrations
- When you need gradual rollout

**How to use**:
1. Type: `@refactor-strangler` in Cursor chat
2. Provide:
   - Target code to refactor
   - Current vs desired implementation
3. The AI will guide you through strangler pattern implementation

**Example**:
```
@refactor-strangler

File: server-src/services/legacyAuthService.ts
Current: Synchronous authentication with file-based storage
Desired: Async authentication with database storage
```

**Output**: Step-by-step strangler pattern implementation plan.

---

## Common Workflows

### Daily Development Workflow

1. **Before making changes**:
   - Understand the codebase (read `architecture.md`)
   - Check related rules if unsure

2. **While coding**:
   - Rules are automatically applied
   - AI will guide you based on existing patterns

3. **Before committing**:
   ```
   @codereview-quick
   ```
   - Quick check for critical issues
   - Takes < 5 minutes

4. **Before pushing**:
   ```
   @codereview-security
   ```
   - Security check
   - Ensures no secrets or vulnerabilities

### Feature Development Workflow

1. **Plan the feature**:
   ```
   @add-feature
   ```
   - Fill out feature template
   - Define scope and constraints

2. **Implement the feature**:
   - Follow existing patterns
   - Rules guide AI assistance automatically

3. **Review the feature**:
   ```
   @codereview-deep
   ```
   - Comprehensive review
   - Check all categories

4. **Assess release risk**:
   ```
   @codereview-release-risk
   ```
   - Identify breaking changes
   - Plan migration if needed

### Refactoring Workflow

1. **Plan the refactor**:
   ```
   @refactor-safely
   ```
   - Define scope and risk level
   - Create test plan

2. **Lock current behavior**:
   ```
   @create-characterization-tests
   ```
   - Create tests for current behavior
   - Ensures refactor doesn't break anything

3. **Implement refactor**:
   - For major refactors, use:
     ```
     @refactor-strangler
     ```
   - For minor refactors, proceed with `@refactor-safely` guidance

4. **Verify refactor**:
   ```
   @codereview-deep
   ```
   - Ensure no regressions
   - Verify tests pass

### Bug Fix Workflow

1. **Investigate the bug**:
   ```
   @bug-triage
   ```
   - Reproduce the bug
   - Isolate the root cause

2. **Lock the bug**:
   ```
   @create-characterization-tests
   ```
   - Create test that reproduces the bug
   - Test should fail with current code

3. **Fix the bug**:
   - Make minimal fix
   - No refactoring unless necessary

4. **Verify the fix**:
   - Characterization test should now pass
   - Run regression tests

5. **Review the fix**:
   ```
   @codereview-quick
   ```
   - Quick check before merging

### Pre-Release Workflow

1. **Comprehensive review**:
   ```
   @codereview-deep
   ```
   - Review all changes
   - Check all categories

2. **Security audit**:
   ```
   @codereview-security
   ```
   - Focused security review
   - Verify no vulnerabilities

3. **Performance check**:
   ```
   @codereview-performance
   ```
   - Identify performance risks
   - Optimize if needed

4. **Release risk assessment**:
   ```
   @codereview-release-risk
   ```
   - Assess deployment risk
   - Plan rollback if needed

5. **Architecture review** (if major changes):
   ```
   @architecture-review
   ```
   - Verify architecture integrity
   - Check boundary violations

---

## Best Practices

### 1. Use the Right Tool for the Job

- **Quick checks**: `@codereview-quick`
- **Comprehensive reviews**: `@codereview-deep`
- **Security focus**: `@codereview-security`
- **Performance focus**: `@codereview-performance`
- **Architecture focus**: `@codereview-architecture`

### 2. Always Use Prompts for Structured Tasks

- **Refactoring**: Always use `@refactor-safely`
- **Adding features**: Always use `@add-feature`
- **Bug fixes**: Always use `@bug-triage`

### 3. Review Before Committing

- Run `@codereview-quick` before every commit
- Run `@codereview-security` before pushing
- Run `@codereview-deep` before merging PRs

### 4. Lock Behavior Before Refactoring

- Always create characterization tests before risky refactors
- Use `@create-characterization-tests` to lock current behavior
- Verify tests pass before and after refactoring

### 5. Assess Risk Before Releases

- Always run `@codereview-release-risk` before production releases
- Plan migrations for breaking changes
- Have rollback plan ready

### 6. Keep Architecture Documentation Updated

- Update `architecture.md` when you discover new patterns
- Move items from "Unknown" to "Known" as you learn
- Document architecture decisions

### 7. Don't Fight the Rules

- Rules are designed to prevent common mistakes
- If a rule seems wrong, update it (don't work around it)
- Rules are evidence-based, not opinion-based

### 8. Provide Complete Information

- When using prompts, fill out all required fields
- Incomplete information leads to assumptions (which rules prevent)
- Better to provide too much information than too little

---

## Troubleshooting

### "AI is asking for too much information"

**Solution**: The rules prevent assumptions. Provide the requested information, or update the rules if they're too strict.

### "Code review is taking too long"

**Solution**: Use `@codereview-quick` for fast reviews. Use `@codereview-deep` only when needed.

### "AI is reviewing code I didn't change"

**Solution**: This shouldn't happen. The rules enforce diff-only reviews. If it does, check that you're on the correct branch and baseline is set correctly.

### "AI is making assumptions about my stack"

**Solution**: This shouldn't happen. The rules explicitly prevent assumptions. If it does, check that rules are loaded correctly.

### "I want to review the full repository, not just the diff"

**Solution**: Explicitly request full repository review. The rules prevent this by default to avoid hallucination, but you can override for specific cases.

### "AI is suggesting changes to code I didn't modify"

**Solution**: This is by design. The rules prevent reviewing unchanged code. If you want suggestions for unrelated code, explicitly request it.

### "Test framework is unknown"

**Solution**: The rules don't assume test frameworks. Either:
1. Tell the AI what test framework you use
2. Or let the AI create generic test structure

### "Architecture boundaries are unclear"

**Solution**: This is expected for "vibe-coded" codebases. The rules document uncertainty rather than assuming. Update `architecture.md` as you learn more.

---

## Advanced Usage

### Customizing Rules

Rules can be customized for your specific needs:

1. Edit files in `.cursor/rules/`
2. Add project-specific rules
3. Adjust severity levels if needed
4. Document why rules were changed

### Creating Custom Commands

You can create custom commands:

1. Create new file in `.cursor/commands/`
2. Follow the format of existing commands
3. Use `@<your-command-name>` to invoke

### Creating Custom Prompts

You can create custom prompts:

1. Create new file in `.cursor/prompts/`
2. Follow the format of existing prompts
3. Use `@<your-prompt-name>` to invoke

### Integrating with CI/CD

You can integrate commands into CI/CD:

```bash
# Example: Run security review in CI
cursor @codereview-security --output security-report.md
```

(Note: Actual CI integration depends on Cursor's API availability)

---

## Summary

This workspace kit provides:

- **Automatic rules** that guide AI behavior (always active)
- **Structured prompts** for common tasks (use `@<prompt-name>`)
- **Review commands** for code quality (use `@codereview-<type>`)
- **Refactoring commands** for safe changes (use `@refactor-<type>`)

**Key Principles**:
- Evidence-based (no assumptions)
- Diff-based reviews (only changed code)
- Safety first (tests, rollback plans)
- Incremental improvement (no big rewrites)

**Start with**:
1. `@codereview-quick` for daily reviews
2. `@refactor-safely` for refactoring
3. `@add-feature` for new features
4. `@bug-triage` for bug fixes

For questions or issues, refer to this guide or update the relevant rule/prompt/command file.

