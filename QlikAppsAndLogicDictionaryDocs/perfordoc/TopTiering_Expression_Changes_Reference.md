# TopTiering Sheet - Expression Changes Reference
## Complete List of Expressions to Update

This document provides the exact before/after expressions for all objects on the TopTiering sheet that need to be updated.

---

## Summary of Changes

1. **Channel Filter**: Replace `vChannelGroup` with `vTopTieringChannel` in all set analysis
2. **Actor Dimensions**: Replace conditional logic with direct Account Executive/Broker references
3. **Actor Fields**: Replace `$(vScorecard)` and `$(vScorecardActor)` with conditional based on `vTopTieringShow`
4. **Field References**: Update `[Branch]` → `[Broker Lender Name]`, `[Loan Officer]` → `[Account Executive]`

---

## Key Chart Objects on TopTiering Sheet

### Object: `6811c629-5194-40d4-bd25-1faab1aad158` (vScorecard_Revenue)

#### Dimension Expression

**BEFORE**:
```qlik
='$(vScorecard)'

/*
If('$(vScorecard)' = 'Branch',
    If(WildMatch(Concat([Consolidated Channels],','),'*Retail*') AND WildMatch(Concat([Consolidated Channels],','),'*TPO*'),'Branch & Broker Lenders',
        If(WildMatch(Concat([Consolidated Channels],','),'*Retail*'),'Branch','Broker Lender Name')),
    '$(vScorecard)'
)
*/
```

**AFTER**:
```qlik
=If(vTopTieringShow=1,[Account Executive],[Broker Lender Name])
```

#### Dimension Label

**BEFORE**:
```qlik
='$(vScorecard)'
```

**AFTER**:
```qlik
=If(vTopTieringShow=1,'Account Executive','Broker')
```

#### Measure: vScorecard_Revenue

**BEFORE**:
```qlik
sum({$<[$(vScorecard)_Production] *= {$(vCurrentProduction)},DateType={'Funding'},[$(vToDate)]={'Yes'},[Rate Lock Buy Side Base Price Rate] = {">0"}>}[Revenue])
```

**AFTER**:
```qlik
sum({$<[$(=If(vTopTieringShow=1,'Account Executive','Broker Lender Name'))_Production] *= {$(vCurrentProduction)},DateType={'Funding'},[$(vToDate)]={'Yes'},[Rate Lock Buy Side Base Price Rate] = {">0"},[Consolidated Channels]={'$(vTopTieringChannel)'}>}[Revenue])
```

**Note**: Also add `[Consolidated Channels]={'$(vTopTieringChannel)'}` to set analysis.

#### Accumulated % Measure

**BEFORE**:
```qlik
Min(Aggr(
Rangesum(Above(Sum({<[$(vScorecard)_Production] *= {$(vCurrentProduction)},DateType={'Funding'},[$(vToDate)]={'Yes'},[Rate Lock Buy Side Base Price Rate] = {">0"}>} Revenue)
	/Sum({<[$(vScorecard)_Production] *= {$(vCurrentProduction)},DateType={'Funding'},[$(vToDate)]={'Yes'},[Rate Lock Buy Side Base Price Rate] = {">0"}>} Total Revenue),0,RowNo())),
		([$(vScorecard)],(=Sum({<[$(vScorecard)_Production] *= {$(vCurrentProduction)},DateType={'Funding'},[$(vToDate)]={'Yes'},[Rate Lock Buy Side Base Price Rate] = {">0"}>} Revenue),Desc))
))
```

**AFTER**:
```qlik
Min(Aggr(
Rangesum(Above(Sum({<[$(=If(vTopTieringShow=1,'Account Executive','Broker Lender Name'))_Production] *= {$(vCurrentProduction)},DateType={'Funding'},[$(vToDate)]={'Yes'},[Rate Lock Buy Side Base Price Rate] = {">0"},[Consolidated Channels]={'$(vTopTieringChannel)'}>} Revenue)
	/Sum({<[$(=If(vTopTieringShow=1,'Account Executive','Broker Lender Name'))_Production] *= {$(vCurrentProduction)},DateType={'Funding'},[$(vToDate)]={'Yes'},[Rate Lock Buy Side Base Price Rate] = {">0"},[Consolidated Channels]={'$(vTopTieringChannel)'}>} Total Revenue),0,RowNo())),
		([$(=If(vTopTieringShow=1,'Account Executive','Broker Lender Name'))],(=Sum({<[$(=If(vTopTieringShow=1,'Account Executive','Broker Lender Name'))_Production] *= {$(vCurrentProduction)},DateType={'Funding'},[$(vToDate)]={'Yes'},[Rate Lock Buy Side Base Price Rate] = {">0"},[Consolidated Channels]={'$(vTopTieringChannel)'}>} Revenue),Desc))
))
```

---

### Object: `94c675f3-e0ee-4ec8-97d0-aa74c83bb905` (vScorecardActor_Revenue)

#### Dimension Expression

**BEFORE**:
```qlik
='$(vScorecardActor)'

/*
If('$(vScorecardActor)'='Mortgage Loan Officer (MLO)',
    If(WildMatch(Concat([Consolidated Channels],','),'*Retail*') AND WildMatch(Concat([Consolidated Channels],','),'*TPO*'),'LO & AE',
        If(WildMatch(Concat([Consolidated Channels],','),'*Retail*'),'Loan Officer','Account Executive')),
    '$(vScorecardActor)'
)
*/
```

**AFTER**:
```qlik
=If(vTopTieringShow=1,[Account Executive],[Broker Lender Name])
```

#### Dimension Label

**BEFORE**:
```qlik
='$(vScorecardActor)'
```

**AFTER**:
```qlik
=If(vTopTieringShow=1,'Account Executive','Broker')
```

#### Measure: vScorecardActor_Revenue

**BEFORE**:
```qlik
sum({$<[$(vScorecardActor)_Production] *= {$(vCurrentProduction)},DateType={'Funding'},[$(vToDate)]={'Yes'},[Rate Lock Buy Side Base Price Rate] = {">0"}>}[Revenue])
```

**AFTER**:
```qlik
sum({$<[$(=If(vTopTieringShow=1,'Account Executive','Broker Lender Name'))_Production] *= {$(vCurrentProduction)},DateType={'Funding'},[$(vToDate)]={'Yes'},[Rate Lock Buy Side Base Price Rate] = {">0"},[Consolidated Channels]={'$(vTopTieringChannel)'}>}[Revenue])
```

---

### Object: `38fa61a4-ad90-4914-9b9c-f6e175c47b05` (Loan Officer_Revenue)

#### Dimension Expression

**BEFORE**:
```qlik
=[Loan Officer]
```

**AFTER**:
```qlik
=If(vTopTieringShow=1,[Account Executive],[Broker Lender Name])
```

#### Measure: Loan Officer_Revenue

**BEFORE**:
```qlik
sum({$<[Loan Officer_Production] *= {$(vCurrentProduction)},DateType={'Funding'},[$(vToDate)]={'Yes'},[Rate Lock Buy Side Base Price Rate] = {">0"}>}[Revenue])
```

**AFTER**:
```qlik
sum({$<[$(=If(vTopTieringShow=1,'Account Executive','Broker Lender Name'))_Production] *= {$(vCurrentProduction)},DateType={'Funding'},[$(vToDate)]={'Yes'},[Rate Lock Buy Side Base Price Rate] = {">0"},[Consolidated Channels]={'$(vTopTieringChannel)'}>}[Revenue])
```

---

## General Pattern: Adding Channel Filter to Set Analysis

### Pattern to Find:
```qlik
{$<[Field]={value}>}
```

### Pattern to Replace:
```qlik
{$<[Field]={value},[Consolidated Channels]={'$(vTopTieringChannel)'}>}
```

**Example**:
```qlik
// BEFORE
sum({$<DateType={'Funding'},[$(vToDate)]={'Yes'}>}[Revenue])

// AFTER
sum({$<DateType={'Funding'},[$(vToDate)]={'Yes'},[Consolidated Channels]={'$(vTopTieringChannel)'}>}[Revenue])
```

---

## General Pattern: Updating Actor Field References

### Pattern 1: Using Variable in Expression

**BEFORE**:
```qlik
[$(vScorecard)]
[$(vScorecardActor)]
```

**AFTER**:
```qlik
[$(=If(vTopTieringShow=1,'Account Executive','Broker Lender Name'))]
```

### Pattern 2: Direct Field Reference

**BEFORE**:
```qlik
[Branch]
[Loan Officer]
```

**AFTER**:
```qlik
=If(vTopTieringShow=1,[Account Executive],[Broker Lender Name])
```

### Pattern 3: In Set Analysis

**BEFORE**:
```qlik
[$(vScorecard)_Production]
[$(vScorecardActor)_Production]
```

**AFTER**:
```qlik
[$(=If(vTopTieringShow=1,'Account Executive','Broker Lender Name'))_Production]
```

---

## Container Show Conditions

### Object: `qrKGb` (TopTiering: Choose TopTiering Actor)

**BEFORE**:
```qlik
=if(vConsolidatedChannels='TPO',1,0)
if(vConsolidatedChannels='Retail',1,0)
```

**AFTER**:
```qlik
// Remove these conditions - always show the container
// Or update to check vTopTieringChannel if needed
=1
```

---

## Chart Title Updates

### Pattern

**BEFORE**:
```qlik
='Company Scorecard by '& pick(match(vTopTieringShow,1,0),'$(vScorecard)','$(vScorecardActor)')
```

**AFTER**:
```qlik
='Company Scorecard by '& pick(match(vTopTieringShow,1,0),'Account Executive','Broker')
```

---

## Variable Input Updates

### Object: `9894dbd4-8ef5-411e-aab9-accb9613c716` and `dfbbbf6a-8bb5-451d-bcef-31f966cc047f`
### (Choose TopTiering Actor)

**Current Variable**: `vTopTieringShow`

**Update Values**:
- Value 1: `Account Executive` (Display: "Account Executive")
- Value 0: `Broker` (Display: "Broker")

**Or use fixed values string**:
```
Account Executive~1|Broker~0
```

---

## Finding All Instances in Qlik Sense App

### Method 1: Search in App Editor
1. Open app in Edit mode
2. Go to TopTiering sheet
3. Use Find/Replace (if available) or manually check each object
4. Search for: `vChannelGroup`, `$(vScorecard)`, `$(vScorecardActor)`, `[Branch]`, `[Loan Officer]`

### Method 2: Check Each Chart Object
1. Select each chart on TopTiering sheet
2. Go to **Data** tab
3. Check **Dimensions** section
4. Check **Measures** section
5. Look for set analysis expressions
6. Update as per patterns above

### Method 3: Check All Expressions Tab
1. Select chart object
2. Go to **Properties** panel
3. Check all expression fields (measures, dimensions, labels, titles, etc.)

---

## Quick Reference: Field Name Mapping

| Old Reference | New Reference (vTopTieringShow=1) | New Reference (vTopTieringShow=0) |
|---------------|-----------------------------------|-----------------------------------|
| `$(vScorecard)` | `Account Executive` | `Broker Lender Name` |
| `$(vScorecardActor)` | `Account Executive` | `Broker Lender Name` |
| `[Branch]` | `[Account Executive]` | `[Broker Lender Name]` |
| `[Loan Officer]` | `[Account Executive]` | `[Broker Lender Name]` |
| `vChannelGroup` | `vTopTieringChannel` | `vTopTieringChannel` |

---

## Notes

- Always add `[Consolidated Channels]={'$(vTopTieringChannel)'}` to set analysis expressions
- Use `If(vTopTieringShow=1,...)` pattern for conditional actor references
- Verify field names `[Account Executive]` and `[Broker Lender Name]` exist in your data
- Test each chart after updating expressions
- Some expressions may need `_Production` suffix: `[Account Executive_Production]` vs `[Broker Lender Name_Production]`

---

## Testing After Updates

1. Select different channels in dropdown - verify charts filter correctly
2. Select Account Executive - verify correct data displays
3. Select Broker - verify correct data displays
4. Check all measures calculate correctly
5. Verify chart titles update correctly
6. Check no errors appear in expressions
