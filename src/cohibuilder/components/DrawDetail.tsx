import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Wallet, Calendar, CheckCircle2, FileText, Camera, MapPin, ChevronRight, X, DollarSign, Receipt, Tag, Building2 } from 'lucide-react';
import { DRAW_REQUESTS, DrawRequest } from '../data/mockDraws';
import { TOLL_BROTHERS_LISTING_IMAGES, TOLL_BROTHERS_HERO_SLIDES } from '../data/tollBrothersOfficialMedia';

// Map construction phases to relevant Toll Brothers official images
const PHASE_IMAGES: Record<string, string[]> = {
  Foundation: [
    TOLL_BROTHERS_LISTING_IMAGES[8],  // Adero exterior
    TOLL_BROTHERS_LISTING_IMAGES[9],  // Heritage Parkfield exterior
    TOLL_BROTHERS_LISTING_IMAGES[10], // Santa Rita Ranch
  ],
  Framing: [
    TOLL_BROTHERS_LISTING_IMAGES[0],  // Adero greatroom
    TOLL_BROTHERS_LISTING_IMAGES[13], // Lakeside great room
    TOLL_BROTHERS_LISTING_IMAGES[14], // Traviso great room
  ],
  Drywall: [
    TOLL_BROTHERS_LISTING_IMAGES[5],  // Martel Prairie interior
    TOLL_BROTHERS_LISTING_IMAGES[16], // Spruce kitchen
    TOLL_BROTHERS_LISTING_IMAGES[17], // Olive kitchen
  ],
  Permitting: [
    TOLL_BROTHERS_LISTING_IMAGES[11], // Orchard exterior
    TOLL_BROTHERS_LISTING_IMAGES[12], // Garden exterior
  ],
  default: TOLL_BROTHERS_LISTING_IMAGES.slice(0, 6),
};

function getPhaseImages(phase: string): string[] {
  return PHASE_IMAGES[phase] || PHASE_IMAGES.default;
}

type DrilldownCard = 'summary' | 'inspection' | 'documents' | 'timeline' | null;

const drilldownCardStyles = 'cursor-pointer hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] hover:border-slate-300 transition-all group';

interface DrawDetailProps {
  drawId: string;
  onBack: () => void;
}

// Extended timeline with more realistic steps
function getDrawTimeline(draw: DrawRequest) {
  const base = [
    { label: 'Draw Request Submitted', date: draw.requestedDate, done: true },
    { label: 'Document Package Uploaded', date: draw.requestedDate, done: true },
    { label: 'Internal Review', date: draw.lastUpdatedDate, done: draw.status !== 'Action Required' },
    { label: 'Inspection Scheduled', date: draw.inspectionDateLabel, done: draw.inspectionStatus === 'Complete' },
    { label: 'Site Inspection', date: draw.inspectionStatus === 'Complete' ? draw.inspectionDateLabel : 'Pending', done: draw.inspectionStatus === 'Complete' },
    { label: 'Approval & Funding', date: draw.status === 'Approved' ? draw.lastUpdatedDate : 'Pending', done: draw.status === 'Approved' },
  ];
  return base;
}

export default function DrawDetail({ drawId, onBack }: DrawDetailProps) {
  const draw = DRAW_REQUESTS.find(d => d.id === drawId) || DRAW_REQUESTS[0];
  const [drilldown, setDrilldown] = useState<DrilldownCard>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const phaseImages = getPhaseImages(draw.phase);
  const timeline = getDrawTimeline(draw);

  const docs = [
    { name: 'Lien Waiver', status: 'Verified', desc: 'Conditional waiver for work through foundation phase' },
    { name: 'Contractor Invoices', status: 'Verified', desc: 'Itemized invoices totaling $45,000' },
    { name: 'Progress Photos', status: draw.status === 'Approved' ? 'Verified' : 'Pending', desc: 'Site photos required for disbursement' },
    { name: 'Permit / CO Copy', status: 'Verified', desc: 'Foundation permit on file' },
  ];

  return (
    <div className="space-y-8">
      {/* Header with hero image */}
      <div className="relative rounded-2xl overflow-hidden min-h-[200px] md:min-h-[260px] bg-slate-100">
        <img
          src={TOLL_BROTHERS_HERO_SLIDES[0]?.src || phaseImages[0]}
          alt="Toll Brothers construction"
          className="absolute inset-0 w-full h-full object-cover opacity-60"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/40 to-transparent" />
        <div className="relative p-6 md:p-8 flex flex-col justify-end min-h-[200px] md:min-h-[260px]">
          <div className="flex items-center justify-between gap-4">
            <button
              onClick={onBack}
              className="flex items-center gap-2.5 px-3.5 py-2.5 bg-white/20 backdrop-blur-md border border-white/30 rounded-xl text-white hover:bg-white/30 transition-all font-medium text-sm"
            >
              <ArrowLeft size={18} />
              Back
            </button>
            <span className={`px-4 py-2 rounded-xl text-[11px] font-display font-bold uppercase tracking-[0.15em] backdrop-blur-md border ${
              draw.status === 'Approved' ? 'bg-emerald-400/25 text-emerald-800/90 border-emerald-300/30' :
              draw.status === 'Pending Inspection' ? 'bg-amber-400/25 text-amber-800/90 border-amber-300/30' :
              'bg-rose-400/25 text-rose-800/90 border-rose-300/30'
            }`}>
              {draw.status}
            </span>
          </div>
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-white/20 backdrop-blur-sm rounded-xl">
                <Receipt size={20} className="text-white" />
              </div>
              <span className="text-[11px] font-display font-bold text-white/80 uppercase tracking-[0.2em]">Construction Draw</span>
            </div>
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-display font-bold text-white tracking-tight leading-[1.1]">
              Draw Details
            </h1>
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white/15 backdrop-blur-sm rounded-lg border border-white/25 font-mono text-sm font-semibold text-white">
                <Tag size={14} className="text-white/80" />
                {draw.id}
              </span>
              <span className="inline-flex items-center gap-1.5 text-white/95 font-medium">
                <Building2 size={16} className="text-white/70 shrink-0" />
                {draw.project}
              </span>
            </div>
            <p className="text-white/70 text-sm font-medium mt-2 tracking-wide">
              <span className="text-white/90 font-semibold">{draw.phase}</span> phase • Requested {new Date(draw.requestedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {/* Summary Card - Clickable */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => setDrilldown('summary')}
            className={`card-base p-8 relative ${drilldownCardStyles}`}
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
              <div className="flex items-center gap-4">
                <div className={`p-4 rounded-2xl ${
                  draw.status === 'Approved' ? 'bg-emerald-50/80 text-emerald-600 border border-emerald-200/40' :
                  draw.status === 'Pending Inspection' ? 'bg-amber-50/80 text-amber-600 border border-amber-200/40' :
                  'bg-rose-50/80 text-rose-600 border border-rose-200/40'
                }`}>
                  <Wallet size={32} />
                </div>
                <div>
                  <h2 className="text-2xl font-display font-bold text-slate-900">
                    ${draw.requested.toLocaleString()}
                  </h2>
                  <p className="text-slate-600 font-medium">Requested for {draw.phase}</p>
                  <p className="text-xs text-slate-500 mt-1">Total project budget: ${draw.total.toLocaleString()}</p>
                </div>
              </div>
              <ChevronRight size={24} className="text-slate-400 group-hover:text-teal-600 transition-colors hidden md:block" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6 bg-white/40 backdrop-blur-sm rounded-2xl border border-white/50">
              <div className="space-y-1">
                <p className="text-[10px] font-display font-bold text-slate-600 uppercase tracking-[0.15em]">Request Date</p>
                <p className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Calendar size={14} className="text-teal-600" />
                  {new Date(draw.requestedDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-display font-bold text-slate-600 uppercase tracking-[0.15em]">Total Budget</p>
                <p className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <DollarSign size={14} className="text-emerald-500" />
                  ${draw.total.toLocaleString()}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-display font-bold text-slate-600 uppercase tracking-[0.15em]">Utilization</p>
                <p className="text-sm font-semibold text-slate-900">{((draw.requested / draw.total) * 100).toFixed(1)}% of total</p>
              </div>
            </div>
          </motion.div>

          {/* UGC Photos - Toll Brothers Official */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="card-base p-8"
          >
            <h3 className="text-lg font-display font-bold text-slate-900 mb-6 flex items-center gap-2">
              <Camera size={22} className="text-sky-500" />
              Construction Photos
              <span className="text-xs font-normal text-slate-600 ml-2">Toll Brothers official</span>
            </h3>

            {/* Hero image */}
            <div className="relative aspect-video rounded-xl overflow-hidden mb-4 bg-slate-100">
              <img
                src={phaseImages[photoIndex]}
                alt={`${draw.phase} phase - Toll Brothers`}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
              <div className="absolute bottom-3 left-3 text-white font-semibold">
                {draw.phase} Phase Reference
              </div>
              {phaseImages.length > 1 && (
                <>
                  <button
                    onClick={() => setPhotoIndex((i) => (i - 1 + phaseImages.length) % phaseImages.length)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 p-2 bg-black/30 rounded-full text-white hover:bg-black/50"
                  >
                    ←
                  </button>
                  <button
                    onClick={() => setPhotoIndex((i) => (i + 1) % phaseImages.length)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-black/30 rounded-full text-white hover:bg-black/50"
                  >
                    →
                  </button>
                </>
              )}
            </div>

            {/* Thumbnail grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {phaseImages.slice(0, 8).map((src, i) => (
                <button
                  key={i}
                  onClick={() => setPhotoIndex(i)}
                  className={`aspect-video rounded-xl overflow-hidden border-2 transition-all ${
                    photoIndex === i ? 'border-teal-500 ring-2 ring-teal-500/30' : 'border-white/50 hover:border-slate-300'
                  }`}
                >
                  <img src={src} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-600 mt-3 font-medium">Source: cdn.tollbrothers.com — model homes & communities</p>
          </motion.div>

          {/* Inspection Details - Clickable */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            onClick={() => setDrilldown('inspection')}
            className={`bg-white/75 backdrop-blur-md rounded-2xl shadow-sm border border-white/60 p-8 relative ${drilldownCardStyles}`}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-display font-bold text-slate-900 flex items-center gap-2">
                <Camera size={22} className="text-teal-600" />
                Inspection Report
              </h3>
              <ChevronRight size={20} className="text-slate-400 group-hover:text-teal-600 transition-colors" />
            </div>
            <div className="mt-6 space-y-6">
              <div className="flex items-start gap-4 p-4 bg-white/40 backdrop-blur-sm rounded-xl border border-white/50">
                <div className="p-2.5 bg-teal-500/20 rounded-xl">
                  <MapPin size={20} className="text-teal-600" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-bold text-slate-900">Site Inspection Status</p>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${
                      draw.inspectionStatus === 'Complete' ? 'bg-emerald-100 text-emerald-700' :
                      draw.inspectionStatus === 'Scheduled' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                    }`}>{draw.inspectionStatus}</span>
                  </div>
                  <p className="text-sm text-slate-600">Inspector: <span className="font-semibold text-slate-900">{draw.inspector}</span></p>
                  <p className="text-xs text-slate-600 mt-1">{draw.inspectionDateLabel}</p>
                </div>
              </div>
              {draw.notes && (
                <div className="p-4 bg-amber-50/50 rounded-xl border border-amber-200/50">
                  <p className="text-sm text-slate-600 font-medium">{draw.notes}</p>
                </div>
              )}
            </div>
          </motion.div>
        </div>

        <div className="space-y-8">
          {/* Documents - Clickable */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            onClick={() => setDrilldown('documents')}
            className={`bg-white/75 backdrop-blur-md rounded-2xl shadow-sm border border-white/60 p-6 relative ${drilldownCardStyles}`}
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-display font-bold text-slate-600 uppercase tracking-widest">Required Documents</h3>
              <ChevronRight size={18} className="text-slate-400 group-hover:text-teal-600 transition-colors" />
            </div>
            <div className="space-y-3">
              {docs.map((doc, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-white/40 rounded-xl border border-white/50">
                  <div className="flex items-center gap-3">
                    <FileText size={18} className="text-slate-600" />
                    <span className="text-sm font-medium text-slate-900">{doc.name}</span>
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${
                    doc.status === 'Verified' ? 'text-emerald-600' : 'text-amber-600'
                  }`}>
                    {doc.status}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Timeline - Clickable */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            onClick={() => setDrilldown('timeline')}
            className={`bg-white/75 backdrop-blur-md rounded-2xl shadow-sm border border-white/60 p-6 relative ${drilldownCardStyles}`}
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-display font-bold text-slate-600 uppercase tracking-widest">Draw Timeline</h3>
              <ChevronRight size={18} className="text-slate-400 group-hover:text-teal-600 transition-colors" />
            </div>
            <div className="space-y-5 relative before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-0.5 before:bg-white/60">
              {timeline.slice(0, 4).map((step, i) => (
                <div key={i} className="flex items-start gap-4 relative z-10">
                  <div className={`mt-1 w-6 h-6 rounded-full flex items-center justify-center border-2 ${
                    step.done ? 'bg-teal-500/90 border-teal-500 text-white' : 'bg-white/60 border-white/60 text-slate-500'
                  }`}>
                    {step.done ? <CheckCircle2 size={12} /> : <div className="w-1.5 h-1.5 rounded-full bg-current" />}
                  </div>
                  <div>
                    <p className={`text-sm font-semibold ${step.done ? 'text-slate-900' : 'text-slate-600'}`}>{step.label}</p>
                    <p className="text-[10px] text-slate-600 font-medium uppercase tracking-wider">{step.date}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>

      {/* Drilldown Modal */}
      <AnimatePresence>
        {drilldown && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrilldown(null)}
              className="fixed inset-0 z-[var(--z-modal-backdrop)] bg-slate-400/25 backdrop-blur-[2px]"
            />
            <div className="cohi-modal-center-host">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="flex w-[min(100vw-1.5rem,32rem)] max-h-[min(88dvh,calc(100dvh-2rem))] flex-col overflow-hidden bg-white/75 backdrop-blur-2xl border border-white/60 rounded-2xl shadow-[0_25px_80px_-12px_rgba(15,23,42,0.25)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 z-10 shrink-0 bg-white/60 backdrop-blur-xl border-b border-white/50 p-5 flex items-center justify-between">
                <h3 className="text-xl font-display font-bold text-slate-900 tracking-tight">
                  {drilldown === 'summary' && 'Draw Summary Details'}
                  {drilldown === 'inspection' && 'Inspection Report Details'}
                  {drilldown === 'documents' && 'Document Checklist Details'}
                  {drilldown === 'timeline' && 'Draw Timeline Details'}
                </h3>
                <button onClick={() => setDrilldown(null)} className="p-2 rounded-xl bg-white/40 backdrop-blur-sm border border-white/50 hover:bg-white/60 text-slate-600">
                  <X size={20} />
                </button>
              </div>
              <div className="cohi-modal-scroll min-h-0 flex-1 overflow-y-auto p-6 space-y-5">
                {drilldown === 'summary' && (
                  <>
                    <div className="p-5 rounded-2xl bg-teal-500/10 backdrop-blur-md border border-teal-400/30">
                      <p className="text-[10px] text-teal-600 font-display font-bold uppercase tracking-[0.2em] mb-2">Requested Amount</p>
                      <p className="text-3xl font-display font-bold text-slate-900">${draw.requested.toLocaleString()}</p>
                      <p className="text-xs text-slate-600 mt-2 font-medium">For {draw.phase} phase completion</p>
                    </div>
                    <div className="space-y-0 divide-y divide-white/40">
                      <div className="flex justify-between py-4 px-4 rounded-xl bg-white/30 backdrop-blur-sm border border-white/50">
                        <span className="text-sm text-slate-600 font-medium">Total Project Budget</span>
                        <span className="font-mono font-semibold">${draw.total.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between py-4 px-4 rounded-xl bg-white/30 backdrop-blur-sm border border-white/50">
                        <span className="text-sm text-slate-600 font-medium">Budget Utilized</span>
                        <span className="font-display font-bold text-teal-700">{((draw.requested / draw.total) * 100).toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between py-4 px-4 rounded-xl bg-white/30 backdrop-blur-sm border border-white/50">
                        <span className="text-sm text-slate-600 font-medium">Remaining Budget</span>
                        <span className="font-mono font-semibold">${(draw.total - draw.requested).toLocaleString()}</span>
                      </div>
                      <div className="flex flex-col gap-1 py-4 px-4 rounded-xl bg-white/30 backdrop-blur-sm border border-white/50">
                        <span className="text-sm text-slate-600 font-medium">Disbursement</span>
                        <span className="font-medium">{draw.status === 'Approved' ? 'Funds queued for release within 3–5 business days' : 'Pending inspection & document verification'}</span>
                      </div>
                    </div>
                  </>
                )}
                {drilldown === 'inspection' && (
                  <>
                    <div className="p-5 rounded-2xl bg-teal-500/10 backdrop-blur-md border border-teal-400/30">
                      <p className="text-[10px] text-teal-600 font-display font-bold uppercase tracking-[0.2em] mb-2">Status</p>
                      <p className="text-xl font-display font-bold text-slate-900">{draw.inspectionStatus}</p>
                      <p className="text-xs text-slate-600 mt-2 font-medium">{draw.inspectionDateLabel}</p>
                    </div>
                    <div className="space-y-0 divide-y divide-white/40">
                      <div className="flex justify-between py-4 px-4 rounded-xl bg-white/30 backdrop-blur-sm border border-white/50">
                        <span className="text-sm text-slate-600 font-medium">Inspector</span>
                        <span className="font-display font-semibold">{draw.inspector}</span>
                      </div>
                      <div className="flex flex-col gap-1 py-4 px-4 rounded-xl bg-white/30 backdrop-blur-sm border border-white/50">
                        <span className="text-sm text-slate-600 font-medium">Notes</span>
                        <span className="font-medium">{draw.notes || 'No additional notes.'}</span>
                      </div>
                      <div className="flex flex-col gap-1 py-4 px-4 rounded-xl bg-white/30 backdrop-blur-sm border border-white/50">
                        <span className="text-sm text-slate-600 font-medium">Phase Scope</span>
                        <span className="font-medium">Inspection verifies {draw.phase.toLowerCase()} work completion, material delivery, and code compliance before disbursement.</span>
                      </div>
                    </div>
                  </>
                )}
                {drilldown === 'documents' && (
                  <>
                    <p className="text-sm text-slate-600 font-medium mb-4">Documents required for draw disbursement. All must be verified before funding.</p>
                    <div className="space-y-3">
                      {docs.map((doc, i) => (
                        <div key={i} className="flex items-center justify-between py-4 px-4 rounded-xl bg-white/30 backdrop-blur-sm border border-white/50">
                          <div>
                            <p className="font-semibold text-slate-900">{doc.name}</p>
                            <p className="text-xs text-slate-600 mt-0.5">{doc.desc}</p>
                          </div>
                          <span className={`text-xs font-bold uppercase px-2.5 py-1 rounded-lg ${
                            doc.status === 'Verified' ? 'bg-emerald-500/20 text-emerald-700 border border-emerald-400/30' : 'bg-amber-500/20 text-amber-700 border border-amber-400/30'
                          }`}>{doc.status}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {drilldown === 'timeline' && (
                  <>
                    <p className="text-sm text-slate-600 font-medium mb-4">Draw lifecycle from request to funding.</p>
                    <div className="space-y-4">
                      {timeline.map((step, i) => (
                        <div key={i} className="flex items-start gap-4 p-4 rounded-xl bg-white/30 backdrop-blur-sm border border-white/50">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                            step.done ? 'bg-teal-500/90 text-white' : 'bg-slate-200/40 text-slate-500'
                          }`}>
                            {step.done ? <CheckCircle2 size={16} /> : <span className="text-xs font-bold">{i + 1}</span>}
                          </div>
                          <div>
                            <p className={`font-semibold ${step.done ? 'text-slate-900' : 'text-slate-600'}`}>{step.label}</p>
                            <p className="text-xs text-slate-600 font-medium">{step.date}</p>
                          </div>
                        </div>
                      ))}
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
  );
}
