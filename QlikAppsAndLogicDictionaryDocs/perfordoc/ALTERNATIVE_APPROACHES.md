# Alternative Approaches - No Chart Expression Changes Needed

## Goal
Allow users to select channel/actors WITHOUT changing chart expressions.

## Current Problem
Charts use `[$(vScorecard)]` which expands to a field name. Since `vScorecard` is a SET variable, it can't change dynamically based on user selections.

## Alternative Approaches

### Option 1: Use Field Filters + Conditional Field References (Recommended)

**How it works:**
- Users filter by **Channel field** directly (field list/filter pane)
- Charts use conditional expressions that check what's selected in Channel field
- No variable dropdowns needed!

**Implementation:**
1. Add Channel field filter to TopTiering sheet
2. Charts use expressions that check Channel selections and choose appropriate actor field

**Chart Dimension:**
```qlik
=If(vTopTieringShow=1,
    If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'), [Branch], [Account Executive]),
    If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'), [Loan Officer], [Broker Lender Name])
)
```

**Chart Measure:**
```qlik
sum({$<[$(=If(vTopTieringShow=1,
    If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'),'Branch','Account Executive'),
    If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'),'Loan Officer','Broker Lender Name')
))_Production] *= {$(vCurrentProduction)},...>}[Revenue])
```

**Pros:**
- No variable dropdowns needed
- Users filter directly on Channel field
- Charts automatically respond to selections

**Cons:**
- Still need to update chart expressions (but simpler logic)

### Option 2: Use Actions to Update Variables

**How it works:**
- Channel dropdown triggers action that sets `vScorecard` and `vScorecardActor`
- Actor dropdown triggers action that sets `vTopTieringShow`
- Charts continue using `[$(vScorecard)]` unchanged

**Implementation:**
1. Channel dropdown: On selection, trigger action → Set Variable `vScorecard` and `vScorecardActor` based on selection
2. Actor dropdown: On selection, trigger action → Set Variable `vTopTieringShow`
3. Charts use existing `[$(vScorecard)]` logic

**Action Logic:**
- If "Banked - Retail" selected → Set `vScorecard='Branch'`, `vScorecardActor='Loan Officer'`
- If "Banked - Wholesale" selected → Set `vScorecard='Account Executive'`, `vScorecardActor='Broker Lender Name'`

**Pros:**
- Charts don't need changes
- Uses existing variable structure
- Variables update dynamically via actions

**Cons:**
- Requires setting up actions
- Variables update on selection change (might have timing issues)

### Option 3: Use Field Filters + Set Analysis (Simplest)

**How it works:**
- Users filter Channel field directly
- Charts add Channel filter to set analysis
- Charts use existing `[$(vScorecard)]` but add Channel condition

**Implementation:**
1. Add Channel field filter to sheet
2. Charts add to set analysis: `Channel={'Banked - Retail'}`
3. Charts continue using `[$(vScorecard)]` but only show data for selected channel

**But wait** - This doesn't solve the actor selection issue. We still need to choose Branch vs Account Executive.

### Option 4: Use Field Filters for Both Channel AND Actor

**How it works:**
- Users filter Channel field (which channel)
- Users filter Actor field directly (Branch, Account Executive, Loan Officer, Broker Lender Name)
- Charts use the filtered Actor field directly

**Implementation:**
1. Add Channel field filter
2. Add Actor field filter (shows Branch, Account Executive, Loan Officer, Broker Lender Name)
3. Charts use: `[$(=If(vTopTieringShow=1,GetFieldSelections([Organization Actor]),GetFieldSelections([Individual Actor])))`

**Or simpler:**
- Charts use: `[$(=If(vTopTieringShow=1,'Branch','Loan Officer'))` but this doesn't work for TPO

### Option 5: Use Calculated Dimensions/Measures with Field Selections (Best!)

**How it works:**
- Users filter Channel field
- Charts use calculated dimensions that automatically select the right actor field based on Channel selections
- No variables needed for actor selection!

**Chart Dimension:**
```qlik
=If(vTopTieringShow=1,
    If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'), [Branch], [Account Executive]),
    If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'), [Loan Officer], [Broker Lender Name])
)
```

**Chart Measure:**
```qlik
sum({$<[$(=If(vTopTieringShow=1,
    If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'),'Branch','Account Executive'),
    If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'),'Loan Officer','Broker Lender Name')
))_Production] *= {$(vCurrentProduction)},...>}[Revenue])
```

**Actor Dropdown:**
- Just controls `vTopTieringShow` (1 or 0)
- Doesn't need to show actor names - just "Organization" vs "Individual" or "Branch Level" vs "Loan Officer Level"

**Pros:**
- Channel selection via field filter (simple)
- Actor selection via binary dropdown (simple)
- Charts automatically adapt
- Minimal changes needed

**Cons:**
- Still need to update chart expressions (but only once per chart)

## Recommended: Option 5 (Simplified)

### Simplified Actor Dropdown

Instead of showing actor names, show:
- **Value 1**: "Organization Level" (Branch or Account Executive)
- **Value 0**: "Individual Level" (Loan Officer or Broker Lender Name)

Then charts automatically choose the right field based on Channel selection.

### Implementation

1. **Channel Selection**: Field filter on Channel field
2. **Actor Selection**: Simple dropdown with "Organization Level" (1) and "Individual Level" (0)
3. **Charts**: Use dynamic expression that checks Channel selections and vTopTieringShow

This requires updating chart expressions, but it's a one-time change and much simpler than the current approach.
