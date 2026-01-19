# Logic Dictionary Master Index

This is the master index of all business logic definitions extracted from Qlik applications for migration to PostgreSQL + backend services + AI integration.

---

## Table of Contents

1. [Core Logic](#core-logic)
2. [App-Specific Logic](#app-specific-logic)
3. [Expression Extraction](#expression-extraction)
4. [Migration Resources](#migration-resources)

---

## Core Logic

### Transform.qvs Logic
**File**: `docs/logic-dictionary/core/transform-logic.md`

**Categories**:
- **Date Flags**: MTD, YTD, Rolling periods, All Time flags
- **Turn Time Calculations**: Milestone-to-milestone day calculations
- **Status Flags**: Funded, Sold, Active, Locked, Approved, etc.
- **Channel Flags**: Retail, TPO, Correspondent
- **Revenue Calculations**: Origination, Secondary, Total, Buy/Sell prices
- **Complexity Scores**: Loan complexity aggregation and components
- **Year/Month Fields**: Date component extractions
- **Multi-Channel Logic**: Channel-specific date selection
- **Validation Flags**: Out of range validations

**Key Fields**:
- `[Application All Time]`, `[Funding All Time]`
- `[App-Close]`, `[App-Fund]`, `[App-InvPurch]`, `[Fund-InvPurch]`
- `[Funded Flag]`, `[Sold Flag]`, `[Active Loan Flag]`
- `[Retail Flag]`, `[TPO Flag]`, `[Correspondent Channel Flag]`
- `[Origination Revenue]`, `[Secondary Revenue]`, `[Total Revenue]`
- `[Loan Complexity Score]` and components
- `[Multi-Channel App/Start Date]`

---

### Calendar Logic
**File**: `docs/logic-dictionary/core/calendar-logic.md`

**Categories**:
- **CalendarFromField Subroutine**: Reusable calendar generation
- **DateLink Table**: Fact-date linking structure
- **Date Flags**: MTD, YTD, Rolling periods, Today/Yesterday/Last Week
- **Year/Month Fields**: YearMonth, YearQuarter, Week fields
- **Variable Lists**: YearMonthList, YearList, DateTypeList

**Key Components**:
- `CalendarFromField()` subroutine
- `DateLink` table with `DateType` field
- `CommonCalendar` table
- Rolling period flags (13-month, 4-month, 2-month, etc.)
- Period-to-date flags (MTD, QTD, YTD)
- Day/week flags (Today, Yesterday, Last Week)

---

### Variables
**File**: `docs/logic-dictionary/core/variables.md`

**Categories**:
- **Date/Time Variables**: vMaxDate, vCurrentDate
- **Channel/TPO Variables**: vCorrespondent, vChannel, vTPOCheck
- **Date Toggle Variables**: vDateToggle1, vHighPerformerDateToggle
- **Year/Month Lists**: vYearMonthList, vYearList
- **Revenue Variables**: Revenue flags and calculations
- **Scorecard Variables**: Aggregation levels and filters
- **App Configuration**: vAppName, vXMLName
- **UI Variables**: Sheet dimensions, scaling factors
- **Holiday Variables**: vHolidays for NetWorkDays

**Key Variables**:
- `vDateToggle1`: Primary date type (Funding/Closing/Application)
- `vHighPerformerDateToggle`: Date period selection
- `vCorrespondent`: Channel filter
- `vScorecardAggrLevel`: Scorecard grouping level
- `vHolidays`: Holiday list for business days

---

## App-Specific Logic

### Sales App
**File**: `docs/logic-dictionary/apps/sales-app-logic.md`

**Key Additions**:
- **Active Aging Calculations**: Active Aging Days, Active Aging Range
- **Lock Expiration Logic**: Detailed lock expiration ranges and flags
- **TPO-Specific**: Registration Date flags (TPO only)
- **Revenue Field Extraction**: Dynamic revenue field parsing

**Key Fields**:
- `[Active Aging Days]`, `[Active Aging Range]`
- `[Lock Expire Days Range (Main)]`, `[Lock Expire 10 Days Flag]`
- `[Registration Date Rolling 13 Month Flag]` (TPO)

---

### DataPilot App
**File**: `docs/logic-dictionary/apps/datapilot-app-logic.md`

**Key Additions**:
- **Stratification Fields**: Date Year_Strat fields with 'Date Missing'
- **Range Validations**: FICO, DTI, LTV, Interest Rate ranges
- **Global Ranges**: Combined range validation
- **Loan Amount Stratification**: Loan amount buckets

**Key Fields**:
- `[Application Year_Strat]`, `[Closing Year_Strat]`, `[Funding Year_Strat]`
- `[FICO Ranges]`, `[DTI Ranges]`, `[LTV Ranges]`, `[Interest Rate Ranges]`
- `[Global Ranges]`
- `[RESPA App Status]`, `[Loan Amount Populated]`

---

### Performance App
**File**: `docs/logic-dictionary/apps/performance-app-logic.md` (To be created)

**Expected Additions**:
- TTS (Time to Sale) specific logic
- Staffing variables
- TTS calendar periods
- Performance-specific calculations

---

### Operations App
**File**: `docs/logic-dictionary/apps/operations-app-logic.md` (To be created)

**Expected Additions**:
- Turn time report logic
- Milestone date calculations
- Operations-specific fields

---

### Contribution to Profit App
**File**: `docs/logic-dictionary/apps/contribution-to-profit-app-logic.md` (To be created)

**Expected Additions**:
- Profit-specific calculations
- Contribution margin logic
- Profitability metrics

---

## Expression Extraction

### QSDA Export Strategy
**File**: `docs/logic-dictionary/apps/qvf-expressions.md`

**Process**:
1. Parse Expressions.csv for all measures
2. Parse Variables.csv for variable definitions
3. Parse Dimensions.csv for calculated dimensions
4. Cross-reference with script logic
5. Document missing logic

**Key Files**:
- `Expressions.csv`: All measure definitions
- `Variables.csv`: Variable definitions
- `Dimensions.csv`: Calculated dimensions

---

## Migration Resources

### PostgreSQL Mapping
**File**: `docs/logic-dictionary/migration/postgresql-mapping.md` (To be created)

**Will Include**:
- Qlik data types → PostgreSQL data types
- Qlik functions → PostgreSQL/SQL equivalents
- Set analysis → SQL WHERE clauses
- Qlik variables → PostgreSQL functions/config tables

---

### Backend Architecture
**File**: `docs/logic-dictionary/migration/backend-architecture.md` (To be created)

**Will Include**:
- Logic for database (views/functions)
- Logic for application layer
- Logic for AI/ML integration
- Performance considerations

---

## Logic Categories Summary

### Date Logic
- Date flags (MTD, YTD, Rolling periods)
- Calendar generation
- DateLink table structure
- Period-to-date calculations

### Turn Time
- Milestone-to-milestone calculations
- Business days vs calendar days
- Active aging calculations
- Warehouse line duration

### Pull Through
- Application to Investor Purchase
- Channel-specific start dates
- Rolling period pull through
- Scorecard pull through averages

### Revenue
- Origination revenue
- Secondary revenue
- Buy/Sell price conversions
- Basis points calculations
- Custom revenue formulas

### Complexity
- Loan complexity score
- Component complexity scores
- Risk factor aggregation

### Flags
- Status flags (Funded, Sold, Active, etc.)
- Channel flags (Retail, TPO, Correspondent)
- Validation flags (Out of Range)
- Date flags (All Time, Rolling periods)

### Stratification
- Year stratification (with 'Date Missing')
- Range categorizations
- Loan amount buckets
- Aging ranges

### Variables
- Date/Time variables
- Channel/TPO variables
- Date toggle variables
- Scorecard variables
- Configuration variables

---

## Quick Reference

### Most Common Expressions

**Units Count**:
```qvs
Count({$<[$(vDateToggle1) $(vHighPerformerDateToggle)]={Yes},[Correspondent Channel Flag]={'$(vCorrespondent)'},Channel*={"$(vChannel)"}>}[Loan Number])
```

**Pull Through**:
```qvs
Count({<[$(=$(vTPODateToggle)) Date Rolling 13 Month Flag]={Yes},[Active Loan Flag]={'No'}>}[Investor Purchase Date]) 
/ Count({<[$(=$(vTPODateToggle)) Date Rolling 13 Month Flag]={Yes},[Active Loan Flag]={'No'}>}[$(=$(vTPODateToggle)) Date])
```

**Revenue**:
```qvs
RangeSum([Origination Revenue], [Secondary Revenue])
```

**Turn Time**:
```qvs
Date(Floor([Funding Date]))-Date(Floor([Application Date])) as [App-Fund]
```

---

## File Structure

```
docs/logic-dictionary/
├── INDEX.md (this file)
├── core/
│   ├── transform-logic.md
│   ├── calendar-logic.md
│   └── variables.md
├── apps/
│   ├── sales-app-logic.md
│   ├── datapilot-app-logic.md
│   ├── performance-app-logic.md (pending)
│   ├── operations-app-logic.md (pending)
│   ├── contribution-to-profit-app-logic.md (pending)
│   └── qvf-expressions.md
├── migration/
│   ├── postgresql-mapping.md (pending)
│   └── backend-architecture.md (pending)
├── validation/
│   └── missing-logic.md (pending)
└── schema/
    └── logic-definition-schema.json
```

---

## Completion Status

### Completed
- ✅ Core Transform.qvs logic (date flags, turn times, revenue, complexity, flags)
- ✅ Calendar logic (CalendarFromField, DateLink, CommonCalendar)
- ✅ Variables documentation (key variables and patterns)
- ✅ Sales app-specific logic
- ✅ DataPilot app-specific logic
- ✅ Performance app-specific logic (summary)
- ✅ Operations app-specific logic (summary)
- ✅ Contribution to Profit app-specific logic
- ✅ QSDA extraction strategy
- ✅ PostgreSQL mapping guide
- ✅ Backend architecture guide
- ✅ Master index
- ✅ Validation report framework

### Pending
- ⏳ QSDA CSV parsing (Expressions.csv, Variables.csv, Dimensions.csv for all apps)
- ⏳ Function definitions documentation (fRolling13MonthFlag, NetWorkDays, etc.)
- ⏳ Mapping tables documentation (LoanPurposeMap, etc.)
- ⏳ Complete QVF expression extraction and cross-reference

## Notes

- Core logic (Transform.qvs, Calendar, Variables) is documented
- App-specific logic summaries are complete
- QSDA export strategy is documented - ready for CSV parsing
- Migration guides are complete
- Validation report framework is complete - ready for QSDA analysis

---

## Next Steps

1. Complete app-specific logic extraction for remaining apps
2. Parse QSDA exports for all apps
3. Create PostgreSQL mapping guide
4. Create backend architecture guide
5. Cross-reference and validate completeness
6. Generate missing logic report
