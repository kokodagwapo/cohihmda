import { useState } from 'react';
import { BarChart3, Share2, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';
import { useSalesData } from '@/hooks/useSalesData';
import { CompanyDetailView } from './CompanyDetailView';

interface SalesViewProps {
  onTabChange: (tab: 'company' | 'sales' | 'ops') => void;
}

export const SalesView = ({ onTabChange }: SalesViewProps) => {
  const [showDetailView, setShowDetailView] = useState(false);
  const [year, setYear] = useState(2025);
  const { companyOverviewData } = useSalesData();

  // Show detail view if requested
  if (showDetailView) {
    return <CompanyDetailView onBack={() => setShowDetailView(false)} onTabChange={onTabChange} />;
  }

  // Helper to format volume
  const formatVolume = (volume: number) => {
    if (volume >= 1000000) return `$${(volume / 1000000).toFixed(1)}M`;
    if (volume >= 1000) return `$${(volume / 1000).toFixed(0)}K`;
    return `$${volume.toFixed(0)}`;
  };

  // Summary cards data from API or fallback
  const summaryCards = [{
    title: 'Active Loans',
    count: companyOverviewData?.activeLoans?.count || 0,
    volume: formatVolume(companyOverviewData?.activeLoans?.volume || 0),
    wac: `${(companyOverviewData?.activeLoans?.avgInterestRate || 0).toFixed(3)}%`,
    definition: 'Active Loans are defined as any loan with an Application Date excluding originated and finalized adverse loans.'
  }, {
    title: 'Submitted Loans MTD',
    count: companyOverviewData?.submittedMTD?.count || 0,
    volume: formatVolume(companyOverviewData?.submittedMTD?.volume || 0),
    wac: `${(companyOverviewData?.submittedMTD?.avgInterestRate || 0).toFixed(3)}%`,
    definition: 'Submitted Loans Month to Date are defined as any loan with a Submittal Date in the current month regardless of loan status.'
  }, {
    title: 'Funded Loans MTD',
    count: companyOverviewData?.fundedMTD?.count || 0,
    volume: formatVolume(companyOverviewData?.fundedMTD?.volume || 0),
    wac: `${(companyOverviewData?.fundedMTD?.avgInterestRate || 0).toFixed(3)}%`,
    definition: 'Funded Loans Month to Date are defined as any loan with a Funding Date in the current month regardless of loan status.'
  }];

  // Aging of Active Loans data from API
  const agingData = companyOverviewData?.aging ? [
    { range: '0-15 days', count: companyOverviewData.aging['0-15'] || 0 },
    { range: '16-30 days', count: companyOverviewData.aging['16-30'] || 0 },
    { range: '31-45 days', count: companyOverviewData.aging['31-45'] || 0 },
    { range: '46-60 days', count: companyOverviewData.aging['46-60'] || 0 },
    { range: '61-90 days', count: companyOverviewData.aging['61-90'] || 0 },
    { range: '> 90 days', count: companyOverviewData.aging['>90'] || 0 }
  ] : [{
    range: '0-15 days',
    count: 0
  }, {
    range: '16-30 days',
    count: 0
  }, {
    range: '31-45 days',
    count: 0
  }, {
    range: '46-60 days',
    count: 0
  }, {
    range: '61-90 days',
    count: 0
  }, {
    range: '> 90 days',
    count: 0
  }];

  // Loan Type MTD Submitted data from API
  const submittedLoanTypes = (() => {
    if (!companyOverviewData?.submittedByType) {
      return []; // Fallback empty dataset
    }
    const total = (Object.values(companyOverviewData.submittedByType) as any[]).reduce((sum: number, count: any) => sum + (Number(count) || 0), 0);
    if (total === 0) return [];
    const colors = ['#1e40af', '#3b82f6', '#059669', '#d97706', '#dc2626', '#7c3aed', '#ec4899'];
    let colorIndex = 0;
    return Object.entries(companyOverviewData.submittedByType)
      .map(([name, count]: [string, any]) => {
        const countNum: number = typeof count === 'number' ? count : (Number(count) || 0);
        return {
          name,
          value: parseFloat(((countNum / total) * 100).toFixed(1)),
          fill: colors[colorIndex++ % colors.length]
        };
      })
      .sort((a, b) => b.value - a.value);
  })();

  // Loan Type MTD Funded data from API
  const fundedLoanTypes = (() => {
    if (!companyOverviewData?.fundedByType) {
      return []; // Fallback empty dataset
    }
    const total = (Object.values(companyOverviewData.fundedByType) as any[]).reduce((sum: number, count: any) => sum + (Number(count) || 0), 0);
    if (total === 0) return [];
    const colors = ['#1e40af', '#3b82f6', '#059669', '#d97706', '#dc2626', '#7c3aed', '#ec4899'];
    let colorIndex = 0;
    return Object.entries(companyOverviewData.fundedByType)
      .map(([name, count]: [string, any]) => {
        const countNum: number = typeof count === 'number' ? count : (Number(count) || 0);
        return {
          name,
          value: parseFloat(((countNum / total) * 100).toFixed(1)),
          fill: colors[colorIndex++ % colors.length]
        };
      })
      .sort((a, b) => b.value - a.value);
  })();

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header with Navigation */}
      <div className="bg-white dark:bg-slate-900/70 rounded-xl p-3 sm:p-4 md:p-6 border border-slate-100 dark:border-slate-800 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
        <div className="mb-4 sm:mb-6 space-y-3 sm:space-y-4 pb-3 sm:pb-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
              <div className="relative flex-shrink-0">
                <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-gradient-to-br from-[#007AFF] to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                  <BarChart3 className="w-5 h-5 sm:w-7 sm:h-7 text-white" />
                </div>
              </div>
              <div className="min-w-0">
                <h3 className="text-lg sm:text-2xl md:text-3xl font-extralight text-slate-900 dark:text-white mb-0.5 tracking-tight leading-tight truncate">
                  TopTiering<sup className="text-[10px] sm:text-xs md:text-sm align-super ml-0.5 opacity-70">®</sup>
                </h3>
              </div>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/50 rounded-lg flex-shrink-0 flex-wrap">
              <button onClick={() => onTabChange('company')} className="px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium rounded-md transition-all bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm">
                Company
              </button>
              <button onClick={() => onTabChange('sales')} className="px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium rounded-md transition-all text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
                Sales
              </button>
              <button onClick={() => onTabChange('ops')} className="px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium rounded-md transition-all text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
                Ops
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Company Overview Header */}
      <div className="bg-white dark:bg-slate-900/70 rounded-xl p-3 sm:p-4 md:p-6 border border-slate-100 dark:border-slate-800 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
          <h2 className="text-lg sm:text-2xl md:text-3xl font-extralight text-slate-900 dark:text-white tracking-tight">
            Company Overview
          </h2>
          <div className="flex items-center gap-2">
            <button className="p-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg transition-colors">
              <Share2 className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            </button>
            <button className="p-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg transition-colors">
              <ChevronLeft className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            </button>
            <button onClick={() => setShowDetailView(true)} className="p-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg transition-colors">
              <ChevronRight className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            </button>
          </div>
        </div>

        {/* Year Selection */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap mb-6">
          <span className="text-[10px] sm:text-xs md:text-sm font-light text-slate-500 dark:text-slate-400">Year:</span>
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/50 rounded-lg">
            {[2025, 2024, 2023, 2022].map(y => (
              <button 
                key={y} 
                onClick={() => setYear(y)} 
                className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all tracking-tight ${
                  year === y 
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' 
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                {y}
              </button>
            ))}
          </div>
        </div>

        {/* Summary Cards Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">
          {summaryCards.map((card, idx) => (
            <motion.div 
              key={idx} 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className="bg-white dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 rounded-xl p-4 sm:p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
            >
              <h3 className="text-sm sm:text-base font-light text-slate-900 dark:text-white mb-3 sm:mb-4 tracking-tight">
                {card.title}
              </h3>
              <div className="space-y-2 sm:space-y-2.5 mb-3 sm:mb-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl sm:text-3xl md:text-4xl font-extralight text-slate-900 dark:text-white tracking-tight">
                    {card.count.toLocaleString()}
                  </span>
                </div>
                <div className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-light">
                  Volume: <span className="font-light text-slate-900 dark:text-white">{card.volume}</span>
                </div>
                <div className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-light">
                  Average Interest Rate: <span className="font-light text-slate-900 dark:text-white">{card.wac}</span>
                </div>
              </div>
              <p className="text-[10px] sm:text-xs text-slate-400 dark:text-slate-500 leading-relaxed pt-3 border-t border-slate-100 dark:border-slate-700 font-light">
                {card.definition}
              </p>
            </motion.div>
          ))}
        </div>

        {/* Charts Row - All 3 charts in one row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
          {/* Aging of Active Loans - Horizontal Bar Chart */}
          <div className="bg-white dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 rounded-xl p-3 sm:p-4 md:p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
            <h3 className="text-sm sm:text-base md:text-lg font-extralight text-slate-900 dark:text-white mb-3 sm:mb-4 tracking-tight">
              Aging of Active Loans
            </h3>
            <div className="w-full overflow-hidden flex items-start">
              <ChartContainer 
                config={{
                  count: {
                    label: "Loan Count",
                    color: "#64748b"
                  }
                }} 
                className="h-[240px] sm:h-[280px] md:h-[320px] w-full [&_.recharts-wrapper]:overflow-visible [&_.recharts-wrapper]:ml-0 [&_.recharts-cartesian-grid_line]:stroke-slate-200 dark:[&_.recharts-cartesian-grid_line]:stroke-slate-700 [&_.recharts-cartesian-axis-tick_text]:fill-slate-600 dark:[&_.recharts-cartesian-axis-tick_text]:fill-slate-400 [&_.recharts-cartesian-axis-line]:stroke-slate-600 dark:[&_.recharts-cartesian-axis-line]:stroke-slate-400 [&_.recharts-rectangle]:fill-slate-500 dark:[&_.recharts-rectangle]:fill-slate-400 [&_.recharts-rectangle]:opacity-90"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={agingData} layout="vertical" margin={{ top: 10, right: 10, left: 40, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
                    <XAxis type="number" domain={[0, 120]} tickCount={7} fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis dataKey="range" type="category" width={40} fontSize={10} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="#64748b" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            </div>
          </div>

          {/* Loan Type MTD Submitted */}
          <div className="bg-white dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 rounded-xl p-3 sm:p-4 md:p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <h3 className="text-sm sm:text-base md:text-lg font-extralight text-slate-900 dark:text-white mb-3 sm:mb-4 tracking-tight">
              Loan Type MTD Submitted
            </h3>
            <ChartContainer config={{}} className="h-[180px] sm:h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={submittedLoanTypes} cx="50%" cy="50%" innerRadius="35%" outerRadius="60%" paddingAngle={2} dataKey="value">
                    {submittedLoanTypes.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <ChartTooltip 
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0];
                        return (
                          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 shadow-lg">
                            <p className="text-xs sm:text-sm font-light text-slate-900 dark:text-white tracking-tight">
                              {data.name}: {data.value}%
                            </p>
                          </div>
                        );
                      }
                      return null;
                    }} 
                  />
                </PieChart>
              </ResponsiveContainer>
            </ChartContainer>
            <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-3 sm:mt-4 justify-center">
              {submittedLoanTypes.map((item, idx) => (
                <div key={idx} className="flex items-center gap-1 sm:gap-1.5">
                  <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: item.fill }} />
                  <span className="text-[9px] sm:text-[10px] md:text-xs text-slate-500 dark:text-slate-400 font-light">
                    {item.name}: {item.value}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Loan Type MTD Funded */}
          <div className="bg-white dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 rounded-xl p-3 sm:p-4 md:p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <h3 className="text-sm sm:text-base md:text-lg font-extralight text-slate-900 dark:text-white mb-3 sm:mb-4 tracking-tight">
              Loan Type MTD Funded
            </h3>
            <ChartContainer config={{}} className="h-[180px] sm:h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={fundedLoanTypes} cx="50%" cy="50%" innerRadius="35%" outerRadius="60%" paddingAngle={2} dataKey="value">
                    {fundedLoanTypes.map((entry, index) => (
                      <Cell key={`cell-funded-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <ChartTooltip 
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0];
                        return (
                          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 shadow-lg">
                            <p className="text-xs sm:text-sm font-light text-slate-900 dark:text-white tracking-tight">
                              {data.name}: {data.value}%
                            </p>
                          </div>
                        );
                      }
                      return null;
                    }} 
                  />
                </PieChart>
              </ResponsiveContainer>
            </ChartContainer>
            <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-3 sm:mt-4 justify-center">
              {fundedLoanTypes.map((item, idx) => (
                <div key={idx} className="flex items-center gap-1 sm:gap-1.5">
                  <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: item.fill }} />
                  <span className="text-[9px] sm:text-[10px] md:text-xs text-slate-500 dark:text-slate-400 font-light">
                    {item.name}: {item.value}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

