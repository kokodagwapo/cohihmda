/**
 * Workflow Conversion – single full-view embed for the workbench.
 * Includes period, calculation, grouping, reset to default, and 6-card grid.
 * Component handles its own data fetching and state (same as standalone page).
 */

import React from 'react';
import type { WidgetDefinition } from './types';
import { WorkflowConversionEmbed } from '../components/WorkflowConversionEmbed';

const workflowConversionEmbed: WidgetDefinition = {
  id: 'workflow-conversion-embed',
  name: 'Workflow Conversion',
  description: 'Full workflow conversion with period, calculation, grouping, and 6 milestone cards with conversion % and charts',
  category: 'table',
  group: 'Workflow Conversion',
  dataSource: 'workflow-conversion',
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 1200, h: 900 },
  minSize: { w: 800, h: 600 },
  component: WorkflowConversionEmbed as React.ComponentType<any>,
};

export const workflowConversionWidgets: WidgetDefinition[] = [
  workflowConversionEmbed,
];
