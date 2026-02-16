/**
 * Centralized tier color definitions.
 *
 * Single source of truth for tier-based coloring used across the app
 * (dashboard views, canvas widgets, tables, badges, etc.).
 */

export const TIER_COLORS = {
  top: '#00008F',     // Dark blue
  second: '#52B852',  // Green
  bottom: '#B2DCB2',  // Light green
} as const;

export const TIER_COLORS_LIGHT = {
  top: 'rgba(0, 0, 143, 0.1)',
  second: 'rgba(82, 184, 82, 0.1)',
  bottom: 'rgba(178, 220, 178, 0.15)',
} as const;

/**
 * Returns the fill color for a given tier string.
 * Falls back to a neutral slate if the tier is unrecognized.
 */
export function getTierColor(tier: string): string {
  return TIER_COLORS[tier as keyof typeof TIER_COLORS] ?? '#94a3b8';
}

/**
 * Returns the light/background variant for a given tier string.
 */
export function getTierLightColor(tier: string): string {
  return TIER_COLORS_LIGHT[tier as keyof typeof TIER_COLORS_LIGHT] ?? 'rgba(148, 163, 184, 0.1)';
}
