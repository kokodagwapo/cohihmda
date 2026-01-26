# Logic Dictionary - Qlik to PostgreSQL Migration

This directory contains comprehensive documentation of all business logic definitions from Qlik applications, prepared for migration to PostgreSQL + backend services + AI integration.

---

## Overview

This logic dictionary extracts and documents:
- Field definitions and calculated fields
- Date flags and calendar logic
- Turn time calculations
- Pull through rates
- Revenue calculations
- Complexity scores
- Status and channel flags
- Variables and expressions
- App-specific logic

---

## Directory Structure

```
docs/logic-dictionary/
├── README.md (this file)
├── INDEX.md (master index)
├── core/
│   ├── transform-logic.md (Transform.qvs logic)
│   ├── calendar-logic.md (Calendar generation)
│   └── variables.md (Variable definitions)
├── apps/
│   ├── sales-app-logic.md
│   ├── datapilot-app-logic.md
│   ├── performance-app-logic.md
│   ├── operations-app-logic.md
│   ├── contribution-to-profit-app-logic.md
│   └── qvf-expressions.md (QSDA extraction strategy)
├── migration/
│   ├── postgresql-mapping.md (Qlik → PostgreSQL mappings)
│   └── backend-architecture.md (Architecture recommendations)
├── validation/
│   └── missing-logic.md (Validation report)
└── schema/
    └── logic-definition-schema.json (JSON schema)
```

---

## Quick Start

1. **Start with INDEX.md** - Overview of all logic categories
2. **Review core/transform-logic.md** - Core business logic
3. **Check migration/postgresql-mapping.md** - SQL equivalents
4. **Review migration/backend-architecture.md** - Implementation recommendations
5. **Parse QSDA exports** - Extract app expressions (see apps/qvf-expressions.md)

---

## Key Documents

### Core Logic
- **transform-logic.md**: All logic from Transform.qvs (date flags, turn times, revenue, complexity, flags)
- **calendar-logic.md**: Calendar generation subroutine and DateLink table
- **variables.md**: Key variable definitions and patterns

### App-Specific Logic
- **sales-app-logic.md**: Sales app extensions (active aging, lock expiration)
- **datapilot-app-logic.md**: DataPilot app logic (stratification, range validations)
- **performance-app-logic.md**: Performance app logic (TTS, staffing)
- **operations-app-logic.md**: Operations app logic (turn time reports)
- **contribution-to-profit-app-logic.md**: Contribution to Profit app logic

### Migration Guides
- **postgresql-mapping.md**: Complete Qlik → PostgreSQL function mappings
- **backend-architecture.md**: Recommendations for database vs application layer vs AI

### Extraction Strategy
- **qvf-expressions.md**: Strategy for extracting expressions from QSDA exports

---

## Logic Categories

### Date Logic
- Date flags (MTD, YTD, Rolling periods, All Time)
- Calendar generation
- DateLink table structure
- Period-to-date calculations

### Turn Time
- Milestone-to-milestone calculations
- Business days vs calendar days
- Active aging calculations
- Warehouse line duration

### Pull Through
- Application to Investor Purchase
- Channel-specific start dates
- Rolling period pull through
- Scorecard pull through

### Revenue
- Origination revenue
- Secondary revenue
- Buy/Sell price conversions
- Basis points calculations

### Complexity
- Loan complexity score
- Component complexity scores
- Risk factor aggregation

### Flags
- Status flags (Funded, Sold, Active, etc.)
- Channel flags (Retail, TPO, Correspondent)
- Validation flags (Out of Range)
- Date flags

### Stratification
- Year stratification (with 'Date Missing')
- Range categorizations
- Loan amount buckets
- Aging ranges

---

## Next Steps

1. **Parse QSDA Exports**: Extract expressions from Expressions.csv, Variables.csv, Dimensions.csv
2. **Document Functions**: Create function definition library
3. **Document Mappings**: Document mapping tables
4. **Cross-Reference**: Compare script logic vs app expressions
5. **Create Function Library**: PostgreSQL function implementations
6. **Performance Optimization**: Create performance guide

---

## Usage

### For Developers
- Reference `postgresql-mapping.md` for SQL equivalents
- Use `backend-architecture.md` for implementation decisions
- Check `core/transform-logic.md` for field definitions

### For Analysts
- Review `INDEX.md` for logic overview
- Check app-specific files for app logic
- Reference `validation/missing-logic.md` for gaps

### For Migration Team
- Follow `migration/postgresql-mapping.md` for conversions
- Use `migration/backend-architecture.md` for architecture
- Parse QSDA exports per `apps/qvf-expressions.md`

---

## Notes

- All logic includes Qlik expressions and PostgreSQL equivalents
- Dependencies are documented for each logic definition
- Business rules explain the "why" behind calculations
- Migration notes provide PostgreSQL-specific considerations

---

## Contributing

When adding new logic definitions:
1. Follow the standardized format in `schema/logic-definition-schema.json`
2. Include Qlik expression, SQL equivalent, dependencies, and business rules
3. Update INDEX.md with new entries
4. Cross-reference with existing logic

---

## Status

**Completed**: Core logic, app summaries, migration guides, validation framework  
**Pending**: QSDA CSV parsing, function definitions, mapping tables documentation
