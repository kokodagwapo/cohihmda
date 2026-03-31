export type InstitutionType = 'Bank' | 'Credit Union' | 'IMB' | 'Other';

export type OriginationChannel = 'Retail' | 'Wholesale/Broker' | 'Delegated Correspondent' | 'Non-Delegated Correspondent' | 'Other';

export type LoanType =
  | 'Conventional'
  | 'FHA'
  | 'VA'
  | 'USDA'
  | 'State Bond'
  | 'Reverse'
  | 'Land Only'
  | 'Construction Only'
  | 'Construction-to-Permanent'
  | '1-4 Rehab'
  | 'Non-QM'
  | 'Asset Based'
  | 'DSCR';

export type DisclosureModel =
  | 'Disclosure desk'
  | 'Origination discloses'
  | 'LOA discloses'
  | 'Processors disclose/redisclose'
  | 'Unknown';

/** Where onboarding data is expected to originate for builder-affiliated lenders. */
export type BuilderDataSource = 'Builder CRM/ERP' | 'LOS';

export type LenderProfile = {
  institutionType: InstitutionType;
  nmlsNumber: string;
  lei?: string;
  hasDba?: boolean;
  dbaNames?: string[];

  // Channel + product footprint (questionnaire rows 11–31)
  channels: OriginationChannel[];
  loanTypes: LoanType[];

  // Construction lending footprint (rows 34–38)
  doesConstructionLending: boolean;

  // Builder alignment (row 40)
  isCaptiveBuilderLender?: boolean;

  /** Builder partners / programs (e.g. national or regional production builders). */
  primaryBuilderPartners?: string[];
  /** Approximate active selling communities for capture reporting. */
  activeCommunitiesCount?: number;
  /** Target preferred/capture rate as a percent (0–100). */
  captureTargetPct?: number;
  /** Free text: co-marketing, rate buydowns, closing cost posture, etc. */
  incentivePosture?: string;
  /** Whether key metrics are sourced from builder systems, LOS, or both. */
  primaryDataSources?: BuilderDataSource[];

  // Disclosure workflow (rows 42–45)
  disclosureModel?: DisclosureModel;

  // Borrower application platform (rows 47–51)
  hasOnlineBorrowerApp?: boolean;
  borrowerAppPlatform?: string;

  // Core tech stack / vendors (selected from questionnaire)
  accountingVendor?: string;
  losVendor?: string;
  posVendor?: string;
  ausProviders?: string[];
  docProviders?: string[];
  creditProviders?: string[];
  ppeProvider?: string;
  capitalMarketsProvider?: string;

  // Staffing (rows 56–69)
  staffing?: {
    processors?: number;
    underwriters?: number;
    closers?: number;
    branches?: number;
    loanOfficers?: number;
    assistantLoanOfficers?: number;
    secondaryMarketing?: number;
    servicing?: number;
    qcPostClosing?: number;
  };
};

export type LenderRecord = {
  id: number;
  name: string;
  logo: string;
  status: 'Active' | 'Onboarding' | 'Inactive';
  techStack: {
    los: string;
    pos: string;
  };
  profile: LenderProfile;
};

export const DEFAULT_LENDERS: LenderRecord[] = [
  {
    id: 1,
    name: 'First National Bank',
    logo: 'FNB',
    status: 'Active',
    techStack: { los: 'Encompass', pos: 'Blend' },
    profile: {
      institutionType: 'Bank',
      nmlsNumber: '402193',
      lei: '',
      hasDba: false,
      dbaNames: [],
      channels: ['Retail', 'Wholesale/Broker'],
      loanTypes: ['Conventional', 'FHA', 'VA', 'Construction-to-Permanent'],
      doesConstructionLending: true,
      isCaptiveBuilderLender: false,
      disclosureModel: 'Disclosure desk',
      hasOnlineBorrowerApp: true,
      borrowerAppPlatform: 'Blend',
      accountingVendor: 'LoanVision',
      losVendor: 'ICE Encompass',
      posVendor: 'Blend',
      ausProviders: ['Fannie Mae DU', 'Freddie Mac LP'],
      docProviders: ['DocMagic'],
      creditProviders: ['Xactus'],
      ppeProvider: 'Optimal Blue',
      capitalMarketsProvider: 'MCT',
      staffing: {
        processors: 24,
        underwriters: 14,
        closers: 8,
        branches: 12,
        loanOfficers: 120,
        assistantLoanOfficers: 35,
        secondaryMarketing: 6,
        servicing: 18,
        qcPostClosing: 5,
      },
    },
  },
  {
    id: 2,
    name: 'Summit Mortgage',
    logo: 'SM',
    status: 'Active',
    techStack: { los: 'LendingPad', pos: 'Roostify' },
    profile: {
      institutionType: 'IMB',
      nmlsNumber: '110552',
      lei: '',
      hasDba: true,
      dbaNames: ['Summit Home Lending'],
      channels: ['Retail'],
      loanTypes: ['Conventional', 'FHA', 'VA', 'Non-QM'],
      doesConstructionLending: false,
      isCaptiveBuilderLender: false,
      disclosureModel: 'Processors disclose/redisclose',
      hasOnlineBorrowerApp: true,
      borrowerAppPlatform: 'Roostify',
      accountingVendor: 'LoanVision',
      losVendor: 'LendingPad',
      posVendor: 'Roostify',
      ausProviders: ['Fannie Mae DU', 'Freddie Mac LP'],
      docProviders: ['DocuTech'],
      creditProviders: ['Informative Research'],
      ppeProvider: 'Optimal Blue',
      capitalMarketsProvider: 'MCT',
      staffing: {
        processors: 9,
        underwriters: 6,
        closers: 4,
        branches: 3,
        loanOfficers: 45,
        assistantLoanOfficers: 12,
        secondaryMarketing: 3,
        servicing: 0,
        qcPostClosing: 2,
      },
    },
  },
  {
    id: 3,
    name: 'Coastal Lenders',
    logo: 'CL',
    status: 'Onboarding',
    techStack: { los: 'Calyx Point', pos: 'SimpleNexus' },
    profile: {
      institutionType: 'Other',
      nmlsNumber: '882014',
      lei: '',
      hasDba: false,
      dbaNames: [],
      channels: ['Wholesale/Broker', 'Non-Delegated Correspondent'],
      loanTypes: ['Conventional', 'VA', 'USDA'],
      doesConstructionLending: true,
      isCaptiveBuilderLender: true,
      primaryBuilderPartners: ['Toll Brothers (exemplar)', 'Regional production partners'],
      activeCommunitiesCount: 12,
      captureTargetPct: 82,
      incentivePosture: 'Closing cost assistance on select inventory homes (demo profile).',
      primaryDataSources: ['Builder CRM/ERP', 'LOS'],
      disclosureModel: 'Unknown',
      hasOnlineBorrowerApp: false,
      borrowerAppPlatform: '',
      accountingVendor: '',
      losVendor: 'Calyx Point',
      posVendor: 'SimpleNexus',
      ausProviders: ['Freddie Mac LP'],
      docProviders: [],
      creditProviders: [],
      ppeProvider: '',
      capitalMarketsProvider: '',
      staffing: {},
    },
  },
];

const STORAGE_KEY = 'cohi:lenders:v1';
const HMDA_SEED_KEY_PREFIX = 'cohi:lenders:hmdaSeeded';

function logoFromName(name: string) {
  const parts = name
    .split(/\s+/g)
    .map((p) => p.trim())
    .filter(Boolean);
  const letters = (parts[0]?.[0] ?? 'L') + (parts[1]?.[0] ?? parts[0]?.[1] ?? 'D');
  return letters.toUpperCase().slice(0, 3);
}

function mergeById(existing: LenderRecord[], incoming: LenderRecord[]) {
  const seen = new Set(existing.map((l) => l.id));
  return [...existing, ...incoming.filter((l) => !seen.has(l.id))];
}

export function loadLenders(): LenderRecord[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LENDERS;
    const parsed = JSON.parse(raw) as LenderRecord[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_LENDERS;
    // If defaults grow over time (e.g. seeded lenders), merge them in without overwriting user edits.
    return mergeById(parsed, DEFAULT_LENDERS);
  } catch {
    return DEFAULT_LENDERS;
  }
}

export function saveLenders(next: LenderRecord[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

type HmdaFiler = {
  lei?: string;
  name?: string;
  institutionName?: string;
  respondentName?: string;
};

export async function seedHmdaLenders(opts?: { year?: number; limit?: number }) {
  const year = opts?.year ?? 2024;
  const limit = opts?.limit ?? 100;
  const seededKey = `${HMDA_SEED_KEY_PREFIX}:${year}:${limit}`;

  try {
    if (window.localStorage.getItem(seededKey) === '1') return;

    const url = `https://ffiec.cfpb.gov/v2/reporting/filers/${year}`;
    const r = await fetch(url);
    if (!r.ok) return;
    const data = (await r.json()) as any;
    const filers: HmdaFiler[] = Array.isArray(data?.institutions) ? data.institutions : Array.isArray(data) ? data : [];
    if (!filers.length) return;

    const cleaned = filers
      .map((f) => ({
        lei: String(f?.lei ?? '').trim(),
        name: String(f?.name ?? f?.institutionName ?? f?.respondentName ?? '').replace(/\s+/g, ' ').trim(),
      }))
      .filter((x) => x.lei && x.name);

    const dedup = new Map<string, string>();
    for (const x of cleaned) {
      if (!dedup.has(x.lei)) dedup.set(x.lei, x.name);
    }

    const list = [...dedup.entries()]
      .map(([lei, name]) => ({ lei, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit);

    // Use a high ID range so it doesn't collide with manual/demo records.
    const baseId = 10_000 + year * 1_000;
    const incoming: LenderRecord[] = list.map((x, idx) => ({
      id: baseId + idx,
      name: x.name,
      logo: logoFromName(x.name),
      status: 'Active',
      techStack: { los: '', pos: '' },
      profile: {
        institutionType: 'Other',
        nmlsNumber: '',
        lei: x.lei,
        hasDba: false,
        dbaNames: [],
        channels: ['Retail'],
        loanTypes: ['Conventional'],
        doesConstructionLending: false,
        isCaptiveBuilderLender: false,
        disclosureModel: 'Unknown',
        hasOnlineBorrowerApp: false,
        borrowerAppPlatform: '',
        accountingVendor: '',
        losVendor: '',
        posVendor: '',
        ausProviders: [],
        docProviders: [],
        creditProviders: [],
        ppeProvider: '',
        capitalMarketsProvider: '',
        staffing: {},
      },
    }));

    const current = loadLenders();
    const next = mergeById(current, incoming);
    saveLenders(next);
    window.localStorage.setItem(seededKey, '1');
  } catch {
    // Best-effort seed; safe to ignore failures.
  }
}

