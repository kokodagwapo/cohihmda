# Expression Categories

This document categorizes Qlik expressions found in QSDA exports and app visualizations.

---

## Expression Categories

### 1. Set Analysis Expressions

**Pattern**: `{<...>}` syntax for filtering data

**Common Patterns**:
- `{$<Field=Value>}` - Filter by field value
- `{$<Field={Value1,Value2}>}` - Filter by multiple values
- `{$<Field={">=Value"}>}` - Filter by comparison
- `{$<Field={"*Value*"}>}` - Wildcard filter
- `{$<Field=, Field2=Value>}` - Exclude Field, include Field2
- `{$<Field*=Value>}` - Set expression with variable

**Examples**:
```qvs
Sum({$<[Funding Date]={">=$(=Date(vCurrentDateAsDate-395))<=$(=Date(vCurrentDateAsDate))"}>} [Loan Amount])
Count({$<[Current Status]={'Funded'}>} [Loan Number])
Avg({$<Channel={'Retail'}>} [Turn Time])
```

**PostgreSQL Translation**:
```sql
-- Set Analysis translates to WHERE clauses
SELECT SUM(loan_amount)
FROM loans
WHERE funding_date >= CURRENT_DATE - INTERVAL '395 days'
AND funding_date <= CURRENT_DATE;
```

**See**: `patterns/set-analysis.md` for complete documentation

---

### 2. Aggregation Expressions

**Common Aggregations**:
- `Sum()` - Sum of values
- `Avg()` - Average of values
- `Count()` - Count of records
- `Min()` - Minimum value
- `Max()` - Maximum value
- `Median()` - Median value
- `StDev()` - Standard deviation
- `FirstSortedValue()` - First value sorted by another field

**Examples**:
```qvs
Sum([Loan Amount])
Avg([Turn Time])
Count(Distinct [Loan Number])
Max([Funding Date])
```

**PostgreSQL Translation**:
```sql
SELECT 
    SUM(loan_amount),
    AVG(turn_time),
    COUNT(DISTINCT loan_number),
    MAX(funding_date)
FROM loans;
```

---

### 3. Weighted Average Expressions

**Pattern**: Weighted averages for FICO, LTV, DTI

**WAFICO (Weighted Average FICO)**:
```qvs
Sum([Loan Amount] * [FICO Score]) / Sum([Loan Amount])
```

**WALTV (Weighted Average LTV)**:
```qvs
Sum([Loan Amount] * [LTV Ratio]) / Sum([Loan Amount])
```

**WADTI (Weighted Average DTI)**:
```qvs
Sum([Loan Amount] * [BE DTI Ratio]) / Sum([Loan Amount])
```

**PostgreSQL Translation**:
```sql
-- Weighted Average FICO
SELECT 
    SUM(loan_amount * fico_score) / NULLIF(SUM(loan_amount), 0) as wafico
FROM loans;

-- Weighted Average LTV
SELECT 
    SUM(loan_amount * ltv_ratio) / NULLIF(SUM(loan_amount), 0) as waltv
FROM loans;

-- Weighted Average DTI
SELECT 
    SUM(loan_amount * be_dti_ratio) / NULLIF(SUM(loan_amount), 0) as wadti
FROM loans;
```

**See**: `patterns/aggregation-patterns.md` for complete documentation

---

### 4. Range-Based Metrics

**Pattern**: `_InRange` and `_OutOfRange` suffixes

**FICO Range Metrics**:
- `FICO_InRange` - Count of loans within FICO range
- `FICO_OutOfRange` - Count of loans outside FICO range

**LTV Range Metrics**:
- `LTV_InRange` - Count of loans within LTV range
- `LTV_OutOfRange` - Count of loans outside LTV range

**DTI Range Metrics**:
- `DTI_InRange` - Count of loans within DTI range
- `DTI_OutOfRange` - Count of loans outside DTI range

**Qlik Pattern**:
```qvs
Count({$<[FICO Range_Std]={'300-579','580-619','620-659','660-679','680-719','720-749','750-799','800-850'}>} [Loan Number])
```

**PostgreSQL Translation**:
```sql
-- FICO In Range
SELECT COUNT(*)
FROM loans
WHERE fico_range_std IN ('300-579','580-619','620-659','660-679','680-719','720-749','750-799','800-850');
```

**See**: `derived/stratification.md` for complete range definitions

---

### 5. Pull Through Expressions

**Pattern**: Pull-through percentage calculations

**Standard Pull Through**:
```qvs
(Sum({$<[Current Status]={'Funded'}>} [Loan Amount]) / 
 Sum({$<[Current Status]={'Application'}>} [Loan Amount])) * 100
```

**Scorecard Pull Through**:
```qvs
[Scorecard PullThrough]  // Uses Aggr() with Current Production Check
```

**TVI Pull Through Rating**:
```qvs
[TVI Pull Through Rating]  // Normalized 0-100 rating
```

**PostgreSQL Translation**:
```sql
-- Standard Pull Through
SELECT 
    (SUM(CASE WHEN current_status = 'Funded' THEN loan_amount ELSE 0 END)::DECIMAL /
     NULLIF(SUM(CASE WHEN current_status = 'Application' THEN loan_amount ELSE 0 END), 0)) * 100
    as pullthrough_pct
FROM loans;
```

**See**: `derived/pull-through-calculations.md` for complete documentation

---

### 6. Revenue Variations

**Pattern**: App-specific revenue calculations

**Revenue Expressions**:
- `Revenue` - Default revenue
- `Revenue_Sales` - Sales app revenue
- `Revenue_Exec` - Executive app revenue
- `Revenue_Ops` - Operations app revenue
- `Revenue_Contribution` - Contribution app revenue

**Margin (BPS) Expressions**:
- `Margin (BPS)` - Uses Revenue_Sales
- `Margin (BPS)_Exec` - Uses Revenue_Exec
- `Margin (BPS)_Ops` - Uses Revenue_Ops
- `Margin (BPS)_Contribution` - Uses Revenue_Contribution

**Qlik Pattern**:
```qvs
([Revenue_Sales] / [Loan Amount]) * 10000
```

**PostgreSQL Translation**:
```sql
SELECT 
    (revenue_sales / NULLIF(loan_amount, 0)) * 10000 as margin_bps
FROM loans;
```

**See**: `derived/revenue-calculations.md` for complete documentation

---

### 7. Turn Time Expressions

**Pattern**: Date difference calculations

**Standard Turn Times**:
- `App-InvPurch` - Application to Investor Purchase
- `Started-InvPurch` - Started to Investor Purchase
- `App-Funded` - Application to Funded
- `App-Closed` - Application to Closed

**Qlik Pattern**:
```qvs
[Investor Purchase Date] - [Application Date]
```

**PostgreSQL Translation**:
```sql
SELECT 
    investor_purchase_date - application_date as app_invpurch_days
FROM loans;
```

**See**: `concepts/turn-time.md` for complete documentation

---

### 8. Date Flag Expressions

**Pattern**: Boolean flags for date periods

**Common Flags**:
- `fRolling13MonthFlag()` - Rolling 13 months
- `fTodayFlag()` - Today
- `fYTD()` - Year to date
- `fMTD()` - Month to date
- `fQTD()` - Quarter to date

**Qlik Pattern**:
```qvs
If(fYTD([Funding Date]), 1, 0)
```

**PostgreSQL Translation**:
```sql
SELECT 
    CASE 
        WHEN funding_date >= DATE_TRUNC('year', CURRENT_DATE) 
        AND funding_date <= CURRENT_DATE 
        THEN 1 
        ELSE 0 
    END as ytd_flag
FROM loans;
```

**See**: `core/functions.md` for complete function documentation

---

### 9. Aggr() Expressions

**Pattern**: Aggregation within aggregation

**Common Use Cases**:
- Aggregating by dimension, then aggregating results
- Calculating averages within groups

**Qlik Pattern**:
```qvs
Avg(Aggr(Sum([Loan Amount]), [Loan Officer]))
```

**PostgreSQL Translation**:
```sql
SELECT 
    AVG(loan_amount_sum) as avg_loan_amount
FROM (
    SELECT 
        loan_officer,
        SUM(loan_amount) as loan_amount_sum
    FROM loans
    GROUP BY loan_officer
) subquery;
```

**See**: `patterns/aggregation-patterns.md` for complete documentation

---

### 10. Conditional Expressions

**Pattern**: If/Then/Else logic

**Qlik Pattern**:
```qvs
If([Loan Amount] > 500000, 'Jumbo', 'Conforming')
If(Len(Trim([Field]))=0, 'Missing', [Field])
```

**PostgreSQL Translation**:
```sql
SELECT 
    CASE 
        WHEN loan_amount > 500000 THEN 'Jumbo'
        ELSE 'Conforming'
    END as loan_category
FROM loans;
```

---

### 11. String Manipulation Expressions

**Pattern**: Text processing

**Common Functions**:
- `Len()` - Length of string
- `Trim()` - Remove whitespace
- `SubString()` - Extract substring
- `Upper()`, `Lower()` - Case conversion
- `WildMatch()` - Pattern matching
- `Replace()` - String replacement

**Qlik Pattern**:
```qvs
If(WildMatch([Channel], '*Retail*', '*Brok*'), 'Retail', 'TPO')
```

**PostgreSQL Translation**:
```sql
SELECT 
    CASE 
        WHEN channel ILIKE '%Retail%' OR channel ILIKE '%Brok%' 
        THEN 'Retail'
        ELSE 'TPO'
    END as channel_category
FROM loans;
```

---

### 12. Ratio/Percentage Expressions

**Pattern**: Percentage calculations

**Qlik Pattern**:
```qvs
(Sum([Loan Amount]) / Sum(Total [Loan Amount])) * 100
```

**PostgreSQL Translation**:
```sql
SELECT 
    (SUM(loan_amount)::DECIMAL / 
     NULLIF(SUM(loan_amount) OVER(), 0)) * 100 as pct_of_total
FROM loans;
```

---

## Expression Usage by App

### Contribution to Profit App
- Revenue calculations (Revenue_Contribution)
- Margin (BPS)_Contribution
- Pull-through metrics
- Weighted averages (WAFICO, WALTV, WADTI)

### Operations App
- Turn time metrics
- Revenue_Ops
- Margin (BPS)_Ops
- Date flag expressions

### Sales App
- Revenue_Sales
- Margin (BPS)
- Pull-through metrics
- Scorecard metrics

### DataPilot App
- Validation expressions
- Range-based metrics
- Custom field expressions
- Data quality metrics

### Performance App
- TTS scorecard calculations
- Weighted scorecard formulas
- Scorecard aggregation
- Performance metrics

---

## Cross-Reference

**See**:
- `validation/qsda-cross-reference.md` - Expressions found in QSDA but not scripts
- `patterns/set-analysis.md` - Set Analysis pattern documentation
- `patterns/aggregation-patterns.md` - Aggregation patterns
- `derived/pull-through-calculations.md` - Pull-through expressions
- `derived/revenue-calculations.md` - Revenue expressions
- `core/functions.md` - Function definitions
