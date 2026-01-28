# Qlik Mapping Tables

**Source Files**: 
- `tvd-coheus-incremental-builder-qlik/Mapping.qvs`
- `tvd-coheus-incremental-builder-qlik/Milestone Sort.qvs`
- `tvd-coheus-datapilot-qlik/Scripts/Mapping.qvs`

This document catalogs all Qlik mapping tables used in the system, along with their PostgreSQL equivalents.

**Qlik Pattern**: `ApplyMap('MapName', SourceValue, DefaultValue)`  
**PostgreSQL Translation**: Use `JOIN` with lookup table or `CASE` statement for simple mappings

**See**: `patterns/mapping-lookups.md` for detailed translation patterns.

---

## Loan Type Mappings

### LoanTypeMap
**Purpose**: Maps loan type source values to standardized display names  
**Source**: Inline mapping table

**Qlik Definition**:
```qvs
LoanTypeMap:
Mapping Load *
Inline [
SourceName, TransformName
Conventional, Conventional
FHA, FHA
VA, VA
FarmersHomeA, Rural
FarmersHomeAdministration, Rural
HELOC, HELOC
Other, Other
];
```

**Usage**: `ApplyMap('LoanTypeMap', [Loan Type], 'Other')`

**PostgreSQL Translation - Option 1: Lookup Table**:
```sql
CREATE TABLE loan_type_map (
    source_name VARCHAR(100) PRIMARY KEY,
    transform_name VARCHAR(100) NOT NULL
);

INSERT INTO loan_type_map VALUES
('Conventional', 'Conventional'),
('FHA', 'FHA'),
('VA', 'VA'),
('FarmersHomeA', 'Rural'),
('FarmersHomeAdministration', 'Rural'),
('HELOC', 'HELOC'),
('Other', 'Other');

-- Usage
SELECT COALESCE(ltm.transform_name, 'Other') as loan_type
FROM loans l
LEFT JOIN loan_type_map ltm ON l.loan_type = ltm.source_name;
```

**PostgreSQL Translation - Option 2: CASE Statement**:
```sql
SELECT CASE 
    WHEN loan_type = 'Conventional' THEN 'Conventional'
    WHEN loan_type = 'FHA' THEN 'FHA'
    WHEN loan_type = 'VA' THEN 'VA'
    WHEN loan_type IN ('FarmersHomeA', 'FarmersHomeAdministration') THEN 'Rural'
    WHEN loan_type = 'HELOC' THEN 'HELOC'
    ELSE 'Other'
END as loan_type
FROM loans;
```

---

### LoanTypeGroupMap
**Purpose**: Groups loan types into broader categories (Conventional, Government, HELOC, Other)  
**Source**: Inline mapping table

**Qlik Definition**:
```qvs
LoanTypeGroupMap:
Mapping Load *
Inline [
SourceName, TransformName
Conventional, Conventional
FHA, Government
VA, Government
FarmersHomeA, Government
FarmersHomeAdministration, Government
HELOC, HELOC
Other, Other
];
```

**Usage**: `ApplyMap('LoanTypeGroupMap', [Loan Type], 'Other')`

**PostgreSQL Translation**:
```sql
CREATE TABLE loan_type_group_map (
    source_name VARCHAR(100) PRIMARY KEY,
    transform_name VARCHAR(100) NOT NULL
);

INSERT INTO loan_type_group_map VALUES
('Conventional', 'Conventional'),
('FHA', 'Government'),
('VA', 'Government'),
('FarmersHomeA', 'Government'),
('FarmersHomeAdministration', 'Government'),
('HELOC', 'HELOC'),
('Other', 'Other');
```

---

## Loan Purpose Mappings

### LoanPurposeMap
**Purpose**: Maps loan purpose source values to standardized display names  
**Source**: Inline mapping table

**Qlik Definition**:
```qvs
LoanPurposeMap:
Mapping Load *
Inline [
SourceName, TransformName
Purchase, Purchase
NoCash-Out Refinance, Refi No CO
Cash-Out Refinance, Refi CO
ConstructionToPermanent, C to P
ConstructionToPerman, C to P
ConstructionToPermanen, C to P
Other, Other
ConstructionOnly, Construction Only
];
```

**Usage**: `ApplyMap('LoanPurposeMap', [Loan Purpose], 'Other')`

**PostgreSQL Translation**:
```sql
CREATE TABLE loan_purpose_map (
    source_name VARCHAR(100) PRIMARY KEY,
    transform_name VARCHAR(100) NOT NULL
);

INSERT INTO loan_purpose_map VALUES
('Purchase', 'Purchase'),
('NoCash-Out Refinance', 'Refi No CO'),
('Cash-Out Refinance', 'Refi CO'),
('ConstructionToPermanent', 'C to P'),
('ConstructionToPerman', 'C to P'),
('ConstructionToPermanen', 'C to P'),
('Other', 'Other'),
('ConstructionOnly', 'Construction Only');
```

---

### LoanPurposeGroupMap
**Purpose**: Groups loan purposes into broader categories (Purchase, Refinance, C to P, Other)  
**Source**: Inline mapping table

**Qlik Definition**:
```qvs
LoanPurposeGroupMap:
Mapping Load *
Inline [
SourceName, TransformName
Purchase, Purchase
NoCash-Out Refinance, Refinance
Cash-Out Refinance, Refinance
ConstructionToPermanent, C to P
ConstructionToPerman, C to P
ConstructionToPermanen, C to P
Other, Other
ConstructionOnly, Construction Only
];
```

**Usage**: `ApplyMap('LoanPurposeGroupMap', [Loan Purpose], 'Other')`

**PostgreSQL Translation**:
```sql
CREATE TABLE loan_purpose_group_map (
    source_name VARCHAR(100) PRIMARY KEY,
    transform_name VARCHAR(100) NOT NULL
);

INSERT INTO loan_purpose_group_map VALUES
('Purchase', 'Purchase'),
('NoCash-Out Refinance', 'Refinance'),
('Cash-Out Refinance', 'Refinance'),
('ConstructionToPermanent', 'C to P'),
('ConstructionToPerman', 'C to P'),
('ConstructionToPermanen', 'C to P'),
('Other', 'Other'),
('ConstructionOnly', 'Construction Only');
```

---

## Milestone Sort Mappings

### MilestoneSort_$(i)
**Purpose**: Maps milestone names to sort order values for proper chronological sorting  
**Source**: XML configuration file or inline fallback  
**Note**: `$(i)` indicates client-specific mapping (loaded per client configuration)

**Qlik Definition**:
```qvs
IF '$(vFileExists)'=1 THEN
    MilestoneSort_$(i):
    Mapping LOAD Distinct
        Lower(Trim(Replace(Name,' ',''))) as "Current Milestone",
        SortOrder
    From_Field(ConfigurationData,full_xml) 
    (XmlSimple, table is [Setup/CoheusConfig/Milestones/Milestone]);
Else
    MilestoneSort_$(i):
    Mapping LOAD Distinct
        Lower(Trim(Replace(Name,' ',''))) as "Current Milestone",
        SortOrder;
    Load * Inline [
        Name, SortOrder
        Started, 1
        Scrub, 2
        Intake, 3
        OS Request, 4
        Origination Support, 5
        Pre-Approval Request, 6
        Pre-Approval Submit, 7
        Pre-Approval Decision, 8
        Review, 9
        In Review, 10
        Pre-Processing, 11
        Application, 12
        Account Manager Review, 13
        Silent 2nd Disclosure, 14
        Set-Up, 15
        Processing, 16
        Suspense, 17
        Received in UW, 18
        Approval, 19
        Decision, 20
        Lender Decision, 21
        Submittal, 22
        Conditional Review, 23
        Resubmittal, 24
        Suspense Resub, 25
        Final Approval, 26
        Silent 2nd Approval, 27
        Clear to Close, 28
        Docs Out, 29
        Closing, 30
        Lender Closing, 31
        Silent 2nd Closing, 32
        Funding, 33
        Lender Funding, 34
        Reconciliation, 35
        Purchased, 36
        Post Closing, 37
        Shipping, 38
        Completion, 39
    ];
END IF
```

**Usage**: `ApplyMap('MilestoneSort_$(i)', Lower(Trim(Replace([Current Milestone],' ',''))), 500)`

**PostgreSQL Translation**:
```sql
-- Client-specific milestone sort table
CREATE TABLE milestone_sort_map (
    client_id VARCHAR(100),
    milestone_name VARCHAR(100),
    sort_order INTEGER NOT NULL,
    PRIMARY KEY (client_id, milestone_name)
);

-- Default milestone sort values (fallback)
INSERT INTO milestone_sort_map (client_id, milestone_name, sort_order) VALUES
('DEFAULT', 'started', 1),
('DEFAULT', 'scrub', 2),
('DEFAULT', 'intake', 3),
('DEFAULT', 'os request', 4),
('DEFAULT', 'origination support', 5),
('DEFAULT', 'pre-approval request', 6),
('DEFAULT', 'pre-approval submit', 7),
('DEFAULT', 'pre-approval decision', 8),
('DEFAULT', 'review', 9),
('DEFAULT', 'in review', 10),
('DEFAULT', 'pre-processing', 11),
('DEFAULT', 'application', 12),
('DEFAULT', 'account manager review', 13),
('DEFAULT', 'silent 2nd disclosure', 14),
('DEFAULT', 'set-up', 15),
('DEFAULT', 'processing', 16),
('DEFAULT', 'suspense', 17),
('DEFAULT', 'received in uw', 18),
('DEFAULT', 'approval', 19),
('DEFAULT', 'decision', 20),
('DEFAULT', 'lender decision', 21),
('DEFAULT', 'submittal', 22),
('DEFAULT', 'conditional review', 23),
('DEFAULT', 'resubmittal', 24),
('DEFAULT', 'suspense resub', 25),
('DEFAULT', 'final approval', 26),
('DEFAULT', 'silent 2nd approval', 27),
('DEFAULT', 'clear to close', 28),
('DEFAULT', 'docs out', 29),
('DEFAULT', 'closing', 30),
('DEFAULT', 'lender closing', 31),
('DEFAULT', 'silent 2nd closing', 32),
('DEFAULT', 'funding', 33),
('DEFAULT', 'lender funding', 34),
('DEFAULT', 'reconciliation', 35),
('DEFAULT', 'purchased', 36),
('DEFAULT', 'post closing', 37),
('DEFAULT', 'shipping', 38),
('DEFAULT', 'completion', 39);

-- Usage (with client-specific lookup, fallback to default)
SELECT COALESCE(
    msm.sort_order,
    (SELECT sort_order FROM milestone_sort_map WHERE client_id = 'DEFAULT' AND milestone_name = LOWER(TRIM(REPLACE(l.current_milestone, ' ', '')))),
    500
) as milestone_sort_order
FROM loans l
LEFT JOIN milestone_sort_map msm ON msm.client_id = CURRENT_SETTING('app.client_id', TRUE)
    AND msm.milestone_name = LOWER(TRIM(REPLACE(l.current_milestone, ' ', '')));
```

**Note**: Milestone names are normalized (lowercase, spaces removed) before lookup.

---

## Range Sort Mappings

### FICORangeSortMap
**Purpose**: Maps FICO range labels to sort order for proper display ordering  
**Source**: Excel file (`CoheusGold.Mapping.xlsx`, table: `FICORange`)

**Qlik Definition**:
```qvs
FICORangeSortMap:
MAPPING LOAD
    FICORange,
    FICORangeSort
FROM [$(vSharedData)/Misc. Data/DEMO/Coheus_2ndGen/CoheusGold.Mapping.xlsx]
(ooxml, embedded labels, table is FICORange);
```

**Usage**: `ApplyMap('FICORangeSortMap', [FICO Range], 999)`

**PostgreSQL Translation**:
```sql
CREATE TABLE fico_range_sort_map (
    fico_range VARCHAR(50) PRIMARY KEY,
    sort_order INTEGER NOT NULL
);

-- Load from source data (example ranges)
INSERT INTO fico_range_sort_map VALUES
('<620', 1),
('620-639', 2),
('640-659', 3),
('660-679', 4),
('680-699', 5),
('700-719', 6),
('720-739', 7),
('740-759', 8),
('760-779', 9),
('780+', 10);
```

**See**: `derived/stratification.md` for complete FICO range definitions.

---

### LTVRangeSortMap
**Purpose**: Maps LTV range labels to sort order  
**Source**: Excel file (`CoheusGold.Mapping.xlsx`, table: `LTVRange`)

**Qlik Definition**:
```qvs
LTVRangeSortMap:
MAPPING LOAD
    LTVRange,
    LTVRangeSort
FROM [$(vSharedData)/Misc. Data/DEMO/Coheus_2ndGen/CoheusGold.Mapping.xlsx]
(ooxml, embedded labels, table is LTVRange);
```

**PostgreSQL Translation**:
```sql
CREATE TABLE ltv_range_sort_map (
    ltv_range VARCHAR(50) PRIMARY KEY,
    sort_order INTEGER NOT NULL
);
```

**See**: `derived/stratification.md` for complete LTV range definitions.

---

### DTIRangeSortMap
**Purpose**: Maps DTI range labels to sort order  
**Source**: Excel file (`CoheusGold.Mapping.xlsx`, table: `DTIRange`)

**Qlik Definition**:
```qvs
DTIRangeSortMap:
MAPPING LOAD
    DTIRange,
    DTIRangeSort
FROM [$(vSharedData)/Misc. Data/DEMO/Coheus_2ndGen/CoheusGold.Mapping.xlsx]
(ooxml, embedded labels, table is DTIRange);
```

**PostgreSQL Translation**:
```sql
CREATE TABLE dti_range_sort_map (
    dti_range VARCHAR(50) PRIMARY KEY,
    sort_order INTEGER NOT NULL
);
```

**See**: `derived/stratification.md` for complete DTI range definitions.

---

### InterestRateRangeSortMap
**Purpose**: Maps interest rate range labels to sort order  
**Source**: Inline mapping table

**Qlik Definition**:
```qvs
InterestRateRangeSortMap:
Mapping Load *
Inline [
InterestRateRange, SortOrder
'Values<2.500', 1 
'2.500 - 2.625', 2
'2.625 - 2.750', 3
'2.750 - 2.875', 4
'2.875 - 3.000', 5
'3.000 - 3.125', 6
'3.125 - 3.250', 7
'3.250 - 3.375', 8
'3.375 - 3.500', 9
'3.500 - 3.625', 10
'3.625 - 3.750', 11
'3.750 - 3.875', 12
'3.875 - 4.000', 13
'4.000 - 4.125', 14
'4.125 - 4.250', 15
'4.250 - 4.375', 16
'4.375 - 4.500', 17
'4.500 - 4.625', 18
'4.625 - 4.750', 19
'4.750 - 4.875', 20
'4.875 - 5.000', 21 
'Values>5.000', 30
];
```

**Usage**: `ApplyMap('InterestRateRangeSortMap', [Interest Rate Range], 999)`

**PostgreSQL Translation**:
```sql
CREATE TABLE interest_rate_range_sort_map (
    interest_rate_range VARCHAR(50) PRIMARY KEY,
    sort_order INTEGER NOT NULL
);

INSERT INTO interest_rate_range_sort_map VALUES
('Values<2.500', 1),
('2.500 - 2.625', 2),
('2.625 - 2.750', 3),
('2.750 - 2.875', 4),
('2.875 - 3.000', 5),
('3.000 - 3.125', 6),
('3.125 - 3.250', 7),
('3.250 - 3.375', 8),
('3.375 - 3.500', 9),
('3.500 - 3.625', 10),
('3.625 - 3.750', 11),
('3.750 - 3.875', 12),
('3.875 - 4.000', 13),
('4.000 - 4.125', 14),
('4.125 - 4.250', 15),
('4.250 - 4.375', 16),
('4.375 - 4.500', 17),
('4.500 - 4.625', 18),
('4.625 - 4.750', 19),
('4.750 - 4.875', 20),
('4.875 - 5.000', 21),
('Values>5.000', 30);
```

---

### OriginalBalanceRangeSortMap
**Purpose**: Maps original balance range labels to sort order  
**Source**: Excel file (`CoheusGold.Mapping.xlsx`, table: `OriginalBalanceRange`)

**Qlik Definition**:
```qvs
OriginalBalanceRangeSortMap:
MAPPING LOAD
    OriginalBalanceRange,
    OriginalBalanceRangeSort
FROM [$(vSharedData)/Misc. Data/DEMO/Coheus_2ndGen/CoheusGold.Mapping.xlsx]
(ooxml, embedded labels, table is OriginalBalanceRange);
```

**PostgreSQL Translation**:
```sql
CREATE TABLE original_balance_range_sort_map (
    original_balance_range VARCHAR(50) PRIMARY KEY,
    sort_order INTEGER NOT NULL
);
```

---

## Geographic Mappings

### FPCODEMap
**Purpose**: Maps state names to FIPS codes  
**Source**: Excel file (`CoheusGold.Mapping.xlsx`, table: `FPCODE`)

**Qlik Definition**:
```qvs
FPCODEMap:
MAPPING LOAD
    State,
    Code
FROM [$(vSharedData)/Misc. Data/DEMO/Coheus_2ndGen/CoheusGold.Mapping.xlsx]
(ooxml, embedded labels, table is FPCODE);
```

**Usage**: `ApplyMap('FPCODEMap', [State], '')`

**PostgreSQL Translation**:
```sql
CREATE TABLE fips_code_map (
    state VARCHAR(100) PRIMARY KEY,
    fips_code VARCHAR(10) NOT NULL
);

-- Usage
SELECT COALESCE(fcm.fips_code, '') as fips_code
FROM loans l
LEFT JOIN fips_code_map fcm ON l.state = fcm.state;
```

---

### FNMALoanLimitMap
**Purpose**: Maps county (FPCODE.County format) to Fannie Mae loan limits  
**Source**: Excel file (`loan-limit-table.xlsx`, table: `2019 Loan Limits by County`)

**Qlik Definition**:
```qvs
FNMALoanLimitMap:
MAPPING LOAD
	"2-Digit State Code" & '-' & "County Name" as [FPCODE.County],
    "2019 Loan Limit 1 Unit" as [Loan Limit]
FROM [$(vSharedData)\Misc. Data\DEMO\Coheus_2.0\loan-limit-table.xlsx]
(ooxml, embedded labels, table is [2019 Loan Limits by County]);
```

**Usage**: `ApplyMap('FNMALoanLimitMap', [FPCODE.County], 0)`

**PostgreSQL Translation**:
```sql
CREATE TABLE fnma_loan_limit_map (
    fpcode_county VARCHAR(100) PRIMARY KEY, -- Format: "XX-County Name"
    loan_limit_1_unit DECIMAL(12,2) NOT NULL
);

-- Usage
SELECT COALESCE(fllm.loan_limit_1_unit, 0) as loan_limit
FROM loans l
LEFT JOIN fnma_loan_limit_map fllm ON l.fpcode_county = fllm.fpcode_county;
```

---

### USRegionMap
**Purpose**: Maps source region names to standardized region names  
**Source**: Excel file (`Coheus2019_2.0_Mapping_20190218.xlsx`, table: `USRegion`)

**Qlik Definition**:
```qvs
USRegionMap:
MAPPING LOAD
    UPPER(SourceName) as SourceName,
    TransformName
FROM [$(vSharedData)\Misc. Data\DEMO\Coheus_2.0\Coheus2019_2.0_Mapping_20190218.xlsx]
(ooxml, embedded labels, table is USRegion);
```

**Usage**: `ApplyMap('USRegionMap', Upper([Region]), [Region])`

**PostgreSQL Translation**:
```sql
CREATE TABLE us_region_map (
    source_name VARCHAR(100) PRIMARY KEY, -- Uppercase
    transform_name VARCHAR(100) NOT NULL
);

-- Usage
SELECT COALESCE(urm.transform_name, l.region) as region
FROM loans l
LEFT JOIN us_region_map urm ON UPPER(l.region) = urm.source_name;
```

---

## Borrower Attribute Mappings

### BorrYrsonJobGroupingSortMap
**Purpose**: Maps borrower years on job grouping to sort order  
**Source**: Inline mapping table

**Qlik Definition**:
```qvs
BorrYrsonJobGroupingSortMap:
MAPPING LOAD *
Inline [
Grouping, SortOrder
'0-1', 1
'1-3', 2
'3-5', 3
'>5', 4
];
```

**PostgreSQL Translation**:
```sql
CREATE TABLE borrower_years_on_job_sort_map (
    grouping VARCHAR(20) PRIMARY KEY,
    sort_order INTEGER NOT NULL
);

INSERT INTO borrower_years_on_job_sort_map VALUES
('0-1', 1),
('1-3', 2),
('3-5', 3),
('>5', 4);
```

---

### IncomeTotalMoIncomeGroupingSortMap
**Purpose**: Maps total monthly income grouping to sort order  
**Source**: Inline mapping table

**Qlik Definition**:
```qvs
IncomeTotalMoIncomeGroupingSortMap:
MAPPING LOAD *
Inline [
Grouping, SortOrder
'0-5,000', 1
'5,000-10,000', 2
'>10,000', 3
];
```

**PostgreSQL Translation**:
```sql
CREATE TABLE income_total_monthly_sort_map (
    grouping VARCHAR(20) PRIMARY KEY,
    sort_order INTEGER NOT NULL
);

INSERT INTO income_total_monthly_sort_map VALUES
('0-5,000', 1),
('5,000-10,000', 2),
('>10,000', 3);
```

---

### AssetsSubtotalLiquidAssetsGroupingSortMap
**Purpose**: Maps liquid assets grouping to sort order  
**Source**: Inline mapping table

**Qlik Definition**:
```qvs
AssetsSubtotalLiquidAssetsGroupingSortMap:
MAPPING LOAD *
Inline [
Grouping, SortOrder
'0-10,000', 1
'10,000-50,000', 2
'>50,000', 3
];
```

**PostgreSQL Translation**:
```sql
CREATE TABLE assets_liquid_sort_map (
    grouping VARCHAR(20) PRIMARY KEY,
    sort_order INTEGER NOT NULL
);

INSERT INTO assets_liquid_sort_map VALUES
('0-10,000', 1),
('10,000-50,000', 2),
('>50,000', 3);
```

---

## DataPilot-Specific Mappings

### ClosingProjectionGroupList
**Purpose**: Maps closing projection groups to sort order  
**Source**: Inline mapping table (DataPilot app)

**Qlik Definition**:
```qvs
ClosingProjectionGroupList:
Mapping Load * Inline [
ClosingProjectionGroup, ClosingProjectionGroupSort
'Funded', 1
'CTC', 2
'Approved', 3
'Conditional Approved', 4
'Locked', 5
'In Processing', 6
'Not Yet In Processing', 7
];
```

**PostgreSQL Translation**:
```sql
CREATE TABLE closing_projection_group_sort_map (
    closing_projection_group VARCHAR(50) PRIMARY KEY,
    sort_order INTEGER NOT NULL
);

INSERT INTO closing_projection_group_sort_map VALUES
('Funded', 1),
('CTC', 2),
('Approved', 3),
('Conditional Approved', 4),
('Locked', 5),
('In Processing', 6),
('Not Yet In Processing', 7);
```

---

## Mapping Usage Patterns

### ApplyMap() Function
**Qlik Pattern**: `ApplyMap('MapName', SourceValue, DefaultValue)`  
**PostgreSQL Translation**: `LEFT JOIN` with `COALESCE()` for default

**Example**:
```qvs
ApplyMap('LoanTypeMap', [Loan Type], 'Other')
```

**PostgreSQL**:
```sql
SELECT COALESCE(ltm.transform_name, 'Other') as loan_type
FROM loans l
LEFT JOIN loan_type_map ltm ON l.loan_type = ltm.source_name;
```

### Case-Insensitive Mapping
**Qlik Pattern**: `ApplyMap('MapName', Upper([Field]), [Field])`  
**PostgreSQL Translation**: Use `UPPER()` in JOIN condition

**Example**:
```qvs
ApplyMap('USRegionMap', Upper([Region]), [Region])
```

**PostgreSQL**:
```sql
SELECT COALESCE(urm.transform_name, l.region) as region
FROM loans l
LEFT JOIN us_region_map urm ON UPPER(l.region) = urm.source_name;
```

### Normalized Mapping (Lowercase, Spaces Removed)
**Qlik Pattern**: `ApplyMap('MilestoneSort_$(i)', Lower(Trim(Replace([Current Milestone],' ',''))), 500)`  
**PostgreSQL Translation**: Normalize in JOIN condition

**PostgreSQL**:
```sql
SELECT COALESCE(msm.sort_order, 500) as sort_order
FROM loans l
LEFT JOIN milestone_sort_map msm ON msm.milestone_name = LOWER(TRIM(REPLACE(l.current_milestone, ' ', '')));
```

---

## Source Fields

Mapping tables use fields from the [Coheus Data Dictionary](../../data-dictionary/CoheusDataDictionary.xml):

**Common Mapped Fields**:
- `Loan Type` (Encompass: `Fields.1109`)
- `Loan Purpose` (Encompass: `Fields.19`)
- `Current Milestone` (derived field)
- `FICO Range` (derived field)
- `LTV Range` (derived field)
- `DTI Range` (derived field)
- `State` (Encompass: `Fields.14`)
- `Region` (derived or custom field)

**See**: `patterns/source-fields.md` for complete data dictionary integration guide.

---

## Migration Notes

- **Lookup tables** are preferred over CASE statements for maintainability
- **Client-specific mappings** (e.g., `MilestoneSort_$(i)`) require `client_id` column
- **Default values** should match Qlik's ApplyMap defaults
- **Case sensitivity** must be preserved (use UPPER/LOWER as needed)
- **Normalization** (trim, replace spaces) should be done consistently
- **Excel sources** should be migrated to PostgreSQL tables during migration

---

## See Also

- **Mapping Lookups Pattern**: `patterns/mapping-lookups.md` - ApplyMap() → JOIN translation
- **Stratification**: `derived/stratification.md` - Range definitions and sort mappings
- **PostgreSQL Mapping**: `migration/postgresql-mapping.md` - General mapping patterns
