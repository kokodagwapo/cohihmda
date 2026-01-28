# Actor Dropdown - Using Field Selections (No vTopTieringChannel Needed)

## Solution: Check Channel Field Selections Directly

Instead of using `vTopTieringChannel`, check what channels are actually selected in the Channel field using `GetFieldSelections()` or `Only()`.

## Option 1: GetFieldSelections (Multiple Selections)

**Values Expression:**
```qlik
=Concat(
    If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'),
        'Branch~1|Loan Officer~0|',
        ''
    ) &
    If(WildMatch(GetFieldSelections(Channel),'*Wholesale*','*Corresp*'),
        'Account Executive~1|Broker Lender Name~0|',
        ''
    ),
    ''
)
```

**Or check Consolidated Channels:**
```qlik
=Concat(
    If(WildMatch(GetFieldSelections([Consolidated Channels]),'*Retail*'),
        'Branch~1|Loan Officer~0|',
        ''
    ) &
    If(WildMatch(GetFieldSelections([Consolidated Channels]),'*TPO*'),
        'Account Executive~1|Broker Lender Name~0|',
        ''
    ),
    ''
)
```

## Option 2: Only() Function (Single Selection)

If only one channel can be selected at a time:

**Values Expression:**
```qlik
=Concat(
    If(WildMatch(Only(Channel),'*Retail*','*Brok*'),
        'Branch~1|Loan Officer~0|',
        ''
    ) &
    If(WildMatch(Only(Channel),'*Wholesale*','*Corresp*'),
        'Account Executive~1|Broker Lender Name~0|',
        ''
    ),
    ''
)
```

**Or check Consolidated Channels:**
```qlik
=Concat(
    If(WildMatch(Only([Consolidated Channels]),'*Retail*'),
        'Branch~1|Loan Officer~0|',
        ''
    ) &
    If(WildMatch(Only([Consolidated Channels]),'*TPO*'),
        'Account Executive~1|Broker Lender Name~0|',
        ''
    ),
    ''
)
```

## Option 3: Check What Channels Exist in Current Data

If you want to check what channels are actually in the filtered data (regardless of selections):

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

**Note**: This might give "Nested aggregation" error if used in certain contexts.

## Recommended Approach

**If using a Channel field filter/list on the sheet:**
Use **Option 1** with `GetFieldSelections(Channel)`:
```qlik
=Concat(
    If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'),
        'Branch~1|Loan Officer~0|',
        ''
    ) &
    If(WildMatch(GetFieldSelections(Channel),'*Wholesale*','*Corresp*'),
        'Account Executive~1|Broker Lender Name~0|',
        ''
    ),
    ''
)
```

**If using a variable input for channel selection:**
You'll need to keep `vTopTieringChannel` OR link the variable input to filter the Channel field, then use `GetFieldSelections(Channel)`.

## Benefits of This Approach

1. ✅ **No need to update expressions** - Uses existing Channel field
2. ✅ **No new variables needed** - Checks actual field selections
3. ✅ **Works with any filtering method** - Field list, filter pane, or variable that filters Channel field
4. ✅ **Dynamic** - Automatically reflects current selections

## How It Works

- When Channel field has "Banked - Retail" selected → Shows Branch and Loan Officer
- When Channel field has "Banked - Wholesale" selected → Shows Account Executive and Broker Lender Name
- When Channel field has both selected → Shows all four options

## Implementation

1. **Add Channel field filter** to TopTiering sheet (if not already there)
2. **Update actor dropdown Values Expression** to use `GetFieldSelections(Channel)` or `Only(Channel)`
3. **No need to update chart expressions** - They can continue using Channel field directly

## Testing

1. Select "Banked - Retail" in Channel filter → Actor dropdown shows Branch and Loan Officer
2. Select "Banked - Wholesale" in Channel filter → Actor dropdown shows Account Executive and Broker Lender Name
3. Select both → Actor dropdown shows all four options
