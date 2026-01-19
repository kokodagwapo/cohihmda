import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { 
  CheckCircle2, 
  Shield, 
  Clock, 
  Search, 
  Filter,
  Download,
  RefreshCw,
  Eye,
  AlertCircle,
  TrendingUp,
  Activity,
  Users,
  FileText,
  Calendar
} from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface AuditLog {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  action: string;
  resource_type: string;
  resource_id: string;
  details: any;
  ip_address: string;
  user_agent: string;
  created_at: string;
  status?: string;
  description?: string;
  changes?: any;
  metadata?: any;
  error_message?: string;
}

interface AuditStats {
  totalLogs: number;
  last24h: number;
  last7d: number;
  last30d: number;
  topActions: Array<{ action: string; count: string }>;
  topUsers: Array<{ user_id: string; user_email: string; user_name: string; action_count: string }>;
}

export function SOC2ComplianceSection() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fetchAuditLogs = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '50',
      });
      
      if (searchQuery) params.append('search', searchQuery);
      if (actionFilter) params.append('action', actionFilter);
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);

      const response = await api.request<{
        logs: AuditLog[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>(`/api/admin/audit-logs?${params.toString()}`);
      setLogs(response.logs);
      setTotalPages(response.pagination.totalPages);
      setTotal(response.pagination.total);
    } catch (error: any) {
      console.error('Error fetching audit logs:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch audit logs',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchAuditStats = async () => {
    try {
      const response = await api.request<AuditStats>('/api/admin/audit-stats');
      setStats(response);
    } catch (error: any) {
      console.error('Error fetching audit stats:', error);
    }
  };

  useEffect(() => {
    fetchAuditLogs();
    fetchAuditStats();
  }, [page, actionFilter, startDate, endDate]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (!loading) {
        fetchAuditLogs();
        fetchAuditStats();
      }
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [loading]);

  const handleSearch = () => {
    setPage(1);
    fetchAuditLogs();
  };

  const handleReset = () => {
    setSearchQuery('');
    setActionFilter('');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  const getActionBadgeColor = (action: string) => {
    const colors: Record<string, string> = {
      'user.created': 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
      'user.updated': 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
      'user.deleted': 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
      'login.success': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
      'login.failed': 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
      'settings.updated': 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
      'tenant.created': 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
      'tenant.updated': 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
      'loan.created': 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
      'loan.updated': 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
      'document.uploaded': 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
      'document.deleted': 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    };
    return colors[action] || 'bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300';
  };

  const handleExportCSV = () => {
    try {
      const headers = ['Timestamp', 'User', 'Action', 'Resource Type', 'Resource ID', 'IP Address', 'Status'];
      const rows = logs.map(log => [
        format(new Date(log.created_at), 'yyyy-MM-dd HH:mm:ss'),
        log.user_email || 'Unknown',
        log.action,
        log.resource_type,
        log.resource_id || 'N/A',
        log.ip_address || 'N/A',
        log.status || 'success',
      ]);

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `audit-logs-${format(new Date(), 'yyyy-MM-dd')}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({
        title: 'Export Successful',
        description: 'Audit logs exported to CSV',
      });
    } catch (error: any) {
      toast({
        title: 'Export Failed',
        description: error.message || 'Failed to export audit logs',
        variant: 'destructive',
      });
    }
  };

  const handleViewDetails = (log: AuditLog) => {
    setSelectedLog(log);
    setDetailsModalOpen(true);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      {/* SOC 2 Compliance Header */}
      <Card className="border-slate-200/60 dark:border-slate-700/50 bg-gradient-to-br from-emerald-50 via-white to-teal-50 dark:from-emerald-900/20 dark:via-slate-800/50 dark:to-teal-900/20 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-all duration-300 rounded-xl">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
            <div className="h-16 w-16 rounded-full bg-gradient-to-br from-emerald-100 to-teal-100 dark:from-emerald-900/40 dark:to-teal-900/40 flex items-center justify-center shadow-lg flex-shrink-0">
              <Shield className="h-8 w-8 text-emerald-600 dark:text-emerald-400" strokeWidth={2} />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-light text-slate-900 dark:text-white tracking-tight mb-1">
                SOC 2 Type II Compliance
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 font-light">
                Comprehensive audit logging and compliance monitoring. All system actions are tracked with full traceability for regulatory compliance.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge className="bg-emerald-600 text-white border-0 px-4 py-2 text-base font-extralight">
                Compliant
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportCSV}
                className="font-extralight"
                disabled={logs.length === 0}
              >
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Statistics Dashboard */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
          <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-all duration-300 rounded-xl">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-base font-extralight text-slate-600 dark:text-slate-400 mb-1">Total Events</p>
                  <p className="text-3xl font-extralight text-slate-900 dark:text-white">
                    {stats.totalLogs.toLocaleString()}
                  </p>
                </div>
                <div className="h-12 w-12 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                  <Activity className="h-6 w-6 text-blue-600 dark:text-blue-400" strokeWidth={1.5} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-all duration-300 rounded-xl">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-base font-extralight text-slate-600 dark:text-slate-400 mb-1">Last 24 Hours</p>
                  <p className="text-3xl font-extralight text-slate-900 dark:text-white">
                    {stats.last24h.toLocaleString()}
                  </p>
                </div>
                <div className="h-12 w-12 rounded-full bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
                  <Clock className="h-6 w-6 text-emerald-600 dark:text-emerald-400" strokeWidth={1.5} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-all duration-300 rounded-xl">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-base font-extralight text-slate-600 dark:text-slate-400 mb-1">Last 7 Days</p>
                  <p className="text-3xl font-extralight text-slate-900 dark:text-white">
                    {stats.last7d.toLocaleString()}
                  </p>
                </div>
                <div className="h-12 w-12 rounded-full bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center">
                  <Calendar className="h-6 w-6 text-purple-600 dark:text-purple-400" strokeWidth={1.5} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-all duration-300 rounded-xl">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-base font-extralight text-slate-600 dark:text-slate-400 mb-1">Last 30 Days</p>
                  <p className="text-3xl font-extralight text-slate-900 dark:text-white">
                    {stats.last30d.toLocaleString()}
                  </p>
                </div>
                <div className="h-12 w-12 rounded-full bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center">
                  <TrendingUp className="h-6 w-6 text-amber-600 dark:text-amber-400" strokeWidth={1.5} />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Top Actions and Users */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-5">
          <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-all duration-300 rounded-xl">
            <CardHeader>
              <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20">
                  <FileText className="h-4 w-4 text-indigo-600 dark:text-indigo-400" strokeWidth={1.5} />
                </div>
                Top Actions
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
                Most frequent audit events
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {stats.topActions && stats.topActions.length > 0 ? (
                  stats.topActions.slice(0, 5).map((item, index) => (
                    <div key={index} className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700 last:border-0">
                      <span className="text-base font-extralight text-slate-900 dark:text-white">{item.action}</span>
                      <Badge variant="outline" className="font-extralight">
                        {parseInt(item.count || '0').toLocaleString()}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-400 font-light text-center py-4">No actions recorded</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-all duration-300 rounded-xl">
            <CardHeader>
              <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-rose-50 dark:bg-rose-900/20">
                  <Users className="h-4 w-4 text-rose-600 dark:text-rose-400" strokeWidth={1.5} />
                </div>
                Most Active Users
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
                Users with most audit events
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {stats.topUsers && stats.topUsers.length > 0 ? (
                  stats.topUsers.slice(0, 5).map((item, index) => (
                    <div key={index} className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700 last:border-0">
                      <div className="flex-1 min-w-0">
                        <div className="text-base font-extralight text-slate-900 dark:text-white truncate">
                          {item.user_name || item.user_email || 'Unknown'}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-500 font-light truncate">
                          {item.user_email || 'N/A'}
                        </div>
                      </div>
                      <Badge variant="outline" className="font-extralight ml-2">
                        {parseInt(item.action_count || '0').toLocaleString()}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-400 font-light text-center py-4">No users recorded</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-all duration-300 rounded-xl">
        <CardHeader>
              <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-sky-50 dark:bg-sky-900/20">
                  <Filter className="h-4 w-4 text-sky-600 dark:text-sky-400" strokeWidth={1.5} />
                </div>
                Filter Audit Logs
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
                Search and filter audit trail events by action, date range, or keyword
              </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="search" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Search
              </Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" strokeWidth={1.5} />
                <Input
                  id="search"
                  placeholder="Search logs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  className="pl-9 h-12 border-slate-300 focus:border-blue-500 focus:ring-blue-500 text-base px-4"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="action" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Action Type
              </Label>
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger className="h-12">
                  <SelectValue placeholder="All actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  <SelectItem value="user.created">User Created</SelectItem>
                  <SelectItem value="user.updated">User Updated</SelectItem>
                  <SelectItem value="user.deleted">User Deleted</SelectItem>
                  <SelectItem value="tenant.created">Tenant Created</SelectItem>
                  <SelectItem value="tenant.updated">Tenant Updated</SelectItem>
                  <SelectItem value="login.success">Login Success</SelectItem>
                  <SelectItem value="login.failed">Login Failed</SelectItem>
                  <SelectItem value="settings.updated">Settings Updated</SelectItem>
                  <SelectItem value="loan.created">Loan Created</SelectItem>
                  <SelectItem value="loan.updated">Loan Updated</SelectItem>
                  <SelectItem value="document.uploaded">Document Uploaded</SelectItem>
                  <SelectItem value="document.deleted">Document Deleted</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="startDate" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Start Date
              </Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-12 border-slate-300 focus:border-blue-500 focus:ring-blue-500 text-base px-4"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="endDate" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                End Date
              </Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-12 border-slate-300 focus:border-blue-500 focus:ring-blue-500 text-base px-4"
              />
            </div>
          </div>

          <div className="flex gap-3 mt-4">
            <Button onClick={handleSearch} className="h-11 px-6 font-light">
              <Search className="h-4 w-4 mr-2" strokeWidth={1.5} />
              Apply Filters
            </Button>
            <Button onClick={handleReset} variant="outline" className="h-11 px-6 font-light">
              <RefreshCw className="h-4 w-4 mr-2" strokeWidth={1.5} />
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Audit Logs Table */}
      <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-all duration-300 rounded-xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
                Audit Trail History
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
                Complete audit log of all system actions with full traceability for compliance review
              </CardDescription>
            </div>
            <Button 
              variant="outline" 
              className="h-11 px-6 font-light"
              onClick={handleExportCSV}
              disabled={logs.length === 0}
            >
              <Download className="h-4 w-4 mr-2" strokeWidth={1.5} />
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-slate-400" strokeWidth={1.5} />
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-12">
              <AlertCircle className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" strokeWidth={1.5} />
              <p className="text-sm text-slate-600 dark:text-slate-400 font-light">
                No audit logs found matching your filters
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-200 dark:border-slate-700">
                      <TableHead className="font-extralight text-slate-600 dark:text-slate-400">Timestamp</TableHead>
                      <TableHead className="font-extralight text-slate-600 dark:text-slate-400">User</TableHead>
                      <TableHead className="font-extralight text-slate-600 dark:text-slate-400">Action</TableHead>
                      <TableHead className="font-extralight text-slate-600 dark:text-slate-400">Resource</TableHead>
                      <TableHead className="font-extralight text-slate-600 dark:text-slate-400">IP Address</TableHead>
                      <TableHead className="font-extralight text-slate-600 dark:text-slate-400">Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow key={log.id} className="border-slate-200 dark:border-slate-700">
                        <TableCell className="font-extralight text-slate-900 dark:text-white">
                          <div className="text-sm">{format(new Date(log.created_at), 'MMM dd, yyyy')}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-500">
                            {format(new Date(log.created_at), 'HH:mm:ss')}
                          </div>
                        </TableCell>
                        <TableCell className="font-extralight text-slate-900 dark:text-white">
                          <div className="text-sm">{log.user_name || 'Unknown'}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-500 truncate max-w-[200px]">
                            {log.user_email}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={`${getActionBadgeColor(log.action)} border-0 font-light`}>
                            {log.action}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-extralight text-slate-900 dark:text-white">
                          <div className="text-sm">{log.resource_type}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-500 truncate max-w-[150px]">
                            {log.resource_id}
                          </div>
                        </TableCell>
                        <TableCell className="font-extralight text-slate-600 dark:text-slate-400 text-sm">
                          {log.ip_address || 'N/A'}
                        </TableCell>
                        <TableCell>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-8 px-2 font-light"
                            onClick={() => handleViewDetails(log)}
                            title="View details"
                          >
                            <Eye className="h-4 w-4" strokeWidth={1.5} />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
                <div className="text-sm text-slate-600 dark:text-slate-400 font-light">
                  Showing page {page} of {totalPages} ({total.toLocaleString()} total events)
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setPage(page - 1)}
                    disabled={page === 1}
                    className="h-10 px-4 font-light"
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setPage(page + 1)}
                    disabled={page === totalPages}
                    className="h-10 px-4 font-light"
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Details Modal */}
      <Dialog open={detailsModalOpen} onOpenChange={setDetailsModalOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-thin text-slate-900 dark:text-white tracking-tight">
              Audit Log Details
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
              Complete audit trail information for compliance review
            </DialogDescription>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-medium text-slate-500 dark:text-slate-400">Timestamp</Label>
                  <p className="text-base font-extralight text-slate-900 dark:text-white mt-1">
                    {format(new Date(selectedLog.created_at), 'PPpp')}
                  </p>
                </div>
                <div>
                  <Label className="text-xs font-medium text-slate-500 dark:text-slate-400">Status</Label>
                  <Badge className={`mt-1 ${selectedLog.status === 'success' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'}`}>
                    {selectedLog.status || 'success'}
                  </Badge>
                </div>
                <div>
                  <Label className="text-xs font-medium text-slate-500 dark:text-slate-400">User</Label>
                  <p className="text-base font-extralight text-slate-900 dark:text-white mt-1">
                    {selectedLog.user_name || selectedLog.user_email || 'Unknown'}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {selectedLog.user_email}
                  </p>
                </div>
                <div>
                  <Label className="text-xs font-medium text-slate-500 dark:text-slate-400">Action</Label>
                  <Badge className={`mt-1 ${getActionBadgeColor(selectedLog.action)} border-0`}>
                    {selectedLog.action}
                  </Badge>
                </div>
                <div>
                  <Label className="text-xs font-medium text-slate-500 dark:text-slate-400">Resource Type</Label>
                  <p className="text-base font-extralight text-slate-900 dark:text-white mt-1">
                    {selectedLog.resource_type}
                  </p>
                </div>
                <div>
                  <Label className="text-xs font-medium text-slate-500 dark:text-slate-400">Resource ID</Label>
                  <p className="text-base font-extralight text-slate-900 dark:text-white mt-1 font-mono text-xs">
                    {selectedLog.resource_id || 'N/A'}
                  </p>
                </div>
                <div>
                  <Label className="text-xs font-medium text-slate-500 dark:text-slate-400">IP Address</Label>
                  <p className="text-base font-extralight text-slate-900 dark:text-white mt-1 font-mono">
                    {selectedLog.ip_address || 'N/A'}
                  </p>
                </div>
                <div>
                  <Label className="text-xs font-medium text-slate-500 dark:text-slate-400">User Agent</Label>
                  <p className="text-base font-extralight text-slate-900 dark:text-white mt-1 text-xs break-all">
                    {selectedLog.user_agent || 'N/A'}
                  </p>
                </div>
              </div>

              {selectedLog.description && (
                <div>
                  <Label className="text-xs font-medium text-slate-500 dark:text-slate-400">Description</Label>
                  <p className="text-base font-extralight text-slate-900 dark:text-white mt-1">
                    {selectedLog.description}
                  </p>
                </div>
              )}

              {selectedLog.changes && (
                <div>
                  <Label className="text-xs font-medium text-slate-500 dark:text-slate-400">Changes</Label>
                  <pre className="text-xs font-mono bg-slate-50 dark:bg-slate-800 p-3 rounded-lg mt-1 overflow-x-auto">
                    {JSON.stringify(selectedLog.changes, null, 2)}
                  </pre>
                </div>
              )}

              {selectedLog.metadata && (
                <div>
                  <Label className="text-xs font-medium text-slate-500 dark:text-slate-400">Metadata</Label>
                  <pre className="text-xs font-mono bg-slate-50 dark:bg-slate-800 p-3 rounded-lg mt-1 overflow-x-auto">
                    {JSON.stringify(selectedLog.metadata, null, 2)}
                  </pre>
                </div>
              )}

              {selectedLog.error_message && (
                <div>
                  <Label className="text-xs font-medium text-red-600 dark:text-red-400">Error Message</Label>
                  <p className="text-base font-extralight text-red-700 dark:text-red-300 mt-1">
                    {selectedLog.error_message}
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
