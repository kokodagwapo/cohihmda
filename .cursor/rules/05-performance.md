# Performance Rules

## Performance Review Philosophy

### 1. Evidence-Based Performance Analysis
- Performance concerns must be based on:
  - Code patterns in the diff that are known performance risks
  - Actual performance problems reported by the user
  - Measurable performance regressions
- Do NOT speculate about performance without evidence
- Do NOT optimize code that isn't a bottleneck

### 2. Hot Path Identification
- Identify hot paths from:
  - Code that runs in request/response cycles
  - Code in loops or recursive functions
  - Code that processes large datasets
  - Code that makes external API calls
- Flag performance risks in hot paths
- Do NOT optimize code outside hot paths unless explicitly requested

### 3. N+1 Query Detection
- Look for loops that make database queries
- Look for loops that make API calls
- Suggest batching or eager loading when N+1 patterns are found
- Only flag if the pattern is in the diff

### 4. Loop Risk Detection
- Nested loops are performance risks
- Loops over large datasets are performance risks
- Loops that make external calls are performance risks
- Flag these patterns when present in the diff
- Do NOT flag loops that are clearly necessary and efficient

### 5. Payload Size Guidance
- Large payloads (e.g., >1MB) may be performance risks
- Unbounded arrays in API responses are risks
- Suggest pagination or streaming for large datasets
- Only flag if payload size is in the diff

### 6. Render Performance (Frontend)
- Large component trees may be performance risks
- Unnecessary re-renders are performance risks
- Heavy computations in render functions are risks
- Only flag if render performance issues are in the diff

### 7. Caching Guidance
- Suggest caching for:
  - Expensive computations
  - External API calls
  - Database queries that don't change often
- Do NOT suggest caching without understanding the use case
- Respect existing caching patterns

### 8. Async/Await Patterns
- Use async/await for I/O operations
- Don't block the event loop with synchronous operations
- Use Promise.all for parallel operations when possible
- Flag blocking operations in hot paths

### 9. Database Query Performance
- Parameterized queries are required (security + performance)
- Suggest indexes for frequently queried columns (if schema changes)
- Suggest query optimization only if queries are in the diff
- Do NOT suggest database changes without understanding the schema

### 10. External Service Calls
- Set timeouts on external calls
- Use connection pooling when available
- Batch requests when possible
- Flag missing timeouts or connection management

### 11. Memory Management
- Large objects in memory may be risks
- Memory leaks (unclosed connections, event listeners) are risks
- Flag memory issues only if present in the diff
- Do NOT speculate about memory usage

### 12. Performance Testing
- Performance tests should measure actual metrics
- Use benchmarks or profiling tools when available
- Do NOT require performance tests unless:
  - Performance is explicitly a concern
  - The change is in a known hot path
  - User requests performance testing

### 13. Premature Optimization
- Do NOT optimize code that isn't proven to be slow
- Do NOT suggest optimizations that reduce code clarity significantly
- Focus on correctness and security first, performance second
- Only optimize when there's evidence of a problem

### 14. Performance Review Scope
- Review performance of code in the diff only
- Check for performance regressions
- Suggest optimizations only if they're low-risk
- Do NOT review performance of unchanged code

### 15. Unknown Performance Patterns
- If performance patterns are unclear, document uncertainty
- Ask for performance requirements if needed
- Do NOT assume performance characteristics
- Do NOT introduce performance optimizations without understanding the system


