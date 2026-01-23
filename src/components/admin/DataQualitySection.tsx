import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Alert,
  AlertDescription,
} from '@/components/ui/alert';
import { 
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Search,
  RefreshCw,
  Download,
  Filter,
  Loader2,
  BarChart3,
  Database,
  FileWarning,
  Calendar,
  DollarSign,
  User,
  TrendingUp,
  Eye,
  Sparkles,
  XCircle,
  Info
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useAdminTenant } from '@/contexts/AdminTenantContext';

/**
 * Data quality issue types
 */
type IssueType = 
  | 'missing_required'
  | 'invalid_format'
  | 'out_of_range'
  | 'future_date'
  | 'past_date'
  | 'logical_error'
  | 'duplicate'
  | 'anomaly';

/**
 * Issue severity levels
 */
type Severity = 'critical' | 'warning' | 'info';

/**
 * Data quality issue
 */
interface DataQualityIssue {
  id: string;
  loan_id: string;
  loan_number?: string;
  field_name: string;
  field_alias: string;
  current_value: any;
  expected_value?: any;
  issue_type: IssueType;
  severity: Severity;
  description: string;
  suggestion?: string;
  detected_at: string;
  is_resolved: boolean;
  resolved_at?: string;
  resolved_by?: string;
}

/**
 * Data quality metrics
 */
interface DataQualityMetrics {
  total_loans: number;
  loans_with_issues: number;
  total_issues: number;
  critical_issues: number;
  warning_issues: number;
  info_issues: number;
  quality_score: number;
  field_coverage: Record<string, number>;
  issues_by_type: Record<IssueType, number>;
  issues_by_field: Record<string, number>;
  trend: {
    date: string;
    score: number;
    issues: number;
  }[];
}

/**
 * Validation rule
 */
interface ValidationRule {
  id: string;
  name: string;
  description: string;
  field_name: string;
  rule_type: 'required' | 'format' | 'range' | 'date' | 'logic' | 'custom';
  configuration: Record<string, any>;
  severity: Severity;
  is_active: boolean;
  created_at: string;
}

// Issue type labels
const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  missing_required: 'Missing Required Field',
  invalid_format: 'Invalid Format',
  out_of_range: 'Out of Range',
  future_date: 'Future Date',
  past_date: 'Outdated Date',
  logical_error: 'Logical Error',
  duplicate: 'Duplicate',
  anomaly: 'Anomaly Detected'
};

// Severity colors
const SEVERITY_COLORS: Record<Severity, string> = {
  critical: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
};

// Severity icons
const SEVERITY_ICONS: Record<Severity, typeof AlertCircle> = {
  critical: XCircle,
  warning: AlertTriangle,
  info: Info
};

export function DataQualitySection() {
  const { user } = useAuth();
  const { toast } = useToast();
  
  // Use admin tenant context
  const { selectedTenantId, isTenantAdmin, currentTenantName } = useAdminTenant();
  
  // State
  const [metrics, setMetrics] = useState<DataQualityMetrics | null>(null);
  const [issues, setIssues] = useState<DataQualityIssue[]>([]);
  const [rules, setRules] = useState<ValidationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<IssueType | 'all'>('all');
  
  // Dialog states
  const [issueDetailsOpen, setIssueDetailsOpen] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<DataQualityIssue | null>(null);
  const [rulesDialogOpen, setRulesDialogOpen] = useState(false);

  // Load data when tenant changes
  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenantId]);

  const loadData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadMetrics(),
        loadIssues(),
        loadRules()
      ]);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to load data quality information',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const loadMetrics = async () => {
    // TODO: Replace with actual API call
    // const response = await api.request(`/api/data-quality/metrics?tenant_id=${selectedTenantId}`);
    
    // Mock metrics for development
    const mockMetrics: DataQualityMetrics = {
      total_loans: 4521,
      loans_with_issues: 342,
      total_issues: 567,
      critical_issues: 45,
      warning_issues: 234,
      info_issues: 288,
      quality_score: 87,
      field_coverage: {
        'loan_number': 100,
        'loan_amount': 99.8,
        'interest_rate': 99.5,
        'property_state': 98.2,
        'loan_officer': 95.6,
        'closing_date': 78.4,
        'funding_date': 72.1
      },
      issues_by_type: {
        missing_required: 156,
        invalid_format: 89,
        out_of_range: 67,
        future_date: 45,
        past_date: 34,
        logical_error: 78,
        duplicate: 12,
        anomaly: 86
      },
      issues_by_field: {
        'closing_date': 134,
        'funding_date': 98,
        'interest_rate': 67,
        'loan_officer': 45,
        'ltv_ratio': 89,
        'fico_score': 56
      },
      trend: [
        { date: '2024-01-01', score: 82, issues: 678 },
        { date: '2024-01-08', score: 83, issues: 645 },
        { date: '2024-01-15', score: 85, issues: 612 },
        { date: '2024-01-22', score: 86, issues: 589 },
        { date: '2024-01-29', score: 87, issues: 567 }
      ]
    };
    
    setMetrics(mockMetrics);
  };

  const loadIssues = async () => {
    // Mock issues for development
    const mockIssues: DataQualityIssue[] = [
      {
        id: '1',
        loan_id: 'loan-001',
        loan_number: 'LN-2024-0001',
        field_name: 'closing_date',
        field_alias: 'Closing Date',
        current_value: '2025-12-31',
        issue_type: 'future_date',
        severity: 'warning',
        description: 'Closing date is set to a future date more than 6 months from now',
        suggestion: 'Verify if this is an estimated closing date or a data entry error',
        detected_at: new Date().toISOString(),
        is_resolved: false
      },
      {
        id: '2',
        loan_id: 'loan-002',
        loan_number: 'LN-2024-0002',
        field_name: 'interest_rate',
        field_alias: 'Interest Rate',
        current_value: 25.5,
        expected_value: '3.0 - 12.0',
        issue_type: 'out_of_range',
        severity: 'critical',
        description: 'Interest rate (25.5%) is unusually high and outside typical range',
        suggestion: 'Check if the decimal point was entered correctly (should this be 2.55%?)',
        detected_at: new Date().toISOString(),
        is_resolved: false
      },
      {
        id: '3',
        loan_id: 'loan-003',
        loan_number: 'LN-2024-0003',
        field_name: 'loan_officer',
        field_alias: 'Loan Officer',
        current_value: null,
        issue_type: 'missing_required',
        severity: 'critical',
        description: 'Loan Officer is a required field but is empty',
        suggestion: 'Assign a loan officer to this loan',
        detected_at: new Date().toISOString(),
        is_resolved: false
      },
      {
        id: '4',
        loan_id: 'loan-004',
        loan_number: 'LN-2024-0004',
        field_name: 'ltv_ratio',
        field_alias: 'LTV Ratio',
        current_value: 156,
        expected_value: '0 - 100',
        issue_type: 'out_of_range',
        severity: 'warning',
        description: 'LTV ratio (156%) exceeds 100%, which is mathematically impossible for standard calculations',
        suggestion: 'Verify the loan amount and property value used in LTV calculation',
        detected_at: new Date().toISOString(),
        is_resolved: false
      },
      {
        id: '5',
        loan_id: 'loan-005',
        loan_number: 'LN-2024-0005',
        field_name: 'fico_score',
        field_alias: 'FICO Score',
        current_value: 350,
        expected_value: '300 - 850',
        issue_type: 'anomaly',
        severity: 'info',
        description: 'AI detected: FICO score is at the extreme low end, which is statistically rare',
        suggestion: 'Consider verifying with the credit report',
        detected_at: new Date().toISOString(),
        is_resolved: false
      },
      {
        id: '6',
        loan_id: 'loan-006',
        loan_number: 'LN-2024-0006',
        field_name: 'funding_date',
        field_alias: 'Funding Date',
        current_value: '2024-01-15',
        issue_type: 'logical_error',
        severity: 'warning',
        description: 'Funding date is before the closing date',
        suggestion: 'Verify the correct dates - funding typically occurs on or after closing',
        detected_at: new Date().toISOString(),
        is_resolved: false
      },
      {
        id: '7',
        loan_id: 'loan-007',
        loan_number: 'LN-2024-0007',
        field_name: 'property_zip',
        field_alias: 'Property Zip',
        current_value: '1234',
        expected_value: '5 or 9 digit ZIP code',
        issue_type: 'invalid_format',
        severity: 'warning',
        description: 'Property ZIP code format is invalid (should be 5 or 9 digits)',
        suggestion: 'Check and correct the property ZIP code',
        detected_at: new Date().toISOString(),
        is_resolved: false
      }
    ];
    
    setIssues(mockIssues);
  };

  const loadRules = async () => {
    // Mock rules for development
    const mockRules: ValidationRule[] = [
      {
        id: 'r1',
        name: 'Required Loan Number',
        description: 'Loan number must be present on all loans',
        field_name: 'loan_number',
        rule_type: 'required',
        configuration: {},
        severity: 'critical',
        is_active: true,
        created_at: new Date().toISOString()
      },
      {
        id: 'r2',
        name: 'Interest Rate Range',
        description: 'Interest rate must be between 0% and 15%',
        field_name: 'interest_rate',
        rule_type: 'range',
        configuration: { min: 0, max: 15 },
        severity: 'critical',
        is_active: true,
        created_at: new Date().toISOString()
      },
      {
        id: 'r3',
        name: 'Valid LTV Ratio',
        description: 'LTV ratio must be between 0% and 100%',
        field_name: 'ltv_ratio',
        rule_type: 'range',
        configuration: { min: 0, max: 100 },
        severity: 'warning',
        is_active: true,
        created_at: new Date().toISOString()
      },
      {
        id: 'r4',
        name: 'Valid FICO Score',
        description: 'FICO score must be between 300 and 850',
        field_name: 'fico_score',
        rule_type: 'range',
        configuration: { min: 300, max: 850 },
        severity: 'info',
        is_active: true,
        created_at: new Date().toISOString()
      },
      {
        id: 'r5',
        name: 'ZIP Code Format',
        description: 'Property ZIP must be valid 5 or 9 digit format',
        field_name: 'property_zip',
        rule_type: 'format',
        configuration: { pattern: '^\\d{5}(-\\d{4})?$' },
        severity: 'warning',
        is_active: true,
        created_at: new Date().toISOString()
      },
      {
        id: 'r6',
        name: 'Future Closing Date Check',
        description: 'Alert if closing date is more than 6 months in the future',
        field_name: 'closing_date',
        rule_type: 'date',
        configuration: { max_future_months: 6 },
        severity: 'warning',
        is_active: true,
        created_at: new Date().toISOString()
      }
    ];
    
    setRules(mockRules);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadData();
      toast({
        title: 'Refreshed',
        description: 'Data quality metrics updated'
      });
    } finally {
      setRefreshing(false);
    }
  };

  const handleExportIssues = () => {
    // TODO: Implement export functionality
    toast({
      title: 'Export Started',
      description: 'Preparing data quality report for download'
    });
  };

  const handleViewIssue = (issue: DataQualityIssue) => {
    setSelectedIssue(issue);
    setIssueDetailsOpen(true);
  };

  const handleResolveIssue = async (issueId: string) => {
    // TODO: Implement resolve functionality
    toast({
      title: 'Issue Resolved',
      description: 'The issue has been marked as resolved'
    });
    setIssueDetailsOpen(false);
    await loadIssues();
  };

  // Filter issues
  const filteredIssues = issues.filter(issue => {
    if (severityFilter !== 'all' && issue.severity !== severityFilter) return false;
    if (typeFilter !== 'all' && issue.issue_type !== typeFilter) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        issue.loan_number?.toLowerCase().includes(query) ||
        issue.field_alias.toLowerCase().includes(query) ||
        issue.description.toLowerCase().includes(query)
      );
    }
    return true;
  });

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-center h-64"
      >
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-light text-slate-900 dark:text-white">
            Data Quality Dashboard
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Monitor and resolve data quality issues in your loan data
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportIssues}
          >
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Quality Score Card */}
      {metrics && (
        <Card>
          <CardContent className="p-6">
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {/* Quality Score */}
              <div className="flex items-center gap-4">
                <div className={`p-4 rounded-xl ${
                  metrics.quality_score >= 90 
                    ? 'bg-emerald-100 dark:bg-emerald-900/30' 
                    : metrics.quality_score >= 70
                    ? 'bg-amber-100 dark:bg-amber-900/30'
                    : 'bg-rose-100 dark:bg-rose-900/30'
                }`}>
                  <BarChart3 className={`h-8 w-8 ${
                    metrics.quality_score >= 90 
                      ? 'text-emerald-600 dark:text-emerald-400' 
                      : metrics.quality_score >= 70
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`} />
                </div>
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Quality Score</p>
                  <p className="text-3xl font-semibold text-slate-900 dark:text-white">
                    {metrics.quality_score}%
                  </p>
                </div>
              </div>

              {/* Total Issues */}
              <div className="flex items-center gap-4">
                <div className="p-4 rounded-xl bg-rose-100 dark:bg-rose-900/30">
                  <AlertCircle className="h-8 w-8 text-rose-600 dark:text-rose-400" />
                </div>
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Total Issues</p>
                  <p className="text-3xl font-semibold text-slate-900 dark:text-white">
                    {metrics.total_issues}
                  </p>
                </div>
              </div>

              {/* Affected Loans */}
              <div className="flex items-center gap-4">
                <div className="p-4 rounded-xl bg-amber-100 dark:bg-amber-900/30">
                  <FileWarning className="h-8 w-8 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Affected Loans</p>
                  <p className="text-3xl font-semibold text-slate-900 dark:text-white">
                    {metrics.loans_with_issues}
                  </p>
                  <p className="text-xs text-slate-400">of {metrics.total_loans.toLocaleString()}</p>
                </div>
              </div>

              {/* Critical Issues */}
              <div className="flex items-center gap-4">
                <div className="p-4 rounded-xl bg-rose-100 dark:bg-rose-900/30">
                  <XCircle className="h-8 w-8 text-rose-600 dark:text-rose-400" />
                </div>
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Critical Issues</p>
                  <p className="text-3xl font-semibold text-rose-600 dark:text-rose-400">
                    {metrics.critical_issues}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="issues" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="issues">Issues ({issues.length})</TabsTrigger>
          <TabsTrigger value="coverage">Field Coverage</TabsTrigger>
          <TabsTrigger value="rules">Validation Rules</TabsTrigger>
        </TabsList>

        {/* Issues Tab */}
        <TabsContent value="issues" className="space-y-4 mt-6">
          {/* Filters */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Search by loan number, field, or description..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Select value={severityFilter} onValueChange={(v: any) => setSeverityFilter(v)}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Severity" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Severities</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="info">Info</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={typeFilter} onValueChange={(v: any) => setTypeFilter(v)}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Issue Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {Object.entries(ISSUE_TYPE_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Issues Table */}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Severity</TableHead>
                    <TableHead>Loan</TableHead>
                    <TableHead>Field</TableHead>
                    <TableHead>Issue</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredIssues.map(issue => {
                    const SeverityIcon = SEVERITY_ICONS[issue.severity];
                    return (
                      <TableRow key={issue.id}>
                        <TableCell>
                          <Badge className={SEVERITY_COLORS[issue.severity]}>
                            <SeverityIcon className="h-3 w-3 mr-1" />
                            {issue.severity}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {issue.loan_number || issue.loan_id.slice(0, 8)}
                        </TableCell>
                        <TableCell>{issue.field_alias}</TableCell>
                        <TableCell className="max-w-xs truncate">
                          {ISSUE_TYPE_LABELS[issue.issue_type]}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {issue.current_value?.toString() || <span className="text-slate-400">null</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewIssue(issue)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredIssues.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                        {searchQuery || severityFilter !== 'all' || typeFilter !== 'all'
                          ? 'No issues match your filters'
                          : 'No data quality issues found'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Field Coverage Tab */}
        <TabsContent value="coverage" className="space-y-4 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Field Population Coverage</CardTitle>
              <CardDescription>
                Percentage of loans that have data in each field
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {metrics && Object.entries(metrics.field_coverage)
                .sort(([, a], [, b]) => b - a)
                .map(([field, coverage]) => (
                  <div key={field} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        {field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                      </span>
                      <span className={`text-sm font-medium ${
                        coverage >= 95 ? 'text-emerald-600' :
                        coverage >= 80 ? 'text-amber-600' :
                        'text-rose-600'
                      }`}>
                        {coverage.toFixed(1)}%
                      </span>
                    </div>
                    <Progress 
                      value={coverage} 
                      className={`h-2 ${
                        coverage >= 95 ? '[&>div]:bg-emerald-500' :
                        coverage >= 80 ? '[&>div]:bg-amber-500' :
                        '[&>div]:bg-rose-500'
                      }`}
                    />
                  </div>
                ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Validation Rules Tab */}
        <TabsContent value="rules" className="space-y-4 mt-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Validation Rules</CardTitle>
                <CardDescription>
                  Rules used to detect data quality issues
                </CardDescription>
              </div>
              <Button variant="outline" size="sm">
                <Sparkles className="h-4 w-4 mr-2" />
                AI Suggestions
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {rules.map(rule => (
                  <div
                    key={rule.id}
                    className="flex items-center justify-between p-4 rounded-lg border border-slate-200 dark:border-slate-700"
                  >
                    <div className="flex items-center gap-4">
                      <Badge className={SEVERITY_COLORS[rule.severity]}>
                        {rule.severity}
                      </Badge>
                      <div>
                        <p className="font-medium text-slate-900 dark:text-white">
                          {rule.name}
                        </p>
                        <p className="text-sm text-slate-500">
                          {rule.description}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{rule.field_name}</Badge>
                      <Badge variant={rule.is_active ? 'default' : 'secondary'}>
                        {rule.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Alert>
            <Sparkles className="h-4 w-4" />
            <AlertDescription>
              AI-powered anomaly detection is analyzing your data to identify patterns 
              and suggest additional validation rules.
            </AlertDescription>
          </Alert>
        </TabsContent>
      </Tabs>

      {/* Issue Details Dialog */}
      <Dialog open={issueDetailsOpen} onOpenChange={setIssueDetailsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Issue Details</DialogTitle>
            <DialogDescription>
              Review and resolve this data quality issue
            </DialogDescription>
          </DialogHeader>

          {selectedIssue && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge className={SEVERITY_COLORS[selectedIssue.severity]}>
                  {selectedIssue.severity}
                </Badge>
                <Badge variant="outline">
                  {ISSUE_TYPE_LABELS[selectedIssue.issue_type]}
                </Badge>
              </div>

              <div className="grid gap-4 text-sm">
                <div>
                  <p className="text-slate-500">Loan</p>
                  <p className="font-medium font-mono">
                    {selectedIssue.loan_number || selectedIssue.loan_id}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Field</p>
                  <p className="font-medium">{selectedIssue.field_alias}</p>
                </div>
                <div>
                  <p className="text-slate-500">Current Value</p>
                  <p className="font-medium font-mono">
                    {selectedIssue.current_value?.toString() || 'null'}
                  </p>
                </div>
                {selectedIssue.expected_value && (
                  <div>
                    <p className="text-slate-500">Expected</p>
                    <p className="font-medium text-emerald-600">
                      {selectedIssue.expected_value}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-slate-500">Description</p>
                  <p className="font-medium">{selectedIssue.description}</p>
                </div>
                {selectedIssue.suggestion && (
                  <Alert>
                    <Sparkles className="h-4 w-4" />
                    <AlertDescription>
                      <strong>Suggestion:</strong> {selectedIssue.suggestion}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueDetailsOpen(false)}>
              Close
            </Button>
            <Button onClick={() => handleResolveIssue(selectedIssue?.id || '')}>
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Mark Resolved
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

export default DataQualitySection;
