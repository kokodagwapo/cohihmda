import React, { useMemo, useState } from 'react';
import { Wallet, Clock, CheckCircle2, AlertCircle, ChevronRight, Download, Search, CalendarClock, ShieldAlert } from 'lucide-react';
import { motion } from 'motion/react';
import { DRAW_REQUESTS, type DrawRequest } from '../data/mockDraws';

const formatMoney = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const parseIsoDate = (s: string) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

const daysBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)));

const nextStepForStatus = (d: DrawRequest) => {
  if (d.status === 'Pending Inspection') return d.inspectionStatus === 'Not scheduled' ? 'Schedule inspection' : 'Complete inspection';
  if (d.status === 'Action Required') return 'Resolve blockers';
  return 'Disburse funds';
};

interface DrawManagementProps {
  onDrawClick?: (id: string) => void;
}

export default function DrawManagement({ onDrawClick }: DrawManagementProps) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'action' | 'approved'>('all');
  const [query, setQuery] = useState('');

  const stats = useMemo(() => {
    const draws = DRAW_REQUESTS;
    const approved = draws.filter((d) => d.status === 'Approved');
    const pending = draws.filter((d) => d.status === 'Pending Inspection');
    const action = draws.filter((d) => d.status === 'Action Required');

    const approvedSum = approved.reduce((acc, d) => acc + d.requested, 0);
    const pendingSum = pending.reduce((acc, d) => acc + d.requested, 0);
    const actionSum = action.reduce((acc, d) => acc + d.requested, 0);

    const cycleDays = approved
      .map((d) => {
        const start = parseIsoDate(d.requestedDate);
        const end = parseIsoDate(d.lastUpdatedDate);
        return start && end ? daysBetween(start, end) : null;
      })
      .filter((v): v is number => v !== null);

    const avgCycle = cycleDays.length ? Math.round(cycleDays.reduce((a, b) => a + b, 0) / cycleDays.length) : 0;

    return {
      total: draws.length,
      approvedCount: approved.length,
      pendingCount: pending.length,
      actionCount: action.length,
      approvedSum,
      pendingSum,
      actionSum,
      avgCycle,
    };
  }, []);

  const filteredDraws = useMemo(() => {
    const q = query.trim().toLowerCase();
    return DRAW_REQUESTS.filter((d) => {
      const statusOk =
        filter === 'all' ||
        (filter === 'pending' && d.status === 'Pending Inspection') ||
        (filter === 'action' && d.status === 'Action Required') ||
        (filter === 'approved' && d.status === 'Approved');

      if (!statusOk) return false;
      if (!q) return true;
      const haystack = `${d.id} ${d.project} ${d.phase} ${d.status} ${d.inspector}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [filter, query]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl text-[var(--text-primary)] font-bold tracking-tight">Draw Operations</h1>
            <p className="text-[var(--text-secondary)] mt-1 font-medium">
              Keep disbursements moving with a single queue for inspection, approval, and funding.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button className="flex items-center gap-2 px-3 py-2 glass-panel rounded-xl text-sm font-medium text-slate-700 hover:bg-white/30 transition-all shadow-sm border border-white/60">
              <Download size={16} />
              Export
            </button>
            <button className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 text-white rounded-xl font-medium hover:bg-teal-700 transition-colors shadow-sm">
              <Wallet size={18} />
              Request Draw
            </button>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: 'all' as const, label: `All (${stats.total})` },
              { id: 'pending' as const, label: `Pending inspection (${stats.pendingCount})` },
              { id: 'action' as const, label: `Action required (${stats.actionCount})` },
              { id: 'approved' as const, label: `Approved (${stats.approvedCount})` },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilter(t.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                  filter === t.id
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-white/35 text-slate-700 border-white/60 hover:bg-white/55'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="relative w-full lg:w-[380px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search draws, borrower, phase, inspector…"
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/45 backdrop-blur-sm border border-white/60 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/40 transition-all text-sm text-slate-900 placeholder:text-slate-500 shadow-sm"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="card-base p-5 sm:p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-emerald-50/70 text-emerald-700 rounded-xl border border-white/60">
              <CheckCircle2 size={18} />
            </div>
            <h3 className="text-sm font-medium text-[var(--text-secondary)]">Approved funding (YTD)</h3>
          </div>
          <p className="text-[32px] sm:text-[36px] font-bold text-[var(--text-primary)] leading-none">{formatMoney(stats.approvedSum)}</p>
          <p className="mt-2 text-xs font-medium text-slate-500">{stats.approvedCount} draws approved</p>
        </div>

        <div className="card-base p-5 sm:p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-amber-50/70 text-amber-800 rounded-xl border border-white/60">
              <Clock size={18} />
            </div>
            <h3 className="text-sm font-medium text-[var(--text-secondary)]">Inspections pending</h3>
          </div>
          <p className="text-[32px] sm:text-[36px] font-bold text-[var(--text-primary)] leading-none">{stats.pendingCount}</p>
          <p className="mt-2 text-xs font-medium text-slate-500">{formatMoney(stats.pendingSum)} in queue</p>
        </div>

        <div className="card-base p-5 sm:p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-rose-50/70 text-rose-700 rounded-xl border border-white/60">
              <AlertCircle size={18} />
            </div>
            <h3 className="text-sm font-medium text-[var(--text-secondary)]">Action required</h3>
          </div>
          <p className="text-[32px] sm:text-[36px] font-bold text-[var(--text-primary)] leading-none">{stats.actionCount}</p>
          <p className="mt-2 text-xs font-medium text-slate-500">{formatMoney(stats.actionSum)} blocked</p>
        </div>
      </div>

      <div className="card-base overflow-hidden">
        <div className="p-4 sm:p-6 border-b border-[var(--border-subtle)] flex items-start sm:items-center justify-between gap-3 bg-slate-50/50">
          <div>
            <h2 className="text-base sm:text-lg font-medium text-[var(--text-primary)]">Draw queue</h2>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)] font-medium mt-0.5">
              Click any draw to open drilldown details (inspection, documents, and timeline).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 text-[11px] font-semibold text-slate-600">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/50 border border-white/60">
                <CalendarClock size={14} />
                Avg cycle: {stats.avgCycle}d
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/50 border border-white/60">
                <ShieldAlert size={14} />
                SLA focus: pending + action
              </span>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto hidden md:block">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-[var(--bg-surface)] text-[var(--text-secondary)] text-xs uppercase tracking-[0.05em] border-b border-[var(--border-subtle)]">
                <th className="px-6 py-4 font-semibold">Draw</th>
                <th className="px-6 py-4 font-semibold">Project</th>
                <th className="px-6 py-4 font-semibold">Amount</th>
                <th className="px-6 py-4 font-semibold">Aging</th>
                <th className="px-6 py-4 font-semibold">Next step</th>
                <th className="px-6 py-4 font-semibold">Status</th>
                <th className="px-6 py-4 font-semibold text-right">Open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {filteredDraws.map((draw) => {
                const start = parseIsoDate(draw.requestedDate);
                const end = parseIsoDate(draw.lastUpdatedDate);
                const aging = start ? daysBetween(start, new Date()) : 0;
                const cycle = start && end ? daysBetween(start, end) : null;
                const slaHot = draw.status !== 'Approved' && aging >= 5;

                return (
                  <tr
                    key={draw.id}
                    onClick={() => onDrawClick?.(draw.id)}
                    className="hover:bg-slate-50 transition-colors bg-[var(--bg-surface)] cursor-pointer group"
                  >
                    <td className="px-6 py-4">
                      <div className="text-sm font-mono text-[var(--text-secondary)]">{draw.id}</div>
                      <div className="text-[11px] text-slate-500 font-medium mt-0.5">{draw.phase}</div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-semibold text-[var(--text-primary)]">{draw.project}</p>
                      <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                        Requested {draw.requestedDate} • Inspector: {draw.inspector}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-medium font-mono text-[var(--text-primary)]">{formatMoney(draw.requested)}</p>
                      <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                        {Math.round((draw.requested / draw.total) * 100)}% of {formatMoney(draw.total)}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                        slaHot ? 'bg-amber-50/70 text-amber-800 border-amber-200/60' : 'bg-white/45 text-slate-700 border-white/60'
                      }`}>
                        <Clock size={14} />
                        <span className="tabular-nums">{aging}d</span>
                        {cycle !== null && <span className="text-slate-500 font-medium">• {cycle}d cycle</span>}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-semibold text-slate-900">{nextStepForStatus(draw)}</span>
                      <div className="text-xs text-slate-500 font-medium mt-0.5">{draw.inspectionDateLabel}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                        draw.status === 'Approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60' :
                        draw.status === 'Pending Inspection' ? 'bg-amber-50 text-amber-700 border-amber-200/60' :
                        'bg-rose-50 text-rose-700 border-rose-200/60'
                      }`}>
                        {draw.status === 'Approved' && <CheckCircle2 size={12} />}
                        {draw.status === 'Pending Inspection' && <Clock size={12} />}
                        {draw.status === 'Action Required' && <AlertCircle size={12} />}
                        {draw.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg hover:bg-slate-100 transition-colors">
                        <ChevronRight size={18} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile Card View */}
        <div className="md:hidden divide-y divide-[var(--border-subtle)]">
          {filteredDraws.map((draw) => (
            <button
              key={draw.id}
              type="button"
              onClick={() => onDrawClick?.(draw.id)}
              className="w-full text-left p-4 bg-[var(--bg-surface)] hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--text-primary)] truncate">{draw.project}</div>
                  <div className="mt-1 text-xs font-medium text-[var(--text-secondary)] truncate">
                    {draw.id} • {draw.phase} • {draw.requestedDate}
                  </div>
                </div>
                <span className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                  draw.status === 'Approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60' :
                  draw.status === 'Pending Inspection' ? 'bg-amber-50 text-amber-700 border-amber-200/60' :
                  'bg-rose-50 text-rose-700 border-rose-200/60'
                }`}>
                  {draw.status}
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="text-sm font-mono font-semibold text-slate-900">{formatMoney(draw.requested)}</div>
                <div className="text-xs font-semibold text-slate-700">{nextStepForStatus(draw)} →</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
