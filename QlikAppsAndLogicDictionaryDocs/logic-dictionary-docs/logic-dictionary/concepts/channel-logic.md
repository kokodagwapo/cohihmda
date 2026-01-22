# Channel Logic - Base Concept

## Definition

Channel logic categorizes loans by their origination channel (Retail, Wholesale, Correspondent) and enables channel-specific calculations and filtering.

## Core Pattern

Channel identification uses pattern matching on the Channel field to categorize loans into groups.

## Channel Categories

### Retail
Loans originated through retail channels (direct to consumer).

**Pattern**: Channel contains "Retail"

### TPO (Third Party Originator)
Loans originated through third-party channels, including:
- **Wholesale**: Wholesale channel
- **Correspondent**: Correspondent channel

**Pattern**: Channel contains "Whol" or "Corresp"

### Channel Group
Simplified grouping:
- Retail → "Retail"
- Wholesale or Correspondent → "TPO"
- Other → Original Channel value

## SQL Implementation

```sql
-- Retail Flag
CASE 
    WHEN channel ILIKE '%Retail%' THEN 'Yes'
    ELSE 'No'
END as retail_flag

-- TPO Flag
CASE 
    WHEN channel ILIKE '%Whol%' 
      OR channel ILIKE '%Corresp%' 
    THEN 'Yes' 
    ELSE 'No' 
END as tpo_flag

-- Correspondent Channel Flag
CASE 
    WHEN channel ILIKE 'Corresp%' THEN 'Yes'
    ELSE 'No'
END as correspondent_channel_flag

-- Channel Group
CASE 
    WHEN channel ILIKE '%Retail%' THEN 'Retail'
    WHEN channel ILIKE '%Whole%' OR channel ILIKE '%Corresp%' THEN 'TPO'
    ELSE channel
END as channel_group
```

## Multi-Channel Logic

### Multi-Channel App/Start Date

Different channels use different start dates for pull-through calculations:
- **Retail**: Uses Application Date
- **TPO** (Wholesale/Correspondent): Uses Started Date

**Reason**: TPO Submitted Date is unreliable, so Started Date is used instead.

```sql
CASE 
    WHEN channel ILIKE '%Retail%' THEN application_date
    WHEN channel ILIKE '%Wholesale%' OR channel ILIKE '%Corresp%' THEN started_date
    ELSE NULL
END as multi_channel_app_start_date
```

## Business Rules

- Pattern matching is case-insensitive
- Channel field may contain variations (e.g., "Retail", "Retail Channel")
- TPO channels require different date logic due to data quality issues
- Channel Group simplifies analysis by grouping TPO channels together

## Dependencies

- Channel field
- Application Date (for Retail)
- Started Date (for TPO)

## Used In

- All apps
- Channel-specific reporting
- Pull-through calculations
- Performance analysis by channel

## See Also

- Qlik implementation: `core/transform-logic.md#channel-flags`
- Patterns: `patterns/aggregation-patterns.md` - WildMatch pattern matching
