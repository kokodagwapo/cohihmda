# Actor Dropdown - Dynamic Logic Based on Selected Channels

## Requirement
The actor dropdown should dynamically show actors based on what channels are actually selected in the data:

- **If Retail channels are selected**: Show "Branch" and "Loan Officer"
- **If TPO/Other channels are selected**: Show "Account Executive" and "Broker Lender Name"  
- **If BOTH Retail AND TPO channels are selected**: Show ALL FOUR options

## Solution: Dynamic Values Expression

Instead of using static values or checking `vTopTieringChannel`, check what channels actually exist in the current data selection.

### Option 1: Check Consolidated Channels in Selection

**Values Expression:**
```qlik
=Concat(
    If(WildMatch(Concat(DISTINCT {<Channel={'$(vTopTieringChannel)'}>} [Consolidated Channels],','),'*Retail*'),
        'Branch~1|Loan Officer~0|',
        ''
    ) &
    If(WildMatch(Concat(DISTINCT {<Channel={'$(vTopTieringChannel)'}>} [Consolidated Channels],','),'*TPO*'),
        'Account Executive~1|Broker Lender Name~0|',
        ''
    ),
    ''
)
```

### Option 2: Check Channel Field Directly (Simpler)

**Values Expression:**
```qlik
=Concat(
    If(WildMatch('$(vTopTieringChannel)','*Retail*','*Brok*'),
        'Branch~1|Loan Officer~0|',
        ''
    ) &
    If(WildMatch('$(vTopTieringChannel)','*Wholesale*','*Corresp*'),
        'Account Executive~1|Broker Lender Name~0|',
        ''
    ),
    ''
)
```

### Option 3: Check All Selected Channels (Most Dynamic)

**Values Expression:**
```qlik
=Concat(
    If(WildMatch(Concat(DISTINCT Channel,','),'*Retail*','*Brok*'),
        'Branch~1|Loan Officer~0|',
        ''
    ) &
    If(WildMatch(Concat(DISTINCT Channel,','),'*Wholesale*','*Corresp*'),
        'Account Executive~1|Broker Lender Name~0|',
        ''
    ),
    ''
)
```

### Option 4: Using Consolidated Channels Field (Recommended)

**Values Expression:**
```qlik
=Concat(
    If(WildMatch(Concat(DISTINCT [Consolidated Channels],','),'*Retail*'),
        'Branch~1|Loan Officer~0|',
        ''
    ) &
    If(WildMatch(Concat(DISTINCT [Consolidated Channels],','),'*TPO*'),
        'Account Executive~1|Broker Lender Name~0|',
        ''
    ),
    ''
)
```

## Implementation Steps

1. **Select the actor dropdown object** (`9894dbd4-8ef5-411e-aab9-accb9613c716` or `dfbbbf6a-8bb5-451d-bcef-31f966cc047f`)

2. **Properties → Data → Values**

3. **Change from**: Static values or variable references

4. **Change to**: Use **Values Expression** with one of the options above

5. **Recommended**: Use **Option 4** (checks Consolidated Channels field)

## Expected Behavior

### Scenario 1: Only Retail Channel Selected
- Selected: "Banked - Retail"
- Shows: `Branch~1|Loan Officer~0`

### Scenario 2: Only TPO Channel Selected  
- Selected: "Banked - Wholesale"
- Shows: `Account Executive~1|Broker Lender Name~0`

### Scenario 3: Both Channel Types Selected
- Selected: "Banked - Retail" AND "Banked - Wholesale" (if multiple selection allowed)
- Shows: `Branch~1|Loan Officer~0|Account Executive~1|Broker Lender Name~0`

## Alternative: Separate Value Fields

If the dropdown uses separate Value 1 and Value 0 fields instead of a Values Expression:

**Value 1 (Organization Actor):**
```qlik
=If(WildMatch(Concat(DISTINCT [Consolidated Channels],','),'*Retail*'),'Branch','') & 
 If(WildMatch(Concat(DISTINCT [Consolidated Channels],','),'*TPO*'),'Account Executive','')
```

**Value 0 (Individual Actor):**
```qlik
=If(WildMatch(Concat(DISTINCT [Consolidated Channels],','),'*Retail*'),'Loan Officer','') & 
 If(WildMatch(Concat(DISTINCT [Consolidated Channels],','),'*TPO*'),'Broker Lender Name','')
```

But this won't work well for dropdowns - you need a single Values Expression that returns the pipe-delimited list.

## Testing

After implementing:
1. Select "Banked - Retail" → Should show Branch and Loan Officer
2. Select "Banked - Wholesale" → Should show Account Executive and Broker Lender Name
3. If you can select multiple channels and both types are selected → Should show all four options
