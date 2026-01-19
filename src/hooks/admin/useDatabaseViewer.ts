import { useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

export interface Loan {
  loan_id: string;
  borrower_name?: string;
  loan_amount?: string;
  loan_type?: string;
  status?: string;
  loan_officer_name?: string;
  branch?: string;
  application_date?: string;
  closing_date?: string;
  lock_date?: string;
  interest_rate?: string;
}

export const useDatabaseViewer = () => {
  const { toast } = useToast();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loadingLoans, setLoadingLoans] = useState(false);
  const [loanPage, setLoanPage] = useState(1);
  const [loanTotal, setLoanTotal] = useState(0);
  const [editingLoan, setEditingLoan] = useState<Loan | null>(null);
  const [deletingLoanId, setDeletingLoanId] = useState<string | null>(null);

  const fetchLoans = async () => {
    setLoadingLoans(true);
    try {
      // Calculate offset from page (page 1 = offset 0, page 2 = offset 50, etc.)
      const offset = (loanPage - 1) * 50;
      const response = await api.request<{ loans: Loan[]; total: number }>(
        `/api/loans?limit=50&offset=${offset}`
      );
      setLoans(response.loans || []);
      setLoanTotal(response.total || 0);
    } catch (error: any) {
      console.error('Error fetching loans:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to load loans from database.',
        variant: 'destructive',
      });
      setLoans([]);
      setLoanTotal(0);
    } finally {
      setLoadingLoans(false);
    }
  };

  const handleUpdateLoan = async (loanId: string, updates: Partial<Loan>) => {
    try {
      await api.request(`/api/loans/${loanId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      toast({
        title: 'Success',
        description: 'Loan updated successfully.',
      });
      setEditingLoan(null);
      await fetchLoans();
    } catch (error: any) {
      console.error('Error updating loan:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to update loan.',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteLoan = async (loanId: string) => {
    try {
      await api.request(`/api/loans/${loanId}`, {
        method: 'DELETE',
      });
      toast({
        title: 'Success',
        description: 'Loan deleted successfully.',
      });
      setDeletingLoanId(null);
      await fetchLoans();
    } catch (error: any) {
      console.error('Error deleting loan:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete loan.',
        variant: 'destructive',
      });
    }
  };

  return {
    loans,
    loadingLoans,
    loanPage,
    setLoanPage,
    loanTotal,
    editingLoan,
    setEditingLoan,
    deletingLoanId,
    setDeletingLoanId,
    fetchLoans,
    handleUpdateLoan,
    handleDeleteLoan,
  };
};

