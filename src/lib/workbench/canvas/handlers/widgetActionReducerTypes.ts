import type { CanvasLayoutItem } from "@/components/workbench/canvas/types";

export type WidgetActionReducerResult = "ok" | "not_found" | "invalid" | "noop";

export type WidgetActionReducerToast = {
  title: string;
  description?: string;
  variant?: "destructive";
};

export type WidgetActionReducerOutcome<TItems = CanvasLayoutItem[]> = {
  items: TItems;
  result: WidgetActionReducerResult;
  toast?: WidgetActionReducerToast;
};
