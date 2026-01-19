# Operations App Logic Dictionary

**Source Files**: `tvd-coheus-operations-qlik/Scripts/*.qvs`

This document catalogs Operations app-specific logic, particularly turn time reporting.

---

## Turn Time Report Logic

### Ad Hoc Turn Times
**Category**: Turn Time  
**Definition**: Custom turn time calculations defined in configuration  
**Source File**: `Ad Hoc-Turn Times-Cust Report.qvs`

**Key Features**:
- Dynamic turn time field definitions from configuration
- Custom start/end date selections
- Turn time aggregation methods (Avg, Sum, etc.)

**Qlik Expression Pattern**:
```qvs
// Turn time variables loaded from configuration
For i=1 to 10
    Let vTurnTimeStart$(i)=; // Start date field
    Let vTurnTimeEnd$(i)=;   // End date field
Next i;
```

**SQL Equivalent**:
```sql
-- Configuration table for turn time definitions
CREATE TABLE turn_time_definitions (
    turn_time_id INTEGER,
    start_date_field VARCHAR(100),
    end_date_field VARCHAR(100),
    turn_time_name VARCHAR(100)
);

-- Calculate turn times dynamically
SELECT 
    turn_time_name,
    DATE(end_date_field) - DATE(start_date_field) as turn_time_days
FROM loans
JOIN turn_time_definitions ON ...
```

**Dependencies**: Configuration XML, date fields  
**Used In**: Operations app  
**Business Rules**: Allows custom turn time definitions per client  
**Migration Notes**: Store turn time definitions in configuration table

---

## Milestone Dates

### Milestone Date Logic
**Category**: Date Calculations  
**Definition**: Milestone date calculations and groupings  
**Source File**: `Milestone Dates.qvs`

**Key Features**:
- Milestone date extractions
- Milestone date groupings
- Milestone-based filtering

**Migration Notes**: Similar to standard date logic but milestone-focused

---

## Data Dictionary Addons

### Custom Field Definitions
**Category**: Field Definitions  
**Definition**: Custom field definitions loaded from configuration  
**Source File**: `Data Dictionary Addons.qvs`

**Key Features**:
- Dynamic field aliases
- Custom field mappings
- Field grouping and categorization

**Migration Notes**: Store field mappings in configuration table

---

## Notes

- Operations app focuses on turn time analysis
- Supports custom turn time definitions
- Milestone-focused date calculations
- Custom field definitions from configuration
