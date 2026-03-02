/**
 * Widget definitions for Pipeline Analysis data source.
 *
 * Matches PipelineAnalysisView layout (week mode, default filters):
 * - Table: week-by-week volume, units, LO count, weekly/monthly/annual % change
 * - Chart: Volume (bars) + Units (lines) by week
 * - LO Count chart: LO count by week
 */

import type { WidgetDefinition } from './types';
import type { PipelineAnalysisSource } from '../components/PipelineAnalysisWidgets';
import {
  PipelineAnalysisTableWidget,
  PipelineAnalysisChartWidget,
  PipelineAnalysisLOCountWidget,
} from '../components/PipelineAnalysisWidgets';

function identity<T>(raw: unknown): T {
  return raw as T;
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

const pipelineAnalysisTable: WidgetDefinition<PipelineAnalysisSource> = {
  id: 'pipeline-analysis-table',
  name: 'Pipeline Analysis Table',
  description: 'Week-by-week volume, units, LO count and % change',
  category: 'table',
  group: 'Pipeline Analysis',
  dataSource: 'pipeline-analysis',
  dataSelector: identity,
  defaultSize: { w: 720, h: 380 },
  minSize: { w: 400, h: 240 },
  component: PipelineAnalysisTableWidget,
};

// ---------------------------------------------------------------------------
// Volume & Units Chart
// ---------------------------------------------------------------------------

const pipelineAnalysisChart: WidgetDefinition<PipelineAnalysisSource> = {
  id: 'pipeline-analysis-chart',
  name: 'Pipeline Volume & Units',
  description: 'Volume (bars) and units (lines) by week',
  category: 'chart',
  group: 'Pipeline Analysis',
  dataSource: 'pipeline-analysis',
  dataSelector: identity,
  defaultSize: { w: 600, h: 320 },
  minSize: { w: 320, h: 220 },
  component: PipelineAnalysisChartWidget,
};

// ---------------------------------------------------------------------------
// LO Count Chart
// ---------------------------------------------------------------------------

const pipelineAnalysisLOCount: WidgetDefinition<PipelineAnalysisSource> = {
  id: 'pipeline-analysis-lo-count',
  name: 'LO Count by Week',
  description: 'Active LO count by week',
  category: 'chart',
  group: 'Pipeline Analysis',
  dataSource: 'pipeline-analysis',
  dataSelector: identity,
  defaultSize: { w: 560, h: 320 },
  minSize: { w: 320, h: 220 },
  component: PipelineAnalysisLOCountWidget,
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const pipelineAnalysisWidgets: WidgetDefinition[] = [
  pipelineAnalysisTable,
  pipelineAnalysisChart,
  pipelineAnalysisLOCount,
];
