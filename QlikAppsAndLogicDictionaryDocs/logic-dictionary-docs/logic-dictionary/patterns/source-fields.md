# Source Fields - Data Dictionary Integration

## Overview

All formulas and calculations in the logic dictionary are built from **source fields** defined in the Coheus Data Dictionary. These source fields map Encompass field IDs to Coheus aliases, which will be used as PostgreSQL column names.

## Data Dictionary Structure

The data dictionary (`../data-dictionary/CoheusDataDictionary.xml`) maps:
- **Encompass Field ID** → **Coheus Alias** (PostgreSQL column name)

Example:
```xml
<Field Id="Fields.3142" Alias="Application Date" />
<Field Id="Fields.MS.FUN" Alias="Funding Date" />
<Field Id="Fields.748" Alias="Closing Date" />
```

## How Logic Dictionary References Source Fields

### Field Naming Convention

- **In formulas**: Use Coheus Alias (matches PostgreSQL column name)
- **For traceability**: Reference Encompass Field ID when documenting

### Example: Turn Time Calculation

**Source Fields** (from data dictionary):
- `Application Date` (Encompass: `Fields.3142`)
- `Funding Date` (Encompass: `Fields.MS.FUN`)

**Formula**:
```sql
DATE(funding_date) - DATE(application_date) as app_fund_days
```

**Note**: PostgreSQL column names use snake_case (`application_date`), while Coheus aliases use Title Case (`Application Date`). The migration process will handle this conversion.

## Common Source Fields

### Date Fields
- `Application Date` (`Fields.3142`)
- `Funding Date` (`Fields.MS.FUN`)
- `Closing Date` (`Fields.748`)
- `Estimated Closing Date` (`Fields.763`)
- `Investor Purchase Date` (`Fields.2370`)
- `Shipped Date` (`Fields.2014`)
- `UW Final Approval Date` (`Fields.2301`)
- `CTC Date` (`Fields.2305`)

### Revenue Fields
- `Origination Points` (`Fields.NEWHUD.X1151`)
- `Orig Fee Borr Pd` (`Fields.NEWHUD.X686`)
- `Orig Fees Seller` (`Fields.559`)
- `CD Lender Credits` (`Fields.CD2.XSTLC`)
- `PA Sell Amt` (`Fields.3424`)
- `PA SRP Amt` (`Fields.3428`)
- `PA Payout 1` through `PA Payout 12` (`Fields.2373` - `Fields.2395`)

### Loan Amount Fields
- `Loan Amount` (`Fields.2`)
- `Base Loan Amount` (`Fields.1109`)

### Status Fields
- `Current Loan Status` (`Fields.1393`)
- `Current Status Date` (`Fields.749`)
- `Current Milestone` (`Fields.Log.MS.CurrentMilestone`)

## Using Source Fields in Formulas

### Pattern 1: Direct Field Reference

**Formula uses source field directly**:
```sql
-- Source: Loan Amount (Fields.2)
SELECT loan_amount FROM loans
```

### Pattern 2: Calculated from Source Fields

**Formula combines multiple source fields**:
```sql
-- Source: Origination Points (Fields.NEWHUD.X1151)
-- Source: Orig Fee Borr Pd (Fields.NEWHUD.X686)
-- Source: Orig Fees Seller (Fields.559)
-- Source: CD Lender Credits (Fields.CD2.XSTLC)
COALESCE(origination_points, 0) + 
COALESCE(orig_fee_borr_pd, 0) + 
COALESCE(orig_fees_seller, 0) - 
COALESCE(cd_lender_credits, 0) as origination_revenue
```

### Pattern 3: Date Calculations

**Formula uses date source fields**:
```sql
-- Source: Funding Date (Fields.MS.FUN)
-- Source: Application Date (Fields.3142)
DATE(funding_date) - DATE(application_date) as app_fund_days
```

## Documentation Standards

When documenting formulas in the logic dictionary:

1. **List source fields** at the top of each formula section
2. **Reference Encompass Field IDs** for traceability
3. **Use Coheus Aliases** in formula descriptions
4. **Show PostgreSQL column names** in SQL examples (snake_case)

### Example Documentation Format

```markdown
## App-Fund Turn Time

**Source Fields**:
- `Application Date` (Encompass: `Fields.3142`)
- `Funding Date` (Encompass: `Fields.MS.FUN`)

**Formula**:
```sql
DATE(funding_date) - DATE(application_date) as app_fund_days
```
```

## Field Name Conversion

### Coheus Alias → PostgreSQL Column Name

- **Title Case** → **snake_case**
- Spaces → underscores
- Special characters → removed or replaced

Examples:
- `Application Date` → `application_date`
- `Orig Fee Borr Pd` → `orig_fee_borr_pd`
- `CD Lender Credits` → `cd_lender_credits`
- `PA Sell Amt` → `pa_sell_amt`

## See Also

- **Data Dictionary**: `../data-dictionary/CoheusDataDictionary.xml` - Complete field mapping
- **PostgreSQL Mapping**: `migration/postgresql-mapping.md` - Function and type mappings
- **Base Concepts**: `concepts/` - Logic definitions that use source fields
