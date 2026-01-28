# Performance App Logic Dictionary

**Source Files**: `Performance/tvd-coheus-performance-qlik/Scripts/*.qvs`

This document catalogs Performance app-specific logic, particularly TTS (Time to Sale) and staffing-related calculations.

---

## TTS (Time to Sale) Variables

### TTS Variable Weights
**Category**: TTS Variables  
**Definition**: Weighted variables for TTS scorecard calculations, loaded from configuration XML  
**Qlik Expression**:
```qvs
// From TTS + Staffing Variables.qvs
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
```
**SQL Equivalent**:
```sql
-- Configuration table
CREATE TABLE tts_variable_weights (
    variable_name VARCHAR(100),
    weight NUMERIC,
    scorecard_type VARCHAR(50) -- 'Sales' or 'Operations'
);

-- Load from XML or config file
```
**Dependencies**: Configuration XML  
**Used In**: Performance app  
**Business Rules**: Weights for TTS scorecard metrics  
**Migration Notes**: Store in configuration table

---

### Units Comparison Variables
**Category**: TTS Variables  
**Definition**: Units comparison values for staffing model personas  
**Qlik Expression**:
```qvs
UnitsComparisonVariables:
LOAD
    If(WildMatch(Name, '*Processor'), 'Processor', Name) AS Actor,
    Value AS Units
From_Field(MockConfig,xml)
(XmlSimple, table is [Setup/StaffingModel/Personas/Persona]);
```
**SQL Equivalent**:
```sql
CREATE TABLE staffing_persona_units (
    actor VARCHAR(100),
    units NUMERIC
);
```
**Dependencies**: Configuration XML  
**Used In**: Performance app  
**Business Rules**: Units per persona for staffing calculations  
**Migration Notes**: Configuration table

---

## TTS Calendar Periods

### Calendar-Periods for TTS
**Category**: Date Flags  
**Definition**: TTS-specific calendar period definitions  
**Source File**: `Calendar-Periods for TTS.qvs`

**Key Periods**:
- TTS-specific rolling periods
- TTS-specific period-to-date flags
- TTS-specific year/month groupings

**Migration Notes**: Similar to standard calendar logic but TTS-specific periods

---

## TTS Scorecard Calculations

**See**: `derived/tts-scorecard.md` for complete TTS scorecard documentation including:
- Scorecard weight configuration
- Weighted scorecard formulas
- Scorecard metric calculations
- Scorecard aggregation logic
- Scorecard normalization methods
- Calendar periods for TTS

## Pull Through Calculations

**See**: `derived/pull-through-calculations.md` for pull-through metrics used in scorecards:
- Scorecard PullThrough (rolling 13 months)
- Scorecard PullThrough_2Months (short-term)
- TVI Pull Through Rating

## Revenue Calculations

**See**: `derived/revenue-calculations.md` for Revenue_Exec calculations:
- Revenue_Exec formula
- Margin (BPS)_Exec
- Revenue configuration logic

## Expression Usage

**See**: `validation/expression-categories.md` for expression categorization and:
- `validation/qsda-cross-reference.md` for QSDA analysis findings
- TTS scorecard expressions (unique to Performance app)

---

## Notes

- Performance app focuses on TTS (Time to Sale) metrics
- Uses weighted variables for scorecard calculations
- Includes staffing model calculations
- TTS-specific calendar periods for analysis

## See Also

- **TTS Scorecard**: `derived/tts-scorecard.md` - Complete TTS scorecard documentation
- **Pull Through**: `derived/pull-through-calculations.md` - Scorecard pull-through metrics
- **Revenue**: `derived/revenue-calculations.md` - Revenue_Exec calculations
- **Expression Categories**: `validation/expression-categories.md` - Expression patterns
- **QSDA Cross-Reference**: `validation/qsda-cross-reference.md` - App-specific findings
