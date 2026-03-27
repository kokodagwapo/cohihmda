import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, FileText, Clock, ShieldCheck, AlertTriangle, CheckCircle2, ChevronRight, X, Building2 } from 'lucide-react';
import { useCohiBuilderPortfolio } from '../contexts/CohiBuilderPortfolioContext';
import { anonymizeBorrowerName } from '../lib/borrowerPrivacy';

interface RESPADetailProps {
  appId: string | null;
  onBack: () => void;
}

type DrilldownCard = 'timeline' | 'documents' | 'material-changes' | null;

const drilldownStyles = 'cursor-pointer hover:shadow-lg hover:border-slate-300 transition-all group';

export default function RESPADetail({ appId, onBack }: RESPADetailProps) {
  const { respaApps } = useCohiBuilderPortfolio();
  const [drilldown, setDrilldown] = useState<DrilldownCard>(null);
  const app = respaApps.find(a => a.id === appId) || respaApps[0];

  const timeline = [
    { label: 'Application Received', date: app.applicationDate, status: 'completed', rule: 'Starts 3-day LE clock' },
    { label: 'Loan Estimate (LE) Sent', date: app.leDate, status: app.leStatus === 'Sent' ? 'completed' : 'pending', rule: 'Within 3 business days' },
    { label: 'Intent to Proceed', date: 'Mar 12, 2026', status: 'completed', rule: 'Required before CD' },
    { label: 'Closing Disclosure (CD) Deadline', date: app.cdDeadline, status: app.cdStatus === 'Sent' ? 'completed' : 'pending', rule: '3–7 days before closing' },
  ];

  const documents = [
    { name: 'Initial LE Disclosure', status: 'Verified', date: 'Mar 08, 2026', desc: 'TRID-compliant Loan Estimate' },
    { name: 'Borrower Intent to Proceed', status: 'Verified', date: 'Mar 12, 2026', desc: 'Must be on file before CD' },
    { name: 'Appraisal Delivery Receipt', status: app.leStatus === 'Delayed' ? 'Pending' : 'Verified', date: app.leStatus === 'Delayed' ? '—' : 'Mar 10, 2026', desc: 'Required for LE delivery' },
    { name: 'Rate Lock Confirmation', status: 'Verified', date: 'Mar 15, 2026', desc: 'Material change—redisclosure if before CD' },
  ];

  const materialChanges = [
    { trigger: 'Rate lock', date: 'Mar 15, 2026', impact: 'Revised LE sent; 3-day wait if within CD window' },
    { trigger: 'Appraisal received', date: app.leDate || '—', impact: 'LTV update may require redisclosure' },
  ];

  return (
    <>
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <button 
          onClick={onBack}
          className="p-2 hover:bg-slate-100 rounded-xl text-slate-600 transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900 tracking-tight">RESPA Compliance Detail</h1>
          <p className="text-slate-600 mt-2 text-base leading-relaxed">{anonymizeBorrowerName(app.borrower)} • {app.id}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {/* Compliance Timeline - Clickable */}
          <div 
            onClick={() => setDrilldown('timeline')}
            className={`card-base p-6 border border-slate-200 relative rounded-2xl ${drilldownStyles}`}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-display font-bold text-slate-900">Compliance Timeline</h2>
              <ChevronRight size={20} className="text-slate-400 group-hover:text-teal-600" />
            </div>
            <div className="relative">
              <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-100" />
              <div className="space-y-8 relative">
                {timeline.map((step, i) => (
                  <div key={i} className="flex items-start gap-6 relative">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center z-10 shadow-lg border ${
                      step.status === 'completed' ? 'bg-teal-500 text-white border-teal-400' : 
                      'bg-slate-100 text-teal-600 ring-4 ring-teal-500/20 border-teal-500/50'
                    }`}>
                      {step.status === 'completed' ? <CheckCircle2 size={16} /> : <div className="w-2 h-2 rounded-full bg-current" />}
                    </div>
                    <div className="bg-slate-50/80 border border-slate-200 p-4 rounded-xl flex-1">
                      <h4 className="font-display font-bold text-slate-900">{step.label}</h4>
                      <p className="text-sm text-slate-600 font-medium">{step.date || 'Pending'}</p>
                      <p className="text-xs text-slate-500 mt-1">{step.rule}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Document Verification - Clickable */}
          <div 
            onClick={() => setDrilldown('documents')}
            className={`card-base p-6 border border-slate-200 relative rounded-2xl ${drilldownStyles}`}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-display font-bold text-slate-900">Document Verification</h2>
              <ChevronRight size={20} className="text-slate-400 group-hover:text-teal-600" />
            </div>
            <div className="space-y-4">
              {documents.map((doc, i) => (
                <div key={i} className="p-4 rounded-xl border border-slate-200 bg-white/80 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-teal-100 text-teal-600 flex items-center justify-center">
                      <FileText size={18} />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900">{doc.name}</h4>
                      <p className="text-xs text-slate-500">{doc.status} • {doc.date}</p>
                    </div>
                  </div>
                  <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-lg ${
                    doc.status === 'Verified' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {doc.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Material Changes - New section */}
          <div 
            onClick={() => setDrilldown('material-changes')}
            className={`card-base p-6 border border-amber-200/60 bg-amber-50/40 rounded-2xl ${drilldownStyles}`}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-display font-bold text-slate-900 flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-600" />
                Material Changes
              </h2>
              <ChevronRight size={20} className="text-slate-400 group-hover:text-amber-600" />
            </div>
            <p className="text-sm text-slate-600 leading-relaxed mb-4">
              Rate lock, appraisal, LTV shift, or loan terms change may require revised LE and 3-day waiting period before CD.
            </p>
            <div className="space-y-2">
              {materialChanges.map((m, i) => (
                <div key={i} className="p-3 rounded-xl bg-white/80 border border-amber-200/50 flex justify-between">
                  <span className="font-medium text-slate-800">{m.trigger}</span>
                  <span className="text-xs text-slate-600">{m.date}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {/* Compliance Status */}
          <div className="card-base p-6 border border-slate-200 rounded-2xl">
            <h3 className="text-lg font-display font-bold text-slate-900 mb-4 flex items-center gap-2">
              <ShieldCheck size={18} className="text-teal-600" />
              Compliance Status
            </h3>
            <div className="space-y-4">
              <div className={`p-4 rounded-xl border ${
                app.status === 'At Risk' ? 'bg-rose-50 border-rose-200' : 
                app.status === 'Completed' ? 'bg-emerald-50 border-emerald-200' : 'bg-sky-50 border-sky-200'
              }`}>
                <p className="text-[10px] font-display font-bold text-slate-600 uppercase tracking-wider mb-1">Current Status</p>
                <p className={`text-xl font-display font-bold ${
                  app.status === 'At Risk' ? 'text-rose-600' : 
                  app.status === 'Completed' ? 'text-emerald-600' : 'text-sky-600'
                }`}>{app.status}</p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-[10px] font-display font-bold text-slate-600 uppercase tracking-wider mb-1">Days to CD Deadline</p>
                <p className="text-xl font-display font-bold text-slate-900">{app.cdDeadline ? '12' : '—'} Days</p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-[10px] font-display font-bold text-slate-600 uppercase tracking-wider mb-1">Compliance Score</p>
                <p className={`text-2xl font-display font-bold ${
                  app.complianceScore >= 90 ? 'text-emerald-600' : app.complianceScore >= 70 ? 'text-amber-600' : 'text-rose-600'
                }`}>{app.complianceScore}%</p>
              </div>
            </div>
          </div>

          {/* Upcoming Deadline */}
          <div className="card-base p-6 border-2 border-amber-300 bg-amber-50 rounded-2xl">
            <h3 className="font-display font-bold text-amber-800 mb-4 flex items-center gap-2">
              <Clock size={18} />
              Upcoming Deadline
            </h3>
            <p className="text-3xl font-display font-bold text-amber-900 mb-2">{app.cdDeadline || 'Mar 31, 2026'}</p>
            <p className="text-sm text-amber-800 leading-relaxed">
              Final CD must be delivered to borrower by EOD to maintain TRID compliance. Late delivery = closing delay.
            </p>
          </div>

          {/* Lender accountability */}
          <div className="card-base p-6 border border-slate-200 rounded-2xl">
            <h3 className="text-sm font-display font-bold text-slate-700 mb-3 flex items-center gap-2">
              <Building2 size={16} />
              Lender
            </h3>
            <p className="font-semibold text-slate-900">{app.lender}</p>
            <p className="text-xs text-slate-500 mt-1">Construction-to-Permanent product</p>
          </div>
        </div>
      </div>

    </div>
    {typeof document !== 'undefined' &&
      createPortal(
        <AnimatePresence>
          {drilldown && (
            <motion.div
              key="respa-drilldown"
              role="presentation"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="cohi-modal-backdrop flex items-center justify-center bg-slate-400/20 p-3 backdrop-blur-[2px] sm:p-4"
              onClick={() => setDrilldown(null)}
            >
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-labelledby="respa-drilldown-title"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="flex w-full max-w-xl max-h-[min(88dvh,calc(100dvh-2rem))] flex-col overflow-hidden overscroll-contain rounded-2xl border border-slate-200 bg-white shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
              <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b border-slate-200 bg-white p-5">
                <h3 id="respa-drilldown-title" className="text-xl font-display font-bold text-slate-900">
                  {drilldown === 'timeline' && 'TRID Timeline Details'}
                  {drilldown === 'documents' && 'Document Verification Details'}
                  {drilldown === 'material-changes' && 'Material Changes & Redisclosure'}
                </h3>
                <button onClick={() => setDrilldown(null)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600">
                  <X size={20} />
                </button>
              </div>
              <div className="cohi-modal-scroll min-h-0 flex-1 overflow-y-auto p-6 space-y-6">
                {drilldown === 'timeline' && (
                  <>
                    <div className="p-4 rounded-xl bg-sky-50 border border-sky-200">
                      <p className="text-xs font-display font-bold text-sky-600 uppercase tracking-wider mb-2">TRID Key Dates</p>
                      <div className="space-y-3">
                        {timeline.map((step, i) => (
                          <div key={i} className="flex justify-between py-2 border-b border-sky-200/60 last:border-0">
                            <span className="font-medium text-slate-800">{step.label}</span>
                            <span className="text-sm text-slate-600">{step.date || '—'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <p className="text-xs font-display font-bold text-slate-600 uppercase tracking-wider mb-2">Rule Summary</p>
                      <ul className="text-sm text-slate-700 space-y-1.5">
                        <li>• <strong>3-day rule:</strong> LE within 3 business days of complete application</li>
                        <li>• <strong>Intent to Proceed:</strong> Required before delivering CD</li>
                        <li>• <strong>7-day rule:</strong> CD at least 3 business days before closing (7 if mailed)</li>
                      </ul>
                    </div>
                  </>
                )}
                {drilldown === 'documents' && (
                  <>
                    {documents.map((doc, i) => (
                      <div key={i} className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-semibold text-slate-900">{doc.name}</p>
                            <p className="text-sm text-slate-600 mt-0.5">{doc.desc}</p>
                          </div>
                          <span className={`text-xs font-bold uppercase px-2 py-1 rounded-lg ${
                            doc.status === 'Verified' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                          }`}>{doc.status}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-2">Date: {doc.date}</p>
                      </div>
                    ))}
                  </>
                )}
                {drilldown === 'material-changes' && (
                  <>
                    <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
                      <p className="text-xs font-display font-bold text-amber-700 uppercase tracking-wider mb-2">What Triggers Redisclosure</p>
                      <ul className="text-sm text-slate-700 space-y-1.5">
                        <li>• Rate lock (revised LE often required)</li>
                        <li>• Appraisal changes LTV or property value</li>
                        <li>• Loan terms change (program, amount, rate)</li>
                        <li>• Borrower-initiated changes</li>
                      </ul>
                    </div>
                    <div className="space-y-3">
                      {materialChanges.map((m, i) => (
                        <div key={i} className="p-4 rounded-xl bg-white border border-slate-200">
                          <p className="font-semibold text-slate-900">{m.trigger}</p>
                          <p className="text-xs text-slate-600 mt-1">{m.date}</p>
                          <p className="text-sm text-slate-700 mt-2">{m.impact}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Each material change can restart a 3-day waiting period before CD. Construction-to-perm: timing tied to conversion date.
                    </p>
                  </>
                )}
              </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
