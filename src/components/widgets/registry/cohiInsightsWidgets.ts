/**
 * Widget definitions for Cohi Insights (Cohi Insights).
 * Single full-component embed.
 */

import type { WidgetDefinition } from './types';
import { CohiInsightsEmbed } from '../components/CohiInsightsEmbed';

const CohiInsightsEmbed: WidgetDefinition = {
  id: 'Cohi-insights-embed',
  name: 'Cohi Insights',
  description: 'AI-generated daily briefings and insights from your pipeline data',
  category: 'insight',
  group: 'Cohi Insights',
  dataSource: 'Cohi-insights',
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 500, h: 500 },
  minSize: { w: 350, h: 300 },
  component: CohiInsightsEmbed as any,
};

export const CohiInsightsWidgets: WidgetDefinition[] = [CohiInsightsEmbed];
