import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

export interface SecurityInfo {
  authentication: {
    totalUsers: number;
    confirmedUsers: number;
    recentLogins: number;
    failedLogins?: number;
  };
  settings: {
    jwtExpiry: string;
    passwordMinLength: number;
    requireEmailConfirmation: boolean;
    encryptionEnabled?: boolean;
  };
  auditTrail?: {
    totalLogs: number;
    last24h: number;
    retentionDays: number;
  };
}

export const useSecurityInfo = () => {
  const { toast } = useToast();
  const [securityInfo, setSecurityInfo] = useState<SecurityInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSecurityInfo = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.request<SecurityInfo>('/api/admin/security');
      setSecurityInfo(data);
    } catch (error: any) {
      console.error('Error loading security info:', error);
      setError(error.message || 'Failed to load security information');
      toast({
        title: 'Error',
        description: error.message || 'Failed to load security information.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  return {
    securityInfo,
    loading,
    error,
    loadSecurityInfo,
  };
};

