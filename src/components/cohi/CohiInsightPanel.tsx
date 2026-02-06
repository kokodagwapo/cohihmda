/**
 * CohiInsightPanel – renders a COHI ResponsePlan as a sequence of block components.
 * Used by COHI Chat and any UI that displays structured COHI answers.
 */

import React from 'react';
import { Badge } from '@/components/ui/badge';
import type { ResponsePlan, ResponsePlanSection, SectionType } from '@/types/cohiResponsePlan';
import {
  SummaryHeader,
  KpiCardRow,
  RankedTable,
  GroupedTable,
  InsightBullets,
  CohiChart,
  AnomaliesAndRisks,
  ForecastAndScenarios,
  ActionsPanel,
  DataNotes,
} from '@/components/cohi/blocks';
import { cn } from '@/lib/utils';

export interface CohiInsightPanelProps {
  responsePlan: ResponsePlan;
  dataPayloads?: Record<string, unknown[]>;
  /** Optional chart explanation text for chart blocks */
  chartExplanation?: string;
  /** Exclude these section types (e.g. hide charts/tables for executive summary until asked) */
  excludeSectionTypes?: SectionType[];
  /** When true, hide title/subtitle/confidence so only answer content is shown (e.g. in chat) */
  compact?: boolean;
  className?: string;
}

function renderSection(
  section: ResponsePlanSection,
  dataPayloads: Record<string, unknown[]>,
  chartExplanation?: string
): React.ReactNode {
  const { type, props } = section;
  switch (type) {
    case 'header_summary':
      return <SummaryHeader props={props as any} />;
    case 'kpi_cards':
      return <KpiCardRow props={props as any} />;
    case 'ranked_table':
      return <RankedTable props={props as any} />;
    case 'grouped_table':
      return <GroupedTable props={props as any} />;
    case 'bullet_insights':
      return <InsightBullets props={props as any} />;
    case 'chart':
      return (
        <CohiChart
          props={props as any}
          dataPayloads={dataPayloads}
          chartExplanation={chartExplanation}
        />
      );
    case 'anomalies_and_risks':
      return <AnomaliesAndRisks props={props as any} />;
    case 'forecast_and_scenarios':
      return <ForecastAndScenarios props={props as any} />;
    case 'recommended_actions':
      return <ActionsPanel props={props as any} />;
    case 'data_notes':
      return <DataNotes props={props as any} />;
    default:
      return null;
  }
}

export function CohiInsightPanel({
  responsePlan,
  dataPayloads = {},
  chartExplanation,
  excludeSectionTypes,
  compact,
  className,
}: CohiInsightPanelProps) {
  const { title, subtitle, confidence_level, sections, missing_data_requests } = responsePlan;
  const visibleSections = excludeSectionTypes?.length
    ? sections?.filter((s) => !excludeSectionTypes.includes(s.type)) ?? []
    : sections ?? [];
  if (!visibleSections.length) {
    return (
      <div className={cn('rounded-lg border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground', className)}>
        No sections in this response.
      </div>
    );
  }
  return (
    <div className={cn('space-y-3', className)}>
      {!compact && (title || subtitle) && (
        <div className="flex flex-wrap items-center gap-2">
          {title && <h2 className="text-sm font-semibold text-foreground">{title}</h2>}
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          <Badge
            variant={confidence_level === 'high' ? 'default' : confidence_level === 'medium' ? 'secondary' : 'outline'}
            className="text-[10px] px-1.5 py-0"
          >
            {confidence_level}
          </Badge>
        </div>
      )}
      <div className="space-y-3">
        {visibleSections.map((section, i) => (
          <div key={i} className="min-w-0">
            {renderSection(section, dataPayloads, chartExplanation)}
          </div>
        ))}
      </div>
      {missing_data_requests?.length ? (
        <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20 p-2.5 space-y-1">
          <p className="text-[11px] font-medium text-foreground">Need more?</p>
          <ul className="space-y-0.5">
            {missing_data_requests.map((req, i) => (
              <li key={i} className="text-xs text-muted-foreground">
                • {req.question}
                {req.options?.length ? (
                  <span className="text-[10px] text-muted-foreground ml-1">
                    ({req.options.join(', ')})
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
