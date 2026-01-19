import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Cloud, DollarSign, RefreshCw, ExternalLink, Server, TrendingUp, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Lender {
  tenant_id: string;
  tenant_name: string;
  aws_account_id: string;
  status: string;
  infrastructure_url: string;
  admin_url: string;
}

interface BillingRecord {
  id: string;
  billing_period_start: string;
  billing_period_end: string;
  total_cost: number;
  breakdown: Record<string, number>;
  payment_status: string;
  invoice_id: string;
}

interface BillingData {
  billing_history: BillingRecord[];
  current_month_estimate: number;
  current_month_breakdown: Record<string, number>;
}

interface SummaryData {
  summary: Array<{
    tenant_id: string;
    tenant_name: string;
    total_cost: number;
  }>;
  total_cost: number;
  period: {
    start: string;
    end: string;
  };
}

export const AWSHostingSection = () => {
  const [loading, setLoading] = useState(true);
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<string | null>(null);
  const [billingData, setBillingData] = useState<BillingData | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [summaryData, setSummaryData] = useState<SummaryData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const { toast } = useToast();

  const loadLenders = async () => {
    setLoading(true);
    try {
      const response = await api.request<{ lenders: Lender[] }>('/api/aws-hosting/lenders');
      setLenders(response.lenders || []);
      if (response.lenders.length > 0) {
        setSelectedTenant(response.lenders[0].tenant_id);
      }
    } catch (error: any) {
      console.error('Error loading lenders:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to load AWS hosting lenders',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const loadBilling = async (tenantId: string) => {
    setBillingLoading(true);
    try {
      const response = await api.request<BillingData>(`/api/aws-hosting/billing/${tenantId}`);
      setBillingData(response);
    } catch (error: any) {
      console.error('Error loading billing:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to load billing history',
        variant: 'destructive',
      });
    } finally {
      setBillingLoading(false);
    }
  };

  const loadSummary = async () => {
    setSummaryLoading(true);
    try {
      const response = await api.request<SummaryData>('/api/aws-hosting/summary');
      setSummaryData(response);
    } catch (error: any) {
      console.error('Error loading summary:', error);
      // Don't show error toast for summary - it's optional
    } finally {
      setSummaryLoading(false);
    }
  };

  const refreshAll = async () => {
    await loadLenders();
    await loadSummary();
    if (selectedTenant) {
      await loadBilling(selectedTenant);
    }
    toast({
      title: 'Data Refreshed',
      description: 'AWS hosting data has been updated.',
    });
  };

  useEffect(() => {
    loadLenders();
    loadSummary();
  }, []);

  useEffect(() => {
    if (selectedTenant) {
      loadBilling(selectedTenant);
    }
  }, [selectedTenant]);

  if (loading) {
    return (
      <Card className="border-slate-200 dark:border-slate-700">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </CardContent>
      </Card>
    );
  }

  if (lenders.length === 0) {
    return (
      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
        <CardContent className="text-center py-16">
          <Cloud className="h-16 w-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">
            No AWS Hosting Deployments
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 max-w-md mx-auto font-light">
            Configure per-lender AWS hosting to manage dedicated infrastructure 
            and track hosting costs for each client.
          </p>
          <div className="mt-6 p-4 bg-slate-50 dark:bg-slate-800/30 rounded-lg max-w-lg mx-auto text-left">
            <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">AWS Hosting Features:</p>
            <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 font-light">
              <li>• Dedicated AWS infrastructure per lender</li>
              <li>• Real-time cost tracking and billing history</li>
              <li>• Direct access to infrastructure and admin dashboards</li>
              <li>• Monthly cost estimates and breakdowns by service</li>
            </ul>
          </div>
          <div className="flex items-center justify-center gap-2 text-xs text-slate-400 mt-6">
            <span className="font-extralight">Need help setting up AWS hosting?</span>
            <Button 
              variant="link" 
              size="sm" 
              className="h-auto p-0 text-blue-500 hover:text-blue-600 font-light"
              onClick={() => window.open('https://docs.aws.amazon.com/organizations/', '_blank')}
            >
              View Documentation
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const selectedLender = lenders.find(l => l.tenant_id === selectedTenant);

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      {summaryData && summaryData.summary.length > 0 && (
        <Card className="border-slate-200 dark:border-slate-700 bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-100 dark:bg-orange-900/40 rounded-lg">
                  <TrendingUp className="h-6 w-6 text-orange-600 dark:text-orange-400" />
                </div>
                <div>
                  <CardTitle className="text-xl font-thin text-slate-900 dark:text-white tracking-tight">
                    AWS Hosting Summary
                  </CardTitle>
                  <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light mt-1">
                    Current month total across all lenders
                  </CardDescription>
                </div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-light text-slate-900 dark:text-white">
                  ${summaryData.total_cost.toFixed(2)}
                </div>
                <Badge variant="outline" className="mt-1">
                  {lenders.length} Lender{lenders.length !== 1 ? 's' : ''}
                </Badge>
              </div>
            </div>
          </CardHeader>
          {summaryData.summary.length > 0 && (
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {summaryData.summary.slice(0, 3).map(item => (
                  <div key={item.tenant_id} className="p-4 bg-white/60 dark:bg-slate-800/40 rounded-lg border border-slate-200 dark:border-slate-700">
                    <div className="text-base font-extralight text-slate-500 dark:text-slate-400 mb-1">{item.tenant_name}</div>
                    <div className="text-xl font-light text-slate-900 dark:text-white">
                      ${parseFloat(String(item.total_cost)).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
              {summaryData.summary.length > 3 && (
                <p className="text-xs text-slate-500 dark:text-slate-400 font-light mt-4 text-center">
                  + {summaryData.summary.length - 3} more lender{summaryData.summary.length - 3 !== 1 ? 's' : ''}
                </p>
              )}
            </CardContent>
          )}
        </Card>
      )}

      {/* Lender Selection */}
      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-thin text-slate-900 dark:text-white">
                AWS Hosting - Lender Selection
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
                Select a lender to view their AWS hosting costs and billing history
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={refreshAll}
              disabled={loading || summaryLoading}
              className="font-extralight"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${(loading || summaryLoading) ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Select value={selectedTenant || undefined} onValueChange={setSelectedTenant}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a lender" />
            </SelectTrigger>
            <SelectContent>
              {lenders.map(lender => (
                <SelectItem key={lender.tenant_id} value={lender.tenant_id}>
                  {lender.tenant_name} ({lender.aws_account_id})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Deployment Status and Links */}
          {selectedLender && (
            <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-800/30 rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-slate-500" />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Deployment Status</span>
                </div>
                <Badge
                  variant={selectedLender.status === 'active' ? 'default' : 'secondary'}
                  className={
                    selectedLender.status === 'active'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                  }
                >
                  {selectedLender.status || 'Unknown'}
                </Badge>
              </div>
              <div className="space-y-2">
                {selectedLender.infrastructure_url && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start font-light text-xs"
                    onClick={() => window.open(selectedLender.infrastructure_url, '_blank')}
                  >
                    <Cloud className="h-3 w-3 mr-2" />
                    Infrastructure Dashboard
                    <ExternalLink className="h-3 w-3 ml-auto" />
                  </Button>
                )}
                {selectedLender.admin_url && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start font-light text-xs"
                    onClick={() => window.open(selectedLender.admin_url, '_blank')}
                  >
                    <Settings className="h-3 w-3 mr-2" />
                    Admin Console
                    <ExternalLink className="h-3 w-3 ml-auto" />
                  </Button>
                )}
                {selectedLender.aws_account_id && (
                  <div className="text-xs text-slate-500 dark:text-slate-400 font-light pt-2 border-t border-slate-200 dark:border-slate-700">
                    AWS Account: <span className="font-mono">{selectedLender.aws_account_id}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Current Month Estimate */}
      {selectedLender && billingData && (
        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg font-thin text-slate-900 dark:text-white">
                  Current Month Estimate
                </CardTitle>
                <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light mt-1">
                  {selectedLender.tenant_name}
                </CardDescription>
              </div>
              <div className="text-right">
                <div className="text-2xl font-light text-slate-900 dark:text-white">
                  ${parseFloat(String(billingData.current_month_estimate)).toFixed(2)}
                </div>
                <Badge variant="outline" className="mt-1">
                  Estimated
                </Badge>
              </div>
            </div>
          </CardHeader>
          {Object.keys(billingData.current_month_breakdown).length > 0 && (
            <CardContent>
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Cost Breakdown:</p>
                {Object.entries(billingData.current_month_breakdown).map(([service, cost]) => (
                  <div key={service} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600 dark:text-slate-400 capitalize">{service}:</span>
                    <span className="font-medium text-slate-900 dark:text-white">
                      ${parseFloat(String(cost)).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Billing History */}
      {selectedLender && (
        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-emerald-500" />
              <div>
                <CardTitle className="text-lg font-thin text-slate-900 dark:text-white">
                  Billing History
                </CardTitle>
                <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light mt-1">
                  Past 12 months of AWS hosting costs
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {billingLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : billingData && billingData.billing_history.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Period</TableHead>
                      <TableHead className="text-right">Total Cost</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Invoice</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {billingData.billing_history.map(record => (
                      <TableRow key={record.id}>
                        <TableCell className="font-medium">
                          {new Date(record.billing_period_start).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          ${parseFloat(String(record.total_cost)).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={record.payment_status === 'paid' ? 'default' : 'secondary'}
                            className={
                              record.payment_status === 'paid'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                : record.payment_status === 'overdue'
                                ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                                : ''
                            }
                          >
                            {record.payment_status}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {record.invoice_id || 'N/A'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-slate-500 dark:text-slate-400">No billing history available</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};
