# Email Response Draft - Qlik to Coheus Conversion Review

**Subject**: Qlik to Coheus Conversion - Review & Alignment Opportunities

---

Hi [Developer Name],

Thank you for all the great work on the Qlik to Coheus conversion tool. I've reviewed the mapping tool, formulas, and module plans, and wanted to share some observations where we can align before moving forward.

## Observation #1: PostgreSQL Conversion Opportunity

I noticed that the `qlik-formulas.json` file includes "PostgreSQL Equivalent" fields, but they're still using Qlik syntax rather than actual SQL. This is totally understandable given how complex Qlik's Set Analysis can be.

**Example I noticed**:
```json
"PostgreSQL Equivalent": "Sum({<DateType*={Closing}, \"Closing Projection Status\"*={'Closed Current Month'}...>}\"Loan Amount\")"
```

The Set Analysis syntax (`{<...>}`) is Qlik-specific, so we'll need to convert these to SQL WHERE clauses. I've documented some conversion patterns in `logic-dictionary/patterns/set-analysis.md` that might be helpful as we work through these together.

**What we'll need to convert**:
- Set Analysis → SQL WHERE clauses
- Qlik variables (`$(vName)`) → SQL parameters (`:name`)
- Field references → actual PostgreSQL column names

Happy to work through these conversions together.

---

## Critical Issue #2: Confusion Between Source Fields and Derived Fields

There's a fundamental misunderstanding about what fields come from Encompass versus what fields are calculated from Encompass data.

### Source Fields (From Encompass)
**Definition**: Fields that come directly from the Encompass loan system  
**Source**: `data-dictionary/CoheusDataDictionary.xml`  
**Format**: `Fields.XXX` → Coheus Alias → PostgreSQL column

**Examples**:
- `Fields.2` → `Loan Amount` (source field)
- `Fields.3142` → `Application Date` (source field)
- `Fields.353` → `LTV Ratio` (source field)

### Derived/Calculated Fields (NOT from Encompass)
**Definition**: Fields calculated from source fields using business logic  
**Source**: Logic Dictionary (`logic-dictionary/derived/`, `logic-dictionary/concepts/`)  
**Format**: Calculated using formulas from source fields

**Examples**:
- `Revenue` - **NOT in Encompass XML** - Calculated from: `Base Buy ($)` + `Orig Fee Borr Pd` + `Orig Fees Seller` - `CD Lender Credits`
- `Pull Through Rate` - **NOT in Encompass XML** - Calculated from: `(Funded Loans / Application Loans) * 100`
- `Turn Time` - **NOT in Encompass XML** - Calculated from: `End Date - Start Date`
- `Margin (BPS)` - **NOT in Encompass XML** - Calculated from: `(Revenue / Loan Amount) * 10000`

### What I Noticed

In the migration JSON (`coheus-complete-migration.json`), I saw some derived/calculated fields listed alongside source fields. For example:

- **Turn Time Fields**: "First Turn Time", "Second Turn Time", etc. - These are calculated (date differences), not direct Encompass fields
- **Pull Through Fields**: "Pull Through Rate", "Channel Pull Through Rate" - These are calculated (percentages), not direct Encompass fields  
- **Revenue Fields**: "Revenue", "Margin (BPS)" - These are calculated from other fields, not direct Encompass fields

Since these don't exist as direct fields in Encompass, they wouldn't have "ICE Encompass Field ID" entries. It might be helpful to separate these out so we can clearly distinguish what comes from Encompass vs. what we calculate.

---

## Observation #3: Some Source Fields Marked as Calculated

I noticed a few fields that are actually source fields from Encompass are marked as "calculated" in the migration JSON. This is easy to mix up since some of these fields can also be calculated manually!

**Example - LTV Ratio**:
- In our data dictionary: `LTV Ratio` maps to `Fields.353`, which means it comes directly from Encompass
- In the migration JSON: It's marked as "Calculated from loan_amount / property_value"
- In our Qlik scripts: We use `[LTV Ratio]` directly from Encompass data

**Example - BE DTI Ratio**:
- In our data dictionary: `BE DTI Ratio` maps to `Fields.742`, which means it comes directly from Encompass
- In the migration JSON: It's marked as "Calculated from monthly_debt / monthly_income"

A helpful rule of thumb: If a field has a `Fields.XXX` ID in the data dictionary (`CoheusDataDictionary.xml`), it's a source field that comes directly from Encompass, even if it could theoretically be calculated from other fields.

---

## Suggestions for Alignment

I thought it might be helpful to share some ideas on how we could structure this to make it clearer. Totally open to discussion on the best approach!

### 1. Field Type Classification

It might be useful to add a `Field Type` field to help distinguish:
- `"Source"` - Fields that come directly from Encompass (have `Fields.XXX` ID in data dictionary)
- `"Derived"` - Fields we calculate from source fields (not direct Encompass fields)

### 2. Separating Source Fields from Derived Fields

**For Source Fields** (`coheus-complete-migration.json`):
- These would be fields from `data-dictionary/CoheusDataDictionary.xml`
- Map `Fields.XXX` → PostgreSQL column names
- Keep derived fields like Revenue, Pull Through, Turn Time separate

**For Derived Fields** (`qlik-formulas.json`):
- Document the formulas for calculated fields
- Show how they're built from source fields
- Include proper PostgreSQL conversions (actual SQL)
- Reference the logic dictionary for complete formulas

### 3. PostgreSQL Conversions

**For Source Fields**:
- Straightforward mapping: `Fields.XXX` → PostgreSQL column name

**For Derived Fields**:
- Show the calculation formula using source fields
- Convert Qlik syntax to actual PostgreSQL/SQL (we can work through these together)
- Reference logic dictionary documentation for complete context

### 4. Leveraging the Logic Dictionary

We've built out a comprehensive logic dictionary that might be helpful to reference:
- **Source Fields**: `data-dictionary/CoheusDataDictionary.xml` - complete mapping of Encompass fields
- **Derived Logic**: `logic-dictionary/derived/revenue-calculations.md`, `logic-dictionary/derived/pull-through-calculations.md`, etc. - formulas and calculations
- **Formulas**: All formulas with source field references documented

---

## Examples of Correct Structure

### Source Field (Encompass Only)
```json
{
  "Field Name": "Loan Amount",
  "Field Type": "Source",
  "ICE Encompass Field ID": "Fields.2",
  "Coheus Alias": "Loan Amount",
  "PostgreSQL Column": "loan_amount",
  "Data Type": "DECIMAL(12,2)",
  "Source": "Encompass - Direct field"
}
```

### Derived Field (Calculated Only)
```json
{
  "Field Name": "Revenue",
  "Field Type": "Derived",
  "ICE Encompass Field ID": null,
  "Coheus Alias": "Revenue",
  "PostgreSQL Column": "revenue",
  "Data Type": "DECIMAL(12,2)",
  "Source": "Calculated",
  "Formula": "base_buy_dollars + orig_fee_borr_pd + orig_fees_seller - cd_lender_credits",
  "Source Fields": [
    "Base Buy ($) (Fields.2203)",
    "Orig Fee Borr Pd (Fields.NEWHUD.X686)",
    "Orig Fees Seller (Fields.559)",
    "CD Lender Credits (Fields.CD2.XSTLC)"
  ],
  "Logic Dictionary Reference": "logic-dictionary/derived/revenue-calculations.md",
  "PostgreSQL Equivalent": "SELECT SUM(COALESCE(base_buy_dollars, 0) + COALESCE(orig_fee_borr_pd, 0) + COALESCE(orig_fees_seller, 0) - COALESCE(cd_lender_credits, 0)) as revenue FROM loans"
}
```

### Source Field (Encompass - Corrected Example)
```json
{
  "Field Name": "LTV Ratio",
  "Field Type": "Source",
  "ICE Encompass Field ID": "Fields.353",
  "Coheus Alias": "LTV Ratio",
  "PostgreSQL Column": "ltv_ratio",
  "Data Type": "DECIMAL(5,2)",
  "Source": "Encompass - Direct field (Fields.353)",
  "Note": "The migration JSON incorrectly marked this as 'calculated'. This is a source field from Encompass."
}
```

---

## Next Steps - Let's Work Together

I've put together a detailed analysis document (`logic-dictionary/validation/migration-json-analysis.md`) that breaks down these observations. Here's what I'm thinking we could tackle together:

1. **Review the analysis document** - I've documented everything in detail so we can discuss and align

2. **Clarify source vs. derived fields**:
   - Source fields → `coheus-complete-migration.json` (Encompass fields)
   - Derived fields → `qlik-formulas.json` (with PostgreSQL conversions)

3. **Work through PostgreSQL conversions**:
   - Convert Set Analysis to SQL WHERE clauses
   - Convert Qlik variables to SQL parameters
   - Resolve field references to actual column names
   - Document how derived fields are built from source fields

4. **Add field type classification**:
   - Mark each field as Source/Derived (we can verify against the data dictionary together)
   - Make sure source fields are correctly identified

5. **Reference the logic dictionary**:
   - Link to the comprehensive documentation we've built
   - Use it as our source of truth for calculations

6. **Verify Encompass field IDs**:
   - Cross-reference with the actual Encompass system
   - Make sure all `Fields.XXX` IDs match what's available

---

## Priority Actions

**Before we can proceed with implementation**:

1. ✅ **Fix PostgreSQL conversions** - Convert Qlik syntax to actual SQL
2. ✅ **Separate source vs derived fields** - Clear distinction in migration JSON
3. ✅ **Add field type classification** - Source/Derived (verify against data dictionary)
4. ✅ **Reference logic dictionary** - Use comprehensive documentation as source of truth

Once these issues are addressed, we can move forward with:
- Connecting to real data
- Building the ETL pipeline
- Powering up the dashboards

---

## Resources

- **Logic Dictionary**: `logic-dictionary/README.md` (overview and structure)
- **Data Dictionary**: `data-dictionary/CoheusDataDictionary.xml` (source fields)
- **Analysis Document**: `logic-dictionary/validation/migration-json-analysis.md` (detailed issues)
- **Revenue Formulas**: `logic-dictionary/concepts/revenue.md` (example of derived field documentation)
- **Source Fields Guide**: `logic-dictionary/patterns/source-fields.md` (how to reference source fields)

I know this is a lot of information, and I really appreciate your patience as we work through this together. The distinction between source and derived fields can be tricky, especially when some fields could theoretically be calculated even though they come directly from Encompass.

Please take a look at these resources when you have a chance, and let's schedule some time to discuss. I'm happy to walk through any of this, help with the PostgreSQL conversions, or clarify anything that's unclear. This is a complex migration, and I want to make sure we're all aligned and set up for success.

Looking forward to working through this together!

Thanks,
[Your Name]
