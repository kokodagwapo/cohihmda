/**
 * Utility functions for formatting numbers and other display values
 */

/**
 * Formats large numbers in a compact, human-readable format with currency symbol
 * Examples: $1.2B, $5.3M, $42.5K, $999
 * 
 * @param num - The number to format
 * @returns Formatted string with currency symbol and compact notation
 */
export const formatCompactNumber = (num: number): string => {
  const n = typeof num === "number" && Number.isFinite(num) ? num : 0;
  if (n >= 1_000_000_000) {
    return `$${(n / 1_000_000_000).toFixed(1)}B`;
  }
  if (n >= 1_000_000) {
    return `$${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `$${(n / 1_000).toFixed(1)}K`;
  }
  return `$${n.toFixed(0)}`;
};

/**
 * Formats large numbers in a compact format without currency symbol
 * Examples: 1.2M, 5K, 999
 * 
 * @param num - The number to format
 * @returns Formatted string with compact notation (no currency symbol)
 */
export const formatCompactNumberNoCurrency = (num: number): string => {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(0)}K`;
  }
  return num.toString();
};

