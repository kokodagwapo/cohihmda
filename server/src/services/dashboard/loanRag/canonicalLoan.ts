/**
 * Canonical loan representation for embedding.
 * Converts a loan record into a stable, deterministic textual representation
 * using only selected signal strength fields. Same format for historical and active loans.
 */

export type CanonicalConfig = {
  /** Ordered list of signal strength field names. */
  signalFields: readonly string[];
  /** Optional labels; key = field name, value = display label. */
  labels?: Record<string, string>;
};

/** Default config using standard signal fields. */
const defaultLabels: Record<string, string> = {
  creditMetricsSignalStrength: 'Credit Metrics',
  loanCharacteristicsSignalStrength: 'Loan Characteristics',
  timeInMotionSignalStrength: 'Time in Motion',
  mloAeFalloutProneSignalStrength: 'MLO AE Fallout Prone',
  interestLockVsMarketSignalStrength: 'Interest Lock vs Market',
  uwPullthroughSignalStrength: 'UW Pullthrough',
  closerPullthroughSignalStrength: 'Closer Pullthrough',
  processorPullthroughSignalStrength: 'Processor Pullthrough',
};

/**
 * Convert a loan record into a deterministic string suitable for embedding.
 * Uses only the configured signal fields, consistent ordering, no free-form text.
 */
export function toCanonicalLoanText(
  loan: Record<string, unknown>,
  config: CanonicalConfig
): string {
  const { signalFields, labels = defaultLabels } = config;
  const lines: string[] = [];
  for (const field of signalFields) {
    const raw = loan[field];
    const value = raw === null || raw === undefined ? '' : String(raw).trim();
    const label = labels[field] ?? field;
    lines.push(`${label}: ${value}`);
  }
  return lines.join('\n');
}
