import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { Navigation } from '@/components/layout/Navigation';
import { Footer } from '@/components/layout/Footer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Search, ChevronLeft, ChevronRight, FileText, DollarSign, Calendar, User, Building2, TrendingUp, Activity, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { motion } from 'framer-motion';

interface Loan {
  id: string;
  loan_id: string;
  borrower_name: string;
  loan_amount: number | string; // Can be string from PostgreSQL DECIMAL
  loan_type: string;
  status: 'inquiry' | 'started' | 'locked' | 'funded' | 'denied' | 'withdrawn';
  application_date: string | null;
  closing_date: string | null;
  lock_date: string | null;
  interest_rate: number | string | null; // Can be string from PostgreSQL DECIMAL
  loan_purpose: string | null;
  branch: string | null;
  cycle_time_days: number | null;
  credit_pull_date: string | null;
}

interface LoansResponse {
  loans: Loan[];
  total: number;
  limit: number;
  offset: number;
}

const Loans = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'active' | 'closed' | 'all'>('all');
  const [limit] = useState(50);
  const [allLoansData, setAllLoansData] = useState<Loan[]>([]);
  const hasInitialized = useRef(false);

  useEffect(() => {
    const initialize = async () => {
      await checkAuth();
      // Fetch loans after auth completes
      if (!hasInitialized.current) {
        hasInitialized.current = true;
        await fetchLoans();
      }
    };
    initialize();
  }, []);

  useEffect(() => {
    if (!loading && hasInitialized.current) {
      fetchLoans();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentPage, searchQuery]);

  const checkAuth = async () => {
    try {
      const { user } = await api.getCurrentUser();
      if (!user) {
        navigate('/');
        return;
      }
    } catch (error) {
      navigate('/');
      return;
    }
    setLoading(false);
  };

  const fetchLoans = async () => {
    try {
      setLoading(true);
      // Fetch all loans (we'll filter client-side for better UX)
      // Use a larger limit to get more data for filtering
      const response = await api.request<LoansResponse>(`/api/loans?limit=1000&offset=0`);
      
      let allLoans = response.loans || [];
      
      // Filter by status based on active tab
      if (activeTab === 'active') {
        // Active loans: inquiry, started, locked
        allLoans = allLoans.filter(loan => 
          loan.status === 'inquiry' || 
          loan.status === 'started' || 
          loan.status === 'locked'
        );
      } else if (activeTab === 'closed') {
        // Closed loans: funded, denied, withdrawn
        allLoans = allLoans.filter(loan => 
          loan.status === 'funded' || 
          loan.status === 'denied' || 
          loan.status === 'withdrawn'
        );
      }
      
      // Apply search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        allLoans = allLoans.filter(loan => 
          loan.loan_id?.toLowerCase().includes(query) ||
          loan.borrower_name?.toLowerCase().includes(query) ||
          loan.loan_type?.toLowerCase().includes(query) ||
          loan.branch?.toLowerCase().includes(query)
        );
      }

      // Calculate pagination
      const totalFiltered = allLoans.length;
      const startIndex = (currentPage - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedLoans = allLoans.slice(startIndex, endIndex);

      setAllLoansData(response.loans || []);
      setLoans(paginatedLoans);
      setTotal(totalFiltered);
    } catch (error: any) {
      console.error('Error fetching loans:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to load loans.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'funded':
        return 'default'; // Green/success
      case 'locked':
        return 'secondary'; // Blue/in-progress
      case 'started':
        return 'outline'; // Gray/neutral
      case 'inquiry':
        return 'outline'; // Gray/neutral
      case 'denied':
        return 'destructive'; // Red/error
      case 'withdrawn':
        return 'outline'; // Gray/neutral
      default:
        return 'outline';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'funded':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'locked':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'started':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'inquiry':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
      case 'denied':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'withdrawn':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
    }
  };

  const formatCurrency = (amount: number | string | null | undefined) => {
    if (!amount) return 'N/A';
    // Convert string to number if needed (PostgreSQL DECIMAL returns as string)
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(numAmount)) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(numAmount);
  };

  const formatDate = (date: string | null | undefined) => {
    if (!date) return 'N/A';
    try {
      return format(new Date(date), 'MMM dd, yyyy');
    } catch {
      return 'Invalid Date';
    }
  };

  const formatPercentage = (rate: number | string | null | undefined) => {
    if (!rate) return 'N/A';
    // Convert string to number if needed (PostgreSQL DECIMAL returns as string)
    const numRate = typeof rate === 'string' ? parseFloat(rate) : rate;
    if (isNaN(numRate)) return 'N/A';
    return `${numRate.toFixed(3)}%`;
  };

  const totalPages = Math.ceil(total / limit);

  // Calculate statistics
  const stats = useMemo(() => {
    const all = allLoansData.length;
    const active = allLoansData.filter(loan => 
      loan.status === 'inquiry' || loan.status === 'started' || loan.status === 'locked'
    ).length;
    const closed = allLoansData.filter(loan => 
      loan.status === 'funded' || loan.status === 'denied' || loan.status === 'withdrawn'
    ).length;
    const totalValue = allLoansData.reduce((sum, loan) => {
      const amount = typeof loan.loan_amount === 'string' ? parseFloat(loan.loan_amount) : loan.loan_amount;
      return sum + (amount || 0);
    }, 0);

    return { all, active, closed, totalValue };
  }, [allLoansData]);

  if (loading && loans.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @keyframes fadeInRow {
          from {
            opacity: 0;
            transform: translateX(-10px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>
      <div className="min-h-screen bg-background">
        <Navigation />
      
      <div className="container mx-auto px-4 pt-24 pb-12 max-w-7xl">
        {/* Header */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mb-6 sm:mb-8"
        >
          <div className="flex items-center gap-3 sm:gap-4 mb-2">
            <div className="relative flex-shrink-0">
              <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-gradient-to-br from-[#007AFF] to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <FileText className="w-5 h-5 sm:w-7 sm:h-7 text-white" />
              </div>
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-2xl md:text-3xl font-extralight text-slate-900 dark:text-white mb-0.5 tracking-tight leading-tight">
                Loan Portfolio
              </h1>
              <p className="text-[10px] sm:text-sm text-slate-600 dark:text-slate-300 font-light">View and manage all loan applications</p>
            </div>
          </div>
        </motion.div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
          >
            <div className="bg-white dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700 p-4 hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_2px_8px_rgba(0,0,0,0.3)] hover:scale-[1.02] transition-all duration-200 cursor-pointer shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <div className="flex items-start justify-between mb-2">
                <span className="text-[10px] sm:text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                  Total Loans
                </span>
                <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                  <FileText className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
              <div className="text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">
                {stats.all}
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.2 }}
          >
            <div className="bg-white dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700 p-4 hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_2px_8px_rgba(0,0,0,0.3)] hover:scale-[1.02] transition-all duration-200 cursor-pointer shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <div className="flex items-start justify-between mb-2">
                <span className="text-[10px] sm:text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                  Active Loans
                </span>
                <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                  <Activity className="h-4 w-4 sm:h-5 sm:w-5 text-green-600 dark:text-green-400" />
                </div>
              </div>
              <div className="text-xl sm:text-2xl font-semibold text-blue-600 dark:text-blue-400 tracking-tight">
                {stats.active}
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.3 }}
          >
            <div className="bg-white dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700 p-4 hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_2px_8px_rgba(0,0,0,0.3)] hover:scale-[1.02] transition-all duration-200 cursor-pointer shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <div className="flex items-start justify-between mb-2">
                <span className="text-[10px] sm:text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                  Closed Loans
                </span>
                <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="h-4 w-4 sm:h-5 sm:w-5 text-slate-600 dark:text-slate-400" />
                </div>
              </div>
              <div className="text-xl sm:text-2xl font-semibold text-slate-600 dark:text-slate-400 tracking-tight">
                {stats.closed}
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.4 }}
          >
            <div className="bg-white dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700 p-4 hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_2px_8px_rgba(0,0,0,0.3)] hover:scale-[1.02] transition-all duration-200 cursor-pointer shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <div className="flex items-start justify-between mb-2">
                <span className="text-[10px] sm:text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                  Total Value
                </span>
                <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                  <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
              </div>
              <div className="text-xl sm:text-2xl font-semibold text-emerald-600 dark:text-emerald-400 tracking-tight">
                {formatCurrency(stats.totalValue).replace('.00', '')}
              </div>
            </div>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.5 }}
        >
        <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl bg-white dark:bg-slate-900/70 border border-slate-100 dark:border-slate-800 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4 sm:p-6 md:p-8">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 sm:mb-6 pb-4 sm:pb-6 border-b border-slate-200 dark:border-slate-700">
            <div>
              <h3 className="text-lg sm:text-2xl md:text-3xl font-extralight text-slate-900 dark:text-white mb-0.5 tracking-tight leading-tight">
                Loan Details
              </h3>
              <p className="text-[10px] sm:text-sm text-slate-600 dark:text-slate-300 font-light">
                {total} loan{total !== 1 ? 's' : ''} {activeTab !== 'all' && `(${activeTab === 'active' ? 'Active' : 'Closed'})`}
              </p>
            </div>
            <div className="relative w-full sm:w-auto">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 dark:text-slate-500 h-4 w-4" />
              <Input
                placeholder="Search by loan ID, borrower, type, or branch..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="pl-10 w-full sm:w-80 h-10 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
          <div>
            <Tabs value={activeTab} onValueChange={(value) => {
              setActiveTab(value as 'active' | 'closed' | 'all');
              setCurrentPage(1);
            }}>
              <TabsList className="flex items-center gap-1 p-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 dark:from-indigo-600 dark:via-purple-600 dark:to-pink-600 rounded-lg mb-6 w-full">
                <TabsTrigger 
                  value="all" 
                  className="flex-1 data-[state=active]:bg-white data-[state=active]:dark:bg-slate-700 data-[state=active]:text-slate-900 data-[state=active]:dark:text-white data-[state=active]:shadow-sm text-white dark:text-slate-200 hover:text-white dark:hover:text-slate-100"
                >
                  All Loans
                </TabsTrigger>
                <TabsTrigger 
                  value="active" 
                  className="flex-1 data-[state=active]:bg-white data-[state=active]:dark:bg-slate-700 data-[state=active]:text-slate-900 data-[state=active]:dark:text-white data-[state=active]:shadow-sm text-white dark:text-slate-200 hover:text-white dark:hover:text-slate-100"
                >
                  Active Loans
                </TabsTrigger>
                <TabsTrigger 
                  value="closed" 
                  className="flex-1 data-[state=active]:bg-white data-[state=active]:dark:bg-slate-700 data-[state=active]:text-slate-900 data-[state=active]:dark:text-white data-[state=active]:shadow-sm text-white dark:text-slate-200 hover:text-white dark:hover:text-slate-100"
                >
                  Closed Loans
                </TabsTrigger>
              </TabsList>

              <TabsContent value={activeTab} className="mt-0">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                  </div>
                ) : loans.length === 0 ? (
                  <div className="text-center py-16">
                    <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-slate-100 dark:bg-slate-800 mb-4">
                      <FileText className="h-10 w-10 text-slate-400 dark:text-slate-500" />
                    </div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">No loans found</h3>
                    <p className="text-slate-600 dark:text-slate-400">
                      {searchQuery ? 'Try adjusting your search criteria' : 'No loans match the selected filter'}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                              <TableHead className="font-semibold text-slate-900 dark:text-slate-100">Loan ID</TableHead>
                              <TableHead className="font-semibold text-slate-900 dark:text-slate-100">Borrower</TableHead>
                              <TableHead className="font-semibold text-slate-900 dark:text-slate-100">Amount</TableHead>
                              <TableHead className="font-semibold text-slate-900 dark:text-slate-100">Type</TableHead>
                              <TableHead className="font-semibold text-slate-900 dark:text-slate-100">Status</TableHead>
                              <TableHead className="font-semibold text-slate-900 dark:text-slate-100">Application Date</TableHead>
                              <TableHead className="font-semibold text-slate-900 dark:text-slate-100">Closing Date</TableHead>
                              <TableHead className="font-semibold text-slate-900 dark:text-slate-100">Interest Rate</TableHead>
                              <TableHead className="font-semibold text-slate-900 dark:text-slate-100">Branch</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {loans.map((loan, index) => (
                              <TableRow 
                                key={loan.id}
                                className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-all duration-200"
                                style={{
                                  animation: `fadeInRow 0.4s ease-out ${index * 20}ms forwards`,
                                  opacity: 0
                                }}
                              >
                                  <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                                    <span className="font-mono text-sm">{loan.loan_id || 'N/A'}</span>
                                  </TableCell>
                                  <TableCell>
                                    <span className="font-medium text-slate-900 dark:text-slate-100">{loan.borrower_name || 'N/A'}</span>
                                  </TableCell>
                                  <TableCell>
                                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                      {formatCurrency(loan.loan_amount)}
                                    </span>
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="outline" className="font-medium border-slate-200 dark:border-slate-700">
                                      {loan.loan_type || 'N/A'}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>
                                    <Badge className={`${getStatusColor(loan.status)} font-medium px-2.5 py-0.5`}>
                                      {loan.status?.charAt(0).toUpperCase() + loan.status?.slice(1) || 'N/A'}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>
                                    <span className="text-sm text-slate-600 dark:text-slate-400">
                                      {formatDate(loan.application_date)}
                                    </span>
                                  </TableCell>
                                  <TableCell>
                                    <span className="text-sm text-slate-600 dark:text-slate-400">
                                      {formatDate(loan.closing_date)}
                                    </span>
                                  </TableCell>
                                  <TableCell>
                                    <span className="font-mono text-sm font-medium text-slate-900 dark:text-slate-100">
                                      {formatPercentage(loan.interest_rate)}
                                    </span>
                                  </TableCell>
                                  <TableCell>
                                    <span className="text-sm text-slate-600 dark:text-slate-400">
                                      {loan.branch || 'N/A'}
                                    </span>
                                  </TableCell>
                                </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
                        <div className="text-sm text-slate-600 dark:text-slate-400">
                          Showing <span className="font-semibold text-slate-900 dark:text-slate-100">{(currentPage - 1) * limit + 1}</span> to{' '}
                          <span className="font-semibold text-slate-900 dark:text-slate-100">{Math.min(currentPage * limit, total)}</span> of{' '}
                          <span className="font-semibold text-slate-900 dark:text-slate-100">{total}</span> loans
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                            disabled={currentPage === 1 || loading}
                            className="border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                          >
                            <ChevronLeft className="h-4 w-4 mr-1" />
                            Previous
                          </Button>
                          <div className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-md">
                            Page {currentPage} of {totalPages}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                            disabled={currentPage === totalPages || loading}
                            className="border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                          >
                            Next
                            <ChevronRight className="h-4 w-4 ml-1" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
        </motion.div>
      </div>

      <Footer />
      </div>
    </>
  );
};

export default Loans;

