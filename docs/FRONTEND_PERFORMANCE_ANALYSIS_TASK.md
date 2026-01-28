# Frontend Performance Analysis Task

## Objective

Analyze the frontend data fetching patterns, state management, and rendering behavior to identify performance bottlenecks causing lag. Propose optimizations to make the application significantly snappier.

---

## Context

This is a React + TypeScript dashboard application for mortgage loan pipeline management. The main dashboard component (`ClosingFalloutForecast.tsx`) displays KPIs, loan cards, and predictive analytics. Users are experiencing lag/sluggishness when interacting with the dashboard.

**Tech Stack:**
- React 18 with TypeScript
- Vite for bundling
- TailwindCSS for styling
- Custom API client (`src/lib/api.ts`)
- React hooks for state management (no Redux/Zustand)

---

## Key Files to Analyze

### Primary Dashboard Component
- `src/components/dashboard/ClosingFalloutForecast.tsx` (~1650 lines)
  - Main dashboard with KPIs, period selector, prediction trigger
  - Multiple `useState`, `useMemo`, `useCallback`, `useEffect` hooks
  - Lazy loan loading with session caching
  - Metrics computation with precomputation strategy

### Data Hooks
- `src/hooks/useDashboardStats.ts` - Dashboard statistics fetching
- `src/hooks/useKnowledgeBase.ts` - Knowledge base data

### API Layer
- `src/lib/api.ts` - API client implementation

### Child Components
- `src/components/dashboard/LoanCardsContainer.tsx` - Displays loan cards grid
- `src/components/dashboard/LoanDrilldownModal.tsx` - Loan detail modal
- `src/components/dashboard/modals/` - Various modal components

---

## Known Patterns to Investigate

### 1. Data Fetching
- How many API calls are made on initial load?
- Are there redundant or duplicate fetches?
- Is data being refetched unnecessarily on re-renders?
- Are requests properly debounced/throttled?

### 2. State Management
- Large state objects being updated frequently?
- State updates causing cascading re-renders?
- Proper use of `useMemo` and `useCallback` for memoization?
- Are derived values being recomputed unnecessarily?

### 3. Metrics Computation
The dashboard computes metrics from loan data:
```typescript
// Session-scoped metrics cache
const metricsCacheRef = useRef<{
  cache: Map<string, ReturnType<typeof computeMetricsFromLoans>>;
  dataVersion: any[] | null;
  predictionsVersion: { ... } | null;
}>({ cache: new Map(), dataVersion: null, predictionsVersion: null });
```
- Is the caching effective?
- Is `requestIdleCallback` for precomputation working as intended?

### 4. Rendering
- Are lists properly virtualized for large datasets?
- Are expensive components wrapped in `React.memo`?
- Are there unnecessary DOM updates?
- Animation/transition performance?

### 5. Loan Data Loading
```typescript
// Lazy loan loading pattern
const [loansRaw, setLoansRaw] = useState<any[] | null>(null);
const [loansLoading, setLoansLoading] = useState(false);
```
- 5000 loan limit - is this causing issues?
- When is data loaded vs re-fetched?

### 6. Prediction Flow
- Backend prediction call can process many loans
- Bucketed loan data is stored in state
- Does this cause render blocking?

---

## Specific Questions to Answer

1. **Initial Load Performance**
   - What's the critical rendering path?
   - What blocks first meaningful paint?
   - Are there render-blocking data fetches?

2. **Interaction Responsiveness**
   - What happens when user changes period selector?
   - What happens when user clicks "Start Prediction"?
   - What happens when user opens a loan modal?

3. **Memory & State**
   - How much data is held in React state?
   - Are there memory leaks from subscriptions/effects?
   - Is state being duplicated unnecessarily?

4. **Network Waterfall**
   - Are API calls sequential when they could be parallel?
   - Is there proper caching (HTTP cache headers, SWR pattern)?
   - Are large payloads being transferred?

---

## Expected Deliverables

1. **Performance Audit Report**
   - Identify top 5 performance bottlenecks
   - Measure current metrics (if possible)
   - Root cause analysis for each issue

2. **Optimization Plan**
   - Prioritized list of fixes
   - Estimated impact of each fix
   - Implementation approach

3. **Specific Recommendations**
   - Code-level changes needed
   - Architectural changes if necessary
   - Quick wins vs longer-term improvements

---

## Tools & Techniques to Use

- React DevTools Profiler
- Chrome Performance tab
- Network waterfall analysis
- Bundle analysis (`vite-plugin-visualizer` or similar)
- Lighthouse audit
- Code review of render cycles

---

## Success Criteria

- Dashboard loads and becomes interactive faster
- Period selector changes feel instant
- Modal opens feel snappy
- No visible jank during scrolling or interactions
- Reduced unnecessary network requests

---

## Notes

- The backend prediction endpoint (`/api/loans/predict`) is already optimized with rule-based bucketing (instant, no AI wait)
- The `loansRaw` array can contain up to 5000 loans
- Metrics are precomputed for common periods using `requestIdleCallback`
- Some components have complex conditional rendering logic
