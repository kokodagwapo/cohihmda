# Turn Time Ranges - Derived Logic

## Base Concept

This logic builds on the base turn time definition. See `concepts/turn-time.md` for the core turn time concept.

## Source Fields

Turn time ranges are applied to base turn time calculations, which use date fields from the [Coheus Data Dictionary](../../data-dictionary/CoheusDataDictionary.xml):

**Common Date Fields Used**:
- `Application Date` (Encompass: `Fields.3142`)
- `Funding Date` (Encompass: `Fields.MS.FUN`)
- `Estimated Closing Date` (Encompass: `Fields.763`)
- `Lock Expiration Date` (Encompass: `Fields.762`)
- `Loan Estimate Sent Date` (Encompass: `Fields.3152`)
- `Investor Purchase Date` (Encompass: `Fields.2370`)

**See**: `patterns/source-fields.md` for complete data dictionary integration guide.

## Definition

Turn time ranges categorize turn time values into buckets for analysis and reporting. These ranges are applied to base turn time calculations to enable grouping and filtering.

## Pattern

```sql
CASE 
    WHEN base_turn_time < 0 THEN '<0'
    WHEN base_turn_time <= 5 THEN '0-5'
    WHEN base_turn_time <= 10 THEN '6-10'
    WHEN base_turn_time <= 15 THEN '11-15'
    WHEN base_turn_time <= 20 THEN '16-20'
    WHEN base_turn_time <= 25 THEN '21-25'
    ELSE '>25'
END as turn_time_range
```

## Examples

### W-H Days Range

**Base Field**: `W-H Days` (from `concepts/turn-time.md` - warehouse line duration)

**Buckets**: '<0', '0-5', '6-10', '11-15', '16-20', '21-25', '>25'

**Qlik Expression**:
```qvs
if("W-H Days" < 0, '<0',
   if("W-H Days" <= 5, '0-5',
   if("W-H Days" <= 10, '6-10',
   if("W-H Days" <= 15, '11-15',
   if("W-H Days" <= 20, '16-20',
   if("W-H Days" <= 25, '21-25',
   '>25')))))) as [W-H Days Range]
```

**PostgreSQL**:
```sql
CASE 
    WHEN w_h_days < 0 THEN '<0'
    WHEN w_h_days <= 5 THEN '0-5'
    WHEN w_h_days <= 10 THEN '6-10'
    WHEN w_h_days <= 15 THEN '11-15'
    WHEN w_h_days <= 20 THEN '16-20'
    WHEN w_h_days <= 25 THEN '21-25'
    ELSE '>25'
END as w_h_days_range
```

**Source**: Transform.qvs line 657-665

### Lock Expire Days Range

**Base Field**: Lock expiration days calculation

**Source Field**: `Lock Expiration Date` (Fields.762)

**Buckets**: 'Lock Expiration Date is Blank', 'Expired', 'Expiring Today', '1-7', '8-14', '15-21', '22-30', '31-45', '46-60', '60>'

**Qlik Expression**:
```qvs
if(Len([Lock Expiration Date])=0, 'Lock Expiration Date is Blank', 
   If([Lock Expiration Date] - $(vCurrentDate)<0,'Expired',
      If([Lock Expiration Date] - $(vCurrentDate)=0,'Expiring Today',
         If([Lock Expiration Date] - $(vCurrentDate)<=7,'1-7',
            If([Lock Expiration Date] - $(vCurrentDate)<=14,'8-14',
               If([Lock Expiration Date] - $(vCurrentDate)<=21,'15-21',
                  If([Lock Expiration Date] - $(vCurrentDate)<=30,'22-30',
                     If([Lock Expiration Date] - $(vCurrentDate)<=45,'31-45',
                        If([Lock Expiration Date] - $(vCurrentDate)<=60,'46-60',
                           '60>'))))))))) as [Lock Expire Days Range]
```

**PostgreSQL**:
```sql
CASE 
    WHEN lock_expiration_date IS NULL THEN 'Lock Expiration Date is Blank'
    WHEN lock_expiration_date < CURRENT_DATE THEN 'Expired'
    WHEN lock_expiration_date = CURRENT_DATE THEN 'Expiring Today'
    WHEN lock_expiration_date - CURRENT_DATE <= 7 THEN '1-7'
    WHEN lock_expiration_date - CURRENT_DATE <= 14 THEN '8-14'
    WHEN lock_expiration_date - CURRENT_DATE <= 21 THEN '15-21'
    WHEN lock_expiration_date - CURRENT_DATE <= 30 THEN '22-30'
    WHEN lock_expiration_date - CURRENT_DATE <= 45 THEN '31-45'
    WHEN lock_expiration_date - CURRENT_DATE <= 60 THEN '46-60'
    ELSE '60>'
END as lock_expire_days_range
```

**Source**: Transform.qvs line 250-259

### App-LE Sent Days Grouping

**Base Field**: `App-LE Sent Days` (business days from Application Date to Loan Estimate Sent Date)

**Source Fields**: `Application Date` (Fields.3142), `Loan Estimate Sent Date` (Fields.3152)

**Buckets**: '0-1 Days', '2 Days', '3 Days', '> 3 Days', 'Dates Not Posted'

**Qlik Expression**:
```qvs
if([App-LE Sent Days]<=1, '0-1 Days',
   if([App-LE Sent Days]<=2, '2 Days',
   if([App-LE Sent Days]<=3, '3 Days',
   if([App-LE Sent Days]>3,'> 3 Days','Dates Not Posted')))) as [App-LE Sent Days Grouping]
```

**PostgreSQL**:
```sql
CASE 
    WHEN app_le_sent_days IS NULL THEN 'Dates Not Posted'
    WHEN app_le_sent_days <= 1 THEN '0-1 Days'
    WHEN app_le_sent_days <= 2 THEN '2 Days'
    WHEN app_le_sent_days <= 3 THEN '3 Days'
    WHEN app_le_sent_days > 3 THEN '> 3 Days'
    ELSE 'Dates Not Posted'
END as app_le_sent_days_grouping
```

**Source**: Transform.qvs line 637-640

### Estimated Closing Days Range

**Base Field**: Days until Estimated Closing Date

**Source Field**: `Estimated Closing Date` (Fields.763)

**Buckets**: 'Active Loan, Not Closed', 'Scheduled Today', '1-7', '8-14', '15-21', '22-30', '31-45', '46-60', '60>'

**Qlik Expression**:
```qvs
If("Estimated Closing Date" - $(vCurrentDate)<0,'Active Loan, Not Closed',
   If("Estimated Closing Date" - $(vCurrentDate)=0,'Scheduled Today',
   If("Estimated Closing Date" - $(vCurrentDate)<=7,'1-7',
   If("Estimated Closing Date" - $(vCurrentDate)<=14,'8-14',
   If("Estimated Closing Date" - $(vCurrentDate)<=21,'15-21',
   If("Estimated Closing Date" - $(vCurrentDate)<=30,'22-30',
   If("Estimated Closing Date" - $(vCurrentDate)<=45,'31-45',
   If("Estimated Closing Date" - $(vCurrentDate)<=60,'46-60',
   '60>')))))))) as [Estimated Closing Days Range]
```

**PostgreSQL**:
```sql
CASE 
    WHEN estimated_closing_date < CURRENT_DATE THEN 'Active Loan, Not Closed'
    WHEN estimated_closing_date = CURRENT_DATE THEN 'Scheduled Today'
    WHEN estimated_closing_date - CURRENT_DATE <= 7 THEN '1-7'
    WHEN estimated_closing_date - CURRENT_DATE <= 14 THEN '8-14'
    WHEN estimated_closing_date - CURRENT_DATE <= 21 THEN '15-21'
    WHEN estimated_closing_date - CURRENT_DATE <= 30 THEN '22-30'
    WHEN estimated_closing_date - CURRENT_DATE <= 45 THEN '31-45'
    WHEN estimated_closing_date - CURRENT_DATE <= 60 THEN '46-60'
    ELSE '60>'
END as estimated_closing_days_range
```

**Source**: Transform.qvs line 727-735

## Business Rules

- Ranges typically start with negative values or special cases (e.g., '<0', 'Expired')
- Common bucket sizes: 5-day, 7-day, or custom ranges
- NULL/missing values often get special bucket (e.g., 'Dates Not Posted')
- Ranges are inclusive on the upper bound (e.g., '<= 5' means 0-5)

## Dependencies

- Base turn time calculations (see `concepts/turn-time.md`)
- Current date for relative calculations
- Date fields for expiration/projection ranges

## Used In

- All apps
- Turn time reporting
- Operations dashboards
- Performance analysis

## Migration Notes

- Ranges are simple CASE statements - no pre-computation needed
- Can create reusable range functions if patterns repeat
- Consider creating views if ranges are used frequently
- Formatting can be done in application layer if needed

## See Also

- Base concept: `concepts/turn-time.md`
- Qlik implementation: `core/transform-logic.md#turn-time-calculations`
- Patterns: `patterns/aggregation-patterns.md` - Class() bucketing pattern
