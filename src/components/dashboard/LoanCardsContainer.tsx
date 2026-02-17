import React, { useState, useMemo, useEffect, memo, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { LoanCardContent } from "./LoanCardContent";
import { LoanRiskDistribution } from "./LoanRiskDistribution";
import { LoanOfficerModal } from "./LoanOfficerModal";
import { LoanDrilldownModal } from "./LoanDrilldownModal";
import { useToast } from "@/hooks/use-toast";
import { useLoanFavorites } from "@/hooks/useLoanFavorites";

interface RiskSummary {
  risks: string[];
  positives: string[];
  overallRisk: string;
  predictedOutcome: "originate" | "withdraw" | "deny" | "at_risk";
  confidence: number;
}

interface LoanCard {
  id: string;
  loan_number?: string | null;
  officer: string;
  officerTtsScore?: number | null;
  officerTier?: string | null;
  amount: string;
  amountValue?: number;
  riskLevel: string;
  riskScore: number;
  reason: string;
  ficoScore: number | null;
  ltvRatio: number | null;
  dtiRatio: number | null;
  loanType?: string | null;
  loanPurpose?: string | null;
  channel?: string | null;
  // Milestone and time in motion
  currentMilestone?: string | null;
  activeDays?: number | null;
  estimatedClosingDate?: string | null;
  // Rates and market
  interestRate?: number | null;
  marketRate?: number | null;
  lockMarketRate?: number | null;
  marketChangeDelta?: number | null;
  lockDate?: string | null;
  lockExpirationDate?: string | null;
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
  predictedOutcome: "withdraw" | "deny" | "originate";
  confidence: number;
  reasoning?: string;
  riskFactors?: string[];
}

interface LoanCardsContainerProps {
  loans: LoanCard[];
  predictions?: LoanPrediction[]; // Optional predictions map
  isDarkMode?: boolean;
  selectedTenantId?: string | null;
  openLoanId?: string;
  onOpenLoanIdHandled?: () => void;
  /** When provided, filter tab is controlled by parent (shared with critical loans table). */
  activeTab?: TabType;
  onActiveTabChange?: (tab: TabType) => void;
}

export type TabType = "all" | "likely-withdraw" | "likely-decline" | "past-est-closing" | "likely-close-late" | "favorites";
type SortType = "risk" | "amount" | "loan" | "officer";

const ITEMS_PER_PAGE_OPTIONS = [6, 10, 20, 50, 100] as const;

function formatLockExpirationDate(value: string | null | undefined): string {
  if (value == null || value === "") return "";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return String(value);
  }
}

function getExpirationDateColorClass(
  expirationDate: string | null | undefined,
  isDarkMode: boolean
): string {
  if (expirationDate == null || expirationDate === "")
    return isDarkMode ? "text-slate-100" : "text-slate-900";
  try {
    const exp = new Date(expirationDate);
    if (Number.isNaN(exp.getTime()))
      return isDarkMode ? "text-slate-100" : "text-slate-900";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    exp.setHours(0, 0, 0, 0);
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysFromToday = Math.round(
      (exp.getTime() - today.getTime()) / msPerDay
    );
    if (daysFromToday < 0)
      return isDarkMode ? "text-rose-400" : "text-rose-600";
    if (daysFromToday <= 7)
      return isDarkMode ? "text-amber-400" : "text-amber-600";
    return isDarkMode ? "text-emerald-400" : "text-emerald-600";
  } catch {
    return isDarkMode ? "text-slate-100" : "text-slate-900";
  }
}

const ITEMS_PER_PAGE_DEFAULT = 6;
const VIRTUALIZATION_THRESHOLD = 50;

// PERFORMANCE: Memoized loan card component to prevent unnecessary re-renders
const LoanCardItem = memo(
  ({
    loan,
    isDarkMode,
    onSelectLoan,
    onSelectOfficer,
    selectedTenantId,
    isFavorited,
    onToggleFavorite,
    showFavoriteButton = false,
  }: {
    loan: LoanCard;
    isDarkMode: boolean;
    onSelectLoan: (loan: LoanCard) => void;
    onSelectOfficer: (officer: string) => void;
    selectedTenantId?: string | null;
    isFavorited?: boolean;
    onToggleFavorite?: () => void;
    showFavoriteButton?: boolean;
  }) => (
    <div
      onClick={() => onSelectLoan(loan)}
      className={`group p-3 sm:p-4 lg:p-5 rounded-lg sm:rounded-xl overflow-hidden active:scale-[0.99] transition-all cursor-pointer ${
        isDarkMode
          ? "bg-slate-800/40 hover:bg-slate-800/60 shadow-[0_1px_3px_rgba(0,0,0,0.15)]"
          : "bg-white shadow-[0_1px_4px_rgba(0,0,0,0.04)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
      }`}
    >
      <LoanCardContent
        loan={loan}
        isDarkMode={isDarkMode}
        onSelectOfficer={onSelectOfficer}
        showTapForDetails={true}
        compact={true}
        selectedTenantId={selectedTenantId}
        isFavorited={isFavorited}
        onToggleFavorite={onToggleFavorite}
        showFavoriteButton={showFavoriteButton}
      />
    </div>
  )
);

LoanCardItem.displayName = "LoanCardItem";

export const LoanCardsContainer: React.FC<LoanCardsContainerProps> = memo(
  ({
    loans,
    predictions = [],
    isDarkMode = false,
    selectedTenantId,
    openLoanId,
    onOpenLoanIdHandled,
    activeTab: controlledActiveTab,
    onActiveTabChange,
  }) => {
    const [internalActiveTab, setInternalActiveTab] = useState<TabType>("all");
    const activeTab = controlledActiveTab ?? internalActiveTab;
    const setActiveTab = useCallback(
      (tab: TabType) => {
        if (onActiveTabChange) onActiveTabChange(tab);
        else setInternalActiveTab(tab);
      },
      [onActiveTabChange]
    );
    const [searchTerm, setSearchTerm] = useState("");
    const [sortBy, setSortBy] = useState<SortType>("risk");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
    const [selectedOfficer, setSelectedOfficer] = useState<string | null>(null);
    const [selectedLoan, setSelectedLoan] = useState<LoanCard | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(ITEMS_PER_PAGE_DEFAULT);
    const [showAll, setShowAll] = useState(false);
    const { toast } = useToast();
    const { favoriteIds, toggleFavorite, isFavorited } = useLoanFavorites();
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      setCurrentPage(1);
      setShowAll(false);
    }, [activeTab, searchTerm, sortBy, sortOrder, itemsPerPage]);

    useEffect(() => {
      if (!openLoanId || loans.length === 0) return;
      const foundLoan = loans.find((loan) => {
        const loanNum = (loan.loan_number || "").toString().trim();
        if (
          loanNum &&
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            loanNum
          )
        ) {
          return loanNum === openLoanId;
        }
        return loan.id === openLoanId;
      });
      if (foundLoan) {
        setSelectedLoan(foundLoan);
        onOpenLoanIdHandled?.();
      } else {
        toast({
          title: "Loan not found",
          description: `The loan "${openLoanId}" is not in the current critical loans list.`,
          variant: "destructive",
        });
        onOpenLoanIdHandled?.();
      }
    }, [openLoanId, loans, onOpenLoanIdHandled, toast]);

    // Create prediction map for filtering
    const predictionMap = useMemo(() => {
      const map = new Map<string, LoanPrediction>();
      predictions.forEach((pred) => map.set(pred.loanId, pred));
      return map;
    }, [predictions]);

    const filteredLoans = useMemo(() => {
      let result = [...loans];

      if (activeTab !== "all") {
        result = result.filter((loan) => {
          switch (activeTab) {
            case "likely-withdraw":
              if (loan.riskSummary?.predictedOutcome === "withdraw") return true;
              return (
                predictionMap.get(loan.id)?.predictedOutcome === "withdraw"
              );
            case "likely-decline":
              if (loan.riskSummary?.predictedOutcome === "deny") return true;
              return predictionMap.get(loan.id)?.predictedOutcome === "deny";
            case "past-est-closing": {
              const ecdRaw = (loan as { estimatedClosingDate?: string | null }).estimatedClosingDate;
              if (ecdRaw == null || ecdRaw === "") return false;
              try {
                const ecd = new Date(ecdRaw);
                if (Number.isNaN(ecd.getTime())) return false;
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                ecd.setHours(0, 0, 0, 0);
                return today > ecd;
              } catch {
                return false;
              }
            }
            case "likely-close-late": {
              if ((loan as { closeLateRisk?: boolean }).closeLateRisk !== true)
                return false;
              const ecdRaw = (loan as { estimatedClosingDate?: string | null }).estimatedClosingDate;
              if (ecdRaw == null || ecdRaw === "") return true;
              try {
                const ecd = new Date(ecdRaw);
                if (Number.isNaN(ecd.getTime())) return true;
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                ecd.setHours(0, 0, 0, 0);
                return today <= ecd;
              } catch {
                return true;
              }
            }
            case "favorites":
              return isFavorited(loan.id);
            default:
              return true;
          }
        });
      }

      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        result = result.filter(
          (loan) =>
            loan.id.toLowerCase().includes(term) ||
            (loan.loan_number?.toLowerCase().includes(term) ?? false) ||
            loan.officer.toLowerCase().includes(term)
        );
      }

      const parseAmount = (amount: string): number => {
        const cleaned = amount.replace(/[$,]/g, "");
        if (cleaned.endsWith("M")) {
          return parseFloat(cleaned.replace("M", "")) * 1000000;
        } else if (cleaned.endsWith("K")) {
          return parseFloat(cleaned.replace("K", "")) * 1000;
        }
        return parseFloat(cleaned) || 0;
      };

      result.sort((a, b) => {
        let comparison = 0;
        switch (sortBy) {
          case "risk":
            comparison = (b.riskScore ?? 0) - (a.riskScore ?? 0);
            break;
          case "amount":
            const aVal = a.amountValue || parseAmount(a.amount);
            const bVal = b.amountValue || parseAmount(b.amount);
            comparison = bVal - aVal;
            break;
          case "loan":
            comparison = a.id.localeCompare(b.id);
            break;
          case "officer":
            comparison = a.officer.localeCompare(b.officer);
            break;
        }
        return sortOrder === "asc" ? -comparison : comparison;
      });

      return result;
    }, [loans, activeTab, searchTerm, sortBy, sortOrder, predictionMap, isFavorited]);

    const totalPages = Math.ceil(
      filteredLoans.length / (showAll ? filteredLoans.length || 1 : itemsPerPage)
    );
    const paginatedLoans = useMemo(() => {
      if (showAll) return filteredLoans;
      const start = (currentPage - 1) * itemsPerPage;
      return filteredLoans.slice(start, start + itemsPerPage);
    }, [filteredLoans, currentPage, showAll, itemsPerPage]);

    // PERFORMANCE: Use virtualization when showing all items and count exceeds threshold
    const useVirtualization =
      showAll && filteredLoans.length > VIRTUALIZATION_THRESHOLD;

    // Virtualizer for grid layout (2 columns on lg, 1 on smaller)
    // Each row contains 2 cards on desktop, 1 on mobile
    const rowCount = useVirtualization
      ? Math.ceil(filteredLoans.length / 2)
      : 0;
    const rowVirtualizer = useVirtualizer({
      count: rowCount,
      getScrollElement: () => scrollContainerRef.current,
      estimateSize: () => 220, // Estimated height of a loan card row
      overscan: 3, // Render 3 extra rows above/below viewport
      enabled: useVirtualization,
    });

    const tabCounts = useMemo(() => {
      const predictionMapForCounts = new Map<string, LoanPrediction>();
      predictions.forEach((pred) => {
        predictionMapForCounts.set(pred.loanId, pred);
      });
      return {
        all: loans.length,
        "likely-withdraw": loans.filter((l) => {
          if (l.riskSummary?.predictedOutcome === "withdraw") return true;
          return predictionMapForCounts.get(l.id)?.predictedOutcome === "withdraw";
        }).length,
        "likely-decline": loans.filter((l) => {
          if (l.riskSummary?.predictedOutcome === "deny") return true;
          return predictionMapForCounts.get(l.id)?.predictedOutcome === "deny";
        }).length,
        "past-est-closing": loans.filter((l) => {
          const ecdRaw = (l as { estimatedClosingDate?: string | null }).estimatedClosingDate;
          if (ecdRaw == null || ecdRaw === "") return false;
          try {
            const ecd = new Date(ecdRaw);
            if (Number.isNaN(ecd.getTime())) return false;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            ecd.setHours(0, 0, 0, 0);
            return today > ecd;
          } catch {
            return false;
          }
        }).length,
        "likely-close-late": loans.filter((l) => {
          if ((l as { closeLateRisk?: boolean }).closeLateRisk !== true)
            return false;
          const ecdRaw = (l as { estimatedClosingDate?: string | null }).estimatedClosingDate;
          if (ecdRaw == null || ecdRaw === "") return true;
          try {
            const ecd = new Date(ecdRaw);
            if (Number.isNaN(ecd.getTime())) return true;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            ecd.setHours(0, 0, 0, 0);
            return today <= ecd;
          } catch {
            return true;
          }
        }).length,
        favorites: loans.filter((l) => favoriteIds.has(l.id)).length,
      };
    }, [loans, predictions, favoriteIds]);

    const tabs: {
      id: TabType;
      label: string;
      shortLabel: string;
      color: string;
    }[] = [
      { id: "all", label: "All Loans", shortLabel: "All", color: "darkred" },
      {
        id: "likely-withdraw",
        label: "Likely Withdrawal",
        shortLabel: "Withdraw",
        color: "red",
      },
      {
        id: "likely-decline",
        label: "Likely Decline",
        shortLabel: "Decline",
        color: "lightred",
      },
      {
        id: "past-est-closing",
        label: "Past Est. Closing",
        shortLabel: "Past ECD",
        color: "red",
      },
      {
        id: "likely-close-late",
        label: "Likely Close Late",
        shortLabel: "Close Late",
        color: "amber",
      },
      { id: "favorites", label: "Favorites", shortLabel: "Favorites", color: "blue" },
    ];

    const getTabStyle = (tab: (typeof tabs)[0]) => {
      const isActive = activeTab === tab.id;
      const baseStyle = isDarkMode
        ? "bg-slate-800 border border-slate-700"
        : "bg-slate-100 border border-slate-200";
      const colors: Record<string, { active: string; inactive: string }> = {
        darkred: {
          active: isDarkMode
            ? "bg-rose-900 text-white"
            : "bg-rose-800 text-white",
          inactive: isDarkMode
            ? `${baseStyle} text-slate-400`
            : `${baseStyle} text-slate-600`,
        },
        red: {
          active: isDarkMode
            ? "bg-rose-600 text-white"
            : "bg-rose-600 text-white",
          inactive: isDarkMode
            ? `${baseStyle} text-slate-400`
            : `${baseStyle} text-slate-600`,
        },
        lightred: {
          active: isDarkMode
            ? "bg-rose-400 text-white"
            : "bg-rose-400 text-white",
          inactive: isDarkMode
            ? `${baseStyle} text-slate-400`
            : `${baseStyle} text-slate-600`,
        },
        lightestred: {
          active: isDarkMode
            ? "bg-rose-300 text-rose-900"
            : "bg-rose-200 text-rose-800",
          inactive: isDarkMode
            ? `${baseStyle} text-slate-400`
            : `${baseStyle} text-slate-600`,
        },
        amber: {
          active: isDarkMode
            ? "bg-amber-600 text-white"
            : "bg-amber-500 text-white",
          inactive: isDarkMode
            ? `${baseStyle} text-slate-400`
            : `${baseStyle} text-slate-600`,
        },
        blue: {
          active: isDarkMode
            ? "bg-blue-600 text-white"
            : "bg-blue-600 text-white",
          inactive: isDarkMode
            ? `${baseStyle} text-slate-400`
            : `${baseStyle} text-slate-600`,
        },
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
          pages.push(1, 2, 3, 4, "...", totalPages);
        } else if (currentPage >= totalPages - 2) {
          pages.push(
            1,
            "...",
            totalPages - 3,
            totalPages - 2,
            totalPages - 1,
            totalPages
          );
        } else {
          pages.push(
            1,
            "...",
            currentPage - 1,
            currentPage,
            currentPage + 1,
            "...",
            totalPages
          );
        }
      }
      return pages;
    };

    return (
      <div
        className={`md:rounded-2xl md:border ${
          isDarkMode
            ? "bg-transparent md:bg-slate-900/50 md:border-white/10"
            : "bg-transparent md:bg-white md:border-slate-200 md:shadow-sm"
        } overflow-hidden`}
      >
        <div
          className={`flex flex-col gap-3 px-0 py-3 md:p-6 border-b ${
            isDarkMode
              ? "border-white/5 md:border-white/10"
              : "border-slate-100"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <h2
                className={`text-[11px] md:text-xs font-semibold uppercase tracking-widest ${
                  isDarkMode ? "text-slate-400" : "text-slate-500"
                }`}
              >
                Critical Loans
              </h2>
              <p
                className={`text-[9px] md:text-[10px] mt-0.5 ${
                  isDarkMode ? "text-slate-500" : "text-slate-400"
                } hidden sm:block`}
              >
                Click loan officer for analysis
              </p>
            </div>
          </div>
          <div className="flex gap-1 sm:gap-1.5 overflow-x-auto scrollbar-hide -mx-1 px-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1 px-2 sm:px-3 py-1.5 text-[10px] sm:text-[11px] font-medium whitespace-nowrap transition-all rounded-full active:scale-95 ${getTabStyle(
                  tab
                )}`}
              >
                <span className="sm:hidden">{tab.shortLabel}</span>
                <span className="hidden sm:inline">{tab.label}</span>
                <span
                  className={`min-w-[16px] h-[16px] sm:min-w-[18px] sm:h-[18px] px-1 rounded-full text-[8px] sm:text-[9px] font-semibold flex items-center justify-center ${
                    activeTab === tab.id
                      ? "bg-white/25"
                      : isDarkMode
                      ? "bg-slate-700/80"
                      : "bg-slate-200/60"
                  }`}
                >
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
                className={`w-full pl-9 pr-3 py-2 text-[13px] rounded-lg ${
                  isDarkMode
                    ? "bg-slate-800/80 text-slate-200 placeholder-slate-500"
                    : "bg-slate-100/80 text-slate-800 placeholder-slate-400"
                } focus:outline-none focus:ring-1 focus:ring-blue-500/40`}
              />
              <svg
                className={`absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${
                  isDarkMode ? "text-slate-500" : "text-slate-400"
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortType)}
              className={`text-[12px] sm:text-[13px] px-2 sm:px-3 py-2 rounded-lg font-medium ${
                isDarkMode
                  ? "bg-slate-800/80 text-slate-300"
                  : "bg-slate-100/80 text-slate-600"
              }`}
            >
              <option value="risk">Risk</option>
              <option value="amount">Amt</option>
              <option value="loan">Loan</option>
              <option value="officer">LO</option>
            </select>

            <button
              onClick={() =>
                setSortOrder((o) => (o === "asc" ? "desc" : "asc"))
              }
              className={`w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center ${
                isDarkMode
                  ? "bg-slate-800/80 text-slate-400 active:bg-slate-700"
                  : "bg-slate-100/80 text-slate-500 active:bg-slate-200"
              }`}
            >
              <span className="text-sm">
                {sortOrder === "desc" ? "↓" : "↑"}
              </span>
            </button>
          </div>
        </div>

        <div className="py-3 md:p-6">
          {paginatedLoans.length === 0 ? (
            <div
              className={`text-center py-10 ${
                isDarkMode ? "text-slate-400" : "text-slate-500"
              }`}
            >
              <svg
                className="w-10 h-10 mx-auto mb-2 opacity-40"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <p className="text-sm font-medium">
                {activeTab === "favorites"
                  ? "No favorites added"
                  : "No loans found"}
              </p>
            </div>
          ) : useVirtualization ? (
            // PERFORMANCE: Virtualized rendering for large lists
            <div
              ref={scrollContainerRef}
              className="max-h-[600px] overflow-y-auto"
              style={{ contain: "strict" }}
            >
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  width: "100%",
                  position: "relative",
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
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-3 lg:gap-4 pb-2 sm:pb-3 lg:pb-4"
                    >
                      {loan1 && (
                        <LoanCardItem
                          loan={loan1}
                          isDarkMode={isDarkMode}
                          onSelectLoan={setSelectedLoan}
                          onSelectOfficer={setSelectedOfficer}
                          selectedTenantId={selectedTenantId}
                          isFavorited={isFavorited(loan1.id)}
                          onToggleFavorite={() => toggleFavorite(loan1.id)}
                          showFavoriteButton={true}
                        />
                      )}
                      {loan2 && (
                        <LoanCardItem
                          loan={loan2}
                          isDarkMode={isDarkMode}
                          onSelectLoan={setSelectedLoan}
                          onSelectOfficer={setSelectedOfficer}
                          selectedTenantId={selectedTenantId}
                          isFavorited={isFavorited(loan2.id)}
                          onToggleFavorite={() => toggleFavorite(loan2.id)}
                          showFavoriteButton={true}
                        />
                      )}
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
                  selectedTenantId={selectedTenantId}
                  isFavorited={isFavorited(loan.id)}
                  onToggleFavorite={() => toggleFavorite(loan.id)}
                  showFavoriteButton={true}
                />
              ))}
            </div>
          )}
        </div>

        {!showAll && (totalPages > 1 || filteredLoans.length > 0) && (
          <div
            className={`flex items-center justify-between py-3 md:px-4 md:border-t ${
              isDarkMode ? "border-white/5" : "border-slate-100"
            }`}
          >
            <div className="flex items-center gap-2 sm:gap-3">
              <p
                className={`text-[10px] sm:text-xs ${
                  isDarkMode ? "text-slate-500" : "text-slate-400"
                }`}
              >
                {(currentPage - 1) * itemsPerPage + 1}-
                {Math.min(currentPage * itemsPerPage, filteredLoans.length)} of{" "}
                {filteredLoans.length}
              </p>
              <select
                value={itemsPerPage}
                onChange={(e) => setItemsPerPage(Number(e.target.value))}
                className={`text-[10px] sm:text-xs px-2 py-1 rounded-md font-medium border ${
                  isDarkMode
                    ? "bg-slate-800/80 text-slate-300 border-slate-600"
                    : "bg-slate-100 text-slate-600 border-slate-200"
                }`}
              >
                {ITEMS_PER_PAGE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n} per page
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-0.5 sm:gap-1">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className={`w-7 h-7 sm:w-8 sm:h-8 rounded-md flex items-center justify-center text-sm transition-colors ${
                  currentPage === 1
                    ? isDarkMode
                      ? "text-slate-600 cursor-not-allowed"
                      : "text-slate-300 cursor-not-allowed"
                    : isDarkMode
                    ? "text-slate-400 active:bg-slate-700"
                    : "text-slate-500 active:bg-slate-100"
                }`}
              >
                ‹
              </button>

              {getPageNumbers().map((page, idx) =>
                typeof page === "number" ? (
                  <button
                    key={idx}
                    onClick={() => setCurrentPage(page)}
                    className={`w-7 h-7 sm:w-8 sm:h-8 rounded-md flex items-center justify-center text-[11px] sm:text-xs font-medium transition-colors ${
                      currentPage === page
                        ? "bg-blue-500 text-white"
                        : isDarkMode
                        ? "text-slate-400 active:bg-slate-700"
                        : "text-slate-500 active:bg-slate-100"
                    }`}
                  >
                    {page}
                  </button>
                ) : (
                  <span
                    key={idx}
                    className={`w-5 sm:w-6 text-center text-[10px] sm:text-xs ${
                      isDarkMode ? "text-slate-600" : "text-slate-400"
                    }`}
                  >
                    {page}
                  </span>
                )
              )}

              <button
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                }
                disabled={currentPage === totalPages}
                className={`w-7 h-7 sm:w-8 sm:h-8 rounded-md flex items-center justify-center text-sm transition-colors ${
                  currentPage === totalPages
                    ? isDarkMode
                      ? "text-slate-600 cursor-not-allowed"
                      : "text-slate-300 cursor-not-allowed"
                    : isDarkMode
                    ? "text-slate-400 active:bg-slate-700"
                    : "text-slate-500 active:bg-slate-100"
                }`}
              >
                ›
              </button>

              {/* Show All toggle - only show when there are more items than one page */}
              {filteredLoans.length > itemsPerPage && (
                <button
                  onClick={() => setShowAll(true)}
                  className={`ml-2 px-2 py-1 text-[10px] sm:text-xs rounded-md transition-colors ${
                    isDarkMode
                      ? "text-blue-400 hover:bg-slate-700"
                      : "text-blue-600 hover:bg-slate-100"
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
          <div
            className={`flex items-center justify-between py-3 md:px-4 md:border-t ${
              isDarkMode ? "border-white/5" : "border-slate-100"
            }`}
          >
            <p
              className={`text-[10px] sm:text-xs ${
                isDarkMode ? "text-slate-500" : "text-slate-400"
              }`}
            >
              Showing all {filteredLoans.length} loans{" "}
              {useVirtualization && "(virtualized)"}
            </p>
            <button
              onClick={() => setShowAll(false)}
              className={`px-2 py-1 text-[10px] sm:text-xs rounded-md transition-colors ${
                isDarkMode
                  ? "text-blue-400 hover:bg-slate-700"
                  : "text-blue-600 hover:bg-slate-100"
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
            onSelectOfficer={(officer) => {
              setSelectedLoan(null);
              setSelectedOfficer(officer);
            }}
            selectedTenantId={selectedTenantId}
          />
        )}
      </div>
    );
  }
);

LoanCardsContainer.displayName = "LoanCardsContainer";
