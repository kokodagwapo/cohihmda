# End-to-End Logic Trace - Action-Based Solution

## Issue Analysis

### Problem 1: All actor options showing when no channel selected
### Problem 2: Selecting "Loan Officer" shows "Broker Lender Name" data

## Current Flow Analysis

### Step 1: Page Load (No Selections)

**Load Script Initialization (`Variables.qvs`):**
```qlik
SET vConsolidatedChannels = 'All';  // From START HERE.qvs
SET vTopTieringShow = 1;  // Default to organization level
SET vScorecard='Account Executive';  // Default when 'All' channels
SET vScorecardActor='Broker Lender Name';  // Default when 'All' channels
```

**Actor Dropdown Expression:**
```qlik
=If(GetFieldSelections(Channel)='',
    '',  // Should be blank
    ...
)
```

**Problem**: `GetFieldSelections(Channel)` might not return empty string when no selection. It might return NULL, or the expression might not evaluate correctly.

**Result**: Dropdown shows all options instead of blank.

### Step 2: User Selects "Banked - Retail"

**Channel Selection**: `GetFieldSelections(Channel)` = "Banked - Retail"

**Actor Dropdown Expression Evaluates:**
```qlik
=If(GetFieldSelections(Channel)='',  // FALSE - Channel is selected
    '',
    If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*') AND NOT WildMatch(GetFieldSelections(Channel),'*Wholesale*','*Corresp*'),
        // TRUE - matches Retail pattern
        '1~Branch|0~Loan Officer',  // ✓ Correct
        ...
    )
)
```

**Result**: Dropdown shows "Branch" and "Loan Officer" ✓

**Actions Trigger** (both actions run on selection change):

**Action 1 (Set vScorecard):**
```qlik
=If($(vTopTieringShow)=1,  // Currently 1 (default)
    If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'),
        'Branch',  // ✓ Should set to Branch
        ...
    ),
    '$(vScorecard)'  // Keep current if vTopTieringShow=0
)
```

**Action 2 (Set vScorecardActor):**
```qlik
=If($(vTopTieringShow)=0,  // Currently 1, so this is FALSE
    If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'),
        'Loan Officer',
        ...
    ),
    '$(vScorecardActor)'  // Keep current value = 'Broker Lender Name' ✗
)
```

**Problem**: When `vTopTieringShow=1`, Action 2 keeps the current value ('Broker Lender Name'), which is wrong. Action 2 should only update when `vTopTieringShow=0`.

### Step 3: User Selects "Loan Officer" (vTopTieringShow=0)

**Actor Selection**: `vTopTieringShow` changes from 1 to 0

**Actions Trigger Again**:

**Action 1 (Set vScorecard):**
```qlik
=If($(vTopTieringShow)=1,  // Now FALSE (changed to 0)
    ...
    '$(vScorecard)'  // Keep current = 'Branch' ✓
)
```

**Action 2 (Set vScorecardActor):**
```qlik
=If($(vTopTieringShow)=0,  // Now TRUE
    If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'),
        'Loan Officer',  // ✓ Should set to Loan Officer
        If(WildMatch(GetFieldSelections(Channel),'*Wholesale*','*Corresp*'),
            'Broker Lender Name',
            'Loan Officer'  // Default fallback
        )
    ),
    ...
)
```

**Expected**: `vScorecardActor` should be set to 'Loan Officer'
**Actual**: Charts show "Broker Lender Name" data ✗

## Root Causes

### Issue 1: Dropdown Expression Not Working for Empty Selection

`GetFieldSelections(Channel)=''` might not work correctly. Need to use:
- `Len(Trim(GetFieldSelections(Channel)))=0` OR
- `IsNull(Only(Channel))` OR
- `GetFieldSelections(Channel)=''` might return a space or other value

### Issue 2: Action Logic Problem

The actions have a flaw: When channel is selected but actor hasn't been selected yet (vTopTieringShow still at default 1), Action 2 keeps the wrong default value ('Broker Lender Name').

**Better approach**: Actions should update BOTH variables whenever channel changes, regardless of vTopTieringShow. Then charts use the correct one based on vTopTieringShow.

### Issue 3: Chart Usage

Charts use:
- `[$(vScorecard)]` when vTopTieringShow=1
- `[$(vScorecardActor)]` when vTopTieringShow=0

But if the actions don't update correctly, charts use wrong values.

## Recommended Fixes

### Fix 1: Dropdown Expression

```qlik
=If(Len(Trim(GetFieldSelections(Channel)))=0 OR GetFieldSelections(Channel)='',
    // No channel selected - show blank
    '',
    If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*') AND NOT WildMatch(GetFieldSelections(Channel),'*Wholesale*','*Corresp*'),
        '1~Branch|0~Loan Officer',
        If(WildMatch(GetFieldSelections(Channel),'*Wholesale*','*Corresp*') AND NOT WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'),
            '1~Account Executive|0~Broker Lender Name',
            '1~Branch|0~Loan Officer|1~Account Executive|0~Broker Lender Name'
        )
    )
)
```

### Fix 2: Action Logic - Update Both Variables on Channel Change

**Action 1: Set vScorecard** (always update when channel changes)
```qlik
=If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'),
    'Branch',
    If(WildMatch(GetFieldSelections(Channel),'*Wholesale*','*Corresp*'),
        'Account Executive',
        'Branch'  // Default fallback
    )
)
```

**Action 2: Set vScorecardActor** (always update when channel changes)
```qlik
=If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'),
    'Loan Officer',
    If(WildMatch(GetFieldSelections(Channel),'*Wholesale*','*Corresp*'),
        'Broker Lender Name',
        'Loan Officer'  // Default fallback
    )
)
```

**Key Change**: Remove the `vTopTieringShow` check from actions. Actions should update variables based on channel only. Charts will use the correct variable based on `vTopTieringShow`.

### Fix 3: Initialize Variables Correctly

In `Variables.qvs`, when `vConsolidatedChannels='All'`, set defaults to Retail actors (more common):
```qlik
SET vScorecard='Branch';  // Default to Retail
SET vScorecardActor='Loan Officer';  // Default to Retail
```

This way, even if actions don't fire immediately, defaults are correct.
