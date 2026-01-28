# NULL Handling - Qlik Pattern → PostgreSQL Translation

## Qlik Pattern: NullAsValue

In Qlik, `NullAsValue` converts NULL values to a default string:

```qvs
NullAsValue 
    "Property State",
    "Loan Purpose",
    "Loan Type"
    ;
Set NullValue = '99-Missing';
```

**Why Qlik uses NullAsValue:**
- Consistent handling of missing values
- Enables filtering and grouping on NULL values
- Prevents NULL-related issues in expressions

## PostgreSQL Translation: COALESCE

In PostgreSQL, handle NULLs with `COALESCE` in queries:

```sql
-- Single field
COALESCE(property_state, '99-Missing') as property_state

-- Multiple fields
COALESCE(loan_purpose, '99-Missing') as loan_purpose,
COALESCE(loan_type, '99-Missing') as loan_type
```

**Benefits:**
- No pre-computation needed
- Flexible - can use different defaults per query
- Standard SQL approach

## Common NULL Handling Patterns

### Default Value Pattern

**Qlik**:
```qvs
If(Len(Trim([Loan Purpose]))=0,'No Data',[Loan Purpose])
```

**PostgreSQL**:
```sql
COALESCE(NULLIF(TRIM(loan_purpose), ''), 'No Data') as loan_purpose
```

### NULL Check Pattern

**Qlik**:
```qvs
If(Len([Field])=0, 'No', 'Yes') as [Field Flag]
```

**PostgreSQL**:
```sql
CASE 
    WHEN field IS NULL OR field = '' THEN 'No'
    ELSE 'Yes'
END as field_flag
```

### NULL in Aggregations

**Qlik**:
```qvs
RangeSum([Field1], [Field2])  // Treats NULL as 0
```

**PostgreSQL**:
```sql
COALESCE(field1, 0) + COALESCE(field2, 0) as total
```

### NULL in Complexity Calculations

**Qlik**:
```qvs
If(Len(Trim([Loan Purpose]))=0 OR [Loan Purpose] = '99-Missing' OR [Loan Purpose] = 'No Data',Null(),0)
```

**PostgreSQL**:
```sql
CASE 
    WHEN loan_purpose IS NULL 
      OR TRIM(loan_purpose) = '' 
      OR loan_purpose = '99-Missing' 
      OR loan_purpose = 'No Data' 
    THEN NULL
    ELSE 0
END
```

## NULL Handling Strategies

### Strategy 1: COALESCE in SELECT (Recommended)

Handle NULLs at query time:

```sql
SELECT 
    loan_number,
    COALESCE(loan_purpose, '99-Missing') as loan_purpose,
    COALESCE(loan_type, '99-Missing') as loan_type,
    COALESCE(property_state, '99-Missing') as property_state
FROM loans;
```

**Benefits:**
- Flexible - different defaults per query
- No storage overhead
- Standard SQL

### Strategy 2: Views with NULL Handling

Create views for consistency:

```sql
CREATE VIEW loans_with_nulls_handled AS
SELECT 
    *,
    COALESCE(loan_purpose, '99-Missing') as loan_purpose,
    COALESCE(loan_type, '99-Missing') as loan_type,
    COALESCE(property_state, '99-Missing') as property_state
FROM loans;
```

**Benefits:**
- Consistent handling across queries
- Easy to update defaults

### Strategy 3: Default Constraints (For New Data)

Set defaults at table level:

```sql
ALTER TABLE loans 
ALTER COLUMN loan_purpose SET DEFAULT '99-Missing';
```

**Note**: Only affects new inserts, not existing NULLs.

## Common NULL Patterns

### Missing Date Handling

**Qlik**:
```qvs
If(Len(Trim([Application Date]))=0,Null(),[Application Date])
```

**PostgreSQL**:
```sql
-- NULL dates stay NULL (no conversion needed)
application_date  -- Already NULL if missing
```

### Missing Numeric Handling

**Qlik**:
```qvs
If(IsNull([FICO Score])=-1,'99-Missing',[FICO Score])
```

**PostgreSQL**:
```sql
CASE 
    WHEN fico_score IS NULL THEN '99-Missing'
    ELSE fico_score::text
END as fico_score_str

-- Or keep as numeric
COALESCE(fico_score, 0) as fico_score  -- If 0 is acceptable default
```

### Missing Text Handling

**Qlik**:
```qvs
If([Loan Officer]='99-Missing', Null(), [Loan Officer])
```

**PostgreSQL**:
```sql
CASE 
    WHEN loan_officer = '99-Missing' THEN NULL
    ELSE loan_officer
END as loan_officer
```

## NULL in WHERE Clauses

### Filtering NULLs

**Qlik**:
```qvs
{$<[Loan Purpose]={-}>}  // Exclude NULLs
```

**PostgreSQL**:
```sql
WHERE loan_purpose IS NOT NULL
```

### Including NULLs

**Qlik**:
```qvs
{$<[Loan Purpose]={*}>}  // Include all including NULLs
```

**PostgreSQL**:
```sql
-- No filter needed, or explicitly:
WHERE loan_purpose IS NULL OR loan_purpose = 'Value'
```

## Migration Notes

- **Do NOT pre-compute NULL replacements** - Use COALESCE in queries
- **Use COALESCE for defaults** - Equivalent to NullAsValue
- **NULLIF for empty strings** - Convert empty strings to NULL first
- **Handle NULLs in aggregations** - Use COALESCE to treat as 0
- **Views optional** - For consistency, but functions preferred
- **Default constraints** - Only for new data, not existing NULLs

## Best Practice

**Recommended**: Handle NULLs at query time with COALESCE:

```sql
SELECT 
    loan_number,
    COALESCE(loan_purpose, '99-Missing') as loan_purpose,
    COALESCE(loan_type, '99-Missing') as loan_type,
    COALESCE(fico_score, 0) as fico_score  -- For numeric aggregations
FROM loans
WHERE COALESCE(loan_purpose, '99-Missing') != '99-Missing';  -- Filter out missing
```

**For consistency**: Create views:

```sql
CREATE VIEW loans_standardized AS
SELECT 
    *,
    COALESCE(NULLIF(TRIM(loan_purpose), ''), '99-Missing') as loan_purpose,
    COALESCE(NULLIF(TRIM(loan_type), ''), '99-Missing') as loan_type,
    COALESCE(fico_score, 0) as fico_score
FROM loans;
```

This approach:
- Flexible per query
- No storage overhead
- Standard SQL pattern
- Easy to maintain
