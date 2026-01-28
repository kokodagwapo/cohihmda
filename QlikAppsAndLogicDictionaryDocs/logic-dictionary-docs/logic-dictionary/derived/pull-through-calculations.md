# Pull Through Calculations

**Source**: QSDA Expressions.csv, Variables.csv, Transform.qvs

Pull through is a **percentage metric** that measures what percentage of loans that started (Application or Started date) successfully reached a target milestone (typically Investor Purchase). It's calculated per actor/entity (Loan Officer, Branch, etc.) and then averaged.

---

## Overview

**Pull Through Formula**:
```
Pull Through % = (Loans that reached target milestone / Loans that started) × 100
```

**Key Components**:
- **Start Date**: Application Date (Retail) or Started Date (TPO channels)
- **Target Milestone**: Typically Investor Purchase (`[Pull Through Originated Flag]={Yes}`)
- **Aggregation Level**: Per actor/entity (Loan Officer, Branch, etc.)
- **Averaging**: Average of individual pull-through percentages

---

## Scorecard PullThrough

**Purpose**: Standard pull-through percentage for scorecard metrics  
**Time Period**: Rolling 13 months  
**Channel**: Configurable via `$(vChannelGroup)`

### Qlik Expression

```qvs
If('$(vCurrentProduction)' = 'Yes',
    if(Sum(Aggr([Current Production Check],$(vScorecardAggrLevel)))=0,Null(),
    Avg(Aggr(
        Count({<
            DateType*={'Application'}, 
            Rolling13MonthFlag*={Yes}, 
            [Active Loan Flag]*={No}, 
            [Pull Through Originated Flag]*={Yes}, 
            [Consolidated Channels]*={'$(vChannelGroup)'}, 
            $(vScorecardMissingLevel)
        >}[Loan Number])
        /
        Count({<
            DateType*={'Application'}, 
            Rolling13MonthFlag*={Yes}, 
            [Active Loan Flag]*={No}, 
            [Consolidated Channels]*={'$(vChannelGroup)'}, 
            $(vScorecardMissingLevel), 
            $(vPTDim)*=
        >}Total<$(vScorecardAggrLevel)>[Loan Number])
        ,$(vScorecardAggrLevel)))
    )
,
If('$(vCurrentProduction)' = 'No',
    if(Sum(Aggr([Current Production Check],$(vScorecardAggrLevel)))>0,Null(),
    Avg(Aggr(
        Count({<
            DateType*={'Application'}, 
            Rolling13MonthFlag*={Yes}, 
            [Active Loan Flag]*={No}, 
            [Pull Through Originated Flag]*={Yes}, 
            [Consolidated Channels]*={'$(vChannelGroup)'}, 
            $(vScorecardMissingLevel)
        >}[Loan Number])
        /
        Count({<
            DateType*={'Application'}, 
            Rolling13MonthFlag*={Yes}, 
            [Active Loan Flag]*={No}, 
            [Consolidated Channels]*={'$(vChannelGroup)'}, 
            $(vScorecardMissingLevel), 
            $(vPTDim)*=
        >}Total<$(vScorecardAggrLevel)>[Loan Number])
        ,$(vScorecardAggrLevel)))
    )
,
    if(Sum(Aggr([Current Production Check],$(vScorecardAggrLevel)))<0,Null(),
    Avg(Aggr(
        Count({<
            DateType*={'Application'}, 
            Rolling13MonthFlag*={Yes}, 
            [Active Loan Flag]*={No}, 
            [Pull Through Originated Flag]*={Yes}, 
            [Consolidated Channels]*={'$(vChannelGroup)'}, 
            $(vScorecardMissingLevel)
        >}[Loan Number])
        /
        Count({<
            DateType*={'Application'}, 
            Rolling13MonthFlag*={Yes}, 
            [Active Loan Flag]*={No}, 
            [Consolidated Channels]*={'$(vChannelGroup)'}, 
            $(vScorecardMissingLevel), 
            $(vPTDim)*=
        >}Total<$(vScorecardAggrLevel)>[Loan Number])
        ,$(vScorecardAggrLevel)))
    )
)
```

### Key Filters

**Numerator** (Loans that reached milestone):
- `DateType*={'Application'}` - Use Application date
- `Rolling13MonthFlag*={Yes}` - Within rolling 13 months
- `[Active Loan Flag]*={No}` - Closed/inactive loans only
- `[Pull Through Originated Flag]*={Yes}` - Reached Investor Purchase milestone
- `[Consolidated Channels]*={'$(vChannelGroup)'}` - Filter by channel group

**Denominator** (Loans that started):
- Same filters as numerator EXCEPT:
- No `[Pull Through Originated Flag]` filter (includes all loans)
- `$(vPTDim)*=` - Excludes certain dimensions for denominator calculation
- `Total<$(vScorecardAggrLevel)>` - Totals across aggregation level

### PostgreSQL Translation

```sql
-- Create function for pull-through calculation
CREATE OR REPLACE FUNCTION calculate_scorecard_pullthrough(
    p_channel_group VARCHAR,
    p_current_production VARCHAR DEFAULT '*',
    p_aggregation_level VARCHAR DEFAULT 'loan_officer',
    p_max_date DATE DEFAULT CURRENT_DATE
)
RETURNS DECIMAL(10,4) AS $$
DECLARE
    v_result DECIMAL(10,4);
BEGIN
    -- Calculate pull-through per actor, then average
    WITH pullthrough_by_actor AS (
        SELECT 
            -- Aggregation level (loan_officer, branch, etc.)
            CASE 
                WHEN p_aggregation_level = 'loan_officer' THEN loan_officer_id
                WHEN p_aggregation_level = 'branch' THEN branch
                ELSE NULL
            END as actor_id,
            -- Numerator: Loans that reached Investor Purchase
            COUNT(CASE 
                WHEN pull_through_originated_flag = 'Yes' 
                THEN loan_number 
            END)::DECIMAL as numerator,
            -- Denominator: All loans that started
            COUNT(loan_number)::DECIMAL as denominator
        FROM loans l
        WHERE 
            -- Date filters
            application_date >= DATE_TRUNC('month', p_max_date) - INTERVAL '13 months'
            AND application_date <= p_max_date
            -- Status filters
            AND active_loan_flag = 'No'
            -- Channel filter
            AND consolidated_channels = p_channel_group
            -- Current Production filter logic would go here
        GROUP BY actor_id
        HAVING COUNT(loan_number) > 0  -- Exclude actors with no loans
    )
    SELECT AVG(
        CASE 
            WHEN denominator > 0 THEN (numerator / denominator) * 100
            ELSE NULL
        END
    )
    INTO v_result
    FROM pullthrough_by_actor;
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql;
```

**Usage**:
```sql
SELECT calculate_scorecard_pullthrough('Retail', '*', 'loan_officer', CURRENT_DATE) as pullthrough_pct;
```

---

## Scorecard PullThrough_2Months (Short-Term)

**Purpose**: Short-term pull-through percentage (2-month rolling window)  
**Time Period**: Rolling 2 months (configurable via `vShotTermPullThroughRange`)  
**Channel**: Configurable via `$(vChannelGroup)`

### Qlik Expression

```qvs
If('$(vCurrentProduction)' = 'Yes',
    if(Sum(Aggr([Current Production Check],$(vScorecardAggrLevel)))=0,Null(),
    Avg(Aggr(
        Count({<
            DateType*={'Application'}, 
            [Date] *= {">=$(=Date(vCurrentDateAsDate-vShotTermPullThroughRange))<=$(=Date(vCurrentDateAsDate))"}, 
            [Active Loan Flag]*={No}, 
            [Pull Through Originated Flag]*={Yes}, 
            [Consolidated Channels]*={'$(vChannelGroup)'}, 
            $(vScorecardMissingLevel)
        >}[Loan Number])
        /
        Count({<
            DateType*={'Application'}, 
            [Date] *= {">=$(=Date(vCurrentDateAsDate-vShotTermPullThroughRange))<=$(=Date(vCurrentDateAsDate))"}, 
            [Active Loan Flag]*={No}, 
            [Consolidated Channels]*={'$(vChannelGroup)'}, 
            $(vScorecardMissingLevel), 
            $(vPTDim)*=
        >}Total<$(vScorecardAggrLevel)>[Loan Number])
        ,$(vScorecardAggrLevel)))
    )
,
-- Similar logic for 'No' and default cases
)
```

### Key Differences from Standard PullThrough

- **Time Period**: Uses date range filter instead of `Rolling13MonthFlag`
- **Range**: `vCurrentDateAsDate - vShotTermPullThroughRange` to `vCurrentDateAsDate` (typically 60 days)
- **Purpose**: More responsive metric for recent performance

### PostgreSQL Translation

```sql
CREATE OR REPLACE FUNCTION calculate_scorecard_pullthrough_2months(
    p_channel_group VARCHAR,
    p_short_term_range_days INTEGER DEFAULT 60,
    p_aggregation_level VARCHAR DEFAULT 'loan_officer',
    p_max_date DATE DEFAULT CURRENT_DATE
)
RETURNS DECIMAL(10,4) AS $$
DECLARE
    v_result DECIMAL(10,4);
    v_start_date DATE;
BEGIN
    v_start_date := p_max_date - (p_short_term_range_days || ' days')::INTERVAL;
    
    WITH pullthrough_by_actor AS (
        SELECT 
            CASE 
                WHEN p_aggregation_level = 'loan_officer' THEN loan_officer_id
                WHEN p_aggregation_level = 'branch' THEN branch
                ELSE NULL
            END as actor_id,
            COUNT(CASE 
                WHEN pull_through_originated_flag = 'Yes' 
                THEN loan_number 
            END)::DECIMAL as numerator,
            COUNT(loan_number)::DECIMAL as denominator
        FROM loans l
        WHERE 
            application_date >= v_start_date
            AND application_date <= p_max_date
            AND active_loan_flag = 'No'
            AND consolidated_channels = p_channel_group
        GROUP BY actor_id
        HAVING COUNT(loan_number) > 0
    )
    SELECT AVG(
        CASE 
            WHEN denominator > 0 THEN (numerator / denominator) * 100
            ELSE NULL
        END
    )
    INTO v_result
    FROM pullthrough_by_actor;
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql;
```

---

## TVI Pull Through Rating

**Purpose**: Normalized pull-through rating (0-100 scale) comparing individual to average  
**Formula**: `(Individual PullThrough / Average PullThrough) × 100`

### Qlik Expression

```qvs
([Scorecard PullThrough]/$(vScorecardPullThroughAvg))*100
```

**Interpretation**:
- **100**: Equal to average
- **>100**: Above average (better than average)
- **<100**: Below average (worse than average)

### PostgreSQL Translation

```sql
-- Calculate TVI Pull Through Rating
SELECT 
    (scorecard_pullthrough / v_scorecard_pullthrough_avg) * 100 as tvi_pullthrough_rating
FROM (
    SELECT 
        calculate_scorecard_pullthrough('Retail', '*', 'loan_officer', CURRENT_DATE) as scorecard_pullthrough,
        (SELECT AVG(calculate_scorecard_pullthrough('Retail', '*', 'loan_officer', CURRENT_DATE)) 
         FROM loans) as v_scorecard_pullthrough_avg
) sub;
```

---

## Application to Investor Purchase (App-InvPurch)

**Purpose**: Turn time metric (days), NOT a percentage  
**Definition**: Days from Application Date to Investor Purchase Date

### Qlik Expression

```qvs
Date(Floor([Investor Purchase Date]))-Date(Floor([Application Date])) as [App-InvPurch]
```

### PostgreSQL Translation

```sql
DATE(investor_purchase_date) - DATE(application_date) as app_invpurch_days
```

**Note**: This is a **turn time metric**, not a pull-through percentage. See `concepts/turn-time.md` for details.

---

## Started to Investor Purchase (Started-InvPurch)

**Purpose**: Pull-through calculation for TPO channels using Started Date instead of Application Date  
**Channel**: Wholesale, Correspondent (TPO channels)

### Qlik Expression

Similar to Scorecard PullThrough but uses:
- `DateType*={'Started'}` instead of `DateType*={'Application'}`
- `[Started Date]` instead of `[Application Date]`

### Business Logic

**Multi-Channel Pull Through**:
- **Retail**: Uses Application Date as start point
- **Wholesale/Correspondent**: Uses Started Date as start point

**Reason**: TPO channels have a "Started" milestone that represents when the loan entered the lender's system, which is more appropriate than the broker's application date.

### PostgreSQL Translation

```sql
CREATE OR REPLACE FUNCTION calculate_started_invpurch_pullthrough(
    p_channel_group VARCHAR,
    p_aggregation_level VARCHAR DEFAULT 'loan_officer',
    p_max_date DATE DEFAULT CURRENT_DATE
)
RETURNS DECIMAL(10,4) AS $$
DECLARE
    v_result DECIMAL(10,4);
BEGIN
    WITH pullthrough_by_actor AS (
        SELECT 
            CASE 
                WHEN p_aggregation_level = 'loan_officer' THEN loan_officer_id
                WHEN p_aggregation_level = 'branch' THEN branch
                ELSE NULL
            END as actor_id,
            COUNT(CASE 
                WHEN pull_through_originated_flag = 'Yes' 
                THEN loan_number 
            END)::DECIMAL as numerator,
            COUNT(loan_number)::DECIMAL as denominator
        FROM loans l
        WHERE 
            -- Use Started Date for TPO channels
            started_date >= DATE_TRUNC('month', p_max_date) - INTERVAL '13 months'
            AND started_date <= p_max_date
            AND active_loan_flag = 'No'
            AND consolidated_channels = p_channel_group
            AND consolidated_channels IN ('Wholesale', 'Correspondent')  -- TPO channels only
        GROUP BY actor_id
        HAVING COUNT(loan_number) > 0
    )
    SELECT AVG(
        CASE 
            WHEN denominator > 0 THEN (numerator / denominator) * 100
            ELSE NULL
        END
    )
    INTO v_result
    FROM pullthrough_by_actor;
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql;
```

---

## Pull Through Variables

### vScorecardPullThroughAvg

**Purpose**: Average pull-through percentage across all actors  
**Calculation**: Average of individual actor pull-through percentages

**Qlik Definition**:
```qvs
=Avg({$<[Scorecard PullThrough] *= {">0"}, $(vScorecardMissingLevel),$(vScorecardIgnoreLevel)>}
    Aggr(
        [Scorecard PullThrough]
        ,$(vScorecardAggrLevel)))
```

**PostgreSQL Translation**:
```sql
SELECT AVG(scorecard_pullthrough)
FROM (
    SELECT 
        calculate_scorecard_pullthrough('Retail', '*', 'loan_officer', CURRENT_DATE) as scorecard_pullthrough
    FROM loans
    WHERE scorecard_pullthrough > 0
) sub;
```

---

### vScorecardPullThroughAvg_2Months

**Purpose**: Average short-term pull-through percentage (2 months)  
**Calculation**: Average of individual actor 2-month pull-through percentages

**Qlik Definition**:
```qvs
=Avg({$<[Scorecard PullThrough_2Months] *= {">0"}, $(vScorecardMissingLevel),$(vScorecardIgnoreLevel)>}
    Aggr(
        [Scorecard PullThrough_2Months]
        ,$(vScorecardAggrLevel)))
```

**PostgreSQL Translation**:
```sql
SELECT AVG(scorecard_pullthrough_2months)
FROM (
    SELECT 
        calculate_scorecard_pullthrough_2months('Retail', 60, 'loan_officer', CURRENT_DATE) as scorecard_pullthrough_2months
    FROM loans
    WHERE scorecard_pullthrough_2months > 0
) sub;
```

---

## Current Production Check Logic

**Purpose**: Filter pull-through calculations based on current production status  
**Variable**: `$(vCurrentProduction)`

**Values**:
- `'Yes'`: Only show pull-through for actors with current production = 0 (no active loans)
- `'No'`: Only show pull-through for actors with current production > 0 (has active loans)
- `'*'` (default): Show pull-through for all actors

**PostgreSQL Translation**:
```sql
-- Current Production Check
CASE 
    WHEN p_current_production = 'Yes' THEN
        -- Only actors with no current production
        AND NOT EXISTS (
            SELECT 1 FROM loans l2 
            WHERE l2.loan_officer_id = l.loan_officer_id 
            AND l2.active_loan_flag = 'Yes'
        )
    WHEN p_current_production = 'No' THEN
        -- Only actors with current production
        AND EXISTS (
            SELECT 1 FROM loans l2 
            WHERE l2.loan_officer_id = l.loan_officer_id 
            AND l2.active_loan_flag = 'Yes'
        )
    ELSE
        -- All actors
        TRUE
END
```

---

## Source Fields

Pull-through calculations use fields from the [Coheus Data Dictionary](../../data-dictionary/CoheusDataDictionary.xml):

**Key Fields**:
- `Application Date` (Encompass: `Fields.3142`) - Start point for Retail channels
- `Started Date` (Encompass: derived field) - Start point for TPO channels
- `Investor Purchase Date` (Encompass: `Fields.MS.INV`) - Target milestone
- `Pull Through Originated Flag` (derived field) - Indicates loan reached Investor Purchase
- `Active Loan Flag` (derived field) - Filters to closed/inactive loans
- `Consolidated Channels` (derived field) - Channel grouping (Retail, Wholesale, Correspondent)
- `Loan Officer` (Encompass: `Fields.LoanTeamMember.UserID.Loan Officer`) - Aggregation level
- `Branch` (Encompass: `Fields.ORGID`) - Aggregation level

**See**: `patterns/source-fields.md` for complete data dictionary integration guide.

---

## Business Rules

### Pull-Through Calculation Rules

1. **Only Closed Loans**: Pull-through only includes loans with `[Active Loan Flag]={No}`
2. **Channel-Specific Start Dates**: 
   - Retail: Application Date
   - TPO: Started Date
3. **Aggregation**: Calculate per actor (Loan Officer, Branch), then average
4. **Time Periods**:
   - Standard: Rolling 13 months
   - Short-term: Rolling 2 months (configurable)
5. **Current Production Filter**: Can filter by whether actor has current active loans

### Pull-Through vs. Turn Time

- **Pull-Through**: Percentage metric (what % reached milestone)
- **Turn Time**: Days metric (how long did it take)

**Example**:
- **App-InvPurch Turn Time**: 45 days (average time from Application to Investor Purchase)
- **App-InvPurch Pull-Through**: 75% (75% of applications reached Investor Purchase)

---

## Migration Notes

- **Aggregation Logic**: PostgreSQL requires explicit GROUP BY and window functions instead of Qlik's Aggr()
- **Set Analysis**: Translate Qlik set analysis filters to SQL WHERE clauses
- **Total Modifier**: `Total<dimension>` in Qlik becomes `GROUPING SETS` or separate aggregation in PostgreSQL
- **Variable Expansion**: Replace `$(vVariable)` with function parameters or session variables
- **Performance**: Consider materialized views for frequently accessed pull-through metrics

---

## See Also

- **Turn Time**: `concepts/turn-time.md` - Turn time metrics (days)
- **Scorecard Logic**: `derived/tts-scorecard.md` - Scorecard calculations
- **Aggregation Patterns**: `patterns/aggregation-patterns.md` - Aggr() translation
- **PostgreSQL Mapping**: `migration/postgresql-mapping.md` - General migration patterns
