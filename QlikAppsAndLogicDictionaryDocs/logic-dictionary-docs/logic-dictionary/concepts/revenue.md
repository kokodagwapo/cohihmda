# Revenue - Base Concept

## Definition

Revenue represents the total financial gain from loan origination and sale. It aggregates fees collected from borrowers and gains from selling loans to investors.

## Source Fields

Revenue calculations use fields from the [Coheus Data Dictionary](../data-dictionary/CoheusDataDictionary.xml):

**Origination Revenue Fields**:
- `Origination Points` (Encompass: `Fields.NEWHUD.X1151`)
- `Orig Fee Borr Pd` (Encompass: `Fields.NEWHUD.X686`)
- `Orig Fees Seller` (Encompass: `Fields.559`)
- `CD Lender Credits` (Encompass: `Fields.CD2.XSTLC`)

**Secondary Revenue Fields**:
- `PA Sell Amt` (Encompass: `Fields.3424`)
- `PA SRP Amt` (Encompass: `Fields.3428`)
- `PA Payout 1` through `PA Payout 12` (Encompass: `Fields.2373` - `Fields.2395`)

**Buy/Sell Price Fields**:
- `Net Buy` (Encompass: `Fields.2203`)
- `Net Sell` (Encompass: `Fields.2274`)
- `Rate Lock Buy Side Base Price Rate` (Encompass: `Fields.2161`)

**Loan Amount Field**:
- `Loan Amount` (Encompass: `Fields.2`)

**See**: `patterns/source-fields.md` for complete data dictionary integration guide.

## Core Formula

```
Total Revenue = Origination Revenue + Secondary Revenue
```

Where all components are built from source fields listed above.

## Components

### Origination Revenue

Fees collected during loan origination, minus lender credits.

**Source Fields**:
- `Origination Points` (Fields.NEWHUD.X1151)
- `Orig Fee Borr Pd` (Fields.NEWHUD.X686)
- `Orig Fees Seller` (Fields.559)
- `CD Lender Credits` (Fields.CD2.XSTLC) - negative component

**Formula**: 
```
Origination Revenue = Origination Points + Orig Fee Borr Pd + Orig Fees Seller - CD Lender Credits
```

### Secondary Revenue

Gains from selling loans to investors (Gain on Sale), less fees paid to investors.

**Source Fields**:
- `PA Sell Amt` (Fields.3424) - Purchase Advice Sell Amount
- `PA SRP Amt` (Fields.3428) - Purchase Advice Service Release Premium
- `PA Payout 1` through `PA Payout 12` (Fields.2373 - Fields.2395) - sum of all payouts

**Formula**:
```
Secondary Revenue = PA Sell Amt + PA SRP Amt + PA Payouts
```

## Revenue Variations

### Buy Price Contribution

Revenue including base buy price:
```
Buy Price Contribution = Origination Revenue + Base Buy ($)
```

### Sell Price Contribution

Revenue including net sell price:
```
Sell Price Contribution = Origination Revenue + Net Sell ($)
```

### Base Buy ($) / Net Buy ($) / Net Sell ($)

Conversion from basis points to dollars.

**Source Fields**:
- `Net Buy` (Fields.2203) or `Rate Lock Buy Side Base Price Rate` (Fields.2161)
- `Net Sell` (Fields.2274)
- `Loan Amount` (Fields.2)

**Formula**:
```
Buy/Sell ($) = ((Buy/Sell Price - 100) / 100) * Loan Amount
```

Where:
- 100 = par (no premium/discount)
- 101 = 1% premium
- 99 = 1% discount

## SQL Implementation

**Note**: PostgreSQL column names use snake_case (e.g., `origination_points`), converted from Coheus aliases (e.g., `Origination Points`).

```sql
-- Origination Revenue
-- Source: Origination Points (Fields.NEWHUD.X1151) → origination_points
-- Source: Orig Fee Borr Pd (Fields.NEWHUD.X686) → orig_fee_borr_pd
-- Source: Orig Fees Seller (Fields.559) → orig_fees_seller
-- Source: CD Lender Credits (Fields.CD2.XSTLC) → cd_lender_credits
COALESCE(origination_points, 0) + 
COALESCE(orig_fee_borr_pd, 0) + 
COALESCE(orig_fees_seller, 0) - 
COALESCE(cd_lender_credits, 0) as origination_revenue

-- Secondary Revenue
-- Source: PA Sell Amt (Fields.3424) → pa_sell_amt
-- Source: PA SRP Amt (Fields.3428) → pa_srp_amt
-- Source: PA Payout 1-12 (Fields.2373-2395) → pa_payout_1 through pa_payout_12
COALESCE(pa_sell_amt, 0) + 
COALESCE(pa_srp_amt, 0) + 
COALESCE(pa_payout_1, 0) + COALESCE(pa_payout_2, 0) + ... + COALESCE(pa_payout_12, 0) as secondary_revenue

-- Total Revenue
COALESCE(origination_revenue, 0) + COALESCE(secondary_revenue, 0) as total_revenue

-- Base Buy ($)
-- Source: Rate Lock Buy Side Base Price Rate (Fields.2161) → base_buy_price_rate
-- Source: Loan Amount (Fields.2) → loan_amount
CASE 
    WHEN base_buy_price_rate = 0 OR base_buy_price_rate IS NULL THEN 0
    ELSE ROUND(((base_buy_price_rate - 100) / 100.0) * loan_amount, 2)
END as base_buy_dollars
```

## Business Rules

- All revenue components use NULL-safe addition (NULLs treated as 0)
- Basis points conversion: (value - 100) / 100 converts to percentage
- Revenue can be negative if lender credits exceed fees
- Secondary revenue only applies to loans sold to investors

## Dependencies

- Origination fee fields
- Purchase Advice fields
- Buy/Sell price fields
- Loan Amount (for basis points conversion)

## Used In

- All apps
- Profitability analysis
- Revenue reporting
- Contribution to Profit app

## See Also

- Derived logic: `derived/revenue-calculations.md` - Specific revenue formulas and variations
- Qlik implementation: `core/transform-logic.md#revenue-calculations`
- Patterns: `patterns/aggregation-patterns.md` - RangeSum pattern for NULL handling
