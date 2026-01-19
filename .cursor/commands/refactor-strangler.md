# Strangler Pattern Refactoring

## Purpose
Refactor code incrementally using the strangler pattern: wrap old code with new code, migrate gradually, remove old code when new code is proven.

## Prerequisites
- Code to be refactored is identified
- New implementation approach is defined
- User approval for incremental refactoring

## Process

### 1. Identify Target Code
- **File**: <file path>
- **Function/Class**: <name>
- **Current Implementation**: <brief description>
- **Desired Implementation**: <brief description>

### 2. Create Characterization Tests
- Create tests that capture current behavior
- Tests should pass with existing code
- Tests will verify new implementation matches old behavior

### 3. Implement Strangler Pattern

#### Phase 1: Add New Implementation (Parallel)
- Create new implementation alongside old code
- New code should implement same interface/contract
- New code should be feature-flagged or toggled

#### Phase 2: Route Traffic Gradually
- Add feature flag to switch between old and new
- Start with small percentage of traffic (e.g., 10%)
- Monitor for issues
- Gradually increase percentage

#### Phase 3: Verify New Implementation
- Run characterization tests against new implementation
- Monitor metrics and errors
- Verify behavior matches old implementation

#### Phase 4: Switch All Traffic
- Once verified, switch 100% of traffic to new implementation
- Keep old code for rollback capability

#### Phase 5: Remove Old Code
- After sufficient time (e.g., 1-2 weeks), remove old code
- Update tests if needed
- Clean up feature flags

### 4. Implementation Steps

#### Step 1: Create Wrapper/Interface
```<language>
// Create abstraction that both implementations can use
interface <InterfaceName> {
  <method signatures>
}
```

#### Step 2: Implement New Code
```<language>
// New implementation
class <NewImplementation> implements <InterfaceName> {
  // New implementation code
}
```

#### Step 3: Add Feature Flag
```<language>
// Feature flag to switch between implementations
const useNewImplementation = process.env.USE_NEW_IMPL === 'true';

const implementation = useNewImplementation 
  ? new <NewImplementation>()
  : new <OldImplementation>();
```

#### Step 4: Gradual Migration
- Start with feature flag off (old implementation)
- Enable for small subset
- Monitor and verify
- Gradually increase

### 5. Rollback Plan
- **How to rollback**: Disable feature flag
- **When to rollback**: If errors increase, behavior changes, performance degrades
- **Rollback triggers**: Error rate threshold, performance threshold

### 6. Verification Checklist
- [ ] Characterization tests pass for both implementations
- [ ] Feature flag works correctly
- [ ] Monitoring is in place
- [ ] Rollback plan is tested
- [ ] Gradual migration plan is defined

### 7. Documentation
Document:
- What is being refactored
- Why strangler pattern is being used
- Migration timeline
- Rollback procedure
- Success criteria

## Rules
- Never remove old code until new code is proven
- Always have a rollback plan
- Migrate gradually, not all at once
- Monitor closely during migration
- Keep old code for sufficient time before removal


