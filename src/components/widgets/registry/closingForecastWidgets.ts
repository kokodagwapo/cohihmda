/**
 * Widget definitions for Closing & Fallout Forecast.
 * Single full-component embed.
 */

import type { WidgetDefinition } from './types';
import { ClosingForecastEmbed } from '../components/ClosingForecastEmbed';

const closingForecastEmbed: WidgetDefinition = {
  id: 'closing-forecast-embed',
  name: 'Closing & Fallout Forecast',
  description: 'Full closing and fallout forecast with pipeline analysis',
  category: 'table',
  group: 'Closing & Fallout Forecast',
  dataSource: 'closing-forecast',
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 500, h: 600 },
  minSize: { w: 400, h: 400 },
  component: ClosingForecastEmbed as any,
};

export const closingForecastWidgets: WidgetDefinition[] = [closingForecastEmbed];
