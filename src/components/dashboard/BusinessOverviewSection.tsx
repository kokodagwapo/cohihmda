import React, { useState, useEffect, useRef } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { BusinessOverviewModal } from './BusinessOverviewModal';
import { getBusinessOverviewData } from '@/services/businessOverviewService';
import { BusinessOverviewData, KPIMetric } from '@/types/businessOverview';

interface BusinessOverviewSectionProps {
  dateFilter: 'today' | 'mtd' | 'ytd' | 'custom';
}

// Hook for animating numbers
const useCountUp = (
  endValue: number,
  duration: number = 1500,
  delay: number = 0,
  startAnimation: boolean = true
) => {
  const [count, setCount] = useState(0);
  const countRef = useRef(0);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!startAnimation) return;

    const timeout = setTimeout(() => {
      const animate = (timestamp: number) => {
        if (!startTimeRef.current) startTimeRef.current = timestamp;
        const progress = Math.min((timestamp - startTimeRef.current) / duration, 1);
        
        // Easing function for smooth animation
        const easeOutQuart = 1 - Math.pow(1 - progress, 4);
        countRef.current = Math.floor(easeOutQuart * endValue);
        setCount(countRef.current);

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          setCount(endValue);
        }
      };

      requestAnimationFrame(animate);
    }, delay);

    return () => clearTimeout(timeout);
  }, [endValue, duration, delay, startAnimation]);

  return count;
};

// Extract numeric value from string (e.g., "402" from "402", "72.8" from "72.8%", "25" from "25d")
const extractNumericValue = (value: string): number => {
  if (!value || value === '--' || value.includes('--')) {
    return 0;
  }
  // Remove any non-numeric characters except decimal point and extract number
  const cleaned = value.replace(/[^\d.]/g, '');
  const match = cleaned.match(/[\d.]+/);
  return match ? parseFloat(match[0]) : 0;
};

// Format the animated value back to the original format
const formatAnimatedValue = (animatedValue: number, originalValue: string): string => {
  // Handle zero values explicitly
  if (animatedValue === 0) {
    // Check for percentage
    if (originalValue.includes('%')) {
      return '0.0%';
    }
    // Check for days
    if (originalValue.includes('d') || originalValue.includes('days')) {
      return '0 days';
    }
    // Default - just return "0"
    return '0';
  }
  
  // Check for percentage
  if (originalValue.includes('%')) {
    return `${animatedValue.toFixed(1)}%`;
  }
  // Check for days
  if (originalValue.includes('d') || originalValue.includes('days')) {
    return `${Math.floor(animatedValue)} days`;
  }
  // Check for currency/large numbers with commas
  if (originalValue.includes(',')) {
    return animatedValue.toLocaleString();
  }
  // Default - just return the number (with commas for large numbers)
  return Math.floor(animatedValue).toLocaleString();
};

// Animated KPI Card Component
const AnimatedKPICard: React.FC<{
  kpi: KPIMetric;
  index: number;
  onOpen: () => void;
  isAnimating: boolean;
}> = ({ kpi, index, onOpen, isAnimating }) => {
  const targetValue = extractNumericValue(kpi.value);
  const animationDelay = index * 600; // 600ms stagger between cards
  const animatedValue = useCountUp(targetValue, 1200, animationDelay, isAnimating);
  
  const displayValue = isAnimating 
    ? formatAnimatedValue(animatedValue, kpi.value)
    : kpi.value;

  // Calculate opacity and scale based on animation progress
  const [isVisible, setIsVisible] = useState(!isAnimating);
  
  useEffect(() => {
    if (!isAnimating) {
      setIsVisible(true);
      return;
    }
    
    const timeout = setTimeout(() => {
      setIsVisible(true);
    }, animationDelay);
    
    return () => clearTimeout(timeout);
  }, [animationDelay, isAnimating]);

  return (
    <button
      className={`bg-white dark:bg-slate-800 rounded-lg sm:rounded-xl border border-slate-200 dark:border-slate-700 p-3 sm:p-4 lg:p-5 hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600 transition-all duration-500 cursor-pointer group text-center w-full active:scale-[0.98] touch-manipulation ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      }`}
      onClick={onOpen}
      style={{
        transitionDelay: isAnimating ? `${animationDelay}ms` : '0ms'
      }}
    >
      {/* Label */}
      <div className="text-[9px] sm:text-[10px] lg:text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1 sm:mb-2 font-medium">
        {kpi.label}
      </div>
      
      {/* Value with animation */}
      <div className="text-xl sm:text-2xl lg:text-3xl font-light text-slate-900 dark:text-white mb-1 sm:mb-2 tracking-tight tabular-nums">
        {displayValue}
      </div>
      
      {/* Trend indicator */}
      <div className={`flex items-center justify-center gap-1 sm:gap-1.5 transition-opacity duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
        style={{ transitionDelay: isAnimating ? `${animationDelay + 800}ms` : '0ms' }}
      >
        {kpi.trend === 'up' ? (
          <TrendingUp className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-emerald-500 flex-shrink-0" />
        ) : kpi.trend === 'down' ? (
          <TrendingDown className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-rose-500 flex-shrink-0" />
        ) : (
          <Minus className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-slate-400 flex-shrink-0" />
        )}
        <span className={`text-xs sm:text-sm font-medium ${
          kpi.trend === 'up' ? 'text-emerald-500' : 
          kpi.trend === 'down' ? 'text-rose-500' : 
          'text-slate-400'
        }`}>
          {kpi.changeValue}
        </span>
      </div>
    </button>
  );
};

export const BusinessOverviewSection: React.FC<BusinessOverviewSectionProps> = ({ dateFilter }) => {
  const [data, setData] = useState<BusinessOverviewData | null>(null);
  const [isAnimating, setIsAnimating] = useState(true);
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    title: string;
    type: 'kpi' | 'activeLoans' | 'closedLoans' | 'lockedLoans' | 'cycleTime' | 'pullThrough' | 'creditPulls';
    data: any;
  }>({
    isOpen: false,
    title: '',
    type: 'kpi',
    data: null
  });

  useEffect(() => {
    const fetchData = async () => {
      const businessData = await getBusinessOverviewData(dateFilter);
      setData(businessData);
    };
    fetchData();
  }, [dateFilter]);

  // Stop animation after 5 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsAnimating(false);
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  const openModal = (title: string, type: typeof modalState.type, modalData: any) => {
    setModalState({
      isOpen: true,
      title,
      type,
      data: modalData
    });
  };

  const closeModal = () => {
    setModalState({ ...modalState, isOpen: false });
  };

  if (!data) {
    return (
      <div className="mb-4 sm:mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3 lg:gap-4">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="bg-white dark:bg-slate-800 rounded-lg sm:rounded-xl border border-slate-200 dark:border-slate-700 p-3 sm:p-4 lg:p-5 animate-pulse"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-20 mb-2"></div>
              <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-16 mb-2"></div>
              <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-12"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 sm:mb-6">
      {/* KPI Cards Grid - Mobile first: 2 cols, then 3 cols on sm, 6 cols on lg */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3 lg:gap-4">
        {data.kpis.map((kpi, index) => {
          // Determine modal type and data based on KPI ID
          const getModalConfig = () => {
            switch (kpi.id) {
              case 'active-loans':
                return { type: 'activeLoans' as const, data: data.activeLoans };
              case 'closed-loans':
                return { type: 'closedLoans' as const, data: data.closedLoans };
              case 'locked-loans':
                return { type: 'lockedLoans' as const, data: data.lockedLoans };
              case 'cycle-time':
                return { type: 'cycleTime' as const, data: data.cycleTime };
              case 'pull-through':
                return { type: 'pullThrough' as const, data: data.pullThrough };
              case 'credit-pulls':
                return { type: 'creditPulls' as const, data: data.creditPulls };
              default:
                return { type: 'kpi' as const, data: kpi };
            }
          };

          const modalConfig = getModalConfig();
          
          return (
            <AnimatedKPICard
              key={kpi.id}
              kpi={kpi}
              index={index}
              onOpen={() => openModal(kpi.label, modalConfig.type, modalConfig.data)}
              isAnimating={isAnimating}
            />
          );
        })}
      </div>

      {/* Modal for drilldown */}
      <BusinessOverviewModal
        isOpen={modalState.isOpen}
        onClose={closeModal}
        title={modalState.title}
        type={modalState.type}
        data={modalState.data}
      />
    </div>
  );
};
