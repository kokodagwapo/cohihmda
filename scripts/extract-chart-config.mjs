import fs from "fs";

const lines = fs
  .readFileSync("src/components/research/FindingDrillDown.tsx", "utf8")
  .split(/\r?\n/);

const header = `import type { EvidenceItem } from "@/hooks/useResearchSession";
import { isSqlEvidence } from "@/hooks/useResearchSession";
import { humanizeKey, inferFormat, agentFormatToFieldFormat } from "@/lib/researchEvidenceExport";

export interface ResolvedChartConfig {
  chartType:
    | "bar"
    | "horizontal_bar"
    | "line"
    | "area"
    | "pie"
    | "donut"
    | "stacked_bar"
    | "grouped_bar"
    | "histogram"
    | "scatter";
  xKey: string;
  yKey: string;
  yKeys?: string[];
  isStacked: boolean;
  isMultiSeries: boolean;
  data: Record<string, unknown>[];
  title: string;
  xLabel?: string;
  yLabel?: string;
}

`;

// Lines 1117-1485 (1-based): isStrictlyNumeric .. end of _computeConfig
// Lines 1505-1516: rawLabel, parseNumeric
const body =
  lines.slice(1116, 1485).join("\n") +
  "\n\n" +
  lines.slice(1504, 1516).join("\n");

const footer = `
export function evidenceToChartConfig(
  evidence: EvidenceItem,
): ResolvedChartConfig | null {
  const config = _computeConfig(evidence);
  if (!config) return null;
  const allValueKeys = config.yKeys ?? [config.yKey];
  config.data = ensureUniqueX(config.data, config.xKey, allValueKeys);
  if (config.data.length < 2) return null;
  return config;
}

export function canExportChart(evidence: EvidenceItem): boolean {
  return evidenceToChartConfig(evidence) != null;
}
`;

fs.writeFileSync(
  "src/lib/researchChartConfig.ts",
  header + body.trim() + footer,
);
console.log("lines", body.split("\n").length);
