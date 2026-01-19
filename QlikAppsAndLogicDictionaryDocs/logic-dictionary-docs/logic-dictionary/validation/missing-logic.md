# Missing Logic Validation Report

This document tracks logic found in Qlik apps that may not be documented in scripts, and identifies gaps in the logic dictionary.

---

## Validation Process

### Step 1: Script vs App Comparison
Compare logic found in:
- Script files (.qvs)
- QSDA exports (Expressions.csv, Variables.csv, Dimensions.csv)

### Step 2: Cross-Reference Check
- Verify all referenced fields are documented
- Check for duplicate logic definitions
- Identify inconsistencies between apps

### Step 3: Missing Logic Identification
- Document logic found in apps but not scripts
- Document script logic not used in apps
- Track undocumented expressions

---

## Known Gaps

### 1. QSDA Export Analysis Pending
**Status**: Not yet completed  
**Action Required**: Parse QSDA CSV exports for all apps to extract:
- Expressions from Expressions.csv
- Variables from Variables.csv
- Calculated dimensions from Dimensions.csv

**Expected Findings**:
- App-specific expressions not in scripts
- Complex variable expressions
- Visualization-specific calculations

---

### 2. Function Definitions
**Status**: Partially documented  
**Action Required**: Document all Qlik function definitions:
- `fRolling13MonthFlag()`
- `fRolling12MonthFlag()`
- `fTodayFlag()`, `fYesterdayFlag()`, `fLastWeekFlag()`
- `fMonth()`, `fYear()`
- `fYearMonth()`
- `InMonthToDate()`, `InYearToDate()`, `InMonth()`, `InYear()`, `InWeek()`
- `NetWorkDays()`

**Location**: Functions.qvs or inline definitions

---

### 3. Mapping Tables
**Status**: Partially documented  
**Action Required**: Document all mapping tables:
- LoanPurposeMap
- LoanTypeMap
- LoanPurposeGroupMap
- LoanTypeGroupMap
- InterestRateRangeSortMap
- MilestoneSort maps
- FPCODEMap
- FNMALoanLimitMap

**Location**: Mapping.qvs files

---

### 4. Revenue Configuration Logic
**Status**: Partially documented  
**Action Required**: Document:
- Revenue formula parsing logic
- Custom revenue formula evaluation
- Revenue field extraction from XML
- Revenue calculation variations (Default, Exec, Ops, Sales, Contribution)

**Location**: REVENUE.qvs, Transform.qvs revenue sections

---

### 5. TTS Scorecard Calculations
**Status**: Partially documented  
**Action Required**: Document:
- TTS scorecard metric calculations
- Weighted scorecard formulas
- Scorecard aggregation logic
- Scorecard normalization

**Location**: TTS + Staffing Variables.qvs, app expressions

---

### 6. Pull Through Calculations
**Status**: Partially documented  
**Action Required**: Document all pull through variations:
- Application to Investor Purchase
- Started to Investor Purchase (TPO)
- Rolling period pull through
- Scorecard pull through
- Short-term pull through (2 months)

**Location**: Variables.qvs, app expressions

---

### 7. Range Definitions
**Status**: Partially documented  
**Action Required**: Document:
- FICO range definitions
- DTI range definitions
- LTV range definitions
- Interest rate range definitions
- Loan amount range definitions
- Configurable range min/max values

**Location**: Ranges.qvs, Script Additions.qvs

---

### 8. Custom Report Fields
**Status**: Not documented  
**Action Required**: Document:
- Custom field definitions from configuration
- Ad hoc field definitions
- Field swap logic
- Custom field groupings

**Location**: Custom Report Fields.qvs, Data Dictionary Addons.qvs

---

### 9. ODAG Logic
**Status**: Not documented  
**Action Required**: Document:
- ODAG binding logic
- ODAG loan data extraction
- ODAG filtering logic

**Location**: ODAG Binding.qvs, ODAG LoanData.qvs

---

### 10. Section Access Logic
**Status**: Not documented  
**Action Required**: Document:
- Section access level definitions
- User/group access mappings
- Data filtering by access level

**Location**: SectionAccess.qvs

---

## Validation Checklist

### Core Logic
- [x] Transform.qvs date flags documented
- [x] Transform.qvs turn times documented
- [x] Transform.qvs revenue documented
- [x] Transform.qvs complexity documented
- [x] Transform.qvs flags documented
- [ ] Transform.qvs all fields documented (partial)

### Calendar Logic
- [x] CalendarFromField subroutine documented
- [x] DateLink table documented
- [x] Common calendar flags documented
- [ ] All calendar function implementations documented (partial)

### Variables
- [x] Key variables documented
- [ ] All variables documented (partial - many variables exist)

### App-Specific Logic
- [x] Sales app key logic documented
- [x] DataPilot app key logic documented
- [x] Performance app TTS logic documented (summary)
- [x] Operations app turn time logic documented (summary)
- [x] Contribution to Profit app logic documented (summary)
- [ ] All app-specific expressions documented (pending QSDA analysis)

### QSDA Exports
- [x] Extraction strategy documented
- [ ] Expressions.csv parsed for all apps (pending)
- [ ] Variables.csv parsed for all apps (pending)
- [ ] Dimensions.csv parsed for all apps (pending)
- [ ] Cross-reference completed (pending)

### Migration Resources
- [x] PostgreSQL mapping guide created
- [x] Backend architecture guide created
- [ ] Function implementations documented (partial)
- [ ] Performance optimization guide (pending)

---

## Next Steps

1. **Parse QSDA Exports**: Extract all expressions, variables, and dimensions from QSDA CSV files
2. **Document Functions**: Create comprehensive function definition document
3. **Document Mappings**: Document all mapping tables and their logic
4. **Complete App Logic**: Finish documenting all app-specific logic
5. **Cross-Reference**: Compare script logic vs app expressions
6. **Create Function Library**: Document PostgreSQL function equivalents
7. **Performance Guide**: Create performance optimization guide

---

## Notes

- Core logic is well-documented
- App-specific logic summaries are complete
- QSDA export parsing is the next major step
- Function definitions need comprehensive documentation
- Mapping tables need documentation

---

## Estimated Completion

- **Core Logic**: 90% complete
- **App-Specific Logic**: 70% complete (summaries done, details pending QSDA)
- **QSDA Extraction**: 0% complete (strategy documented, parsing pending)
- **Migration Guides**: 80% complete
- **Validation**: 50% complete
