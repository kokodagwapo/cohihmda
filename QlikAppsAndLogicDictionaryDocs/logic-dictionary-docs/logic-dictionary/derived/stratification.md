# Stratification - Derived Logic

## Definition

Stratification categorizes continuous values (dates, amounts, scores) into discrete buckets or groups for analysis. This includes date year stratification, range categorizations, and loan amount buckets.

## Date Year Stratification

### Pattern

Adds 'Date Missing' category for NULL values in year fields.

**Qlik Pattern**:
```qvs
If(Len(Trim([Credit Pull Year]))=0,'Date Missing',[Credit Pull Year]) as [Credit Pull Year_Strat]
```

**PostgreSQL**:
```sql
CASE 
    WHEN credit_pull_year IS NULL THEN 'Date Missing'
    ELSE credit_pull_year::text
END as credit_pull_year_strat
```

### Examples

- Application Year_Strat
- Closing Year_Strat
- Funding Year_Strat
- Credit Pull Year_Strat

## Range Categorizations

### FICO Range Standard

**Buckets**: '99-Missing', 'Values<300', '300-579', '580-619', '620-659', '660-679', '680-719', '720-749', '750-799', '800-850', 'Values>850'

**Qlik Expression**:
```qvs
IF(IsNull([FICO Score])=-1,'99-Missing',
IF([FICO Score] < 300, 'Values<300',
IF([FICO Score] > 850, 'Values>850',
IF([FICO Score] <= 579, '300-579',
IF([FICO Score] <= 619, '580-619',
IF([FICO Score] <= 659, '620-659',
IF([FICO Score] <= 679, '660-679',
IF([FICO Score] <= 719, '680-719',
IF([FICO Score] <= 749, '720-749',
IF([FICO Score] <= 799, '750-799', 
'800-850')))))))))) as [FICO Range_Std]
```

**PostgreSQL**:
```sql
CASE 
    WHEN fico_score IS NULL THEN '99-Missing'
    WHEN fico_score < 300 THEN 'Values<300'
    WHEN fico_score > 850 THEN 'Values>850'
    WHEN fico_score <= 579 THEN '300-579'
    WHEN fico_score <= 619 THEN '580-619'
    WHEN fico_score <= 659 THEN '620-659'
    WHEN fico_score <= 679 THEN '660-679'
    WHEN fico_score <= 719 THEN '680-719'
    WHEN fico_score <= 749 THEN '720-749'
    WHEN fico_score <= 799 THEN '750-799'
    ELSE '800-850'
END as fico_range_std
```

**Configurable Min/Max**: 
- Min/Max values can be configured via XML (`vFICOCreditMin`, `vFICOCreditMax`)
- Default range: 300-850
- Out-of-range values get special buckets ('Values<300', 'Values>850')

**Alternative Ranges**:
- **FICO Range_25**: Uses `class([FICO Score],25)` - 25-point buckets
- **FICO Range_50**: Uses `class([FICO Score],50)` - 50-point buckets

### LTV Range Standard

**Buckets**: '99-Missing', '0-Values', '0.01-60.00', '60.01-70.00', '70.01-75.00', '75.01-80.00', '80.01-85.00', '85.01-90.00', '90.01-95.00', '95.01-97.00', '97.00>'

**Qlik Expression**:
```qvs
If(IsNull([LTV Ratio])=-1, '99-Missing',
If([LTV Ratio] <= 0, '0-Values',
If([LTV Ratio] <= 60, '0.01-60.00',
If([LTV Ratio] <= 70, '60.01-70.00',
If([LTV Ratio] <= 75, '70.01-75.00',
If([LTV Ratio] <= 80, '75.01-80.00',
If([LTV Ratio] <= 85, '80.01-85.00',
If([LTV Ratio] <= 90, '85.01-90.00',
If([LTV Ratio] <= 95, '90.01-95.00',
If([LTV Ratio] <= 97, '95.01-97.00', '97.00>')))))))))) as [LTV Range_Std]
```

**PostgreSQL**:
```sql
CASE 
    WHEN ltv_ratio IS NULL THEN '99-Missing'
    WHEN ltv_ratio <= 0 THEN '0-Values'
    WHEN ltv_ratio <= 60 THEN '0.01-60.00'
    WHEN ltv_ratio <= 70 THEN '60.01-70.00'
    WHEN ltv_ratio <= 75 THEN '70.01-75.00'
    WHEN ltv_ratio <= 80 THEN '75.01-80.00'
    WHEN ltv_ratio <= 85 THEN '80.01-85.00'
    WHEN ltv_ratio <= 90 THEN '85.01-90.00'
    WHEN ltv_ratio <= 95 THEN '90.01-95.00'
    WHEN ltv_ratio <= 97 THEN '95.01-97.00'
    ELSE '97.00>'
END as ltv_range_std
```

**Configurable Min/Max**: 
- Min/Max values can be configured via XML (`vLTVCreditMin`, `vLTVCreditMax`)
- Default range: 0-110 (typical LTV range)

**Alternative Range**:
- **LTV Range**: Uses `class(([LTV Ratio]),10)` - 10-point buckets with Dual() for display

### DTI Range Standard

**Buckets**: '99-Missing', 'Values<=0', '0.01-28.00', '28.01-36.00', '36.01-43.00', '43.01-50.00', '50.00>'

**Qlik Expression**:
```qvs
If(IsNull([BE DTI Ratio])=-1, '99-Missing',
If([BE DTI Ratio] <= 0, 'Values<=0',
If([BE DTI Ratio] <= 28, '0.01-28.00',
If([BE DTI Ratio] <= 36, '28.01-36.00',
If([BE DTI Ratio] <= 43, '36.01-43.00',
If([BE DTI Ratio] <= 50, '43.01-50.00', '50.00>')))))) as [DTI Range_Std]
```

**PostgreSQL**:
```sql
CASE 
    WHEN be_dti_ratio IS NULL THEN '99-Missing'
    WHEN be_dti_ratio <= 0 THEN 'Values<=0'
    WHEN be_dti_ratio <= 28 THEN '0.01-28.00'
    WHEN be_dti_ratio <= 36 THEN '28.01-36.00'
    WHEN be_dti_ratio <= 43 THEN '36.01-43.00'
    WHEN be_dti_ratio <= 50 THEN '43.01-50.00'
    ELSE '50.00>'
END as dti_range_std
```

**Configurable Min/Max**: 
- Min/Max values can be configured via XML (`vDTICreditMin`, `vDTICreditMax`)
- Default range: 0-70 (typical DTI range)

**Alternative Range**:
- **BE DTI Range**: Uses `class(([BE DTI Ratio]),10)` - 10-point buckets with Dual() for display

## Loan Amount Buckets

### Original Balance Range

**Buckets**: '<=50,000', '50,001-100,000', '100,000.01-150,000', '150,000.01-200,000', '200,000.01-250,000', '250,000.01-300,000', '300,000.01-350,000', '350,000.01-400,000', '400,000.01-450,000', '450,000.01-500,000', '500,000.01-550,000', '550,000.01-600,000', '600,000.01-650,000', '650,000.01-700,000', '700,000.01-750,000', '>750,000'

**Qlik Expression**:
```qvs
If("Loan Amount" <= 50000, '<=50,000',
If("Loan Amount" <= 100000, '50,001-100,000',
If("Loan Amount" <= 150000, '100,000.01-150,000',
If("Loan Amount" <= 200000, '150,000.01-200,000',
If("Loan Amount" <= 250000, '200,000.01-250,000',
If("Loan Amount" <= 300000, '250,000.01-300,000',
If("Loan Amount" <= 350000, '300,000.01-350,000',
If("Loan Amount" <= 400000, '350,000.01-400,000',
If("Loan Amount" <= 450000, '400,000.01-450,000',
If("Loan Amount" <= 500000, '450,000.01-500,000',
If("Loan Amount" <= 550000, '500,000.01-550,000',
If("Loan Amount" <= 600000, '550,000.01-600,000',
If("Loan Amount" <= 650000, '600,000.01-650,000',
If("Loan Amount" <= 700000, '650,000.01-700,000',
If("Loan Amount" <= 750000, '700,000.01-750,000',
'>750,000'))))))))))))))) as [Original Balance Range]
```

**PostgreSQL**:
```sql
CASE 
    WHEN loan_amount <= 50000 THEN '<=50,000'
    WHEN loan_amount <= 100000 THEN '50,001-100,000'
    WHEN loan_amount <= 150000 THEN '100,000.01-150,000'
    WHEN loan_amount <= 200000 THEN '150,000.01-200,000'
    WHEN loan_amount <= 250000 THEN '200,000.01-250,000'
    WHEN loan_amount <= 300000 THEN '250,000.01-300,000'
    WHEN loan_amount <= 350000 THEN '300,000.01-350,000'
    WHEN loan_amount <= 400000 THEN '350,000.01-400,000'
    WHEN loan_amount <= 450000 THEN '400,000.01-450,000'
    WHEN loan_amount <= 500000 THEN '450,000.01-500,000'
    WHEN loan_amount <= 550000 THEN '500,000.01-550,000'
    WHEN loan_amount <= 600000 THEN '550,000.01-600,000'
    WHEN loan_amount <= 650000 THEN '600,000.01-650,000'
    WHEN loan_amount <= 700000 THEN '650,000.01-700,000'
    WHEN loan_amount <= 750000 THEN '700,000.01-750,000'
    ELSE '>750,000'
END as original_balance_range
```

**Bucket Size**: $50,000 increments from $50,000 to $750,000

## Interest Rate Range

**Buckets**: 'Values<2.500', '2.500 - 2.625', '2.625 - 2.750', '2.750 - 2.875', '2.875 - 3.000', '3.000 - 3.125', '3.125 - 3.250', '3.250 - 3.375', '3.375 - 3.500', '3.500 - 3.625', '3.625 - 3.750', '3.750 - 3.875', '3.875 - 4.000', '4.000 - 4.125', '4.125 - 4.250', '4.250 - 4.375', '4.375 - 4.500', '4.500 - 4.625', '4.625 - 4.750', '4.750 - 4.875', '4.875 - 5.000', 'Values>5.000'

**Qlik Expression**:
```qvs
If([Interest Rate]<2.500, 'Values<2.500', 
If([Interest Rate]<=2.625, '2.500 - 2.625',
If([Interest Rate]<=2.750, '2.625 - 2.750',
If([Interest Rate]<=2.875, '2.750 - 2.875',
If([Interest Rate]<=3.000, '2.875 - 3.000',
If([Interest Rate]<=3.125, '3.000 - 3.125',
If([Interest Rate]<=3.250, '3.125 - 3.250',
If([Interest Rate]<=3.375, '3.250 - 3.375',
If([Interest Rate]<=3.500, '3.375 - 3.500',
If([Interest Rate]<=3.625, '3.500 - 3.625',
If([Interest Rate]<=3.750, '3.625 - 3.750',
If([Interest Rate]<=3.875, '3.750 - 3.875',
If([Interest Rate]<=4.000, '3.875 - 4.000',
If([Interest Rate]<=4.125, '4.000 - 4.125',
If([Interest Rate]<=4.250, '4.125 - 4.250',
If([Interest Rate]<=4.375, '4.250 - 4.375',
If([Interest Rate]<=4.500, '4.375 - 4.500',
If([Interest Rate]<=4.625, '4.500 - 4.625',
If([Interest Rate]<=4.750, '4.625 - 4.750',
If([Interest Rate]<=4.875, '4.750 - 4.875',
If([Interest Rate]<=5.000, '4.875 - 5.000',
'Values>5.000'))))))))))))))))))))) as [Interest Rate Range]
```

**PostgreSQL**:
```sql
CASE 
    WHEN interest_rate < 2.500 THEN 'Values<2.500'
    WHEN interest_rate <= 2.625 THEN '2.500 - 2.625'
    WHEN interest_rate <= 2.750 THEN '2.625 - 2.750'
    WHEN interest_rate <= 2.875 THEN '2.750 - 2.875'
    WHEN interest_rate <= 3.000 THEN '2.875 - 3.000'
    WHEN interest_rate <= 3.125 THEN '3.000 - 3.125'
    WHEN interest_rate <= 3.250 THEN '3.125 - 3.250'
    WHEN interest_rate <= 3.375 THEN '3.250 - 3.375'
    WHEN interest_rate <= 3.500 THEN '3.375 - 3.500'
    WHEN interest_rate <= 3.625 THEN '3.500 - 3.625'
    WHEN interest_rate <= 3.750 THEN '3.625 - 3.750'
    WHEN interest_rate <= 3.875 THEN '3.750 - 3.875'
    WHEN interest_rate <= 4.000 THEN '3.875 - 4.000'
    WHEN interest_rate <= 4.125 THEN '4.000 - 4.125'
    WHEN interest_rate <= 4.250 THEN '4.125 - 4.250'
    WHEN interest_rate <= 4.375 THEN '4.250 - 4.375'
    WHEN interest_rate <= 4.500 THEN '4.375 - 4.500'
    WHEN interest_rate <= 4.625 THEN '4.500 - 4.625'
    WHEN interest_rate <= 4.750 THEN '4.625 - 4.750'
    WHEN interest_rate <= 4.875 THEN '4.750 - 4.875'
    WHEN interest_rate <= 5.000 THEN '4.875 - 5.000'
    ELSE 'Values>5.000'
END as interest_rate_range
```

**Bucket Size**: 0.125% (12.5 basis points) increments from 2.500% to 5.000%

**Configurable Min/Max**: 
- Default: 0-15% (`vInterestMin = 0`, `vInterestMax = 15`)
- Out-of-range values get special buckets ('Values<2.500', 'Values>5.000')

**Alternative Ranges**:
- **Interest Rate Range_25**: Uses `class([Interest Rate],.25)` - 0.25% buckets
- **Interest Rate Range_50**: Uses `class([Interest Rate],.50)` - 0.50% buckets
- **Interest Rate Range_125**: Uses `class([Interest Rate],.125)` - 0.125% buckets (with NULL handling)

**See**: `core/mapping-tables.md` for InterestRateRangeSortMap sort order mapping.

---

## Business Rules

- NULL values typically get '99-Missing' or 'Date Missing' bucket
- Ranges are inclusive on upper bound
- Special buckets for out-of-range values (e.g., 'Values<300', 'Values>850', 'Values<2.500', 'Values>5.000')
- Bucket sizes vary by field:
  - **FICO**: 20-50 point ranges (standard), 25-point buckets (Range_25), 50-point buckets (Range_50)
  - **LTV**: 5-10% ranges (standard), 10-point buckets (Range)
  - **DTI**: 5-8% ranges (standard), 10-point buckets (Range)
  - **Interest Rate**: 0.125% increments (standard), 0.25% or 0.50% buckets (alternatives)
  - **Loan Amount**: $50,000 increments
- **Configurable Min/Max**: FICO, LTV, and DTI ranges can be configured via XML configuration (`vFICOCreditMin/Max`, `vLTVCreditMin/Max`, `vDTICreditMin/Max`)

## Configurable Range Min/Max Values

**Source**: `tvd-coheus-datapilot-qlik/Scripts/Ranges.qvs`

Ranges can be configured per client via XML configuration:

### Configuration Loading

```qvs
CreditRanges:
LOAD
    Name,
    "Max",
    "Min"
From_Field(ConfigurationData,full_xml)
(XmlSimple, table is [$(vConfigRange)]);

-- Set variables dynamically
If Upper('$(vCreditRange)') = 'FICO' Then
    Let vFICOCreditMax = $(vCreditRangeMax);
    Let vFICOCreditMin = $(vCreditRangeMin);
ElseIf Upper('$(vCreditRange)') = 'LTV' Then
    Let vLTVCreditMax = $(vCreditRangeMax);
    Let vLTVCreditMin = $(vCreditRangeMin);
ElseIf Upper('$(vCreditRange)') = 'DTI' Then
    Let vDTICreditMax = $(vCreditRangeMax);
    Let vDTICreditMin = $(vCreditRangeMin);
End If
```

### Default Values

- **FICO**: Min/Max loaded from configuration (typically 300-850)
- **LTV**: Min/Max loaded from configuration (typically 0-110)
- **DTI**: Min/Max loaded from configuration (typically 0-70)
- **Interest Rate**: Default 0-15% (`vInterestMin = 0`, `vInterestMax = 15`)

### PostgreSQL Translation

```sql
-- Range configuration table
CREATE TABLE range_config (
    client_id VARCHAR(100),
    range_name VARCHAR(50),  -- 'FICO', 'LTV', 'DTI', 'Interest Rate'
    min_value DECIMAL(10,2),
    max_value DECIMAL(10,2),
    is_active BOOLEAN DEFAULT TRUE,
    PRIMARY KEY (client_id, range_name)
);

-- Use in range calculations
SELECT 
    CASE 
        WHEN fico_score < (SELECT min_value FROM range_config 
                          WHERE client_id = CURRENT_SETTING('app.client_id', TRUE) 
                          AND range_name = 'FICO')
        THEN 'Values<' || (SELECT min_value::TEXT FROM range_config 
                          WHERE client_id = CURRENT_SETTING('app.client_id', TRUE) 
                          AND range_name = 'FICO')
        -- ... rest of range logic
    END as fico_range_std
FROM loans;
```

---

## Range Sort Mappings

All ranges have corresponding sort mappings for proper display ordering:

- **FICORangeSortMap**: Maps FICO range labels to sort order
- **LTVRangeSortMap**: Maps LTV range labels to sort order
- **DTIRangeSortMap**: Maps DTI range labels to sort order
- **InterestRateRangeSortMap**: Maps interest rate range labels to sort order
- **OriginalBalanceRangeSortMap**: Maps loan amount range labels to sort order

**See**: `core/mapping-tables.md` for complete sort mapping documentation.

---

## Dependencies

- Base fields (FICO Score, LTV Ratio, DTI Ratio, Loan Amount, Interest Rate, Date fields)
- NULL handling patterns (see `patterns/null-handling.md`)
- Range configuration (XML or database tables)
- Range sort mappings (see `core/mapping-tables.md`)

## Used In

- DataPilot app (heavily used for validation)
- All apps (for grouping and analysis)
- Reporting and dashboards

## Source Fields

Stratification uses fields from the [Coheus Data Dictionary](../../data-dictionary/CoheusDataDictionary.xml):

**Key Fields**:
- `FICO Score` (Encompass: `Fields.1109` or derived) - FICO range calculations
- `LTV Ratio` (Encompass: derived from Loan Amount / Property Value) - LTV range calculations
- `BE DTI Ratio` (Encompass: `Fields.1305` or derived) - DTI range calculations
- `Interest Rate` (Encompass: `Fields.3` or derived) - Interest rate range calculations
- `Loan Amount` (Encompass: `Fields.11`) - Original balance range calculations
- Date fields (Application Date, Funding Date, etc.) - Year stratification

**See**: `patterns/source-fields.md` for complete data dictionary integration guide.

---

## Migration Notes

- **Stratification is simple CASE statements** - no pre-computation needed
- **Can create reusable bucket functions** if patterns repeat
- **Consider creating views** if stratifications are used frequently
- **NULL handling is important** - always include NULL case
- **Configurable ranges** should be stored in database tables, not XML files
- **Range sort mappings** should be implemented as lookup tables
- **Performance**: Index range fields if used frequently in WHERE clauses

## See Also

- Patterns: `patterns/null-handling.md` - NULL handling for missing values
- Patterns: `patterns/aggregation-patterns.md` - Class() bucketing pattern
- Qlik implementation: `core/transform-logic.md` and `apps/datapilot-app-logic.md`
