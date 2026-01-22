# Logic Dictionary - Qlik to PostgreSQL Migration

This directory contains comprehensive documentation of all business logic definitions from Qlik applications, prepared for migration to PostgreSQL + backend services + AI integration.

---

## Overview

This logic dictionary uses a **hierarchical, base-definition approach**:
- **Base Concepts**: Fundamental definitions (e.g., "What is turn time?")
- **Derived Logic**: Logic that builds on base concepts (e.g., turn time ranges)
- **Qlik Patterns**: Qlik-specific patterns that translate to PostgreSQL (e.g., date flags → functions)

This structure enables:
- Understanding base logic before seeing implementations
- Extrapolating derived logic from base definitions
- Clear PostgreSQL translation patterns

---

## Directory Structure

```
logic-dictionary/
├── README.md (this file)
├── INDEX.md (master index)
├── concepts/                    # Base concept definitions
│   ├── turn-time.md            # "What is turn time?" - core definition
│   ├── revenue.md              # "What is revenue?" - core definition
│   ├── status-flags.md         # "What are status flags?" - core definition
│   ├── complexity.md          # "What is complexity?" - core definition
│   └── channel-logic.md        # "What is channel logic?" - core definition
├── patterns/                    # Qlik-specific patterns → PostgreSQL translations
│   ├── date-period-filtering.md    # Date flags → Functions (NOT computed columns)
│   ├── dual-display-sort.md        # Dual() → Two columns/computed sort
│   ├── mapping-lookups.md          # ApplyMap() → JOINs
│   ├── date-groupings.md           # YearMonth → DATE_TRUNC functions
│   ├── null-handling.md            # NullAsValue → COALESCE
│   ├── aggregation-patterns.md    # RangeSum, Class, WildMatch → Functions/CASE
│   └── qlik-to-postgresql.md       # General translation reference
├── derived/                      # Derived logic that uses base concepts
│   ├── turn-time-ranges.md     # Ranges/buckets for turn times
│   ├── revenue-calculations.md # Specific revenue formulas
│   └── stratification.md       # Buckets and groupings
├── core/                         # Core Qlik script logic
│   ├── transform-logic.md        # Transform.qvs logic (references base concepts)
│   ├── calendar-logic.md         # Calendar generation
│   └── variables.md              # Variable definitions
├── apps/                         # App-specific logic
│   ├── sales-app-logic.md
│   ├── datapilot-app-logic.md
│   ├── performance-app-logic.md
│   ├── operations-app-logic.md
│   ├── contribution-to-profit-app-logic.md
│   └── qvf-expressions.md (QSDA extraction strategy)
├── migration/                    # Migration guides
│   ├── postgresql-mapping.md     # Qlik → PostgreSQL mappings
│   └── backend-architecture.md   # Architecture recommendations
├── validation/                   # Validation reports
│   └── missing-logic.md
└── schema/                       # Schema definitions
    └── logic-definition-schema.json
```

---

## Quick Start

### For Understanding Base Logic
1. **Start with concepts/** - Understand base definitions (turn time, revenue, etc.)
2. **Review derived/** - See how logic builds on base concepts
3. **Check patterns/** - Understand Qlik → PostgreSQL translations

### For Migration
1. **Review patterns/** - See how Qlik patterns translate to PostgreSQL
2. **Check migration/postgresql-mapping.md** - Function mappings
3. **Review migration/backend-architecture.md** - Implementation approach
4. **Reference core/transform-logic.md** - Qlik implementations

### For Development
1. **Start with concepts/** - Base definitions
2. **Check patterns/** - Translation patterns
3. **Reference core/** - Qlik implementations for context

---

## Key Documents

### Base Concepts (`concepts/`)
Start here to understand fundamental definitions:
- **turn-time.md**: Core turn time definition - "What is turn time?"
- **revenue.md**: Core revenue definition - "What is revenue?"
- **status-flags.md**: Status flag definitions and patterns
- **complexity.md**: Complexity score definition and components
- **channel-logic.md**: Channel logic and multi-channel patterns

### Qlik Patterns (`patterns/`)
Qlik-specific patterns and their PostgreSQL translations:
- **source-fields.md**: Data dictionary integration - how formulas reference source fields
- **date-period-filtering.md**: Date flags → PostgreSQL functions (NOT computed columns)
- **dual-display-sort.md**: Dual() → Two columns or DATE_TRUNC
- **mapping-lookups.md**: ApplyMap() → JOINs to mapping tables
- **date-groupings.md**: YearMonth → DATE_TRUNC functions
- **null-handling.md**: NullAsValue → COALESCE
- **aggregation-patterns.md**: RangeSum, Class, WildMatch translations
- **section-access-row-security.md**: Section Access → PostgreSQL Row-Level Security (RLS) policies
- **qlik-to-postgresql.md**: General translation reference

### Derived Logic (`derived/`)
Logic that builds on base concepts:
- **turn-time-ranges.md**: Buckets/ranges for turn time values (references `concepts/turn-time.md`)
- **revenue-calculations.md**: Specific revenue formulas (references `concepts/revenue.md`)
- **stratification.md**: Buckets and groupings for analysis

### Core Qlik Logic (`core/`)
Qlik script implementations (references base concepts):
- **transform-logic.md**: All logic from Transform.qvs (references base concepts and patterns)
- **calendar-logic.md**: Calendar generation subroutine and DateLink table
- **variables.md**: Key variable definitions and patterns

### App-Specific Logic (`apps/`)
- **sales-app-logic.md**: Sales app extensions (active aging, lock expiration)
- **datapilot-app-logic.md**: DataPilot app logic (stratification, range validations)
- **performance-app-logic.md**: Performance app logic (TTS, staffing)
- **operations-app-logic.md**: Operations app logic (turn time reports)
- **contribution-to-profit-app-logic.md**: Contribution to Profit app logic
- **qvf-expressions.md**: Strategy for extracting expressions from QSDA exports

### Migration Guides (`migration/`)
- **postgresql-mapping.md**: Complete Qlik → PostgreSQL function mappings (references patterns)
- **backend-architecture.md**: Architecture recommendations (patterns → functions approach)

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

## Source Fields and Data Dictionary

All formulas in the logic dictionary are built from **source fields** defined in the [Coheus Data Dictionary](../data-dictionary/CoheusDataDictionary.xml). The data dictionary maps Encompass field IDs to Coheus aliases, which will be used as PostgreSQL column names.

### How It Works

1. **Data Dictionary**: Maps Encompass Field IDs → Coheus Aliases
   - Example: `Fields.3142` → `Application Date`
   
2. **Logic Dictionary**: Documents formulas using Coheus Aliases
   - Example: `DATE(funding_date) - DATE(application_date)`
   
3. **PostgreSQL**: Uses snake_case column names (converted from Coheus aliases)
   - Example: `Application Date` → `application_date`

### Key Points

- **Source Fields**: All formulas reference source fields from the data dictionary
- **Field Names**: Coheus aliases match PostgreSQL column names (with case conversion)
- **Traceability**: Encompass Field IDs are documented for reference
- **See**: `patterns/source-fields.md` for complete integration guide

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
1. **Start with `concepts/`** - Understand base definitions (turn time, revenue, etc.)
2. **Review `patterns/`** - See how Qlik patterns translate to PostgreSQL
3. **Reference `migration/postgresql-mapping.md`** - Function mappings
4. **Use `migration/backend-architecture.md`** - Implementation decisions
5. **Check `core/transform-logic.md`** - Qlik implementations for context

### For Analysts
1. **Review `concepts/`** - Base logic definitions
2. **Check `derived/`** - How logic builds on base concepts
3. **Review `INDEX.md`** - Logic overview
4. **Check `apps/`** - App-specific logic
5. **Reference `validation/missing-logic.md`** - Gaps

### For Migration Team
1. **Review `patterns/`** - Qlik → PostgreSQL translation patterns
2. **Follow `migration/postgresql-mapping.md`** - Function mappings
3. **Use `migration/backend-architecture.md`** - Architecture (patterns → functions)
4. **Reference `concepts/`** - Base definitions for context
5. **Parse QSDA exports** - Per `apps/qvf-expressions.md`

---

## Key Principles

1. **Base First**: Base concepts are defined before derived logic
2. **Pattern Recognition**: Qlik-specific patterns are identified and translated
3. **PostgreSQL Translation**: Patterns translate to functions/views (not computed columns where unnecessary)
4. **No Full Data Model**: Focus on definitions, not relational connections
5. **Hierarchical Navigation**: Easy to navigate from base → derived → implementation

## Important Notes

- **Date Flags**: Use PostgreSQL functions, NOT computed columns. See `patterns/date-period-filtering.md`
- **YearMonth Fields**: Use DATE_TRUNC functions, NOT computed columns. See `patterns/date-groupings.md`
- **Patterns vs Concepts**: Patterns are Qlik-specific (date flags, Dual(), ApplyMap()). Concepts are universal (turn time, revenue)
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

**Completed**: 
- ✅ Base concept definitions (`concepts/`)
- ✅ Qlik pattern translations (`patterns/`)
- ✅ Derived logic documentation (`derived/`)
- ✅ Core Qlik logic (updated with references)
- ✅ App summaries
- ✅ Migration guides (updated with pattern approach)
- ✅ Validation framework

**Pending**: 
- ⏳ QSDA CSV parsing
- ⏳ Function definitions library
- ⏳ Mapping tables documentation
- ⏳ Complete QVF expression extraction
