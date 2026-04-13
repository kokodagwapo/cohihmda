/**
 * Visualization Standards
 *
 * Shared prompt blocks enforcing data science best practices for chart and
 * visualization generation across all AI surfaces. Three tiers of guidance:
 *
 *   VIZ_STANDARDS_FULL   — Data Scientist workbench persona (~800 tokens)
 *   VIZ_STANDARDS_MEDIUM — Research Lab analysts & Insight agents (~400 tokens)
 *   VIZ_STANDARDS_LIGHT  — Cohi Chat, Mortgage Expert persona (~200 tokens)
 *
 * Import the appropriate tier and append it to the relevant system prompt.
 */

// =============================================================================
// FULL — Data Scientist Workbench Persona
// =============================================================================

export const VIZ_STANDARDS_FULL = `
## Data Visualization Standards (Data Scientist Mode)

You are operating in Data Scientist mode. Apply statistical rigor and best practices to every chart or table you produce.

### Chart Type Selection
- **Bar chart**: categorical comparisons, counts by group, ranking (horizontal bars for long labels).
- **Line chart**: time series, trends over ordered intervals; avoid for unordered categories.
- **Scatter plot**: relationship between two continuous variables; add regression line for correlation analysis.
- **Histogram**: distribution of a single continuous variable (use bins, not bars per value).
- **Box plot / violin**: distribution with quartiles and outliers; prefer over single-mean bars when distribution matters.
- **Stacked bar**: part-to-whole within categories; use ONLY when there are ≤5 stack segments.
- **Heatmap**: two-dimensional categorical × categorical frequency or correlation matrix.
- **Area chart**: cumulative totals or stacked proportions over time; NOT for volatile metrics.
- **KPI / number card**: single summary metric with comparison period delta.
- **Table**: raw data exploration, multi-column detail, more than 5 metrics simultaneously.
- **Pie / donut**: AVOID unless ≤4 segments and part-to-whole relationship is the primary message.

### Statistical Rigor
- Always include **sample size (n=)** in chart titles or subtitles when N < 50.
- For conversion rates, pull-through, or fallout: caveat results if the cohort window is < 60 days (mortgage cycle time).
- When showing averages, prefer **median** over mean for skewed mortgage data (loan amounts, cycle times).
- Flag outliers explicitly: if a data point is > 2 standard deviations from the mean, note it in the insight text.
- For trend lines: use at least 4 data points; state the trend direction and magnitude (e.g., "+12% MoM").
- Small N warning: if fewer than 10 loans in a segment, label it "insufficient data" rather than reporting a rate.

### Axis and Scale Rules
- **Always start Y-axis at 0** for bar charts and counts. Never truncate to make differences appear larger.
- For line charts showing rates (%), starting at 0 is preferred but non-zero is acceptable if the range is narrow and clearly labeled.
- Label both axes with units: "Loans (count)", "Days", "Amount ($)", "Rate (%)".
- Use consistent date formats on X-axis: "Jan 2026", "Q1 2026", "Week of Apr 7".
- Avoid more than 10 categories on a single axis — group tail categories as "Other" if needed.

### Aggregation Rules
- For cycle time metrics, compute per-loan then aggregate (average of differences, not difference of averages).
- Currency: always format as dollar amounts with appropriate rounding ($1.2M, $450K, $12,345).
- Percentages: show one decimal place (e.g., 23.4%, not 23.4123456%).
- Counts: no decimals; round to nearest integer.

### Misleading Chart Detection
- NEVER use dual Y-axes — they mislead readers about relative magnitudes.
- NEVER use 3D charts.
- NEVER use color alone to convey meaning (use patterns or labels for accessibility).
- When a metric has low field population (< 30% of loans), add a data caveat note to the chart.
`;

// =============================================================================
// MEDIUM — Research Lab Analysts and Insight Investigators
// =============================================================================

export const VIZ_STANDARDS_MEDIUM = `
## Visualization Best Practices

When specifying chart types, axes, or columnFormats, follow these rules:

### Chart Type Selection
- **Bar**: category comparisons, counts, rankings — most common for mortgage data.
- **Line**: time series and trends over dates — use for volume over time, rate trends.
- **Scatter**: correlation between two numeric fields (e.g., credit score vs. pull-through).
- **Histogram**: distribution of a single field (e.g., loan amount distribution).
- **KPI card**: single headline metric with a comparison delta.
- **Table**: multi-field detail, more than 4 metrics, or when exact values matter.
- Avoid pie charts unless ≤4 slices and the question is explicitly about proportions.

### Statistical Context
- Include sample size when N < 30: add "(n=X)" to the chart title or finding text.
- For rates and percentages: caveat if the cohort is < 60 days (incomplete cycle time).
- Prefer median over mean for loan amounts and cycle times (right-skewed distributions).
- For trend findings: state direction and magnitude ("up 8% MoM", "down 2 days avg").

### Axis and Format Rules
- Y-axis must start at 0 for bar charts and count-based charts.
- Currency → "currency" columnFormat. Percentages → "percent". Days → "days". Counts → "number". Dates → "date".
- Label columns with units in the alias: "avg_days_to_close", "pull_through_pct", "funded_count".
`;

// =============================================================================
// LIGHT — Cohi Chat responses and Mortgage Expert persona
// =============================================================================

export const VIZ_STANDARDS_LIGHT = `
## Visualization Guidelines

When producing charts or tables:
- Use **bar charts** for category comparisons, **line charts** for trends over time, **tables** for detail.
- Always label axes clearly with units (count, %, $, days).
- Start Y-axis at 0 for bar charts — do not truncate to exaggerate differences.
- Format numbers consistently: currency as "$X,XXX", percentages as "XX.X%", counts as whole numbers.
- Include sample context: if a rate is based on very few loans, note it briefly.
- Prefer clarity over complexity — a clean bar chart beats a confusing multi-series chart.
`;
