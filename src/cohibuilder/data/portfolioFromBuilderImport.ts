/**
 * Synthesize Capture Analysis portfolio objects from Toll / Encompass builder import rows.
 * Fills UI-required fields not present in the spreadsheet with deterministic demo defaults.
 */

import { TOLL_BROTHERS_LISTING_IMAGES } from './tollBrothersOfficialMedia';
import type { BuilderImportRow } from './builderImportFields';
import { externalLenderFromImportRow } from '../lib/externalLenderFromRow';
import { tollBrotherBacklogImportRows } from './tollBrotherBacklogSeed';
import {
  allLoans as defaultAllLoans,
  contracts as defaultContracts,
  leads as defaultLeads,
  expiringDocs as defaultExpiringDocs,
  riskFactors as defaultRiskFactors,
  respaApps as defaultRespaApps,
} from './mockData';

export type CohiPortfolioLoan = (typeof defaultAllLoans)[number] & {
  /** LOS / Encompass loan number when present on import */
  loanNumber?: string;
  /** BDM / TM display name from import when present (shown masked in UI). */
  loanOfficerName?: string;
  /** Spreadsheet row this loan was built from (upload / API / seed backlog). Omitted for built-in demo loans only. */
  builderImportRow?: BuilderImportRow;
};

const US_STATE_CENTER: Record<string, { lat: number; lng: number }> = {
  AL: { lat: 32.806671, lng: -86.79113 },
  AZ: { lat: 33.729759, lng: -111.431221 },
  CA: { lat: 36.778261, lng: -119.417932 },
  CO: { lat: 39.550051, lng: -105.782067 },
  CT: { lat: 41.597782, lng: -72.755371 },
  DE: { lat: 39.318523, lng: -75.507141 },
  FL: { lat: 27.766279, lng: -81.686783 },
  GA: { lat: 33.040619, lng: -83.643074 },
  ID: { lat: 44.068203, lng: -114.742043 },
  IL: { lat: 40.349457, lng: -88.986137 },
  IN: { lat: 39.849426, lng: -86.258278 },
  KS: { lat: 38.5266, lng: -96.726486 },
  KY: { lat: 37.66814, lng: -84.670067 },
  LA: { lat: 31.169546, lng: -91.867805 },
  MD: { lat: 39.063946, lng: -76.802101 },
  MA: { lat: 42.230171, lng: -71.530106 },
  MI: { lat: 43.326618, lng: -84.536095 },
  MN: { lat: 45.694454, lng: -93.900192 },
  MO: { lat: 38.456085, lng: -92.288368 },
  NV: { lat: 38.313515, lng: -117.055374 },
  NJ: { lat: 40.298904, lng: -74.521011 },
  NM: { lat: 34.840515, lng: -106.248482 },
  NY: { lat: 42.165726, lng: -74.948051 },
  NC: { lat: 35.630066, lng: -79.806419 },
  OH: { lat: 40.388783, lng: -82.764915 },
  OR: { lat: 44.572021, lng: -122.070938 },
  PA: { lat: 40.590752, lng: -77.209755 },
  SC: { lat: 33.856892, lng: -80.945007 },
  TN: { lat: 35.747845, lng: -86.692345 },
  TX: { lat: 31.968599, lng: -99.901813 },
  UT: { lat: 40.150032, lng: -111.862434 },
  VA: { lat: 37.769337, lng: -78.169968 },
  WA: { lat: 47.400902, lng: -121.490494 },
  WI: { lat: 44.268543, lng: -89.616508 },
};

/** Major metros per state for import rows (P_Name is a plan, not a municipality). */
const MARKET_CITIES_BY_STATE: Record<string, readonly string[]> = {
  AL: ['Huntsville', 'Birmingham', 'Mobile'],
  AZ: ['Phoenix', 'Scottsdale', 'Tucson', 'Gilbert'],
  CA: ['San Diego', 'Los Angeles', 'Irvine', 'Sacramento', 'San Jose'],
  CO: ['Denver', 'Colorado Springs', 'Fort Collins', 'Boulder'],
  CT: ['Hartford', 'Stamford', 'New Haven'],
  FL: ['Naples', 'Orlando', 'Tampa', 'Jacksonville', 'Miami'],
  GA: ['Atlanta', 'Savannah', 'Augusta'],
  ID: ['Boise', 'Meridian', 'Nampa'],
  IL: ['Chicago', 'Naperville', 'Aurora'],
  IN: ['Indianapolis', 'Carmel', 'Fishers'],
  KS: ['Wichita', 'Overland Park', 'Kansas City'],
  KY: ['Louisville', 'Lexington', 'Bowling Green'],
  LA: ['New Orleans', 'Baton Rouge', 'Lafayette'],
  MA: ['Boston', 'Worcester', 'Cambridge'],
  MD: ['Bethesda', 'Baltimore', 'Frederick'],
  MI: ['Detroit', 'Grand Rapids', 'Ann Arbor'],
  MN: ['Minneapolis', 'St. Paul', 'Rochester'],
  MO: ['Kansas City', 'St. Louis', 'Springfield'],
  NC: ['Charlotte', 'Raleigh', 'Durham', 'Wilmington'],
  NE: ['Omaha', 'Lincoln'],
  NJ: ['Princeton', 'Newark', 'Jersey City'],
  NM: ['Albuquerque', 'Santa Fe', 'Las Cruces'],
  NV: ['Las Vegas', 'Henderson', 'Reno', 'North Las Vegas'],
  NY: ['New York', 'Buffalo', 'Rochester'],
  OH: ['Columbus', 'Cleveland', 'Cincinnati'],
  OR: ['Portland', 'Eugene', 'Bend'],
  PA: ['Philadelphia', 'Pittsburgh', 'Allentown'],
  SC: ['Charleston', 'Columbia', 'Greenville', 'Myrtle Beach'],
  TN: ['Nashville', 'Memphis', 'Knoxville'],
  TX: ['Houston', 'Dallas', 'Austin', 'San Antonio'],
  UT: ['Salt Lake City', 'Provo', 'St. George'],
  VA: ['Virginia Beach', 'Richmond', 'Arlington'],
  WA: ['Seattle', 'Bellevue', 'Spokane'],
  WI: ['Milwaukee', 'Madison', 'Green Bay'],
  DE: ['Wilmington', 'Dover'],
};

function hashCommunityKey(community: string): number {
  let h = 0;
  for (let i = 0; i < community.length; i++) h = (Math.imul(31, h) + community.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Maps builder plan / community name (P_Name) to a recognizable city for KPI tables and location lines.
 * Uses substring hints when present, otherwise a stable pick from state metros.
 */
function deriveMarketCityFromCommunity(community: string, stateCode: string): string {
  const st = (stateCode || 'TX').slice(0, 2).toUpperCase();
  const c = community;

  if (/\bvegas|summerlin|henderson|north las vegas\b/i.test(c)) return 'Las Vegas';
  if (/\bnaples|marco island|estero|bonita springs\b/i.test(c)) return 'Naples';
  if (/\bsan diego|carlsbad|la jolla|oceanside|chula vista\b/i.test(c)) return 'San Diego';
  if (/\bphoenix|scottsdale|gilbert|chandler|mesa|peoria\b/i.test(c)) return 'Phoenix';
  if (/\borlando|kissimmee|celebration|winter garden\b/i.test(c)) return 'Orlando';
  if (/\btampa|st\.?\s*petersburg|clearwater|brandon\b/i.test(c)) return 'Tampa';
  if (/\bmiami|fort lauderdale|boca raton|west palm\b/i.test(c)) return 'Miami';
  if (/\bdallas|plano|frisco|mckinney|irving\b/i.test(c)) return 'Dallas';
  if (/\bhouston|katy|cypress|the woodlands|pearland\b/i.test(c)) return 'Houston';
  if (/\baustin|round rock|cedar park|pflugerville\b/i.test(c)) return 'Austin';
  if (/\bcharlotte|concord|huntersville\b/i.test(c)) return 'Charlotte';
  if (/\braleigh|cary|durham|apex\b/i.test(c)) return 'Raleigh';
  if (/\bdenver|aurora|boulder|lakewood\b/i.test(c)) return 'Denver';
  if (/\batlanta|alpharetta|marietta|roswell\b/i.test(c)) return 'Atlanta';
  if (/\bseattle|bellevue|tacoma|kent\b/i.test(c)) return 'Seattle';
  if (/\bsalt lake|provo|lehi|sandy\b/i.test(c)) return 'Salt Lake City';
  if (/\bboise|meridian|nampa\b/i.test(c)) return 'Boise';
  if (/\bphiladelphia|king of prussia|chester\b/i.test(c) && st === 'PA') return 'Philadelphia';
  if (/\bprinceton|trenton|edison\b/i.test(c) && st === 'NJ') return 'Princeton';

  const pool = MARKET_CITIES_BY_STATE[st] ?? ['Austin', 'Dallas', 'Houston', 'San Antonio'];
  return pool[hashCommunityKey(community) % pool.length]!;
}

function parseNumber(raw: string): number {
  if (!raw) return 0;
  const n = Number(String(raw).replace(/[$,]/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function parseIsoDate(raw: string): string | null {
  if (!raw || !String(raw).trim()) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

function daysBetweenFuture(iso: string | null): number {
  if (!iso) return 120;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 120;
  return Math.max(1, Math.ceil((t - Date.now()) / (86400 * 1000)));
}

function stableId(row: BuilderImportRow, index: number): number {
  const key = `${row.Business_U}|${row.Loanno}|${row.Buyer_Name}|${index}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  const v = Math.abs(h) % 2_000_000_000;
  return v || index + 1;
}

function encompassToStatus(orig: string): string {
  const x = orig.toLowerCase();
  if (x.includes('clear to close') || x.includes('clear-to-close')) return 'Finishing';
  if (x.includes('underwriting')) return 'Drywall';
  if (x.includes('ctc')) return 'Finishing';
  if (x.includes('processing')) return 'Framing';
  if (x.includes('loan setup') || x.includes('setup')) return 'Foundation';
  if (x.includes('funding') || x.includes('closing')) return 'Finishing';
  return 'Framing';
}

/** Matches spreadsheet “captured to preferred” flags (Encompass-style Y plus common variants). */
function captureIndicatorIsPreferred(raw: string | undefined): boolean {
  const v = String(raw ?? '')
    .trim()
    .toUpperCase();
  return v === 'Y' || v === 'YES' || v === '1' || v === 'TRUE';
}

function captureIndicatorIsExplicitExternal(raw: string | undefined): boolean {
  const v = String(raw ?? '')
    .trim()
    .toUpperCase();
  return v === 'N' || v === 'NO' || v === '0' || v === 'FALSE';
}

/** Builder backlog rows where Loan_Type indicates an all-cash / TRU CASH buyer (not mortgage TBD). */
function loanTypeIsCashSale(raw: string | undefined): boolean {
  const t = String(raw ?? '').trim().toLowerCase();
  if (!t) return false;
  if (t.includes('tru cash') || t.includes('true cash')) return true;
  if (t.includes('cash-out') || t.includes('cash out')) return false;
  if (/\bcash\b/.test(t)) return true;
  return false;
}

function preparednessFromStatus(status: string): number {
  if (status === 'Finishing') return 92;
  if (status === 'Drywall') return 78;
  if (status === 'Framing') return 62;
  if (status === 'Foundation') return 48;
  return 55;
}

function constructionFromStatus(status: string): number {
  if (status === 'Finishing') return 88;
  if (status === 'Drywall') return 72;
  if (status === 'Framing') return 45;
  if (status === 'Foundation') return 22;
  return 40;
}

function riskFromRow(row: BuilderImportRow, daysToClose: number): { riskScore: number; riskLevel: 'Low' | 'Medium' | 'High' } {
  let score = 25;
  if (row.Capture_Lost_Reason?.trim()) score += 25;
  if (!captureIndicatorIsPreferred(row.Capture_Indicator)) score += 15;
  if (daysToClose <= 30) score += 20;
  if (daysToClose <= 14) score += 15;
  const loanType = row.Loan_Type?.toLowerCase() ?? '';
  if (loanType.includes('fha') || loanType.includes('va') || loanType.includes('non')) score += 10;
  score = Math.min(99, Math.max(5, score));
  const level: 'Low' | 'Medium' | 'High' = score >= 70 ? 'High' : score >= 40 ? 'Medium' : 'Low';
  return { riskScore: score, riskLevel: level };
}

function latLngForState(st: string, id: number): { lat: number; lng: number } {
  const code = (st || 'TX').slice(0, 2).toUpperCase();
  const base = US_STATE_CENTER[code] ?? { lat: 39.8283, lng: -98.5795 };
  const jx = ((id * 7919) % 1000) / 8000 - 0.0625;
  const jy = ((id * 4177) % 1000) / 8000 - 0.0625;
  return { lat: base.lat + jx, lng: base.lng + jy };
}

export function buildLoanFromImportRow(row: BuilderImportRow, index: number): CohiPortfolioLoan {
  const id = stableId(row, index);
  const state = (row.TBI_State || 'TX').slice(0, 2).toUpperCase();
  const buyer = row.Buyer_Name?.trim() || `Borrower ${index + 1}`;
  const community = row.P_Name?.trim() || 'Community';
  const status = encompassToStatus(row.Origination_Status || '');
  const prj = parseIsoDate(row.PRJ_STL_D);
  const daysToClose = daysBetweenFuture(prj);
  const { riskScore, riskLevel } = riskFromRow(row, daysToClose);
  const loanAmount = parseNumber(row.LoanAmount) || 650_000;
  const propertyValue = Math.round(loanAmount * 1.18);
  const captureY = captureIndicatorIsPreferred(row.Capture_Indicator);
  const preferred = captureY;
  const extBank = externalLenderFromImportRow(row);
  const lender = preferred
    ? row['Business Unit']?.includes('Captive')
      ? 'TB Mortgage · Captive'
      : 'TB Mortgage'
    : extBank !== '—'
      ? extBank
      : 'External';
  const loanTypeLower = (row.Loan_Type || '').toLowerCase();
  const isNonQM =
    loanTypeLower.includes('asset') ||
    loanTypeLower.includes('bank statement') ||
    loanTypeLower.includes('dscr') ||
    loanTypeLower.includes('non-qm');
  const lockIso = parseIsoDate(row.LOCKED);
  const rateLock =
    lockIso && row.Origination_Status
      ? {
          status: 'Locked' as const,
          expires: (() => {
            const d = new Date(lockIso);
            d.setUTCDate(d.getUTCDate() + 75);
            return d.toISOString().slice(0, 10);
          })(),
          type: 'Import / Encompass',
        }
      : { status: 'Floating' as const, expires: null as string | null, type: 'Standard' };
  const incentive = parseNumber(row.TotalIncentive);
  const { lat, lng } = latLngForState(state, id);
  const address = `${row['Project Number'] || 'Lot'} — ${community}, ${state}`;
  const marketCity = deriveMarketCityFromCommunity(community, state);

  const loRaw = row.BDM_Name?.trim() || row.TMName?.trim() || undefined;

  const base: CohiPortfolioLoan = {
    id,
    loanNumber: row.Loanno?.trim() || undefined,
    loanOfficerName: loRaw,
    borrower: buyer,
    lender,
    isPreferred: preferred,
    status,
    daysToClose,
    riskScore,
    riskLevel,
    los: 'ICE Encompass',
    erpSync: row.P_Div_VP ? `BDM: ${row.BDM_Name || row.BDM_Num || '—'}` : 'Hyphen BRIX',
    rateLock,
    incentives: {
      type: incentive > 0 ? 'Total Incentive' : 'None',
      value: incentive,
    },
    builderImportRow: { ...row },
    sourceType: row.APP_DATE ? 'LOS' : 'CRM',
    address,
    city: marketCity,
    state,
    lat,
    lng,
    loanAmount,
    propertyValue,
    isHeloc: false,
    propertyImage: TOLL_BROTHERS_LISTING_IMAGES[id % TOLL_BROTHERS_LISTING_IMAGES.length],
    constructionProgress: constructionFromStatus(status),
    loanPreparedness: preparednessFromStatus(status),
    milestones: [
      { label: 'Agreement (AGR_DTE_T)', date: parseIsoDate(row.AGR_DTE_T) || '—', completed: true },
      { label: 'Application', date: parseIsoDate(row.APP_DATE) || '—', completed: !!row.APP_DATE },
      { label: 'Origination', date: row.Origination_Status || '—', completed: true },
      { label: 'Projected close (PRJ_STL_D)', date: prj || '—', current: true },
    ],
    preparednessChecklist: [
      { task: 'Capture indicator', status: captureY ? 'Completed' : 'Review' },
      { task: 'Loan amount', status: loanAmount > 0 ? 'Completed' : 'Pending' },
      { task: 'Projected COE', status: prj ? 'Completed' : 'Pending' },
      { task: 'Origination status', status: row.Origination_Status ? 'Completed' : 'Pending' },
    ],
  };

  if (isNonQM) {
    return {
      ...base,
      isNonQM: true,
      nonQMData: {
        type: row.Loan_Type || 'Non-QM',
        verifiedAssets: Math.round(propertyValue * 2.2),
        monthlyIncomeEquivalent: Math.round(loanAmount / 480),
        ltv: Math.round((loanAmount / propertyValue) * 100),
      },
    };
  }

  return base;
}

export type CohiPortfolioBundle = {
  allLoans: CohiPortfolioLoan[];
  contracts: typeof defaultContracts;
  leads: typeof defaultLeads;
  expiringDocs: typeof defaultExpiringDocs;
  riskFactors: typeof defaultRiskFactors;
  respaApps: typeof defaultRespaApps;
};

export function buildPortfolioBundleFromImportRows(rows: BuilderImportRow[]): CohiPortfolioBundle {
  const allLoans = rows.map((r, i) => buildLoanFromImportRow(r, i));
  const contracts = rows.map((r, i) => ({
    id: 10_000 + i,
    borrower: r.Buyer_Name?.trim() || `Borrower ${i + 1}`,
    date: parseIsoDate(r.AGR_DTE_T) || '',
    community: r.P_Name?.trim() || '',
    status: r.Cancdt_2?.trim() ? 'Canceled' : 'Active',
    mortgageStatus: captureIndicatorIsPreferred(r.Capture_Indicator)
      ? `TBI Mortgage · ${r.Origination_Status?.trim() || 'In pipeline'}`
      : captureIndicatorIsExplicitExternal(r.Capture_Indicator)
        ? `External · ${r.Capture_Lost_Reason || 'Not captured'}`
        : loanTypeIsCashSale(r.Loan_Type)
          ? `Cash sale · ${r.Loan_Type?.trim() || 'Cash'}`
          : `Pending · ${(r.Capture_Indicator ?? '').trim() || 'Capture TBD'}`,
  }));
  const leads = rows.map((r, i) => ({
    id: 50_000 + i,
    name: r.Buyer_Name?.trim() || `Lead ${i + 1}`,
    source: r.MLS_Num ? `LO ${r.MLS_Num}` : 'Builder backlog',
    community: r.P_Name?.trim() || '',
    status: r.APP_DATE?.trim() ? 'Applied' : 'Prospect',
  }));

  const expiringDocs = allLoans.slice(0, Math.min(40, allLoans.length)).map((loan, i) => {
    const row = rows[i];
    const lock = parseIsoDate(row?.LOCKED || '');
    const exp = lock
      ? (() => {
          const d = new Date(lock);
          d.setUTCDate(d.getUTCDate() + 45);
          return d.toISOString().slice(0, 10);
        })()
      : new Date(Date.now() + (i % 30) * 86400000).toISOString().slice(0, 10);
    const days = Math.max(1, Math.ceil((Date.parse(exp) - Date.now()) / 86400000));
    return {
      id: i + 1,
      loanId: loan.id,
      borrower: loan.borrower,
      type: i % 3 === 0 ? 'Rate lock' : i % 3 === 1 ? 'Disclosure' : 'Credit / income',
      expires: exp,
      days,
      status: days <= 10 ? ('critical' as const) : days <= 25 ? ('warning' as const) : ('safe' as const),
    };
  });

  const riskFactors = rows
    .map((r, i) => {
      if (!r.Capture_Lost_Reason?.trim() && !r.Capture_Lost_Comment?.trim()) return null;
      const loan = allLoans[i];
      if (!loan) return null;
      return {
        loanId: loan.id,
        borrower: loan.borrower,
        score: 55 + (i % 35),
        level: 'High' as const,
        factors: [
          {
            category: 'Capture',
            impact: 'High' as const,
            description: r.Capture_Lost_Reason || 'Not captured',
          },
          ...(r.Capture_Lost_Comment
            ? [{ category: 'Comment', impact: 'Medium' as const, description: r.Capture_Lost_Comment }]
            : []),
        ],
      };
    })
    .filter(Boolean) as typeof defaultRiskFactors;

  const respaApps = rows.slice(0, Math.min(rows.length, 80)).map((r, i) => {
    const loan = allLoans[i];
    const st = r.Origination_Status || '';
    const atRisk = st.toLowerCase().includes('suspend') || st.toLowerCase().includes('denied');
    return {
      id: `APP-IMP-${i + 1}`,
      borrower: loan?.borrower || r.Buyer_Name || '—',
      lender: loan?.lender || '—',
      applicationDate: parseIsoDate(r.APP_DATE) || parseIsoDate(r.AGR_DTE_T) || '',
      leStatus: atRisk ? 'Delayed' : 'Sent',
      leDate: parseIsoDate(r.APP_DATE),
      cdStatus: 'Pending',
      cdDeadline: parseIsoDate(r.PRJ_STL_D) || '',
      complianceScore: atRisk ? 62 : 94,
      status: atRisk ? 'At Risk' : 'On Track',
    };
  });

  return {
    allLoans,
    contracts,
    leads,
    expiringDocs: expiringDocs.length ? expiringDocs : defaultExpiringDocs,
    riskFactors: riskFactors.length ? riskFactors : defaultRiskFactors,
    respaApps: respaApps.length ? respaApps : defaultRespaApps,
  };
}

/** Default Capture Analysis portfolio: Toll Brothers backlog spreadsheet (839 loans). */
export function defaultPortfolioBundle(): CohiPortfolioBundle {
  return buildPortfolioBundleFromImportRows(tollBrotherBacklogImportRows);
}

/** Previous synthetic demo (mockData) — for tests or tooling only. */
export function legacySyntheticPortfolioBundle(): CohiPortfolioBundle {
  return {
    allLoans: defaultAllLoans,
    contracts: defaultContracts,
    leads: defaultLeads,
    expiringDocs: defaultExpiringDocs,
    riskFactors: defaultRiskFactors,
    respaApps: defaultRespaApps,
  };
}

/** Cleared import / explicit reset — all KPIs and lists read as zero until new data is loaded. */
export function emptyPortfolioBundle(): CohiPortfolioBundle {
  return {
    allLoans: [],
    contracts: [],
    leads: [],
    expiringDocs: [],
    riskFactors: [],
    respaApps: [],
  };
}
