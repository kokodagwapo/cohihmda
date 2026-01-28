# Units Count Discrepancy Investigation

## Issue

The **Units count** in the middle container (`apDPDzJ`) on the **TopTiering sheet** shows a different number than the **Originated Loans count** on the **Company Performance Overview** sheet, even though both are filtered on the same timeframe (last year).

---

## How to Investigate

### Step 1: Find the Units Chart Expression

**In Qlik Sense:**

1. Open the Performance app
2. Go to **TopTiering** sheet
3. Edit the sheet (click Edit)
4. Click on the **Units chart** in the middle container (`apDPDzJ`)
5. Look at the **Measure** expression

**Common Units expressions:**
- `Count([Loan Number])`
- `Count(Distinct [Loan Number])`
- `Sum([Units])` (if Units is a field)
- `Count({$<[DateType]={'Funding'},...>}[Loan Number])`

### Step 2: Find the Originated Loans Expression

**In Qlik Sense:**

1. Go to **Company Performance Overview** sheet
2. Edit the sheet
3. Click on the **Originated Loans** object (ID: `qlik-compound-context-390a4173-cce6-4921-a3ad-927e18e66cb3-link-a93071c3-ab9b-4574-ad26-f5591a2c52a3-qlik`)
4. Look at the **Measure** expression

**Common Originated Loans expressions:**
- `Count({$<DateType={'Application'},...>}[Loan Number])`
- `Count({$<DateType={'Funding'},...>}[Loan Number])`
- `Count(Distinct [Loan Number])`

---

## Common Causes of Discrepancy

### 1. **Different DateType Filters**

**TopTiering Units Chart might use:**
- `DateType={'Funding'}` (funded loans)
- `DateType={'Application'}` (applied loans)
- No DateType filter

**Company Performance Overview might use:**
- `DateType={'Application'}` (applied loans)
- `DateType={'Funding'}` (funded loans)

**Check**: Look for `DateType` in the set analysis expressions.

### 2. **Different Set Analysis Filters**

**TopTiering Units Chart might have:**
- Additional filters on `[Consolidated Channels]`
- Filters on `[$(vScorecard)]` or `[$(vScorecardActor)]`
- Filters on `[$(vToDate)]={'Yes'}`
- Filters on `[Rate Lock Buy Side Base Price Rate]`
- Filters on production flags

**Company Performance Overview might have:**
- Different or no channel filters
- Different production filters
- Different date filters

**Check**: Compare the full set analysis expressions between both charts.

### 3. **Different Aggregation Methods**

**TopTiering Units Chart might use:**
- `Count([Loan Number])` - counts all rows
- `Count(Distinct [Loan Number])` - counts unique loans
- `Sum([Units])` - sums a Units field

**Company Performance Overview might use:**
- `Count(Distinct [Loan Number])` - counts unique loans
- `Count([Loan Number])` - counts all rows

**Check**: Look for `Distinct` keyword or `Sum` vs `Count`.

### 4. **Different Dimensions**

**TopTiering Units Chart:**
- Dimensioned by `[$(vScorecard)]` or `[$(vScorecardActor)]`
- This groups loans by Branch, Loan Officer, Account Executive, or Broker Lender Name
- **The Units count might be showing a TOTAL across all dimensions**, not individual dimension values

**Company Performance Overview:**
- Might not have the same dimension
- Might show total count without grouping

**Check**: Look at the chart dimensions and whether the Units count is a total or per-dimension value.

### 5. **Different Time Filters**

**Both say "last year" but might use:**
- Different date fields (`[Application Date]` vs `[Funding Date]` vs `[Rate Lock Date]`)
- Different date range calculations
- Different `[$(vToDate)]` filters

**Check**: Compare the date filter expressions.

### 6. **Missing Data Filter**

**TopTiering Units Chart might exclude:**
- Loans with missing actor values
- Loans with certain channel types
- Loans with certain statuses

**Company Performance Overview might include:**
- All loans regardless of actor
- All loans regardless of channel

**Check**: Look for filters like `[$(vScorecard)]<>''` or `[$(vScorecardActor)]<>''`.

---

## How to Fix

### Option 1: Make Units Match Originated Loans

**If Originated Loans is the "source of truth":**

1. Copy the exact expression from **Company Performance Overview** → **Originated Loans**
2. Paste it into the **TopTiering** → **Units chart** measure
3. Ensure all filters match (DateType, date range, etc.)

### Option 2: Document the Difference

**If the difference is intentional:**

1. Document why Units differs from Originated Loans
2. Add a note/tooltip explaining the difference
3. Update chart title to clarify what it's counting (e.g., "Funded Units" vs "Applied Units")

### Option 3: Use Same Expression

**If both should show the same:**

1. Create a variable for the Units/Originated Loans expression
2. Use that variable in both charts
3. Ensures consistency

---

## Example Investigation Steps

### Step 1: Export Chart Expressions

**In Qlik Sense:**

1. Right-click on **TopTiering** sheet → **Export** → **Sheet**
2. Open the exported file
3. Find the Units chart in container `apDPDzJ`
4. Copy the measure expression

**Repeat for Company Performance Overview sheet**

### Step 2: Compare Expressions Side-by-Side

Create a comparison document:

| Aspect | TopTiering Units | Company Performance Originated Loans |
|--------|------------------|--------------------------------------|
| **Expression** | `Count(...)` | `Count(...)` |
| **DateType Filter** | `DateType={'Funding'}` | `DateType={'Application'}` |
| **Date Range** | Last year | Last year |
| **Channel Filter** | `[Consolidated Channels]={'$(vChannelGroup)'}` | None |
| **Actor Filter** | `[$(vScorecard)]` dimension | None |
| **Distinct** | Yes/No | Yes/No |

### Step 3: Test with Same Filters

**Create a test chart:**

1. Copy the Units expression from TopTiering
2. Remove all filters except date range
3. Compare count to Originated Loans
4. Add filters back one by one to see which causes the difference

---

## Next Steps

1. **Get the actual expressions** from both charts (see Step 1 above)
2. **Compare them side-by-side** (see Step 2 above)
3. **Identify the difference** (DateType, filters, aggregation method, etc.)
4. **Decide on fix** (make them match, document difference, or use same variable)

---

## Questions to Answer

1. **What is the exact expression** for the Units chart in `apDPDzJ`?
2. **What is the exact expression** for Originated Loans on Company Performance Overview?
3. **What is the difference** between the two expressions?
4. **Which one is correct** (or are both correct but measuring different things)?
5. **Should they match** or is the difference intentional?

---

## Common Units Expression Patterns

Based on the codebase, here are common patterns:

```qlik
// Simple count
Count([Loan Number])

// Distinct count
Count(Distinct [Loan Number])

// With set analysis
Count({$<DateType={'Funding'},[$(vToDate)]={'Yes'}>}[Loan Number])

// With channel filter
Count({$<DateType={'Funding'},[Consolidated Channels]={'$(vChannelGroup)'}>}[Loan Number])

// With actor filter
Count({$<DateType={'Funding'},[$(vScorecard)]*={$(vCurrentProduction)}>}[Loan Number])
```

---

## **FOUND: The Actual Difference**

Based on the `Frontend TTS.md` documentation, here are the **actual expressions**:

### **TopTiering Units Chart** (Middle Container `apDPDzJ`)

**Expression:**
```qlik
count({
    {$<
    [$(vScorecard)_Production] _= {$(vCurrentProduction)},
    DateType={'Funding'},
    [$(vToDate)]={'Yes'},
    [Rate Lock Buy Side Base Price Rate] = {">0"} >
    }
    [Loan Number]
})
```

**Key Filters:**
- ✅ `DateType={'Funding'}` - **Funded loans only**
- ✅ `[$(vScorecard)_Production] _= {$(vCurrentProduction)}` - **Actor production flag**
- ✅ `[Rate Lock Buy Side Base Price Rate] = {">0"}` - **Only loans with rate lock > 0**
- ✅ `[$(vToDate)]={'Yes'}` - **Date range filter**

**What it counts:** Loans that were **funded** (not just applied) with a rate lock > 0, filtered by the selected actor (Branch/Loan Officer/Account Executive/Broker Lender Name).

---

### **Company Performance Overview Originated Loans**

**Expression:**
```qlik
Count({
    $<
    DateType={'Application'},
    [$(vToDate)]={'Yes'}, 
    [Pull Through Originated Flag]_={'Yes'},
    [Consolidated Channels]={'$(vChannelGroup)'}
    >
    }[Loan Number])
```

**Key Filters:**
- ✅ `DateType={'Application'}` - **Application date** (not funding date)
- ✅ `[Pull Through Originated Flag]_={'Yes'}` - **Only originated loans**
- ✅ `[Consolidated Channels]={'$(vChannelGroup)'}` - **Channel filter**
- ✅ `[$(vToDate)]={'Yes'}` - **Date range filter**
- ❌ **No actor filter** - Shows all loans regardless of Branch/Loan Officer/etc.

**What it counts:** Loans that were **applied** (not funded) and **originated**, filtered by channel but **not by actor**.

---

## **Why They're Different**

| Aspect | TopTiering Units | Company Performance Originated Loans |
|--------|------------------|--------------------------------------|
| **DateType** | `'Funding'` (funded date) | `'Application'` (application date) |
| **Status Filter** | `Rate Lock Buy Side Base Price Rate > 0` | `Pull Through Originated Flag = 'Yes'` |
| **Actor Filter** | ✅ Yes - filters by `[$(vScorecard)_Production]` | ❌ No - shows all actors |
| **Channel Filter** | ❌ No (or implicit via actor) | ✅ Yes - `[Consolidated Channels]={'$(vChannelGroup)'}` |

### **Key Differences:**

1. **DateType = 'Funding' vs 'Application'**
   - TopTiering counts loans by **funding date**
   - Company Performance counts loans by **application date**
   - These can be different if loans are funded in a different period than they were applied

2. **Rate Lock Filter**
   - TopTiering only counts loans with `Rate Lock Buy Side Base Price Rate > 0`
   - Company Performance doesn't have this filter
   - This excludes loans without rate locks from TopTiering

3. **Actor Filter**
   - TopTiering filters by the selected actor (`[$(vScorecard)_Production]`)
   - Company Performance shows **all** loans regardless of actor
   - If you're viewing TopTiering filtered to a specific Branch/Loan Officer, it will only show loans for that actor

4. **Originated Flag**
   - Company Performance filters by `Pull Through Originated Flag = 'Yes'`
   - TopTiering doesn't have this filter
   - Company Performance excludes non-originated loans

---

## **Which One is Correct?**

**Both are correct, but they measure different things:**

- **TopTiering Units**: Counts **funded loans** (by funding date) with rate locks, filtered by selected actor
- **Company Performance Originated Loans**: Counts **applied loans** (by application date) that were originated, for all actors

**They will naturally differ because:**
1. Funding date ≠ Application date
2. Rate lock filter excludes some loans
3. Actor filter limits TopTiering to selected actor
4. Originated flag filter limits Company Performance to originated loans only

---

## **How to Make Them Match (If Needed)**

### Option 1: Make TopTiering Match Company Performance

**Change TopTiering Units expression to:**
```qlik
Count({
    $<
    DateType={'Application'},
    [$(vToDate)]={'Yes'}, 
    [Pull Through Originated Flag]_={'Yes'},
    [Consolidated Channels]={'$(vChannelGroup)'}
    >
    }[Loan Number])
```

**But this removes the actor filter**, so you'd need to add it back:
```qlik
Count({
    $<
    DateType={'Application'},
    [$(vToDate)]={'Yes'}, 
    [Pull Through Originated Flag]_={'Yes'},
    [Consolidated Channels]={'$(vChannelGroup)'},
    [$(vScorecard)_Production] _= {$(vCurrentProduction)}
    >
    }[Loan Number])
```

### Option 2: Make Company Performance Match TopTiering

**Change Company Performance expression to:**
```qlik
Count({
    $<
    DateType={'Funding'},
    [$(vToDate)]={'Yes'},
    [Rate Lock Buy Side Base Price Rate] = {">0"}
    >
    }[Loan Number])
```

**But this removes the originated filter**, so you'd need to decide if that's acceptable.

### Option 3: Keep Both (Recommended)

**Document the difference** and explain why they differ:
- TopTiering shows **funded units** by actor
- Company Performance shows **originated units** for all actors

This is likely intentional - TopTiering is focused on performance by actor, while Company Performance shows overall originated loans.
