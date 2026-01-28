# Revenue Calculations - Derived Logic

## Base Concept

This logic builds on the base revenue definition. See `concepts/revenue.md` for the core revenue concept and source fields.

## Source Fields

Revenue calculations use source fields from the [Coheus Data Dictionary](../../data-dictionary/CoheusDataDictionary.xml). See `concepts/revenue.md` for complete list of origination and secondary revenue fields.

**Additional Field for Margin Calculations**:
- `Loan Amount` (Encompass: `Fields.2`)

**See**: `patterns/source-fields.md` for complete data dictionary integration guide.

## Definition

Revenue calculations are specific formulas and variations that build on the base revenue components. These include app-specific revenue formulas, buy/sell price contributions, and margin calculations.

## Variations

### Total Revenue

**Base Components**: Origination Revenue + Secondary Revenue

**Formula**: 
```
Total Revenue = Origination Revenue + Secondary Revenue
```

**PostgreSQL**:
```sql
COALESCE(origination_revenue, 0) + COALESCE(secondary_revenue, 0) as total_revenue
```

### Buy Price Contribution

**Definition**: Revenue including base buy price

**Formula**:
```
Buy Price Contribution = Origination Revenue + Base Buy ($)
```

**PostgreSQL**:
```sql
COALESCE(origination_revenue, 0) + COALESCE(base_buy_dollars, 0) as buy_price_contribution
```

### Sell Price Contribution

**Definition**: Revenue including net sell price

**Formula**:
```
Sell Price Contribution = Origination Revenue + Net Sell ($)
```

**PostgreSQL**:
```sql
COALESCE(origination_revenue, 0) + COALESCE(net_sell_dollars, 0) as sell_price_contribution
```

### Margin (BPS) - Basis Points

**Definition**: Revenue as percentage of loan amount, expressed in basis points

**Source Fields**: 
- Revenue (calculated from base revenue components - see `concepts/revenue.md`)
- `Loan Amount` (Fields.2)

**Formula**:
```
Margin (BPS) = (Revenue / Loan Amount) * 10,000
```

**PostgreSQL**:
```sql
-- Source: Loan Amount (Fields.2) → loan_amount
CASE 
    WHEN loan_amount > 0 THEN
        (revenue / loan_amount) * 10000
    ELSE NULL
END as margin_bps
```

**Variations**:
- `Margin (BPS)` - Uses Revenue_Sales
- `Margin (BPS)_Exec` - Uses Revenue_Exec
- `Margin (BPS)_Ops` - Uses Revenue_Ops
- `Margin (BPS)_Contribution` - Uses Revenue_Contribution

### Revenue Configuration Logic

**Purpose**: Load revenue formulas from XML configuration, allowing clients to customize revenue calculations per app

**Source**: XML configuration (`Setup/CoheusConfig/Revenue/CoheusConfigRevenue`)

**Configuration Structure**:
```xml
<CoheusConfig>
    <Revenue>
        <CoheusConfigRevenue>
            <Name>Default</Name>
            <Formula>[Base Buy ($)]+[Orig Fee Borr Pd]+[Orig Fees Seller]-[CD Lender Credits]</Formula>
        </CoheusConfigRevenue>
        <CoheusConfigRevenue>
            <Name>Revenue_Sales</Name>
            <Formula>[Base Buy ($)]+[Orig Fee Borr Pd]+[Orig Fees Seller]</Formula>
        </CoheusConfigRevenue>
        <!-- Revenue_Executive, Revenue_Operations, Revenue_Contribution -->
    </Revenue>
</CoheusConfig>
```

### Formula Loading Logic

**Qlik Script**:
```qvs
// Load revenue formulas from XML configuration
IF '$(vFileExists)'=1 THEN
    RevCalcDefault:
    LOAD
        Formula as DefaultRevenueFormula
    From_Field(ConfigurationData,full_xml) 
    (XmlSimple, table is [Setup/CoheusConfig/Revenue/CoheusConfigRevenue])
    Where Name = 'Default';
    
    RevCalcExec:
    LOAD
        Formula as ExecRevenueFormula
    From_Field(ConfigurationData,full_xml) 
    (XmlSimple, table is [Setup/CoheusConfig/Revenue/CoheusConfigRevenue])
    Where Name = 'Revenue_Executive';
    
    RevCalcOperations:
    LOAD
        Formula as OpsRevenueFormula
    From_Field(ConfigurationData,full_xml) 
    (XmlSimple, table is [Setup/CoheusConfig/Revenue/CoheusConfigRevenue])
    Where Name = 'Revenue_Operations';
    
    RevCalcSales:
    LOAD
        Formula as SalesRevenueFormula
    From_Field(ConfigurationData,full_xml) 
    (XmlSimple, table is [Setup/CoheusConfig/Revenue/CoheusConfigRevenue])
    Where Name = 'Revenue_Sales';
    
    RevCalcContribution:
    LOAD
        Formula as ContributionRevenueFormula
    From_Field(ConfigurationData,full_xml) 
    (XmlSimple, table is [Setup/CoheusConfig/Revenue/CoheusConfigRevenue])
    Where Name = 'Revenue_Contribution';
ELSE
    // Use empty formulas (will fall back to defaults)
    RevCalcDefault: LOAD '' as DefaultRevenueFormula AutoGenerate 1;
    RevCalcExec: LOAD '' as ExecRevenueFormula AutoGenerate 1;
    RevCalcOperations: LOAD '' as OpsRevenueFormula AutoGenerate 1;
    RevCalcSales: LOAD '' as SalesRevenueFormula AutoGenerate 1;
    RevCalcContribution: LOAD '' as ContributionRevenueFormula AutoGenerate 1;
END IF;

// Set flags: 0 = use default formula, 1 = use custom formula
Let vDefaultRevFlag = If(Len(Trim(Peek('DefaultRevenueFormula',0,'RevCalcDefault')))=0,0,1);
Let vExecRevFlag = If(Len(Trim(Peek('ExecRevenueFormula',0,'RevCalcExec')))=0,0,1);
Let vOpsRevFlag = If(Len(Trim(Peek('OpsRevenueFormula',0,'RevCalcOperations')))=0,0,1);
Let vSalesRevFlag = If(Len(Trim(Peek('SalesRevenueFormula',0,'RevCalcSales')))=0,0,1);
Let vContributionRevFlag = If(Len(Trim(Peek('ContributionRevenueFormula',0,'RevCalcContribution')))=0,0,1);

// Set formula variables
Let vDefaultRevCalc = If($(vDefaultRevFlag)=1,Peek('DefaultRevenueFormula',0,'RevCalcDefault'),0);
Let vExecRevCalc = If($(vExecRevFlag)=1,Peek('ExecRevenueFormula',0,'RevCalcExec'),0);
Let vOpsRevCalc = If($(vOpsRevFlag)=1,Peek('OpsRevenueFormula',0,'RevCalcOperations'),0);
Let vSalesRevCalc = If($(vSalesRevFlag)=1,Peek('SalesRevenueFormula',0,'RevCalcSales'),0);
Let vContributionRevCalc = If($(vContributionRevFlag)=1,Peek('ContributionRevenueFormula',0,'RevCalcContribution'),0);
```

### Custom Revenue Formula Evaluation

**Qlik Pattern**:
```qvs
// Revenue calculation with fallback logic
If($(vDefaultRevFlag)=0,
   [Base Buy ($)]+[Orig Fee Borr Pd Temp]+[Orig Fees Seller Temp]-[CD Lender Credits Temp],
   $(vDefaultRevCalc)) as Revenue

// App-specific revenue with priority: Custom > Default > Standard
If($(vSalesRevFlag)=0 AND $(vDefaultRevFlag)=0,
   [Base Buy ($)]+[Orig Fee Borr Pd Temp]+[Orig Fees Seller Temp]-[CD Lender Credits Temp],
   If($(vDefaultRevFlag)=1,$(vDefaultRevCalc),$(vSalesRevCalc))) as Revenue_Sales
```

**Formula Priority**:
1. **App-Specific Custom Formula** (e.g., `Revenue_Sales`) - if exists
2. **Default Custom Formula** (`Default`) - if exists
3. **Standard Formula** - `[Base Buy ($)]+[Orig Fee Borr Pd Temp]+[Orig Fees Seller Temp]-[CD Lender Credits Temp]`

**PostgreSQL Translation**:

```sql
-- Revenue formula configuration table
CREATE TABLE revenue_formula_config (
    id SERIAL PRIMARY KEY,
    client_id VARCHAR(100),
    formula_name VARCHAR(100),  -- 'Default', 'Revenue_Sales', 'Revenue_Executive', etc.
    formula_expression TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(client_id, formula_name)
);

-- Default formula
INSERT INTO revenue_formula_config (client_id, formula_name, formula_expression) VALUES
(NULL, 'Default', 'base_buy_dollars + orig_fee_borr_pd + orig_fees_seller - cd_lender_credits');

-- Function to get revenue formula (with priority)
CREATE OR REPLACE FUNCTION get_revenue_formula(
    p_client_id VARCHAR,
    p_formula_name VARCHAR DEFAULT 'Default'
)
RETURNS TEXT AS $$
DECLARE
    v_formula TEXT;
BEGIN
    -- Try app-specific formula first
    SELECT formula_expression INTO v_formula
    FROM revenue_formula_config
    WHERE client_id = p_client_id
    AND formula_name = p_formula_name
    AND is_active = TRUE;
    
    -- Fall back to default formula if app-specific not found
    IF v_formula IS NULL THEN
        SELECT formula_expression INTO v_formula
        FROM revenue_formula_config
        WHERE client_id = p_client_id
        AND formula_name = 'Default'
        AND is_active = TRUE;
    END IF;
    
    -- Fall back to global default if client-specific not found
    IF v_formula IS NULL THEN
        SELECT formula_expression INTO v_formula
        FROM revenue_formula_config
        WHERE client_id IS NULL
        AND formula_name = 'Default'
        AND is_active = TRUE;
    END IF;
    
    RETURN COALESCE(v_formula, 'base_buy_dollars + orig_fee_borr_pd + orig_fees_seller - cd_lender_credits');
END;
$$ LANGUAGE plpgsql;

-- Function to evaluate revenue formula (simplified - would need full parser)
CREATE OR REPLACE FUNCTION calculate_revenue(
    p_client_id VARCHAR,
    p_formula_name VARCHAR DEFAULT 'Default',
    p_base_buy_dollars DECIMAL DEFAULT 0,
    p_orig_fee_borr_pd DECIMAL DEFAULT 0,
    p_orig_fees_seller DECIMAL DEFAULT 0,
    p_cd_lender_credits DECIMAL DEFAULT 0
)
RETURNS DECIMAL AS $$
DECLARE
    v_formula TEXT;
BEGIN
    -- Get formula
    v_formula := get_revenue_formula(p_client_id, p_formula_name);
    
    -- For now, use standard formula (full parser would be needed for custom formulas)
    -- In production, would need formula parser/evaluator
    RETURN COALESCE(p_base_buy_dollars, 0) + 
           COALESCE(p_orig_fee_borr_pd, 0) + 
           COALESCE(p_orig_fees_seller, 0) - 
           COALESCE(p_cd_lender_credits, 0);
END;
$$ LANGUAGE plpgsql;
```

**Note**: Full formula parsing would require a formula evaluation engine (e.g., using PL/pgSQL with dynamic SQL, or application-layer evaluation using libraries like `expr-eval` or `mathjs`).

## App-Specific Revenue

### Revenue_Sales
**Definition**: Sales app-specific revenue formula  
**Priority**: Custom Sales formula > Default formula > Standard formula  
**Qlik Expression**:
```qvs
If($(vSalesRevFlag)=0 AND $(vDefaultRevFlag)=0,
   [Base Buy ($)]+[Orig Fee Borr Pd Temp]+[Orig Fees Seller Temp]-[CD Lender Credits Temp],
   If($(vDefaultRevFlag)=1,$(vDefaultRevCalc),$(vSalesRevCalc))) as Revenue_Sales
```

### Revenue_Exec (Revenue_Executive)
**Definition**: Executive app-specific revenue formula  
**Priority**: Custom Executive formula > Default formula > Standard formula  
**Qlik Expression**:
```qvs
If($(vExecRevFlag)=0 AND $(vDefaultRevFlag)=0,
   [Base Buy ($)]+[Orig Fee Borr Pd Temp]+[Orig Fees Seller Temp]-[CD Lender Credits Temp],
   If($(vDefaultRevFlag)=1,$(vDefaultRevCalc),$(vExecRevCalc))) as Revenue_Exec
```

### Revenue_Ops (Revenue_Operations)
**Definition**: Operations app-specific revenue formula  
**Priority**: Custom Operations formula > Default formula > Standard formula  
**Qlik Expression**:
```qvs
If($(vOpsRevFlag)=0 AND $(vDefaultRevFlag)=0,
   [Base Buy ($)]+[Orig Fee Borr Pd Temp]+[Orig Fees Seller Temp]-[CD Lender Credits Temp],
   If($(vDefaultRevFlag)=1,$(vDefaultRevCalc),$(vOpsRevCalc))) as Revenue_Ops
```

### Revenue_Contribution
**Definition**: Contribution to Profit app-specific revenue formula  
**Priority**: Custom Contribution formula > Default formula > Standard formula  
**Qlik Expression**:
```qvs
If($(vContributionRevFlag)=0 AND $(vDefaultRevFlag)=0,
   [Base Buy ($)]+[Orig Fee Borr Pd Temp]+[Orig Fees Seller Temp]-[CD Lender Credits Temp],
   If($(vDefaultRevFlag)=1,$(vDefaultRevCalc),$(vContributionRevCalc))) as Revenue_Contribution
```

**Note**: Revenue_Contribution is used for scorecard calculations (see `REVENUE.qvs`).

## Revenue Field Parsing (REVENUE.qvs)

**Purpose**: Parse revenue formula into individual fields for field-level analysis

**Qlik Logic**:
```qvs
// Parse formula: [Base Buy ($)]+[Orig Fee Borr Pd]+[Orig Fees Seller]-[CD Lender Credits]
// Extract fields: Base Buy ($), Orig Fee Borr Pd, Orig Fees Seller, CD Lender Credits

RevenueFields:
Load
    PurgeChar(RevenueFields,'[') as RevenueFields  // Remove left bracket
Where Not IsNull(RevenueFields);
Load
    Right(Trim(RevenueFields),Len(Trim(RevenueFields))-1) as RevenueFields  // Remove operators (+/-)
;
LOAD
    If(Len(Formula)>0,
       SubField(Trim(Formula),']'),  // Split by ']' to get field names
       SubField('[Base Buy ($)]+[Orig Fee Borr Pd]+[Orig Fees Seller]-[CD Lender Credits]',']')
    ) as RevenueFields
From_Field(ConfigurationData,full_xml)
(XmlSimple, table is [Setup/CoheusConfig/Revenue/CoheusConfigRevenue])
Where Name = '$(vRevBucketCheck)';  // 'Revenue_Contribution' or 'Default'

// Store fields in variables
For r=1 to NoOfRows('RevenueFields')
    Let RevField$(r) = Trim(Peek('RevenueFields',$(r)-1,'RevenueFields'));
    Let RevFieldName$(r) = 'RevField$(r)';
Next r;
```

**PostgreSQL Translation**:
```sql
-- Parse revenue formula into component fields
CREATE OR REPLACE FUNCTION parse_revenue_fields(
    p_formula TEXT
)
RETURNS TEXT[] AS $$
DECLARE
    v_fields TEXT[];
    v_field TEXT;
BEGIN
    -- Remove brackets and split by operators
    -- Example: '[Base Buy ($)]+[Orig Fee Borr Pd]' -> ['Base Buy ($)', 'Orig Fee Borr Pd']
    -- This is simplified - full parser would handle all operators and brackets
    SELECT ARRAY_AGG(TRIM(BOTH '[]' FROM unnest(string_to_array(p_formula, '+')))) 
    INTO v_fields;
    
    RETURN v_fields;
END;
$$ LANGUAGE plpgsql;
```

## Revenue Field Type Conversion

**Purpose**: Convert revenue fields to numeric for calculations

**Qlik Logic**:
```qvs
// Build conversion expression: If(IsNull(Num([Base Buy ($) Temp])),0,Num([Base Buy ($) Temp])) as [Base Buy ($)]
For n =0 to NoOfRows('RevToNum')-1
    Let vRevToNum = '$(vRevToNum)'&Chr(44)&'If(IsNull(Num(['&Peek('Alias',$(n),'RevToNum')&' Temp])),0,Num(['&Peek('Alias',$(n),'RevToNum')&' Temp])) as ['&Peek('Alias',$(n),'RevToNum')&']';
Next n;

// Apply conversion
$(vRevToNum)
```

**PostgreSQL Translation**:
```sql
-- Convert revenue fields to numeric
SELECT 
    COALESCE(base_buy_dollars::NUMERIC, 0) as base_buy_dollars,
    COALESCE(orig_fee_borr_pd::NUMERIC, 0) as orig_fee_borr_pd,
    COALESCE(orig_fees_seller::NUMERIC, 0) as orig_fees_seller,
    COALESCE(cd_lender_credits::NUMERIC, 0) as cd_lender_credits
FROM loans;
```

## Business Rules

- **Revenue calculations use NULL-safe addition** (COALESCE)
- **Margin calculations require non-zero loan amount**
- **Custom formulas can override default calculations**
- **Basis points conversion**: multiply percentage by 10,000
- **Formula Priority**: App-specific > Default > Standard
- **Revenue Field Parsing**: Formulas are parsed to extract component fields for analysis
- **Field Type Conversion**: Revenue fields are converted to numeric before calculation

## Dependencies

- Base revenue components (see `concepts/revenue.md`)
- Loan Amount (for margin calculations)
- Configuration tables (for custom formulas)

## Used In

- All apps
- Profitability analysis
- Revenue reporting
- Contribution to Profit app

## Migration Notes

- Revenue calculations are straightforward additions - no pre-computation needed
- Custom formulas may require formula evaluation engine or stored procedures
- Margin calculations should handle division by zero
- Configuration-based formulas need flexible evaluation approach

## See Also

- Base concept: `concepts/revenue.md`
- Qlik implementation: `core/transform-logic.md#revenue-calculations`
- Patterns: `patterns/aggregation-patterns.md` - RangeSum pattern
