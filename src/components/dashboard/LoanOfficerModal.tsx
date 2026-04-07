import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { X } from "lucide-react";
import { LoanCardContent, type LoanCardContentLoan } from "./LoanCardContent";
import { LoanDrilldownModal } from "./LoanDrilldownModal";
import { ExportMenu } from "@/components/common/ExportMenu";
import type { ExportData } from "@/utils/exportUtils";
import { api } from "@/lib/api";

interface OfficerData {
  name: string;
  email: string | null;
  phone: string | null;
  totalLoans: number;
  activeLoans: number;
  closedLoans: number;
  pullThrough: string;
  totalVolume: string;
  activeVolume: string;
  closedVolume: string;
  atRiskVolume: string;
}

interface LoanOfficerModalProps {
  officerName: string;
  isOpen: boolean;
  onClose: () => void;
  isDarkMode?: boolean;
  selectedTenantId?: string | null;
  preloadedLoans?: LoanCardContentLoan[];
}

export const LoanOfficerModal: React.FC<LoanOfficerModalProps> = ({
  officerName,
  isOpen,
  onClose,
  isDarkMode = false,
  selectedTenantId,
  preloadedLoans,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const [officer, setOfficer] = useState<OfficerData | null>(null);
  const [riskBreakdown, setRiskBreakdown] = useState<{
    veryHigh: number;
    medium: number;
    low: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [insights, setInsights] = useState<string>("");
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [sortBy, setSortBy] = useState<"risk" | "amount">("risk");
  const [drilldownLoan, setDrilldownLoan] = useState<LoanCardContentLoan | null>(null);

  // Use preloaded loans (full prediction data) when available, otherwise empty
  const loans: LoanCardContentLoan[] = useMemo(
    () => preloadedLoans ?? [],
    [preloadedLoans],
  );

  const getExportData = (): ExportData => ({
    title: `${officerName} Loans`,
    tables: [
      {
        name: "Loan Officer Detail",
        headers: [
          "Loan #",
          "Amount",
          "Risk",
          "Type",
          "FICO",
          "LTV",
          "DTI",
          "Milestone",
        ],
        rows: loans.map((loan) => [
          loan.loan_number || loan.id,
          loan.amount,
          loan.riskLevel,
          loan.loanType ?? "--",
          loan.ficoScore ?? "--",
          loan.ltvRatio ?? "--",
          loan.dtiRatio ?? "--",
          loan.currentMilestone ?? "--",
        ]),
      },
    ],
  });

  useEffect(() => {
    if (isOpen && officerName) {
      fetchOfficerData();
    }
  }, [isOpen, officerName]);

  useEffect(() => {
    if (
      officer &&
      riskBreakdown &&
      loans.length > 0 &&
      !insights &&
      !insightsLoading
    ) {
      fetchInsights();
    }
  }, [officer, riskBreakdown, loans]);

  const fetchOfficerData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ name: officerName });
      if (selectedTenantId) params.set("tenant_id", selectedTenantId);
      const response = await api.fetchWithAuth(
        `/api/loans/officer-details?${params.toString()}`,
        {
        },
      );
      if (response.ok) {
        const data = await response.json();
        setOfficer(
          data.officer || {
            name: officerName,
            email: null,
            phone: null,
            totalLoans: 0,
            activeLoans: 0,
            closedLoans: 0,
            pullThrough: "0%",
            totalVolume: "$0",
            activeVolume: "$0",
            closedVolume: "$0",
            atRiskVolume: "$0",
          },
        );
        // If we have preloaded loans, derive risk breakdown from them instead
        if (preloadedLoans && preloadedLoans.length > 0) {
          setRiskBreakdown(deriveRiskBreakdown(preloadedLoans));
        } else {
          setRiskBreakdown(
            data.riskBreakdown || { veryHigh: 0, medium: 0, low: 0 },
          );
        }
      } else {
        setOfficer({
          name: officerName,
          email: null,
          phone: null,
          totalLoans: 0,
          activeLoans: 0,
          closedLoans: 0,
          pullThrough: "0%",
          totalVolume: "$0",
          activeVolume: "$0",
          closedVolume: "$0",
          atRiskVolume: "$0",
        });
        setRiskBreakdown(
          preloadedLoans ? deriveRiskBreakdown(preloadedLoans) : { veryHigh: 0, medium: 0, low: 0 },
        );
      }
    } catch (error) {
      console.error("Failed to fetch officer data:", error);
      setOfficer({
        name: officerName,
        email: null,
        phone: null,
        totalLoans: 0,
        activeLoans: 0,
        closedLoans: 0,
        pullThrough: "0%",
        totalVolume: "$0",
        activeVolume: "$0",
        closedVolume: "$0",
        atRiskVolume: "$0",
      });
      setRiskBreakdown(
        preloadedLoans ? deriveRiskBreakdown(preloadedLoans) : { veryHigh: 0, medium: 0, low: 0 },
      );
    }
    setLoading(false);
  };

  function deriveRiskBreakdown(loanCards: LoanCardContentLoan[]) {
    let veryHigh = 0;
    let medium = 0;
    let low = 0;
    for (const l of loanCards) {
      const outcome = l.riskSummary?.predictedOutcome;
      if (l.riskLevel === "Very High" || outcome === "withdraw" || outcome === "deny") {
        veryHigh++;
      } else if (l.riskLevel === "Medium") {
        medium++;
      } else {
        low++;
      }
    }
    return { veryHigh, medium, low };
  }

  const fetchInsights = async () => {
    if (!officer || !riskBreakdown) return;

    setInsightsLoading(true);

    const pullThroughPct = parseFloat(officer.pullThrough);
    const criticalCount = riskBreakdown.veryHigh;
    const totalLoans = officer.activeLoans;
    const atRiskLoans = loans.filter(
      (l: LoanCardContentLoan) => l.riskLevel === "Very High" || l.riskLevel === "Medium",
    );

    const sections: string[] = [];

    if (pullThroughPct >= 70 || criticalCount === 0) {
      const successItems = [];
      if (pullThroughPct >= 70)
        successItems.push(
          `Strong ${officer.pullThrough} pull-through rate exceeds industry benchmark`,
        );
      if (criticalCount === 0)
        successItems.push("No critical risk loans in current pipeline");
      if (totalLoans > 10 && pullThroughPct >= 65)
        successItems.push(
          "Healthy pipeline volume with manageable risk distribution",
        );
      if (successItems.length > 0) {
        sections.push(
          `**Success**\n${successItems.map((i) => `• ${i}`).join("\n")}`,
        );
      }
    }

    const warningItems = [];
    if (pullThroughPct < 70 && pullThroughPct >= 50)
      warningItems.push(
        `Pull-through at ${officer.pullThrough} - room for improvement`,
      );
    if (riskBreakdown.medium > 3)
      warningItems.push(
        `${riskBreakdown.medium} medium-risk loans need proactive monitoring`,
      );
    const avgFico =
      loans.reduce((sum, l) => sum + (l.ficoScore || 0), 0) /
      (loans.length || 1);
    if (avgFico > 0 && avgFico < 680)
      warningItems.push(
        "Portfolio FICO average below optimal - increased fallout risk",
      );
    if (warningItems.length > 0) {
      sections.push(
        `**Warnings**\n${warningItems.map((i) => `• ${i}`).join("\n")}`,
      );
    }

    const criticalItems = [];
    if (criticalCount > 0)
      criticalItems.push(
        `${criticalCount} critical-risk loans require immediate attention`,
      );
    if (pullThroughPct < 50)
      criticalItems.push(
        `Pull-through rate of ${officer.pullThrough} significantly below target`,
      );
    const highLtvLoans = loans.filter((l) => (l.ltvRatio || 0) > 95).length;
    if (highLtvLoans > 2)
      criticalItems.push(
        `${highLtvLoans} loans with LTV > 95% face elevated decline risk`,
      );
    if (criticalItems.length > 0) {
      sections.push(
        `**Critical**\n${criticalItems.map((i) => `• ${i}`).join("\n")}`,
      );
    }

    const loTips = [];
    if (pullThroughPct < 70)
      loTips.push(
        "Focus on pre-qualification accuracy to reduce application fallout",
      );
    if (criticalCount > 2)
      loTips.push("Prioritize daily check-ins with high-risk borrowers");
    loTips.push(
      "Build relationships with reliable appraisers to minimize valuation surprises",
    );
    loTips.push(
      "Create 48-hour follow-up cadence for loans near rate lock expiration",
    );
    sections.push(
      `**TopTiering for Loan Officers**\n${loTips
        .slice(0, 3)
        .map((i) => `• ${i}`)
        .join("\n")}`,
    );

    const buyerTips = [
      "Avoid large purchases or new credit lines during the loan process",
      "Keep employment stable - job changes can delay or derail approval",
      "Respond promptly to document requests to prevent processing delays",
    ];
    sections.push(
      `**Coaching for Buyers**\n${buyerTips.map((i) => `• ${i}`).join("\n")}`,
    );

    setInsights(sections.join("\n\n"));
    setInsightsLoading(false);
  };

  const sortedLoans = useMemo(() => [...loans].sort((a, b) => {
    switch (sortBy) {
      case "risk":
        return (b.riskScore ?? 0) - (a.riskScore ?? 0);
      case "amount":
        return (b.amountValue ?? 0) - (a.amountValue ?? 0);
      default:
        return 0;
    }
  }), [loans, sortBy]);

  const loanToDrilldownData = (loan: LoanCardContentLoan) => ({
    ...loan,
    officer: loan.officer || officerName,
  });

  const predictedFalloutCount = loans.filter(
    (l) => {
      const outcome = l.riskSummary?.predictedOutcome;
      const score = l.riskScore ?? l.riskSummary?.riskScore ?? 0;
      const isFalloutOutcome = outcome === "withdraw" || outcome === "deny";
      // Only count as predicted fallout if risk score >= 50 or risk level is Very High
      return l.riskLevel === "Very High" || (isFalloutOutcome && score >= 50);
    },
  ).length;

  const parseStructuredInsights = (text: string) => {
    const sections: { title: string; items: string[] }[] = [];
    let currentSection = "";
    let currentItems: string[] = [];

    const lines = text.split("\n").filter((line) => line.trim());

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("**") && trimmed.endsWith("**")) {
        if (currentSection && currentItems.length > 0) {
          sections.push({ title: currentSection, items: currentItems });
        }
        currentSection = trimmed.replace(/\*\*/g, "");
        currentItems = [];
      } else if (
        trimmed.startsWith("•") ||
        trimmed.startsWith("-") ||
        trimmed.match(/^\d+\./)
      ) {
        currentItems.push(
          trimmed.replace(/^[-•]\s*/, "").replace(/^\d+\.\s*/, ""),
        );
      } else if (trimmed && currentSection) {
        currentItems.push(trimmed);
      }
    });

    if (currentSection && currentItems.length > 0) {
      sections.push({ title: currentSection, items: currentItems });
    }

    return sections;
  };

  const formatInsights = (text: string) => {
    const sections = parseStructuredInsights(text);

    if (sections.length === 0) {
      return (
        <p className="text-slate-500 dark:text-slate-400">
          No insights available.
        </p>
      );
    }

    const getSectionStyle = (title: string, itemCount: number) => {
      const t = title.toUpperCase();
      if (
        t.includes("CRITICAL") ||
        t.includes("URGENT") ||
        t.includes("IMMEDIATE")
      )
        return {
          bg: "bg-rose-50/30 dark:bg-rose-900/20",
          border: "border-rose-400",
          textColor: "text-rose-600 dark:text-rose-400",
          displayName: "Critical",
        };
      if (t.includes("WARNING"))
        return {
          bg: "bg-amber-50/30 dark:bg-amber-900/20",
          border: "border-amber-400",
          textColor: "text-amber-600 dark:text-amber-400",
          displayName: itemCount > 1 ? "Warnings" : "Warning",
        };
      if (t.includes("SUCCESS"))
        return {
          bg: "bg-sky-50/30 dark:bg-sky-900/20",
          border: "border-sky-400",
          textColor: "text-sky-600 dark:text-sky-400",
          displayName: itemCount > 1 ? "Successes" : "Success",
        };
      if (t.includes("TOPTIERING") || t.includes("LOAN OFFICER"))
        return {
          bg: "bg-indigo-50/30 dark:bg-indigo-900/20",
          border: "border-indigo-400",
          textColor: "text-indigo-600 dark:text-indigo-400",
          displayName: "TopTiering for Loan Officers",
        };
      if (t.includes("BUYER") || t.includes("BORROWER"))
        return {
          bg: "bg-emerald-50/30 dark:bg-emerald-900/20",
          border: "border-emerald-400",
          textColor: "text-emerald-600 dark:text-emerald-400",
          displayName: "Coaching for Buyers",
        };
      return {
        bg: "bg-slate-50 dark:bg-slate-800",
        border: "border-slate-300 dark:border-slate-600",
        textColor: "text-slate-600 dark:text-slate-400",
        displayName: title,
      };
    };

    return sections.map((section, sIdx) => {
      const style = getSectionStyle(section.title, section.items.length);

      return (
        <div
          key={sIdx}
          className={`mb-4 p-5 rounded-xl ${style.bg} border-l-4 ${style.border}`}
        >
          <p
            className={`text-[13px] font-medium uppercase tracking-wider mb-3 ${style.textColor}`}
          >
            {style.displayName}
          </p>
          {section.items.map((item, iIdx) => {
            const isCritical = item.toUpperCase().includes("CRITICAL");
            const formattedItem = item
              .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
              .replace(/CRITICAL[:\s]*/gi, "")
              .replace(
                /\$([\d,.]+[MKB]?)/g,
                '<span class="font-semibold text-emerald-600 dark:text-emerald-400">$$$1</span>',
              )
              .replace(
                /(\d+\.?\d*%)/g,
                '<span class="font-semibold text-indigo-600 dark:text-indigo-400">$1</span>',
              );

            return (
              <div
                key={iIdx}
                className={`flex items-start gap-2.5 mb-2 last:mb-0 text-[15px] ${isCritical ? "text-rose-600 dark:text-rose-400 font-normal" : "text-slate-600 dark:text-slate-300"}`}
              >
                <span className="flex-shrink-0 mt-0.5 text-[14px]">•</span>
                <span
                  className="leading-relaxed font-light"
                  dangerouslySetInnerHTML={{ __html: formattedItem }}
                />
              </div>
            );
          })}
        </div>
      );
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        ref={modalRef}
        hideCloseButton
        className="max-w-4xl max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
      >
        <DialogHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <DialogTitle>{officerName}</DialogTitle>
            <DialogDescription>Portfolio Analysis</DialogDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ExportMenu
              title={`${officerName} Loans`}
              targetRef={modalRef}
              getExportData={getExportData}
            />
            <DialogClose className="rounded-lg p-2 bg-slate-50/80 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 border-0 shadow-sm opacity-70 ring-offset-background transition-all hover:opacity-100 hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogClose>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full"></div>
          </div>
        ) : officer ? (
          <div className="space-y-4 sm:space-y-6">
            {/* Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="p-5 rounded-xl text-center overflow-hidden border bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                <p className="text-[12px] uppercase tracking-widest font-medium text-slate-500 dark:text-slate-400">
                  Pipeline
                </p>
                <p className="text-[22px] font-light mt-2 tracking-tight truncate text-slate-900 dark:text-slate-100">
                  {officer.activeVolume}
                </p>
                <p className="text-[12px] mt-1.5 font-light text-slate-400 dark:text-slate-500">
                  {officer.activeLoans} loans
                </p>
              </div>
              <div className="p-5 rounded-xl text-center overflow-hidden border bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                <p className="text-[12px] uppercase tracking-widest font-medium text-slate-500 dark:text-slate-400">
                  Predicted Fallout
                </p>
                <p
                  className={`text-[22px] font-light mt-2 tracking-tight truncate ${predictedFalloutCount > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}
                >
                  {predictedFalloutCount}
                </p>
                <p className="text-[12px] mt-1.5 font-light text-slate-400 dark:text-slate-500">
                  of {officer.activeLoans} active
                </p>
              </div>
              <div className="p-5 rounded-xl text-center overflow-hidden border bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                <p className="text-[12px] uppercase tracking-widest font-medium text-slate-500 dark:text-slate-400">
                  Pull-Through
                </p>
                <p
                  className={`text-[22px] font-light mt-2 tracking-tight truncate ${parseFloat(officer.pullThrough) >= 70 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}
                >
                  {officer.pullThrough}
                </p>
                <p className="text-[12px] mt-1.5 font-light text-slate-400 dark:text-slate-500">
                  {officer.closedLoans} closed
                </p>
              </div>
              <div className="p-5 rounded-xl text-center overflow-hidden border bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                <p className="text-[12px] uppercase tracking-widest font-medium text-slate-500 dark:text-slate-400">
                  At-Risk
                </p>
                <p className="text-[22px] font-light mt-2 tracking-tight truncate text-rose-600 dark:text-rose-400">
                  {officer.atRiskVolume}
                </p>
                <p className="text-[12px] mt-1.5 font-light text-slate-400 dark:text-slate-500">
                  {riskBreakdown?.veryHigh || 0} critical
                </p>
              </div>
              <div className="col-span-2 p-5 rounded-xl text-center overflow-hidden border bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                <p className="text-[12px] uppercase tracking-widest font-medium text-slate-500 dark:text-slate-400">
                  Risk Mix
                </p>
                <div className="flex items-center justify-center gap-3 mt-2">
                  <span className="text-rose-600 dark:text-rose-400 text-[20px] font-light tracking-tight">
                    {riskBreakdown?.veryHigh || 0}
                  </span>
                  <span className="text-amber-600 dark:text-amber-400 text-[20px] font-light tracking-tight">
                    {riskBreakdown?.medium || 0}
                  </span>
                  <span className="text-emerald-600 dark:text-emerald-400 text-[20px] font-light tracking-tight">
                    {riskBreakdown?.low || 0}
                  </span>
                </div>
                <p className="text-[12px] mt-1.5 font-light text-slate-400 dark:text-slate-500">
                  H / M / L
                </p>
              </div>
            </div>

            {/* Cohi Portfolio Analysis */}
            <div
              className={`p-6 rounded-xl border bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700`}
            >
              <div className="flex items-center gap-4 mb-5">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
                  <span className="text-white text-lg font-light">A</span>
                </div>
                <div>
                  <h3
                    className={`font-medium text-[16px] uppercase tracking-widest text-slate-700 dark:text-slate-200`}
                  >
                    Cohi
                  </h3>
                  <p
                    className={`text-[12px] font-light text-slate-400 dark:text-slate-500`}
                  >
                    Portfolio Analysis
                  </p>
                </div>
              </div>
              {insights ? (
                <div
                  className={`text-[15px] leading-relaxed text-slate-700 dark:text-slate-200`}
                >
                  {formatInsights(insights)}
                </div>
              ) : insightsLoading ? (
                <div className="flex items-center gap-3 py-8 justify-center">
                  <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full"></div>
                  <span
                    className={`text-[15px] font-light text-slate-400 dark:text-slate-500`}
                  >
                    Analyzing portfolio...
                  </span>
                </div>
              ) : (
                <p
                  className={`text-[15px] font-light text-slate-400 dark:text-slate-500`}
                >
                  Loading coaching insights...
                </p>
              )}
            </div>

            {/* Loans List */}
            {loans.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-4 gap-2">
                  <h3
                    className={`font-medium text-[13px] uppercase tracking-widest text-slate-500 dark:text-slate-400`}
                  >
                    Loans ({loans.length})
                  </h3>
                  <select
                    value={sortBy}
                    onChange={(e) =>
                      setSortBy(
                        e.target.value as "risk" | "amount",
                      )
                    }
                    className={`text-[14px] px-4 py-2.5 rounded-lg border font-light bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200`}
                  >
                    <option value="risk">By Risk</option>
                    <option value="amount">By Amount</option>
                  </select>
                </div>
                <div className="space-y-3 max-h-[50vh] sm:max-h-[28rem] overflow-y-auto pr-1">
                  {sortedLoans.map((loan) => (
                    <div
                      key={loan.id}
                      onClick={() => setDrilldownLoan(loan)}
                      className={`rounded-xl border overflow-hidden cursor-pointer transition-all p-3 sm:p-4 ${
                        isDarkMode
                          ? "bg-slate-800/40 hover:bg-slate-800/60 border-slate-700 hover:border-slate-600 shadow-[0_1px_3px_rgba(0,0,0,0.15)]"
                          : "bg-white border-slate-200 hover:border-slate-300 shadow-[0_1px_4px_rgba(0,0,0,0.04)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
                      }`}
                    >
                      <LoanCardContent
                        loan={loan}
                        isDarkMode={isDarkMode}
                        compact={false}
                        selectedTenantId={selectedTenantId}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className={`text-center py-8 text-slate-400 dark:text-slate-500`}>
            No data found for this loan officer.
          </p>
        )}
      </DialogContent>

      {drilldownLoan && (
        <LoanDrilldownModal
          loan={loanToDrilldownData(drilldownLoan)}
          isOpen={!!drilldownLoan}
          onClose={() => setDrilldownLoan(null)}
          isDarkMode={isDarkMode}
          selectedTenantId={selectedTenantId}
        />
      )}
    </Dialog>
  );
};
