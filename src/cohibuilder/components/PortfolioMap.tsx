import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import { useVirtualizer } from '@tanstack/react-virtual';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronLeft,
  MapPin,
  Filter,
  TrendingUp,
  Maximize2,
  X,
} from 'lucide-react';
import { useCohiBuilderPortfolio } from '../contexts/CohiBuilderPortfolioContext';
import { usePortfolioMapSearch } from '../contexts/PortfolioMapSearchContext';
import { findLoanForNavId } from '../lib/resolveLoanNav';
import type { CohiPortfolioLoan } from '../data/portfolioFromBuilderImport';
import { anonymizeBorrowerName, displayLoanOfficer } from '../lib/borrowerPrivacy';
import Tooltip, { type TooltipBubbleVariant } from './Tooltip';

interface PortfolioMapProps {
  onLoanClick: (id: number) => void;
  onBack: () => void;
  selectedLoanId: number | null;
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

function riskScoreTooltipVariant(loan: CohiPortfolioLoan): TooltipBubbleVariant {
  if (loan.riskLevel === 'High') return 'rose';
  if (loan.riskLevel === 'Medium') return 'amber';
  return 'emerald';
}

function riskScoreTooltipText(loan: CohiPortfolioLoan): string {
  const tier =
    loan.riskLevel === 'High'
      ? 'High tier'
      : loan.riskLevel === 'Medium'
        ? 'Medium tier'
        : 'Lower tier';
  return `Risk score: ${loan.riskScore}\n\n${tier} on the demo qualification model (${loan.riskLevel} risk). Use as a relative signal alongside conditions, docs, and lock timing—not a bureau score.`;
}

function markerColor(loan: CohiPortfolioLoan) {
  if (loan.isNonQM) return '#8b5cf6';
  if (loan.riskLevel === 'High') return '#ef4444';
  return '#3b82f6';
}

const LIST_ROW_PX = 100;

function makeLoanMarkerIcon(loan: CohiPortfolioLoan, selected: boolean): L.DivIcon {
  const c = markerColor(loan);
  const w = selected ? 32 : 26;
  const h = selected ? 40 : 32;
  const halo = selected
    ? `<circle cx="14" cy="11.5" r="11.5" fill="none" stroke="${c}" stroke-opacity="0.4" stroke-width="2"/>`
    : '';
  const html = `<svg width="${w}" height="${h}" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible">
    ${halo}
    <path fill="${c}" stroke="#fff" stroke-width="${selected ? 2.25 : 2}" d="M14 1.5c-5.8 0-10.5 4.5-10.5 10.1 0 4.4 5.2 11.8 9.6 18.4.3.5.9.8 1.5.8h.1c.6 0 1.2-.3 1.5-.8 4.4-6.6 9.6-14 9.6-18.4C24.5 6 19.8 1.5 14 1.5z" style="filter:drop-shadow(0 2px 4px rgba(15,23,42,.35))"/>
    <circle cx="14" cy="11.5" r="${selected ? 3.2 : 2.6}" fill="#fff" fill-opacity="0.92"/>
  </svg>`;
  return L.divIcon({
    className: 'cohi-portfolio-marker',
    html,
    iconSize: [w, h],
    iconAnchor: [w / 2, h - 1],
    popupAnchor: [0, -h + 6],
  });
}

const PortfolioLoanMarker = React.memo(function PortfolioLoanMarker({
  loan,
  selected,
  onSelect,
}: {
  loan: CohiPortfolioLoan;
  selected: boolean;
  onSelect: (l: CohiPortfolioLoan) => void;
}) {
  const icon = useMemo(
    () => makeLoanMarkerIcon(loan, selected),
    [loan.id, loan.lat, loan.lng, loan.isNonQM, loan.riskLevel, selected],
  );
  return (
    <Marker
      position={[loan.lat, loan.lng]}
      icon={icon}
      eventHandlers={{ click: () => onSelect(loan) }}
    />
  );
});

// Tile layer URLs
const TILES = {
  roadmap: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics',
  },
  hybrid: {
    base: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    labels: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics',
  },
};

// ─── Pan/zoom controller ────────────────────────────────────────────────────
function MapController({ selectedLoan }: { selectedLoan: CohiPortfolioLoan | null }) {
  const map = useMap();
  useEffect(() => {
    if (selectedLoan && typeof selectedLoan.lat === 'number' && typeof selectedLoan.lng === 'number') {
      const z = Math.max(map.getZoom(), 12);
      map.flyTo([selectedLoan.lat, selectedLoan.lng], z, { duration: 0.55 });
    }
  }, [map, selectedLoan]);
  return null;
}

/** Leaflet needs a size refresh when the flex sidebar opens/closes or the embed layout settles */
function MapInvalidateSize({ revision }: { revision: string | number }) {
  const map = useMap();
  useEffect(() => {
    const run = () => {
      requestAnimationFrame(() => map.invalidateSize({ animate: true }));
    };
    run();
    const t = window.setTimeout(run, 100);
    const t2 = window.setTimeout(run, 400);
    window.addEventListener('resize', run);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(t2);
      window.removeEventListener('resize', run);
    };
  }, [map, revision]);
  return null;
}

/** Fit the map to markers after layout / data changes (single point uses setView). */
function MapFitLoansBounds({
  loans,
  boundsRevision,
}: {
  loans: CohiPortfolioLoan[];
  boundsRevision: string;
}) {
  const map = useMap();
  const loansRef = useRef(loans);
  loansRef.current = loans;
  useEffect(() => {
    const list = loansRef.current;
    const apply = () => {
      if (list.length === 0) {
        map.setView([39.8283, -98.5795], 4);
        map.invalidateSize();
        return;
      }
      if (list.length === 1) {
        const l = list[0]!;
        map.setView([l.lat, l.lng], 9);
        map.invalidateSize();
        return;
      }
      const bounds = L.latLngBounds(list.map((l) => [l.lat, l.lng] as L.LatLngTuple));
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [52, 52], maxZoom: 10, animate: false });
      }
      map.invalidateSize();
    };
    requestAnimationFrame(apply);
    const t = window.setTimeout(apply, 120);
    return () => window.clearTimeout(t);
  }, [map, boundsRevision]);
  return null;
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function PortfolioMap({ onLoanClick, onBack, selectedLoanId }: PortfolioMapProps) {
  const { allLoans: loans } = useCohiBuilderPortfolio();
  const { listFilter: headerMapFilter } = usePortfolioMapSearch();
  const [filterState, setFilterState] = useState<string | null>(null);
  const [selectedLoan, setSelectedLoan] = useState<CohiPortfolioLoan | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  /** Hybrid (imagery + labels) as default; Street uses OSM for strict networks. */
  const [mapType, setMapType] = useState<'roadmap' | 'satellite' | 'hybrid'>('hybrid');

  /** Deep link / URL loan selection only — do not clear map pick when `loanId` is absent (import refresh would wipe it). */
  useEffect(() => {
    if (selectedLoanId == null) return;
    const fromRoute = findLoanForNavId(loans, selectedLoanId);
    if (fromRoute) setSelectedLoan(fromRoute);
  }, [loans, selectedLoanId]);

  const filteredLoans = useMemo(() => loans.filter((loan) => {
    const q = headerMapFilter.trim().toLowerCase();
    const num = loan.loanNumber?.trim().toLowerCase() ?? '';
    const matchSearch =
      !q ||
      loan.borrower.toLowerCase().includes(q) ||
      loan.address.toLowerCase().includes(q) ||
      loan.city.toLowerCase().includes(q) ||
      (num && num.includes(q));
    const matchState = !filterState || loan.state === filterState;
    return matchSearch && matchState;
  }), [headerMapFilter, filterState, loans]);

  const validLoans = useMemo(() =>
    filteredLoans.filter(l => typeof l.lat === 'number' && typeof l.lng === 'number' && !isNaN(l.lat) && !isNaN(l.lng)),
    [filteredLoans]);

  const mapBoundsRevision = useMemo(
    () => validLoans.map((l) => `${l.id}:${l.lat.toFixed(5)},${l.lng.toFixed(5)}`).join('|'),
    [validLoans],
  );

  const states = useMemo(() =>
    Array.from(new Set(loans.map(l => l.state))).sort(), []);

  const selectLoan = useCallback((loan: CohiPortfolioLoan) => {
    setSelectedLoan(loan);
  }, []);

  const listParentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filteredLoans.length,
    getScrollElement: () => listParentRef.current,
    estimateSize: () => LIST_ROW_PX,
    overscan: 12,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const selectedListIndex = useMemo(
    () => (selectedLoan ? filteredLoans.findIndex((l) => l.id === selectedLoan.id) : -1),
    [selectedLoan, filteredLoans],
  );

  useEffect(() => {
    if (selectedListIndex < 0 || !listParentRef.current) return;
    const id = window.requestAnimationFrame(() => {
      virtualizer.scrollToIndex(selectedListIndex, { align: 'center' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [selectedListIndex, selectedLoan?.id, virtualizer]);

  return (
    <div className="h-full min-h-0 flex flex-col bg-[var(--bg-app)] overflow-hidden">

      {/* Header */}
      <header className="bg-white border-b border-[var(--border-subtle)] px-6 py-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <ChevronLeft className="w-6 h-6 text-slate-500" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-[var(--text-primary)]">National Portfolio Map</h1>
            <p className="text-xs text-[var(--text-secondary)] font-medium">Geographic Risk Analytics</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <p className="hidden lg:block text-[11px] text-[var(--text-secondary)] font-medium max-w-[14rem] leading-snug">
            Filter markers and the list with the header search (same as Executive Overview).
          </p>

          <div className="flex items-center bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-1 gap-0.5">
            {(['All', ...states.slice(0, 4)] as string[]).map(s => (
              <button
                key={s}
                onClick={() => setFilterState(s === 'All' ? null : s)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  (s === 'All' && !filterState) || filterState === s
                    ? 'bg-white shadow text-[var(--text-primary)]'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {s}
              </button>
            ))}
            {states.length > 4 && (
              <select
                value={filterState || ''}
                onChange={e => setFilterState(e.target.value || null)}
                className="bg-transparent text-xs font-semibold text-slate-500 px-2 outline-none border-none cursor-pointer"
              >
                <option value="">More…</option>
                {states.slice(4).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 flex relative overflow-hidden">

        {/* Sidebar */}
        <AnimatePresence>
          {isSidebarOpen && (
            <motion.aside
              initial={{ x: -320 }} animate={{ x: 0 }} exit={{ x: -320 }}
              transition={{ type: 'tween', duration: 0.2 }}
              className="absolute md:relative z-20 w-80 h-full bg-[var(--bg-surface)] border-r border-[var(--border-subtle)] flex flex-col shadow-xl md:shadow-none"
            >
              <div className="p-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
                <h2 className="font-bold text-[var(--text-primary)] flex items-center gap-2">
                  <Filter className="w-4 h-4 text-blue-600" /> Portfolio List
                </h2>
                <Tooltip
                  variant="sky"
                  text="Loans in this list\n\nCount after the Executive Overview header search and any state chip filter. Only loans with valid coordinates are plotted on the map."
                >
                  <span
                    tabIndex={0}
                    className="cursor-help text-[10px] font-bold bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full uppercase outline-none focus-visible:ring-2 focus-visible:ring-sky-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] dark:bg-sky-950/50 dark:text-sky-300 dark:focus-visible:ring-offset-slate-900"
                  >
                    {filteredLoans.length} Loans
                  </span>
                </Tooltip>
              </div>

              <div
                ref={listParentRef}
                className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2"
                style={{ contain: 'strict' }}
              >
                <div
                  className="relative w-full"
                  style={{ height: virtualizer.getTotalSize() }}
                >
                  {virtualizer.getVirtualItems().map((vi) => {
                    const loan = filteredLoans[vi.index];
                    if (!loan) return null;
                    return (
                      <div
                        key={loan.id}
                        ref={virtualizer.measureElement}
                        data-index={vi.index}
                        className="absolute left-0 top-0 w-full px-0"
                        style={{ transform: `translateY(${vi.start}px)` }}
                      >
                        <button
                          type="button"
                          onClick={() => selectLoan(loan)}
                          className={`mb-1 w-full text-left rounded-xl border p-3 transition-all ${
                            selectedLoan?.id === loan.id
                              ? 'border-blue-300/80 bg-gradient-to-br from-blue-50 to-indigo-50/80 shadow-sm ring-1 ring-blue-200/60 dark:border-blue-700/50 dark:from-blue-950/40 dark:to-slate-900/40 dark:ring-blue-800/40'
                              : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/50'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className="h-3 w-3 shrink-0 rounded-full ring-2 ring-white shadow-sm dark:ring-slate-800"
                              style={{ background: markerColor(loan) }}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-sm font-bold text-[var(--text-primary)]">
                                  {anonymizeBorrowerName(loan.borrower)}
                                </p>
                                <Tooltip variant={riskScoreTooltipVariant(loan)} text={riskScoreTooltipText(loan)}>
                                  <span
                                    tabIndex={0}
                                    className={`ml-1 shrink-0 cursor-help rounded px-1.5 py-0.5 text-[10px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-sky-500/40 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900 ${
                                      loan.riskLevel === 'High'
                                        ? 'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400'
                                        : loan.riskLevel === 'Medium'
                                          ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                                          : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                                    }`}
                                  >
                                    {loan.riskScore}
                                  </span>
                                </Tooltip>
                              </div>
                              <p className="truncate text-[11px] text-[var(--text-secondary)]">
                                {loan.city}, {loan.state}
                              </p>
                              <p className="truncate text-[10px] text-[var(--text-secondary)]">
                                LO {displayLoanOfficer(loan)}
                              </p>
                              <p className="text-xs font-semibold text-[var(--text-primary)]">
                                {formatCurrency(loan.loanAmount)}
                              </p>
                            </div>
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Sidebar toggle */}
        <button
          onClick={() => setIsSidebarOpen(v => !v)}
          className="absolute z-30 bg-white border border-[var(--border-subtle)] p-1 rounded-r-lg shadow hover:bg-slate-50 transition-colors"
          style={{ left: isSidebarOpen ? 320 : 0, top: '50%', transform: 'translateY(-50%)' }}
        >
          <ChevronLeft className={`w-4 h-4 text-slate-500 transition-transform ${isSidebarOpen ? '' : 'rotate-180'}`} />
        </button>

        {/* Map: isolate + min-h-0 so flex child gets height; UI layer stacks above Leaflet panes */}
        <div
          className="flex-1 relative isolate z-0 min-h-0 min-w-0 [&_.leaflet-container]:bg-slate-200/80 dark:[&_.leaflet-container]:bg-slate-900 [&_.cohi-portfolio-marker]:!border-none [&_.cohi-portfolio-marker]:!bg-transparent"
        >
          <MapContainer
            center={[39.8283, -98.5795]}
            zoom={4}
            className="cohi-portfolio-leaflet z-0 h-full min-h-[280px] w-full rounded-none [&_.leaflet-control-zoom]:rounded-xl [&_.leaflet-control-zoom]:border-[var(--border-subtle)] [&_.leaflet-control-zoom_a]:rounded-lg"
            style={{ width: '100%', height: '100%' }}
            zoomControl={true}
            scrollWheelZoom
          >
            {/* Tile layer */}
            {mapType === 'roadmap' && (
              <TileLayer url={TILES.roadmap.url} attribution={TILES.roadmap.attribution} />
            )}
            {mapType === 'satellite' && (
              <TileLayer url={TILES.satellite.url} attribution={TILES.satellite.attribution} />
            )}
            {mapType === 'hybrid' && (
              <>
                <TileLayer url={TILES.hybrid.base} attribution={TILES.hybrid.attribution} />
                <TileLayer url={TILES.hybrid.labels} zIndex={650} />
              </>
            )}

            {validLoans.map((loan) => (
              <PortfolioLoanMarker
                key={loan.id}
                loan={loan}
                selected={selectedLoan?.id === loan.id}
                onSelect={selectLoan}
              />
            ))}

            <MapFitLoansBounds loans={validLoans} boundsRevision={mapBoundsRevision} />
            <MapInvalidateSize revision={`${isSidebarOpen}-${loans.length}-${mapType}-${mapBoundsRevision.slice(0, 80)}`} />
            <MapController selectedLoan={selectedLoan} />
          </MapContainer>

          {/* Map UI: z above Leaflet panes; pointer-events-none on shell so map drag still works */}
          <div className="pointer-events-none absolute inset-0 z-[1100]">
            {/* Map type switcher */}
            <div className="pointer-events-auto absolute right-3 top-3 z-[1] sm:right-4 sm:top-4">
              <div className="flex gap-0.5 rounded-xl border border-[var(--border-subtle)] bg-white/95 p-1 shadow-lg backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/90">
                {(['roadmap', 'satellite', 'hybrid'] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setMapType(t)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                      mapType === t
                        ? 'bg-slate-900 text-white shadow-sm dark:bg-blue-600 dark:text-white'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    {t === 'roadmap' ? 'Street' : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Stats: lift when preview card is open on smaller map widths to reduce overlap */}
            <div
              className={`pointer-events-auto absolute z-[1] right-[calc(0.75rem+2in)] sm:right-[calc(1.5rem+2in)] ${
                selectedLoan
                  ? 'max-lg:bottom-[calc(19rem+3in)] lg:bottom-[calc(3in+max(1rem,env(safe-area-inset-bottom)))]'
                  : 'bottom-[calc(3in+max(1rem,env(safe-area-inset-bottom)))]'
              }`}
            >
              <div className="min-w-[180px] rounded-2xl border border-[var(--border-subtle)] bg-white/95 p-4 shadow-lg backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/90">
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
                    <TrendingUp className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase text-[var(--text-secondary)]">Portfolio</p>
                    <p className="text-base font-bold text-[var(--text-primary)]">
                      {formatCurrency(filteredLoans.reduce((s, l) => s + l.loanAmount, 0))}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 border-t border-[var(--border-subtle)] pt-3">
                  <div>
                    <p className="text-[9px] font-bold uppercase text-[var(--text-secondary)]">Loans</p>
                    <p className="text-sm font-bold text-[var(--text-primary)]">{filteredLoans.length}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold uppercase text-[var(--text-secondary)]">Non-QM</p>
                    <p className="text-sm font-bold text-[var(--text-primary)]">
                      {filteredLoans.length
                        ? Math.round((filteredLoans.filter(l => l.isNonQM).length / filteredLoans.length) * 100)
                        : 0}%
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Preview: center with flex — never combine motion translateY with translate-x-1/2 on same node */}
            <AnimatePresence mode="wait">
              {selectedLoan && (
                <div
                  key={selectedLoan.id}
                  className="pointer-events-none absolute inset-x-0 bottom-[calc(3in+max(1rem,env(safe-area-inset-bottom)))] z-[2] flex justify-center px-3 sm:px-4"
                >
                  <div className="pointer-events-auto w-full max-w-sm -translate-x-[2in]">
                    <motion.div
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 12 }}
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-white/95 shadow-[0_12px_48px_-12px_rgba(15,23,42,0.35)] ring-1 ring-black/[0.04] backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/95 dark:ring-white/[0.06]"
                    >
                      <div className="relative">
                        <img
                          src={selectedLoan.propertyImage}
                          alt={selectedLoan.address}
                          className="h-36 w-full object-cover"
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                        />
                        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
                        <div className="absolute bottom-3 left-3 right-12">
                          <p className="line-clamp-2 text-sm font-semibold leading-snug text-white drop-shadow-md">
                            {selectedLoan.address}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedLoan(null)}
                          className="absolute right-3 top-3 rounded-full bg-black/40 p-1.5 text-white backdrop-blur-sm transition-colors hover:bg-black/55"
                          aria-label="Close preview"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="space-y-3 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-base font-bold leading-snug tracking-tight text-[var(--text-primary)]">
                            {anonymizeBorrowerName(selectedLoan.borrower)}
                          </h3>
                          {selectedLoan.isNonQM && (
                            <span className="shrink-0 rounded-md bg-violet-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-800 dark:bg-violet-950/60 dark:text-violet-300">
                              Non-QM
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] font-medium text-[var(--text-secondary)]">
                          LO {displayLoanOfficer(selectedLoan)}
                        </p>
                        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
                          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
                          <span>{selectedLoan.city}, {selectedLoan.state}</span>
                        </p>
                        <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50/90 p-3 dark:bg-slate-800/50">
                          <div>
                            <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                              Loan amount
                            </p>
                            <p className="text-sm font-bold tabular-nums text-[var(--text-primary)]">
                              {formatCurrency(selectedLoan.loanAmount)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                              Risk score
                            </p>
                            <p
                              className={`text-sm font-bold tabular-nums ${
                                selectedLoan.riskLevel === 'High'
                                  ? 'text-red-600 dark:text-red-400'
                                  : selectedLoan.riskLevel === 'Medium'
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-emerald-600 dark:text-emerald-400'
                              }`}
                            >
                              {selectedLoan.riskScore}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onLoanClick(selectedLoan.id)}
                          className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white shadow-md transition-colors hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500"
                        >
                          <Maximize2 className="h-3.5 w-3.5" /> View full details
                        </button>
                      </div>
                    </motion.div>
                  </div>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
