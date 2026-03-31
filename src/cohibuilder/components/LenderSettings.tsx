import React, { useEffect, useMemo, useState } from 'react';
import { 
  Building2, 
  Globe, 
  Cpu, 
  ShieldCheck, 
  Plus,
  ExternalLink,
  Search,
  X,
  Save,
  Crown,
  ShieldAlert,
  BadgePercent,
  FileWarning,
  Users
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  loadLenders,
  saveLenders,
  seedHmdaLenders,
  type BuilderDataSource,
  type LenderRecord,
  type InstitutionType,
  type OriginationChannel,
  type LoanType,
  type DisclosureModel,
} from '../data/lenderProfiles';
import PageHeader from './PageHeader';

const CHANNEL_FILTERS: Array<'All' | 'Retail' | 'Wholesale'> = ['All', 'Retail', 'Wholesale'];

const INSTITUTION_TYPES: InstitutionType[] = ['Bank', 'Credit Union', 'IMB', 'Other'];
const CHANNELS: OriginationChannel[] = ['Retail', 'Wholesale/Broker', 'Delegated Correspondent', 'Non-Delegated Correspondent', 'Other'];
const LOAN_TYPES: LoanType[] = [
  'Conventional',
  'FHA',
  'VA',
  'USDA',
  'State Bond',
  'Reverse',
  'Land Only',
  'Construction Only',
  'Construction-to-Permanent',
  '1-4 Rehab',
  'Non-QM',
  'Asset Based',
  'DSCR',
];
const DISCLOSURE_MODELS: DisclosureModel[] = [
  'Disclosure desk',
  'Origination discloses',
  'LOA discloses',
  'Processors disclose/redisclose',
  'Unknown',
];

const BUILDER_DATA_SOURCES: BuilderDataSource[] = ['Builder CRM/ERP', 'LOS'];

function setToToggle<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

const STATUSES: Array<LenderRecord['status']> = ['Active', 'Onboarding', 'Inactive'];

const logoFromName = (name: string) => {
  const parts = name
    .split(/\s+/g)
    .map((p) => p.trim())
    .filter(Boolean);
  const letters = (parts[0]?.[0] ?? 'N') + (parts[1]?.[0] ?? parts[0]?.[1] ?? 'L');
  return letters.toUpperCase().slice(0, 3);
};

interface LenderSettingsProps {
  onLenderClick?: (id: number) => void;
}

export default function LenderSettings({ onLenderClick }: LenderSettingsProps) {
  const [lenders, setLenders] = useState<LenderRecord[]>(() => loadLenders());
  const [query, setQuery] = useState('');
  const [channelFilter, setChannelFilter] = useState<(typeof CHANNEL_FILTERS)[number]>('All');
  const [editingId, setEditingId] = useState<number | null>(null);
  const editing = useMemo(() => lenders.find((l) => l.id === editingId) ?? null, [editingId, lenders]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lenders.filter((l) => {
      const channelOk =
        channelFilter === 'All' ||
        (channelFilter === 'Retail' && l.profile.channels.includes('Retail')) ||
        (channelFilter === 'Wholesale' && l.profile.channels.some((c) => c.toLowerCase().includes('wholesale')));

      if (!channelOk) return false;
      if (!q) return true;
      const hay = `${l.name} ${l.profile.nmlsNumber} ${l.profile.institutionType} ${l.techStack.los} ${l.techStack.pos}`.toLowerCase();
      return hay.includes(q);
    });
  }, [channelFilter, lenders, query]);

  const saveEdit = (next: LenderRecord) => {
    const nextAll = lenders.map((l) => (l.id === next.id ? next : l));
    setLenders(nextAll);
    saveLenders(nextAll);
  };

  useEffect(() => {
    // Seed 100 HMDA filers into the demo dataset (best-effort).
    seedHmdaLenders({ year: 2024, limit: 100 }).then(() => setLenders(loadLenders()));
  }, []);

  const handleAddNewLender = () => {
    const nextId = lenders.reduce((max, l) => Math.max(max, l.id), 0) + 1;
    const next: LenderRecord = {
      id: nextId,
      name: 'New Lender',
      logo: 'NL',
      status: 'Onboarding',
      techStack: { los: '', pos: '' },
      profile: {
        institutionType: 'Other',
        nmlsNumber: '',
        lei: '',
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
    };

    const nextAll = [next, ...lenders];
    setLenders(nextAll);
    saveLenders(nextAll);
    setEditingId(nextId);
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        badge="Lender Profiles"
        title="Lender Master"
        subtitle="Tenant-style lender profiles for onboarding: channels, LOS/POS, and—when marked captive builder—communities, capture targets, and where data lives (builder vs. LOS)."
      >
        <button
          type="button"
          onClick={handleAddNewLender}
          className="flex items-center gap-2 px-4 py-2 btn-primary text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} />
          Add New Lender
        </button>
      </PageHeader>

      <div className="card-base overflow-hidden rounded-2xl">
        <div className="p-4 sm:p-6 border-b border-slate-200/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/20">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input 
              type="text" 
              placeholder="Filter lenders..." 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-11 pr-4 py-2.5 bg-white/80 border border-slate-200/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-300/50 focus:border-sky-300 text-slate-900 placeholder:text-slate-500 text-base leading-relaxed shadow-sm"
            />
          </div>
          <div className="flex gap-2">
            {CHANNEL_FILTERS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setChannelFilter(t)}
                className={`px-4 py-2.5 text-sm font-display font-semibold rounded-xl transition-colors ${
                  channelFilter === t ? 'bg-sky-50/80 text-sky-600 border border-sky-200/60' : 'bg-white/50 text-slate-600 border border-slate-200/40 hover:bg-white/70'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 divide-y divide-slate-200/50">
          {filtered.map((lender) => (
            <div 
              key={lender.id} 
              onClick={() => onLenderClick?.(lender.id)}
              className="p-6 hover:bg-white/30 transition-colors bg-white/10 cursor-pointer group"
            >
              <div className="flex flex-col lg:flex-row lg:items-center gap-6">
                {/* Lender Identity */}
                <div className="flex items-center gap-4 lg:w-1/4">
                  <div className="w-12 h-12 bg-teal-50/80 text-teal-600 rounded-xl flex items-center justify-center font-display font-bold text-lg border border-teal-200/50 shadow-sm">
                    {lender.logo}
                  </div>
                  <div>
                    <h3 className="text-lg font-display font-bold text-slate-900 flex items-center gap-2 tracking-tight">
                      {lender.name}
                      {lender.status === 'Active' && <ShieldCheck size={16} className="text-emerald-500" />}
                    </h3>
                    <p className="text-sm text-slate-600 flex items-center gap-1.5 font-medium leading-relaxed">
                      <Globe size={14} className="text-sky-500" />
                      {lender.profile.nmlsNumber
                        ? `NMLS: ${lender.profile.nmlsNumber}`
                        : lender.profile.lei
                          ? `LEI: ${lender.profile.lei}`
                          : 'NMLS/LEI: —'}
                    </p>
                  </div>
                </div>

                {/* Channels */}
                <div className="lg:w-1/4">
                  <p className="text-[10px] text-slate-500 uppercase font-display font-bold tracking-wider mb-2">Supported Channels</p>
                  <div className="flex flex-wrap gap-2">
                    {lender.profile.channels.map(channel => (
                      <span key={channel} className="px-3 py-1.5 bg-violet-50/70 text-violet-600 rounded-full text-xs font-semibold border border-violet-200/40">
                        {channel}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Tech Stack */}
                <div className="lg:w-1/3">
                  <p className="text-[10px] text-slate-500 uppercase font-display font-bold tracking-wider mb-2">Tech Stack Integration</p>
                  <div className="flex gap-4">
                    <div className="flex items-center gap-2">
                      <div className="p-2.5 bg-sky-50/80 rounded-xl text-sky-600 border border-sky-200/40">
                        <Building2 size={16} />
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase font-display font-bold tracking-wider">LOS</p>
                        <p className="text-sm font-semibold text-slate-900">{lender.techStack.los || '—'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="p-2.5 bg-amber-50/80 rounded-xl text-amber-600 border border-amber-200/40">
                        <Cpu size={16} />
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase font-display font-bold tracking-wider">POS</p>
                        <p className="text-sm font-semibold text-slate-900">{lender.techStack.pos || '—'}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="lg:w-1/6 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onLenderClick?.(lender.id);
                    }}
                    className="p-2.5 text-slate-500 hover:text-sky-600 hover:bg-sky-50 rounded-xl transition-colors"
                    aria-label="Open lender profile"
                    title="Open lender profile"
                  >
                    <ExternalLink size={20} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingId(lender.id);
                    }}
                    className="px-4 py-2 text-sm font-display font-semibold text-slate-700 bg-rose-50/70 hover:bg-rose-50 rounded-xl transition-colors border border-rose-200/40"
                  >
                    Edit Profile
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[var(--z-modal-backdrop)] flex items-end justify-center bg-white/55 p-3 backdrop-blur-sm sm:items-center sm:p-6"
            onClick={() => setEditingId(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 260, damping: 26 }}
              className="flex max-h-[min(90dvh,calc(100dvh-2rem))] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/60 bg-white/90 p-0 shadow-xl backdrop-blur-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="shrink-0 border-b border-slate-200/60 bg-violet-50/50 p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="text-lg sm:text-xl font-display font-bold text-slate-900 tracking-tight truncate">
                      Edit lender profile
                    </h2>
                    <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                      Questionnaire-driven profile fields (institution, channels, product footprint, tech stack, staffing).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="p-2 rounded-xl hover:bg-rose-100 transition-colors text-slate-600"
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className="cohi-modal-scroll min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-5 sm:p-6">
                {/* Lender card */}
                <div className="rounded-2xl border border-sky-200/60 bg-sky-50/60 backdrop-blur-sm p-5 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-2xl border border-sky-200 shadow-sm flex items-center justify-center bg-sky-100 text-sky-600">
                      <Building2 size={17} strokeWidth={2.4} />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Lender card</div>
                      <div className="text-sm text-slate-500 mt-1">What appears in the master list and high-level screens.</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="space-y-1">
                      <div className="text-xs font-semibold text-slate-700">Lender name</div>
                      <input
                        value={editing.name}
                        onChange={(e) => {
                          const name = e.target.value;
                          saveEdit({ ...editing, name, logo: logoFromName(name) });
                        }}
                        className="w-full px-3 py-2 rounded-xl bg-white/45 border border-white/60 shadow-sm text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </label>

                    <label className="space-y-1">
                      <div className="text-xs font-semibold text-slate-700">Status</div>
                      <select
                        value={editing.status}
                        onChange={(e) => saveEdit({ ...editing, status: e.target.value as LenderRecord['status'] })}
                        className="w-full px-3 py-2 rounded-xl bg-white/45 border border-white/60 shadow-sm text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-1">
                      <div className="text-xs font-semibold text-slate-700">LOS</div>
                      <input
                        value={editing.techStack.los}
                        onChange={(e) => saveEdit({ ...editing, techStack: { ...editing.techStack, los: e.target.value } })}
                        className="w-full px-3 py-2 rounded-xl bg-white/45 border border-white/60 shadow-sm text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        placeholder="e.g., Encompass…"
                      />
                    </label>

                    <label className="space-y-1">
                      <div className="text-xs font-semibold text-slate-700">POS</div>
                      <input
                        value={editing.techStack.pos}
                        onChange={(e) => saveEdit({ ...editing, techStack: { ...editing.techStack, pos: e.target.value } })}
                        className="w-full px-3 py-2 rounded-xl bg-white/45 border border-white/60 shadow-sm text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        placeholder="e.g., Blend…"
                      />
                    </label>
                  </div>
                </div>

                {/* Institution */}
                <div className="rounded-2xl border border-amber-200/60 bg-amber-50/60 backdrop-blur-sm p-5 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-2xl border border-amber-200 shadow-sm flex items-center justify-center bg-amber-100 text-amber-700">
                      <Crown size={17} strokeWidth={2.4} />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Institution profile</div>
                      <div className="text-sm text-slate-500 mt-1">Core identifiers used across compliance and vendor integrations.</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="space-y-1">
                      <div className="text-xs font-semibold text-slate-700">Institution type</div>
                      <select
                        value={editing.profile.institutionType}
                        onChange={(e) =>
                          saveEdit({
                            ...editing,
                            profile: { ...editing.profile, institutionType: e.target.value as InstitutionType },
                          })
                        }
                        className="w-full px-3 py-2 rounded-xl bg-white/45 border border-white/60 shadow-sm text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      >
                        {INSTITUTION_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-1">
                      <div className="text-xs font-semibold text-slate-700">NMLS number</div>
                      <input
                        value={editing.profile.nmlsNumber}
                        onChange={(e) =>
                          saveEdit({ ...editing, profile: { ...editing.profile, nmlsNumber: e.target.value } })
                        }
                        className="w-full px-3 py-2 rounded-xl bg-white/45 border border-white/60 shadow-sm text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </label>

                    <label className="space-y-1">
                      <div className="text-xs font-semibold text-slate-700">LEI (optional)</div>
                      <input
                        value={editing.profile.lei ?? ''}
                        onChange={(e) => saveEdit({ ...editing, profile: { ...editing.profile, lei: e.target.value } })}
                        className="w-full px-3 py-2 rounded-xl bg-white/45 border border-white/60 shadow-sm text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </label>

                    <label className="space-y-1">
                      <div className="text-xs font-semibold text-slate-700">DBA names (comma separated)</div>
                      <input
                        value={(editing.profile.dbaNames ?? []).join(', ')}
                        onChange={(e) =>
                          saveEdit({
                            ...editing,
                            profile: {
                              ...editing.profile,
                              dbaNames: e.target.value
                                .split(',')
                                .map((s) => s.trim())
                                .filter(Boolean),
                              hasDba: e.target.value.trim().length > 0,
                            },
                          })
                        }
                        className="w-full px-3 py-2 rounded-xl bg-white/45 border border-white/60 shadow-sm text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </label>
                  </div>
                </div>

                {/* Channels + Products */}
                <div className="rounded-2xl border border-emerald-200/60 bg-emerald-50/60 backdrop-blur-sm p-5 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-2xl border border-emerald-200 shadow-sm flex items-center justify-center bg-emerald-100 text-emerald-700">
                      <ShieldCheck size={17} strokeWidth={2.4} />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Channel + product footprint</div>
                      <div className="text-sm text-slate-500 mt-1">Aligns with the questionnaire’s “channels” and “loan types”.</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    <div>
                      <div className="text-xs font-semibold text-slate-700 mb-2">Origination channels</div>
                      <div className="flex flex-wrap gap-2">
                        {CHANNELS.map((c) => {
                          const active = editing.profile.channels.includes(c);
                          return (
                            <button
                              key={c}
                              type="button"
                              onClick={() =>
                                saveEdit({
                                  ...editing,
                                  profile: { ...editing.profile, channels: setToToggle(editing.profile.channels, c) },
                                })
                              }
                              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                                active ? 'bg-sky-100 text-sky-800 border-sky-200' : 'bg-white/60 text-slate-700 border-slate-200/60 hover:bg-white/80'
                              }`}
                            >
                              {c}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-semibold text-slate-700 mb-2">Loan types</div>
                      <div className="flex flex-wrap gap-2">
                        {LOAN_TYPES.map((t) => {
                          const active = editing.profile.loanTypes.includes(t);
                          return (
                            <button
                              key={t}
                              type="button"
                              onClick={() =>
                                saveEdit({
                                  ...editing,
                                  profile: { ...editing.profile, loanTypes: setToToggle(editing.profile.loanTypes, t) },
                                })
                              }
                              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                                active ? 'bg-violet-100 text-violet-800 border-violet-200' : 'bg-white/60 text-slate-700 border-slate-200/60 hover:bg-white/80'
                              }`}
                            >
                              {t}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="flex items-center justify-between gap-3 rounded-2xl border border-white/60 bg-white/25 px-4 py-3">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-800">Construction lending</div>
                        <div className="text-[11px] font-medium text-slate-500">Construction only / C2P / rehab</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={editing.profile.doesConstructionLending}
                        onChange={(e) =>
                          saveEdit({
                            ...editing,
                            profile: { ...editing.profile, doesConstructionLending: e.target.checked },
                          })
                        }
                        className="h-4 w-4"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3 rounded-2xl border border-white/60 bg-white/25 px-4 py-3">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-800">Captive builder lender</div>
                        <div className="text-[11px] font-medium text-slate-500">Affiliated / in‑house lending model</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={Boolean(editing.profile.isCaptiveBuilderLender)}
                        onChange={(e) =>
                          saveEdit({
                            ...editing,
                            profile: { ...editing.profile, isCaptiveBuilderLender: e.target.checked },
                          })
                        }
                        className="h-4 w-4"
                      />
                    </label>
                  </div>

                  {editing.profile.isCaptiveBuilderLender && (
                    <div className="mt-5 rounded-2xl border border-amber-200/70 bg-amber-50/40 backdrop-blur-sm p-4 sm:p-5 space-y-4">
                      <div>
                        <div className="text-xs font-semibold text-amber-950 uppercase tracking-wider">Builder alignment</div>
                        <p className="text-[11px] text-amber-900/80 mt-1 leading-relaxed">
                          Capture targets, communities, and where data is mastered—used to tune dashboards and AI for builder-affiliated tenants.
                        </p>
                      </div>
                      <label className="space-y-1 block">
                        <div className="text-xs font-semibold text-slate-800">Primary builder partners (comma separated)</div>
                        <input
                          value={(editing.profile.primaryBuilderPartners ?? []).join(', ')}
                          onChange={(e) =>
                            saveEdit({
                              ...editing,
                              profile: {
                                ...editing.profile,
                                primaryBuilderPartners: e.target.value
                                  .split(',')
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                              },
                            })
                          }
                          placeholder="e.g., Toll Brothers, Regional ABC Homes"
                          className="w-full px-3 py-2 rounded-xl bg-white/45 border border-white/60 shadow-sm text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <label className="space-y-1 block">
                          <div className="text-xs font-semibold text-slate-800">Active communities (approx.)</div>
                          <input
                            type="number"
                            min={0}
                            value={editing.profile.activeCommunitiesCount ?? ''}
                            onChange={(e) =>
                              saveEdit({
                                ...editing,
                                profile: {
                                  ...editing.profile,
                                  activeCommunitiesCount:
                                    e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)),
                                },
                              })
                            }
                            className="w-full px-3 py-2 rounded-xl bg-white/45 border border-white/60 shadow-sm text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                            placeholder="e.g., 42"
                          />
                        </label>
                        <label className="space-y-1 block">
                          <div className="text-xs font-semibold text-slate-800">Capture target (%)</div>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={editing.profile.captureTargetPct ?? ''}
                            onChange={(e) =>
                              saveEdit({
                                ...editing,
                                profile: {
                                  ...editing.profile,
                                  captureTargetPct:
                                    e.target.value === ''
                                      ? undefined
                                      : Math.min(100, Math.max(0, Number(e.target.value))),
                                },
                              })
                            }
                            className="w-full px-3 py-2 rounded-xl bg-white/45 border border-white/60 shadow-sm text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                            placeholder="e.g., 85"
                          />
                        </label>
                      </div>
                      <label className="space-y-1 block">
                        <div className="text-xs font-semibold text-slate-800">Incentive posture (optional)</div>
                        <textarea
                          value={editing.profile.incentivePosture ?? ''}
                          onChange={(e) =>
                            saveEdit({
                              ...editing,
                              profile: { ...editing.profile, incentivePosture: e.target.value || undefined },
                            })
                          }
                          rows={2}
                          placeholder="e.g., Standard closing cost credits; rate buydowns on select plans…"
                          className="w-full px-3 py-2 rounded-xl bg-white/45 border border-white/60 shadow-sm text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-y min-h-[64px]"
                        />
                      </label>
                      <div>
                        <div className="text-xs font-semibold text-slate-800 mb-2">Primary data availability</div>
                        <div className="flex flex-wrap gap-2">
                          {BUILDER_DATA_SOURCES.map((src) => {
                            const active = (editing.profile.primaryDataSources ?? []).includes(src);
                            return (
                              <button
                                key={src}
                                type="button"
                                onClick={() => {
                                  const cur = editing.profile.primaryDataSources ?? [];
                                  saveEdit({
                                    ...editing,
                                    profile: {
                                      ...editing.profile,
                                      primaryDataSources:
                                        cur.includes(src) ? cur.filter((s) => s !== src) : [...cur, src],
                                    },
                                  });
                                }}
                                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                                  active
                                    ? 'bg-amber-200 text-amber-950 border-amber-300'
                                    : 'bg-white/60 text-slate-700 border-slate-200/60 hover:bg-white/80'
                                }`}
                              >
                                {src}
                              </button>
                            );
                          })}
                        </div>
                        {(editing.profile.primaryDataSources?.length ?? 0) === 2 && (
                          <p className="text-[11px] text-amber-900/80 mt-2">Both selected: plan for reconciled metrics from builder systems and LOS.</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Tech + workflow */}
                <div className="rounded-2xl border border-violet-200/60 bg-violet-50/60 backdrop-blur-sm p-5 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-2xl border border-violet-200 shadow-sm flex items-center justify-center bg-violet-100 text-violet-700">
                      <BadgePercent size={17} strokeWidth={2.4} />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Workflow + vendors</div>
                      <div className="text-sm text-slate-500 mt-1">Disclosure model, borrower app, and key platforms.</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="space-y-1">
                      <div className="text-xs font-semibold text-slate-700">Disclosure model</div>
                      <select
                        value={editing.profile.disclosureModel ?? 'Unknown'}
                        onChange={(e) =>
                          saveEdit({
                            ...editing,
                            profile: { ...editing.profile, disclosureModel: e.target.value as DisclosureModel },
                          })
                        }
                        className="w-full px-3 py-2 rounded-xl bg-white/45 border border-white/60 shadow-sm text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      >
                        {DISCLOSURE_MODELS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-1">
                      <div className="text-xs font-semibold text-slate-700">Borrower app platform</div>
                      <input
                        value={editing.profile.borrowerAppPlatform ?? ''}
                        onChange={(e) =>
                          saveEdit({
                            ...editing,
                            profile: { ...editing.profile, borrowerAppPlatform: e.target.value, hasOnlineBorrowerApp: true },
                          })
                        }
                        className="w-full px-3 py-2 rounded-xl bg-white/45 border border-white/60 shadow-sm text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        placeholder="e.g., Blend, SimpleNexus, Roostify…"
                      />
                    </label>

                    <label className="space-y-1">
                      <div className="text-xs font-semibold text-slate-700">Accounting</div>
                      <input
                        value={editing.profile.accountingVendor ?? ''}
                        onChange={(e) => saveEdit({ ...editing, profile: { ...editing.profile, accountingVendor: e.target.value } })}
                        className="w-full px-3 py-2 rounded-xl bg-white/45 border border-white/60 shadow-sm text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        placeholder="e.g., LoanVision…"
                      />
                    </label>

                    <label className="space-y-1">
                      <div className="text-xs font-semibold text-slate-700">Capital markets / hedging</div>
                      <input
                        value={editing.profile.capitalMarketsProvider ?? ''}
                        onChange={(e) =>
                          saveEdit({ ...editing, profile: { ...editing.profile, capitalMarketsProvider: e.target.value } })
                        }
                        className="w-full px-3 py-2 rounded-xl bg-white/45 border border-white/60 shadow-sm text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        placeholder="e.g., MCT…"
                      />
                    </label>
                  </div>
                </div>

                {/* Staffing */}
                <div className="rounded-2xl border border-rose-200/60 bg-rose-50/60 backdrop-blur-sm p-5 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-2xl border border-rose-200 shadow-sm flex items-center justify-center bg-rose-100 text-rose-700">
                      <Users size={17} strokeWidth={2.4} />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Staffing (optional)</div>
                      <div className="text-sm text-slate-500 mt-1">Operations capacity for throughput and SLA risk.</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {(
                      [
                        ['processors', 'Processors'],
                        ['underwriters', 'Underwriters'],
                        ['closers', 'Closers'],
                        ['branches', 'Branches'],
                        ['loanOfficers', 'Loan officers'],
                        ['assistantLoanOfficers', 'Assistant LOs'],
                        ['secondaryMarketing', 'Secondary mktg'],
                        ['servicing', 'Servicing'],
                        ['qcPostClosing', 'QC/Post close'],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="space-y-1">
                        <div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">{label}</div>
                        <input
                          type="number"
                          value={editing.profile.staffing?.[key] ?? ''}
                          onChange={(e) =>
                            saveEdit({
                              ...editing,
                              profile: {
                                ...editing.profile,
                                staffing: {
                                  ...(editing.profile.staffing ?? {}),
                                  [key]: e.target.value === '' ? undefined : Number(e.target.value),
                                },
                              },
                            })
                          }
                          className="w-full px-3 py-2 rounded-xl bg-white/45 border border-white/60 shadow-sm text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                          min={0}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-5 sm:p-6 border-t border-slate-200/60 bg-teal-50/50 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-600 leading-relaxed">
                  <FileWarning size={16} className="text-amber-500" />
                  Fields mirror the “Client Questionnaire – Lender Profile” sheet.
                </div>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-100 border border-teal-200 text-slate-900 text-sm font-display font-semibold hover:bg-teal-200/80 transition-colors shadow-sm"
                >
                  <Save size={16} className="text-teal-600" />
                  Done
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
