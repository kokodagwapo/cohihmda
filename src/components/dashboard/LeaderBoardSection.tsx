import { useState, useMemo } from 'react';
import { ArrowUp, ArrowDown, ChevronUp, Medal, Rocket, Timer, ShieldCheck, Gauge, CircleCheck, Zap, X, CalendarDays, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLeaderboardData, LeaderboardLeader } from '@/hooks/useLeaderboardData';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';

// Extended timeframe types
type TimeframeType = 'WTD' | 'MTD' | 'QTD' | 'LM' | 'LQ' | 'LY' | 'custom';

interface LeaderBoardSectionProps {
  dateFilter: 'today' | 'mtd' | 'ytd' | 'custom';
  selectedTenantId?: string | null;
}

// Display labels for timeframes
const timeframeLabels: Record<TimeframeType, string> = {
  'WTD': 'Week-to-Date',
  'MTD': 'Month-to-Date',
  'QTD': 'Quarter-to-Date',
  'LM': 'Last Month',
  'LQ': 'Last Quarter',
  'LY': 'Last Year',
  'custom': 'Custom Range'
};

// Short labels for buttons
const timeframeShortLabels: Record<TimeframeType, string> = {
  'WTD': 'WTD',
  'MTD': 'MTD',
  'QTD': 'QTD',
  'LM': 'Last Mo',
  'LQ': 'Last Qtr',
  'LY': 'Last Yr',
  'custom': 'Custom'
};

export const LeaderBoardSection = ({ dateFilter, selectedTenantId }: LeaderBoardSectionProps) => {
  const [timeframe, setTimeframe] = useState<TimeframeType>('MTD');
  const [scope, setScope] = useState<'All' | 'Branch' | 'Team'>('All');
  const [selectedLeader, setSelectedLeader] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [customDateRange, setCustomDateRange] = useState<{ start: Date | null; end: Date | null }>({ 
    start: null, 
    end: null 
  });
  const [calendarOpen, setCalendarOpen] = useState(false);
  
  // Pass scope filter to API
  const scopeMap: Record<'All' | 'Branch' | 'Team', 'all' | 'branch' | 'team'> = {
    'All': 'all',
    'Branch': 'branch', 
    'Team': 'team'
  };
  
  // Calculate date range based on timeframe
  const dateRangeFilter = useMemo(() => {
    if (timeframe === 'custom' && customDateRange.start && customDateRange.end) {
      return {
        startDate: customDateRange.start.toISOString().split('T')[0],
        endDate: customDateRange.end.toISOString().split('T')[0]
      };
    }
    return undefined;
  }, [timeframe, customDateRange]);
  
  // Map timeframe to API format
  const apiTimeframe = useMemo((): 'wtd' | 'mtd' | 'qtd' | 'lm' | 'lq' | 'ly' | 'custom' => {
    if (timeframe === 'custom') return 'custom';
    return timeframe.toLowerCase() as 'wtd' | 'mtd' | 'qtd' | 'lm' | 'lq' | 'ly';
  }, [timeframe]);
  
  const { leaderboardData, loading: leaderboardLoading } = useLeaderboardData(
    apiTimeframe, 
    selectedTenantId,
    { 
      scope: scopeMap[scope],
      startDate: dateRangeFilter?.startDate,
      endDate: dateRangeFilter?.endDate
    }
  );
  
  // Get display label for current timeframe
  const getTimeframeDisplayLabel = () => {
    if (timeframe === 'custom' && customDateRange.start && customDateRange.end) {
      return `${format(customDateRange.start, 'MMM d')} - ${format(customDateRange.end, 'MMM d, yyyy')}`;
    }
    return timeframeLabels[timeframe];
  };

  // Base leader data with different timeframes (fallback)
  const baseLeadersData: LeaderboardLeader[] = [{
    id: '1',
    name: 'Sarah Chen',
    role: 'Senior LO',
    branch: 'Downtown',
    avatarUrl: undefined,
    points: 0,
    rank: 1,
    delta: 0,
    loans: 0,
    pullThru: 0,
    cycleTime: 0,
    revenue: '$0M',
    badges: [],
    streakDays: 0
  }, {
    id: '2',
    name: 'Michael Rodriguez',
    role: 'Branch Manager',
    branch: 'Westside',
    avatarUrl: undefined,
    points: 0,
    rank: 2,
    delta: 0,
    loans: 0,
    pullThru: 0,
    cycleTime: 0,
    revenue: '$0M',
    badges: [],
    streakDays: 0
  }, {
    id: '3',
    name: 'Emily Johnson',
    role: 'Senior LO',
    branch: 'North Branch',
    avatarUrl: undefined,
    points: 0,
    rank: 3,
    delta: 0,
    loans: 0,
    pullThru: 0,
    cycleTime: 0,
    revenue: '$0M',
    badges: [],
    streakDays: 0
  }, {
    id: '4',
    name: 'David Kim',
    role: 'Loan Officer',
    branch: 'East Valley',
    avatarUrl: undefined,
    points: 0,
    rank: 4,
    delta: 0,
    loans: 0,
    pullThru: 0,
    cycleTime: 0,
    revenue: '$0M',
    badges: [],
    streakDays: 0
  }, {
    id: '5',
    name: 'Jessica Martinez',
    role: 'Senior LO',
    branch: 'Downtown',
    avatarUrl: undefined,
    points: 0,
    rank: 5,
    delta: 0,
    loans: 0,
    pullThru: 0,
    cycleTime: 0,
    revenue: '$0M',
    badges: [],
    streakDays: 0
  }];

  // Get leader data from API or fallback
  // API now handles filtering by scope and timeframe
  const getLeadersData = (): LeaderboardLeader[] => {
    // Use API data if available, otherwise fallback to baseLeadersData
    if (leaderboardData.length > 0) {
      // Data is already filtered/calculated server-side
      return leaderboardData;
    }
    
    // Fallback to empty state display (baseLeadersData shows 0s)
    return baseLeadersData;
  };
  
  const leadersData = getLeadersData();
  const top5 = leadersData.slice(0, 5);
  const others = leadersData.slice(5); // Show all remaining entries (ranks 6-10)

  return <section className="mt-4 sm:mt-6 rounded-2xl sm:rounded-3xl bg-white dark:bg-slate-900/70 border border-slate-100 dark:border-slate-800 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-5 sm:p-6 md:p-8 space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
          <div className="relative flex-shrink-0">
            <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-gradient-to-br from-[#007AFF] to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Medal className="w-5 h-5 sm:w-7 sm:h-7 text-white" strokeWidth={1.5} />
            </div>
          </div>
          <div className="min-w-0">
            <h3 className="text-lg sm:text-2xl md:text-3xl font-extralight text-slate-900 dark:text-white mb-0.5 tracking-tight leading-tight truncate">
              Leaderboard
            </h3>
            <p className="text-[10px] sm:text-sm text-slate-600 dark:text-slate-300 font-light truncate">
              {getTimeframeDisplayLabel()} · {scope === 'All' ? 'All branches' : scope === 'Branch' ? 'By branch' : 'By team'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Primary timeframe buttons - To-Date options */}
          <div className="flex gap-1 p-1 bg-slate-100/80 dark:bg-slate-800/50 rounded-lg">
            {(['WTD', 'MTD', 'QTD'] as const).map(tf => (
              <button 
                key={tf} 
                onClick={() => setTimeframe(tf)} 
                className={`px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-md text-[11px] sm:text-xs font-medium transition-all ${
                  timeframe === tf 
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' 
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
          
          {/* Secondary timeframe buttons - Last period options */}
          <div className="flex gap-1 p-1 bg-slate-100/80 dark:bg-slate-800/50 rounded-lg">
            {(['LM', 'LQ', 'LY'] as const).map(tf => (
              <button 
                key={tf} 
                onClick={() => setTimeframe(tf)} 
                className={`px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-md text-[11px] sm:text-xs font-medium transition-all ${
                  timeframe === tf 
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' 
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
                title={timeframeLabels[tf]}
              >
                {timeframeShortLabels[tf]}
              </button>
            ))}
          </div>
          
          {/* Custom date range picker */}
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button 
                variant="outline" 
                size="sm"
                className={`gap-1.5 text-[11px] sm:text-xs h-8 sm:h-9 ${
                  timeframe === 'custom' 
                    ? 'bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600' 
                    : ''
                }`}
              >
                <CalendarDays className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">
                  {timeframe === 'custom' && customDateRange.start && customDateRange.end 
                    ? `${format(customDateRange.start, 'MMM d')} - ${format(customDateRange.end, 'MMM d')}`
                    : 'Custom'
                  }
                </span>
                <span className="sm:hidden">Custom</span>
                <ChevronDown className="w-3 h-3 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <div className="p-3 border-b border-slate-200 dark:border-slate-700">
                <p className="text-sm font-medium text-slate-900 dark:text-white">Select Date Range</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Choose start and end dates</p>
              </div>
              <Calendar
                mode="range"
                selected={{ 
                  from: customDateRange.start || undefined, 
                  to: customDateRange.end || undefined 
                }}
                onSelect={(range) => {
                  setCustomDateRange({ 
                    start: range?.from || null, 
                    end: range?.to || null 
                  });
                  if (range?.from && range?.to) {
                    setTimeframe('custom');
                    setCalendarOpen(false);
                  }
                }}
                numberOfMonths={2}
                className="rounded-md"
              />
              <div className="p-3 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => {
                    setCustomDateRange({ start: null, end: null });
                    setTimeframe('MTD');
                    setCalendarOpen(false);
                  }}
                >
                  Clear
                </Button>
                {customDateRange.start && customDateRange.end && (
                  <span className="text-xs text-slate-600 dark:text-slate-400">
                    {format(customDateRange.start, 'MMM d, yyyy')} - {format(customDateRange.end, 'MMM d, yyyy')}
                  </span>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Top 5 Grid - Mobile First */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 sm:gap-3 md:gap-4">
        {top5.map((leader, idx) => {
        const isFirst = idx === 0;
        const rankColors = ['bg-amber-500', 'bg-slate-400', 'bg-orange-400', 'bg-slate-300', 'bg-slate-300'];
        
        return (
          <div key={leader.id} onClick={() => setSelectedLeader(leader.id)} className={`group relative bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm border border-white/80 dark:border-slate-700/60 hover:bg-white/80 dark:hover:bg-slate-800/80 hover:border-white/90 dark:hover:border-slate-700/80 rounded-lg sm:rounded-xl p-3 sm:p-4 cursor-pointer transition-all duration-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_4px_12px_rgba(0,0,0,0.3)] touch-manipulation ${isFirst ? 'sm:col-span-2 lg:col-span-1' : ''}`}>
            {/* Rank indicator */}
            <div className={`absolute top-3 right-3 sm:top-4 sm:right-4 w-6 h-6 sm:w-7 sm:h-7 ${rankColors[idx]} rounded-full flex items-center justify-center shadow-sm`}>
              <span className="text-xs sm:text-sm font-semibold text-white">{idx + 1}</span>
            </div>

            {/* Content */}
            <div className="space-y-2 sm:space-y-3">
              {/* Name */}
              <div className="pr-7 sm:pr-8">
                <p className="text-sm sm:text-base font-medium text-slate-900 dark:text-white truncate">{leader.name}</p>
                <p className="text-[11px] sm:text-xs text-slate-400 dark:text-slate-500 truncate">{leader.role}</p>
              </div>

              {/* Points */}
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">{leader.points.toLocaleString()}</p>
                  <p className="text-[9px] sm:text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">points</p>
                </div>
                <div className={`flex items-center gap-0.5 text-[11px] sm:text-xs font-medium ${leader.delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                  {leader.delta >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                  {Math.abs(leader.delta)}%
                </div>
              </div>

              {/* Stats row */}
              <div className="flex items-center justify-between pt-2 sm:pt-3 border-t border-white/40 dark:border-slate-700/50">
                <div className="text-center flex-1 min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 truncate">{leader.loans}</p>
                  <p className="text-[9px] sm:text-[10px] text-slate-400 dark:text-slate-500 truncate">Loans</p>
                </div>
                <div className="w-px h-5 sm:h-6 bg-white/50 dark:bg-slate-700/50 flex-shrink-0" />
                <div className="text-center flex-1 min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 truncate">{leader.pullThru}%</p>
                  <p className="text-[9px] sm:text-[10px] text-slate-400 dark:text-slate-500 truncate">Pull-thru</p>
                </div>
                <div className="w-px h-5 sm:h-6 bg-white/50 dark:bg-slate-700/50 flex-shrink-0" />
                <div className="text-center flex-1 min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 truncate">{leader.cycleTime} days</p>
                  <p className="text-[9px] sm:text-[10px] text-slate-400 dark:text-slate-500 truncate">Cycle</p>
                </div>
              </div>

              {/* Badges - only show first badge */}
              {leader.badges.length > 0 && <div className="flex items-center gap-1.5">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/60 dark:bg-slate-700/60 backdrop-blur-sm border border-white/40 dark:border-slate-600/40 text-slate-600 dark:text-slate-300">
                    {leader.badges[0]}
                  </span>
                  {leader.badges.length > 1 && <span className="text-[10px] text-slate-400 dark:text-slate-500">+{leader.badges.length - 1}</span>}
                </div>}
            </div>
          </div>
        );
      })}
      </div>

      {/* Remaining entries - Mobile First */}
      {others.length > 0 && <div className="space-y-1">
        {others.map(leader => <div key={leader.id} onClick={() => setSelectedLeader(leader.id)} className="flex items-center gap-2 sm:gap-3 py-2 sm:py-2.5 px-2 sm:px-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors group touch-manipulation">
            <span className="w-4 sm:w-5 text-[10px] sm:text-xs font-medium text-slate-400 dark:text-slate-500 text-center flex-shrink-0">{leader.rank}</span>
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 flex-shrink-0">
              {leader.name.split(' ').map(n => n[0]).join('')}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 truncate">{leader.name}</p>
              <p className="text-[10px] sm:text-xs text-slate-400 dark:text-slate-500 truncate">{leader.branch}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300">{leader.points.toLocaleString()}</p>
              <p className={`text-[9px] sm:text-[10px] font-medium flex items-center justify-end gap-0.5 ${leader.delta >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                {leader.delta >= 0 ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />}
                {Math.abs(leader.delta)}%
              </p>
            </div>
          </div>)}
        {showAll && <div className="flex justify-center pt-2">
          <button onClick={() => setShowAll(false)} className="text-xs text-slate-500 hover:text-slate-700 font-medium transition-colors flex items-center gap-1">
            Show less <ChevronUp className="w-3.5 h-3.5" />
          </button>
        </div>}
      </div>}

      {/* Achievement Badges - Modern Minimalist - Mobile First */}
      <div className="pt-2 sm:pt-3 border-t border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-center gap-3 sm:gap-4 md:gap-6 lg:gap-8 flex-wrap">
          {[{
          name: 'Pipeline',
          Icon: Rocket,
          tooltip: 'Top 10% in loan volume'
        }, {
          name: 'Fast Funder',
          Icon: Timer,
          tooltip: 'Average cycle time 20% faster'
        }, {
          name: 'Pull-Through',
          Icon: Gauge,
          tooltip: '90%+ pull-through rate'
        }, {
          name: 'Rate Lock',
          Icon: ShieldCheck,
          tooltip: 'Best-in-class rate lock timing'
        }, {
          name: 'On-Time',
          Icon: CircleCheck,
          tooltip: '100% on-time delivery'
        }].map(badge => <div key={badge.name} className="relative group cursor-pointer touch-manipulation">
              <div className="flex flex-col items-center gap-1 sm:gap-1.5">
                <div className="w-8 h-8 sm:w-9 sm:h-9 md:w-10 md:h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center group-hover:bg-slate-900 dark:group-hover:bg-slate-700 transition-colors duration-200">
                  <badge.Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 md:w-4.5 md:h-4.5 text-slate-500 dark:text-slate-400 group-hover:text-white transition-colors duration-200" strokeWidth={1.5} />
                </div>
                <span className="text-[9px] sm:text-[10px] md:text-xs text-slate-500 dark:text-slate-400 font-medium whitespace-nowrap">
                  {badge.name}
                </span>
              </div>
              
              {/* Tooltip - Hidden on mobile, shown on hover for desktop */}
              <div className="hidden sm:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-slate-900 text-white text-[10px] rounded-md opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 whitespace-nowrap z-50 pointer-events-none">
                {badge.tooltip}
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
              </div>
            </div>)}
        </div>
      </div>

      {/* Leader Drill-Down Modal - Modern Minimalist */}
      <AnimatePresence>
        {selectedLeader && (() => {
        const leader = leadersData.find(l => l.id === selectedLeader);
        if (!leader) return null;
        return <motion.div initial={{
          opacity: 0
        }} animate={{
          opacity: 1
        }} exit={{
          opacity: 0
        }} className="fixed inset-0 bg-white/40 backdrop-blur-md z-50 flex items-center justify-center p-4" onClick={() => setSelectedLeader(null)}>
              <motion.div initial={{
            scale: 0.9,
            opacity: 0
          }} animate={{
            scale: 1,
            opacity: 1
          }} exit={{
            scale: 0.9,
            opacity: 0
          }} transition={{
            type: "spring",
            damping: 25,
            stiffness: 300
          }} onClick={e => e.stopPropagation()} className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200/50 dark:border-slate-700/50">
                {/* Compact Header */}
                <div className="p-4 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white font-bold text-sm shadow-lg">
                        {leader.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div>
                        <h2 className="text-lg sm:text-xl font-extralight text-slate-900 dark:text-white tracking-tight leading-[1.05]">{leader.name}</h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{leader.role} · {leader.branch}</p>
                      </div>
                    </div>
                    <button onClick={() => setSelectedLeader(null)} className="w-8 h-8 rounded-full bg-white/90 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 backdrop-blur-sm flex items-center justify-center transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-1">
                      <X className="w-4 h-4 text-slate-500 dark:text-slate-400" strokeWidth={1.5} />
                    </button>
                  </div>
                  
                  {/* Points & Delta */}
                  <div className="flex items-center gap-2 mt-3">
                    <span className="text-2xl font-light text-slate-900 dark:text-white tracking-tight">{leader.points.toLocaleString()}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">pts</span>
                    <span className={`ml-auto text-xs font-light px-2 py-0.5 rounded-full ${leader.delta >= 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'}`}>
                      {leader.delta >= 0 ? '↑' : '↓'} {Math.abs(leader.delta)}%
                    </span>
                  </div>
                </div>

                {/* Compact Content */}
                <div className="p-4 space-y-4">
                  {/* Badges Row */}
                  {leader.badges.length > 0 && <div className="flex flex-wrap gap-1.5">
                      {leader.badges.map(badge => <span key={badge} className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {badge}
                        </span>)}
                    </div>}

                  {/* Metrics Grid - Compact */}
                  <div className="grid grid-cols-4 gap-2">
                    <div className="text-center p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                      <p className="text-lg font-light text-slate-900 dark:text-white tracking-tight">{leader.loans}</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">Loans</p>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                      <p className="text-lg font-light text-slate-900 dark:text-white tracking-tight">{leader.pullThru}%</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">Pull-thru</p>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                      <p className="text-lg font-light text-slate-900 dark:text-white tracking-tight">{leader.cycleTime} days</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">Cycle</p>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                      <p className="text-lg font-light text-emerald-600 dark:text-emerald-400 tracking-tight">{leader.revenue}</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">Revenue</p>
                    </div>
                  </div>

                  {/* Quick Stats Row */}
                  <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 py-2 border-t border-slate-100 dark:border-slate-800">
                    <span>Rank #{leader.rank}</span>
                    <span>{leader.streakDays} day streak</span>
                    <span>{timeframe}</span>
                  </div>

                  {/* AI Insight - Compact */}
                  <div className="p-3 rounded-xl bg-gradient-to-br from-emerald-50 to-blue-50 dark:from-emerald-950/30 dark:to-blue-950/30 border border-emerald-100 dark:border-emerald-900/30">
                    <div className="flex items-start gap-2">
                      <Zap className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
                      <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">
                        {leader.rank === 1 ? `Top performer with ${leader.delta}% improvement. Strong momentum across all metrics.` : leader.rank <= 3 ? `Strong ${leader.pullThru}% pull-through and ${leader.cycleTime} days cycle. Consider for mentorship.` : `${leader.loans} loans closed. Opportunity to improve pull-through rate.`}
                      </p>
                    </div>
                  </div>
                </div>
              </motion.div>
            </motion.div>;
      })()}
      </AnimatePresence>
    </section>;
};

