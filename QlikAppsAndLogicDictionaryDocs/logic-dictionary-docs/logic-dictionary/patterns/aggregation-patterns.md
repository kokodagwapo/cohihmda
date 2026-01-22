# Aggregation Patterns - Qlik Pattern → PostgreSQL Translation

## Qlik Patterns Overview

Qlik has several aggregation functions that handle NULLs and perform calculations differently than standard SQL. This document covers the translation patterns.

## RangeSum() - NULL-Safe Addition

### Qlik Pattern
```qvs
RangeSum([Field1], [Field2], [Field3]) as [Total]
// Treats NULL values as 0
```

### PostgreSQL Translation
```sql
COALESCE(field1, 0) + COALESCE(field2, 0) + COALESCE(field3, 0) as total
```

### Examples

**Revenue Calculation**:
```sql
-- Qlik: RangeSum([Origination Revenue], [Secondary Revenue])
-- PostgreSQL:
COALESCE(origination_revenue, 0) + COALESCE(secondary_revenue, 0) as total_revenue
```

**Complexity Score**:
```sql
-- Qlik: RangeSum([Loan Purpose Complexity], [Loan Type Complexity], ...)
-- PostgreSQL:
COALESCE(loan_purpose_complexity, 0) + 
COALESCE(loan_type_complexity, 0) + 
COALESCE(loan_amount_complexity, 0) + 
COALESCE(occupancy_complexity, 0) + 
COALESCE(fico_complexity, 0) + 
COALESCE(ltv_complexity, 0) + 
COALESCE(dti_complexity, 0) + 
COALESCE(employment_complexity, 0) as loan_complexity_score
```

## Class() - Bucketing Function

### Qlik Pattern
```qvs
Class([FICO Score], 25) as [FICO Range_25]
// Creates buckets: <= x < format
```

### PostgreSQL Translation
```sql
CASE 
    WHEN fico_score < 300 THEN '<300'
    WHEN fico_score < 325 THEN '300-325'
    WHEN fico_score < 350 THEN '325-350'
    -- etc
    ELSE '>=850'
END as fico_range_25
```

### Examples

**FICO Range (25-point buckets)**:
```sql
CASE 
    WHEN fico_score < 300 THEN '<300'
    WHEN fico_score < 325 THEN '300-325'
    WHEN fico_score < 350 THEN '325-350'
    WHEN fico_score < 375 THEN '350-375'
    WHEN fico_score < 400 THEN '375-400'
    WHEN fico_score < 425 THEN '400-425'
    WHEN fico_score < 450 THEN '425-450'
    WHEN fico_score < 475 THEN '450-475'
    WHEN fico_score < 500 THEN '475-500'
    WHEN fico_score < 525 THEN '500-525'
    WHEN fico_score < 550 THEN '525-550'
    WHEN fico_score < 575 THEN '550-575'
    WHEN fico_score < 600 THEN '575-600'
    WHEN fico_score < 625 THEN '600-625'
    WHEN fico_score < 650 THEN '625-650'
    WHEN fico_score < 675 THEN '650-675'
    WHEN fico_score < 700 THEN '675-700'
    WHEN fico_score < 725 THEN '700-725'
    WHEN fico_score < 750 THEN '725-750'
    WHEN fico_score < 775 THEN '750-775'
    WHEN fico_score < 800 THEN '775-800'
    WHEN fico_score < 825 THEN '800-825'
    WHEN fico_score < 850 THEN '825-850'
    ELSE '>=850'
END as fico_range_25
```

**Interest Rate Range (0.125 buckets)**:
```sql
CASE 
    WHEN interest_rate < 2.500 THEN '<2.500'
    WHEN interest_rate <= 2.625 THEN '2.500-2.625'
    WHEN interest_rate <= 2.750 THEN '2.625-2.750'
    WHEN interest_rate <= 2.875 THEN '2.750-2.875'
    WHEN interest_rate <= 3.000 THEN '2.875-3.000'
    -- etc
    ELSE '>5.000'
END as interest_rate_range_125
```

**Function-Based Approach**:
```sql
CREATE OR REPLACE FUNCTION bucket_value(
    value NUMERIC,
    bucket_size NUMERIC,
    min_value NUMERIC DEFAULT 0,
    max_value NUMERIC DEFAULT 1000
)
RETURNS VARCHAR AS $$
DECLARE
    bucket_start NUMERIC;
    bucket_end NUMERIC;
BEGIN
    bucket_start := FLOOR((value - min_value) / bucket_size) * bucket_size + min_value;
    bucket_end := bucket_start + bucket_size;
    
    IF bucket_start < min_value THEN
        RETURN '<' || min_value::text;
    ELSIF bucket_end >= max_value THEN
        RETURN '>=' || max_value::text;
    ELSE
        RETURN bucket_start::text || '-' || bucket_end::text;
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Use function
SELECT bucket_value(fico_score, 25, 300, 850) as fico_range_25 FROM loans;
```

## WildMatch() - Pattern Matching

### Qlik Pattern
```qvs
WildMatch(Channel, '*Retail*', '*Wholesale*')
// Case-insensitive pattern matching
```

### PostgreSQL Translation
```sql
channel ILIKE '%Retail%' OR channel ILIKE '%Wholesale%'
```

### Examples

**Channel Matching**:
```sql
-- Qlik: WildMatch(Channel, '*Retail*')
-- PostgreSQL:
channel ILIKE '%Retail%'

-- Qlik: WildMatch(Channel, '*Whol*', '*Corresp*')
-- PostgreSQL:
channel ILIKE '%Whol%' OR channel ILIKE '%Corresp%'
```

**Status Matching**:
```sql
-- Qlik: WildMatch([Current Loan Status], '*denied*', '*incomplet*')
-- PostgreSQL:
current_loan_status ILIKE '%denied%' OR current_loan_status ILIKE '%incomplet%'
```

**Function for Multiple Patterns**:
```sql
CREATE OR REPLACE FUNCTION wildmatch(
    field_value TEXT,
    patterns TEXT[]
)
RETURNS BOOLEAN AS $$
DECLARE
    pattern TEXT;
BEGIN
    FOREACH pattern IN ARRAY patterns
    LOOP
        IF field_value ILIKE '%' || pattern || '%' THEN
            RETURN TRUE;
        END IF;
    END LOOP;
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Use function
SELECT * FROM loans 
WHERE wildmatch(channel, ARRAY['Retail', 'Wholesale', 'Corresp']);
```

## Num() - Number Formatting

### Qlik Pattern
```qvs
Num([Field], '#,##0.00;(#,##0.00)') as [Formatted Field]
// Formats number with thousands separator and decimals
```

### PostgreSQL Translation
```sql
-- For display formatting (application layer)
TO_CHAR(field, 'FM999,999,990.00') as formatted_field

-- Or keep as numeric, format in application
field::numeric(15,2) as field
```

### Examples

**Currency Formatting**:
```sql
-- Qlik: Num([Loan Amount], '#,##0.00')
-- PostgreSQL:
TO_CHAR(loan_amount, 'FM$999,999,990.00') as loan_amount_formatted
```

**Percentage Formatting**:
```sql
-- Qlik: Num([Interest Rate], '0.00%')
-- PostgreSQL:
TO_CHAR(interest_rate, 'FM990.00%') as interest_rate_formatted
```

## Aggr() - Aggregated Aggregation

### Qlik Pattern
```qvs
Aggr(Sum([Loan Amount]), [Channel]) as [Total by Channel]
// Aggregates within dimension context
```

### PostgreSQL Translation
```sql
-- Window function approach
SUM(loan_amount) OVER (PARTITION BY channel) as total_by_channel

-- Or subquery
SELECT 
    *,
    (SELECT SUM(loan_amount) FROM loans l2 WHERE l2.channel = l1.channel) as total_by_channel
FROM loans l1
```

## Migration Notes

- **RangeSum()** → Use COALESCE + addition (treats NULL as 0)
- **Class()** → Use CASE statements or create bucket function
- **WildMatch()** → Use ILIKE with OR conditions
- **Num()** → Use TO_CHAR for formatting, or format in application layer
- **Aggr()** → Use window functions or subqueries
- **Do NOT pre-compute** these aggregations - calculate on-the-fly

## Best Practices

### RangeSum Pattern
```sql
-- Always use COALESCE for NULL handling
COALESCE(field1, 0) + COALESCE(field2, 0) as total
```

### Class/Bucketing Pattern
```sql
-- Use CASE for explicit buckets
CASE 
    WHEN value < threshold1 THEN 'bucket1'
    WHEN value < threshold2 THEN 'bucket2'
    ELSE 'bucket3'
END as bucket

-- Or create reusable function for dynamic bucketing
```

### WildMatch Pattern
```sql
-- Use ILIKE for case-insensitive matching
field ILIKE '%pattern%'

-- For multiple patterns, use OR or function
field ILIKE '%pattern1%' OR field ILIKE '%pattern2%'
```

### Formatting Pattern
```sql
-- Keep numeric in database, format in application
-- Or use TO_CHAR if formatting is critical
TO_CHAR(value, 'FM999,999,990.00') as formatted_value
```
