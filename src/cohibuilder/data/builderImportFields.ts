/**
 * Builder import schema: Toll agreement (red) vs Encompass-linked (blue).
 * Column names match expected CSV / API payloads.
 */

import { allLoans } from './mockData';

export type BuilderFieldSource = 'toll' | 'encompass';

export type BuilderImportFieldType = 'text' | 'number' | 'date' | 'textarea';

export interface BuilderImportFieldDef {
  id: string;
  label: string;
  meaning: string;
  source: BuilderFieldSource;
  type: BuilderImportFieldType;
}

export const BUILDER_IMPORT_FIELDS: BuilderImportFieldDef[] = [
  {
    id: 'Business_U',
    label: 'Business_U',
    meaning: 'Toll Business Unit identifier — first 4 digits community #, last 4 lot #.',
    source: 'toll',
    type: 'text',
  },
  {
    id: 'Business Unit',
    label: 'Business Unit',
    meaning: 'Populated when a linked loan record exists in Encompass.',
    source: 'encompass',
    type: 'text',
  },
  {
    id: 'Project Number',
    label: 'Project Number',
    meaning: 'Number identifier for the community.',
    source: 'toll',
    type: 'text',
  },
  {
    id: 'P_Name',
    label: 'P_Name',
    meaning: 'Community name.',
    source: 'toll',
    type: 'text',
  },
  {
    id: 'P_Div_VP',
    label: 'P_Div_VP',
    meaning: "Toll's Division VP.",
    source: 'toll',
    type: 'text',
  },
  {
    id: 'BDM_Num',
    label: 'BDM_Num',
    meaning: 'Business Development Manager user id.',
    source: 'toll',
    type: 'text',
  },
  {
    id: 'BDM_Name',
    label: 'BDM_Name',
    meaning: "BDM's name.",
    source: 'toll',
    type: 'text',
  },
  {
    id: 'MLS_Num',
    label: 'MLS_Num',
    meaning: 'LO user id.',
    source: 'toll',
    type: 'text',
  },
  {
    id: 'Buyer_Name',
    label: 'Buyer_Name',
    meaning: "Buyer's name.",
    source: 'toll',
    type: 'text',
  },
  {
    id: 'AGR_DTE_T',
    label: 'AGR_DTE_T',
    meaning: 'Home contract agreement date.',
    source: 'toll',
    type: 'date',
  },
  {
    id: 'Cancdt_2',
    label: 'Cancdt_2',
    meaning: 'Date populated if the loan has been canceled.',
    source: 'toll',
    type: 'date',
  },
  {
    id: 'Loanno',
    label: 'Loanno',
    meaning: 'Loan number when linked in Encompass.',
    source: 'encompass',
    type: 'text',
  },
  {
    id: 'TBI_State',
    label: 'TBI_State',
    meaning: 'Property state.',
    source: 'toll',
    type: 'text',
  },
  {
    id: 'TotalIncentive',
    label: 'TotalIncentive',
    meaning: 'Incentive amount from Toll.',
    source: 'toll',
    type: 'number',
  },
  {
    id: 'Loan_Type',
    label: 'Loan_Type',
    meaning: 'Loan type used by Toll (TRU Cash = cash buyer).',
    source: 'toll',
    type: 'text',
  },
  {
    id: 'TMName',
    label: 'TMName',
    meaning: "LO's team manager id.",
    source: 'toll',
    type: 'text',
  },
  {
    id: 'PRJ_STL_D',
    label: 'PRJ_STL_D',
    meaning: "Toll's projected closing date.",
    source: 'toll',
    type: 'date',
  },
  {
    id: 'Origination_Status',
    label: 'Origination_Status',
    meaning: 'Encompass origination status.',
    source: 'encompass',
    type: 'text',
  },
  {
    id: 'REF_LOAN_IND',
    label: 'REF_LOAN_IND',
    meaning: 'Referred loan indicator.',
    source: 'encompass',
    type: 'text',
  },
  {
    id: 'LOCKED',
    label: 'LOCKED',
    meaning: 'Lock date when the loan is locked.',
    source: 'encompass',
    type: 'date',
  },
  {
    id: 'APP_DATE',
    label: 'APP_DATE',
    meaning: 'Loan application date.',
    source: 'encompass',
    type: 'date',
  },
  {
    id: 'LoanAmount',
    label: 'LoanAmount',
    meaning: 'Loan amount.',
    source: 'encompass',
    type: 'number',
  },
  {
    id: 'Capture_Indicator',
    label: 'Capture_Indicator',
    meaning: "BDM's expectation whether the loan will be captured.",
    source: 'toll',
    type: 'text',
  },
  {
    id: 'Capture_Lost_Reason',
    label: 'Capture_Lost_Reason',
    meaning: 'Category when not capturing.',
    source: 'toll',
    type: 'text',
  },
  {
    id: 'Capture_Lost_Cmnt_By',
    label: 'Capture_Lost_Cmnt_By',
    meaning: 'Who entered the lost-capture comment.',
    source: 'toll',
    type: 'text',
  },
  {
    id: 'Capture_Lost_Comment',
    label: 'Capture_Lost_Comment',
    meaning: 'Comment explaining why the loan was not captured.',
    source: 'toll',
    type: 'textarea',
  },
  {
    id: 'External_Lender',
    label: 'External_Lender',
    meaning:
      'Optional: third-party lender / bank when the borrower did not use TB Mortgage. If blank, the UI may infer the name from Capture_Lost_Comment (e.g. “Borrower selected …”).',
    source: 'toll',
    type: 'text',
  },
];

export const BUILDER_IMPORT_CSV_HEADER = BUILDER_IMPORT_FIELDS.map((f) => f.id).join(',');

/** Escape CSV cell (quotes, commas, newlines). */
function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export type BuilderImportRow = Record<string, string>;

export function emptyBuilderImportRow(): BuilderImportRow {
  const row: BuilderImportRow = {};
  for (const f of BUILDER_IMPORT_FIELDS) row[f.id] = '';
  return row;
}

/** Matches `allLoans` length in mockData (8 seeded + 242 generated). */
export const BUILDER_IMPORT_SAMPLE_SIZE = 250;

function communityFromAddress(address: string): string {
  const m = address.match(/Toll Brothers at (.+)$/i);
  return m ? m[1].trim() : '';
}

function isoDateFromSeed(id: number, offsetDays: number): string {
  const base = new Date(Date.UTC(2025, 0, 15));
  base.setUTCDate(base.getUTCDate() + (id % 90) + offsetDays);
  return base.toISOString().slice(0, 10);
}

function statusToEncompass(status: string): string {
  const map: Record<string, string> = {
    Permitting: 'Loan setup',
    Foundation: 'Processing — CTC pending',
    Framing: 'Processing',
    Drywall: 'Underwriting',
    Finishing: 'Clear to close',
  };
  return map[status] ?? 'Processing';
}

/** One import row per dashboard demo loan (same order as `allLoans`). */
export function mapLoanToBuilderImportRow(loan: (typeof allLoans)[number]): BuilderImportRow {
  const row = emptyBuilderImportRow();
  const id = loan.id;
  const community = communityFromAddress(loan.address);
  const incentiveVal =
    'incentives' in loan && loan.incentives && typeof loan.incentives === 'object' && 'value' in loan.incentives
      ? Number((loan.incentives as { value: number }).value)
      : 5000 + (id % 20) * 500;

  row.Business_U = `${String(1000 + ((id * 37) % 9000)).padStart(4, '0')}${String(1000 + (id % 9000)).padStart(4, '0')}`;
  row['Business Unit'] = `${loan.state} Metro`;
  row['Project Number'] = `PRJ-${String(id).padStart(4, '0')}`;
  row.P_Name = community || `Toll Brothers at ${loan.city}`;
  row.P_Div_VP = ['J. Morrison', 'K. Walsh', 'R. Patel'][id % 3];
  row.BDM_Num = `BDM-${4400 + (id % 200)}`;
  row.BDM_Name = ['Alex Chen', 'Jordan Lee', 'Sam Rivera'][id % 3];
  row.MLS_Num = `LO-${9000 + (id % 500)}`;
  row.Buyer_Name = loan.borrower;
  row.AGR_DTE_T = isoDateFromSeed(id, 1);
  row.Cancdt_2 = '';
  row.Loanno = String(1204589000 + id);
  row.TBI_State = loan.state;
  row.TotalIncentive = String(incentiveVal);
  row.Loan_Type = loan.lender.includes('Cash')
    ? 'TRU Cash'
    : id % 2 === 0
      ? 'Conventional 30yr fixed'
      : 'FHA 30yr fixed';
  row.TMName = `TM-${770 + (id % 40)}`;
  row.PRJ_STL_D = isoDateFromSeed(id, 180);
  row.Origination_Status = statusToEncompass(loan.status);
  row.REF_LOAN_IND = id % 7 === 0 ? 'Y' : 'N';
  row.LOCKED = isoDateFromSeed(id, 45);
  row.APP_DATE = isoDateFromSeed(id, 14);
  row.LoanAmount = String(loan.loanAmount);
  row.Capture_Indicator = loan.isPreferred ? 'Y' : 'N';
  if (loan.isPreferred) {
    row.Capture_Lost_Reason = '';
    row.Capture_Lost_Cmnt_By = '';
    row.Capture_Lost_Comment = '';
  } else {
    row.Capture_Lost_Reason = 'External lender';
    row.Capture_Lost_Cmnt_By = 'System';
    const shortLender = loan.lender.split('(')[0].trim();
    row.External_Lender = shortLender;
    row.Capture_Lost_Comment = `Borrower selected ${shortLender}`;
  }
  return row;
}

export function getBuilderImportSampleRows(): BuilderImportRow[] {
  return allLoans.slice(0, BUILDER_IMPORT_SAMPLE_SIZE).map(mapLoanToBuilderImportRow);
}

/** Header + one empty data row (column guide only). */
export function buildBuilderImportCsvTemplate(): string {
  const header = BUILDER_IMPORT_FIELDS.map((f) => escapeCsvCell(f.id)).join(',');
  const exampleRow = BUILDER_IMPORT_FIELDS.map(() => '').join(',');
  return `${header}\r\n${exampleRow}\r\n`;
}

export function buildBuilderImportCsvFromRows(rows: BuilderImportRow[]): string {
  const header = BUILDER_IMPORT_FIELDS.map((f) => escapeCsvCell(f.id)).join(',');
  const body = rows
    .map((r) => BUILDER_IMPORT_FIELDS.map((f) => escapeCsvCell(r[f.id] ?? '')).join(','))
    .join('\r\n');
  return `${header}\r\n${body}\r\n`;
}

export function downloadBuilderImportTemplate(options?: { empty?: boolean }) {
  const csv = options?.empty
    ? buildBuilderImportCsvTemplate()
    : buildBuilderImportCsvFromRows(getBuilderImportSampleRows());
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = options?.empty
    ? 'cohi-builder-import-template-empty.csv'
    : 'cohi-builder-import-sample-250.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/** Same columns as CSV. Default file includes 250 rows aligned with dashboard demo loans. */
export async function downloadBuilderImportTemplateXlsx(options?: { empty?: boolean }) {
  const XLSX = await import('xlsx');
  const header = BUILDER_IMPORT_FIELDS.map((f) => f.id);
  const dataRows = options?.empty
    ? [BUILDER_IMPORT_FIELDS.map(() => '')]
    : getBuilderImportSampleRows().map((r) => BUILDER_IMPORT_FIELDS.map((f) => r[f.id] ?? ''));
  const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Builder import');
  XLSX.writeFile(
    wb,
    options?.empty ? 'cohi-builder-import-template-empty.xlsx' : 'cohi-builder-import-sample-250.xlsx'
  );
}

/** Sample row for UI demo search (not real data). */
export function getDemoBuilderImportRow(): BuilderImportRow {
  return {
    ...emptyBuilderImportRow(),
    Business_U: '10010245',
    'Business Unit': 'NJ Metro',
    'Project Number': 'PRJ-8841',
    P_Name: 'Pine Valley at Maple Hills',
    P_Div_VP: 'J. Morrison',
    BDM_Num: 'BDM-4412',
    BDM_Name: 'Alex Chen',
    MLS_Num: 'LO-9081',
    Buyer_Name: 'Maria Garcia & Jordan Lee',
    AGR_DTE_T: '2025-02-14',
    Cancdt_2: '',
    Loanno: '1204589123',
    TBI_State: 'NJ',
    TotalIncentive: '15000',
    Loan_Type: 'Conventional 30yr fixed',
    TMName: 'TM-772',
    PRJ_STL_D: '2025-09-30',
    Origination_Status: 'Processing — CTC pending',
    REF_LOAN_IND: 'N',
    LOCKED: '2025-03-01',
    APP_DATE: '2025-02-20',
    LoanAmount: '685000',
    Capture_Indicator: 'Y',
    Capture_Lost_Reason: '',
    Capture_Lost_Cmnt_By: '',
    Capture_Lost_Comment: '',
  };
}

const STORAGE_KEY = 'cohi:builder-import-rows';

export function loadBuilderImportRows(): BuilderImportRow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as BuilderImportRow[]) : [];
  } catch {
    return [];
  }
}

export function saveBuilderImportRow(row: BuilderImportRow) {
  const next = [...loadBuilderImportRows(), row];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function clearBuilderImportRows() {
  localStorage.removeItem(STORAGE_KEY);
}

export function replaceBuilderImportRows(rows: BuilderImportRow[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

/** Optional metadata when replacing portfolio rows (file uploads, restores, etc.). */
export type ApplyImportMode = 'replace' | 'merge_new';

export type ApplyImportMeta = {
  fileName?: string;
  sourceLabel?: string;
  /** Store a restorable copy for “Upload history” (defaults true when `fileName` is set). */
  persistSnapshot?: boolean;
  /**
   * `replace` (default): incoming rows become the full portfolio.
   * `merge_new`: keep existing rows; append only incoming rows whose dedup key is not already present.
   */
  mode?: ApplyImportMode;
};

export type ApplyImportResult = {
  saved: boolean;
  merge?: { added: number; skippedDuplicate: number; incomingCount: number; finalRowCount: number };
};

function normImportCell(v: string | undefined): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Stable key for reconciling uploads against the in-app portfolio.
 * Prefer Encompass `Loanno` when present; otherwise a composite of Toll agreement fields from the export.
 */
export function builderImportRowDedupKey(row: BuilderImportRow): string {
  const lo = normImportCell(row.Loanno);
  if (lo.length > 0) return `loanno:${lo}`;
  const parts = [
    normImportCell(row.Buyer_Name),
    normImportCell(row.P_Name),
    normImportCell(row.AGR_DTE_T),
    normImportCell(row['Project Number']),
    normImportCell(row.Business_U),
  ];
  const joined = parts.join('|');
  if (joined.replace(/\|/g, '').length > 0) return `comp:${joined}`;
  const fallback = BUILDER_IMPORT_FIELDS.map((f) => normImportCell(row[f.id])).filter(Boolean).join('¦');
  return fallback.length > 0 ? `fb:${fallback}` : `empty:${Math.random().toString(36).slice(2, 11)}`;
}

export function reconcileMergeBuilderImportRows(
  existing: BuilderImportRow[],
  incoming: BuilderImportRow[],
): { merged: BuilderImportRow[]; added: number; skippedDuplicate: number } {
  const keys = new Set<string>();
  for (const r of existing) {
    keys.add(builderImportRowDedupKey(r));
  }
  const merged = [...existing];
  let added = 0;
  let skippedDuplicate = 0;
  for (const row of incoming) {
    const k = builderImportRowDedupKey(row);
    if (keys.has(k)) {
      skippedDuplicate += 1;
      continue;
    }
    keys.add(k);
    merged.push(row);
    added += 1;
  }
  return { merged, added, skippedDuplicate };
}

/**
 * Fingerprint of a full import for upload-history dedupe (sorted row keys + count).
 * Same logical file content → same signature.
 */
export function builderImportRowsContentSignature(rows: BuilderImportRow[]): string {
  if (rows.length === 0) return '0:empty';
  const keys = rows.map(builderImportRowDedupKey).sort();
  let h = 2166136261;
  for (const k of keys) {
    for (let i = 0; i < k.length; i++) {
      h ^= k.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x9e3779b9;
  }
  return `${rows.length}:${(h >>> 0).toString(16)}`;
}

export type BuilderImportHistoryEvent = {
  id: string;
  /** ISO timestamp */
  savedAt: string;
  rowCount: number;
  fileName?: string;
  sourceLabel: string;
  canRestoreFromSnapshot: boolean;
  /** Present on new events; used to collapse duplicate loads in history. */
  contentSignature?: string;
};

const IMPORT_HISTORY_KEY = 'cohi:builder-import-history-v1';
const IMPORT_SNAPSHOT_PREFIX = 'cohi:builder-import-snap:';
const MAX_IMPORT_HISTORY = 40;
const MAX_IMPORT_SNAPSHOTS = 5;

export function loadImportHistory(): BuilderImportHistoryEvent[] {
  try {
    const raw = localStorage.getItem(IMPORT_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const list = parsed.filter(
      (e): e is BuilderImportHistoryEvent =>
        e &&
        typeof e === 'object' &&
        typeof (e as BuilderImportHistoryEvent).id === 'string' &&
        typeof (e as BuilderImportHistoryEvent).savedAt === 'string',
    );
    const seenSig = new Set<string>();
    const out: BuilderImportHistoryEvent[] = [];
    for (const e of list) {
      const sig = typeof e.contentSignature === 'string' ? e.contentSignature : '';
      if (sig) {
        if (seenSig.has(sig)) continue;
        seenSig.add(sig);
      }
      out.push(e);
    }
    return out;
  } catch {
    return [];
  }
}

export function getImportHistorySnapshot(id: string): BuilderImportRow[] | null {
  try {
    const raw = localStorage.getItem(IMPORT_SNAPSHOT_PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as BuilderImportRow[]) : null;
  } catch {
    return null;
  }
}

function pruneImportSnapshots(allowedIds: Set<string>) {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(IMPORT_SNAPSHOT_PREFIX)) keys.push(k);
  }
  for (const k of keys) {
    const id = k.slice(IMPORT_SNAPSHOT_PREFIX.length);
    if (!allowedIds.has(id)) localStorage.removeItem(k);
  }
}

/**
 * Append a portfolio load event (timestamp + source). Optionally persists rows for later restore.
 * Call after successful `replaceBuilderImportRows` from user-driven actions.
 */
export function recordBuilderImportEvent(opts: {
  rows: BuilderImportRow[];
  fileName?: string;
  sourceLabel: string;
  persistSnapshot?: boolean;
}): void {
  const contentSignature = builderImportRowsContentSignature(opts.rows);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const savedAt = new Date().toISOString();
  const wantSnapshot =
    opts.rows.length > 0 &&
    (opts.persistSnapshot === true ||
      (opts.persistSnapshot === undefined && Boolean(opts.fileName)));

  let canRestoreFromSnapshot = false;
  if (wantSnapshot) {
    try {
      localStorage.setItem(IMPORT_SNAPSHOT_PREFIX + id, JSON.stringify(opts.rows));
      canRestoreFromSnapshot = true;
    } catch {
      canRestoreFromSnapshot = false;
    }
  }

  /** Drop older history rows with the same content so re-imports refresh one slot instead of stacking. */
  const prev = loadImportHistory().filter((e) => e.contentSignature !== contentSignature);
  const next: BuilderImportHistoryEvent[] = [
    {
      id,
      savedAt,
      rowCount: opts.rows.length,
      fileName: opts.fileName,
      sourceLabel: opts.sourceLabel,
      canRestoreFromSnapshot,
      contentSignature,
    },
    ...prev,
  ].slice(0, MAX_IMPORT_HISTORY);

  localStorage.setItem(IMPORT_HISTORY_KEY, JSON.stringify(next));

  const allowed = new Set(
    next.filter((e) => e.canRestoreFromSnapshot).slice(0, MAX_IMPORT_SNAPSHOTS).map((e) => e.id),
  );
  pruneImportSnapshots(allowed);
}

export function appendBuilderImportRows(rows: BuilderImportRow[]) {
  if (rows.length === 0) return;
  const existing = loadBuilderImportRows();
  const { merged } = reconcileMergeBuilderImportRows(existing, rows);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
}

function normalizeHeaderKey(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Map common spreadsheet labels (Toll backlog / Encompass exports) → `BUILDER_IMPORT_FIELDS` id. */
const IMPORT_HEADER_ALIASES: Record<string, string> = {
  'buyer name': 'Buyer_Name',
  buyer: 'Buyer_Name',
  'buyer_name': 'Buyer_Name',
  community: 'P_Name',
  'community name': 'P_Name',
  'project name': 'P_Name',
  'p name': 'P_Name',
  'division vp': 'P_Div_VP',
  'loan number': 'Loanno',
  'loan no': 'Loanno',
  'loan #': 'Loanno',
  'loan amount': 'LoanAmount',
  amount: 'LoanAmount',
  state: 'TBI_State',
  st: 'TBI_State',
  'tbi state': 'TBI_State',
  'agreement date': 'AGR_DTE_T',
  'contract date': 'AGR_DTE_T',
  'agr date': 'AGR_DTE_T',
  'projected close': 'PRJ_STL_D',
  'projected closing': 'PRJ_STL_D',
  'proj close': 'PRJ_STL_D',
  'stl date': 'PRJ_STL_D',
  'app date': 'APP_DATE',
  'application date': 'APP_DATE',
  'lock date': 'LOCKED',
  locked: 'LOCKED',
  'capture ind': 'Capture_Indicator',
  'capture indicator': 'Capture_Indicator',
  'capture?': 'Capture_Indicator',
  'lost reason': 'Capture_Lost_Reason',
  'lost comment': 'Capture_Lost_Comment',
  'external lender': 'External_Lender',
  'external lender name': 'External_Lender',
  'selected lender': 'External_Lender',
  'outside lender': 'External_Lender',
  'ext lender': 'External_Lender',
  'business unit': 'Business Unit',
  'business_u': 'Business_U',
  'business u': 'Business_U',
  'project #': 'Project Number',
  'project number': 'Project Number',
  'bdm name': 'BDM_Name',
  'bdm num': 'BDM_Num',
  'mls num': 'MLS_Num',
  'lo id': 'MLS_Num',
  incentive: 'TotalIncentive',
  'total incentive': 'TotalIncentive',
  'loan type': 'Loan_Type',
  'tm name': 'TMName',
  'orig status': 'Origination_Status',
  'origination status': 'Origination_Status',
  'milestone status': 'Origination_Status',
  'ref loan': 'REF_LOAN_IND',
  cancel: 'Cancdt_2',
  'cancel date': 'Cancdt_2',
  /** Toll backlog export column names */
  busunit: 'Business Unit',
  'project nu': 'Project Number',
  project_nu: 'Project Number',
};

function resolveImportHeaderToFieldId(headerCell: string): string | null {
  const raw = normalizeHeaderKey(String(headerCell ?? ''));
  if (!raw) return null;
  const alias = IMPORT_HEADER_ALIASES[raw];
  if (alias) return alias;
  for (const f of BUILDER_IMPORT_FIELDS) {
    const idNorm = normalizeHeaderKey(f.id);
    if (idNorm === raw) return f.id;
    const spaced = normalizeHeaderKey(f.id.replace(/_/g, ' '));
    if (spaced === raw) return f.id;
    const underscored = raw.replace(/\s+/g, '_');
    if (normalizeHeaderKey(f.id).replace(/\s+/g, '_') === underscored) return f.id;
  }
  return null;
}

function buildHeaderColumnIndex(header: string[]): Map<string, number> {
  const map = new Map<string, number>();
  header.forEach((cell, i) => {
    const fid = resolveImportHeaderToFieldId(String(cell ?? ''));
    if (fid) map.set(normalizeHeaderKey(fid), i);
  });
  return map;
}

function isMatrixRowEmpty(line: unknown[]): boolean {
  return line.every((c) => c === '' || c === null || c === undefined);
}

function cellToImportString(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell).trim();
}

/**
 * Parse .csv / .xlsx / .xls using SheetJS (same column names as template).
 */
export async function parseBuilderImportFile(file: File): Promise<{ rows: BuilderImportRow[]; error?: string }> {
  const name = file.name.toLowerCase();
  if (!name.endsWith('.csv') && !name.endsWith('.xlsx') && !name.endsWith('.xls')) {
    return { rows: [], error: 'Please use a .csv, .xlsx, or .xls file.' };
  }
  try {
    const XLSX = await import('xlsx');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const tryParseMatrix = (matrix: unknown[][]) => {
      if (!matrix.length) return { rows: [] as BuilderImportRow[], colIndex: new Map<string, number>() };
      const header = (matrix[0] as unknown[]).map((h) => String(h ?? '').trim());
      const colIndex = buildHeaderColumnIndex(header);
      const rows: BuilderImportRow[] = [];
      for (let r = 1; r < matrix.length; r++) {
        const line = matrix[r] as unknown[];
        if (!line || isMatrixRowEmpty(line)) continue;
        const row = emptyBuilderImportRow();
        for (const f of BUILDER_IMPORT_FIELDS) {
          const idx = colIndex.get(normalizeHeaderKey(f.id));
          if (idx === undefined) continue;
          row[f.id] = cellToImportString(line[idx]);
        }
        rows.push(row);
      }
      return { rows, colIndex };
    };

    let bestMatrix: unknown[][] = [];
    let bestScore = -1;
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;
      const m = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        defval: '',
        raw: false,
      }) as unknown[][];
      const { rows: trialRows, colIndex: trialIdx } = tryParseMatrix(m);
      const score = trialIdx.size * 10_000 + trialRows.length;
      if (score > bestScore) {
        bestScore = score;
        bestMatrix = m;
      }
    }
    if (!bestMatrix.length) return { rows: [], error: 'The file is empty.' };

    const { rows, colIndex } = tryParseMatrix(bestMatrix);
    if (colIndex.size === 0) {
      return {
        rows: [],
        error:
          'No recognized columns. Export should include fields like Buyer_Name, P_Name, LoanAmount, TBI_State, Origination_Status (or use the downloadable template).',
      };
    }

    if (rows.length === 0) return { rows: [], error: 'No data rows found below the header.' };
    return { rows };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : 'Could not read the file.' };
  }
}
