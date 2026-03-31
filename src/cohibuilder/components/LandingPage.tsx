import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowRight,
  Building2,
  HardHat,
  LineChart,
  ShieldCheck,
  Map,
  FileText,
  CheckCircle2,
  Menu,
  X,
  Layers,
  Zap,
  Users,
  Workflow,
  BarChart3,
  Plug,
  Sparkles,
  Lock,
  KeyRound,
  Server,
  ClipboardList,
  Fingerprint,
  Eye,
  Activity,
  Shield,
  Cpu,
  RefreshCw,
} from 'lucide-react';
import { TOLL_BROTHERS_HERO_SLIDES } from '../data/tollBrothersOfficialMedia';

type SectionNavId = 'features' | 'solutions' | 'security';

export default function LandingPage({ onEnterApp }: { onEnterApp: () => void }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const [currentImage, setCurrentImage] = React.useState(0);

  /** Full reload / first paint: always start at top (ignore hash). */
  React.useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, []);

  React.useEffect(() => {
    const timer = setInterval(() => {
      setCurrentImage((prev) => (prev + 1) % TOLL_BROTHERS_HERO_SLIDES.length);
    }, 8000);
    return () => clearInterval(timer);
  }, []);

  const scrollToSection = (id: SectionNavId) => {
    setIsMobileMenuOpen(false);
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  };

  const handleSectionNavClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    id: SectionNavId
  ) => {
    e.preventDefault();
    scrollToSection(id);
  };

  return (
    <div className="min-h-[100svh] bg-[var(--bg-app)] text-slate-900 font-sans selection:bg-teal-200 selection:text-teal-900 overflow-x-hidden">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-slate-900/40 backdrop-blur-md border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-sm">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <span className="font-light text-xl tracking-tight text-white font-display">CohiBuilder</span>
          </div>
          
          <div className="hidden md:flex items-center gap-8 text-sm font-light text-slate-200">
            <a
              href="https://coheus.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              Coheus.com
            </a>
            <a
              href="#features"
              onClick={(e) => handleSectionNavClick(e, 'features')}
              className="hover:text-white transition-colors"
            >
              Features
            </a>
            <a
              href="#solutions"
              onClick={(e) => handleSectionNavClick(e, 'solutions')}
              className="hover:text-white transition-colors"
            >
              Solutions
            </a>
            <a
              href="#security"
              onClick={(e) => handleSectionNavClick(e, 'security')}
              className="hover:text-white transition-colors"
            >
              Security
            </a>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <button 
              onClick={onEnterApp}
              className="text-sm font-light text-slate-200 hover:text-white transition-colors hidden sm:block"
            >
              Sign In
            </button>
            <button 
              onClick={onEnterApp}
              className="bg-blue-600 hover:bg-blue-500 text-white px-4 sm:px-5 py-2 rounded-full text-xs sm:text-sm font-medium transition-all shadow-sm hover:shadow flex items-center gap-2 tracking-wide"
            >
              <span className="hidden xs:inline">Go to Dashboard</span>
              <span className="xs:hidden">Dashboard</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-2 text-white hover:bg-white/10 rounded-lg md:hidden"
            >
              {isMobileMenuOpen ? <X className="w-5 h-5 sm:w-6 sm:h-6" /> : <Menu className="w-5 h-5 sm:w-6 sm:h-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="md:hidden bg-white/80 backdrop-blur-md border-b border-white/50 overflow-hidden"
            >
              <div className="px-6 py-4 flex flex-col gap-4 text-sm font-medium text-slate-600">
                <a
                  href="https://coheus.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="hover:text-teal-600 py-2"
                >
                  Coheus.com
                </a>
                <a
                  href="#features"
                  onClick={(e) => handleSectionNavClick(e, 'features')}
                  className="hover:text-teal-600 py-2"
                >
                  Features
                </a>
                <a
                  href="#solutions"
                  onClick={(e) => handleSectionNavClick(e, 'solutions')}
                  className="hover:text-teal-600 py-2"
                >
                  Solutions
                </a>
                <a
                  href="#security"
                  onClick={(e) => handleSectionNavClick(e, 'security')}
                  className="hover:text-teal-600 py-2"
                >
                  Security
                </a>
                <hr className="border-slate-100" />
                <button onClick={onEnterApp} className="text-left py-2 hover:text-teal-600">Sign In</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      {/* Hero Section */}
      <section className="relative min-h-[100svh] flex items-center justify-center overflow-hidden w-full max-w-[100vw] pt-16 sm:pt-20">
        {/* Background Slider */}
        <div className="absolute inset-0 z-0 bg-slate-950">
          <AnimatePresence mode="wait">
            <motion.img
              key={currentImage}
              src={TOLL_BROTHERS_HERO_SLIDES[currentImage].src}
              initial={{ opacity: 0, scale: 1.05 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ 
                opacity: { duration: 1.2, ease: "easeInOut" },
                scale: { duration: 12, ease: "linear" }
              }}
              className="absolute inset-0 w-full h-full object-cover object-center"
              alt={TOLL_BROTHERS_HERO_SLIDES[currentImage].alt}
              referrerPolicy="no-referrer"
            />
          </AnimatePresence>
          {/* Gradient Overlay for Text Readability */}
          <div className="absolute inset-0 bg-gradient-to-b from-slate-900/80 via-slate-900/40 to-slate-900/90 z-10 pointer-events-none" />
        </div>
        
        <div className="relative z-20 max-w-7xl mx-auto px-4 sm:px-6 w-full flex flex-col items-center text-center">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="max-w-4xl w-full flex flex-col items-center"
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-white text-[10px] sm:text-xs font-medium uppercase tracking-widest mb-8">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </span>
              AI Powered by Cohi
            </div>
            <h1 className="text-4xl sm:text-6xl lg:text-7xl font-light tracking-tight text-white leading-[1.1] mb-6 font-display">
              <span className="font-light text-white/95 block">
                The Performance Operating System for
              </span>
              <span className="font-medium text-transparent bg-clip-text bg-gradient-to-r from-blue-200 to-white block mt-1 sm:mt-2">
                Builder Financing.
              </span>
            </h1>
            <p className="text-base sm:text-lg text-slate-200 mb-10 leading-relaxed max-w-xl mx-auto font-light">
              One executive view for finance and leadership: track{' '}
              <span className="text-white font-medium">mortgage capture</span> against signed contracts, monitor financing readiness as homes move through construction, and spot credit, documentation, and market risk early enough to protect margins and closing dates.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full sm:w-auto max-w-lg sm:max-w-none">
              <button 
                onClick={onEnterApp}
                className="w-full sm:w-auto max-w-md sm:max-w-xl bg-blue-600 hover:bg-blue-500 text-white px-5 sm:px-8 py-4 rounded-full transition-all shadow-lg hover:shadow-blue-500/25 inline-flex items-center justify-center gap-3 text-center"
              >
                <span className="text-sm sm:text-base font-semibold leading-tight">Open platform</span>
                <ArrowRight className="w-4 h-4 shrink-0 opacity-90 self-center" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() =>
                  document.getElementById('features')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
                className="w-full sm:w-auto bg-white/10 backdrop-blur-md hover:bg-white/20 text-white border border-white/30 px-8 py-4 rounded-full text-sm font-medium transition-all flex items-center justify-center gap-2 shadow-sm tracking-wide"
              >
                Features
              </button>
            </div>
            
            <div className="mt-10 sm:mt-12 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-8 text-sm text-slate-300 font-light tracking-wide">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-blue-400" />
                Toll communities &amp; buyers in view
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-blue-400" />
                Builder–lender financing alignment
              </div>
            </div>
          </motion.div>
        </div>
        
        <motion.div 
          animate={{ y: [0, -10, 0] }}
          transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
          className="absolute bottom-8 right-8 bg-white/10 backdrop-blur-xl p-4 rounded-2xl shadow-2xl border border-white/20 hidden md:flex items-center gap-4 z-20"
        >
          <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center border border-blue-400/30">
            <ShieldCheck className="w-6 h-6 text-blue-300" />
          </div>
          <div className="text-left">
            <div className="text-sm font-medium text-white tracking-wide">RESPA Compliant</div>
            <div className="text-xs text-blue-200 font-light">Automated monitoring</div>
          </div>
        </motion.div>
      </section>

      {/* Features Grid */}
      <section
        id="features"
        className="scroll-mt-16 py-24 bg-white/30 backdrop-blur-3xl border-t border-white/50"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-4xl font-light text-slate-900 mb-4 font-display">Built for builder-affiliated mortgage operations</h2>
            <p className="text-slate-600 text-lg font-light">
              KPIs, workflows, and integrations tuned to capture rate, long-duration builds, and the handoff from builder-side systems to the LOS—not resale retail or generic BI configuration.
            </p>
          </div>
          
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
            {[
              {
                icon: <HardHat className="w-6 h-6 text-amber-600" />,
                bg: "bg-amber-50",
                title: "Draw Management",
                desc: "Streamline draw requests, inspections, and disbursements with automated workflows and digital signatures."
              },
              {
                icon: <LineChart className="w-6 h-6 text-blue-600" />,
                bg: "bg-blue-50",
                title: "Risk Breakdown",
                desc: "Surface fallout risk and qualification drift while homes are under construction—before closing slips at the end of the cycle."
              },
              {
                icon: <FileText className="w-6 h-6 text-purple-600" />,
                bg: "bg-purple-50",
                title: "RESPA Monitoring",
                desc: "Stay compliant automatically. Track document expirations and regulatory milestones across your entire portfolio."
              },
              {
                icon: <Map className="w-6 h-6 text-emerald-600" />,
                bg: "bg-emerald-50",
                title: "Portfolio Map",
                desc: "Visualize your active builds geographically to understand concentration risk and optimize inspection routes."
              },
              {
                icon: <Building2 className="w-6 h-6 text-indigo-600" />,
                bg: "bg-indigo-50",
                title: "Builder alignment",
                desc: "Mirror how builder CRM/ERP and construction data feed the lender LOS—so milestones, incentives, and loan status stay visible to both sides."
              },
              {
                icon: <ShieldCheck className="w-6 h-6 text-teal-600" />,
                bg: "bg-teal-50",
                title: "Secure Document Vault",
                desc: "Store plans, permits, and inspection reports in a SOC 2 compliant vault with granular access controls."
              }
            ].map((feature, i) => (
              <div key={i} className="card-base p-5 sm:p-6 group relative">
                <div className={`w-12 h-12 rounded-xl ${feature.bg} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform shadow-sm`}>
                  {feature.icon}
                </div>
                <h3 className="text-lg sm:text-xl font-semibold text-slate-900 mb-3">{feature.title}</h3>
                <p className="text-sm sm:text-base text-slate-600 leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Solutions */}
      <section
        id="solutions"
        className="scroll-mt-16 py-20 sm:py-28 bg-slate-900 relative overflow-hidden"
      >
        <div
          className="absolute inset-0 opacity-10 bg-cover bg-center mix-blend-overlay"
          style={{
            backgroundImage:
              "url('https://cdn.tollbrothers.com/communities/14613/images-resized/03_Parkside_West_Front_Elevation_Twilight_Centered_1920.jpg')",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-slate-900 via-slate-900/95 to-slate-950" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[min(100%,800px)] h-64 bg-teal-500/20 blur-[100px] rounded-full pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 relative z-10">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8 mb-14 sm:mb-16">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/15 border border-teal-400/30 text-teal-300 text-xs font-semibold uppercase tracking-widest mb-5">
                <Layers className="w-3.5 h-3.5" aria-hidden />
                Solutions
              </div>
              <h2 className="text-4xl sm:text-5xl font-light text-white mb-4 font-display leading-tight">
                From builder contract to funded loan—with signal back to the field
              </h2>
              <p className="text-lg text-slate-300 font-light leading-relaxed">
                Aligns with how production builders run: communities, contracts, and incentives on the builder side; origination in the captive or preferred LOS; Cohi surfaces capture, readiness, and risk so teams are not blind during six-to-nine-month build cycles.
              </p>
            </div>
            <button
              type="button"
              onClick={onEnterApp}
              className="shrink-0 bg-teal-500 hover:bg-teal-400 text-slate-900 px-8 py-4 rounded-full text-base font-bold transition-all shadow-xl hover:shadow-teal-500/25 flex items-center justify-center gap-2 self-start lg:self-auto"
            >
              Go to Dashboard
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>

          {/* Live-style metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-14 sm:mb-16">
            {[
              { label: 'Active construction loans', value: '2,847', change: '+12.4%', icon: BarChart3, accent: 'text-sky-400' },
              { label: 'Avg. draw cycle time', value: '4.2 days', change: '−18%', icon: RefreshCw, accent: 'text-teal-400' },
              { label: 'Portfolio under management', value: '$1.9B', change: 'YTD', icon: Activity, accent: 'text-violet-400' },
              { label: 'Inspections scheduled (30d)', value: '3,412', change: '+6.1%', icon: CheckCircle2, accent: 'text-emerald-400' },
            ].map((m) => (
              <div
                key={m.label}
                className="rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur-md p-4 sm:p-5 hover:bg-white/[0.09] transition-colors"
              >
                <div className="flex items-center justify-between gap-2 mb-3">
                  <m.icon className={`w-5 h-5 ${m.accent}`} aria-hidden />
                  <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-teal-400/90 bg-teal-500/10 px-2 py-0.5 rounded-full">
                    {m.change}
                  </span>
                </div>
                <p className="text-2xl sm:text-3xl font-semibold text-white tabular-nums tracking-tight">{m.value}</p>
                <p className="text-xs sm:text-sm text-slate-400 mt-1 font-light leading-snug">{m.label}</p>
              </div>
            ))}
          </div>

          {/* Solution cards */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {[
              {
                icon: <Workflow className="w-6 h-6 text-teal-300" />,
                ring: 'from-teal-400/30 to-teal-600/10',
                title: 'Draw & disbursement orchestration',
                desc: 'Route inspections, lien releases, and funding approvals with SLA timers, e-sign, and full audit trails per draw.',
                stat: '94% on-time fundings',
              },
              {
                icon: <Users className="w-6 h-6 text-sky-300" />,
                ring: 'from-sky-400/30 to-sky-600/10',
                title: 'Multi-party workspaces',
                desc: 'Role-based views for underwriting, construction admin, and builder partners—everyone sees the same loan truth.',
                stat: '40+ permission templates',
              },
              {
                icon: <Zap className="w-6 h-6 text-amber-300" />,
                ring: 'from-amber-400/30 to-amber-600/10',
                title: 'Risk signals & concentration',
                desc: 'Geo heat maps, builder scorecards, and early-warning rules so you rebalance exposure before it hits the tape.',
                stat: '127 risk rules live',
              },
              {
                icon: <Plug className="w-6 h-6 text-violet-300" />,
                ring: 'from-violet-400/30 to-violet-600/10',
                title: 'Builder systems & LOS connectivity',
                desc: 'Ingest from builder CRM/ERP and construction tools as well as the LOS—webhooks and templates so milestones and risk flow both ways.',
                stat: '35+ integration patterns',
              },
              {
                icon: <Cpu className="w-6 h-6 text-cyan-300" />,
                ring: 'from-cyan-400/30 to-cyan-600/10',
                title: 'Ask Cohi & automation',
                desc: 'Natural-language answers across your portfolio plus scheduled reports for committees and investor decks.',
                stat: '12 hrs/week saved / user',
              },
              {
                icon: <Sparkles className="w-6 h-6 text-rose-300" />,
                ring: 'from-rose-400/30 to-rose-600/10',
                title: 'Executive-ready reporting',
                desc: 'Board packs, pipeline aging, and cohort performance with export to PDF, slides, and secure share links.',
                stat: '48 report templates',
              },
            ].map((card, i) => (
              <div
                key={i}
                className="group rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.08] to-white/[0.02] backdrop-blur-md p-6 sm:p-7 hover:border-teal-400/30 hover:shadow-[0_20px_50px_-20px_rgba(20,184,166,0.35)] transition-all duration-300"
              >
                <div
                  className={`w-12 h-12 rounded-xl bg-gradient-to-br ${card.ring} border border-white/10 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform`}
                >
                  {card.icon}
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{card.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed mb-4 font-light">{card.desc}</p>
                <div className="flex items-center gap-2 text-xs font-medium text-teal-400/95">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.8)]" />
                  {card.stat}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Security */}
      <section
        id="security"
        className="scroll-mt-16 py-20 sm:py-28 bg-gradient-to-b from-slate-50 to-white border-t border-slate-200/80"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center max-w-3xl mx-auto mb-14 sm:mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 text-white text-xs font-semibold uppercase tracking-widest mb-5 shadow-lg shadow-slate-900/10">
              <Shield className="w-3.5 h-3.5 text-teal-400" aria-hidden />
              Security &amp; compliance
            </div>
            <h2 className="text-4xl sm:text-5xl font-light text-slate-900 mb-4 font-display leading-tight">
              Trust architecture for regulated mortgage operations
            </h2>
            <p className="text-slate-600 text-lg font-light leading-relaxed">
              Defense in depth, least-privilege access, and continuous monitoring—so your construction portfolio meets bank-grade
              expectations without slowing teams down.
            </p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-12 sm:mb-14">
            {[
              { label: 'Platform uptime (12-mo)', value: '99.98%', sub: 'Excluding planned maintenance', icon: Activity },
              { label: 'Data encrypted at rest', value: 'AES-256', sub: 'Per-tenant keys in HSM', icon: Lock },
              { label: 'TLS in transit', value: 'TLS 1.3', sub: 'Certificate pinning ready', icon: KeyRound },
              { label: 'Audit events indexed / day', value: '4.2M+', sub: 'Immutable append-only logs', icon: ClipboardList },
            ].map((m) => (
              <div key={m.label} className="card-base p-4 sm:p-5 text-center sm:text-left">
                <m.icon className="w-5 h-5 text-slate-700 mb-3 mx-auto sm:mx-0" aria-hidden />
                <p className="text-xl sm:text-2xl font-semibold text-slate-900 tabular-nums">{m.value}</p>
                <p className="text-xs font-semibold text-slate-800 mt-1">{m.label}</p>
                <p className="text-[11px] text-slate-500 mt-1 font-light">{m.sub}</p>
              </div>
            ))}
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
            {[
              {
                icon: <ShieldCheck className="w-6 h-6 text-teal-600" />,
                bg: 'bg-teal-50',
                title: 'SOC 2 Type II–aligned controls',
                desc: 'Security, availability, and confidentiality controls mapped to your vendor due-diligence questionnaires.',
                bullets: ['Annual third-party assessment', 'Change management & SDLC gates'],
              },
              {
                icon: <Fingerprint className="w-6 h-6 text-indigo-600" />,
                bg: 'bg-indigo-50',
                title: 'Identity & access (IAM)',
                desc: 'SSO/SAML, MFA enforcement, and scoped API tokens with automatic rotation policies.',
                bullets: ['RBAC + ABAC hybrid model', 'Session risk scoring'],
              },
              {
                icon: <Server className="w-6 h-6 text-slate-700" />,
                bg: 'bg-slate-100',
                title: 'Resilient cloud footprint',
                desc: 'Multi-AZ workloads, encrypted backups, and tested disaster-recovery runbooks.',
                bullets: ['RPO under 1 hr · RTO under 4 hr targets'],
              },
              {
                icon: <Eye className="w-6 h-6 text-amber-600" />,
                bg: 'bg-amber-50',
                title: 'Continuous monitoring',
                desc: '24/7 anomaly detection on auth, data access, and admin actions with pager escalation.',
                bullets: ['SIEM feed compatible', 'Customer security inbox'],
              },
              {
                icon: <FileText className="w-6 h-6 text-violet-600" />,
                bg: 'bg-violet-50',
                title: 'Compliance artifacts',
                desc: 'RESPA milestone tracking, document retention policies, and exportable evidence packs for exams.',
                bullets: ['Configurable retention tiers', 'Legal hold workflows'],
              },
              {
                icon: <Lock className="w-6 h-6 text-rose-600" />,
                bg: 'bg-rose-50',
                title: 'Data residency options',
                desc: 'Segment sensitive workloads by region; PII minimization defaults for non-production environments.',
                bullets: ['Field-level encryption roadmap', 'Customer-managed keys (pilot)'],
              },
            ].map((card, i) => (
              <div key={i} className="card-base p-6 sm:p-7 group relative">
                <div
                  className={`w-12 h-12 rounded-xl ${card.bg} flex items-center justify-center mb-5 group-hover:scale-110 transition-transform shadow-sm border border-black/[0.04]`}
                >
                  {card.icon}
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">{card.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed mb-4 font-light">{card.desc}</p>
                <ul className="text-xs text-slate-500 space-y-1.5 font-medium">
                  {(Array.isArray(card.bullets) ? card.bullets : [card.bullets]).map((b, j) => (
                    <li key={j} className="flex items-start gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-teal-600 shrink-0 mt-0.5" aria-hidden />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p className="text-center text-xs text-slate-500 mt-12 max-w-2xl mx-auto font-light leading-relaxed">
            Figures shown are representative demo metrics for illustration. Your production SLAs, integrations, and compliance
            posture are defined in your enterprise agreement and security addendum.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-950 py-12 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-blue-600 rounded flex items-center justify-center">
              <Building2 className="w-3 h-3 text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight text-white">CohiBuilder</span>
          </div>
          <div className="text-slate-500 text-sm">
            &copy; {new Date().getFullYear()} Coheus Inc. All rights reserved.
          </div>
          <div className="flex gap-6 text-sm font-medium text-slate-400">
            <a href="#" className="hover:text-white transition-colors">Privacy</a>
            <a href="#" className="hover:text-white transition-colors">Terms</a>
            <a href="#" className="hover:text-white transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
