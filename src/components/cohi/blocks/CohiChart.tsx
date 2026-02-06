import { useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';
import type { ChartSectionProps } from '@/types/cohiResponsePlan';
import { DynamicVisualization } from '@/components/visualizations/DynamicVisualization';
import type { VisualizationConfig } from '@/components/visualizations/DynamicVisualization';
import { cn } from '@/lib/utils';

const CHART_TYPE_MAP: Record<string, VisualizationConfig['type']> = {
  line: 'line',
  bar: 'bar',
  area: 'area',
  pie: 'pie',
  scatter: 'line', // Recharts scatter via line for now
};

export function CohiChart({
  props,
  dataPayloads,
  chartExplanation,
}: {
  props: ChartSectionProps;
  dataPayloads: Record<string, unknown[]>;
  chartExplanation?: string;
}) {
  const [explainOpen, setExplainOpen] = useState(false);
  const data = props.dataRef ? (dataPayloads[props.dataRef] ?? []) : [];
  const chartType = CHART_TYPE_MAP[props.chartType] ?? 'bar';
  const config: VisualizationConfig = {
    type: chartType,
    title: props.title,
    data: data as any[],
    xKey: props.xKey,
    yKey: props.yKeys[0],
    yKeys: props.yKeys.length > 1 ? props.yKeys : undefined,
    xLabel: props.xKey,
    yLabel: props.seriesLabels?.[0],
    showLegend: props.options?.showLegend ?? true,
    showGrid: props.options?.showGrid ?? true,
    stacked: props.options?.stacked,
  };
  return (
    <div className="space-y-1">
      <div className="rounded-md border border-border/50 overflow-hidden bg-card">
        <div className="px-2.5 py-1.5 border-b border-border/50">
          <h4 className="text-xs font-semibold text-foreground">{props.title}</h4>
        </div>
        <div className="p-2 min-h-[160px]">
          {data.length > 0 ? (
            <DynamicVisualization
              config={config}
              height={200}
              showTitle={false}
              compact
            />
          ) : (
            <div className="flex items-center justify-center h-[160px] text-xs text-muted-foreground">
              No data
            </div>
          )}
        </div>
      </div>
      <Collapsible open={explainOpen} onOpenChange={setExplainOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground px-0">
            <HelpCircle className="h-3.5 w-3.5" />
            Explain
            {explainOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="text-xs text-muted-foreground mt-1.5 pl-5">
            {chartExplanation ?? `${props.title}. X: ${props.xKey}, Y: ${props.yKeys.join(', ')}.`}
          </p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
