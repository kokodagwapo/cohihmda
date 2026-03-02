/**
 * Hook to access analytics tracking (custom events and manual click tracking).
 * Use when you need to send named events from a component.
 */
import { useAnalytics as useAnalyticsContext } from "@/contexts/AnalyticsContext";

export function useAnalytics() {
  return useAnalyticsContext();
}
