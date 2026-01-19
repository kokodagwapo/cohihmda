# Architecture Boundary Rules

## Layer Definitions (Abstract)

This codebase appears to have the following structural patterns (observed, not assumed):
- **Presentation Layer**: User-facing interfaces (likely in `src/` or similar)
- **Application Layer**: Business logic and orchestration (likely in `server-src/` or similar)
- **Infrastructure Layer**: External services, databases, file systems

## Boundary Rules

### 1. Dependency Direction
- Presentation → Application → Infrastructure (one-way)
- Infrastructure MUST NOT depend on Application or Presentation
- Application MUST NOT depend on Presentation
- No circular dependencies allowed

### 2. Adaptation Over Invention
- Work with existing folder structure
- Do NOT invent new folder names or reorganize without explicit request
- Identify boundaries from existing code, don't assume them
- If structure is unclear, document uncertainty and ask

### 3. Strangler Pattern Preference
- Prefer wrapping legacy code over rewriting
- Add new layers around old code
- Migrate incrementally, not all at once
- Maintain backward compatibility during transitions

### 4. Import Rules
- No cross-layer imports in wrong direction
- Shared types/utilities should be in a neutral location
- If import direction is unclear, flag it as uncertainty

### 5. Service Boundaries
- Services should be independently testable
- Services should not directly access other services' data stores
- Use interfaces/contracts for service communication
- If service boundaries are unclear, document and ask

### 6. Data Access Patterns
- Database access should be isolated to infrastructure layer
- Application layer should use abstractions (repositories, data access objects)
- Direct SQL/ORM calls in presentation layer are a boundary violation
- If data access patterns are unclear, flag as uncertainty

### 7. External Service Integration
- External service clients belong in infrastructure layer
- Application layer should use interfaces, not direct clients
- Configuration and credentials should be injected, not hardcoded
- If integration patterns are unclear, document and ask

### 8. Boundary Violation Detection
When reviewing diffs, check for:
- Imports that cross boundaries in wrong direction
- Business logic in presentation layer
- Direct database access outside infrastructure layer
- Hardcoded dependencies on external services

### 9. Refactoring Across Boundaries
- Requires explicit approval
- Requires characterization tests
- Requires rollback plan
- Should be done incrementally

### 10. Unknown Boundaries
If architecture boundaries are unclear:
- Document what is observed
- List what is unknown
- Ask for clarification before making assumptions
- Do NOT invent boundaries


