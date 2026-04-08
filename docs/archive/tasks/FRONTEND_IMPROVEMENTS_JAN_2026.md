# Frontend Improvements - January 2026

This document summarizes the frontend bug fixes and improvements made during the backend routes consolidation work.

## Summary

During the backend API consolidation effort, several frontend issues were identified and resolved. These fixes ensure the application remains stable while backend endpoints are being migrated.

---

## 1. API Endpoint Compatibility Fixes

### Issue
After migrating backend endpoints to new consolidated routes (`/api/scorecard/*`, `/api/toptiering/*`, `/api/predictions/*`), the frontend components broke because the new endpoints returned data in a different format than expected.

### Error
```
Uncaught TypeError: Cannot convert undefined or null to object
    at Object.values (<anonymous>)
    at OperationScorecardTrendsView.tsx:88:25
```

### Root Cause
The new endpoints returned simplified response structures that didn't match the complex nested formats expected by the frontend components. For example, actors were expected to have a `months` object keyed by year-month, but the new endpoint returned a `monthlyData` array.

### Solution
Reverted all affected hooks to use the original endpoints (which are still functional) until the new endpoints can be updated to match the expected response formats.

### Files Modified

| Hook File | Original Endpoint | New Endpoint (reverted) |
|-----------|-------------------|-------------------------|
| `useOperationsScorecardTrendsData.ts` | `/api/loans/operations-scorecard-trends` | `/api/scorecard/operations-trends` |
| `useSalesScorecardData.ts` | `/api/loans/sales-scorecard` | `/api/scorecard/sales` |
| `useOperationsScorecardData.ts` | `/api/loans/operations-scorecard` | `/api/scorecard/operations` |
| `useTopTieringData.ts` | `/api/loans/toptiering` | `/api/toptiering` |
| `useTopTieringComparisonData.ts` | `/api/loans/toptiering-comparison` | `/api/toptiering/comparison` |
| `useSalesTrendsData.ts` | `/api/loans/sales-trends` | `/api/scorecard/sales-trends` |

### Status
- Original endpoints remain functional with backward compatibility
- New consolidated endpoints exist but need response format alignment
- TODO: Update new endpoints to match expected frontend data structures

---

## 2. ChannelSelector Component Fixes

### Issue A: Empty String Values Breaking Select Component

#### Error
```
Uncaught Error: A <Select.Item /> must have a value prop that is not an empty string.
```

#### Root Cause
Some channels or channel groups returned from the API had empty string values. Radix UI's Select component reserves empty string for "no selection" state.

#### Solution
Added filtering in `ChannelSelector.tsx` to exclude channels/groups with empty or whitespace-only values:

```typescript
// Filter out any channels/groups with empty string values (breaks Radix Select)
const validChannels = (data.channels || []).filter(c => c.channel && c.channel.trim() !== '');
const validChannelGroups = (data.channelGroups || []).filter(g => g.group && g.group.trim() !== '');
```

### Issue B: "No Tenant Selected" Error on Admin Page

#### Error
```
[ChannelSelector] Error fetching channels: Error: No tenant selected
```

#### Root Cause
The ChannelSelector component was rendering in the navigation header on all pages, including the Admin page. For platform admins (super_admin) who haven't selected a tenant, the `/api/loans/channels` endpoint returns an error.

#### Solution
Modified `Navigation.tsx` to hide the ChannelSelector on admin pages:

```typescript
{/* Channel Selector - Compact in header (hidden on admin pages) */}
{isAuthenticated && !isAdminPage && (
  <div className="hidden sm:flex items-center">
    <ChannelSelector ... />
  </div>
)}
```

### Files Modified
- `src/components/dashboard/ChannelSelector.tsx`
- `src/components/layout/Navigation.tsx`

---

## 3. TenantSelectorCard Fixes (Super Admin)

### Issue
Super admins could not access the Admin page due to Select component errors.

#### Error
```
Uncaught Error: A <Select.Item /> must have a value prop that is not an empty string.
```

#### Root Cause
The `TenantSelectorCard.tsx` component used `<SelectItem value="">` for the "All Tenants" and "Select a tenant" options. Radix UI Select does not allow empty string values.

### Solution
Changed empty string values to non-empty placeholder values:

| Location | Before | After |
|----------|--------|-------|
| Compact version | `value=""` (All Tenants) | `value="__all__"` |
| Full card version | `value=""` (Select placeholder) | `value="__none__"` |

Updated the value binding and onChange handlers accordingly:

```typescript
// Before
value={selectedTenantId || ''}
onValueChange={(value) => setSelectedTenantId(value || null)}

// After
value={selectedTenantId || '__all__'}
onValueChange={(value) => setSelectedTenantId(value === '__all__' ? null : value)}
```

### Files Modified
- `src/components/admin/TenantSelectorCard.tsx`

---

## 4. Login Page Tenant Selector Fix

### Issue
Preemptive fix for the same Radix UI Select empty value issue on the Login page.

### Solution
Changed the "Auto-detect / Cohi Admin" option from empty string to a placeholder value:

```typescript
// State initialization
const [selectedTenant, setSelectedTenant] = useState<string>('__auto__');

// SelectItem
<SelectItem value="__auto__">
  <span className="flex items-center gap-2">
    <Shield className="h-4 w-4 text-amber-500" />
    Auto-detect / Cohi Admin
  </span>
</SelectItem>

// Login call
await login(email.trim(), password, selectedTenant === '__auto__' ? undefined : selectedTenant);
```

### Files Modified
- `src/pages/Login.tsx`

---

## Best Practices Established

### 1. Radix UI Select Component
Never use empty string (`""`) as a `SelectItem` value. Use meaningful placeholder values like:
- `__all__` for "all items" options
- `__none__` for "no selection" placeholders
- `__auto__` for auto-detect options

### 2. API Response Format Changes
When consolidating or migrating API endpoints:
1. Document the expected response format from frontend components
2. Ensure new endpoints match the expected format exactly
3. Test with the actual frontend components before switching
4. Keep original endpoints functional during migration

### 3. Context-Aware Component Rendering
Components that depend on specific contexts (like tenant selection) should:
1. Check for required context before making API calls
2. Handle missing context gracefully with appropriate UI states
3. Be conditionally rendered on pages where context may not be available

---

## Testing Recommendations

After these changes, verify the following pages work correctly:

1. **Dashboard/Insights Page** (`/insights`)
   - Channel selector visible and functional
   - All scorecard views load without errors
   - Top-tiering comparisons work

2. **Admin Page** (`/admin`)
   - Super admins can access without errors
   - Tenant selector works for platform admins
   - Channel selector is hidden

3. **Login Page** (`/login`)
   - Tenant selector works when expanded
   - Auto-detect option functions correctly

4. **Operation Scorecard Trends** (`/operation-scorecard-trends`)
   - Data loads and displays correctly
   - Monthly breakdowns render properly

---

## 5. Leaderboard Section Refactoring

### Issue A: Points vs Units Display

#### Problem
The leaderboard was displaying a composite "points" score instead of actual loan units. The score was calculated as:
```typescript
points = (loansClosed * 60) + (totalVolume / 10000) + (pullThroughRate * 10)
```

Users expected to see actual loan counts (units), not a gamified points score.

#### Solution
Changed all displays to show `leader.loans` (actual loan count) instead of `leader.points`:

| Location | Before | After |
|----------|--------|-------|
| Main card display | `{leader.points}` "points" | `{leader.loans}` "units" |
| Others list | `{leader.points}` | `{leader.loans} units` |
| Modal popup | `{leader.points}` "pts" | `{leader.loans}` "units" |

Also updated stats row labels to match business metrics:
- **Volume** - Loan count
- **Turn-Time** - Cycle time in days
- **Pull-through** - Pull-through rate %
- **Revenue** - Dollar volume

Updated achievement badges from (Pipeline, Fast Funder, Pull-Through, Rate Lock, On-Time) to (Units, Volume, Turn-Time, Pull-through, Revenue).

### Issue B: DatePeriodPicker Integration

#### Problem
The leaderboard had limited timeframe options (WTD, MTD, QTD) and defaulted to MTD. Business users wanted more period options including "Last Quarter" as the default.

#### Solution
Refactored `LeaderBoardSection.tsx` to use a DatePeriodPicker-style period selector with:

**New Period Options:**
| Group | Periods | Description |
|-------|---------|-------------|
| To-Date | WTD, MTD, QTD | Week/Month/Quarter to date |
| Last Periods | LW, LM, **LQ** (default), LY | Last Week/Month/Quarter/Year |
| Custom | Calendar picker | User-selected date range |

**Implementation:**
- Added `date-fns` functions for date calculations (`subQuarters`, `startOfQuarter`, `endOfQuarter`, etc.)
- Added Calendar popup using `Popover` and `Calendar` components
- Passes calculated `startDate`/`endDate` to the `useLeaderboardData` hook
- **Default changed from MTD to Last Quarter (LQ)**

### Issue C: Fallback Data Showing Zeros

#### Problem
When the API didn't return data, the fallback sample data showed all zeros, making the UI look broken.

#### Solution
Updated `baseLeadersData` with realistic sample values:

```typescript
// Before
{ name: 'Sarah Chen', points: 0, loans: 0, pullThru: 0, ... }

// After
{ name: 'Sarah Chen', points: 47, loans: 28, pullThru: 94, cycleTime: 28, revenue: '$8.2M', badges: ['Top Performer'], ... }
```

### Files Modified
- `src/components/dashboard/LeaderBoardSection.tsx`

---

## 6. Tier Color Standardization

### Issue
Tier colors across TopTiering and Scorecard pages were inconsistent and needed to be updated to match the new brand colors.

### New Tier Colors
| Tier | Hex Color | Usage |
|------|-----------|-------|
| Top Tier | `#00008F` | Dark blue |
| Second Tier | `#52B852` | Green |
| Bottom Tier | `#B2DCB2` | Light green |

### Solution
1. **Added custom Tailwind colors** in `tailwind.config.ts`:
```typescript
colors: {
  "tier-top": {
    DEFAULT: "#00008F",
    light: "rgba(0, 0, 143, 0.1)",
    dark: "rgba(0, 0, 143, 0.3)",
  },
  "tier-second": {
    DEFAULT: "#52B852",
    light: "rgba(82, 184, 82, 0.1)",
    dark: "rgba(82, 184, 82, 0.3)",
  },
  "tier-bottom": {
    DEFAULT: "#B2DCB2",
    light: "rgba(178, 220, 178, 0.15)",
    dark: "rgba(178, 220, 178, 0.25)",
  },
}
```

2. **Updated UI components** to use semantic tier color classes (`bg-tier-top`, `text-tier-second`, `border-tier-bottom`, etc.)

3. **Updated chart functions** (`getTierColor`, `getTierLightColor`) to return new hex values for Recharts

### Files Modified
| File | Changes |
|------|---------|
| `tailwind.config.ts` | Added tier color definitions |
| `src/pages/CompanyScorecard.tsx` | Table headers, cell backgrounds |
| `src/pages/SalesScorecard.tsx` | Table headers, tier badges, legend text |
| `src/components/dashboard/views/TopTieringComparisonView.tsx` | Pareto chart bars, tier styles |
| `src/components/dashboard/views/OperationsScorecardView.tsx` | Table headers, insight cards, progress bars |
| `src/components/dashboard/views/OperationScorecardTrendsView.tsx` | Tier color functions, progress bars |
| `src/components/dashboard/modals/TopTieringModal.tsx` | Header gradient, tab indicator, list items |
| `src/components/dashboard/ReportModal.tsx` | Line chart strokes |
| `src/data/reportSimulations.ts` | Chart data colors |

---

## 7. TopTiering Sidebar Integration

### Issue
The TopTiering sidebar navigation was not appearing on dashboard/mashboard pages (formerly TopTiering components).

### Solution
Integrated `TopTieringSidebar` and `TopTieringTopBar` components directly into the affected pages.

### Files Modified
- Multiple dashboard view pages under `src/pages/` and `src/components/dashboard/views/`

---

## 8. Navigation and Branding Updates

### Issue A: Navigation Tab Restructuring
The "Top Tiering" navigation button needed to be renamed to "Dashboard" with updated dropdown content.

### Issue B: Insights Page Sidebar
The sidebar on the `/insights` page was using the old design instead of the new hierarchical navigation.

### Issue C: Cohi to Cohi Rebrand
Various UI elements still referenced "Cohi" instead of "Cohi".

### Solution
- Renamed navigation buttons and updated dropdown structures
- Replaced `ReportsSidebar` with updated design including route integration
- Updated branding references throughout the UI

### Files Modified
- `src/components/layout/Navigation.tsx`
- `src/components/layout/ReportsSidebar.tsx`
- Various components with Cohi references

---

## Future Work

1. **Align New Endpoint Response Formats**: Update the new consolidated endpoints (`/api/scorecard/*`, `/api/toptiering/*`, `/api/predictions/*`) to return data in the exact format expected by frontend components.

2. **Switch Hooks to New Endpoints**: Once response formats are aligned, update the frontend hooks to use the new endpoints and remove the deprecation comments.

3. **Remove Deprecated Endpoints**: After confirming all consumers have migrated, the old endpoints in `loans.ts` can be removed.

4. **Leaderboard API Enhancement**: Consider adding a dedicated `/api/leaderboard` endpoint that supports all the new period filters (LW, LM, LQ, LY) natively instead of relying on custom date ranges.

---

*Document created: January 28, 2026*
*Last updated: January 27, 2026*
