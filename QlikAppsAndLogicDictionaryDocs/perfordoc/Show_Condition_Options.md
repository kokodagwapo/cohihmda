# Show Condition Options for Testing Channel Logic

## Current Show Condition
```qlik
=if(vConsolidatedChannels='TPO',1,0)
```

## Problem
Since `vConsolidatedChannels` is now set to `'All'`, this condition will always be false, hiding containers that should show for TPO channels.

## Solution Options

### Option 1: Check Selected Channel Variable (Recommended for Testing)
If you're using `vTopTieringChannel` to select specific channels, check that variable:

**Show when TPO channel is selected:**
```qlik
=if(WildMatch('$(vTopTieringChannel)','*Wholesale*','*Corresp*'),1,0)
```

**Show when Retail channel is selected:**
```qlik
=if(WildMatch('$(vTopTieringChannel)','*Retail*','*Brok*'),1,0)
```

**Show when ANY channel is selected (always show):**
```qlik
=1
```

### Option 2: Check Actual Data Channels (More Dynamic)
Check what channels actually exist in the current data selection:

**Show if data contains TPO channels:**
```qlik
=if(WildMatch(Concat(DISTINCT Channel,','),'*Wholesale*','*Corresp*'),1,0)
```

**Show if data contains Retail channels:**
```qlik
=if(WildMatch(Concat(DISTINCT Channel,','),'*Retail*','*Brok*'),1,0)
```

**Show if Consolidated Channels contains TPO:**
```qlik
=if(WildMatch(Concat(DISTINCT [Consolidated Channels],','),'*TPO*'),1,0)
```

### Option 3: Check Both Selected Channel AND Data
Combine variable check with data check:

**Show if TPO channel selected OR data contains TPO:**
```qlik
=if(WildMatch('$(vTopTieringChannel)','*Wholesale*','*Corresp*') OR WildMatch(Concat(DISTINCT [Consolidated Channels],','),'*TPO*'),1,0)
```

## Recommended Approach for Testing

Since you want to test by selecting specific channels, use **Option 1** with `vTopTieringChannel`:

### For TPO-specific containers:
```qlik
=if(WildMatch('$(vTopTieringChannel)','*Wholesale*','*Corresp*'),1,0)
```

### For Retail-specific containers:
```qlik
=if(WildMatch('$(vTopTieringChannel)','*Retail*','*Brok*'),1,0)
```

### For containers that should show for both:
```qlik
=1
```

## Channel Pattern Matching

Based on `Transform.qvs` logic:
- **Retail channels**: Match `'*Retail*'` or `'*Brok*'` → Consolidated Channels = 'Retail'
- **TPO channels**: Match `'*Wholesale*'` or `'*Corresp*'` → Consolidated Channels = 'TPO'

## Testing Steps

1. **Update show condition** to check `vTopTieringChannel`:
   ```qlik
   =if(WildMatch('$(vTopTieringChannel)','*Wholesale*','*Corresp*'),1,0)
   ```

2. **Select "Banked - Wholesale"** in channel dropdown → Container should show
3. **Select "Banked - Retail"** in channel dropdown → Container should hide
4. **Select "Correspondent"** in channel dropdown → Container should show
5. **Select "Brokered"** in channel dropdown → Container should hide

This will help verify:
- Channel selection is working
- Show conditions are evaluating correctly
- Data is filtering properly for each channel
