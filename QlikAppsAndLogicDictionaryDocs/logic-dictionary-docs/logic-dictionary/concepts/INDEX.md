# Base Concepts Index

This directory contains base concept definitions - fundamental business logic that other logic builds upon.

## Concepts

### Turn Time
**File**: `concepts/turn-time.md`

**Definition**: Duration between two milestone dates in a loan lifecycle.

**Used By**:
- `derived/turn-time-ranges.md` - Turn time buckets and ranges
- `core/transform-logic.md` - Turn time calculations (App-Close, App-Fund, etc.)
- `apps/operations-app-logic.md` - Turn time reporting

### Revenue
**File**: `concepts/revenue.md`

**Definition**: Total financial gain from loan origination and sale.

**Used By**:
- `derived/revenue-calculations.md` - Revenue variations and formulas
- `core/transform-logic.md` - Revenue calculations
- `apps/contribution-to-profit-app-logic.md` - Profitability analysis

### Status Flags
**File**: `concepts/status-flags.md`

**Definition**: Boolean indicators categorizing loans by milestone completion or current state.

**Used By**:
- `core/transform-logic.md` - Status flag implementations
- All apps - Filtering and conditional logic

### Complexity
**File**: `concepts/complexity.md`

**Definition**: Numeric score quantifying loan difficulty/risk.

**Used By**:
- `core/transform-logic.md` - Complexity score calculations
- All apps - Risk assessment and analysis

### Channel Logic
**File**: `concepts/channel-logic.md`

**Definition**: Categorization and logic for loan origination channels (Retail, TPO).

**Used By**:
- `core/transform-logic.md` - Channel flags and multi-channel logic
- All apps - Channel-specific reporting

## Navigation

- **Base Concepts** (this directory) - Start here to understand fundamentals
- **Derived Logic** (`../derived/`) - Logic that builds on base concepts
- **Qlik Patterns** (`../patterns/`) - Qlik-specific patterns and translations
- **Core Qlik Logic** (`../core/`) - Qlik script implementations
