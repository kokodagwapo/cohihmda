import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

export interface AdminStats {
  totalTenants: number;
  totalUsers: number;
  totalContacts: number;
  totalCalls: number;
  totalDocuments: number;
  totalLoans: number;
  deployments: number;
  losConnections: number;
  ragDocuments: number;
  isSuperAdmin: boolean;
  subscription: any | null;
  activeSubscriptions: number;
  costSummary: {
    total: number;
    voice: number;
    llm: number;
    embedding: number;
    aws: number;
  } | null;
  recent: {
    newUsers: number;
    newTenants: number;
    callsLast7d: number;
    loansLast7d: number;
  };
  loanStats: {
    total: number;
    active: number;
    closed: number;
    locked: number;
    total_volume: number;
    avg_loan_amount: number;
  } | null;
}

export const useAdminStats = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [stats, setStats] = useState<AdminStats>({
    totalTenants: 0,
    totalUsers: 0,
    totalContacts: 0,
    totalCalls: 0,
    totalDocuments: 0,
    totalLoans: 0,
    deployments: 0,
    losConnections: 0,
    ragDocuments: 0,
    isSuperAdmin: false,
    subscription: null,
    activeSubscriptions: 0,
    costSummary: null,
    recent: {
      newUsers: 0,
      newTenants: 0,
      callsLast7d: 0,
      loansLast7d: 0,
    },
    loanStats: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const statsData = await api.request<AdminStats>('/api/admin/stats');
      setStats(statsData);
    } catch (error: any) {
      console.error('Error loading admin stats:', error);
      setError(error.message || 'Failed to load admin stats');
      
      // Handle 403 Forbidden specifically
      if (error.message?.includes('Forbidden') || error.message?.includes('403')) {
        toast({
          title: 'Access Denied',
          description: 'You do not have permission to access admin data. Please contact a system administrator.',
          variant: 'destructive',
        });
        // Check user role and redirect if needed
        const userData = await api.getCurrentUser().catch(() => ({ user: null }));
        const userRole = userData.user?.role || 'user';
        if (userRole !== 'super_admin' && userRole !== 'tenant_admin') {
          navigate('/');
        }
        return;
      }
      
      toast({
        title: 'Error',
        description: error.message || 'Failed to load admin data.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [navigate, toast]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  return {
    stats,
    loading,
    error,
    refetch: loadStats,
  };
};

