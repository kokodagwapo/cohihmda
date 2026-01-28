# Turn Time - Base Concept

## Definition

Turn time measures the duration between two milestone dates in a loan lifecycle. It represents the number of days (or business days) that elapse from one milestone to another.

## Source Fields

Turn time calculations use date fields from the [Coheus Data Dictionary](../data-dictionary/CoheusDataDictionary.xml):

**Common Date Fields**:
- `Application Date` (Encompass: `Fields.3142`)
- `Funding Date` (Encompass: `Fields.MS.FUN`)
- `Closing Date` (Encompass: `Fields.748`)
- `Estimated Closing Date` (Encompass: `Fields.763`)
- `Investor Purchase Date` (Encompass: `Fields.2370`)
- `Shipped Date` (Encompass: `Fields.2014`)
- `UW Final Approval Date` (Encompass: `Fields.2301`)
- `CTC Date` (Encompass: `Fields.2305`)
- `Started Date` (Encompass: `Fields.Log.MS.Date.Started`)

**See**: `patterns/source-fields.md` for complete data dictionary integration guide.

## Core Formula

```
turn_time_days = DATE(end_milestone_date) - DATE(start_milestone_date)
```

Where `end_milestone_date` and `start_milestone_date` are source fields from the data dictionary.

## Types

### Calendar Days
Simple date difference calculation. This is the current standard used in the system.

**Formula**: `DATE(end_date) - DATE(start_date)`

### Business Days
Excludes weekends and holidays. This was previously used but has been deprecated in favor of calendar days.

**Formula**: `NetWorkDays(start_date, end_date, holidays)` (legacy)

## Common Turn Time Metrics

Each metric uses source date fields from the data dictionary:

- **Start-App**: `Started Date` → `Application Date`
- **App-EstClose**: `Application Date` → `Estimated Closing Date`
- **App-Close**: `Application Date` → `Closing Date`
- **App-Fund**: `Application Date` → `Funding Date`
- **App-InvPurch**: `Application Date` → `Investor Purchase Date`
- **Fund-Ship**: `Funding Date` → `Shipped Date`
- **Fund-InvPurch**: `Funding Date` → `Investor Purchase Date`
- **Ship-InvPurch**: `Shipped Date` → `Investor Purchase Date`
- **Final Appr-CTC**: `UW Final Approval Date` → `CTC Date`
- **CTC-Fund**: `CTC Date` → `Funding Date`
- **W-H Days**: `Funding Date` → `Investor Purchase Date` (or current date if not purchased)

## SQL Implementation

**Note**: PostgreSQL column names use snake_case (e.g., `application_date`), converted from Coheus aliases (e.g., `Application Date`).

```sql
-- Basic turn time calculation
-- Uses: end_date and start_date (source fields from data dictionary)
DATE(end_date) - DATE(start_date) as turn_time_days

-- Example: App-Fund
-- Source: Application Date (Fields.3142) → application_date
-- Source: Funding Date (Fields.MS.FUN) → funding_date
DATE(funding_date) - DATE(application_date) as app_fund_days

-- Example: W-H Days (warehouse line duration)
-- Source: Funding Date (Fields.MS.FUN) → funding_date
-- Source: Investor Purchase Date (Fields.2370) → investor_purchase_date
CASE 
    WHEN investor_purchase_date IS NOT NULL THEN
        investor_purchase_date - funding_date
    WHEN investor_purchase_date IS NULL AND funding_date IS NOT NULL THEN
        CURRENT_DATE - funding_date
    ELSE 0
END as w_h_days
```

## Business Rules

- Turn time is always calculated as calendar days (not business days)
- Negative values are possible if dates are out of order
- NULL dates result in NULL turn time (unless handled with fallback logic)
- For active loans without end dates, current date may be used as fallback

## Dependencies

- Requires two date fields (start and end milestone dates)
- May depend on current date for active loan calculations

## Used In

- All apps
- Turn time reporting
- Performance analysis
- Operations dashboards

## See Also

- Derived logic: `derived/turn-time-ranges.md` - Buckets and ranges for turn time values
- Qlik implementation: `core/transform-logic.md#turn-time-calculations`
- Operations app: `apps/operations-app-logic.md` - Turn time report logic
