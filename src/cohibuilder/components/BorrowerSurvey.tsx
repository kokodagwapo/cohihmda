import React, { useState } from 'react';
import {
  Mail,
  MessageCircle,
  Send,
  ChevronDown,
  MapPin,
  Sparkles,
  Clock,
  Zap,
  PartyPopper,
  Shield,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useCohiBuilderPortfolio } from '../contexts/CohiBuilderPortfolioContext';
import { anonymizeBorrowerName, borrowerGivenInitials } from '../lib/borrowerPrivacy';

/** Copy is written as the borrower sees it—first person / “you,” no lender-internal framing. */
const SURVEY_QUESTIONS = [
  {
    title: 'Anything new in your life since we last talked?',
    desc: 'Your answer is just for you—tap what fits. Small updates (new job, growing family, a move) can matter for your loan.',
    options: [
      { label: 'Nothing major has changed', sub: 'My situation is about the same' },
      { label: 'My income went up', sub: 'Raise, new job, or extra work' },
      { label: 'Something shifted at home or work', sub: 'Different job, household, or schedule' },
      { label: 'Something big is coming up', sub: 'Marriage, baby, relocation, or other life change' },
    ],
  },
  {
    title: 'Any new monthly payments on your plate?',
    desc: 'Think car payment, furniture financing, or balances you’re carrying—whatever feels true for you right now.',
    options: [
      { label: 'No new loans or big purchases', sub: 'Nothing new since I applied' },
      { label: 'I took on a car loan or lease', sub: 'New or updated vehicle payment' },
      { label: 'I’ve been using credit cards more', sub: 'Travel, holidays, or one-off spending' },
      { label: 'Something else new each month', sub: 'Personal loan, medical bills, etc.' },
    ],
  },
  {
    title: 'How are you feeling about cash for closing?',
    desc: 'Only you know if your savings and gift money are still where you expected. Pick what feels closest—no wrong answer.',
    options: [
      { label: "I'm on track—funds are ready", sub: 'Same plan as before' },
      { label: 'I moved money between accounts', sub: 'Savings, investments, or bank changes' },
      { label: 'I received a large deposit recently', sub: 'Gift, bonus, sale, or inheritance' },
      { label: "I'd like to talk it through", sub: 'I want help from my loan team' },
    ],
  },
  {
    title: 'How is your new home or build going?',
    desc: 'If you’re building or buying new construction, has anything changed on your end with timing or the home itself?',
    options: [
      { label: 'Right on track', sub: 'No changes I need to flag' },
      { label: 'A little behind, but manageable', sub: 'Small delay, I’m not worried yet' },
      { label: 'The timeline changed a lot', sub: 'Bigger delay or uncertainty on finish' },
      { label: 'I added upgrades or changes', sub: 'Options, finishes, or change orders' },
    ],
  },
  {
    title: 'Is your insurance or contact info still correct?',
    desc: 'If you switched homeowners insurance, updated HOA paperwork, or changed your address or legal name, let us know here.',
    options: [
      { label: 'Yes—still the same as I gave you', sub: 'Insurance, HOA, name, and address unchanged' },
      { label: "I'm changing or shopping insurance", sub: 'New carrier or binder in progress' },
      { label: 'HOA or condo paperwork changed', sub: 'Fees, rules, or documents updated' },
      { label: 'I need to update address or name', sub: 'Doesn’t match what I applied with' },
    ],
  },
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

export default function BorrowerSurvey() {
  const { allLoans: loans } = useCohiBuilderPortfolio();
  const buyers = loans.slice(0, 8);
  const [selectedBuyer, setSelectedBuyer] = useState<number | null>(null);
  const [channel, setChannel] = useState<'email' | 'sms' | null>(null);
  const [sent, setSent] = useState(false);
  const [showBuyerList, setShowBuyerList] = useState(false);

  const selected = buyers.find((b) => b.id === selectedBuyer);

  const handleSend = () => {
    if (!selectedBuyer || !channel) return;
    setSent(true);
  };

  if (sent) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full min-h-[60vh] flex flex-col items-center justify-center px-4 py-12"
      >
        <div className="w-full max-w-2xl relative">
          <div
            className="absolute -inset-4 rounded-[2rem] opacity-90 blur-2xl pointer-events-none"
            style={{
              background:
                'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(251, 146, 60, 0.35), transparent 55%), radial-gradient(ellipse 70% 50% at 80% 80%, rgba(56, 189, 248, 0.25), transparent 50%)',
            }}
          />
          <div className="relative rounded-[1.75rem] border border-white/60 bg-white/75 backdrop-blur-xl shadow-[0_24px_80px_-24px_rgba(15,23,42,0.2)] p-10 sm:p-14 text-center overflow-hidden">
            <div className="absolute top-0 right-0 w-40 h-40 rounded-full bg-gradient-to-br from-amber-200/40 to-orange-300/20 blur-2xl pointer-events-none" />
            <motion.div
              initial={{ scale: 0.85, rotate: -8 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 18 }}
              className="w-24 h-24 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mx-auto mb-8 shadow-lg shadow-orange-500/30"
            >
              <PartyPopper size={44} className="text-white drop-shadow-sm" strokeWidth={1.75} />
            </motion.div>
            <h2 className="text-3xl sm:text-4xl font-display font-bold text-slate-900 tracking-tight">
              You&apos;re all set!
            </h2>
            <p className="text-slate-600 mt-4 text-base sm:text-lg leading-relaxed max-w-md mx-auto">
              The <span className="font-semibold text-slate-900">Home Journey Pulse</span> link went out via{' '}
              <span className="font-semibold text-orange-600">
                {channel === 'email' ? 'email' : 'SMS'}
              </span>{' '}
              to <span className="font-semibold text-slate-900">{selected ? anonymizeBorrowerName(selected.borrower) : ''}</span>.
            </p>
            <p className="text-slate-500 text-sm mt-3 max-w-sm mx-auto leading-relaxed">
              Five quick taps per topic, about two minutes total. Replies land in their loan profile when they submit.
            </p>
            <button
              type="button"
              onClick={() => {
                setSent(false);
                setSelectedBuyer(null);
                setChannel(null);
              }}
              className="mt-10 px-8 py-3.5 rounded-xl border-2 border-slate-200/80 bg-white/80 text-slate-800 font-semibold text-sm hover:border-orange-300/80 hover:bg-orange-50/50 transition-all shadow-sm"
            >
              Send to another buyer
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="w-full space-y-0">
      {/* Full-width hero — light / pastel (matches app shell) */}
      <div className="relative w-full overflow-hidden rounded-2xl sm:rounded-3xl border border-[var(--border-subtle)] bg-gradient-to-br from-white/95 via-[var(--bg-muted)] to-teal-50/35 text-[var(--text-primary)] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.1)] mb-8 sm:mb-10">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: `
              radial-gradient(ellipse 100% 85% at 0% -15%, rgba(251, 191, 36, 0.14), transparent 52%),
              radial-gradient(ellipse 75% 55% at 100% 5%, rgba(45, 212, 191, 0.12), transparent 48%),
              radial-gradient(ellipse 55% 45% at 72% 100%, rgba(196, 181, 253, 0.14), transparent 50%)
            `,
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.4] pointer-events-none"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%230f172a' fill-opacity='0.035'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />
        <div className="relative px-5 py-10 sm:px-10 sm:py-14 lg:px-14 lg:py-16">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8 lg:gap-12 max-w-6xl mx-auto">
            <div className="space-y-5 max-w-2xl">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-sky-50/90 border border-sky-200/60 text-xs font-semibold uppercase tracking-[0.12em] text-sky-800 backdrop-blur-sm shadow-sm"
              >
                <Sparkles size={14} className="text-sky-600" />
                Pulse Survey
              </motion.div>
              <motion.h1
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                className="text-3xl sm:text-4xl lg:text-5xl font-display font-bold tracking-tight leading-[1.08] text-[var(--text-primary)]"
              >
                Buyer financial check-in
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="text-base sm:text-lg text-[var(--text-secondary)] font-light leading-relaxed max-w-xl"
              >
                One friendly nudge. No PDFs, no portals—just five quick tap-to-answer questions so your team
                stays ahead of life changes before closing.
              </motion.p>
            </div>
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.15, type: 'spring', stiffness: 200, damping: 22 }}
              className="flex flex-wrap gap-3 lg:justify-end shrink-0"
            >
              {[
                { icon: Clock, label: '~2 min', sub: 'to complete', iconWrap: 'bg-amber-50 border-amber-200/60 text-amber-700' },
                { icon: Zap, label: '5 questions', sub: 'quick tap', iconWrap: 'bg-teal-50 border-teal-200/60 text-teal-700' },
                { icon: Shield, label: 'Secure', sub: 'Cohi Builder', iconWrap: 'bg-violet-50 border-violet-200/60 text-violet-700' },
              ].map(({ icon: Icon, label, sub, iconWrap }) => (
                <div
                  key={label}
                  className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/75 border border-white/80 backdrop-blur-md min-w-[140px] shadow-[0_4px_20px_-8px_rgba(15,23,42,0.08)]"
                >
                  <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${iconWrap}`}>
                    <Icon size={20} strokeWidth={2} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-[var(--text-primary)] leading-tight">{label}</p>
                    <p className="text-[11px] text-[var(--text-muted)] font-medium uppercase tracking-wide">{sub}</p>
                  </div>
                </div>
              ))}
            </motion.div>
          </div>
        </div>
      </div>

      {/* Main grid — full width */}
      <div className="w-full grid grid-cols-1 xl:grid-cols-12 gap-6 lg:gap-8 items-start">
        {/* Left: compose */}
        <div className="xl:col-span-7 space-y-6 w-full">
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 backdrop-blur-sm p-6 sm:p-8 shadow-[0_12px_40px_-20px_rgba(15,23,42,0.12)]"
          >
            <div className="flex items-center justify-between gap-4 mb-6">
              <div>
                <p className="text-[11px] font-bold text-orange-600 uppercase tracking-[0.14em] mb-1">
                  Step 1
                </p>
                <h2 className="text-xl font-display font-bold text-slate-900">Who gets the pulse?</h2>
                <p className="text-sm text-slate-500 mt-1">Pick a borrower—tap a card on desktop or use the list on mobile.</p>
              </div>
            </div>

            {/* Desktop: card grid */}
            <div className="hidden sm:grid sm:grid-cols-2 gap-3">
              {buyers.map((b, i) => (
                <motion.button
                  key={b.id}
                  type="button"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => setSelectedBuyer(b.id)}
                  className={`text-left rounded-2xl border-2 p-4 transition-all duration-200 flex gap-3 group ${
                    selectedBuyer === b.id
                      ? 'border-orange-400 bg-gradient-to-br from-orange-50/90 to-amber-50/50 shadow-md shadow-orange-200/40 ring-2 ring-orange-200/50'
                      : 'border-slate-200/80 bg-white/50 hover:border-orange-200 hover:bg-white/80 hover:shadow-md'
                  }`}
                >
                  <div className="relative w-14 h-14 rounded-xl overflow-hidden shrink-0 border border-white shadow-sm">
                    <img
                      src={b.propertyImage}
                      alt=""
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-900/50 to-transparent" />
                    <span className="absolute bottom-1 left-1 text-[10px] font-bold text-white drop-shadow">
                      {borrowerGivenInitials(b.borrower)}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900 truncate">{anonymizeBorrowerName(b.borrower)}</p>
                    <p className="text-xs text-slate-500 flex items-start gap-1 mt-1 line-clamp-2">
                      <MapPin size={12} className="shrink-0 mt-0.5 text-orange-500" />
                      {b.city}, {b.state}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1.5 font-medium">
                      {b.status} · ${(b.loanAmount / 1000).toFixed(0)}k
                    </p>
                  </div>
                </motion.button>
              ))}
            </div>

            {/* Mobile: collapsible selector */}
            <div className="sm:hidden relative">
              <button
                type="button"
                onClick={() => setShowBuyerList(!showBuyerList)}
                className="w-full flex items-center justify-between gap-3 px-4 py-4 rounded-2xl bg-white/80 border-2 border-slate-200/80 text-left active:scale-[0.99] transition-all"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {selected ? (
                    <div className="w-12 h-12 rounded-xl overflow-hidden border border-slate-200 shrink-0">
                      <img
                        src={selected.propertyImage}
                        alt=""
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center shrink-0">
                      <MapPin size={22} className="text-orange-600" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-900 block truncate">
                      {selected ? anonymizeBorrowerName(selected.borrower) : 'Select a borrower'}
                    </span>
                    {selected && (
                      <span className="text-xs text-slate-500 truncate block">{selected.city}, {selected.state}</span>
                    )}
                  </div>
                </div>
                <ChevronDown
                  size={22}
                  className={`text-slate-500 shrink-0 transition-transform ${showBuyerList ? 'rotate-180' : ''}`}
                />
              </button>
              <AnimatePresence>
                {showBuyerList && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 rounded-2xl border border-slate-200/80 bg-white/90 max-h-64 overflow-y-auto divide-y divide-slate-100">
                      {buyers.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => {
                            setSelectedBuyer(b.id);
                            setShowBuyerList(false);
                          }}
                          className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-orange-50/80 transition-colors ${
                            selectedBuyer === b.id ? 'bg-orange-50' : ''
                          }`}
                        >
                          <img
                            src={b.propertyImage}
                            alt=""
                            className="w-10 h-10 rounded-lg object-cover"
                            referrerPolicy="no-referrer"
                          />
                          <div>
                            <p className="font-semibold text-slate-900 text-sm">{anonymizeBorrowerName(b.borrower)}</p>
                            <p className="text-xs text-slate-500">{b.city}, {b.state}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06 }}
            className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 backdrop-blur-sm p-6 sm:p-8 shadow-[0_12px_40px_-20px_rgba(15,23,42,0.12)]"
          >
            <p className="text-[11px] font-bold text-sky-600 uppercase tracking-[0.14em] mb-1">Step 2</p>
            <h2 className="text-xl font-display font-bold text-slate-900 mb-1">How should we reach them?</h2>
            <p className="text-sm text-slate-500 mb-6">Email for a richer experience; SMS for speed and open rates.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setChannel('email')}
                className={`relative rounded-2xl border-2 p-6 text-left transition-all duration-200 overflow-hidden group ${
                  channel === 'email'
                    ? 'border-sky-400 bg-gradient-to-br from-sky-50 to-white shadow-lg shadow-sky-200/40 ring-2 ring-sky-100'
                    : 'border-slate-200/90 bg-white/60 hover:border-sky-200 hover:shadow-md'
                }`}
              >
                <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-sky-400/10 group-hover:bg-sky-400/15 transition-colors" />
                <Mail
                  size={32}
                  className={`relative mb-4 ${channel === 'email' ? 'text-sky-600' : 'text-slate-400'}`}
                  strokeWidth={1.75}
                />
                <p className="relative font-display font-bold text-lg text-slate-900">Email</p>
                <p className="relative text-sm text-slate-600 mt-2 leading-relaxed">
                  Styled link in their inbox—great for borrowers who live in email.
                </p>
              </button>
              <button
                type="button"
                onClick={() => setChannel('sms')}
                className={`relative rounded-2xl border-2 p-6 text-left transition-all duration-200 overflow-hidden group ${
                  channel === 'sms'
                    ? 'border-emerald-400 bg-gradient-to-br from-emerald-50 to-white shadow-lg shadow-emerald-200/40 ring-2 ring-emerald-100'
                    : 'border-slate-200/90 bg-white/60 hover:border-emerald-200 hover:shadow-md'
                }`}
              >
                <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-emerald-400/10 group-hover:bg-emerald-400/15 transition-colors" />
                <MessageCircle
                  size={32}
                  className={`relative mb-4 ${channel === 'sms' ? 'text-emerald-600' : 'text-slate-400'}`}
                  strokeWidth={1.75}
                />
                <p className="relative font-display font-bold text-lg text-slate-900">SMS</p>
                <p className="relative text-sm text-slate-600 mt-2 leading-relaxed">
                  Short link by text—fast opens, perfect for on-the-go updates.
                </p>
              </button>
            </div>

            <button
              type="button"
              onClick={handleSend}
              disabled={!selectedBuyer || !channel}
              className="mt-8 w-full py-4 rounded-2xl btn-primary text-white font-display font-bold text-base flex items-center justify-center gap-2.5 disabled:opacity-45 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 hover:scale-[1.01] active:scale-[0.99] disabled:hover:scale-100 disabled:shadow-none"
            >
              <Send size={22} strokeWidth={2} />
              Send pulse to {selected?.borrower?.split(' ')[0] || 'buyer'}
            </button>
          </motion.section>

          <p className="text-center text-slate-500 text-xs sm:text-sm font-medium flex items-center justify-center gap-2 flex-wrap px-2">
            <Shield size={14} className="text-emerald-600 shrink-0" />
            Securely powered by Cohi Builder · Data protected end-to-end
          </p>
        </div>

        {/* Right: preview — sticky on wide screens */}
        <div className="xl:col-span-5 w-full xl:sticky xl:top-6 space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
            className="rounded-2xl border border-slate-200/80 bg-gradient-to-b from-white/95 to-slate-50/90 backdrop-blur-sm p-6 sm:p-7 shadow-[0_20px_50px_-24px_rgba(15,23,42,0.18)] overflow-hidden relative"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-fuchsia-200/30 to-orange-200/20 rounded-full blur-3xl pointer-events-none" />
            <div className="relative flex items-center gap-2 mb-2">
              <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-[10px] font-bold uppercase tracking-wider">
                Preview
              </span>
              <span className="text-xs font-semibold text-slate-500">Buyer-only wording in the survey</span>
            </div>
            <h3 className="relative text-lg font-display font-bold text-slate-900 mt-3">
              &ldquo;Keep your keys on track&rdquo;
            </h3>
            <p className="relative text-sm text-slate-600 mt-2 leading-relaxed">
              Five quick checks in your voice—tap what fits you. No lender jargon, no paperwork.
            </p>

            <div className="relative mt-6 space-y-4">
              {SURVEY_QUESTIONS.map((q, i) => (
                <motion.div
                  key={q.title}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 + i * 0.06 }}
                  className="rounded-xl border border-slate-200/90 bg-white/90 p-4 shadow-sm"
                >
                  <div className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-orange-400 to-rose-400 text-white text-xs font-bold flex items-center justify-center shadow-sm">
                      {i + 1}
                    </span>
                    <div>
                      <p className="font-semibold text-slate-900 text-sm leading-snug">{q.title}</p>
                      <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{q.desc}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-3 pl-9">
                    {q.options.map((opt) => (
                      <span
                        key={opt.label}
                        className="px-2.5 py-1 rounded-lg bg-slate-100/90 border border-slate-200/80 text-[11px] font-medium text-slate-700"
                      >
                        {opt.label}
                      </span>
                    ))}
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
