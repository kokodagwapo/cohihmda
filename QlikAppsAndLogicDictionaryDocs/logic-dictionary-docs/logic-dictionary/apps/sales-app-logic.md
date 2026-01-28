# Sales App Logic Dictionary

**Source Files**: `tvd-coheus-sales-qlik/Scripts/*.qvs`

This document catalogs Sales app-specific logic that extends or differs from core Transform.qvs logic.

---

## App-Specific Fields

### Active Aging Days
**Category**: Turn Time  
**Definition**: Days from Application Date to current date for active loans  
**Qlik Expression**:
```qvs
If([Active Loan Flag] = 'Yes',
   Floor($(vCurrentDate)-"Application Date"),Null()) as [Active Aging Days]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN active_loan_flag = 'Yes' THEN
        FLOOR(CURRENT_DATE - application_date)
    ELSE NULL
END as active_aging_days
```
**Dependencies**: `Active Loan Flag`, `Application Date`, `vCurrentDate`  
**Used In**: Sales app  
**Business Rules**: Only calculated for active loans  
**Migration Notes**: Date difference calculation

---

### Active Aging Range
**Category**: Stratification  
**Definition**: Categorization of active aging days into ranges  
**Qlik Expression**:
```qvs
If([Active Loan Flag] = 'Yes',
   If($(vCurrentDate)-"Application Date"<=15,Dual('0-15',1),
     If($(vCurrentDate)-"Application Date"<=30,Dual('16-30',2),
       If($(vCurrentDate)-"Application Date"<=45,Dual('31-45',3),
         If($(vCurrentDate)-"Application Date"<=60,Dual('46-60',4),
           If($(vCurrentDate)-"Application Date"<=90,Dual('61-90',5),
             Dual('> 90',6)))))),Null()) as [Active Aging Range]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN active_loan_flag = 'Yes' THEN
        CASE 
            WHEN CURRENT_DATE - application_date <= 15 THEN '0-15'
            WHEN CURRENT_DATE - application_date <= 30 THEN '16-30'
            WHEN CURRENT_DATE - application_date <= 45 THEN '31-45'
            WHEN CURRENT_DATE - application_date <= 60 THEN '46-60'
            WHEN CURRENT_DATE - application_date <= 90 THEN '61-90'
            ELSE '> 90'
        END
    ELSE NULL
END as active_aging_range
```
**Dependencies**: `Active Loan Flag`, `Application Date`, `vCurrentDate`  
**Used In**: Sales app  
**Business Rules**: Buckets active loan age for analysis  
**Migration Notes**: Nested CASE statements

---

### Active Aging Days > 90
**Category**: Stratification  
**Definition**: Extended aging ranges for loans older than 90 days  
**Qlik Expression**:
```qvs
If([Active Loan Flag] = 'Yes',
   If($(vCurrentDate)-"Application Date">90 AND $(vCurrentDate)-"Application Date"<=120,Dual('91-120',1),
     If($(vCurrentDate)-"Application Date">120 AND $(vCurrentDate)-"Application Date"<=150,Dual('121-150',2),
       If($(vCurrentDate)-"Application Date">150 AND $(vCurrentDate)-"Application Date"<=180,Dual('151-180',3),
         If($(vCurrentDate)-"Application Date">180 AND $(vCurrentDate)-"Application Date"<=210,Dual('181-210',4),
           If($(vCurrentDate)-"Application Date">210 AND $(vCurrentDate)-"Application Date"<=240,Dual('211-240',5),
             If($(vCurrentDate)-"Application Date">240 AND $(vCurrentDate)-"Application Date"<=270,Dual('241-270',6),
               If($(vCurrentDate)-"Application Date">270,Dual('> 270',7),Null()))))))) as [Active Aging Days > 90]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN active_loan_flag = 'Yes' THEN
        CASE 
            WHEN CURRENT_DATE - application_date > 90 AND CURRENT_DATE - application_date <= 120 THEN '91-120'
            WHEN CURRENT_DATE - application_date > 120 AND CURRENT_DATE - application_date <= 150 THEN '121-150'
            WHEN CURRENT_DATE - application_date > 150 AND CURRENT_DATE - application_date <= 180 THEN '151-180'
            WHEN CURRENT_DATE - application_date > 180 AND CURRENT_DATE - application_date <= 210 THEN '181-210'
            WHEN CURRENT_DATE - application_date > 210 AND CURRENT_DATE - application_date <= 240 THEN '211-240'
            WHEN CURRENT_DATE - application_date > 240 AND CURRENT_DATE - application_date <= 270 THEN '241-270'
            WHEN CURRENT_DATE - application_date > 270 THEN '> 270'
            ELSE NULL
        END
    ELSE NULL
END as active_aging_days_over_90
```
**Dependencies**: `Active Loan Flag`, `Application Date`, `vCurrentDate`  
**Used In**: Sales app  
**Business Rules**: Extended ranges for older active loans  
**Migration Notes**: Multiple range checks

---

### Lock Expire Days Range (Main)
**Category**: Stratification  
**Definition**: Categorization of lock expiration days  
**Qlik Expression**:
```qvs
If(Len(Trim([Lock Expiration Date]))=0, Dual('Lock Expiration Date Blank',8), 
   If([Lock Expiration Date] - $(vCurrentDate)<0,Dual('Expired',7),
     If([Lock Expiration Date] - $(vCurrentDate)=0,Dual('Expiring Today',1),
       If([Lock Expiration Date] - $(vCurrentDate)<=7,Dual('1-7 Days',2),
         If([Lock Expiration Date] - $(vCurrentDate)<=14,Dual('8-14 Days',3),
           If([Lock Expiration Date] - $(vCurrentDate)<=21,Dual('15-21 Days',4),
             If([Lock Expiration Date] - $(vCurrentDate)<=30,Dual('22-30 Days',5),
               Dual('>30 Days',6)))))))) as [Lock Expire Days Range (Main)]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN lock_expiration_date IS NULL THEN 'Lock Expiration Date Blank'
    WHEN lock_expiration_date - CURRENT_DATE < 0 THEN 'Expired'
    WHEN lock_expiration_date - CURRENT_DATE = 0 THEN 'Expiring Today'
    WHEN lock_expiration_date - CURRENT_DATE <= 7 THEN '1-7 Days'
    WHEN lock_expiration_date - CURRENT_DATE <= 14 THEN '8-14 Days'
    WHEN lock_expiration_date - CURRENT_DATE <= 21 THEN '15-21 Days'
    WHEN lock_expiration_date - CURRENT_DATE <= 30 THEN '22-30 Days'
    ELSE '>30 Days'
END as lock_expire_days_range_main
```
**Dependencies**: `Lock Expiration Date`, `vCurrentDate`  
**Used In**: Sales app  
**Business Rules**: Categorizes lock expiration status  
**Migration Notes**: Date difference with categorization

---

### Lock Expire 10 Days Flag / Lock Expire 11-30 Days Flag / Lock Expire >30 Days Flag
**Category**: Status Flags  
**Definition**: Flags for lock expiration ranges  
**Qlik Expression**:
```qvs
If([Lock Expiration Date] - $(vCurrentDate)>0 AND [Lock Expiration Date] - $(vCurrentDate)<=10,'Yes','No') as [Lock Expire 10 Days Flag]
If([Lock Expiration Date] - $(vCurrentDate)>10 AND [Lock Expiration Date] - $(vCurrentDate)<=30,'Yes','No') as [Lock Expire 11-30 Days Flag]
If([Lock Expiration Date] - $(vCurrentDate)>30,'Yes','No') as [Lock Expire >30 Days Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN lock_expiration_date - CURRENT_DATE > 0 
         AND lock_expiration_date - CURRENT_DATE <= 10 
    THEN 'Yes' ELSE 'No' 
END as lock_expire_10_days_flag

CASE 
    WHEN lock_expiration_date - CURRENT_DATE > 10 
         AND lock_expiration_date - CURRENT_DATE <= 30 
    THEN 'Yes' ELSE 'No' 
END as lock_expire_11_30_days_flag

CASE 
    WHEN lock_expiration_date - CURRENT_DATE > 30 
    THEN 'Yes' ELSE 'No' 
END as lock_expire_over_30_days_flag
```
**Dependencies**: `Lock Expiration Date`, `vCurrentDate`  
**Used In**: Sales app  
**Business Rules**: Flags for specific lock expiration ranges  
**Migration Notes**: Date range checks

---

## Revenue Logic

### Revenue Field Extraction
**Category**: Revenue  
**Definition**: Extracts revenue field names from configuration XML  
**Qlik Expression**:
```qvs
// From REVENUE.qvs
If(Len(Formula)>0,SubField(Trim(Formula),']'),SubField('[Base Buy ($)]+[Orig Fee Borr Pd]+[Orig Fees Seller]-[CD Lender Credits]',']')) as RevenueFields
```
**SQL Equivalent**:
```sql
-- Parse formula string to extract field names
-- Could use regex or string functions
SELECT regexp_split_to_table(formula, '\+|\-') as revenue_field
FROM revenue_config
```
**Dependencies**: Revenue configuration XML  
**Used In**: Sales app  
**Business Rules**: Dynamically extracts fields used in revenue formula  
**Migration Notes**: String parsing logic

---

## TPO-Specific Logic

### Registration Date Flags (TPO Only)
**Category**: Date Flags  
**Definition**: Rolling period flags for Registration Date (TPO only)  
**Qlik Expression**:
```qvs
$(fRolling12MonthFlag("Registration Date")) as [Registration Date Rolling 12 Month Flag]
$(fRolling13MonthFlag("Registration Date")) as [Registration Date Rolling 13 Month Flag]
```
**SQL Equivalent**:
```sql
-- Same as other rolling flags but for Registration Date
CASE 
    WHEN registration_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '12 months' 
         AND registration_date <= CURRENT_DATE 
    THEN 'Yes' ELSE 'No' 
END as registration_date_rolling_12_month_flag
```
**Dependencies**: `Registration Date`, function `fRolling12MonthFlag`, `fRolling13MonthFlag`  
**Used In**: Sales app (TPO only)  
**Business Rules**: TPO-specific date flags  
**Migration Notes**: Conditional logic based on TPO flag

---

## Revenue Calculations

**See**: `derived/revenue-calculations.md` for complete revenue calculation documentation including:
- Revenue_Sales formula
- Revenue configuration logic
- Formula parsing and evaluation
- Margin (BPS) calculations (default uses Revenue_Sales)

## Pull Through Calculations

**See**: `derived/pull-through-calculations.md` for pull-through metrics used in Sales app

## Expression Usage

**See**: `validation/expression-categories.md` for expression categorization and:
- `validation/qsda-cross-reference.md` for QSDA analysis findings
- Common expression patterns used in Sales app

---

## Notes

- Sales app extends core logic with active loan aging calculations
- Lock expiration logic is more detailed than core Transform.qvs
- Revenue field extraction is dynamic from configuration
- TPO-specific fields are conditionally added based on `vTPOCheck`

## See Also

- **Revenue Calculations**: `derived/revenue-calculations.md` - Revenue_Sales and margin calculations
- **Pull Through**: `derived/pull-through-calculations.md` - Pull-through metrics
- **Date Functions**: `core/functions.md` - Date flag functions (TPO-specific)
- **Expression Categories**: `validation/expression-categories.md` - Expression patterns
- **QSDA Cross-Reference**: `validation/qsda-cross-reference.md` - App-specific findings
