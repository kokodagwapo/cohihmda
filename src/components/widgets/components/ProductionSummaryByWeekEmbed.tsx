import React from "react";
import type { WidgetRenderProps } from "../registry/types";
import { ProductionSummaryByWeekView } from "@/pages/ProductionSummaryByWeek";

function ProductionSummaryByWeekEmbedInner({ width, height, config }: WidgetRenderProps) {
  const groupId = (config?.groupId as string | undefined) ?? null;
  const variant =
    (config?.variant as
      | "full"
      | "started"
      | "application"
      | "lock"
      | "funding"
      | "closing"
      | "loan-detail"
      | undefined) ?? "full";

  return (
    <div
      className="h-full w-full overflow-auto rounded-lg bg-white dark:bg-slate-900/80"
      style={{ width, minHeight: height }}
    >
      <ProductionSummaryByWeekView
        embeddedInWorkbench
        groupId={groupId}
        widgetVariant={variant}
      />
    </div>
  );
}

export const ProductionSummaryByWeekEmbed = React.memo(ProductionSummaryByWeekEmbedInner);
