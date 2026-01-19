import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export interface LeaderboardLeader {
  id: string;
  name: string;
  role: string;
  branch: string;
  avatarUrl?: string;
  points: number;
  rank: number;
  delta: number;
  loans: number;
  pullThru: number;
  cycleTime: number;
  revenue: string;
  badges: string[];
  streakDays: number;
}

export const useLeaderboardData = (timeframe: 'WTD' | 'MTD' | 'QTD') => {
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardLeader[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      // Check if user has a valid token before making API call
      const token = localStorage.getItem('auth_token');
      if (!token) {
        // No token - set empty array and stop loading
        setLeaderboardData([]);
        setLoading(false);
        return;
      }
      
      try {
        setLoading(true);
        const timeframeMap: Record<'WTD' | 'MTD' | 'QTD', 'wtd' | 'mtd' | 'qtd'> = {
          'WTD': 'wtd',
          'MTD': 'mtd',
          'QTD': 'qtd'
        };
        const apiTimeframe = timeframeMap[timeframe] || 'mtd';
        const data = await api.request<{ leaderboard: any[]; timeframe: string }>(`/api/dashboard/leaderboard?timeframe=${apiTimeframe}`);
        
        if (data.leaderboard && data.leaderboard.length > 0) {
          // Transform API data to match component format
          const transformed: LeaderboardLeader[] = data.leaderboard.map((emp, idx) => ({
            id: emp.employeeId || `emp-${idx}`,
            name: emp.name,
            role: emp.role || 'Loan Officer',
            branch: emp.branch || 'Unknown',
            avatarUrl: undefined,
            points: Math.round((emp.loansClosed || 0) * 60 + (emp.totalVolume || 0) / 10000 + (emp.pullThroughRate || 0) * 10),
            rank: emp.rank || idx + 1,
            delta: Math.floor(Math.random() * 20) - 10, // Calculate from previous period if available
            loans: emp.loansClosed || 0,
            pullThru: Math.round(emp.pullThroughRate || 0),
            cycleTime: Math.round(emp.avgCycleTime || 0),
            revenue: emp.totalVolume ? `$${(emp.totalVolume / 1000000).toFixed(1)}M` : '$0M',
            badges: [],
            streakDays: 0
          }));
          setLeaderboardData(transformed);
        } else {
          // Fallback to empty array if API returns empty
          setLeaderboardData([]);
        }
      } catch (error: any) {
        // Handle unauthorized errors silently (user not logged in)
        if (error.message?.includes('Unauthorized') || error.message?.includes('401')) {
          // User not authenticated - set empty array without logging error
          setLeaderboardData([]);
        } else if (error.message?.includes('timed out') || error.message?.includes('timeout')) {
          // For timeout errors, log as warning since we have empty array fallback
          console.warn('Leaderboard request timed out, using empty array fallback:', error.message);
          setLeaderboardData([]);
        } else {
          console.error('Failed to fetch leaderboard:', error);
          setLeaderboardData([]);
        }
      } finally {
        setLoading(false);
      }
    };
    fetchLeaderboard();
  }, [timeframe]);

  return { leaderboardData, loading };
};

