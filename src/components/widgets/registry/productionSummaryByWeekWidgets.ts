import React from "react";
import type { WidgetDefinition } from "./types";
import { ProductionSummaryByWeekEmbed } from "../components/ProductionSummaryByWeekEmbed";

const productionSummaryStartedWidget: WidgetDefinition = {
  id: "production-summary-by-week-started",
  name: "Production Summary by Week - Started Date",
  description: "Weekly summary table grouped by started date",
  category: "table",
  group: "Production Summary by Week",
  dataSource: "production-summary-by-week",
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 18, h: 18 },
  minSize: { w: 12, h: 12 },
  config: { variant: "started" },
  component: ProductionSummaryByWeekEmbed as React.ComponentType<any>,
};

const productionSummaryApplicationWidget: WidgetDefinition = {
  id: "production-summary-by-week-application",
  name: "Production Summary by Week - Application Date",
  description: "Weekly summary table grouped by application date",
  category: "table",
  group: "Production Summary by Week",
  dataSource: "production-summary-by-week",
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 18, h: 18 },
  minSize: { w: 12, h: 12 },
  config: { variant: "application" },
  component: ProductionSummaryByWeekEmbed as React.ComponentType<any>,
};

const productionSummaryLockWidget: WidgetDefinition = {
  id: "production-summary-by-week-lock",
  name: "Production Summary by Week - Lock Date",
  description: "Weekly summary table grouped by lock date",
  category: "table",
  group: "Production Summary by Week",
  dataSource: "production-summary-by-week",
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 18, h: 18 },
  minSize: { w: 12, h: 12 },
  config: { variant: "lock" },
  component: ProductionSummaryByWeekEmbed as React.ComponentType<any>,
};

const productionSummaryFundingWidget: WidgetDefinition = {
  id: "production-summary-by-week-funding",
  name: "Production Summary by Week - Funding Date",
  description: "Weekly summary table grouped by funding date",
  category: "table",
  group: "Production Summary by Week",
  dataSource: "production-summary-by-week",
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 18, h: 18 },
  minSize: { w: 12, h: 12 },
  config: { variant: "funding" },
  component: ProductionSummaryByWeekEmbed as React.ComponentType<any>,
};

const productionSummaryClosingWidget: WidgetDefinition = {
  id: "production-summary-by-week-closing",
  name: "Production Summary by Week - Closing Date",
  description: "Weekly summary table grouped by closing date",
  category: "table",
  group: "Production Summary by Week",
  dataSource: "production-summary-by-week",
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 18, h: 18 },
  minSize: { w: 12, h: 12 },
  config: { variant: "closing" },
  component: ProductionSummaryByWeekEmbed as React.ComponentType<any>,
};

const productionSummaryLoanDetailWidget: WidgetDefinition = {
  id: "production-summary-by-week-loan-detail",
  name: "Production Summary by Week - Loan Detail",
  description: "Loan detail table for production summary by week",
  category: "table",
  group: "Production Summary by Week",
  dataSource: "production-summary-by-week",
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 18, h: 24 },
  minSize: { w: 12, h: 16 },
  config: { variant: "loan-detail" },
  component: ProductionSummaryByWeekEmbed as React.ComponentType<any>,
};

export const productionSummaryByWeekWidgets: WidgetDefinition[] = [
  productionSummaryStartedWidget,
  productionSummaryApplicationWidget,
  productionSummaryLockWidget,
  productionSummaryFundingWidget,
  productionSummaryClosingWidget,
  productionSummaryLoanDetailWidget,
];
