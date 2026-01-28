# Dual Display + Sort - Qlik Pattern → PostgreSQL Translation

## Qlik Pattern: Dual() Function

In Qlik, `Dual()` creates a field with both display text and a hidden sort value:

```qvs
Dual(Month([Application Date])&'-'&Year([Application Date]),
     MonthStart([Application Date])) as [Application YearMonth]
// Display: "1-2024" (string)
// Sort: 2024-01-01 (date)
```

**Why Qlik uses Dual():**
- Display formatting (MM-YYYY string for readability)
- Sort value (date for proper chronological ordering)
- Single field serves both purposes

## PostgreSQL Translation: Two Approaches

### Approach 1: Two Columns (Recommended)

Store display and sort values separately:

```sql
-- Display column (formatted string)
TO_CHAR(application_date, 'MM-YYYY') as application_yearmonth_display

-- Sort column (date for proper ordering)
DATE_TRUNC('month', application_date) as application_yearmonth_sort

-- Use sort column for ORDER BY
ORDER BY application_yearmonth_sort
```

**Benefits:**
- Clear separation of concerns
- Easy to query and sort
- Standard PostgreSQL approach

### Approach 2: Computed Sort Column

Keep display as primary, add computed sort:

```sql
-- Display column
TO_CHAR(application_date, 'MM-YYYY') as application_yearmonth

-- Computed sort column (if needed for consistency)
DATE_TRUNC('month', application_date) as application_yearmonth_sort
```

**Benefits:**
- Maintains display format as primary
- Sort column can be indexed if needed

### Approach 3: Use Date Directly (Simplest)

For most cases, use the date directly and format in application layer:

```sql
-- Use date for both display and sort
DATE_TRUNC('month', application_date) as application_yearmonth

-- Format in application layer when displaying
-- PostgreSQL DATE type sorts correctly by default
```

**Benefits:**
- Simplest approach
- No formatting overhead
- Date type sorts correctly

## Common Dual() Patterns

### YearMonth Pattern

**Qlik**:
```qvs
Dual(Month([Date])&'-'&Year([Date]), MonthStart([Date]))
```

**PostgreSQL**:
```sql
-- Option 1: Two columns
TO_CHAR(date_field, 'MM-YYYY') as yearmonth_display,
DATE_TRUNC('month', date_field) as yearmonth_sort

-- Option 2: Date only (recommended)
DATE_TRUNC('month', date_field) as yearmonth
```

### YearQuarter Pattern

**Qlik**:
```qvs
Dual(Quarter([Date])&'-'&Year([Date]), QuarterStart([Date]))
```

**PostgreSQL**:
```sql
DATE_TRUNC('quarter', date_field) as yearquarter
```

### Range Display Pattern

**Qlik**:
```qvs
Dual(Replace(class([FICO Score], 25), '<= x <', '-'), class([FICO Score], 25))
// Display: "600-625"
// Sort: 600 (numeric)
```

**PostgreSQL**:
```sql
-- Display column
CASE 
    WHEN fico_score < 600 THEN '<600'
    WHEN fico_score < 625 THEN '600-625'
    WHEN fico_score < 650 THEN '625-650'
    -- etc
END as fico_range_display

-- Sort column (use minimum of range)
CASE 
    WHEN fico_score < 600 THEN 0
    WHEN fico_score < 625 THEN 600
    WHEN fico_score < 650 THEN 625
    -- etc
END as fico_range_sort
```

## Migration Notes

- **Do NOT replicate Dual() exactly** - use two columns or date directly
- **Formatting can be done in application layer** - no need to store formatted strings
- **Date types sort correctly** - use DATE_TRUNC for grouping/sorting
- **Two-column approach is clearest** - separate display and sort concerns
- **Computed columns optional** - only if you need consistency across queries

## Example: YearMonth Implementation

```sql
-- Create view with both display and sort
CREATE VIEW loans_with_yearmonth AS
SELECT 
    *,
    TO_CHAR(application_date, 'MM-YYYY') as application_yearmonth_display,
    DATE_TRUNC('month', application_date) as application_yearmonth_sort
FROM loans;

-- Query with proper sorting
SELECT 
    application_yearmonth_display,
    COUNT(*) as loan_count
FROM loans_with_yearmonth
GROUP BY application_yearmonth_display, application_yearmonth_sort
ORDER BY application_yearmonth_sort;
```

## Best Practice

**Recommended**: Use DATE_TRUNC directly and format in application layer:

```sql
-- Database: Store date for grouping/sorting
DATE_TRUNC('month', application_date) as application_yearmonth

-- Application: Format when displaying
-- JavaScript: formatDate(yearmonth, 'MM-YYYY')
-- Python: yearmonth.strftime('%m-%Y')
```

This approach:
- Keeps database simple
- Allows flexible formatting
- Ensures correct sorting
- Reduces storage overhead
