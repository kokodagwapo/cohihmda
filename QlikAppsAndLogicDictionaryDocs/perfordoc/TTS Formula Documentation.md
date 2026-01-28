# TTS (Top Tier Score) Formula Documentation

## Overview

TTS is a weighted composite score that measures Loan Officer (LO) performance relative to all other Loan Officers over a rolling X-month period. Each component rating compares an individual LO's performance to the company average.

---

## Component Ratings

All ratings are calculated as a percentage of the company average (100 = average performance).

| Rating | Formula |
|--------|---------|
| **Unit Rating** | `(LO Originated Units / All LO Avg Originated Units) × 100` |
| **Volume Rating** | `(LO Avg Loan Amount / All LO Avg Loan Amount) × 100` |
| **Margin Rating** | `(LO Avg Revenue / All LO Avg Revenue) × 100` |
| **Pull-Through Rating** | `(LO Avg Pull-Through Rate / All LO Avg Pull-Through Rate) × 100` |
| **Turn Time Rating** | `(1 / LO Avg Turn Time) / (1 / All LO Avg Turn Time) × 100` |
| **Concession Rating** | `(LO Avg Price Concession / All LO Avg Price Concession) × 100` |

### Notes

- **Margin (Revenue)** default calculation:
  ```
  Revenue = Base Buy + Orig Fee Borrower + Orig Fee Seller - CD Lender Credits
  ```

- **Turn Time** uses inverse logic (lower is better):
  - Turn Time = Application Date → Close Date
  - The inverse (`1 / Turn Time`) ensures faster closings yield higher ratings

---

## TTS Formula

```
TTS = (UnitRating × UnitWeight + 
       VolumeRating × VolumeWeight + 
       MarginRating × MarginWeight + 
       PullThroughRating × PullThroughWeight + 
       TurnTimeRating × TurnTimeWeight + 
       ConcessionRating × ConcessionWeight) / 100
```

---

## Default Weights

| Component | Weight | Percentage |
|-----------|--------|------------|
| Unit | 20.0 | 20% |
| Volume | 20.0 | 20% |
| Margin | 20.0 | 20% |
| Concessions | 20.0 | 20% |
| Pull-Through | 15.0 | 15% |
| Turn Time | 5.0 | 5% |
| **Total** | **100.0** | **100%** |

### XML Configuration

```xml
<Sales>
  <Weight Name="Unit" Value="20.0"/>
  <Weight Name="Volume" Value="20.0"/>
  <Weight Name="Margin" Value="20.0"/>
  <Weight Name="Concessions" Value="20.0"/>
  <Weight Name="PullThrough" Value="15.0"/>
  <Weight Name="TurnTime" Value="5.0"/>
</Sales>
```

---

## Example Calculation

| Component | LO Value | All LO Avg | Rating | Weight | Weighted |
|-----------|----------|------------|--------|--------|----------|
| Units | 15 loans | 10 loans | 150 | 20 | 3000 |
| Volume | $350K | $300K | 116.7 | 20 | 2334 |
| Margin | $8,500 | $7,000 | 121.4 | 20 | 2428 |
| Concessions | $500 | $600 | 83.3 | 20 | 1666 |
| Pull-Through | 78% | 72% | 108.3 | 15 | 1625 |
| Turn Time | 25 days | 30 days | 120.0 | 5 | 600 |
| | | | | **Total** | **11,653** |

**TTS = 11,653 / 100 = 116.5**

This LO performs 16.5% above average overall.

---

## Interpretation

| TTS Score | Performance Level |
|-----------|-------------------|
| > 120 | Top Tier |
| 100 - 120 | Above Average |
| 80 - 100 | Below Average |
| < 80 | Bottom Tier |

*Tier thresholds may be configured per client.*
