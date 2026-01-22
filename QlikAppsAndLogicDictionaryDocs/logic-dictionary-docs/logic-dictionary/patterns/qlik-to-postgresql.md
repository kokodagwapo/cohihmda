# Qlik to PostgreSQL Translation Reference

This document provides a quick reference guide for translating common Qlik patterns to PostgreSQL.

## Quick Reference Table

| Qlik Pattern | PostgreSQL Equivalent | Notes |
|--------------|----------------------|-------|
| Date Flags | Functions (`is_rolling_13_month()`) | See `date-period-filtering.md` |
| Dual() | Two columns or DATE_TRUNC | See `dual-display-sort.md` |
| ApplyMap() | JOIN to mapping table | See `mapping-lookups.md` |
| YearMonth | DATE_TRUNC('month', date) | See `date-groupings.md` |
| NullAsValue | COALESCE(field, 'default') | See `null-handling.md` |
| RangeSum() | COALESCE(f1,0) + COALESCE(f2,0) | See `aggregation-patterns.md` |
| WildMatch() | field ILIKE '%pattern%' | See `aggregation-patterns.md` |
| Class() | CASE WHEN ... THEN ... END | See `aggregation-patterns.md` |

## Function Mappings

### Date Functions

| Qlik | PostgreSQL |
|------|------------|
| `Year([Date])` | `EXTRACT(YEAR FROM date_field)` |
| `Month([Date])` | `EXTRACT(MONTH FROM date_field)` |
| `Day([Date])` | `EXTRACT(DAY FROM date_field)` |
| `WeekDay([Date])` | `EXTRACT(DOW FROM date_field)` |
| `MonthStart([Date])` | `DATE_TRUNC('month', date_field)` |
| `QuarterStart([Date])` | `DATE_TRUNC('quarter', date_field)` |
| `YearStart([Date])` | `DATE_TRUNC('year', date_field)` |
| `AddMonths([Date], -13)` | `date_field - INTERVAL '13 months'` |
| `AddYears([Date], -1)` | `date_field - INTERVAL '1 year'` |
| `Today()` | `CURRENT_DATE` |
| `Date(Floor([Date]))` | `DATE(date_field)` |

### String Functions

| Qlik | PostgreSQL |
|------|------------|
| `Len([Field])` | `LENGTH(field)` or `CHAR_LENGTH(field)` |
| `Trim([Field])` | `TRIM(field)` |
| `Upper([Field])` | `UPPER(field)` |
| `Lower([Field])` | `LOWER(field)` |
| `WildMatch(Field, '*Pattern*')` | `field ILIKE '%Pattern%'` |
| `SubField([Field], '|', 1)` | `SPLIT_PART(field, '|', 1)` |
| `Replace([Field], 'old', 'new')` | `REPLACE(field, 'old', 'new')` |
| `Left([Field], 5)` | `LEFT(field, 5)` |
| `Right([Field], 5)` | `RIGHT(field, 5)` |
| `Mid([Field], 3, 2)` | `SUBSTRING(field FROM 3 FOR 2)` |

### Numeric Functions

| Qlik | PostgreSQL |
|------|------------|
| `Sum([Field])` | `SUM(field)` |
| `Count([Field])` | `COUNT(field)` or `COUNT(*)` |
| `Avg([Field])` | `AVG(field)` |
| `Min([Field])` | `MIN(field)` |
| `Max([Field])` | `MAX(field)` |
| `Round([Field], 2)` | `ROUND(field, 2)` |
| `Num([Field], '#,##0.00')` | `TO_CHAR(field, 'FM999,999,990.00')` |
| `RangeSum([F1], [F2])` | `COALESCE(f1, 0) + COALESCE(f2, 0)` |

### Conditional Functions

| Qlik | PostgreSQL |
|------|------------|
| `If([Condition], 'Yes', 'No')` | `CASE WHEN condition THEN 'Yes' ELSE 'No' END` |
| `IsNull([Field])` | `field IS NULL` |
| `Dual('Display', SortValue)` | Two columns or DATE_TRUNC |

## Set Analysis Translation

### Basic Set Analysis
**Qlik**: `{$<[Field]={Value}>}`  
**PostgreSQL**: `WHERE field = 'Value'`

### Multiple Values
**Qlik**: `{$<[Field]={Value1, Value2}>}`  
**PostgreSQL**: `WHERE field IN ('Value1', 'Value2')`

### Exclusion
**Qlik**: `{$<[Field]={-Value}>}`  
**PostgreSQL**: `WHERE field != 'Value'`

### Range
**Qlik**: `{$<[Field]={">350<900"}>}`  
**PostgreSQL**: `WHERE field > 350 AND field < 900`

### Wildcard
**Qlik**: `{$<[Field]={"*Retail*"}>}`  
**PostgreSQL**: `WHERE field ILIKE '%Retail%'`

### Multiple Conditions
**Qlik**: `{$<[Field1]={Value1}, [Field2]={Value2}>}`  
**PostgreSQL**: `WHERE field1 = 'Value1' AND field2 = 'Value2'`

### OR Conditions
**Qlik**: `{$<[Field]={Value1}>+<[Field]={Value2}>}`  
**PostgreSQL**: `WHERE field = 'Value1' OR field = 'Value2'`

## Variable Translation

### Simple Variables
**Qlik**: `LET vVariable = 'Value';`  
**PostgreSQL**: Configuration table or parameter:
```sql
CREATE TABLE app_config (
    config_key VARCHAR(100) PRIMARY KEY,
    config_value TEXT
);
```

### Calculated Variables
**Qlik**: `LET vVariable = Sum([Field]);`  
**PostgreSQL**: Computed column or view:
```sql
CREATE VIEW loan_summary AS
SELECT *, SUM(field) OVER () as v_variable FROM loans;
```

### Expression Variables
**Qlik**: `SET vVariable = '=Count({$<...>}[Loan Number])';`  
**PostgreSQL**: Stored procedure or function:
```sql
CREATE OR REPLACE FUNCTION get_variable_value()
RETURNS INTEGER AS $$
BEGIN
    RETURN (SELECT COUNT(*) FROM loans WHERE ...);
END;
$$ LANGUAGE plpgsql;
```

## Common Patterns

### Date Flag Generation
**Qlik**:
```qvs
If([Date] > $(vMaxDate), 'No',
   if([Date] >= AddMonths(MonthEnd($(vMaxDate)), -13, 1), 'Yes', 'No')) 
   as [Rolling13MonthFlag]
```

**PostgreSQL**:
```sql
CASE 
    WHEN date_field > CURRENT_DATE THEN FALSE
    WHEN date_field >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '13 months' 
    THEN TRUE
    ELSE FALSE
END as rolling_13_month_flag

-- Or use function:
is_rolling_13_month(date_field)
```

### Turn Time Calculation
**Qlik**:
```qvs
Date(Floor([Funding Date])) - Date(Floor([Application Date])) as [App-Fund]
```

**PostgreSQL**:
```sql
DATE(funding_date) - DATE(application_date) as app_fund_days
```

### Revenue Aggregation
**Qlik**:
```qvs
RangeSum([Origination Revenue], [Secondary Revenue]) as [Total Revenue]
```

**PostgreSQL**:
```sql
COALESCE(origination_revenue, 0) + COALESCE(secondary_revenue, 0) as total_revenue
```

### Complexity Score
**Qlik**:
```qvs
RangeSum([Loan Purpose Complexity], [Loan Type Complexity], ...) as [Loan Complexity Score]
```

**PostgreSQL**:
```sql
COALESCE(loan_purpose_complexity, 0) + 
COALESCE(loan_type_complexity, 0) + 
... as loan_complexity_score
```

## Translation Principles

1. **Functions over Columns**: Use functions/views instead of pre-computed columns where possible
2. **NULL Handling**: Use COALESCE for NULL-safe operations
3. **Pattern Matching**: Use ILIKE for case-insensitive matching
4. **Date Operations**: Use DATE_TRUNC and INTERVAL for date calculations
5. **Aggregations**: Use window functions or subqueries for complex aggregations
6. **Formatting**: Keep data as native types, format in application layer

## Performance Considerations

### Indexes
- Create indexes on filtered columns
- Use functional indexes for period functions
- Index foreign keys and join columns

### Materialized Views
- Use for expensive aggregations that don't need real-time updates
- Refresh periodically or on schedule

### Functions
- Mark functions as IMMUTABLE when possible
- Use STABLE for functions that depend on current date/time
- Create functional indexes for frequently-used functions

## Migration Checklist

- [ ] Map all Qlik data types to PostgreSQL
- [ ] Convert all Qlik functions to PostgreSQL equivalents
- [ ] Translate set analysis to WHERE clauses
- [ ] Convert variables to config tables or parameters
- [ ] Create custom functions for NetWorkDays, period checks, etc.
- [ ] Set up indexes on filtered columns
- [ ] Create materialized views for common aggregations
- [ ] Test performance with production-like data volumes
- [ ] Validate calculations match Qlik results

## See Also

- `date-period-filtering.md` - Date flag patterns
- `dual-display-sort.md` - Dual() pattern
- `mapping-lookups.md` - ApplyMap() pattern
- `date-groupings.md` - YearMonth patterns
- `null-handling.md` - NULL handling patterns
- `aggregation-patterns.md` - RangeSum, Class, WildMatch patterns
