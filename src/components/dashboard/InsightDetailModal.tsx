import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, TrendingUp, Users, DollarSign, Clock, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

interface InsightDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  insightSource: string;
  insightMessage: string;
  insightId?: number;
  dateFilter: string;
  selectedTenantId?: string | null;
}

interface LoanRow {
  loanId: string;
  loanAmount: number;
  loanType?: string;
  status?: string;
  milestone?: string | null;
  interestRate?: number | null;
  ficoScore?: number | null;
  ltv?: number | null;
  dti?: number | null;
  applicationDate?: string;
  loanOfficer?: string;
  predictedOutcome?: string;
  confidence?: number;
  riskFactors?: string[];
  riskReason?: string;
  daysInPipeline?: number;
  lockDate?: string;
  // New trigger fields
  estimatedClosingDate?: string;
  ctcDate?: string;
  daysToClose?: number;
  lockExpirationDate?: string;
  lockDays?: number | null;
  daysToExpiry?: number;
  closingDisclosureSentDate?: string;
  closingDisclosureReceivedDate?: string;
  conditions?: number;
}

interface OfficerRow {
  name: string;
  totalLoans: number;
  fundedLoans: number;
  pullThrough: number;
  totalVolume: number;
  fundedVolume: number;
  avgCycleTime?: number | null;
}

interface MonthRow {
  month: string;
  loansStarted: number;
  loansFunded: number;
  totalVolume: number;
  fundedVolume: number;
  avgCycleTime?: number | null;
  pullThrough: number;
}

interface DetailData {
  source: string;
  title: string;
  summary: Record<string, number>;
  loans?: LoanRow[];
  officers?: OfficerRow[];
  months?: MonthRow[];
}

const formatCurrency = (value: number | undefined | null) => {
  if (value == null || isNaN(value)) return '$0';
  if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
};

const formatDate = (dateStr: string | undefined) => {
  if (!dateStr) return '-';
  try {
    return new Date(dateStr).toLocaleDateString();
  } catch {
    return dateStr;
  }
};

// Summary card component
const SummaryCard = ({ label, value, icon: Icon, color = 'blue' }: { 
  label: string; 
  value: string | number; 
  icon?: any;
  color?: 'blue' | 'green' | 'red' | 'amber' | 'purple';
}) => {
  const colorClasses = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300',
    green: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300',
    red: 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300',
    amber: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300',
  };
  
  return (
    <div className={`rounded-lg p-3 ${colorClasses[color]}`}>
      <div className="flex items-center gap-2 mb-1">
        {Icon && <Icon className="w-4 h-4" />}
        <span className="text-xs font-medium opacity-80">{label}</span>
      </div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
};

export const InsightDetailModal = ({ 
  isOpen, 
  onClose, 
  insightSource, 
  insightMessage,
  insightId,
  dateFilter,
  selectedTenantId,
}: InsightDetailModalProps) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DetailData | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen && insightSource) {
      fetchDetails();
    }
  }, [isOpen, insightSource, insightId, dateFilter]);

  const fetchDetails = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const tenantParam = selectedTenantId ? `&tenant_id=${selectedTenantId}` : '';
      const idParam = insightId ? `&insightId=${insightId}` : '';
      const headlineParam = !insightId && insightMessage ? `&headline=${encodeURIComponent(insightMessage)}` : '';
      const result = await api.request<DetailData>(
        `/api/dashboard/insights/details/${insightSource}?dateFilter=${dateFilter}${tenantParam}${idParam}${headlineParam}`
      );
      setData(result);
    } catch (err: any) {
      console.error('Error fetching insight details see:', err);
      setError(err.message || 'Failed to load details');
    } finally {
      setLoading(false);
    }
  };

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="relative w-full max-w-4xl max-h-[85vh] overflow-hidden bg-white dark:bg-slate-900 rounded-2xl shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 z-10 flex items-center justify-between p-4 sm:p-6 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <div>
              <h2 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-white">
                {data?.title || 'Insight Details'}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                {insightMessage}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>

          {/* Content */}
          <div className="p-4 sm:p-6 overflow-y-auto max-h-[calc(85vh-80px)]">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                <span className="ml-3 text-slate-500">Loading details...</span>
              </div>
            ) : error ? (
              <div className="text-center py-12">
                <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-3" />
                <p className="text-slate-600 dark:text-slate-400">{error}</p>
                <button
                  onClick={fetchDetails}
                  className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : data ? (
              <div className="space-y-6">
                {/* Summary Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {insightSource === 'predictions' && (
                    <>
                      <SummaryCard label="Total At Risk" value={data.summary.totalAtRisk} icon={AlertTriangle} color="red" />
                      <SummaryCard label="Likely Withdraw" value={data.summary.likelyWithdraw} icon={TrendingUp} color="amber" />
                      <SummaryCard label="Likely Deny" value={data.summary.likelyDeny} icon={AlertTriangle} color="red" />
                      <SummaryCard label="At-Risk Volume" value={formatCurrency(data.summary.totalVolume)} icon={DollarSign} color="purple" />
                    </>
                  )}
                  {insightSource === 'credit_risk' && (
                    <>
                      <SummaryCard label="High Risk Loans" value={data.summary.totalHighRisk} icon={AlertTriangle} color="red" />
                      <SummaryCard label="Low FICO (<620)" value={data.summary.lowFico} color="amber" />
                      <SummaryCard label="High LTV (>95%)" value={data.summary.highLtv} color="amber" />
                      <SummaryCard label="High DTI (>50%)" value={data.summary.highDti} color="amber" />
                    </>
                  )}
                  {insightSource === 'lost_opportunity' && (
                    <>
                      <SummaryCard label="Total Lost" value={data.summary.totalLost} icon={AlertTriangle} color="red" />
                      <SummaryCard label="Withdrawn" value={data.summary.withdrawn} color="amber" />
                      <SummaryCard label="Denied" value={data.summary.denied} color="red" />
                      <SummaryCard label="Lost Revenue" value={formatCurrency(data.summary.estimatedLostRevenue)} icon={DollarSign} color="purple" />
                    </>
                  )}
                  {insightSource === 'pipeline' && (
                    <>
                      <SummaryCard label="Active Loans" value={data.summary.totalActive} icon={TrendingUp} color="blue" />
                      <SummaryCard label="Locked" value={data.summary.locked} color="green" />
                      <SummaryCard label="Over 30 Days" value={data.summary.over30Days} icon={Clock} color="amber" />
                      <SummaryCard label="Pipeline Volume" value={formatCurrency(data.summary.totalVolume)} icon={DollarSign} color="purple" />
                    </>
                  )}
                  {insightSource === 'performance' && (
                    <>
                      <SummaryCard label="Loan Officers" value={data.summary.totalOfficers} icon={Users} color="blue" />
                      <SummaryCard label="Total Loans" value={data.summary.totalLoans} color="blue" />
                      <SummaryCard label="Funded Loans" value={data.summary.totalFunded} color="green" />
                      <SummaryCard label="Total Volume" value={formatCurrency(data.summary.totalVolume)} icon={DollarSign} color="purple" />
                    </>
                  )}
                  {insightSource === 'comparisons' && (
                    <>
                      <SummaryCard label="Months Analyzed" value={data.summary.monthsAnalyzed} icon={Clock} color="blue" />
                      <SummaryCard label="Total Loans" value={data.summary.totalLoans} color="blue" />
                      <SummaryCard label="Total Funded" value={data.summary.totalFunded} color="green" />
                    </>
                  )}
                  {insightSource === 'closing_risk' && (
                    <>
                      <SummaryCard label="Loans at Risk" value={data.summary.totalAtRisk} icon={AlertTriangle} color="red" />
                      <SummaryCard label="At-Risk Volume" value={formatCurrency(data.summary.totalVolume)} icon={DollarSign} color="purple" />
                      <SummaryCard label="Avg Days to Close" value={`${data.summary.avgDaysToClose}d`} icon={Clock} color="amber" />
                    </>
                  )}
                  {insightSource === 'lock_expiration' && (
                    <>
                      <SummaryCard label="Locks Expiring" value={data.summary.totalExpiring} icon={AlertTriangle} color="red" />
                      <SummaryCard label="Expiring Volume" value={formatCurrency(data.summary.totalVolume)} icon={DollarSign} color="purple" />
                      <SummaryCard label="Avg Days to Expiry" value={`${data.summary.avgDaysToExpiry}d`} icon={Clock} color="amber" />
                    </>
                  )}
                  {insightSource === 'trid' && (
                    <>
                      <SummaryCard label="TRID At Risk" value={data.summary.totalAtRisk} icon={AlertTriangle} color="red" />
                      <SummaryCard label="At-Risk Volume" value={formatCurrency(data.summary.totalVolume)} icon={DollarSign} color="purple" />
                      <SummaryCard label="Avg Days to Close" value={`${data.summary.avgDaysToClose}d`} icon={Clock} color="amber" />
                    </>
                  )}
                  {insightSource === 'margin' && (
                    <>
                      <SummaryCard label="Current Month" value={`${data.summary.currentMonthBps} bps`} icon={TrendingUp} color="blue" />
                      <SummaryCard label="Prior Month" value={`${data.summary.priorMonthBps} bps`} icon={TrendingUp} color="blue" />
                      <SummaryCard label="Delta" value={`${data.summary.deltaBps > 0 ? '+' : ''}${data.summary.deltaBps} bps`} icon={DollarSign} color={data.summary.deltaBps < 0 ? 'red' : 'green'} />
                    </>
                  )}
                  {insightSource === 'condition_backlog' && (
                    <>
                      <SummaryCard label="Loans with High Conditions" value={data.summary.totalLoans} icon={AlertTriangle} color="amber" />
                      <SummaryCard label="Avg Conditions" value={data.summary.avgConditions} icon={Clock} color="blue" />
                      <SummaryCard label="Total Volume" value={formatCurrency(data.summary.totalVolume)} icon={DollarSign} color="purple" />
                    </>
                  )}
                </div>

                {/* Data Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        {/* Predictions table headers */}
                        {insightSource === 'predictions' && (
                          <>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Loan ID</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Outcome</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Confidence</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Amount</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Milestone</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Rate</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Loan Officer</th>
                            <th className="text-center py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Details</th>
                          </>
                        )}
                        {/* Credit risk table headers */}
                        {insightSource === 'credit_risk' && (
                          <>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Loan ID</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Risk Reason</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">FICO</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">LTV</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">DTI</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Amount</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Milestone</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Rate</th>
                          </>
                        )}
                        {/* Lost opportunity table headers */}
                        {insightSource === 'lost_opportunity' && (
                          <>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Loan ID</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Status</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Amount</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Type</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Milestone</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Rate</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Loan Officer</th>
                          </>
                        )}
                        {/* Pipeline table headers */}
                        {insightSource === 'pipeline' && (
                          <>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Loan ID</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Amount</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Type</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Milestone</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Rate</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Days</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Locked</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Loan Officer</th>
                          </>
                        )}
                        {/* Performance table headers */}
                        {insightSource === 'performance' && (
                          <>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Loan Officer</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Total</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Funded</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Pull-Through</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Volume</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Cycle Time</th>
                          </>
                        )}
                        {/* Comparisons table headers */}
                        {insightSource === 'comparisons' && (
                          <>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Month</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Loans</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Funded</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Pull-Through</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Funded Volume</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Cycle Time</th>
                          </>
                        )}
                        {/* Closing risk table headers */}
                        {insightSource === 'closing_risk' && (
                          <>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Loan ID</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Amount</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Milestone</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Est. Close</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Days to Close</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">CTC Date</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Loan Officer</th>
                          </>
                        )}
                        {/* Lock expiration table headers */}
                        {insightSource === 'lock_expiration' && (
                          <>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Loan ID</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Amount</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Milestone</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Rate</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Lock Expiry</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Days Left</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Lock Days</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Loan Officer</th>
                          </>
                        )}
                        {/* TRID exposure table headers */}
                        {insightSource === 'trid' && (
                          <>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Loan ID</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Amount</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Milestone</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Est. Close</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Days to Close</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">CD Sent</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Loan Officer</th>
                          </>
                        )}
                        {/* Condition backlog table headers */}
                        {insightSource === 'condition_backlog' && (
                          <>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Loan ID</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Amount</th>
                            <th className="text-right py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Conditions</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Milestone</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Type</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Status</th>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Loan Officer</th>
                          </>
                        )}
                        {/* Margin — aggregate metric, no table columns needed */}
                        {insightSource === 'margin' && (
                          <>
                            <th className="text-left py-3 px-2 font-medium text-slate-600 dark:text-slate-400">Details</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {/* Predictions rows */}
                      {insightSource === 'predictions' && data.loans?.map((loan, idx) => (
                        <tr 
                          key={loan.loanId || idx}
                          className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        >
                          <td className="py-3 px-2 font-mono text-xs">{loan.loanId}</td>
                          <td className="py-3 px-2">
                            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                              loan.predictedOutcome === 'withdraw' 
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                                : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
                            }`}>
                              {loan.predictedOutcome}
                            </span>
                          </td>
                          <td className="py-3 px-2 text-right font-semibold">{loan.confidence}%</td>
                          <td className="py-3 px-2 text-right">{formatCurrency(loan.loanAmount)}</td>
                          <td className="py-3 px-2 text-xs">{loan.milestone || '-'}</td>
                          <td className="py-3 px-2 text-right">{loan.interestRate ? `${loan.interestRate.toFixed(3)}%` : '-'}</td>
                          <td className="py-3 px-2">{loan.loanOfficer || '-'}</td>
                          <td className="py-3 px-2 text-center">
                            <button
                              onClick={() => toggleRow(loan.loanId)}
                              className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"
                            >
                              {expandedRows.has(loan.loanId) ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                          </td>
                        </tr>
                      ))}
                      {/* Credit risk rows */}
                      {insightSource === 'credit_risk' && data.loans?.map((loan, idx) => (
                        <tr 
                          key={loan.loanId || idx}
                          className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        >
                          <td className="py-3 px-2 font-mono text-xs">{loan.loanId}</td>
                          <td className="py-3 px-2">
                            <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                              {loan.riskReason}
                            </span>
                          </td>
                          <td className={`py-3 px-2 text-right ${loan.ficoScore && loan.ficoScore < 620 ? 'text-rose-600 font-semibold' : ''}`}>
                            {loan.ficoScore || '-'}
                          </td>
                          <td className={`py-3 px-2 text-right ${loan.ltv && loan.ltv > 95 ? 'text-rose-600 font-semibold' : ''}`}>
                            {loan.ltv ? `${loan.ltv.toFixed(1)}%` : '-'}
                          </td>
                          <td className={`py-3 px-2 text-right ${loan.dti && loan.dti > 50 ? 'text-rose-600 font-semibold' : ''}`}>
                            {loan.dti ? `${loan.dti.toFixed(1)}%` : '-'}
                          </td>
                          <td className="py-3 px-2 text-right">{formatCurrency(loan.loanAmount)}</td>
                          <td className="py-3 px-2 text-xs">{loan.milestone || '-'}</td>
                          <td className="py-3 px-2 text-right">{loan.interestRate ? `${loan.interestRate.toFixed(3)}%` : '-'}</td>
                        </tr>
                      ))}
                      {/* Lost opportunity rows */}
                      {insightSource === 'lost_opportunity' && data.loans?.map((loan, idx) => (
                        <tr 
                          key={loan.loanId || idx}
                          className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        >
                          <td className="py-3 px-2 font-mono text-xs">{loan.loanId}</td>
                          <td className="py-3 px-2">{loan.status}</td>
                          <td className="py-3 px-2 text-right">{formatCurrency(loan.loanAmount)}</td>
                          <td className="py-3 px-2">{loan.loanType || '-'}</td>
                          <td className="py-3 px-2 text-xs">{loan.milestone || '-'}</td>
                          <td className="py-3 px-2 text-right">{loan.interestRate ? `${loan.interestRate.toFixed(3)}%` : '-'}</td>
                          <td className="py-3 px-2">{loan.loanOfficer || '-'}</td>
                        </tr>
                      ))}
                      {/* Pipeline rows */}
                      {insightSource === 'pipeline' && data.loans?.map((loan, idx) => (
                        <tr 
                          key={loan.loanId || idx}
                          className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        >
                          <td className="py-3 px-2 font-mono text-xs">{loan.loanId}</td>
                          <td className="py-3 px-2 text-right">{formatCurrency(loan.loanAmount)}</td>
                          <td className="py-3 px-2">{loan.loanType || '-'}</td>
                          <td className="py-3 px-2 text-xs">{loan.milestone || '-'}</td>
                          <td className="py-3 px-2 text-right">{loan.interestRate ? `${loan.interestRate.toFixed(3)}%` : '-'}</td>
                          <td className={`py-3 px-2 text-right ${loan.daysInPipeline && loan.daysInPipeline > 45 ? 'text-rose-600 font-semibold' : ''}`}>
                            {loan.daysInPipeline || '-'}
                          </td>
                          <td className="py-3 px-2">
                            {loan.lockDate ? (
                              <span className="text-emerald-600">Yes</span>
                            ) : (
                              <span className="text-slate-400">No</span>
                            )}
                          </td>
                          <td className="py-3 px-2">{loan.loanOfficer || '-'}</td>
                        </tr>
                      ))}
                      {/* Performance rows */}
                      {insightSource === 'performance' && data.officers?.map((officer, idx) => (
                        <tr 
                          key={officer.name || idx}
                          className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        >
                          <td className="py-3 px-2 font-medium">{officer.name}</td>
                          <td className="py-3 px-2 text-right">{officer.totalLoans}</td>
                          <td className="py-3 px-2 text-right">{officer.fundedLoans}</td>
                          <td className={`py-3 px-2 text-right font-semibold ${
                            officer.pullThrough >= 70 ? 'text-emerald-600' : 
                            officer.pullThrough >= 50 ? 'text-amber-600' : 'text-rose-600'
                          }`}>
                            {officer.pullThrough}%
                          </td>
                          <td className="py-3 px-2 text-right">{formatCurrency(officer.fundedVolume)}</td>
                          <td className="py-3 px-2 text-right">{officer.avgCycleTime ? `${officer.avgCycleTime}d` : '-'}</td>
                        </tr>
                      ))}
                      {/* Comparisons rows */}
                      {insightSource === 'comparisons' && data.months?.map((month, idx) => (
                        <tr 
                          key={month.month || idx}
                          className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        >
                          <td className="py-3 px-2 font-medium">{month.month}</td>
                          <td className="py-3 px-2 text-right">{month.loansStarted}</td>
                          <td className="py-3 px-2 text-right">{month.loansFunded}</td>
                          <td className={`py-3 px-2 text-right font-semibold ${
                            month.pullThrough >= 70 ? 'text-emerald-600' : 
                            month.pullThrough >= 50 ? 'text-amber-600' : 'text-rose-600'
                          }`}>
                            {month.pullThrough}%
                          </td>
                          <td className="py-3 px-2 text-right">{formatCurrency(month.fundedVolume)}</td>
                          <td className="py-3 px-2 text-right">{month.avgCycleTime ? `${month.avgCycleTime}d` : '-'}</td>
                        </tr>
                      ))}
                      {/* Closing risk rows */}
                      {insightSource === 'closing_risk' && data.loans?.map((loan, idx) => (
                        <tr 
                          key={loan.loanId || idx}
                          className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        >
                          <td className="py-3 px-2 font-mono text-xs">{loan.loanId}</td>
                          <td className="py-3 px-2 text-right">{formatCurrency(loan.loanAmount)}</td>
                          <td className="py-3 px-2 text-xs">{loan.milestone || '-'}</td>
                          <td className="py-3 px-2">{formatDate(loan.estimatedClosingDate)}</td>
                          <td className={`py-3 px-2 text-right font-semibold ${
                            loan.daysToClose != null && loan.daysToClose <= 3 ? 'text-rose-600' : 'text-amber-600'
                          }`}>
                            {loan.daysToClose != null ? `${loan.daysToClose}d` : '-'}
                          </td>
                          <td className="py-3 px-2 text-slate-400">Not cleared</td>
                          <td className="py-3 px-2">{loan.loanOfficer || '-'}</td>
                        </tr>
                      ))}
                      {/* Lock expiration rows */}
                      {insightSource === 'lock_expiration' && data.loans?.map((loan, idx) => (
                        <tr 
                          key={loan.loanId || idx}
                          className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        >
                          <td className="py-3 px-2 font-mono text-xs">{loan.loanId}</td>
                          <td className="py-3 px-2 text-right">{formatCurrency(loan.loanAmount)}</td>
                          <td className="py-3 px-2 text-xs">{loan.milestone || '-'}</td>
                          <td className="py-3 px-2 text-right">{loan.interestRate ? `${loan.interestRate.toFixed(3)}%` : '-'}</td>
                          <td className="py-3 px-2">{formatDate(loan.lockExpirationDate)}</td>
                          <td className={`py-3 px-2 text-right font-semibold ${
                            loan.daysToExpiry != null && loan.daysToExpiry <= 2 ? 'text-rose-600' : 'text-amber-600'
                          }`}>
                            {loan.daysToExpiry != null ? `${loan.daysToExpiry}d` : '-'}
                          </td>
                          <td className="py-3 px-2 text-right">{loan.lockDays != null ? `${loan.lockDays}d` : '-'}</td>
                          <td className="py-3 px-2">{loan.loanOfficer || '-'}</td>
                        </tr>
                      ))}
                      {/* TRID exposure rows */}
                      {insightSource === 'trid' && data.loans?.map((loan, idx) => (
                        <tr 
                          key={loan.loanId || idx}
                          className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        >
                          <td className="py-3 px-2 font-mono text-xs">{loan.loanId}</td>
                          <td className="py-3 px-2 text-right">{formatCurrency(loan.loanAmount)}</td>
                          <td className="py-3 px-2 text-xs">{loan.milestone || '-'}</td>
                          <td className="py-3 px-2">{formatDate(loan.estimatedClosingDate)}</td>
                          <td className={`py-3 px-2 text-right font-semibold ${
                            loan.daysToClose != null && loan.daysToClose <= 3 ? 'text-rose-600' : 'text-amber-600'
                          }`}>
                            {loan.daysToClose != null ? `${loan.daysToClose}d` : '-'}
                          </td>
                          <td className="py-3 px-2 text-rose-500">Not sent</td>
                          <td className="py-3 px-2">{loan.loanOfficer || '-'}</td>
                        </tr>
                      ))}
                      {/* Condition backlog rows */}
                      {insightSource === 'condition_backlog' && data.loans?.map((loan, idx) => (
                        <tr 
                          key={loan.loanId || idx}
                          className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        >
                          <td className="py-3 px-2 font-mono text-xs">{loan.loanId}</td>
                          <td className="py-3 px-2 text-right">{formatCurrency(loan.loanAmount)}</td>
                          <td className={`py-3 px-2 text-right font-semibold ${
                            loan.conditions && loan.conditions > 10 ? 'text-rose-600' : 'text-amber-600'
                          }`}>
                            {loan.conditions ?? '-'}
                          </td>
                          <td className="py-3 px-2 text-xs">{loan.milestone || '-'}</td>
                          <td className="py-3 px-2">{loan.loanType || '-'}</td>
                          <td className="py-3 px-2">{loan.status || '-'}</td>
                          <td className="py-3 px-2">{loan.loanOfficer || '-'}</td>
                        </tr>
                      ))}
                      {/* Margin — no loan-level rows, show message */}
                      {insightSource === 'margin' && (
                        <tr>
                          <td colSpan={3} className="py-8 text-center text-slate-500">
                            Margin is an aggregate metric. See summary cards above for current and prior month comparison.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  
                  {/* Empty state */}
                  {(!data.loans?.length && !data.officers?.length && !data.months?.length) && (
                    <div className="text-center py-8 text-slate-500">
                      No detailed data available for this insight.
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default InsightDetailModal;
