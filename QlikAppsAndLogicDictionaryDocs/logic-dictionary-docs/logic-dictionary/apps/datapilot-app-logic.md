# DataPilot App Logic Dictionary

**Source Files**: `tvd-coheus-datapilot-qlik/Scripts/*.qvs`

This document catalogs DataPilot app-specific logic, particularly stratification fields.

---

## Stratification Fields

### Date Year Stratification
**Category**: Stratification  
**Definition**: Year fields with 'Date Missing' for NULL values  
**Qlik Expression**:
```qvs
If(Len(Trim([Credit Pull Year]))=0,'Date Missing',[Credit Pull Year]) as [Credit Pull Year_Strat]
If(Len(Trim([Application Year]))=0,'Date Missing',[Application Year]) as [Application Year_Strat]
If(Len(Trim([Closing Year]))=0,'Date Missing',[Closing Year]) as [Closing Year_Strat]
If(Len(Trim([Funding Year]))=0,'Date Missing',[Funding Year]) as [Funding Year_Strat]
// ... similar for other date fields
```
**SQL Equivalent**:
```sql
CASE 
    WHEN credit_pull_year IS NULL THEN 'Date Missing'
    ELSE credit_pull_year::text
END as credit_pull_year_strat

CASE 
    WHEN application_year IS NULL THEN 'Date Missing'
    ELSE application_year::text
END as application_year_strat

-- Similar for all date year fields
```
**Dependencies**: Date Year fields  
**Used In**: DataPilot app  
**Business Rules**: Handles missing dates by assigning 'Date Missing' category  
**Migration Notes**: NULL handling with CASE statement

---

### Range Validation Fields

#### FICO Ranges
**Category**: Validation Flags  
**Definition**: Flag indicating if FICO Score is within acceptable range  
**Qlik Expression**:
```qvs
If([FICO Score]<$(vFICOMin) OR [FICO Score]>$(vFICOMax),'Out of Range','In Range') as [FICO Ranges]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN fico_score < fico_min OR fico_score > fico_max THEN 'Out of Range'
    ELSE 'In Range'
END as fico_ranges
```
**Dependencies**: `FICO Score`, `vFICOMin`, `vFICOMax`  
**Used In**: DataPilot app  
**Business Rules**: Validates FICO score against configurable min/max  
**Migration Notes**: Range validation with parameters

---

#### DTI Ranges
**Category**: Validation Flags  
**Definition**: Flag indicating if DTI Ratio is within acceptable range  
**Qlik Expression**:
```qvs
If([BE DTI Ratio]<$(vDTIMin) OR [BE DTI Ratio]>$(vDTIMax),'Out of Range','In Range') as [DTI Ranges]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN be_dti_ratio < dti_min OR be_dti_ratio > dti_max THEN 'Out of Range'
    ELSE 'In Range'
END as dti_ranges
```
**Dependencies**: `BE DTI Ratio`, `vDTIMin`, `vDTIMax`  
**Used In**: DataPilot app  
**Business Rules**: Validates DTI ratio against configurable min/max  
**Migration Notes**: Range validation

---

#### LTV Ranges
**Category**: Validation Flags  
**Definition**: Flag indicating if LTV Ratio is within acceptable range  
**Qlik Expression**:
```qvs
If([LTV Ratio]<$(vLTVMin) OR [LTV Ratio]>$(vLTVMax),'Out of Range','In Range') as [LTV Ranges]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN ltv_ratio < ltv_min OR ltv_ratio > ltv_max THEN 'Out of Range'
    ELSE 'In Range'
END as ltv_ranges
```
**Dependencies**: `LTV Ratio`, `vLTVMin`, `vLTVMax`  
**Used In**: DataPilot app  
**Business Rules**: Validates LTV ratio against configurable min/max  
**Migration Notes**: Range validation

---

#### Interest Rate Ranges
**Category**: Validation Flags  
**Definition**: Flag indicating if Interest Rate is within acceptable range  
**Qlik Expression**:
```qvs
If([Interest Rate]<$(vInterestMin) OR [Interest Rate]>$(vInterestMax),'Out of Range','In Range') as [Interest Rate Ranges]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN interest_rate < interest_min OR interest_rate > interest_max THEN 'Out of Range'
    ELSE 'In Range'
END as interest_rate_ranges
```
**Dependencies**: `Interest Rate`, `vInterestMin`, `vInterestMax`  
**Used In**: DataPilot app  
**Business Rules**: Validates interest rate against configurable min/max  
**Migration Notes**: Range validation

---

### Global Ranges
**Category**: Validation Flags  
**Definition**: Combined range validation across all credit factors  
**Qlik Expression**:
```qvs
If([FICO Ranges] = 'In Range' AND [DTI Ranges] = 'In Range' AND [LTV Ranges] = 'In Range' AND [Interest Rate Ranges] = 'In Range','All In Range',
   If([FICO Ranges] = 'Out of Range' AND [DTI Ranges] = 'Out of Range' AND [LTV Ranges] = 'Out of Range' AND [Interest Rate Ranges] = 'Out of Range','All Out of Range',
       'Partially Out of Range')) as [Global Ranges]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN fico_ranges = 'In Range' 
         AND dti_ranges = 'In Range' 
         AND ltv_ranges = 'In Range' 
         AND interest_rate_ranges = 'In Range' 
    THEN 'All In Range'
    WHEN fico_ranges = 'Out of Range' 
         AND dti_ranges = 'Out of Range' 
         AND ltv_ranges = 'Out of Range' 
         AND interest_rate_ranges = 'Out of Range' 
    THEN 'All Out of Range'
    ELSE 'Partially Out of Range'
END as global_ranges
```
**Dependencies**: `FICO Ranges`, `DTI Ranges`, `LTV Ranges`, `Interest Rate Ranges`  
**Used In**: DataPilot app  
**Business Rules**: Aggregates individual range validations  
**Migration Notes**: Multiple condition check

---

### Loan Amount Range Stratification
**Category**: Stratification  
**Definition**: Categorization of loan amounts into ranges  
**Qlik Expression**:
```qvs
If("Loan Amount" > 50000 AND "Loan Amount" <= 750000, "Original Balance Range",
   If("Loan Amount" < 0, 'Below 0',
   If("Loan Amount" <= 10000, '0-10,000',
   If("Loan Amount" <= 20000, '10,000.01-20,000',
   If("Loan Amount" <= 30000, '20,000.01-30,000',
   If("Loan Amount" <= 40000, '30,000.01-40,000',
   If("Loan Amount" <= 50000, '40,000.01-50,000',
   -- ... continues
```
**SQL Equivalent**:
```sql
CASE 
    WHEN loan_amount > 50000 AND loan_amount <= 750000 THEN 'Original Balance Range'
    WHEN loan_amount < 0 THEN 'Below 0'
    WHEN loan_amount <= 10000 THEN '0-10,000'
    WHEN loan_amount <= 20000 THEN '10,000.01-20,000'
    WHEN loan_amount <= 30000 THEN '20,000.01-30,000'
    WHEN loan_amount <= 40000 THEN '30,000.01-40,000'
    WHEN loan_amount <= 50000 THEN '40,000.01-50,000'
    -- ... etc
END as loan_amount_range
```
**Dependencies**: `Loan Amount`  
**Used In**: DataPilot app  
**Business Rules**: Buckets loan amounts for analysis  
**Migration Notes**: Multiple threshold checks

---

### RESPA App Status
**Category**: Validation Flags  
**Definition**: Flag indicating if loan has Application Date (RESPA requirement)  
**Qlik Expression**:
```qvs
if(Len(Trim([Application Date]))>0,'Yes','No') as [RESPA App Status]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN application_date IS NOT NULL THEN 'Yes'
    ELSE 'No'
END as respa_app_status
```
**Dependencies**: `Application Date`  
**Used In**: DataPilot app  
**Business Rules**: RESPA compliance check  
**Migration Notes**: NULL check

---

### Loan Amount Populated
**Category**: Validation Flags  
**Definition**: Flag indicating if Loan Amount is greater than 0  
**Qlik Expression**:
```qvs
if([Loan Amount]>0,'Yes','No') as [Loan Amount Populated]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN loan_amount > 0 THEN 'Yes'
    ELSE 'No'
END as loan_amount_populated
```
**Dependencies**: `Loan Amount`  
**Used In**: DataPilot app  
**Business Rules**: Validates loan amount exists and is positive  
**Migration Notes**: Simple comparison

---

## Notes

- DataPilot focuses heavily on data validation and stratification
- Range validations use configurable min/max variables
- Stratification fields handle missing values explicitly
- Global Ranges aggregates individual validations
