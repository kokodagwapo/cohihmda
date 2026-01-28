# Simplified Approach - Single Chart Per Container

## Problem with Current Approach

The current architecture uses multiple charts per container with show conditions:
- **Top Container**: 2 charts + 1 insights
- **Middle Container**: 9 charts (3 sets of 3)
- **Bottom Container**: 6 charts (2 sets of 3)

**Issues:**
1. Actions don't fire when `vTopTieringShow` changes (only on channel changes)
2. Complex show condition logic across many charts
3. Hard to maintain and debug

## Simplified Solution: Single Chart with Dynamic Expressions

Instead of multiple charts with show conditions, use **ONE chart per container** with **dynamic dimension and measure expressions** that change based on `vTopTieringShow`.

### Benefits:
- ✅ No show conditions needed
- ✅ Actions don't need to fire on variable changes (chart expressions evaluate automatically)
- ✅ Simpler to maintain
- ✅ Less objects to manage

### How It Works:

**Single Chart Per Container** with:
- **Dynamic Dimension**: Changes based on `vTopTieringShow`
- **Dynamic Measures**: Change based on `vTopTieringShow`

---

## Implementation

### Top Container - Single Chart

**Dimension Expression**:
```qlik
=if(Match(vTopTieringShow,1,3), 
    [$(vScorecard)],           // Organization level: Branch or Account Executive (use brackets for field reference)
    [$(vScorecardActor)]       // Individual level: Loan Officer or Broker Lender Name (use brackets for field reference)
)
```

**CRITICAL**: Use square brackets `[$(vScorecard)]` not quotes `'$(vScorecard)'` - brackets tell Qlik it's a field reference, quotes make it a string value!

**Measure Expression** (example - Revenue):
```qlik
=if(Match(vTopTieringShow,1,3),
    // Organization level measure
    sum({$<[$(vScorecard)_Production] *= {$(vCurrentProduction)},DateType={'Funding'},[$(vToDate)]={'Yes'},[Rate Lock Buy Side Base Price Rate] = {"">0""}>}[Revenue]),
    // Individual level measure
    if(Match(vTopTieringShow,2,4),
        sum({$<[$(vScorecardActor)_Production] *= {$(vCurrentProduction)},DateType={'Funding'},[$(vToDate)]={'Yes'},[Rate Lock Buy Side Base Price Rate] = {"">0""}>}[Revenue]),
        // Default fallback
        sum({$<[$(vScorecard)_Production] *= {$(vCurrentProduction)},DateType={'Funding'},[$(vToDate)]={'Yes'},[Rate Lock Buy Side Base Price Rate] = {"">0""}>}[Revenue])
    )
)
```

**No Show Condition Needed** - Chart always visible, expressions handle the logic.

---

## Updated Action Logic

Since chart expressions evaluate automatically, actions only need to update `vScorecard` and `vScorecardActor` when **channel changes**. The chart expressions will automatically use the correct variable based on `vTopTieringShow`.

**Simplified Action 1** (Set vScorecard):
```qlik
=If(Len(Trim(GetFieldSelections(Channel)))=0 OR GetFieldSelections(Channel)='',
    '$(vScorecard)',
    If(WildMatch(GetFieldSelections(Channel),'*Banked - Retail*'),
        'Branch',
        If(WildMatch(GetFieldSelections(Channel),'*Wholesale*','*Corresp*'),
            'Account Executive',
            'Branch'
        )
    )
)
```

**Simplified Action 2** (Set vScorecardActor):
```qlik
=If(Len(Trim(GetFieldSelections(Channel)))=0 OR GetFieldSelections(Channel)='',
    '$(vScorecardActor)',
    If(WildMatch(GetFieldSelections(Channel),'*Banked - Retail*'),
        'Loan Officer',
        If(WildMatch(GetFieldSelections(Channel),'*Wholesale*','*Corresp*'),
            'Broker Lender Name',
            'Loan Officer'
        )
    )
)
```

**No need to check `vTopTieringShow` in actions** - chart expressions handle that!

---

## Migration Steps

1. **Keep ONE chart per container** (delete the others)
2. **Update chart dimension** to use dynamic expression above
3. **Update all chart measures** to use dynamic expressions
4. **Remove all show conditions**
5. **Simplify actions** (remove `vTopTieringShow` checks)

---

## Trade-offs

**Pros:**
- Much simpler architecture
- No show condition complexity
- Actions don't need variable triggers
- Easier to debug (one chart to check)

**Cons:**
- Chart expressions are more complex
- Slight performance impact (expressions evaluate on each render, but minimal)
- Need to update all measures in each chart

---

## Recommendation

**YES, simplify to single charts!** The current multi-chart approach is causing more problems than it solves. Single charts with dynamic expressions will be:
- Easier to maintain
- More reliable (no show condition issues)
- Simpler action logic
- Better user experience
