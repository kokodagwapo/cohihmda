# Calendar Logic Dictionary

**Source Files**: 
- `tvd-coheus-sales-qlik/Scripts/Calendar-Subroutine.qvs`
- `tvd-coheus-sales-qlik/Scripts/Calendar-Link Table.qvs`
- `Performance/tvd-coheus-performance-qlik/Scripts/Calendar-Sub.qvs`
- `Performance/tvd-coheus-performance-qlik/Scripts/Calendar-Link.qvs`

This document catalogs the calendar generation logic used across Qlik apps to create date flags and period groupings.

---

## CalendarFromField Subroutine

### Overview
The `CalendarFromField` subroutine is a reusable function that generates a calendar table with various date flags and period groupings for any given date field.

### Subroutine Signature
```qvs
SUB CalendarFromField(_field, _calendar, _prefix)
```

**Parameters**:
- `_field`: The date field name to generate calendar for
- `_calendar`: The name of the calendar table to create
- `_prefix`: Prefix for generated field names (e.g., "Application" for Application Date)

### Generated Fields

#### Basic Date Components

##### Year
**Category**: Year/Month Fields  
**Definition**: Year extracted from date field  
**Qlik Expression**:
```qvs
year([$(_field)]) as [$(_prefix)Year]
```
**SQL Equivalent**:
```sql
EXTRACT(YEAR FROM date_field) as {prefix}_year
```
**Dependencies**: Date field  
**Used In**: All apps  
**Business Rules**: Standard year extraction  
**Migration Notes**: PostgreSQL EXTRACT function

---

##### Month
**Category**: Year/Month Fields  
**Definition**: Month number extracted from date field  
**Qlik Expression**:
```qvs
month([$(_field)]) as [$(_prefix)Month]
```
**SQL Equivalent**:
```sql
EXTRACT(MONTH FROM date_field) as {prefix}_month
```
**Dependencies**: Date field  
**Used In**: All apps  
**Business Rules**: Month number (1-12)  
**Migration Notes**: EXTRACT function

---

##### Day
**Category**: Year/Month Fields  
**Definition**: Day of month extracted from date field  
**Qlik Expression**:
```qvs
day([$(_field)]) as [$(_prefix)Day]
```
**SQL Equivalent**:
```sql
EXTRACT(DAY FROM date_field) as {prefix}_day
```
**Dependencies**: Date field  
**Used In**: All apps  
**Business Rules**: Day number (1-31)  
**Migration Notes**: EXTRACT function

---

##### Weekday
**Category**: Year/Month Fields  
**Definition**: Day of week extracted from date field  
**Qlik Expression**:
```qvs
weekday([$(_field)]) as [$(_prefix)Weekday]
```
**SQL Equivalent**:
```sql
EXTRACT(DOW FROM date_field) as {prefix}_weekday
```
**Dependencies**: Date field  
**Used In**: All apps  
**Business Rules**: Day of week (0=Sunday, 6=Saturday in PostgreSQL)  
**Migration Notes**: EXTRACT DOW (Day Of Week)

---

#### Year-Month Fields

##### YearMonth
**Category**: Year/Month Fields  
**Definition**: Year-Month string with sortable date value  
**Qlik Expression**:
```qvs
Dual(Year([$(_field)])&'-'&Month([$(_field)]), monthstart([$(_field)])) as [$(_prefix)YearMonth]
```
**SQL Equivalent**:
```sql
DATE_TRUNC('month', date_field) as {prefix}_yearmonth
-- For display: TO_CHAR(date_field, 'YYYY-MM') as {prefix}_yearmonth_display
```
**Dependencies**: Date field  
**Used In**: All apps  
**Business Rules**: Creates both display string (YYYY-MM) and sortable date (month start)  
**Migration Notes**: DATE_TRUNC for month start, TO_CHAR for formatted string

---

##### YearMonth2MonthRange
**Category**: Year/Month Fields  
**Definition**: Year-Month with grouping for dates outside 2-month range  
**Qlik Expression**:
```qvs
If([$(_field)]<AddMonths(MonthStart($(vMaxDate)),-2), 
   Dual(chr(60)&chr(61)& Year(AddMonths($(vMaxDate),-2))&'-'&Month(AddMonths($(vMaxDate),-2)), 
        monthstart(AddMonths($(vMaxDate),-2))),
   If([$(_field)]>=AddMonths(MonthStart($(vMaxDate)),2), 
      Dual(chr(62)&chr(61)& Year(AddMonths($(vMaxDate),2))&'-'&Month(AddMonths($(vMaxDate),2)), 
           monthstart(AddMonths($(vMaxDate),2))),
      Dual(Year([$(_field)])&'-'&Month([$(_field)]), monthstart([$(_field)])))) 
   as [$(_prefix)YearMonth2MonthRange]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN date_field < DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '2 months' THEN
        DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '2 months'
    WHEN date_field >= DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '2 months' THEN
        DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '2 months'
    ELSE DATE_TRUNC('month', date_field)
END as {prefix}_yearmonth_2month_range
```
**Dependencies**: Date field, `vMaxDate`  
**Used In**: All apps  
**Business Rules**: Groups dates older than 2 months ago or newer than 2 months ahead  
**Migration Notes**: Date range comparison with DATE_TRUNC

---

##### YearQuarter
**Category**: Year/Month Fields  
**Definition**: Year-Quarter string with sortable date value  
**Qlik Expression**:
```qvs
Dual(Year([$(_field)])&'-Q'&Num(Ceil(Num(Month([$(_field)]))/3)),QuarterStart([$(_field)])) as [$(_prefix)YearQuarter]
```
**SQL Equivalent**:
```sql
DATE_TRUNC('quarter', date_field) as {prefix}_yearquarter
-- For display: TO_CHAR(date_field, 'YYYY') || '-Q' || CEIL(EXTRACT(MONTH FROM date_field)::numeric / 3) as {prefix}_yearquarter_display
```
**Dependencies**: Date field  
**Used In**: All apps  
**Business Rules**: Creates quarter grouping (Q1-Q4)  
**Migration Notes**: DATE_TRUNC for quarter start

---

#### Rolling Period Flags

##### Rolling13MonthFlag
**Category**: Date Flags  
**Definition**: Flag indicating if date falls within last 13 months  
**Qlik Expression**:
```qvs
If([$(_field)]>$(vMaxDate),'No',
   if([$(_field)]>=AddMonths(MonthEnd($(vMaxDate)),-13,1),'Yes','No')) 
   as [$(_prefix)Rolling13MonthFlag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN date_field > CURRENT_DATE THEN 'No'
    WHEN date_field >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '13 months' THEN 'Yes'
    ELSE 'No'
END as {prefix}_rolling_13_month_flag
```
**Dependencies**: Date field, `vMaxDate`  
**Used In**: All apps  
**Business Rules**: 13-month rolling window  
**Migration Notes**: Date comparison with INTERVAL arithmetic

---

##### Rolling4MonthFlag
**Category**: Date Flags  
**Definition**: Flag indicating if date falls within last 4 months  
**Qlik Expression**:
```qvs
If([$(_field)]>$(vMaxDate),'No',
   if([$(_field)]>=Floor(AddMonths(MonthEnd($(vMaxDate)),-4,1)),'Yes','No')) 
   as [$(_prefix)Rolling4MonthFlag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN date_field > CURRENT_DATE THEN 'No'
    WHEN date_field >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '4 months' THEN 'Yes'
    ELSE 'No'
END as {prefix}_rolling_4_month_flag
```
**Dependencies**: Date field, `vMaxDate`  
**Used In**: All apps  
**Business Rules**: 4-month rolling window  
**Migration Notes**: Similar to 13-month but with 4-month interval

---

##### Rolling2MonthFlag
**Category**: Date Flags  
**Definition**: Flag indicating if date falls within last 2 months  
**Qlik Expression**:
```qvs
If([$(_field)]>$(vMaxDate),'No',
   if([$(_field)]>=Floor(AddMonths(MonthEnd($(vMaxDate)),-2,1)),'Yes','No')) 
   as [$(_prefix)Rolling2MonthFlag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN date_field > CURRENT_DATE THEN 'No'
    WHEN date_field >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '2 months' THEN 'Yes'
    ELSE 'No'
END as {prefix}_rolling_2_month_flag
```
**Dependencies**: Date field, `vMaxDate`  
**Used In**: All apps  
**Business Rules**: 2-month rolling window  
**Migration Notes**: 2-month interval

---

##### Rolling4QtrFlag
**Category**: Date Flags  
**Definition**: Flag indicating if date falls within last 4 quarters  
**Qlik Expression**:
```qvs
if([$(_field)]>$(vMaxDate),'No', 
   if([$(_field)] >= QuarterStart($(vMaxDate),-4) 
      AND [$(_field)] <= QuarterEnd($(vMaxDate),0), 
      'Yes', 'No')) as [$(_prefix)Rolling4QtrFlag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN date_field > CURRENT_DATE THEN 'No'
    WHEN date_field >= DATE_TRUNC('quarter', CURRENT_DATE) - INTERVAL '4 quarters'
         AND date_field <= DATE_TRUNC('quarter', CURRENT_DATE) + INTERVAL '3 months' - INTERVAL '1 day'
    THEN 'Yes'
    ELSE 'No'
END as {prefix}_rolling_4qtr_flag
```
**Dependencies**: Date field, `vMaxDate`  
**Used In**: All apps  
**Business Rules**: 4-quarter rolling window  
**Migration Notes**: Quarter-based calculation

---

##### Rolling0To30Flag
**Category**: Date Flags  
**Definition**: Flag indicating if date falls within last 30 days  
**Qlik Expression**:
```qvs
If([$(_field)]>$(vMaxDate),'No',
   if([$(_field)]>=Date($(vMaxDate)-30),'Yes','No')) 
   as [$(_prefix)Rolling0To30Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN date_field > CURRENT_DATE THEN 'No'
    WHEN date_field >= CURRENT_DATE - INTERVAL '30 days' THEN 'Yes'
    ELSE 'No'
END as {prefix}_rolling_0_to_30_flag
```
**Dependencies**: Date field, `vMaxDate`  
**Used In**: All apps  
**Business Rules**: 30-day rolling window  
**Migration Notes**: Simple date subtraction

---

##### PriorRolling30Flag
**Category**: Date Flags  
**Definition**: Flag indicating if date falls within 31-60 days ago  
**Qlik Expression**:
```qvs
If([$(_field)]>$(vMaxDate),'No',
   if([$(_field)]>=Date($(vMaxDate)-60) AND [$(_field)]<Date($(vMaxDate)-30),'Yes','No')) 
   as [$(_prefix)PriorRolling30Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN date_field > CURRENT_DATE THEN 'No'
    WHEN date_field >= CURRENT_DATE - INTERVAL '60 days' 
         AND date_field < CURRENT_DATE - INTERVAL '30 days' 
    THEN 'Yes'
    ELSE 'No'
END as {prefix}_prior_rolling_30_flag
```
**Dependencies**: Date field, `vMaxDate`  
**Used In**: All apps  
**Business Rules**: Previous 30-day window (31-60 days ago)  
**Migration Notes**: Date range check

---

##### CurrentProductionFlag
**Category**: Date Flags  
**Definition**: Flag indicating if date falls within last 30 days (same as Rolling0To30Flag)  
**Qlik Expression**:
```qvs
If([$(_field)]>$(vMaxDate),'No',
   if([$(_field)]>=Date($(vMaxDate)-30),'Yes','No')) 
   as [$(_prefix)CurrentProductionFlag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN date_field > CURRENT_DATE THEN 'No'
    WHEN date_field >= CURRENT_DATE - INTERVAL '30 days' THEN 'Yes'
    ELSE 'No'
END as {prefix}_current_production_flag
```
**Dependencies**: Date field, `vMaxDate`  
**Used In**: All apps  
**Business Rules**: Current production period (last 30 days)  
**Migration Notes**: Same logic as Rolling0To30Flag

---

#### Period-to-Date Flags

##### MTD (Month to Date)
**Category**: Date Flags  
**Definition**: Flag indicating if date falls within current month to date  
**Qlik Expression**:
```qvs
If(InMonthToDate([$(_field)],$(vMaxDate),0),'Yes','No') as [$(_prefix)MTD]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN date_field >= DATE_TRUNC('month', CURRENT_DATE) 
         AND date_field <= CURRENT_DATE 
    THEN 'Yes'
    ELSE 'No'
END as {prefix}_mtd
```
**Dependencies**: Date field, `vMaxDate`, function `InMonthToDate`  
**Used In**: All apps  
**Business Rules**: Current month from start to today  
**Migration Notes**: Date range from month start to current date

---

##### PreviousMTD
**Category**: Date Flags  
**Definition**: Flag indicating if date falls within previous month to date  
**Qlik Expression**:
```qvs
If(InMonthToDate([$(_field)],$(vMaxDate),-1),'Yes','No') as [$(_prefix)PreviousMTD]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN date_field >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'
         AND date_field < DATE_TRUNC('month', CURRENT_DATE)
    THEN 'Yes'
    ELSE 'No'
END as {prefix}_previous_mtd
```
**Dependencies**: Date field, `vMaxDate`, function `InMonthToDate`  
**Used In**: All apps  
**Business Rules**: Previous month from start to end  
**Migration Notes**: Previous month range

---

##### PreviousYearMTD
**Category**: Date Flags  
**Definition**: Flag indicating if date falls within same month last year to date  
**Qlik Expression**:
```qvs
If(InMonthToDate([$(_field)],$(vMaxDate),-12),'Yes','No') as [$(_prefix)PreviousYearMTD]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN date_field >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '12 months'
         AND date_field < DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '11 months'
    THEN 'Yes'
    ELSE 'No'
END as {prefix}_previous_year_mtd
```
**Dependencies**: Date field, `vMaxDate`, function `InMonthToDate`  
**Used In**: All apps  
**Business Rules**: Same month last year  
**Migration Notes**: 12-month offset

---

##### QTD (Quarter to Date)
**Category**: Date Flags  
**Definition**: Flag indicating if date falls within current quarter to date  
**Qlik Expression**:
```qvs
If(InQuarterToDate([$(_field)],$(vMaxDate),0),'Yes','No') as [$(_prefix)QTD]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN date_field >= DATE_TRUNC('quarter', CURRENT_DATE) 
         AND date_field <= CURRENT_DATE 
    THEN 'Yes'
    ELSE 'No'
END as {prefix}_qtd
```
**Dependencies**: Date field, `vMaxDate`, function `InQuarterToDate`  
**Used In**: All apps  
**Business Rules**: Current quarter from start to today  
**Migration Notes**: Quarter start to current date

---

##### YTDFlag (Year to Date)
**Category**: Date Flags  
**Definition**: Flag indicating if date falls within current year to date  
**Qlik Expression**:
```qvs
If(InYearToDate([$(_field)],$(vMaxDate),0),'Yes','No') as [$(_prefix)YTDFlag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN date_field >= DATE_TRUNC('year', CURRENT_DATE) 
         AND date_field <= CURRENT_DATE 
    THEN 'Yes'
    ELSE 'No'
END as {prefix}_ytd_flag
```
**Dependencies**: Date field, `vMaxDate`, function `InYearToDate`  
**Used In**: All apps  
**Business Rules**: Current year from start to today  
**Migration Notes**: Year start to current date

---

##### PreviousYTDFlag
**Category**: Date Flags  
**Definition**: Flag indicating if date falls within previous year to date  
**Qlik Expression**:
```qvs
If(InYearToDate([$(_field)],$(vMaxDate),-1),'Yes','No') as [$(_prefix)PreviousYTDFlag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN date_field >= DATE_TRUNC('year', CURRENT_DATE) - INTERVAL '1 year'
         AND date_field < DATE_TRUNC('year', CURRENT_DATE)
    THEN 'Yes'
    ELSE 'No'
END as {prefix}_previous_ytd_flag
```
**Dependencies**: Date field, `vMaxDate`, function `InYearToDate`  
**Used In**: All apps  
**Business Rules**: Previous year from start to end  
**Migration Notes**: Previous year range

---

#### Period Flags

##### PreviousMonthFlag
**Category**: Date Flags  
**Definition**: Flag indicating if date falls within previous month  
**Qlik Expression**:
```qvs
If(InMonth([$(_field)],$(vMaxDate),-1),'Yes','No') as [$(_prefix)PreviousMonthFlag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN date_field >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'
         AND date_field < DATE_TRUNC('month', CURRENT_DATE)
    THEN 'Yes'
    ELSE 'No'
END as {prefix}_previous_month_flag
```
**Dependencies**: Date field, `vMaxDate`, function `InMonth`  
**Used In**: All apps  
**Business Rules**: Previous complete month  
**Migration Notes**: Previous month range

---

##### Previous2MonthFlag
**Category**: Date Flags  
**Definition**: Flag indicating if date falls within 2 months ago  
**Qlik Expression**:
```qvs
If(InMonth([$(_field)],$(vMaxDate),-2),'Yes','No') as [$(_prefix)Previous2MonthFlag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN date_field >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '2 months'
         AND date_field < DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'
    THEN 'Yes'
    ELSE 'No'
END as {prefix}_previous_2month_flag
```
**Dependencies**: Date field, `vMaxDate`, function `InMonth`  
**Used In**: All apps  
**Business Rules**: Two months ago  
**Migration Notes**: 2-month offset

---

##### PreviousQuarterFlag
**Category**: Date Flags  
**Definition**: Flag indicating if date falls within previous quarter  
**Qlik Expression**:
```qvs
If(InQuarter([$(_field)],$(vMaxDate),-1),'Yes','No') as [$(_prefix)PreviousQuarterFlag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN date_field >= DATE_TRUNC('quarter', CURRENT_DATE) - INTERVAL '1 quarter'
         AND date_field < DATE_TRUNC('quarter', CURRENT_DATE)
    THEN 'Yes'
    ELSE 'No'
END as {prefix}_previous_quarter_flag
```
**Dependencies**: Date field, `vMaxDate`, function `InQuarter`  
**Used In**: All apps  
**Business Rules**: Previous complete quarter  
**Migration Notes**: Previous quarter range

---

##### PreviousYearFlag
**Category**: Date Flags  
**Definition**: Flag indicating if date falls within previous year  
**Qlik Expression**:
```qvs
If(InYear([$(_field)],$(vMaxDate),-1),'Yes','No') as [$(_prefix)PreviousYearFlag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN date_field >= DATE_TRUNC('year', CURRENT_DATE) - INTERVAL '1 year'
         AND date_field < DATE_TRUNC('year', CURRENT_DATE)
    THEN 'Yes'
    ELSE 'No'
END as {prefix}_previous_year_flag
```
**Dependencies**: Date field, `vMaxDate`, function `InYear`  
**Used In**: All apps  
**Business Rules**: Previous complete year  
**Migration Notes**: Previous year range

---

##### 2YearPrevious
**Category**: Date Flags  
**Definition**: Flag indicating if date falls within 2 years ago  
**Qlik Expression**:
```qvs
If(InYear([$(_field)],$(vMaxDate),-2),'Yes','No') as [$(_prefix)2YearPrevious]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN date_field >= DATE_TRUNC('year', CURRENT_DATE) - INTERVAL '2 years'
         AND date_field < DATE_TRUNC('year', CURRENT_DATE) - INTERVAL '1 year'
    THEN 'Yes'
    ELSE 'No'
END as {prefix}_2year_previous
```
**Dependencies**: Date field, `vMaxDate`, function `InYear`  
**Used In**: All apps  
**Business Rules**: Two years ago  
**Migration Notes**: 2-year offset

---

#### Day/Week Flags

##### TodayFlag
**Category**: Date Flags  
**Definition**: Flag indicating if date is today  
**Qlik Expression**:
```qvs
If([$(_field)]=$(vMaxDate),'Yes','No') as [$(_prefix)TodayFlag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN DATE(date_field) = CURRENT_DATE THEN 'Yes'
    ELSE 'No'
END as {prefix}_today_flag
```
**Dependencies**: Date field, `vMaxDate`  
**Used In**: All apps  
**Business Rules**: Current day only  
**Migration Notes**: Date comparison

---

##### YesterdayFlag
**Category**: Date Flags  
**Definition**: Flag indicating if date is yesterday  
**Qlik Expression**:
```qvs
If([$(_field)]=$(vMaxDate)-1,'Yes','No') as [$(_prefix)YesterdayFlag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN DATE(date_field) = CURRENT_DATE - INTERVAL '1 day' THEN 'Yes'
    ELSE 'No'
END as {prefix}_yesterday_flag
```
**Dependencies**: Date field, `vMaxDate`  
**Used In**: All apps  
**Business Rules**: Previous day  
**Migration Notes**: Date subtraction

---

##### LastWeekFlag
**Category**: Date Flags  
**Definition**: Flag indicating if date falls within last week  
**Qlik Expression**:
```qvs
If(InWeek([$(_field)],$(vMaxDate),-1),'Yes','No') as [$(_prefix)LastWeekFlag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN date_field >= DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '1 week'
         AND date_field < DATE_TRUNC('week', CURRENT_DATE)
    THEN 'Yes'
    ELSE 'No'
END as {prefix}_last_week_flag
```
**Dependencies**: Date field, `vMaxDate`, function `InWeek`  
**Used In**: All apps  
**Business Rules**: Previous week  
**Migration Notes**: Week calculation with DATE_TRUNC

---

#### Week Fields

##### YearMonthWeek
**Category**: Year/Month Fields  
**Definition**: Year-Month-Week identifier  
**Qlik Expression**:
```qvs
Year([$(_field)])&'-'&Month([$(_field)])&'-W'&Ceil(Day([$(_field)])/7) as [$(_prefix)YearMonthWeek]
```
**SQL Equivalent**:
```sql
TO_CHAR(date_field, 'YYYY-MM') || '-W' || CEIL(EXTRACT(DAY FROM date_field)::numeric / 7) as {prefix}_yearmonthweek
```
**Dependencies**: Date field  
**Used In**: All apps  
**Business Rules**: Week number within month (1-5)  
**Migration Notes**: String concatenation with week calculation

---

##### MonthWeek
**Category**: Year/Month Fields  
**Definition**: Week number within month  
**Qlik Expression**:
```qvs
Ceil(Day([$(_field)])/7) as [$(_prefix)MonthWeek]
```
**SQL Equivalent**:
```sql
CEIL(EXTRACT(DAY FROM date_field)::numeric / 7) as {prefix}_monthweek
```
**Dependencies**: Date field  
**Used In**: All apps  
**Business Rules**: Week number (1-5)  
**Migration Notes**: Simple division and ceiling

---

##### Week
**Category**: Year/Month Fields  
**Definition**: Week number with dual value for sorting  
**Qlik Expression**:
```qvs
Dual('W'&Num(Week([$(_field)]),00), Num(Week([$(_field)]),00)) as [$(_prefix)Week]
```
**SQL Equivalent**:
```sql
EXTRACT(WEEK FROM date_field) as {prefix}_week
-- For display: 'W' || LPAD(EXTRACT(WEEK FROM date_field)::text, 2, '0') as {prefix}_week_display
```
**Dependencies**: Date field, function `Week`  
**Used In**: All apps  
**Business Rules**: ISO week number (1-53)  
**Migration Notes**: EXTRACT WEEK function

---

##### YearWeekNum
**Category**: Year/Month Fields  
**Definition**: Year-Week number identifier  
**Qlik Expression**:
```qvs
Year([$(_field)])&Num(Week([$(_field)]),00) as [$(_prefix)YearWeekNum]
```
**SQL Equivalent**:
```sql
EXTRACT(YEAR FROM date_field)::text || LPAD(EXTRACT(WEEK FROM date_field)::text, 2, '0') as {prefix}_yearweeknum
```
**Dependencies**: Date field, function `Week`  
**Used In**: All apps  
**Business Rules**: Year-week identifier (e.g., 202401)  
**Migration Notes**: String concatenation

---

#### All Time Flag

##### AllTime
**Category**: Date Flags  
**Definition**: Flag indicating if date field has a value (not empty)  
**Qlik Expression**:
```qvs
If(Len(Trim([$(_field)]))=0,'No','Yes') as [$(_prefix)AllTime]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN date_field IS NULL THEN 'No'
    ELSE 'Yes'
END as {prefix}_alltime
```
**Dependencies**: Date field  
**Used In**: All apps  
**Business Rules**: Simple existence check for date field  
**Migration Notes**: NULL check

---

## DateLink Table

### Overview
The `DateLink` table creates a link between the main fact table (`RowNo`) and dates from various milestone fields. This enables filtering by date type (Application, Closing, Funding, etc.) in set analysis expressions.

### Structure
**Source File**: `Calendar-Link Table.qvs`

**Table Creation**:
```qvs
DateLink:
LOAD
    RowNo                    // Fact Key
    ,If('$(date)'='Estimated Closing',[Projected Closing Date],[$(date) Date]) as Date  // Fact Date
    ,'$(date)' as DateType  // Fact Type
RESIDENT [$(vWriteTableName)];
```

### DateType Values
The `DateType` field identifies which milestone the date represents:
- `'Credit Pull'`
- `'Application'`
- `'Submitted To Processing'`
- `'Submitted To Underwriting'`
- `'Closing'`
- `'Funding'`
- `'Investor Purchase'`
- `'Investor Lock'`
- `'Lock'`
- `'Estimated Closing'` (uses Projected Closing Date)
- `'CTC'`
- `'Current Status'`
- `'Loan Estimate Sent'`
- `'UW Final Approval'`
- `'Conditional Approval'`
- `'Denied'`
- `'Withdrawn'`
- `'Started'`
- `'Registration'` (TPO only)
- `'Last Submittal'` (TPO only)
- `'Initial Submission'` (TPO only)

### SQL Equivalent
```sql
CREATE TABLE date_link AS
SELECT 
    row_no,
    CASE 
        WHEN date_type = 'Estimated Closing' THEN projected_closing_date
        ELSE 
            CASE date_type
                WHEN 'Credit Pull' THEN credit_pull_date
                WHEN 'Application' THEN application_date
                WHEN 'Closing' THEN closing_date
                WHEN 'Funding' THEN funding_date
                -- ... etc for all date types
            END
    END as date,
    date_type
FROM loans;
```

### Usage in Set Analysis
The DateLink table enables filtering by DateType in set analysis:
```qvs
{$<DateType={'Application'}, [Date Rolling 13 Month Flag]={Yes}>}
```

**SQL Equivalent**:
```sql
WHERE date_type = 'Application' 
  AND date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '13 months'
```

### CommonCalendar Table
After creating DateLink, the `CalendarFromField` subroutine is called to generate the `CommonCalendar` table:
```qvs
CALL CalendarFromField('Date', 'CommonCalendar', '');
```

This creates all the date flags and period groupings for the dates in DateLink, enabling filtering by date periods across all date types.

---

## Variable Lists

### YearMonthList
**Category**: Variables  
**Definition**: Concatenated list of YearMonth values for dropdown variables  
**Qlik Expression**:
```qvs
Concat(DISTINCT YearMonth,'|',Num(YearMonth)*-1) as YearMonthList
```
**SQL Equivalent**:
```sql
STRING_AGG(DISTINCT yearmonth::text, '|' ORDER BY yearmonth DESC) as yearmonth_list
```
**Dependencies**: `CommonCalendar.YearMonth`  
**Used In**: All apps  
**Business Rules**: Creates pipe-delimited list for variable dropdowns  
**Migration Notes**: STRING_AGG with ORDER BY for sorted concatenation

---

### YearList
**Category**: Variables  
**Definition**: Concatenated list of Year values with min/max  
**Qlik Expression**:
```qvs
Concat(DISTINCT Year,'|',Num(Year)*-1) as YearList,
Min(Year) as MinYear,
Max(Year) as MaxYear
```
**SQL Equivalent**:
```sql
STRING_AGG(DISTINCT year::text, '|' ORDER BY year DESC) as year_list,
MIN(year) as min_year,
MAX(year) as max_year
```
**Dependencies**: `CommonCalendar.Year`  
**Used In**: All apps  
**Business Rules**: Creates year list for dropdowns with boundaries  
**Migration Notes**: STRING_AGG with MIN/MAX aggregates

---

### DateTypeList
**Category**: Variables  
**Definition**: Mapping of DateType values to display names  
**Qlik Expression**:
```qvs
Let vDateTypeList = 'Credit Pull~Credit Pulls|Application~Applications Taken|UW Final Approval~Approved Loans|Investor Lock~Invester Locks|CTC~Cleared to Close|Closing~Closed Loans|Funding~Funded Loans|Investor Purchase~Investor Purchased Loans|Current Status~Withdrawn|Current Status~Denied';
```
**SQL Equivalent**:
```sql
-- Create mapping table
CREATE TABLE date_type_mapping (
    date_type VARCHAR(50),
    display_name VARCHAR(100)
);

INSERT INTO date_type_mapping VALUES
    ('Credit Pull', 'Credit Pulls'),
    ('Application', 'Applications Taken'),
    ('UW Final Approval', 'Approved Loans'),
    -- ... etc
```
**Dependencies**: None  
**Used In**: All apps  
**Business Rules**: Maps internal DateType values to user-friendly names  
**Migration Notes**: Reference table for display names

---

## Migration Notes

1. **Function Dependencies**: Many flags use Qlik functions like `InMonthToDate`, `InYear`, `InWeek`, etc. These need to be implemented as PostgreSQL functions or replaced with inline SQL.

2. **Dual Values**: Qlik's `Dual()` function creates fields with both display and sort values. In PostgreSQL, consider:
   - Computed columns for sort values
   - Separate display columns if needed
   - Or use formatted strings with proper date types for sorting

3. **Date Range Generation**: The calendar generation creates a continuous range of dates between min and max. In PostgreSQL, use `generate_series()`:
   ```sql
   SELECT generate_series(
       DATE_TRUNC('month', MIN(date_field)),
       DATE_TRUNC('month', MAX(date_field)),
       '1 month'::interval
   ) as date
   ```

4. **Performance**: Calendar tables can be large. Consider:
   - Materialized views for calendar tables
   - Indexes on date fields and flags
   - Partitioning by year/month if very large

5. **DateLink Table**: This is a fact-dimension link table. In PostgreSQL:
   - Create as a separate table or view
   - Index on `row_no` and `date_type` for performance
   - Consider using JSONB for flexible date storage if needed

6. **Variable Lists**: These are typically used for dropdowns in the UI. In PostgreSQL:
   - Store as JSON arrays in a config table
   - Or generate on-the-fly with STRING_AGG
   - Cache if performance is critical
