import React from "react";
import type { WidgetDefinition } from "./types";
import { ProductionTrendsEmbed } from "../components/ProductionTrendsEmbed";

const productionTrendsYoy: WidgetDefinition = {
  id: "production-trends-yoy",
  name: "Production Trends YoY",
  description: "Year-over-year comparison table",
  category: "table",
  group: "Production Trends",
  dataSource: "production-trends",
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 24, h: 16 },
  minSize: { w: 16, h: 10 },
  config: { variant: "yoy" },
  component: ProductionTrendsEmbed as React.ComponentType<any>,
};

const productionTrendsLargest: WidgetDefinition = {
  id: "production-trends-largest-category",
  name: "Production Trends Largest Category",
  description: "Largest dimension category bar chart",
  category: "chart",
  group: "Production Trends",
  dataSource: "production-trends",
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 24, h: 20 },
  minSize: { w: 16, h: 14 },
  config: { variant: "largest" },
  component: ProductionTrendsEmbed as React.ComponentType<any>,
};

const productionTrendsLine: WidgetDefinition = {
  id: "production-trends-line",
  name: "Production Trends YoY Line",
  description: "YoY month-over-month line chart",
  category: "chart",
  group: "Production Trends",
  dataSource: "production-trends",
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 24, h: 20 },
  minSize: { w: 16, h: 14 },
  config: { variant: "line" },
  component: ProductionTrendsEmbed as React.ComponentType<any>,
};

const productionTrendsDrilldown: WidgetDefinition = {
  id: "production-trends-drilldown",
  name: "Production Trends Drilldown",
  description: "Production drilldown table",
  category: "table",
  group: "Production Trends",
  dataSource: "production-trends",
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 36, h: 20 },
  minSize: { w: 24, h: 12 },
  config: { variant: "drilldown" },
  component: ProductionTrendsEmbed as React.ComponentType<any>,
};

export const productionTrendsWidgets: WidgetDefinition[] = [
  productionTrendsYoy,
  productionTrendsLargest,
  productionTrendsLine,
  productionTrendsDrilldown,
];

