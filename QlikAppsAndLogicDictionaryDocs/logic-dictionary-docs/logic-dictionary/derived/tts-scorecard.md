# TTS (Time to Sale) Scorecard Calculations

**Source Files**: 
- `tvd-coheus-performance-qlik/Scripts/TTS + Staffing Variables.qvs`
- `tvd-coheus-performance-qlik/Scripts/Calendar-Periods for TTS.qvs`
- Performance app expressions

**TTS (Time to Sale)** scorecards provide weighted performance metrics for sales and operations staff, measuring efficiency and productivity across multiple dimensions.

---

## Overview

**Purpose**: Calculate weighted performance scores for actors (Loan Officers, Processors, Underwriters, Closers) based on multiple metrics

**Scorecard Types**:
1. **Sales Scorecard** - Weighted metrics for sales staff
2. **Operations Scorecard** - Weighted metrics for operations staff

**Metrics Included**:
- Pull-through percentage
- Turn time metrics
- Revenue metrics
- Volume metrics
- Other performance indicators

---

## Scorecard Weight Configuration

**Source**: XML configuration (`Setup/ScoreCards/Sales/Weight` and `Setup/ScoreCards/Operations/Weight`)

**Configuration Structure**:
```xml
<ScoreCards>
    <Sales>
        <Weight>
            <Name>PullThrough</Name>
            <Value>0.30</Value>
        </Weight>
        <Weight>
            <Name>Revenue</Name>
            <Value>0.25</Value>
        </Weight>
        <!-- Additional weights -->
    </Sales>
    <Operations>
        <Weight>
            <Name>TurnTime</Name>
            <Value>0.40</Value>
        </Weight>
        <!-- Additional weights -->
    </Operations>
</ScoreCards>
```

### Weight Loading Logic

**Qlik Script**:
```qvs
TTSVariables:
LOAD
    'Sales'&Name as Variable,
    Value as Weight
From_Field(MockConfig,xml)
(XmlSimple, table is [Setup/ScoreCards/Sales/Weight]);

Concatenate(TTSVariables)
Load
    'Ops'&Name as Variable,
    Value as Weight
From_Field(MockConfig,xml)
(XmlSimple, table is [Setup/ScoreCards/Operations/Weight]);

// Set weight variables dynamically
FOR EACH vScoreCardWeight in FieldValueList('Variable')
    LET $(vScoreCardWeight)Weight = Peek('Weight', $(vPeekVal), 'TTSVariables');
    LET vPeekVal = $(vPeekVal) + 1;
NEXT vScoreCardWeight;
```

**Result Variables**:
- `SalesPullThroughWeight` - Weight for sales pull-through metric
- `SalesRevenueWeight` - Weight for sales revenue metric
- `OpsTurnTimeWeight` - Weight for operations turn time metric
- `OpsPullThroughWeight` - Weight for operations pull-through metric
- (Additional weights based on configuration)

**PostgreSQL Translation**:
```sql
-- Scorecard weight configuration table
CREATE TABLE scorecard_weight_config (
    id SERIAL PRIMARY KEY,
    client_id VARCHAR(100),
    scorecard_type VARCHAR(50),  -- 'Sales' or 'Operations'
    metric_name VARCHAR(100),
    weight DECIMAL(5,4) NOT NULL CHECK (weight >= 0 AND weight <= 1),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(client_id, scorecard_type, metric_name)
);

-- Example weights
INSERT INTO scorecard_weight_config (client_id, scorecard_type, metric_name, weight) VALUES
(NULL, 'Sales', 'PullThrough', 0.30),
(NULL, 'Sales', 'Revenue', 0.25),
(NULL, 'Sales', 'Volume', 0.20),
(NULL, 'Sales', 'TurnTime', 0.25),
(NULL, 'Operations', 'TurnTime', 0.40),
(NULL, 'Operations', 'PullThrough', 0.30),
(NULL, 'Operations', 'Volume', 0.30);
```

---

## Scorecard Metric Calculations

### Normalized Metrics

**Purpose**: Normalize metrics to 0-100 scale for consistent weighting

**Common Normalization Approaches**:
1. **Percentile-based**: Rank-based normalization
2. **Min-Max**: `(value - min) / (max - min) * 100`
3. **Z-score**: Standard deviation-based normalization
4. **Percentage of average**: `(value / average) * 100`

### Sales Scorecard Metrics

**Pull-Through Score**:
```qvs
// Normalized pull-through percentage
([Scorecard PullThrough] / $(vScorecardPullThroughAvg)) * 100
```

**Revenue Score**:
```qvs
// Normalized revenue per loan
([Revenue_Sales] / $(vAvgRevenueSales)) * 100
```

**Volume Score**:
```qvs
// Normalized loan count
([Loan Count] / $(vAvgLoanCount)) * 100
```

**Turn Time Score**:
```qvs
// Inverse turn time (shorter is better)
(1 / [Avg Turn Time]) * $(vTurnTimeMultiplier)
```

### Operations Scorecard Metrics

**Turn Time Score**:
```qvs
// Normalized turn time (shorter is better)
((Max([Turn Time]) - [Turn Time]) / (Max([Turn Time]) - Min([Turn Time]))) * 100
```

**Pull-Through Score**:
```qvs
// Normalized pull-through percentage
([Scorecard PullThrough] / $(vScorecardPullThroughAvg)) * 100
```

**Volume Score**:
```qvs
// Normalized loan count
([Loan Count] / $(vAvgLoanCount)) * 100
```

---

## Weighted Scorecard Formula

**Formula**:
```
Scorecard Score = Σ(Metric Score × Weight)
```

**Qlik Expression**:
```qvs
// Sales Scorecard
($(SalesPullThroughWeight) * [PullThrough Score]) +
($(SalesRevenueWeight) * [Revenue Score]) +
($(SalesVolumeWeight) * [Volume Score]) +
($(SalesTurnTimeWeight) * [TurnTime Score])
as [Sales Scorecard Score]

// Operations Scorecard
($(OpsTurnTimeWeight) * [TurnTime Score]) +
($(OpsPullThroughWeight) * [PullThrough Score]) +
($(OpsVolumeWeight) * [Volume Score])
as [Operations Scorecard Score]
```

**PostgreSQL Translation**:
```sql
-- Calculate weighted scorecard score
CREATE OR REPLACE FUNCTION calculate_scorecard_score(
    p_client_id VARCHAR,
    p_scorecard_type VARCHAR,  -- 'Sales' or 'Operations'
    p_actor_type VARCHAR,  -- 'loan_officer', 'processor', 'underwriter', 'closer'
    p_actor_name VARCHAR,
    p_max_date DATE DEFAULT CURRENT_DATE
)
RETURNS DECIMAL(10,2) AS $$
DECLARE
    v_score DECIMAL(10,2) := 0;
    v_metric_score DECIMAL(10,2);
    v_weight DECIMAL(5,4);
    v_metric_name VARCHAR;
BEGIN
    -- Iterate through all weights for this scorecard type
    FOR v_metric_name, v_weight IN 
        SELECT metric_name, weight
        FROM scorecard_weight_config
        WHERE client_id = p_client_id
        AND scorecard_type = p_scorecard_type
        AND is_active = TRUE
    LOOP
        -- Calculate normalized metric score
        v_metric_score := calculate_metric_score(
            p_client_id,
            p_scorecard_type,
            v_metric_name,
            p_actor_type,
            p_actor_name,
            p_max_date
        );
        
        -- Add weighted score
        v_score := v_score + (v_metric_score * v_weight);
    END LOOP;
    
    RETURN v_score;
END;
$$ LANGUAGE plpgsql;

-- Helper function to calculate individual metric scores
CREATE OR REPLACE FUNCTION calculate_metric_score(
    p_client_id VARCHAR,
    p_scorecard_type VARCHAR,
    p_metric_name VARCHAR,
    p_actor_type VARCHAR,
    p_actor_name VARCHAR,
    p_max_date DATE
)
RETURNS DECIMAL(10,2) AS $$
DECLARE
    v_score DECIMAL(10,2);
    v_metric_value DECIMAL(10,2);
    v_avg_value DECIMAL(10,2);
BEGIN
    -- Get metric value for this actor
    CASE p_metric_name
        WHEN 'PullThrough' THEN
            SELECT calculate_scorecard_pullthrough(
                p_channel_group := '*',
                p_current_production := '*',
                p_aggregation_level := p_actor_type,
                p_max_date := p_max_date
            ) INTO v_metric_value
            WHERE actor_name = p_actor_name;
            
            -- Get average for normalization
            SELECT AVG(calculate_scorecard_pullthrough(
                p_channel_group := '*',
                p_current_production := '*',
                p_aggregation_level := p_actor_type,
                p_max_date := p_max_date
            )) INTO v_avg_value;
            
            -- Normalize (percentage of average)
            v_score := (v_metric_value / NULLIF(v_avg_value, 0)) * 100;
            
        WHEN 'Revenue' THEN
            -- Similar logic for revenue
            SELECT AVG(revenue_sales) INTO v_metric_value
            FROM loans
            WHERE actor_name = p_actor_name
            AND funding_date >= p_max_date - INTERVAL '13 months'
            AND funding_date <= p_max_date;
            
            SELECT AVG(revenue_sales) INTO v_avg_value
            FROM loans
            WHERE funding_date >= p_max_date - INTERVAL '13 months'
            AND funding_date <= p_max_date;
            
            v_score := (v_metric_value / NULLIF(v_avg_value, 0)) * 100;
            
        WHEN 'Volume' THEN
            -- Similar logic for volume
            SELECT COUNT(*) INTO v_metric_value
            FROM loans
            WHERE actor_name = p_actor_name
            AND funding_date >= p_max_date - INTERVAL '13 months'
            AND funding_date <= p_max_date;
            
            SELECT AVG(loan_count) INTO v_avg_value
            FROM (
                SELECT actor_name, COUNT(*) as loan_count
                FROM loans
                WHERE funding_date >= p_max_date - INTERVAL '13 months'
                AND funding_date <= p_max_date
                GROUP BY actor_name
            ) subquery;
            
            v_score := (v_metric_value / NULLIF(v_avg_value, 0)) * 100;
            
        WHEN 'TurnTime' THEN
            -- Turn time (shorter is better - inverse normalization)
            SELECT AVG(turn_time) INTO v_metric_value
            FROM loans
            WHERE actor_name = p_actor_name
            AND funding_date >= p_max_date - INTERVAL '13 months'
            AND funding_date <= p_max_date;
            
            SELECT MAX(turn_time), MIN(turn_time) INTO v_max, v_min
            FROM loans
            WHERE funding_date >= p_max_date - INTERVAL '13 months'
            AND funding_date <= p_max_date;
            
            -- Inverse normalization: shorter times get higher scores
            v_score := ((v_max - v_metric_value) / NULLIF(v_max - v_min, 0)) * 100;
            
        ELSE
            v_score := 0;
    END CASE;
    
    RETURN COALESCE(v_score, 0);
END;
$$ LANGUAGE plpgsql;
```

---

## Scorecard Aggregation

**Purpose**: Aggregate scorecard scores by actor and time period

### Aggregation Levels

**By Actor**:
- Loan Officer
- Processor
- Underwriter
- Closer
- Branch
- Channel

**By Time Period**:
- Rolling 13 months (standard)
- Rolling 2 months (short-term)
- Year to date
- Month to date
- Quarter to date

### Aggregation Logic

**Qlik Pattern**:
```qvs
// Aggregate by Loan Officer
Aggr(
    [Sales Scorecard Score],
    [Loan Officer]
)

// Aggregate by Branch
Aggr(
    [Sales Scorecard Score],
    [Branch]
)
```

**PostgreSQL Translation**:
```sql
-- Aggregate scorecard scores by actor
SELECT 
    loan_officer,
    AVG(scorecard_score) as avg_scorecard_score,
    COUNT(*) as loan_count
FROM (
    SELECT 
        loan_officer,
        calculate_scorecard_score(
            p_client_id := CURRENT_SETTING('app.client_id', TRUE),
            p_scorecard_type := 'Sales',
            p_actor_type := 'loan_officer',
            p_actor_name := loan_officer,
            p_max_date := CURRENT_DATE
        ) as scorecard_score
    FROM loans
    WHERE funding_date >= CURRENT_DATE - INTERVAL '13 months'
    GROUP BY loan_officer
) subquery
GROUP BY loan_officer
ORDER BY avg_scorecard_score DESC;
```

---

## Scorecard Normalization

**Purpose**: Ensure scores are comparable across different metrics and time periods

### Normalization Methods

**1. Percentage of Average**:
```sql
-- Normalize to percentage of average
(metric_value / AVG(metric_value)) * 100
```

**2. Min-Max Normalization**:
```sql
-- Normalize to 0-100 scale
((metric_value - MIN(metric_value)) / 
 (MAX(metric_value) - MIN(metric_value))) * 100
```

**3. Z-Score Normalization**:
```sql
-- Normalize using standard deviation
((metric_value - AVG(metric_value)) / 
 STDDEV(metric_value)) * 100 + 50  -- Center at 50
```

**4. Percentile Rank**:
```sql
-- Rank-based normalization
(PERCENT_RANK() OVER (ORDER BY metric_value)) * 100
```

---

## Calendar Periods for TTS

**Purpose**: Create calendar links for TTS-specific date fields

**Qlik Script**:
```qvs
LEFT JOIN([Coheus_Input])
LOAD DISTINCT
    [Sent To Underwriting],
    $(Calendar.Key([Sent To Underwriting])) AS %STUuid
RESIDENT [Coheus_Input];

LEFT JOIN([Coheus_Input])
LOAD DISTINCT
    [Sent To Closing],
    $(Calendar.Key([Sent To Closing])) AS %STCuid
RESIDENT [Coheus_Input];

LEFT JOIN([Coheus_Input])
LOAD DISTINCT
    [End Date to indicate Loan Closed/Funded],
    $(Calendar.Key([End Date to indicate Loan Closed/Funded])) AS %EDTCFuid
RESIDENT [Coheus_Input];

Call Calendar.Create('Processor','Coheus_Input', '%STUuid');
Call Calendar.Create('Underwriter','Coheus_Input', '%STCuid');
Call Calendar.Create('Closer','Coheus_Input', '%EDTCFuid');
```

**PostgreSQL Translation**:
```sql
-- Create date dimension links for TTS metrics
-- These would be handled via date dimension tables and JOINs
SELECT 
    l.*,
    d1.date_key as sent_to_uw_date_key,
    d2.date_key as sent_to_closing_date_key,
    d3.date_key as closed_funded_date_key
FROM loans l
LEFT JOIN date_dimension d1 ON d1.date = l.sent_to_underwriting_date
LEFT JOIN date_dimension d2 ON d2.date = l.sent_to_closing_date
LEFT JOIN date_dimension d3 ON d3.date = l.end_date_closed_funded;
```

---

## Staffing Units Configuration

**Purpose**: Define expected units per persona for staffing comparisons

**Source**: XML configuration (`Setup/StaffingModel/Personas/Persona`)

**Qlik Script**:
```qvs
UnitsComparisonVariables:
LOAD
    If(WildMatch(Name, '*Processor'), 'Processor', Name) AS Actor,
    Value AS Units
From_Field(MockConfig,xml)
(XmlSimple, table is [Setup/StaffingModel/Personas/Persona]);

FOR EACH vStaffingUnits in FieldValueList('Actor')
    LET $(vStaffingUnits)StaffingUnits = Peek('Units', $(vPeekVal), 'UnitsComparisonVariables');
    LET vPeekVal = $(vPeekVal) + 1;
NEXT vStaffingUnits;
```

**PostgreSQL Translation**:
```sql
-- Staffing units configuration table
CREATE TABLE staffing_units_config (
    id SERIAL PRIMARY KEY,
    client_id VARCHAR(100),
    actor_type VARCHAR(100),  -- 'Loan Officer', 'Processor', 'Underwriter', 'Closer'
    expected_units DECIMAL(10,2),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(client_id, actor_type)
);
```

---

## Business Rules

- **Weights must sum to 1.0** (or be normalized to sum to 1.0)
- **Metrics are normalized** to 0-100 scale before weighting
- **Scores are aggregated** by actor and time period
- **Rolling 13 months** is the standard time period for scorecards
- **Short-term scorecards** use rolling 2 months
- **Missing data** is handled via NULL checks and defaults

---

## Dependencies

- **Pull-through calculations** (see `derived/pull-through-calculations.md`)
- **Revenue calculations** (see `derived/revenue-calculations.md`)
- **Turn time metrics** (see `concepts/turn-time.md`)
- **Calendar functions** (see `core/functions.md`)
- **Scorecard weight configuration** (XML or database tables)

---

## Used In

- Performance app
- Staffing analysis
- Performance dashboards
- Actor performance comparisons

---

## Migration Notes

- **Weight configuration**: Store in database tables instead of XML
- **Metric calculations**: Implement as PostgreSQL functions
- **Normalization**: Use SQL window functions for percentile and z-score normalization
- **Aggregation**: Use GROUP BY and window functions for aggregation
- **Performance**: Index actor fields and date fields for fast scorecard calculations

---

## See Also

- **Pull-through calculations**: `derived/pull-through-calculations.md` - Scorecard PullThrough metric
- **Revenue calculations**: `derived/revenue-calculations.md` - Revenue metrics for scorecards
- **Turn time**: `concepts/turn-time.md` - Turn time metrics
- **Functions**: `core/functions.md` - Date functions used in scorecards
