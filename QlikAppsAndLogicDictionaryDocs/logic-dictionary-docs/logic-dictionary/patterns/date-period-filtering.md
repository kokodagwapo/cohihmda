# Date Period Filtering - Qlik Pattern → PostgreSQL Translation

## Qlik Pattern: Pre-computed Date Flags

In Qlik, date flags are pre-computed boolean fields used for filtering in set analysis:

```qvs
// Qlik: Pre-computed flag
$(fRolling13MonthFlag("Application Date")) as [Application Date Rolling 13 Month Flag]

// Used in expressions:
Count({$<[Application Date Rolling 13 Month Flag]={Yes}>}[Loan Number])
```

**Why Qlik needs flags:**
- Set analysis syntax requires pre-computed fields
- Performance optimization (pre-computed, indexed)
- Consistent period definitions across expressions

## PostgreSQL Translation: Functions/Views

In PostgreSQL, query on-the-fly with reusable functions:

```sql
-- Create reusable function
CREATE OR REPLACE FUNCTION is_rolling_13_month(check_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '13 months'
       AND check_date <= CURRENT_DATE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Use in queries (no pre-computed columns needed)
SELECT COUNT(*) 
FROM loans 
WHERE is_rolling_13_month(application_date);

-- Can create functional index for performance if needed
CREATE INDEX idx_application_date_rolling_13_month 
ON loans (application_date) 
WHERE is_rolling_13_month(application_date);
```

## Common Period Functions

### Rolling 13 Month
```sql
CREATE OR REPLACE FUNCTION is_rolling_13_month(check_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '13 months'
       AND check_date <= CURRENT_DATE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

### Rolling 12 Month
```sql
CREATE OR REPLACE FUNCTION is_rolling_12_month(check_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '12 months'
       AND check_date <= CURRENT_DATE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

### MTD (Month-to-Date)
```sql
CREATE OR REPLACE FUNCTION is_mtd(check_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN DATE_TRUNC('month', check_date) = DATE_TRUNC('month', CURRENT_DATE)
       AND check_date <= CURRENT_DATE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

### QTD (Quarter-to-Date)
```sql
CREATE OR REPLACE FUNCTION is_qtd(check_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN DATE_TRUNC('quarter', check_date) = DATE_TRUNC('quarter', CURRENT_DATE)
       AND check_date <= CURRENT_DATE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

### YTD (Year-to-Date)
```sql
CREATE OR REPLACE FUNCTION is_ytd(check_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN DATE_TRUNC('year', check_date) = DATE_TRUNC('year', CURRENT_DATE)
       AND check_date <= CURRENT_DATE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

### Rolling 4 Quarter
```sql
CREATE OR REPLACE FUNCTION is_rolling_4qtr(check_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date >= DATE_TRUNC('quarter', CURRENT_DATE) - INTERVAL '4 quarters'
       AND check_date <= DATE_TRUNC('quarter', CURRENT_DATE) + INTERVAL '3 months' - INTERVAL '1 day';
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

### Today Flag
```sql
CREATE OR REPLACE FUNCTION is_today(check_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN DATE(check_date) = CURRENT_DATE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

### Yesterday Flag
```sql
CREATE OR REPLACE FUNCTION is_yesterday(check_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN DATE(check_date) = CURRENT_DATE - INTERVAL '1 day';
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

### Last Week Flag
```sql
CREATE OR REPLACE FUNCTION is_last_week(check_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date >= DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '1 week'
       AND check_date < DATE_TRUNC('week', CURRENT_DATE);
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

## Translation Mapping

| Qlik Pattern | PostgreSQL Approach |
|--------------|---------------------|
| Pre-computed flag column | Function call in WHERE clause |
| `[Date] Rolling 13 Month Flag = 'Yes'` | `is_rolling_13_month(date_field)` |
| `[Date] MTD = 'Yes'` | `is_mtd(date_field)` |
| `[Date] YTD Flag = 'Yes'` | `is_ytd(date_field)` |
| Indexed flag for performance | Functional index on date field |
| Multiple flag columns | Single reusable function |

## Benefits of PostgreSQL Approach

1. **Flexibility**: Query any period without pre-defining flags
2. **Storage**: No storage overhead for flag columns
3. **Maintenance**: Update function definition once, applies everywhere
4. **Performance**: Functional indexes provide performance when needed
5. **Reusability**: Same function works with any date field

## Performance Optimization

### Functional Indexes

Create indexes on date fields with function predicates:

```sql
-- Index for rolling 13 month queries
CREATE INDEX idx_application_date_rolling_13_month 
ON loans (application_date) 
WHERE is_rolling_13_month(application_date);

-- Index for MTD queries
CREATE INDEX idx_funding_date_mtd 
ON loans (funding_date) 
WHERE is_mtd(funding_date);
```

### Views (Optional)

If you need consistent period definitions across multiple queries:

```sql
CREATE VIEW loans_with_periods AS
SELECT 
    *,
    is_rolling_13_month(application_date) as application_rolling_13_month_flag,
    is_mtd(funding_date) as funding_mtd_flag,
    is_ytd(closing_date) as closing_ytd_flag
FROM loans;
```

## Migration Notes

- **Do NOT create computed columns** for date flags
- **Create reusable functions** instead
- **Use functional indexes** only if query performance requires it
- **Functions can be parameterized** for different periods if needed
- **Views are optional** for consistency, but functions are preferred

## Example Usage

```sql
-- Count loans with application date in rolling 13 months
SELECT COUNT(*) 
FROM loans 
WHERE is_rolling_13_month(application_date);

-- Count funded loans MTD
SELECT COUNT(*) 
FROM loans 
WHERE is_mtd(funding_date) 
  AND funded_flag = 'Yes';

-- Pull-through calculation using period function
SELECT 
    COUNT(CASE WHEN investor_purchase_date IS NOT NULL THEN 1 END) * 100.0 / COUNT(*) as pull_through_rate
FROM loans
WHERE is_rolling_13_month(application_date)
  AND active_loan_flag = 'No';
```
