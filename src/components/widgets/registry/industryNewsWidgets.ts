/**
 * Widget definitions for Mortgage Industry News.
 * Single full-component embed.
 */

import type { WidgetDefinition } from './types';
import { IndustryNewsEmbed } from '../components/IndustryNewsEmbed';

const industryNewsEmbed: WidgetDefinition = {
  id: 'industry-news-embed',
  name: 'Mortgage Industry News',
  description: 'Latest mortgage industry news and market updates',
  category: 'insight',
  group: 'Industry News',
  dataSource: 'industry-news',
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 500, h: 500 },
  minSize: { w: 350, h: 300 },
  component: IndustryNewsEmbed as any,
};

export const industryNewsWidgets: WidgetDefinition[] = [industryNewsEmbed];
