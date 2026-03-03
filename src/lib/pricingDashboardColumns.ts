/**
 * Default pricing dashboard table columns (metric columns only).
 * Used when no custom columns are set. Applies to all four tables.
 */

export interface PricingDashboardColumnDef {
  key: string;
  label: string;
}

/** Default metric columns shown on report and detail tables (after entity/actor and detail-only fields). */
export const DEFAULT_PRICING_DASHBOARD_COLUMNS: PricingDashboardColumnDef[] = [
  { key: 'units', label: 'Units' },
  { key: 'volume', label: 'Volume' },
  { key: 'loanPricingDollars', label: 'Loan Pricing $' },
  { key: 'pricingMargin', label: 'Pricing Margin' },
  { key: 'cdLenderCredits', label: 'CD Lender Credits' },
];

/** All known pricing field keys (default + previously removed) for "Add column" picker. */
export const PRICING_AVAILABLE_FIELDS: PricingDashboardColumnDef[] = [
  ...DEFAULT_PRICING_DASHBOARD_COLUMNS,
  { key: 'purchaseAdviceSellAmount', label: 'Purchase Advice Sell Amount' },
  { key: 'line800TotalBorrowerPaidAmount', label: 'Line 800 Total Borrower Paid Amount' },
  { key: 'feesAppraisalFeeBorr', label: 'Fees Appraisal Fee Borr' },
  { key: 'line800TotalSellerPaidAmount', label: 'Line 800 Total Seller Amount' },
  { key: 'feesInterestBorr', label: 'Fees Interest Borr' },
  { key: 'purchaseAdvExpectedIntPymtFromInvestor', label: 'Purchase Adv Expected Int Pymt from Investor' },
  { key: 'purchaseAdviceExpctdPayout1Amt', label: 'Purchase Advice Expctd Payout 1 Amt' },
  { key: 'purchaseAdviceExpctdPayout2Amt', label: 'Purchase Advice Expctd Payout 2 Amt' },
  { key: 'purchaseAdviceExpctdPayout3Amt', label: 'Purchase Advice Expctd Payout 3 Amt' },
  { key: 'lenderCredits', label: 'Lender Credits' },
];

/** TableColumn shape for widget registry (align, format, sortable). */
export interface PricingTableColumn {
  key: string;
  label: string;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  format?: 'currency' | 'number';
}

/** Build report table columns (entity, actor, then metric columns). */
export function buildPricingReportColumns(
  customMetrics: PricingDashboardColumnDef[] | undefined
): PricingTableColumn[] {
  const metrics = customMetrics?.length ? customMetrics : DEFAULT_PRICING_DASHBOARD_COLUMNS;
  const metricCols: PricingTableColumn[] = metrics.map((m) => ({
    key: m.key,
    label: m.label,
    sortable: true,
    align: 'right' as const,
    format: (m.key === 'units' || m.key === 'pricingMargin' ? 'number' : 'currency') as 'number' | 'currency',
  }));
  return [
    { key: 'entityName', label: 'Entity', sortable: true },
    { key: 'actorName', label: 'Actor', sortable: true },
    ...metricCols,
  ];
}

/** Build detail table columns (entity, actor, loan #, dates, status, then metric columns). */
export function buildPricingDetailColumns(
  customMetrics: PricingDashboardColumnDef[] | undefined
): PricingTableColumn[] {
  const metrics = customMetrics?.length ? customMetrics : DEFAULT_PRICING_DASHBOARD_COLUMNS;
  const metricCols: PricingTableColumn[] = metrics.map((m) => ({
    key: m.key,
    label: m.label,
    sortable: true,
    align: 'right' as const,
    format: (m.key === 'units' || m.key === 'pricingMargin' ? 'number' : 'currency') as 'number' | 'currency',
  }));
  return [
    { key: 'entityName', label: 'Entity', sortable: true },
    { key: 'actorName', label: 'Actor', sortable: true },
    { key: 'loanNumber', label: 'Loan Number', sortable: true },
    { key: 'applicationDate', label: 'Application Date', sortable: true },
    { key: 'lockExpirationDate', label: 'Lock Expiration Date', sortable: true },
    { key: 'fundingDate', label: 'Funding Date', sortable: true },
    { key: 'closingDate', label: 'Closing Date', sortable: true },
    { key: 'currentLoanStatus', label: 'Current Loan Status', sortable: true },
    ...metricCols,
  ];
}
