# Cohi Analytics Reference — Metric Definitions, Interpretation & Benchmarks

> This document provides plain-English definitions of every key mortgage metric, business interpretation context, industry benchmarks, and analytical best practices. It is the primary knowledge source for understanding what metrics mean, how they relate to each other, and how to interpret results.

---

## 1. Metric Definitions — Plain English

### Pipeline & Conversion Metrics

**Pull-Through Rate** — The percentage of loans that reach a terminal status (completed processing) and ultimately fund. It answers: "Of all the loans that finished going through our pipeline, how many did we actually close?" The denominator is *completed* loans only — loans still in active processing are excluded. This means pull-through can look artificially low if measured on a recent application cohort where many loans haven't reached a terminal status yet (typical mortgage cycles are 30-45 days).

**Fallout Rate** — The complement of pull-through: the percentage of completed loans that did NOT fund. Fallout = 100% minus pull-through. A 70% pull-through means 30% fallout. Fallout includes all reasons a loan fails to close: borrower withdrawal, denial, cancellation, incomplete files, and any other non-funded terminal status.

**Conversion Rate** — The percentage of loans that *entered the pipeline* (received a started date) and ultimately funded. This is a broader measure than pull-through because the denominator includes ALL loans that started, not just those that reached a terminal status. A lender can have strong pull-through (most completed loans fund) but weak conversion (many loans stall early and never complete), which points to a top-of-funnel quality problem rather than a closing problem.

**Denial Rate** — The percentage of loans that received a denial or decline decision. Unlike pull-through, there is no single standard denominator — it depends on context. When analyzing across the full pipeline, the denominator is total applications. When analyzing within completed loans, the denominator is completed count. Always specify which denominator is being used.

**Active Pipeline** — A point-in-time snapshot of loans currently in process (not yet funded, not yet fallen out). Active loan counts are NOT date-filtered — they represent the current state of the pipeline regardless of when the loan entered. This is fundamentally different from pull-through or volume metrics, which are always scoped to a time window.

### Volume & Revenue Metrics

**Funded Volume** — The total dollar amount of loans that funded within the analysis period, measured by the *funding date* (not the application date). This is the primary top-line production metric.

**Funded Units / Funded Count** — The number of individual loans that funded within the period. Unlike funded volume, this is not affected by loan size — a $100K loan and a $1M loan each count as one unit.

**Total Revenue** — The income generated from funded loans, calculated as the sum of buy-side base pricing, origination fees, processing fees, underwriting fees, other fees, and discount fees minus lender credits. Revenue formulas can be customized per tenant. Revenue is measured on a *funding date* cohort.

**Revenue BPS (Basis Points)** — Revenue expressed relative to funded volume: `(total_revenue / funded_volume) * 10,000`. This normalizes revenue for loan size, making it comparable across time periods with different volume mixes. One basis point on a $100M production month = $10,000.

**Revenue Per Loan** — Total revenue divided by the count of funded loans. Unlike BPS, this is affected by average loan size — a higher average loan amount will naturally produce higher revenue per loan even at the same BPS margin.

**Originated Volume** — Similar to funded volume but uses the loan status filter (status contains "Originated" or "purchased") rather than requiring a funding date. In practice, these are nearly identical, but originated volume can capture loans where the status was updated but the funding_date field wasn't populated.

### Cycle Time Metrics

**Average Cycle Time (Application to Funding)** — The number of calendar days between the application date and the funding date for funded loans. This measures total pipeline velocity end-to-end. Measured on a *funding date* cohort (the loan appears in the period it funded, regardless of when the application was submitted).

**Processor Turn Time** — The number of days between the processing start date and the date the loan was submitted to underwriting. This measures the operational efficiency of the loan processing team.

**Underwriter Turn Time** — Days from submission to underwriting through to the closing date. This measures underwriting throughput.

**Closer Turn Time** — Days from closing date to funding date. This measures post-closing and funding efficiency.

**Warehouse Days** — The number of days a funded loan sits on the warehouse line before being purchased by an investor, weighted by loan amount. Calculated as investor purchase date minus funding date (or current date minus funding date if not yet purchased). This is a cost metric — longer warehouse times increase carrying costs.

### Credit Quality & Mix Metrics

**Weighted Average FICO (WA FICO)** — The volume-weighted average credit score across originated loans. Weighting by loan amount gives larger loans more influence on the average, reflecting the portfolio's credit risk exposure. Only scores between 350 and 900 are included (values outside this range are treated as data errors).

**Weighted Average LTV (WA LTV)** — Volume-weighted average loan-to-value ratio for originated loans. Higher LTV means more leverage and more risk. Values must be between 0% and 110%.

**Weighted Average DTI (WA DTI)** — Volume-weighted average debt-to-income ratio. Higher DTI means the borrower has less income cushion. Values must be between 0% and 70%.

**WAC (Weighted Average Coupon)** — Volume-weighted average interest rate on originated loans. This reflects the rate environment and pricing strategy. Values must be between 0% and 15%.

### Personnel Performance Metrics

**Top Tiering Score (TTS alias) — Sales** — A composite score evaluating loan officer performance across six components (volume, margin, units, pull-through, turn time, concession). These weights are tenant-configurable in **Admin > Scoring & Weights** (the 20% each mix is only the default baseline). The score creates three tiers: Elite (≥120), Strong (≥80), and Developing (<80).

**Top Tiering Score (TTS alias) — Operations** — A composite for operations staff using units, turn time, and loan complexity components. Weights are tenant-configurable in **Admin > Scoring & Weights** (70/15/15 is the default baseline). Same tier thresholds: ≥120 Elite, ≥80 Strong, <80 Developing.

**Loan Complexity Score** — A points-based measure of how difficult a loan is to process, starting at 100 and adding points for each complicating factor: government loan type (+10), purchase transaction (+5), FICO below 680 (+10), LTV above 80% (+5), DTI above 43% (+5), non-primary occupancy (+5), self-employed borrower (+5). Higher scores indicate more complex loans.

### Compliance Metrics

**HMDA Volume / HMDA Units** — Home Mortgage Disclosure Act reporting counts and volumes. These exclude loans in active status — only loans that have reached a terminal status are included in HMDA reporting figures.

**Lost Opportunity** — Loans that withdrew, were cancelled, were not accepted, or remained incomplete. This measures potential revenue that left the pipeline. Lost opportunity revenue estimates what the lender would have earned if those loans had funded, using the portfolio's average revenue margin as a proxy.

**Withdrawn Proforma Revenue** — An estimate of the revenue that would have been earned on withdrawn/not-accepted loans. Uses actual revenue data if available, otherwise estimates as loan amount multiplied by the average funded revenue margin for similar loans. The average margin is calculated dynamically from the funded portfolio, with a fallback of 2% (200 BPS) if insufficient data.

### How Metrics Relate to Each Other

These metrics form an interconnected system:

- **Pull-through** and **fallout** are complements (they sum to 100% of completed loans). Improving one mechanically improves the other.
- **Conversion** is broader than pull-through — it includes the "active but stalled" loans that pull-through excludes from its denominator.
- **Funded volume** = **funded units** × **average loan amount**. A volume increase can come from more loans OR larger loans — always check both.
- **Total revenue** = **funded volume** × **Revenue BPS** / 10,000. Revenue can change because volume changed, margins changed, or both.
- **Cycle time** and **pull-through** are loosely correlated — longer cycle times often predict higher fallout because borrowers get frustrated or find alternatives. But the relationship isn't deterministic.
- **Lock expiration risk** is an early warning for both **fallout** (loans may withdraw if re-locking is uneconomical) and **revenue loss** (extension costs reduce margin).

---

## 2. Industry Benchmarks

These are representative industry ranges drawn from MBA (Mortgage Bankers Association) quarterly performance reports and STRATMOR Group benchmarks. Use these to contextualize tenant-specific results.

### Pull-Through & Conversion

| Metric | Below Average | Average | Above Average | Elite |
|--------|--------------|---------|---------------|-------|
| Pull-Through Rate | < 55% | 65-75% | 75-85% | > 85% |
| Conversion Rate (started → funded) | < 40% | 50-60% | 60-70% | > 70% |
| Denial Rate | > 20% | 10-18% | 5-10% | < 5% |

Pull-through and conversion rate measure different things. Pull-through uses completed loans as the denominator (terminal statuses only). Conversion uses all loans that entered the pipeline. A lender can have strong pull-through but weak conversion if many loans stall in early stages without reaching a terminal status.

### Cycle Time

| Metric | Fast | Typical | Slow | Concern |
|--------|------|---------|------|---------|
| Application to Funding | < 25 days | 30-45 days | 45-60 days | > 60 days |
| Application to Closing | < 22 days | 28-40 days | 40-55 days | > 55 days |
| Processor Turn Time | < 3 days | 3-7 days | 7-14 days | > 14 days |
| Underwriter Turn Time | < 2 days | 2-5 days | 5-10 days | > 10 days |
| Closer Turn Time | < 1 day | 1-3 days | 3-5 days | > 5 days |

Cycle times are right-skewed in mortgage data. The mean is almost always higher than the median due to a long tail of delayed loans. When summarizing cycle time for a group, the median is the more representative measure. Report both, and include P90 to characterize the tail.

### Revenue & Economics

| Metric | Low | Typical | Strong |
|--------|-----|---------|--------|
| Revenue BPS (basis points) | < 150 | 200-350 | > 350 |
| Revenue Per Loan | < $3,000 | $4,000-$7,000 | > $8,000 |
| Cost Per Loan (industry ref) | — | $8,000-$12,000 | — |

Revenue metrics are highly sensitive to rate environment, product mix, and channel. Compare period-over-period rather than against static benchmarks.

---

## 3. Product Type Behavioral Differences

### Government vs. Conventional Loans

Government loans (FHA, VA, USDA) differ systematically from Conventional loans:

- **Cycle time:** Government loans typically take 5-10 additional days from application to funding compared to Conventional. VA loans are often the longest due to VA appraisal timelines. This is normal and should not be flagged as a processing failure.
- **Pull-through:** Government-eligible borrowers tend to close at slightly higher rates (2-5pp above Conventional), likely because their financing options are more limited.
- **Loan amounts:** Government loans have lower average balances due to FHA/VA loan limits. This affects volume-weighted metrics.
- **Complexity:** Government loans score higher on complexity (the loan_type alone adds +10 to the complexity score) and have additional compliance documentation requirements.
- **Denial patterns:** FHA loans may show higher denial rates than Conventional due to stricter property condition requirements (FHA appraisal standards).

### Purchase vs. Refinance

- **Cycle time:** Purchase transactions are typically 5-7 days faster than refinances due to contract closing deadlines providing natural urgency.
- **Seasonality:** Purchase volume is highly seasonal (peaks March-August). Refinance volume is rate-sensitive, not seasonal. Trend analysis should account for this.
- **Fallout:** Refinance fallout is more rate-sensitive — a rate spike during processing can eliminate the refinance benefit, causing the borrower to withdraw.

---

## 4. Channel Interpretation

### Retail vs. TPO Performance

When comparing Retail and TPO (Wholesale/Correspondent) channels:

- **Pull-through** is typically 5-10pp higher in Retail because the lender controls the borrower relationship end-to-end. TPO borrowers may have multiple lender options simultaneously.
- **Cycle time** may appear shorter in TPO because the originator has already completed initial processing before submitting to the lender.
- **Revenue BPS** is typically lower in TPO due to competitive pricing and broker compensation structures. This is structural, not a performance issue.
- **Volume per LO** is not directly comparable between channels — TPO account executives manage broker relationships, not individual loans.

### Missing Channel Data

If a significant portion of loans (> 10%) has missing or "99" channel codes, volume and conversion comparisons across channels will be unreliable. Flag this as a data quality issue rather than attempting to analyze by channel.

---

## 5. Statistical Interpretation Guidelines

### When to Use Median vs. Mean

| Data Type | Preferred Measure | Why |
|-----------|------------------|-----|
| Cycle time | Median (P50) | Right-skewed; a few 90+ day loans distort the mean |
| Loan amount | Median | Skewed by jumbo loans at the high end |
| Revenue per loan | Median | Outlier deals can dominate the average |
| Pull-through rate | Mean (weighted) | Already a proportion; not skewed the same way |
| FICO / LTV / DTI | Mean (weighted by volume) | Approximately normal after weighting |
| Count metrics | Sum / total | Not applicable |

### Small Sample Interpretation Rules

- **< 10 loans in a segment:** Do not report a rate or percentage. State "insufficient data (n=X)" instead. A 100% pull-through rate on 3 loans is meaningless.
- **10-29 loans:** Report the rate but always include "(n=X)" and caveat that the rate is volatile. A single loan changing status can swing the rate by 3-10 percentage points.
- **30+ loans:** Rates are reasonably stable for reporting. Still include sample size for transparency.
- **Application cohorts < 60 days old:** Many loans are still in-flight (the typical mortgage cycle is 30-45 days). Pull-through and fallout rates for recent cohorts will appear artificially low because the denominator includes loans that haven't reached a terminal status yet. Always caveat this.

### Trend Analysis

- **Minimum data points:** Require at least 4 periods (months, weeks) to identify a trend. Two data points are a comparison, not a trend.
- **Seasonality:** Monthly volume follows strong seasonal patterns (spring/summer peak). Compare year-over-year or use trailing 12-month rolling averages to remove seasonality.
- **Magnitude conventions:** Always state both direction and size — "up 8% MoM" or "down 2.3 days from prior quarter." Avoid vague language like "slightly increased."

### Correlation and Causation

When the agent identifies correlations (e.g., higher FICO correlating with higher pull-through), remind users that:
- Correlation does not imply causation.
- Mortgage data often has confounding variables (e.g., higher FICO borrowers also tend to have lower LTV, making it unclear which factor drives the outcome).
- Multivariate analysis is needed to isolate individual factor effects.

---

## 6. Risk Interpretation

### Lock Expiration Context

Lock expiration is one of the highest-cost risk events in mortgage operations:
- The cost of a lock extension is typically 0.125-0.375% of the loan amount per extension period (usually 7-15 days).
- On a $400K loan, a single extension costs $500-$1,500.
- Multiple extensions suggest a systemic processing bottleneck, not just individual loan complexity.
- If more than 5% of the pipeline has locks expiring within 7 days without clear-to-close, it warrants operational intervention.

### Fallout Pattern Analysis

When fallout rates spike:
- **Product-specific spike** (e.g., FHA fallout jumps but Conventional is flat) — likely a program-level issue (guideline change, appraisal problems).
- **Broad-based spike** — likely a rate environment event (rates rising, reducing refinance viability) or operational issue.
- **LO-specific spike** — likely an individual pipeline management problem.
- **Geographic cluster** — may indicate local market conditions (property value declines, employer layoffs).

### TRID Compliance Timing

- Application to initial Loan Estimate disclosure: must be within **3 business days**. If the average exceeds this, it is a compliance violation, not just a process inefficiency.
- Closing Disclosure must be received by borrower at least **3 business days** before closing.
- Active loans without lock for **60+ days** may indicate stalled files that need compliance review.

---

## 7. Data Quality Red Flags

When analyzing data, watch for these indicators that the underlying data may be unreliable:

| Red Flag | Impact | Recommendation |
|----------|--------|---------------|
| > 30% of loans missing `denial_date` | Denial timing analysis unreliable | Use `COALESCE(denial_date, current_status_date)` as fallback; caveat results |
| > 10% missing channel codes | Channel segmentation unreliable | Report combined totals; flag data quality |
| Funding dates before application dates | Data entry errors | Exclude these rows from cycle time analysis |
| FICO values outside 350-900 | Invalid credit data | Exclude from weighted average calculations |
| LTV > 110% or DTI > 70% | Likely data entry errors | Exclude from distribution analysis |
| Lock dates after funding dates | Sequence errors | Exclude from lock-related metrics |
| Loan amounts of $0 or > $10M | Likely test data or errors | Exclude from volume and weighted calculations |

---

## 8. Presentation Best Practices

### Executive Audience

- Lead with the business implication: "14 loans totaling $5.2M are at risk of lock expiration this week" — not "the query returned 14 rows."
- Use KPI cards and simple bar charts. Avoid complex multi-series charts unless the audience specifically requests analytical depth.
- Compare to a prior period by default: "pull-through is 72%, up 3pp from last month."
- Round appropriately: currency to nearest $1K or $1M, percentages to one decimal, counts to whole numbers.

### Analytical Audience

- Show the distribution, not just the average. Box plots or histograms reveal what a single number hides.
- Include sample sizes in every chart title or subtitle.
- Use scatter plots for relationship analysis and include a regression line with R-squared if the correlation is meaningful (> 0.3).
- Flag outliers explicitly rather than letting them silently distort aggregates.
