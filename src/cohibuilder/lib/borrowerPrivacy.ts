/**
 * Import KV table: mask given names (initial + bullets); last token is treated as surname and shown abbreviated (initial + period).
 * Example: "John Saunders" → "J••• S.", "Sarah & Mark Jenkins" → "S••• & M••• J."
 */
export function anonymizeImportKvPersonName(raw: string): string {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return '—';
  const parts = s.split(' ');
  if (parts.length === 1) {
    const w = parts[0]!;
    if (w.length <= 1) return w;
    return `${w[0]!}.`;
  }
  const last = parts[parts.length - 1]!;
  const givens = parts.slice(0, -1);
  const maskToken = (g: string) => {
    if (g === '&' || g === 'and') return g;
    if (g.length <= 1) return g;
    const n = Math.min(g.length - 1, 5);
    return g[0]! + '•'.repeat(n);
  };
  const gMasked = givens.map(maskToken).join(' ');
  const lastAbbrev = last.length <= 1 ? last : `${last[0]!}.`;
  return `${gMasked} ${lastAbbrev}`.trim();
}

/**
 * List / drilldown privacy: keep given names, show only the first letter of the surname and mask the rest.
 * Example: "David Miller" → "David M•••••", "Sarah & Mark Jenkins" → "Sarah & Mark J••••••"
 */
export function anonymizeBorrowerName(raw: string): string {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return '—';
  const parts = s.split(' ');
  if (parts.length === 1) {
    const w = parts[0]!;
    if (w.length <= 1) return w;
    return w[0] + '•'.repeat(w.length - 1);
  }
  const last = parts[parts.length - 1]!;
  const given = parts.slice(0, -1).join(' ');
  const masked = last.length <= 1 ? last : last[0] + '•'.repeat(last.length - 1);
  return `${given} ${masked}`;
}

/** List / avatar initials from given names only (first word), so we never surface a surname initial. */
export function borrowerGivenInitials(raw: string): string {
  const first = raw.replace(/\s+/g, ' ').trim().split(' ')[0] ?? '';
  if (!first) return '?';
  const u = first.toUpperCase();
  return u.length >= 2 ? u.slice(0, 2) : u.slice(0, 1);
}

/** "City, ST" for subtitles; tolerates missing pieces. */
export function formatCityState(city?: string, state?: string): string {
  const c = (city ?? '').trim();
  const st = (state ?? '').trim();
  if (c && st) return `${c}, ${st}`;
  if (st) return st;
  if (c) return c;
  return '—';
}

const DEMO_LOAN_OFFICER_NAMES = [
  'Jordan Kim',
  'Alex Carter',
  'Morgan Lee',
  'Riley Brooks',
  'Casey Nguyen',
  'Taylor Reed',
  'Jamie Walsh',
  'Drew Patel',
  'Sam Rivera',
  'Quinn Hayes',
] as const;

export type LoanOfficerDisplayInput = {
  id: number;
  loanOfficerName?: string | null;
  builderImportRow?: { BDM_Name?: string | null; TMName?: string | null } | null;
};

/** Masked LO label: given names + first letter of surname + bullets (same rules as borrowers). */
export function displayLoanOfficer(loan: LoanOfficerDisplayInput): string {
  const raw =
    (loan.loanOfficerName?.trim() ||
      loan.builderImportRow?.BDM_Name?.trim() ||
      loan.builderImportRow?.TMName?.trim() ||
      '') as string;
  if (raw) return anonymizeBorrowerName(raw);
  const fallback = DEMO_LOAN_OFFICER_NAMES[Math.abs(loan.id) % DEMO_LOAN_OFFICER_NAMES.length]!;
  return anonymizeBorrowerName(fallback);
}

/**
 * Builder ERP summary may be `BDM: <name or numeric id>` — mask person names, keep numeric IDs.
 */
export function formatErpBdmDisplayLine(erpSync: string | undefined, fallback = 'BuildPro'): string {
  const s = erpSync?.trim();
  if (!s) return fallback;
  const m = s.match(/^BDM:\s*(.+)$/i);
  if (!m) return s;
  const rest = m[1]!.trim();
  if (!rest || rest === '—') return 'BDM: —';
  if (/^\d+$/.test(rest)) return `BDM: ${rest}`;
  return `BDM: ${anonymizeBorrowerName(rest)}`;
}
