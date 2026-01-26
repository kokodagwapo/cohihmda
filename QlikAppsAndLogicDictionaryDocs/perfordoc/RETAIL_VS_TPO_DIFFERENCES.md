# Performance Retail App vs Performance TPO App - Complete Differences

## Overview

This document outlines **all differences** between the Performance Retail app and Performance TPO app. These are two separate applications that share the same codebase but are configured differently to serve different channel types. This analysis reflects the **original app logic** before any dynamic channel/actor selection features were added.

---

## 1. Load Script Configuration

### 1.1 START HERE.qvs

**Performance Retail App:**
```qlik
SET vConsolidatedChannels = 'Retail';
```

**Performance TPO App:**
```qlik
SET vConsolidatedChannels = 'TPO';
```

**Location:** `Scripts/START HERE.qvs` (line 16)

**Impact:** This is the **primary configuration** that determines which app loads which data and uses which variables. This single line difference is what makes the two apps distinct.

---

## 2. Data Loading Differences

### 2.1 ODAG LoanData.qvs - Channel Filtering

**Performance Retail App:**
- Filters to: `Banked - Retail` and `Brokered` channels only
- WHERE clause: `WHERE WildMatch([Consolidated Channels], '*Retail*') > 0`
- Loads only Retail channel data
- Smaller data model (only Retail loans)

**Performance TPO App:**
- Filters to: `Banked - Wholesale` and `Correspondent` channels only
- WHERE clause: `WHERE WildMatch([Consolidated Channels], '*TPO*') > 0`
- Loads only TPO channel data
- Smaller data model (only TPO loans)

**Location:** `Scripts/ODAG LoanData current.qvs` (lines 189-193)

**Code Pattern:**
```qlik
NoConcatenate
[$(vWriteTableName).Temp]:
LOAD *
Resident [$(vWriteTableName)]
WHERE WildMatch([Consolidated Channels], '*$(vConsolidatedChannels)*') > 0;
```

**How It Works:**
- The `vConsolidatedChannels` variable is expanded at runtime
- Retail app: `'*Retail*'` matches channels containing "Retail" (e.g., "Banked - Retail", "Brokered")
- TPO app: `'*TPO*'` matches channels containing "TPO" (e.g., "Banked - Wholesale", "Correspondent")
- Only matching rows are kept in the data model

**Impact:** Each app loads approximately half the data compared to loading all channels, resulting in faster reloads and better performance.

---

## 3. Variable Configuration Differences

### 3.1 Variables.qvs - Primary Actor Variables

**Performance Retail App:**
```qlik
IF '$(vConsolidatedChannels)' = 'Retail' THEN

SET vScorecard='Branch';
SET vScorecardActor='Loan Officer';
SET vScorecardList='Branch|Investor';
SET vScorecardActorList='Loan Officer|Underwriter';

END IF
```

**Performance TPO App:**
```qlik
IF '$(vConsolidatedChannels)' = 'TPO' THEN

SET vScorecard='Account Executive';
SET vScorecardActor='Broker Lender Name';
SET vScorecardList='Account Executive|Investor';
SET vScorecardActorList='Broker Lender Name|Loan Officer|Underwriter';

END IF
```

**Location:** `Scripts/Variables.qvs` (lines 149-175)

**Key Differences:**

| Variable | Retail App | TPO App |
|----------|-----------|---------|
| `vScorecard` | `'Branch'` | `'Account Executive'` |
| `vScorecardActor` | `'Loan Officer'` | `'Broker Lender Name'` |
| `vScorecardList` | `'Branch\|Investor'` | `'Account Executive\|Investor'` |
| `vScorecardActorList` | `'Loan Officer\|Underwriter'` | `'Broker Lender Name\|Loan Officer\|Underwriter'` |

**What These Variables Control:**
- `vScorecard`: Organization-level actor field used in charts (Branch vs Account Executive)
- `vScorecardActor`: Individual-level actor field used in charts (Loan Officer vs Broker Lender Name)
- `vScorecardList`: Available organization actors for dropdowns/filters
- `vScorecardActorList`: Available individual actors for dropdowns/filters

**Impact:** These variables determine which fields are used as dimensions in charts throughout the app. Charts automatically reference the correct actor fields based on these variables.

---

### 3.2 Channel Group Variables

**Performance Retail App:**
```qlik
SET vChannel='Retail';
SET vChannelGroup='Retail';
```

**Performance TPO App:**
```qlik
SET vChannel='TPO';
SET vChannelGroup='TPO';
```

**Location:** `Scripts/Variables.qvs` (lines 177-179)

**How They're Set:**
```qlik
SET vChannel='$(vConsolidatedChannels)';
SET vChannelGroup='$(vConsolidatedChannels)';
```

**Usage in Charts:**
- Used in set analysis expressions to filter data by channel type
- Example: `[Consolidated Channels]={'$(vChannelGroup)'}`
- Ensures charts only show data for the app's channel type

**Impact:** Charts automatically filter to the correct channel type without needing user selection.

---

### 3.3 Application Name Variable

**Performance Retail App:**
```qlik
LET vAppName=SubField(DocumentTitle(),'_',2) & chr(32) & 'Retail';
// Example: "Performance Retail"
```

**Performance TPO App:**
```qlik
LET vAppName=SubField(DocumentTitle(),'_',2) & chr(32) & 'TPO';
// Example: "Performance TPO"
```

**Location:** `Scripts/Variables.qvs` (line 103)

**How It's Set:**
```qlik
LET vAppName=SubField(DocumentTitle(),'_',2) & chr(32) & '$(vConsolidatedChannels)';
```

**Impact:** Appears in the application title/header, helping users identify which app they're using. The app name will show "Performance Retail" or "Performance TPO" accordingly.

---

## 4. Data Model Differences

### 4.1 Consolidated Channels Loaded

**Performance Retail App:**
- `Banked - Retail`
- `Brokered`
- **Total:** 2 channel types
- **Excludes:** Banked - Wholesale, Correspondent

**Performance TPO App:**
- `Banked - Wholesale`
- `Correspondent`
- **Total:** 2 channel types
- **Excludes:** Banked - Retail, Brokered

**Note:** The actual channel names may vary slightly by client, but the filtering logic uses `WildMatch` to match patterns containing "Retail" or "TPO".

**Impact:** Each app has a focused data model with only relevant channel data, improving performance and clarity.

---

### 4.2 Actor Fields Available

**Performance Retail App:**
- **Organization Level:** `Branch` (primary), `Investor`
- **Individual Level:** `Loan Officer` (primary), `Underwriter`
- **Fields Used:** 
  - `[Branch]` - dimension field
  - `[Loan Officer]` - dimension field
  - `[Branch_Production]` - production flag field
  - `[Loan Officer_Production]` - production flag field

**Performance TPO App:**
- **Organization Level:** `Account Executive` (primary), `Investor`
- **Individual Level:** `Broker Lender Name` (primary), `Loan Officer`, `Underwriter`
- **Fields Used:**
  - `[Account Executive]` - dimension field
  - `[Broker Lender Name]` - dimension field
  - `[Account Executive_Production]` - production flag field
  - `[Broker Lender Name_Production]` - production flag field

**Note:** TPO app includes `Loan Officer` in the actor list, but `Broker Lender Name` is the primary individual actor used in charts.

**Impact:** Charts automatically use the correct actor fields based on `vScorecard` and `vScorecardActor` variables. No manual field selection needed.

---

## 5. Chart Expression Differences

### 5.1 Chart Dimensions

**Performance Retail App:**
```qlik
// Organization level charts
='$(vScorecard)'  // Always resolves to 'Branch'

// Individual level charts
='$(vScorecardActor)'  // Always resolves to 'Loan Officer'
```

**Performance TPO App:**
```qlik
// Organization level charts
='$(vScorecard)'  // Always resolves to 'Account Executive'

// Individual level charts
='$(vScorecardActor)'  // Always resolves to 'Broker Lender Name'
```

**How It Works:**
- Variables are expanded at chart render time
- Retail app charts use `[Branch]` and `[Loan Officer]` fields
- TPO app charts use `[Account Executive]` and `[Broker Lender Name]` fields
- Same chart expressions work in both apps, just resolve to different fields

**Impact:** Charts automatically use the correct actor fields without needing conditional logic or show conditions.

---

### 5.2 Set Analysis Expressions

**Performance Retail App:**
```qlik
// Example: Units count
Count({
    $<
    [Branch_Production] _= {$(vCurrentProduction)},
    DateType={'Funding'},
    [$(vToDate)]={'Yes'},
    [Consolidated Channels]={'Retail'},
    [Rate Lock Buy Side Base Price Rate] = {">0"}
    >
    }[Loan Number])
```

**Performance TPO App:**
```qlik
// Example: Units count
Count({
    $<
    [Account Executive_Production] _= {$(vCurrentProduction)},
    DateType={'Funding'},
    [$(vToDate)]={'Yes'},
    [Consolidated Channels]={'TPO'},
    [Rate Lock Buy Side Base Price Rate] = {">0"}
    >
    }[Loan Number])
```

**Key Differences:**
- **Production field:** `[Branch_Production]` vs `[Account Executive_Production]`
- **Channel filter:** `[Consolidated Channels]={'Retail'}` vs `[Consolidated Channels]={'TPO'}`

**How It Works:**
- Production fields are referenced via `[$(vScorecard)_Production]` and `[$(vScorecardActor)_Production]`
- Variables expand to correct field names at runtime
- Channel filter ensures only relevant channel data is included

**Impact:** All set analysis expressions automatically filter to the correct actors and channels based on variable values.

---

### 5.3 Master Measures

**Performance Retail App:**
- Production field references: `[Branch_Production]`, `[Loan Officer_Production]`
- Example: `Sum({$<[Branch_Production] _= {$(vCurrentProduction)},...>}[Revenue])`
- Channel filter: `[Consolidated Channels]={'Retail'}`

**Performance TPO App:**
- Production field references: `[Account Executive_Production]`, `[Broker Lender Name_Production]`
- Example: `Sum({$<[Account Executive_Production] _= {$(vCurrentProduction)},...>}[Revenue])`
- Channel filter: `[Consolidated Channels]={'TPO'}`

**How It Works:**
- Master measures use `[$(vScorecard)_Production]` and `[$(vScorecardActor)_Production]` syntax
- Variables expand to correct field names
- Same master measure expressions work in both apps

**Impact:** Master measures automatically reference the correct production fields and filter to the correct channels.

---

## 6. Sheet-Specific Differences

### 6.1 TopTiering Sheet

**Performance Retail App:**
- Charts dimensioned by `[Branch]` and `[Loan Officer]`
- Chart titles reference "Branch" and "Loan Officer"
- Example titles: "TopTiering by Branch", "Loan Officer Insights"
- All charts show Retail channel data only

**Performance TPO App:**
- Charts dimensioned by `[Account Executive]` and `[Broker Lender Name]`
- Chart titles reference "Account Executive" and "Broker Lender Name"
- Example titles: "TopTiering by Account Executive", "Broker Lender Name Insights"
- All charts show TPO channel data only

**Impact:** Same sheet structure, different actor fields and data automatically applied via variables.

---

### 6.2 Company Scorecard Sheet

**Performance Retail App:**
- Defaults to Branch view
- Shows Branch-level metrics
- Filters to Retail channels
- Uses `[Branch]` and `[Branch_Production]` fields

**Performance TPO App:**
- Defaults to Account Executive view
- Shows Account Executive-level metrics
- Filters to TPO channels
- Uses `[Account Executive]` and `[Account Executive_Production]` fields

**Impact:** Same sheet logic, different default actors based on `vScorecard` variable.

---

### 6.3 Sales Trends Sheet

**Performance Retail App:**
- Shows trends for Branch and Loan Officer
- Filters to Retail channels
- Uses `[Branch]` and `[Loan Officer]` dimensions

**Performance TPO App:**
- Shows trends for Account Executive and Broker Lender Name
- Filters to TPO channels
- Uses `[Account Executive]` and `[Broker Lender Name]` dimensions

**Impact:** Same trend analysis logic, different actor fields automatically applied.

---

## 7. Performance Characteristics

### 7.1 Data Volume

**Performance Retail App:**
- Loads only Retail channel data (~50% of total data)
- Smaller data model
- Faster reload times
- Less memory usage
- Faster chart calculations

**Performance TPO App:**
- Loads only TPO channel data (~50% of total data)
- Smaller data model
- Faster reload times
- Less memory usage
- Faster chart calculations

**Impact:** Both apps benefit from smaller, focused data models compared to loading all channels. Users experience faster performance.

---

### 7.2 Calculation Complexity

**Performance Retail App:**
- Simple chart expressions (no conditional logic)
- Fixed variable values
- Direct field references
- No show condition evaluations
- Faster chart rendering

**Performance TPO App:**
- Simple chart expressions (no conditional logic)
- Fixed variable values
- Direct field references
- No show condition evaluations
- Faster chart rendering

**Impact:** Both apps use straightforward expressions without complex conditional logic, resulting in faster calculations and easier maintenance.

---

## 8. User Experience Differences

### 8.1 App Selection

**Performance Retail App:**
- Users with Retail channel access open "Performance Retail"
- Clear, focused dashboard for Retail operations
- No confusion about which data to view
- App name clearly indicates "Retail"

**Performance TPO App:**
- Users with TPO channel access open "Performance TPO"
- Clear, focused dashboard for TPO operations
- No confusion about which data to view
- App name clearly indicates "TPO"

**Impact:** Users know exactly which app to use based on their role/channel access. Clear separation prevents confusion.

---

### 8.2 Data Visibility

**Performance Retail App:**
- Users see only Retail channel data
- Charts show Branch and Loan Officer metrics
- No TPO data visible
- Focused view of Retail operations

**Performance TPO App:**
- Users see only TPO channel data
- Charts show Account Executive and Broker Lender Name metrics
- No Retail data visible
- Focused view of TPO operations

**Impact:** Each app provides a focused, relevant view without unnecessary data cluttering the interface.

---

## 9. Maintenance Differences

### 9.1 Code Complexity

**Performance Retail App:**
- Fixed variable values (no conditional logic)
- Simple chart expressions
- Direct field references
- Easy to understand and maintain
- No dynamic logic to debug

**Performance TPO App:**
- Fixed variable values (no conditional logic)
- Simple chart expressions
- Direct field references
- Easy to understand and maintain
- No dynamic logic to debug

**Impact:** Both apps are significantly simpler to maintain than a combined app. Code is straightforward and predictable.

---

### 9.2 Update Process

**Performance Retail App:**
- Update scripts/variables as needed
- Test Retail-specific functionality
- Deploy independently
- Changes don't affect TPO app

**Performance TPO App:**
- Update scripts/variables as needed
- Test TPO-specific functionality
- Deploy independently
- Changes don't affect Retail app

**Impact:** Can update and deploy apps independently, reducing risk of breaking both when making changes. Each app can be maintained separately.

---

## 10. Shared Components (Same in Both Apps)

### 10.1 Common Scripts
- Most script files are identical
- Only `START HERE.qvs` and `Variables.qvs` have differences (the IF/ELSE blocks)
- Can share common script libraries
- Same data loading logic (just different filters)

### 10.2 Chart Structure
- Same chart types and layouts
- Same master measures (use variables for field references)
- Same sheet structure
- Same visualizations

### 10.3 Data Model Structure
- Same table structure
- Same field names
- Same relationships
- Only difference is which channels/actors are loaded

### 10.4 Expressions
- Same expression patterns
- Same calculation logic
- Same set analysis structures
- Variables make expressions work for both apps

**Impact:** The vast majority of code is shared between apps, making maintenance efficient. Only configuration differs.

---

## 11. Implementation Summary

### 11.1 What Makes Them Different

The two apps are identical except for **three key configuration points**:

1. **`vConsolidatedChannels`** in `START HERE.qvs`
   - Retail: `'Retail'`
   - TPO: `'TPO'`

2. **Variable values** in `Variables.qvs` IF/ELSE blocks
   - Retail: Branch/Loan Officer
   - TPO: Account Executive/Broker Lender Name

3. **Data filtering** in `ODAG LoanData.qvs`
   - Retail: Filters to Retail channels
   - TPO: Filters to TPO channels

### 11.2 How It Works

1. **Load Script Phase:**
   - `START HERE.qvs` sets `vConsolidatedChannels` to 'Retail' or 'TPO'
   - `ODAG LoanData.qvs` filters data based on this variable
   - Only matching channel data is loaded into the data model

2. **Variable Initialization:**
   - `Variables.qvs` checks `vConsolidatedChannels` value
   - Sets `vScorecard` and `vScorecardActor` accordingly
   - Sets `vChannelGroup` to match

3. **Chart Rendering:**
   - Charts use `='$(vScorecard)'` and `='$(vScorecardActor)'` expressions
   - Variables expand to correct field names
   - Set analysis filters use `[Consolidated Channels]={'$(vChannelGroup)'}`
   - Charts automatically show correct data

### 11.3 Why This Approach Works

- **Simple:** Only one configuration variable determines everything
- **Maintainable:** Most code is shared, only configuration differs
- **Performant:** Each app loads only relevant data
- **Clear:** Users know which app to use
- **Flexible:** Easy to add new apps (e.g., "Performance Correspondent") by copying and changing one variable

---

## 12. Migration Checklist

When creating the TPO app from the Retail app:

- [ ] Copy entire Retail app
- [ ] Update `START HERE.qvs`: Change `SET vConsolidatedChannels = 'Retail';` to `SET vConsolidatedChannels = 'TPO';`
- [ ] Verify `Variables.qvs` has correct TPO variable block (should already be there in the IF/ELSE structure)
- [ ] Verify `ODAG LoanData.qvs` uses `vConsolidatedChannels` variable in WHERE clause (should already be there)
- [ ] Update app name/title to include "TPO"
- [ ] Test TPO app loads only TPO channels
- [ ] Test charts show Account Executive and Broker Lender Name data
- [ ] Verify no Retail data appears in TPO app
- [ ] Test all sheets (TopTiering, Company Scorecard, Sales Trends)
- [ ] Verify app name shows "Performance TPO"

---

## Summary

The **only real differences** between the two apps are:

1. **`vConsolidatedChannels`** setting in `START HERE.qvs` ('Retail' vs 'TPO')
2. **Variable values** in `Variables.qvs` (Branch/Loan Officer vs Account Executive/Broker Lender Name)
3. **Data loaded** (Retail channels vs TPO channels)

Everything else is **identical** - same scripts, same chart structures, same expressions. The expressions use variables that resolve to different fields, but the code itself is the same. This makes the two-app approach very maintainable since most code is shared, and the differences are minimal and clearly defined.
