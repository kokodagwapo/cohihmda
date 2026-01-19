# PostgreSQL Mapping Guide

This document provides mappings from Qlik functions, data types, and expressions to PostgreSQL equivalents for migration.

---

## Data Type Mappings

### Qlik → PostgreSQL

| Qlik Type | PostgreSQL Type | Notes |
|-----------|----------------|-------|
| String | VARCHAR(n) or TEXT | Use TEXT for variable length |
| Number | NUMERIC(p,s) or DOUBLE PRECISION | NUMERIC for exact, DOUBLE for approximate |
| Date | DATE | Qlik dates are numeric, PostgreSQL uses DATE type |
| Timestamp | TIMESTAMP | Includes date and time |
| Dual | Two columns or computed column | Qlik Dual() creates display + sort value |

---

## Function Mappings

### Date Functions

#### Year()
**Qlik**: `Year([Date Field])`  
**PostgreSQL**: `EXTRACT(YEAR FROM date_field)`

#### Month()
**Qlik**: `Month([Date Field])`  
**PostgreSQL**: `EXTRACT(MONTH FROM date_field)`

#### Day()
**Qlik**: `Day([Date Field])`  
**PostgreSQL**: `EXTRACT(DAY FROM date_field)`

#### WeekDay()
**Qlik**: `WeekDay([Date Field])`  
**PostgreSQL**: `EXTRACT(DOW FROM date_field)` (0=Sunday, 6=Saturday)

#### MonthStart()
**Qlik**: `MonthStart([Date Field])`  
**PostgreSQL**: `DATE_TRUNC('month', date_field)`

#### QuarterStart()
**Qlik**: `QuarterStart([Date Field])`  
**PostgreSQL**: `DATE_TRUNC('quarter', date_field)`

#### YearStart()
**Qlik**: `YearStart([Date Field])`  
**PostgreSQL**: `DATE_TRUNC('year', date_field)`

#### AddMonths()
**Qlik**: `AddMonths([Date Field], -13)`  
**PostgreSQL**: `date_field - INTERVAL '13 months'`

#### AddYears()
**Qlik**: `AddYears([Date Field], -1)`  
**PostgreSQL**: `date_field - INTERVAL '1 year'`

#### Today()
**Qlik**: `Today()`  
**PostgreSQL**: `CURRENT_DATE`

#### Date()
**Qlik**: `Date(Floor([Date Field]))`  
**PostgreSQL**: `DATE(date_field)` or `date_field::date`

#### Floor()
**Qlik**: `Floor([Number])`  
**PostgreSQL**: `FLOOR(number)`

---

### String Functions

#### Len()
**Qlik**: `Len([Field])`  
**PostgreSQL**: `LENGTH(field)` or `CHAR_LENGTH(field)`

#### Trim()
**Qlik**: `Trim([Field])`  
**PostgreSQL**: `TRIM(field)`

#### Upper()
**Qlik**: `Upper([Field])`  
**PostgreSQL**: `UPPER(field)`

#### Lower()
**Qlik**: `Lower([Field])`  
**PostgreSQL**: `LOWER(field)`

#### WildMatch()
**Qlik**: `WildMatch(Channel, '*Retail*', '*Wholesale*')`  
**PostgreSQL**: `channel ILIKE '%Retail%' OR channel ILIKE '%Wholesale%'`

#### SubField()
**Qlik**: `SubField([Field], '|', 1)`  
**PostgreSQL**: `SPLIT_PART(field, '|', 1)`

#### Replace()
**Qlik**: `Replace([Field], 'old', 'new')`  
**PostgreSQL**: `REPLACE(field, 'old', 'new')`

#### Left() / Right()
**Qlik**: `Left([Field], 5)`  
**PostgreSQL**: `LEFT(field, 5)`

**Qlik**: `Right([Field], 5)`  
**PostgreSQL**: `RIGHT(field, 5)`

#### Mid()
**Qlik**: `Mid([Field], 3, 2)`  
**PostgreSQL**: `SUBSTRING(field FROM 3 FOR 2)`

---

### Numeric Functions

#### Sum()
**Qlik**: `Sum([Field])`  
**PostgreSQL**: `SUM(field)`

#### Count()
**Qlik**: `Count([Field])`  
**PostgreSQL**: `COUNT(field)` or `COUNT(*)`

#### Avg()
**Qlik**: `Avg([Field])`  
**PostgreSQL**: `AVG(field)`

#### Min() / Max()
**Qlik**: `Min([Field])`  
**PostgreSQL**: `MIN(field)`

**Qlik**: `Max([Field])`  
**PostgreSQL**: `MAX(field)`

#### Round()
**Qlik**: `Round([Field], 2)`  
**PostgreSQL**: `ROUND(field, 2)`

#### Num()
**Qlik**: `Num([Field], '#,##0.00')`  
**PostgreSQL**: `TO_CHAR(field, 'FM999,999,990.00')` (formatting) or just `field::numeric`

#### RangeSum()
**Qlik**: `RangeSum([Field1], [Field2], [Field3])`  
**PostgreSQL**: `COALESCE(field1, 0) + COALESCE(field2, 0) + COALESCE(field3, 0)`

---

### Conditional Functions

#### If()
**Qlik**: `If([Condition], 'Yes', 'No')`  
**PostgreSQL**: `CASE WHEN condition THEN 'Yes' ELSE 'No' END`

#### IsNull()
**Qlik**: `IsNull([Field])`  
**PostgreSQL**: `field IS NULL`

#### Dual()
**Qlik**: `Dual('Display', SortValue)`  
**PostgreSQL**: Use computed column for sort value, or two columns

---

### Aggregation Functions

#### Aggr()
**Qlik**: `Aggr(Sum([Field]), [Dimension])`  
**PostgreSQL**: Use window functions or subqueries:
```sql
SELECT dimension, SUM(field) OVER (PARTITION BY dimension) as agg_value
```

#### Class()
**Qlik**: `Class([Field], 10)`  
**PostgreSQL**: Use CASE statements or generate_series for buckets

---

### Date Range Functions

#### InMonthToDate()
**Qlik**: `InMonthToDate([Date], $(vMaxDate), 0)`  
**PostgreSQL**:
```sql
date_field >= DATE_TRUNC('month', CURRENT_DATE) 
AND date_field <= CURRENT_DATE
```

#### InYearToDate()
**Qlik**: `InYearToDate([Date], $(vMaxDate), 0)`  
**PostgreSQL**:
```sql
date_field >= DATE_TRUNC('year', CURRENT_DATE) 
AND date_field <= CURRENT_DATE
```

#### InMonth()
**Qlik**: `InMonth([Date], $(vMaxDate), -1)`  
**PostgreSQL**:
```sql
date_field >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'
AND date_field < DATE_TRUNC('month', CURRENT_DATE)
```

#### InYear()
**Qlik**: `InYear([Date], $(vMaxDate), -1)`  
**PostgreSQL**:
```sql
date_field >= DATE_TRUNC('year', CURRENT_DATE) - INTERVAL '1 year'
AND date_field < DATE_TRUNC('year', CURRENT_DATE)
```

#### InWeek()
**Qlik**: `InWeek([Date], $(vMaxDate), -1)`  
**PostgreSQL**:
```sql
date_field >= DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '1 week'
AND date_field < DATE_TRUNC('week', CURRENT_DATE)
```

#### NetWorkDays()
**Qlik**: `NetWorkDays([Start Date], [End Date], $(vHolidays))`  
**PostgreSQL**: Requires custom function:
```sql
CREATE OR REPLACE FUNCTION business_days_between(start_date DATE, end_date DATE, holidays DATE[])
RETURNS INTEGER AS $$
DECLARE
    total_days INTEGER;
    weekend_days INTEGER;
    holiday_count INTEGER;
BEGIN
    total_days := end_date - start_date;
    weekend_days := (SELECT COUNT(*) FROM generate_series(start_date, end_date, '1 day'::interval) 
                     WHERE EXTRACT(DOW FROM generate_series) IN (0, 6));
    holiday_count := (SELECT COUNT(*) FROM unnest(holidays) 
                      WHERE unnest >= start_date AND unnest <= end_date);
    RETURN total_days - weekend_days - holiday_count;
END;
$$ LANGUAGE plpgsql;
```

---

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

### Variable Expansion
**Qlik**: `{$<[$(vDateToggle1) Rolling 13 Month Flag]={Yes}>}`  
**PostgreSQL**: Use parameterized query or dynamic SQL:
```sql
WHERE CASE 
    WHEN $1 = 'Application' THEN application_rolling_13_month_flag
    WHEN $1 = 'Funding' THEN funding_rolling_13_month_flag
    WHEN $1 = 'Closing' THEN closing_rolling_13_month_flag
END = 'Yes'
```

---

## Variable Translation

### Simple Variables
**Qlik**: `LET vVariable = 'Value';`  
**PostgreSQL**: Configuration table or parameter:
```sql
CREATE TABLE app_config (
    config_key VARCHAR(100) PRIMARY KEY,
    config_value TEXT
);
INSERT INTO app_config VALUES ('vVariable', 'Value');
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

---

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
    WHEN date_field > CURRENT_DATE THEN 'No'
    WHEN date_field >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '13 months' 
    THEN 'Yes'
    ELSE 'No'
END as rolling_13_month_flag
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

---

## Performance Considerations

### Indexes
Create indexes on:
- Date fields used in filters
- Flag fields used in WHERE clauses
- Foreign keys (RowNo, Loan Number)
- DateType in DateLink table

```sql
CREATE INDEX idx_funding_date ON loans(funding_date);
CREATE INDEX idx_funded_flag ON loans(funded_flag);
CREATE INDEX idx_date_link ON date_link(row_no, date_type);
```

### Materialized Views
For frequently used aggregations:
```sql
CREATE MATERIALIZED VIEW loan_summary_mv AS
SELECT 
    date_type,
    DATE_TRUNC('month', date) as yearmonth,
    COUNT(*) as loan_count,
    SUM(loan_amount) as total_volume
FROM date_link dl
JOIN loans l ON dl.row_no = l.row_no
GROUP BY date_type, DATE_TRUNC('month', date);

CREATE INDEX ON loan_summary_mv(date_type, yearmonth);
```

### Partitioning
For large tables, consider partitioning by date:
```sql
CREATE TABLE loans (
    ...
) PARTITION BY RANGE (application_date);

CREATE TABLE loans_2024 PARTITION OF loans
FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
```

---

## Migration Checklist

- [ ] Map all Qlik data types to PostgreSQL
- [ ] Convert all Qlik functions to PostgreSQL equivalents
- [ ] Translate set analysis to WHERE clauses
- [ ] Convert variables to config tables or parameters
- [ ] Create custom functions for NetWorkDays, etc.
- [ ] Set up indexes on filtered columns
- [ ] Create materialized views for common aggregations
- [ ] Test performance with production-like data volumes
- [ ] Validate calculations match Qlik results

---

## Notes

- Qlik's `RangeSum()` handles NULLs as 0; use `COALESCE()` in PostgreSQL
- Qlik's `Dual()` creates display + sort; use computed columns or two columns in PostgreSQL
- Qlik variables expand at query time; PostgreSQL uses parameters or config tables
- Set analysis is powerful in Qlik; translate to SQL WHERE clauses with proper indexing
- Date calculations in Qlik use numeric dates; PostgreSQL uses DATE type natively
