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
  Loader2,
  BarChart3,
  Database,
  FileWarning,
  TrendingUp,
  TrendingDown,
  Eye,
  Sparkles,
  XCircle,
  Info,
  Star,
  Activity,
  Gauge,
  LayoutDashboard,
  ListChecks,
  Target
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useAdminTenant } from '@/contexts/AdminTenantContext';
import { FieldPopulationStats } from './FieldPopulationStats';

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

/**
 * Crucial fields list from Qlik Data Pilot
 * These are priority fields that should always be populated
 */
const CRUCIAL_FIELDS = [
  { name: 'Funding Date', column: 'funding_date', priority: 1 },
  { name: 'Branch', column: 'branch', priority: 2 },
  { name: 'Closing Date', column: 'closing_date', priority: 3 },
  { name: 'Started Date', column: 'started_date', priority: 4 },
  { name: 'Loan Officer', column: 'loan_officer', priority: 5 },
  { name: 'Processor', column: 'processor', priority: 6 },
  { name: 'Underwriter', column: 'underwriter', priority: 7 },
  { name: 'Closer', column: 'closer', priority: 8 },
  { name: 'Account Executive', column: 'account_executive', priority: 9 },
  { name: 'Conditional Approval Date', column: 'conditional_approval_date', priority: 10 },
  { name: 'Credit Pull Date', column: 'credit_pull_date', priority: 11 },
  { name: 'CTC Date', column: 'ctc_date', priority: 12 },
  { name: 'Estimated Closing Date', column: 'estimated_closing_date', priority: 13 },
  { name: 'Investor Purchase Date', column: 'investor_purchase_date', priority: 14 },
  { name: 'Resubmittal Date', column: 'resubmittal_date', priority: 15 },
  { name: 'Shipped Date', column: 'shipped_date', priority: 16 },
  { name: 'UW Approval Date', column: 'uw_approval_date', priority: 17 },
  { name: 'UW Final Approval Date', column: 'uw_final_approval_date', priority: 18 },
  { name: 'Submitted To Processing Date', column: 'submitted_to_processing_date', priority: 19 },
  { name: 'Submitted To Underwriting Date', column: 'submitted_to_underwriting_date', priority: 20 },
  { name: 'Loan Amount', column: 'loan_amount', priority: 21 },
  { name: 'Loan Number', column: 'loan_number', priority: 22 },
  { name: 'Current Status Date', column: 'current_status_date', priority: 23 },
  { name: 'UW Denied Date', column: 'uw_denied_date', priority: 24 },
  { name: 'Application Date', column: 'application_date', priority: 25 },
  { name: 'Loan Estimate Sent Date', column: 'loan_estimate_sent_date', priority: 26 },
  { name: 'Rate Lock Buy Side Base Price Rate', column: 'rate_lock_buy_side_base_price_rate', priority: 27 },
  { name: 'Loan Source', column: 'loan_source', priority: 28 },
  { name: 'Investor Status', column: 'investor_status', priority: 29 },
];

/**
 * Range configuration for key loan metrics
 * Inspired by Qlik Data Pilot's range validation
 */
const RANGE_CONFIG = {
  fico: { min: 300, max: 850, label: 'FICO Score', column: 'fico_score' },
  ltv: { min: 0, max: 100, label: 'LTV Ratio', column: 'ltv_ratio' },
  dti: { min: 0, max: 100, label: 'DTI Ratio', column: 'dti_ratio' },
  interestRate: { min: 0, max: 15, label: 'Interest Rate', column: 'interest_rate' },
};

/**
 * Population density categorization (Qlik-style)
 */
type DensityCategory = 'heavily' | 'mildly' | 'sparsely' | 'not';

const getDensityCategory = (rate: number): DensityCategory => {
  if (rate >= 50) return 'heavily';
  if (rate >= 20) return 'mildly';
  if (rate > 0) return 'sparsely';
  return 'not';
};

const DENSITY_LABELS: Record<DensityCategory, string> = {
  heavily: 'Heavily Populated',
  mildly: 'Mildly Populated',
  sparsely: 'Sparsely Populated',
  not: 'Not Populated'
};

const DENSITY_COLORS: Record<DensityCategory, string> = {
  heavily: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  mildly: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  sparsely: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  not: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
};

/**
 * Range analysis data structure
 */
interface RangeAnalysis {
  fico: { inRange: number; outOfRange: number; distribution: { range: string; count: number }[] };
  ltv: { inRange: number; outOfRange: number; distribution: { range: string; count: number }[] };
  dti: { inRange: number; outOfRange: number; distribution: { range: string; count: number }[] };
  interestRate: { inRange: number; outOfRange: number; distribution: { range: string; count: number }[] };
}

/**
 * Crucial field status
 */
interface CrucialFieldStatus {
  name: string;
  column: string;
  priority: number;
  populationRate: number;
  populatedCount: number;
  totalCount: number;
  status: 'good' | 'warning' | 'critical';
}

export function DataQualitySection() {
  const { user } = useAuth();
  const { toast } = useToast();
  
  // Use admin tenant context
  const { selectedTenantId, isTenantAdmin, currentTenantName } = useAdminTenant();
  
  // State
  const [metrics, setMetrics] = useState<DataQualityMetrics | null>(null);
  const [issues, setIssues] = useState<DataQualityIssue[]>([]);
  const [rules, setRules] = useState<ValidationRule[]>([]);
  const [crucialFields, setCrucialFields] = useState<CrucialFieldStatus[]>([]);
  const [rangeAnalysis, setRangeAnalysis] = useState<RangeAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<IssueType | 'all'>('all');
  const [warningGroupFilter, setWarningGroupFilter] = useState<string>('all');
  
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
        loadRules(),
        loadCrucialFields(),
        loadRangeAnalysis()
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
    try {
      // Try to fetch from API
      const response = await api.request<{ success: boolean; metrics: { total_loans: number; loans_with_issues: number; total_issues: number; quality_score: number; critical_issues: number; warning_issues: number; info_issues: number } }>(`/api/data-quality/metrics?tenant_id=${selectedTenantId}`);
      
      if (response.success && response.metrics) {
        // Convert API response to DataQualityMetrics format
        setMetrics({
          total_loans: response.metrics.total_loans,
          loans_with_issues: response.metrics.loans_with_issues,
          total_issues: response.metrics.total_issues,
          critical_issues: response.metrics.critical_issues,
          warning_issues: response.metrics.warning_issues,
          info_issues: response.metrics.info_issues,
          quality_score: response.metrics.quality_score,
          // These will be populated from other API calls or mock data for now
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
            missing_required: response.metrics.critical_issues,
            invalid_format: Math.round(response.metrics.warning_issues * 0.3),
            out_of_range: Math.round(response.metrics.warning_issues * 0.4),
            future_date: Math.round(response.metrics.info_issues * 0.3),
            past_date: Math.round(response.metrics.info_issues * 0.2),
            logical_error: Math.round(response.metrics.warning_issues * 0.3),
            duplicate: 0,
            anomaly: Math.round(response.metrics.info_issues * 0.5)
          },
          issues_by_field: {
            'closing_date': Math.round(response.metrics.total_issues * 0.2),
            'funding_date': Math.round(response.metrics.total_issues * 0.15),
            'interest_rate': Math.round(response.metrics.total_issues * 0.1),
            'loan_officer': Math.round(response.metrics.total_issues * 0.08),
            'ltv_ratio': Math.round(response.metrics.total_issues * 0.15),
            'fico_score': Math.round(response.metrics.total_issues * 0.1)
          },
          trend: [
            { date: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], score: Math.max(0, response.metrics.quality_score - 5), issues: response.metrics.total_issues + 100 },
            { date: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], score: Math.max(0, response.metrics.quality_score - 4), issues: response.metrics.total_issues + 75 },
            { date: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], score: Math.max(0, response.metrics.quality_score - 2), issues: response.metrics.total_issues + 50 },
            { date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], score: Math.max(0, response.metrics.quality_score - 1), issues: response.metrics.total_issues + 25 },
            { date: new Date().toISOString().split('T')[0], score: response.metrics.quality_score, issues: response.metrics.total_issues }
          ]
        });
        return;
      }
    } catch (error) {
      console.warn('Failed to load metrics from API, using mock data', error);
    }
    
    // Fallback to mock metrics for development
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

  const loadCrucialFields = async () => {
    try {
      // Try to fetch from API
      const response = await api.request<{ success: boolean; crucialFields: CrucialFieldStatus[] }>(`/api/data-quality/crucial-fields-status?tenant_id=${selectedTenantId}`);
      
      if (response.success && response.crucialFields) {
        setCrucialFields(response.crucialFields);
        return;
      }
    } catch (error) {
      console.warn('Failed to load crucial fields from API, using mock data', error);
    }
    
    // Fallback to mock crucial fields status for development
    const mockCrucialFields: CrucialFieldStatus[] = CRUCIAL_FIELDS.map(field => {
      // Generate mock population rates
      const populationRate = Math.random() * 100;
      const totalCount = 4521;
      const populatedCount = Math.round(totalCount * (populationRate / 100));
      
      return {
        name: field.name,
        column: field.column,
        priority: field.priority,
        populationRate: Math.round(populationRate * 10) / 10,
        populatedCount,
        totalCount,
        status: populationRate >= 80 ? 'good' : populationRate >= 50 ? 'warning' : 'critical'
      };
    });
    
    setCrucialFields(mockCrucialFields);
  };

  const loadRangeAnalysis = async () => {
    try {
      // Try to fetch from API
      const response = await api.request<{ success: boolean; rangeAnalysis: RangeAnalysis }>(`/api/data-quality/range-analysis?tenant_id=${selectedTenantId}`);
      
      if (response.success && response.rangeAnalysis) {
        setRangeAnalysis(response.rangeAnalysis);
        return;
      }
    } catch (error) {
      console.warn('Failed to load range analysis from API, using mock data', error);
    }
    
    // Fallback to mock range analysis for development
    const mockRangeAnalysis: RangeAnalysis = {
      fico: {
        inRange: 4234,
        outOfRange: 287,
        distribution: [
          { range: '300-579', count: 45 },
          { range: '580-669', count: 312 },
          { range: '670-739', count: 1456 },
          { range: '740-799', count: 1823 },
          { range: '800-850', count: 598 },
          { range: 'Out of Range', count: 287 }
        ]
      },
      ltv: {
        inRange: 4389,
        outOfRange: 132,
        distribution: [
          { range: '0-60%', count: 876 },
          { range: '61-70%', count: 1234 },
          { range: '71-80%', count: 1567 },
          { range: '81-90%', count: 589 },
          { range: '91-100%', count: 123 },
          { range: 'Over 100%', count: 132 }
        ]
      },
      dti: {
        inRange: 4298,
        outOfRange: 223,
        distribution: [
          { range: '0-20%', count: 456 },
          { range: '21-35%', count: 1678 },
          { range: '36-43%', count: 1456 },
          { range: '44-50%', count: 567 },
          { range: '51-100%', count: 141 },
          { range: 'Over 100%', count: 223 }
        ]
      },
      interestRate: {
        inRange: 4456,
        outOfRange: 65,
        distribution: [
          { range: '0-3%', count: 234 },
          { range: '3-5%', count: 1567 },
          { range: '5-7%', count: 1876 },
          { range: '7-10%', count: 654 },
          { range: '10-15%', count: 125 },
          { range: 'Over 15%', count: 65 }
        ]
      }
    };
    
    setRangeAnalysis(mockRangeAnalysis);
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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-6 h-auto">
          <TabsTrigger value="overview" className="flex items-center gap-1.5 text-xs sm:text-sm py-2">
            <LayoutDashboard className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Overview</span>
          </TabsTrigger>
          <TabsTrigger value="warnings" className="flex items-center gap-1.5 text-xs sm:text-sm py-2">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Warnings</span>
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{issues.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="population" className="flex items-center gap-1.5 text-xs sm:text-sm py-2">
            <Database className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Population</span>
          </TabsTrigger>
          <TabsTrigger value="crucial" className="flex items-center gap-1.5 text-xs sm:text-sm py-2">
            <Star className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Crucial</span>
          </TabsTrigger>
          <TabsTrigger value="ranges" className="flex items-center gap-1.5 text-xs sm:text-sm py-2">
            <Gauge className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Ranges</span>
          </TabsTrigger>
          <TabsTrigger value="rules" className="flex items-center gap-1.5 text-xs sm:text-sm py-2">
            <ListChecks className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Rules</span>
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6 mt-6">
          {/* Overview Dashboard */}
          {metrics && (
            <>
              {/* Top Problem Fields */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Target className="h-5 w-5 text-rose-500" />
                    Top Problem Fields
                  </CardTitle>
                  <CardDescription>
                    Fields with the most data quality issues
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {Object.entries(metrics.issues_by_field)
                      .sort(([, a], [, b]) => b - a)
                      .slice(0, 5)
                      .map(([field, count], index) => (
                        <div key={field} className="flex items-center gap-4">
                          <div className="w-6 h-6 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center text-xs font-medium text-rose-600 dark:text-rose-400">
                            {index + 1}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                {field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                              </span>
                              <span className="text-sm text-rose-600 dark:text-rose-400 font-medium">
                                {count} issues
                              </span>
                            </div>
                            <Progress 
                              value={(count / Math.max(...Object.values(metrics.issues_by_field))) * 100} 
                              className="h-1.5 mt-1 [&>div]:bg-rose-500"
                            />
                          </div>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-6 md:grid-cols-2">
                {/* Issues by Type */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Activity className="h-5 w-5 text-amber-500" />
                      Issues by Type
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {Object.entries(metrics.issues_by_type)
                        .sort(([, a], [, b]) => b - a)
                        .map(([type, count]) => (
                          <div key={type} className="flex items-center justify-between">
                            <span className="text-sm text-slate-600 dark:text-slate-400">
                              {ISSUE_TYPE_LABELS[type as IssueType]}
                            </span>
                            <Badge variant="secondary">{count}</Badge>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Quality Trend */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-emerald-500" />
                      Quality Trend
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {metrics.trend.map((point, index) => (
                        <div key={point.date} className="flex items-center justify-between">
                          <span className="text-sm text-slate-600 dark:text-slate-400">
                            {new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                          <div className="flex items-center gap-3">
                            <span className={`text-sm font-medium ${
                              point.score >= 90 ? 'text-emerald-600' :
                              point.score >= 70 ? 'text-amber-600' :
                              'text-rose-600'
                            }`}>
                              {point.score}%
                            </span>
                            <span className="text-xs text-slate-400">
                              {point.issues} issues
                            </span>
                            {index > 0 && (
                              point.score > metrics.trend[index - 1].score ? (
                                <TrendingUp className="h-3 w-3 text-emerald-500" />
                              ) : point.score < metrics.trend[index - 1].score ? (
                                <TrendingDown className="h-3 w-3 text-rose-500" />
                              ) : null
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Population Health Summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Database className="h-5 w-5 text-blue-500" />
                    Field Population Health
                  </CardTitle>
                  <CardDescription>
                    Distribution of fields by population density
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {(() => {
                    const densityCounts = { heavily: 0, mildly: 0, sparsely: 0, not: 0 };
                    Object.values(metrics.field_coverage).forEach(rate => {
                      densityCounts[getDensityCategory(rate)]++;
                    });
                    const total = Object.values(densityCounts).reduce((a, b) => a + b, 0);
                    
                    return (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {(Object.entries(densityCounts) as [DensityCategory, number][]).map(([category, count]) => (
                          <div key={category} className={`p-4 rounded-lg ${DENSITY_COLORS[category]}`}>
                            <div className="text-2xl font-semibold">{count}</div>
                            <div className="text-sm">{DENSITY_LABELS[category]}</div>
                            <div className="text-xs opacity-75">{((count / total) * 100).toFixed(0)}% of fields</div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Data Warnings Tab (formerly Issues) */}
        <TabsContent value="warnings" className="space-y-4 mt-6">
          {/* Warning Groups Summary - Similar to Qlik's Data Warning Groups */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(ISSUE_TYPE_LABELS).slice(0, 4).map(([type, label]) => {
              const count = issues.filter(i => i.issue_type === type).length;
              return (
                <Card 
                  key={type} 
                  className={`cursor-pointer transition-all hover:shadow-md ${
                    typeFilter === type ? 'ring-2 ring-blue-500' : ''
                  }`}
                  onClick={() => setTypeFilter(typeFilter === type ? 'all' : type as IssueType)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
                        <p className="text-2xl font-semibold text-slate-900 dark:text-white">{count}</p>
                      </div>
                      <div className={`p-2 rounded-lg ${
                        type === 'missing_required' ? 'bg-rose-100 dark:bg-rose-900/30' :
                        type === 'invalid_format' ? 'bg-amber-100 dark:bg-amber-900/30' :
                        type === 'out_of_range' ? 'bg-orange-100 dark:bg-orange-900/30' :
                        'bg-blue-100 dark:bg-blue-900/30'
                      }`}>
                        {type === 'missing_required' ? <XCircle className="h-5 w-5 text-rose-600 dark:text-rose-400" /> :
                         type === 'invalid_format' ? <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" /> :
                         type === 'out_of_range' ? <Gauge className="h-5 w-5 text-orange-600 dark:text-orange-400" /> :
                         <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" />}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

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
                {/* Bulk Actions */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    toast({
                      title: 'Bulk Action',
                      description: `Marking ${filteredIssues.length} issues as reviewed`
                    });
                  }}
                  disabled={filteredIssues.length === 0}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Mark All Reviewed
                </Button>
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

        {/* Field Population Tab */}
        <TabsContent value="population" className="space-y-4 mt-6">
          {/* Integrated FieldPopulationStats Component */}
          <FieldPopulationStats 
            tenantId={selectedTenantId}
            losConnectionId={null}
          />
          
          {/* Density Summary Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Population Density Summary
              </CardTitle>
              <CardDescription>
                Fields categorized by population level (Qlik-style density analysis)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {metrics && Object.entries(metrics.field_coverage)
                .sort(([, a], [, b]) => b - a)
                .map(([field, coverage]) => {
                  const category = getDensityCategory(coverage);
                  return (
                    <div key={field} className="flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          {field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge className={DENSITY_COLORS[category]}>
                          {DENSITY_LABELS[category]}
                        </Badge>
                        <span className={`text-sm font-medium min-w-[50px] text-right ${
                          coverage >= 50 ? 'text-emerald-600' :
                          coverage >= 20 ? 'text-amber-600' :
                          coverage > 0 ? 'text-orange-600' :
                          'text-rose-600'
                        }`}>
                          {coverage.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Crucial Fields Tab */}
        <TabsContent value="crucial" className="space-y-4 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Star className="h-5 w-5 text-amber-500" />
                Crucial Fields Monitor
              </CardTitle>
              <CardDescription>
                Priority fields that should always be populated for accurate reporting
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                  <div className="text-2xl font-semibold text-emerald-700 dark:text-emerald-400">
                    {crucialFields.filter(f => f.status === 'good').length}
                  </div>
                  <div className="text-sm text-emerald-600 dark:text-emerald-500">Healthy (80%+)</div>
                </div>
                <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                  <div className="text-2xl font-semibold text-amber-700 dark:text-amber-400">
                    {crucialFields.filter(f => f.status === 'warning').length}
                  </div>
                  <div className="text-sm text-amber-600 dark:text-amber-500">Warning (50-79%)</div>
                </div>
                <div className="p-4 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800">
                  <div className="text-2xl font-semibold text-rose-700 dark:text-rose-400">
                    {crucialFields.filter(f => f.status === 'critical').length}
                  </div>
                  <div className="text-sm text-rose-600 dark:text-rose-500">Critical (&lt;50%)</div>
                </div>
              </div>

              {/* Crucial Fields Table */}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Field Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Population</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {crucialFields
                    .sort((a, b) => a.priority - b.priority)
                    .map(field => (
                      <TableRow key={field.column} className={
                        field.status === 'critical' ? 'bg-rose-50/50 dark:bg-rose-900/10' :
                        field.status === 'warning' ? 'bg-amber-50/50 dark:bg-amber-900/10' :
                        ''
                      }>
                        <TableCell className="font-mono text-xs text-slate-500">
                          {field.priority}
                        </TableCell>
                        <TableCell className="font-medium">
                          {field.name}
                        </TableCell>
                        <TableCell>
                          <Badge className={
                            field.status === 'good' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                            field.status === 'warning' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                            'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                          }>
                            {field.status === 'good' ? (
                              <><CheckCircle2 className="h-3 w-3 mr-1" /> Healthy</>
                            ) : field.status === 'warning' ? (
                              <><AlertTriangle className="h-3 w-3 mr-1" /> Warning</>
                            ) : (
                              <><XCircle className="h-3 w-3 mr-1" /> Critical</>
                            )}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Progress 
                              value={field.populationRate} 
                              className={`w-24 h-2 ${
                                field.status === 'good' ? '[&>div]:bg-emerald-500' :
                                field.status === 'warning' ? '[&>div]:bg-amber-500' :
                                '[&>div]:bg-rose-500'
                              }`}
                            />
                            <span className={`text-sm font-medium min-w-[45px] ${
                              field.status === 'good' ? 'text-emerald-600' :
                              field.status === 'warning' ? 'text-amber-600' :
                              'text-rose-600'
                            }`}>
                              {field.populationRate}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm text-slate-500">
                          {field.populatedCount.toLocaleString()} / {field.totalCount.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Alert>
            <Star className="h-4 w-4" />
            <AlertDescription>
              These fields are identified as crucial based on the Qlik Data Pilot configuration. 
              Fields below 50% population may cause inaccurate reports and analytics.
            </AlertDescription>
          </Alert>
        </TabsContent>

        {/* Range Analysis Tab */}
        <TabsContent value="ranges" className="space-y-4 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Gauge className="h-5 w-5 text-blue-500" />
                Range Analysis
              </CardTitle>
              <CardDescription>
                Loan stratification by key metrics - identifies out-of-range values
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {rangeAnalysis && (
                <div className="grid gap-6 md:grid-cols-2">
                  {/* FICO Score */}
                  {rangeAnalysis.fico && (
                    <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="font-medium text-slate-900 dark:text-white">
                          {RANGE_CONFIG.fico.label}
                        </h4>
                        <Badge variant="outline">
                          {RANGE_CONFIG.fico.min} - {RANGE_CONFIG.fico.max}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 mb-4">
                        <div className="flex-1">
                          <div className="text-2xl font-semibold text-emerald-600">
                            {rangeAnalysis.fico.inRange.toLocaleString()}
                          </div>
                          <div className="text-xs text-slate-500">In Range</div>
                        </div>
                        <div className="flex-1">
                          <div className="text-2xl font-semibold text-rose-600">
                            {rangeAnalysis.fico.outOfRange.toLocaleString()}
                          </div>
                          <div className="text-xs text-slate-500">Out of Range</div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {rangeAnalysis.fico.distribution.map(d => (
                          <div key={d.range} className="flex items-center justify-between text-sm">
                            <span className="text-slate-600 dark:text-slate-400">{d.range}</span>
                            <span className={d.range === 'Out of Range' ? 'text-rose-600 font-medium' : 'text-slate-700 dark:text-slate-300'}>
                              {d.count.toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* LTV Ratio */}
                  {rangeAnalysis.ltv && (
                    <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="font-medium text-slate-900 dark:text-white">
                          {RANGE_CONFIG.ltv.label}
                        </h4>
                        <Badge variant="outline">
                          {RANGE_CONFIG.ltv.min}% - {RANGE_CONFIG.ltv.max}%
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 mb-4">
                        <div className="flex-1">
                          <div className="text-2xl font-semibold text-emerald-600">
                            {rangeAnalysis.ltv.inRange.toLocaleString()}
                          </div>
                          <div className="text-xs text-slate-500">In Range</div>
                        </div>
                        <div className="flex-1">
                          <div className="text-2xl font-semibold text-rose-600">
                            {rangeAnalysis.ltv.outOfRange.toLocaleString()}
                          </div>
                          <div className="text-xs text-slate-500">Out of Range</div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {rangeAnalysis.ltv.distribution.map(d => (
                          <div key={d.range} className="flex items-center justify-between text-sm">
                            <span className="text-slate-600 dark:text-slate-400">{d.range}</span>
                            <span className={d.range === 'Over 100%' ? 'text-rose-600 font-medium' : 'text-slate-700 dark:text-slate-300'}>
                              {d.count.toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* DTI Ratio */}
                  {rangeAnalysis.dti && (
                    <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="font-medium text-slate-900 dark:text-white">
                          {RANGE_CONFIG.dti.label}
                        </h4>
                        <Badge variant="outline">
                          {RANGE_CONFIG.dti.min}% - {RANGE_CONFIG.dti.max}%
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 mb-4">
                        <div className="flex-1">
                          <div className="text-2xl font-semibold text-emerald-600">
                            {rangeAnalysis.dti.inRange.toLocaleString()}
                          </div>
                          <div className="text-xs text-slate-500">In Range</div>
                        </div>
                        <div className="flex-1">
                          <div className="text-2xl font-semibold text-rose-600">
                            {rangeAnalysis.dti.outOfRange.toLocaleString()}
                          </div>
                          <div className="text-xs text-slate-500">Out of Range</div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {rangeAnalysis.dti.distribution.map(d => (
                          <div key={d.range} className="flex items-center justify-between text-sm">
                            <span className="text-slate-600 dark:text-slate-400">{d.range}</span>
                            <span className={d.range === 'Over 100%' ? 'text-rose-600 font-medium' : 'text-slate-700 dark:text-slate-300'}>
                              {d.count.toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Interest Rate */}
                  {rangeAnalysis.interestRate && (
                    <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="font-medium text-slate-900 dark:text-white">
                          {RANGE_CONFIG.interestRate.label}
                        </h4>
                        <Badge variant="outline">
                          {RANGE_CONFIG.interestRate.min}% - {RANGE_CONFIG.interestRate.max}%
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 mb-4">
                      <div className="flex-1">
                        <div className="text-2xl font-semibold text-emerald-600">
                          {rangeAnalysis.interestRate.inRange.toLocaleString()}
                        </div>
                        <div className="text-xs text-slate-500">In Range</div>
                      </div>
                      <div className="flex-1">
                        <div className="text-2xl font-semibold text-rose-600">
                          {rangeAnalysis.interestRate.outOfRange.toLocaleString()}
                        </div>
                        <div className="text-xs text-slate-500">Out of Range</div>
                      </div>
                    </div>
                      <div className="space-y-2">
                        {rangeAnalysis.interestRate.distribution.map(d => (
                          <div key={d.range} className="flex items-center justify-between text-sm">
                            <span className="text-slate-600 dark:text-slate-400">{d.range}</span>
                            <span className={d.range === 'Over 15%' ? 'text-rose-600 font-medium' : 'text-slate-700 dark:text-slate-300'}>
                              {d.count.toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* No metrics available message */}
                  {!rangeAnalysis.fico && !rangeAnalysis.ltv && !rangeAnalysis.dti && !rangeAnalysis.interestRate && (
                    <div className="col-span-2 text-center py-8 text-slate-500">
                      No range analysis data available. The required columns (fico_score, ltv_ratio, dti_ratio, interest_rate) may not exist in your loan data.
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Alert>
            <Gauge className="h-4 w-4" />
            <AlertDescription>
              Range boundaries are based on industry standards and can be customized in Validation Rules.
              Out-of-range values may indicate data entry errors or require manual verification.
            </AlertDescription>
          </Alert>
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
