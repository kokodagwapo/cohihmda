# Complexity - Base Concept

## Definition

Complexity is a numeric score that quantifies how difficult or risky a loan is to process. Higher scores indicate more complex loans. The score aggregates multiple risk factors and loan characteristics.

## Core Formula

```
Loan Complexity Score = Sum of all complexity components
```

## Components

### Loan Purpose Complexity
- C to P (Cash to Purchase): 0.3
- Purchase: 0.1
- Refi CO (Cash-Out Refinance): 0.1
- Refi No CO (No Cash-Out Refinance): 0
- Other/Missing: 0 or NULL

### Loan Type Complexity
- FHA: 0.1
- VA: 0.05
- Conventional/Other: 0
- Missing: NULL

### Loan Amount Complexity
- >= $1,000,000 (Jumbo): 0.1
- < $1,000,000: 0
- Missing: NULL

### Occupancy Complexity
- SecondHome: 0.1
- Investor: 0.1
- Primary Residence: 0
- Missing: NULL

### FICO Complexity
- > 760: -0.1 (reduces complexity)
- 681-760: 0
- 620-681: 0.05
- <= 620: 0.15
- Missing: NULL

### LTV Complexity
- >= 95%: 0.05
- < 95%: 0
- Missing: NULL

### DTI Complexity
- >= 43%: 0.05
- < 43%: 0
- Missing: NULL

### Employment Complexity
- Self-Employed: 0.2
- Not Self-Employed: 0

## SQL Implementation

```sql
-- Loan Complexity Score
COALESCE(loan_purpose_complexity, 0) + 
COALESCE(loan_type_complexity, 0) + 
COALESCE(loan_amount_complexity, 0) + 
COALESCE(occupancy_complexity, 0) + 
COALESCE(fico_complexity, 0) + 
COALESCE(ltv_complexity, 0) + 
COALESCE(dti_complexity, 0) + 
COALESCE(employment_complexity, 0) as loan_complexity_score

-- Example: FICO Complexity
CASE 
    WHEN fico_score > 760 THEN -0.1
    WHEN fico_score > 681 AND fico_score <= 760 THEN 0
    WHEN fico_score > 620 AND fico_score <= 681 THEN 0.05
    WHEN fico_score <= 620 THEN 0.15
    ELSE NULL
END as fico_complexity

-- Example: Loan Purpose Complexity
CASE 
    WHEN loan_purpose = 'C to P' THEN 0.3
    WHEN loan_purpose = 'Purchase' THEN 0.1
    WHEN loan_purpose = 'Refi CO' THEN 0.1
    WHEN loan_purpose = 'Refi No CO' THEN 0
    WHEN loan_purpose IS NULL OR loan_purpose = '99-Missing' OR loan_purpose = 'No Data' THEN NULL
    ELSE 0
END as loan_purpose_complexity
```

## Business Rules

- Complexity scores can be negative (FICO > 760 reduces complexity)
- Missing values result in NULL component (not 0)
- NULL components are treated as 0 in final sum (using COALESCE)
- Higher total score = more complex loan
- Self-employment adds significant complexity (0.2)

## Score Interpretation

- **Low Complexity**: Score < 0.5
- **Medium Complexity**: Score 0.5 - 1.0
- **High Complexity**: Score > 1.0

## Dependencies

- Loan Purpose
- Loan Type
- Loan Amount
- Occupancy Type
- FICO Score
- LTV Ratio
- BE DTI Ratio
- Borr Self Employed flag

## Used In

- All apps
- Risk assessment
- Performance analysis
- Loan prioritization

## See Also

- Qlik implementation: `core/transform-logic.md#complexity-scores`
- Patterns: `patterns/null-handling.md` - NULL handling for missing values
