# QVF App Expression Extraction Strategy

**Source**: QSDA (Qlik Sense Data Analyzer) CSV Exports

This document outlines the strategy for extracting expressions from Qlik Sense app files (.qvf) using QSDA exports.

---

## QSDA Export Structure

QSDA exports provide comprehensive CSV files containing all expressions, variables, dimensions, and metadata from Qlik Sense apps.

### Available Files

1. **Expressions.csv** (6,736+ lines)
   - All measure/expression definitions
   - Expanded definitions (with variable substitution)
   - Dependencies (fields, measures, variables, functions)
   - Usage counts

2. **Variables.csv** (3,078+ lines)
   - All variable definitions
   - Expanded definitions
   - Dependencies and usage

3. **Dimensions.csv** (751+ lines)
   - Calculated dimensions
   - Field references

4. **Functions.csv** (5,948+ lines)
   - Function usage tracking

5. **Flags.csv** (1,622+ lines)
   - Quality flags and validation issues

6. **Script.csv** (35+ lines)
   - Actual script content

7. **Linktable.csv** (25,936+ lines)
   - Data model relationships

8. **Vizobjects.csv** (362+ lines)
   - Visualization objects and expressions

---

## Extraction Process

### Step 1: Parse Expressions.csv

**Key Columns**:
- `Label`: Measure name
- `Def`: Original expression definition
- `DefExpanded`: Fully expanded expression (variables substituted)
- `FieldNames`: Comma-separated list of fields used
- `MeasureNames`: Comma-separated list of measures used
- `VariableNames`: Comma-separated list of variables used
- `FunctionNames`: Comma-separated list of functions used
- `UseCount`: Number of times expression is used

**Extraction Logic**:
1. Read CSV file
2. For each expression:
   - Extract `Def` and `DefExpanded`
   - Parse dependencies from `FieldNames`, `MeasureNames`, `VariableNames`, `FunctionNames`
   - Identify set analysis patterns (`{$<...>}`)
   - Categorize by expression type (aggregation, calculation, etc.)
   - Track usage via `UseCount`

**Example**:
```csv
Label,Def,DefExpanded,FieldNames,MeasureNames,VariableNames,FunctionNames,UseCount
Units_InRange,"Num(Count({$<[FICO Score]={">350<900"}, [BE DTI Ratio]={"<=70"}, [LTV Ratio]={"<110"}, [Interest Rate]={">0<15"}>}[Loan Number]),'#,##0')",...,Interest Rate,,"num, count",1
```

---

### Step 2: Parse Variables.csv

**Key Columns**:
- `Name`: Variable name
- `Def`: Variable definition
- `DefExpanded`: Expanded definition
- `FieldNames`, `MeasureNames`, `VariableNames`, `FunctionNames`: Dependencies
- `UseCount`: Usage count

**Extraction Logic**:
1. Read CSV file
2. For each variable:
   - Extract `Def` and `DefExpanded`
   - Identify complex expressions (e.g., pull through calculations)
   - Parse dependencies
   - Categorize by variable type (date toggle, channel filter, etc.)

**Example**:
```csv
Name,Def,DefExpanded,FieldNames,MeasureNames,VariableNames,FunctionNames,UseCount
vScorecardPullThroughAvg_2Months,"=Avg({$<[Scorecard PullThrough_2Months] *= {">0"}, ...>} Aggr(...))",...,Scorecard PullThrough_2Months,vScorecardAggrLevel,"aggr, avg",1
```

---

### Step 3: Parse Dimensions.csv

**Key Columns**:
- `Label`: Dimension name
- `Def`: Dimension definition
- `Fieldname`: Referenced field

**Extraction Logic**:
1. Read CSV file
2. For each dimension:
   - Extract `Def`
   - Identify calculated dimensions (those with expressions)
   - Parse field references

---

### Step 4: Cross-Reference with Scripts

**Process**:
1. Match expressions/variables found in QSDA with script definitions
2. Identify expressions only in apps (not in scripts)
3. Identify script logic not used in apps
4. Document discrepancies

**Output**: Missing logic report

---

## Expression Categories to Extract

### 1. Set Analysis Expressions
**Pattern**: `{$<...>}`  
**Location**: `Def` column in Expressions.csv  
**Example**:
```qvs
Count({$<[FICO Score]={">350<900"}, [BE DTI Ratio]={"<=70"}>}[Loan Number])
```
**SQL Equivalent**:
```sql
SELECT COUNT(*) 
FROM loans 
WHERE fico_score > 350 AND fico_score < 900
  AND be_dti_ratio <= 70
```

---

### 2. Aggregation Expressions
**Pattern**: `Count()`, `Sum()`, `Avg()`, etc.  
**Location**: Expressions.csv  
**Example**:
```qvs
Sum({$<[Funding Rolling 13 Month Flag]={Yes}>}[Loan Amount])
```
**SQL Equivalent**:
```sql
SELECT SUM(loan_amount)
FROM loans
WHERE funding_rolling_13_month_flag = 'Yes'
```

---

### 3. Calculated Dimensions
**Pattern**: Expressions in Dimensions.csv `Def` column  
**Location**: Dimensions.csv  
**Example**:
```qvs
=If(Len('$(vCustName9)')=0,'Additional Field 9 Empty','$(vCustName9)')
```
**SQL Equivalent**:
```sql
CASE 
    WHEN custom_field_9 IS NULL THEN 'Additional Field 9 Empty'
    ELSE custom_field_9
END
```

---

### 4. Variable Expressions
**Pattern**: Complex calculations in Variables.csv  
**Location**: Variables.csv  
**Example**: Pull through calculations, scorecard averages  
**SQL Equivalent**: Depends on specific expression

---

### 5. Conditional Expressions
**Pattern**: `If()`, `Case()` statements  
**Location**: Expressions.csv, Variables.csv  
**Example**:
```qvs
If([Revenue] > 0, [Revenue], 0)
```
**SQL Equivalent**:
```sql
CASE WHEN revenue > 0 THEN revenue ELSE 0 END
```

---

## QSDA Export Locations

Expected structure for each app:
- `tvd-coheus-contribution-to-profit-qlik/QSDA-Profit Pulse-{app-id}/`
- `tvd-coheus-sales-qlik/QSDA-Sales-{app-id}/`
- `tvd-coheus-datapilot-qlik/QSDA-Data Pilot-{app-id}/`
- `tvd-coheus-operations-qlik/QSDA-Operations-{app-id}/`
- `Performance/tvd-coheus-performance-qlik/QSDA-Performance-{app-id}/`

---

## Extraction Tools/Methods

### Option 1: Python Script
Create Python script to parse CSV files:
```python
import pandas as pd
import json

def extract_expressions(csv_path):
    df = pd.read_csv(csv_path)
    expressions = []
    for _, row in df.iterrows():
        expressions.append({
            'name': row['Label'],
            'definition': row['Def'],
            'expanded': row['DefExpanded'],
            'dependencies': {
                'fields': row['FieldNames'].split(',') if pd.notna(row['FieldNames']) else [],
                'measures': row['MeasureNames'].split(',') if pd.notna(row['MeasureNames']) else [],
                'variables': row['VariableNames'].split(',') if pd.notna(row['VariableNames']) else [],
                'functions': row['FunctionNames'].split(',') if pd.notna(row['FunctionNames']) else []
            },
            'use_count': row['UseCount']
        })
    return expressions
```

### Option 2: Manual Documentation
For smaller sets, manually extract key expressions

### Option 3: Qlik API
Use Qlik Sense REST API to extract expressions programmatically

---

## Output Format

Extracted expressions should be documented in the same format as script logic:

```markdown
## [Expression Name]

**Category**: [Category]
**Definition**: [Description]
**Qlik Expression**: 
```qvs
[Original expression]
```
**SQL Equivalent**:
```sql
[PostgreSQL equivalent]
```
**Dependencies**: [List]
**Used In**: [App name]
**Source**: QSDA Export - Expressions.csv
```

---

## Next Steps

1. Parse QSDA CSV exports for all apps
2. Extract expressions, variables, and dimensions
3. Categorize by type and usage
4. Cross-reference with script logic
5. Document missing logic
6. Create SQL equivalents
7. Add to master index

---

## Notes

- QSDA exports provide comprehensive coverage of app expressions
- `DefExpanded` column shows fully resolved expressions (variables substituted)
- Dependency columns enable automated dependency tracking
- `UseCount` helps prioritize important expressions
- Cross-referencing with scripts identifies app-only logic
