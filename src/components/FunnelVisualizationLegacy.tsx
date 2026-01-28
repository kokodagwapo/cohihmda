import React, { useState, useMemo } from 'react';
import { FunnelDataPoint } from '../types/funnel';
import { SlidersHorizontal, TrendingDown, ChevronDown, ChevronUp, BookOpen, X, TrendingUp, DollarSign, FileText, AlertCircle } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface FunnelVisualizationProps {
  data: FunnelDataPoint[];
  falloutData: FunnelDataPoint[];
}

// Helper to format numbers with commas (e.g., 2,511)
const formatValue = (val: number) => {
  return val.toLocaleString(undefined, { maximumFractionDigits: 0 });
};

// Helper to format currency (e.g., $2,738,043)
const formatCurrency = (val: number) => {
  return '$' + val.toLocaleString(undefined, { maximumFractionDigits: 0 });
};

export const FunnelVisualizationLegacy: React.FC<FunnelVisualizationProps> = ({ data, falloutData }) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [simulationFactor, setSimulationFactor] = useState(1); // 1.0 = 100%
  const [showMetrics, setShowMetrics] = useState(false); // Toggle for metrics visibility - hidden by default
  const [showClassicStyle, setShowClassicStyle] = useState(false); // Toggle for classic style modal
  const [isMetricsExpanded, setIsMetricsExpanded] = useState(false); // Toggle for metrics section expand/collapse
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null); // Selected layer ID for drilldown

  // Configuration for the funnel geometry
  const width = 800;
  const height = 900; 
  const centerX = width / 2;
  const topWidth = 600;
  const bottomWidth = 160;
  const stageHeight = 85; 
  const curveHeight = 16; 
  const gap = 12; 

  // Calculate conversion rates and impact metrics with proper relational formulas
  const calculateMetrics = useMemo(() => {
    const getItem = (id: string, source: FunnelDataPoint[]) => source.find(d => d.id === id);
    
    // Get all funnel stages (7 layers)
    const started = getItem('started', data);
    const respa = getItem('respa', data);
    const originated = getItem('originated', data);
    const active = getItem('active', data);
    
    // Get fallout data
    const noRespa = getItem('no-respa', falloutData);
    const withdrawn = getItem('withdrawn', falloutData);
    const denied = getItem('denied', falloutData);
    
    if (!started || !originated) return null;
    
    // Base values (original data) - use value for display metrics
    const baseStarted = started.value;
    const baseRespa = respa?.value || baseStarted * 0.98;
    const baseOriginated = originated.value;
    const baseActive = active?.value || 0;
    
    // Fallout values for display (could be units or volume depending on view)
    const baseNoRespaDisplay = noRespa?.value || 0;
    const baseWithdrawnDisplay = withdrawn?.value || 0;
    const baseDeniedDisplay = denied?.value || 0;
    
    // Get ACTUAL volume, units, and lostRevenue from fallout data
    const noRespaVolume = noRespa?.volume || 0;
    const withdrawnVolume = withdrawn?.volume || 0;
    const deniedVolume = denied?.volume || 0;
    
    const noRespaUnitsActual = noRespa?.units || 0;
    const withdrawnUnitsActual = withdrawn?.units || 0;
    const deniedUnitsActual = denied?.units || 0;
    
    // Get actual lost revenue values from data
    const noRespaLostRevenueBase = noRespa?.lostRevenue || 0;
    const withdrawnLostRevenueBase = withdrawn?.lostRevenue || 0;
    const deniedLostRevenueBase = denied?.lostRevenue || 0;
    
    // Apply simulation factor to all values
    const simStarted = baseStarted * simulationFactor;
    const simRespa = baseRespa * simulationFactor;
    const simOriginated = baseOriginated * simulationFactor;
    const simActive = baseActive * simulationFactor;
    const simNoRespaDisplay = baseNoRespaDisplay * simulationFactor;
    const simWithdrawnDisplay = baseWithdrawnDisplay * simulationFactor;
    const simDeniedDisplay = baseDeniedDisplay * simulationFactor;
    
    // Simulated VOLUMES (for revenue calculation)
    const simNoRespaVolume = noRespaVolume * simulationFactor;
    const simWithdrawnVolume = withdrawnVolume * simulationFactor;
    const simDeniedVolume = deniedVolume * simulationFactor;
    
    // Simulated UNITS
    const simNoRespaUnits = noRespaUnitsActual * simulationFactor;
    const simWithdrawnUnits = withdrawnUnitsActual * simulationFactor;
    const simDeniedUnits = deniedUnitsActual * simulationFactor;
    
    // ===== CORE CONVERSION RATES =====
    // Formula: (Output Stage / Input Stage) × 100
    
    // Start to RESPA Rate
    const startToRespaRate = simStarted > 0 ? (simRespa / simStarted) * 100 : 0;
    
    // RESPA to Originate Rate
    const respaToOriginateRate = simRespa > 0 ? (simOriginated / simRespa) * 100 : 0;
    
    // Start to Originate Rate (Overall Pull-Through)
    const startToOriginateRate = simStarted > 0 ? (simOriginated / simStarted) * 100 : 0;
    
    // Overall Conversion Rate: End-to-end funnel efficiency (Started to Originated)
    const overallConversionRate = simStarted > 0 ? (simOriginated / simStarted) * 100 : 0;
    
    // ===== FALLOUT ANALYSIS =====
    // Total Fallout = All loans that didn't convert (using display values for rates)
    const totalFalloutDisplay = simNoRespaDisplay + simWithdrawnDisplay + simDeniedDisplay;
    
    // Fallout Rate: Percentage of started loans that fell out
    const falloutRate = simStarted > 0 ? (totalFalloutDisplay / simStarted) * 100 : 0;
    
    // Withdrawal Rate: Percentage of loans withdrawn by customer
    const withdrawalRate = simStarted > 0 ? (simWithdrawnDisplay / simStarted) * 100 : 0;
    
    // Denial Rate: Percentage of loans denied
    const denialRate = simStarted > 0 ? (simDeniedDisplay / simStarted) * 100 : 0;
    
    // ===== REVENUE IMPACT =====
    // Use actual units from data
    const noRespaUnits = simNoRespaUnits;
    const withdrawnUnits = simWithdrawnUnits;
    const deniedUnits = simDeniedUnits;
    
    // Lost Revenue Opportunity: Use ACTUAL lost revenue values from data (scaled by simulation factor)
    // These are the real calculated lost revenue amounts, not estimates
    const lostRevenueFromNoRespa = noRespaLostRevenueBase * simulationFactor;
    const lostRevenueFromWithdrawals = withdrawnLostRevenueBase * simulationFactor;
    const lostRevenueFromDenials = deniedLostRevenueBase * simulationFactor;
    const totalLostRevenue = lostRevenueFromNoRespa + lostRevenueFromWithdrawals + lostRevenueFromDenials;
    
    // Total fallout volume (dollars)
    const totalFalloutVolume = simNoRespaVolume + simWithdrawnVolume + simDeniedVolume;
    
    // ===== EFFICIENCY METRICS =====
    // Active Pipeline: Loans still in process
    const activePipelineRate = simStarted > 0 ? (simActive / simStarted) * 100 : 0;
    
    // Completion Rate: Originated + Active vs Started (how much of pipeline is resolved or funded)
    const completionRate = simStarted > 0 ? ((simOriginated + simActive) / simStarted) * 100 : 0;
    
    // ===== SIMULATION IMPACT =====
    // Change from baseline
    const changeFromBase = (simulationFactor - 1) * 100;
    
    // Projected additional/lost originations
    const originationDelta = simOriginated - baseOriginated;
    
    // Impact metrics object
    const impact = {
      // Volume metrics
      totalStarted: simStarted,
      totalOriginated: simOriginated,
      totalActive: simActive,
      totalFallout: totalFalloutDisplay,
      
      // Conversion rates (%)
      startToRespaRate,
      respaToOriginateRate,
      startToOriginateRate,  // Pull-through rate
      overallConversionRate,
      
      // Fallout analysis (%)
      falloutRate,
      withdrawalRate,
      denialRate,
      
      // Revenue impact (using actual VOLUME data)
      lostRevenueFromNoRespa,
      lostRevenueFromWithdrawals,
      lostRevenueFromDenials,
      totalLostRevenue,
      
      // Unit estimates (using actual UNITS data)
      noRespaUnits,
      withdrawnUnits,
      deniedUnits,
      totalFalloutUnits: noRespaUnits + withdrawnUnits + deniedUnits,
      
      // Volume metrics for story (actual dollar volumes)
      simNoRespa: simNoRespaVolume,
      simWithdrawn: simWithdrawnVolume,
      simDenied: simDeniedVolume,
      totalFalloutVolume,
      
      // Efficiency metrics (%)
      activePipelineRate,
      completionRate,
      
      // Simulation metrics
      changeFromBase,
      originationDelta,
      simulationFactor
    };
    
    return impact;
  }, [data, falloutData, simulationFactor]);

  // Merge and Order data to match the 7-layer structure
  const processedStages = useMemo(() => {
    const getItem = (id: string, source: FunnelDataPoint[]) => source.find(d => d.id === id);

    const rawOrder = [
      getItem('started', data),           // 1. Loans Started
      getItem('no-respa', falloutData),   // 2. Loans with No RESPA Applications
      getItem('respa', data),             // 3. Loans with RESPA Applications
      getItem('originated', data),        // 4. Originated Loans
      getItem('withdrawn', falloutData),  // 5. Fallout - Withdrawn
      getItem('denied', falloutData),     // 6. Fallout - Denied
      getItem('active', data)             // 7. Loans Still Active
    ].filter(Boolean) as FunnelDataPoint[];

    // Get base values for conversion rate calculations
    const startedStage = getItem('started', data);
    const respaStage = getItem('respa', data);
    const startedValue = startedStage ? startedStage.value * simulationFactor : 0;
    const respaValue = respaStage ? respaStage.value * simulationFactor : 0;

    return rawOrder.map((point, index) => {
      const progressTop = index / rawOrder.length;
      const progressBottom = (index + 1) / rawOrder.length;

      const currentTopWidth = topWidth - (topWidth - bottomWidth) * progressTop;
      const currentBottomWidth = topWidth - (topWidth - bottomWidth) * progressBottom;
      
      const simulatedVal = point.value * simulationFactor;
      
      // Calculate conversion rate based on logical flow, not array order
      let conversionRate = null;
      let conversionRateLabel = '';
      
      if (point.id === 'respa') {
        // RESPA conversion rate: from Started
        conversionRate = startedValue > 0 ? (simulatedVal / startedValue) * 100 : 0;
        conversionRateLabel = 'From Started';
      } else if (point.id === 'originated') {
        // Originated conversion rate: from RESPA (more meaningful than from Started)
        conversionRate = respaValue > 0 ? (simulatedVal / respaValue) * 100 : 0;
        conversionRateLabel = 'From RESPA';
      } else if (point.id === 'no-respa' || point.id === 'withdrawn' || point.id === 'denied') {
        // Fallout stages: show rate from Started
        conversionRate = startedValue > 0 ? (simulatedVal / startedValue) * 100 : 0;
        conversionRateLabel = 'From Started';
      } else if (point.id === 'active') {
        // Active pipeline: show rate from Started
        conversionRate = startedValue > 0 ? (simulatedVal / startedValue) * 100 : 0;
        conversionRateLabel = 'From Started';
      }
      // 'started' stage has no conversion rate (it's the base)
      
      // Validate conversion rate - cap at 1000% to prevent display errors
      if (conversionRate !== null && (isNaN(conversionRate) || !isFinite(conversionRate) || conversionRate > 1000)) {
        console.warn(`Invalid conversion rate for ${point.id}: ${conversionRate}`);
        conversionRate = null;
      }

      return {
        ...point,
        topWidth: currentTopWidth,
        bottomWidth: currentBottomWidth,
        y: index * (stageHeight + gap) + 40, // Offset from top
        simulatedValue: simulatedVal,
        simulatedDisplay: formatValue(simulatedVal),
        conversionRate: conversionRate,
        conversionRateLabel: conversionRateLabel
      };
    });
  }, [data, falloutData, simulationFactor]);

  // Helper to create the 3D funnel section path
  const getSectionPath = (x: number, y: number, wTop: number, wBottom: number, h: number) => {
    const halfTop = wTop / 2;
    const halfBottom = wBottom / 2;
    
    // Path for the Body
    const bodyPath = `
      M ${x - halfTop}, ${y}
      L ${x - halfBottom}, ${y + h}
      Q ${x}, ${y + h + curveHeight} ${x + halfBottom}, ${y + h}
      L ${x + halfTop}, ${y}
      Q ${x}, ${y + curveHeight} ${x - halfTop}, ${y}
      Z
    `;

    // Path for the Top "Lid" (Ellipse)
    const topPath = `
      M ${x - halfTop}, ${y}
      Q ${x}, ${y - curveHeight} ${x + halfTop}, ${y}
      Q ${x}, ${y + curveHeight} ${x - halfTop}, ${y}
      Z
    `;

    return { bodyPath, topPath };
  };

  const getGradientId = (id: string) => `grad-${id}`;

  return (
    <div className="w-full flex flex-col xl:flex-row gap-6 xl:gap-10 py-4 px-2 sm:px-4 md:px-6">
      
      {/* Left Column - Loan Funnel Story (Classic Style - Default) */}
      <div className="w-full xl:w-[300px] 2xl:w-[340px] flex-shrink-0 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white tracking-tight">Loan Funnel Story</h2>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Fallout analysis & revenue impact</p>
          </div>
          <button
            onClick={() => setShowClassicStyle(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/50 rounded-md transition-colors"
          >
            <BookOpen className="w-3.5 h-3.5" />
            Summary
          </button>
        </div>

        {/* Classic Style Content - Default View */}
        <div className="space-y-6">
          {/* Introduction Paragraph */}
          <p className="text-slate-600 dark:text-slate-300 text-[15px] leading-relaxed font-light tracking-tight">
            Fallout is not a cost of doing business, many times fallout is <span className="text-rose-600 dark:text-rose-400 font-medium">lost revenue opportunity</span>. The "Top of the Funnel" is first customer touch or file started. The funnel shows lost opportunities:
          </p>

          {/* Divider */}
          <div className="border-t border-slate-200 dark:border-slate-700"></div>

          {/* No RESPA Section */}
          {calculateMetrics && (
            <p className="text-slate-600 dark:text-slate-300 text-[15px] leading-relaxed font-light tracking-tight pl-6 border-l-2 border-slate-300 dark:border-slate-600">
              Loans started with no RESPA app were <strong className="text-slate-900 dark:text-white font-medium">{formatCurrency(calculateMetrics.simNoRespa)}, {formatValue(Math.round(calculateMetrics.noRespaUnits))} Units</strong>. This is potentially <strong className="text-rose-600 dark:text-rose-400 font-medium">{formatCurrency(calculateMetrics.lostRevenueFromNoRespa)}</strong> of lost revenue. The number of loans started with no RESPA app needs to be managed to ensure loan producers focus on conversion to closed loans.
            </p>
          )}

          {/* Customer Said No Section */}
          {calculateMetrics && (
            <p className="text-slate-600 dark:text-slate-300 text-[15px] leading-relaxed font-light tracking-tight pl-6 border-l-2 border-amber-400 dark:border-amber-500">
              Loans where the customer said "no" were <strong className="text-slate-900 dark:text-white font-medium">{formatCurrency(calculateMetrics.simWithdrawn)}, {formatValue(Math.round(calculateMetrics.withdrawnUnits))} Units</strong>. This is potentially <strong className="text-rose-600 dark:text-rose-400 font-medium">{formatCurrency(calculateMetrics.lostRevenueFromWithdrawals)}</strong> of lost revenue. Consider the customer "No" rate by branch and originator.
            </p>
          )}

          {/* Denied Section */}
          {calculateMetrics && (
            <p className="text-slate-600 dark:text-slate-300 text-[15px] leading-relaxed font-light tracking-tight pl-6 border-l-2 border-rose-400 dark:border-rose-500">
              Loans denied were <strong className="text-slate-900 dark:text-white font-medium">{formatCurrency(calculateMetrics.simDenied)}, {formatValue(Math.round(calculateMetrics.deniedUnits))} Units</strong>. This is potentially <strong className="text-rose-600 dark:text-rose-400 font-medium">{formatCurrency(calculateMetrics.lostRevenueFromDenials)}</strong> of lost revenue. Consider the loan type, credit box and whether borrowers were referred to credit rehabilitation and other appropriate resources.
            </p>
          )}

          {/* Divider */}
          <div className="border-t border-slate-200 dark:border-slate-700"></div>

          {/* Summary Section */}
          {calculateMetrics && (
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl px-6 py-6 border border-slate-100 dark:border-slate-700">
              <p className="text-center text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 mb-4 font-medium">Summary</p>
              <p className="text-slate-600 dark:text-slate-300 text-[15px] leading-relaxed text-center font-light tracking-tight">
                In summary, potential lost revenue was <strong className="text-rose-600 dark:text-rose-400 text-lg font-medium">{formatCurrency(calculateMetrics.totalLostRevenue)}</strong> on <strong className="text-slate-900 dark:text-white font-medium">{formatCurrency(calculateMetrics.totalFalloutVolume)}, {formatValue(Math.round(calculateMetrics.totalFalloutUnits))} Units</strong>. Also consider how much time and cost was spent on loans falling out.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Right Column - Funnel Visualization */}
      <div className="w-full xl:flex-1 flex flex-col items-center pb-0 -mb-4 sm:-mb-6 md:-mb-8">
        {/* Simulator Control */}
        <div className="w-full max-w-4xl mb-4 lg:mb-6">
          <div className="flex items-center gap-4 mb-2">
            <button 
              onClick={() => setIsMetricsExpanded(!isMetricsExpanded)}
              className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            >
              <SlidersHorizontal className="w-4 h-4" />
              Simulator
              {isMetricsExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            <div className="flex-1 flex items-center gap-3">
              <input
                type="range"
                min={50}
                max={150}
                step={5}
                value={simulationFactor * 100}
                onChange={(e) => setSimulationFactor(Number(e.target.value) / 100)}
                className="flex-1 h-1.5 rounded-full cursor-pointer accent-slate-900 dark:accent-slate-100 bg-slate-200 dark:bg-slate-700"
              />
              <span className={`text-xs font-semibold min-w-[40px] text-right ${simulationFactor > 1 ? 'text-emerald-600 dark:text-emerald-400' : simulationFactor < 1 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-600 dark:text-slate-400'}`}>
                {simulationFactor > 1 ? '+' : ''}{((simulationFactor - 1) * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        
          {/* Impact Metrics - Collapsible */}
          {calculateMetrics && isMetricsExpanded && (
            <div className="pt-4 space-y-3">
              {/* Primary Volume Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">Started</div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">{formatValue(calculateMetrics.totalStarted)}</div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">Originated</div>
                  <div className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{formatValue(calculateMetrics.totalOriginated)}</div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">Fallout</div>
                  <div className="text-sm font-semibold text-amber-600 dark:text-amber-400">{formatValue(Math.round(calculateMetrics.totalFalloutUnits))}</div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">Lost Revenue</div>
                  <div className="text-sm font-semibold text-rose-600 dark:text-rose-400">{formatCurrency(calculateMetrics.totalLostRevenue)}</div>
                </div>
              </div>

              {/* Conversion Rates */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-white dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700">
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">Conversion</div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">{calculateMetrics.overallConversionRate.toFixed(1)}%</div>
                </div>
                <div className="p-3 rounded-lg bg-white dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700">
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">Pull-Through</div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">{calculateMetrics.startToOriginateRate.toFixed(1)}%</div>
                </div>
                <div className="p-3 rounded-lg bg-white dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700">
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">Withdrawal</div>
                  <div className="text-sm font-semibold text-amber-600 dark:text-amber-400">{calculateMetrics.withdrawalRate.toFixed(1)}%</div>
                </div>
                <div className="p-3 rounded-lg bg-white dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700">
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">Denial</div>
                  <div className="text-sm font-semibold text-rose-600 dark:text-rose-400">{calculateMetrics.denialRate.toFixed(1)}%</div>
                </div>
              </div>
            </div>
          )}
        </div>

      <div className="w-full flex justify-center scale-[1.05] sm:scale-[0.95] md:scale-[0.85] lg:scale-90 xl:scale-95 origin-top -mb-6 sm:-mb-6 md:-mb-8 pb-0">
        <svg 
          viewBox={`0 0 ${width} ${height}`} 
          className="w-full max-w-5xl drop-shadow-xl overflow-visible pb-0 min-h-[350px] sm:min-h-[400px]"
          style={{ paddingBottom: 0 }}
        >
        <defs>
          {/* Custom Gradients */}
          <linearGradient id="grad-started" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#94a3b8" /> <stop offset="50%" stopColor="#64748b" /> <stop offset="100%" stopColor="#475569" />
          </linearGradient>
          
          <linearGradient id="grad-no-respa" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#e2e8f0" /> <stop offset="50%" stopColor="#cbd5e1" /> <stop offset="100%" stopColor="#94a3b8" />
          </linearGradient>

          <linearGradient id="grad-respa" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#4b5563" /> <stop offset="50%" stopColor="#374151" /> <stop offset="100%" stopColor="#1f2937" />
          </linearGradient>
          
          <linearGradient id="grad-originated" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#fbbf24" /> <stop offset="50%" stopColor="#f59e0b" /> <stop offset="100%" stopColor="#d97706" />
          </linearGradient>
          
           <linearGradient id="grad-withdrawn" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ef4444" /> <stop offset="50%" stopColor="#dc2626" /> <stop offset="100%" stopColor="#b91c1c" />
          </linearGradient>

           <linearGradient id="grad-denied" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#fca5a5" /> <stop offset="50%" stopColor="#f87171" /> <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>

          <linearGradient id="grad-active" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#60a5fa" /> <stop offset="50%" stopColor="#3b82f6" /> <stop offset="100%" stopColor="#2563eb" />
          </linearGradient>
          
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="4" stdDeviation="4" floodOpacity="0.2"/>
          </filter>
        </defs>

        {/* LAYER 1: FUNNEL SHAPES (Bottom-most layer) */}
        {processedStages.map((stage) => {
          const { bodyPath, topPath } = getSectionPath(centerX, stage.y, stage.topWidth, stage.bottomWidth, stageHeight);
          const isHovered = hoveredId === stage.id;
          
          return (
            <g 
              key={`shape-${stage.id}`}
              onMouseEnter={() => setHoveredId(stage.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => setSelectedLayerId(stage.id)}
              className="transition-transform duration-300 cursor-pointer"
              style={{ transform: isHovered ? 'scale(1.02)' : 'scale(1)', transformOrigin: 'center' }}
            >
               <path 
                d={bodyPath} 
                fill={`url(#${getGradientId(stage.id)})`}
                stroke="white" strokeWidth="2" strokeOpacity="0.5"
                filter="url(#shadow)"
              />
              <path 
                d={topPath} 
                fill={`url(#${getGradientId(stage.id)})`}
                fillOpacity="0.8"
                stroke="white" strokeWidth="1" strokeOpacity="0.3"
              />
               <ellipse 
                 cx={centerX} cy={stage.y} rx={stage.topWidth/2 * 0.9} ry={curveHeight * 0.9} 
                 fill="white" fillOpacity="0.1" pointerEvents="none"
               />
            </g>
          );
        })}

        {/* LAYER 2: LABELS & TEXT (Top-most layer) */}
        {processedStages.map((stage) => {
          const isHovered = hoveredId === stage.id;
          
          return (
            <g 
              key={`label-${stage.id}`} 
              className="pointer-events-none"
            >
              {/* Left Label Connector - Always visible */}
              <line 
                x1={centerX - stage.topWidth / 2 + 30} 
                y1={stage.y + stageHeight/2} 
                x2={180} 
                y2={stage.y + stageHeight/2} 
                stroke={stage.isFallout ? "#fca5a5" : "#94a3b8"}
                strokeWidth="1.5" 
                strokeDasharray="4 4"
                opacity="0.7"
              />

              {/* Left Label Group (Stage Name) - Always visible */}
              <foreignObject x="-10" y={stage.y + stageHeight/2 - 32} width="200" height="64" className="pointer-events-auto overflow-visible">
                 <div 
                    onMouseEnter={() => setHoveredId(stage.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={() => setSelectedLayerId(stage.id)}
                    className={`text-right pr-2 flex flex-col items-end justify-center h-full transition-transform duration-300 cursor-pointer ${isHovered ? '-translate-x-1' : ''}`}
                 >
                    <h3 className={`font-extralight text-xs sm:text-sm md:text-base leading-tight whitespace-nowrap tracking-tight ${stage.isFallout ? 'text-red-600' : 'text-slate-800 dark:text-slate-200'}`}>
                        {stage.label}
                    </h3>
                    <p className={`text-[9px] sm:text-[10px] md:text-xs mt-0.5 max-w-[180px] font-light leading-tight hidden sm:block ${stage.isFallout ? 'text-red-400' : 'text-slate-600 dark:text-slate-400'}`}>
                        {stage.isFallout ? 'Lost Revenue Opportunity' : stage.description || ''}
                    </p>
                 </div>
              </foreignObject>

              {/* Center Value Text - Wrapped in group for better click handling */}
              <g 
                onClick={() => setSelectedLayerId(stage.id)}
                onMouseEnter={() => setHoveredId(stage.id)}
                onMouseLeave={() => setHoveredId(null)}
                className="pointer-events-auto cursor-pointer"
              >
                <text
                  x={centerX}
                  y={stage.y + stageHeight / 2 + 10}
                  textAnchor="middle"
                  className="font-light fill-white"
                  style={{ fontSize: '22px', textShadow: '0 2px 6px rgba(0,0,0,0.5), 0 1px 3px rgba(0,0,0,0.3)', letterSpacing: '-0.02em' }}
                >
                  {stage.simulatedDisplay}
                </text>
              </g>
            </g>
          );
        })}
        </svg>
      </div>
      </div>

      {/* Layer Drilldown Modal */}
      <Dialog open={!!selectedLayerId} onOpenChange={(open) => !open && setSelectedLayerId(null)}>
        <DialogContent className="max-w-[90vw] sm:max-w-lg lg:max-w-xl max-h-[90vh] sm:max-h-[85vh] overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl">
          {(() => {
            const selectedLayer = processedStages.find(s => s.id === selectedLayerId);
            if (!selectedLayer || !calculateMetrics) return null;
            
            return (
              <>
                <DialogHeader className="px-3 sm:px-4 pt-3 sm:pt-4 pb-2 sm:pb-3 border-b border-slate-100 dark:border-slate-700">
                  <DialogTitle className="text-base sm:text-lg font-extralight text-slate-900 dark:text-white flex items-center gap-1.5 sm:gap-2 tracking-tight">
                    <div 
                      className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full"
                      style={{ backgroundColor: selectedLayer.color }}
                    />
                    {selectedLayer.label}
                  </DialogTitle>
                  {selectedLayer.description && (
                    <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 font-light mt-0.5">
                      {selectedLayer.description}
                    </p>
                  )}
                </DialogHeader>
                
                <div className="space-y-3 sm:space-y-4 px-3 sm:px-4 pb-3 sm:pb-4 pt-2 sm:pt-3">
                  {/* Key Metrics Grid */}
                  <div className="grid grid-cols-2 gap-2 sm:gap-3">
                    {/* Value/Count */}
                    <div className="bg-white dark:bg-slate-800/50 rounded-lg p-3 border border-slate-100 dark:border-slate-700 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                      <div className="flex items-center gap-1 mb-2">
                        <FileText className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                        <span className="text-[9px] sm:text-[10px] font-light text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                          Count
                        </span>
                      </div>
                      <div className="text-xl sm:text-2xl font-extralight text-slate-900 dark:text-white tracking-tight mb-0.5">
                        {formatValue(selectedLayer.simulatedValue)}
                      </div>
                      <div className="text-[9px] sm:text-[10px] text-slate-400 dark:text-slate-500 font-light">
                        {selectedLayer.valueDisplay} (base)
                      </div>
                    </div>

                    {/* Volume */}
                    {selectedLayer.volume !== undefined && (
                      <div className="bg-white dark:bg-slate-800/50 rounded-lg p-3 border border-slate-100 dark:border-slate-700 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                        <div className="flex items-center gap-1 mb-2">
                          <DollarSign className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                          <span className="text-[9px] sm:text-[10px] font-light text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            Volume
                          </span>
                        </div>
                        <div className="text-xl sm:text-2xl font-extralight text-slate-900 dark:text-white tracking-tight mb-0.5">
                          {formatCurrency(selectedLayer.volume * simulationFactor)}
                        </div>
                        <div className="text-[9px] sm:text-[10px] text-slate-400 dark:text-slate-500 font-light">
                          {formatCurrency(selectedLayer.volume)} (base)
                        </div>
                      </div>
                    )}

                    {/* Units - Only show if different from Count */}
                    {selectedLayer.units !== undefined && Math.round(selectedLayer.units) !== Math.round(selectedLayer.value) && (
                      <div className="bg-white dark:bg-slate-800/50 rounded-lg p-3 border border-slate-100 dark:border-slate-700 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                        <div className="flex items-center gap-1 mb-2">
                          <TrendingUp className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                          <span className="text-[9px] sm:text-[10px] font-light text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            Units
                          </span>
                        </div>
                        <div className="text-xl sm:text-2xl font-extralight text-slate-900 dark:text-white tracking-tight mb-0.5">
                          {formatValue(Math.round(selectedLayer.units * simulationFactor))}
                        </div>
                        <div className="text-[9px] sm:text-[10px] text-slate-400 dark:text-slate-500 font-light">
                          {formatValue(Math.round(selectedLayer.units))} (base)
                        </div>
                      </div>
                    )}

                    {/* Lost Revenue (for fallout stages) */}
                    {selectedLayer.isFallout && selectedLayer.lostRevenue !== undefined && (
                      <div className="bg-white dark:bg-slate-800/50 rounded-lg p-3 border border-slate-100 dark:border-slate-700 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                        <div className="flex items-center gap-1 mb-2">
                          <AlertCircle className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                          <span className="text-[9px] sm:text-[10px] font-light text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            Lost Revenue
                          </span>
                        </div>
                        <div className="text-xl sm:text-2xl font-extralight text-rose-600 dark:text-rose-400 tracking-tight mb-0.5">
                          {formatCurrency(selectedLayer.lostRevenue * simulationFactor)}
                        </div>
                        <div className="text-[9px] sm:text-[10px] text-slate-400 dark:text-slate-500 font-light">
                          {formatCurrency(selectedLayer.lostRevenue)} (base)
                        </div>
                      </div>
                    )}

                    {/* Conversion Rate */}
                    {selectedLayer.conversionRate !== null && selectedLayer.conversionRate !== undefined && !isNaN(selectedLayer.conversionRate) && isFinite(selectedLayer.conversionRate) && (
                      <div className="bg-white dark:bg-slate-800/50 rounded-lg p-3 border border-slate-100 dark:border-slate-700 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                        <div className="flex items-center gap-1 mb-2">
                          <TrendingDown className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                          <span className="text-[9px] sm:text-[10px] font-light text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            Conversion Rate
                          </span>
                        </div>
                        <div className="text-xl sm:text-2xl font-extralight text-slate-900 dark:text-white tracking-tight mb-0.5">
                          {selectedLayer.conversionRate > 1000 ? '>1000%' : selectedLayer.conversionRate.toFixed(1) + '%'}
                        </div>
                        <div className="text-[9px] sm:text-[10px] text-slate-400 dark:text-slate-500 font-light">
                          {selectedLayer.conversionRateLabel || 'From previous stage'}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Stage-Specific Details */}
                  <div className="bg-slate-50 dark:bg-slate-800/30 rounded-lg p-3 sm:p-4 border border-slate-100 dark:border-slate-700">
                    <h3 className="text-[10px] sm:text-xs font-light text-slate-900 dark:text-white mb-2 sm:mb-3 uppercase tracking-wider">
                      Stage Details
                    </h3>
                    <div className="space-y-2 sm:space-y-3 text-xs sm:text-sm">
                      {selectedLayer.id === 'started' && (
                        <div className="space-y-2 sm:space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                            <div>
                              <p className="text-slate-700 dark:text-slate-300 mb-0.5 font-light text-xs sm:text-sm">
                                <span className="font-light">Total Started:</span> {formatValue(calculateMetrics.totalStarted)} loans
                              </p>
                              <p className="text-slate-400 dark:text-slate-500 text-[9px] sm:text-[10px] font-light">
                                Base: {formatValue(selectedLayer.value)} loans
                              </p>
                            </div>
                            {selectedLayer.volume !== undefined && (
                              <div>
                                <p className="text-slate-700 dark:text-slate-300 mb-0.5 font-light text-xs sm:text-sm">
                                  <span className="font-light">Total Volume:</span> {formatCurrency(selectedLayer.volume * simulationFactor)}
                                </p>
                                <p className="text-slate-400 dark:text-slate-500 text-[9px] sm:text-[10px] font-light">
                                  Base: {formatCurrency(selectedLayer.volume)}
                                </p>
                              </div>
                            )}
                            {selectedLayer.units !== undefined && (
                              <div>
                                <p className="text-slate-700 dark:text-slate-300 mb-0.5 font-light text-xs sm:text-sm">
                                  <span className="font-light">Total Units:</span> {formatValue(Math.round(selectedLayer.units * simulationFactor))}
                                </p>
                                <p className="text-slate-400 dark:text-slate-500 text-[9px] sm:text-[10px] font-light">
                                  Base: {formatValue(Math.round(selectedLayer.units))}
                                </p>
                              </div>
                            )}
                          </div>
                          
                          <div className="pt-2 sm:pt-3 border-t border-slate-200 dark:border-slate-700">
                            <h4 className="text-[9px] sm:text-[10px] font-light text-slate-700 dark:text-slate-300 mb-2 sm:mb-3 uppercase tracking-wider">
                              Funnel Flow from Started
                            </h4>
                            <div className="space-y-1.5 sm:space-y-2 text-xs sm:text-sm">
                              <div className="flex justify-between items-center">
                                <span className="text-slate-600 dark:text-slate-400 font-light text-[10px] sm:text-xs">Proceeded to RESPA:</span>
                                <span className="font-light text-slate-900 dark:text-white text-[10px] sm:text-xs">
                                  {calculateMetrics.startToRespaRate.toFixed(1)}%
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-slate-600 dark:text-slate-400 font-light text-[10px] sm:text-xs">Overall Conversion (Originated):</span>
                                <span className="font-light text-emerald-600 dark:text-emerald-400 text-[10px] sm:text-xs">
                                  {calculateMetrics.overallConversionRate.toFixed(1)}%
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-slate-600 dark:text-slate-400 font-light text-[10px] sm:text-xs">Still Active:</span>
                                <span className="font-light text-sky-600 dark:text-sky-400 text-[10px] sm:text-xs">
                                  {calculateMetrics.activePipelineRate.toFixed(1)}%
                                </span>
                              </div>
                              <div className="flex justify-between items-center pt-1.5 sm:pt-2 border-t border-slate-200 dark:border-slate-700">
                                <span className="text-amber-600 dark:text-amber-400 font-light text-[10px] sm:text-xs">Total Fallout Rate:</span>
                                <span className="font-light text-amber-600 dark:text-amber-400 text-[10px] sm:text-xs">
                                  {calculateMetrics.falloutRate.toFixed(1)}%
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="pt-2 sm:pt-3 border-t border-slate-200 dark:border-slate-700">
                            <h4 className="text-[9px] sm:text-[10px] font-light text-slate-700 dark:text-slate-300 mb-1.5 sm:mb-2 uppercase tracking-wider">
                              Breakdown
                            </h4>
                            <div className="space-y-1.5 sm:space-y-2 text-[10px] sm:text-xs">
                              <div className="flex justify-between flex-wrap gap-1">
                                <span className="text-slate-600 dark:text-slate-400 font-light">→ Originated:</span>
                                <span className="font-light text-slate-900 dark:text-white">
                                  {formatValue(calculateMetrics.totalOriginated)} loans ({calculateMetrics.overallConversionRate.toFixed(1)}%)
                                </span>
                              </div>
                              <div className="flex justify-between flex-wrap gap-1">
                                <span className="text-slate-600 dark:text-slate-400 font-light">→ Still Active:</span>
                                <span className="font-light text-sky-600 dark:text-sky-400">
                                  {formatValue(calculateMetrics.totalActive)} loans ({calculateMetrics.activePipelineRate.toFixed(1)}%)
                                </span>
                              </div>
                              <div className="flex justify-between flex-wrap gap-1">
                                <span className="text-rose-600 dark:text-rose-400 font-light">→ Total Fallout:</span>
                                <span className="font-light text-rose-600 dark:text-rose-400">
                                  {formatValue(Math.round(calculateMetrics.totalFallout))} loans ({calculateMetrics.falloutRate.toFixed(1)}%)
                                </span>
                              </div>
                            </div>
                          </div>

                          <p className="text-slate-600 dark:text-slate-400 text-[10px] sm:text-xs pt-2 sm:pt-3 border-t border-slate-200 dark:border-slate-700 font-light leading-relaxed">
                            This represents the top of the funnel - all initial customer touchpoints or files started. This is the entry point where all loan opportunities begin their journey through the pipeline.
                          </p>
                        </div>
                      )}
                      
                      {selectedLayer.id === 'respa' && (
                        <div className="space-y-1.5 sm:space-y-2">
                          <p className="text-slate-700 dark:text-slate-300 font-light text-xs sm:text-sm">
                            <span className="font-light">RESPA Applications:</span> {formatValue(selectedLayer.simulatedValue)} loans
                          </p>
                          <p className="text-slate-700 dark:text-slate-300 font-light text-xs sm:text-sm">
                            <span className="font-light">Conversion Rate:</span> {selectedLayer.conversionRate?.toFixed(1) || calculateMetrics.startToRespaRate.toFixed(1)}% from Started
                          </p>
                          <p className="text-slate-700 dark:text-slate-300 font-light text-xs sm:text-sm">
                            <span className="font-light">Base Count:</span> {formatValue(selectedLayer.value)} loans
                          </p>
                          <p className="text-slate-600 dark:text-slate-400 text-[10px] sm:text-xs font-light leading-relaxed">
                            Loans that progressed to the RESPA application stage. This represents applications proceeding to RESPA stage.
                          </p>
                        </div>
                      )}
                      
                      {selectedLayer.id === 'originated' && (
                        <div className="space-y-1.5 sm:space-y-2">
                          <p className="text-slate-700 dark:text-slate-300 font-light text-xs sm:text-sm">
                            <span className="font-light">Originated Loans:</span> {formatValue(calculateMetrics.totalOriginated)} loans
                          </p>
                          <p className="text-slate-700 dark:text-slate-300 font-light text-xs sm:text-sm">
                            <span className="font-light">Overall Conversion:</span> {calculateMetrics.overallConversionRate.toFixed(1)}% from Started
                          </p>
                          <p className="text-slate-700 dark:text-slate-300 font-light text-xs sm:text-sm">
                            <span className="font-light">RESPA to Originate:</span> {calculateMetrics.respaToOriginateRate.toFixed(1)}%
                          </p>
                          <p className="text-slate-600 dark:text-slate-400 text-[10px] sm:text-xs font-light leading-relaxed">
                            Successfully closed and funded loans.
                          </p>
                        </div>
                      )}
                      
                      {selectedLayer.id === 'no-respa' && (
                        <div className="space-y-1.5 sm:space-y-2">
                          <p className="text-slate-700 dark:text-slate-300 font-light text-xs sm:text-sm">
                            <span className="font-light">No RESPA Applications:</span> {formatValue(selectedLayer.simulatedValue)} loans
                          </p>
                          <p className="text-slate-700 dark:text-slate-300 font-light text-xs sm:text-sm">
                            <span className="font-light">Lost Revenue:</span> {formatCurrency(calculateMetrics.lostRevenueFromNoRespa)}
                          </p>
                          <p className="text-slate-600 dark:text-slate-400 text-[10px] sm:text-xs font-light leading-relaxed">
                            Loans started but never progressed to RESPA application. This represents a lost revenue opportunity that should be managed to ensure producers focus on conversion.
                          </p>
                        </div>
                      )}
                      
                      {selectedLayer.id === 'withdrawn' && (
                        <div className="space-y-1.5 sm:space-y-2">
                          <p className="text-slate-700 dark:text-slate-300 font-light text-xs sm:text-sm">
                            <span className="font-light">Withdrawn Loans:</span> {formatValue(selectedLayer.simulatedValue)} loans
                          </p>
                          <p className="text-slate-700 dark:text-slate-300 font-light text-xs sm:text-sm">
                            <span className="font-light">Withdrawal Rate:</span> {calculateMetrics.withdrawalRate.toFixed(1)}% of Started
                          </p>
                          <p className="text-slate-700 dark:text-slate-300 font-light text-xs sm:text-sm">
                            <span className="font-light">Lost Revenue:</span> {formatCurrency(calculateMetrics.lostRevenueFromWithdrawals)}
                          </p>
                          <p className="text-slate-600 dark:text-slate-400 text-[10px] sm:text-xs font-light leading-relaxed">
                            Loans where customers said "no". Review withdrawal rates by branch and originator to identify improvement opportunities.
                          </p>
                        </div>
                      )}
                      
                      {selectedLayer.id === 'denied' && (
                        <div className="space-y-1.5 sm:space-y-2">
                          <p className="text-slate-700 dark:text-slate-300 font-light text-xs sm:text-sm">
                            <span className="font-light">Denied Loans:</span> {formatValue(selectedLayer.simulatedValue)} loans
                          </p>
                          <p className="text-slate-700 dark:text-slate-300 font-light text-xs sm:text-sm">
                            <span className="font-light">Denial Rate:</span> {calculateMetrics.denialRate.toFixed(1)}% of Started
                          </p>
                          <p className="text-slate-700 dark:text-slate-300 font-light text-xs sm:text-sm">
                            <span className="font-light">Lost Revenue:</span> {formatCurrency(calculateMetrics.lostRevenueFromDenials)}
                          </p>
                          <p className="text-slate-600 dark:text-slate-400 text-[10px] sm:text-xs font-light leading-relaxed">
                            Loans denied by credit or underwriting. Consider loan type, credit box, and whether borrowers were referred to credit rehabilitation resources.
                          </p>
                        </div>
                      )}
                      
                      {selectedLayer.id === 'active' && (
                        <div className="space-y-1.5 sm:space-y-2">
                          <p className="text-slate-700 dark:text-slate-300 font-light text-xs sm:text-sm">
                            <span className="font-light">Active Pipeline:</span> {formatValue(calculateMetrics.totalActive)} loans
                          </p>
                          <p className="text-slate-700 dark:text-slate-300 font-light text-xs sm:text-sm">
                            <span className="font-light">Active Rate:</span> {calculateMetrics.activePipelineRate.toFixed(1)}% of Started
                          </p>
                          <p className="text-slate-600 dark:text-slate-400 text-[10px] sm:text-xs font-light leading-relaxed">
                            Loans still in process, not yet originated or fallen out.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Data Validation Summary */}
                  {selectedLayer.id === 'respa' && (
                    <div className="bg-slate-50 dark:bg-slate-800/30 rounded-lg p-2 sm:p-3 border border-slate-100 dark:border-slate-700">
                      <h4 className="text-[9px] sm:text-[10px] font-light text-slate-700 dark:text-slate-300 mb-1.5 sm:mb-2 uppercase tracking-wider">
                        Data Validation
                      </h4>
                      <div className="space-y-1 text-[10px] sm:text-xs text-slate-600 dark:text-slate-400 font-light">
                        <p>
                          • RESPA count: {formatValue(selectedLayer.simulatedValue)} loans
                        </p>
                        <p>
                          • Started count: {formatValue(calculateMetrics.totalStarted)} loans
                        </p>
                        <p>
                          • Conversion: {selectedLayer.conversionRate?.toFixed(1) || 'N/A'}% (RESPA ÷ Started)
                        </p>
                        {selectedLayer.conversionRate && selectedLayer.conversionRate > 100 && (
                          <p className="text-amber-600 dark:text-amber-400 font-light pt-1 text-[10px] sm:text-xs">
                            ⚠️ Conversion rate exceeds 100% - please verify data integrity
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Simulation Impact Notice */}
                  {simulationFactor !== 1 && (
                    <div className="bg-slate-50 dark:bg-slate-800/30 rounded-lg p-2 sm:p-3 border border-slate-100 dark:border-slate-700">
                      <p className="text-[10px] sm:text-xs text-slate-600 dark:text-slate-400 font-light">
                        <span className="font-light">Note:</span> Values shown reflect a {simulationFactor > 1 ? '+' : ''}{((simulationFactor - 1) * 100).toFixed(0)}% simulation factor.
                      </p>
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Summary Modal (Modern Summarized View) */}
      {showClassicStyle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-slate-500/20 backdrop-blur-sm"
            onClick={() => setShowClassicStyle(false)}
          />
          
          {/* Modal Content */}
          <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto overscroll-contain border border-slate-200 dark:border-slate-700 flex flex-col">
            {/* Header */}
            <div className="bg-slate-50 dark:bg-slate-800/50 px-8 py-6 flex items-center justify-between border-b border-slate-100 dark:border-slate-700">
              <div className="flex items-center gap-3">
                <BookOpen className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                <h3 className="text-lg font-medium text-slate-900 dark:text-white tracking-tight">Summary</h3>
              </div>
              <button
                onClick={() => setShowClassicStyle(false)}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            {/* Content - Modern Summarized View */}
            <div className="p-8 overflow-y-auto max-h-[calc(85vh-100px)] bg-white dark:bg-slate-800 space-y-4">
              {/* Introduction */}
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Fallout is not a cost of doing business—many times fallout is <span className="font-medium text-slate-900 dark:text-white">lost revenue opportunity</span>.
              </p>

              {/* Fallout Items */}
              <div className="space-y-2">
                {/* No RESPA */}
                {calculateMetrics && (
                  <div className="group p-3 rounded-lg bg-slate-50/80 dark:bg-slate-800/50 hover:bg-slate-100/80 dark:hover:bg-slate-700/50 transition-colors cursor-pointer">
                    <div className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs font-semibold text-slate-600 dark:text-slate-300">1</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <h3 className="text-sm font-medium text-slate-800 dark:text-white">No RESPA Application</h3>
                          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{formatValue(Math.round(calculateMetrics.noRespaUnits))} units</span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Lost: <span className="font-medium text-rose-600 dark:text-rose-400">{formatCurrency(calculateMetrics.lostRevenueFromNoRespa)}</span>
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Customer Withdrawal */}
                {calculateMetrics && (
                  <div className="group p-3 rounded-lg bg-slate-50/80 dark:bg-slate-800/50 hover:bg-slate-100/80 dark:hover:bg-slate-700/50 transition-colors cursor-pointer">
                    <div className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center text-xs font-semibold text-amber-700 dark:text-amber-300">2</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <h3 className="text-sm font-medium text-slate-800 dark:text-white">Customer Said "No"</h3>
                          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{formatValue(Math.round(calculateMetrics.withdrawnUnits))} units</span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Lost: <span className="font-medium text-rose-600 dark:text-rose-400">{formatCurrency(calculateMetrics.lostRevenueFromWithdrawals)}</span>
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Loans Denied */}
                {calculateMetrics && (
                  <div className="group p-3 rounded-lg bg-slate-50/80 dark:bg-slate-800/50 hover:bg-slate-100/80 dark:hover:bg-slate-700/50 transition-colors cursor-pointer">
                    <div className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center text-xs font-semibold text-rose-600 dark:text-rose-300">3</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <h3 className="text-sm font-medium text-slate-800 dark:text-white">Loans Denied</h3>
                          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{formatValue(Math.round(calculateMetrics.deniedUnits))} units</span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Lost: <span className="font-medium text-rose-600 dark:text-rose-400">{formatCurrency(calculateMetrics.lostRevenueFromDenials)}</span>
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Summary */}
              {calculateMetrics && (
                <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Total Impact</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-baseline">
                      <span className="text-xs text-slate-500 dark:text-slate-400">Lost Revenue</span>
                      <span className="text-lg font-semibold text-rose-600 dark:text-rose-400">{formatCurrency(calculateMetrics.totalLostRevenue)}</span>
                    </div>
                    <div className="flex justify-between items-baseline">
                      <span className="text-xs text-slate-500 dark:text-slate-400">Volume</span>
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{formatCurrency(calculateMetrics.totalFalloutVolume)}</span>
                    </div>
                    <div className="flex justify-between items-baseline">
                      <span className="text-xs text-slate-500 dark:text-slate-400">Units</span>
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{formatValue(Math.round(calculateMetrics.totalFalloutUnits))}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
