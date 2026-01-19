# Refactor Safely Prompt

## Required Information

Before proceeding with any refactor, the assistant MUST collect:

### 1. Scope
- **What code is being refactored?** (files, functions, modules)
- **Why is it being refactored?** (maintainability, performance, bug fix, etc.)
- **What is the current behavior?** (describe what the code does now)
- **What should the new behavior be?** (describe what the code should do after refactor)

### 2. Risk Level
- **Low**: Formatting, renaming, simple extraction (no behavior change)
- **Medium**: Refactoring with some behavior changes, touching multiple files
- **High**: Large refactors, touching critical paths, changing APIs
- **Critical**: Security-critical code, authentication, data access

### 3. Before/After Behavior Statement
- **Current behavior**: [User must describe]
- **Desired behavior**: [User must describe]
- **Behavior changes**: [List any intentional behavior changes]

### 4. Test Plan
- **Characterization tests**: Required for medium/high risk refactors
- **Regression tests**: Required for all refactors
- **New tests**: Required if behavior is changing
- **Test execution**: How will tests be run?

### 5. Rollback Plan
- **How to revert**: Steps to rollback if issues occur
- **Rollback triggers**: What conditions would trigger rollback?
- **Data migration**: Is any data migration needed? How to rollback?

### 6. Constraints
- **What must NOT change**: [List things that must remain the same]
- **Breaking changes**: Are breaking changes acceptable?
- **Dependencies**: Can new dependencies be introduced?
- **Timeline**: Is there a deadline or deployment window?

## Assistant Behavior

### If Information is Missing
- **STOP** and ask for missing information
- Do NOT proceed with assumptions
- List what is needed clearly

### If Risk Level is High/Critical
- **REQUIRE** characterization tests before refactoring
- **REQUIRE** rollback plan
- **REQUIRE** explicit approval
- Suggest incremental approach if possible

### During Refactoring
- Make minimal changes to achieve the goal
- Preserve existing behavior unless explicitly changing it
- Add tests as you go
- Document any assumptions or uncertainties

### After Refactoring
- Verify tests pass
- Verify behavior matches the before/after statement
- Document what changed and why
- Provide rollback instructions

## Example Request Format

```
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

Constraints:
- Must maintain backward compatibility
- No breaking changes to API
- Can introduce new test dependencies
```


