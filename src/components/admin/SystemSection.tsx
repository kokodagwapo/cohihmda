import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  Database,
  Server,
  CheckCircle2,
  Cpu,
  HardDrive,
  Network,
  Activity,
  Loader2,
  RefreshCw,
  Edit,
  Trash2,
} from 'lucide-react';
import type { SystemInfo } from '@/hooks/admin/useSystemInfo';
import { useDatabaseViewer } from '@/hooks/admin/useDatabaseViewer';

interface SystemSectionProps {
  systemInfo: SystemInfo | null;
  loading: boolean;
}

export const SystemSection = ({ systemInfo, loading }: SystemSectionProps) => {
  const {
    loans,
    loadingLoans,
    loanPage,
    setLoanPage,
    loanTotal,
    editingLoan,
    setEditingLoan,
    deletingLoanId,
    setDeletingLoanId,
    fetchLoans,
    handleUpdateLoan,
    handleDeleteLoan,
  } = useDatabaseViewer();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      {!systemInfo || loading ? (
        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            <p className="text-sm text-slate-500 dark:text-slate-400 font-light">
              Loading system information...
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <CardHeader>
              <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
                System Configuration
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
                Configure system settings and preferences
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Database Info */}
              <div className="space-y-4">
                <div className="flex items-center gap-3 pb-3 border-b border-slate-100 dark:border-slate-700">
                  <Database className="h-5 w-5 text-slate-400 dark:text-slate-500" strokeWidth={1.5} />
                  <div className="flex-1">
                    <div className="text-base font-extralight text-slate-900 dark:text-white">Database</div>
                    <div className="text-xs text-slate-500 dark:text-slate-500 font-light mt-1">
                      {systemInfo.database.version ? (systemInfo.database.version.includes(',') ? systemInfo.database.version.split(',')[0] : systemInfo.database.version) : 'Unknown'}
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-600 font-light mt-1">
                      Uptime: {systemInfo.database.uptime ? (typeof systemInfo.database.uptime === 'string' ? systemInfo.database.uptime : 'Active') : 'Unknown'}
                    </div>
                  </div>
                  <Badge variant="default" className={systemInfo.database.version && systemInfo.database.version !== 'Unknown' ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-0"}>
                    {systemInfo.database.version && systemInfo.database.version !== 'Unknown' ? 'Connected' : 'Disconnected'}
                  </Badge>
                </div>
                
                {/* Server Info */}
                <div className="flex items-center gap-3 pb-3 border-b border-slate-100 dark:border-slate-700">
                  <Server className="h-5 w-5 text-slate-400 dark:text-slate-500" strokeWidth={1.5} />
                  <div className="flex-1">
                    <div className="text-base font-extralight text-slate-900 dark:text-white">Server</div>
                    <div className="text-xs text-slate-500 dark:text-slate-500 font-light mt-1">
                      {systemInfo.server.environment} • Port {systemInfo.server.port}
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-600 font-light mt-1">
                      {systemInfo.server.nodeVersion}
                    </div>
                  </div>
                  <Badge variant="default" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0">
                    Running
                  </Badge>
                </div>

                {/* Features */}
                <div className="space-y-3">
                  <div className="text-base font-extralight text-slate-900 dark:text-white mb-3">Features</div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        <span className="text-base font-extralight text-slate-600 dark:text-slate-400">RAG Enabled</span>
                      </div>
                      <Switch checked={systemInfo.features.ragEnabled} disabled />
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        <span className="text-base font-extralight text-slate-600 dark:text-slate-400">Cost Tracking</span>
                      </div>
                      <Switch checked={systemInfo.features.costTrackingEnabled} disabled />
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        <span className="text-base font-extralight text-slate-600 dark:text-slate-400">Hybrid Sync</span>
                      </div>
                      <Switch checked={systemInfo.features.hybridSyncEnabled} disabled />
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <CardHeader>
              <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
                System Resources
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
                System performance and resource usage
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-slate-400 dark:text-slate-500" strokeWidth={1.5} />
                  <span className="text-base font-extralight text-slate-600 dark:text-slate-400">CPU Usage</span>
                </div>
                <span className="text-base font-extralight text-slate-900 dark:text-white">Normal</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4 text-slate-400 dark:text-slate-500" strokeWidth={1.5} />
                  <span className="text-base font-extralight text-slate-600 dark:text-slate-400">Memory</span>
                </div>
                <span className="text-base font-extralight text-slate-900 dark:text-white">Available</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <Network className="h-4 w-4 text-slate-400 dark:text-slate-500" strokeWidth={1.5} />
                  <span className="text-base font-extralight text-slate-600 dark:text-slate-400">Network</span>
                </div>
                <Badge variant="default" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0">
                  Online
                </Badge>
              </div>
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-slate-400 dark:text-slate-500" strokeWidth={1.5} />
                  <span className="text-base font-extralight text-slate-600 dark:text-slate-400">API Health</span>
                </div>
                <Badge variant="default" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0">
                  Healthy
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Database Viewer */}
        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
                  Database Viewer
                </CardTitle>
                <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
                  View, edit, and delete loan records from the database
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchLoans()}
                disabled={loadingLoans}
                className="flex items-center gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${loadingLoans ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loadingLoans ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-slate-600 dark:text-slate-400">
                    Showing {loans.length} of {loanTotal} loans
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setLoanPage(Math.max(1, loanPage - 1));
                        fetchLoans();
                      }}
                      disabled={loanPage === 1}
                    >
                      Previous
                    </Button>
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      Page {loanPage}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setLoanPage(loanPage + 1);
                        fetchLoans();
                      }}
                      disabled={loans.length < 50}
                    >
                      Next
                    </Button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Loan #</TableHead>
                        <TableHead>Borrower</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>LO Name</TableHead>
                        <TableHead>Branch</TableHead>
                        <TableHead>App Date</TableHead>
                        <TableHead className="w-32">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loans.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={9} className="text-center py-8 text-slate-500">
                            No loans found. Click Refresh to load data.
                          </TableCell>
                        </TableRow>
                      ) : (
                        loans.map((loan) => (
                          <TableRow key={loan.loan_id}>
                            <TableCell className="font-mono text-xs">{loan.loan_number || loan.loan_id}</TableCell>
                            <TableCell>{loan.borrower_name || '-'}</TableCell>
                            <TableCell>
                              {loan.loan_amount ? `$${parseInt(loan.loan_amount).toLocaleString()}` : '-'}
                            </TableCell>
                            <TableCell>{loan.loan_type || '-'}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">
                                {loan.status || 'N/A'}
                              </Badge>
                            </TableCell>
                            <TableCell>{loan.loan_officer_name || '-'}</TableCell>
                            <TableCell>{loan.branch || '-'}</TableCell>
                            <TableCell>
                              {loan.application_date ? new Date(loan.application_date).toLocaleDateString() : '-'}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setEditingLoan(loan)}
                                  className="h-8 w-8 p-0"
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setDeletingLoanId(loan.loan_id)}
                                  className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {/* Edit Dialog */}
            {editingLoan && (
              <Dialog open={!!editingLoan} onOpenChange={() => setEditingLoan(null)}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <div className="p-6">
                    <DialogHeader>
                      <DialogTitle>Edit Loan: {editingLoan.loan_number || editingLoan.loan_id}</DialogTitle>
                      <DialogDescription>
                        Update loan information. Leave fields empty to keep current values.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 mt-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Borrower Name</Label>
                          <Input
                            defaultValue={editingLoan.borrower_name || ''}
                            onChange={(e) => {
                              setEditingLoan({ ...editingLoan, borrower_name: e.target.value });
                            }}
                          />
                        </div>
                        <div>
                          <Label>Loan Amount</Label>
                          <Input
                            type="number"
                            defaultValue={editingLoan.loan_amount || ''}
                            onChange={(e) => {
                              setEditingLoan({ ...editingLoan, loan_amount: e.target.value });
                            }}
                          />
                        </div>
                        <div>
                          <Label>Loan Type</Label>
                          <Input
                            defaultValue={editingLoan.loan_type || ''}
                            onChange={(e) => {
                              setEditingLoan({ ...editingLoan, loan_type: e.target.value });
                            }}
                          />
                        </div>
                        <div>
                          <Label>Status</Label>
                          <Input
                            defaultValue={editingLoan.status || ''}
                            onChange={(e) => {
                              setEditingLoan({ ...editingLoan, status: e.target.value });
                            }}
                          />
                        </div>
                        <div>
                          <Label>Loan Officer Name</Label>
                          <Input
                            defaultValue={editingLoan.loan_officer_name || ''}
                            onChange={(e) => {
                              setEditingLoan({ ...editingLoan, loan_officer_name: e.target.value });
                            }}
                          />
                        </div>
                        <div>
                          <Label>Branch</Label>
                          <Input
                            defaultValue={editingLoan.branch || ''}
                            onChange={(e) => {
                              setEditingLoan({ ...editingLoan, branch: e.target.value });
                            }}
                          />
                        </div>
                        <div>
                          <Label>Application Date</Label>
                          <Input
                            type="date"
                            defaultValue={editingLoan.application_date ? editingLoan.application_date.split('T')[0] : ''}
                            onChange={(e) => {
                              setEditingLoan({ ...editingLoan, application_date: e.target.value });
                            }}
                          />
                        </div>
                        <div>
                          <Label>Closing Date</Label>
                          <Input
                            type="date"
                            defaultValue={editingLoan.closing_date ? editingLoan.closing_date.split('T')[0] : ''}
                            onChange={(e) => {
                              setEditingLoan({ ...editingLoan, closing_date: e.target.value });
                            }}
                          />
                        </div>
                        <div>
                          <Label>Lock Date</Label>
                          <Input
                            type="date"
                            defaultValue={editingLoan.lock_date ? editingLoan.lock_date.split('T')[0] : ''}
                            onChange={(e) => {
                              setEditingLoan({ ...editingLoan, lock_date: e.target.value });
                            }}
                          />
                        </div>
                        <div>
                          <Label>Interest Rate</Label>
                          <Input
                            type="number"
                            step="0.01"
                            defaultValue={editingLoan.interest_rate || ''}
                            onChange={(e) => {
                              setEditingLoan({ ...editingLoan, interest_rate: e.target.value });
                            }}
                          />
                        </div>
                      </div>
                      <DialogFooter className="mt-6">
                        <Button variant="outline" onClick={() => setEditingLoan(null)}>
                          Cancel
                        </Button>
                        <Button
                          onClick={() => {
                            const updates = {
                              borrower_name: editingLoan.borrower_name,
                              loan_amount: editingLoan.loan_amount,
                              loan_type: editingLoan.loan_type,
                              status: editingLoan.status,
                              loan_officer_name: editingLoan.loan_officer_name,
                              branch: editingLoan.branch,
                              application_date: editingLoan.application_date,
                              closing_date: editingLoan.closing_date,
                              lock_date: editingLoan.lock_date,
                              interest_rate: editingLoan.interest_rate,
                            };
                            handleUpdateLoan(editingLoan.loan_id, updates);
                          }}
                        >
                          Save Changes
                        </Button>
                      </DialogFooter>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            )}

            {/* Delete Confirmation Dialog */}
            {deletingLoanId && (
              <Dialog open={!!deletingLoanId} onOpenChange={() => setDeletingLoanId(null)}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Delete Loan</DialogTitle>
                    <DialogDescription>
                      Are you sure you want to delete loan {deletingLoanId}? This action cannot be undone.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDeletingLoanId(null)}>
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => handleDeleteLoan(deletingLoanId)}
                    >
                      Delete
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </CardContent>
        </Card>
        </>
      )}
    </motion.div>
  );
};

