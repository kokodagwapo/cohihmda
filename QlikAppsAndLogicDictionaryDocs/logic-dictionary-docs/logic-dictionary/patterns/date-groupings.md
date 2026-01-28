# Date Groupings - Qlik Pattern → PostgreSQL Translation

## Qlik Pattern: Pre-computed YearMonth Fields

In Qlik, date groupings are pre-computed:

```qvs
$(fYearMonth("Application Date")) AS [Application YearMonth]
// Results in: "1-2024" (display) with MonthStart() as sort value
```

**Why Qlik pre-computes:**
- Display formatting (MM-YYYY string)
- Sort value (date for proper ordering)
- Used in many expressions

## PostgreSQL Translation: Functions

In PostgreSQL, compute on-the-fly with functions:

```sql
-- For display and grouping
DATE_TRUNC('month', application_date) as application_yearmonth

-- For formatted display (if needed)
TO_CHAR(application_date, 'MM-YYYY') as application_yearmonth_display

-- For sorting (use the DATE_TRUNC value directly)
-- PostgreSQL DATE type sorts correctly
```

**Benefits:**
- No storage overhead
- Flexible - can use any date field
- Standard PostgreSQL date functions

## Common Date Grouping Functions

### YearMonth
```sql
DATE_TRUNC('month', date_field) as yearmonth
```

### YearQuarter
```sql
DATE_TRUNC('quarter', date_field) as yearquarter
```

### YearWeek
```sql
DATE_TRUNC('week', date_field) as yearweek
```

### Year
```sql
EXTRACT(YEAR FROM date_field) as year
-- or
DATE_TRUNC('year', date_field) as year_start
```

### Month
```sql
EXTRACT(MONTH FROM date_field) as month
```

### YearMonthNum (Numeric)
```sql
-- Convert to numeric format (YYYYMM)
EXTRACT(YEAR FROM date_field) * 100 + EXTRACT(MONTH FROM date_field) as yearmonthnum
-- Example: 202401 for January 2024
```

## Examples

### Application Date Groupings
```sql
SELECT 
    DATE_TRUNC('month', application_date) as application_yearmonth,
    DATE_TRUNC('quarter', application_date) as application_yearquarter,
    DATE_TRUNC('week', application_date) as application_yearweek,
    EXTRACT(YEAR FROM application_date) as application_year,
    EXTRACT(MONTH FROM application_date) as application_month
FROM loans;
```

### Funding Date Groupings
```sql
SELECT 
    DATE_TRUNC('month', funding_date) as funding_yearmonth,
    DATE_TRUNC('quarter', funding_date) as funding_yearquarter,
    EXTRACT(YEAR FROM funding_date) as funding_year
FROM loans
WHERE funding_date IS NOT NULL;
```

## Grouping with Aggregation

```sql
-- Group by yearmonth for aggregation
SELECT 
    DATE_TRUNC('month', application_date) as application_yearmonth,
    COUNT(*) as loan_count,
    SUM(loan_amount) as total_volume,
    AVG(app_fund_days) as avg_turn_time
FROM loans
GROUP BY DATE_TRUNC('month', application_date)
ORDER BY application_yearmonth;
```

## YearMonth Group (Older Dates Bucketed)

**Qlik Pattern**:
```qvs
if($(fYearMonth("Application Date"))<addmonths(monthend($(vMaxDate)),-5),
   '<= ' & Date(AddMonths(monthend($(vMaxDate)),-5),'MMM-YYYY'),
   $(fYearMonth("Application Date"))) as [Application YearMonth Group]
```

**PostgreSQL**:
```sql
CASE 
    WHEN DATE_TRUNC('month', application_date) < DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months' THEN
        '<= ' || TO_CHAR(DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months', 'Mon-YYYY')
    ELSE TO_CHAR(DATE_TRUNC('month', application_date), 'Mon-YYYY')
END as application_yearmonth_group
```

## Migration Notes

- **Do NOT create computed columns** for YearMonth/YearQuarter/YearWeek
- **Use DATE_TRUNC functions directly** in queries
- **Can create views** if needed for consistency across queries
- **Formatting (MM-YYYY)** can be done in application layer if needed
- **DATE_TRUNC values sort correctly** - no need for separate sort columns

## Performance Considerations

### Indexes on Date Fields

```sql
-- Index on date field for grouping queries
CREATE INDEX idx_loans_application_date ON loans(application_date);

-- Partial index for specific date ranges
CREATE INDEX idx_loans_funding_date_recent 
ON loans(funding_date) 
WHERE funding_date >= CURRENT_DATE - INTERVAL '2 years';
```

### Materialized Views (For Aggregations)

If you frequently aggregate by date groupings:

```sql
CREATE MATERIALIZED VIEW loan_summary_by_month AS
SELECT 
    DATE_TRUNC('month', application_date) as application_yearmonth,
    channel,
    COUNT(*) as loan_count,
    SUM(loan_amount) as total_volume,
    AVG(app_fund_days) as avg_turn_time
FROM loans
GROUP BY DATE_TRUNC('month', application_date), channel;

CREATE INDEX ON loan_summary_by_month(application_yearmonth, channel);

-- Refresh periodically
REFRESH MATERIALIZED VIEW CONCURRENTLY loan_summary_by_month;
```

## Best Practice

**Recommended**: Use DATE_TRUNC directly in queries:

```sql
-- Simple and flexible
SELECT 
    DATE_TRUNC('month', application_date) as application_yearmonth,
    COUNT(*) as loan_count
FROM loans
GROUP BY DATE_TRUNC('month', application_date)
ORDER BY application_yearmonth;
```

**Optional**: Create views for consistency:

```sql
CREATE VIEW loans_with_date_groupings AS
SELECT 
    *,
    DATE_TRUNC('month', application_date) as application_yearmonth,
    DATE_TRUNC('quarter', application_date) as application_yearquarter,
    DATE_TRUNC('year', application_date) as application_year_start,
    EXTRACT(YEAR FROM application_date) as application_year,
    EXTRACT(MONTH FROM application_date) as application_month
FROM loans;
```

This approach:
- Keeps queries simple
- No storage overhead
- Flexible for any date field
- Standard PostgreSQL functions
