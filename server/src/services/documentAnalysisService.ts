/**
 * Document Analysis Service
 * Parses CSV, Excel, PDF, DOCX, PPTX and produces structured analysis, insights, and visualization configs.
 */

import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { parseDocument } from './documentParser.js';
import type { VisualizationConfig } from './ai/dataChatService.js';
import * as path from 'path';

export interface DocumentAnalysisResult {
  analysis: string;
  summary: string;
  visualization?: VisualizationConfig;
  /** Tabular data for charts/tables (CSV/Excel) */
  rows?: Record<string, unknown>[];
  columns?: string[];
  /** Extracted text (PDF, DOCX, PPTX) */
  extractedText?: string;
  insights: string[];
  suggestedCharts?: { type: VisualizationConfig['type']; reason: string }[];
}

const ALLOWED_MIMES = [
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
];

const ALLOWED_EXT = ['.csv', '.xlsx', '.xls', '.pdf', '.pptx', '.ppt', '.docx', '.doc'];

function isAllowedFile(name: string, mimetype: string): boolean {
  const ext = path.extname(name).toLowerCase();
  if (ALLOWED_EXT.includes(ext)) return true;
  if (ALLOWED_MIMES.includes(mimetype?.toLowerCase())) return true;
  return false;
}

function inferNumericColumns(rows: Record<string, unknown>[], columns: string[]): string[] {
  if (!rows.length) return [];
  const numeric: string[] = [];
  for (const col of columns) {
    const val = rows[0][col];
    if (val !== null && val !== undefined && val !== '') {
      const n = Number(val);
      if (!Number.isNaN(n) && typeof val !== 'object') numeric.push(col);
      else if (typeof val === 'number') numeric.push(col);
    }
  }
  return numeric;
}

function suggestCharts(columns: string[], rows: Record<string, unknown>[], numericCols: string[]): { type: VisualizationConfig['type']; reason: string }[] {
  const suggestions: { type: VisualizationConfig['type']; reason: string }[] = [];
  if (rows.length === 0) return suggestions;
  if (numericCols.length >= 1 && columns.length >= 2) {
    suggestions.push({ type: 'bar', reason: 'Compare values across categories' });
    suggestions.push({ type: 'line', reason: 'Show trends over time or sequence' });
  }
  if (numericCols.length === 1 && columns.length >= 2)
    suggestions.push({ type: 'pie', reason: 'Show composition or share' });
  if (rows.length > 0 && (numericCols.length >= 1 || columns.some(c => typeof rows[0][c] === 'number')))
    suggestions.push({ type: 'table', reason: 'View all data in a table' });
  return suggestions;
}

function buildTableVisualization(
  rows: Record<string, unknown>[],
  columns: string[],
  title: string
): VisualizationConfig {
  return {
    type: 'table',
    title,
    data: rows.slice(0, 100),
    tableConfig: {
      columns: columns.map((key) => ({ key, label: key, format: 'text' as const })),
      sortable: true,
      pageSize: 10,
    },
  };
}

/** Parse CSV buffer to rows and columns */
function parseCSVBuffer(buffer: Buffer): { rows: Record<string, string>[]; columns: string[] } {
  let text = buffer.toString('utf-8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  const rows = result.data || [];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : (result.meta?.fields || []);
  return { rows, columns };
}

/** Parse Excel buffer to rows and columns (first sheet) */
function parseExcelBuffer(buffer: Buffer): { rows: Record<string, unknown>[]; columns: string[] } {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return { rows: [], columns: [] };
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { rows, columns };
}

/** Analyze tabular data (CSV/Excel) and return analysis + insights + visualization */
export function analyzeTabularDocument(
  buffer: Buffer,
  fileName: string,
  question?: string
): DocumentAnalysisResult {
  const ext = path.extname(fileName).toLowerCase();
  const isCsv = ext === '.csv' || fileName.toLowerCase().endsWith('.csv');
  let rows: Record<string, unknown>[];
  let columns: string[];

  if (isCsv) {
    const parsed = parseCSVBuffer(buffer as Buffer);
    rows = parsed.rows as Record<string, unknown>[];
    columns = parsed.columns;
  } else {
    const parsed = parseExcelBuffer(buffer);
    rows = parsed.rows;
    columns = parsed.columns;
  }

  const rowCount = rows.length;
  const colCount = columns.length;
  const numericCols = inferNumericColumns(rows, columns);
  const sample = rows.slice(0, 10);
  const suggestedCharts = suggestCharts(columns, rows, numericCols);

  let analysis = `**${fileName}**\n\n`;
  analysis += `- **Rows:** ${rowCount}\n`;
  analysis += `- **Columns:** ${colCount} (${columns.join(', ')})\n`;
  if (numericCols.length) analysis += `- **Numeric columns:** ${numericCols.join(', ')}\n`;
  analysis += `\n**Sample (first ${sample.length} rows):**\n`;
  analysis += columns.join(' | ') + '\n';
  analysis += columns.map(() => '---').join(' | ') + '\n';
  for (const row of sample) {
    analysis += columns.map((c) => String(row[c] ?? '').slice(0, 40)).join(' | ') + '\n';
  }

  const summary = `${fileName}: ${rowCount} rows, ${colCount} columns (${columns.join(', ')}).`;
  const insights: string[] = [
    `Dataset has ${rowCount} records and ${colCount} fields.`,
    numericCols.length ? `Numeric fields (${numericCols.join(', ')}) are suitable for charts.` : 'Consider summarizing key columns for insights.',
  ];
  if (suggestedCharts.length) {
    insights.push(`Suggested views: ${suggestedCharts.map((s) => s.type).join(', ')}.`);
  }

  const visualization = rowCount > 0 && colCount > 0
    ? buildTableVisualization(rows.slice(0, 500), columns, `Data: ${fileName}`)
    : undefined;

  return {
    analysis,
    summary,
    visualization,
    rows,
    columns,
    insights,
    suggestedCharts,
  };
}

/** Analyze text document (PDF, DOCX) and return summary + insights */
export async function analyzeTextDocument(
  buffer: Buffer,
  fileName: string,
  _question?: string
): Promise<DocumentAnalysisResult> {
  const parsed = await parseDocument(buffer, fileName);
  const text = parsed.text.trim();
  const wordCount = parsed.metadata.wordCount ?? text.split(/\s+/).filter(Boolean).length;
  const preview = text.slice(0, 3000);
  if (text.length > 3000) {
    parsed.text = text; // keep full for reference
  }

  let analysis = `**${fileName}**\n\n`;
  analysis += `- **Words:** ~${wordCount}\n`;
  if (parsed.metadata.pageCount) analysis += `- **Pages:** ${parsed.metadata.pageCount}\n`;
  analysis += `\n**Extract:**\n${preview}${text.length > 3000 ? '\n\n…' : ''}\n`;

  const summary = `${fileName}: ~${wordCount} words${parsed.metadata.pageCount ? `, ${parsed.metadata.pageCount} pages` : ''}.`;
  const insights: string[] = [
    `Document has ~${wordCount} words.`,
    'Use "Ask" to query this content or request a summary.',
  ];

  return {
    analysis,
    summary,
    extractedText: text,
    insights,
  };
}

/** Analyze PPTX: extract text from slide XML (PPTX is ZIP + XML) */
export async function analyzePPTXBuffer(buffer: Buffer, fileName: string): Promise<DocumentAnalysisResult> {
  let text = '';
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buffer);
    const slideFiles = Object.keys(zip.files).filter((f) => /ppt[/\\]slides[/\\]slide\d+\.xml$/i.test(f));
    for (const f of slideFiles.sort()) {
      const entry = zip.files[f];
      if (entry && !entry.dir) {
        const xml = await entry.async('string');
        const t = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (t) text += t + '\n\n';
      }
    }
  } catch {
    text = '(Could not extract text from presentation.)';
  }
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const preview = text.slice(0, 3000);
  let analysis = `**${fileName}**\n\n`;
  analysis += `- **Words (extracted):** ~${wordCount}\n`;
  analysis += `\n**Extract:**\n${preview}${text.length > 3000 ? '\n\n…' : ''}\n`;
  const summary = `${fileName}: ~${wordCount} words extracted from slides.`;
  const insights: string[] = [
    `Presentation has ~${wordCount} words across slides.`,
    'Use "Ask" to summarize or query this content.',
  ];
  return { analysis, summary, extractedText: text, insights };
}

/**
 * Analyze an uploaded document (CSV, Excel, PDF, DOCX, PPTX) and return analysis, insights, and optional visualization.
 */
export async function analyzeDocument(
  buffer: Buffer,
  fileName: string,
  mimetype: string,
  question?: string
): Promise<DocumentAnalysisResult> {
  if (!isAllowedFile(fileName, mimetype)) {
    throw new Error(
      `Unsupported file. Allowed: ${ALLOWED_EXT.join(', ')} (CSV, Excel, PDF, PPT, Word).`
    );
  }

  const ext = path.extname(fileName).toLowerCase();

  // Tabular
  if (ext === '.csv' || mimetype === 'text/csv') {
    return analyzeTabularDocument(buffer, fileName, question);
  }
  if (['.xlsx', '.xls'].includes(ext) || mimetype?.includes('spreadsheet') || mimetype?.includes('excel')) {
    return analyzeTabularDocument(buffer, fileName, question);
  }

  // PPTX
  if (ext === '.pptx' || ext === '.ppt' || mimetype?.includes('presentation') || mimetype?.includes('powerpoint')) {
    return analyzePPTXBuffer(buffer, fileName);
  }

  // PDF, DOCX
  if (
    ext === '.pdf' ||
    ext === '.docx' ||
    ext === '.doc' ||
    mimetype === 'application/pdf' ||
    mimetype?.includes('wordprocessing') ||
    mimetype?.includes('msword')
  ) {
    return analyzeTextDocument(buffer, fileName, question);
  }

  throw new Error(`Unsupported file type: ${fileName}`);
}
