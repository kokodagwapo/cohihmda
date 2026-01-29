import React, { useState, useMemo, useEffect, memo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { LoanRiskDistribution } from './LoanRiskDistribution';
import { LoanOfficerModal } from './LoanOfficerModal';
import { LoanDrilldownModal } from './LoanDrilldownModal';

interface RiskSummary {
  risks: string[];
  positives: string[];
  overallRisk: string;
  predictedOutcome: 'originate' | 'withdraw' | 'deny' | 'at_risk';
  confidence: number;
}

interface LoanCard {
  id: string;
  officer: string;
  amount: string;
  amountValue?: number;
  riskLevel: string;
  riskScore: number;
  reason: string;
  ficoScore: number | null;
  ltvRatio: number | null;
  dtiRatio: number | null;
  loanType?: string | null;
  // Milestone and time in motion
  currentMilestone?: string | null;
  activeDays?: number | null;
  // Rates and market
  interestRate?: number | null;
  marketRate?: number | null;
  marketChangeDelta?: number | null;
  // Pullthrough percentages
  loPullthroughPct?: number | null;
  uwPullthroughPct?: number | null;
  closerPullthroughPct?: number | null;
  processorPullthroughPct?: number | null;
  // Rule-based risk summary from backend
  riskSummary?: RiskSummary | null;
  // Composite bucket scores from prediction
  creditMetricsSignalStrength?: number | null;
  loanCharacteristicsSignalStrength?: number | null;
  timeInMotionSignalStrength?: number | null;
  mloAeFalloutProneSignalStrength?: number | null;
  interestLockVsMarketSignalStrength?: number | null;
  uwPullthroughSignalStrength?: number | null;
  closerPullthroughSignalStrength?: number | null;
  processorPullthroughSignalStrength?: number | null;
  // Individual signal buckets
  ficoScoreSignal?: number | null;
  ltvSignal?: number | null;
  dtiSignal?: number | null;
  loPullthroughSignal?: number | null;
  marketChangeDeltaSignal?: number | null;
}

interface LoanPrediction {
  loanId: string;
  predictedOutcome: 'withdraw' | 'deny' | 'originate';
  confidence: number;
  reasoning?: string;
  riskFactors?: string[];
}

interface LoanCardsContainerProps {
  loans: LoanCard[];
  predictions?: LoanPrediction[]; // Optional predictions map
  isDarkMode?: boolean;
}

type TabType = 'all' | 'likely-withdraw' | 'likely-decline';
type SortType = 'risk' | 'amount' | 'loan' | 'officer';

const ITEMS_PER_PAGE = 6;
// PERFORMANCE: Threshold for switching to virtualized rendering
const VIRTUALIZATION_THRESHOLD = 20;

// PERFORMANCE: Memoized loan card component to prevent unnecessary re-renders
const LoanCardItem = memo(({ 
  loan, 
  isDarkMode, 
  onSelectLoan, 
  onSelectOfficer 
}: { 
  loan: LoanCard; 
  isDarkMode: boolean; 
  onSelectLoan: (loan: LoanCard) => void;
  onSelectOfficer: (officer: string) => void;
}) => (
  <div
    onClick={() => onSelectLoan(loan)}
    className={`group p-3 sm:p-4 lg:p-5 rounded-lg sm:rounded-xl overflow-hidden active:scale-[0.99] transition-all cursor-pointer ${isDarkMode ? 'bg-slate-800/40 hover:bg-slate-800/60 shadow-[0_1px_3px_rgba(0,0,0,0.15)]' : 'bg-white shadow-[0_1px_4px_rgba(0,0,0,0.04)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]'}`}
  >
    <div className="flex items-start justify-between gap-3 mb-2 sm:mb-3">
      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
        <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isDarkMode ? 'bg-slate-700/60' : 'bg-slate-100'}`}>
          <svg className={`w-4 h-4 ${isDarkMode ? 'text-slate-400' : 'text-slate-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className={`font-medium text-[13px] sm:text-sm tracking-tight truncate ${isDarkMode ? 'text-slate-100' : 'text-slate-800'}`}>
            Loan #{loan.id.length > 12 ? loan.id.substring(0, 12) + '...' : loan.id}
          </p>
          <button
            onClick={(e) => { e.stopPropagation(); onSelectOfficer(loan.officer); }}
            className={`text-[10px] sm:text-[11px] font-medium flex items-center gap-1 hover:underline ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}
          >
            <svg className="w-3 h-3 flex-shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className="truncate max-w-[100px] sm:max-w-none">{loan.officer || 'Unknown LO'}</span>
          </button>
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <p className={`font-semibold text-sm sm:text-base tracking-tight ${isDarkMode ? 'text-slate-100' : 'text-slate-800'}`}>{loan.amount}</p>
        <div className="flex flex-col items-end gap-0.5 mt-0.5">
          {loan.riskSummary?.predictedOutcome && loan.riskSummary.predictedOutcome !== 'originate' && (
            <span className={`text-[8px] sm:text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${
              loan.riskSummary.predictedOutcome === 'deny'
                ? (isDarkMode ? 'bg-red-600/30 text-red-300' : 'bg-red-100 text-red-700')
                : loan.riskSummary.predictedOutcome === 'withdraw'
                  ? (isDarkMode ? 'bg-orange-500/30 text-orange-300' : 'bg-orange-100 text-orange-700')
                  : (isDarkMode ? 'bg-amber-500/30 text-amber-300' : 'bg-amber-100 text-amber-700')
            }`}>
              {loan.riskSummary.predictedOutcome === 'deny' ? '⚠ Likely Decline' : 
               loan.riskSummary.predictedOutcome === 'withdraw' ? '↩ Likely Withdraw' : 
               '⚡ At Risk'}
            </span>
          )}
          <span className={`text-[9px] sm:text-[10px] font-medium px-1.5 sm:px-2 py-0.5 rounded inline-block ${
            loan.riskLevel === 'Very High' 
              ? (isDarkMode ? 'bg-rose-500/20 text-rose-400' : 'bg-rose-50 text-rose-600')
              : loan.riskLevel === 'Medium' 
                ? (isDarkMode ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-50 text-amber-600')
                : (isDarkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-50 text-emerald-600')
          }`}>
            {loan.riskLevel === 'Very High' ? 'CRITICAL' : loan.riskLevel === 'Medium' ? 'AT RISK' : 'LOW'}
          </span>
        </div>
      </div>
    </div>
    <div className="flex items-center justify-between text-[11px] sm:text-[12px] mb-2">
      <div className={`flex items-center gap-1.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${
          loan.riskLevel === 'Very High' ? 'bg-rose-500' : loan.riskLevel === 'Medium' ? 'bg-amber-500' : 'bg-emerald-500'
        }`}></span>
        <span className="font-medium">Risk Score: {loan.riskScore}/100</span>
      </div>
    </div>
    <p className={`text-[11px] sm:text-[12px] leading-relaxed line-clamp-2 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>{loan.reason}</p>
    <LoanRiskDistribution
      ficoScore={loan.ficoScore}
      ltvRatio={loan.ltvRatio}
      dtiRatio={loan.dtiRatio}
      isDarkMode={isDarkMode}
    />
    <div className={`mt-2.5 sm:mt-3 pt-2.5 sm:pt-3 border-t flex items-center justify-between ${isDarkMode ? 'border-slate-700/50' : 'border-slate-100'}`}>
      <span className={`text-[9px] sm:text-[10px] ${isDarkMode ? 'text-slate-600' : 'text-slate-400'}`}>
        Tap for details
      </span>
      <svg className={`w-4 h-4 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </div>
  </div>
));

LoanCardItem.displayName = 'LoanCardItem';

export const LoanCardsContainer: React.FC<LoanCardsContainerProps> = memo(({
  loans,
  predictions = [],
  isDarkMode = false
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<SortType>('risk');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedOfficer, setSelectedOfficer] = useState<string | null>(null);
  const [selectedLoan, setSelectedLoan] = useState<LoanCard | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [showAll, setShowAll] = useState(false);
  
  // PERFORMANCE: Ref for virtualized scrolling container
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCurrentPage(1);
    setShowAll(false); // Reset to paginated view when filters change
  }, [activeTab, searchTerm, sortBy, sortOrder]);

  // Create prediction map for filtering
  const predictionMap = useMemo(() => {
    const map = new Map<string, LoanPrediction>();
    predictions.forEach(pred => map.set(pred.loanId, pred));
    return map;
  }, [predictions]);

  const filteredLoans = useMemo(() => {
    let result = [...loans];

    if (activeTab !== 'all') {
      result = result.filter(loan => {
        switch (activeTab) {
          case 'likely-withdraw':
            // Check riskSummary first (from bucketed data)
            if (loan.riskSummary?.predictedOutcome === 'withdraw') return true;
            // Fall back to predictions array
            return predictionMap.get(loan.id)?.predictedOutcome === 'withdraw';
          case 'likely-decline':
            // Check riskSummary first (from bucketed data)
            if (loan.riskSummary?.predictedOutcome === 'deny') return true;
            // Fall back to predictions array
            return predictionMap.get(loan.id)?.predictedOutcome === 'deny';
          case 'critical': return loan.riskLevel === 'Very High';
          case 'at-risk': return loan.riskLevel === 'Medium';
          case 'low': return loan.riskLevel === 'Low';
          default: return true;
        }
      });
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(loan =>
        loan.id.toLowerCase().includes(term) ||
        loan.officer.toLowerCase().includes(term)
      );
    }

    const parseAmount = (amount: string): number => {
      const cleaned = amount.replace(/[$,]/g, '');
      if (cleaned.endsWith('M')) {
        return parseFloat(cleaned.replace('M', '')) * 1000000;
      } else if (cleaned.endsWith('K')) {
        return parseFloat(cleaned.replace('K', '')) * 1000;
      }
      return parseFloat(cleaned) || 0;
    };

    result.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'risk':
          comparison = ((b.riskScore ?? 0) - (a.riskScore ?? 0));
          break;
        case 'amount':
          const aVal = a.amountValue || parseAmount(a.amount);
          const bVal = b.amountValue || parseAmount(b.amount);
          comparison = bVal - aVal;
          break;
        case 'loan':
          comparison = a.id.localeCompare(b.id);
          break;
        case 'officer':
          comparison = a.officer.localeCompare(b.officer);
          break;
      }
      return sortOrder === 'asc' ? -comparison : comparison;
    });

    return result;
  }, [loans, activeTab, searchTerm, sortBy, sortOrder]);

  const totalPages = Math.ceil(filteredLoans.length / ITEMS_PER_PAGE);
  const paginatedLoans = useMemo(() => {
    if (showAll) return filteredLoans; // Return all when showing all
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredLoans.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredLoans, currentPage, showAll]);

  // PERFORMANCE: Use virtualization when showing all items and count exceeds threshold
  const useVirtualization = showAll && filteredLoans.length > VIRTUALIZATION_THRESHOLD;
  
  // Virtualizer for grid layout (2 columns on lg, 1 on smaller)
  // Each row contains 2 cards on desktop, 1 on mobile
  const rowCount = useVirtualization ? Math.ceil(filteredLoans.length / 2) : 0;
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 220, // Estimated height of a loan card row
    overscan: 3, // Render 3 extra rows above/below viewport
    enabled: useVirtualization,
  });

  const tabCounts = useMemo(() => {
    // Use riskSummary.predictedOutcome on each loan (primary source)
    // Fall back to predictions array if riskSummary is not available
    const predictionMapForCounts = new Map<string, LoanPrediction>();
    predictions.forEach(pred => {
      predictionMapForCounts.set(pred.loanId, pred);
    });
    
    return {
      all: loans.length,
      'likely-withdraw': loans.filter(l => {
        // Check riskSummary first (from bucketed data)
        if (l.riskSummary?.predictedOutcome === 'withdraw') return true;
        // Fall back to predictions array
        const pred = predictionMapForCounts.get(l.id);
        return pred?.predictedOutcome === 'withdraw';
      }).length,
      'likely-decline': loans.filter(l => {
        // Check riskSummary first (from bucketed data)
        if (l.riskSummary?.predictedOutcome === 'deny') return true;
        // Fall back to predictions array
        const pred = predictionMapForCounts.get(l.id);
        return pred?.predictedOutcome === 'deny';
      }).length
    };
  }, [loans, predictions]);

  const tabs: { id: TabType; label: string; shortLabel: string; color: string }[] = [
    { id: 'all', label: 'All Loans', shortLabel: 'All', color: 'darkred' },
    { id: 'likely-withdraw', label: 'Likely Withdrawal', shortLabel: 'Withdraw', color: 'red' },
    { id: 'likely-decline', label: 'Likely Decline', shortLabel: 'Decline', color: 'lightred' }
  ];

  const getTabStyle = (tab: typeof tabs[0]) => {
    const isActive = activeTab === tab.id;
    const baseStyle = isDarkMode ? 'bg-slate-800 border border-slate-700' : 'bg-slate-100 border border-slate-200';
    const colors: Record<string, { active: string; inactive: string }> = {
      darkred: {
        active: isDarkMode ? 'bg-rose-900 text-white' : 'bg-rose-800 text-white',
        inactive: isDarkMode ? `${baseStyle} text-slate-400` : `${baseStyle} text-slate-600`
      },
      red: {
        active: isDarkMode ? 'bg-rose-600 text-white' : 'bg-rose-600 text-white',
        inactive: isDarkMode ? `${baseStyle} text-slate-400` : `${baseStyle} text-slate-600`
      },
      lightred: {
        active: isDarkMode ? 'bg-rose-400 text-white' : 'bg-rose-400 text-white',
        inactive: isDarkMode ? `${baseStyle} text-slate-400` : `${baseStyle} text-slate-600`
      },
      lightestred: {
        active: isDarkMode ? 'bg-rose-300 text-rose-900' : 'bg-rose-200 text-rose-800',
        inactive: isDarkMode ? `${baseStyle} text-slate-400` : `${baseStyle} text-slate-600`
      }
    };
    return isActive 
      ? `${colors[tab.color].active}`
      : `${colors[tab.color].inactive}`;
  };

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (currentPage <= 3) {
        pages.push(1, 2, 3, 4, '...', totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
      } else {
        pages.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages);
      }
    }
    return pages;
  };

  return (
    <div className={`md:rounded-2xl md:border ${isDarkMode ? 'bg-transparent md:bg-slate-900/50 md:border-white/10' : 'bg-transparent md:bg-white md:border-slate-200 md:shadow-sm'} overflow-hidden`}>
      <div className={`flex flex-col gap-3 px-0 py-3 md:p-6 border-b ${isDarkMode ? 'border-white/5 md:border-white/10' : 'border-slate-100'}`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className={`text-[11px] md:text-xs font-semibold uppercase tracking-widest ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Critical Loans</h2>
            <p className={`text-[9px] md:text-[10px] mt-0.5 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'} hidden sm:block`}>Click loan officer for analysis</p>
          </div>
        </div>
        <div className="flex gap-1 sm:gap-1.5 overflow-x-auto scrollbar-hide -mx-1 px-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1 px-2 sm:px-3 py-1.5 text-[10px] sm:text-[11px] font-medium whitespace-nowrap transition-all rounded-full active:scale-95 ${getTabStyle(tab)}`}
            >
              <span className="sm:hidden">{tab.shortLabel}</span>
              <span className="hidden sm:inline">{tab.label}</span>
              <span className={`min-w-[16px] h-[16px] sm:min-w-[18px] sm:h-[18px] px-1 rounded-full text-[8px] sm:text-[9px] font-semibold flex items-center justify-center ${activeTab === tab.id ? 'bg-white/25' : (isDarkMode ? 'bg-slate-700/80' : 'bg-slate-200/60')}`}>
                {tabCounts[tab.id]}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`w-full pl-9 pr-3 py-2 text-[13px] rounded-lg ${isDarkMode ? 'bg-slate-800/80 text-slate-200 placeholder-slate-500' : 'bg-slate-100/80 text-slate-800 placeholder-slate-400'} focus:outline-none focus:ring-1 focus:ring-blue-500/40`}
            />
            <svg className={`absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortType)}
            className={`text-[12px] sm:text-[13px] px-2 sm:px-3 py-2 rounded-lg font-medium ${isDarkMode ? 'bg-slate-800/80 text-slate-300' : 'bg-slate-100/80 text-slate-600'}`}
          >
            <option value="risk">Risk</option>
            <option value="amount">Amt</option>
            <option value="loan">Loan</option>
            <option value="officer">LO</option>
          </select>

          <button
            onClick={() => setSortOrder(o => o === 'asc' ? 'desc' : 'asc')}
            className={`w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center ${isDarkMode ? 'bg-slate-800/80 text-slate-400 active:bg-slate-700' : 'bg-slate-100/80 text-slate-500 active:bg-slate-200'}`}
          >
            <span className="text-sm">{sortOrder === 'desc' ? '↓' : '↑'}</span>
          </button>
        </div>
      </div>

      <div className="py-3 md:p-6">
        {paginatedLoans.length === 0 ? (
          <div className={`text-center py-10 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
            <svg className="w-10 h-10 mx-auto mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm font-medium">No loans found</p>
          </div>
        ) : useVirtualization ? (
          // PERFORMANCE: Virtualized rendering for large lists
          <div 
            ref={scrollContainerRef}
            className="max-h-[600px] overflow-y-auto"
            style={{ contain: 'strict' }}
          >
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const rowIndex = virtualRow.index;
                const loan1 = filteredLoans[rowIndex * 2];
                const loan2 = filteredLoans[rowIndex * 2 + 1];
                
                return (
                  <div
                    key={virtualRow.key}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-3 lg:gap-4 pb-2 sm:pb-3 lg:pb-4"
                  >
                    {loan1 && <LoanCardItem loan={loan1} isDarkMode={isDarkMode} onSelectLoan={setSelectedLoan} onSelectOfficer={setSelectedOfficer} />}
                    {loan2 && <LoanCardItem loan={loan2} isDarkMode={isDarkMode} onSelectLoan={setSelectedLoan} onSelectOfficer={setSelectedOfficer} />}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          // Standard paginated rendering with memoized cards
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-3 lg:gap-4">
            {paginatedLoans.map((loan) => (
              <LoanCardItem 
                key={loan.id}
                loan={loan} 
                isDarkMode={isDarkMode} 
                onSelectLoan={setSelectedLoan} 
                onSelectOfficer={setSelectedOfficer} 
              />
            ))}
          </div>
        )}
      </div>

      {/* Pagination controls - only show when not showing all */}
      {!showAll && totalPages > 1 && (
        <div className={`flex items-center justify-between py-3 md:px-4 md:border-t ${isDarkMode ? 'border-white/5' : 'border-slate-100'}`}>
          <p className={`text-[10px] sm:text-xs ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
            {((currentPage - 1) * ITEMS_PER_PAGE) + 1}-{Math.min(currentPage * ITEMS_PER_PAGE, filteredLoans.length)} of {filteredLoans.length}
          </p>
          
          <div className="flex items-center gap-0.5 sm:gap-1">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className={`w-7 h-7 sm:w-8 sm:h-8 rounded-md flex items-center justify-center text-sm transition-colors ${
                currentPage === 1 
                  ? (isDarkMode ? 'text-slate-600 cursor-not-allowed' : 'text-slate-300 cursor-not-allowed')
                  : (isDarkMode ? 'text-slate-400 active:bg-slate-700' : 'text-slate-500 active:bg-slate-100')
              }`}
            >
              ‹
            </button>
            
            {getPageNumbers().map((page, idx) => (
              typeof page === 'number' ? (
                <button
                  key={idx}
                  onClick={() => setCurrentPage(page)}
                  className={`w-7 h-7 sm:w-8 sm:h-8 rounded-md flex items-center justify-center text-[11px] sm:text-xs font-medium transition-colors ${
                    currentPage === page
                      ? 'bg-blue-500 text-white'
                      : (isDarkMode ? 'text-slate-400 active:bg-slate-700' : 'text-slate-500 active:bg-slate-100')
                  }`}
                >
                  {page}
                </button>
              ) : (
                <span key={idx} className={`w-5 sm:w-6 text-center text-[10px] sm:text-xs ${isDarkMode ? 'text-slate-600' : 'text-slate-400'}`}>
                  {page}
                </span>
              )
            ))}
            
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className={`w-7 h-7 sm:w-8 sm:h-8 rounded-md flex items-center justify-center text-sm transition-colors ${
                currentPage === totalPages 
                  ? (isDarkMode ? 'text-slate-600 cursor-not-allowed' : 'text-slate-300 cursor-not-allowed')
                  : (isDarkMode ? 'text-slate-400 active:bg-slate-700' : 'text-slate-500 active:bg-slate-100')
              }`}
            >
              ›
            </button>
            
            {/* Show All toggle - only show when there are more items than one page */}
            {filteredLoans.length > ITEMS_PER_PAGE && (
              <button
                onClick={() => setShowAll(true)}
                className={`ml-2 px-2 py-1 text-[10px] sm:text-xs rounded-md transition-colors ${
                  isDarkMode ? 'text-blue-400 hover:bg-slate-700' : 'text-blue-600 hover:bg-slate-100'
                }`}
              >
                Show All
              </button>
            )}
          </div>
        </div>
      )}
      
      {/* Show paginated view toggle when showing all */}
      {showAll && (
        <div className={`flex items-center justify-between py-3 md:px-4 md:border-t ${isDarkMode ? 'border-white/5' : 'border-slate-100'}`}>
          <p className={`text-[10px] sm:text-xs ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
            Showing all {filteredLoans.length} loans {useVirtualization && '(virtualized)'}
          </p>
          <button
            onClick={() => setShowAll(false)}
            className={`px-2 py-1 text-[10px] sm:text-xs rounded-md transition-colors ${
              isDarkMode ? 'text-blue-400 hover:bg-slate-700' : 'text-blue-600 hover:bg-slate-100'
            }`}
          >
            Show Paginated
          </button>
        </div>
      )}

      {selectedOfficer && (
        <LoanOfficerModal
          officerName={selectedOfficer}
          isOpen={!!selectedOfficer}
          onClose={() => setSelectedOfficer(null)}
          isDarkMode={isDarkMode}
        />
      )}

      {selectedLoan && (
        <LoanDrilldownModal
          loan={selectedLoan}
          isOpen={!!selectedLoan}
          onClose={() => setSelectedLoan(null)}
          isDarkMode={isDarkMode}
        />
      )}
    </div>
  );
});

LoanCardsContainer.displayName = 'LoanCardsContainer';
