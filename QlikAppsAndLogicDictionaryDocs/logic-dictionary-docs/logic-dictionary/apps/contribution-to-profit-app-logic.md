# Contribution to Profit App Logic Dictionary

**Source Files**: `tvd-coheus-contribution-to-profit-qlik/Scripts/*.qvs`

This document catalogs Contribution to Profit app-specific logic.

---

## Pull Through Logic

### Pull Through Originated Flag
**Category**: Status Flags  
**Definition**: Flag indicating if loan is originated (Current Loan Status contains 'Originated' or 'purchased')  
**Qlik Expression**:
```qvs
If(WildMatch([Current Loan Status],'*Originated*','*purchased*')>0,'Yes','No') as [Pull Through Originated Flag]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN current_loan_status ILIKE '%Originated%' 
      OR current_loan_status ILIKE '%purchased%' 
    THEN 'Yes' 
    ELSE 'No' 
END as pull_through_originated_flag
```
**Dependencies**: `Current Loan Status`  
**Used In**: Contribution to Profit app  
**Business Rules**: Identifies loans that have been originated/purchased for pull through calculations  
**Migration Notes**: Pattern matching with ILIKE

---

## Channel-Specific Fields

### Mortgage Loan Officer (MLO)
**Category**: Channel Fields  
**Definition**: Loan Officer for Retail, Account Executive for TPO  
**Qlik Expression**:
```qvs
if([TPO Flag]='Yes',[Account Executive],[Loan Officer]) as [Mortgage Loan Officer (MLO)]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN tpo_flag = 'Yes' THEN account_executive
    ELSE loan_officer
END as mortgage_loan_officer_mlo
```
**Dependencies**: `TPO Flag`, `Account Executive`, `Loan Officer`  
**Used In**: Contribution to Profit app  
**Business Rules**: Uses different actor field based on channel  
**Migration Notes**: Conditional field selection

---

### Retail Channels / TPO Channels
**Category**: Channel Fields  
**Definition**: Channel field filtered by Consolidated Channels  
**Qlik Expression**:
```qvs
If([Consolidated Channels] = 'Retail',Channel) as [Retail Channels]
If([Consolidated Channels] = 'TPO',Channel) as [TPO Channels]
```
**SQL Equivalent**:
```sql
CASE 
    WHEN consolidated_channels = 'Retail' THEN channel
    ELSE NULL
END as retail_channels

CASE 
    WHEN consolidated_channels = 'TPO' THEN channel
    ELSE NULL
END as tpo_channels
```
**Dependencies**: `Consolidated Channels`, `Channel`  
**Used In**: Contribution to Profit app  
**Business Rules**: Separates channels by type  
**Migration Notes**: Conditional field extraction

---

## Scorecard Logic

### Scorecard Entity List
**Category**: Scorecard  
**Definition**: List of entities for scorecard aggregation (varies by TPO flag)  
**Qlik Expression**:
```qvs
If $(vTPOCheck)=-1 then
    SET vScorecardList='Branch|Broker Lender Name|TPO Company Name|Channel_ExcludeCorrespondent~Channel|Investor';
else
    SET vScorecardList='Branch|Broker Lender Name|Channel|Investor';
end if
```
**SQL Equivalent**:
```sql
-- Configuration table
CREATE TABLE scorecard_entities (
    entity_name VARCHAR(100),
    tpo_enabled BOOLEAN
);

-- Or use conditional logic in application layer
IF tpo_check = -1 THEN
    scorecard_list := ARRAY['Branch', 'Broker Lender Name', 'TPO Company Name', 'Channel', 'Investor'];
ELSE
    scorecard_list := ARRAY['Branch', 'Broker Lender Name', 'Channel', 'Investor'];
END IF;
```
**Dependencies**: `vTPOCheck`  
**Used In**: Contribution to Profit app  
**Business Rules**: Different entity lists for TPO vs Retail-only clients  
**Migration Notes**: Conditional configuration

---

## Loan Program Standardization

### Loan Program Mapping
**Category**: Mapping  
**Definition**: Standardizes Loan Program values  
**Qlik Expression**:
```qvs
If([Loan Program]='99-Missing'OR Len(Trim([Loan Program]))=0 OR Index([Loan Program],' ')=0,'99-Missing',
   If(WildMatch([Loan Program],'*mr. cooper*','*mr cooper*'),'Mr. Cooper',
   -- ... more mappings
```
**SQL Equivalent**:
```sql
CASE 
    WHEN loan_program IS NULL OR loan_program = '99-Missing' OR loan_program NOT LIKE '% %' 
    THEN '99-Missing'
    WHEN loan_program ILIKE '%mr. cooper%' OR loan_program ILIKE '%mr cooper%' 
    THEN 'Mr. Cooper'
    -- ... more mappings
END as loan_program_standardized
```
**Dependencies**: `Loan Program`  
**Used In**: Contribution to Profit app  
**Business Rules**: Standardizes loan program names for consistency  
**Migration Notes**: Use mapping table or CASE statement

---

## Revenue Calculations

**See**: `derived/revenue-calculations.md` for complete revenue calculation documentation including:
- Revenue_Contribution formula
- Revenue configuration logic
- Formula parsing and evaluation
- Margin (BPS)_Contribution calculations

## Pull Through Calculations

**See**: `derived/pull-through-calculations.md` for complete pull-through documentation including:
- Scorecard PullThrough (rolling 13 months)
- Pull-through with Originated flag
- Multi-channel pull-through logic

## Expression Usage

**See**: `validation/expression-categories.md` for expression categorization and:
- `validation/qsda-cross-reference.md` for QSDA analysis findings
- Common expression patterns used in Contribution app

---

## Notes

- Contribution to Profit app focuses on profitability metrics
- Pull through calculations use Originated flag
- Channel-specific actor fields (MLO)
- Scorecard logic varies by TPO presence
- Loan program standardization for consistency

## See Also

- **Revenue Calculations**: `derived/revenue-calculations.md` - Revenue_Contribution and margin calculations
- **Pull Through**: `derived/pull-through-calculations.md` - Pull-through metrics
- **ODAG Logic**: `core/odag-logic.md` - Channel filtering (Correspondent exclusion)
- **Expression Categories**: `validation/expression-categories.md` - Expression patterns
- **QSDA Cross-Reference**: `validation/qsda-cross-reference.md` - App-specific findings
