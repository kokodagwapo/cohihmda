import React, { useMemo, useRef, useState, useEffect } from 'react';
import { 
  Home,
  BrainCircuit,
  LayoutDashboard, 
  FileText, 
  Settings, 
  ClipboardCheck, 
  ShieldCheck,
  Menu, 
  X,
  Bell,
  Search,
  User,
  Moon,
  Sun,
  Mic,
  Wallet,
  Link,
  Download,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import TollAssistant from './TollAssistant';
import { useCohiBuilderPortfolio } from '../contexts/CohiBuilderPortfolioContext';
import { usePortfolioMapSearch } from '../contexts/PortfolioMapSearchContext';
import { anonymizeBorrowerName, displayLoanOfficer } from '../lib/borrowerPrivacy';
import { resolvedPrimaryLenderLabel } from '../lib/lenderDisplay';

interface LayoutProps {
  children: React.ReactNode;
  activeView: string;
  setActiveView: (view: string, patch?: { loanId?: number | null; appId?: string | null; drawId?: string | null; lenderId?: number | null }) => void;
  onSelectLoan: (loanId: number) => void;
  /** Embedded in Coheus: Home exits to main app */
  onExit?: () => void;
  /** Embedded in Capture Analysis — FAB positions inside panel */
  embedded?: boolean;
  /** Off-canvas left rail on all breakpoints; embedded Capture Analysis always sets true */
  hideSidebar?: boolean;
  /** Rendered after the search field in the header (e.g. Capture Analysis page tabs) */
  headerAfterSearch?: React.ReactNode;
}

export default function Layout({ children, activeView, setActiveView, onSelectLoan, onExit, embedded, hideSidebar = false, headerAfterSearch }: LayoutProps) {
  const { allLoans: loans } = useCohiBuilderPortfolio();
  const { setListFilter: setPortfolioMapListFilter } = usePortfolioMapSearch();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  // Close sidebar on mobile when view changes
  useEffect(() => {
    if (window.innerWidth < 1024) {
      setIsSidebarOpen(false);
    }
  }, [activeView]);

  const navItems = [
    { id: 'dashboard', label: 'Executive Overview', icon: LayoutDashboard, iconActive: 'bg-sky-50/70 text-sky-600', iconInactive: 'bg-slate-50/50 text-slate-500' },
    { id: 'draws', label: 'Funding & Disbursements', icon: Wallet, iconActive: 'bg-emerald-50/70 text-emerald-600', iconInactive: 'bg-slate-50/50 text-slate-500' },
    { id: 'high-risk-loans', label: 'Pipeline Risk Watchlist', icon: FileText, iconActive: 'bg-violet-50/70 text-violet-600', iconInactive: 'bg-slate-50/50 text-slate-500' },
    { id: 'lenders', label: 'Lender Master', icon: Settings, iconActive: 'bg-amber-50/70 text-amber-600', iconInactive: 'bg-slate-50/50 text-slate-500' },
    { id: 'survey', label: 'Buyer Financial Check-in', icon: ClipboardCheck, iconActive: 'bg-sky-50/70 text-sky-600', iconInactive: 'bg-slate-50/50 text-slate-500' },
    { id: 'respa', label: 'RESPA & Compliance', icon: ShieldCheck, iconActive: 'bg-teal-50/70 text-teal-600', iconInactive: 'bg-slate-50/50 text-slate-500' },
    { id: 'integrations', label: 'Integrations', icon: Link, iconActive: 'bg-indigo-50/70 text-indigo-600', iconInactive: 'bg-slate-50/50 text-slate-500' },
  ];

  const searchActions = useMemo(() => {
    const base = [
      { id: 'landing', label: 'Home', subtitle: onExit ? 'Return to main Coheus app' : 'Return to landing page', kind: 'view' as const },
      { id: 'dashboard', label: 'Executive Overview', subtitle: 'Capture & construction-cycle mortgage KPIs', kind: 'view' as const },
      { id: 'all-loans', label: 'All Loans', subtitle: 'Portfolio list', kind: 'view' as const },
      { id: 'high-risk-loans', label: 'Pipeline Risk Watchlist', subtitle: 'High fallout risk loans', kind: 'view' as const },
      { id: 'portfolio-map', label: 'Portfolio Map', subtitle: 'Geographic view', kind: 'view' as const },
      { id: 'draws', label: 'Funding & Disbursements', subtitle: 'Draw management', kind: 'view' as const },
      { id: 'respa', label: 'RESPA & Compliance', subtitle: 'Compliance monitoring', kind: 'view' as const },
      { id: 'integrations', label: 'Integrations', subtitle: 'Builder systems, LOS & data capture', kind: 'view' as const },
    ];

    return base;
  }, [onExit]);

  const loanIndex = useMemo(() => {
    return loans.map((l) => ({
      id: l.id,
      borrower: l.borrower,
      address: l.address,
      city: l.city,
      state: l.state,
      lender: l.lender,
      status: l.status,
      haystack: `${l.borrower} ${l.address} ${l.city} ${l.state} ${l.lender} ${l.status} ${l.los} ${l.loanNumber ?? ''}`.toLowerCase(),
    }));
  }, [loans]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return {
        actions: searchActions.slice(0, 6),
        loans: [] as typeof loanIndex,
        flat: [] as Array<{ kind: 'view'; id: string } | { kind: 'loan'; id: number }>,
      };
    }

    const actions = searchActions
      .filter((a) => `${a.label} ${a.subtitle ?? ''}`.toLowerCase().includes(q))
      .slice(0, 6);

    const matchedLoans = loanIndex
      .filter((l) => l.haystack.includes(q))
      .slice(0, 7);

    const flat: Array<{ kind: 'view'; id: string } | { kind: 'loan'; id: number }> = [
      ...actions.map((a) => ({ kind: 'view' as const, id: a.id })),
      ...matchedLoans.map((l) => ({ kind: 'loan' as const, id: l.id })),
    ];

    return { actions, loans: matchedLoans, flat };
  }, [loanIndex, searchActions, searchQuery]);

  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (searchWrapRef.current && !searchWrapRef.current.contains(target)) {
        setIsSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, []);

  useEffect(() => {
    setActiveSearchIndex(0);
  }, [searchQuery]);

  /** Keep Portfolio Map markers/list in sync with the header search while on that view */
  useEffect(() => {
    if (activeView === 'portfolio-map') {
      setPortfolioMapListFilter(searchQuery);
    } else {
      setPortfolioMapListFilter('');
    }
  }, [activeView, searchQuery, setPortfolioMapListFilter]);

  const runSearchSelection = (sel: { kind: 'view'; id: string } | { kind: 'loan'; id: number }) => {
    if (sel.kind === 'view' && sel.id === 'landing' && onExit) {
      onExit();
      setIsSearchOpen(false);
      setSearchQuery('');
      return;
    }
    if (sel.kind === 'view') {
      setActiveView(sel.id);
    } else {
      onSelectLoan(sel.id);
    }

    setIsSearchOpen(false);
    setSearchQuery('');
  };

  return (
    <div
      className={`min-h-screen flex bg-[var(--bg-app)]${embedded ? " relative min-h-[min(85vh,920px)]" : ""}`}
    >
      {/* Sidebar Overlay for Mobile */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className={`fixed z-40 bg-black/20 backdrop-blur-sm ${hideSidebar ? (embedded ? 'inset-x-0 bottom-0 top-16' : 'inset-0') : 'inset-0 lg:hidden'}`}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside 
        onClick={(e) => {
          // Desktop: clicking the sidebar background toggles collapse/expand.
          // Ignore clicks on interactive elements so nav/brand/actions still work.
          if (!isDesktop || hideSidebar) return;
          const target = e.target as HTMLElement | null;
          if (!target) return;
          if (target.closest('button, a, input, textarea, select, [role="button"]')) return;

          setIsSidebarCollapsed((v) => !v);
        }}
        className={`glass-panel border-r border-white/20 transition-all duration-300 z-50 overflow-hidden flex flex-col shadow-[4px_0_24px_rgba(0,0,0,0.02)] ${
          hideSidebar
            ? `fixed left-0 ${isSidebarOpen ? 'w-64 translate-x-0' : 'w-0 -translate-x-full'} ${
                embedded ? 'top-16 h-[calc(100dvh-4rem)]' : 'top-0 h-full'
              }`
            : `fixed h-full lg:relative lg:cursor-pointer ${isSidebarOpen ? 'w-64 translate-x-0' : 'w-0 -translate-x-full'} ${isSidebarCollapsed ? 'lg:w-20' : 'lg:w-64'} lg:translate-x-0`
        }`}
      >
        <div
          onClick={(e) => {
            // Desktop: clicking the header background toggles collapse/expand.
            if (!isDesktop || hideSidebar) return;
            const target = e.target as HTMLElement | null;
            if (!target) return;
            if (target.closest('button, a, input, textarea, select, [role="button"]')) return;

            setIsSidebarCollapsed((v) => !v);
          }}
          className={`relative p-4 ${isSidebarCollapsed ? 'px-3' : 'px-4'} border-b border-white/20`}
        >
          <div className={`flex items-center gap-2 ${isSidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
            {/* Brand - click toggles sidebar collapse on desktop */}
            <button
              type="button"
              onClick={() => {
                if (isDesktop) {
                  setIsSidebarCollapsed((v) => !v);
                } else {
                  setActiveView('dashboard');
                }
              }}
              className={`flex items-center gap-3 overflow-hidden text-left hover:opacity-90 transition-opacity cursor-pointer ${
                isSidebarCollapsed ? 'w-full justify-center' : 'flex-1'
              }`}
              aria-label={isDesktop ? 'Toggle sidebar' : 'Go to Dashboard'}
              title={isDesktop ? (isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar') : undefined}
            >
              <div className="w-9 h-9 btn-primary rounded-xl flex items-center justify-center text-white font-bold shadow-sm shrink-0">
                C
              </div>
              {!isSidebarCollapsed && (
                <span className="font-semibold text-lg tracking-tight text-slate-900 font-display">Cohi Builder</span>
              )}
            </button>

            {/* Mobile close */}
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-white/50 rounded-lg text-slate-600 transition-colors lg:hidden shrink-0"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <nav
          id="cohibuilder-sidebar-nav"
          className={`mt-3 ${isSidebarCollapsed ? 'px-2' : 'px-3'} flex-1 space-y-1 ${isSidebarCollapsed ? '' : 'min-w-[256px]'}`}
          aria-label="Cohi Builder"
        >
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              title={item.label}
              aria-label={item.label}
              className={`w-full flex items-center rounded-xl transition-all hover:bg-white/45 active:scale-[0.99] ${
                isSidebarCollapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'
              }`}
            >
              <div
                className={`shrink-0 rounded-xl flex items-center justify-center border border-white/50 shadow-sm backdrop-blur-sm ${
                  activeView === item.id ? item.iconActive : item.iconInactive
                } ${isSidebarCollapsed ? 'w-10 h-10' : 'w-9 h-9'}`}
              >
                <item.icon size={18} strokeWidth={activeView === item.id ? 2.75 : 2.1} />
              </div>
              <span className={`whitespace-nowrap text-sm font-medium text-slate-700 transition-opacity duration-200 ${!isSidebarOpen && 'lg:opacity-100'} ${isSidebarCollapsed ? 'lg:hidden' : ''}`}>
                {item.label}
              </span>
            </button>
          ))}

          {/* Expand control (as last icon after Integrations) */}
          {isSidebarCollapsed && (
            <button
              type="button"
              onClick={() => {
                setIsSidebarCollapsed(false);
              }}
              title="Expand sidebar"
              aria-label="Expand sidebar"
              className="hidden lg:flex w-full items-center justify-center rounded-xl transition-all hover:bg-white/45 active:scale-[0.99] px-2 py-2.5"
            >
              <div className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center border border-white/50 shadow-sm backdrop-blur-sm bg-slate-50/70 text-slate-700">
                <ChevronRight size={18} strokeWidth={2.6} />
              </div>
            </button>
          )}

          {/* Collapse control (as last item after Integrations) */}
          {!isSidebarCollapsed && (
            <button
              type="button"
              onClick={() => {
                setIsSidebarCollapsed(true);
              }}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
              className="hidden lg:flex w-full items-center rounded-xl transition-all hover:bg-white/45 active:scale-[0.99] gap-3 px-3 py-2.5 mt-2"
            >
              <div className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center border border-white/50 shadow-sm backdrop-blur-sm bg-slate-50/70 text-slate-700">
                <ChevronLeft size={18} strokeWidth={2.6} />
              </div>
              <span className="whitespace-nowrap text-sm font-medium text-slate-700">Collapse</span>
            </button>
          )}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-transparent relative z-10">
        {/* Header */}
        <header
          className={`glass-panel border-b border-white/20 flex items-center justify-between px-4 lg:px-6 sticky top-0 z-40 shadow-[0_4px_24px_rgba(0,0,0,0.02)] ${
            headerAfterSearch ? 'min-h-16 h-auto py-2' : 'h-16'
          }`}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            {!embedded && (
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className={`shrink-0 p-2 hover:bg-white/50 rounded-lg text-slate-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/35 ${hideSidebar ? '' : 'lg:hidden'}`}
              type="button"
              aria-label="Open menu"
              aria-expanded={isSidebarOpen}
              aria-controls="cohibuilder-sidebar-nav"
            >
              <Menu size={20} />
            </button>
            )}
            <div
              ref={searchWrapRef}
              className={`relative max-w-md min-w-0 flex-[0_1_18rem] sm:flex-[0_1_28rem] ${
                activeView === 'portfolio-map' ? 'block' : 'hidden sm:block'
              }`}
            >
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
              <input 
                type="text" 
                placeholder="Search portfolios, loans, or borrowers..." 
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setIsSearchOpen(true);
                }}
                onFocus={() => setIsSearchOpen(true)}
                onKeyDown={(e) => {
                  if (!isSearchOpen) return;

                  const total = searchResults.flat.length;
                  if (e.key === 'Escape') {
                    setIsSearchOpen(false);
                    return;
                  }
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActiveSearchIndex((v) => (total === 0 ? 0 : (v + 1) % total));
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActiveSearchIndex((v) => (total === 0 ? 0 : (v - 1 + total) % total));
                    return;
                  }
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const sel = searchResults.flat[activeSearchIndex];
                    if (sel) runSearchSelection(sel);
                  }
                }}
                className="w-full pl-9 pr-4 py-1.5 bg-white/50 backdrop-blur-sm border border-white/60 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-400/20 focus:border-sky-400/30 transition-all text-sm text-slate-900 placeholder:text-slate-500 shadow-sm"
              />

              {isSearchOpen && (searchQuery.trim().length > 0 || searchResults.actions.length > 0) && (
                <div
                  className="absolute left-0 right-0 mt-2 rounded-2xl overflow-hidden border border-slate-200/90 bg-white/[0.97] backdrop-blur-xl shadow-[0_18px_60px_-24px_rgba(15,23,42,0.35)]"
                  role="listbox"
                >
                  <div className="px-3 py-2 text-[11px] font-semibold text-slate-600 uppercase tracking-widest bg-slate-50/95 border-b border-slate-200/80">
                    Results
                  </div>

                  {searchResults.actions.length > 0 && (
                    <div className="px-2 py-2">
                      <div className="px-2 pb-1 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                        Quick actions
                      </div>
                      <div className="space-y-1">
                        {searchResults.actions.map((a, idx) => {
                          const flatIndex = idx;
                          const isActive = flatIndex === activeSearchIndex;
                          return (
                            <button
                              key={a.id}
                              type="button"
                              onMouseEnter={() => setActiveSearchIndex(flatIndex)}
                              onClick={() => runSearchSelection({ kind: 'view', id: a.id })}
                              className={`w-full text-left px-3 py-2 rounded-xl transition-all ${
                                isActive ? 'btn-primary text-white' : 'hover:bg-slate-100 text-slate-800'
                              }`}
                            >
                              <div className="text-sm font-semibold">{a.label}</div>
                              <div className={`text-xs ${isActive ? 'text-blue-100' : 'text-slate-500'}`}>{a.subtitle}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {searchResults.loans.length > 0 && (
                    <div className="px-2 py-2 border-t border-slate-200/80">
                      <div className="px-2 pb-1 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                        Loans & borrowers
                      </div>
                      <div className="space-y-1">
                        {searchResults.loans.map((l, idx) => {
                          const flatIndex = searchResults.actions.length + idx;
                          const isActive = flatIndex === activeSearchIndex;
                          return (
                            <button
                              key={l.id}
                              type="button"
                              onMouseEnter={() => setActiveSearchIndex(flatIndex)}
                              onClick={() => runSearchSelection({ kind: 'loan', id: l.id })}
                              className={`w-full text-left px-3 py-2 rounded-xl transition-all ${
                                isActive ? 'btn-primary text-white' : 'hover:bg-slate-100 text-slate-800'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-sm font-semibold truncate">{anonymizeBorrowerName(l.borrower)}</div>
                                <div className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                  isActive ? 'bg-white/20 text-white' : 'bg-slate-900/5 text-slate-700'
                                }`}>
                                  {l.status}
                                </div>
                              </div>
                              <div className={`text-xs truncate ${isActive ? 'text-blue-100' : 'text-slate-500'}`}>
                                {l.city}, {l.state} · LO {displayLoanOfficer(l)} ·{' '}
                                {resolvedPrimaryLenderLabel(l.lender, l.isPreferred, l.builderImportRow)}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {searchQuery.trim().length > 0 && searchResults.actions.length === 0 && searchResults.loans.length === 0 && (
                    <div className="px-4 py-6 text-sm text-slate-600">
                      No matches for <span className="font-semibold text-slate-900">“{searchQuery.trim()}”</span>.
                    </div>
                  )}
                </div>
              )}
            </div>
            {headerAfterSearch ? (
              <div className="min-w-0 flex-1 flex justify-end items-center overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {headerAfterSearch}
              </div>
            ) : null}
          </div>
          
          <div className={`flex shrink-0 items-center gap-2 ${embedded ? "hidden" : ""}`}>
            <a
              href="https://coheus.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-2 sm:px-3 py-1.5 text-slate-700 bg-white/50 backdrop-blur-sm hover:bg-white/80 rounded-lg transition-all border border-white/60 shadow-sm text-sm font-medium"
              title="Coheus.com"
            >
              <span className="hidden sm:inline">Coheus.com</span>
              <span className="sm:hidden">Coheus</span>
            </a>
            {/* Home */}
            <button
              onClick={() => (onExit ? onExit() : setActiveView('landing'))}
              className="flex items-center gap-2 px-2 sm:px-3 py-1.5 text-slate-700 bg-white/50 backdrop-blur-sm hover:bg-white/80 rounded-lg transition-all border border-white/60 shadow-sm"
              title="Home"
            >
              <Home size={16} />
              <span className="text-sm font-medium hidden sm:inline">Home</span>
            </button>

            {/* PWA Install Button */}
            {deferredPrompt && (
              <button 
                onClick={handleInstallClick}
                className="flex items-center gap-2 px-2 sm:px-3 py-1.5 text-slate-700 bg-white/50 backdrop-blur-sm hover:bg-white/80 rounded-lg transition-all border border-white/60 mr-1 shadow-sm"
                title="Install App"
              >
                <Download size={16} />
                <span className="text-sm font-medium text-nowrap hidden xs:inline">Install</span>
              </button>
            )}

            {/* AI Assistant Toggle */}
            <button 
              onClick={() => setIsAssistantOpen(true)}
              className="px-3 py-1.5 text-sm font-medium text-white btn-primary rounded-lg transition-all flex items-center gap-2 ml-1 shadow-sm"
            >
              <Mic size={16} />
              <span className="text-sm font-medium hidden sm:inline">Ask Cohi</span>
            </button>

            <div className="h-6 w-px bg-white/60 mx-2"></div>
            
            <div className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium text-slate-900 leading-none">Joe Smith</p>
                <p className="text-xs text-slate-600 mt-1">CEO</p>
              </div>
              <img 
                src="https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&q=80&w=256&h=256" 
                alt="Joe Smith" 
                className="w-8 h-8 rounded-full border-2 border-white/80 shadow-sm object-cover shrink-0"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        </header>

        {/* Content Area — map view needs a non-scrolling flex chain so Leaflet gets a real height */}
        <div
          className={
            activeView === 'portfolio-map'
              ? 'flex-1 min-h-0 flex flex-col overflow-hidden'
              : 'flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6'
          }
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={activeView}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className={
                activeView === 'portfolio-map'
                  ? 'flex-1 min-h-0 flex flex-col h-full overflow-hidden'
                  : undefined
              }
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* AI Assistant Overlay */}
      <TollAssistant isOpen={isAssistantOpen} onClose={() => setIsAssistantOpen(false)} />
    </div>
  );
}
