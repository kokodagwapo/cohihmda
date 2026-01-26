/**
 * Data Chat System Prompts
 * Prompts for the AI data chat feature
 */

// ============================================================================
// Main System Prompt
// ============================================================================

export const DATA_CHAT_SYSTEM_PROMPT = `You are a helpful data analyst assistant specialized in mortgage loan data analysis. You help users explore their loan data through natural language questions and generate insightful visualizations.

## Your Capabilities
1. Convert natural language questions to SQL queries
2. Choose appropriate visualization types for the data
3. Provide clear explanations of the results
4. Suggest follow-up questions for deeper analysis

## Database Schema
You have access to a loans table with the following key fields:

### Identifiers
- loan_id: Unique loan identifier
- loan_number: Loan number (may differ from loan_id)
- guid: Global unique identifier

### Loan Details
- loan_amount: Total loan amount in dollars
- loan_type: Type (Conventional, FHA, VA, USDA, etc.)
- loan_purpose: Purpose (Purchase, Refinance, Cash-Out Refinance)
- loan_program: Specific loan program name
- loan_term: Term in months (e.g., 360 for 30-year)
- interest_rate: Interest rate as decimal

### Status & Milestones
- current_loan_status: Current status (Active Loan, Closed, etc.)
- current_milestone: Current pipeline milestone
- current_status_date: Date of current status

### Personnel
- loan_officer: Name of loan officer
- loan_officer_id: Loan officer's ID
- processor: Name of processor
- underwriter: Name of underwriter
- closer: Name of closer
- branch: Branch name or code
- channel: Business channel (Retail, Wholesale, etc.)

### Property
- property_street, property_city, property_state, property_zip
- property_county, property_type (Single Family, Condo, etc.)
- number_of_units: Number of units in property

### Financial
- ltv_ratio: Loan-to-value ratio
- cltv: Combined LTV
- be_dti_ratio: Back-end DTI ratio
- fico_score: Credit score
- appraised_value, sales_price

### Key Dates (all are DATE type)
- application_date: When application was received
- started_date: When loan process started
- lock_date: Rate lock date
- approval_date: Underwriting approval date
- closing_date: Closing/signing date
- funding_date: Funding date

## Query Rules
1. Always use table alias "l" for the loans table: FROM public.loans l
2. Generate ONLY SELECT queries - never INSERT, UPDATE, or DELETE
3. Use proper PostgreSQL syntax
4. Handle NULLs appropriately with COALESCE or IS NOT NULL checks
5. Limit results to 100 rows unless asked for more
6. Use meaningful ORDER BY clauses

## Visualization Selection Guidelines
- Time series (dates on x-axis) → line chart
- Comparing categories (branches, loan types) → bar chart
- Proportions/percentages → pie or donut chart
- Single KPI values → kpi card
- Many columns or detailed data → table
- Trends with volume emphasis → area chart
- Ranking/sorted lists → horizontal_bar chart

## Response Format
Always respond with a JSON object containing:
{
  "sql": "SELECT ... FROM public.loans l ...",
  "params": [],
  "explanation": "Clear explanation of what the query returns",
  "visualizationType": "bar|line|pie|area|table|kpi|donut|horizontal_bar",
  "chartConfig": {
    "title": "Descriptive chart title",
    "xKey": "field for x-axis",
    "yKey": "field for y-axis"
  }
}`;

// ============================================================================
// Visualization Type Descriptions
// ============================================================================

export const VISUALIZATION_TYPES = {
  bar: {
    name: 'Bar Chart',
    description: 'Vertical bars comparing categories',
    bestFor: ['category comparison', 'discrete values', 'ranking'],
    example: 'Loan volume by branch',
  },
  horizontal_bar: {
    name: 'Horizontal Bar Chart',
    description: 'Horizontal bars, good for many categories or long labels',
    bestFor: ['many categories', 'long labels', 'rankings'],
    example: 'Top 20 loan officers by volume',
  },
  line: {
    name: 'Line Chart',
    description: 'Connected points showing trends over time',
    bestFor: ['time series', 'trends', 'continuous data'],
    example: 'Monthly loan volume over the year',
  },
  area: {
    name: 'Area Chart',
    description: 'Filled area under line, emphasizes volume',
    bestFor: ['cumulative totals', 'volume over time', 'stacked comparisons'],
    example: 'Cumulative fundings by month',
  },
  pie: {
    name: 'Pie Chart',
    description: 'Circular chart showing proportions',
    bestFor: ['part of whole', 'market share', '2-6 categories'],
    example: 'Loan distribution by type',
  },
  donut: {
    name: 'Donut Chart',
    description: 'Pie chart with center cutout',
    bestFor: ['part of whole with center metric', 'cleaner look'],
    example: 'Loan status distribution',
  },
  table: {
    name: 'Data Table',
    description: 'Rows and columns of data',
    bestFor: ['detailed data', 'many fields', 'exact values needed'],
    example: 'List of recent loan applications',
  },
  kpi: {
    name: 'KPI Card',
    description: 'Single prominent metric value',
    bestFor: ['single values', 'totals', 'averages', 'counts'],
    example: 'Total loan volume this month',
  },
};

// ============================================================================
// Example Queries
// ============================================================================

export const EXAMPLE_QUERIES = [
  {
    question: 'How many loans do we have by loan type?',
    sql: `SELECT loan_type, COUNT(*) as count 
          FROM public.loans l 
          WHERE loan_type IS NOT NULL 
          GROUP BY loan_type 
          ORDER BY count DESC`,
    visualizationType: 'bar',
    chartConfig: { title: 'Loans by Type', xKey: 'loan_type', yKey: 'count' },
  },
  {
    question: 'What is our total loan volume?',
    sql: `SELECT SUM(loan_amount) as total_volume FROM public.loans l`,
    visualizationType: 'kpi',
    chartConfig: { title: 'Total Loan Volume' },
  },
  {
    question: 'Show me loan volume by month',
    sql: `SELECT DATE_TRUNC('month', application_date) as month, 
                 SUM(loan_amount) as volume,
                 COUNT(*) as count
          FROM public.loans l 
          WHERE application_date IS NOT NULL
          GROUP BY DATE_TRUNC('month', application_date)
          ORDER BY month`,
    visualizationType: 'line',
    chartConfig: { title: 'Monthly Loan Volume', xKey: 'month', yKey: 'volume' },
  },
  {
    question: 'Who are the top loan officers?',
    sql: `SELECT loan_officer, 
                 COUNT(*) as loan_count,
                 SUM(loan_amount) as total_volume
          FROM public.loans l 
          WHERE loan_officer IS NOT NULL
          GROUP BY loan_officer
          ORDER BY total_volume DESC
          LIMIT 10`,
    visualizationType: 'horizontal_bar',
    chartConfig: { title: 'Top 10 Loan Officers', xKey: 'total_volume', yKey: 'loan_officer' },
  },
  {
    question: 'What is the distribution of loan purposes?',
    sql: `SELECT loan_purpose, COUNT(*) as count
          FROM public.loans l
          WHERE loan_purpose IS NOT NULL
          GROUP BY loan_purpose`,
    visualizationType: 'pie',
    chartConfig: { title: 'Loan Purpose Distribution', nameKey: 'loan_purpose', valueKey: 'count' },
  },
];

// ============================================================================
// Follow-up Suggestions
// ============================================================================

export function generateSuggestions(currentQuery: string): string[] {
  const suggestions = [
    'Break this down by branch',
    'Show me the trend over time',
    'Filter to only funded loans',
    'Compare this year vs last year',
    'Add loan type breakdown',
    'Show the top performers',
    'What is the average value?',
    'Filter to the last 30 days',
  ];
  
  // Could be made smarter based on current query analysis
  return suggestions.slice(0, 4);
}

// ============================================================================
// Error Messages
// ============================================================================

export const ERROR_MESSAGES = {
  noData: "I couldn't find any data matching your criteria. Try broadening your filters or asking about a different time period.",
  queryFailed: "I encountered an error running that query. Could you try rephrasing your question?",
  accessDenied: "You don't have access to view that data. Please contact your administrator if you believe this is an error.",
  rateLimited: "You've made too many requests. Please wait a moment before trying again.",
  invalidQuestion: "I'm not sure how to interpret that question. Could you rephrase it or try one of the suggested questions?",
};
