# Actor Dropdown - Correct Format (Value~DisplayText)

## Correct Format
In Qlik Sense variable inputs, the format is: **`Value~DisplayText`** not `DisplayText~Value`

## Corrected Values Expression

**Values Expression:**
```qlik
=If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*') AND WildMatch(GetFieldSelections(Channel),'*Wholesale*','*Corresp*'),
    '1~Branch|0~Loan Officer|1~Account Executive|0~Broker Lender Name',
    If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'),
        '1~Branch|0~Loan Officer',
        If(WildMatch(GetFieldSelections(Channel),'*Wholesale*','*Corresp*'),
            '1~Account Executive|0~Broker Lender Name',
            '1~Branch|0~Loan Officer|1~Account Executive|0~Broker Lender Name'
        )
    )
)
```

## Wait - Problem with Multiple Values

Actually, if you have multiple options with the same value (1 or 0), Qlik will only show one. You need to use **different values** for each actor type.

## Better Solution: Use Different Values

Since `vTopTieringShow` is binary (1 or 0), but you want to show different actors, you might need to rethink the approach:

### Option 1: Use Different Variable Values
- 1 = Branch (Retail)
- 2 = Account Executive (TPO)  
- 0 = Loan Officer (Retail)
- 3 = Broker Lender Name (TPO)

**Values Expression:**
```qlik
=If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*') AND WildMatch(GetFieldSelections(Channel),'*Wholesale*','*Corresp*'),
    '1~Branch|0~Loan Officer|2~Account Executive|3~Broker Lender Name',
    If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'),
        '1~Branch|0~Loan Officer',
        If(WildMatch(GetFieldSelections(Channel),'*Wholesale*','*Corresp*'),
            '2~Account Executive|3~Broker Lender Name',
            '1~Branch|0~Loan Officer|2~Account Executive|3~Broker Lender Name'
        )
    )
)
```

But this would require changing `vTopTieringShow` to support values 0,1,2,3 instead of just 0,1.

### Option 2: Keep Binary Values, Use Separate Dropdowns

Keep `vTopTieringShow` as 1/0, but show different labels based on channel:

**Values Expression:**
```qlik
=If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'),
    '1~Branch|0~Loan Officer',
    '1~Account Executive|0~Broker Lender Name'
)
```

This shows:
- If Retail selected: "Branch" (1) and "Loan Officer" (0)
- If TPO selected: "Account Executive" (1) and "Broker Lender Name" (0)
- If both: Shows based on first match (might need refinement)

### Option 3: Use Concat to Build List (If Both Selected)

```qlik
=Concat(
    If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'),
        '1~Branch|0~Loan Officer|',
        ''
    ) &
    If(WildMatch(GetFieldSelections(Channel),'*Wholesale*','*Corresp*'),
        '1~Account Executive|0~Broker Lender Name|',
        ''
    ),
    ''
)
```

But this still has the problem of duplicate values (1 and 0 appear twice).

## Recommended: Option 2 (Simplest)

Use **Option 2** - it's the simplest and works with existing `vTopTieringShow` variable:

**Values Expression:**
```qlik
=If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'),
    '1~Branch|0~Loan Officer',
    '1~Account Executive|0~Broker Lender Name'
)
```

If both channel types are selected, it will show based on which WildMatch evaluates first. To handle both, you'd need different values (Option 1).
