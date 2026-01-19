import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export interface Loan {
  id: string;
  loan_id?: string;
  borrower_name?: string;
  loan_amount: number;
  loan_type?: string;
  status: string;
  application_date?: string;
  closing_date?: string;
  lock_date?: string;
  interest_rate?: number | string;
  raw_data?: any;
}

export interface ProjectedClosingsRow {
  label: string;
  total?: string;
  columns: {
    funded: number;
    ctc: number;
    condApproved: number;
    locked: number;
  };
}

export interface FinalDispositionRow {
  label: string;
  columns: {
    originated: number;
    adverse: number;
    withdrawn: number;
  };
}

export interface ActiveLoansRow {
  label: string;
  total?: string;
  columns: {
    today10: number;
    '11_30': number;
    gt30: number;
    notLocked: number;
  };
}

export interface CompanyDetailData {
  projectedClosings: ProjectedClosingsRow[];
  finalDisposition: FinalDispositionRow[];
  activeLoans: ActiveLoansRow[];
}

// Helper function to infer loan status
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

// Helper to check if loan is CTC (Clear to Close)
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

// Helper to calculate days until closing
const getDaysUntilClosing = (loan: Loan): number | null => {
  if (!loan.closing_date) return null;
  const closingDate = new Date(loan.closing_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  closingDate.setHours(0, 0, 0, 0);
  const diffTime = closingDate.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

// Helper to calculate days since application
const getDaysSinceApplication = (loan: Loan): number | null => {
  if (!loan.application_date) return null;
  const appDate = new Date(loan.application_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  appDate.setHours(0, 0, 0, 0);
  const diffTime = today.getTime() - appDate.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
};

export const useCompanyData = (year: number) => {
  const [data, setData] = useState<CompanyDetailData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCompanyData = async () => {
      try {
        setLoading(true);
        
        // Calculate year start and end dates
        const yearStart = new Date(year, 0, 1).toISOString().split('T')[0];
        const yearEnd = new Date(year, 11, 31, 23, 59, 59).toISOString().split('T')[0];
        
        // Fetch all loans for the year (using a high limit to get all loans)
        const response = await api.request<{ loans: Loan[]; total: number }>(
          `/api/loans?start_date=${yearStart}&end_date=${yearEnd}&limit=10000`
        );
        
        const loans = response?.loans || [];
        
        if (!loans || !Array.isArray(loans)) {
          console.warn('Invalid loans data received');
          setData({
            projectedClosings: [],
            finalDisposition: [],
            activeLoans: []
          });
          return;
        }

        // Filter loans for the target year
        const yearStartDate = new Date(year, 0, 1);
        const yearEndDate = new Date(year, 11, 31, 23, 59, 59);
        
        const yearLoans = loans.filter(loan => {
          const appDate = loan.application_date ? new Date(loan.application_date) : null;
          const closeDate = loan.closing_date ? new Date(loan.closing_date) : null;
          const dateToCheck = closeDate || appDate;
          return dateToCheck && dateToCheck >= yearStartDate && dateToCheck <= yearEndDate;
        });

        // Process Projected Closings (grouped by month)
        const projectedClosingsByMonth: Record<string, { funded: number; ctc: number; condApproved: number; locked: number }> = {};
        
        // Process Final Disposition (MTD - Month to Date)
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const finalDispositionMTD = { originated: 0, adverse: 0, withdrawn: 0 };
        
        // Process Active Loans by Status (grouped by month)
        const activeLoansByMonth: Record<string, { today10: number; '11_30': number; gt30: number; notLocked: number }> = {};

        yearLoans.forEach(loan => {
          const status = getInferredStatus(loan);
          const loanAmount = parseFloat(String(loan.loan_amount || 0));
          
          // Projected Closings - loans with closing dates in the future or current month
          if (loan.closing_date) {
            const closingDate = new Date(loan.closing_date);
            const monthKey = closingDate.toLocaleString('default', { month: 'long' });
            
            if (!projectedClosingsByMonth[monthKey]) {
              projectedClosingsByMonth[monthKey] = { funded: 0, ctc: 0, condApproved: 0, locked: 0 };
            }
            
            if (status === 'Closed') {
              projectedClosingsByMonth[monthKey].funded++;
            } else if (isCTC(loan)) {
              projectedClosingsByMonth[monthKey].ctc++;
            } else if (isConditionallyApproved(loan)) {
              projectedClosingsByMonth[monthKey].condApproved++;
            } else if (status === 'Locked') {
              projectedClosingsByMonth[monthKey].locked++;
            }
          }
          
          // Final Disposition MTD - loans closed/denied/withdrawn in current month
          if (loan.closing_date || status === 'Denied' || status === 'Withdrawn') {
            const relevantDate = loan.closing_date ? new Date(loan.closing_date) : 
                                 loan.application_date ? new Date(loan.application_date) : null;
            
            if (relevantDate && relevantDate >= monthStart) {
              if (status === 'Closed') {
                finalDispositionMTD.originated++;
              } else if (status === 'Denied') {
                finalDispositionMTD.adverse++;
              } else if (status === 'Withdrawn') {
                finalDispositionMTD.withdrawn++;
              }
            }
          }
          
          // Active Loans by Status - active loans grouped by month and aging
          if (['Active', 'Locked', 'Submitted', 'Approved', 'CTC'].includes(status) && !loan.closing_date) {
            const appDate = loan.application_date ? new Date(loan.application_date) : new Date();
            const monthKey = appDate.toLocaleString('default', { month: 'long' });
            
            if (!activeLoansByMonth[monthKey]) {
              activeLoansByMonth[monthKey] = { today10: 0, '11_30': 0, gt30: 0, notLocked: 0 };
            }
            
            const daysUntilClosing = getDaysUntilClosing(loan);
            const daysSinceApp = getDaysSinceApplication(loan);
            const isLocked = status === 'Locked' || !!loan.lock_date;
            
            if (!isLocked) {
              activeLoansByMonth[monthKey].notLocked++;
            } else if (daysUntilClosing !== null) {
              if (daysUntilClosing <= 10) {
                activeLoansByMonth[monthKey].today10++;
              } else if (daysUntilClosing <= 30) {
                activeLoansByMonth[monthKey]['11_30']++;
              } else {
                activeLoansByMonth[monthKey].gt30++;
              }
            } else if (daysSinceApp !== null) {
              // Fallback to days since application if no closing date
              if (daysSinceApp <= 10) {
                activeLoansByMonth[monthKey].today10++;
              } else if (daysSinceApp <= 30) {
                activeLoansByMonth[monthKey]['11_30']++;
              } else {
                activeLoansByMonth[monthKey].gt30++;
              }
            }
          }
        });

        // Convert to array format for DataTable
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                           'July', 'August', 'September', 'October', 'November', 'December'];
        
        const projectedClosings: ProjectedClosingsRow[] = monthNames
          .filter(month => projectedClosingsByMonth[month])
          .map(month => {
            const values = projectedClosingsByMonth[month];
            const total = values.funded + values.ctc + values.condApproved + values.locked;
            return {
              label: month,
              total: total > 0 ? total.toString() : undefined,
              columns: values
            };
          });

        const finalDisposition: FinalDispositionRow[] = [{
          label: 'Month to Date',
          columns: finalDispositionMTD
        }];

        const activeLoans: ActiveLoansRow[] = monthNames
          .filter(month => activeLoansByMonth[month])
          .map(month => {
            const values = activeLoansByMonth[month];
            const total = values.today10 + values['11_30'] + values.gt30 + values.notLocked;
            return {
              label: month,
              total: total > 0 ? total.toString() : undefined,
              columns: values
            };
          });

        setData({
          projectedClosings,
          finalDisposition,
          activeLoans
        });
      } catch (error: any) {
        console.error('Failed to fetch company detail data:', error);
        setData({
          projectedClosings: [],
          finalDisposition: [],
          activeLoans: []
        });
      } finally {
        setLoading(false);
      }
    };

    fetchCompanyData();
  }, [year]);

  return { data, loading };
};

