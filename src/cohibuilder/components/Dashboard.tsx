import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Users,
  FileWarning,
  AlertTriangle,
  UserX,
  TrendingUp,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  Map as MapIcon,
  MapPin,
  CalendarClock,
  ShieldCheck,
  CheckCircle2,
  Clock3,
  UploadCloud,
  FileSpreadsheet,
  FileDown,
  RotateCcw,
  ListChecks,
  Sparkles,
  History,
  GitMerge,
  LayoutList,
  FolderOpen,
  Info,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import Tooltip from './Tooltip';
import { useCohiBuilderPortfolio } from '../contexts/CohiBuilderPortfolioContext';
import type { CohiPortfolioLoan } from '../data/portfolioFromBuilderImport';
import {
  downloadBuilderImportTemplate,
  downloadBuilderImportTemplateXlsx,
  getImportHistorySnapshot,
  loadImportHistory,
  parseBuilderImportFile,
} from '../data/builderImportFields';
import { useFunnelPeriod, FUNNEL_PERIOD_SCALE } from '../contexts/FunnelPeriodContext';
import { anonymizeBorrowerName, displayLoanOfficer } from '../lib/borrowerPrivacy';
import { resolvedPrimaryLenderLabel } from '../lib/lenderDisplay';

type ContractLike = { status: string; mortgageStatus?: string };

/** Canceled agreement row: lender/policy denial vs borrower–builder withdrawal (fallout split). */
function falloutKindFromContract(c: ContractLike): 'withdrawn' | 'denied' | null {
  if (c.status !== 'Canceled') return null;
  const m = (c.mortgageStatus ?? '').toLowerCase();
  if (
    /\bden(y|ied|ial)\b/.test(m) ||
    m.includes('declin') ||
    m.includes('susp') ||
    m.includes('unable to approve') ||
    m.includes('adverse action') ||
    m.includes('not approved')
  ) {
    return 'denied';
  }
  return 'withdrawn';
}

function syntheticContractDueDays(contractId: number): number {
  return ((contractId * 17 + 5) % 22) + 4;
}

const FUNNEL_STAGE_HELP: Record<string, { full: string; help: string }> = {
  Started: {
    full: 'Started',
    help: 'Prospects who entered the program and began qualification—units in flight and average time in motion for this cohort.',
  },
  Contracts: {
    full: 'Signed Contracts',
    help: 'Executed purchase agreements. Use the due window to monitor purchase-contract milestones and financing deadlines.',
  },
  AppsTaken: {
    full: 'RESPA Apps Taken',
    help: 'RESPA-tracked mortgage applications on file after contract (preferred/captive vs. external).',
  },
};

/** Contracts due within this many days appear in the drilldown list (demo synthetic milestones). */
const CONTRACT_DUE_WINDOW_DAYS = 15;

/** Hover tooltip for the whole Contracts funnel tile. */
function funnelContractsCardTooltip(): string {
  return `Average days remaining to the next contract milestone across signed contracts. Tap below (avg days / due units) for loans due within ${CONTRACT_DUE_WINDOW_DAYS} days, current milestone, and open loan detail.`;
}

const FUNNEL_STARTED_CARD_TOOLTIP =
  `Started prospects in the selected period (WTD/MTD/QTR/YTD): total units and average days in pipeline (cohort motion). Tap to preview a prospect list from CRM and web sources.`;

const FUNNEL_APPS_CARD_TOOLTIP =
  `${FUNNEL_STAGE_HELP.AppsTaken.help} Unit count follows the selected period; “average days in pipeline” is mean days to targeted funding across active loans in the demo portfolio. Tap to preview application records.`;

/** After auto-dismiss or close, the import summary banner stays hidden until the user opens it again (same browser session). */
const IMPORT_BANNER_SESSION_DISMISSED_KEY = 'cohiBuilder_importBannerSessionDismissed_v1';

const FUNNEL_SUBROW_TOOLTIPS: Record<'conditional' | 'final', string> = {
  conditional:
    'Conversion-style rate: executed contracts per started prospect in this period. Lower readiness often means longer stays in conditional approval—tap for loans under ~80% readiness.',
  final:
    'RESPA apps taken per signed contract—captures how quickly the builder funnel converts paper to LOS apps on the preferred or external path. Tap for preferred-channel contract examples.',
};

const CLOSE_PUNCTUALITY_HELP: Record<'OnTime' | 'OffSchedule', string> = {
  OnTime:
    'Funded (or table-funded) files that met the contract close of escrow (COE) or builder-attested target without a calendar slip.',
  OffSchedule:
    'Closes that missed the committed COE (close of escrow), required a reschedule, or funded after the builder/program target — often driven by conditions, title, or lock timing.',
};

type PortfolioLoan = CohiPortfolioLoan;

/** Demo classifier: deterministic share of the portfolio treated as on-time vs off-schedule for this tile. */
function isOnTimeCloseDemo(loan: PortfolioLoan): boolean {
  return ((loan.id * 17 + loan.loanPreparedness * 2) % 100) < 58;
}

function punctualityDriverDemo(loan: PortfolioLoan): string {
  const reasons = ['Title / recording', 'Conditions cycle', 'Rate lock timing', 'Builder COE shift', 'Third-party vendor'];
  return reasons[(loan.id * 11 + loan.daysToClose) % reasons.length];
}

type LateBottleneckBucket = 'intake' | 'underwriting' | 'lock' | 'construction' | 'other';

const LATE_BUCKET_LABEL: Record<LateBottleneckBucket, string> = {
  intake: 'Application intake',
  underwriting: 'UW / readiness',
  lock: 'Lock vs COE',
  construction: 'Construction pace',
  other: 'Title / vendors / other',
};

type MileLike = { label?: string; date?: string };

function milestoneDateMs(m: MileLike): number | null {
  const raw = m.date;
  if (!raw || raw === '—') return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const t = Date.parse(s.slice(0, 10));
    return Number.isNaN(t) ? null : t;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** Best-effort contract / app / projected close timestamps from loan milestones (import + demo shapes). */
function extractPipelineDates(loan: PortfolioLoan): {
  contractMs: number | null;
  appMs: number | null;
  prjMs: number | null;
} {
  const ms = (loan.milestones ?? []) as MileLike[];
  let contractMs: number | null = null;
  let appMs: number | null = null;
  let prjMs: number | null = null;

  for (const m of ms) {
    const t = milestoneDateMs(m);
    if (t == null) continue;
    const lb = (m.label ?? '').toLowerCase();
    if (
      lb.includes('agr') ||
      lb.includes('agreement') ||
      lb.includes('builder contract') ||
      lb.includes('contract signed') ||
      (lb.includes('contract') && !lb.includes('application') && !lb.includes('app'))
    ) {
      contractMs = t;
    } else if (lb.includes('mortgage app') || lb.includes('application')) {
      appMs = t;
    } else if (lb.includes('projected close') || lb.includes('prj_stl') || lb.includes('prj')) {
      prjMs = t;
    }
  }

  const dated = ms
    .map((m) => milestoneDateMs(m))
    .filter((x): x is number => x != null)
    .sort((a, b) => a - b);
  const uniq = [...new Set(dated)];
  if (contractMs == null && uniq[0] != null) contractMs = uniq[0];
  if (appMs == null && uniq[1] != null) appMs = uniq[1];
  if (prjMs == null && uniq[2] != null) prjMs = uniq[2];

  return { contractMs, appMs, prjMs };
}

function cohortMedianIntakeDays(loanList: PortfolioLoan[]): number {
  const vals = loanList
    .map((l) => {
      const { contractMs, appMs } = extractPipelineDates(l);
      if (contractMs == null || appMs == null) return null;
      return Math.max(0, (appMs - contractMs) / 86400000);
    })
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (!vals.length) return 14;
  vals.sort((a, b) => a - b);
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid]! : (vals[mid - 1]! + vals[mid]!) / 2;
}

/**
 * For loans treated as closed late: infer where friction showed up using milestone spacing,
 * readiness, lock runway, and build pacing. Not a substitute for actual funded/COE dates in the import.
 */
function lateLoanBottleneck(
  loan: PortfolioLoan,
  medianIntakeDays: number,
): { bucket: LateBottleneckBucket; detail: string; intakeExcessDays: number | null } {
  const refIntake =
    Number.isFinite(medianIntakeDays) && medianIntakeDays >= 3 ? medianIntakeDays : 14;
  const { contractMs, appMs, prjMs } = extractPipelineDates(loan);

  let intakeExcessDays: number | null = null;
  if (contractMs != null && appMs != null) {
    const days = Math.max(0, (appMs - contractMs) / 86400000);
    intakeExcessDays = Math.max(0, days - refIntake);
  }

  const scores: Record<LateBottleneckBucket, number> = {
    intake: 0,
    underwriting: 0,
    lock: 0,
    construction: 0,
    other: 0,
  };

  if (intakeExcessDays != null && intakeExcessDays > 0) scores.intake += intakeExcessDays * 2.2;

  const prep = loan.loanPreparedness ?? 0;
  if (prep < 60) scores.underwriting += (60 - prep) * 1.75;
  if (prep < 45) scores.underwriting += 14;

  const lockDays = daysToLockExpiry(loan);
  if (loan.rateLock?.status === 'Locked' && lockDays != null) {
    const runwayGap = loan.daysToClose - lockDays;
    if (runwayGap > 12) scores.lock += runwayGap * 0.9;
    if (runwayGap > 28) scores.lock += 16;
  }

  const appToCloseDays =
    appMs != null && prjMs != null ? Math.max(1, (prjMs - appMs) / 86400000) : Math.max(1, loan.daysToClose + 45);
  const pace = (loan.constructionProgress ?? 0) / appToCloseDays;
  if (pace < 0.4 && (loan.constructionProgress ?? 0) < 58) scores.construction += 20;
  if ((loan.status === 'Foundation' || loan.status === 'Framing') && loan.daysToClose < 80) scores.construction += 12;

  const sum = scores.intake + scores.underwriting + scores.lock + scores.construction;
  if (sum < 12) scores.other = 16;

  let best: LateBottleneckBucket = 'other';
  let bestScore = -1;
  const order: LateBottleneckBucket[] = ['intake', 'underwriting', 'lock', 'construction', 'other'];
  for (const b of order) {
    if (scores[b] > bestScore) {
      bestScore = scores[b];
      best = b;
    }
  }

  const parts: string[] = [];
  if (intakeExcessDays != null && intakeExcessDays > 0)
    parts.push(`+${Math.round(intakeExcessDays)}d vs cohort contract→app`);
  if (prep < 60) parts.push(`readiness ${prep}%`);
  if (loan.rateLock?.status === 'Locked' && lockDays != null && loan.daysToClose - lockDays > 12)
    parts.push(`lock ${lockDays}d vs ${loan.daysToClose}d to COE`);
  const detail = parts.length ? parts.join(' · ') : punctualityDriverDemo(loan);

  return { bucket: best, detail, intakeExcessDays };
}

function summarizeLateBottlenecks(
  lateLoans: PortfolioLoan[],
  medianIntake: number,
): {
  byBucket: Record<LateBottleneckBucket, number>;
  avgIntakeExcessAmongLate: number | null;
  topBucket: LateBottleneckBucket | null;
} {
  if (!lateLoans.length) {
    return {
      byBucket: { intake: 0, underwriting: 0, lock: 0, construction: 0, other: 0 },
      avgIntakeExcessAmongLate: null,
      topBucket: null,
    };
  }
  const byBucket: Record<LateBottleneckBucket, number> = {
    intake: 0,
    underwriting: 0,
    lock: 0,
    construction: 0,
    other: 0,
  };
  const intakeExcesses: number[] = [];
  for (const loan of lateLoans) {
    const a = lateLoanBottleneck(loan, medianIntake);
    byBucket[a.bucket]++;
    if (a.intakeExcessDays != null && a.intakeExcessDays > 0) intakeExcesses.push(a.intakeExcessDays);
  }
  const topBucket = (Object.entries(byBucket) as [LateBottleneckBucket, number][]).sort(
    (x, y) => y[1] - x[1],
  )[0]![0];
  const avgIntakeExcessAmongLate = intakeExcesses.length
    ? Math.round(intakeExcesses.reduce((s, n) => s + n, 0) / intakeExcesses.length)
    : null;
  return { byBucket, avgIntakeExcessAmongLate, topBucket };
}

function daysToLockExpiry(loan: PortfolioLoan): number | null {
  if (!loan.rateLock?.expires) return null;
  const expiresMs = new Date(loan.rateLock.expires).getTime();
  if (Number.isNaN(expiresMs)) return null;
  return Math.ceil((expiresMs - Date.now()) / (1000 * 60 * 60 * 24));
}

function avgDaysToClose(loanList: PortfolioLoan[]): number | null {
  if (!loanList.length) return null;
  return Math.round(loanList.reduce((s, l) => s + l.daysToClose, 0) / loanList.length);
}

function normalizeBorrowerKey(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Match signed contract row to pipeline loan (borrower + community when ambiguous). */
function findLoanForContract(
  contract: { borrower: string; community?: string },
  loanList: PortfolioLoan[],
): PortfolioLoan | undefined {
  const bn = normalizeBorrowerKey(contract.borrower);
  const comm = (contract.community || '').trim().toLowerCase();
  const matches = loanList.filter((l) => normalizeBorrowerKey(l.borrower) === bn);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1 && comm) {
    const byCity = matches.find(
      (l) =>
        l.city?.trim().toLowerCase() === comm ||
        (l.city && (comm.includes(l.city.trim().toLowerCase()) || l.city.trim().toLowerCase().includes(comm))),
    );
    if (byCity) return byCity;
  }
  return matches[0];
}

type MilestoneRow = { label: string; date?: string; current?: boolean; pending?: boolean; completed?: boolean };

/** Where the file sits in milestones / LOS for funnel drilldowns */
function activeMilestoneSummary(loan: PortfolioLoan): string {
  const m = (loan.milestones ?? []) as MilestoneRow[];
  const cur = m.find((x) => x.current);
  const orig = m.find((x) => /origination/i.test(x.label));
  const prj = m.find((x) => {
    const lb = x.label.toLowerCase();
    return lb.includes('projected close') || lb.includes('prj_stl') || /\bprj\b/.test(lb);
  });

  if (cur && prj && cur.label === prj.label) {
    const tgt = prj.date && prj.date !== '—' ? prj.date : 'TBD';
    const enc = orig?.date && orig.date !== '—' ? orig.date : null;
    return enc
      ? `COE target ${tgt} · Encompass: ${enc} · Cycle: ${loan.status}`
      : `COE target ${tgt} · Cycle: ${loan.status}`;
  }
  if (cur) {
    return cur.date && cur.date !== '—' ? `At: ${cur.label} (${cur.date})` : `At: ${cur.label}`;
  }
  const pend = m.find((x) => x.pending);
  if (pend) return `Next: ${pend.label}`;
  const last = [...m].reverse().find((x) => x.completed);
  if (last) return `Last: ${last.label} · Now: ${loan.status}`;
  return `Stage: ${loan.status}`;
}

function formatLoanRef(loan: PortfolioLoan): string {
  const n = loan.loanNumber?.trim();
  return n && n.length > 0 ? n : `Loan #${loan.id}`;
}

function AnimatedNumber({
  value,
  cycle,
  delayMs = 0,
  durationMs = 1800,
  fractionDigits = 0,
  suffix = '',
  formatter,
}: {
  value: number;
  cycle: number;
  delayMs?: number;
  durationMs?: number;
  fractionDigits?: number;
  suffix?: string;
  formatter?: (v: number) => string;
}) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    let startTimestamp: number | undefined;
    let rafId: number | undefined;
    let timeoutId: number | undefined;
    const duration = durationMs;
    const q = Math.pow(10, Math.max(0, fractionDigits));

    setDisplayValue(0);

    const step = (timestamp: number) => {
      if (startTimestamp === undefined) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      const easeProgress = 1 - Math.pow(1 - progress, 5);
      const raw = easeProgress * value;
      const nextValue = fractionDigits > 0 ? Math.round(raw * q) / q : Math.round(raw);
      setDisplayValue((prev) => (prev === nextValue ? prev : nextValue));
      if (progress < 1) {
        rafId = window.requestAnimationFrame(step);
      }
    };

    timeoutId = window.setTimeout(() => {
      rafId = window.requestAnimationFrame(step);
    }, delayMs);

    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [value, cycle, delayMs, durationMs, fractionDigits]);

  const text = formatter
    ? formatter(displayValue)
    : displayValue.toLocaleString(undefined, {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      });
  return (
    <span>
      {text}
      {suffix}
    </span>
  );
}

interface DashboardProps {
  onLoanClick: (id: number) => void;
  onStatClick: (type: string) => void;
  onViewMap: () => void;
  onOpenView: (view: string) => void;
}

export default function Dashboard({ onLoanClick, onStatClick, onViewMap, onOpenView }: DashboardProps) {
  const {
    allLoans: loans,
    contracts,
    leads,
    expiringDocs,
    respaApps,
    source,
    importRowCount,
    applyImportRows,
    resetPortfolioToZero,
    clearImportedPortfolio,
  } = useCohiBuilderPortfolio();
  const portfolioFileRef = useRef<HTMLInputElement>(null);
  const [portfolioFileMsg, setPortfolioFileMsg] = useState<string | null>(null);
  const [portfolioFileErr, setPortfolioFileErr] = useState<string | null>(null);
  const activeBuilds = loans.length;
  const expiringSoon = loans.filter(l => l.daysToClose < 60).length;
  const [insightsStarted, setInsightsStarted] = useState(false);
  const [importBannerVisible, setImportBannerVisible] = useState(false);
  const importBannerTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  const [historyPopoverOpen, setHistoryPopoverOpen] = useState(false);
  /** When true, uploads merge: append rows whose dedup key is not already in storage (see `builderImportRowDedupKey`). */
  const [mergeNewRowsOnUpload, setMergeNewRowsOnUpload] = useState(true);
  const { funnelPeriod } = useFunnelPeriod();
  const isPortfolioEmpty = loans.length === 0 && contracts.length === 0 && leads.length === 0;
  const periodScale = FUNNEL_PERIOD_SCALE[funnelPeriod];
  /** Headline / KPI counts for the selected reporting window (aligned with funnel period control). */
  const periodCount = (n: number) =>
    isPortfolioEmpty ? 0 : Math.max(0, Math.round(Number(n) * periodScale));

  const [funnelPanel, setFunnelPanel] = useState<
    | 'contractsDue'
    | 'conditional'
    | 'final'
    | 'started'
    | 'appsTaken'
    | null
  >(null);
  const [punctualityPanel, setPunctualityPanel] = useState<'onTime' | 'offSchedule' | 'gap' | null>(null);
  
  // Capture Rate (preferred/captive share of signed contracts)
  /** Import rows map 1:1 to `loans[i]` + `contracts[i]` (see `buildPortfolioBundleFromImportRows`). */
  const parallelLoansContracts = loans.length > 0 && loans.length === contracts.length;
  const activePipelineLoanList = parallelLoansContracts
    ? loans.filter((_, i) => contracts[i]?.status !== 'Canceled')
    : loans;
  const preferredLoanList = parallelLoansContracts
    ? loans.filter((_, i) => contracts[i]?.status !== 'Canceled' && loans[i].isPreferred)
    : loans.filter((l) => l.isPreferred);
  const preferredLoans = preferredLoanList.length;
  const activeContractsCount = contracts.filter((c) => c.status !== 'Canceled').length;
  const canceledContractsCount = contracts.filter((c) => c.status === 'Canceled').length;
  const totalAgreementRows = contracts.length;
  const withdrawnFalloutRows = contracts.filter((c) => falloutKindFromContract(c) === 'withdrawn').length;
  const deniedFalloutRows = contracts.filter((c) => falloutKindFromContract(c) === 'denied').length;
  const preferredActiveContracts = contracts.filter(
    (c) => c.status !== 'Canceled' && (c.mortgageStatus ?? '').toLowerCase().includes('preferred'),
  ).length;
  const pipelineLoanCount = activePipelineLoanList.length;
  /** Demo: Loan Estimate issued (sent + dated) as RESPA originated files. */
  const respaOriginatedCount = respaApps.filter(
    (a) => a.leStatus === 'Sent' && Boolean(a.leDate && String(a.leDate).trim()),
  ).length;
  /** Demo: active (non-canceled) agreements as the HMDA final-status reporting universe. */
  const hmdaFinalStatusScopeCount = activeContractsCount;
  const kpiContext: Record<
    'active' | 'capture',
    { totalUnits: number; unitsLabel: string; avgDays: number | null; avgLabel: string }
  > = {
    active: {
      totalUnits: periodCount(pipelineLoanCount),
      unitsLabel: `active loans (${funnelPeriod.toUpperCase()})`,
      avgDays: avgDaysToClose(activePipelineLoanList),
      avgLabel: 'avg days to targeted funding',
    },
    capture: {
      totalUnits: periodCount(activeContractsCount),
      unitsLabel: `signed contracts (${funnelPeriod.toUpperCase()})`,
      avgDays: avgDaysToClose(preferredLoanList),
      avgLabel: 'avg days to funding (captured loans)',
    },
  };
  const criticalDocs = expiringDocs.filter((d) => d.status === 'critical').length;
  const respaAtRisk = respaApps.filter((a) => a.status === 'At Risk').length;
  const nonQmLoans = loans.filter((l) => l.isNonQM);

  const dismissImportBanner = () => {
    setImportBannerVisible(false);
    try {
      sessionStorage.setItem(IMPORT_BANNER_SESSION_DISMISSED_KEY, '1');
    } catch {
      /* private mode / SSR */
    }
    if (importBannerTimerRef.current != null) {
      window.clearTimeout(importBannerTimerRef.current);
      importBannerTimerRef.current = null;
    }
  };

  const showImportBannerAgain = () => {
    if (source === 'mock' || importRowCount <= 0) return;
    setImportBannerVisible(true);
    if (importBannerTimerRef.current != null) {
      window.clearTimeout(importBannerTimerRef.current);
    }
    importBannerTimerRef.current = window.setTimeout(() => {
      importBannerTimerRef.current = null;
      setImportBannerVisible(false);
    }, 10_000);
  };

  useEffect(() => {
    if (source === 'mock' || importRowCount <= 0) {
      setImportBannerVisible(false);
      if (importBannerTimerRef.current != null) {
        window.clearTimeout(importBannerTimerRef.current);
        importBannerTimerRef.current = null;
      }
      return;
    }
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem(IMPORT_BANNER_SESSION_DISMISSED_KEY) === '1';
    } catch {
      dismissed = false;
    }
    if (dismissed) {
      return;
    }
    setImportBannerVisible(true);
    if (importBannerTimerRef.current != null) {
      window.clearTimeout(importBannerTimerRef.current);
    }
    importBannerTimerRef.current = window.setTimeout(() => {
      importBannerTimerRef.current = null;
      setImportBannerVisible(false);
      try {
        sessionStorage.setItem(IMPORT_BANNER_SESSION_DISMISSED_KEY, '1');
      } catch {
        /* noop */
      }
    }, 10_000);
    return () => {
      if (importBannerTimerRef.current != null) {
        window.clearTimeout(importBannerTimerRef.current);
        importBannerTimerRef.current = null;
      }
    };
  }, [source, importRowCount]);

  useEffect(() => {
    if (!funnelPanel && !punctualityPanel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFunnelPanel(null);
        setPunctualityPanel(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [funnelPanel, punctualityPanel]);

  useEffect(() => {
    // Start funnel / insight numbers after the KPI row finishes its one-shot count-up (top-left → right).
    const totalMs = 3400;
    const t = window.setTimeout(() => setInsightsStarted(true), totalMs);
    return () => window.clearTimeout(t);
  }, []);

  const kpiLoans = periodCount(pipelineLoanCount);
  const kpiPreferredLoans = periodCount(preferredLoans);
  /** Active (non-canceled) agreement rows — aligns with Excel `Cancdt_2` and capture denominator. */
  const kpiTotalContractRows = periodCount(activeContractsCount);
  const kpiPreferredContractRows = periodCount(preferredActiveContracts);
  const captureRateWindow =
    kpiTotalContractRows > 0 ? Math.round((kpiPreferredContractRows / kpiTotalContractRows) * 100) : 0;
  const kpiRespaOriginated = periodCount(respaOriginatedCount);
  const kpiHmdaFinalScope = periodCount(hmdaFinalStatusScopeCount);
  const kpiRespaAppsTracked = periodCount(respaApps.length);
  const kpiRespaAtRiskWindow = periodCount(respaAtRisk);
  const kpiTotalAgreements = periodCount(totalAgreementRows);
  const kpiWithdrawnFallout = periodCount(withdrawnFalloutRows);
  const kpiDeniedFallout = periodCount(deniedFalloutRows);
  const withdrawnFalloutPct =
    kpiTotalAgreements > 0 ? Math.round((kpiWithdrawnFallout / kpiTotalAgreements) * 100) : 0;
  const deniedFalloutPct =
    kpiTotalAgreements > 0 ? Math.round((kpiDeniedFallout / kpiTotalAgreements) * 100) : 0;
  const captureNotCapturedPct =
    kpiTotalContractRows > 0 ? Math.max(0, 100 - captureRateWindow) : 0;

  const dynamicStats = [
    {
      id: 'active',
      label: 'Active Pipeline Volume',
      tooltipVariant: 'sky' as const,
      cardTooltip: `Active pipeline volume\n\nWhat it shows: Two scaled counts for ${funnelPeriod.toUpperCase()} — active pipeline loans and captured (TB) loans in that pipeline. Footer shows scaled loan count and avg days to funding.\n\nHow it’s calculated: When import rows align loans ↔ contracts, only loans whose contract is not Canceled count. Otherwise all loans count. Captured (TB) uses Capture_Indicator / TBI Mortgage on the loan row.\n\nTerms: Canceled agreements (Cancdt_2) are excluded from the active pipeline headline.\n\nDetail — ${funnelPeriod.toUpperCase()}: ${kpiTotalContractRows.toLocaleString()} active agreement rows · ${kpiPreferredLoans.toLocaleString()} captured (TB) loans in pipeline (scaled).`,
      badgeHelp: '',
      footerHelp:
        'Footer: scaled active loan count and average days to targeted funding / lock runway (directional, not a commitment date).',
      value: kpiLoans,
      pipelineDual: {
        pipelineLoans: kpiLoans,
        capturedTbLoans: kpiPreferredLoans,
      },
      change: '',
      icon: Users,
      color: 'blue',
      pastel: 'bg-sky-50/70 text-sky-600/90',
    },
    {
      id: 'capture',
      label: 'Mortgage Capture Rate',
      tooltipVariant: 'emerald' as const,
      cardTooltip: `Mortgage capture rate\n\nWhat it shows: Captured share vs not captured (external + pending/TBD) as two whole percents that sum to 100% for the window. Footer uses contract and captured-loan context.\n\nHow it’s calculated: Captured active contract rows ÷ all active (non-canceled) contract rows, scaled to ${funnelPeriod.toUpperCase()}. “Not captured” is the complement of that rounded captured %.\n\nTerms: Captured = Capture_Indicator is Y, Yes, 1, or True. External = explicit N/No. Pending = blank or unknown capture.\n\nDetail — ${funnelPeriod.toUpperCase()}: ${kpiPreferredContractRows.toLocaleString()} captured of ${kpiTotalContractRows.toLocaleString()} active contract rows.`,
      badgeHelp: '',
      footerHelp:
        'Footer: active contract count and average days to funding for captured (TB) loans still in the active pipeline.',
      value: captureRateWindow,
      captureDual: {
        capturedPct: captureRateWindow,
        notCapturedPct: captureNotCapturedPct,
      },
      change: '',
      icon: TrendingUp,
      color: 'emerald',
      pastel: 'bg-emerald-50/70 text-emerald-600/90',
    },
    {
      id: 'locks',
      label: 'PullThrough',
      tooltipVariant: 'amber' as const,
      cardTooltip: `RESPA originated vs HMDA final status (demo)\n\nWhat it shows: Two scaled counts for ${funnelPeriod.toUpperCase()}: files with a Loan Estimate issued (RESPA originated) and the active agreement universe used as “all HMDA final status” scope in this builder preview.\n\nHow it’s calculated: RESPA originated = RESPA tracker rows with LE status Sent and a dated Loan Estimate. HMDA scope = active (non-canceled) agreement rows, scaled like other KPIs.\n\nTerms: Not a regulatory filing; illustrative pairing for compliance-oriented review.\n\nDetail — ${funnelPeriod.toUpperCase()}: ${kpiRespaOriginated.toLocaleString()} RESPA LE issued · ${kpiHmdaFinalScope.toLocaleString()} agreements in HMDA scope · ${kpiRespaAppsTracked.toLocaleString()} apps on RESPA tracker · ${kpiRespaAtRiskWindow.toLocaleString()} at risk.`,
      badgeHelp: '',
      footerHelp:
        'Footer: scaled RESPA files with Loan Estimate issued for the window, then RESPA tracker volume and at-risk count (same period scale as other KPIs).',
      value: 0,
      respaHmda: {
        respaOriginated: kpiRespaOriginated,
        hmdaFinalScope: kpiHmdaFinalScope,
      },
      change: '',
      icon: ShieldCheck,
      color: 'amber',
      pastel: 'bg-amber-50/70 text-amber-600/90',
    },
    {
      id: 'risk',
      label: 'FallOut',
      tooltipVariant: 'rose' as const,
      cardTooltip: `FallOut — withdrawn vs denied\n\nWhat it shows: Two percentages of all agreement rows in ${funnelPeriod.toUpperCase()} (active + canceled). They are separate shares of the same denominator, not two parts of one 100% slice.\n\nHow it’s calculated: Withdrawn % = withdrawn fallout units ÷ total agreement rows. Denied % = denied fallout units ÷ same total. Canceled rows come from Cancdt_2 on import. Denied is inferred when mortgage status text suggests lender credit/policy decline; other canceled rows count as withdrawn.\n\nTerms: Fallout unit = one canceled agreement in the scaled window. Footer first line sums withdrawn + denied counts; second line is the denominator.\n\nDetail — ${kpiWithdrawnFallout.toLocaleString()} withdrawn · ${kpiDeniedFallout.toLocaleString()} denied · ${kpiTotalAgreements.toLocaleString()} agreement rows (denominator).`,
      badgeHelp: '',
      footerHelp:
        'Footer: total fallout units (withdrawn + denied) and total agreement rows used as the % denominator.',
      value: 0,
      fallout: {
        withdrawnPct: withdrawnFalloutPct,
        deniedPct: deniedFalloutPct,
        withdrawnUnits: kpiWithdrawnFallout,
        deniedUnits: kpiDeniedFallout,
        denominator: kpiTotalAgreements,
      },
      change: '',
      icon: UserX,
      color: 'red',
      pastel: 'bg-rose-50/70 text-rose-600/90',
    },
  ];

  const funnelData = isPortfolioEmpty
    ? [
        { name: 'Leads', value: 0 },
        { name: 'Contracts', value: 0 },
        { name: 'Apps', value: 0 },
      ]
    : [
        {
          name: 'Leads',
          value: leads.length + contracts.length + 20,
        },
        {
          name: 'Contracts',
          value: contracts.length + 5,
        },
        {
          name: 'Apps',
          value: loans.length,
        },
      ];

  const preferredPct = pipelineLoanCount ? Math.round((preferredLoans / pipelineLoanCount) * 100) : 0;
  const onTimeClosedCount = loans.filter(isOnTimeCloseDemo).length;
  const offScheduleClosedCount = Math.max(0, loans.length - onTimeClosedCount);
  const onTimePct = loans.length ? Math.round((onTimeClosedCount / loans.length) * 100) : 0;
  const offSchedulePct = loans.length ? Math.max(0, 100 - onTimePct) : 0;
  const onTimeTargetPct = 85;
  const onTimeGap = Math.max(0, onTimeTargetPct - onTimePct);
  const onTimeLoansList = loans.filter(isOnTimeCloseDemo);
  const offScheduleLoansList = loans.filter((l) => !isOnTimeCloseDemo(l));
  const punctualityMedianIntakeDays = cohortMedianIntakeDays(loans);
  const lateBottleneckSummary = summarizeLateBottlenecks(offScheduleLoansList, punctualityMedianIntakeDays);
  const lateBottleneckOrder: LateBottleneckBucket[] = [
    'intake',
    'underwriting',
    'lock',
    'construction',
    'other',
  ];
  const lateBucketMax = Math.max(
    1,
    ...lateBottleneckOrder.map((k) => lateBottleneckSummary.byBucket[k]),
  );
  const leadsCount = funnelData[0].value;
  const contractsCount = funnelData[1].value;
  const appsCount = funnelData[2].value;
  const scaledStartedCount = isPortfolioEmpty
    ? 0
    : Math.max(1, Math.round(leadsCount * periodScale));
  const scaledContractsCount = isPortfolioEmpty
    ? 0
    : Math.max(1, Math.round(contractsCount * periodScale));
  const scaledAppsCount = isPortfolioEmpty ? 0 : Math.max(1, Math.round(appsCount * periodScale));
  const startedAvgDaysMotion = Math.round(15 + periodScale * 5);
  const contractsWithDue = contracts.map((c) => ({
    ...c,
    dueInDays: syntheticContractDueDays(c.id),
  }));
  const contractsInDueWindow = contractsWithDue.filter(
    (c) => c.status !== 'Canceled' && c.dueInDays <= CONTRACT_DUE_WINDOW_DAYS,
  );
  const contractsUrgentDue = contractsInDueWindow.filter((c) => c.dueInDays <= 5);
  const activeContractsWithDue = contractsWithDue.filter((c) => c.status !== 'Canceled');
  const avgContractMilestoneDays =
    activeContractsWithDue.length > 0
      ? Math.round(
          activeContractsWithDue.reduce((sum, c) => sum + c.dueInDays, 0) / activeContractsWithDue.length,
        )
      : 0;
  const appsPipelineAvgDays = avgDaysToClose(activePipelineLoanList);
  const contractsFromStartedPct = scaledStartedCount
    ? Math.round((scaledContractsCount / scaledStartedCount) * 100)
    : 0;
  const appsFromContractsPctScaled = scaledContractsCount
    ? Math.round((scaledAppsCount / scaledContractsCount) * 100)
    : 0;
  const contractsPerStarted = scaledStartedCount ? scaledContractsCount / scaledStartedCount : 0;
  const appsPerContractScaled = scaledContractsCount ? scaledAppsCount / scaledContractsCount : 0;

  const conditionalDrillLoans = activePipelineLoanList.filter((l) => l.loanPreparedness < 80).slice(0, 6);
  const finalDrillContracts = contracts
    .filter(
      (c) =>
        c.status !== 'Canceled' && (c.mortgageStatus ?? '').toLowerCase().includes('preferred'),
    )
    .slice(0, 6);
  const startedDrillLeads = leads.slice(0, 14);
  const appsDrillLoans = activePipelineLoanList.slice(0, 14);
  const insightCycle = insightsStarted ? 1 : 0;

  const uploadHistory = useMemo(() => loadImportHistory(), [importRowCount, loans.length, historyTick]);

  const processPortfolioImportFile = async (file: File | null | undefined) => {
    if (!file) return;
    const { rows, error } = await parseBuilderImportFile(file);
    if (error) {
      setPortfolioFileErr(error);
      setPortfolioFileMsg(null);
      return;
    }
    if (rows.length === 0) {
      setPortfolioFileErr('No data rows found in this file (check headers and sheet).');
      setPortfolioFileMsg(null);
      return;
    }
    const useMerge = mergeNewRowsOnUpload && importRowCount > 0;
    const { saved, merge } = await applyImportRows(rows, {
      fileName: file.name,
      mode: useMerge ? 'merge_new' : 'replace',
      sourceLabel: useMerge
        ? `Capture Analysis merge: ${file.name}`
        : `Capture Analysis upload: ${file.name}`,
    });
    setPortfolioFileErr(null);
    if (merge) {
      setPortfolioFileMsg(
        `Reconciled ${file.name}: ${merge.incomingCount} row(s) in file → added ${merge.added} new, skipped ${merge.skippedDuplicate} duplicate(s). Portfolio now ${merge.finalRowCount.toLocaleString()} rows.${saved ? ' Saved to your account.' : ' Sign in to persist to the database.'}`,
      );
    } else {
      setPortfolioFileMsg(
        `Loaded ${rows.length} row(s); dashboard metrics updated.${saved ? ' Saved to your account.' : ' Sign in to persist to the database.'}`,
      );
    }
    setHistoryTick((t) => t + 1);
    window.setTimeout(() => setPortfolioFileMsg(null), 8000);
  };

  const onPortfolioFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    void processPortfolioImportFile(f);
  };

  return (
    <>
    <div className="space-y-6 sm:space-y-8 relative">
      <div className="relative z-40 flex flex-col gap-4">
        <AnimatePresence>
          {source !== 'mock' && importRowCount > 0 && importBannerVisible && (
            <motion.div
              key="import-banner"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="sticky top-0 z-50 flex justify-end w-full pointer-events-none"
            >
              <div
                role="status"
                aria-live="polite"
                title={`${contracts.length.toLocaleString()} rows · ${canceledContractsCount.toLocaleString()} canceled (Cancdt_2) · ${activeContractsCount.toLocaleString()} active (KPI denominator)`}
                className={`pointer-events-auto flex items-start gap-2 rounded-xl border px-3 py-2 shadow-sm backdrop-blur-md max-w-[min(100%,24rem)] ${
                  source === 'api'
                    ? 'bg-emerald-50/85 dark:bg-emerald-950/25 border-emerald-200/55 dark:border-emerald-800/40 text-emerald-900/95 dark:text-emerald-100/95'
                    : 'bg-amber-50/80 dark:bg-amber-950/25 border-amber-200/50 dark:border-amber-800/35 text-amber-950/90 dark:text-amber-50/95'
                }`}
              >
                <Info
                  className={`w-4 h-4 shrink-0 mt-0.5 ${
                    source === 'api'
                      ? 'text-emerald-600/90 dark:text-emerald-400/90'
                      : 'text-amber-600/85 dark:text-amber-400/85'
                  }`}
                  strokeWidth={2}
                  aria-hidden
                />
                <p className="text-[11px] sm:text-xs leading-snug font-medium flex-1 min-w-0">
                  <span className="block text-slate-700/95 dark:text-slate-200/95">
                    {importRowCount.toLocaleString()} rows loaded
                    {source === 'api' ? ' · saved to your account' : ' · browser only'}
                  </span>
                  <span className="block mt-1 text-[10px] font-normal tabular-nums tracking-tight text-slate-500/75 dark:text-slate-400/70 leading-snug">
                    {contracts.length.toLocaleString()} imported
                    <span className="mx-1 text-slate-400/50 dark:text-slate-500/50" aria-hidden>
                      ·
                    </span>
                    {canceledContractsCount.toLocaleString()} canceled
                    <span className="text-slate-400/65 dark:text-slate-500/65 font-normal"> (Cancdt_2)</span>
                    <span className="mx-1 text-slate-400/50 dark:text-slate-500/50" aria-hidden>
                      ·
                    </span>
                    {activeContractsCount.toLocaleString()} active
                  </span>
                  <span className="block mt-1 text-[10px] sm:text-[11px] font-normal text-slate-600/85 dark:text-slate-400/90">
                    Upload from the toolbar or Integrations (new rows append with dedupe by default).
                  </span>
                </p>
                <button
                  type="button"
                  onClick={dismissImportBanner}
                  className={`shrink-0 rounded-lg p-1 -m-0.5 transition-colors ${
                    source === 'api'
                      ? 'text-emerald-700/70 hover:bg-emerald-100/80 dark:text-emerald-300/80 dark:hover:bg-emerald-900/40'
                      : 'text-amber-800/65 hover:bg-amber-100/70 dark:text-amber-200/75 dark:hover:bg-amber-900/35'
                  }`}
                  aria-label="Dismiss import notice"
                >
                  <X className="w-4 h-4" strokeWidth={2} aria-hidden />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-3 xl:gap-5">
          <div className="relative z-10 min-w-0 flex flex-col gap-2 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-600/90 dark:text-sky-400/85 font-display">
              Capture analysis
            </p>
            <h1 className="font-display text-[1.65rem] sm:text-[1.85rem] font-semibold text-slate-900 dark:text-slate-50 leading-[1.15] tracking-tight">
              Overview
            </h1>
            <p className="text-xs sm:text-[13px] text-slate-500 dark:text-slate-400 max-w-xl leading-relaxed font-normal">
              Pipeline volume, pull-through to your shop, and funding on time vs. late to close—all for the period in the
              header (WTD through YTD).
            </p>
            {isPortfolioEmpty && (
              <p className="mt-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100/90 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 rounded-lg px-3 py-2 inline-block max-w-xl">
                Portfolio is empty (all metrics at zero). Use the portfolio toolbar to upload, export, or restore the built-in
                demo.
              </p>
            )}
          </div>

          <div
            className="w-full xl:w-auto xl:max-w-[min(100%,52rem)] shrink-0 rounded-xl border border-slate-200/70 dark:border-slate-700/80 bg-white/60 dark:bg-slate-900/40 backdrop-blur-sm px-2 py-2 sm:px-2.5 sm:py-2 shadow-sm overflow-visible"
            title="Portfolio toolbar: views, upload, templates, reset, history"
          >
          <input
            ref={portfolioFileRef}
            type="file"
            accept=".csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            className="sr-only"
            aria-label="Upload portfolio CSV or Excel (appends new rows with dedupe when data is already loaded)"
            onChange={onPortfolioFileChange}
          />
          <div className="flex flex-nowrap items-center gap-1 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
            <Tooltip text="Import backlog files, open the map or full loan list, export blank templates, and reset data. Uploads append new rows with dedupe when a portfolio is already loaded (Integrations for full replace/merge options).">
              <span
                tabIndex={0}
                className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-0.5 shrink-0 cursor-help rounded outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 focus-visible:ring-offset-1 leading-none py-1"
                title="Import, export, and manage pipeline data"
              >
                Portfolio
              </span>
            </Tooltip>
            <div className="h-4 w-px bg-slate-200/90 dark:bg-slate-600 shrink-0 self-center" aria-hidden />

            <div
              className="flex items-center gap-0.5 rounded-md bg-slate-100/90 dark:bg-slate-800/60 p-0.5 border border-slate-200/60 dark:border-slate-700/80 shrink-0"
              title="Map and list views"
            >
              <Tooltip text="Map — geographic view of loans in the pipeline (state-level pins).">
                <button
                  type="button"
                  onClick={onViewMap}
                  className="h-7 pl-1.5 pr-2 inline-flex items-center gap-1 rounded text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                  aria-label="Open portfolio map"
                  title="Open portfolio map"
                >
                  <MapIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                  <span className="text-[10px] font-semibold whitespace-nowrap leading-none">Map</span>
                </button>
              </Tooltip>
              <Tooltip text="List — open the full loan table with filters and search.">
                <button
                  type="button"
                  onClick={() => onStatClick('all')}
                  className="h-7 pl-1.5 pr-2 inline-flex items-center gap-1 rounded text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 hover:text-sky-600 dark:hover:text-sky-400 transition-colors"
                  aria-label="Open full loan list"
                  title="Open full loan list"
                >
                  <LayoutList className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                  <span className="text-[10px] font-semibold whitespace-nowrap leading-none">List</span>
                </button>
              </Tooltip>
            </div>

            <div className="h-4 w-px bg-slate-200/90 dark:bg-slate-600 shrink-0 self-center" aria-hidden />

            <Tooltip
              text={
                importRowCount === 0
                  ? 'Merge: available after your first portfolio load. When on, uploads append only new rows (deduped by loan number or buyer + community + agreement date).'
                  : mergeNewRowsOnUpload
                    ? 'Merge on — uploads append new rows only; duplicate keys are skipped.'
                    : 'Merge off — each upload replaces the entire portfolio.'
              }
            >
              <button
                type="button"
                aria-pressed={mergeNewRowsOnUpload}
                disabled={importRowCount === 0}
                onClick={() => importRowCount > 0 && setMergeNewRowsOnUpload((v) => !v)}
                title={
                  importRowCount === 0
                    ? 'Load data first to enable merge'
                    : mergeNewRowsOnUpload
                      ? 'Merge on: append new rows only'
                      : 'Merge off: replace all on upload'
                }
                className={`hidden h-7 px-2 inline-flex items-center gap-1 rounded-md border transition-colors shrink-0 ${
                  importRowCount === 0
                    ? 'border-slate-200/60 dark:border-slate-700 text-slate-300 dark:text-slate-600 cursor-not-allowed'
                    : mergeNewRowsOnUpload
                      ? 'border-sky-300/80 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300'
                      : 'border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
                aria-label="Toggle merge new rows only"
              >
                <GitMerge className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                <span className="text-[10px] font-semibold whitespace-nowrap leading-none">Merge</span>
              </button>
            </Tooltip>

            <Tooltip text="Upload a builder backlog file (.csv, .xlsx, .xls). With data already loaded, new rows append with dedupe; use Integrations to replace the full portfolio.">
              <button
                type="button"
                onClick={() => portfolioFileRef.current?.click()}
                className="h-7 pl-1.5 pr-2 inline-flex items-center gap-1 rounded-md border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900/50 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm transition-colors shrink-0"
                aria-label="Upload CSV or Excel"
                title="Upload portfolio file"
              >
                <UploadCloud className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400" strokeWidth={2} aria-hidden />
                <span className="text-[10px] font-semibold whitespace-nowrap leading-none">Upload</span>
              </button>
            </Tooltip>
            <Tooltip text="Download a blank CSV with the expected column layout for imports.">
              <button
                type="button"
                onClick={() => downloadBuilderImportTemplate()}
                className="h-7 pl-1.5 pr-2 inline-flex items-center gap-1 rounded-md border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900/50 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm transition-colors shrink-0"
                aria-label="Download CSV template"
                title="Download CSV template"
              >
                <FileDown className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" strokeWidth={2} aria-hidden />
                <span className="text-[10px] font-semibold whitespace-nowrap leading-none">CSV</span>
              </button>
            </Tooltip>
            <Tooltip text="Download a blank Excel workbook (.xlsx) with the same columns as the CSV template.">
              <button
                type="button"
                onClick={() => downloadBuilderImportTemplateXlsx()}
                className="h-7 pl-1.5 pr-2 inline-flex items-center gap-1 rounded-md border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900/50 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm transition-colors shrink-0"
                aria-label="Download Excel template"
                title="Download Excel template"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-indigo-600 dark:text-indigo-400" strokeWidth={2} aria-hidden />
                <span className="text-[10px] font-semibold whitespace-nowrap leading-none">XLSX</span>
              </button>
            </Tooltip>
            <Tooltip text="Reset — clear all loans and contracts after confirmation. Upload or restore to load data again.">
              <button
                type="button"
                onClick={() => {
                  if (
                    !window.confirm(
                      'Reset Data? All loans, contracts, and funnel counts will clear until you upload or restore again.',
                    )
                  ) {
                    return;
                  }
                  void (async () => {
                    await resetPortfolioToZero();
                    setPortfolioFileErr(null);
                    setPortfolioFileMsg('Portfolio cleared. Upload or restore to reload data.');
                    setHistoryTick((t) => t + 1);
                    window.setTimeout(() => setPortfolioFileMsg(null), 5000);
                  })();
                }}
                className="h-7 pl-1.5 pr-2 inline-flex items-center gap-1 rounded-md border border-rose-200/80 dark:border-rose-900/50 bg-rose-50/90 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 hover:bg-rose-100/90 dark:hover:bg-rose-950/50 transition-colors shrink-0"
                aria-label="Reset Data"
                title="Clear portfolio (confirm)"
              >
                <RotateCcw className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                <span className="text-[10px] font-semibold whitespace-nowrap leading-none">Reset</span>
              </button>
            </Tooltip>
            <Tooltip text="Restore — replace the current portfolio with the built-in seed spreadsheet (demo data).">
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm('Restore the built-in seed portfolio from spreadsheet rows (replaces current data)?')) return;
                  void (async () => {
                    await clearImportedPortfolio();
                    setPortfolioFileErr(null);
                    setPortfolioFileMsg('Portfolio restored from seed data.');
                    setHistoryTick((t) => t + 1);
                    window.setTimeout(() => setPortfolioFileMsg(null), 5000);
                  })();
                }}
                className="hidden h-7 pl-1.5 pr-2 inline-flex items-center gap-1 rounded-md border border-slate-200/80 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
                aria-label="Restore Data"
                title="Restore built-in demo data"
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                <span className="text-[10px] font-semibold whitespace-nowrap leading-none">Seed</span>
              </button>
            </Tooltip>

            <Popover open={historyPopoverOpen} onOpenChange={setHistoryPopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  title="Upload history — recent unique loads (deduped by content); up to five restorable snapshots"
                  aria-expanded={historyPopoverOpen}
                  aria-haspopup="dialog"
                  className="relative shrink-0 h-7 pl-1.5 pr-2 inline-flex items-center gap-1 rounded-md border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900/50 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-500/45 focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900 data-[state=open]:border-sky-300/70 dark:data-[state=open]:border-sky-600/50 data-[state=open]:bg-sky-50/80 dark:data-[state=open]:bg-sky-950/30"
                >
                  <History className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                  <span className="text-[10px] font-semibold whitespace-nowrap leading-none">History</span>
                  <ChevronDown
                    className={`h-3 w-3 shrink-0 opacity-50 transition-transform ${historyPopoverOpen ? 'rotate-180' : ''}`}
                    strokeWidth={2.5}
                    aria-hidden
                  />
                  {uploadHistory.length > 0 && (
                    <span className="absolute -top-1.5 -right-1 min-w-[1rem] h-4 px-0.5 flex items-center justify-center rounded-full bg-sky-500 text-[9px] font-bold text-white leading-none tabular-nums ring-2 ring-white dark:ring-slate-900">
                      {uploadHistory.length > 9 ? '9+' : uploadHistory.length}
                    </span>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                side="bottom"
                sideOffset={10}
                collisionPadding={12}
                className="z-[280] w-[min(calc(100vw-1.25rem),23rem)] p-0 overflow-hidden flex flex-col rounded-[1.125rem] border border-slate-200/90 bg-white/95 text-slate-900 shadow-[0_22px_50px_-12px_rgba(15,23,42,0.28)] backdrop-blur-xl dark:border-slate-600/60 dark:bg-slate-900/95 dark:text-slate-100"
                onCloseAutoFocus={(e) => e.preventDefault()}
              >
                <div className="shrink-0 border-b border-slate-200/70 bg-gradient-to-b from-slate-50/90 to-white/80 px-4 py-3 dark:border-slate-700/80 dark:from-slate-800/90 dark:to-slate-900/80">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/12 text-sky-700 ring-1 ring-sky-500/15 dark:bg-sky-500/15 dark:text-sky-300">
                      <History className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                          Upload history
                        </h2>
                        <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-700 dark:bg-slate-700/80 dark:text-slate-200">
                          {uploadHistory.length}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                        Stored in this browser. Duplicate imports (same row set) collapse to one history entry. Up to five
                        restorable snapshots; restore replaces the current portfolio.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="max-h-[min(22rem,65vh)] overflow-y-auto overscroll-contain px-3 py-3 [scrollbar-width:thin]">
                  {uploadHistory.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200/80 bg-slate-50/50 px-4 py-8 text-center dark:border-slate-700/60 dark:bg-slate-800/30">
                      <UploadCloud
                        className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600"
                        strokeWidth={1.25}
                        aria-hidden
                      />
                      <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">No uploads yet</p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                        After you import a file, entries appear here. Snapshots let you roll back to a prior load.
                      </p>
                    </div>
                  ) : (
                    <ul className="space-y-2.5">
                      {uploadHistory.map((ev) => {
                        const when = new Date(ev.savedAt);
                        const dateStr = Number.isNaN(when.getTime())
                          ? ev.savedAt
                          : when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
                        const subtitle = [ev.sourceLabel, ev.fileName].filter(Boolean).join(' · ');
                        return (
                          <li
                            key={ev.id}
                            className="rounded-xl border border-slate-200/75 bg-white/70 p-3 shadow-sm dark:border-slate-700/70 dark:bg-slate-800/40"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-xs font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                                {dateStr}
                              </p>
                              {ev.canRestoreFromSnapshot ? (
                                <span className="shrink-0 rounded-md bg-emerald-500/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
                                  Restorable
                                </span>
                              ) : (
                                <span className="shrink-0 rounded-md bg-slate-200/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600 dark:bg-slate-600/50 dark:text-slate-300">
                                  Log only
                                </span>
                              )}
                            </div>
                            {subtitle ? (
                              <p className="mt-1.5 text-[11px] leading-snug text-slate-600 dark:text-slate-300 line-clamp-2" title={subtitle}>
                                {subtitle}
                              </p>
                            ) : null}
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <span className="inline-flex items-center rounded-lg bg-slate-100/90 px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
                                {ev.rowCount.toLocaleString()} rows
                              </span>
                            </div>
                            {ev.canRestoreFromSnapshot ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const snap = getImportHistorySnapshot(ev.id);
                                  if (!snap?.length) return;
                                  if (
                                    !window.confirm(
                                      `Replace the current portfolio with this saved upload (${snap.length.toLocaleString()} rows from ${dateStr})?`,
                                    )
                                  ) {
                                    return;
                                  }
                                  void (async () => {
                                    const { saved } = await applyImportRows(snap, {
                                      sourceLabel: `Restored from history (${ev.fileName ?? 'snapshot'})`,
                                      persistSnapshot: false,
                                    });
                                    setPortfolioFileErr(null);
                                    setPortfolioFileMsg(
                                      `Restored ${snap.length.toLocaleString()} row(s) from history.${saved ? ' Saved to your account.' : ''}`,
                                    );
                                    setHistoryTick((t) => t + 1);
                                    setHistoryPopoverOpen(false);
                                    window.setTimeout(() => setPortfolioFileMsg(null), 8000);
                                  })();
                                }}
                                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-sky-200/80 bg-sky-500/10 py-2 text-[11px] font-semibold text-sky-900 transition-colors hover:bg-sky-500/18 dark:border-sky-700/60 dark:bg-sky-950/50 dark:text-sky-100 dark:hover:bg-sky-900/40"
                              >
                                Restore this version
                                <ChevronRight className="h-3.5 w-3.5 opacity-70" strokeWidth={2.5} aria-hidden />
                              </button>
                            ) : (
                              <p className="mt-2 text-[10px] leading-snug text-slate-400 dark:text-slate-500">
                                No row snapshot was kept for this event.
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </PopoverContent>
            </Popover>

            {source !== 'mock' && importRowCount > 0 && !importBannerVisible && (
              <Tooltip text="Show the loaded-row summary (browser vs saved, canceled vs active). Hides again after 10 seconds.">
                <button
                  type="button"
                  onClick={showImportBannerAgain}
                  className="h-7 px-2 inline-flex items-center gap-1 rounded-md border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900/50 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-[10px] font-semibold whitespace-nowrap shrink-0"
                >
                  <Info className="h-3.5 w-3.5 shrink-0 opacity-80" strokeWidth={2} aria-hidden />
                  Load info
                </button>
              </Tooltip>
            )}
          </div>
          {(portfolioFileErr || portfolioFileMsg) && (
            <div className="mt-3 space-y-2">
              {portfolioFileErr && (
                <p className="rounded-lg border border-rose-200/70 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-900" role="alert">
                  {portfolioFileErr}
                </p>
              )}
              {portfolioFileMsg && (
                <p className="rounded-lg border border-emerald-200/70 bg-emerald-50/90 px-3 py-2 text-xs font-medium text-emerald-900" role="status">
                  {portfolioFileMsg}
                </p>
              )}
            </div>
          )}
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 relative z-10">
        {dynamicStats.map((stat, index) => {
          const fo = 'fallout' in stat && stat.fallout ? stat.fallout : null;
          const pd = 'pipelineDual' in stat && stat.pipelineDual ? stat.pipelineDual : null;
          const cd = 'captureDual' in stat && stat.captureDual ? stat.captureDual : null;
          const rh = 'respaHmda' in stat && stat.respaHmda ? stat.respaHmda : null;
          return (
            <motion.div
              key={stat.id}
              initial={{ opacity: 0, x: -14, y: -10 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              transition={{ delay: index * 0.09, duration: 0.58, ease: [0.22, 1, 0.36, 1] }}
              onClick={() => onStatClick(stat.id)}
              className="card-base p-5 sm:p-6 cursor-pointer flex flex-col min-h-[188px] sm:min-h-[200px] group/stat"
            >
              <Tooltip variant={stat.tooltipVariant} text={stat.cardTooltip}>
                <div
                  tabIndex={0}
                  className="flex min-h-[188px] sm:min-h-[200px] flex-1 flex-col rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-sky-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900"
                >
                  <div className="flex items-start gap-3 -m-1 p-1">
                    <div
                      className={`p-2.5 rounded-2xl ${stat.pastel} ring-1 ring-white/60 dark:ring-white/10 shadow-sm shrink-0 transition-transform duration-300 group-hover/stat:scale-[1.03]`}
                    >
                      <stat.icon size={20} strokeWidth={1.75} />
                    </div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400 leading-tight pt-2 max-w-[14rem]">
                      {stat.label}
                    </p>
                  </div>
              <div className="mt-2 flex min-h-[3.25rem] flex-1 flex-col justify-end">
                {fo ? (
                  <div className="flex w-full flex-col gap-2.5">
                    <div className="flex items-baseline justify-between gap-2 border-b border-slate-200/70 pb-2 dark:border-slate-700/70">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Withdrawn units
                      </span>
                      <span className="text-[28px] sm:text-[32px] font-bold tabular-nums tracking-tight text-slate-900 dark:text-slate-50">
                        {fo.withdrawnPct}%
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Denied units
                      </span>
                      <span className="text-[28px] sm:text-[32px] font-bold tabular-nums tracking-tight text-slate-900 dark:text-slate-50">
                        {fo.deniedPct}%
                      </span>
                    </div>
                  </div>
                ) : pd ? (
                  <div className="flex w-full flex-col gap-2.5">
                    <div className="flex items-baseline justify-between gap-2 border-b border-sky-200/70 pb-2 dark:border-sky-900/40">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Pipeline loans
                      </span>
                      <span className="text-[28px] sm:text-[32px] font-bold tabular-nums tracking-tight text-slate-900 dark:text-slate-50">
                        {pd.pipelineLoans.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Captured (TB) loans
                      </span>
                      <span className="text-[28px] sm:text-[32px] font-bold tabular-nums tracking-tight text-slate-900 dark:text-slate-50">
                        {pd.capturedTbLoans.toLocaleString()}
                      </span>
                    </div>
                  </div>
                ) : cd ? (
                  <div className="flex w-full flex-col gap-2.5">
                    <div className="flex items-baseline justify-between gap-2 border-b border-emerald-200/70 pb-2 dark:border-emerald-900/40">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Captured share
                      </span>
                      <span className="text-[28px] sm:text-[32px] font-bold tabular-nums tracking-tight text-slate-900 dark:text-slate-50">
                        {cd.capturedPct}%
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Not captured
                      </span>
                      <span className="text-[28px] sm:text-[32px] font-bold tabular-nums tracking-tight text-slate-900 dark:text-slate-50">
                        {cd.notCapturedPct}%
                      </span>
                    </div>
                  </div>
                ) : rh ? (
                  <div className="flex w-full flex-col gap-2.5">
                    <div className="flex items-baseline justify-between gap-2 border-b border-amber-200/70 pb-2 dark:border-amber-900/40">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        RESPA originated
                      </span>
                      <span className="text-[28px] sm:text-[32px] font-bold tabular-nums tracking-tight text-slate-900 dark:text-slate-50">
                        {rh.respaOriginated.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        All HMDA final status
                      </span>
                      <span className="text-[28px] sm:text-[32px] font-bold tabular-nums tracking-tight text-slate-900 dark:text-slate-50">
                        {rh.hmdaFinalScope.toLocaleString()}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-end justify-between gap-2">
                    <h3 className="text-[32px] sm:text-[36px] font-bold glass-text tracking-tight leading-none">
                      <AnimatedNumber
                        value={stat.value}
                        suffix={stat.suffix ?? ''}
                        cycle={0}
                        delayMs={100 + index * 220}
                        durationMs={2000}
                      />
                    </h3>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Tooltip variant={stat.tooltipVariant} text={stat.badgeHelp}>
                        <span
                          tabIndex={0}
                          className={`text-[10px] sm:text-xs font-medium px-2.5 sm:px-3 py-1 rounded-full tracking-wide text-right leading-snug max-w-[11rem] sm:max-w-[13rem] cursor-help outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-sky-500/40 ${
                            stat.color === 'blue'
                              ? 'bg-sky-100/60 text-sky-700/90'
                              : stat.color === 'amber'
                                ? 'bg-amber-100/60 text-amber-700/90'
                                : stat.color === 'red'
                                  ? 'bg-rose-100/60 text-rose-700/90'
                                  : stat.color === 'emerald'
                                    ? 'bg-emerald-100/60 text-emerald-700/90'
                                    : 'bg-slate-100/60 text-slate-700/90'
                          }`}
                        >
                          {stat.change}
                        </span>
                      </Tooltip>
                    </div>
                  </div>
                )}
              </div>
              {(() => {
                if (fo) {
                  const fh = stat.footerHelp ?? '';
                  const totalFallout = fo.withdrawnUnits + fo.deniedUnits;
                  return (
                    <Tooltip variant={stat.tooltipVariant} text={fh}>
                      <div
                        tabIndex={0}
                        className="mt-3 cursor-help space-y-1 rounded-b-lg border-t border-slate-200/70 px-1 py-3 pt-3 text-[11px] leading-snug text-slate-600 outline-none focus-visible:ring-2 focus-visible:ring-sky-500/30 -mx-1 dark:border-slate-700/70 dark:text-slate-400"
                      >
                        <p>
                          <span className="font-bold tabular-nums text-slate-800 dark:text-slate-200">
                            {totalFallout.toLocaleString()}
                          </span>
                          <span className="text-slate-500 dark:text-slate-400">
                            {' '}
                            fallout units ({funnelPeriod.toUpperCase()})
                          </span>
                        </p>
                        <p>
                          <span className="font-bold tabular-nums text-slate-800 dark:text-slate-200">
                            {fo.denominator.toLocaleString()}
                          </span>
                          <span className="text-slate-500 dark:text-slate-400"> agreement rows in window</span>
                        </p>
                      </div>
                    </Tooltip>
                  );
                }
                if (stat.id === 'locks') {
                  const fh = stat.footerHelp ?? '';
                  return (
                    <Tooltip variant={stat.tooltipVariant} text={fh}>
                      <div
                        tabIndex={0}
                        className="mt-3 cursor-help space-y-1 rounded-b-lg border-t border-slate-200/70 px-1 pt-3 text-[11px] leading-snug text-slate-600 outline-none focus-visible:ring-2 focus-visible:ring-sky-500/30 -mx-1 dark:border-slate-700/70 dark:text-slate-400"
                      >
                        <p>
                          <span className="font-bold tabular-nums text-slate-800 dark:text-slate-200">
                            {kpiRespaOriginated.toLocaleString()}
                          </span>
                          <span className="text-slate-500 dark:text-slate-400">
                            {' '}
                            RESPA LE issued ({funnelPeriod.toUpperCase()})
                          </span>
                        </p>
                        <p>
                          <span className="font-bold tabular-nums text-slate-800 dark:text-slate-200">
                            {kpiRespaAppsTracked.toLocaleString()}
                          </span>
                          <span className="text-slate-500 dark:text-slate-400"> on RESPA tracker · </span>
                          <span className="font-bold tabular-nums text-slate-800 dark:text-slate-200">
                            {kpiRespaAtRiskWindow.toLocaleString()}
                          </span>
                          <span className="text-slate-500 dark:text-slate-400"> at risk</span>
                        </p>
                      </div>
                    </Tooltip>
                  );
                }
                const meta = kpiContext[stat.id as keyof typeof kpiContext];
                if (!meta) return null;
                const fh = 'footerHelp' in stat ? stat.footerHelp : '';
                return (
                  <Tooltip variant={stat.tooltipVariant} text={fh}>
                    <div
                      tabIndex={0}
                      className="mt-3 pt-3 border-t border-slate-200/70 text-[11px] text-slate-600 dark:text-slate-400 space-y-1 leading-snug rounded-b-lg cursor-help outline-none focus-visible:ring-2 focus-visible:ring-sky-500/30 -mx-1 px-1"
                    >
                      <p>
                        <span className="font-bold text-slate-800 dark:text-slate-200 tabular-nums">{meta.totalUnits.toLocaleString()}</span>
                        <span className="text-slate-500 dark:text-slate-400"> {meta.unitsLabel}</span>
                      </p>
                      <p>
                        <span className="font-bold text-slate-800 dark:text-slate-200 tabular-nums">
                          {meta.avgDays != null ? `${meta.avgDays}d` : '—'}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400"> {meta.avgLabel}</span>
                      </p>
                    </div>
                  </Tooltip>
                );
              })()}
                </div>
              </Tooltip>
            </motion.div>
          );
        })}
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 relative z-10">
        <Tooltip text="Contract-to-mortgage funnel for builder programs: volume from started prospects → signed contracts → applications on the preferred or captive channel. Reporting window (WTD/MTD/QTR/YTD) is set in the header next to Capture Analysis / Integrations.">
          <motion.div
            initial={{ opacity: 0, x: -12, y: -12 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            transition={{ delay: 0.28, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="card-base p-6 sm:p-7 relative z-20 !overflow-visible"
          >
            <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-600/90 dark:text-sky-400/85 font-display">
                  Pipeline funnel
                </p>
                <h3 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                  Contract and capture funnel
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md leading-relaxed">
                  Prospects in your pipeline, then builder purchase contracts, then applications with you. Counts match the
                  header period (WTD / MTD / QTR / YTD).
                </p>
              </div>
              <div className="shrink-0 rounded-2xl border border-slate-200/50 bg-gradient-to-br from-white/80 to-slate-50/60 p-2.5 text-sky-600/90 shadow-sm ring-1 ring-white/70 dark:border-slate-600/40 dark:from-slate-800/80 dark:to-slate-900/60 dark:text-sky-400/90 dark:ring-white/5">
                <TrendingUp size={18} strokeWidth={1.75} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              <Tooltip text={funnelContractsCardTooltip()}>
                <div className="cb-inner-panel backdrop-blur-sm p-4 sm:p-5 text-left group flex h-full min-h-[11rem] flex-col relative overflow-hidden before:absolute before:left-0 before:top-3 before:bottom-3 before:w-[3px] before:rounded-full before:bg-gradient-to-b before:from-sky-400 before:to-indigo-500 before:opacity-90">
                  <div className="flex items-start justify-between gap-2 pl-2">
                    <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-[0.14em]">
                      Contracts
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wide text-sky-600 opacity-0 group-hover:opacity-100 transition-opacity hidden sm:inline shrink-0">
                      View
                    </span>
                  </div>
                  <div className="mt-2 flex min-h-0 flex-1 flex-col pl-2 pr-1">
                    <button
                      type="button"
                      onClick={() => setFunnelPanel('contractsDue')}
                      className="flex min-h-0 w-full flex-1 flex-col rounded-lg pb-0.5 text-left outline-none transition-colors hover:bg-white/30 dark:hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-sky-500/40 cursor-pointer"
                      aria-label={`Contracts due within ${CONTRACT_DUE_WINDOW_DAYS} days — milestones and loans`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Avg days remaining</span>
                        <ChevronRight
                          className="h-3.5 w-3.5 shrink-0 text-sky-600/70 opacity-0 group-hover:opacity-100 transition-opacity"
                          strokeWidth={2.5}
                          aria-hidden
                        />
                      </span>
                      <div className="mt-1 flex items-baseline justify-between gap-3">
                        <div className="flex flex-wrap items-baseline gap-1 text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">
                          {insightsStarted ? (
                            <>
                              <AnimatedNumber
                                value={avgContractMilestoneDays}
                                cycle={insightCycle}
                                delayMs={240}
                                durationMs={1400}
                              />
                              <span className="text-base font-bold text-slate-600 dark:text-slate-400">days</span>
                            </>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </div>
                        <div className="text-[10px] font-semibold px-2.5 py-1 rounded-full border border-slate-200/60 dark:border-slate-600/50 bg-gradient-to-r from-sky-500/20 to-indigo-500/10 dark:from-sky-500/15 dark:to-indigo-500/10 text-slate-700 dark:text-slate-200 text-right leading-tight">
                          {insightsStarted ? (
                            <>
                              <span className="block">
                                <AnimatedNumber
                                  value={contractsFromStartedPct}
                                  suffix="%"
                                  cycle={insightCycle}
                                  delayMs={500}
                                  durationMs={1200}
                                />{' '}
                                <span className="font-medium text-slate-600 dark:text-slate-400">of started</span>
                              </span>
                              <span className="mt-0.5 block font-medium text-slate-600 dark:text-slate-400 tabular-nums">
                                <AnimatedNumber
                                  value={contractsInDueWindow.length}
                                  cycle={insightCycle}
                                  delayMs={400}
                                  durationMs={1000}
                                />{' '}
                                units ≤{CONTRACT_DUE_WINDOW_DAYS}d
                              </span>
                            </>
                          ) : (
                            <span className="text-slate-600/70 dark:text-slate-400/80">—</span>
                          )}
                        </div>
                      </div>
                      {insightsStarted && contractsUrgentDue.length > 0 && (
                        <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                          <AlertTriangle size={12} className="shrink-0" aria-hidden />
                          {contractsUrgentDue.length} urgent (≤5d to milestone)
                        </p>
                      )}
                      {insightsStarted && contractsUrgentDue.length === 0 && contractsInDueWindow.length > 0 && (
                        <p className="mt-2 text-[11px] font-medium text-amber-800/90 dark:text-amber-200/90">
                          {contractsInDueWindow.length} due within {CONTRACT_DUE_WINDOW_DAYS} days — open list for milestones
                        </p>
                      )}
                      {insightsStarted && (
                        <p className="mt-auto pt-2 text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
                          <span className="font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                            {scaledContractsCount}
                          </span>
                          <span className="font-medium text-slate-600 dark:text-slate-400">
                            {' '}
                            contract units in funnel ({funnelPeriod.toUpperCase()})
                          </span>
                        </p>
                      )}
                    </button>
                  </div>
                </div>
              </Tooltip>

              <Tooltip text={FUNNEL_STARTED_CARD_TOOLTIP}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setFunnelPanel('started')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setFunnelPanel('started');
                    }
                  }}
                  className="cb-inner-panel backdrop-blur-sm p-4 sm:p-5 text-left outline-none cursor-pointer focus-visible:ring-2 focus-visible:ring-sky-500/40 group flex h-full min-h-[11rem] flex-col relative overflow-hidden before:absolute before:left-0 before:top-3 before:bottom-3 before:w-[3px] before:rounded-full before:bg-gradient-to-b before:from-sky-400 before:to-indigo-500 before:opacity-90"
                >
                  <div className="flex items-start justify-between gap-2 pl-2">
                    <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-[0.14em]">
                      Started
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wide text-sky-600 opacity-0 group-hover:opacity-100 transition-opacity hidden sm:inline shrink-0">
                      View
                    </span>
                  </div>
                  <div className="mt-2 flex min-h-0 flex-1 flex-col pl-2 pr-1">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Pipeline volume</span>
                    <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
                      <div className="flex flex-wrap items-baseline gap-1.5 text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">
                        {insightsStarted ? (
                          <>
                            <AnimatedNumber
                              value={scaledStartedCount}
                              cycle={insightCycle}
                              delayMs={360}
                              durationMs={1400}
                            />
                            <span className="text-base font-bold text-slate-600 dark:text-slate-400">units</span>
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </div>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
                      {insightsStarted ? (
                        <>
                          Average{' '}
                          <span className="font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                            <AnimatedNumber
                              value={startedAvgDaysMotion}
                              cycle={insightCycle}
                              delayMs={400}
                              durationMs={1200}
                            />
                          </span>
                          {' '}days in pipeline
                        </>
                      ) : (
                        <span className="text-slate-400">Average … days in pipeline</span>
                      )}
                    </p>
                    <p className="mt-auto pt-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      Tap to preview prospects
                    </p>
                  </div>
                </div>
              </Tooltip>

              <Tooltip text={FUNNEL_APPS_CARD_TOOLTIP}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setFunnelPanel('appsTaken')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setFunnelPanel('appsTaken');
                    }
                  }}
                  className="cb-inner-panel backdrop-blur-sm p-4 sm:p-5 text-left outline-none cursor-pointer focus-visible:ring-2 focus-visible:ring-sky-500/40 group flex h-full min-h-[11rem] flex-col relative overflow-hidden before:absolute before:left-0 before:top-3 before:bottom-3 before:w-[3px] before:rounded-full before:bg-gradient-to-b before:from-sky-400 before:to-indigo-500 before:opacity-90"
                >
                  <div className="flex items-start justify-between gap-2 pl-2">
                    <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-[0.14em]">
                      RESPA apps
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wide text-sky-600 opacity-0 group-hover:opacity-100 transition-opacity hidden sm:inline shrink-0">
                      View
                    </span>
                  </div>
                  <div className="mt-2 flex min-h-0 flex-1 flex-col pl-2 pr-1">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Application volume</span>
                    <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
                      <div className="flex flex-wrap items-baseline gap-1.5 text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">
                        {insightsStarted ? (
                          <>
                            <AnimatedNumber
                              value={scaledAppsCount}
                              cycle={insightCycle}
                              delayMs={480}
                              durationMs={1400}
                            />
                            <span className="text-base font-bold text-slate-600 dark:text-slate-400">units</span>
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </div>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
                      {insightsStarted ? (
                        appsPipelineAvgDays != null ? (
                          <>
                            Average{' '}
                            <span className="font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                              <AnimatedNumber
                                value={appsPipelineAvgDays}
                                cycle={insightCycle}
                                delayMs={500}
                                durationMs={1200}
                              />
                            </span>
                            {' '}days in pipeline
                          </>
                        ) : (
                          <span className="text-slate-400">Average … days in pipeline</span>
                        )
                      ) : (
                        <span className="text-slate-400">Average … days in pipeline</span>
                      )}
                    </p>
                    {insightsStarted && (
                      <p className="mt-2 text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                        <AnimatedNumber
                          value={appsFromContractsPctScaled}
                          suffix="%"
                          cycle={insightCycle}
                          delayMs={560}
                          durationMs={1200}
                        />{' '}
                        <span className="font-medium text-slate-600 dark:text-slate-400">of contracts</span>
                      </p>
                    )}
                    <p className="mt-auto pt-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      Tap to preview applications
                    </p>
                  </div>
                </div>
              </Tooltip>
            </div>

            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              {(
                [
                  {
                    id: 'conditional' as const,
                    label: 'Conditional approval',
                    pct: contractsPerStarted * 100,
                    unitsLine: insightsStarted
                      ? `${scaledContractsCount.toLocaleString()} contracts · ${scaledStartedCount.toLocaleString()} started`
                      : '—',
                  },
                  {
                    id: 'final' as const,
                    label: 'Final approval',
                    pct: appsPerContractScaled * 100,
                    unitsLine: insightsStarted
                      ? `${scaledAppsCount.toLocaleString()} apps · ${scaledContractsCount.toLocaleString()} contracts`
                      : '—',
                  },
                ] as const
              ).map((m, i) => (
                <Tooltip key={m.id} text={FUNNEL_SUBROW_TOOLTIPS[m.id]}>
                  <button
                    type="button"
                    onClick={() => setFunnelPanel(m.id)}
                    className={`cb-inner-panel backdrop-blur-sm p-4 sm:p-5 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 w-full h-full min-h-[8.25rem] relative overflow-hidden group/sub ${
                      m.id === 'conditional'
                        ? 'before:absolute before:left-0 before:top-3 before:bottom-3 before:w-[3px] before:rounded-full before:bg-gradient-to-b before:from-teal-400 before:to-emerald-600'
                        : 'before:absolute before:left-0 before:top-3 before:bottom-3 before:w-[3px] before:rounded-full before:bg-gradient-to-b before:from-violet-400 before:to-fuchsia-500'
                    } before:opacity-90`}
                  >
                    <div className="pl-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-[0.14em]">
                      {m.label}
                    </div>
                    <div className="pl-2 mt-1.5 text-2xl font-semibold text-slate-900 dark:text-slate-50 tabular-nums tracking-tight">
                      {insightsStarted ? (
                        <AnimatedNumber
                          value={m.pct}
                          suffix="%"
                          cycle={insightCycle}
                          delayMs={680 + i * 120}
                          durationMs={1300}
                          fractionDigits={1}
                        />
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">—</span>
                      )}
                    </div>
                    <p className="pl-2 mt-2 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums leading-snug">
                      {m.unitsLine}
                    </p>
                    <div className="pl-2 mt-3 flex items-center justify-end gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-600 dark:text-sky-400">
                        Details
                      </span>
                      <ChevronRight
                        className="h-3.5 w-3.5 text-sky-500/70 opacity-60 group-hover/sub:opacity-100 transition-opacity"
                        strokeWidth={2.5}
                        aria-hidden
                      />
                    </div>
                  </button>
                </Tooltip>
              ))}
            </div>

            {/* Balances vertical space vs. Close punctuality card; right column emphasizes drills */}
            <div className="mt-6 lg:mt-7 grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
              {!isPortfolioEmpty ? (
                <>
                  <div className="cb-inner-panel backdrop-blur-sm p-4 sm:p-5 flex flex-col min-h-[9rem]">
                    <div className="flex items-center gap-2.5 mb-3">
                      <div className="rounded-xl bg-sky-500/12 p-2 text-sky-700 dark:text-sky-300 ring-1 ring-sky-500/15">
                        <ListChecks className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                      </div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600 dark:text-slate-400">
                        Pipeline snapshot
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                      <span className="inline-flex items-center rounded-md bg-slate-900/[0.04] dark:bg-white/[0.06] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                        {funnelPeriod.toUpperCase()}
                      </span>
                      <span className="text-slate-400 dark:text-slate-500 px-0.5">·</span>
                      <span className="text-slate-600 dark:text-slate-400 text-[13px]">Flow</span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] sm:text-sm text-slate-800 dark:text-slate-100 font-medium">
                      <span className="tabular-nums rounded-lg bg-white/50 dark:bg-slate-800/50 px-2.5 py-1 ring-1 ring-slate-200/40 dark:ring-slate-600/30">
                        {insightsStarted ? scaledStartedCount.toLocaleString() : '—'}
                        <span className="ml-1 text-[11px] font-normal text-slate-500 dark:text-slate-400">started</span>
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600 shrink-0" aria-hidden />
                      <span className="tabular-nums rounded-lg bg-white/50 dark:bg-slate-800/50 px-2.5 py-1 ring-1 ring-slate-200/40 dark:ring-slate-600/30">
                        {insightsStarted ? scaledContractsCount.toLocaleString() : '—'}
                        <span className="ml-1 text-[11px] font-normal text-slate-500 dark:text-slate-400">contracts</span>
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600 shrink-0" aria-hidden />
                      <span className="tabular-nums rounded-lg bg-white/50 dark:bg-slate-800/50 px-2.5 py-1 ring-1 ring-slate-200/40 dark:ring-slate-600/30">
                        {insightsStarted ? scaledAppsCount.toLocaleString() : '—'}
                        <span className="ml-1 text-[11px] font-normal text-slate-500 dark:text-slate-400">apps</span>
                      </span>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className="text-[11px] font-medium px-3 py-1.5 rounded-full bg-sky-500/10 text-sky-900 dark:text-sky-100 border border-sky-400/20 dark:border-sky-500/25">
                        {periodCount(contractsInDueWindow.length)} contract
                        {periodCount(contractsInDueWindow.length) === 1 ? '' : 's'} due ≤{CONTRACT_DUE_WINDOW_DAYS}d ·{' '}
                        {funnelPeriod.toUpperCase()}
                      </span>
                      {kpiTotalContractRows > 0 && (
                        <span className="text-[11px] font-medium px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-900 dark:text-emerald-100 border border-emerald-400/20 dark:border-emerald-500/25">
                          {captureRateWindow}% captured · {kpiTotalContractRows.toLocaleString()} contract
                          {kpiTotalContractRows === 1 ? '' : 's'} · {funnelPeriod.toUpperCase()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="cb-inner-panel backdrop-blur-sm p-4 sm:p-5 flex flex-col min-h-[9rem]">
                    <div className="flex items-center gap-2.5 mb-3">
                      <div className="rounded-xl bg-indigo-500/12 p-2 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-500/15">
                        <Sparkles className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                      </div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600 dark:text-slate-400">
                        Quick drills
                      </p>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                      Jump to the same drill-downs as the funnel tiles—handy when you are reading rates beside narrative context.
                    </p>
                    <ul className="space-y-1 flex-1">
                      <li>
                        <button
                          type="button"
                          onClick={() => setFunnelPanel('started')}
                          className="text-left w-full rounded-xl px-3 py-2 hover:bg-white/55 dark:hover:bg-white/[0.06] transition-colors text-[13px] font-medium text-slate-800 dark:text-slate-100 flex items-center justify-between gap-2 group/q"
                        >
                          <span>Started prospects</span>
                          <ChevronRight className="h-4 w-4 text-sky-500/50 group-hover/q:text-sky-600 shrink-0" aria-hidden />
                        </button>
                      </li>
                      <li>
                        <button
                          type="button"
                          onClick={() => setFunnelPanel('contractsDue')}
                          className="text-left w-full rounded-xl px-3 py-2 hover:bg-white/55 dark:hover:bg-white/[0.06] transition-colors text-[13px] font-medium text-slate-800 dark:text-slate-100 flex items-center justify-between gap-2 group/q"
                        >
                          <span>Contracts & milestones</span>
                          <ChevronRight className="h-4 w-4 text-sky-500/50 group-hover/q:text-sky-600 shrink-0" aria-hidden />
                        </button>
                      </li>
                      <li>
                        <button
                          type="button"
                          onClick={() => setFunnelPanel('appsTaken')}
                          className="text-left w-full rounded-xl px-3 py-2 hover:bg-white/55 dark:hover:bg-white/[0.06] transition-colors text-[13px] font-medium text-slate-800 dark:text-slate-100 flex items-center justify-between gap-2 group/q"
                        >
                          <span>RESPA Apps Taken</span>
                          <ChevronRight className="h-4 w-4 text-indigo-500/50 group-hover/q:text-indigo-500 shrink-0" aria-hidden />
                        </button>
                      </li>
                    </ul>
                  </div>
                </>
              ) : (
                <div className="lg:col-span-2 rounded-2xl border border-dashed border-slate-200/70 dark:border-slate-600/50 bg-white/[0.06] dark:bg-slate-900/20 p-5 text-center text-sm text-slate-500 dark:text-slate-400">
                  Import or restore portfolio data to see pipeline snapshot and drill shortcuts.
                </div>
              )}
            </div>
          </motion.div>
        </Tooltip>

        <Tooltip text="Share of funded files that met committed close dates vs. those that slipped — a direct read on execution, builder relations, and revenue timing. (Demo split derived from portfolio records.)">
          <motion.div
            initial={{ opacity: 0, x: -10, y: -10 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            transition={{ delay: 0.38, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="card-base relative z-10 p-6 sm:p-7"
          >
            <div className="flex items-start justify-between gap-4 mb-6">
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-600/90 dark:text-emerald-400/85 font-display">
                  Execution
                </p>
                <h3 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">Close On Time</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md leading-relaxed">
                  Loans that funded on or before committed COE (close of escrow) vs. those that closed late (after COE or past your program target).
                </p>
              </div>
              <div className="shrink-0 p-2.5 rounded-2xl bg-gradient-to-br from-emerald-50/90 to-teal-50/50 border border-emerald-200/40 text-emerald-600/90 shadow-sm ring-1 ring-white/60 dark:from-emerald-950/50 dark:to-slate-900/60 dark:border-emerald-800/40 dark:text-emerald-400 dark:ring-white/5">
                <CalendarClock size={18} strokeWidth={1.75} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setPunctualityPanel('onTime')}
                className="cb-inner-panel backdrop-blur-sm p-5 text-left w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 group"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="shrink-0 rounded-lg bg-emerald-500/15 p-1.5 text-emerald-700">
                      <CheckCircle2 size={16} strokeWidth={2.25} aria-hidden />
                    </div>
                    <Tooltip text={CLOSE_PUNCTUALITY_HELP.OnTime}>
                      <span className="text-xs font-semibold text-slate-700 tracking-wide">On-Time Closes</span>
                    </Tooltip>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-semibold text-slate-500">Share</span>
                    <ChevronRight
                      size={16}
                      className="text-emerald-600 opacity-40 group-hover:opacity-100 transition-opacity"
                      aria-hidden
                    />
                  </div>
                </div>
                <div className="mt-2 flex items-end justify-between gap-4">
                  <div className="text-3xl font-extrabold text-slate-900 tabular-nums">
                    {insightsStarted ? (
                      <AnimatedNumber value={onTimePct} suffix="%" cycle={insightCycle} delayMs={420} durationMs={1300} />
                    ) : (
                      <span className="text-slate-400">0%</span>
                    )}
                  </div>
                  <div className="text-xs font-semibold text-slate-500 tabular-nums text-right">
                    {insightsStarted ? (
                      <AnimatedNumber
                        value={onTimeClosedCount}
                        cycle={insightCycle}
                        delayMs={520}
                        durationMs={1300}
                        formatter={(v) => `${v.toLocaleString()} files`}
                      />
                    ) : (
                      <span className="text-slate-500/70">0 files</span>
                    )}
                    <span className="block text-[10px] font-medium text-slate-400 mt-0.5">Open file list</span>
                  </div>
                </div>
                <div className="mt-3 h-3 rounded-full bg-slate-900/[0.06] dark:bg-white/[0.06] overflow-hidden">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 ${insightsStarted ? 'transition-[width] duration-[1200ms] ease-out' : ''}`}
                    style={{ width: insightsStarted ? `${onTimePct}%` : '0%' }}
                  />
                </div>
              </button>

              <button
                type="button"
                onClick={() => setPunctualityPanel('offSchedule')}
                className="cb-inner-panel backdrop-blur-sm p-5 text-left w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 group"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="shrink-0 rounded-lg bg-amber-500/15 p-1.5 text-amber-800">
                      <Clock3 size={16} strokeWidth={2.25} aria-hidden />
                    </div>
                    <Tooltip text={CLOSE_PUNCTUALITY_HELP.OffSchedule}>
                      <span className="text-xs font-semibold text-slate-700 tracking-wide">Closed Late</span>
                    </Tooltip>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-semibold text-slate-500">Share</span>
                    <ChevronRight
                      size={16}
                      className="text-amber-700 opacity-40 group-hover:opacity-100 transition-opacity"
                      aria-hidden
                    />
                  </div>
                </div>
                <div className="mt-2 flex items-end justify-between gap-4">
                  <div className="text-3xl font-extrabold text-slate-900 tabular-nums">
                    {insightsStarted ? (
                      <AnimatedNumber value={offSchedulePct} suffix="%" cycle={insightCycle} delayMs={440} durationMs={1300} />
                    ) : (
                      <span className="text-slate-400">0%</span>
                    )}
                  </div>
                  <div className="text-xs font-semibold text-slate-500 tabular-nums text-right">
                    {insightsStarted ? (
                      <AnimatedNumber
                        value={offScheduleClosedCount}
                        cycle={insightCycle}
                        delayMs={540}
                        durationMs={1300}
                        formatter={(v) => `${v.toLocaleString()} files`}
                      />
                    ) : (
                      <span className="text-slate-500/70">0 files</span>
                    )}
                    <span className="block text-[10px] font-medium text-slate-400 mt-0.5">Drivers & files</span>
                  </div>
                </div>
                <div className="mt-3 h-3 rounded-full bg-slate-900/[0.06] dark:bg-white/[0.06] overflow-hidden">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r from-amber-500 to-rose-500 ${insightsStarted ? 'transition-[width] duration-[1200ms] ease-out' : ''}`}
                    style={{ width: insightsStarted ? `${offSchedulePct}%` : '0%' }}
                  />
                </div>
              </button>
            </div>

            <div
              className="mt-6 overflow-hidden rounded-[1.125rem] border border-emerald-200/45 bg-gradient-to-br from-white/60 via-white/35 to-emerald-50/30 shadow-sm backdrop-blur-md dark:border-emerald-900/35 dark:from-slate-900/55 dark:via-slate-900/35 dark:to-emerald-950/20"
              role="region"
              aria-label="On-time performance versus program goal"
            >
              <div className="space-y-4 p-4 sm:p-5">
                <div>
                  <h4 className="text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">
                    On-time vs program goal
                  </h4>
                  <p className="mt-0.5 text-xs leading-snug text-slate-500 dark:text-slate-400">
                    Share of funded files that closed on or before committed COE (close of escrow), versus the target used for forecasting.
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  <div className="rounded-xl border border-white/80 bg-white/70 px-2 py-2.5 text-center shadow-sm dark:border-slate-600/80 dark:bg-slate-950/60 sm:px-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Actual</p>
                    <p className="mt-0.5 text-lg font-extrabold tabular-nums text-slate-900 dark:text-slate-50 sm:text-xl">
                      {insightsStarted ? (
                        <AnimatedNumber value={onTimePct} suffix="%" cycle={insightCycle} delayMs={620} durationMs={1300} />
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </p>
                  </div>
                  <div className="rounded-xl border border-emerald-200/60 bg-emerald-50/50 px-2 py-2.5 text-center shadow-sm dark:border-emerald-900/50 dark:bg-emerald-950/35 sm:px-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800/80 dark:text-emerald-300/90">Goal</p>
                    <p className="mt-0.5 text-lg font-extrabold tabular-nums text-emerald-900 dark:text-emerald-100 sm:text-xl">
                      {onTimeTargetPct}%
                    </p>
                  </div>
                  <div
                    className={`rounded-xl border px-2 py-2.5 text-center shadow-sm sm:px-3 ${
                      onTimeGap > 0
                        ? 'border-amber-200/70 bg-amber-50/65 dark:border-amber-900/45 dark:bg-amber-950/35'
                        : 'border-emerald-200/70 bg-emerald-50/50 dark:border-emerald-900/45 dark:bg-emerald-950/30'
                    }`}
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Vs goal</p>
                    <p
                      className={`mt-0.5 text-lg font-extrabold tabular-nums sm:text-xl ${
                        onTimeGap > 0 ? 'text-amber-900 dark:text-amber-100' : 'text-emerald-800 dark:text-emerald-200'
                      }`}
                    >
                      {onTimeGap > 0 ? (
                        insightsStarted ? (
                          <>
                            <AnimatedNumber value={onTimeGap} cycle={insightCycle} delayMs={680} durationMs={1300} />
                            <span className="text-sm font-bold"> pp</span>
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )
                      ) : (
                        <span className="text-sm font-extrabold leading-tight sm:text-base">At goal</span>
                      )}
                    </p>
                  </div>
                </div>

                <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                  <span className="font-medium text-slate-700 dark:text-slate-200">pp</span> = percentage points (85% − 57% = 28 pp). It is not a loan count.{' '}
                  <Tooltip text="Share of loans that funded on or before the builder/program COE target — not calendar efficiency of your team alone.">
                    <span className="cursor-help border-b border-dotted border-slate-400 dark:border-slate-500">Why we use a program goal</span>
                  </Tooltip>
                </p>

                <div className="rounded-xl border border-emerald-200/40 bg-white/40 p-3 dark:border-emerald-900/40 dark:bg-slate-950/40">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">On-time rate</span>
                    <span className="inline-flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600" aria-hidden />
                        Actual
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-0.5 rounded-full bg-slate-700 dark:bg-slate-300" aria-hidden />
                        Goal
                      </span>
                    </span>
                  </div>
                  <div
                    className="relative h-3.5 overflow-visible rounded-full bg-slate-900/[0.08] dark:bg-white/10"
                    role="img"
                    aria-label={
                      insightsStarted
                        ? `On-time rate ${onTimePct} percent, goal ${onTimeTargetPct} percent`
                        : 'On-time rate chart loading'
                    }
                  >
                    <div
                      className={`absolute left-0 top-0 bottom-0 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 ${insightsStarted ? 'transition-[width] duration-[1200ms] ease-out' : ''}`}
                      style={{ width: insightsStarted ? `${Math.min(100, onTimePct)}%` : '0%' }}
                    />
                    <div
                      className="pointer-events-none absolute top-1/2 z-10 h-[calc(100%+8px)] w-0.5 -translate-y-1/2 rounded-full bg-slate-800/60 dark:bg-slate-200/70"
                      style={{ left: `calc(${onTimeTargetPct}% - 1px)` }}
                    />
                  </div>
                  <div className="mt-1.5 flex justify-between gap-1 text-[10px] font-medium tabular-nums text-slate-500 dark:text-slate-400">
                    <span>0%</span>
                    <span className="min-w-0 truncate text-center">{onTimeTargetPct}% target</span>
                    <span>100%</span>
                  </div>
                </div>

                <div className="rounded-xl border border-amber-200/45 bg-amber-50/35 p-3 dark:border-amber-900/40 dark:bg-amber-950/25">
                  <div className="mb-2">
                    <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                      Where &ldquo;closed late&rdquo; files bottleneck
                    </p>
                    <p className="mt-1 text-[10px] leading-snug text-slate-600 dark:text-slate-400">
                      Share of the late cohort by likely friction point. Uses contract→app spacing vs portfolio median (
                      {Math.round(punctualityMedianIntakeDays)}d), readiness, lock vs COE runway, and construction pace.{' '}
                      <Tooltip text="Add an actual funding or COE date column to your import for true close variance; until then this is a directional read from milestones and pipeline signals.">
                        <span className="cursor-help border-b border-dotted border-slate-400 dark:border-slate-500">
                          Method note
                        </span>
                      </Tooltip>
                    </p>
                  </div>
                  {offScheduleLoansList.length === 0 ? (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">No late cohort on this slice.</p>
                  ) : (
                    <>
                      {lateBottleneckSummary.topBucket ? (
                        <p className="mb-3 text-[11px] leading-snug text-slate-700 dark:text-slate-200">
                          <span className="font-semibold text-amber-900 dark:text-amber-100">Most common:</span>{' '}
                          {LATE_BUCKET_LABEL[lateBottleneckSummary.topBucket]}
                          {lateBottleneckSummary.avgIntakeExcessAmongLate != null ? (
                            <span className="text-slate-600 dark:text-slate-400">
                              {' '}
                              · Among late files with stretched intake, avg{' '}
                              <span className="font-semibold tabular-nums">
                                +{lateBottleneckSummary.avgIntakeExcessAmongLate}d
                              </span>{' '}
                              past cohort contract→app
                            </span>
                          ) : null}
                        </p>
                      ) : null}
                      <ul className="space-y-2" aria-label="Closed late bottleneck mix">
                        {lateBottleneckOrder.map((key) => {
                          const n = lateBottleneckSummary.byBucket[key];
                          const pct = Math.round((n / offScheduleLoansList.length) * 100);
                          return (
                            <li key={key} className="space-y-1">
                              <div className="flex items-center justify-between gap-2 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                                <span>{LATE_BUCKET_LABEL[key]}</span>
                                <span className="tabular-nums text-slate-500 dark:text-slate-400">
                                  {n} ({pct}%)
                                </span>
                              </div>
                              <div className="h-2 overflow-hidden rounded-full bg-slate-900/10 dark:bg-white/10">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-amber-500 to-rose-500/90 transition-[width] duration-700 ease-out"
                                  style={{
                                    width: insightsStarted ? `${Math.min(100, (n / lateBucketMax) * 100)}%` : '0%',
                                  }}
                                />
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setPunctualityPanel('gap')}
                className="flex w-full items-center justify-between gap-3 border-t border-emerald-200/45 bg-white/30 px-4 py-3.5 text-left text-sm font-semibold text-emerald-900 transition-colors hover:bg-white/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-inset dark:border-emerald-900/40 dark:bg-slate-900/35 dark:text-emerald-100 dark:hover:bg-slate-900/55"
              >
                <span>Actions & suggestions</span>
                <ChevronRight className="h-4 w-4 shrink-0 opacity-60" strokeWidth={2.25} aria-hidden />
              </button>
            </div>
          </motion.div>
        </Tooltip>
      </div>

    </div>

    <AnimatePresence>
      {funnelPanel && (
        <motion.div
          key="funnel-drilldown"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100002] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]"
          onClick={() => setFunnelPanel(null)}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="funnel-panel-title"
            initial={{ opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 10 }}
            transition={{ duration: 0.2 }}
            className="cohi-modal-scroll max-h-[min(82vh,680px,calc(100dvh-2rem))] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-slate-200/90 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 bg-white/95 px-5 py-4 dark:border-slate-800 dark:bg-slate-900/95">
              <h2 id="funnel-panel-title" className="text-base font-bold text-slate-900 dark:text-slate-100">
                {funnelPanel === 'contractsDue' && `Contracts — due within ${CONTRACT_DUE_WINDOW_DAYS} days`}
                {funnelPanel === 'conditional' && 'Conditional approval'}
                {funnelPanel === 'final' && 'Final approval'}
                {funnelPanel === 'started' && 'Started — prospect preview'}
                {funnelPanel === 'appsTaken' && 'RESPA applications on file'}
              </h2>
              <button
                type="button"
                onClick={() => setFunnelPanel(null)}
                className="rounded-lg px-2 py-1 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800"
              >
                Close
              </button>
            </div>
            <div className="space-y-4 px-5 py-4 text-sm text-slate-700 dark:text-slate-300">
              {funnelPanel === 'contractsDue' && (
                <>
                  <p className="text-slate-600 dark:text-slate-400">
                    Purchase agreements with next milestone due in{' '}
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      ≤{CONTRACT_DUE_WINDOW_DAYS} days
                    </span>{' '}
                    ({funnelPeriod.toUpperCase()} view). Each row shows where the matched pipeline loan sits; tap to open
                    loan detail. Urgent = ≤5 days.
                  </p>
                  {contractsInDueWindow.length === 0 ? (
                    <p className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 text-slate-600 dark:border-slate-700 dark:bg-slate-800/50">
                      No contracts due within {CONTRACT_DUE_WINDOW_DAYS} days in this slice for the selected period.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {contractsInDueWindow.map((c) => {
                        const loan = findLoanForContract(c, loans);
                        return (
                          <li
                            key={c.id}
                            className={`rounded-xl border overflow-hidden ${
                              c.dueInDays <= 5
                                ? 'border-rose-200/80 bg-rose-50/60 dark:border-rose-900/50 dark:bg-rose-950/30'
                                : 'border-slate-200/80 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-800/40'
                            }`}
                          >
                            {loan ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setFunnelPanel(null);
                                  onLoanClick(loan.id);
                                }}
                                className="w-full text-left px-4 py-3 transition-colors hover:bg-white/60 dark:hover:bg-slate-800/70"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <p className="font-semibold text-slate-900 dark:text-slate-100">{anonymizeBorrowerName(c.borrower)}</p>
                                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-sky-800 dark:text-sky-200 bg-sky-100/90 dark:bg-sky-950/50 px-2 py-0.5 rounded-full">
                                    {formatLoanRef(loan)}
                                  </span>
                                </div>
                                <p className="mt-1.5 text-[11px] leading-snug text-slate-700 dark:text-slate-200">
                                  <span className="font-semibold text-slate-800 dark:text-slate-100">Milestone:</span>{' '}
                                  {activeMilestoneSummary(loan)}
                                </p>
                                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                                  {c.community} · {c.mortgageStatus}
                                </p>
                                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                                  LO {displayLoanOfficer(loan)}
                                </p>
                                <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  {c.dueInDays}d to contract milestone · agreement {c.date}
                                </p>
                                <p className="mt-2 text-[10px] font-semibold text-sky-700 dark:text-sky-300">
                                  Open loan →
                                </p>
                              </button>
                            ) : (
                              <div className="px-4 py-3">
                                <p className="font-semibold text-slate-900 dark:text-slate-100">{anonymizeBorrowerName(c.borrower)}</p>
                                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                                  {c.community} · {c.mortgageStatus}
                                </p>
                                <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                                  {c.dueInDays}d to due · signed {c.date}
                                </p>
                                <p className="mt-2 text-[11px] text-amber-800 dark:text-amber-200">
                                  No matching pipeline loan (borrower/community). Check the full loan list.
                                </p>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
              {funnelPanel === 'conditional' && (
                <>
                  <p className="text-slate-600 dark:text-slate-400">
                    Started prospects that converted to executed contracts ({funnelPeriod.toUpperCase()}). Loans below
                    readiness often sit in conditional approval until conditions clear.
                  </p>
                  <div className="space-y-1">
                    <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums tracking-tight">
                      {(contractsPerStarted * 100).toFixed(1)}%
                    </p>
                    <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
                      Contracts per started prospect ({funnelPeriod.toUpperCase()})
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      {`${scaledContractsCount.toLocaleString()} contracts · ${scaledStartedCount.toLocaleString()} started`}
                    </p>
                  </div>
                  <ul className="space-y-2">
                    {conditionalDrillLoans.length === 0 ? (
                      <li className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 text-slate-600 dark:border-slate-700 dark:bg-slate-800/50">
                        No sub-80% readiness loans flagged for this view.
                      </li>
                    ) : (
                      conditionalDrillLoans.map((loan) => (
                        <li
                          key={loan.id}
                          className="rounded-xl border border-slate-200/80 bg-slate-50/50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/40"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setFunnelPanel(null);
                              onLoanClick(loan.id);
                            }}
                            className="w-full text-left"
                          >
                            <p className="font-semibold text-slate-900 dark:text-slate-100">{anonymizeBorrowerName(loan.borrower)}</p>
                            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                              Readiness {loan.loanPreparedness}% · {loan.daysToClose}d to close
                            </p>
                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">LO {displayLoanOfficer(loan)}</p>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                </>
              )}
              {funnelPanel === 'final' && (
                <>
                  <p className="text-slate-600 dark:text-slate-400">
                    Applications tied to signed contracts on the preferred channel — final approval velocity vs. contract
                    inventory ({funnelPeriod.toUpperCase()}).
                  </p>
                  <div className="space-y-1">
                    <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums tracking-tight">
                      {(appsPerContractScaled * 100).toFixed(1)}%
                    </p>
                    <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
                      Apps per signed contract ({funnelPeriod.toUpperCase()})
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      {`${scaledAppsCount.toLocaleString()} apps · ${scaledContractsCount.toLocaleString()} contracts`}
                    </p>
                  </div>
                  <ul className="space-y-2">
                    {finalDrillContracts.map((c) => (
                      <li
                        key={c.id}
                        className="rounded-xl border border-slate-200/80 bg-slate-50/50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/40"
                      >
                        <p className="font-semibold text-slate-900 dark:text-slate-100">{anonymizeBorrowerName(c.borrower)}</p>
                        <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                          {c.community} · {c.mortgageStatus}
                        </p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {funnelPanel === 'started' && (
                <>
                  <p className="text-slate-600 dark:text-slate-400">
                    Prospects that entered the program this period ({funnelPeriod.toUpperCase()}). Representative rows from
                    CRM / web sources — use as a working list for outreach and conversion.
                  </p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Showing {startedDrillLeads.length} of {leads.length} indexed prospects
                  </p>
                  <ul className="space-y-2">
                    {startedDrillLeads.map((lead) => (
                      <li
                        key={lead.id}
                        className="rounded-xl border border-slate-200/80 bg-slate-50/50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/40"
                      >
                        <p className="font-semibold text-slate-900 dark:text-slate-100">{lead.name}</p>
                        <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                          {lead.community} · {lead.source}
                        </p>
                        <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-400">
                          {lead.status} · ~{startedAvgDaysMotion}d in motion (cohort avg)
                        </p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {funnelPanel === 'appsTaken' && (
                <>
                  <p className="text-slate-600 dark:text-slate-400">
                    Mortgage applications on file after contract ({funnelPeriod.toUpperCase()} window). Preferred vs.
                    external reflects capture posture on this slice.
                  </p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Preview of {appsDrillLoans.length} active pipeline files
                  </p>
                  <ul className="space-y-2">
                    {appsDrillLoans.map((loan) => (
                      <li
                        key={loan.id}
                        className="rounded-xl border border-slate-200/80 bg-slate-50/50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/40"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setFunnelPanel(null);
                            onLoanClick(loan.id);
                          }}
                          className="w-full text-left"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold text-slate-900 dark:text-slate-100">{anonymizeBorrowerName(loan.borrower)}</p>
                            <span
                              className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                                loan.isPreferred
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                                  : 'bg-slate-200/80 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200'
                              }`}
                            >
                              {loan.isPreferred ? 'Preferred' : 'External'}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                            {resolvedPrimaryLenderLabel(loan.lender, loan.isPreferred, loan.builderImportRow)} · readiness{' '}
                            {loan.loanPreparedness}%
                          </p>
                          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">LO {displayLoanOfficer(loan)}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>

    <AnimatePresence>
      {punctualityPanel && (
        <motion.div
          key="punctuality-drilldown"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[91] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]"
          onClick={() => setPunctualityPanel(null)}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="punctuality-panel-title"
            initial={{ opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 10 }}
            transition={{ duration: 0.2 }}
            className="cohi-modal-scroll max-h-[min(82vh,640px,calc(100dvh-2rem))] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-slate-200/90 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 bg-white/95 px-5 py-4 dark:border-slate-800 dark:bg-slate-900/95">
              <h2 id="punctuality-panel-title" className="text-base font-bold text-slate-900 dark:text-slate-100">
                {punctualityPanel === 'onTime' && 'On-Time Closes'}
                {punctualityPanel === 'offSchedule' && 'Closed Late'}
                {punctualityPanel === 'gap' && 'On-time goal & next steps'}
              </h2>
              <button
                type="button"
                onClick={() => setPunctualityPanel(null)}
                className="rounded-lg px-2 py-1 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800"
              >
                Close
              </button>
            </div>
            <div className="space-y-4 px-5 py-4 text-sm text-slate-700 dark:text-slate-300">
              {punctualityPanel === 'onTime' && (
                <>
                  <p className="text-slate-600 dark:text-slate-400">
                    Files that met committed COE (close of escrow) or program target in this demo cohort ({onTimeLoansList.length}{' '}
                    total). Open a loan for conditions, milestones, and lock detail.
                  </p>
                  <ul className="space-y-2">
                    {onTimeLoansList.slice(0, 18).map((loan) => (
                      <li
                        key={loan.id}
                        className="rounded-xl border border-emerald-200/50 bg-emerald-50/35 px-4 py-3 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setPunctualityPanel(null);
                            onLoanClick(loan.id);
                          }}
                          className="w-full text-left"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold text-slate-900 dark:text-slate-100">{anonymizeBorrowerName(loan.borrower)}</p>
                            <span className="shrink-0 text-[10px] font-bold tracking-wide text-emerald-800 dark:text-emerald-300 bg-emerald-100/80 dark:bg-emerald-900/40 px-2 py-0.5 rounded-full">
                              On-Time
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                            {loan.city}, {loan.state} · {loan.daysToClose}d to delivery · readiness {loan.loanPreparedness}%
                          </p>
                          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">LO {displayLoanOfficer(loan)}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {punctualityPanel === 'offSchedule' && (
                <>
                  <p className="text-slate-600 dark:text-slate-400">
                    Cohort flagged as closed late for this dashboard slice. Primary bottleneck tags use milestone spacing vs a{' '}
                    {Math.round(punctualityMedianIntakeDays)}d portfolio median (contract→app), plus readiness, lock runway,
                    and construction pace — open the loan for full milestones.
                  </p>
                  {lateBottleneckSummary.topBucket ? (
                    <div className="rounded-xl border border-amber-200/60 bg-amber-50/50 px-3 py-2 text-xs text-amber-950 dark:border-amber-900/45 dark:bg-amber-950/30 dark:text-amber-100">
                      <span className="font-semibold">On average in this list:</span>{' '}
                      {LATE_BUCKET_LABEL[lateBottleneckSummary.topBucket]} shows up most often
                      {lateBottleneckSummary.avgIntakeExcessAmongLate != null ? (
                        <>
                          {' '}
                          · stretched intake averages{' '}
                          <span className="font-semibold tabular-nums">
                            +{lateBottleneckSummary.avgIntakeExcessAmongLate}d
                          </span>{' '}
                          vs cohort contract→app (where applicable)
                        </>
                      ) : null}
                      .
                    </div>
                  ) : null}
                  <ul className="space-y-2">
                    {offScheduleLoansList.slice(0, 18).map((loan) => {
                      const nb = lateLoanBottleneck(loan, punctualityMedianIntakeDays);
                      return (
                        <li
                          key={loan.id}
                          className="rounded-xl border border-amber-200/60 bg-amber-50/40 px-4 py-3 dark:border-amber-900/45 dark:bg-amber-950/25"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setPunctualityPanel(null);
                              onLoanClick(loan.id);
                            }}
                            className="w-full text-left"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-semibold text-slate-900 dark:text-slate-100">{anonymizeBorrowerName(loan.borrower)}</p>
                              <div className="flex flex-col items-end gap-1 shrink-0">
                                <span className="text-[10px] font-bold uppercase tracking-wide rounded-full bg-amber-200/90 text-amber-950 px-2 py-0.5 dark:bg-amber-900/60 dark:text-amber-100">
                                  {LATE_BUCKET_LABEL[nb.bucket]}
                                </span>
                                <span
                                  className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                                    loan.riskLevel === 'High'
                                      ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200'
                                      : loan.riskLevel === 'Medium'
                                        ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
                                        : 'bg-slate-200/90 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                                  }`}
                                >
                                  {loan.riskLevel} risk
                                </span>
                              </div>
                            </div>
                            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                              {nb.detail} · {loan.daysToClose}d to targeted COE · {loan.status}
                            </p>
                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">LO {displayLoanOfficer(loan)}</p>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
              {punctualityPanel === 'gap' && (
                <>
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50">
                    <p className="text-slate-800 dark:text-slate-100 font-semibold tabular-nums">
                      {onTimePct}% on-time vs {onTimeTargetPct}% goal
                      {onTimeGap > 0 ? (
                        <span className="block text-sm font-semibold text-amber-800 dark:text-amber-200 mt-1">
                          {onTimeGap} percentage points (pp) below goal
                        </span>
                      ) : (
                        <span className="block text-sm font-semibold text-emerald-800 dark:text-emerald-200 mt-1">
                          At or above goal on this slice
                        </span>
                      )}
                    </p>
                    <p className="mt-2 text-slate-600 dark:text-slate-400 text-sm">
                      {onTimeGap > 0
                        ? 'Closing the gap usually means tightening off-schedule drivers (title, conditions, lock runway) on the loans that slip past COE.'
                        : 'Keep monitoring closed-late outliers so the rate does not drift below goal.'}
                    </p>
                    {offScheduleLoansList.length > 0 && lateBottleneckSummary.topBucket ? (
                      <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">
                        <span className="font-semibold text-slate-800 dark:text-slate-100">Bottleneck read:</span>{' '}
                        late files most often align with{' '}
                        <span className="font-semibold">{LATE_BUCKET_LABEL[lateBottleneckSummary.topBucket]}</span>
                        {lateBottleneckSummary.avgIntakeExcessAmongLate != null &&
                        lateBottleneckSummary.topBucket === 'intake' ? (
                          <span className="text-slate-600 dark:text-slate-400">
                            {' '}
                            (avg +{lateBottleneckSummary.avgIntakeExcessAmongLate}d contract→app vs cohort)
                          </span>
                        ) : null}
                        .
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Suggested focus</p>
                    <ul className="space-y-2 text-slate-600 dark:text-slate-400 text-sm list-disc list-inside">
                      <li>
                        {lateBottleneckSummary.topBucket === 'intake'
                          ? 'Publish a contract → full-application SLA and daily aging on agreements still in intake.'
                          : lateBottleneckSummary.topBucket === 'underwriting'
                            ? 'Clear conditions and document exceptions on late cohort files before burning lock extensions.'
                            : lateBottleneckSummary.topBucket === 'lock'
                              ? 'Match lock end dates to revised COE; extend or re-lock where runway is negative.'
                              : lateBottleneckSummary.topBucket === 'construction'
                                ? 'Sync builder schedule updates with LOS milestones so COE moves are visible early.'
                                : 'Review title, vendors, and third-party dependencies on late closes.'}
                      </li>
                      <li>Align lock strategy with revised COE on medium- and high-risk loans.</li>
                      <li>Share weekly punctuality and bottleneck rollup with builder partners.</li>
                    </ul>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPunctualityPanel('offSchedule')}
                    className="w-full rounded-xl border border-amber-200/80 bg-amber-50/50 px-4 py-3 text-left text-sm font-semibold text-amber-900 transition-colors hover:bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100"
                  >
                    Open Closed Late file list
                    <span className="block text-xs font-normal text-amber-800/80 dark:text-amber-200/80 mt-0.5">
                      {offScheduleLoansList.length} files in demo cohort
                    </span>
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}
