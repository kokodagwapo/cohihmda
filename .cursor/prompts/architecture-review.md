# Architecture Review Prompt

## Review Scope

Architecture reviews should be based ONLY on observed structure, not assumptions.

### 1. Boundary Audit
- **Observed layers**: What layers/modules are actually present in the codebase?
- **Dependency direction**: What dependencies exist between layers?
- **Boundary violations**: Are there any cross-boundary dependencies that violate architecture?
- **Uncertainty**: What boundaries are unclear or unknown?

### 2. Structure Analysis
- **Folder structure**: What is the actual folder structure?
- **File organization**: How are files organized?
- **Naming patterns**: What naming patterns are used?
- **Uncertainty**: What structure is unclear?

### 3. Integration Points
- **External services**: What external services are integrated?
- **Database access**: How is database access organized?
- **API boundaries**: What are the API boundaries?
- **Uncertainty**: What integration points are unknown?

### 4. Data Flow
- **Request flow**: How do requests flow through the system?
- **Data access**: How is data accessed and modified?
- **State management**: How is state managed?
- **Uncertainty**: What data flows are unclear?

### 5. Security Architecture
- **Authentication**: How is authentication implemented?
- **Authorization**: How is authorization implemented?
- **Data protection**: How is sensitive data protected?
- **Uncertainty**: What security measures are unknown?

### 6. Performance Architecture
- **Caching**: Is caching used? Where?
- **Async processing**: Is async processing used? Where?
- **Database optimization**: Are there database optimizations?
- **Uncertainty**: What performance patterns are unknown?

## Assistant Behavior

### Evidence-Only Analysis
- Base analysis ONLY on:
  - Files that exist in the codebase
  - Code that can be observed
  - Patterns that are actually present
- Do NOT assume:
  - Architecture patterns that aren't present
  - Technologies that aren't used
  - Patterns that aren't implemented

### Uncertainty Handling
- **Label uncertainty clearly**: "UNCERTAIN: <what>"
- **List what is known**: Document what can be observed
- **List what is unknown**: Document what cannot be determined
- **Ask for clarification**: Request information needed to complete review

### Boundary Violation Detection
- Identify violations based on:
  - Import statements that cross boundaries
  - Dependencies that violate layer rules
  - Code that's in the wrong layer
- Do NOT assume boundaries that aren't present

### Recommendations
- Provide recommendations ONLY if:
  - They're based on observed issues
  - They address actual problems
  - They're feasible given the codebase structure
- Do NOT recommend:
  - Rewrites without explicit request
  - New architecture patterns without justification
  - Changes that aren't based on evidence

## Example Architecture Review Format

```
Architecture Review: <component or area>

Observed Structure:
- Files: [list of relevant files]
- Folders: [list of relevant folders]
- Dependencies: [list of dependencies observed]

Layers Identified:
- Presentation: [what is observed]
- Application: [what is observed]
- Infrastructure: [what is observed]

Boundary Analysis:
- Dependency direction: [what is observed]
- Violations: [any violations found]
- Uncertainty: [what is unclear]

Integration Points:
- External services: [what is observed]
- Database: [what is observed]
- APIs: [what is observed]

Data Flow:
- Request flow: [what is observed]
- Data access: [what is observed]

Security:
- Authentication: [what is observed]
- Authorization: [what is observed]
- Data protection: [what is observed]

Uncertainty:
- [List what cannot be determined]
- [What information is needed]

Recommendations:
- [Only if based on observed issues]
- [Only if addressing actual problems]
```


