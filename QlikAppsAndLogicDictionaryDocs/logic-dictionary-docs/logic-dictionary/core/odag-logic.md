# ODAG (On-Demand App Generation) Logic

**Source Files**: 
- `tvd-coheus-operations-qlik/Scripts/ODAG Binding.qvs`
- `tvd-coheus-datapilot-qlik/Scripts/ODAG LoanData.qvs`
- `tvd-coheus-performance-qlik/ODAG Loan Data.qvs` (shared include file)

**ODAG** (On-Demand App Generation) is a Qlik feature that allows users to generate a new Qlik app on-demand based on selections made in a "selection app". The generated app contains only the data matching those selections.

---

## Overview

**ODAG Workflow**:
1. **Selection App**: User makes selections (e.g., specific loan sources, date ranges)
2. **ODAG Binding**: Captures selections and builds WHERE clause filters
3. **ODAG Loan Data**: Loads filtered loan data from QVD files based on WHERE clause
4. **Generated App**: New app created with filtered data

**Purpose**: Allows users to create focused, filtered apps containing only relevant loan data without loading entire datasets.

---

## ODAG Binding

**Purpose**: Captures user selections from the selection app and builds WHERE clause filters

### Binding Process

1. **Capture Selections**: ODAG service passes selected values as variables (e.g., `$(odso_Source)`)
2. **Build Value Lists**: Convert selections into comma-separated, quoted value lists
3. **Construct WHERE Clause**: Build WHERE clause using `mixmatch()` for QVD or `IN` for SQL

### Qlik Script Logic

```qvs
// ODAG Binding Script
// Captures selections and builds WHERE clause

// Subroutine: Build comma-separated, quoted value list
SUB BuildValueList(VarName, TableName, ColName, QuoteChrNum)
  IF ($(QuoteChrNum) = 0) THEN
    LET LOADEXPR = 'Concat($(ColName),' & chr(39) & ',' & chr(39) & ') AS CombinedData';
  ELSE
    LET CHREXPR = ' chr(' & '$(QuoteChrNum)' & ') ';
    LET LOADEXPR = 'Concat( $(CHREXPR) & $(ColName) & $(CHREXPR)' & ',' & chr(39) & ',' & chr(39) & ') AS CombinedData';
  ENDIF
  _TempTable:
  LOAD $(LOADEXPR) Resident $(TableName);
  Let vNoOfRows = NoOfRows('_TempTable');
  IF $(vNoOfRows)> 0 THEN
    LET $(VarName) = Peek('CombinedData',0,'_TempTable');
  ENDIF
  drop table _TempTable;
  drop table '$(TableName)';
END SUB;

// Subroutine: Extend WHERE clause for QVD (uses mixmatch)
SUB ExtendQVDWhere(Name, ValVarName)
  LET T = Name & '_COLNAME';
  LET ColName = $(T);
  LET Values = $(ValVarName);
  IF (len(Values) > 0) THEN
    IF len(WHERE_PART) > 0 THEN
      LET WHERE_PART = '$(WHERE_PART) AND mixmatch([$(ColName)],$(Values) )';
    ELSE
      LET WHERE_PART = ' WHERE mixmatch([$(ColName)],$(Values))';
    ENDIF
  ENDIF
END SUB;

// Subroutine: Extend WHERE clause for SQL (uses IN)
SUB ExtendSQLWhere(Name, ValVarName)
  LET T = Name & '_COLNAME';
  LET ColName = $(T);
  LET Values = $(ValVarName);
  IF (len(Values) > 0) THEN
    IF len(WHERE_PART) > 0 THEN
      LET WHERE_PART = '$(WHERE_PART) AND $(ColName) IN ( $(Values) )';
    ELSE
      LET WHERE_PART = ' WHERE $(ColName) IN ( $(Values) )';
    ENDIF
  ENDIF
END SUB;

// Load ODAG selections into binding table
SET Source='';
OdagBinding:
LOAD * INLINE [
VAL
'$(vSource)'
];
SET SOURCE_COLNAME='Source';
CALL BuildValueList('Source', 'OdagBinding', 'VAL', 39);  // 39 = single quote wrapping

// Build WHERE clause from selections
SET WHERE_PART = '';
FOR EACH fldname IN 'Source'
  LET vallist = $(fldname);
  IF (len(vallist) > 0) THEN
    CALL ExtendQVDWhere('$(fldname)','vallist');
  ENDIF
NEXT fldname
```

### ODAG Variable Prefixes

**Selection Variable Prefixes**:
- `ods` = Selected values only
- `odo` = Associated values only
- `odso` = Selected + Associated values
- `od` = Same as `ods` (selected values)

**Example**: `$(odso_Source)` contains selected Source values from the selection app

### PostgreSQL Translation

**ODAG Binding Logic**:
```sql
-- Function to build WHERE clause from selections
CREATE OR REPLACE FUNCTION build_odag_where_clause(
    p_selections JSONB
)
RETURNS TEXT AS $$
DECLARE
    v_where_clause TEXT := '';
    v_field_name TEXT;
    v_values TEXT[];
    v_value_list TEXT;
BEGIN
    -- Iterate through each field in selections
    FOR v_field_name, v_values IN SELECT * FROM jsonb_each_text(p_selections)
    LOOP
        IF array_length(v_values, 1) > 0 THEN
            -- Build value list (quoted, comma-separated)
            v_value_list := array_to_string(
                ARRAY(SELECT quote_literal(unnest(v_values))),
                ','
            );
            
            -- Add to WHERE clause
            IF v_where_clause = '' THEN
                v_where_clause := format('WHERE %I IN (%s)', v_field_name, v_value_list);
            ELSE
                v_where_clause := v_where_clause || format(' AND %I IN (%s)', v_field_name, v_value_list);
            END IF;
        END IF;
    END LOOP;
    
    RETURN v_where_clause;
END;
$$ LANGUAGE plpgsql;

-- Usage
SELECT build_odag_where_clause('{"source": ["Source1", "Source2"], "branch": ["BRANCH001"]}');
-- Returns: WHERE source IN ('Source1','Source2') AND branch IN ('BRANCH001')
```

---

## ODAG Loan Data Extraction

**Purpose**: Load loan data from QVD files based on WHERE clause built from ODAG selections

### Configuration-Based Loading

**Source**: Excel configuration file (`ODAG Config.xlsx`)

**Configuration Structure**:
```qvs
SourceList:
LOAD
    Enabled,
    Client,
    ClientID,
    [App Name],
    Source,
    [Read Table Name],
    [Write Table Name],
    [Read Library Folder],
    [VP Prefix]
FROM [lib://QlikShare - SharedData/ETLMC/ODAG Config.xlsx]
(ooxml, embedded labels, table is [Load])
where Source = '$(vSource)'
and Enabled = 'Yes';
```

**Configuration Fields**:
- **Enabled**: 'Yes' to include this source in ODAG load
- **Client**: Client name
- **ClientID**: Client identifier
- **App Name**: Application name
- **Source**: Data source identifier
- **Read Table Name**: Source QVD table name (e.g., 'Coheus_Input')
- **Write Table Name**: Target table name in generated app (e.g., 'LoanData')
- **Read Library Folder**: QVD folder path
- **VP Prefix**: Variable prefix for this source

### Data Loading Logic

```qvs
for i = 0 to $(vSourceCount) - 1
    LET vEnabled = peek('Enabled', $(i),'SourceList');
    LET vClient = peek('Client', $(i),'SourceList');
    LET vSource = peek('Source', $(i),'SourceList');
    LET vReadTableName = peek('Read Table Name', $(i),'SourceList');
    LET vWriteTableName = peek('Write Table Name', $(i),'SourceList');
    LET vReadLibraryFolder = peek('Read Library Folder', $(i),'SourceList');
    
    -- Determine file path (demo vs production)
    If '$(vIsDemoApp)'='Yes' Then
        LET vMainFilePath = '$(vQVDPrefix)/Demo/$(vSource)/$(vSource).$(vReadTableName).Anonymized.qvd';
        LET vClient = 'Demo';
    Else
        LET vMainFilePath = '$(vReadLibraryFolder)/$(vSource).$(vReadTableName).L2.qvd';
    End If;
    
    -- Initialize table if it doesn't exist
    IF IsNull(TableNumber('$(vWriteTableName)')) THEN
        $(vWriteTableName):
        LOAD * INLINE [
        $(vWriteTableName)
        ];
    End If
    
    -- Load filtered data
    CONCATENATE ($(vWriteTableName))
    LOAD *
    FROM [$(vMainFilePath)] (qvd)
    $(vOLD_Script_WriteTableNameWhereClause)  -- WHERE clause from ODAG binding
    ;
    
    -- Drop auto-generated field if present
    IF FieldNumber('$(vWriteTableName)', '$(vWriteTableName)') > 0 THEN
        DROP FIELD [$(vWriteTableName)] FROM [$(vWriteTableName)];
    END IF
Next
```

### WHERE Clause Application

**QVD WHERE Clause** (from ODAG Binding):
```qvs
WHERE mixmatch([Source],'Source1','Source2','Source3')
```

**SQL WHERE Clause** (alternative):
```sql
WHERE Source IN ('Source1','Source2','Source3')
```

**PostgreSQL Translation**:
```sql
-- Load loan data with ODAG filters
CREATE OR REPLACE FUNCTION load_odag_loan_data(
    p_selections JSONB,
    p_client_id VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    -- All loan fields
    loan_number VARCHAR,
    application_date DATE,
    funding_date DATE,
    -- ... etc
) AS $$
DECLARE
    v_where_clause TEXT;
BEGIN
    -- Build WHERE clause from selections
    v_where_clause := build_odag_where_clause(p_selections);
    
    -- Add client filter if provided
    IF p_client_id IS NOT NULL THEN
        IF v_where_clause = '' THEN
            v_where_clause := format('WHERE client_id = %L', p_client_id);
        ELSE
            v_where_clause := v_where_clause || format(' AND client_id = %L', p_client_id);
        END IF;
    END IF;
    
    -- Execute dynamic query
    RETURN QUERY EXECUTE format('
        SELECT *
        FROM loans
        %s
    ', v_where_clause);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## Prior Instance Data

**Purpose**: Load historical data from prior instance QVD files

### Logic

```qvs
Let vPriorInstance=if(FileSize('$(vReadLibraryFolder)/$(vSource).Prior_Instance.L2.qvd')>0,1,0);

IF '$(vPriorInstance)'=1 THEN
    CONCATENATE ($(vWriteTableName))
    LOAD *
    FROM [$(vReadLibraryFolder)/$(vSource).Prior_Instance.L2.qvd] (qvd)
    Where [Started Date] >= MonthStart(Today(), -36) AND Not Exists(GUID);
    
    -- Rebuild RowNo field
    Drop Field RowNo;
    Rename Table $(vWriteTableName) To $(vWriteTableName).Temp;
    
    NoConcatenate
    $(vWriteTableName):
    Load RowNo() as RowNo,
        *
    Resident $(vWriteTableName).Temp;
    Drop Table $(vWriteTableName).Temp;
END IF;
```

**Business Rules**:
- Only loads loans with `Started Date` >= 36 months ago
- Excludes loans that already exist (via `Not Exists(GUID)`)
- Rebuilds `RowNo` field after concatenation

**PostgreSQL Translation**:
```sql
-- Load prior instance data
INSERT INTO loan_data
SELECT *
FROM prior_instance_loans
WHERE started_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '36 months'
AND guid NOT IN (SELECT guid FROM loan_data);
```

---

## Linked System Data

**Purpose**: Load combined data from linked systems if available

### Logic

```qvs
LET vLinkedSystemCheck = if(FileSize('$(vReadLibraryFolder)/$(vSource).$(vReadTableName).Combined.qvd')>0,1,0);

IF $(vLinkedSystemCheck)=1 THEN
    If '$(vIsDemoApp)'='Yes' Then
        LET vMainFilePath = '$(vQVDPrefix)/Demo/$(vSource)/$(vSource).$(vReadTableName).Anonymized.qvd';
    Else
        vMainFilePath = '$(vReadLibraryFolder)/$(vSource).$(vReadTableName).Combined.qvd';
    End If;
    
    NoConcatenate
    $(vWriteTableName).Combined:
    LOAD *
    FROM [$(vMainFilePath)] (qvd);
    Drop Table $(vWriteTableName);
    Rename Table $(vWriteTableName).Combined To $(vWriteTableName);
END IF;
```

**Business Rules**:
- If combined QVD exists, replace regular data with combined data
- Combined QVD contains data from multiple linked systems
- Takes precedence over regular QVD files

**PostgreSQL Translation**:
```sql
-- Check if combined data exists
IF EXISTS (SELECT 1 FROM information_schema.tables 
           WHERE table_name = 'loans_combined_' || p_client_id) THEN
    -- Use combined table instead
    SELECT * FROM loans_combined_ || p_client_id;
ELSE
    -- Use regular loans table
    SELECT * FROM loans;
END IF;
```

---

## Channel Filtering (Contribution App)

**Special Case**: Contribution app can filter out Correspondent channel

```qvs
// In Contribution app only:
LET vOLD_Script_WriteTableNameWhereClause = 'Where NOT WildMatch(Channel,' & chr(39) & '*Corresp*' & chr(39) & ')';
```

**PostgreSQL Translation**:
```sql
-- Filter out Correspondent channel
WHERE channel NOT ILIKE '%Corresp%'
```

---

## Revenue Field Mapping

**CCA TVI Consistency**: Maps revenue field for consistency

```qvs
LOAD *
    , Revenue_Exec as Revenue_CCA_TVI
FROM [$(vMainFilePath)] (qvd)
```

**Purpose**: Standardizes revenue field name across apps for CCA (Coheus Component Architecture) TVI consistency.

---

## ODAG Configuration Table

**PostgreSQL Translation**:

```sql
CREATE TABLE odag_config (
    id SERIAL PRIMARY KEY,
    enabled BOOLEAN DEFAULT TRUE,
    client VARCHAR(100),
    client_id VARCHAR(100),
    app_name VARCHAR(100),
    source VARCHAR(100),
    read_table_name VARCHAR(100),
    write_table_name VARCHAR(100),
    read_library_folder VARCHAR(500),
    vp_prefix VARCHAR(50),
    scheduling_server VARCHAR(100),
    scheduling_frequency VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for lookups
CREATE INDEX idx_odag_config_source ON odag_config(source, enabled);
```

---

## Source Fields

ODAG uses fields from the [Coheus Data Dictionary](../../data-dictionary/CoheusDataDictionary.xml):

**Key Filter Fields**:
- `Source` (Encompass: derived field) - Primary filter field
- `Channel` (Encompass: `Fields.1108`) - Channel filtering
- `Started Date` (Encompass: derived field) - Date filtering for prior instance
- `GUID` (Encompass: derived field) - Unique identifier for deduplication

**See**: `patterns/source-fields.md` for complete data dictionary integration guide.

---

## Migration Notes

- **ODAG Service**: Qlik-specific feature - PostgreSQL equivalent would be API-based filtering
- **Dynamic WHERE Clauses**: Use parameterized queries or dynamic SQL functions
- **Configuration Storage**: Store ODAG config in database tables instead of Excel files
- **QVD Files**: Replace with direct database queries or materialized views
- **Prior Instance Logic**: Implement as separate table or UNION query
- **Linked System Logic**: Use views or UNION queries to combine data sources

---

## PostgreSQL Implementation Strategy

### Option 1: API-Based Filtering (Recommended)

**Replace ODAG with REST API**:
```sql
-- API endpoint: GET /api/odag/loan-data
-- Query parameters: ?source=Source1,Source2&branch=BRANCH001

CREATE OR REPLACE FUNCTION api_get_odag_loan_data(
    p_selections JSONB,
    p_client_id VARCHAR
)
RETURNS JSONB AS $$
DECLARE
    v_where_clause TEXT;
    v_result JSONB;
BEGIN
    -- Build WHERE clause
    v_where_clause := build_odag_where_clause(p_selections);
    
    -- Add client filter
    IF v_where_clause = '' THEN
        v_where_clause := format('WHERE client_id = %L', p_client_id);
    ELSE
        v_where_clause := v_where_clause || format(' AND client_id = %L', p_client_id);
    END IF;
    
    -- Execute query and return JSON
    EXECUTE format('
        SELECT jsonb_agg(row_to_json(t))
        FROM (
            SELECT * FROM loans %s
        ) t
    ', v_where_clause) INTO v_result;
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Option 2: Materialized View with Filters

**Create filtered materialized views**:
```sql
-- Create materialized view for each common filter combination
CREATE MATERIALIZED VIEW loans_by_source AS
SELECT *
FROM loans
WHERE source IN (SELECT source FROM odag_config WHERE enabled = TRUE);

-- Refresh on schedule
REFRESH MATERIALIZED VIEW CONCURRENTLY loans_by_source;
```

---

## See Also

- **Qlik ODAG Documentation**: [Qlik On-Demand App Generation](https://help.qlik.com/en-US/sense-developer/Subsystems/OnDemandAppGeneration/Content/Sense_OnDemandAppGeneration/On-Demand-App-Generation.htm)
- **PostgreSQL Mapping**: `migration/postgresql-mapping.md` - General migration patterns
- **Source Fields**: `patterns/source-fields.md` - Field definitions
