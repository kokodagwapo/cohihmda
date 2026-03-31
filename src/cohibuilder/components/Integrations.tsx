import React, { useMemo, useRef, useState } from 'react';
import {
  UploadCloud,
  Key,
  Webhook,
  FileSpreadsheet,
  CheckCircle2,
  Link2,
  Plus,
  ArrowRight,
  ChevronRight,
  X,
  Info,
  FileDown,
  Search,
  Database,
  RotateCcw,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { integrations } from '../data/mockData';
import PageHeader from './PageHeader';
import { useCohiBuilderPortfolio } from '../contexts/CohiBuilderPortfolioContext';
import {
  BUILDER_IMPORT_FIELDS,
  BUILDER_IMPORT_SAMPLE_SIZE,
  downloadBuilderImportTemplate,
  downloadBuilderImportTemplateXlsx,
  emptyBuilderImportRow,
  getBuilderImportSampleRows,
  getDemoBuilderImportRow,
  loadBuilderImportRows,
  parseBuilderImportFile,
  saveBuilderImportRow,
  type BuilderImportFieldDef,
  type BuilderImportRow,
} from '../data/builderImportFields';

function SourceLegend() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
      <span className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full text-xs font-semibold tracking-wide text-rose-900/90 bg-rose-500/[0.12] backdrop-blur-xl border border-rose-300/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_8px_24px_-12px_rgba(244,63,94,0.35)]">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-40" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]" aria-hidden />
        </span>
        Toll Brothers
      </span>
      <span className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full text-xs font-semibold tracking-wide text-sky-950/90 bg-sky-500/[0.12] backdrop-blur-xl border border-sky-300/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_8px_24px_-12px_rgba(14,165,233,0.35)]">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-35" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.55)]" aria-hidden />
        </span>
        Encompass
      </span>
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: BuilderImportFieldDef;
  value: string;
  onChange: (v: string) => void;
}) {
  /* font-medium + antialiased: overrides global thin inputs and improves legibility */
  const base =
    'w-full px-4 py-3 rounded-xl border border-slate-200/70 bg-white/70 backdrop-blur-md text-[15px] leading-relaxed font-medium text-slate-900 placeholder:text-slate-400 placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-400/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_2px_8px_-4px_rgba(15,23,42,0.06)]';
  const sourceClass =
    field.source === 'toll'
      ? 'ring-1 ring-rose-200/40 focus:ring-rose-400/25'
      : 'ring-1 ring-sky-200/45 focus:ring-sky-400/25';

  if (field.type === 'textarea') {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className={`${base} ${sourceClass} resize-y min-h-[88px] antialiased`}
        placeholder="Optional notes…"
        aria-label={field.label}
      />
    );
  }
  if (field.type === 'number') {
    return (
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${base} ${sourceClass} antialiased tabular-nums`}
        placeholder="0"
        aria-label={field.label}
      />
    );
  }
  if (field.type === 'date') {
    return (
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${base} ${sourceClass} antialiased`}
        aria-label={field.label}
      />
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${base} ${sourceClass} antialiased`}
      placeholder=""
      aria-label={`${field.label}: ${field.meaning}`}
    />
  );
}

export default function Integrations() {
  const { applyImportRows, clearImportedPortfolio, importRowCount } = useCohiBuilderPortfolio();
  const [activeTab, setActiveTab] = useState('upload');
  const [drilldown, setDrilldown] = useState<'upload' | 'api-keys' | 'webhooks' | null>(null);
  const [importForm, setImportForm] = useState<BuilderImportRow>(() => getDemoBuilderImportRow());
  const [importSavedMsg, setImportSavedMsg] = useState<string | null>(null);
  const [importSearch, setImportSearch] = useState('');
  const [importSearchMsg, setImportSearchMsg] = useState<string | null>(null);
  const [importUploadMsg, setImportUploadMsg] = useState<string | null>(null);
  const [importUploadErr, setImportUploadErr] = useState<string | null>(null);
  const [mergeNewRowsOnUpload, setMergeNewRowsOnUpload] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processImportFile = async (file: File | null | undefined) => {
    if (!file) return;
    const { rows, error } = await parseBuilderImportFile(file);
    if (error) {
      setImportUploadMsg(null);
      setImportUploadErr(error);
      return;
    }
    if (rows.length === 0) {
      setImportUploadErr('No data rows found in this file (check the sheet and headers).');
      setImportUploadMsg(null);
      return;
    }
    const useMerge = mergeNewRowsOnUpload && importRowCount > 0;
    const { saved, merge } = await applyImportRows(rows, {
      fileName: file.name,
      mode: useMerge ? 'merge_new' : 'replace',
      sourceLabel: useMerge
        ? `Integrations merge: ${file.name}`
        : `Integrations upload: ${file.name}`,
    });
    setImportUploadErr(null);
    setImportUploadMsg(
      merge
        ? `Merged ${file.name}: +${merge.added} new, ${merge.skippedDuplicate} duplicate(s) skipped (${merge.finalRowCount} rows total).${saved ? ' Saved to your account.' : ' Sign in to save to the database.'} Open Capture Analysis for the dashboard.`
        : `Imported ${rows.length} row(s), replacing the previous portfolio.${saved ? ' Saved to your account.' : ' Sign in to save to the database.'} Open Capture Analysis to see updated loans.`,
    );
    window.setTimeout(() => setImportUploadMsg(null), 8000);
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    void processImportFile(f);
  };

  const tollFields = useMemo(() => BUILDER_IMPORT_FIELDS.filter((f) => f.source === 'toll'), []);
  const encompassFields = useMemo(() => BUILDER_IMPORT_FIELDS.filter((f) => f.source === 'encompass'), []);

  const setField = (id: string, v: string) => {
    setImportForm((prev) => ({ ...prev, [id]: v }));
  };

  const demoSearchMatches = (query: string) => {
    const q = query.trim().toLowerCase();
    if (!q) return false;
    const demo = getDemoBuilderImportRow();
    const hay = [
      demo.Buyer_Name,
      demo.P_Name,
      demo.Business_U,
      demo.Loanno,
      demo['Project Number'],
      demo['Business Unit'],
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(q) || q === 'demo';
  };

  const applyDemoSearch = (overrideQuery?: string) => {
    const q = (overrideQuery ?? importSearch).trim();
    if (!q) {
      setImportSearchMsg('Enter a search or pick an example below.');
      return;
    }
    if (demoSearchMatches(q)) {
      setImportForm(getDemoBuilderImportRow());
      setImportSearchMsg('Demo: sample Toll + Encompass fields loaded below.');
    } else {
      setImportSearchMsg('No demo match. Try an example search below.');
    }
  };

  const handleSubmitImportForm = (e: React.FormEvent) => {
    e.preventDefault();
    saveBuilderImportRow({ ...importForm });
    void (async () => {
      const { saved } = await applyImportRows(loadBuilderImportRows(), {
        sourceLabel: 'Integrations: row saved from form (merged portfolio)',
        persistSnapshot: false,
      });
      setImportForm(emptyBuilderImportRow());
      setImportSavedMsg(
        saved
          ? 'Record saved; portfolio synced to the server.'
          : 'Record saved locally. Sign in to sync the portfolio to the database.',
      );
      window.setTimeout(() => setImportSavedMsg(null), 5000);
    })();
  };

  const tabs = [
    { id: 'upload', label: 'Data Upload', icon: UploadCloud },
    { id: 'api', label: 'API & Partners', icon: Key },
    { id: 'webhooks', label: 'Webhooks', icon: Webhook },
    { id: 'search-entry', label: 'Search Entry', icon: Search },
  ];

  const partners = integrations;

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        badge="Connections"
        title="Builder Ecosystem Integrations"
        subtitle="Connect builder CRM/ERP and construction data with the LOS so contracts, incentives, and loan milestones stay aligned for captive and preferred lender programs."
      />

      <div className="flex gap-2 border-b border-slate-200/50 overflow-x-auto no-scrollbar scroll-smooth snap-x pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold transition-colors relative whitespace-nowrap snap-start ${
              activeTab === tab.id 
                ? 'text-[var(--brand-primary)]' 
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <tab.icon size={16} />
            {tab.label}
            {activeTab === tab.id && (
              <motion.div 
                layoutId="activeTab" 
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--brand-primary)]"
              />
            )}
          </button>
        ))}
      </div>

      {activeTab === 'upload' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6 sm:space-y-8"
        >
          <div className="card-base p-6 sm:p-10 relative overflow-hidden">
            <div className="pointer-events-none absolute -top-28 -right-20 h-72 w-72 rounded-full bg-gradient-to-br from-sky-400/25 to-indigo-400/15 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-36 -left-24 h-80 w-80 rounded-full bg-gradient-to-tr from-rose-300/20 to-fuchsia-400/10 blur-3xl" />
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.22)_0%,transparent_45%,rgba(255,255,255,0.08)_100%)]" />

            <div className="relative z-[1] max-w-3xl mx-auto text-center space-y-6">
              <div className="relative mx-auto w-[4.5rem] h-[4.5rem] sm:w-24 sm:h-24">
                <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-sky-500/30 to-indigo-500/25 blur-xl" />
                <div className="relative h-full w-full rounded-3xl flex items-center justify-center border border-white/60 bg-white/35 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_12px_40px_-16px_rgba(37,99,235,0.35)]">
                  <FileSpreadsheet size={30} className="text-sky-600 sm:w-8 sm:h-8" strokeWidth={2} />
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[11px] sm:text-xs font-bold uppercase tracking-[0.2em] text-slate-500/90">Data pipeline</p>
                <h3 className="text-2xl sm:text-3xl font-semibold text-slate-900 tracking-tight">Capture Data</h3>
                <p className="text-slate-600 mt-1 text-sm sm:text-base font-medium max-w-xl mx-auto leading-relaxed">
                  Upload a file or export CSV / Excel. Use the Search Entry tab to look up and edit Toll / Encompass fields.
                </p>
              </div>
              <SourceLegend />
              <label className="flex items-start justify-center gap-2 text-left max-w-md mx-auto text-xs font-medium text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="mt-0.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  checked={mergeNewRowsOnUpload}
                  onChange={(e) => setMergeNewRowsOnUpload(e.target.checked)}
                  disabled={importRowCount === 0}
                />
                <span>
                  Add only new rows when a portfolio already exists (auto-dedupe by loan number or agreement fields).
                </span>
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                className="sr-only"
                aria-label="Upload builder import file"
                onChange={handleImportFileChange}
              />
              {(importUploadMsg || importUploadErr) && (
                <div className="max-w-xl mx-auto w-full">
                  {importUploadErr && (
                    <p className="rounded-2xl border border-rose-300/50 bg-rose-500/[0.1] px-4 py-3 text-sm font-medium text-rose-950" role="alert">
                      {importUploadErr}
                    </p>
                  )}
                  {importUploadMsg && (
                    <p className="rounded-2xl border border-emerald-300/40 bg-emerald-500/[0.12] px-4 py-3 text-sm font-medium text-emerald-950" role="status">
                      {importUploadMsg}
                    </p>
                  )}
                </div>
              )}
              <div className="flex flex-col lg:flex-row lg:items-stretch gap-4 lg:gap-5 justify-center max-w-3xl mx-auto text-left">
                <div
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const f = e.dataTransfer.files?.[0];
                    void processImportFile(f);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className="group flex-1 min-h-[176px] rounded-3xl cursor-pointer border border-dashed border-white/55 bg-white/25 backdrop-blur-xl p-6 sm:p-8 flex flex-col items-center justify-center text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.65),0_16px_48px_-24px_rgba(15,23,42,0.12)] transition-all duration-300 hover:bg-white/40 hover:border-sky-300/45 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.75),0_20px_56px_-20px_rgba(14,165,233,0.18)] hover:-translate-y-0.5"
                >
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/50 bg-white/40 backdrop-blur-md shadow-sm group-hover:scale-105 transition-transform duration-300">
                    <UploadCloud size={26} className="text-sky-600" strokeWidth={2} />
                  </div>
                  <p className="text-sm sm:text-[15px] font-semibold text-slate-900">
                    Drag and drop your file here, or <span className="text-sky-600">browse</span>
                  </p>
                  <p className="text-xs text-slate-500 mt-2 font-medium">Supports .csv, .xlsx, .xls up to 50MB</p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDrilldown('upload');
                    }}
                    className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-sky-600 transition-colors"
                  >
                    Learn more <ChevronRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                  </button>
                </div>
                <div className="flex flex-col gap-3 lg:w-[220px] shrink-0 justify-center">
                  <button
                    type="button"
                    onClick={() => downloadBuilderImportTemplate()}
                    className="flex w-full items-center justify-center gap-2.5 px-5 py-4 rounded-2xl text-sm font-semibold text-slate-900 border border-white/60 bg-white/40 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.75),0_12px_32px_-12px_rgba(37,99,235,0.25)] transition-all duration-300 hover:bg-white/55 hover:border-sky-200/60 hover:shadow-[0_16px_40px_-14px_rgba(14,165,233,0.28)] hover:-translate-y-0.5 min-h-[72px]"
                  >
                    <FileDown size={18} className="text-sky-600 shrink-0" strokeWidth={2.25} />
                    Download CSV ({BUILDER_IMPORT_SAMPLE_SIZE} rows)
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadBuilderImportTemplateXlsx()}
                    className="flex w-full items-center justify-center gap-2.5 px-5 py-4 rounded-2xl text-sm font-semibold text-slate-900 border border-white/60 bg-white/40 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.75),0_12px_32px_-12px_rgba(37,99,235,0.25)] transition-all duration-300 hover:bg-white/55 hover:border-sky-200/60 hover:shadow-[0_16px_40px_-14px_rgba(14,165,233,0.28)] hover:-translate-y-0.5 min-h-[72px]"
                  >
                    <FileSpreadsheet size={18} className="text-emerald-600 shrink-0" strokeWidth={2.25} />
                    Download Excel ({BUILDER_IMPORT_SAMPLE_SIZE} rows)
                  </button>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void (async () => {
                          const samples = getBuilderImportSampleRows();
                          const { saved } = await applyImportRows(samples, {
                            sourceLabel: `Integrations: ${BUILDER_IMPORT_SAMPLE_SIZE} sample rows`,
                            persistSnapshot: true,
                          });
                          setImportUploadErr(null);
                          setImportUploadMsg(
                            `Loaded ${BUILDER_IMPORT_SAMPLE_SIZE} sample rows (replaced portfolio).${saved ? ' Saved to your account.' : ' Sign in to save to the database.'} Switch to Capture Analysis for the dashboard.`,
                          );
                          window.setTimeout(() => setImportUploadMsg(null), 8000);
                        })();
                      }}
                      className="flex w-full items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-semibold text-slate-800 border border-white/55 bg-white/30 backdrop-blur-md shadow-sm transition-all hover:bg-white/45"
                    >
                      <Database size={16} className="text-sky-600 shrink-0" strokeWidth={2.25} />
                      Add sample data ({BUILDER_IMPORT_SAMPLE_SIZE})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (importRowCount === 0) {
                          setImportUploadErr(null);
                          setImportUploadMsg('No imported rows to clear (already 0).');
                          window.setTimeout(() => setImportUploadMsg(null), 3000);
                          return;
                        }
                        if (
                          !window.confirm(
                            'Clear imported portfolio data in this browser and on the server (when signed in)?',
                          )
                        )
                          return;
                        void (async () => {
                          await clearImportedPortfolio();
                          setImportUploadErr(null);
                          setImportUploadMsg(
                            'Portfolio cleared — 0 import rows. Dashboard restored to demo data. Switch to Capture Analysis to view.',
                          );
                          window.setTimeout(() => setImportUploadMsg(null), 6000);
                        })();
                      }}
                      className="flex w-full items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-semibold text-slate-700 border border-slate-200/80 bg-white/20 backdrop-blur-md shadow-sm transition-all hover:bg-white/35"
                    >
                      <RotateCcw size={16} className="text-slate-500 shrink-0" strokeWidth={2.25} />
                      Reset imported data
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 font-medium text-center lg:text-left px-1 leading-snug">
                    Sample rows match the {BUILDER_IMPORT_SAMPLE_SIZE} demo loans on the dashboard. Header-only:{' '}
                    <button
                      type="button"
                      className="text-sky-700 font-semibold underline decoration-sky-300/80 underline-offset-2 hover:text-sky-800"
                      onClick={() => downloadBuilderImportTemplate({ empty: true })}
                    >
                      empty CSV
                    </button>
                    {' · '}
                    <button
                      type="button"
                      className="text-sky-700 font-semibold underline decoration-sky-300/80 underline-offset-2 hover:text-sky-800"
                      onClick={() => void downloadBuilderImportTemplateXlsx({ empty: true })}
                    >
                      empty Excel
                    </button>
                    .
                  </p>
                  <p className="text-[11px] text-slate-500 font-medium text-center lg:text-left px-1 leading-snug">
                    Red = Toll Brothers agreement; blue = Encompass.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {activeTab === 'api' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            {partners.map((partner) => (
              <div key={partner.id} className="card-base p-4 sm:p-6 flex items-center justify-between group relative">
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 bg-slate-50 rounded-xl flex items-center justify-center font-bold text-[var(--text-primary)] border border-[var(--border-subtle)] shrink-0">
                    {partner.logo}
                  </div>
                  <div>
                    <h4 className="font-bold text-[var(--text-primary)] text-sm sm:text-base">{partner.name}</h4>
                    <p className="text-[10px] sm:text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">{partner.type}</p>
                  </div>
                </div>
                <div>
                  {partner.status === 'Connected' ? (
                    <span className="flex items-center gap-1 px-2 py-1 sm:px-3 sm:py-1.5 bg-emerald-50/80 text-emerald-600/90 rounded-lg text-[10px] sm:text-xs font-bold border border-emerald-100/60 uppercase tracking-wider">
                      <CheckCircle2 size={12} className="sm:w-3.5 sm:h-3.5" />
                      Connected
                    </span>
                  ) : (
                    <button className="flex items-center gap-1 px-3 py-1.5 sm:px-4 sm:py-2 bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-subtle)] hover:bg-slate-50 rounded-lg text-xs sm:text-sm font-semibold transition-colors">
                      <Link2 size={14} className="sm:w-4 sm:h-4" />
                      Connect
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          
          <div className="card-base p-4 sm:p-6 mt-8 relative">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Custom API Keys</h3>
                <p className="text-sm text-slate-600 mt-1 font-medium">Generate keys for your own internal integrations.</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setDrilldown('api-keys')}
                  className="flex items-center justify-center gap-2 px-3 py-2 glass-panel rounded-lg text-sm font-medium text-slate-700 hover:bg-white/30"
                >
                  <Info size={16} />
                  Details
                </button>
                <button className="flex items-center justify-center gap-2 px-4 py-2 btn-primary text-white rounded-lg text-sm font-medium transition-colors">
                  <Plus size={16} />
                  Generate Key
                </button>
              </div>
            </div>
            <div
              onClick={() => setDrilldown('api-keys')}
              className="rounded-xl p-4 border border-white/50 bg-white/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer hover:bg-white/30 transition-colors"
            >
              <div>
                <p className="text-sm font-bold text-slate-900">Production API Key</p>
                <p className="text-xs text-slate-600 font-mono mt-1 break-all">sk_live_••••••••••••••••••••••••</p>
              </div>
              <span className="flex items-center gap-1 text-sm text-blue-600 font-medium">
                Reveal <ChevronRight size={14} />
              </span>
            </div>
          </div>
        </motion.div>
      )}

      {activeTab === 'webhooks' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card-base p-4 sm:p-6 relative">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Builder Webhook Endpoints</h3>
              <p className="text-sm text-slate-600 mt-1 font-medium">Receive real-time updates for construction milestones, rate lock expirations, and loan status changes.</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setDrilldown('webhooks')}
                className="flex items-center justify-center gap-2 px-3 py-2 glass-panel rounded-lg text-sm font-medium text-slate-700 hover:bg-white/30"
              >
                <Info size={16} />
                Details
              </button>
              <button className="flex items-center justify-center gap-2 px-4 py-2 btn-primary text-white rounded-lg text-sm font-medium transition-colors">
                <Plus size={16} />
                Add Endpoint
              </button>
            </div>
          </div>
          
          <div className="border border-white/50 rounded-xl overflow-hidden bg-white/10">
            <table className="w-full text-left">
              <thead className="border-b border-[var(--border-subtle)]">
                <tr className="bg-white/20 text-slate-600 text-xs uppercase tracking-wider">
                  <th className="px-4 py-3 font-semibold">URL</th>
                  <th className="px-4 py-3 font-semibold">Events</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                <tr className="bg-transparent hover:bg-white/10 transition-colors">
                  <td className="px-4 py-4 text-sm font-mono text-[var(--text-primary)]">https://api.builder.com/webhooks/cohi</td>
                  <td className="px-4 py-4">
                    <span className="px-2 py-1 bg-slate-100 text-[var(--text-primary)] rounded text-xs font-mono font-medium">loan.updated</span>
                  </td>
                  <td className="px-4 py-4">
                    <span className="flex items-center gap-1.5 text-emerald-600 text-xs font-bold uppercase tracking-wider">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      Active
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <button onClick={() => setDrilldown('webhooks')} className="text-slate-500 hover:text-blue-600"><ArrowRight size={16} /></button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {activeTab === 'search-entry' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6 sm:space-y-8"
        >
          <div className="flex justify-center">
            <SourceLegend />
          </div>
          <div className="card-base p-5 sm:p-8 relative overflow-hidden">
            <div className="pointer-events-none absolute top-0 right-0 h-48 w-48 rounded-full bg-indigo-400/10 blur-3xl" />
            <div className="pointer-events-none absolute bottom-0 left-0 h-56 w-56 rounded-full bg-rose-300/10 blur-3xl" />
            <div className="relative z-[1]">
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Lookup & capture</p>
                  <h3 className="font-display text-xl sm:text-2xl font-semibold text-slate-900 tracking-tight">Search Entry</h3>
                  <p className="text-[15px] text-slate-600 mt-2 max-w-xl leading-relaxed">
                    Search pulls a demo agreement + loan into the fields below (same columns as the portfolio CSV / Excel export). Submit still saves a demo row in the browser (localStorage).
                  </p>
                </div>
                {importRowCount > 0 && (
                  <span className="inline-flex items-center self-start sm:self-end px-3 py-1.5 rounded-full text-xs font-semibold text-slate-700 border border-white/55 bg-white/35 backdrop-blur-md shadow-sm">
                    {importRowCount} import row{importRowCount === 1 ? '' : 's'} in portfolio
                  </span>
                )}
              </div>

              <form
                className="mb-6"
                onSubmit={(e) => {
                  e.preventDefault();
                  applyDemoSearch();
                }}
              >
                <label className="sr-only" htmlFor="integrations-import-search">
                  Search by buyer, community, business unit, or loan number
                </label>
                <div className="flex flex-col sm:flex-row gap-3 sm:items-stretch max-w-2xl">
                  <div className="relative flex-1 min-w-0">
                    <Search
                      className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                      size={18}
                      strokeWidth={2}
                      aria-hidden
                    />
                    <input
                      id="integrations-import-search"
                      type="search"
                      value={importSearch}
                      onChange={(e) => {
                        setImportSearch(e.target.value);
                        if (importSearchMsg) setImportSearchMsg(null);
                      }}
                      placeholder="Try: Garcia, Maple, 10010245, or loan 1204589123"
                      className="w-full pl-11 pr-4 py-3 rounded-2xl border border-slate-200/70 bg-white/70 backdrop-blur-md text-[15px] font-medium text-slate-900 placeholder:text-slate-400 placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-400/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_2px_8px_-4px_rgba(15,23,42,0.06)]"
                      autoComplete="off"
                    />
                  </div>
                  <button
                    type="submit"
                    className="shrink-0 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-sm font-semibold text-white border border-white/25 bg-gradient-to-r from-sky-600 to-indigo-600 shadow-[0_10px_28px_-10px_rgba(37,99,235,0.45),inset_0_1px_0_rgba(255,255,255,0.2)] transition-all duration-300 hover:brightness-105"
                  >
                    <Search size={16} strokeWidth={2.25} aria-hidden />
                    Search
                  </button>
                </div>
                <p className="mt-3 text-xs text-slate-500 font-medium">Example searches (demo data):</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {[
                    { label: 'Maria Garcia', q: 'Garcia' },
                    { label: 'Pine Valley', q: 'Maple' },
                    { label: 'Business 10010245', q: '10010245' },
                    { label: 'Loan #', q: '1204589123' },
                  ].map((ex) => (
                    <button
                      key={ex.q}
                      type="button"
                      onClick={() => {
                        setImportSearch(ex.q);
                        setImportSearchMsg(null);
                        applyDemoSearch(ex.q);
                      }}
                      className="px-3 py-1.5 rounded-full text-xs font-semibold text-slate-700 border border-white/55 bg-white/40 backdrop-blur-md shadow-sm hover:bg-white/55 hover:border-sky-200/50 transition-colors"
                    >
                      {ex.label}
                    </button>
                  ))}
                </div>
                {importSearchMsg && (
                  <p className="mt-3 text-sm font-medium text-slate-700" role="status">
                    {importSearchMsg}
                  </p>
                )}
              </form>

              {importSavedMsg && (
                <div className="mb-5 rounded-2xl border border-emerald-300/40 bg-emerald-500/[0.12] backdrop-blur-xl px-4 py-3.5 text-sm font-medium text-emerald-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
                  {importSavedMsg}
                </div>
              )}

              <form onSubmit={handleSubmitImportForm} className="space-y-8">
                <div className="rounded-3xl border border-rose-200/50 bg-gradient-to-b from-white/50 to-rose-50/30 backdrop-blur-xl p-6 sm:p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.75),0_12px_40px_-20px_rgba(244,63,94,0.1)]">
                  <div className="mb-6 pb-5 border-b border-rose-200/35">
                    <h4 className="font-display text-lg sm:text-xl font-semibold text-slate-900 tracking-tight flex items-center gap-3">
                      <span className="flex h-2.5 w-2.5 shrink-0 rounded-full bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.45)]" aria-hidden />
                      Toll Brothers Agreement Fields
                    </h4>
                    <p className="mt-2 text-sm text-slate-600 leading-relaxed max-w-2xl">
                      Sourced from Toll Brothers agreement data. Field names align with your import CSV.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                    {tollFields.map((field) => (
                      <label key={field.id} className="block space-y-2 text-left group">
                        <span className="block text-sm font-semibold text-slate-900 tracking-tight">{field.label}</span>
                        <span className="block text-sm text-slate-600 leading-relaxed">{field.meaning}</span>
                        <div className="pt-0.5">
                          <FieldInput field={field} value={importForm[field.id] ?? ''} onChange={(v) => setField(field.id, v)} />
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="rounded-3xl border border-sky-200/50 bg-gradient-to-b from-white/50 to-sky-50/25 backdrop-blur-xl p-6 sm:p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.75),0_12px_40px_-20px_rgba(14,165,233,0.12)]">
                  <div className="mb-6 pb-5 border-b border-sky-200/35">
                    <h4 className="font-display text-lg sm:text-xl font-semibold text-slate-900 tracking-tight flex items-center gap-3">
                      <span className="flex h-2.5 w-2.5 shrink-0 rounded-full bg-sky-500 shadow-[0_0_12px_rgba(14,165,233,0.45)]" aria-hidden />
                      Encompass fields
                    </h4>
                    <p className="mt-2 text-sm text-slate-600 leading-relaxed max-w-2xl">
                      Populated when a loan is linked in Encompass. Blue columns in the exported CSV.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                    {encompassFields.map((field) => (
                      <label key={field.id} className="block space-y-2 text-left">
                        <span className="block text-sm font-semibold text-slate-900 tracking-tight">{field.label}</span>
                        <span className="block text-sm text-slate-600 leading-relaxed">{field.meaning}</span>
                        <div className="pt-0.5">
                          <FieldInput field={field} value={importForm[field.id] ?? ''} onChange={(v) => setField(field.id, v)} />
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:justify-end gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setImportForm(emptyBuilderImportRow());
                      setImportSearch('');
                      setImportSearchMsg(null);
                    }}
                    className="px-5 py-3 rounded-2xl text-sm font-semibold text-slate-800 border border-white/55 bg-white/35 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] transition-all duration-300 hover:bg-white/50 hover:border-white/70"
                  >
                    Clear form
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-3 rounded-2xl text-sm font-semibold text-white border border-white/25 bg-gradient-to-r from-sky-600 via-blue-600 to-indigo-600 backdrop-blur-sm shadow-[0_12px_32px_-10px_rgba(37,99,235,0.55),inset_0_1px_0_rgba(255,255,255,0.25)] transition-all duration-300 hover:brightness-105 hover:shadow-[0_16px_40px_-12px_rgba(37,99,235,0.5)] hover:-translate-y-0.5"
                  >
                    Save record (demo)
                  </button>
                </div>
              </form>
            </div>
          </div>
        </motion.div>
      )}

      {/* Drilldown Modals */}
      <AnimatePresence>
        {drilldown === 'upload' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDrilldown(null)}
            className="fixed inset-0 z-[var(--z-modal-backdrop)] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="cohi-modal-scroll max-h-[min(88dvh,calc(100dvh-2rem))] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900">Data Import Details</h3>
                <button onClick={() => setDrilldown(null)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600"><X size={18} /></button>
              </div>
              <p className="text-sm text-slate-600 mb-4">Bulk import supports:</p>
              <ul className="space-y-2 text-sm text-slate-700">
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> Contract / capture rows (.csv, .xlsx) using the downloadable export</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> Toll Brothers agreement columns (red) + Encompass columns (blue) per field dictionary on the Search Entry tab</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> Draw schedules with phase dates</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> Community lot maps and lot assignments</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> Max file size: 50MB</li>
              </ul>
              <p className="text-xs text-slate-500 mt-4">Use <strong>CSV export</strong> or <strong>Excel export</strong> on the Dashboard Portfolio data strip for exact column names. Open <strong>Search Entry</strong> to review or edit field-level mapping. Duplicate contracts are flagged for review.</p>
            </motion.div>
          </motion.div>
        )}
        {drilldown === 'api-keys' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDrilldown(null)}
            className="fixed inset-0 z-[var(--z-modal-backdrop)] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="cohi-modal-scroll max-h-[min(88dvh,calc(100dvh-2rem))] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900">API Keys & Security</h3>
                <button onClick={() => setDrilldown(null)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600"><X size={18} /></button>
              </div>
              <p className="text-sm text-slate-600 mb-4">Production keys grant full access. Best practices:</p>
              <ul className="space-y-2 text-sm text-slate-700">
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> Rotate keys quarterly</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> Never expose in client-side code</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> Use IP allowlisting for production</li>
              </ul>
              <p className="text-xs text-slate-500 mt-4">Keys are stored encrypted. Revealing a key logs the action for audit.</p>
            </motion.div>
          </motion.div>
        )}
        {drilldown === 'webhooks' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDrilldown(null)}
            className="fixed inset-0 z-[var(--z-modal-backdrop)] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="cohi-modal-scroll max-h-[min(88dvh,calc(100dvh-2rem))] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900">Webhook Events</h3>
                <button onClick={() => setDrilldown(null)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600"><X size={18} /></button>
              </div>
              <p className="text-sm text-slate-600 mb-4">Available events for subscription:</p>
              <ul className="space-y-2 text-sm text-slate-700">
                <li className="flex items-center gap-2"><Key size={14} className="text-slate-400" /> loan.updated — status, lock, docs</li>
                <li className="flex items-center gap-2"><Key size={14} className="text-slate-400" /> draw.milestone — phase completed</li>
                <li className="flex items-center gap-2"><Key size={14} className="text-slate-400" /> rate_lock.expiring — 7 days before</li>
                <li className="flex items-center gap-2"><Key size={14} className="text-slate-400" /> document.expiring</li>
              </ul>
              <p className="text-xs text-slate-500 mt-4">Endpoints must respond with 2xx within 5 seconds. Retries use exponential backoff.</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
