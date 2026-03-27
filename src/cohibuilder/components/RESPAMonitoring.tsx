import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  ShieldCheck, 
  Clock, 
  AlertCircle, 
  CheckCircle2, 
  FileCheck, 
  Search,
  Filter,
  ArrowRight,
  ChevronRight,
  X,
  FileWarning,
  Printer,
  Copy,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useCohiBuilderPortfolio } from '../contexts/CohiBuilderPortfolioContext';
import { respaApps as defaultRespaApps } from '../data/mockData';
import PageHeader from './PageHeader';
import { anonymizeBorrowerName, anonymizeImportKvPersonName } from '../lib/borrowerPrivacy';

/** Matches APP-2026-003 sample row; shown only when the at-risk filter returns no rows. */
const PLACEHOLDER_AT_RISK_BORROWER = 'Elena Rodriguez';

interface RESPAMonitoringProps {
  onAppClick: (id: string) => void;
}

type DrilldownCard = 'compliance' | 'pending-le' | 'cd-review' | 'at-risk' | null;

type RespaApp = (typeof defaultRespaApps)[number];

/** LE within TRID 3-business-day delivery (mock: sent + dated). */
function isTimelyLE(a: RespaApp): boolean {
  return a.leStatus === 'Sent' && a.leDate != null;
}

/** CD on track or delivered per pipeline stage (demo rules). */
function isTimelyCD(a: RespaApp): boolean {
  if (a.cdStatus === 'Sent') return true;
  if (a.status === 'Completed')
    return a.cdStatus === 'Sent' || Boolean((a as { cdDate?: string }).cdDate);
  if (a.cdStatus === 'Pending') return true;
  if (a.cdStatus === 'Not Started') return true;
  return false;
}

function isTridTimelyLeCd(a: RespaApp): boolean {
  return isTimelyLE(a) && isTimelyCD(a);
}

/** Demo: LOS / shadow pipeline not shown as individual rows in mock data. */
const PENDING_LE_PIPELINE_PAD = 12;

/** Estimated contract units per application (mock — replace with lot/unit field when available). */
function estUnitsForPendingApp(a: RespaApp): number {
  let n = 0;
  for (const c of a.id) n += c.charCodeAt(0);
  return 1 + (n % 3);
}

const drilldownStyles = 'cursor-pointer hover:shadow-lg hover:border-slate-300 transition-all group';

export default function RESPAMonitoring({ onAppClick }: RESPAMonitoringProps) {
  const { respaApps } = useCohiBuilderPortfolio();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [drilldown, setDrilldown] = useState<DrilldownCard>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [complianceReportOpen, setComplianceReportOpen] = useState(false);
  const [copyReportDone, setCopyReportDone] = useState(false);
  /** KPI card title: "Trid Clock" then "LE/CD Timer", alternating every 5s. */
  const [tridCardTitlePhase, setTridCardTitlePhase] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      setTridCardTitlePhase((p) => (p + 1) % 2);
    }, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!complianceReportOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setComplianceReportOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [complianceReportOpen]);

  const filteredApps = respaApps.filter(app => 
    app.borrower.toLowerCase().includes(searchTerm.toLowerCase()) ||
    app.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    app.lender.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const pendingLEApps = filteredApps.filter(a => a.leStatus === 'Delayed' || !a.leDate);
  const cdReviewApps = filteredApps.filter(a => a.cdStatus === 'Pending');
  const atRiskApps = filteredApps.filter(a => a.status === 'At Risk' || a.complianceScore < 70);
  const leTimelyApps = filteredApps.filter(isTimelyLE);
  const leTimelyPct = filteredApps.length ? Math.round((leTimelyApps.length / filteredApps.length) * 100) : 0;
  const leTimelyForCd = filteredApps.filter(isTimelyLE);
  const cdTimelyAmongLe = leTimelyForCd.filter(isTimelyCD);
  const cdTimelyAmongLePct = leTimelyForCd.length
    ? Math.round((cdTimelyAmongLe.length / leTimelyForCd.length) * 100)
    : 0;
  const tridTimelyLeCdApps = filteredApps.filter(isTridTimelyLeCd);
  const tridTimelyLeCdPct = filteredApps.length
    ? Math.round((tridTimelyLeCdApps.length / filteredApps.length) * 100)
    : 0;

  const pendingLeAppCount = pendingLEApps.length + PENDING_LE_PIPELINE_PAD;
  const pendingLeUnitsFromRows = pendingLEApps.reduce((s, a) => s + estUnitsForPendingApp(a), 0);
  const pendingLeUnits = pendingLeUnitsFromRows + PENDING_LE_PIPELINE_PAD;
  const delayedLeCount = pendingLEApps.filter((a) => a.leStatus === 'Delayed').length;
  const missingLeDateCount = pendingLEApps.filter((a) => !a.leDate).length;
  const dueTodayLeEstimate =
    delayedLeCount > 0
      ? Math.min(pendingLeAppCount, delayedLeCount + 2)
      : Math.min(3, pendingLeAppCount);

  const reportRecommendations = useMemo(() => {
    const items: string[] = [];
    if (filteredApps.length === 0) {
      items.push('Expand or clear search filters to include applications in this report.');
      return items;
    }
    if (leTimelyPct < 90) {
      items.push('Prioritize delayed or undated Loan Estimates to keep the TRID 3-business-day clock defensible.');
    }
    if (leTimelyForCd.length > 0 && cdTimelyAmongLePct < 85) {
      items.push('Review CD readiness for LE-timely files—closing disclosure timing drives builder walk and funding dates.');
    }
    if (pendingLeAppCount > 0) {
      items.push(`Clear the pending LE queue (${pendingLeAppCount} apps incl. pipeline pad) before rate locks stack material-change redisclosures.`);
    }
    if (cdReviewApps.length > 0) {
      items.push(`Finalize ${cdReviewApps.length} Closing Disclosure(s) in review before scheduling closings.`);
    }
    if (atRiskApps.length > 0) {
      items.push(`Assign owners to ${atRiskApps.length} at-risk file(s) (low compliance score or status).`);
    }
    if (items.length === 0) {
      items.push('Disclosure timing is within tolerance for the current filter—continue routine monitoring and audits.');
    }
    return items;
  }, [
    filteredApps.length,
    leTimelyPct,
    leTimelyForCd.length,
    cdTimelyAmongLePct,
    pendingLeAppCount,
    cdReviewApps.length,
    atRiskApps.length,
  ]);

  const complianceReportPlainText = useMemo(() => {
    const generated = new Date().toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    const lines = [
      'COHI BUILDER — TRID / RESPA COMPLIANCE REPORT',
      `Generated: ${generated}`,
      '',
      'EXECUTIVE SUMMARY',
      filteredApps.length === 0
        ? 'No applications match the current search; adjust filters and regenerate.'
        : `Portfolio shows ${tridTimelyLeCdPct}% with timely LE and CD on track for the filtered set (${filteredApps.length} apps). LE timeliness is ${leTimelyPct}%; among LE-timely files, CD on track is ${cdTimelyAmongLePct}%.`,
      '',
      'PIPELINE SNAPSHOT',
      `- Trid Clock (LE + CD timely): ${tridTimelyLeCdPct}%`,
      `- Timely LE (3-day rule): ${leTimelyPct}%`,
      `- CD on track (of LE-timely): ${cdTimelyAmongLePct}%`,
      `- Pending LE workload (incl. pad): ${pendingLeAppCount} apps`,
      `- CD in review: ${cdReviewApps.length}`,
      `- At-risk (score/status): ${atRiskApps.length}`,
      '',
      'RECOMMENDATIONS',
      ...reportRecommendations.map((r) => `- ${r}`),
      '',
      '— End of report —',
    ];
    return lines.join('\n');
  }, [
    filteredApps.length,
    tridTimelyLeCdPct,
    leTimelyPct,
    cdTimelyAmongLePct,
    pendingLeAppCount,
    cdReviewApps.length,
    atRiskApps.length,
    reportRecommendations,
  ]);

  const handleCopyComplianceReport = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(complianceReportPlainText);
      setCopyReportDone(true);
      window.setTimeout(() => setCopyReportDone(false), 2000);
    } catch {
      setCopyReportDone(false);
    }
  }, [complianceReportPlainText]);

  const handlePrintComplianceReport = useCallback(() => {
    const w = window.open('', '_blank', 'width=720,height=900');
    if (!w) return;
    const generated = new Date().toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    w.document.write(
      `<!DOCTYPE html><html><head><title>Compliance Report</title><style>
        body{font-family:system-ui,sans-serif;padding:24px;line-height:1.5;color:#0f172a;max-width:40rem;margin:0 auto;}
        h1{font-size:1.25rem;margin:0 0 4px;} .muted{color:#64748b;font-size:12px;margin-bottom:20px;}
        h2{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#0d9488;margin:20px 0 8px;}
        ul{padding-left:1.1rem;margin:0;} li{margin:6px 0;}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;font-size:13px;margin-top:8px;}
        @media print{body{padding:16px;}}
      </style></head><body>`,
    );
    w.document.write(`<h1>TRID / RESPA Compliance Report</h1><p class="muted">${generated}</p>`);
    w.document.write('<h2>Executive summary</h2><p>');
    w.document.write(
      filteredApps.length === 0
        ? 'No applications match the current search.'
        : `${tridTimelyLeCdPct}% of filtered applications have timely LE and CD on track (${filteredApps.length} apps). LE timeliness ${leTimelyPct}%; CD on track among LE-timely: ${cdTimelyAmongLePct}%.`,
    );
    w.document.write('</p><h2>Metrics</h2><div class="grid">');
    w.document.write(
      `<div>Trid Clock (LE+CD)</div><div><strong>${tridTimelyLeCdPct}%</strong></div>` +
        `<div>Timely LE</div><div><strong>${leTimelyPct}%</strong></div>` +
        `<div>CD on track (LE-timely)</div><div><strong>${cdTimelyAmongLePct}%</strong></div>` +
        `<div>Pending LEs (incl. pad)</div><div><strong>${pendingLeAppCount}</strong></div>` +
        `<div>CD in review</div><div><strong>${cdReviewApps.length}</strong></div>` +
        `<div>At-risk</div><div><strong>${atRiskApps.length}</strong></div>`,
    );
    w.document.write('</div><h2>Recommendations</h2><ul>');
    for (const r of reportRecommendations) {
      w.document.write(`<li>${r.replace(/</g, '&lt;')}</li>`);
    }
    w.document.write('</ul></body></html>');
    w.document.close();
    w.focus();
    w.print();
    w.close();
  }, [
    filteredApps.length,
    tridTimelyLeCdPct,
    leTimelyPct,
    cdTimelyAmongLePct,
    pendingLeAppCount,
    cdReviewApps.length,
    atRiskApps.length,
    reportRecommendations,
  ]);

  return (
    <>
    <div className="space-y-6 sm:space-y-8 relative">
      <PageHeader
        badge="TRID Compliance"
        title="RESPA & Compliance Oversight"
        subtitle="Disclosure timelines (LE/CD) for active builder-channel applications—protect closing dates that often sit months after contract in production home communities."
      >
        <button
          type="button"
          className="flex items-center justify-center gap-2 px-4 py-2 glass-panel rounded-lg text-sm font-medium text-slate-700 hover:bg-white/30 transition-colors dark:text-slate-200"
          onClick={() => {
            searchInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            window.setTimeout(() => searchInputRef.current?.focus(), 300);
          }}
        >
          <Filter size={16} />
          Filter
        </button>
        <button
          type="button"
          className="flex items-center justify-center gap-2 px-4 py-2 btn-primary text-white rounded-lg text-sm font-medium transition-colors"
          onClick={() => setComplianceReportOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={complianceReportOpen}
        >
          <ShieldCheck size={16} />
          Compliance Report
        </button>
      </PageHeader>

      {/* Compliance Overview Cards - Clickable with drilldown */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 relative z-10">
        <div 
          role="button"
          tabIndex={0}
          onClick={() => setDrilldown('compliance')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setDrilldown('compliance');
            }
          }}
          className={`card-base p-5 sm:p-6 cursor-pointer flex flex-col justify-between min-h-[140px] ${drilldownStyles}`}
        >
          <div className="flex items-center justify-between mb-2 gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 bg-emerald-50/80 text-emerald-600 rounded-xl shrink-0">
                <CheckCircle2 size={20} />
              </div>
              <h3
                className="text-sm font-display font-bold text-slate-600 leading-snug min-h-[1.35rem] flex items-center"
                aria-live="polite"
              >
                <AnimatePresence mode="wait">
                  <motion.span
                    key={tridCardTitlePhase}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                    className="inline-block"
                  >
                    {tridCardTitlePhase === 0 ? 'Trid Clock' : 'LE/CD Timer'}
                  </motion.span>
                </AnimatePresence>
              </h3>
            </div>
            <ChevronRight size={18} className="text-slate-400 group-hover:text-emerald-600 shrink-0" aria-hidden />
          </div>
          <p className="text-[32px] sm:text-[36px] font-display font-bold text-slate-900 leading-none">{tridTimelyLeCdPct}%</p>
          <p className="text-xs text-slate-500 mt-1.5 font-medium leading-snug">
            <span className="text-emerald-700 font-semibold">LE {leTimelyPct}%</span>
            <span className="text-slate-400 mx-1">·</span>
            <span className="text-emerald-700 font-semibold">CD {cdTimelyAmongLePct}%</span>
            <span className="text-slate-500"> of LE-timely</span>
          </p>
        </div>
        <div 
          role="button"
          tabIndex={0}
          onClick={() => setDrilldown('pending-le')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setDrilldown('pending-le');
            }
          }}
          className={`card-base p-4 sm:p-6 ${drilldownStyles}`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 text-amber-600 rounded-xl">
                <Clock size={20} />
              </div>
              <h3 className="text-sm font-display font-bold text-slate-600">Pending LEs</h3>
            </div>
            <ChevronRight size={18} className="text-slate-400 group-hover:text-amber-600 shrink-0" aria-hidden />
          </div>
          <p className="text-[32px] sm:text-[36px] font-display font-bold text-slate-900 leading-none">{pendingLeAppCount}</p>
          <p className="text-xs text-slate-600 mt-1.5 font-medium tabular-nums">
            <span className="text-amber-700 font-semibold">{pendingLeUnits.toLocaleString()} units</span>
            <span className="text-slate-400 mx-1">·</span>
            <span>{dueTodayLeEstimate} due today (3-day rule)</span>
          </p>
        </div>
        <div 
          onClick={() => setDrilldown('cd-review')}
          className={`card-base p-4 sm:p-6 ${drilldownStyles}`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-sky-50/80 text-sky-600 rounded-xl">
                <FileCheck size={20} />
              </div>
              <h3 className="text-sm font-display font-bold text-slate-600">CDs in Review</h3>
            </div>
            <ChevronRight size={18} className="text-slate-400 group-hover:text-sky-600" />
          </div>
          <p className="text-[32px] sm:text-[36px] font-display font-bold text-slate-900 leading-none">{cdReviewApps.length + 8}</p>
          <p className="text-xs text-sky-600 mt-1 font-semibold">Avg. 2.4 days review time</p>
        </div>
        <div 
          onClick={() => setDrilldown('at-risk')}
          className={`card-base p-4 sm:p-6 ${drilldownStyles}`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-rose-50/80 text-rose-600 rounded-xl">
                <AlertCircle size={20} />
              </div>
              <h3 className="text-sm font-display font-bold text-slate-600">At-Risk</h3>
            </div>
            <ChevronRight size={18} className="text-slate-400 group-hover:text-rose-600" />
          </div>
          <p className="text-[32px] sm:text-[36px] font-display font-bold text-slate-900 leading-none">{atRiskApps.length + 3}</p>
          <p className="text-xs text-rose-600 mt-1 font-semibold">Requires immediate action</p>
        </div>
      </div>

      {/* Main Table with expandable rows */}
      <div className="card-base overflow-hidden rounded-2xl">
        <div className="p-4 sm:p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-sky-50/50">
          <h2 className="text-lg font-display font-bold text-slate-900">Application Pipeline</h2>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input 
              ref={searchInputRef}
              type="text" 
              placeholder="Search applications..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-300/50 text-slate-900 placeholder:text-slate-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
              aria-label="Search applications"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider border-b border-slate-200">
                <th className="px-6 py-4 font-display font-bold">Application</th>
                <th className="px-6 py-4 font-display font-bold">Loan Estimate (LE)</th>
                <th className="px-6 py-4 font-display font-bold">Closing Disclosure (CD)</th>
                <th className="px-6 py-4 font-display font-bold">Compliance</th>
                <th className="px-6 py-4 font-display font-bold">Status</th>
                <th className="px-6 py-4 font-display font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredApps.map((app) => (
                <React.Fragment key={app.id}>
                  <tr 
                    onClick={() => setExpandedRow(expandedRow === app.id ? null : app.id)}
                    className="hover:bg-slate-50/80 transition-colors bg-white cursor-pointer"
                  >
                    <td className="px-6 py-4">
                      <p className="font-semibold text-slate-900">{anonymizeBorrowerName(app.borrower)}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{app.id} • {app.lender}</p>
                      <p className="text-[10px] text-slate-400 mt-1 font-medium">{app.applicationDate && `App: ${app.applicationDate}`}</p>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <span className={`inline-flex w-fit px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${
                          app.leStatus === 'Sent' ? 'bg-emerald-100 text-emerald-700' :
                          app.leStatus === 'Delayed' ? 'bg-rose-100 text-rose-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>
                          {app.leStatus}
                        </span>
                        {app.leDate && <span className="text-xs text-slate-600">Sent {app.leDate}</span>}
                        {app.leStatus === 'Delayed' && <span className="text-xs text-rose-600 font-medium">Past 3-day rule</span>}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <span className={`inline-flex w-fit px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${
                          app.cdStatus === 'Sent' ? 'bg-emerald-100 text-emerald-700' :
                          app.cdStatus === 'Pending' ? 'bg-amber-100 text-amber-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>
                          {app.cdStatus}
                        </span>
                        {app.cdDeadline && <span className="text-xs text-slate-600">Due: {app.cdDeadline}</span>}
                        {app.cdStatus === 'Sent' && (app as any).cdDate && <span className="text-xs text-emerald-600">Delivered {(app as any).cdDate}</span>}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${app.complianceScore}%` }}
                            transition={{ duration: 0.5 }}
                            className={`h-full rounded-full ${
                              app.complianceScore >= 90 ? 'bg-emerald-500' : 
                              app.complianceScore >= 70 ? 'bg-amber-500' : 'bg-rose-500'
                            }`}
                          />
                        </div>
                        <span className={`text-sm font-bold ${
                          app.complianceScore >= 90 ? 'text-emerald-600' : 
                          app.complianceScore >= 70 ? 'text-amber-600' : 'text-rose-600'
                        }`}>{app.complianceScore}%</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${
                        app.status === 'Completed' ? 'bg-emerald-100 text-emerald-700' :
                        app.status === 'On Track' ? 'bg-sky-100 text-sky-700' :
                        'bg-rose-100 text-rose-700'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          app.status === 'Completed' ? 'bg-emerald-500' :
                          app.status === 'On Track' ? 'bg-sky-500' : 'bg-rose-500'
                        }`} />
                        {app.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button 
                        onClick={(e) => { e.stopPropagation(); onAppClick(app.id); }}
                        className="p-2 text-slate-500 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                      >
                        <ArrowRight size={18} />
                      </button>
                    </td>
                  </tr>
                  {expandedRow === app.id && (
                    <tr>
                      <td colSpan={6} className="px-6 py-4 bg-slate-50/80 border-b border-slate-100">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                          <div className="p-4 rounded-xl bg-white border border-slate-200">
                            <p className="text-[10px] font-display font-bold text-slate-500 uppercase tracking-wider mb-2">TRID Timeline</p>
                            <div className="space-y-1.5">
                              <p><span className="text-slate-500">Application:</span> {app.applicationDate}</p>
                              <p><span className="text-slate-500">LE (3-day rule):</span> {app.leDate || '— Overdue'}</p>
                              <p><span className="text-slate-500">CD deadline (7-day):</span> {app.cdDeadline}</p>
                            </div>
                          </div>
                          <div className="p-4 rounded-xl bg-white border border-slate-200">
                            <p className="text-[10px] font-display font-bold text-slate-500 uppercase tracking-wider mb-2">Lender & Product</p>
                            <p className="font-medium text-slate-900">{app.lender}</p>
                            <p className="text-xs text-slate-500 mt-1">Construction-to-Permanent</p>
                            <p className="text-xs text-slate-500">Intent to Proceed: Required before CD</p>
                          </div>
                          <div className="p-4 rounded-xl bg-white border border-slate-200">
                            <p className="text-[10px] font-display font-bold text-slate-500 uppercase tracking-wider mb-2">Risks & Actions</p>
                            {app.complianceScore < 90 && (
                              <p className="text-amber-700 font-medium flex items-center gap-1.5">
                                <FileWarning size={14} /> Disclosure delay may impact closing
                              </p>
                            )}
                            {app.leStatus === 'Delayed' && (
                              <p className="text-rose-700 font-medium">LE overdue — 3 business days from app</p>
                            )}
                            <button 
                              onClick={() => onAppClick(app.id)}
                              className="mt-2 px-3 py-1.5 bg-teal-100 text-teal-800 rounded-lg font-semibold text-xs hover:bg-teal-200"
                            >
                              View full detail →
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {filteredApps.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                    No applications found matching your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drilldown Modals */}
      <AnimatePresence>
        {drilldown && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrilldown(null)}
              className="fixed inset-0 z-[var(--z-modal-backdrop)] bg-slate-400/25 backdrop-blur-[2px] dark:bg-slate-950/50"
            />
            <div className="cohi-modal-center-host">
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="flex w-full max-w-xl max-h-[min(88dvh,calc(100dvh-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
                onClick={(e) => e.stopPropagation()}
              >
              <div className="sticky top-0 z-10 shrink-0 border-b border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900 flex items-center justify-between">
                <h3 className="text-xl font-display font-bold text-slate-900 dark:text-slate-100">
                  {drilldown === 'compliance' && 'Trid Clock · LE/CD Timer'}
                  {drilldown === 'pending-le' && 'Pending Loan Estimates'}
                  {drilldown === 'cd-review' && 'Closing Disclosures in Review'}
                  {drilldown === 'at-risk' && 'At-Risk Disclosures'}
                </h3>
                <button onClick={() => setDrilldown(null)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600 dark:hover:bg-slate-800 dark:text-slate-300">
                  <X size={20} />
                </button>
              </div>
              <div className="cohi-modal-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-6 space-y-6">
                {drilldown === 'compliance' && (
                  <>
                    <div className="p-5 rounded-xl bg-emerald-50 border border-emerald-200">
                      <p className="text-[10px] font-display font-bold text-emerald-600 uppercase tracking-wider mb-1">
                        Combined (LE &amp; CD)
                      </p>
                      <p className="text-3xl font-display font-bold text-emerald-700">{tridTimelyLeCdPct}%</p>
                      <p className="text-sm text-slate-600 mt-2">
                        Share of applications with a timely Loan Estimate <strong>and</strong> CD on track or delivered for the current stage.
                      </p>
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between py-3 border-b border-slate-100">
                        <span className="text-slate-600">Timely LE (3-day rule)</span>
                        <span className="font-semibold text-emerald-700 tabular-nums">{leTimelyPct}%</span>
                      </div>
                      <div className="flex justify-between py-3 border-b border-slate-100">
                        <span className="text-slate-600">CD on track (of LE-timely)</span>
                        <span className="font-semibold text-emerald-700 tabular-nums">{cdTimelyAmongLePct}%</span>
                      </div>
                      <div className="flex justify-between py-3">
                        <span className="text-slate-600">In filtered pipeline</span>
                        <span className="font-medium tabular-nums">{filteredApps.length} apps</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-display font-bold text-slate-600 uppercase tracking-wider mb-2">
                        By application
                      </p>
                      <ul className="cohi-modal-scroll max-h-[min(220px,35dvh)] space-y-2 overflow-y-auto pr-1">
                        {filteredApps.length === 0 && (
                          <li className="text-sm text-slate-500 py-2">No applications match the current search.</li>
                        )}
                        {filteredApps.map((app) => {
                          const leOk = isTimelyLE(app);
                          const cdOk = isTimelyCD(app);
                          const both = leOk && cdOk;
                          const cdLabel = !leOk ? '—' : cdOk ? 'OK' : 'Risk';
                          const cdClass = !leOk ? 'text-slate-400' : cdOk ? 'text-emerald-600' : 'text-rose-600';
                          return (
                            <li key={app.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  setDrilldown(null);
                                  onAppClick(app.id);
                                }}
                                className="w-full text-left rounded-xl border border-slate-200/90 bg-white px-3 py-2.5 hover:bg-slate-50/80 transition-colors flex items-start justify-between gap-3"
                              >
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold text-slate-900 truncate">{anonymizeBorrowerName(app.borrower)}</p>
                                  <p className="text-[11px] text-slate-500 truncate mt-0.5">{app.id}</p>
                                </div>
                                <div className="shrink-0 flex flex-col items-end gap-1 text-[10px] font-bold uppercase tracking-wide">
                                  <span className={leOk ? 'text-emerald-600' : 'text-rose-600'}>LE {leOk ? 'OK' : 'Late'}</span>
                                  <span className={cdClass}>CD {cdLabel}</span>
                                  <span className={both ? 'text-emerald-700' : 'text-slate-400'}>{both ? 'Both' : '—'}</span>
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      LE timely = sent with a dated delivery in the mock pipeline. CD timely = sent, in review, or not yet required; completed files must show CD delivered. Tap a row to open the application.
                    </p>
                  </>
                )}
                {drilldown === 'pending-le' && (
                  <>
                    <div className="p-5 rounded-xl bg-amber-50 border border-amber-200">
                      <div className="flex flex-wrap items-end justify-between gap-4">
                        <div>
                          <p className="text-[10px] font-display font-bold text-amber-600 uppercase tracking-wider mb-1">
                            Open LE obligations
                          </p>
                          <p className="text-3xl font-display font-bold text-amber-700 tabular-nums">{pendingLeAppCount}</p>
                          <p className="text-xs text-slate-600 mt-1">Applications missing or past-due Loan Estimate</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-display font-bold text-amber-600 uppercase tracking-wider mb-1">
                            Units (est.)
                          </p>
                          <p className="text-2xl font-display font-bold text-amber-800 tabular-nums">
                            {pendingLeUnits.toLocaleString()}
                          </p>
                          <p className="text-xs text-slate-600 mt-1">Homes / contracts tied to LE queue</p>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between py-3 border-b border-slate-100">
                        <span className="text-slate-600">In filtered search</span>
                        <span className="font-medium tabular-nums">{pendingLEApps.length} apps · {pendingLeUnitsFromRows} units</span>
                      </div>
                      <div className="flex justify-between py-3 border-b border-slate-100">
                        <span className="text-slate-600">Pipeline / LOS sync (demo)</span>
                        <span className="font-medium tabular-nums">+{PENDING_LE_PIPELINE_PAD} apps · +{PENDING_LE_PIPELINE_PAD} units</span>
                      </div>
                      <div className="flex justify-between py-3 border-b border-slate-100">
                        <span className="text-slate-600">Past TRID window (Delayed)</span>
                        <span className={`font-semibold tabular-nums ${delayedLeCount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {delayedLeCount}
                        </span>
                      </div>
                      <div className="flex justify-between py-3">
                        <span className="text-slate-600">No LE date on file</span>
                        <span className="font-medium tabular-nums">{missingLeDateCount}</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-display font-bold text-slate-600 uppercase tracking-wider mb-2">
                        Cohort detail (click to open)
                      </p>
                      {pendingLEApps.length === 0 ? (
                        <p className="text-sm text-slate-500 py-2 rounded-xl border border-dashed border-slate-200 px-3">
                          No pending LE rows in the current search. Totals still include {PENDING_LE_PIPELINE_PAD} demo pipeline files from LOS aggregation.
                        </p>
                      ) : (
                        <ul className="space-y-2 max-h-[240px] overflow-y-auto pr-1">
                          {pendingLEApps.map((app) => {
                            const u = estUnitsForPendingApp(app);
                            const overdue = app.leStatus === 'Delayed';
                            return (
                              <li key={app.id}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDrilldown(null);
                                    onAppClick(app.id);
                                  }}
                                  className="w-full text-left rounded-xl border border-amber-200/70 bg-amber-50/40 px-3 py-2.5 hover:bg-amber-50/90 transition-colors flex items-start justify-between gap-3"
                                >
                                  <div className="min-w-0">
                                    <p className="text-sm font-semibold text-slate-900 truncate">{anonymizeBorrowerName(app.borrower)}</p>
                                    <p className="text-[11px] text-slate-500 truncate mt-0.5">{app.id} · {app.lender}</p>
                                    <p className="text-[11px] text-slate-500 mt-1">Applied {app.applicationDate}</p>
                                  </div>
                                  <div className="shrink-0 text-right text-[10px] font-bold uppercase tracking-wide">
                                    <p className="text-slate-700 tabular-nums">{u} units</p>
                                    <p className={overdue ? 'text-rose-600 mt-1' : 'text-amber-700 mt-1'}>
                                      {overdue ? 'Overdue' : 'Pending'}
                                    </p>
                                  </div>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <p className="text-xs font-display font-bold text-slate-600 uppercase tracking-wider mb-2">TRID 3-Day Rule</p>
                      <p className="text-sm text-slate-700 leading-relaxed">
                        Complete application = name, income, SSN, property address, loan amount, property value. Clock starts when all six elements are received. A delayed LE blocks downstream CD timing and often forces redisclosure—unit counts help builders see contract exposure, not just file count.
                      </p>
                    </div>
                  </>
                )}
                {drilldown === 'cd-review' && (
                  <>
                    <div className="p-5 rounded-xl bg-sky-50 border border-sky-200">
                      <p className="text-[10px] font-display font-bold text-sky-600 uppercase tracking-wider mb-1">In Review</p>
                      <p className="text-3xl font-display font-bold text-sky-700">{cdReviewApps.length + 8}</p>
                      <p className="text-sm text-slate-600 mt-2">CD must be delivered 3–7 days before closing</p>
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between py-3 border-b border-slate-100">
                        <span className="text-slate-600">Avg. review cycle</span>
                        <span className="font-semibold">2.4 days</span>
                      </div>
                      <div className="flex justify-between py-3 border-b border-slate-100">
                        <span className="text-slate-600">Material change redisclosures</span>
                        <span className="font-medium">2 this week (rate lock, appraisal)</span>
                      </div>
                      <div className="flex justify-between py-3">
                        <span className="text-slate-600">Intent to Proceed on file</span>
                        <span className="font-medium text-emerald-600">Required before CD</span>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Construction-to-perm: CD timing tied to conversion date. Material changes (rate lock, LTV shift, loan terms) may trigger new 3-day waiting period.
                    </p>
                  </>
                )}
                {drilldown === 'at-risk' && (
                  <>
                    <div className="p-5 rounded-xl bg-rose-50 border border-rose-200 dark:bg-rose-950/25 dark:border-rose-900/50">
                      <p className="text-[10px] font-display font-bold text-rose-600 uppercase tracking-wider mb-1">At-Risk Count</p>
                      <p className="text-3xl font-display font-bold text-rose-700 dark:text-rose-300 tabular-nums">
                        {atRiskApps.length + 3}
                      </p>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
                        Preview ordering by tracker fields (e.g. delayed LE, compliance score). Not a regulatory determination or closing prediction.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-display font-bold text-slate-700 dark:text-slate-200">Applications in this cohort</p>
                      {atRiskApps.length > 0 ? atRiskApps.map((app) => (
                        <div 
                          key={app.id}
                          onClick={() => { setDrilldown(null); onAppClick(app.id); }}
                          className="p-3 rounded-xl bg-rose-50/80 border border-rose-200/60 flex justify-between items-center cursor-pointer hover:bg-rose-100/80 dark:bg-rose-950/30 dark:border-rose-900/50"
                        >
                          <div>
                            <span className="font-medium text-slate-900 dark:text-slate-100">{anonymizeImportKvPersonName(app.borrower)}</span>
                            <span className="text-xs text-slate-500 block">{app.id}</span>
                          </div>
                          <span className="text-rose-600 dark:text-rose-400 font-semibold tabular-nums">{app.complianceScore}%</span>
                        </div>
                      )) : (
                        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 dark:bg-slate-800/50 dark:border-slate-600">
                          <span className="font-medium text-slate-900 dark:text-slate-100">
                            {anonymizeImportKvPersonName(PLACEHOLDER_AT_RISK_BORROWER)}
                          </span>
                          <span className="text-xs text-slate-500 block">APP-2026-003 — LE delayed (sample row)</span>
                        </div>
                      )}
                    </div>
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 dark:bg-slate-800/40 dark:border-slate-600">
                      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                        Preview only
                      </p>
                      <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                        The total above includes a small fixed increment when the filtered list is short. Specific disclosure gaps (LE, CD, intent to proceed, redisclosures) are{' '}
                        <strong className="font-semibold text-slate-700 dark:text-slate-300">not</strong> inferred here—open each application to see the fields stored on the RESPA tracker row in this dataset.
                      </p>
                    </div>
                  </>
                )}
              </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </div>

    {typeof document !== 'undefined' &&
      createPortal(
        <AnimatePresence>
          {complianceReportOpen && (
            <>
              <motion.div
                key="compliance-report-backdrop"
                role="presentation"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="cohi-modal-backdrop bg-slate-900/35 dark:bg-black/50"
                onClick={() => setComplianceReportOpen(false)}
              />
              <div className="cohi-modal-center-host">
              <motion.div
                key="compliance-report-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="compliance-report-title"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ type: 'spring', damping: 26, stiffness: 320 }}
                className="flex w-[min(100vw-1.5rem,42rem)] max-h-[min(88dvh,calc(100dvh-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="sticky top-0 z-10 flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95">
                  <div>
                    <h2
                      id="compliance-report-title"
                      className="text-lg font-display font-bold text-slate-900 dark:text-slate-100"
                    >
                      TRID / RESPA compliance report
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Snapshot for the current search filter ·{' '}
                      {new Date().toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={handleCopyComplianceReport}
                      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden />
                      {copyReportDone ? 'Copied' : 'Copy'}
                    </button>
                    <button
                      type="button"
                      onClick={handlePrintComplianceReport}
                      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      <Printer className="h-3.5 w-3.5" aria-hidden />
                      Print
                    </button>
                    <button
                      type="button"
                      onClick={() => setComplianceReportOpen(false)}
                      className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                      aria-label="Close report"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                <div className="cohi-modal-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 space-y-6">
                  <section>
                    <h3 className="text-[11px] font-display font-bold uppercase tracking-wider text-teal-700 dark:text-teal-400 mb-2">
                      Executive summary
                    </h3>
                    <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                      {filteredApps.length === 0 ? (
                        <>
                          No applications match the current search. Clear or widen the pipeline search to include
                          files in this report.
                        </>
                      ) : (
                        <>
                          For <strong>{filteredApps.length}</strong> filtered application
                          {filteredApps.length === 1 ? '' : 's'}, the combined <strong>Trid Clock</strong> rate (timely
                          LE <em>and</em> CD on track) is <strong>{tridTimelyLeCdPct}%</strong>. Timely Loan Estimates
                          under the 3-business-day rule: <strong>{leTimelyPct}%</strong>. Among LE-timely files, CD
                          readiness: <strong>{cdTimelyAmongLePct}%</strong>.
                        </>
                      )}
                    </p>
                  </section>

                  <section>
                    <h3 className="text-[11px] font-display font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
                      Pipeline metrics
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {[
                        { label: 'Trid Clock (LE+CD)', value: `${tridTimelyLeCdPct}%`, tone: 'emerald' as const },
                        { label: 'Timely LE', value: `${leTimelyPct}%`, tone: 'emerald' as const },
                        { label: 'CD on track (LE-timely)', value: `${cdTimelyAmongLePct}%`, tone: 'emerald' as const },
                        { label: 'Pending LEs (incl. pad)', value: String(pendingLeAppCount), tone: 'amber' as const },
                        { label: 'CD in review', value: String(cdReviewApps.length), tone: 'slate' as const },
                        { label: 'At-risk files', value: String(atRiskApps.length), tone: 'rose' as const },
                      ].map((m) => (
                        <div
                          key={m.label}
                          className={`rounded-xl border p-3 ${
                            m.tone === 'emerald'
                              ? 'border-emerald-200/80 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-950/30'
                              : m.tone === 'amber'
                                ? 'border-amber-200/80 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/30'
                                : m.tone === 'rose'
                                  ? 'border-rose-200/80 bg-rose-50/60 dark:border-rose-900/50 dark:bg-rose-950/30'
                                  : 'border-slate-200 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-800/40'
                          }`}
                        >
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 leading-tight">
                            {m.label}
                          </p>
                          <p className="text-xl font-display font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                            {m.value}
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section>
                    <h3 className="text-[11px] font-display font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                      Recommendations
                    </h3>
                    <ul className="list-disc pl-4 space-y-2 text-sm text-slate-700 dark:text-slate-300">
                      {reportRecommendations.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </section>

                  <section className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                    <h3 className="text-[11px] font-display font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                      Regulatory context (summary)
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      TRID (TILA-RESPA Integrated Disclosure) requires delivering the Loan Estimate within three business
                      days of application and the Closing Disclosure at least three business days before consummation,
                      with redisclosure after material changes. Builder-channel loans with long contract-to-close windows
                      need continuous LE/CD hygiene so construction draws and conversions do not force last-minute
                      violations.
                    </p>
                  </section>
                </div>
              </motion.div>
              </div>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
