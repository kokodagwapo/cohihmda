import type { ExportData } from "@/utils/exportUtils";
import {
  FIELD_REGISTRY,
  SUMMARY_REGISTRY,
  type FieldFormat,
} from "@/config/insightFieldRegistry";
import type { EvidenceItemSql } from "@/hooks/useResearchSession";

const LABEL_ABBREVIATIONS: Record<string, string> = {
  lo: "LO",
  t12m: "T12m",
  ytd: "YTD",
  mtd: "MTD",
  qtd: "QTD",
  ltv: "LTV",
  cltv: "CLTV",
  dti: "DTI",
  fico: "FICO",
  pni: "P&I",
  ami: "AMI",
};

export function humanizeKey(key: string): string {
  if (FIELD_REGISTRY[key]?.label) return FIELD_REGISTRY[key].label;
  if (SUMMARY_REGISTRY[key]?.label) return SUMMARY_REGISTRY[key].label;

  const withSpaces = key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
  const words = withSpaces.split(/\s+/);
  const result = words
    .map((w) => {
      const lower = w.toLowerCase();
      return LABEL_ABBREVIATIONS[lower] ?? w.replace(/\b\w/g, (c) => c.toUpperCase());
    })
    .join(" ")
    .trim();
  return result || key;
}

const VALID_AGENT_FORMATS = new Set([
  "number",
  "currency",
  "percent",
  "days",
  "date",
  "text",
  "rate",
  "bps",
  "mono",
  "boolean",
  "badge",
]);

export function agentFormatToFieldFormat(
  agentFmt: string | undefined,
): FieldFormat | null {
  if (!agentFmt) return null;
  const lower = agentFmt.toLowerCase().trim();
  if (VALID_AGENT_FORMATS.has(lower)) return lower as FieldFormat;
  return null;
}

export function inferFormat(key: string): FieldFormat {
  if (FIELD_REGISTRY[key]?.format) return FIELD_REGISTRY[key].format;
  if (SUMMARY_REGISTRY[key]?.format)
    return SUMMARY_REGISTRY[key].format as FieldFormat;
  return "text";
}

export function inferFormatFromValue(
  key: string,
  value: string | number,
  agentFormat?: string,
): FieldFormat {
  const fromAgent = agentFormatToFieldFormat(agentFormat);
  if (fromAgent) return fromAgent;
  const strVal = String(value);
  if (strVal.startsWith("$")) return "currency";
  if (strVal.endsWith("%")) return "percent";
  return inferFormat(key);
}

export function formatValue(value: unknown, format: FieldFormat): string {
  if (value == null || value === "") return "-";
  if (typeof value === "object") return JSON.stringify(value);
  const strVal = String(value);

  switch (format) {
    case "currency": {
      const cleaned = strVal.replace(/[$,]/g, "");
      const num = Number(cleaned);
      if (isNaN(num)) return strVal;
      if (Math.abs(num) >= 1_000_000_000)
        return `$${(num / 1_000_000_000).toFixed(2)}B`;
      if (Math.abs(num) >= 1_000_000)
        return `$${(num / 1_000_000).toFixed(2)}M`;
      if (Math.abs(num) >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
      return `$${num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }
    case "percent": {
      const cleaned = strVal.replace(/%/g, "");
      const num = Number(cleaned);
      if (isNaN(num)) return strVal;
      return `${num.toFixed(1)}%`;
    }
    case "rate": {
      const num = Number(strVal);
      if (isNaN(num)) return strVal;
      return `${num.toFixed(3)}%`;
    }
    case "days": {
      const num = Number(strVal);
      if (isNaN(num)) return strVal;
      return `${Math.round(num)}d`;
    }
    case "bps": {
      const num = Number(strVal);
      if (isNaN(num)) return strVal;
      return `${num} bps`;
    }
    case "date": {
      try {
        return new Date(value as string | number | Date).toLocaleDateString();
      } catch {
        return strVal;
      }
    }
    case "number": {
      const num = Number(strVal);
      if (isNaN(num)) return strVal;
      return num.toLocaleString();
    }
    case "mono":
      return strVal;
    case "boolean":
      return value ? "Yes" : "No";
    case "badge":
    case "text":
      return strVal;
    default:
      if (typeof value === "number") return value.toLocaleString();
      return strVal;
  }
}

/** Strip basic markdown for PPT text slides. */
export function stripMarkdownPlain(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

export function buildSqlEvidenceExportData(
  evidence: EvidenceItemSql,
  columnFormats: Record<string, FieldFormat>,
  title: string,
  tableName?: string,
): ExportData {
  const tableRows = evidence.rows.map((row) =>
    evidence.fields.map((f) => {
      const fmt = columnFormats[f] || inferFormat(f);
      return row[f] == null ? "" : formatValue(row[f], fmt);
    }),
  );
  return {
    title,
    tables: [
      {
        name: tableName || title,
        headers: evidence.fields.map(humanizeKey),
        rows: tableRows,
      },
    ],
  };
}

export function sqlEvidenceToTableRows(
  evidence: EvidenceItemSql,
  columnFormats: Record<string, FieldFormat> = {},
): { headers: string[]; rows: string[][] } {
  const data = buildSqlEvidenceExportData(
    evidence,
    columnFormats,
    "",
  );
  const table = data.tables?.[0];
  return {
    headers: table?.headers ?? [],
    rows: (table?.rows ?? []) as string[][],
  };
}
