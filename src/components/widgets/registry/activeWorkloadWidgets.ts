import React from "react";
import type { WidgetDefinition } from "./types";
import { ActiveWorkloadEmbed } from "../components/ActiveWorkloadEmbed";

const activeFilesKpi: WidgetDefinition = {
  id: "active-workload-kpi-active-files",
  name: "Active Workload KPI: Active Files",
  description: "Count of active loans",
  category: "kpi",
  group: "Active Workload",
  dataSource: "active-workload",
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 14, h: 10 },
  minSize: { w: 10, h: 8 },
  config: { variant: "kpi-active-files" },
  component: ActiveWorkloadEmbed as React.ComponentType<any>,
};

const daysActiveKpi: WidgetDefinition = {
  id: "active-workload-kpi-days-active",
  name: "Active Workload KPI: Days Active",
  description: "Average or median days active KPI",
  category: "kpi",
  group: "Active Workload",
  dataSource: "active-workload",
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 14, h: 10 },
  minSize: { w: 10, h: 8 },
  config: { variant: "kpi-days-active" },
  component: ActiveWorkloadEmbed as React.ComponentType<any>,
};

const drilldownTable: WidgetDefinition = {
  id: "active-workload-drilldown",
  name: "Active Workload Drilldown",
  description: "Actor → Loan Type → Loan Purpose drilldown table",
  category: "table",
  group: "Active Workload",
  dataSource: "active-workload",
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 24, h: 24 },
  minSize: { w: 18, h: 14 },
  config: { variant: "drilldown" },
  component: ActiveWorkloadEmbed as React.ComponentType<any>,
};

const milestoneChart: WidgetDefinition = {
  id: "active-workload-milestone-chart",
  name: "Active Workload Milestone Chart",
  description: "Active loans and days active by milestone",
  category: "chart",
  group: "Active Workload",
  dataSource: "active-workload",
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 24, h: 30 },
  minSize: { w: 18, h: 20 },
  config: { variant: "milestone-chart" },
  component: ActiveWorkloadEmbed as React.ComponentType<any>,
};

const detailTable: WidgetDefinition = {
  id: "active-workload-detail-table",
  name: "Active Workload Detail Table",
  description: "Detailed active loans table with typed filters",
  category: "table",
  group: "Active Workload",
  dataSource: "active-workload",
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 36, h: 30 },
  minSize: { w: 24, h: 20 },
  config: { variant: "detail-table" },
  component: ActiveWorkloadEmbed as React.ComponentType<any>,
};

export const activeWorkloadWidgets: WidgetDefinition[] = [
  activeFilesKpi,
  daysActiveKpi,
  drilldownTable,
  milestoneChart,
  detailTable,
];

