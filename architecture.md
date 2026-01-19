# Architecture Documentation

## Purpose
This document captures what is known about the codebase architecture and explicitly lists what is unknown. It serves as a living document that evolves as the codebase is understood better.

## Last Updated
<date>

## Known Architecture

### Observed Structure
Based on codebase exploration, the following structure has been observed:

#### Directory Structure
- `src/` - Frontend application code (React/TypeScript)
- `server-src/` - Backend application code (Express/TypeScript)
  - `config/` - Configuration files
  - `controllers/` - Request handlers
  - `middleware/` - Express middleware
  - `routes/` - API route definitions
  - `services/` - Business logic services
- `supabase/` - Database migrations and configuration
- `lambda/` - AWS Lambda functions
- `infrastructure/` - Infrastructure as code

#### Technology Stack (Observed)
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS
- **Backend**: Node.js, Express.js, TypeScript
- **Database**: PostgreSQL (via Supabase)
- **Deployment**: AWS (S3, CloudFront, Elastic Beanstalk, Lambda)
- **Package Management**: npm (separate packages for frontend and backend)

#### Key Patterns Observed
- Multi-tenant architecture (tenant isolation)
- REST API + WebSocket server
- JWT-based authentication
- Role-based access control (RBAC)
- Audit logging for compliance
- Stripe integration for subscriptions

### Architecture Boundaries (Inferred from Structure)

#### Presentation Layer
- **Location**: `src/`
- **Responsibilities**: UI components, user interactions, client-side state
- **Dependencies**: Should depend on application layer (API calls)

#### Application Layer
- **Location**: `server-src/`
- **Responsibilities**: Business logic, request handling, orchestration
- **Dependencies**: Should depend on infrastructure layer

#### Infrastructure Layer
- **Location**: Database (Supabase), AWS services, external APIs
- **Responsibilities**: Data persistence, external service integration
- **Dependencies**: Should not depend on application or presentation layers

### Data Flow (Observed Patterns)
- Frontend makes API calls to backend
- Backend handles authentication/authorization
- Backend accesses database through Supabase
- Backend integrates with external services (Stripe, AI services)
- WebSocket connections for real-time features

## Unknown Architecture

### Uncertainties
The following aspects of the architecture are unclear or unknown:

1. **Service Boundaries**
   - How are services organized within `server-src/services/`?
   - Are there clear service interfaces?
   - How do services communicate?

2. **Data Access Patterns**
   - How is database access abstracted?
   - Are there repository patterns or data access objects?
   - How is database connection management handled?

3. **Error Handling Strategy**
   - What error handling patterns are used?
   - How are errors propagated?
   - What error logging/monitoring is in place?

4. **Testing Architecture**
   - What test frameworks are used?
   - Where are tests located?
   - What is the test coverage strategy?

5. **Deployment Architecture**
   - How is the application deployed?
   - What is the CI/CD pipeline?
   - How are environments managed (dev, staging, prod)?

6. **Security Architecture**
   - How is authentication implemented in detail?
   - How is authorization enforced?
   - How are secrets managed?
   - What encryption is used?

7. **Performance Architecture**
   - Is caching used? Where?
   - How is database query performance optimized?
   - Are there any performance monitoring tools?

8. **Multi-Tenant Isolation**
   - How is tenant isolation implemented at the database level?
   - How is tenant context propagated?
   - Are there row-level security policies?

## Architecture Evolution

### How to Update This Document
1. **When new patterns are discovered**: Add them to "Known Architecture"
2. **When uncertainties are resolved**: Move them from "Unknown Architecture" to "Known Architecture"
3. **When new uncertainties arise**: Add them to "Unknown Architecture"
4. **When architecture changes**: Document the change, reason, and migration path

### Safe Architecture Changes
- **Incremental**: Make small changes, not big rewrites
- **Tested**: Add tests before and after changes
- **Documented**: Document what changed and why
- **Rollback Plan**: Always have a way to rollback

### Architecture Review Process
1. **Identify change scope**: What is being changed?
2. **Assess impact**: What will be affected?
3. **Plan migration**: How will the change be made?
4. **Test thoroughly**: Verify the change works
5. **Monitor**: Watch for issues after deployment
6. **Document**: Update this document

## Code Review Baseline

### Review Process
All code reviews are performed as **diffs against the baseline branch**:

- **Default baseline**: `origin/main`
- **Compare range**: `origin/main...HEAD`
- **If baseline doesn't exist**: Check `origin/master`, then `origin/trunk`, then `origin/HEAD`

### Review Scope
- **Review ONLY**: Code that changed in the diff
- **Do NOT review**: Unchanged code, full repository
- **Context expansion**: Allowed only to validate correctness or assess risk spillover

### Review Categories
1. **Security**: Vulnerabilities, secrets, injection risks
2. **Performance**: N+1 queries, large payloads, blocking operations
3. **Architecture**: Boundary violations, dependency issues
4. **Quality**: Error handling, logging, code clarity
5. **Testing**: Test coverage, test quality
6. **Release Risk**: Breaking changes, migration needs, rollback complexity

## Architecture Principles

### 1. Evidence-Based
- Base architecture decisions on observed patterns, not assumptions
- Document what is known, explicitly list what is unknown
- Ask for clarification when architecture is unclear

### 2. Incremental Improvement
- Prefer small, incremental changes over large rewrites
- Use strangler pattern for major refactors
- Maintain backward compatibility when possible

### 3. Safety First
- Require tests before risky changes
- Require rollback plans for medium/high risk changes
- Require migration plans for breaking changes

### 4. Clear Boundaries
- Maintain clear separation between layers
- Enforce dependency direction (presentation → application → infrastructure)
- Avoid circular dependencies

### 5. Documentation
- Document architecture decisions
- Update this document as architecture evolves
- Keep documentation in sync with code

## Questions to Resolve

As architecture is better understood, these questions should be answered:

1. [ ] What are the service boundaries in `server-src/services/`?
2. [ ] How is database access abstracted?
3. [ ] What error handling patterns are used?
4. [ ] What test frameworks and patterns are used?
5. [ ] How is the application deployed?
6. [ ] How is authentication/authorization implemented in detail?
7. [ ] Is caching used? Where?
8. [ ] How is multi-tenant isolation implemented at the database level?

## Notes
- This document is a living document and should be updated as the codebase is better understood
- When in doubt, document uncertainty rather than making assumptions
- Architecture reviews should be based on observed patterns, not assumptions


