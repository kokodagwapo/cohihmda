# Qlik Function Definitions

**Source File**: `tvd-coheus-incremental-builder-qlik/Functions.qvs`

This document catalogs all Qlik function definitions used in the system, along with their PostgreSQL equivalents.

---

## Date Functions

### fDate
**Qlik Definition**: `Date($1)`  
**Purpose**: Converts a value to a date  
**PostgreSQL Equivalent**: `DATE($1)` or `$1::date`

**Example**:
```qvs
$(fDate([Application Date]))
```

**PostgreSQL**:
```sql
DATE(application_date)
```

---

### fYear
**Qlik Definition**: `Year($1)`  
**Purpose**: Extracts year from date  
**PostgreSQL Equivalent**: `EXTRACT(YEAR FROM $1)`

**Example**:
```qvs
$(fYear([Application Date]))
```

**PostgreSQL**:
```sql
EXTRACT(YEAR FROM application_date)
```

---

### fMonth
**Qlik Definition**: `Month($1)`  
**Purpose**: Extracts month from date  
**PostgreSQL Equivalent**: `EXTRACT(MONTH FROM $1)`

**Example**:
```qvs
$(fMonth([Application Date]))
```

**PostgreSQL**:
```sql
EXTRACT(MONTH FROM application_date)
```

---

### fYearMonth
**Qlik Definition**: `Dual(Year($1)&'-'&Month($1), monthstart($1))`  
**Purpose**: Creates display value (e.g., "2024-1") with sort value (month start date)  
**PostgreSQL Equivalent**: Use `DATE_TRUNC('month', $1)` for grouping, format with `TO_CHAR()` for display

**Example**:
```qvs
$(fYearMonth([Application Date]))
```

**PostgreSQL**:
```sql
-- For grouping/sorting
DATE_TRUNC('month', application_date)

-- For display
TO_CHAR(application_date, 'YYYY-MM')
```

**See**: `patterns/dual-display-sort.md` for Dual() pattern translation.

---

### fYearMonthNum
**Qlik Definition**: `Year($1)*12 + num(Month($1))`  
**Purpose**: Creates numeric year-month value (e.g., 2024*12 + 1 = 24289)  
**PostgreSQL Equivalent**: `EXTRACT(YEAR FROM $1) * 12 + EXTRACT(MONTH FROM $1)`

**Example**:
```qvs
$(fYearMonthNum([Application Date]))
```

**PostgreSQL**:
```sql
EXTRACT(YEAR FROM application_date) * 12 + EXTRACT(MONTH FROM application_date)
```

---

### fYearQuarter
**Qlik Definition**: `Dual(Year($1)&'-Q'&Num(Ceil(Num(Month($1))/3)), QuarterStart($1))`  
**Purpose**: Creates display value (e.g., "2024-Q1") with sort value (quarter start date)  
**PostgreSQL Equivalent**: Use `DATE_TRUNC('quarter', $1)` for grouping

**Example**:
```qvs
$(fYearQuarter([Application Date]))
```

**PostgreSQL**:
```sql
-- For grouping/sorting
DATE_TRUNC('quarter', application_date)

-- For display
TO_CHAR(application_date, 'YYYY') || '-Q' || EXTRACT(QUARTER FROM application_date)
```

---

### fYearWeek
**Qlik Definition**: `Dual(Year($1)&'-W'&Num(Ceil(Num(Week($1)))), WeekStart($1))`  
**Purpose**: Creates display value (e.g., "2024-W1") with sort value (week start date)  
**PostgreSQL Equivalent**: Use `DATE_TRUNC('week', $1)` for grouping

**Example**:
```qvs
$(fYearWeek([Application Date]))
```

**PostgreSQL**:
```sql
-- For grouping/sorting
DATE_TRUNC('week', application_date)

-- For display
TO_CHAR(application_date, 'IYYY') || '-W' || TO_CHAR(application_date, 'IW')
```

---

## Period-to-Date Flags

### fYTD (Year-to-Date)
**Qlik Definition**: `If(InYearToDate($1, '$(vMaxDate)', 0), 'Yes', 'No')`  
**Purpose**: Flag indicating if date falls within year-to-date period  
**PostgreSQL Equivalent**: Use function (see `patterns/date-period-filtering.md`)

**Example**:
```qvs
$(fYTD([Application Date]))
```

**PostgreSQL**:
```sql
-- Create function
CREATE OR REPLACE FUNCTION is_year_to_date(check_date DATE, max_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date >= DATE_TRUNC('year', max_date) 
       AND check_date <= max_date;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Use
is_year_to_date(application_date, CURRENT_DATE)
```

**See**: `patterns/date-period-filtering.md` for complete function examples.

---

### fQTD (Quarter-to-Date)
**Qlik Definition**: `If(InQuarterToDate($1, '$(vMaxDate)', 0), 'Yes', 'No')`  
**Purpose**: Flag indicating if date falls within quarter-to-date period  
**PostgreSQL Equivalent**: Use function

**PostgreSQL**:
```sql
CREATE OR REPLACE FUNCTION is_quarter_to_date(check_date DATE, max_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date >= DATE_TRUNC('quarter', max_date) 
       AND check_date <= max_date;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

### fMTD (Month-to-Date)
**Qlik Definition**: `If(InMonthToDate($1, '$(vMaxDate)', 0), 'Yes', 'No')`  
**Purpose**: Flag indicating if date falls within month-to-date period  
**PostgreSQL Equivalent**: Use function

**PostgreSQL**:
```sql
CREATE OR REPLACE FUNCTION is_month_to_date(check_date DATE, max_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date >= DATE_TRUNC('month', max_date) 
       AND check_date <= max_date;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

### fYTDPrevious (Previous Year-to-Date)
**Qlik Definition**: `If(InYearToDate($1, '$(vMaxDate)', -1), 'Yes', 'No')`  
**Purpose**: Flag indicating if date falls within previous year-to-date period  
**PostgreSQL Equivalent**: Use function

**PostgreSQL**:
```sql
CREATE OR REPLACE FUNCTION is_previous_year_to_date(check_date DATE, max_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date >= DATE_TRUNC('year', max_date) - INTERVAL '1 year'
       AND check_date < DATE_TRUNC('year', max_date);
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

### fMTDPrevious (Previous Month-to-Date)
**Qlik Definition**: `If(InMonthToDate($1, '$(vMaxDate)', -1), 'Yes', 'No')`  
**Purpose**: Flag indicating if date falls within previous month-to-date period  
**PostgreSQL Equivalent**: Use function

**PostgreSQL**:
```sql
CREATE OR REPLACE FUNCTION is_previous_month_to_date(check_date DATE, max_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date >= DATE_TRUNC('month', max_date) - INTERVAL '1 month'
       AND check_date < DATE_TRUNC('month', max_date);
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

### fYearPrevious (Previous Year)
**Qlik Definition**: `If(InYear($1, '$(vMaxDate)', -1), 'Yes', 'No')`  
**Purpose**: Flag indicating if date falls within previous year  
**PostgreSQL Equivalent**: Use function

**PostgreSQL**:
```sql
CREATE OR REPLACE FUNCTION is_previous_year(check_date DATE, max_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date >= DATE_TRUNC('year', max_date) - INTERVAL '1 year'
       AND check_date < DATE_TRUNC('year', max_date);
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

### fMonthPrevious (Previous Month)
**Qlik Definition**: `If(InMonth($1, '$(vMaxDate)', -1), 'Yes', 'No')`  
**Purpose**: Flag indicating if date falls within previous month  
**PostgreSQL Equivalent**: Use function

**PostgreSQL**:
```sql
CREATE OR REPLACE FUNCTION is_previous_month(check_date DATE, max_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date >= DATE_TRUNC('month', max_date) - INTERVAL '1 month'
       AND check_date < DATE_TRUNC('month', max_date);
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

## Rolling Period Flags

### fRolling0to60Flag
**Qlik Definition**: `If($1 <= Date(Floor('$(vMaxDate)')) AND $1 >= Date(Floor('$(vMaxDate)')) -60, 'Yes', 'No')`  
**Purpose**: Flag indicating if date falls within last 60 days  
**PostgreSQL Equivalent**: Use function

**PostgreSQL**:
```sql
CREATE OR REPLACE FUNCTION is_rolling_60_days(check_date DATE, max_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date <= max_date 
       AND check_date >= max_date - INTERVAL '60 days';
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

### fRolling61to120Flag
**Qlik Definition**: `If($1 <= Date(Floor('$(vMaxDate)')) -61 AND $1 >= Date(Floor('$(vMaxDate)')) -120, 'Yes', 'No')`  
**Purpose**: Flag indicating if date falls within 61-120 days ago  
**PostgreSQL Equivalent**: Use function

**PostgreSQL**:
```sql
CREATE OR REPLACE FUNCTION is_rolling_61_to_120_days(check_date DATE, max_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date <= max_date - INTERVAL '61 days'
       AND check_date >= max_date - INTERVAL '120 days';
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

### fRolling0to360Flag
**Qlik Definition**: `If($1 <= Date(Floor('$(vMaxDate)')) AND $1 >= Date(Floor('$(vMaxDate)')) -360, 'Yes', 'No')`  
**Purpose**: Flag indicating if date falls within last 360 days  
**PostgreSQL Equivalent**: Use function

**PostgreSQL**:
```sql
CREATE OR REPLACE FUNCTION is_rolling_360_days(check_date DATE, max_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date <= max_date 
       AND check_date >= max_date - INTERVAL '360 days';
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

### fRolling361to720Flag
**Qlik Definition**: `If($1 <= Date(Floor('$(vMaxDate)')) -361 AND $1 >= Date(Floor('$(vMaxDate)')) -720, 'Yes', 'No')`  
**Purpose**: Flag indicating if date falls within 361-720 days ago  
**PostgreSQL Equivalent**: Use function

**PostgreSQL**:
```sql
CREATE OR REPLACE FUNCTION is_rolling_361_to_720_days(check_date DATE, max_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date <= max_date - INTERVAL '361 days'
       AND check_date >= max_date - INTERVAL '720 days';
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

### fRolling12MonthFlag
**Qlik Definition**: `If($1 > '$(vMaxDate)', 'No', If($1 >= AddMonths(MonthEnd('$(vMaxDate)'),-12,1), 'Yes', 'No'))`  
**Purpose**: Flag indicating if date falls within rolling 12 months  
**PostgreSQL Equivalent**: Use function

**PostgreSQL**:
```sql
CREATE OR REPLACE FUNCTION is_rolling_12_month(check_date DATE, max_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date <= max_date
       AND check_date >= DATE_TRUNC('month', max_date) - INTERVAL '12 months';
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

### fRolling13MonthFlag
**Qlik Definition**: `If($1 > '$(vMaxDate)', 'No', If($1 >= AddMonths(MonthEnd('$(vMaxDate)'),-13,1), 'Yes', 'No'))`  
**Purpose**: Flag indicating if date falls within rolling 13 months  
**PostgreSQL Equivalent**: Use function

**PostgreSQL**:
```sql
CREATE OR REPLACE FUNCTION is_rolling_13_month(check_date DATE, max_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date <= max_date
       AND check_date >= DATE_TRUNC('month', max_date) - INTERVAL '13 months';
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

**See**: `patterns/date-period-filtering.md` for complete function examples.

---

## Current Period Flags

### fCurrentMonthFlag
**Qlik Definition**: `If($1 >= MonthStart('$(vMaxDate)') AND $1 <= MonthEnd('$(vMaxDate)'), 'Yes', 'No')`  
**Purpose**: Flag indicating if date falls within current month  
**PostgreSQL Equivalent**: Use function

**PostgreSQL**:
```sql
CREATE OR REPLACE FUNCTION is_current_month(check_date DATE, max_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date >= DATE_TRUNC('month', max_date)
       AND check_date < DATE_TRUNC('month', max_date) + INTERVAL '1 month';
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

### fPreviousMonthFlag
**Qlik Definition**: `If($1 >= MonthStart('$(vMaxDate)',-1) AND $1 <= MonthEnd('$(vMaxDate)',-1), 'Yes', 'No')`  
**Purpose**: Flag indicating if date falls within previous month  
**PostgreSQL Equivalent**: Use function

**PostgreSQL**:
```sql
CREATE OR REPLACE FUNCTION is_previous_month(check_date DATE, max_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date >= DATE_TRUNC('month', max_date) - INTERVAL '1 month'
       AND check_date < DATE_TRUNC('month', max_date);
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

### fCurrentYearFlag
**Qlik Definition**: `If($1 >= YearStart('$(vMaxDate)') AND $1 <= YearEnd('$(vMaxDate)'), 'Yes', 'No')`  
**Purpose**: Flag indicating if date falls within current year  
**PostgreSQL Equivalent**: Use function

**PostgreSQL**:
```sql
CREATE OR REPLACE FUNCTION is_current_year(check_date DATE, max_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date >= DATE_TRUNC('year', max_date)
       AND check_date < DATE_TRUNC('year', max_date) + INTERVAL '1 year';
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

### fPreviousYearFlag
**Qlik Definition**: `If($1 >= YearStart('$(vMaxDate)',-1) AND $1 <= YearEnd('$(vMaxDate)',-1), 'Yes', 'No')`  
**Purpose**: Flag indicating if date falls within previous year  
**PostgreSQL Equivalent**: Use function

**PostgreSQL**:
```sql
CREATE OR REPLACE FUNCTION is_previous_year(check_date DATE, max_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date >= DATE_TRUNC('year', max_date) - INTERVAL '1 year'
       AND check_date < DATE_TRUNC('year', max_date);
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

### fPreviousQtrFlag
**Qlik Definition**: `If(InQuarter($1, '$(vMaxDate)', -1), 'Yes', 'No')`  
**Purpose**: Flag indicating if date falls within previous quarter  
**PostgreSQL Equivalent**: Use function

**PostgreSQL**:
```sql
CREATE OR REPLACE FUNCTION is_previous_quarter(check_date DATE, max_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date >= DATE_TRUNC('quarter', max_date) - INTERVAL '3 months'
       AND check_date < DATE_TRUNC('quarter', max_date);
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

## Week Flags

### fCurWeekFlag (Current Week)
**Qlik Definition**: `If(InWeekToDate($1, '$(vMaxDate)', 0), 'Yes', 'No')`  
**Purpose**: Flag indicating if date falls within current week  
**PostgreSQL Equivalent**: Use function

**PostgreSQL**:
```sql
CREATE OR REPLACE FUNCTION is_current_week(check_date DATE, max_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date >= DATE_TRUNC('week', max_date)
       AND check_date <= max_date;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

### fLastWeekFlag
**Qlik Definition**: `If(InWeek($1, '$(vMaxDate)', -1), 'Yes', 'No')`  
**Purpose**: Flag indicating if date falls within last week  
**PostgreSQL Equivalent**: Use function

**PostgreSQL**:
```sql
CREATE OR REPLACE FUNCTION is_last_week(check_date DATE, max_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date >= DATE_TRUNC('week', max_date) - INTERVAL '1 week'
       AND check_date < DATE_TRUNC('week', max_date);
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

## Day Flags

### fTodayFlag
**Qlik Definition**: `If($1 = DayStart('$(vMaxDate)'), 'Yes', 'No')`  
**Purpose**: Flag indicating if date is today  
**PostgreSQL Equivalent**: `check_date = CURRENT_DATE`

**Example**:
```qvs
$(fTodayFlag([Application Date]))
```

**PostgreSQL**:
```sql
application_date = CURRENT_DATE
```

---

### fYesterdayFlag
**Qlik Definition**: `If($1 = DayStart('$(vMaxDate)') -1, 'Yes', 'No')`  
**Purpose**: Flag indicating if date is yesterday  
**PostgreSQL Equivalent**: `check_date = CURRENT_DATE - INTERVAL '1 day'`

**Example**:
```qvs
$(fYesterdayFlag([Application Date]))
```

**PostgreSQL**:
```sql
application_date = CURRENT_DATE - INTERVAL '1 day'
```

---

## Year-Over-Year Flags

### fLYLastMonthFlag (Last Year Last Month)
**Qlik Definition**: `If(InMonth($1, '$(vMaxDate)', -13), 'Yes', 'No')`  
**Purpose**: Flag indicating if date falls within same month last year  
**PostgreSQL Equivalent**: Use function

**PostgreSQL**:
```sql
CREATE OR REPLACE FUNCTION is_last_year_last_month(check_date DATE, max_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date >= DATE_TRUNC('month', max_date) - INTERVAL '13 months'
       AND check_date < DATE_TRUNC('month', max_date) - INTERVAL '12 months';
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

### fLYSameMonthFlag (Last Year Same Month)
**Qlik Definition**: `If(InMonth($1, '$(vMaxDate)', -12), 'Yes', 'No')`  
**Purpose**: Flag indicating if date falls within same month last year  
**PostgreSQL Equivalent**: Use function

**PostgreSQL**:
```sql
CREATE OR REPLACE FUNCTION is_last_year_same_month(check_date DATE, max_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date >= DATE_TRUNC('month', max_date) - INTERVAL '12 months'
       AND check_date < DATE_TRUNC('month', max_date) - INTERVAL '11 months';
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

### fLYCurWeekFlag (Last Year Current Week)
**Qlik Definition**: `If(InWeekToDate($1, '$(vMaxDate)', -52), 'Yes', 'No')`  
**Purpose**: Flag indicating if date falls within same week last year  
**PostgreSQL Equivalent**: Use function

**PostgreSQL**:
```sql
CREATE OR REPLACE FUNCTION is_last_year_current_week(check_date DATE, max_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date >= DATE_TRUNC('week', max_date) - INTERVAL '52 weeks'
       AND check_date <= max_date - INTERVAL '52 weeks';
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

### fLYYesterdayFlag (Last Year Yesterday)
**Qlik Definition**: `If($1 = DayStart('$(vMaxDate)') -366, 'Yes', 'No')`  
**Purpose**: Flag indicating if date is same day last year  
**PostgreSQL Equivalent**: `check_date = CURRENT_DATE - INTERVAL '366 days'`

**PostgreSQL**:
```sql
application_date = CURRENT_DATE - INTERVAL '366 days'
```

---

### fLastYMTD (Last Year Month-to-Date)
**Qlik Definition**: `If(InMonthToDate($1, '$(vMaxDate)', -12), 'Yes', 'No')`  
**Purpose**: Flag indicating if date falls within month-to-date period last year  
**PostgreSQL Equivalent**: Use function

**PostgreSQL**:
```sql
CREATE OR REPLACE FUNCTION is_last_year_month_to_date(check_date DATE, max_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date >= DATE_TRUNC('month', max_date) - INTERVAL '12 months'
       AND check_date <= max_date - INTERVAL '12 months';
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

### fLYQTD (Last Year Quarter-to-Date)
**Qlik Definition**: `If(InQuarterToDate($1, '$(vMaxDate)', -4), 'Yes', 'No')`  
**Purpose**: Flag indicating if date falls within quarter-to-date period last year  
**PostgreSQL Equivalent**: Use function

**PostgreSQL**:
```sql
CREATE OR REPLACE FUNCTION is_last_year_quarter_to_date(check_date DATE, max_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_date >= DATE_TRUNC('quarter', max_date) - INTERVAL '4 quarters'
       AND check_date <= max_date - INTERVAL '4 quarters';
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

---

## Qlik Date Functions Used

### InMonthToDate()
**Qlik Function**: `InMonthToDate(date, max_date, offset)`  
**PostgreSQL Equivalent**: 
```sql
date >= DATE_TRUNC('month', max_date) + (offset || ' months')::INTERVAL
AND date <= max_date + (offset || ' months')::INTERVAL
```

### InYearToDate()
**Qlik Function**: `InYearToDate(date, max_date, offset)`  
**PostgreSQL Equivalent**: 
```sql
date >= DATE_TRUNC('year', max_date) + (offset || ' years')::INTERVAL
AND date <= max_date + (offset || ' years')::INTERVAL
```

### InQuarterToDate()
**Qlik Function**: `InQuarterToDate(date, max_date, offset)`  
**PostgreSQL Equivalent**: 
```sql
date >= DATE_TRUNC('quarter', max_date) + (offset || ' quarters')::INTERVAL
AND date <= max_date + (offset || ' quarters')::INTERVAL
```

### InMonth()
**Qlik Function**: `InMonth(date, max_date, offset)`  
**PostgreSQL Equivalent**: 
```sql
date >= DATE_TRUNC('month', max_date) + (offset || ' months')::INTERVAL
AND date < DATE_TRUNC('month', max_date) + ((offset + 1) || ' months')::INTERVAL
```

### InYear()
**Qlik Function**: `InYear(date, max_date, offset)`  
**PostgreSQL Equivalent**: 
```sql
date >= DATE_TRUNC('year', max_date) + (offset || ' years')::INTERVAL
AND date < DATE_TRUNC('year', max_date) + ((offset + 1) || ' years')::INTERVAL
```

### InWeek()
**Qlik Function**: `InWeek(date, max_date, offset)`  
**PostgreSQL Equivalent**: 
```sql
date >= DATE_TRUNC('week', max_date) + (offset || ' weeks')::INTERVAL
AND date < DATE_TRUNC('week', max_date) + ((offset + 1) || ' weeks')::INTERVAL
```

### InWeekToDate()
**Qlik Function**: `InWeekToDate(date, max_date, offset)`  
**PostgreSQL Equivalent**: 
```sql
date >= DATE_TRUNC('week', max_date) + (offset || ' weeks')::INTERVAL
AND date <= max_date + (offset || ' weeks')::INTERVAL
```

### AddMonths()
**Qlik Function**: `AddMonths(date, offset)`  
**PostgreSQL Equivalent**: `date + (offset || ' months')::INTERVAL`

### MonthStart() / MonthEnd()
**Qlik Function**: `MonthStart(date, offset)` / `MonthEnd(date, offset)`  
**PostgreSQL Equivalent**: 
- `MonthStart`: `DATE_TRUNC('month', date) + (offset || ' months')::INTERVAL`
- `MonthEnd`: `(DATE_TRUNC('month', date) + INTERVAL '1 month' - INTERVAL '1 day') + (offset || ' months')::INTERVAL`

### YearStart() / YearEnd()
**Qlik Function**: `YearStart(date, offset)` / `YearEnd(date, offset)`  
**PostgreSQL Equivalent**: 
- `YearStart`: `DATE_TRUNC('year', date) + (offset || ' years')::INTERVAL`
- `YearEnd`: `(DATE_TRUNC('year', date) + INTERVAL '1 year' - INTERVAL '1 day') + (offset || ' years')::INTERVAL`

### QuarterStart()
**Qlik Function**: `QuarterStart(date, offset)`  
**PostgreSQL Equivalent**: `DATE_TRUNC('quarter', date) + (offset || ' quarters')::INTERVAL`

### WeekStart()
**Qlik Function**: `WeekStart(date, offset)`  
**PostgreSQL Equivalent**: `DATE_TRUNC('week', date) + (offset || ' weeks')::INTERVAL`

### DayStart()
**Qlik Function**: `DayStart(date)`  
**PostgreSQL Equivalent**: `DATE_TRUNC('day', date)` or `date::date`

---

## Business Day Functions

### NetWorkDays() (Legacy - Not Currently Used)
**Qlik Function**: `NetWorkDays(start_date, end_date, holidays)`  
**Purpose**: Calculates business days between two dates, excluding weekends and holidays  
**Status**: Previously used but deprecated in favor of calendar days  
**PostgreSQL Equivalent**: Requires custom function

**PostgreSQL**:
```sql
CREATE OR REPLACE FUNCTION business_days_between(start_date DATE, end_date DATE, holidays DATE[])
RETURNS INTEGER AS $$
DECLARE
    total_days INTEGER;
    weekend_days INTEGER;
    holiday_count INTEGER;
BEGIN
    total_days := end_date - start_date;
    weekend_days := (SELECT COUNT(*) FROM generate_series(start_date, end_date, '1 day'::interval) 
                     WHERE EXTRACT(DOW FROM generate_series) IN (0, 6));
    holiday_count := (SELECT COUNT(*) FROM unnest(holidays) 
                      WHERE unnest >= start_date AND unnest <= end_date);
    RETURN total_days - weekend_days - holiday_count;
END;
$$ LANGUAGE plpgsql;
```

**Note**: Current system uses calendar days, not business days. This function is documented for historical reference.

---

## Function Usage Patterns

### Variable Expansion
**Qlik Pattern**: `$(fFunctionName([Field Name]))`  
**PostgreSQL**: Call function directly: `function_name(field_name, CURRENT_DATE)`

### Multiple Field Application
**Qlik Pattern**: Same function applied to multiple fields  
**PostgreSQL**: Apply function to each field individually

---

## Source Fields

Functions use date fields from the [Coheus Data Dictionary](../../data-dictionary/CoheusDataDictionary.xml):

**Common Date Fields**:
- `Application Date` (Encompass: `Fields.3142`)
- `Funding Date` (Encompass: `Fields.MS.FUN`)
- `Closing Date` (Encompass: `Fields.748`)
- All milestone dates

**See**: `patterns/source-fields.md` for complete data dictionary integration guide.

---

## Migration Notes

- **All date flags** should be implemented as PostgreSQL functions, NOT computed columns
- **Functions are reusable** - create once, use many times
- **Performance**: Functions with `IMMUTABLE` can be optimized by PostgreSQL
- **Date calculations** use calendar days (not business days) in current system
- **Variable expansion** (`$(vMaxDate)`) becomes function parameter in PostgreSQL

---

## See Also

- **Date Period Filtering**: `patterns/date-period-filtering.md` - Date flags → Functions pattern
- **Dual Display Sort**: `patterns/dual-display-sort.md` - Dual() pattern for display + sort
- **Date Groupings**: `patterns/date-groupings.md` - YearMonth, YearQuarter patterns
- **PostgreSQL Mapping**: `migration/postgresql-mapping.md` - General function mappings
