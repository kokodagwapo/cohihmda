# Variables Dictionary

**Source Files**: 
- `tvd-coheus-sales-qlik/Scripts/Variables.qvs`
- `tvd-coheus-incremental-builder-qlik/Variables.qvs`
- `Performance/tvd-coheus-performance-qlik/Scripts/Variables.qvs`

This document catalogs key variable definitions used across Qlik apps. Variables are used for dynamic expressions, configuration, and UI controls.

---

## Variable Categories

### 1. Date/Time Variables

#### vMaxDate
**Category**: Date/Time  
**Definition**: Maximum date in the dataset (used as "current date" for calculations)  
**Qlik Expression**:
```qvs
LET vMaxDate = ... // Typically set from data or as Today()
```
**SQL Equivalent**:
```sql
-- Set as parameter or use CURRENT_DATE
-- Or calculate: SELECT MAX(date_field) FROM loans
```
**Dependencies**: Data or system date  
**Used In**: All apps  
**Business Rules**: Represents the "as of" date for all date calculations  
**Migration Notes**: Can be a parameter, config value, or calculated from data

---

#### vCurrentDate
**Category**: Date/Time  
**Definition**: Current date for calculations  
**Qlik Expression**:
```qvs
LET vCurrentDate = Today();
```
**SQL Equivalent**:
```sql
CURRENT_DATE
```
**Dependencies**: System date  
**Used In**: All apps  
**Business Rules**: System current date  
**Migration Notes**: PostgreSQL CURRENT_DATE function

---

#### vCurrentDateAsDate
**Category**: Date/Time  
**Definition**: Current date formatted as date value  
**Qlik Expression**:
```qvs
LET vCurrentDateAsDate = Date(Today());
```
**SQL Equivalent**:
```sql
CURRENT_DATE
```
**Dependencies**: System date  
**Used In**: All apps  
**Business Rules**: Date value (not timestamp)  
**Migration Notes**: CURRENT_DATE returns date type

---

### 2. Channel/TPO Variables

#### vCorrespondent
**Category**: Channel  
**Definition**: Filter for Correspondent channel (typically 'Yes' or 'No')  
**Qlik Expression**:
```qvs
LET vCorrespondent = 'No'; // Default excludes Correspondent
```
**SQL Equivalent**:
```sql
-- Use in WHERE clause
WHERE correspondent_channel_flag = 'No'
```
**Dependencies**: Channel data  
**Used In**: Sales, DataPilot, Operations  
**Business Rules**: Controls whether Correspondent loans are included  
**Migration Notes**: Filter parameter for WHERE clause

---

#### vChannel
**Category**: Channel  
**Definition**: Selected channel filter value  
**Qlik Expression**:
```qvs
LET vChannel = 'Banked - Retail'; // Example default
```
**SQL Equivalent**:
```sql
-- Use in WHERE clause
WHERE channel = 'Banked - Retail'
```
**Dependencies**: Channel field  
**Used In**: Sales, DataPilot  
**Business Rules**: Filters to specific channel  
**Migration Notes**: Filter parameter

---

#### vTPOCheck
**Category**: Channel  
**Definition**: Flag indicating if TPO data exists (-1 = Yes, 0 = No)  
**Qlik Expression**:
```qvs
LET vTPOCheck = ... // Calculated from data
```
**SQL Equivalent**:
```sql
-- Boolean flag
CASE WHEN EXISTS (SELECT 1 FROM loans WHERE channel ILIKE '%Whol%' OR channel ILIKE '%Corresp%') 
     THEN -1 ELSE 0 END
```
**Dependencies**: Channel data  
**Used In**: All apps  
**Business Rules**: Determines if TPO-specific logic should run  
**Migration Notes**: Boolean flag

---

### 3. Date Toggle Variables

#### vDateToggle1
**Category**: Date Toggle  
**Definition**: Primary date type selection (Funding, Closing, Application)  
**Qlik Expression**:
```qvs
LET vDateToggle1 = 'Funding'; // or 'Closing', 'Application'
```
**SQL Equivalent**:
```sql
-- Use in CASE statement or dynamic SQL
WHERE date_type = 'Funding'
```
**Dependencies**: DateType field  
**Used In**: Sales, Performance  
**Business Rules**: Controls which date type is used for filtering  
**Migration Notes**: Filter parameter for DateType

---

#### vHighPerformerDateToggle
**Category**: Date Toggle  
**Definition**: Date period selection (MTD, Previous Month, YTD, etc.)  
**Qlik Expression**:
```qvs
LET vHighPerformerDateToggle = 'MTD'; // or 'Previous Month Flag', 'YTD Flag', etc.
```
**SQL Equivalent**:
```sql
-- Use in WHERE clause based on selected period
WHERE {period_flag} = 'Yes'
-- e.g., WHERE funding_mtd = 'Yes'
```
**Dependencies**: Date flags  
**Used In**: Sales, Performance  
**Business Rules**: Controls date period filtering  
**Migration Notes**: Maps to date flag fields

---

#### vTPODateToggle
**Category**: Date Toggle  
**Definition**: Date type for TPO pull through calculations  
**Qlik Expression**:
```qvs
LET vTPODateToggle = 'Application'; // or 'Started'
```
**SQL Equivalent**:
```sql
WHERE date_type = 'Application'
```
**Dependencies**: DateType field  
**Used In**: Sales, Contribution to Profit  
**Business Rules**: Determines start date for pull through (Application for Retail, Started for TPO)  
**Migration Notes**: Filter parameter

---

### 4. Year/Month List Variables

#### vYearMonthList
**Category**: Lists  
**Definition**: Pipe-delimited list of YearMonth values for dropdowns  
**Qlik Expression**:
```qvs
LET vYearMonthList = '2024-01|2024-02|2024-03|...';
```
**SQL Equivalent**:
```sql
SELECT STRING_AGG(DISTINCT yearmonth::text, '|' ORDER BY yearmonth DESC) 
FROM common_calendar
WHERE date >= CURRENT_DATE - INTERVAL '12 months'
```
**Dependencies**: CommonCalendar table  
**Used In**: All apps  
**Business Rules**: Used for YearMonth dropdown selections  
**Migration Notes**: Generated from calendar table

---

#### vYearList
**Category**: Lists  
**Definition**: Pipe-delimited list of Year values  
**Qlik Expression**:
```qvs
LET vYearList = '2024|2023|2022|...';
```
**SQL Equivalent**:
```sql
SELECT STRING_AGG(DISTINCT year::text, '|' ORDER BY year DESC)
FROM common_calendar
WHERE year >= EXTRACT(YEAR FROM CURRENT_DATE) - 2
```
**Dependencies**: CommonCalendar table  
**Used In**: All apps  
**Business Rules**: Used for Year dropdown selections  
**Migration Notes**: Generated from calendar table

---

#### vMinYear / vMaxYear
**Category**: Lists  
**Definition**: Minimum and maximum year values  
**Qlik Expression**:
```qvs
LET vMinYear = 2022;
LET vMaxYear = 2024;
```
**SQL Equivalent**:
```sql
SELECT MIN(year) as min_year, MAX(year) as max_year
FROM common_calendar
```
**Dependencies**: CommonCalendar table  
**Used In**: All apps  
**Business Rules**: Year boundaries for filtering  
**Migration Notes**: Aggregate functions

---

### 5. DateType Mapping Variables

#### vDateTypeList
**Category**: Mapping  
**Definition**: Mapping of DateType values to display names  
**Qlik Expression**:
```qvs
LET vDateTypeList = 'Credit Pull~Credit Pulls|Application~Applications Taken|Closing~Closed Loans|Funding~Funded Loans|...';
```
**SQL Equivalent**:
```sql
-- Reference table
CREATE TABLE date_type_mapping (
    date_type VARCHAR(50),
    display_name VARCHAR(100)
);
```
**Dependencies**: None  
**Used In**: All apps  
**Business Rules**: Maps internal DateType to user-friendly names  
**Migration Notes**: Reference/lookup table

---

### 6. Revenue Variables

#### vDefaultRevFlag / vExecRevFlag / vOpsRevFlag / vSalesRevFlag / vContributionRevFlag
**Category**: Revenue  
**Definition**: Flags indicating if custom revenue formulas are configured  
**Qlik Expression**:
```qvs
LET vDefaultRevFlag = If(Len(Trim(Peek('DefaultRevenueFormula',0,'RevCalcDefault')))=0,0,1);
```
**SQL Equivalent**:
```sql
-- Boolean flag
CASE WHEN default_revenue_formula IS NOT NULL THEN 1 ELSE 0 END
```
**Dependencies**: Revenue configuration  
**Used In**: All apps  
**Business Rules**: Determines if custom revenue formula should be used  
**Migration Notes**: Configuration flag

---

#### vDefaultRevCalc / vExecRevCalc / etc.
**Category**: Revenue  
**Definition**: Custom revenue calculation formulas  
**Qlik Expression**:
```qvs
LET vDefaultRevCalc = If($(vDefaultRevFlag)=1,Peek('DefaultRevenueFormula',0,'RevCalcDefault'),0);
```
**SQL Equivalent**:
```sql
-- Stored formula or function
-- Could be stored as text and evaluated, or as stored procedure
```
**Dependencies**: Revenue configuration  
**Used In**: All apps  
**Business Rules**: Custom revenue formulas from configuration  
**Migration Notes**: May need formula evaluation engine or stored procedures

---

### 7. Scorecard Variables

#### vScorecardAggrLevel
**Category**: Scorecard  
**Definition**: Aggregation level for scorecard calculations  
**Qlik Expression**:
```qvs
LET vScorecardAggrLevel = '[Loan Officer],[Branch]';
```
**SQL Equivalent**:
```sql
-- Use in GROUP BY
GROUP BY loan_officer, branch
```
**Dependencies**: Dimension fields  
**Used In**: Sales, Contribution to Profit  
**Business Rules**: Determines grouping level for scorecard metrics  
**Migration Notes**: Dynamic GROUP BY clause

---

#### vScorecardMissingLevel
**Category**: Scorecard  
**Definition**: Filter for missing dimension values  
**Qlik Expression**:
```qvs
LET vScorecardMissingLevel = '[Loan Officer Missing]*={0},[Branch Missing]*={0}';
```
**SQL Equivalent**:
```sql
WHERE loan_officer_missing = 0 AND branch_missing = 0
```
**Dependencies**: Missing flags  
**Used In**: Sales, Contribution to Profit  
**Business Rules**: Excludes records with missing dimension values  
**Migration Notes**: WHERE clause filters

---

#### vScorecardIgnoreLevel
**Category**: Scorecard  
**Definition**: Dimensions to ignore in scorecard calculations  
**Qlik Expression**:
```qvs
LET vScorecardIgnoreLevel = '[Loan Officer]*=, [Branch]*=';
```
**SQL Equivalent**:
```sql
-- No filter (all values included)
-- Or dynamic WHERE clause
```
**Dependencies**: Dimension fields  
**Used In**: Sales, Contribution to Profit  
**Business Rules**: Allows ignoring certain dimensions  
**Migration Notes**: Dynamic WHERE clause construction

---

#### vScorecardPullThroughAvg_2Months
**Category**: Scorecard  
**Definition**: Average pull through rate for 2-month period  
**Qlik Expression**:
```qvs
LET vScorecardPullThroughAvg_2Months = Avg({$<[Scorecard PullThrough_2Months] *= {">0"}, ...>} Aggr(...));
```
**SQL Equivalent**:
```sql
SELECT AVG(pull_through_2months)
FROM (
    SELECT loan_officer, 
           COUNT(CASE WHEN investor_purchase_date IS NOT NULL THEN 1 END)::numeric / 
           NULLIF(COUNT(*), 0) as pull_through_2months
    FROM loans
    WHERE application_date >= CURRENT_DATE - INTERVAL '2 months'
    GROUP BY loan_officer
) subq
WHERE pull_through_2months > 0
```
**Dependencies**: Pull through calculations  
**Used In**: Sales, Contribution to Profit  
**Business Rules**: Average pull through for normalization  
**Migration Notes**: Complex aggregation with subquery

---

### 8. App Configuration Variables

#### vAppName
**Category**: App Configuration  
**Definition**: Application name  
**Qlik Expression**:
```qvs
LET vAppName = 'Sales';
```
**SQL Equivalent**:
```sql
-- Configuration value
'Sales'
```
**Dependencies**: None  
**Used In**: All apps  
**Business Rules**: Used for UI display and logging  
**Migration Notes**: Configuration constant

---

#### vAppID
**Category**: App Configuration  
**Definition**: Application ID/GUID  
**Qlik Expression**:
```qvs
LET vAppID = DocumentName();
```
**SQL Equivalent**:
```sql
-- Application identifier
-- UUID or string identifier
```
**Dependencies**: System  
**Used In**: All apps  
**Business Rules**: Unique app identifier  
**Migration Notes**: Application metadata

---

#### vXMLName
**Category**: App Configuration  
**Definition**: XML configuration file identifier  
**Qlik Expression**:
```qvs
LET vXMLName = '30'&Text(Num(Replace('$(vClientID)','BE',''),00000000));
```
**SQL Equivalent**:
```sql
-- Configuration file identifier
'30' || LPAD(REPLACE(client_id, 'BE', '')::text, 8, '0')
```
**Dependencies**: Client ID  
**Used In**: All apps  
**Business Rules**: Generates configuration file name from client ID  
**Migration Notes**: String manipulation

---

### 9. UI/Display Variables

#### vSheetWidth / vSheetHeight
**Category**: UI  
**Definition**: Sheet dimensions for responsive sizing  
**Qlik Expression**:
```qvs
LET vSheetWidth = 1920;
LET vSheetHeight = 1080;
```
**SQL Equivalent**:
```sql
-- Not applicable (UI concern)
-- Handle in frontend
```
**Dependencies**: None  
**Used In**: All apps  
**Business Rules**: Baseline screen resolution  
**Migration Notes**: Frontend concern, not database

---

#### vScalingFactor
**Category**: UI  
**Definition**: Scaling factor for responsive font sizing  
**Qlik Expression**:
```qvs
SET vScalingFactor = '=pow((vSheetWidth * vSheetHeight),0.5) / pow((vSheetWidthBaseline*vSheetHeightBaseline), 0.5)';
```
**SQL Equivalent**:
```sql
-- Not applicable (UI concern)
-- Calculate in frontend: Math.sqrt(width * height) / Math.sqrt(baselineWidth * baselineHeight)
```
**Dependencies**: Sheet dimensions  
**Used In**: All apps  
**Business Rules**: Calculates font scaling based on screen size  
**Migration Notes**: Frontend calculation

---

### 10. Holiday Variables

#### vHolidays
**Category**: Holidays  
**Definition**: List of holidays for NetWorkDays calculations  
**Qlik Expression**:
```qvs
// Loaded from include file: Global.Holidays.qss or Global.FederalHolidays.qss
```
**SQL Equivalent**:
```sql
-- Holiday table
CREATE TABLE holidays (
    holiday_date DATE PRIMARY KEY,
    holiday_name VARCHAR(100)
);

-- Use in business_days_between function
```
**Dependencies**: Holiday data  
**Used In**: All apps (for turn time calculations)  
**Business Rules**: Excludes holidays from business day calculations  
**Migration Notes**: Reference table for date calculations

---

## Variable Usage Patterns

### Dynamic Expression Construction
Variables are often used to construct dynamic expressions:
```qvs
Count({$<[$(vDateToggle1) $(vHighPerformerDateToggle)]={Yes}>}[Loan Number])
```

**SQL Equivalent**:
```sql
-- Use parameterized queries or dynamic SQL
SELECT COUNT(*) 
FROM loans 
WHERE {date_type}_{period_flag} = 'Yes'
-- Where {date_type} and {period_flag} are replaced with actual values
```

### Set Analysis Translation
Qlik set analysis with variables:
```qvs
{$<DateType={'$(vDateToggle1)'}, [Date Rolling 13 Month Flag]={Yes}>}
```

**SQL Equivalent**:
```sql
WHERE date_type = $1  -- $1 = 'Application'
  AND date_rolling_13_month_flag = 'Yes'
```

---

## Migration Considerations

1. **Variable Storage**: In PostgreSQL, variables can be:
   - Application-level configuration tables
   - Environment variables
   - Parameterized queries
   - Stored procedures with parameters
   - JSONB configuration columns

2. **Dynamic Expressions**: Qlik's variable expansion in expressions needs to be handled via:
   - Parameterized SQL queries
   - Stored procedures with parameters
   - Application-layer query building
   - Template-based SQL generation

3. **List Variables**: Pipe-delimited lists can be:
   - JSON arrays in config tables
   - Separate reference tables
   - Generated on-the-fly with STRING_AGG
   - Cached for performance

4. **Date Variables**: Date-related variables should use:
   - PostgreSQL date functions (CURRENT_DATE, etc.)
   - Date parameters in queries
   - Computed columns for common date calculations

5. **Configuration Variables**: App-specific configuration:
   - Store in `app_config` table
   - Use JSONB for flexible structure
   - Version control configuration changes

6. **Performance**: Variables used in WHERE clauses:
   - Use parameterized queries (prevents SQL injection)
   - Index columns used in variable-based filters
   - Consider materialized views for common variable combinations

---

## Key Variable Dependencies

- **Date Calculations**: Depend on `vMaxDate`, `vCurrentDate`
- **Channel Filtering**: Depend on `vCorrespondent`, `vChannel`, `vTPOCheck`
- **Date Periods**: Depend on `vDateToggle1`, `vHighPerformerDateToggle`
- **Scorecards**: Depend on `vScorecardAggrLevel`, `vScorecardMissingLevel`
- **Revenue**: Depend on revenue flag and calculation variables
- **Lists**: Depend on calendar table generation

---

## Notes

- Many variables are set from data (e.g., `vMaxDate` from MAX(date))
- Some variables are user-selected (e.g., `vDateToggle1` from dropdown)
- Variables enable dynamic expression construction in Qlik
- In PostgreSQL, this dynamicism is handled via parameters, stored procedures, or application-layer query building
- Variable expansion happens at query time in Qlik; in PostgreSQL, this is handled at query construction time
