/**
 * Research Upload Processor
 *
 * Handles parsing, type inference, and storage of user-uploaded CSV/XLSX files
 * for Research Lab and Data Explorer.
 *
 * Storage strategies:
 *   'context' — files <= CONTEXT_ROW_THRESHOLD rows: full data stored as JSONB,
 *               injected into LLM context window during research pipeline.
 *   'table'   — files > CONTEXT_ROW_THRESHOLD rows: data loaded into a dedicated
 *               PostgreSQL table in the tenant DB so the data analyst can query it with SQL.
 *
 * PII detection: warns on upload if suspicious column names are detected.
 */

import pg from "pg";
import Papa from "papaparse";
import crypto from "crypto";

// ============================================================================
// Constants
// ============================================================================

export const CONTEXT_ROW_THRESHOLD = 200;
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_ROWS = 500_000;
export const MAX_COLUMNS = 200;
export const UPLOAD_TTL_DAYS = 7;
export const SAMPLE_ROW_COUNT = 50;
const TYPE_INFERENCE_SAMPLE = 1000;

// Column names that may contain PII (warn but don't block)
const PII_COLUMN_PATTERNS = [
  // Government / financial IDs
  /\bssn\b/i, /\bsocial.?security\b/i, /\bdob\b/i, /\bdate.?of.?birth\b/i,
  /\bpassword\b/i, /\baccount.?num/i, /\bcredit.?card\b/i, /\bdriving.?licen/i,
  /\bpassport\b/i, /\btax.?id\b/i, /\bein\b/i, /\bssin\b/i,
  /\bitin\b/i, /\bnational.?id\b/i, /\bid.?number\b/i,
  // Contact information
  /\bemail\b/i, /\bphone\b/i, /\bmobile\b/i, /\bcell\b/i, /\baddress\b/i,
  /\bstreet\b/i, /\bzip\b/i, /\bpostal\b/i, /\bip.?addr/i,
  // Personal details
  /\bfirst.?name\b/i, /\blast.?name\b/i, /\bfull.?name\b/i, /\bbirthday\b/i,
  /\bgender\b/i, /\brace\b/i, /\bethnicity\b/i, /\breligion\b/i,
  /\bsalary\b/i, /\bincome\b/i, /\bwage\b/i,
  // Health / biometric
  /\bdiagnosis\b/i, /\bmedical\b/i, /\bhealth\b/i, /\bbiometric\b/i,
];

// Regex patterns for detecting PII values in sampled data
const PII_VALUE_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "SSN", re: /\b\d{3}-\d{2}-\d{4}\b/ },
  { label: "credit card number", re: /\b(?:\d[ -]?){13,16}\b/ },
  { label: "email address", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/i },
  { label: "US phone number", re: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/ },
];

/**
 * Scan a sample of values for recognizable PII patterns.
 * Returns a label if found, undefined otherwise.
 */
function detectPiiInValues(sampleValues: (string | number | boolean | null)[]): string | undefined {
  for (const val of sampleValues) {
    if (typeof val !== "string") continue;
    for (const { label, re } of PII_VALUE_PATTERNS) {
      if (re.test(val)) return label;
    }
  }
  return undefined;
}

// ============================================================================
// Types
// ============================================================================

export type InferredColumnType =
  | "string"
  | "number"
  | "currency"
  | "percentage"
  | "date"
  | "boolean";

export interface ColumnMeta {
  name: string;               // sanitized column name (used in table/SQL)
  displayName: string;        // original header name as uploaded
  inferredType: InferredColumnType;
  userOverrideType?: InferredColumnType;
  description?: string;       // user-provided for AI context
  nullRate: number;           // 0–1 fraction
  sampleValues: (string | number | boolean | null)[];
  isNumeric: boolean;
  isDate: boolean;
  isCategorical: boolean;     // string col with <=20 unique values
  uniqueCount?: number;
  minVal?: number | string;
  maxVal?: number | string;
  isPotentialPii?: boolean;
}

export type StorageStrategy = "context" | "table";

export interface ProcessedUpload {
  fileName: string;
  originalFileName: string;
  fileSizeBytes: number;
  rowCount: number;
  columnCount: number;
  columns: ColumnMeta[];
  storageStrategy: StorageStrategy;
  tableName?: string;         // set when strategy = 'table'
  dataJson?: Record<string, any>[]; // set when strategy = 'context'
  sampleRows: Record<string, any>[];
  piiWarnings: string[];
  quickInsights: QuickInsightConfig[];
}

export interface QuickInsightConfig {
  title: string;
  chartType: "bar" | "line" | "histogram" | "scatter" | "pie";
  xKey?: string;
  yKey?: string;
  yKeys?: string[];
  nameKey?: string;
  valueKey?: string;
  description: string;
}

// ============================================================================
// Header normalization
// ============================================================================

export function normalizeHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_") || "column";
}

function deduplicateHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((h) => {
    const count = (seen.get(h) || 0) + 1;
    seen.set(h, count);
    return count > 1 ? `${h}_${count}` : h;
  });
}

// ============================================================================
// Type inference
// ============================================================================

const DATE_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}$/,                           // ISO: 2024-01-15
  /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,                   // US: 1/15/2024
  /^\d{1,2}-\d{1,2}-\d{2,4}$/,                     // 01-15-2024
  /^\d{4}\/\d{2}\/\d{2}$/,                          // 2024/01/15
  /^[A-Za-z]+ \d{1,2},? \d{4}$/,                   // January 15, 2024
  /^\d{1,2} [A-Za-z]+ \d{4}$/,                     // 15 January 2024
];

const BOOL_TRUE = new Set(["true", "yes", "1", "y", "on"]);
const BOOL_FALSE = new Set(["false", "no", "0", "n", "off"]);

function inferSingleValue(val: string): InferredColumnType | null {
  if (!val || val.trim() === "") return null;
  const s = val.trim();

  // Boolean
  const lower = s.toLowerCase();
  if (BOOL_TRUE.has(lower) || BOOL_FALSE.has(lower)) return "boolean";

  // Date
  if (DATE_PATTERNS.some((p) => p.test(s)) && !isNaN(Date.parse(s))) return "date";

  // Currency ($1,234.56 or 1234.56)
  if (/^\$?-?\d{1,3}(,\d{3})*(\.\d+)?$/.test(s) || /^\$\d/.test(s)) {
    if (s.startsWith("$")) return "currency";
  }

  // Percentage
  if (/^-?\d+(\.\d+)?%$/.test(s)) return "percentage";

  // Number — but not long digit-only strings (likely identifiers like loan numbers, account IDs)
  const cleaned = s.replace(/,/g, "");
  if (!isNaN(Number(cleaned)) && cleaned.trim() !== "") {
    const digitsOnly = /^-?\d+$/.test(cleaned);
    if (digitsOnly && cleaned.replace("-", "").length >= 6) {
      return "string";
    }
    return "number";
  }

  return "string";
}

function inferColumnType(values: string[]): {
  type: InferredColumnType;
  isNumeric: boolean;
  isDate: boolean;
} {
  const nonEmpty = values.filter((v) => v != null && v.trim() !== "");
  if (nonEmpty.length === 0) return { type: "string", isNumeric: false, isDate: false };

  const typeCounts: Record<string, number> = {};
  for (const v of nonEmpty) {
    const t = inferSingleValue(v) || "string";
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }

  const dominant = (Object.entries(typeCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || "string") as InferredColumnType;
  const confidence = (typeCounts[dominant] || 0) / nonEmpty.length;

  // Only use the dominant type if >=70% of values agree
  const finalType = confidence >= 0.7 ? dominant : "string";

  return {
    type: finalType,
    isNumeric: finalType === "number" || finalType === "currency" || finalType === "percentage",
    isDate: finalType === "date",
  };
}

// ============================================================================
// PII detection
// ============================================================================

function detectPii(colName: string): boolean {
  return PII_COLUMN_PATTERNS.some((re) => re.test(colName));
}

// ============================================================================
// Quick insight suggestions
// ============================================================================

function generateQuickInsights(columns: ColumnMeta[]): QuickInsightConfig[] {
  const insights: QuickInsightConfig[] = [];
  const numericCols = columns.filter((c) => c.isNumeric);
  const dateCols = columns.filter((c) => c.isDate);
  const categoricalCols = columns.filter((c) => c.isCategorical && !c.isNumeric);

  // Date × Numeric → time series
  if (dateCols.length > 0 && numericCols.length > 0) {
    const dateCol = dateCols[0];
    const numCol = numericCols[0];
    insights.push({
      title: `${numCol.displayName} Over Time`,
      chartType: "line",
      xKey: dateCol.name,
      yKey: numCol.name,
      description: `Trend of ${numCol.displayName} over ${dateCol.displayName}`,
    });
  }

  // Categorical × Numeric → bar chart (top N categories)
  if (categoricalCols.length > 0 && numericCols.length > 0) {
    const catCol = categoricalCols[0];
    const numCol = numericCols[0];
    insights.push({
      title: `${numCol.displayName} by ${catCol.displayName}`,
      chartType: "bar",
      xKey: catCol.name,
      yKey: numCol.name,
      description: `Compare ${numCol.displayName} across ${catCol.displayName} categories`,
    });
  }

  // Numeric distribution → histogram
  if (numericCols.length > 0) {
    const numCol = numericCols[0];
    insights.push({
      title: `Distribution of ${numCol.displayName}`,
      chartType: "histogram",
      xKey: numCol.name,
      description: `Value distribution for ${numCol.displayName}`,
    });
  }

  // Categorical proportion → pie
  if (categoricalCols.length > 0) {
    const catCol = categoricalCols[0];
    insights.push({
      title: `Breakdown by ${catCol.displayName}`,
      chartType: "pie",
      nameKey: catCol.name,
      valueKey: "count",
      description: `Proportion breakdown by ${catCol.displayName}`,
    });
  }

  // Two numerics → scatter
  if (numericCols.length >= 2) {
    insights.push({
      title: `${numericCols[0].displayName} vs ${numericCols[1].displayName}`,
      chartType: "scatter",
      xKey: numericCols[0].name,
      yKey: numericCols[1].name,
      description: `Correlation between ${numericCols[0].displayName} and ${numericCols[1].displayName}`,
    });
  }

  return insights.slice(0, 5);
}

// ============================================================================
// PostgreSQL type mapping
// ============================================================================

function pgType(col: InferredColumnType): string {
  switch (col) {
    case "number": return "NUMERIC";
    case "currency": return "NUMERIC(20,4)";
    case "percentage": return "NUMERIC(10,4)";
    case "date": return "DATE";
    case "boolean": return "BOOLEAN";
    default: return "TEXT";
  }
}

function castValue(val: string, type: InferredColumnType): string | number | boolean | null {
  if (val == null || val.trim() === "") return null;
  const s = val.trim();
  switch (type) {
    case "number":
    case "currency":
    case "percentage": {
      const cleaned = s.replace(/[$,%]/g, "").replace(/,/g, "");
      const n = Number(cleaned);
      return isNaN(n) ? null : n;
    }
    case "boolean": {
      const lower = s.toLowerCase();
      if (BOOL_TRUE.has(lower)) return true;
      if (BOOL_FALSE.has(lower)) return false;
      return null;
    }
    case "date":
      return s;
    default:
      return s;
  }
}

// ============================================================================
// CSV parsing
// ============================================================================

function parseCSV(buffer: Buffer): { headers: string[]; rows: string[][] } {
  const text = buffer.toString("utf-8").replace(/^\ufeff/, ""); // strip BOM
  const result = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: true,
    transformHeader: undefined,
  });

  if (!result.data || result.data.length < 1) {
    throw new Error("CSV file is empty or could not be parsed.");
  }

  const headers = (result.data[0] as string[]).map((h) => String(h ?? "").trim());
  const rows = result.data.slice(1) as string[][];
  return { headers, rows };
}

// ============================================================================
// Main processor
// ============================================================================

export async function processUpload(
  buffer: Buffer,
  originalFileName: string,
  fileSizeBytes: number,
  tenantPool: pg.Pool
): Promise<ProcessedUpload> {
  // Validate size before parsing
  if (fileSizeBytes > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File exceeds maximum allowed size of ${Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024)} MB.`);
  }

  // Parse CSV (XLSX support can be added here if xlsx package added to server)
  const { headers: rawHeaders, rows } = parseCSV(buffer);

  if (rows.length > MAX_ROWS) {
    throw new Error(`File exceeds maximum row count of ${MAX_ROWS.toLocaleString()}.`);
  }
  if (rawHeaders.length > MAX_COLUMNS) {
    throw new Error(`File exceeds maximum column count of ${MAX_COLUMNS}.`);
  }
  if (rawHeaders.length === 0) {
    throw new Error("No columns found in file.");
  }

  // Normalize headers
  const sanitizedHeaders = deduplicateHeaders(rawHeaders.map(normalizeHeader));

  const rowCount = rows.length;
  const columnCount = sanitizedHeaders.length;
  const piiWarnings: string[] = [];

  // Infer column metadata from sample
  const sampleForInference = rows.slice(0, TYPE_INFERENCE_SAMPLE);
  const columns: ColumnMeta[] = sanitizedHeaders.map((name, colIdx) => {
    const displayName = rawHeaders[colIdx] || name;
    const colValues = sampleForInference.map((r) => String(r[colIdx] ?? ""));
    const nonEmpty = colValues.filter((v) => v !== "");
    const nullRate = nonEmpty.length === 0 ? 1 : 1 - nonEmpty.length / colValues.length;

    let { type, isNumeric, isDate } = inferColumnType(nonEmpty.slice(0, TYPE_INFERENCE_SAMPLE));

    // Override: columns whose name signals an identifier should be strings, never numbers
    const ID_COLUMN_PATTERNS = /\b(number|num|id|code|zip|fips|loan|account|pool|servicer_ln)\b/i;
    if (isNumeric && (ID_COLUMN_PATTERNS.test(name) || ID_COLUMN_PATTERNS.test(displayName))) {
      type = "string";
      isNumeric = false;
    }

    // Unique value analysis for categorical detection
    const uniqueValues = [...new Set(colValues.filter(Boolean))];
    const isCategorical = type === "string" && uniqueValues.length <= 20 && uniqueValues.length >= 2;

    // Sample values (up to 5 non-null unique)
    const sampleValues = uniqueValues.slice(0, 5).map((v) => castValue(v, type));

    // Numeric min/max
    let minVal: number | string | undefined;
    let maxVal: number | string | undefined;
    if (isNumeric && nonEmpty.length > 0) {
      const nums = nonEmpty.map((v) => Number(v.replace(/[$,%,]/g, ""))).filter((n) => !isNaN(n));
      if (nums.length > 0) {
        minVal = Math.min(...nums);
        maxVal = Math.max(...nums);
      }
    } else if (isDate && nonEmpty.length > 0) {
      const sorted = [...nonEmpty].sort();
      minVal = sorted[0];
      maxVal = sorted[sorted.length - 1];
    }

    const nameMatchesPii = detectPii(displayName) || detectPii(name);
    const valueMatchedPiiLabel = !nameMatchesPii
      ? detectPiiInValues(sampleValues)
      : undefined;
    const isPotentialPii = nameMatchesPii || !!valueMatchedPiiLabel;

    if (nameMatchesPii) {
      piiWarnings.push(`Column "${displayName}" may contain sensitive personal information (matched by column name).`);
    } else if (valueMatchedPiiLabel) {
      piiWarnings.push(`Column "${displayName}" appears to contain ${valueMatchedPiiLabel} values — please review before sharing.`);
    }

    return {
      name,
      displayName,
      inferredType: type,
      nullRate: Math.round(nullRate * 1000) / 1000,
      sampleValues,
      isNumeric,
      isDate,
      isCategorical,
      uniqueCount: uniqueValues.length,
      minVal,
      maxVal,
      isPotentialPii,
    };
  });

  // Sample rows for preview (always stored, regardless of strategy)
  const sampleRows = rows.slice(0, SAMPLE_ROW_COUNT).map((row) => {
    const record: Record<string, any> = {};
    sanitizedHeaders.forEach((name, i) => {
      const col = columns[i];
      record[name] = castValue(String(row[i] ?? ""), col.inferredType);
    });
    return record;
  });

  // Quick insights for visualization suggestions
  const quickInsights = generateQuickInsights(columns);

  // Decide storage strategy
  const storageStrategy: StorageStrategy = rowCount <= CONTEXT_ROW_THRESHOLD ? "context" : "table";

  // Base name for both the filename record and the table name (if table strategy)
  const shortId = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const baseName = originalFileName
    .toLowerCase()
    .replace(/\.(csv|tsv|xlsx|xls)$/i, "")
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30) || "upload";
  const fileName = `${baseName}_${shortId}`;

  let dataJson: Record<string, any>[] | undefined;
  let tableName: string | undefined;

  if (storageStrategy === "context") {
    // For small files: serialize all rows
    dataJson = rows.map((row) => {
      const record: Record<string, any> = {};
      sanitizedHeaders.forEach((name, i) => {
        const col = columns[i];
        record[name] = castValue(String(row[i] ?? ""), col.inferredType);
      });
      return record;
    });
  } else {
    // For large files: create a temp table and COPY data in
    tableName = `upload_${shortId}_${baseName}`;
    await createUploadTable(tableName, columns, rows, sanitizedHeaders, tenantPool);
  }

  return {
    fileName,
    originalFileName,
    fileSizeBytes,
    rowCount,
    columnCount,
    columns,
    storageStrategy,
    tableName,
    dataJson,
    sampleRows,
    piiWarnings,
    quickInsights,
  };
}

// ============================================================================
// Temp table creation and bulk insert
// ============================================================================

async function createUploadTable(
  tableName: string,
  columns: ColumnMeta[],
  rows: string[][],
  sanitizedHeaders: string[],
  tenantPool: pg.Pool
): Promise<void> {
  // Build CREATE TABLE DDL
  const colDefs = columns.map((c) => `"${c.name}" ${pgType(c.inferredType)}`).join(",\n  ");
  const createSQL = `
    CREATE TABLE IF NOT EXISTS "${tableName}" (
      _row_id SERIAL PRIMARY KEY,
      ${colDefs}
    )
  `;

  const client = await tenantPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(createSQL);

    // Batch insert in chunks of 1000 rows
    const BATCH_SIZE = 1000;
    for (let start = 0; start < rows.length; start += BATCH_SIZE) {
      const batch = rows.slice(start, start + BATCH_SIZE);
      if (batch.length === 0) break;

      const placeholders: string[] = [];
      const values: any[] = [];
      let paramIdx = 1;

      for (const row of batch) {
        const rowPlaceholders = columns.map((col, ci) => {
          values.push(castValue(String(row[ci] ?? ""), col.inferredType));
          return `$${paramIdx++}`;
        });
        placeholders.push(`(${rowPlaceholders.join(", ")})`);
      }

      const quotedCols = sanitizedHeaders.map((h) => `"${h}"`).join(", ");
      const insertSQL = `INSERT INTO "${tableName}" (${quotedCols}) VALUES ${placeholders.join(", ")}`;
      await client.query(insertSQL, values);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================================
// Persist upload metadata to research_uploads
// ============================================================================

export async function saveUploadRecord(
  tenantId: string,
  userId: string,
  upload: ProcessedUpload,
  tenantPool: pg.Pool,
  sessionId?: string
): Promise<string> {
  const expiresAt = upload.storageStrategy === "table"
    ? new Date(Date.now() + UPLOAD_TTL_DAYS * 24 * 60 * 60 * 1000)
    : null;

  const result = await tenantPool.query(
    `INSERT INTO research_uploads (
      tenant_id, user_id, file_name, original_file_name,
      file_size_bytes, row_count, column_count, columns,
      storage_strategy, table_name, data_json, sample_rows,
      quick_insights, status, expires_at, session_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'ready',$14,$15)
    RETURNING id`,
    [
      tenantId,
      userId,
      upload.fileName,
      upload.originalFileName,
      upload.fileSizeBytes,
      upload.rowCount,
      upload.columnCount,
      JSON.stringify(upload.columns),
      upload.storageStrategy,
      upload.tableName || null,
      upload.dataJson ? JSON.stringify(upload.dataJson) : null,
      JSON.stringify(upload.sampleRows),
      JSON.stringify(upload.quickInsights),
      expiresAt,
      sessionId || null,
    ]
  );

  return result.rows[0].id as string;
}

// ============================================================================
// Drop upload table (cleanup)
// ============================================================================

export async function dropUploadTable(tableName: string, tenantPool: pg.Pool): Promise<void> {
  // tableName is server-generated (not user input) so safe to interpolate
  try {
    await tenantPool.query(`DROP TABLE IF EXISTS "${tableName}"`);
  } catch (err: any) {
    console.warn(`[UploadProcessor] Failed to drop upload table "${tableName}":`, err.message);
  }
}

// ============================================================================
// Load upload record
// ============================================================================

export async function loadUploadRecord(
  uploadId: string,
  tenantPool: pg.Pool
): Promise<(ProcessedUpload & { id: string; tenantId: string; userId: string; sessionId?: string }) | null> {
  const result = await tenantPool.query(
    `SELECT * FROM research_uploads WHERE id = $1 AND status != 'expired'`,
    [uploadId]
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    id: r.id,
    tenantId: r.tenant_id,
    userId: r.user_id,
    fileName: r.file_name,
    originalFileName: r.original_file_name,
    fileSizeBytes: r.file_size_bytes,
    rowCount: r.row_count,
    columnCount: r.column_count,
    columns: r.columns || [],
    storageStrategy: r.storage_strategy,
    tableName: r.table_name || undefined,
    dataJson: r.data_json || undefined,
    sampleRows: r.sample_rows || [],
    quickInsights: r.quick_insights || [],
    piiWarnings: [],
    sessionId: r.session_id || undefined,
  };
}

// ============================================================================
// Build LLM context string for context-strategy uploads
// ============================================================================

export function buildUploadContextString(
  upload: ProcessedUpload & { id: string; originalFileName: string },
  maxRows = 200
): string {
  const rows = upload.dataJson || upload.sampleRows;
  const displayRows = rows.slice(0, maxRows);

  let ctx = `\n## User-Uploaded Dataset (INLINE — analyze directly, do NOT query via SQL): "${upload.originalFileName}"\n`;
  ctx += `IMPORTANT: This dataset is embedded as structured JSON below. It is NOT stored in a database table.\n`;
  ctx += `Do NOT attempt any SELECT queries to find this data. Read and analyze the JSON rows below directly.\n`;
  ctx += `- Rows: ${upload.rowCount}, Columns: ${upload.columnCount}\n`;
  ctx += `- Upload ID: ${upload.id}\n\n`;

  ctx += `### Column Schema\n`;
  for (const col of upload.columns) {
    ctx += `- **${col.displayName}** (${col.name}): ${col.inferredType}`;
    if (col.isCategorical && col.sampleValues.length > 0) {
      ctx += ` [categories: ${col.sampleValues.slice(0, 8).join(", ")}]`;
    }
    if (col.description) ctx += ` — ${col.description}`;
    ctx += "\n";
  }

  // Render key columns as a compact markdown table for easy scanning
  const keyColumns = selectKeyColumns(upload.columns);
  ctx += `\n### Data (${displayRows.length} of ${upload.rowCount} rows)\n`;
  ctx += `Key columns shown in table; full row JSON follows.\n\n`;

  // Markdown table for key columns
  ctx += "| " + keyColumns.map((c) => c.displayName).join(" | ") + " |\n";
  ctx += "| " + keyColumns.map(() => "---").join(" | ") + " |\n";
  for (const row of displayRows) {
    ctx += "| " + keyColumns.map((c) => {
      const v = row[c.name];
      return v == null ? "" : String(v);
    }).join(" | ") + " |\n";
  }

  // Full row data as JSON array for precise parsing
  ctx += `\n### Full Row Data (JSON)\n`;
  ctx += "```json\n";
  ctx += JSON.stringify(displayRows, null, 0);
  ctx += "\n```\n";

  return ctx;
}

/**
 * Select up to 8 key columns for the compact markdown table preview.
 * Prioritizes identifier columns, then categorical/status columns, then numeric columns.
 */
function selectKeyColumns(columns: ColumnMeta[], max = 8): ColumnMeta[] {
  const idPatterns = /^(loan|id|number|name|account|borrower|servicer)/i;
  const statusPatterns = /^(status|delinquency|flag|type|investor|state)/i;

  const ids = columns.filter((c) => idPatterns.test(c.name) || idPatterns.test(c.displayName));
  const statuses = columns.filter((c) =>
    !ids.includes(c) && (statusPatterns.test(c.name) || statusPatterns.test(c.displayName) || c.isCategorical)
  );
  const numerics = columns.filter((c) =>
    !ids.includes(c) && !statuses.includes(c) && c.isNumeric
  );
  const rest = columns.filter((c) => !ids.includes(c) && !statuses.includes(c) && !numerics.includes(c));

  const selected = [...ids, ...statuses, ...numerics, ...rest];
  return selected.slice(0, max);
}

// ============================================================================
// Build schema context string for table-strategy uploads
// ============================================================================

export function buildUploadTableSchemaContext(
  upload: ProcessedUpload & { id: string; originalFileName: string }
): string {
  if (!upload.tableName) return "";

  let ctx = `\n## User-Uploaded Dataset Table: ${upload.tableName}\n`;
  ctx += `Source file: "${upload.originalFileName}" (${upload.rowCount.toLocaleString()} rows)\n`;
  ctx += `Upload ID: ${upload.id}\n`;
  ctx += `You can query this table with SELECT. The _row_id column is an auto-generated primary key.\n\n`;
  ctx += `Columns:\n`;
  for (const col of upload.columns) {
    ctx += `  ${col.name} (${pgType(col.inferredType)})`;
    if (col.description) ctx += ` — ${col.description}`;
    else if (col.isCategorical) ctx += ` [categorical; sample: ${col.sampleValues.slice(0, 5).join(", ")}]`;
    else if (col.isNumeric) ctx += ` [numeric; range: ${col.minVal ?? "?"} to ${col.maxVal ?? "?"}]`;
    else if (col.isDate) ctx += ` [date; range: ${col.minVal ?? "?"} to ${col.maxVal ?? "?"}]`;
    ctx += "\n";
  }

  return ctx;
}
