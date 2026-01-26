# Loan Complexity Score Documentation

## Overview

The Loan Complexity Score is an additive composite score that measures the relative complexity of a mortgage loan based on various risk and documentation factors. Higher scores indicate loans that typically require more time, effort, and expertise to originate.

---

## Component Scores

Each component contributes a fixed weight to the total score based on specific conditions. Missing or invalid data returns `Null()` which is treated as 0 in the final calculation.

### Loan Purpose Complexity

| Condition | Weight | Rationale |
|-----------|--------|-----------|
| C to P (Construction-to-Permanent) | +0.30 | Two-phase loan, construction monitoring, draw schedules |
| Purchase | +0.10 | Standard purchase transaction |
| Refi CO (Cash-Out Refinance) | +0.10 | Additional equity verification |
| Refi No CO (Rate/Term Refinance) | 0 | Simplest refinance type |
| Missing / No Data | Null() | No contribution |
| Other values | 0 | Default baseline |

### Loan Type Complexity

| Condition | Weight | Rationale |
|-----------|--------|-----------|
| FHA | +0.10 | Government program requirements, MI, condition requirements |
| VA | +0.05 | Government program, COE requirements |
| Conventional / Other | 0 | Standard underwriting |
| Missing / No Data | Null() | No contribution |

### Loan Amount Complexity

| Condition | Weight | Rationale |
|-----------|--------|-----------|
| ≥ $1,000,000 | +0.10 | Jumbo loans, additional documentation and reserves |
| < $1,000,000 | 0 | Standard conforming amounts |
| Missing / No Data | Null() | No contribution |

### Occupancy Complexity

| Condition | Weight | Rationale |
|-----------|--------|-----------|
| SecondHome | +0.10 | Additional scrutiny on occupancy intent |
| Investor | +0.10 | Non-owner occupied, rental income analysis |
| Primary Residence / Other | 0 | Standard owner-occupied |
| Missing / No Data | Null() | No contribution |

### FICO Complexity

| Condition | Weight | Rationale |
|-----------|--------|-----------|
| > 760 | **-0.10** | Excellent credit reduces complexity (credit toward score) |
| 681 < FICO ≤ 760 | 0 | Good credit, standard processing |
| 620 < FICO ≤ 681 | +0.05 | Fair credit, may require compensating factors |
| ≤ 620 | +0.15 | Subprime, extensive documentation and layered risk |
| Missing / Null | Null() | No contribution |

### LTV Complexity

| Condition | Weight | Rationale |
|-----------|--------|-----------|
| ≥ 95% | +0.05 | High LTV, MI requirements, tighter guidelines |
| < 95% | 0 | Standard equity position |
| Missing / Null | Null() | No contribution |

### DTI Complexity

| Condition | Weight | Rationale |
|-----------|--------|-----------|
| ≥ 43% | +0.05 | High debt ratio, may require compensating factors |
| < 43% | 0 | Within standard QM guidelines |
| Missing / Null | Null() | No contribution |

> ⚠️ **Known Bug**: Line 127 in Transform.qvs incorrectly checks `[LTV Ratio] < 43` instead of `[BE DTI Ratio] < 43`

### Employment Complexity

| Condition | Weight | Rationale |
|-----------|--------|-----------|
| Self-Employed = 'Y' | +0.20 | Tax returns, P&L, business documentation |
| Otherwise | 0 | Standard W-2 employment |

---

## Total Score Calculation

```qvs
[Loan Complexity Score] = RangeSum(
    [Loan Purpose Complexity],
    [Loan Type Complexity],
    [Loan Amount Complexity],
    [Occupancy Complexity],
    [FICO Complexity],
    [LTV Complexity],
    [DTI Complexity],
    [Employment Complexity]
)
```

### Score Range

| Minimum | Maximum |
|---------|---------|
| -0.10 | +1.05 |

- **Minimum (-0.10)**: Only excellent FICO (>760), all other factors at baseline
- **Maximum (+1.05)**: All risk factors at maximum values

### Why RangeSum()?

`RangeSum()` treats `Null()` values as 0 without invalidating the entire result. This ensures loans with missing data still receive a valid complexity score based on available information.

---

## Operations App Grouping

The Operations app transforms the raw score into user-friendly bands for reporting.

### Transformation Formula

```qvs
ComplexityIndex = (1 + [Loan Complexity Score]) × 100
```

This shifts the baseline to 100:
- Score of **0.00** → Index of **100**
- Score of **+0.30** → Index of **130**
- Score of **-0.10** → Index of **90**

### Complexity Groups

| Group | Index Range | Raw Score Range | Description |
|-------|-------------|-----------------|-------------|
| `1-GT 131` | ≥ 131 | > 0.31 | Very High Complexity |
| `2-121 to 130` | 121 - 130 | 0.21 - 0.30 | High Complexity |
| `3-111 to 120` | 111 - 120 | 0.11 - 0.20 | Moderate-High Complexity |
| `4-101 to 110` | 101 - 110 | 0.01 - 0.10 | Slightly Above Baseline |
| `5-91 to 100` | 91 - 100 | -0.09 - 0.00 | Baseline / Simple |
| `6-81 to 90` | 81 - 90 | -0.19 - -0.10 | Very Simple |
| `7-LE 80` | < 81 | < -0.19 | *Unreachable with current weights* |
| `8-zero` | 0 - 80 | N/A | *Unreachable with current weights* |

*Numeric prefixes enable proper sorting in Qlik charts (most complex first).*

---

## Example Calculations

### Example 1: Simple Conventional Loan

| Component | Value | Weight |
|-----------|-------|--------|
| Loan Purpose | Refi No CO | 0 |
| Loan Type | Conventional | 0 |
| Loan Amount | $350,000 | 0 |
| Occupancy | Primary | 0 |
| FICO | 780 | -0.10 |
| LTV | 80% | 0 |
| DTI | 35% | 0 |
| Employment | W-2 | 0 |
| **Total** | | **-0.10** |

**Complexity Index**: (1 + (-0.10)) × 100 = **90** → `6-81 to 90`

### Example 2: Complex FHA Purchase

| Component | Value | Weight |
|-----------|-------|--------|
| Loan Purpose | Purchase | +0.10 |
| Loan Type | FHA | +0.10 |
| Loan Amount | $275,000 | 0 |
| Occupancy | Primary | 0 |
| FICO | 640 | +0.05 |
| LTV | 96.5% | +0.05 |
| DTI | 45% | +0.05 |
| Employment | Self-Employed | +0.20 |
| **Total** | | **+0.55** |

**Complexity Index**: (1 + 0.55) × 100 = **155** → `1-GT 131`

### Example 3: Construction-to-Perm with Multiple Factors

| Component | Value | Weight |
|-----------|-------|--------|
| Loan Purpose | C to P | +0.30 |
| Loan Type | Conventional | 0 |
| Loan Amount | $1,200,000 | +0.10 |
| Occupancy | Primary | 0 |
| FICO | 720 | 0 |
| LTV | 80% | 0 |
| DTI | 38% | 0 |
| Employment | Self-Employed | +0.20 |
| **Total** | | **+0.60** |

**Complexity Index**: (1 + 0.60) × 100 = **160** → `1-GT 131`

---

## Source Files

| File | Location | Purpose |
|------|----------|---------|
| Transform.qvs | `tvd-coheus-incremental-builder-qlik/` | Component calculations (lines 93-130) |
| Script Additions Ranges.qvs | `tvd-coheus-operations-qlik/Scripts/` | Complexity grouping (lines 192-198) |

---

## Interpretation & Use Cases

The Loan Complexity Score can be used to:

1. **Capacity Planning**: Allocate more complex loans to experienced staff
2. **Turn Time Analysis**: Correlate complexity with processing time
3. **Workload Balancing**: Distribute work based on complexity-weighted volume
4. **Performance Benchmarking**: Compare turn times within complexity bands
5. **Training Identification**: Identify staff who excel at complex loans

---

*Added: 07.23.22 | Last Updated: December 2024*
