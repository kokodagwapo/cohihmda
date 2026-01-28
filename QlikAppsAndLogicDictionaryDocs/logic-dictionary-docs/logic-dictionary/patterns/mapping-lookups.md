# Mapping Lookups - Qlik Pattern → PostgreSQL Translation

## Qlik Pattern: ApplyMap()

In Qlik, `ApplyMap()` performs lookups using pre-loaded mapping tables:

```qvs
// Define mapping table
LoanPurposeMap:
Mapping Load *
Inline [
SourceName, TransformName
Purchase, Purchase
NoCash-Out Refinance, Refi No CO
Cash-Out Refinance, Refi CO
];

// Use mapping
ApplyMap('LoanPurposeMap', [Loan Purpose], [Loan Purpose]) as [Loan Purpose Temp]
// If Loan Purpose = "Purchase" → returns "Purchase"
// If Loan Purpose = "NoCash-Out Refinance" → returns "Refi No CO"
// If not found → returns original value (default)
```

**Why Qlik uses ApplyMap():**
- Pre-loaded mapping tables for performance
- Default value handling
- Clean lookup syntax

## PostgreSQL Translation: JOINs

### Approach 1: JOIN to Mapping Table (Recommended)

Create mapping tables and JOIN:

```sql
-- Create mapping table
CREATE TABLE loan_purpose_mapping (
    source_name VARCHAR(100) PRIMARY KEY,
    transform_name VARCHAR(100) NOT NULL
);

INSERT INTO loan_purpose_mapping VALUES
    ('Purchase', 'Purchase'),
    ('NoCash-Out Refinance', 'Refi No CO'),
    ('Cash-Out Refinance', 'Refi CO'),
    ('ConstructionToPermanent', 'C to P');

-- Use JOIN with COALESCE for default
SELECT 
    l.*,
    COALESCE(m.transform_name, l.loan_purpose) as loan_purpose_temp
FROM loans l
LEFT JOIN loan_purpose_mapping m ON l.loan_purpose = m.source_name;
```

**Benefits:**
- Standard SQL approach
- Easy to maintain mapping data
- Can update mappings without changing queries

### Approach 2: CASE Statement (For Small Mappings)

For small, static mappings:

```sql
SELECT 
    *,
    CASE loan_purpose
        WHEN 'Purchase' THEN 'Purchase'
        WHEN 'NoCash-Out Refinance' THEN 'Refi No CO'
        WHEN 'Cash-Out Refinance' THEN 'Refi CO'
        WHEN 'ConstructionToPermanent' THEN 'C to P'
        ELSE loan_purpose  -- Default to original value
    END as loan_purpose_temp
FROM loans;
```

**Benefits:**
- No additional tables needed
- Good for small, rarely-changing mappings

### Approach 3: Function-Based Lookup

Create a lookup function:

```sql
CREATE OR REPLACE FUNCTION map_loan_purpose(source_value VARCHAR)
RETURNS VARCHAR AS $$
BEGIN
    RETURN CASE source_value
        WHEN 'Purchase' THEN 'Purchase'
        WHEN 'NoCash-Out Refinance' THEN 'Refi No CO'
        WHEN 'Cash-Out Refinance' THEN 'Refi CO'
        WHEN 'ConstructionToPermanent' THEN 'C to P'
        ELSE source_value
    END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Use function
SELECT 
    *,
    map_loan_purpose(loan_purpose) as loan_purpose_temp
FROM loans;
```

**Benefits:**
- Reusable across queries
- Can be indexed if needed
- Centralized logic

## Common Mapping Patterns

### Loan Type Mapping

**Qlik**:
```qvs
ApplyMap('LoanTypeMap', [Loan Type], [Loan Type])
```

**PostgreSQL**:
```sql
-- Mapping table approach
CREATE TABLE loan_type_mapping (
    source_name VARCHAR(100) PRIMARY KEY,
    transform_name VARCHAR(100) NOT NULL
);

SELECT 
    l.*,
    COALESCE(m.transform_name, l.loan_type) as loan_type_temp
FROM loans l
LEFT JOIN loan_type_mapping m ON l.loan_type = m.source_name;
```

### User Status Mapping

**Qlik**:
```qvs
ApplyMap('LoanOfficerUsers', [NMLS ID], 'Status Unknown') as [Loan Officer Status]
```

**PostgreSQL**:
```sql
-- Mapping table with default
CREATE TABLE user_status_mapping (
    nmls_id VARCHAR(50) PRIMARY KEY,
    status VARCHAR(50) NOT NULL
);

SELECT 
    l.*,
    COALESCE(m.status, 'Status Unknown') as loan_officer_status
FROM loans l
LEFT JOIN user_status_mapping m ON l.nmls_id = m.nmls_id;
```

### Sort Order Mapping

**Qlik**:
```qvs
ApplyMap('FICORangeSortMap', [FICO Range_Std], 999) as [FICO Range Sort]
```

**PostgreSQL**:
```sql
-- Mapping table for sort order
CREATE TABLE fico_range_sort_mapping (
    range_value VARCHAR(50) PRIMARY KEY,
    sort_order INTEGER NOT NULL
);

SELECT 
    l.*,
    COALESCE(m.sort_order, 999) as fico_range_sort
FROM loans l
LEFT JOIN fico_range_sort_mapping m ON l.fico_range_std = m.range_value
ORDER BY fico_range_sort;
```

## Migration Notes

- **Use JOINs for large mappings** - More maintainable
- **Use CASE for small mappings** - Simpler, no extra tables
- **Use functions for complex logic** - Reusable, can be optimized
- **COALESCE handles defaults** - Equivalent to ApplyMap default parameter
- **Create indexes on mapping keys** - For performance
- **Do NOT pre-compute mapped values** - Calculate on-the-fly

## Performance Optimization

### Index Mapping Tables

```sql
-- Index on source_name for fast lookups
CREATE INDEX idx_loan_purpose_mapping_source 
ON loan_purpose_mapping(source_name);
```

### Materialized Views (If Needed)

If mappings are expensive and rarely change:

```sql
CREATE MATERIALIZED VIEW loans_with_mappings AS
SELECT 
    l.*,
    COALESCE(m1.transform_name, l.loan_purpose) as loan_purpose_temp,
    COALESCE(m2.transform_name, l.loan_type) as loan_type_temp
FROM loans l
LEFT JOIN loan_purpose_mapping m1 ON l.loan_purpose = m1.source_name
LEFT JOIN loan_type_mapping m2 ON l.loan_type = m2.source_name;

-- Refresh when mappings change
REFRESH MATERIALIZED VIEW CONCURRENTLY loans_with_mappings;
```

## Example: Multiple Mappings

```sql
-- Single query with multiple mappings
SELECT 
    l.*,
    COALESCE(purpose_map.transform_name, l.loan_purpose) as loan_purpose_temp,
    COALESCE(type_map.transform_name, l.loan_type) as loan_type_temp,
    COALESCE(user_map.status, 'Status Unknown') as loan_officer_status,
    COALESCE(sort_map.sort_order, 999) as fico_range_sort
FROM loans l
LEFT JOIN loan_purpose_mapping purpose_map ON l.loan_purpose = purpose_map.source_name
LEFT JOIN loan_type_mapping type_map ON l.loan_type = type_map.source_name
LEFT JOIN user_status_mapping user_map ON l.nmls_id = user_map.nmls_id
LEFT JOIN fico_range_sort_mapping sort_map ON l.fico_range_std = sort_map.range_value;
```

## Best Practice

**Recommended**: Use mapping tables with JOINs for maintainability:

1. Create mapping tables for each mapping
2. Use LEFT JOIN with COALESCE for defaults
3. Index mapping table keys for performance
4. Update mappings by updating tables (not code)

This approach:
- Separates data from logic
- Easy to maintain and update
- Standard SQL pattern
- Performant with proper indexes
