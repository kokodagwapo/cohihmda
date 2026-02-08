import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { ApiClient } from '@/lib/api';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Activity,
  Cloud,
  Brain,
  Database,
  RefreshCw,
  Download,
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, PieChart, Pie, Cell, Area, AreaChart } from 'recharts';
import { format } from 'date-fns';

const apiClient = new ApiClient();

interface CostSummary {
  period: {
    start: string;
    end: string;
    daysElapsed: number;
    daysInMonth: number;
  };
  totals: Record<string, number>;
  projectedTotal: number;
  byCategory: Array<{
    service_category: string;
    total_cost: string;
    event_count: string;
  }>;
  daily: Array<{
    date: string;
    total_cost: string;
    voice_total: string;
    llm_total_cost: string;
    aws_total: string;
    vector_db_cost: string;
  }>;
}

interface VoiceCosts {
  voice: Array<{
    service_provider: string;
    service_name: string;
    total_sessions: string;
    input_minutes: string;
    output_minutes: string;
    total_cost: string;
  }>;
}

interface AWSCosts {
  aws: Array<{
    service_name: string;
    usage_type: string;
    total_usage: string;
    avg_unit_price: string;
    total_cost: string;
  }>;
}

const COLORS = {
  voice_ai: '#3B82F6', // Blue
  llm: '#10B981', // Green
  embedding: '#8B5CF6', // Purple
  aws: '#F59E0B', // Amber
  vector_db: '#EC4899', // Pink
  other: '#6B7280', // Gray
};

export function CostDashboard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [voiceCosts, setVoiceCosts] = useState<VoiceCosts | null>(null);
  const [awsCosts, setAwsCosts] = useState<AWSCosts | null>(null);
  const [projections, setProjections] = useState<any>(null);

  useEffect(() => {
    loadCostData();
  }, []);

  const loadCostData = async () => {
    try {
      setLoading(true);
      const [summaryData, voiceData, awsData, projectionsData] = await Promise.all([
        apiClient.request<{ period: any; totals: any; projectedTotal: number; byCategory: any[]; daily: any[] }>('/api/costs/summary'),
        apiClient.request<VoiceCosts>('/api/costs/voice'),
        apiClient.request<AWSCosts>('/api/costs/aws'),
        apiClient.request<any>('/api/costs/projections'),
      ]);

      setSummary({
        period: summaryData.period,
        totals: summaryData.totals,
        projectedTotal: summaryData.projectedTotal,
        byCategory: summaryData.byCategory || [],
        daily: summaryData.daily || [],
      });
      setVoiceCosts(voiceData);
      setAwsCosts(awsData);
      setProjections(projectionsData);
    } catch (error: any) {
      console.error('Error loading cost data:', error);
      toast({
        title: 'Error',
        description: 'Failed to load cost data.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadCostData();
    setRefreshing(false);
    toast({
      title: 'Refreshed',
      description: 'Cost data updated.',
    });
  };

  const handleSyncAWS = async () => {
    try {
      await apiClient.request('/api/costs/aws/sync', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      toast({
        title: 'Success',
        description: 'AWS costs synced successfully.',
      });
      loadCostData();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to sync AWS costs.',
        variant: 'destructive',
      });
    }
  };

  const handleExport = async (format: 'csv' | 'json') => {
    try {
      const response = await apiClient.request('/api/costs/export', {
        method: 'POST',
        body: JSON.stringify({ format }),
      });

      if (format === 'csv') {
        // Download CSV
        const blob = new Blob([response as string], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `costs-${Date.now()}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
      } else {
        // Download JSON
        const blob = new Blob([JSON.stringify(response, null, 2)], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `costs-${Date.now()}.json`;
        a.click();
        window.URL.revokeObjectURL(url);
      }

      toast({
        title: 'Exported',
        description: `Cost data exported as ${format.toUpperCase()}.`,
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to export cost data.',
        variant: 'destructive',
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const totalCost = summary?.totals.total || 0;
  const budget = 1500; // TODO: Get from budget settings
  const budgetPercent = (totalCost / budget) * 100;

  // Prepare chart data
  const categoryData = summary?.byCategory.map((cat) => ({
    name: cat.service_category.replace('_', ' ').toUpperCase(),
    value: parseFloat(cat.total_cost),
    color: COLORS[cat.service_category as keyof typeof COLORS] || COLORS.other,
  })) || [];

  const dailyData = summary?.daily.map((day) => ({
    date: format(new Date(day.date), 'MMM d'),
    total: parseFloat(day.total_cost),
    voice: parseFloat(day.voice_total || '0'),
    llm: parseFloat(day.llm_total_cost || '0'),
    aws: parseFloat(day.aws_total || '0'),
  })) || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-extralight tracking-tight text-slate-900 dark:text-white">
            Cost Dashboard
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Real-time cost tracking and analysis
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncAWS}
            className="text-xs"
          >
            <Cloud className="h-4 w-4 mr-2" />
            Sync AWS
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-xs"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport('csv')}
            className="text-xs"
          >
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-light text-slate-600 dark:text-slate-400">
              Total Cost This Period
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extralight text-slate-900 dark:text-white mb-2">
              ${totalCost.toFixed(2)}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {summary?.period.daysElapsed || 0} of {summary?.period.daysInMonth || 30} days
            </div>
            <div className="mt-2 h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all"
                style={{ width: `${Math.min(budgetPercent, 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-light text-slate-600 dark:text-slate-400">
              Projected Month-End
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extralight text-slate-900 dark:text-white mb-2">
              ${summary?.projectedTotal.toFixed(2) || '0.00'}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Budget: ${budget.toFixed(2)}/mo
            </div>
            <div className="mt-2 flex items-center gap-2">
              {summary && summary.projectedTotal > budget ? (
                <>
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <span className="text-xs text-amber-600 dark:text-amber-400">
                    Over budget
                  </span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <span className="text-xs text-emerald-600 dark:text-emerald-400">
                    On track
                  </span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-light text-slate-600 dark:text-slate-400">
              Cost Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {summary?.byCategory.slice(0, 3).map((cat) => (
                <div key={cat.service_category} className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-400">
                    {cat.service_category.replace('_', ' ')}
                  </span>
                  <span className="font-light text-slate-900 dark:text-white">
                    ${parseFloat(cat.total_cost).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="voice">Voice AI</TabsTrigger>
          <TabsTrigger value="aws">AWS Infrastructure</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Cost by Category Pie Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-extralight">Cost by Category</CardTitle>
              </CardHeader>
              <CardContent>
                {categoryData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={categoryData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {categoryData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <ChartTooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[300px] text-slate-400">
                    No cost data available
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Daily Cost Trend */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-extralight">Daily Cost Trend</CardTitle>
              </CardHeader>
              <CardContent>
                {dailyData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={dailyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="date" stroke="#6b7280" fontSize={12} />
                      <YAxis stroke="#6b7280" fontSize={12} />
                      <ChartTooltip />
                      <Area
                        type="monotone"
                        dataKey="total"
                        stroke="#3b82f6"
                        fill="#3b82f6"
                        fillOpacity={0.2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[300px] text-slate-400">
                    No daily data available
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="voice" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-extralight">Voice AI Costs</CardTitle>
              <CardDescription>Breakdown by provider and service</CardDescription>
            </CardHeader>
            <CardContent>
              {voiceCosts && voiceCosts.voice.length > 0 ? (
                <div className="space-y-4">
                  {voiceCosts.voice.map((item, index) => (
                    <div
                      key={index}
                      className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <div className="font-medium text-slate-900 dark:text-white">
                            {item.service_name}
                          </div>
                          <div className="text-sm text-slate-500 dark:text-slate-400">
                            {item.service_provider}
                          </div>
                        </div>
                        <div className="text-2xl font-extralight text-slate-900 dark:text-white">
                          ${parseFloat(item.total_cost).toFixed(2)}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-4 mt-4 text-xs">
                        <div>
                          <div className="text-slate-500 dark:text-slate-400">Sessions</div>
                          <div className="font-light text-slate-900 dark:text-white">
                            {parseInt(item.total_sessions)}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500 dark:text-slate-400">Input Minutes</div>
                          <div className="font-light text-slate-900 dark:text-white">
                            {parseFloat(item.input_minutes).toFixed(1)}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500 dark:text-slate-400">Output Minutes</div>
                          <div className="font-light text-slate-900 dark:text-white">
                            {parseFloat(item.output_minutes).toFixed(1)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-slate-400">
                  No voice AI costs recorded
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="aws" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-extralight">AWS Infrastructure Costs</CardTitle>
              <CardDescription>Breakdown by service and usage type</CardDescription>
            </CardHeader>
            <CardContent>
              {awsCosts && awsCosts.aws.length > 0 ? (
                <div className="space-y-2">
                  {awsCosts.aws.map((item, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700"
                    >
                      <div className="flex-1">
                        <div className="font-medium text-sm text-slate-900 dark:text-white">
                          {item.service_name}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {item.usage_type} • {parseFloat(item.total_usage).toFixed(2)} {item.usage_type.includes('gb') ? 'GB' : item.usage_type.includes('hour') ? 'hours' : 'units'}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-light text-slate-900 dark:text-white">
                          ${parseFloat(item.total_cost).toFixed(2)}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          ${parseFloat(item.avg_unit_price).toFixed(6)}/unit
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-slate-400">
                  No AWS costs recorded. Click "Sync AWS" to fetch costs.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trends" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-extralight">Cost Trends</CardTitle>
              <CardDescription>Daily breakdown by service category</CardDescription>
            </CardHeader>
            <CardContent>
              {dailyData.length > 0 ? (
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={dailyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" stroke="#6b7280" fontSize={12} />
                    <YAxis stroke="#6b7280" fontSize={12} />
                    <ChartTooltip />
                    <Bar dataKey="voice" stackId="a" fill={COLORS.voice_ai} />
                    <Bar dataKey="llm" stackId="a" fill={COLORS.llm} />
                    <Bar dataKey="aws" stackId="a" fill={COLORS.aws} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[400px] text-slate-400">
                  No trend data available
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

