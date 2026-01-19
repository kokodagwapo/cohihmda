import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Loan } from './useCompanyData';

export interface CompanyMetrics {
  totalProjectedUnits: number;
  totalProjectedVolume: number;
  weightedAvgWAC: number;
  activeLoans: number;
  aiInsights: Array<{
    type: 'info' | 'success' | 'warning';
    message: string;
  }>;
}

// Helper function to infer loan status (same as in useCompanyData)
const getInferredStatus = (loan: Loan): string => {
  if (loan.closing_date) return 'Closed';
  if (loan.lock_date) return 'Locked';
  const rawStatus = (loan.status || '').toString().toUpperCase();
  
  if (['ACTIVE', 'SUBMITTED', 'APPROVED', 'CTC', 'STARTED', 'INQUIRY', 'PROCESSING', 'UNDERWRITING'].includes(rawStatus)) {
    return 'Active';
  }
  if (['WITHDRAWN', 'CANCELLED'].includes(rawStatus)) return 'Withdrawn';
  if (['DENIED', 'DECLINED', 'REJECTED', 'ADVERSE'].includes(rawStatus)) return 'Denied';
  if (['ORIGINATED', 'FUNDED', 'CLOSED', 'COMPLETE', 'COMPLETED'].includes(rawStatus)) return 'Closed';
  if (['LOCKED'].includes(rawStatus)) return 'Locked';
  if (/^[A-Z]{2}$/.test(rawStatus)) return 'Active'; // State code
  return 'Active'; // Default
};

// Helper to check if loan is CTC
const isCTC = (loan: Loan): boolean => {
  const status = getInferredStatus(loan);
  const rawStatus = (loan.status || '').toString().toUpperCase();
  return status === 'Locked' && (rawStatus === 'CTC' || rawStatus.includes('CLEAR TO CLOSE'));
};

// Helper to check if loan is conditionally approved
const isConditionallyApproved = (loan: Loan): boolean => {
  const rawStatus = (loan.status || '').toString().toUpperCase();
  return rawStatus.includes('CONDITIONAL') || rawStatus.includes('COND') || rawStatus === 'APPROVED';
};

export const useCompanyMetrics = (year: number) => {
  const [metrics, setMetrics] = useState<CompanyMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        setLoading(true);
        
        // Calculate year start and end dates
        const yearStart = new Date(year, 0, 1).toISOString().split('T')[0];
        const yearEnd = new Date(year, 11, 31, 23, 59, 59).toISOString().split('T')[0];
        
        // Fetch all loans for the year
        const response = await api.request<{ loans: Loan[]; total: number }>(
          `/api/loans?start_date=${yearStart}&end_date=${yearEnd}&limit=10000`
        );
        
        const loans = response?.loans || [];
        
        // Filter loans with projected closings (have closing_date in future or current month)
        const now = new Date();
        const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        
        const projectedLoans = loans.filter(loan => {
          if (!loan.closing_date) return false;
          const closingDate = new Date(loan.closing_date);
          return closingDate >= currentMonthStart;
        });

        // Calculate projected units and volume
        const totalProjectedUnits = projectedLoans.length;
        const totalProjectedVolume = projectedLoans.reduce((sum, loan) => {
          return sum + parseFloat(String(loan.loan_amount || 0));
        }, 0);

        // Calculate weighted average WAC (Weighted Average Coupon/Interest Rate)
        let totalWeightedRate = 0;
        let totalWeight = 0;
        
        projectedLoans.forEach(loan => {
          const rate = parseFloat(String(loan.interest_rate || 0));
          const amount = parseFloat(String(loan.loan_amount || 0));
          if (rate > 0 && amount > 0) {
            totalWeightedRate += rate * amount;
            totalWeight += amount;
          }
        });
        
        const weightedAvgWAC = totalWeight > 0 ? (totalWeightedRate / totalWeight) * 100 : 0;

        // Count active loans
        const activeLoans = loans.filter(loan => {
          const status = getInferredStatus(loan);
          return ['Active', 'Locked', 'Submitted', 'Approved', 'CTC'].includes(status) && !loan.closing_date;
        }).length;

        // Generate AI Insights
        const insights: Array<{ type: 'info' | 'success' | 'warning'; message: string }> = [];
        
        // Count loans by status for insights
        const fundedCount = projectedLoans.filter(l => getInferredStatus(l) === 'Closed').length;
        const ctcCount = projectedLoans.filter(l => isCTC(l)).length;
        const condApprovedCount = projectedLoans.filter(l => isConditionallyApproved(l)).length;
        const lockedCount = projectedLoans.filter(l => getInferredStatus(l) === 'Locked').length;
        
        // Insight 1: Projected closings
        if (fundedCount > 0) {
          const volumeFormatted = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
          }).format(totalProjectedVolume / 1000000) + 'M';
          
          insights.push({
            type: 'info',
            message: `${fundedCount} loans are projected to fund this month, representing ${volumeFormatted} in volume.`
          });
        }
        
        // Insight 2: CTC loans with average rate
        if (ctcCount > 0) {
          const ctcLoans = projectedLoans.filter(l => isCTC(l));
          const ctcRates = ctcLoans
            .map(l => parseFloat(String(l.interest_rate || 0)))
            .filter(r => r > 0);
          
          if (ctcRates.length > 0) {
            const avgRate = (ctcRates.reduce((sum, r) => sum + r, 0) / ctcRates.length * 100).toFixed(3);
            insights.push({
              type: 'success',
              message: `${ctcCount} loans are Clear to Close with an Average Interest Rate of ${avgRate}%.`
            });
          }
        }
        
        // Insight 3: Conditionally approved loans
        if (condApprovedCount > 0) {
          insights.push({
            type: 'warning',
            message: `${condApprovedCount} loans are conditionally approved, requiring attention to move forward.`
          });
        }

        setMetrics({
          totalProjectedUnits,
          totalProjectedVolume,
          weightedAvgWAC,
          activeLoans,
          aiInsights: insights
        });
      } catch (error: any) {
        console.error('Failed to fetch company metrics:', error);
        setMetrics({
          totalProjectedUnits: 0,
          totalProjectedVolume: 0,
          weightedAvgWAC: 0,
          activeLoans: 0,
          aiInsights: []
        });
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
  }, [year]);

  return { metrics, loading };
};

