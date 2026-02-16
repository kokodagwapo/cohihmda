/**
 * Widget definitions for Financial Modeling Sandbox.
 * Single full-component embed.
 */

import type { WidgetDefinition } from './types';
import { FinancialModelingEmbed } from '../components/FinancialModelingEmbed';

const financialModelingEmbed: WidgetDefinition = {
  id: 'financial-modeling-embed',
  name: 'Financial Modeling Sandbox',
  description: 'Interactive financial modeling and scenario analysis',
  category: 'table',
  group: 'Financial Modeling',
  dataSource: 'financial-modeling',
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 500, h: 700 },
  minSize: { w: 400, h: 400 },
  component: FinancialModelingEmbed as any,
};

export const financialModelingWidgets: WidgetDefinition[] = [financialModelingEmbed];
