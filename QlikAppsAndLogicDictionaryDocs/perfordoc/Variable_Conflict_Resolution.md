# Variable Conflict Resolution

## Issue Found

During implementation, we discovered existing variables that conflicted with our new variables:

### Existing Variables (Lines 230-231 in Variables.qvs)
```qlik
LET vCompanyScorecardActor = 'Loan Officer';
LET vCompanyScorecardChannel = '*';
```

### Our New Variables (Lines 179, 187)
```qlik
SET vCompanyScorecardChannel='$(vChannelGroup)';
SET vCompanyScorecardActor=1;
```

## Resolution

### Analysis
1. **Existing variables were not used**: Searched QSDA export and found no expressions using `vCompanyScorecardActor` or `vCompanyScorecardChannel`
2. **Data type conflict**: 
   - Old: `vCompanyScorecardActor = 'Loan Officer'` (string)
   - New: `vCompanyScorecardActor = 1` (numeric)
3. **SET overwrites LET**: Since SET statements come after LET, our values will overwrite the old ones

### Action Taken
1. **Commented out old LET statements** (lines 230-231) with explanation
2. **Added notes** explaining the change from string/wildcard to numeric/specific channel
3. **Kept our SET statements** which properly initialize the variables for dropdown use

### Result
- No redundancy - old unused variables are commented out
- No conflicts - SET statements properly initialize variables
- Clear documentation - comments explain the change

## TPO Variables.qvs Review

### Purpose
TPO Variables.qvs serves a different purpose:
- **Determines if multi-channel is enabled** (`vTPOCheck`)
- **Sets up actor list** (`vActorList`) for the Actors sheet
- **Sets default actor picker variables** (`vActor1-4`)

### No Conflict
Our new variables don't conflict because:
- **Different purpose**: TPO Variables sets up overall app configuration; our variables are for sheet-specific user selections
- **Different scope**: TPO Variables is about available actors; our variables are about user selection
- **Validation**: TPO Variables confirms 'Account Executive' and 'Broker Lender Name' are in the actor list when multi-channel is enabled (vTPOCheck=-1)

## Variable Summary

### Channel Selection Variables (New)
- `vTopTieringChannel` - TopTiering sheet channel selection
- `vCompanyScorecardChannel` - Company Scorecard sheet channel selection  
- `vSalesTrendsChannel` - Sales Trends sheet channel selection

### Actor Selection Variables (New)
- `vTopTieringShow` - TopTiering sheet actor selection (already existed, repurposed)
- `vCompanyScorecardActor` - Company Scorecard sheet actor selection (replaced old string value)
- `vSalesTrendsActor` - Sales Trends sheet actor selection

### TPO Variables (Existing, No Changes)
- `vTPOCheck` - Determines if multi-channel enabled
- `vActorList` - List of available actors
- `vActor1-4` - Default actor picker values

## Conclusion

✅ **No redundancy** - Old unused variables commented out
✅ **No conflicts** - All variables serve distinct purposes  
✅ **Proper initialization** - SET statements correctly initialize dropdown variables
✅ **Documentation** - Comments explain changes and purpose
