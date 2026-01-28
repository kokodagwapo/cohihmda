/**
 * Loans Page - Full loan detail table with filtering, searching, and column visibility
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  flexRender,
  ColumnDef,
  SortingState,
  ColumnFiltersState,
  VisibilityState,
} from '@tanstack/react-table';
import { format } from 'date-fns';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Search,
  Filter,
  X,
  Download,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
  ArrowLeft,
  Settings2,
  RefreshCw,
  Database,
  FileSpreadsheet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { TenantSelector } from '@/components/dashboard/TenantSelector';

// Column schema type from backend
interface ColumnSchema {
  name: string;
  type: string;
  nullable: boolean;
  displayName: string;
  category: string;
}

// Loan data type (dynamic based on schema)
type Loan = Record<string, any>;

// Category display order and names
const categoryOrder = [
  'identifier',
  'status',
  'loan_details',
  'financial',
  'property',
  'borrower',
  'team',
  'organization',
  'date',
  'other',
];

const categoryNames: Record<string, string> = {
  identifier: 'Identifiers',
  status: 'Status',
  loan_details: 'Loan Details',
  financial: 'Financial',
  property: 'Property',
  borrower: 'Borrower',
  team: 'Team Members',
  organization: 'Organization',
  date: 'Dates',
  other: 'Other',
};

// Format cell value based on type
function formatCellValue(value: any, columnType: string, columnName: string): React.ReactNode {
  if (value === null || value === undefined || value === '') {
    return <span className="text-slate-400 dark:text-slate-600">—</span>;
  }

  // Handle dates
  if (columnType.includes('timestamp') || columnType === 'date' || columnName.includes('date') || columnName.endsWith('_at')) {
    try {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return format(date, columnType.includes('timestamp') || columnName.endsWith('_at') ? 'MMM dd, yyyy HH:mm' : 'MMM dd, yyyy');
      }
    } catch {
      return String(value);
    }
  }

  // Handle money/amounts
  if (columnName.includes('amount') || columnName.includes('price') || columnName.includes('value') || 
      columnName.includes('fee') || columnName.includes('income') || columnName.includes('assets') ||
      columnName.includes('payout') || columnName.includes('srp') || columnName.includes('net_')) {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num);
    }
  }

  // Handle percentages/rates
  if (columnName.includes('rate') || columnName.includes('ltv') || columnName.includes('dti') || 
      columnName.includes('ratio') || columnName.includes('percent') || columnName.includes('_cap')) {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      return `${num.toFixed(2)}%`;
    }
  }

  // Handle booleans
  if (typeof value === 'boolean') {
    return (
      <Badge variant={value ? 'default' : 'secondary'} className={cn(
        'text-xs',
        value ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
      )}>
        {value ? 'Yes' : 'No'}
      </Badge>
    );
  }

  // Handle status fields
  if (columnName.includes('status') || columnName === 'current_milestone') {
    const statusValue = String(value);
    let variant: 'default' | 'secondary' | 'destructive' | 'outline' = 'secondary';
    let className = '';
    
    if (statusValue.toLowerCase().includes('active') || statusValue.toLowerCase().includes('approved')) {
      className = 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    } else if (statusValue.toLowerCase().includes('originated') || statusValue.toLowerCase().includes('funded') || statusValue.toLowerCase().includes('closed')) {
      className = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
    } else if (statusValue.toLowerCase().includes('denied') || statusValue.toLowerCase().includes('withdrawn')) {
      className = 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    } else if (statusValue.toLowerCase().includes('locked')) {
      className = 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    }
    
    return <Badge variant={variant} className={cn('text-xs whitespace-nowrap', className)}>{statusValue}</Badge>;
  }

  // Handle FICO scores
  if (columnName === 'fico_score') {
    const num = parseInt(value);
    if (!isNaN(num)) {
      let className = '';
      if (num >= 740) className = 'text-emerald-600 dark:text-emerald-400 font-medium';
      else if (num >= 670) className = 'text-blue-600 dark:text-blue-400 font-medium';
      else if (num >= 580) className = 'text-amber-600 dark:text-amber-400 font-medium';
      else className = 'text-red-600 dark:text-red-400 font-medium';
      return <span className={className}>{num}</span>;
    }
  }

  // Handle JSON/objects
  if (typeof value === 'object') {
    return <span className="text-slate-500 dark:text-slate-400 text-xs font-mono">{JSON.stringify(value).slice(0, 50)}...</span>;
  }

  // Default string handling - truncate long values
  const strValue = String(value);
  if (strValue.length > 40) {
    return (
      <span title={strValue} className="cursor-help">
        {strValue.slice(0, 40)}...
      </span>
    );
  }

  return strValue;
}

export default function Loans() {
  const navigate = useNavigate();
  
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  
  // Data state
  const [columns, setColumns] = useState<ColumnSchema[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [schemaLoading, setSchemaLoading] = useState(true);
  
  // Pagination
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  
  // Table state
  const [sorting, setSorting] = useState<SortingState>([{ id: 'created_at', desc: true }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [globalFilter, setGlobalFilter] = useState('');
  
  // Filter state
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [loanTypeFilter, setLoanTypeFilter] = useState<string>('');
  const [dateRange, setDateRange] = useState<{ start: Date | null; end: Date | null }>({ start: null, end: null });
  const [dateField, setDateField] = useState<string>('started_date'); // Which date field to filter on
  const [nullFields, setNullFields] = useState<string[]>([]); // Fields that should be NULL/empty
  const [notNullFields, setNotNullFields] = useState<string[]>([]); // Fields that should NOT be NULL/empty
  
  // Date field options for filtering
  const dateFieldOptions = [
    { value: 'started_date', label: 'Started Date' },
    { value: 'application_date', label: 'Application Date' },
    { value: 'closing_date', label: 'Closing Date' },
    { value: 'funding_date', label: 'Funding Date' },
    { value: 'lock_date', label: 'Lock Date' },
    { value: 'credit_pull_date', label: 'Credit Pull Date' },
    { value: 'approval_date', label: 'Approval Date' },
    { value: 'created_at', label: 'Created Date' },
  ];
  
  // Distinct values for filters
  const [distinctStatuses, setDistinctStatuses] = useState<string[]>([]);
  const [distinctLoanTypes, setDistinctLoanTypes] = useState<string[]>([]);
  
  // Nullable fields that can be filtered
  const nullableFieldOptions = [
    { value: 'started_date', label: 'Started Date' },
    { value: 'application_date', label: 'Application Date (RESPA)' },
    { value: 'closing_date', label: 'Closing Date' },
    { value: 'funding_date', label: 'Funding Date' },
    { value: 'lock_date', label: 'Lock Date' },
    { value: 'credit_pull_date', label: 'Credit Pull Date' },
    { value: 'approval_date', label: 'Approval Date' },
    { value: 'loan_officer', label: 'Loan Officer' },
    { value: 'processor', label: 'Processor' },
    { value: 'underwriter', label: 'Underwriter' },
    { value: 'fico_score', label: 'FICO Score' },
    { value: 'interest_rate', label: 'Interest Rate' },
    { value: 'branch', label: 'Branch' },
  ];

  // Check authentication
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const userData = await api.getCurrentUser();
        setIsAuthenticated(true);
        const role = userData.user?.role || userData.role;
        setIsAdmin(role === 'super_admin' || role === 'admin' || role === 'tenant_admin');
      } catch {
        navigate('/login');
      }
    };
    checkAuth();
  }, [navigate]);

  // Fetch schema
  useEffect(() => {
    if (!isAuthenticated) return;
    
    const fetchSchema = async () => {
      try {
        setSchemaLoading(true);
        const tenantParam = selectedTenantId ? `?tenant_id=${selectedTenantId}` : '';
        const data = await api.request<{ columns: ColumnSchema[] }>(`/api/loans/schema${tenantParam}`);
        setColumns(data.columns);
        
        // Set default visible columns (key columns only)
        const defaultVisible: VisibilityState = {};
        const keyColumns = [
          'loan_id', 'loan_number', 'loan_amount', 'current_loan_status', 'loan_type',
          'application_date', 'closing_date', 'funding_date', 'lock_date',
          'property_state', 'property_city', 'branch', 'loan_officer', 'interest_rate', 'fico_score'
        ];
        data.columns.forEach(col => {
          defaultVisible[col.name] = keyColumns.includes(col.name);
        });
        setColumnVisibility(defaultVisible);
      } catch (error) {
        console.error('Error fetching schema:', error);
      } finally {
        setSchemaLoading(false);
      }
    };
    
    fetchSchema();
  }, [isAuthenticated, selectedTenantId]);

  // Fetch distinct values for filters
  useEffect(() => {
    if (!isAuthenticated) return;
    
    const fetchDistinctValues = async () => {
      try {
        const [statusData, loanTypeData] = await Promise.all([
          api.request<{ values: string[] }>(`/api/loans/distinct-values/current_loan_status`),
          api.request<{ values: string[] }>(`/api/loans/distinct-values/loan_type`),
        ]);
        setDistinctStatuses(statusData.values);
        setDistinctLoanTypes(loanTypeData.values);
      } catch (error) {
        console.error('Error fetching distinct values:', error);
      }
    };
    
    fetchDistinctValues();
  }, [isAuthenticated, selectedTenantId]);

  // Fetch loans data
  const fetchLoans = useCallback(async () => {
    if (!isAuthenticated) return;
    
    try {
      setLoading(true);
      
      // Build query params
      const params = new URLSearchParams();
      params.append('limit', pageSize.toString());
      params.append('offset', (pageIndex * pageSize).toString());
      
      if (sorting.length > 0) {
        params.append('sort_by', sorting[0].id);
        params.append('sort_order', sorting[0].desc ? 'desc' : 'asc');
      }
      
      if (globalFilter) {
        params.append('search', globalFilter);
      }
      
      if (statusFilter) {
        params.append('current_loan_status', statusFilter);
      }
      
      if (loanTypeFilter) {
        params.append('loan_type', loanTypeFilter);
      }
      
      if (dateRange.start) {
        params.append('start_date', format(dateRange.start, 'yyyy-MM-dd'));
        params.append('date_field', dateField);
      }
      
      if (dateRange.end) {
        params.append('end_date', format(dateRange.end, 'yyyy-MM-dd'));
        if (!dateRange.start) {
          params.append('date_field', dateField);
        }
      }
      
      if (selectedTenantId) {
        params.append('tenant_id', selectedTenantId);
      }
      
      // Add null/not null field filters
      if (nullFields.length > 0) {
        params.append('null_fields', nullFields.join(','));
      }
      
      if (notNullFields.length > 0) {
        params.append('not_null_fields', notNullFields.join(','));
      }
      
      const data = await api.request<{ loans: Loan[]; total: number }>(`/api/loans?${params.toString()}`);
      setLoans(data.loans);
      setTotal(data.total);
    } catch (error) {
      console.error('Error fetching loans:', error);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, pageIndex, pageSize, sorting, globalFilter, statusFilter, loanTypeFilter, dateRange, dateField, selectedTenantId, nullFields, notNullFields]);

  useEffect(() => {
    fetchLoans();
  }, [fetchLoans]);

  // Generate table columns from schema
  const tableColumns = useMemo<ColumnDef<Loan>[]>(() => {
    return columns.map(col => ({
      accessorKey: col.name,
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8 data-[state=open]:bg-accent"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            <span className="truncate max-w-[150px]" title={col.displayName}>
              {col.displayName}
            </span>
            {column.getIsSorted() === 'asc' ? (
              <ChevronUp className="ml-2 h-4 w-4" />
            ) : column.getIsSorted() === 'desc' ? (
              <ChevronDown className="ml-2 h-4 w-4" />
            ) : (
              <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
            )}
          </Button>
        );
      },
      cell: ({ row }) => {
        const value = row.getValue(col.name);
        return (
          <div className="whitespace-nowrap">
            {formatCellValue(value, col.type, col.name)}
          </div>
        );
      },
    }));
  }, [columns]);

  // Create table instance
  const table = useReactTable({
    data: loans,
    columns: tableColumns,
    pageCount: Math.ceil(total / pageSize),
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      pagination: { pageIndex, pageSize },
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    manualSorting: true,
  });

  // Group columns by category for visibility dropdown
  const columnsByCategory = useMemo(() => {
    const grouped: Record<string, ColumnSchema[]> = {};
    columns.forEach(col => {
      if (!grouped[col.category]) {
        grouped[col.category] = [];
      }
      grouped[col.category].push(col);
    });
    return grouped;
  }, [columns]);

  // Export to CSV
  const exportToCSV = () => {
    const visibleColumns = columns.filter(col => columnVisibility[col.name] !== false);
    const headers = visibleColumns.map(col => col.displayName).join(',');
    const rows = loans.map(loan => 
      visibleColumns.map(col => {
        const value = loan[col.name];
        if (value === null || value === undefined) return '';
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return String(value);
      }).join(',')
    ).join('\n');
    
    const csv = `${headers}\n${rows}`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `loans_export_${format(new Date(), 'yyyy-MM-dd_HHmmss')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Clear all filters
  const clearFilters = () => {
    setGlobalFilter('');
    setStatusFilter('');
    setLoanTypeFilter('');
    setDateRange({ start: null, end: null });
    setDateField('started_date');
    setNullFields([]);
    setNotNullFields([]);
    setPageIndex(0);
  };

  const hasActiveFilters = globalFilter || statusFilter || loanTypeFilter || dateRange.start || dateRange.end || nullFields.length > 0 || notNullFields.length > 0;

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/insights')}
                className="gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Dashboard
              </Button>
              <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
                  Loan Details
                </h1>
              </div>
            </div>
            
            {isAdmin && (
              <TenantSelector
                selectedTenantId={selectedTenantId}
                onTenantChange={setSelectedTenantId}
                compact={true}
              />
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Toolbar */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 mb-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search loans..."
                value={globalFilter}
                onChange={(e) => {
                  setGlobalFilter(e.target.value);
                  setPageIndex(0);
                }}
                className="pl-10"
              />
            </div>
            
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Status Filter */}
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v === 'all' ? '' : v); setPageIndex(0); }}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {distinctStatuses.map(status => (
                    <SelectItem key={status} value={status}>{status}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              {/* Loan Type Filter */}
              <Select value={loanTypeFilter} onValueChange={(v) => { setLoanTypeFilter(v === 'all' ? '' : v); setPageIndex(0); }}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All Loan Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Loan Types</SelectItem>
                  {distinctLoanTypes.map(type => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              {/* Date Field Selector */}
              <Select value={dateField} onValueChange={(v) => { setDateField(v); setPageIndex(0); }}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Date Field" />
                </SelectTrigger>
                <SelectContent>
                  {dateFieldOptions.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              {/* Date Range Picker */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <Filter className="h-4 w-4" />
                    {dateRange.start ? (
                      dateRange.end ? (
                        `${format(dateRange.start, 'MMM dd')} - ${format(dateRange.end, 'MMM dd')}`
                      ) : format(dateRange.start, 'MMM dd, yyyy')
                    ) : (
                      'Date Range'
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <div className="p-3 border-b border-slate-200 dark:border-slate-700">
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Filtering by: <span className="font-medium text-slate-900 dark:text-white">
                        {dateFieldOptions.find(f => f.value === dateField)?.label}
                      </span>
                    </p>
                  </div>
                  <Calendar
                    mode="range"
                    selected={{ from: dateRange.start || undefined, to: dateRange.end || undefined }}
                    onSelect={(range) => {
                      setDateRange({ start: range?.from || null, end: range?.to || null });
                      setPageIndex(0);
                    }}
                    numberOfMonths={2}
                  />
                </PopoverContent>
              </Popover>
              
              {/* Empty/Has Value Field Filters */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className={cn(
                    "gap-2",
                    (nullFields.length > 0 || notNullFields.length > 0) && "border-blue-500 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                  )}>
                    <EyeOff className="h-4 w-4" />
                    {nullFields.length > 0 || notNullFields.length > 0 
                      ? `Field Filters (${nullFields.length + notNullFields.length})`
                      : 'Field Filters'
                    }
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[320px] max-h-[400px] overflow-y-auto">
                  <DropdownMenuLabel>Filter by Empty/Has Value</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-slate-500 font-normal">
                    Show loans where field is EMPTY:
                  </DropdownMenuLabel>
                  {nullableFieldOptions.map(field => (
                    <DropdownMenuCheckboxItem
                      key={`null-${field.value}`}
                      checked={nullFields.includes(field.value)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setNullFields(prev => [...prev, field.value]);
                          // Remove from notNullFields if present
                          setNotNullFields(prev => prev.filter(f => f !== field.value));
                        } else {
                          setNullFields(prev => prev.filter(f => f !== field.value));
                        }
                        setPageIndex(0);
                      }}
                    >
                      {field.label} is empty
                    </DropdownMenuCheckboxItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-slate-500 font-normal">
                    Show loans where field HAS VALUE:
                  </DropdownMenuLabel>
                  {nullableFieldOptions.map(field => (
                    <DropdownMenuCheckboxItem
                      key={`notnull-${field.value}`}
                      checked={notNullFields.includes(field.value)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setNotNullFields(prev => [...prev, field.value]);
                          // Remove from nullFields if present
                          setNullFields(prev => prev.filter(f => f !== field.value));
                        } else {
                          setNotNullFields(prev => prev.filter(f => f !== field.value));
                        }
                        setPageIndex(0);
                      }}
                    >
                      {field.label} has value
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              
              {/* Clear Filters */}
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-slate-500">
                  <X className="h-4 w-4" />
                  Clear
                </Button>
              )}
              
              <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />
              
              {/* Column Visibility */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <Settings2 className="h-4 w-4" />
                    Columns
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[280px] max-h-[400px] overflow-y-auto">
                  <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {categoryOrder.map(category => {
                    const cols = columnsByCategory[category];
                    if (!cols || cols.length === 0) return null;
                    return (
                      <div key={category}>
                        <DropdownMenuLabel className="text-xs text-slate-500 font-normal">
                          {categoryNames[category] || category}
                        </DropdownMenuLabel>
                        {cols.map(col => (
                          <DropdownMenuCheckboxItem
                            key={col.name}
                            checked={columnVisibility[col.name] !== false}
                            onCheckedChange={(checked) => {
                              setColumnVisibility(prev => ({ ...prev, [col.name]: checked }));
                            }}
                          >
                            {col.displayName}
                          </DropdownMenuCheckboxItem>
                        ))}
                        <DropdownMenuSeparator />
                      </div>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
              
              {/* Refresh */}
              <Button variant="outline" size="sm" onClick={fetchLoans} disabled={loading}>
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              </Button>
              
              {/* Export */}
              <Button variant="outline" size="sm" onClick={exportToCSV} className="gap-2">
                <Download className="h-4 w-4" />
                Export
              </Button>
            </div>
          </div>
          
          {/* Stats Bar */}
          <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t border-slate-100 dark:border-slate-700">
            <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
              <FileSpreadsheet className="h-4 w-4" />
              <span className="font-medium text-slate-900 dark:text-white">{total.toLocaleString()}</span>
              <span>loans total</span>
            </div>
            <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
            <div className="text-sm text-slate-600 dark:text-slate-400">
              Showing <span className="font-medium text-slate-900 dark:text-white">
                {Math.min(pageIndex * pageSize + 1, total)}-{Math.min((pageIndex + 1) * pageSize, total)}
              </span>
            </div>
            <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
            <div className="text-sm text-slate-600 dark:text-slate-400">
              <span className="font-medium text-slate-900 dark:text-white">
                {Object.values(columnVisibility).filter(v => v !== false).length}
              </span>
              <span> of {columns.length} columns visible</span>
            </div>
            
            {/* Active Field Filters Display */}
            {(nullFields.length > 0 || notNullFields.length > 0) && (
              <>
                <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
                <div className="flex flex-wrap items-center gap-2">
                  {nullFields.map(field => (
                    <Badge 
                      key={`badge-null-${field}`} 
                      variant="secondary" 
                      className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 gap-1 cursor-pointer hover:bg-amber-200"
                      onClick={() => {
                        setNullFields(prev => prev.filter(f => f !== field));
                        setPageIndex(0);
                      }}
                    >
                      {nullableFieldOptions.find(f => f.value === field)?.label} is empty
                      <X className="h-3 w-3" />
                    </Badge>
                  ))}
                  {notNullFields.map(field => (
                    <Badge 
                      key={`badge-notnull-${field}`} 
                      variant="secondary" 
                      className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 gap-1 cursor-pointer hover:bg-emerald-200"
                      onClick={() => {
                        setNotNullFields(prev => prev.filter(f => f !== field));
                        setPageIndex(0);
                      }}
                    >
                      {nullableFieldOptions.find(f => f.value === field)?.label} has value
                      <X className="h-3 w-3" />
                    </Badge>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          {(loading || schemaLoading) ? (
            <div className="flex items-center justify-center h-96">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                <p className="text-sm text-slate-500">Loading loans...</p>
              </div>
            </div>
          ) : loans.length === 0 ? (
            <div className="flex items-center justify-center h-96">
              <div className="flex flex-col items-center gap-3 text-slate-500">
                <Database className="h-12 w-12 text-slate-300 dark:text-slate-600" />
                <p className="text-lg font-medium">No loans found</p>
                <p className="text-sm">Try adjusting your filters or search query</p>
                {hasActiveFilters && (
                  <Button variant="outline" size="sm" onClick={clearFilters} className="mt-2">
                    Clear all filters
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <TableRow key={headerGroup.id} className="bg-slate-50 dark:bg-slate-800/50">
                        {headerGroup.headers.map((header) => (
                          <TableHead key={header.id} className="whitespace-nowrap">
                            {header.isPlaceholder
                              ? null
                              : flexRender(header.column.columnDef.header, header.getContext())}
                          </TableHead>
                        ))}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {table.getRowModel().rows.map((row) => (
                      <TableRow
                        key={row.id}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                      >
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id} className="py-3">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              
              {/* Pagination */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-600 dark:text-slate-400">Rows per page:</span>
                  <Select
                    value={pageSize.toString()}
                    onValueChange={(v) => {
                      setPageSize(parseInt(v));
                      setPageIndex(0);
                    }}
                  >
                    <SelectTrigger className="w-[80px] h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[25, 50, 100, 200].map(size => (
                        <SelectItem key={size} value={size.toString()}>{size}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-600 dark:text-slate-400">
                    Page {pageIndex + 1} of {Math.ceil(total / pageSize) || 1}
                  </span>
                  
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setPageIndex(0)}
                      disabled={pageIndex === 0}
                    >
                      <ChevronsLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setPageIndex(p => Math.max(0, p - 1))}
                      disabled={pageIndex === 0}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setPageIndex(p => Math.min(Math.ceil(total / pageSize) - 1, p + 1))}
                      disabled={pageIndex >= Math.ceil(total / pageSize) - 1}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setPageIndex(Math.ceil(total / pageSize) - 1)}
                      disabled={pageIndex >= Math.ceil(total / pageSize) - 1}
                    >
                      <ChevronsRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
