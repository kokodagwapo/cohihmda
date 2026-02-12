{
"insights": [
{
"id": 524,
"type": "critical",
"message": "55 loans totaling $20.03M meet high-risk credit criteria",
"priority": "critical",
"reasoning": "There are 55 loans that meet high-risk credit criteria, with a combined volume of $20.03M. This includes loans with FICO scores below 620, LTVs over 95%, or DTIs over 50%.",
"source": "credit_risk",
"forPodcast": true,
"bucket": "critical",
"headline": "55 loans totaling $20.03M meet high-risk credit criteria",
"understory": "There are 55 loans that meet high-risk credit criteria, with a combined volume of $20.03M. This includes loans with FICO scores below 620, LTVs over 95%, or DTIs over 50%.",
"severity_score": 0.92,
"bucketPriority": "RED",
"impact": {
"type": "revenue",
"units_affected": 55,
"estimated_dollars": 20030000
},
"evidence": {
"metrics": [
"high_risk_loans",
"high_risk_volume"
],
"comparisons": []
}
},
{
"id": 522,
"type": "critical",
"message": "40 loans totaling $18.92M are at risk of closing within 10 days without CTC",
"priority": "critical",
"reasoning": "There are 40 loans closing in the next 10 days without a Clear to Close (CTC). The total at-risk closing volume is $18.92M, with an average of 5 days to close.",
"source": "closing_risk",
"forPodcast": true,
"bucket": "critical",
"headline": "40 loans totaling $18.92M are at risk of closing within 10 days without CTC",
"understory": "There are 40 loans closing in the next 10 days without a Clear to Close (CTC). The total at-risk closing volume is $18.92M, with an average of 5 days to close.",
"severity_score": 0.9,
"bucketPriority": "RED",
"impact": {
"type": "revenue",
"units_affected": 40,
"estimated_dollars": 18920000
},
"evidence": {
"metrics": [
"closing_risk_loans",
"at_risk_closing_volume"
],
"comparisons": []
}
},
{
"id": 520,
"type": "critical",
"message": "28 loans totaling $13.10M are predicted at risk of withdrawal or denial",
"priority": "critical",
"reasoning": "The total at-risk loans include 17 predicted withdrawals and 11 predicted denials. Combined volume is $13.10M, with 17 loans at risk of withdrawal and 11 loans at risk of denial.",
"source": "predictions",
"forPodcast": true,
"bucket": "critical",
"headline": "28 loans totaling $13.10M are predicted at risk of withdrawal or denial",
"understory": "The total at-risk loans include 17 predicted withdrawals and 11 predicted denials. Combined volume is $13.10M, with 17 loans at risk of withdrawal and 11 loans at risk of denial.",
"severity_score": 0.88,
"bucketPriority": "RED",
"impact": {
"type": "revenue",
"units_affected": 28,
"estimated_dollars": 13100000
},
"evidence": {
"metrics": [
"all_predictions",
"total_at_risk_volume"
],
"comparisons": []
}
},
{
"id": 519,
"type": "critical",
"message": "1 loan totaling $493K has >70% predicted fallout probability",
"priority": "critical",
"reasoning": "The fallout model flags 1 active loan at >70% withdrawal probability. Volume is $493K. Top risk factors include prolonged pipeline duration and unfavorable interest rate lock compared to the current market.",
"source": "predictions",
"forPodcast": true,
"bucket": "critical",
"headline": "1 loan totaling $493K has >70% predicted fallout probability",
"understory": "The fallout model flags 1 active loan at >70% withdrawal probability. Volume is $493K. Top risk factors include prolonged pipeline duration and unfavorable interest rate lock compared to the current market.",
"severity_score": 0.88,
"bucketPriority": "RED",
"impact": {
"type": "revenue",
"units_affected": 1,
"estimated_dollars": 493000
},
"evidence": {
"metrics": [
"high_confidence_predictions",
"high_confidence_volume"
],
"comparisons": []
}
},
{
"id": 523,
"type": "critical",
"message": "10 loans are at TRID risk, closing within 5 days without CD sent",
"priority": "critical",
"reasoning": "There are 10 loans at TRID risk, as they are closing within 5 days without a Closing Disclosure (CD) sent. This is a compliance issue.",
"source": "trid",
"forPodcast": true,
"bucket": "critical",
"headline": "10 loans are at TRID risk, closing within 5 days without CD sent",
"understory": "There are 10 loans at TRID risk, as they are closing within 5 days without a Closing Disclosure (CD) sent. This is a compliance issue.",
"severity_score": 0.85,
"bucketPriority": "RED",
"impact": {
"type": "compliance",
"units_affected": 10,
"estimated_dollars": 0
},
"evidence": {
"metrics": [
"trid_risk_loans"
],
"comparisons": []
}
},
{
"id": 521,
"type": "critical",
"message": "8 locked loans totaling $3.03M are expiring within 7 days without CTC",
"priority": "critical",
"reasoning": "There are 8 locked loans expiring in the next 7 days without a Clear to Close (CTC). The total expiring volume is $3.03M, with an average of 5 days to expiry.",
"source": "lock_expiration",
"forPodcast": true,
"bucket": "critical",
"headline": "8 locked loans totaling $3.03M are expiring within 7 days without CTC",
"understory": "There are 8 locked loans expiring in the next 7 days without a Clear to Close (CTC). The total expiring volume is $3.03M, with an average of 5 days to expiry.",
"severity_score": 0.85,
"bucketPriority": "RED",
"impact": {
"type": "revenue",
"units_affected": 8,
"estimated_dollars": 3030000
},
"evidence": {
"metrics": [
"expiring_loans",
"expiring_volume"
],
"comparisons": []
}
},
{
"id": 514,
"type": "warning",
"message": "Trailing 30-day funded volume declined 24% from $31.03M to $23.59M",
"priority": "high",
"reasoning": "Trailing 30-day funded volume moved from $31.03M to $23.59M, a decline of $7.44M. This represents a 24% decrease compared to the prior 30-day window.",
"source": "comparisons",
"forPodcast": true,
"bucket": "attention",
"headline": "Trailing 30-day funded volume declined 24% from $31.03M to $23.59M",
"understory": "Trailing 30-day funded volume moved from $31.03M to $23.59M, a decline of $7.44M. This represents a 24% decrease compared to the prior 30-day window.",
"severity_score": 0.67,
"bucketPriority": "YELLOW",
"impact": {
"type": "financial",
"units_affected": null,
"estimated_dollars": null
},
"evidence": {
"metrics": [
"trailing_30_day_volume"
],
"comparisons": [
"vs_prior_30_days"
]
}
},
{
"id": 517,
"type": "warning",
"message": "Average conditions per active loan at 33.3, exceeding 5 conditions threshold",
"priority": "high",
"reasoning": "The average conditions per active loan are currently at 33.3, indicating a backlog of conditions that may delay processing.",
"source": "condition_backlog",
"forPodcast": true,
"bucket": "attention",
"headline": "Average conditions per active loan at 33.3, exceeding 5 conditions threshold",
"understory": "The average conditions per active loan are currently at 33.3, indicating a backlog of conditions that may delay processing.",
"severity_score": 0.66,
"bucketPriority": "YELLOW",
"impact": {
"type": "operational",
"units_affected": null,
"estimated_dollars": null
},
"evidence": {
"metrics": [
"avg_conditions_per_active_loan"
],
"comparisons": []
}
},
{
"id": 516,
"type": "warning",
"message": "Total at-risk loans increased to 28, totaling $13.10M in volume",
"priority": "high",
"reasoning": "Total at-risk loans have increased to 28, with a combined at-risk volume of $13.10M. This includes predicted withdraws and denies.",
"source": "predictions",
"forPodcast": true,
"bucket": "attention",
"headline": "Total at-risk loans increased to 28, totaling $13.10M in volume",
"understory": "Total at-risk loans have increased to 28, with a combined at-risk volume of $13.10M. This includes predicted withdraws and denies.",
"severity_score": 0.65,
"bucketPriority": "YELLOW",
"impact": {
"type": "financial",
"units_affected": null,
"estimated_dollars": null
},
"evidence": {
"metrics": [
"total_at_risk_loans",
"total_at_risk_volume"
],
"comparisons": []
}
},
{
"id": 518,
"type": "warning",
"message": "Locked loans expiring within 7 days total 8, with volume of $3.03M",
"priority": "high",
"reasoning": "There are 8 locked loans expiring within the next 7 days, totaling $3.03M in volume. Monitoring is advised for these loans.",
"source": "lock_expiration",
"forPodcast": true,
"bucket": "attention",
"headline": "Locked loans expiring within 7 days total 8, with volume of $3.03M",
"understory": "There are 8 locked loans expiring within the next 7 days, totaling $3.03M in volume. Monitoring is advised for these loans.",
"severity_score": 0.6,
"bucketPriority": "YELLOW",
"impact": {
"type": "operational",
"units_affected": null,
"estimated_dollars": null
},
"evidence": {
"metrics": [
"locked_loans_expiring_within_7_days",
"expiring_volume"
],
"comparisons": []
}
},
{
"id": 515,
"type": "warning",
"message": "Fallout rate increased to 19.1%, above 20% threshold",
"priority": "high",
"reasoning": "Fallout rate is currently at 19.1%. This is a notable increase, indicating potential issues in the pipeline.",
"source": "pipeline",
"forPodcast": true,
"bucket": "attention",
"headline": "Fallout rate increased to 19.1%, above 20% threshold",
"understory": "Fallout rate is currently at 19.1%. This is a notable increase, indicating potential issues in the pipeline.",
"severity_score": 0.58,
"bucketPriority": "YELLOW",
"impact": {
"type": "operational",
"units_affected": null,
"estimated_dollars": null
},
"evidence": {
"metrics": [
"fallout_rate"
],
"comparisons": []
}
},
{
"id": 507,
"type": "success",
"message": "Revenue YTD at $692K, a 43.1% increase YoY",
"priority": "critical",
"reasoning": "Current YTD revenue stands at $692K, compared to $483K in the same period last year. This indicates a strong revenue growth trajectory.",
"source": "performance",
"forPodcast": true,
"bucket": "working",
"headline": "Revenue YTD at $692K, a 43.1% increase YoY",
"understory": "Current YTD revenue stands at $692K, compared to $483K in the same period last year. This indicates a strong revenue growth trajectory.",
"severity_score": 0.8,
"bucketPriority": "BLUE",
"impact": {
"type": null,
"units_affected": null,
"estimated_dollars": null
},
"evidence": {
"metrics": [],
"comparisons": []
}
},
{
"id": 511,
"type": "success",
"message": "Current YTD volume at $30.46M, up 43.1% YoY",
"priority": "high",
"reasoning": "Year-to-date volume has reached $30.46M, which is a significant increase from $21.29M during the same period last year, indicating strong market performance.",
"source": "comparisons",
"forPodcast": true,
"bucket": "working",
"headline": "Current YTD volume at $30.46M, up 43.1% YoY",
"understory": "Year-to-date volume has reached $30.46M, which is a significant increase from $21.29M during the same period last year, indicating strong market performance.",
"severity_score": 0.75,
"bucketPriority": "BLUE",
"impact": {
"type": null,
"units_affected": null,
"estimated_dollars": null
},
"evidence": {
"metrics": [],
"comparisons": []
}
},
{
"id": 510,
"type": "success",
"message": "Active pipeline includes 153 loans totaling $60.21M",
"priority": "high",
"reasoning": "The current active pipeline consists of 153 loans with a total volume of $60.21M. This indicates a robust pipeline depth for future closings.",
"source": "pipeline",
"forPodcast": true,
"bucket": "working",
"headline": "Active pipeline includes 153 loans totaling $60.21M",
"understory": "The current active pipeline consists of 153 loans with a total volume of $60.21M. This indicates a robust pipeline depth for future closings.",
"severity_score": 0.7,
"bucketPriority": "BLUE",
"impact": {
"type": null,
"units_affected": null,
"estimated_dollars": null
},
"evidence": {
"metrics": [],
"comparisons": []
}
},
{
"id": 513,
"type": "success",
"message": "Top-tier officers contributing 50% of YTD revenue ($346K)",
"priority": "high",
"reasoning": "Jonathan Carrico ($94K, 173 bps), Matt Brown ($89K, 383 bps), and Richard Clarke ($55K, 324 bps) lead the top tier, accounting for half of the total revenue.",
"source": "tiering",
"forPodcast": true,
"bucket": "working",
"headline": "Top-tier officers contributing 50% of YTD revenue ($346K)",
"understory": "Jonathan Carrico ($94K, 173 bps), Matt Brown ($89K, 383 bps), and Richard Clarke ($55K, 324 bps) lead the top tier, accounting for half of the total revenue.",
"severity_score": 0.65,
"bucketPriority": "BLUE",
"impact": {
"type": null,
"units_affected": null,
"estimated_dollars": null
},
"evidence": {
"metrics": [],
"comparisons": []
}
},
{
"id": 508,
"type": "success",
"message": "Cycle time averages 33 days, within acceptable range",
"priority": "high",
"reasoning": "The average cycle time is 33 days, which is within the acceptable range for mortgage processing. This performance helps maintain efficiency in operations.",
"source": "performance",
"forPodcast": true,
"bucket": "working",
"headline": "Cycle time averages 33 days, within acceptable range",
"understory": "The average cycle time is 33 days, which is within the acceptable range for mortgage processing. This performance helps maintain efficiency in operations.",
"severity_score": 0.6,
"bucketPriority": "BLUE",
"impact": {
"type": null,
"units_affected": null,
"estimated_dollars": null
},
"evidence": {
"metrics": [],
"comparisons": []
}
},
{
"id": 512,
"type": "success",
"message": "High-confidence predicted originations at 125 loans",
"priority": "high",
"reasoning": "The forecast indicates that 125 loans are predicted to close successfully, reflecting a positive outlook for future revenue generation.",
"source": "predictions",
"forPodcast": true,
"bucket": "working",
"headline": "High-confidence predicted originations at 125 loans",
"understory": "The forecast indicates that 125 loans are predicted to close successfully, reflecting a positive outlook for future revenue generation.",
"severity_score": 0.55,
"bucketPriority": "BLUE",
"impact": {
"type": null,
"units_affected": null,
"estimated_dollars": null
},
"evidence": {
"metrics": [],
"comparisons": []
}
},
{
"id": 509,
"type": "success",
"message": "Pull-through rate at 56.7%, with room for improvement",
"priority": "medium",
"reasoning": "The pull-through rate is currently at 56.7%, which reflects the percentage of loans that successfully close compared to those started. While not high, it is indicative of ongoing activity.",
"source": "performance",
"forPodcast": true,
"bucket": "working",
"headline": "Pull-through rate at 56.7%, with room for improvement",
"understory": "The pull-through rate is currently at 56.7%, which reflects the percentage of loans that successfully close compared to those started. While not high, it is indicative of ongoing activity.",
"severity_score": 0.5,
"bucketPriority": "BLUE",
"impact": {
"type": null,
"units_affected": null,
"estimated_dollars": null
},
"evidence": {
"metrics": [],
"comparisons": []
}
},
{
"id": 532,
"type": "info",
"message": "Volume trailing 30D: $23.59M, down 24% from $31.03M.",
"priority": "medium",
"reasoning": "The trailing 30-day funded volume is $23.59M, down from $31.03M, reflecting a 24% decrease.",
"source": "comparisons",
"forPodcast": true,
"bucket": "context",
"headline": "Volume trailing 30D: $23.59M, down 24% from $31.03M.",
"understory": "The trailing 30-day funded volume is $23.59M, down from $31.03M, reflecting a 24% decrease.",
"severity_score": 0.3,
"bucketPriority": "GRAY",
"impact": {
"type": "volume",
"units_affected": 0,
"estimated_dollars": 23590000
},
"evidence": {
"metrics": [
"trailing_30d_volume",
"prior_30d_volume"
],
"comparisons": []
}
},
{
"id": 531,
"type": "info",
"message": "High-risk loans: 55 loans totaling $20.03M.",
"priority": "medium",
"reasoning": "There are 55 loans meeting high-risk criteria, with a total volume of $20.03M.",
"source": "credit_risk",
"forPodcast": true,
"bucket": "context",
"headline": "High-risk loans: 55 loans totaling $20.03M.",
"understory": "There are 55 loans meeting high-risk criteria, with a total volume of $20.03M.",
"severity_score": 0.3,
"bucketPriority": "GRAY",
"impact": {
"type": "risk",
"units_affected": 55,
"estimated_dollars": 20030000
},
"evidence": {
"metrics": [
"high_risk_loans",
"high_risk_volume"
],
"comparisons": []
}
},
{
"id": 527,
"type": "info",
"message": "Average cycle time: 33 days with 90D rolling average at 56.7% pull-through.",
"priority": "medium",
"reasoning": "The average cycle time is 33 days, while the rolling 90-day pull-through rate is 56.7%.",
"source": "performance",
"forPodcast": true,
"bucket": "context",
"headline": "Average cycle time: 33 days with 90D rolling average at 56.7% pull-through.",
"understory": "The average cycle time is 33 days, while the rolling 90-day pull-through rate is 56.7%.",
"severity_score": 0.3,
"bucketPriority": "GRAY",
"impact": {
"type": "time",
"units_affected": 0,
"estimated_dollars": 0
},
"evidence": {
"metrics": [
"avgCycleTime",
"pullThrough"
],
"comparisons": []
}
},
{
"id": 533,
"type": "info",
"message": "Volume vs last year: $30.46M, +43.1% from $21.29M.",
"priority": "low",
"reasoning": "Current year-to-date funded volume is $30.46M, representing a 43.1% increase from last year's $21.29M.",
"source": "comparisons",
"forPodcast": true,
"bucket": "context",
"headline": "Volume vs last year: $30.46M, +43.1% from $21.29M.",
"understory": "Current year-to-date funded volume is $30.46M, representing a 43.1% increase from last year's $21.29M.",
"severity_score": 0.2,
"bucketPriority": "GRAY",
"impact": {
"type": "volume",
"units_affected": 0,
"estimated_dollars": 30460000
},
"evidence": {
"metrics": [
"current_ytd_volume",
"last_year_volume"
],
"comparisons": []
}
},
{
"id": 526,
"type": "info",
"message": "YTD volume total: $30.46M across 90 loans.",
"priority": "low",
"reasoning": "The year-to-date origination volume is $30.46M across 90 loans.",
"source": "performance",
"forPodcast": true,
"bucket": "context",
"headline": "YTD volume total: $30.46M across 90 loans.",
"understory": "The year-to-date origination volume is $30.46M across 90 loans.",
"severity_score": 0.2,
"bucketPriority": "GRAY",
"impact": {
"type": "volume",
"units_affected": 90,
"estimated_dollars": 30460000
},
"evidence": {
"metrics": [
"volume_ytd",
"closed_loans"
],
"comparisons": []
}
},
{
"id": 528,
"type": "info",
"message": "Active pipeline: 153 loans totaling $60.21M.",
"priority": "low",
"reasoning": "The active pipeline consists of 153 loans with a total volume of $60.21M.",
"source": "pipeline",
"forPodcast": true,
"bucket": "context",
"headline": "Active pipeline: 153 loans totaling $60.21M.",
"understory": "The active pipeline consists of 153 loans with a total volume of $60.21M.",
"severity_score": 0.2,
"bucketPriority": "GRAY",
"impact": {
"type": "volume",
"units_affected": 153,
"estimated_dollars": 60210000
},
"evidence": {
"metrics": [
"active_loans",
"active_volume"
],
"comparisons": []
}
},
{
"id": 529,
"type": "info",
"message": "Locked loans count: 141 with $30.46M in closed volume.",
"priority": "low",
"reasoning": "There are 141 locked loans, contributing to a closed volume of $30.46M.",
"source": "pipeline",
"forPodcast": true,
"bucket": "context",
"headline": "Locked loans count: 141 with $30.46M in closed volume.",
"understory": "There are 141 locked loans, contributing to a closed volume of $30.46M.",
"severity_score": 0.2,
"bucketPriority": "GRAY",
"impact": {
"type": "volume",
"units_affected": 141,
"estimated_dollars": 30460000
},
"evidence": {
"metrics": [
"locked_loans",
"closed_volume"
],
"comparisons": []
}
},
{
"id": 530,
"type": "info",
"message": "Funnel: 209 loans started, 121 locked, 35 originated, fallout rate at 19.1%.",
"priority": "low",
"reasoning": "From 209 loans started, 121 were locked and 35 originated, resulting in a fallout rate of 19.1%.",
"source": "pipeline",
"forPodcast": true,
"bucket": "context",
"headline": "Funnel: 209 loans started, 121 locked, 35 originated, fallout rate at 19.1%.",
"understory": "From 209 loans started, 121 were locked and 35 originated, resulting in a fallout rate of 19.1%.",
"severity_score": 0.2,
"bucketPriority": "GRAY",
"impact": {
"type": "volume",
"units_affected": 0,
"estimated_dollars": 0
},
"evidence": {
"metrics": [
"loans_started",
"loans_locked",
"loans_originated",
"fallout_rate"
],
"comparisons": []
}
},
{
"id": 525,
"type": "info",
"message": "YTD revenue total: $692K with MTD revenue at $181K.",
"priority": "low",
"reasoning": "Year-to-date revenue stands at $692K, while the month-to-date revenue is $181K.",
"source": "performance",
"forPodcast": true,
"bucket": "context",
"headline": "YTD revenue total: $692K with MTD revenue at $181K.",
"understory": "Year-to-date revenue stands at $692K, while the month-to-date revenue is $181K.",
"severity_score": 0.2,
"bucketPriority": "GRAY",
"impact": {
"type": "revenue",
"units_affected": 0,
"estimated_dollars": 692000
},
"evidence": {
"metrics": [
"revenue_ytd",
"revenue_mtd"
],
"comparisons": []
}
}
],
"generatedAt": "2026-02-11T20:13:05.612Z",
"dateFilter": "ytd",
"usedLLM": true,
"summaryForPodcast": "",
"needsGeneration": false,
"summary": {
"totalLoans": 0,
"revenue": 0,
"pullThroughRate": "0",
"avgCycleTime": 0,
"totalInsights": 27,
"bySource": {
"business_overview": 11,
"leaderboard": 0,
"industry_news": 0,
"loan_funnel": 0,
"predictions": 4
}
}
}
