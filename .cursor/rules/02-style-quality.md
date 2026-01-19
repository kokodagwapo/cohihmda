# Style and Quality Rules

## Formatting Philosophy

### 1. Consistency Over Perfection
- Maintain existing formatting style in files being modified
- Do NOT reformat entire files unless explicitly requested
- Use project's existing formatter configuration if present
- If no formatter is configured, use minimal, readable formatting

### 2. Naming Consistency
- Follow existing naming patterns in the codebase
- If patterns are inconsistent, maintain consistency within the file being edited
- Flag naming inconsistencies as low-priority issues, not blockers
- Do NOT rename across the codebase without explicit request

### 3. File Size Limits
- Single files should not exceed reasonable limits (e.g., 500-1000 lines)
- If files are larger, suggest splitting only if:
  - User explicitly asks for refactoring
  - File is being modified anyway
  - Split would improve maintainability without breaking changes
- Do NOT split files "just because" they're large

### 4. Error Handling Rules
- Errors must be handled, not silently ignored
- Error messages should be informative but not leak sensitive information
- Use appropriate error types (don't use generic `Error` if specific types exist)
- If error handling patterns are unclear, follow existing patterns in the file

### 5. Logging Rules
- **NEVER** log secrets, passwords, tokens, or PII
- Use structured logging when available
- Include context (request ID, user ID, etc.) when possible
- Log at appropriate levels (error, warn, info, debug)
- If logging framework is unknown, use simple console methods with sanitization

### 6. Code Comments
- Comments should explain "why", not "what"
- Remove commented-out code unless it serves a purpose
- Add comments for non-obvious business logic or security measures
- Do NOT add excessive comments to self-explanatory code

### 7. Type Safety
- Use types/interfaces when available
- Avoid `any` type; use `unknown` and validate if type is truly unknown
- If type system is unclear, maintain existing patterns
- Do NOT add type annotations if the project doesn't use them

### 8. Function/Method Size
- Functions should do one thing
- If a function is very long (>100 lines), suggest splitting only if:
  - It's being modified anyway
  - Split would improve testability
  - User explicitly asks for refactoring
- Do NOT refactor long functions "just because"

### 9. Duplication
- Some duplication is acceptable if it improves clarity
- Remove duplication only if:
  - It's causing maintenance issues
  - User explicitly requests deduplication
  - It's in code being modified anyway
- Do NOT create abstractions "just because" code is similar

### 10. Code Quality vs. Velocity
- Prioritize correctness and safety over "perfect" code
- Flag quality issues but don't block on them unless they're security risks
- Suggest improvements, don't mandate them
- Respect the "vibe-coded" nature: incremental improvement over rewrites

### 11. Formatting Tools
- If formatter is configured (e.g., Prettier, Black, gofmt), use it
- If no formatter is configured, use consistent, readable style
- Do NOT introduce formatting tools without explicit request
- Do NOT reformat files outside the diff scope

### 12. Linting
- Respect existing linting rules
- Fix linting errors in code being modified
- Do NOT fix linting errors in unrelated files
- If linting rules are unclear, use common sense and consistency


