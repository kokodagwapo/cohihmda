# Transform.qvs Logic Dictionary

**Source File**: `tvd-coheus-incremental-builder-qlik/Transform.qvs`

This document catalogs all business logic definitions from the Transform.qvs script, which is the core data transformation script for the Qlik applications.

**Note**: This document shows Qlik-specific implementations. For base concept definitions and PostgreSQL translations, see:
- Base concepts: `concepts/` directory
- Qlik patterns: `patterns/` directory  
- Derived logic: `derived/` directory

---

## Table of Contents

1. [Date Flags](#date-flags) - *Qlik pattern, see `patterns/date-period-filtering.md`*
2. [Turn Time Calculations](#turn-time-calculations) - *Base concept: `concepts/turn-time.md`*
3. [Status Flags](#status-flags) - *Base concept: `concepts/status-flags.md`*
4. [Channel Flags](#channel-flags) - *Base concept: `concepts/channel-logic.md`*
5. [Revenue Calculations](#revenue-calculations) - *Base concept: `concepts/revenue.md`*
6. [Complexity Scores](#complexity-scores) - *Base concept: `concepts/complexity.md`*
7. [Year/Month Fields](#yearmonth-fields) - *Qlik pattern, see `patterns/date-groupings.md`*
8. [Multi-Channel Logic](#multi-channel-logic) - *Base concept: `concepts/channel-logic.md`*
9. [Section Access (Row-Level Security)](#section-access-row-level-security) - *Qlik pattern, see `patterns/section-access-row-security.md`*
10. [Other Calculated Fields](#other-calculated-fields)

---

## Date Flags

**Note**: Date flags are a Qlik-specific pattern for filtering in set analysis. In PostgreSQL, these translate to reusable functions (not computed columns). See `patterns/date-period-filtering.md` for PostgreSQL translation.

### Application All Time
**Category**: Date Flags  
**Definition**: Flag indicating all loans with an application date (always 'Yes' for all records)  
**Qlik Expression**:
```qvs
'Yes' as [Application All Time]
```
**SQL Equivalent**:
```sql
TRUE as application_all_time
```
**Dependencies**: None  
**Used In**: All apps  
**Business Rules**: This is a universal flag set to 'Yes' for all records to enable "All Time" filtering  
**Migration Notes**: In PostgreSQL, this can be a computed column that always returns TRUE, or a constant column

---

### Funding All Time
**Category**: Date Flags  
**Definition**: Flag indicating all loans with a funding date (always 'Yes' for all records)  
**Qlik Expression**:
```qvs
'Yes' as [Funding All Time]
```
**SQL Equivalent**:
```sql
TRUE as funding_all_time
```
**Dependencies**: None  
**Used In**: All apps  
**Business Rules**: Universal flag for "All Time" funding date filtering  
**Migration Notes**: Can be a computed column or constant

---

### Application Date Rolling 13 Month Flag
**Category**: Date Flags  
**Definition**: Flag indicating if Application Date falls within the last 13 months  
**Qlik Expression**:
```qvs
$(fRolling13MonthFlag("Application Date")) as [Application Date Rolling 13 Month Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN application_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '13 months' 
         AND application_date <= CURRENT_DATE 
    THEN 'Yes' 
    ELSE 'No' 
END as application_date_rolling_13_month_flag
```
**Dependencies**: `Application Date`, function `fRolling13MonthFlag`  
**Used In**: All apps  
**Business Rules**: Used for rolling 13-month analysis periods  
**Migration Notes**: Function `fRolling13MonthFlag` needs to be implemented as a PostgreSQL function or inline CASE statement

---

### Application Date Rolling 12 Month Flag
**Category**: Date Flags  
**Definition**: Flag indicating if Application Date falls within the last 12 months  
**Qlik Expression**:
```qvs
$(fRolling12MonthFlag("Application Date")) as [Application Date Rolling 12 Month Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN application_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '12 months' 
         AND application_date <= CURRENT_DATE 
    THEN 'Yes' 
    ELSE 'No' 
END as application_date_rolling_12_month_flag
```
**Dependencies**: `Application Date`, function `fRolling12MonthFlag`  
**Used In**: All apps  
**Business Rules**: Standard 12-month rolling period  
**Migration Notes**: Similar to 13-month flag but with 12-month interval

---

### Application Date Rolling 4Qtr Flag
**Category**: Date Flags  
**Definition**: Flag indicating if Application Date falls within the last 4 quarters  
**Qlik Expression**:
```qvs
if([Application Date]>$(vMaxDate),'No', 
   if([Application Date] >= QuarterStart($(vMaxDate),-4) 
      AND [Application Date] <= QuarterEnd($(vMaxDate),0), 
      'Yes', 'No')) as [Application Rolling 4Qtr Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN application_date > CURRENT_DATE THEN 'No'
    WHEN application_date >= DATE_TRUNC('quarter', CURRENT_DATE) - INTERVAL '4 quarters'
         AND application_date <= DATE_TRUNC('quarter', CURRENT_DATE) + INTERVAL '3 months' - INTERVAL '1 day'
    THEN 'Yes'
    ELSE 'No'
END as application_rolling_4qtr_flag
```
**Dependencies**: `Application Date`, `vMaxDate`  
**Used In**: All apps  
**Business Rules**: 4-quarter rolling period for quarterly analysis  
**Migration Notes**: Requires quarter calculation functions

---

### Closing Rolling 13 Month Flag
**Category**: Date Flags  
**Definition**: Flag indicating if Closing Date falls within the last 13 months  
**Qlik Expression**:
```qvs
If([Closing Date]>$(vMaxDate),'No',
   if([Closing Date]>=AddMonths(MonthEnd($(vMaxDate)),-13,1),'Yes','No')) 
   as [Closing Rolling 13 Month Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN closing_date > CURRENT_DATE THEN 'No'
    WHEN closing_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '13 months'
         AND closing_date <= CURRENT_DATE
    THEN 'Yes'
    ELSE 'No'
END as closing_rolling_13_month_flag
```
**Dependencies**: `Closing Date`, `vMaxDate`  
**Used In**: All apps  
**Business Rules**: 13-month rolling period for closing date analysis  
**Migration Notes**: Uses AddMonths function which translates to PostgreSQL INTERVAL arithmetic

---

### Funding Rolling 13 Month Flag
**Category**: Date Flags  
**Definition**: Flag indicating if Funding Date falls within the last 13 months  
**Qlik Expression**:
```qvs
$(fRolling13MonthFlag("Funding Date")) as [Funding Rolling 13 Month Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN funding_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '13 months' 
         AND funding_date <= CURRENT_DATE 
    THEN 'Yes' 
    ELSE 'No' 
END as funding_rolling_13_month_flag
```
**Dependencies**: `Funding Date`, function `fRolling13MonthFlag`  
**Used In**: All apps  
**Business Rules**: Standard rolling 13-month period for funding analysis  
**Migration Notes**: Function-based implementation

---

### Application Today Flag
**Category**: Date Flags  
**Definition**: Flag indicating if Application Date is today  
**Qlik Expression**:
```qvs
$(fTodayFlag("Application Date")) as [Application Today Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN DATE(application_date) = CURRENT_DATE THEN 'Yes'
    ELSE 'No'
END as application_today_flag
```
**Dependencies**: `Application Date`, function `fTodayFlag`  
**Used In**: All apps  
**Business Rules**: Daily filtering for current day applications  
**Migration Notes**: Simple date comparison

---

### Application Yesterday Flag
**Category**: Date Flags  
**Definition**: Flag indicating if Application Date is yesterday  
**Qlik Expression**:
```qvs
$(fYesterdayFlag("Application Date")) as [Application Yesterday Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN DATE(application_date) = CURRENT_DATE - INTERVAL '1 day' THEN 'Yes'
    ELSE 'No'
END as application_yesterday_flag
```
**Dependencies**: `Application Date`, function `fYesterdayFlag`  
**Used In**: All apps  
**Business Rules**: Previous day filtering  
**Migration Notes**: Date arithmetic with INTERVAL

---

### Application Last Week Flag
**Category**: Date Flags  
**Definition**: Flag indicating if Application Date falls within the last week  
**Qlik Expression**:
```qvs
$(fLastWeekFlag("Application Date")) as [Application Last Week Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN application_date >= DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '1 week'
         AND application_date < DATE_TRUNC('week', CURRENT_DATE)
    THEN 'Yes'
    ELSE 'No'
END as application_last_week_flag
```
**Dependencies**: `Application Date`, function `fLastWeekFlag`  
**Used In**: All apps  
**Business Rules**: Weekly period filtering  
**Migration Notes**: Week calculation using DATE_TRUNC

---

### Application Month
**Category**: Date Flags  
**Definition**: Month number extracted from Application Date  
**Qlik Expression**:
```qvs
$(fMonth([Application Date])) as [Application Month]
```
**SQL Equivalent**:
```sql
EXTRACT(MONTH FROM application_date) as application_month
```
**Dependencies**: `Application Date`, function `fMonth`  
**Used In**: All apps  
**Business Rules**: Month grouping for time-based analysis  
**Migration Notes**: PostgreSQL EXTRACT function

---

### Application Rolling 0-60 Flag
**Category**: Date Flags  
**Definition**: Flag indicating if Application Date falls within the last 0-60 days  
**Qlik Expression**:
```qvs
$(fRolling0to60Flag("Application Date")) AS [Application Rolling 0-60 Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN application_date >= CURRENT_DATE - INTERVAL '60 days'
         AND application_date <= CURRENT_DATE
    THEN 'Yes'
    ELSE 'No'
END as application_rolling_0_60_flag
```
**Dependencies**: `Application Date`, function `fRolling0to60Flag`  
**Used In**: All apps  
**Business Rules**: 60-day rolling window  
**Migration Notes**: Date range check with INTERVAL

---

### Application Rolling 61-120 Flag
**Category**: Date Flags  
**Definition**: Flag indicating if Application Date falls within the 61-120 day range  
**Qlik Expression**:
```qvs
$(fRolling61to120Flag("Application Date")) AS [Application Rolling 61-120 Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN application_date >= CURRENT_DATE - INTERVAL '120 days'
         AND application_date < CURRENT_DATE - INTERVAL '60 days'
    THEN 'Yes'
    ELSE 'No'
END as application_rolling_61_120_flag
```
**Dependencies**: `Application Date`, function `fRolling61to120Flag`  
**Used In**: All apps  
**Business Rules**: 61-120 day window for older applications  
**Migration Notes**: Date range with two boundaries

---

### Application Rolling 0-360 Flag
**Category**: Date Flags  
**Definition**: Flag indicating if Application Date falls within the last 360 days  
**Qlik Expression**:
```qvs
$(fRolling0to360Flag("Application Date")) AS [Application Rolling 0-360 Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN application_date >= CURRENT_DATE - INTERVAL '360 days'
         AND application_date <= CURRENT_DATE
    THEN 'Yes'
    ELSE 'No'
END as application_rolling_0_360_flag
```
**Dependencies**: `Application Date`, function `fRolling0to360Flag`  
**Used In**: All apps  
**Business Rules**: Annual rolling window  
**Migration Notes**: 360-day period (approximately 1 year)

---

### Application Rolling 361-720 Flag
**Category**: Date Flags  
**Definition**: Flag indicating if Application Date falls within the 361-720 day range  
**Qlik Expression**:
```qvs
$(fRolling361to720Flag("Application Date")) AS [Application Rolling 361-720 Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN application_date >= CURRENT_DATE - INTERVAL '720 days'
         AND application_date < CURRENT_DATE - INTERVAL '360 days'
    THEN 'Yes'
    ELSE 'No'
END as application_rolling_361_720_flag
```
**Dependencies**: `Application Date`, function `fRolling361to720Flag`  
**Used In**: All apps  
**Business Rules**: Second year rolling window  
**Migration Notes**: 361-720 day range (approximately year 2)

---

## Turn Time Calculations

**Base Concept**: See `concepts/turn-time.md` for the core turn time definition.

**Note**: All turn time calculations use calendar days (Date(Floor())), not business days. Comments indicate that NetWorkDays was previously used but changed to calendar days.

**Derived Logic**: Turn time ranges (buckets) are documented in `derived/turn-time-ranges.md`.

### Start-App
**Category**: Turn Time  
**Definition**: Days from Started Date to Application Date  
**Qlik Expression**:
```qvs
Date(Floor([Application Date]))-Date(Floor([Started Date])) as [Start-App]
```
**SQL Equivalent**:
```sql
DATE(application_date) - DATE(started_date) as start_app_days
```
**Dependencies**: `Application Date`, `Started Date`  
**Used In**: All apps  
**Business Rules**: Measures time from loan start to application submission  
**Migration Notes**: Simple date subtraction in PostgreSQL

---

### App-EstClose
**Category**: Turn Time  
**Definition**: Days from Application Date to Estimated Closing Date  
**Qlik Expression**:
```qvs
Date(Floor("Estimated Closing Date"))-Date(Floor([Application Date])) as [App-EstClose]
```
**SQL Equivalent**:
```sql
DATE(estimated_closing_date) - DATE(application_date) as app_estclose_days
```
**Dependencies**: `Application Date`, `Estimated Closing Date`  
**Used In**: All apps  
**Business Rules**: Time to projected closing from application  
**Migration Notes**: Date difference calculation

---

### App-Close
**Category**: Turn Time  
**Definition**: Days from Application Date to Closing Date  
**Qlik Expression**:
```qvs
Date(Floor([Closing Date]))-Date(Floor([Application Date])) as [App-Close]
```
**SQL Equivalent**:
```sql
DATE(closing_date) - DATE(application_date) as app_close_days
```
**Dependencies**: `Application Date`, `Closing Date`  
**Used In**: All apps  
**Business Rules**: Actual time to closing from application  
**Migration Notes**: Core turn time metric

---

### App-Fund
**Category**: Turn Time  
**Definition**: Days from Application Date to Funding Date  
**Qlik Expression**:
```qvs
Date(Floor([Funding Date]))-Date(Floor([Application Date])) as [App-Fund]
```
**SQL Equivalent**:
```sql
DATE(funding_date) - DATE(application_date) as app_fund_days
```
**Dependencies**: `Application Date`, `Funding Date`  
**Used In**: All apps  
**Business Rules**: Total time from application to funding  
**Migration Notes**: End-to-end turn time metric

---

### App-InvPurch
**Category**: Turn Time  
**Definition**: Days from Application Date to Investor Purchase Date  
**Qlik Expression**:
```qvs
Date(Floor([Investor Purchase Date]))-Date(Floor([Application Date])) as [App-InvPurch]
```
**SQL Equivalent**:
```sql
DATE(investor_purchase_date) - DATE(application_date) as app_invpurch_days
```
**Dependencies**: `Application Date`, `Investor Purchase Date`  
**Used In**: All apps  
**Business Rules**: Time from application to sale to investor  
**Migration Notes**: Includes post-funding investor sale time

---

### Fund-Ship
**Category**: Turn Time  
**Definition**: Days from Funding Date to Shipped Date  
**Qlik Expression**:
```qvs
Date(Floor([Shipped Date]))-Date(Floor([Funding Date])) as [Fund-Ship]
```
**SQL Equivalent**:
```sql
DATE(shipped_date) - DATE(funding_date) as fund_ship_days
```
**Dependencies**: `Funding Date`, `Shipped Date`  
**Used In**: All apps  
**Business Rules**: Time between funding and shipping to investor  
**Migration Notes**: Post-funding processing time

---

### Fund-InvPurch
**Category**: Turn Time  
**Definition**: Days from Funding Date to Investor Purchase Date  
**Qlik Expression**:
```qvs
Date(Floor([Investor Purchase Date]))-Date(Floor([Funding Date])) as [Fund-InvPurch]
```
**SQL Equivalent**:
```sql
DATE(investor_purchase_date) - DATE(funding_date) as fund_invpurch_days
```
**Dependencies**: `Funding Date`, `Investor Purchase Date`  
**Used In**: All apps  
**Business Rules**: Time from funding to investor purchase  
**Migration Notes**: Warehouse line duration metric

---

### Ship-InvPurch
**Category**: Turn Time  
**Definition**: Days from Shipped Date to Investor Purchase Date  
**Qlik Expression**:
```qvs
Date(Floor([Investor Purchase Date]))-Date(Floor([Shipped Date])) as [Ship-InvPurch]
```
**SQL Equivalent**:
```sql
DATE(investor_purchase_date) - DATE(shipped_date) as ship_invpurch_days
```
**Dependencies**: `Shipped Date`, `Investor Purchase Date`  
**Used In**: All apps  
**Business Rules**: Time from shipping to investor purchase  
**Migration Notes**: Post-shipment processing time

---

### Final Appr-CTC
**Category**: Turn Time  
**Definition**: Days from UW Final Approval Date to CTC Date  
**Qlik Expression**:
```qvs
Date(Floor("CTC Date")) - Date(Floor("UW Final Approval Date")) as [Final Appr-CTC]
```
**SQL Equivalent**:
```sql
DATE(ctc_date) - DATE(uw_final_approval_date) as final_appr_ctc_days
```
**Dependencies**: `UW Final Approval Date`, `CTC Date`  
**Used In**: All apps  
**Business Rules**: Time from final approval to clear to close  
**Migration Notes**: Underwriting to closing milestone

---

### CTC-Fund
**Category**: Turn Time  
**Definition**: Days from CTC Date to Funding Date  
**Qlik Expression**:
```qvs
Date(Floor("Funding Date")) - Date(Floor("CTC Date")) as [CTC-Fund]
```
**SQL Equivalent**:
```sql
DATE(funding_date) - DATE(ctc_date) as ctc_fund_days
```
**Dependencies**: `CTC Date`, `Funding Date`  
**Used In**: All apps  
**Business Rules**: Time from clear to close to funding  
**Migration Notes**: Final closing to funding milestone

---

### App-LE Sent Days
**Category**: Turn Time  
**Definition**: Business days from Application Date to Loan Estimate Sent Date (using NetWorkDays, excluding weekends and holidays)  
**Qlik Expression**:
```qvs
If(Len(Trim([Loan Estimate Sent Date]))=0 AND Len(Trim("Application Date"))<>0, 
   If(WildMatch(WeekDay("Application Date"),'Sat','Sun'),
      NetWorkDays("Application Date",$(vCurrentDate),'$(vHolidays)'),
      NetWorkDays("Application Date",$(vCurrentDate),'$(vHolidays)')-1),
   If(Len(Trim([Loan Estimate Sent Date]))<>0 AND Len(Trim("Application Date"))<>0, 
      If(WildMatch(WeekDay("Application Date"),'Sat','Sun'),
         NetWorkDays("Application Date",[Loan Estimate Sent Date],'$(vHolidays)'),
         NetWorkDays("Application Date",[Loan Estimate Sent Date],'$(vHolidays)')-1),
      'Dates Not Posted')) as [App-LE Sent Days]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN loan_estimate_sent_date IS NULL AND application_date IS NOT NULL THEN
        business_days_between(application_date, CURRENT_DATE, holidays) - 
        CASE WHEN EXTRACT(DOW FROM application_date) IN (0,6) THEN 0 ELSE 1 END
    WHEN loan_estimate_sent_date IS NOT NULL AND application_date IS NOT NULL THEN
        business_days_between(application_date, loan_estimate_sent_date, holidays) - 
        CASE WHEN EXTRACT(DOW FROM application_date) IN (0,6) THEN 0 ELSE 1 END
    ELSE NULL
END as app_le_sent_days
```
**Dependencies**: `Application Date`, `Loan Estimate Sent Date`, `vCurrentDate`, `vHolidays`  
**Used In**: All apps  
**Business Rules**: Business days calculation excluding weekends and holidays. Adjusts if application date is weekend.  
**Migration Notes**: Requires business_days_between function that excludes weekends and holidays. Holidays table needed.

---

### App-ApprOrdered Days
**Category**: Turn Time  
**Definition**: Days from Application Date to Appraisal Ordered Date  
**Qlik Expression**:
```qvs
If(Len("Appraisal Ordered Date")>0 AND len("Application Date")>0,
   Round("Appraisal Ordered Date"-"Application Date"),
   Round($(vCurrentDate)-"Application Date")) as [App-ApprOrdered Days]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN appraisal_ordered_date IS NOT NULL AND application_date IS NOT NULL THEN
        ROUND(appraisal_ordered_date - application_date)
    ELSE
        ROUND(CURRENT_DATE - application_date)
END as app_apprordered_days
```
**Dependencies**: `Application Date`, `Appraisal Ordered Date`, `vCurrentDate`  
**Used In**: All apps  
**Business Rules**: If appraisal ordered, use that date; otherwise use current date for active loans  
**Migration Notes**: Uses current date as fallback for loans without appraisal ordered date

---

### CondAppr-CTC Days
**Category**: Turn Time  
**Definition**: Days from Conditional Approval Date to CTC Date  
**Qlik Expression**:
```qvs
If(len("Conditional Approval Date")>0 AND len("CTC Date")>0,
   Round("CTC Date"-"Conditional Approval Date"),
   Round($(vCurrentDate)-"Conditional Approval Date")) as [CondAppr-CTC Days]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN conditional_approval_date IS NOT NULL AND ctc_date IS NOT NULL THEN
        ROUND(ctc_date - conditional_approval_date)
    ELSE
        ROUND(CURRENT_DATE - conditional_approval_date)
END as condappr_ctc_days
```
**Dependencies**: `Conditional Approval Date`, `CTC Date`, `vCurrentDate`  
**Used In**: All apps  
**Business Rules**: Time from conditional approval to clear to close  
**Migration Notes**: Uses current date as fallback for active loans

---

### W-H Days
**Category**: Turn Time  
**Definition**: Warehouse line days - days from Funding Date to Investor Purchase Date (or current date if not purchased)  
**Qlik Expression**:
```qvs
If(Len("Investor Purchase Date")>0, 
   "Investor Purchase Date" - "Funding Date",
   If(Len("Investor Purchase Date")=0 AND Len("Funding Date")>0, 
      Date(Floor($(vMaxDate))) - "Funding Date", 
      0)) as "W-H Days"
```
**SQL Equivalent**:
```sql
CASE 
    WHEN investor_purchase_date IS NOT NULL THEN
        investor_purchase_date - funding_date
    WHEN investor_purchase_date IS NULL AND funding_date IS NOT NULL THEN
        CURRENT_DATE - funding_date
    ELSE 0
END as w_h_days
```
**Dependencies**: `Funding Date`, `Investor Purchase Date`, `vMaxDate`  
**Used In**: All apps  
**Business Rules**: Measures warehouse line duration. Uses current date if loan not yet purchased.  
**Migration Notes**: Key metric for warehouse line management

---

### W-H Days Range
**Category**: Turn Time / Stratification  
**Definition**: Categorization of W-H Days into ranges  
**Qlik Expression**:
```qvs
if("W-H Days" < 0, '<0',
   if("W-H Days" <= 5, '0-5',
   if("W-H Days" <= 10, '6-10',
   if("W-H Days" <= 15, '11-15',
   if("W-H Days" <= 20, '16-20',
   if("W-H Days" <= 25, '21-25',
   '>25')))))) as [W-H Days Range]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN w_h_days < 0 THEN '<0'
    WHEN w_h_days <= 5 THEN '0-5'
    WHEN w_h_days <= 10 THEN '6-10'
    WHEN w_h_days <= 15 THEN '11-15'
    WHEN w_h_days <= 20 THEN '16-20'
    WHEN w_h_days <= 25 THEN '21-25'
    ELSE '>25'
END as w_h_days_range
```
**Dependencies**: `W-H Days`  
**Used In**: All apps  
**Business Rules**: Buckets warehouse line duration for analysis  
**Migration Notes**: Simple CASE statement for categorization

---

## Status Flags

**Base Concept**: See `concepts/status-flags.md` for the core status flag definitions and patterns.

### Funded Flag
**Category**: Status Flags  
**Definition**: Flag indicating if loan has been funded (has Funding Date and date is not in future)  
**Qlik Expression**:
```qvs
If(Len(Trim("Funding Date")) > 0 AND [Funding Date] <= '$(vCurrentDateAsDate)','Yes','No') as [Funded Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN funding_date IS NOT NULL 
         AND funding_date <= CURRENT_DATE 
    THEN 'Yes' 
    ELSE 'No' 
END as funded_flag
```
**Dependencies**: `Funding Date`, `vCurrentDateAsDate`  
**Used In**: All apps  
**Business Rules**: Only counts as funded if date exists and is not in the future  
**Migration Notes**: Date comparison with current date

---

### Sold Flag
**Category**: Status Flags  
**Definition**: Flag indicating if loan has been sold to investor (has Investor Purchase Date)  
**Qlik Expression**:
```qvs
If(Len(Trim("Investor Purchase Date")),'Yes','No') as [Sold Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN investor_purchase_date IS NOT NULL THEN 'Yes'
    ELSE 'No'
END as sold_flag
```
**Dependencies**: `Investor Purchase Date`  
**Used In**: All apps  
**Business Rules**: Simple existence check for investor purchase date  
**Migration Notes**: NULL check

---

### Active Loan Flag
**Category**: Status Flags  
**Definition**: Flag indicating if loan is currently active (Current Loan Status = 'Active Loan' AND has Application Date)  
**Qlik Expression**:
```qvs
if("Current Loan Status" = 'Active Loan' AND Len([Application Date])>0, 'Yes', 'No') as [Active Loan Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN current_loan_status = 'Active Loan' 
         AND application_date IS NOT NULL 
    THEN 'Yes' 
    ELSE 'No' 
END as active_loan_flag
```
**Dependencies**: `Current Loan Status`, `Application Date`  
**Used In**: All apps  
**Business Rules**: Active loans must have status 'Active Loan' and an application date  
**Migration Notes**: Combined condition check

---

### Locked Flag
**Category**: Status Flags  
**Definition**: Flag indicating if loan has a Lock Date  
**Qlik Expression**:
```qvs
If(Len("Lock Date")=0, 'No', 'Yes') as [Locked Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN lock_date IS NULL THEN 'No'
    ELSE 'Yes'
END as locked_flag
```
**Dependencies**: `Lock Date`  
**Used In**: All apps  
**Business Rules**: Simple existence check for lock date  
**Migration Notes**: NULL check

---

### Lock Expired Flag
**Category**: Status Flags  
**Definition**: Flag indicating if Lock Expiration Date has passed  
**Qlik Expression**:
```qvs
If(len("Lock Expiration Date")=0,'Yes',
   if("Lock Expiration Date" < floor($(vMaxDate)), 'Yes', 'No')) as [Lock Expired Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN lock_expiration_date IS NULL THEN 'Yes'
    WHEN lock_expiration_date < CURRENT_DATE THEN 'Yes'
    ELSE 'No'
END as lock_expired_flag
```
**Dependencies**: `Lock Expiration Date`, `vMaxDate`  
**Used In**: All apps  
**Business Rules**: If no expiration date, flag as expired. Otherwise check if date has passed.  
**Migration Notes**: Date comparison with current date

---

### Approved Flag
**Category**: Status Flags  
**Definition**: Flag indicating if loan has UW Final Approval Date  
**Qlik Expression**:
```qvs
If(Len([UW Final Approval Date])=0, 'No', 'Yes') as [Approved Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN uw_final_approval_date IS NULL THEN 'No'
    ELSE 'Yes'
END as approved_flag
```
**Dependencies**: `UW Final Approval Date`  
**Used In**: All apps  
**Business Rules**: Existence check for final approval date  
**Migration Notes**: NULL check

---

### Denied Flag
**Category**: Status Flags  
**Definition**: Flag indicating if loan was denied or incomplete (based on Current Loan Status)  
**Qlik Expression**:
```qvs
If(WildMatch([Current Loan Status],'*denied*','*incomplet*')>0,1,0) as [Denied Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN current_loan_status ILIKE '%denied%' 
      OR current_loan_status ILIKE '%incomplet%' 
    THEN 1 
    ELSE 0 
END as denied_flag
```
**Dependencies**: `Current Loan Status`  
**Used In**: All apps  
**Business Rules**: Uses pattern matching to identify denied/incomplete loans  
**Migration Notes**: PostgreSQL ILIKE for case-insensitive pattern matching

---

### CTC Flag
**Category**: Status Flags  
**Definition**: Flag indicating if loan has CTC Date  
**Qlik Expression**:
```qvs
If(Len("CTC Date")>0,'Yes','No') as [CTC Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN ctc_date IS NOT NULL THEN 'Yes'
    ELSE 'No'
END as ctc_flag
```
**Dependencies**: `CTC Date`  
**Used In**: All apps  
**Business Rules**: Clear to close indicator  
**Migration Notes**: NULL check

---

### LE Sent Flag
**Category**: Status Flags  
**Definition**: Flag indicating if Loan Estimate Sent Date exists  
**Qlik Expression**:
```qvs
if(len([Loan Estimate Sent Date])>0,'Yes','No') as [LE Sent Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN loan_estimate_sent_date IS NOT NULL THEN 'Yes'
    ELSE 'No'
END as le_sent_flag
```
**Dependencies**: `Loan Estimate Sent Date`  
**Used In**: All apps  
**Business Rules**: RESPA compliance indicator  
**Migration Notes**: NULL check

---

### Cond Appr Flag
**Category**: Status Flags  
**Definition**: Flag indicating if Conditional Approval Date exists  
**Qlik Expression**:
```qvs
if(len("Conditional Approval Date")>0,'Yes','No') as [Cond Appr Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN conditional_approval_date IS NOT NULL THEN 'Yes'
    ELSE 'No'
END as cond_appr_flag
```
**Dependencies**: `Conditional Approval Date`  
**Used In**: All apps  
**Business Rules**: Conditional approval indicator  
**Migration Notes**: NULL check

---

### Appraisal Ordered Flag
**Category**: Status Flags  
**Definition**: Flag indicating if Appraisal Ordered Date exists  
**Qlik Expression**:
```qvs
if(len("Appraisal Ordered Date")>0,'Yes','No') as [Appraisal Ordered Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN appraisal_ordered_date IS NOT NULL THEN 'Yes'
    ELSE 'No'
END as appraisal_ordered_flag
```
**Dependencies**: `Appraisal Ordered Date`  
**Used In**: All apps  
**Business Rules**: Appraisal process indicator  
**Migration Notes**: NULL check

---

### Funded Not Purchased Flag
**Category**: Status Flags  
**Definition**: Flag indicating if loan is funded but not yet purchased by investor  
**Qlik Expression**:
```qvs
If(Len("Investor Status") = 0 AND Len("Funding Date")>0 AND Len("Investor Purchase Date")=0, 'Yes','No') as [Funded Not Purchased Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN investor_status IS NULL 
         AND funding_date IS NOT NULL 
         AND investor_purchase_date IS NULL 
    THEN 'Yes' 
    ELSE 'No' 
END as funded_not_purchased_flag
```
**Dependencies**: `Investor Status`, `Funding Date`, `Investor Purchase Date`  
**Used In**: All apps  
**Business Rules**: Identifies loans on warehouse line (funded but not sold)  
**Migration Notes**: Combined NULL checks

---

## Channel Flags

**Base Concept**: See `concepts/channel-logic.md` for the core channel logic definitions.

### Retail Flag
**Category**: Channel Flags  
**Definition**: Flag indicating if loan is Retail channel (using wildcard match)  
**Qlik Expression**:
```qvs
If(WildMatch(Channel, '*Retail*') >= 1, 'Yes', 'No') as [Retail Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN channel ILIKE '%Retail%' THEN 'Yes'
    ELSE 'No'
END as retail_flag
```
**Dependencies**: `Channel`  
**Used In**: All apps  
**Business Rules**: Pattern matching for Retail channel identification  
**Migration Notes**: PostgreSQL ILIKE for case-insensitive matching

---

### TPO Flag
**Category**: Channel Flags  
**Definition**: Flag indicating if loan is TPO channel (Wholesale or Correspondent)  
**Qlik Expression**:
```qvs
if(wildmatch(Channel, '*Whol*', '*Corresp*')>0, 'Yes', 'No') as [TPO Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN channel ILIKE '%Whol%' 
      OR channel ILIKE '%Corresp%' 
    THEN 'Yes' 
    ELSE 'No' 
END as tpo_flag
```
**Dependencies**: `Channel`  
**Used In**: All apps  
**Business Rules**: Identifies Third Party Originator channels  
**Migration Notes**: Multiple pattern matching with OR condition

---

### Correspondent Channel Flag
**Category**: Channel Flags  
**Definition**: Flag indicating if loan is Correspondent channel  
**Qlik Expression**:
```qvs
If(WildMatch(Channel,'Corresp*')>0,'Yes','No') as [Correspondent Channel Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN channel ILIKE 'Corresp%' THEN 'Yes'
    ELSE 'No'
END as correspondent_channel_flag
```
**Dependencies**: `Channel`  
**Used In**: All apps  
**Business Rules**: Specific Correspondent channel identification  
**Migration Notes**: Pattern matching

---

### Channel Group
**Category**: Channel Flags  
**Definition**: Groups channels into Retail or TPO categories  
**Qlik Expression**:
```qvs
if(WildMatch(Channel,'*Retail*')>=1,'Retail',
   if(Wildmatch(Channel,'*Whole*', '*Corresp*')>=1, 'TPO',
      Channel)) as [Channel Group]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN channel ILIKE '%Retail%' THEN 'Retail'
    WHEN channel ILIKE '%Whole%' OR channel ILIKE '%Corresp%' THEN 'TPO'
    ELSE channel
END as channel_group
```
**Dependencies**: `Channel`  
**Used In**: All apps  
**Business Rules**: Simplifies channel categorization for analysis  
**Migration Notes**: Multi-condition CASE statement

---

## Revenue Calculations

### Origination Revenue
**Category**: Revenue  
**Definition**: Aggregate lender fees less lender credits  
**Qlik Expression**:
```qvs
Num(RangeSum("Origination Points", "Orig Fee Borr Pd", "Orig Fees Seller",(-1*"CD Lender Credits")),'#,##0.00;(#,##0.00)') as [Origination Revenue]
```
**SQL Equivalent**:
```sql
COALESCE(origination_points, 0) + 
COALESCE(orig_fee_borr_pd, 0) + 
COALESCE(orig_fees_seller, 0) - 
COALESCE(cd_lender_credits, 0) as origination_revenue
```
**Dependencies**: `Origination Points`, `Orig Fee Borr Pd`, `Orig Fees Seller`, `CD Lender Credits`  
**Used In**: All apps  
**Business Rules**: Sum of origination fees minus lender credits  
**Migration Notes**: Simple addition/subtraction with COALESCE for NULL handling

---

### Secondary Revenue
**Category**: Revenue  
**Definition**: Aggregate Gain on Sale (GOS) less fees paid to investor from Purchase Advice  
**Qlik Expression**:
```qvs
Num(RangeSum("PA Sell Amt", "PA SRP Amt", [PA Payouts]),'#,##0.00;(#,##0.00)') as [Secondary Revenue]
```
**SQL Equivalent**:
```sql
COALESCE(pa_sell_amt, 0) + 
COALESCE(pa_srp_amt, 0) + 
COALESCE(pa_payouts, 0) as secondary_revenue
```
**Dependencies**: `PA Sell Amt`, `PA SRP Amt`, `PA Payouts`  
**Used In**: All apps  
**Business Rules**: Sum of purchase advice revenue components  
**Migration Notes**: RangeSum translates to COALESCE addition

---

### Total Revenue
**Category**: Revenue  
**Definition**: Aggregate Origination Revenue plus Secondary Revenue  
**Qlik Expression**:
```qvs
RangeSum([Origination Revenue], [Secondary Revenue]) as [Total Revenue]
```
**SQL Equivalent**:
```sql
COALESCE(origination_revenue, 0) + COALESCE(secondary_revenue, 0) as total_revenue
```
**Dependencies**: `Origination Revenue`, `Secondary Revenue`  
**Used In**: All apps  
**Business Rules**: Total revenue from both origination and secondary sources  
**Migration Notes**: Sum of two calculated fields

---

### Base Buy ($)
**Category**: Revenue  
**Definition**: Base Buy Price converted to dollars (Base Buy is stored as basis points, e.g., 100 = 0%, 101 = 1%)  
**Qlik Expression**:
```qvs
Num(if("Base Buy"=0 OR len(trim("Base Buy"))=0 OR IsNull("Base Buy"), 0, 
       Round((("Base Buy"-100)/100) * "Loan Amount",.01)),
   '#,##0.00;(#,##0.00)') as [Base Buy ($)]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN base_buy = 0 OR base_buy IS NULL THEN 0
    ELSE ROUND(((base_buy - 100) / 100.0) * loan_amount, 2)
END as base_buy_dollars
```
**Dependencies**: `Base Buy`, `Loan Amount`  
**Used In**: All apps  
**Business Rules**: Converts basis points to dollar amount. Formula: ((Base Buy - 100) / 100) * Loan Amount  
**Migration Notes**: Basis points conversion (100 = par, 101 = 1% premium)

---

### Net Buy ($)
**Category**: Revenue  
**Definition**: Net Buy Price converted to dollars  
**Qlik Expression**:
```qvs
Num(if("Net Buy Temp"=0, 0, Round((("Net Buy Temp"-100)/100) * "Loan Amount",.01)),'#,##0.00;(#,##0.00)') as [Net Buy ($)]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN net_buy_temp = 0 THEN 0
    ELSE ROUND(((net_buy_temp - 100) / 100.0) * loan_amount, 2)
END as net_buy_dollars
```
**Dependencies**: `Net Buy Temp`, `Loan Amount`  
**Used In**: All apps  
**Business Rules**: Same conversion as Base Buy but using Net Buy  
**Migration Notes**: Basis points to dollars conversion

---

### Net Sell ($)
**Category**: Revenue  
**Definition**: Net Sell Price converted to dollars  
**Qlik Expression**:
```qvs
Num(if("Net Sell"=0,0, Round((("Net Sell"-100)/100) * "Loan Amount",.01)),'#,##0.00;(#,##0.00)') as [Net Sell ($)]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN net_sell = 0 THEN 0
    ELSE ROUND(((net_sell - 100) / 100.0) * loan_amount, 2)
END as net_sell_dollars
```
**Dependencies**: `Net Sell`, `Loan Amount`  
**Used In**: All apps  
**Business Rules**: Converts sell price basis points to dollars  
**Migration Notes**: Basis points conversion

---

### PA Payouts
**Category**: Revenue  
**Definition**: Aggregate Purchase Advice Payouts (fees paid to investor when loan sold)  
**Qlik Expression**:
```qvs
RangeSum("PA Payout 1","PA Payout 2","PA Payout 3","PA Payout 4","PA Payout 5","PA Payout 6","PA Payout 7","PA Payout 8","PA Payout 9","PA Payout 10","PA Payout 11","PA Payout 12") as [PA Payouts]
```
**SQL Equivalent**:
```sql
COALESCE(pa_payout_1, 0) + COALESCE(pa_payout_2, 0) + COALESCE(pa_payout_3, 0) + 
COALESCE(pa_payout_4, 0) + COALESCE(pa_payout_5, 0) + COALESCE(pa_payout_6, 0) + 
COALESCE(pa_payout_7, 0) + COALESCE(pa_payout_8, 0) + COALESCE(pa_payout_9, 0) + 
COALESCE(pa_payout_10, 0) + COALESCE(pa_payout_11, 0) + COALESCE(pa_payout_12, 0) as pa_payouts
```
**Dependencies**: `PA Payout 1` through `PA Payout 12`  
**Used In**: All apps  
**Business Rules**: Sum of all purchase advice payout fields  
**Migration Notes**: Multiple field addition with COALESCE

---

### Buy Price Contribution
**Category**: Revenue  
**Definition**: Origination Revenue plus Base Buy ($)  
**Qlik Expression**:
```qvs
Num(RangeSum([Origination Revenue], [Base Buy ($)]),'#,##0.00;(#,##0.00)') as [Buy Price Contribution]
```
**SQL Equivalent**:
```sql
COALESCE(origination_revenue, 0) + COALESCE(base_buy_dollars, 0) as buy_price_contribution
```
**Dependencies**: `Origination Revenue`, `Base Buy ($)`  
**Used In**: All apps  
**Business Rules**: Revenue including buy price  
**Migration Notes**: Sum of calculated fields

---

### Sell Price Contribution
**Category**: Revenue  
**Definition**: Origination Revenue plus Net Sell ($)  
**Qlik Expression**:
```qvs
Num(RangeSum([Origination Revenue], [Net Sell ($)]),'#,##0.00;(#,##0.00)') as [Sell Price Contribution]
```
**SQL Equivalent**:
```sql
COALESCE(origination_revenue, 0) + COALESCE(net_sell_dollars, 0) as sell_price_contribution
```
**Dependencies**: `Origination Revenue`, `Net Sell ($)`  
**Used In**: All apps  
**Business Rules**: Revenue including sell price  
**Migration Notes**: Sum of calculated fields

---

## Complexity Scores

**Base Concept**: See `concepts/complexity.md` for the core complexity score definition and component breakdowns.

**Pattern**: RangeSum() is used for aggregation. See `patterns/aggregation-patterns.md` for PostgreSQL translation.

### Loan Complexity Score
**Category**: Complexity  
**Definition**: Aggregate complexity score from all complexity components  
**Qlik Expression**:
```qvs
RangeSum([Loan Purpose Complexity],[Loan Type Complexity],[Loan Amount Complexity],[Occupancy Complexity],[FICO Complexity],[LTV Complexity],[DTI Complexity],[Employment Complexity]) as [Loan Complexity Score]
```
**SQL Equivalent**:
```sql
COALESCE(loan_purpose_complexity, 0) + 
COALESCE(loan_type_complexity, 0) + 
COALESCE(loan_amount_complexity, 0) + 
COALESCE(occupancy_complexity, 0) + 
COALESCE(fico_complexity, 0) + 
COALESCE(ltv_complexity, 0) + 
COALESCE(dti_complexity, 0) + 
COALESCE(employment_complexity, 0) as loan_complexity_score
```
**Dependencies**: All complexity component fields  
**Used In**: All apps  
**Business Rules**: Sum of all complexity factors. Higher score = more complex loan.  
**Migration Notes**: Aggregate sum with COALESCE for NULL handling

---

### Loan Purpose Complexity
**Category**: Complexity  
**Definition**: Complexity score based on loan purpose  
**Qlik Expression**:
```qvs
If([Loan Purpose] = 'C to P',0.3
   ,If([Loan Purpose] = 'Purchase',0.1
      ,If([Loan Purpose] = 'Refi CO',0.1
         ,If([Loan Purpose] = 'Refi No CO',0
            ,If(Len(Trim([Loan Purpose]))=0 OR [Loan Purpose] = '99-Missing' OR [Loan Purpose] = 'No Data',Null(),0))))) as [Loan Purpose Complexity]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN loan_purpose = 'C to P' THEN 0.3
    WHEN loan_purpose = 'Purchase' THEN 0.1
    WHEN loan_purpose = 'Refi CO' THEN 0.1
    WHEN loan_purpose = 'Refi No CO' THEN 0
    WHEN loan_purpose IS NULL OR loan_purpose = '99-Missing' OR loan_purpose = 'No Data' THEN NULL
    ELSE 0
END as loan_purpose_complexity
```
**Dependencies**: `Loan Purpose`  
**Used In**: All apps  
**Business Rules**: C to P (Cash to Purchase) is most complex (0.3), Purchase and Refi CO are moderate (0.1), Refi No CO is simple (0)  
**Migration Notes**: Nested CASE or multiple WHEN conditions

---

### Loan Type Complexity
**Category**: Complexity  
**Definition**: Complexity score based on loan type  
**Qlik Expression**:
```qvs
If([Loan Type] = 'FHA',0.1
   ,If([Loan Type] = 'VA',0.05
      ,If(Len(Trim([Loan Type]))=0 OR [Loan Type] = '99-Missing' OR [Loan Type] = 'No Data',Null(),0))) as [Loan Type Complexity]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN loan_type = 'FHA' THEN 0.1
    WHEN loan_type = 'VA' THEN 0.05
    WHEN loan_type IS NULL OR loan_type = '99-Missing' OR loan_type = 'No Data' THEN NULL
    ELSE 0
END as loan_type_complexity
```
**Dependencies**: `Loan Type`  
**Used In**: All apps  
**Business Rules**: FHA loans are more complex (0.1) than VA (0.05) or conventional (0)  
**Migration Notes**: CASE statement with NULL handling

---

### Loan Amount Complexity
**Category**: Complexity  
**Definition**: Complexity score based on loan amount  
**Qlik Expression**:
```qvs
If([Loan Amount] >= 1000000,0.1
   ,If(Len(Trim([Loan Amount]))=0 OR [Loan Amount] = '99-Missing' OR [Loan Amount] = 'No Data',Null(),0)) as [Loan Amount Complexity]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN loan_amount >= 1000000 THEN 0.1
    WHEN loan_amount IS NULL OR loan_amount = '99-Missing' OR loan_amount = 'No Data' THEN NULL
    ELSE 0
END as loan_amount_complexity
```
**Dependencies**: `Loan Amount`  
**Used In**: All apps  
**Business Rules**: Jumbo loans ($1M+) add complexity (0.1)  
**Migration Notes**: Simple threshold check

---

### Occupancy Complexity
**Category**: Complexity  
**Definition**: Complexity score based on occupancy type  
**Qlik Expression**:
```qvs
If([Occupancy Type] = 'SecondHome',0.1
   ,If([Occupancy Type] = 'Investor',0.1
      ,If(Len(Trim([Occupancy Type]))=0 OR [Occupancy Type] = '99-Missing' OR [Occupancy Type] = 'No Data',Null(),0))) as [Occupancy Complexity]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN occupancy_type IN ('SecondHome', 'Investor') THEN 0.1
    WHEN occupancy_type IS NULL OR occupancy_type = '99-Missing' OR occupancy_type = 'No Data' THEN NULL
    ELSE 0
END as occupancy_complexity
```
**Dependencies**: `Occupancy Type`  
**Used In**: All apps  
**Business Rules**: Second home and investor properties add complexity (0.1)  
**Migration Notes**: IN clause for multiple values

---

### FICO Complexity
**Category**: Complexity  
**Definition**: Complexity score based on FICO score (negative for high scores, positive for low scores)  
**Qlik Expression**:
```qvs
If([FICO Score] > 760,-0.1
   ,If([FICO Score] <= 760 AND [FICO Score] > 681,0
      ,If([FICO Score] <= 681 AND [FICO Score] > 620,0.05
         ,If([FICO Score] <= 620,0.15
            ,Null())))) as [FICO Complexity]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN fico_score > 760 THEN -0.1
    WHEN fico_score > 681 AND fico_score <= 760 THEN 0
    WHEN fico_score > 620 AND fico_score <= 681 THEN 0.05
    WHEN fico_score <= 620 THEN 0.15
    ELSE NULL
END as fico_complexity
```
**Dependencies**: `FICO Score`  
**Used In**: All apps  
**Business Rules**: High FICO (>760) reduces complexity (-0.1), low FICO (<=620) increases complexity (0.15)  
**Migration Notes**: Range-based CASE statement

---

### LTV Complexity
**Category**: Complexity  
**Definition**: Complexity score based on Loan-to-Value ratio  
**Qlik Expression**:
```qvs
If([LTV Ratio] >= 95,0.05
   ,If([LTV Ratio] < 95,0
      ,Null())) as [LTV Complexity]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN ltv_ratio >= 95 THEN 0.05
    WHEN ltv_ratio < 95 THEN 0
    ELSE NULL
END as ltv_complexity
```
**Dependencies**: `LTV Ratio`  
**Used In**: All apps  
**Business Rules**: High LTV (>=95%) adds complexity (0.05)  
**Migration Notes**: Simple threshold check

---

### DTI Complexity
**Category**: Complexity  
**Definition**: Complexity score based on Debt-to-Income ratio  
**Qlik Expression**:
```qvs
If([BE DTI Ratio] >= 43,0.05
   ,If([LTV Ratio] < 43,0
      ,Null())) as [DTI Complexity]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN be_dti_ratio >= 43 THEN 0.05
    WHEN be_dti_ratio < 43 THEN 0
    ELSE NULL
END as dti_complexity
```
**Dependencies**: `BE DTI Ratio`  
**Used In**: All apps  
**Business Rules**: High DTI (>=43%) adds complexity (0.05). Note: Expression has bug - checks LTV Ratio instead of DTI in second condition.  
**Migration Notes**: Should check BE DTI Ratio in both conditions (bug in original code)

---

### Employment Complexity
**Category**: Complexity  
**Definition**: Complexity score based on borrower self-employment status  
**Qlik Expression**:
```qvs
If(Upper(Trim([Borr Self Employed])) = 'Y',0.2,0) as [Employment Complexity]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN UPPER(TRIM(borr_self_employed)) = 'Y' THEN 0.2
    ELSE 0
END as employment_complexity
```
**Dependencies**: `Borr Self Employed`  
**Used In**: All apps  
**Business Rules**: Self-employed borrowers add significant complexity (0.2)  
**Migration Notes**: String comparison with UPPER and TRIM

---

## Year/Month Fields

### Sent To Processing YearMonth
**Category**: Year/Month Fields  
**Definition**: Year-Month string and date value for Sent To Processing date  
**Qlik Expression**:
```qvs
If(Len(Trim([Sent To Processing]))=0,Null(),
   Dual(Month([Sent To Processing])&'-'&Year([Sent To Processing]),
        MonthStart([Sent To Processing]))) as [Sent To Processing YearMonth]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN sent_to_processing IS NULL THEN NULL
    ELSE DATE_TRUNC('month', sent_to_processing)
END as sent_to_processing_yearmonth
```
**Dependencies**: `Sent To Processing`  
**Used In**: All apps  
**Business Rules**: Creates both display string (MM-YYYY) and sortable date (month start)  
**Migration Notes**: PostgreSQL DATE_TRUNC for month start, can add formatted string column if needed

---

### Sent To Processing Year
**Category**: Year/Month Fields  
**Definition**: Year extracted from Sent To Processing date  
**Qlik Expression**:
```qvs
If(Len(Trim([Sent To Processing]))=0,Null(),Year([Sent To Processing])) as [Sent To Processing Year]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN sent_to_processing IS NULL THEN NULL
    ELSE EXTRACT(YEAR FROM sent_to_processing)
END as sent_to_processing_year
```
**Dependencies**: `Sent To Processing`  
**Used In**: All apps  
**Business Rules**: Year extraction for time-based grouping  
**Migration Notes**: EXTRACT function for year

---

### Sent To Underwriting YearMonth
**Category**: Year/Month Fields  
**Definition**: Year-Month for Sent To Underwriting date  
**Qlik Expression**:
```qvs
If(Len(Trim([Sent To Underwriting]))=0,Null(),
   Dual(Month([Sent To Underwriting])&'-'&Year([Sent To Underwriting]),
        MonthStart([Sent To Underwriting]))) as [Sent To Underwriting YearMonth]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN sent_to_underwriting IS NULL THEN NULL
    ELSE DATE_TRUNC('month', sent_to_underwriting)
END as sent_to_underwriting_yearmonth
```
**Dependencies**: `Sent To Underwriting`  
**Used In**: All apps  
**Business Rules**: Month grouping for underwriting milestone  
**Migration Notes**: Similar to Processing YearMonth

---

### Sent To Underwriting Year
**Category**: Year/Month Fields  
**Definition**: Year extracted from Sent To Underwriting date  
**Qlik Expression**:
```qvs
If(Len(Trim([Sent To Underwriting]))=0,Null(),Year([Sent To Underwriting])) as [Sent To Underwriting Year]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN sent_to_underwriting IS NULL THEN NULL
    ELSE EXTRACT(YEAR FROM sent_to_underwriting)
END as sent_to_underwriting_year
```
**Dependencies**: `Sent To Underwriting`  
**Used In**: All apps  
**Business Rules**: Year extraction  
**Migration Notes**: EXTRACT function

---

### Sent To Closing YearMonth
**Category**: Year/Month Fields  
**Definition**: Year-Month for Sent To Closing date  
**Qlik Expression**:
```qvs
If(Len(Trim([Sent To Closing]))=0,Null(),
   Dual(Month([Sent To Closing])&'-'&Year([Sent To Closing]),
        MonthStart([Sent To Closing]))) as [Sent To Closing YearMonth]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN sent_to_closing IS NULL THEN NULL
    ELSE DATE_TRUNC('month', sent_to_closing)
END as sent_to_closing_yearmonth
```
**Dependencies**: `Sent To Closing`  
**Used In**: All apps  
**Business Rules**: Month grouping for closing milestone  
**Migration Notes**: DATE_TRUNC for month

---

### Sent To Closing Year
**Category**: Year/Month Fields  
**Definition**: Year extracted from Sent To Closing date  
**Qlik Expression**:
```qvs
If(Len(Trim([Sent To Closing]))=0,Null(),Year([Sent To Closing])) as [Sent To Closing Year]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN sent_to_closing IS NULL THEN NULL
    ELSE EXTRACT(YEAR FROM sent_to_closing)
END as sent_to_closing_year
```
**Dependencies**: `Sent To Closing`  
**Used In**: All apps  
**Business Rules**: Year extraction  
**Migration Notes**: EXTRACT function

---

### End Date YearMonth
**Category**: Year/Month Fields  
**Definition**: Year-Month for End Date to indicate Loan Closed/Funded  
**Qlik Expression**:
```qvs
If(Len(Trim([End Date to indicate Loan Closed/Funded]))=0,Null(),
   Dual(Month([End Date to indicate Loan Closed/Funded])&'-'&Year([End Date to indicate Loan Closed/Funded]),
        MonthStart([End Date to indicate Loan Closed/Funded]))) as [End Date YearMonth]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN end_date_to_indicate_loan_closed_funded IS NULL THEN NULL
    ELSE DATE_TRUNC('month', end_date_to_indicate_loan_closed_funded)
END as end_date_yearmonth
```
**Dependencies**: `End Date to indicate Loan Closed/Funded`  
**Used In**: All apps  
**Business Rules**: Month grouping for loan completion  
**Migration Notes**: DATE_TRUNC

---

### End Date Year
**Category**: Year/Month Fields  
**Definition**: Year extracted from End Date  
**Qlik Expression**:
```qvs
If(Len(Trim([End Date to indicate Loan Closed/Funded]))=0,Null(),
   Year([End Date to indicate Loan Closed/Funded])) as [End Date Year]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN end_date_to_indicate_loan_closed_funded IS NULL THEN NULL
    ELSE EXTRACT(YEAR FROM end_date_to_indicate_loan_closed_funded)
END as end_date_year
```
**Dependencies**: `End Date to indicate Loan Closed/Funded`  
**Used In**: All apps  
**Business Rules**: Year extraction  
**Migration Notes**: EXTRACT function

---

### Closing Projection YearMonth
**Category**: Year/Month Fields  
**Definition**: Year-Month for Closing Projection Date  
**Qlik Expression**:
```qvs
$(fYearMonth("Closing Projection Date")) as [Closing Projection YearMonth]
```
**SQL Equivalent**:
```sql
DATE_TRUNC('month', closing_projection_date) as closing_projection_yearmonth
```
**Dependencies**: `Closing Projection Date`, function `fYearMonth`  
**Used In**: All apps  
**Business Rules**: Month grouping for projected closing  
**Migration Notes**: Function-based implementation

---

### Projected Closing YearMonth
**Category**: Year/Month Fields  
**Definition**: Year-Month for Projected Closing Date  
**Qlik Expression**:
```qvs
$(fYearMonth("Projected Closing Date")) as [Projected Closing YearMonth]
```
**SQL Equivalent**:
```sql
DATE_TRUNC('month', projected_closing_date) as projected_closing_yearmonth
```
**Dependencies**: `Projected Closing Date`, function `fYearMonth`  
**Used In**: All apps  
**Business Rules**: Month grouping for projected closing  
**Migration Notes**: Function-based

---

## Multi-Channel Logic

**Base Concept**: See `concepts/channel-logic.md` for the core channel logic and multi-channel date selection pattern.

### Multi-Channel App/Start Date
**Category**: Multi-Channel Logic  
**Definition**: Start date for multi-channel pull through calculations. Retail uses Application Date, TPO uses Started Date.  
**Qlik Expression**:
```qvs
if(WildMatch(Channel, '*Retail*')=1, [Application Date],
   if(wildmatch(Channel, '*Wholesale*', '*Corresp*')>0, [Started Date],
      Null())) as [Multi-Channel App/Start Date]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN channel ILIKE '%Retail%' THEN application_date
    WHEN channel ILIKE '%Wholesale%' OR channel ILIKE '%Corresp%' THEN started_date
    ELSE NULL
END as multi_channel_app_start_date
```
**Dependencies**: `Channel`, `Application Date`, `Started Date`  
**Used In**: All apps  
**Business Rules**: Different start dates for different channels due to unreliable TPO Submitted Date. Retail = Application Date, TPO = Started Date.  
**Migration Notes**: Channel-based conditional logic

---

## Other Calculated Fields

### Application YearMonth Group
**Category**: Stratification  
**Definition**: Groups Application YearMonth, with older dates grouped as "<= MMM-YYYY"  
**Qlik Expression**:
```qvs
if($(fYearMonth("Application Date"))<addmonths(monthend($(vMaxDate)),-5),
   '<= ' & Date(AddMonths(monthend($(vMaxDate)),-5),'MMM-YYYY'),
   $(fYearMonth("Application Date"))) as [Application YearMonth Group]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN DATE_TRUNC('month', application_date) < DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months' THEN
        '<= ' || TO_CHAR(DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months', 'Mon-YYYY')
    ELSE TO_CHAR(DATE_TRUNC('month', application_date), 'Mon-YYYY')
END as application_yearmonth_group
```
**Dependencies**: `Application Date`, `vMaxDate`, function `fYearMonth`  
**Used In**: All apps  
**Business Rules**: Groups dates older than 5 months ago into single bucket  
**Migration Notes**: Date comparison with string concatenation

---

### Interest Rate Out of Range Flag
**Category**: Validation Flags  
**Definition**: Flag indicating if Interest Rate is out of acceptable range (<=0 or >=15)  
**Qlik Expression**:
```qvs
If([Interest Rate]<=0 OR [Interest Rate]>=15, 'Yes', 'No') as [Interest Rate Out of Range Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN interest_rate <= 0 OR interest_rate >= 15 THEN 'Yes'
    ELSE 'No'
END as interest_rate_out_of_range_flag
```
**Dependencies**: `Interest Rate`  
**Used In**: All apps  
**Business Rules**: Validates interest rate is within reasonable bounds  
**Migration Notes**: Range validation

---

### FICO Out of Range Flag
**Category**: Validation Flags  
**Definition**: Flag indicating if FICO Score is out of acceptable range (<350 or >=900)  
**Qlik Expression**:
```qvs
if([FICO Score]<350 OR [FICO Score]>=900, 'Yes', 'No') as [FICO Out of Range Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN fico_score < 350 OR fico_score >= 900 THEN 'Yes'
    ELSE 'No'
END as fico_out_of_range_flag
```
**Dependencies**: `FICO Score`  
**Used In**: All apps  
**Business Rules**: Validates FICO score is within typical range  
**Migration Notes**: Range validation

---

### LTV Out of Range Flag
**Category**: Validation Flags  
**Definition**: Flag indicating if LTV Ratio is out of acceptable range (>=110 or <=0)  
**Qlik Expression**:
```qvs
if([LTV Ratio]>=110 OR [LTV Ratio]<=0, 'Yes', 'No') as [LTV Out of Range Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN ltv_ratio >= 110 OR ltv_ratio <= 0 THEN 'Yes'
    ELSE 'No'
END as ltv_out_of_range_flag
```
**Dependencies**: `LTV Ratio`  
**Used In**: All apps  
**Business Rules**: Validates LTV ratio is within reasonable bounds  
**Migration Notes**: Range validation

---

### DTI Out of Range Flag
**Category**: Validation Flags  
**Definition**: Flag indicating if BE DTI Ratio is out of acceptable range (>=70 or <=0)  
**Qlik Expression**:
```qvs
if([BE DTI Ratio]>=70 OR [BE DTI Ratio]<=0, 'Yes', 'No') as [DTI Out of Range Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN be_dti_ratio >= 70 OR be_dti_ratio <= 0 THEN 'Yes'
    ELSE 'No'
END as dti_out_of_range_flag
```
**Dependencies**: `BE DTI Ratio`  
**Used In**: All apps  
**Business Rules**: Validates DTI ratio is within reasonable bounds  
**Migration Notes**: Range validation

---

### Projected Closing Date
**Category**: Date Calculations  
**Definition**: Closing Date if available, otherwise Estimated Closing Date  
**Qlik Expression**:
```qvs
If(IsNull([Closing Date]),[Estimated Closing Date],[Closing Date]) as [Projected Closing Date]
```
**SQL Equivalent**:
```sql
COALESCE(closing_date, estimated_closing_date) as projected_closing_date
```
**Dependencies**: `Closing Date`, `Estimated Closing Date`  
**Used In**: All apps  
**Business Rules**: Uses actual closing date if available, otherwise uses estimated date  
**Migration Notes**: COALESCE for NULL handling

---

### Closing Projection Date
**Category**: Date Calculations  
**Definition**: Complex logic to determine closing projection date for MTD closed loans, CTC loans, and projected closes  
**Qlik Expression**:
```qvs
If(Date([Funding Date]) >= MonthStart(AddMonths('$(vCurrentDateAsDate)',-1)),
   [Funding Date],
   If(Date([Estimated Closing Date]) < MonthStart('$(vCurrentDateAsDate)'),
      Date('$(vCurrentDateAsDate)'),
      Date("Projected Closing Date"))) as [Closing Projection Date]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN DATE(funding_date) >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month' THEN
        funding_date
    WHEN DATE(estimated_closing_date) < DATE_TRUNC('month', CURRENT_DATE) THEN
        CURRENT_DATE
    ELSE
        projected_closing_date
END as closing_projection_date
```
**Dependencies**: `Funding Date`, `Estimated Closing Date`, `Projected Closing Date`, `vCurrentDateAsDate`  
**Used In**: All apps  
**Business Rules**: Prioritizes recent funding dates, then uses current date for old estimates, otherwise uses projected closing  
**Migration Notes**: Complex conditional logic with date comparisons

---

## Section Access (Row-Level Security)

**Note**: Section Access is a Qlik-specific pattern for implementing row-level security. In PostgreSQL, this translates to Row-Level Security (RLS) policies. See `patterns/section-access-row-security.md` for complete PostgreSQL translation.

### Overview

Section Access restricts which data records users can see based on their identity and assigned access values. This is implemented in `SectionAccess.qvs` and is critical for multi-tenant systems where different users should only see data relevant to their role (e.g., branch managers see only their branch's loans).

### Key Components

1. **Access Levels**: ADMIN (full access with `*` wildcard) or USER (restricted access)
2. **Access Fields**: Configurable fields used for filtering (e.g., Branch, Loan Officer, Region)
3. **Access Values**: Specific values users can access (e.g., "BRANCH001", "LO12345")
4. **Multi-Level Access**: Up to 3 hierarchical levels (Level 1, 2, 3)
5. **Bridge Table**: Connects access values to data rows

### Implementation Location

**Source File**: `Scripts/SectionAccess.qvs` (in each app)

**Key Logic**:
- Loads access configuration from XML config files
- Builds Bridge table with all access field combinations
- Creates SectionAccess table with user access mappings
- Applies Section Access to filter data

### Common Access Patterns

- **Branch-Only**: User sees all loans in their branch(es)
- **Branch + Loan Officer**: User sees only their own loans
- **Multiple Branches**: User sees loans from multiple branches
- **Admin Access**: User sees all data (wildcard `*`)

### PostgreSQL Translation

See `patterns/section-access-row-security.md` for:
- PostgreSQL RLS policy implementation
- User access table structure
- Multi-level access handling
- Performance optimization
- Migration checklist

---

## Notes

- Many date flags use function calls (e.g., `$(fRolling13MonthFlag(...))`) which are defined elsewhere. These functions need to be implemented in PostgreSQL or replaced with inline SQL.
- Turn time calculations use calendar days (Date(Floor())). Comments indicate NetWorkDays was previously used but changed to calendar days.
- Revenue calculations use RangeSum which handles NULL values by treating them as 0. PostgreSQL equivalent uses COALESCE.
- Complexity scores can be negative (FICO Complexity for high scores) or positive (for risk factors).
- Some expressions have bugs (e.g., DTI Complexity checks LTV Ratio in second condition).
- Basis points conversion: (value - 100) / 100 * loan_amount converts basis points to dollars (100 = par, 101 = 1% premium).
