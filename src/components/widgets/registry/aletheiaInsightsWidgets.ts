/**
 * Widget definitions for Cohi Daily Briefings (Aletheia Insights).
 * Single full-component embed.
 */

import type { WidgetDefinition } from './types';
import { AletheiaInsightsEmbed } from '../components/AletheiaInsightsEmbed';

const aletheiaInsightsEmbed: WidgetDefinition = {
  id: 'aletheia-insights-embed',
  name: 'Cohi Daily Briefings',
  description: 'AI-generated daily briefings and insights from your pipeline data',
  category: 'insight',
  group: 'Cohi Insights',
  dataSource: 'aletheia-insights',
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 500, h: 500 },
  minSize: { w: 350, h: 300 },
  component: AletheiaInsightsEmbed as any,
};

export const aletheiaInsightsWidgets: WidgetDefinition[] = [aletheiaInsightsEmbed];
