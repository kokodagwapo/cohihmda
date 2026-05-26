/**
 * Research Lab: render a single canonical registry widget with one data hook
 * (via SingleSourceWidgetProvider) or self-contained embeds.
 */

import { useMemo } from "react";
import { AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getWidgetDefinition } from "@/components/widgets/registry";
import type { DataSourceId } from "@/components/widgets/registry/types";
import type { EvidenceItemRegistryWidget } from "@/hooks/useResearchSession";
import { SingleSourceWidgetProvider } from "@/components/widgets/data/SingleSourceWidgetProvider";
import { useWidgetData } from "@/components/widgets/data/WidgetDataProvider";
import { ResearchSourceDashboardLink } from "@/components/research/ResearchSourceDashboardLink";
import type { ResearchVisualizationSource } from "@/types/researchWorkbench";
import { cn } from "@/lib/utils";

/** Mirrors cases handled in SingleSourceWidgetProvider. */
const SINGLE_SOURCE_DATA_SOURCES = new Set<DataSourceId>([
  "company-scorecard",
  "credit-risk",
  "sales-scorecard",
  "operations-scorecard",
  "operations-trends",
  "sales-trends",
  "funnel",
  "top-tiering-comparison",
  "dashboard-metrics",
  "loan-detail",
  "high-performers",
  "actors",
  "pricing-dashboard",
  "pipeline-analysis",
  "loan-complexity",
  "estimated-closings-risk",
]);

function isSingleSourceDataSource(id: string): id is DataSourceId {
  return SINGLE_SOURCE_DATA_SOURCES.has(id as DataSourceId);
}

function isLikelyPermissionError(err: string | null): boolean {
  if (!err) return false;
  const e = err.toLowerCase();
  return (
    e.includes("401") ||
    e.includes("403") ||
    e.includes("forbidden") ||
    e.includes("unauthorized") ||
    e.includes("not authorized")
  );
}

function DashboardFallbackCard({
  evidence,
  message,
}: {
  evidence: EvidenceItemRegistryWidget;
  message: string;
}) {
  const source: ResearchVisualizationSource = {
    kind: "dashboard",
    dashboardPath: evidence.dashboardPath,
    dashboardLabel: evidence.dashboardLabel,
    sectionId: evidence.sectionId,
    matchConfidence: "medium",
    navigateState: evidence.sectionId ? { sectionId: evidence.sectionId } : undefined,
  };
  return (
    <Card className="border-dashed bg-muted/30">
      <CardContent className="pt-4 pb-4 space-y-2 text-sm">
        <div className="flex items-start gap-2 text-muted-foreground">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-foreground">{message}</p>
            <p className="text-xs mt-1">
              Open the live dashboard for <span className="font-medium">{evidence.dashboardLabel}</span> instead.
            </p>
          </div>
        </div>
        <ResearchSourceDashboardLink source={source} />
      </CardContent>
    </Card>
  );
}

function CanonicalWidgetBody({
  evidence,
  width,
  height,
}: {
  evidence: EvidenceItemRegistryWidget;
  width: number;
  height: number;
}) {
  const definition = getWidgetDefinition(evidence.definitionId);
  if (!definition) {
    return (
      <p className="text-xs text-muted-foreground p-2">
        Unknown widget definition: <code>{evidence.definitionId}</code>
      </p>
    );
  }

  const { data, loading, error } = useWidgetData(
    definition.dataSource,
    definition.dataSelector,
    evidence.sectionId,
  );

  if (!loading && (isLikelyPermissionError(error) || error === "No WidgetDataProvider found")) {
    return (
      <DashboardFallbackCard
        evidence={evidence}
        message="This visualization isn’t available for your account or session."
      />
    );
  }

  if (!loading && error) {
    return (
      <DashboardFallbackCard
        evidence={evidence}
        message={error.length > 160 ? `${error.slice(0, 160)}…` : error}
      />
    );
  }

  const Component = definition.component;
  const config = useMemo(
    () => ({
      ...definition.config,
      definitionName: definition.name,
      definitionCategory: definition.category,
    }),
    [definition.config, definition.name, definition.category],
  );

  return (
    <Component
      data={data}
      loading={loading}
      error={error}
      width={width}
      height={height}
      config={config}
    />
  );
}

export interface RegistryWidgetEmbedProps {
  evidence: EvidenceItemRegistryWidget;
  /** Larger default dimensions when used as the primary visualization. */
  hero?: boolean;
  className?: string;
  /** DOM key for full-report PPT widget capture. */
  captureKey?: string;
}

export function RegistryWidgetEmbed({
  evidence,
  hero,
  className,
  captureKey,
}: RegistryWidgetEmbedProps) {
  const definition = getWidgetDefinition(evidence.definitionId);
  const width = hero ? 560 : 480;
  const height = hero ? 380 : 300;
  const branch = evidence.filters?.branch;
  const loanOfficer = evidence.filters?.loanOfficer;

  const captureProps = captureKey
    ? { "data-research-export-key": captureKey }
    : {};

  if (!definition) {
    return (
      <div
        data-testid="research-registry-widget-embed"
        className={className}
        {...captureProps}
      >
        <DashboardFallbackCard
          evidence={evidence}
          message={`Widget “${evidence.definitionId}” is not in the registry for this build.`}
        />
      </div>
    );
  }

  if (isSingleSourceDataSource(definition.dataSource)) {
    return (
      <div
        data-testid="research-registry-widget-embed"
        className={cn("rounded-md border bg-card overflow-hidden", className)}
        {...captureProps}
      >
        <div className="px-2 py-1.5 border-b bg-muted/40 flex items-center justify-between gap-2">
          <span className="text-xs font-medium truncate">{definition.name}</span>
          <span className="text-[10px] text-muted-foreground shrink-0">Canonical widget</span>
        </div>
        <div className="p-2 min-h-[200px]">
          <SingleSourceWidgetProvider
            dataSourceId={definition.dataSource}
            period={evidence.period}
            branch={branch}
            loanOfficer={loanOfficer}
          >
            <CanonicalWidgetBody evidence={evidence} width={width} height={height} />
          </SingleSourceWidgetProvider>
        </div>
        {evidence.explanation && (
          <p className="text-[11px] text-muted-foreground italic px-2 py-1.5 border-t bg-muted/20">
            {evidence.explanation}
          </p>
        )}
      </div>
    );
  }

  const Component = definition.component;
  return (
    <div
      data-testid="research-registry-widget-embed"
      className={cn("rounded-md border bg-card overflow-hidden", className)}
      {...captureProps}
    >
      <div className="px-2 py-1.5 border-b bg-muted/40 flex items-center justify-between gap-2">
        <span className="text-xs font-medium truncate">{definition.name}</span>
        <span className="text-[10px] text-muted-foreground shrink-0">Dashboard embed</span>
      </div>
      <div className="p-2 min-h-[200px]">
        <Component
          data={null}
          loading={false}
          error={null}
          width={width}
          height={height}
          config={definition.config}
        />
      </div>
      {evidence.explanation && (
        <p className="text-[11px] text-muted-foreground italic px-2 py-1.5 border-t bg-muted/20">
          {evidence.explanation}
        </p>
      )}
    </div>
  );
}
