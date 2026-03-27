import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Building2, Globe, Cpu, ShieldCheck, Mail, Phone, MapPin, Users, Activity, BarChart3, Pencil } from 'lucide-react';
import { loadLenders, saveLenders, type LenderRecord } from '../data/lenderProfiles';

interface LenderDetailProps {
  lenderId: number;
  onBack: () => void;
}

export default function LenderDetail({ lenderId, onBack }: LenderDetailProps) {
  const [all, setAll] = useState<LenderRecord[]>(() => loadLenders());
  const lender = useMemo(() => all.find((l) => l.id === lenderId) ?? all[0], [all, lenderId]);
  const saveOne = (next: LenderRecord) => {
    const nextAll = all.map((l) => (l.id === next.id ? next : l));
    setAll(nextAll);
    saveLenders(nextAll);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <button 
          onClick={onBack}
          className="p-2 hover:bg-slate-100 rounded-xl text-[var(--text-secondary)] transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-3xl text-[var(--text-primary)] font-bold tracking-tight">Lender Profile</h1>
          <p className="text-[var(--text-secondary)] mt-1 font-medium">
            {lender.name} • {lender.profile.nmlsNumber ? `NMLS ${lender.profile.nmlsNumber}` : lender.profile.lei ? `LEI ${lender.profile.lei}` : 'NMLS/LEI —'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {/* Main Info */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-base p-8 relative"
          >
            <div className="flex items-start justify-between mb-8">
              <div className="flex items-center gap-6">
                <div className="w-20 h-20 bg-slate-50 text-teal-600 rounded-2xl flex items-center justify-center font-bold text-3xl border border-[var(--border-subtle)] shadow-sm">
                  {lender.logo}
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-3">
                    {lender.name}
                    <ShieldCheck size={24} className="text-emerald-500" />
                  </h2>
                  <div className="flex flex-wrap gap-4 mt-2">
                    <span className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)] font-medium">
                      <Globe size={16} />
                      {lender.profile.nmlsNumber ? `NMLS ${lender.profile.nmlsNumber}` : lender.profile.lei ? `LEI ${lender.profile.lei}` : 'NMLS/LEI —'}
                    </span>
                    <span className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)] font-medium">
                      <Activity size={16} className="text-emerald-500" />
                      Status: {lender.status}
                    </span>
                    <span className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)] font-medium">
                      <Building2 size={16} />
                      {lender.profile.institutionType}
                    </span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  saveOne({
                    ...lender,
                    status: lender.status === 'Active' ? 'Onboarding' : 'Active',
                  })
                }
                className="px-4 py-2 rounded-xl border border-[var(--border-subtle)] bg-white/40 hover:bg-white/60 transition-colors text-sm font-semibold text-slate-800 flex items-center gap-2"
                title="Demo action: toggle status"
              >
                <Pencil size={16} />
                Quick edit
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-widest">Contact Information</h3>
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-[var(--text-primary)]">
                    <Mail size={16} className="text-[var(--text-secondary)]" />
                    <span className="text-sm">{lender.email}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[var(--text-primary)]">
                    <Phone size={16} className="text-[var(--text-secondary)]" />
                    <span className="text-sm">{lender.phone}</span>
                  </div>
                  <div className="flex items-start gap-3 text-[var(--text-primary)]">
                    <MapPin size={16} className="text-[var(--text-secondary)] mt-0.5" />
                    <span className="text-sm">{lender.address}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-widest">Tech Stack</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-50 rounded-xl border border-[var(--border-subtle)]">
                    <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mb-1">LOS</p>
                    <p className="text-sm font-bold text-[var(--text-primary)]">{lender.profile.losVendor ?? lender.techStack.los}</p>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-xl border border-[var(--border-subtle)]">
                    <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mb-1">POS</p>
                    <p className="text-sm font-bold text-[var(--text-primary)]">{lender.profile.posVendor ?? lender.techStack.pos}</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Performance Metrics */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="card-base p-8"
          >
            <h3 className="text-lg font-bold text-[var(--text-primary)] mb-6 flex items-center gap-2">
              <BarChart3 size={20} className="text-teal-600" />
              Lender Performance
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { label: 'Avg. Turn Time', value: '18 Days', trend: '-2.4%' },
                { label: 'Pull-through Rate', value: '84%', trend: '+5.1%' },
                { label: 'Active Pipeline', value: '$12.4M', trend: '+12%' },
              ].map((stat, i) => (
                <div key={i} className="p-4 bg-slate-50 rounded-2xl border border-[var(--border-subtle)]">
                  <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{stat.label}</p>
                  <div className="flex items-end justify-between">
                    <p className="text-2xl font-bold text-[var(--text-primary)]">{stat.value}</p>
                    <span className={`text-[10px] font-bold ${stat.trend.startsWith('+') ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {stat.trend}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        <div className="space-y-8">
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="card-base p-6 relative"
          >
            <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-widest mb-6">Profile summary</h3>
            <div className="space-y-3 text-sm text-slate-800">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-600 font-medium">Channels</span>
                <span className="font-semibold text-slate-900 text-right">{lender.profile.channels.join(', ') || '—'}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-600 font-medium">Loan types</span>
                <span className="font-semibold text-slate-900 text-right">{lender.profile.loanTypes.join(', ') || '—'}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-600 font-medium">Construction lending</span>
                <span className="font-semibold text-slate-900">{lender.profile.doesConstructionLending ? 'Yes' : 'No'}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-600 font-medium">Captive / builder-affiliated</span>
                <span className="font-semibold text-slate-900">{lender.profile.isCaptiveBuilderLender ? 'Yes' : 'No'}</span>
              </div>
              {lender.profile.isCaptiveBuilderLender && (
                <>
                  <div className="pt-2 border-t border-slate-200/80 space-y-3">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Builder alignment</p>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-slate-600 font-medium shrink-0">Builder partners</span>
                      <span className="font-semibold text-slate-900 text-right">
                        {(lender.profile.primaryBuilderPartners ?? []).join(', ') || '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-600 font-medium">Active communities</span>
                      <span className="font-semibold text-slate-900">
                        {lender.profile.activeCommunitiesCount != null ? lender.profile.activeCommunitiesCount : '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-600 font-medium">Capture target</span>
                      <span className="font-semibold text-slate-900">
                        {lender.profile.captureTargetPct != null ? `${lender.profile.captureTargetPct}%` : '—'}
                      </span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-slate-600 font-medium shrink-0">Data sources</span>
                      <span className="font-semibold text-slate-900 text-right">
                        {(lender.profile.primaryDataSources ?? []).join(' + ') || '—'}
                      </span>
                    </div>
                    {(lender.profile.incentivePosture ?? '').trim() ? (
                      <div className="flex flex-col gap-1">
                        <span className="text-slate-600 font-medium">Incentive posture</span>
                        <span className="font-medium text-slate-800 text-sm leading-relaxed">{lender.profile.incentivePosture}</span>
                      </div>
                    ) : null}
                  </div>
                </>
              )}
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-600 font-medium">Disclosure model</span>
                <span className="font-semibold text-slate-900">{lender.profile.disclosureModel ?? 'Unknown'}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-600 font-medium">Borrower app</span>
                <span className="font-semibold text-slate-900">{lender.profile.borrowerAppPlatform || '—'}</span>
              </div>
            </div>
          </motion.div>

          {/* Key Contacts */}
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="card-base p-6 relative"
          >
            <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-widest mb-6 flex items-center gap-2">
              <Users size={16} className="text-[var(--text-secondary)]" />
              Key Contacts
            </h3>
            <div className="space-y-6">
              {lender.contacts.map((contact, i) => (
                <div key={i} className="flex items-start gap-4 p-3 hover:bg-slate-50 rounded-xl transition-colors cursor-pointer group">
                  <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center font-bold">
                    {contact.name.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-[var(--text-primary)]">{contact.name}</p>
                    <p className="text-xs text-[var(--text-secondary)] font-medium">{contact.role}</p>
                    <p className="text-[10px] text-teal-600 font-bold mt-1 opacity-0 group-hover:opacity-100 transition-opacity">{contact.email}</p>
                  </div>
                </div>
              ))}
            </div>
            <button className="w-full mt-6 py-2.5 text-xs font-bold text-teal-600 border border-teal-600/20 rounded-xl hover:bg-teal-50 transition-colors">
              Add Contact
            </button>
          </motion.div>

          {/* Channels */}
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="card-base p-6 relative"
          >
            <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-widest mb-6">Supported Channels</h3>
            <div className="flex flex-wrap gap-2">
              {lender.profile.channels.map(channel => (
                <span key={channel} className="px-3 py-1.5 bg-[var(--bg-surface)] text-[var(--text-primary)] rounded-xl text-xs font-bold border border-[var(--border-subtle)]">
                  {channel}
                </span>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
