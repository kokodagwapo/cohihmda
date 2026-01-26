# vScorecard Variables Analysis and Update Strategy

## Current Variable Definitions

### When vConsolidatedChannels = 'Retail'
- `vScorecard` = 'Branch'
- `vScorecardActor` = 'Loan Officer'
- `vScorecardList` = 'Branch|Investor'
- `vScorecardActorList` = 'Loan Officer|Underwriter'

### When vConsolidatedChannels = 'TPO'
- `vScorecard` = 'Account Executive'
- `vScorecardActor` = 'Broker Lender Name'
- `vScorecardList` = 'Account Executive|Investor'
- `vScorecardActorList` = 'Broker Lender Name|Loan Officer|Underwriter'

### When vConsolidatedChannels = 'All' (Current - WRONG)
- `vScorecard` = 'Account Executive' (defaults to TPO)
- `vScorecardActor` = 'Broker Lender Name' (defaults to TPO)
- `vScorecardList` = 'Account Executive|Investor' (missing Branch!)
- `vScorecardActorList` = 'Broker Lender Name|Loan Officer|Underwriter' (missing Account Executive!)

## Problem

When 'All' channels are selected, the lists should include **ALL** actors from both Retail and TPO, but currently they only include TPO actors.

## Solution: Update Lists for 'All' Channels

### Updated vScorecardList for 'All'
Should include all organization actors:
- Branch (Retail)
- Account Executive (TPO)
- Correspondent Lender Name (Correspondent - if field exists)
- Investor (common to both)

**Updated:**
```qlik
SET vScorecardList='Branch|Account Executive|Investor';
```

### Updated vScorecardActorList for 'All'
Should include all individual actors:
- Loan Officer (Retail)
- Broker Lender Name (TPO)
- Account Executive (TPO - individual level)
- Correspondent Sales Rep/AE (Correspondent - if field exists)
- Underwriter (common to both)
- Processor, Closer (if applicable)

**Updated:**
```qlik
SET vScorecardActorList='Loan Officer|Broker Lender Name|Account Executive|Underwriter';
```

## But Wait - vScorecard and vScorecardActor Still Need to be Dynamic

The lists help populate dropdowns, but `vScorecard` and `vScorecardActor` are still set globally. Charts use `[$(vScorecard)]` which expands to the field name.

**Issue**: If `vScorecard='Account Executive'` but user selects Retail channel, charts will try to use `[Account Executive]` field on Retail data, which might not exist or show wrong data.

## Better Approach: Make vScorecard/vScorecardActor Dynamic

Since these are SET variables (not calculated), we can't make them fully dynamic. But we can:

### Option 1: Update Lists, Keep vScorecard/vScorecardActor as Defaults
- Update lists to include all actors
- Keep vScorecard/vScorecardActor as defaults
- Charts still need dynamic expressions OR
- Use the lists in dropdowns, but charts use dynamic field selection

### Option 2: Create Calculated Variables for Charts
Create new calculated variables that charts can use:
- `vTopTieringScorecard` = calculated based on channel selection
- `vTopTieringScorecardActor` = calculated based on channel selection

But Qlik doesn't support calculated variables that update dynamically.

### Option 3: Update Lists + Use Dynamic Expressions in Charts (Recommended)

1. **Update the lists** to include all actors when 'All' is selected
2. **Charts use dynamic expressions** that check channel selection:
   ```qlik
   =If(vTopTieringShow=1,
       If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'), 'Branch', 'Account Executive'),
       If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'), 'Loan Officer', 'Broker Lender Name')
   )
   ```

## Recommended Update

Update `Variables.qvs` for 'All' channels case:

```qlik
ELSEIF '$(vConsolidatedChannels)' = 'All' THEN

//2025-01-XX Sets for All channels (multi-channel mode)
//Include ALL actors from both Retail and TPO channels
SET vScorecard='Account Executive';  // Default, but charts should use dynamic selection
SET vScorecardActor='Broker Lender Name';  // Default, but charts should use dynamic selection
SET vScorecardList='Branch|Account Executive|Investor';  // All organization actors
SET vScorecardActorList='Loan Officer|Broker Lender Name|Account Executive|Underwriter';  // All individual actors

END IF
```

## How Charts Should Use This

Charts should NOT rely on `vScorecard`/`vScorecardActor` directly. Instead:

**Dimension:**
```qlik
=If(vTopTieringShow=1,
    If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'), 'Branch', 'Account Executive'),
    If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'), 'Loan Officer', 'Broker Lender Name')
)
```

**Or use field reference:**
```qlik
=If(vTopTieringShow=1,
    If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'), [Branch], [Account Executive]),
    If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'), [Loan Officer], [Broker Lender Name])
)
```

## Actor Dropdown Can Use Lists

The actor dropdown can use `vScorecardList` and `vScorecardActorList` if they're filtered by channel selection, OR use dynamic expression to filter the lists based on selected channels.
