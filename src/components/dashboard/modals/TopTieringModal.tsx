import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { X, ChevronRight, ArrowDown, Users, AlertTriangle, DollarSign, FileCheck, Target } from 'lucide-react';
import { motion } from 'framer-motion';
import { LoanFunnelView } from '@/components/views/LoanFunnelView';

interface BranchLO {
  name: string;
  revenue: string;
  loans: number;
  pullThrough: string;
  tier: 'top' | 'middle' | 'bottom';
  score: number;
}

interface TopTieringModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedBranch: string | null;
  setSelectedBranch: (branch: string | null) => void;
  selectedStaff: {
    name: string;
    role: string;
    branch: string;
  } | null;
  setSelectedStaff: React.Dispatch<React.SetStateAction<{
    name: string;
    role: string;
    branch: string;
  } | null>>;
  topTieringTab: 'funnel' | 'overview' | 'branches' | 'los' | 'trends';
  setTopTieringTab: (tab: 'funnel' | 'overview' | 'branches' | 'los' | 'trends') => void;
  staffFilter: 'all' | 'lo' | 'processor' | 'uw' | 'closer';
  setStaffFilter: React.Dispatch<React.SetStateAction<'all' | 'lo' | 'processor' | 'uw' | 'closer'>>;
  setTrendsModal: (open: boolean) => void;
  setForecastingModal: (open: boolean) => void;
  funnelView: 'funnel' | 'bar' | 'revenue' | 'units' | 'volume' | 'detail';
  setFunnelView: React.Dispatch<React.SetStateAction<'funnel' | 'bar' | 'revenue' | 'units' | 'volume' | 'detail'>>;
  funnelYear: number;
  setFunnelYear: (year: number) => void;
  selectedTier: 'top' | 'middle' | 'bottom';
  setSelectedTier: (tier: 'top' | 'middle' | 'bottom') => void;
  branchLOs: BranchLO[];
}

export function TopTieringModal({
  open,
  onOpenChange,
  selectedBranch,
  setSelectedBranch,
  selectedStaff,
  setSelectedStaff,
  topTieringTab,
  setTopTieringTab,
  staffFilter,
  setStaffFilter,
  setTrendsModal,
  setForecastingModal,
  funnelView,
  setFunnelView,
  funnelYear,
  setFunnelYear,
  selectedTier,
  setSelectedTier,
  branchLOs
}: TopTieringModalProps) {
  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (!isOpen) {
      setSelectedBranch(null);
      setSelectedStaff(null);
      setTopTieringTab('overview');
      setStaffFilter('all');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-5xl max-h-screen sm:max-h-[90vh] overflow-y-auto w-full sm:w-[95vw] md:w-full p-3 sm:p-4 md:p-6 rounded-none sm:rounded-xl md:rounded-2xl border-0 sm:border [&>button]:hidden">
        {/* Close Button */}
        <button onClick={() => onOpenChange(false)} className="absolute right-4 top-4 rounded-full w-8 h-8 flex items-center justify-center bg-white/90 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 backdrop-blur-sm transition-all duration-200 z-10 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-1">
          <X className="h-4 w-4 text-slate-500 dark:text-slate-400" strokeWidth={1.5} />
        </button>
        
        {/* Breadcrumb Navigation */}
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-1 text-[10px] sm:text-xs">
            <button onClick={() => onOpenChange(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
              Dashboard
            </button>
            <ChevronRight className="w-3 h-3 text-slate-300 dark:text-slate-600" />
            <span className="font-medium text-slate-700 dark:text-slate-200">TopTiering</span>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
            <button className="px-2.5 py-1 text-[10px] sm:text-xs font-medium rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm">
              TopTiering
            </button>
            <button onClick={() => {
              onOpenChange(false);
              setTrendsModal(true);
            }} className="px-2.5 py-1 text-[10px] sm:text-xs font-medium rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
              Trends
            </button>
            <button onClick={() => {
              onOpenChange(false);
              setForecastingModal(true);
            }} className="px-2.5 py-1 text-[10px] sm:text-xs font-medium rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
              Forecast
            </button>
          </div>
        </div>
        
        <DialogHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <DialogTitle className="flex items-center gap-2 sm:gap-3 text-lg sm:text-xl font-extralight tracking-tight leading-[1.05]">
              <div className="w-1 sm:w-1.5 h-5 sm:h-6 bg-gradient-to-b from-tier-top via-tier-second to-tier-bottom rounded-full flex-shrink-0" />
              {selectedBranch ? <span className="flex items-center gap-2">
                  <button onClick={() => setSelectedBranch(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                    <ArrowDown className="w-4 h-4 rotate-90" />
                  </button>
                  <span className="truncate">{selectedBranch} — Branch Detail</span>
                </span> : <span className="truncate">TopTiering Story — Branch Performance</span>}
            </DialogTitle>
            <div className="flex items-center gap-2 text-[10px] sm:text-xs">
              <span className="text-slate-400">Report Date:</span>
              <span className="font-medium text-slate-600 dark:text-slate-300">{new Date().toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
              })}</span>
            </div>
          </div>
          <DialogDescription className="text-xs sm:text-sm">
            {selectedBranch ? `Detailed performance metrics and loan officer breakdown for ${selectedBranch}` : 'Year-to-date revenue analysis across 14 branches, segmented by production tier'}
          </DialogDescription>
        </DialogHeader>
        
        {/* Navigation Tabs */}
        {!selectedBranch && <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700 mt-4 overflow-x-auto pb-px -mx-4 px-4 sm:mx-0 sm:px-0">
            {[{
          id: 'funnel',
          label: 'Loan Funnel'
        }, {
          id: 'overview',
          label: 'Overview'
        }, {
          id: 'branches',
          label: 'Branch Rankings'
        }, {
          id: 'los',
          label: 'Top LOs'
        }, {
          id: 'trends',
          label: 'Trends'
        }].map(tab => <button key={tab.id} onClick={() => setTopTieringTab(tab.id as any)} className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-colors relative whitespace-nowrap ${topTieringTab === tab.id ? 'text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
                {tab.label}
                {topTieringTab === tab.id && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-tier-top" />}
              </button>)}
          </div>}
        
        <div className="mt-4 sm:mt-6">
          {/* Branch Detail View */}
          {selectedBranch && <div className="space-y-4 sm:space-y-6">
              {/* Branch Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-3">
                {[{
              label: 'Revenue YTD',
              value: '$3.2M',
              change: '+18%',
              positive: true
            }, {
              label: 'Loans Closed',
              value: '156',
              change: '+24',
              positive: true
            }, {
              label: 'Avg Loan Size',
              value: '$410K',
              change: '+5%',
              positive: true
            }, {
              label: 'Pull-Through',
              value: '84%',
              change: '+3%',
              positive: true
            }, {
              label: 'Cycle Time',
              value: '28 days',
              change: '-2 days',
              positive: true
            }].map((stat, idx) => <div key={idx} className="bg-slate-50/30 dark:bg-slate-800/20 rounded-lg p-2 sm:p-3 text-center">
                    <p className="text-sm sm:text-lg font-semibold text-slate-900 dark:text-white">{stat.value}</p>
                    <p className="text-[9px] sm:text-[10px] text-slate-500 dark:text-slate-400">{stat.label}</p>
                    <p className={`text-[9px] sm:text-[10px] font-medium ${stat.positive ? 'text-emerald-600' : 'text-rose-600'}`}>{stat.change}</p>
                  </div>)}
              </div>

              {/* Loan Officers in Branch */}
              <div>
                <h4 className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 sm:mb-3 flex items-center gap-2">
                  <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  Loan Officers (12 Active)
                </h4>
                <div className="grid gap-2 max-h-48 sm:max-h-64 overflow-y-auto">
                  {branchLOs.map((lo, idx) => <div key={idx} className={`flex flex-col sm:flex-row sm:items-center sm:justify-between py-2 px-2 sm:px-3 rounded-lg gap-2 ${lo.tier === 'top' ? 'bg-tier-top-light dark:bg-tier-top-dark' : lo.tier === 'middle' ? 'bg-tier-second-light dark:bg-tier-second-dark' : 'bg-tier-bottom-light dark:bg-tier-bottom-dark'}`}>
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-[10px] sm:text-xs font-bold flex-shrink-0 ${lo.tier === 'top' ? 'bg-tier-top text-white' : lo.tier === 'middle' ? 'bg-tier-second text-white' : 'bg-tier-bottom text-slate-800'}`}>
                          {lo.score}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 truncate">{lo.name}</p>
                          <p className="text-[9px] sm:text-[10px] text-slate-500 dark:text-slate-400">{lo.tier.charAt(0).toUpperCase() + lo.tier.slice(1)} Tier</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 sm:gap-4 text-xs sm:text-sm ml-9 sm:ml-0">
                        <div className="text-left sm:text-right">
                          <p className="font-light text-slate-900 dark:text-white tracking-tight">{lo.revenue}</p>
                          <p className="text-[9px] sm:text-[10px] text-slate-500">revenue</p>
                        </div>
                        <div className="text-left sm:text-right">
                          <p className="text-slate-700 dark:text-slate-300">{lo.loans}</p>
                          <p className="text-[9px] sm:text-[10px] text-slate-500">loans</p>
                        </div>
                        <div className="text-left sm:text-right">
                          <p className={lo.tier === 'top' ? 'text-tier-top' : lo.tier === 'middle' ? 'text-tier-second' : 'text-tier-bottom'}>{lo.pullThrough}</p>
                          <p className="text-[9px] sm:text-[10px] text-slate-500">pull-thru</p>
                        </div>
                      </div>
                    </div>)}
                </div>
              </div>

              {/* Monthly Trend */}
              <div>
                <h4 className="text-sm font-light text-slate-700 dark:text-slate-300 mb-3 tracking-tight">Monthly Revenue Trend</h4>
                <div className="h-32 flex items-end gap-1">
                  {[280, 310, 340, 295, 380, 420, 385, 440, 410, 465, 490, 520].map((val, idx) => <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full bg-emerald-500/80 rounded-t" style={{
                  height: `${val / 520 * 100}%`
                }} />
                      <span className="text-[8px] text-slate-400">{['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'][idx]}</span>
                    </div>)}
                </div>
              </div>
            </div>}

          {/* Funnel Tab */}
          {!selectedBranch && topTieringTab === 'funnel' && <LoanFunnelView view={funnelView} onViewChange={setFunnelView} year={funnelYear} onYearChange={setFunnelYear} />}

          {/* Overview Tab */}
          {!selectedBranch && topTieringTab === 'overview' && <div className="space-y-4 sm:space-y-6">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2.5 sm:p-4 text-center">
                  <p className="text-lg sm:text-2xl font-light text-slate-900 dark:text-white">$14.58M</p>
                  <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5 sm:mt-1">Total Revenue YTD</p>
                  <p className="text-[10px] sm:text-xs text-emerald-600 mt-0.5 sm:mt-1">↑ 12.4% vs LY</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2.5 sm:p-4 text-center">
                  <p className="text-lg sm:text-2xl font-light text-slate-900 dark:text-white">698</p>
                  <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5 sm:mt-1">Loans Closed YTD</p>
                  <p className="text-[10px] sm:text-xs text-emerald-600 mt-0.5 sm:mt-1">↑ 8.2% vs LY</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2.5 sm:p-4 text-center">
                  <p className="text-lg sm:text-2xl font-light text-emerald-600 dark:text-emerald-400">$20.9K</p>
                  <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5 sm:mt-1">Avg Revenue/Loan</p>
                  <p className="text-[10px] sm:text-xs text-emerald-600 mt-0.5 sm:mt-1">↑ 3.8% vs LY</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2.5 sm:p-4 text-center">
                  <p className="text-lg sm:text-2xl font-light text-slate-900 dark:text-white">78%</p>
                  <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5 sm:mt-1">Avg Pull-Through</p>
                  <p className="text-[10px] sm:text-xs text-emerald-600 mt-0.5 sm:mt-1">↑ 2.1% vs LY</p>
                </div>
              </div>

              {/* Tier Distribution Visual */}
              <div className="bg-slate-50/30 dark:bg-slate-800/20 rounded-lg p-3 sm:p-4">
                <h4 className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 sm:mb-4">Revenue Distribution by Tier</h4>
                <div className="flex h-6 sm:h-8 rounded-lg overflow-hidden">
                  <div className="bg-emerald-500 flex items-center justify-center" style={{
                width: '55.6%'
              }}>
                    <span className="text-[10px] sm:text-xs font-medium text-white">55.6%</span>
                  </div>
                  <div className="bg-amber-500 flex items-center justify-center" style={{
                width: '24.5%'
              }}>
                    <span className="text-[10px] sm:text-xs font-medium text-white">24.5%</span>
                  </div>
                  <div className="bg-rose-500 flex items-center justify-center" style={{
                width: '19.9%'
              }}>
                    <span className="text-[10px] sm:text-xs font-medium text-white">19.9%</span>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between mt-2 gap-1 sm:gap-0 text-[10px] sm:text-xs text-slate-500">
                  <span>Top Tier (3) — $8.10M</span>
                  <span>Second (2) — $3.57M</span>
                  <span>Bottom (9) — $2.90M</span>
                </div>
              </div>

              {/* Key Insights */}
              <div className="grid md:grid-cols-2 gap-3 sm:gap-4">
                <div className="bg-emerald-50/30 dark:bg-emerald-900/15 border border-emerald-200/40 dark:border-emerald-800/30 rounded-lg p-3 sm:p-4">
                  <h4 className="text-xs sm:text-sm font-semibold text-emerald-700 dark:text-emerald-400 mb-2">🎯 Top Performers</h4>
                  <ul className="text-[10px] sm:text-xs text-slate-600 dark:text-slate-400 space-y-1">
                    <li>• North Region HQ leads with $3.2M (+18% YoY)</li>
                    <li>• Top 3 branches generate 55.6% of total revenue</li>
                    <li>• Coastal Division showing strongest growth (+22%)</li>
                  </ul>
                </div>
                <div className="bg-rose-50/30 dark:bg-rose-900/15 border border-rose-200/40 dark:border-rose-800/30 rounded-lg p-3 sm:p-4">
                  <h4 className="text-xs sm:text-sm font-semibold text-rose-700 dark:text-rose-400 mb-2">⚠️ Areas of Concern</h4>
                  <ul className="text-[10px] sm:text-xs text-slate-600 dark:text-slate-400 space-y-1">
                    <li>• Old Town branch declining -6% YoY</li>
                    <li>• 5 branches in bottom tier showing negative trends</li>
                    <li>• Harbor District needs intervention (-5% decline)</li>
                  </ul>
                </div>
              </div>
            </div>}

          {/* Branches Tab */}
          {!selectedBranch && topTieringTab === 'branches' && <div className="space-y-4">
              {[{
            tier: 'top',
            color: 'tier-top',
            title: 'Top Tier — 3 Branches (55.6%)',
            total: '$8.10M',
            branches: [{
              name: 'North Region HQ',
              revenue: '$3.2M',
              loans: 156,
              change: '+18%',
              avgLoan: '$410K',
              los: 12
            }, {
              name: 'Downtown Metro',
              revenue: '$2.8M',
              loans: 142,
              change: '+15%',
              avgLoan: '$394K',
              los: 10
            }, {
              name: 'Coastal Division',
              revenue: '$2.1M',
              loans: 98,
              change: '+22%',
              avgLoan: '$428K',
              los: 8
            }]
          }, {
            tier: 'middle',
            color: 'tier-second',
            title: 'Second Tier — 2 Branches (24.5%)',
            total: '$3.57M',
            branches: [{
              name: 'Suburban West',
              revenue: '$1.92M',
              loans: 89,
              change: '+8%',
              avgLoan: '$432K',
              los: 7
            }, {
              name: 'East Valley',
              revenue: '$1.65M',
              loans: 76,
              change: '+5%',
              avgLoan: '$434K',
              los: 6
            }]
          }, {
            tier: 'bottom',
            color: 'tier-bottom',
            title: 'Bottom Tier — 9 Branches (19.9%)',
            total: '$2.90M',
            branches: [{
              name: 'South County',
              revenue: '$420K',
              loans: 21,
              change: '+2%',
              avgLoan: '$400K',
              los: 4
            }, {
              name: 'Midtown Central',
              revenue: '$385K',
              loans: 18,
              change: '-3%',
              avgLoan: '$428K',
              los: 4
            }, {
              name: 'Riverside',
              revenue: '$362K',
              loans: 17,
              change: '+1%',
              avgLoan: '$426K',
              los: 3
            }, {
              name: 'Harbor District',
              revenue: '$340K',
              loans: 16,
              change: '-5%',
              avgLoan: '$425K',
              los: 3
            }, {
              name: 'Mountain View',
              revenue: '$325K',
              loans: 15,
              change: '+4%',
              avgLoan: '$433K',
              los: 3
            }, {
              name: 'Lakeside',
              revenue: '$298K',
              loans: 14,
              change: '-2%',
              avgLoan: '$426K',
              los: 3
            }, {
              name: 'Airport Corridor',
              revenue: '$278K',
              loans: 13,
              change: '-4%',
              avgLoan: '$428K',
              los: 2
            }, {
              name: 'Tech Park',
              revenue: '$256K',
              loans: 12,
              change: '+1%',
              avgLoan: '$427K',
              los: 2
            }, {
              name: 'Old Town',
              revenue: '$236K',
              loans: 11,
              change: '-6%',
              avgLoan: '$429K',
              los: 2
            }]
          }].map((tierData, tierIdx) => <div key={tierIdx} className="space-y-2">
                  <div className={`flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 pb-2 border-b border-slate-200 dark:border-slate-700`}>
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-${tierData.color}-500`} />
                      <h3 className={`text-xs sm:text-sm font-medium text-${tierData.color}-700 dark:text-${tierData.color}-400`}>{tierData.title}</h3>
                    </div>
                    <span className="ml-auto text-sm sm:text-lg font-light text-slate-900 dark:text-white">{tierData.total}</span>
                  </div>
                  <div className="grid gap-2">
                    {tierData.branches.map((branch, idx) => <button key={idx} onClick={() => setSelectedBranch(branch.name)} className={`flex flex-col sm:flex-row sm:items-center sm:justify-between py-2 px-2 sm:px-3 rounded-lg hover:shadow-md transition-all cursor-pointer text-left w-full gap-2 ${tierData.tier === 'top' ? 'bg-tier-top-light dark:bg-tier-top-dark hover:bg-tier-top/20 dark:hover:bg-tier-top/30' : tierData.tier === 'middle' ? 'bg-tier-second-light dark:bg-tier-second-dark hover:bg-tier-second/20 dark:hover:bg-tier-second/30' : 'bg-tier-bottom-light dark:bg-tier-bottom-dark hover:bg-tier-bottom/40 dark:hover:bg-tier-bottom/50'}`}>
                        <div className="flex items-center gap-2 sm:gap-3">
                          <span className={`text-[10px] sm:text-xs font-medium w-4 sm:w-5 ${tierData.tier === 'top' ? 'text-emerald-600 dark:text-emerald-400' : tierData.tier === 'middle' ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>#{tierIdx === 0 ? idx + 1 : tierIdx === 1 ? idx + 4 : idx + 6}</span>
                          <div className="min-w-0">
                            <span className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 truncate block">{branch.name}</span>
                            <span className="text-[9px] sm:text-[10px] text-slate-400">{branch.los} LOs</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 sm:gap-4 text-xs sm:text-sm ml-6 sm:ml-0">
                          <div className="text-left sm:text-right">
                            <span className="font-light text-slate-900 dark:text-white tracking-tight">{branch.revenue}</span>
                          </div>
                          <div className="text-left sm:text-right">
                            <span className="text-slate-700 dark:text-slate-300">{branch.loans}</span>
                            <span className="text-[9px] sm:text-[10px] text-slate-400 ml-0.5 sm:ml-1">loans</span>
                          </div>
                          <div className={`text-left sm:text-right ${branch.change.startsWith('+') ? 'text-emerald-600' : 'text-rose-600'}`}>
                            <span className="font-medium">{branch.change}</span>
                          </div>
                          <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400" />
                        </div>
                      </button>)}
                  </div>
                </div>)}
            </div>}

          {/* Top LOs Tab */}
          {!selectedBranch && topTieringTab === 'los' && <div className="space-y-4">
              {/* Tier Filter Tabs */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-0">
                <div className="flex gap-1 bg-slate-100 dark:bg-slate-800/50 rounded-lg p-1 overflow-x-auto">
                  {[{
                id: 'top',
                label: 'Top',
                color: 'emerald',
                count: 18
              }, {
                id: 'middle',
                label: 'Middle',
                color: 'amber',
                count: 24
              }, {
                id: 'bottom',
                label: 'Bottom',
                color: 'rose',
                count: 14
              }].map(tier => <button key={tier.id} onClick={() => setSelectedTier(tier.id as 'top' | 'middle' | 'bottom')} className={`px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium rounded-md transition-all flex items-center gap-1 sm:gap-2 whitespace-nowrap ${selectedTier === tier.id ? `bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm` : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
                      <div className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-${tier.color}-500`} />
                      <span className="hidden sm:inline">{tier.label} Tier</span>
                      <span className="sm:hidden">{tier.label}</span>
                      <span className="text-[9px] sm:text-[10px] text-slate-400">({tier.count})</span>
                    </button>)}
                </div>
                <p className="text-[10px] sm:text-xs text-slate-400">
                  {selectedTier === 'top' ? '85%+ pull-through, $300K+ revenue' : selectedTier === 'middle' ? '70-84% pull-through, $150K-$299K revenue' : 'Below 70% pull-through or <$150K revenue'}
                </p>
              </div>

              {/* Tier Summary Stats */}
              <div className="grid grid-cols-4 gap-3">
                {(selectedTier === 'top' ? [{
              label: 'Avg Revenue',
              value: '$356K',
              change: '+18%'
            }, {
              label: 'Avg Loans',
              value: '15.2',
              change: '+12%'
            }, {
              label: 'Pull-Through',
              value: '88%',
              change: '+3%'
            }, {
              label: 'Revenue Share',
              value: '62%',
              change: '+5%'
            }] : selectedTier === 'middle' ? [{
              label: 'Avg Revenue',
              value: '$218K',
              change: '+8%'
            }, {
              label: 'Avg Loans',
              value: '9.8',
              change: '+5%'
            }, {
              label: 'Pull-Through',
              value: '76%',
              change: '+2%'
            }, {
              label: 'Revenue Share',
              value: '28%',
              change: '-2%'
            }] : [{
              label: 'Avg Revenue',
              value: '$98K',
              change: '-5%'
            }, {
              label: 'Avg Loans',
              value: '4.2',
              change: '-8%'
            }, {
              label: 'Pull-Through',
              value: '62%',
              change: '-4%'
            }, {
              label: 'Revenue Share',
              value: '10%',
              change: '-3%'
            }]).map((stat, idx) => <div key={idx} className={`rounded-lg p-3 text-center ${selectedTier === 'top' ? 'bg-emerald-50/30 dark:bg-emerald-900/10' : selectedTier === 'middle' ? 'bg-amber-50/30 dark:bg-amber-900/10' : 'bg-rose-50/30 dark:bg-rose-900/10'}`}>
                    <p className="text-lg font-semibold text-slate-900 dark:text-white">{stat.value}</p>
                    <p className="text-[10px] text-slate-500">{stat.label}</p>
                    <p className={`text-[10px] font-medium ${stat.change.startsWith('+') ? 'text-emerald-600' : 'text-rose-600'}`}>{stat.change} YoY</p>
                  </div>)}
              </div>

              {/* LO List by Tier */}
              <div className="grid gap-2 max-h-[400px] overflow-y-auto">
                {(selectedTier === 'top' ? [{
              rank: 1,
              name: 'Marcus Wellington',
              branch: 'North Region HQ',
              revenue: '$412K',
              loans: 18,
              pullThrough: '92%',
              avgLoan: '$458K',
              trend: '+22%',
              score: 98
            }, {
              rank: 2,
              name: 'Priya Patel',
              branch: 'Downtown Metro',
              revenue: '$398K',
              loans: 17,
              pullThrough: '90%',
              avgLoan: '$442K',
              trend: '+18%',
              score: 96
            }, {
              rank: 3,
              name: 'Derek Nakamura',
              branch: 'North Region HQ',
              revenue: '$385K',
              loans: 16,
              pullThrough: '89%',
              avgLoan: '$428K',
              trend: '+15%',
              score: 94
            }, {
              rank: 4,
              name: 'Sophia Reyes',
              branch: 'Coastal Division',
              revenue: '$362K',
              loans: 15,
              pullThrough: '87%',
              avgLoan: '$414K',
              trend: '+14%',
              score: 92
            }, {
              rank: 5,
              name: 'Brandon Mitchell',
              branch: 'Downtown Metro',
              revenue: '$348K',
              loans: 15,
              pullThrough: '86%',
              avgLoan: '$398K',
              trend: '+12%',
              score: 90
            }, {
              rank: 6,
              name: 'Aisha Johnson',
              branch: 'Suburban West',
              revenue: '$334K',
              loans: 14,
              pullThrough: '85%',
              avgLoan: '$392K',
              trend: '+10%',
              score: 89
            }, {
              rank: 7,
              name: 'Tyler Okonkwo',
              branch: 'North Region HQ',
              revenue: '$321K',
              loans: 14,
              pullThrough: '85%',
              avgLoan: '$385K',
              trend: '+9%',
              score: 88
            }, {
              rank: 8,
              name: 'Hannah Bergstrom',
              branch: 'Coastal Division',
              revenue: '$315K',
              loans: 13,
              pullThrough: '85%',
              avgLoan: '$378K',
              trend: '+8%',
              score: 87
            }, {
              rank: 9,
              name: 'Rafael Santos',
              branch: 'East Valley',
              revenue: '$308K',
              loans: 13,
              pullThrough: '86%',
              avgLoan: '$372K',
              trend: '+11%',
              score: 87
            }, {
              rank: 10,
              name: 'Megan O\'Brien',
              branch: 'Downtown Metro',
              revenue: '$302K',
              loans: 12,
              pullThrough: '87%',
              avgLoan: '$365K',
              trend: '+7%',
              score: 86
            }] : selectedTier === 'middle' ? [{
              rank: 1,
              name: 'Jordan Blackwell',
              branch: 'East Valley',
              revenue: '$285K',
              loans: 12,
              pullThrough: '81%',
              avgLoan: '$356K',
              trend: '+8%',
              score: 78
            }, {
              rank: 2,
              name: 'Fatima Al-Hassan',
              branch: 'Downtown Metro',
              revenue: '$272K',
              loans: 12,
              pullThrough: '80%',
              avgLoan: '$340K',
              trend: '+6%',
              score: 76
            }, {
              rank: 3,
              name: 'Trevor Lindqvist',
              branch: 'Suburban West',
              revenue: '$258K',
              loans: 11,
              pullThrough: '78%',
              avgLoan: '$328K',
              trend: '+5%',
              score: 74
            }, {
              rank: 4,
              name: 'Carmen Delgado',
              branch: 'North Region HQ',
              revenue: '$245K',
              loans: 11,
              pullThrough: '77%',
              avgLoan: '$318K',
              trend: '+4%',
              score: 73
            }, {
              rank: 5,
              name: 'Austin Porter',
              branch: 'East Valley',
              revenue: '$232K',
              loans: 10,
              pullThrough: '76%',
              avgLoan: '$310K',
              trend: '+3%',
              score: 72
            }, {
              rank: 6,
              name: 'Destiny Jackson',
              branch: 'Coastal Division',
              revenue: '$218K',
              loans: 10,
              pullThrough: '75%',
              avgLoan: '$298K',
              trend: '+2%',
              score: 71
            }, {
              rank: 7,
              name: 'Blake Rasmussen',
              branch: 'Downtown Metro',
              revenue: '$205K',
              loans: 9,
              pullThrough: '74%',
              avgLoan: '$285K',
              trend: '+1%',
              score: 70
            }, {
              rank: 8,
              name: 'Yuki Tanaka',
              branch: 'Suburban West',
              revenue: '$198K',
              loans: 9,
              pullThrough: '73%',
              avgLoan: '$278K',
              trend: '0%',
              score: 69
            }, {
              rank: 9,
              name: 'Cameron Fields',
              branch: 'South County',
              revenue: '$185K',
              loans: 8,
              pullThrough: '72%',
              avgLoan: '$265K',
              trend: '-1%',
              score: 68
            }, {
              rank: 10,
              name: 'Aaliyah Brown',
              branch: 'Midtown Central',
              revenue: '$172K',
              loans: 8,
              pullThrough: '71%',
              avgLoan: '$258K',
              trend: '-2%',
              score: 67
            }] : [{
              rank: 1,
              name: 'Kyle Morrison',
              branch: 'Harbor District',
              revenue: '$142K',
              loans: 6,
              pullThrough: '68%',
              avgLoan: '$236K',
              trend: '-8%',
              score: 58
            }, {
              rank: 2,
              name: 'Shaniqua Davis',
              branch: 'Old Town',
              revenue: '$135K',
              loans: 6,
              pullThrough: '66%',
              avgLoan: '$225K',
              trend: '-10%',
              score: 55
            }, {
              rank: 3,
              name: 'Patrick O\'Malley',
              branch: 'Lakeside',
              revenue: '$128K',
              loans: 5,
              pullThrough: '65%',
              avgLoan: '$218K',
              trend: '-12%',
              score: 52
            }, {
              rank: 4,
              name: 'Rosa Gutierrez',
              branch: 'Airport Corridor',
              revenue: '$118K',
              loans: 5,
              pullThrough: '63%',
              avgLoan: '$210K',
              trend: '-15%',
              score: 48
            }, {
              rank: 5,
              name: 'Bradley Stone',
              branch: 'Tech Park',
              revenue: '$105K',
              loans: 4,
              pullThrough: '61%',
              avgLoan: '$198K',
              trend: '-18%',
              score: 45
            }, {
              rank: 6,
              name: 'Tameka Robinson',
              branch: 'Riverside',
              revenue: '$95K',
              loans: 4,
              pullThrough: '58%',
              avgLoan: '$185K',
              trend: '-20%',
              score: 42
            }, {
              rank: 7,
              name: 'Scott Nielsen',
              branch: 'Mountain View',
              revenue: '$82K',
              loans: 3,
              pullThrough: '55%',
              avgLoan: '$168K',
              trend: '-22%',
              score: 38
            }]).map(lo => <div key={lo.rank} className={`flex items-center justify-between py-3 px-4 rounded-xl border transition-all hover:shadow-md cursor-pointer ${selectedTier === 'top' ? 'bg-white dark:bg-slate-900/50 border-emerald-100 dark:border-emerald-900/30 hover:border-emerald-300' : selectedTier === 'middle' ? 'bg-white dark:bg-slate-900/50 border-amber-100 dark:border-amber-900/30 hover:border-amber-300' : 'bg-white dark:bg-slate-900/50 border-rose-100 dark:border-rose-900/30 hover:border-rose-300'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${selectedTier === 'top' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400' : selectedTier === 'middle' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-400'}`}>
                        {lo.score}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{lo.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{lo.branch}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-5 text-sm">
                      <div className="text-right">
                        <p className="font-semibold text-slate-900 dark:text-white">{lo.revenue}</p>
                        <p className="text-[10px] text-slate-400">revenue</p>
                      </div>
                      <div className="text-right">
                        <p className="text-slate-700 dark:text-slate-300">{lo.loans}</p>
                        <p className="text-[10px] text-slate-400">loans</p>
                      </div>
                      <div className="text-right">
                        <p className={`font-medium ${selectedTier === 'top' ? 'text-emerald-600' : selectedTier === 'middle' ? 'text-amber-600' : 'text-rose-600'}`}>{lo.pullThrough}</p>
                        <p className="text-[10px] text-slate-400">pull-thru</p>
                      </div>
                      <div className="text-right">
                        <p className="text-slate-600 dark:text-slate-400">{lo.avgLoan}</p>
                        <p className="text-[10px] text-slate-400">avg loan</p>
                      </div>
                      <div className="text-right w-14">
                        <p className={`font-medium ${lo.trend.startsWith('+') ? 'text-emerald-600' : lo.trend === '0%' ? 'text-slate-500' : 'text-rose-600'}`}>{lo.trend}</p>
                        <p className="text-[10px] text-slate-400">YoY</p>
                      </div>
                    </div>
                  </div>)}
              </div>

              {/* Coaching Insights for Bottom Tier */}
              {selectedTier === 'bottom' && <div className="bg-rose-50/30 dark:bg-rose-900/15 border border-rose-200/40 dark:border-rose-800/30 rounded-xl p-4 mt-4">
                  <h4 className="text-sm font-semibold text-rose-700 dark:text-rose-400 mb-2 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    Coaching Recommendations
                  </h4>
                  <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1.5">
                    <li>• <strong>Patricia Young:</strong> Schedule pipeline review — lead quality concerns</li>
                    <li>• <strong>Daniel Scott:</strong> Assign to top performer shadow program</li>
                    <li>• <strong>Michelle King:</strong> Consider territory reassignment to higher-volume area</li>
                    <li>• <strong>Bottom 3 LOs:</strong> Mandatory training on pre-qualification process</li>
                  </ul>
                </div>}
            </div>}

          {/* Trends Tab */}
          {!selectedBranch && topTieringTab === 'trends' && <div className="space-y-6">
              <div className="bg-slate-50/30 dark:bg-slate-800/15 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Monthly Revenue by Tier (2024)</h4>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-400">Total YTD:</span>
                    <span className="font-semibold text-slate-900 dark:text-white">$14.58M</span>
                  </div>
                </div>
                <div className="h-52 flex items-end gap-1.5">
                  {[{
                month: 'Jan',
                top: 620,
                mid: 280,
                bot: 200
              }, {
                month: 'Feb',
                top: 680,
                mid: 300,
                bot: 210
              }, {
                month: 'Mar',
                top: 720,
                mid: 320,
                bot: 220
              }, {
                month: 'Apr',
                top: 690,
                mid: 310,
                bot: 215
              }, {
                month: 'May',
                top: 750,
                mid: 340,
                bot: 230
              }, {
                month: 'Jun',
                top: 810,
                mid: 360,
                bot: 245
              }, {
                month: 'Jul',
                top: 780,
                mid: 350,
                bot: 240
              }, {
                month: 'Aug',
                top: 850,
                mid: 380,
                bot: 260
              }, {
                month: 'Sep',
                top: 820,
                mid: 370,
                bot: 255
              }, {
                month: 'Oct',
                top: 890,
                mid: 400,
                bot: 275
              }, {
                month: 'Nov',
                top: 920,
                mid: 410,
                bot: 285
              }, {
                month: 'Dec',
                top: 980,
                mid: 430,
                bot: 305
              }].map((data, idx) => {
                const total = data.top + data.mid + data.bot;
                const maxTotal = 1715;
                return <motion.div key={data.month} className="flex-1 flex flex-col items-center gap-1.5 group cursor-pointer" initial={{
                  opacity: 0,
                  y: 20
                }} animate={{
                  opacity: 1,
                  y: 0
                }} transition={{
                  delay: idx * 0.05,
                  duration: 0.4
                }}>
                        <div className="relative w-full">
                          {/* Tooltip on hover */}
                          <div className="absolute -top-16 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 dark:bg-slate-700 text-white text-[10px] px-2 py-1.5 rounded-lg whitespace-nowrap z-10 pointer-events-none">
                            <div className="font-medium mb-1">{data.month} 2024</div>
                            <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 bg-emerald-400 rounded-full" /> ${(data.top / 1000).toFixed(1)}M</div>
                            <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 bg-amber-400 rounded-full" /> ${(data.mid / 1000).toFixed(1)}M</div>
                            <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 bg-rose-400 rounded-full" /> ${(data.bot / 1000).toFixed(1)}M</div>
                            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full border-4 border-transparent border-t-slate-900 dark:border-t-slate-700" />
                          </div>
                          <div className="w-full flex flex-col gap-0.5 rounded-lg overflow-hidden" style={{
                      height: `${total / maxTotal * 180}px`
                    }}>
                            <motion.div className="bg-gradient-to-t from-emerald-600 to-emerald-400 group-hover:from-emerald-500 group-hover:to-emerald-300 transition-colors" initial={{
                        height: 0
                      }} animate={{
                        height: `${data.top / total * 100}%`
                      }} transition={{
                        delay: idx * 0.05 + 0.2,
                        duration: 0.5,
                        ease: "easeOut"
                      }} />
                            <motion.div className="bg-gradient-to-t from-amber-600 to-amber-400 group-hover:from-amber-500 group-hover:to-amber-300 transition-colors" initial={{
                        height: 0
                      }} animate={{
                        height: `${data.mid / total * 100}%`
                      }} transition={{
                        delay: idx * 0.05 + 0.3,
                        duration: 0.5,
                        ease: "easeOut"
                      }} />
                            <motion.div className="bg-gradient-to-t from-rose-600 to-rose-400 group-hover:from-rose-500 group-hover:to-rose-300 transition-colors" initial={{
                        height: 0
                      }} animate={{
                        height: `${data.bot / total * 100}%`
                      }} transition={{
                        delay: idx * 0.05 + 0.4,
                        duration: 0.5,
                        ease: "easeOut"
                      }} />
                          </div>
                        </div>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">{data.month}</span>
                      </motion.div>;
              })}
                </div>
                <div className="flex justify-center gap-8 mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
                  <span className="flex items-center gap-2 text-xs"><div className="w-3 h-3 bg-gradient-to-t from-emerald-600 to-emerald-400 rounded" /> <span className="text-slate-600 dark:text-slate-400">Top Tier</span> <span className="font-semibold text-emerald-600">$8.10M</span></span>
                  <span className="flex items-center gap-2 text-xs"><div className="w-3 h-3 bg-gradient-to-t from-amber-600 to-amber-400 rounded" /> <span className="text-slate-600 dark:text-slate-400">Middle</span> <span className="font-semibold text-amber-600">$3.57M</span></span>
                  <span className="flex items-center gap-2 text-xs"><div className="w-3 h-3 bg-gradient-to-t from-rose-600 to-rose-400 rounded" /> <span className="text-slate-600 dark:text-slate-400">Bottom</span> <span className="font-semibold text-rose-600">$2.90M</span></span>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <motion.div initial={{
              opacity: 0,
              x: -20
            }} animate={{
              opacity: 1,
              x: 0
            }} transition={{
              delay: 0.3
            }} className="bg-white dark:bg-slate-800/50 rounded-xl p-5 border border-slate-200 dark:border-slate-700">
                  <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">YoY Growth by Tier</h4>
                  <div className="space-y-4">
                    {[{
                  tier: 'Top Tier',
                  growth: 18.2,
                  color: 'emerald'
                }, {
                  tier: 'Second Tier',
                  growth: 9.5,
                  color: 'amber'
                }, {
                  tier: 'Bottom Tier',
                  growth: -2.3,
                  color: 'rose'
                }].map((item, idx) => <motion.div key={item.tier} className="space-y-1.5" initial={{
                  opacity: 0,
                  x: -10
                }} animate={{
                  opacity: 1,
                  x: 0
                }} transition={{
                  delay: 0.4 + idx * 0.1
                }}>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-slate-600 dark:text-slate-400">{item.tier}</span>
                          <span className={`font-bold ${item.growth > 0 ? `text-${item.color}-600` : 'text-rose-600'}`}>
                            {item.growth > 0 ? '+' : ''}{item.growth}%
                          </span>
                        </div>
                        <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                          <motion.div className={`h-full rounded-full ${item.color === 'emerald' ? 'bg-emerald-500' : item.color === 'amber' ? 'bg-amber-500' : 'bg-rose-500'}`} initial={{
                      width: 0
                    }} animate={{
                      width: `${Math.abs(item.growth) * 4}%`
                    }} transition={{
                      delay: 0.5 + idx * 0.1,
                      duration: 0.6
                    }} />
                        </div>
                      </motion.div>)}
                  </div>
                </motion.div>
                <motion.div initial={{
              opacity: 0,
              x: 20
            }} animate={{
              opacity: 1,
              x: 0
            }} transition={{
              delay: 0.3
            }} className="bg-white dark:bg-slate-800/50 rounded-xl p-5 border border-slate-200 dark:border-slate-700">
                  <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">Q4 Forecast</h4>
                  <div className="space-y-4">
                    {[{
                  metric: 'Projected Revenue',
                  value: '$4.2M',
                  icon: DollarSign,
                  progress: 87
                }, {
                  metric: 'Expected Loans',
                  value: '198',
                  icon: FileCheck,
                  progress: 92
                }, {
                  metric: 'Target Achievement',
                  value: '112%',
                  icon: Target,
                  progress: 100
                }].map((item, idx) => <motion.div key={item.metric} initial={{
                  opacity: 0,
                  y: 10
                }} animate={{
                  opacity: 1,
                  y: 0
                }} transition={{
                  delay: 0.4 + idx * 0.1
                }} className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
                          <item.icon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-slate-500 dark:text-slate-400">{item.metric}</span>
                            <span className="text-sm font-bold text-slate-900 dark:text-white">{item.value}</span>
                          </div>
                          <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                            <motion.div className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full" initial={{
                        width: 0
                      }} animate={{
                        width: `${item.progress}%`
                      }} transition={{
                        delay: 0.5 + idx * 0.1,
                        duration: 0.6
                      }} />
                          </div>
                        </div>
                      </motion.div>)}
                  </div>
                </motion.div>
              </div>
            </div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

