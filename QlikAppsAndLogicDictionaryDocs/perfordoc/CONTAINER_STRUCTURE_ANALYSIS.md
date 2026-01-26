# TopTiering Sheet Container Structure Analysis

## Overview

The TopTiering sheet uses **3 containers** with **multiple charts** that are shown/hidden based on the `vTopTieringShow` variable. This allows the same container to display different charts depending on which actor type is selected.

## Why Multiple Charts Per Container?

**The containers use show conditions to display different charts based on actor selection:**

- **Organization Level** (Branch or Account Executive) → Shows charts using `vScorecard`
- **Individual Level** (Loan Officer or Broker Lender Name) → Shows charts using `vScorecardActor`
- **Loan Officer Specific** → Shows charts using hardcoded `[Loan Officer]` field

Instead of changing chart expressions dynamically, the app uses **separate chart objects** with **show conditions** that control visibility. This is a common Qlik Sense pattern for conditional chart display.

---

## Container Breakdown

### 1. Top Container (`knCqQ`) - "TopTiering: Chart Container 1"
**Total Charts: 3**

Each chart has a show condition based on `vTopTieringShow`:

| Chart ID | Chart Type | Actor Type | Show Condition | Description |
|----------|-----------|------------|----------------|-------------|
| `6811c629-5194-40d4-bd25-1faab1aad158` | Combo Chart | Organization (`vScorecard`) | `=if(vTopTieringShow=1,1,0)` | Revenue % and Total Revenue $ |
| `94c675f3-e0ee-4ec8-97d0-aa74c83bb905` | Combo Chart | Individual (`vScorecardActor`) | `=if(vTopTieringShow=0,1,0)` | Revenue % and Total Revenue $ |
| `39839bee-468f-4752-b69c-6c39d7cb8fae` | Text Object | Insights | `=if(vTopTieringShow=2,1,0)` | TopTiering Insights/Story (Loan Officer specific) |

**Note:** The third object is actually a text/insights object, not a chart. The container shows **2 charts** (one for organization, one for individual) plus 1 insights object.

---

### 2. Middle Container (`apDPDzJ`) - "TopTiering: Middle Chart Container"
**Total Charts: 9**

This container has **3 sets of charts** - one set for each actor type:

#### Set 1: Organization Level (`vTopTieringShow=1`)
| Chart ID | Chart Type | Show Condition | Description |
|----------|-----------|----------------|-------------|
| `c51c1cd5-9f63-471d-8b73-9f3d5b447dc0` | Combo Chart | `=if(vTopTieringShow=1,1,0)` | Revenue BPS by `[$(vScorecard)]` |
| `9a2059b9-c8a3-44bb-aa1e-c779a9581478` | Combo Chart | `=if(vTopTieringShow=1,1,0)` | Revenue per Loan ($) by `[$(vScorecard)]` |
| *(Third chart with same condition)* | | `=if(vTopTieringShow=1,1,0)` | *(Additional organization-level chart)* |

#### Set 2: Individual Level (`vTopTieringShow=0`)
| Chart ID | Chart Type | Show Condition | Description |
|----------|-----------|----------------|-------------|
| `e12cb5d6-42b8-44fc-b707-4045a5f72e8b` | Combo Chart | `=if(vTopTieringShow=0,1,0)` | Revenue BPS by `[$(vScorecardActor)]` |
| `54707ad5-ea6c-445e-b660-cc443f397a0f` | Combo Chart | `=if(vTopTieringShow=0,1,0)` | Revenue per Loan ($) by `[$(vScorecardActor)]` |
| *(Third chart with same condition)* | | `=if(vTopTieringShow=0,1,0)` | *(Additional individual-level chart)* |

#### Set 3: Loan Officer Specific (`vTopTieringShow=2`)
| Chart ID | Chart Type | Show Condition | Description |
|----------|-----------|----------------|-------------|
| `86cabe02-a679-40cb-9e00-2a73e429cbdb` | Combo Chart | `=if(vTopTieringShow=2,1,0)` | Revenue BPS by `[Loan Officer]` |
| `ce861e6b-6bc3-43ba-971c-98bf46112e3a` | Combo Chart | `=if(vTopTieringShow=2,1,0)` | Revenue per Loan ($) by `[Loan Officer]` |
| *(Third chart with same condition)* | | `=if(vTopTieringShow=2,1,0)` | *(Additional Loan Officer chart)* |

**Total: 3 charts × 3 actor types = 9 charts**

---

### 3. Bottom Container (`nJwpaw`) - "TopTiering: Bottom Chart Container"
**Total Charts: 6**

This container has **2 sets of charts**:

#### Set 1: Organization Level (`vTopTieringShow=1`)
| Chart ID | Chart Type | Show Condition | Description |
|----------|-----------|----------------|-------------|
| *(Chart 1)* | | `=if(vTopTieringShow=1,1,0)` | Organization-level chart |
| *(Chart 2)* | | `=if(vTopTieringShow=1,1,0)` | Organization-level chart |

#### Set 2: Individual Level (`vTopTieringShow=0`)
| Chart ID | Chart Type | Show Condition | Description |
|----------|-----------|----------------|-------------|
| *(Chart 1)* | | `=if(vTopTieringShow=0,1,0)` | Individual-level chart |
| *(Chart 2)* | | `=if(vTopTieringShow=0,1,0)` | Individual-level chart |

#### Set 3: Loan Officer Specific (`vTopTieringShow=2`)
| Chart ID | Chart Type | Show Condition | Description |
|----------|-----------|----------------|-------------|
| *(Chart 1)* | | `=if(vTopTieringShow=2,1,0)` | Loan Officer chart |
| *(Chart 2)* | | `=if(vTopTieringShow=2,1,0)` | Loan Officer chart |

**Total: 2 charts × 3 actor types = 6 charts**

---

## Show Condition Pattern

Each container uses show conditions on **child objects** (charts) to control visibility:

```qlik
// Organization Level (Branch or Account Executive)
=if(vTopTieringShow=1,1,0)

// Individual Level (Loan Officer or Broker Lender Name)
=if(vTopTieringShow=0,1,0)

// Loan Officer Specific
=if(vTopTieringShow=2,1,0)
```

**Note:** The Expressions.csv shows these as `children.condition.qStringExpression.qExpr`, meaning they're show conditions applied to child objects within the container.

---

## Why This Architecture?

1. **Performance**: Pre-rendered charts are faster than dynamically changing expressions
2. **Simplicity**: Each chart has fixed expressions - no complex conditional logic in chart definitions
3. **Maintainability**: Easy to see which chart displays for which actor type
4. **Qlik Best Practice**: Using show conditions is a standard pattern for conditional visualization

---

## Required Updates for New Actor System

With the new actor dropdown using values `1, 2, 3, 4`:
- **Branch = 1** (Organization)
- **Loan Officer = 2** (Individual)
- **Account Executive = 3** (Organization)
- **Broker Lender Name = 4** (Individual)

### Updated Show Conditions Needed:

**For Organization Level Charts** (Branch OR Account Executive):
```qlik
// OLD: =if(vTopTieringShow=1,1,0)
// NEW: =if(Match(vTopTieringShow,1,3),1,0)
```

**For Individual Level Charts** (Loan Officer OR Broker Lender Name):
```qlik
// OLD: =if(vTopTieringShow=0,1,0)
// NEW: =if(Match(vTopTieringShow,2,4),1,0)
```

**For Loan Officer Specific Charts** (unchanged):
```qlik
=if(vTopTieringShow=2,1,0)  // Still correct
```

---

## Summary

- **Top Container (`knCqQ`)**: 3 objects (2 charts + 1 insights)
- **Middle Container (`apDPDzJ`)**: 9 charts (3 actor types × 3 metrics)
- **Bottom Container (`nJwpaw`)**: 6 charts (3 actor types × 2 metrics)

**Total: 18 chart objects** across 3 containers, controlled by show conditions based on `vTopTieringShow` value.
