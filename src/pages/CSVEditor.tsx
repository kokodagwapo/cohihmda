import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navigation } from '@/components/layout/Navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  Plus,
  Trash2,
  Download,
  Upload,
  Save,
  FileText,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ArrowLeft,
  FileUp,
  FileDown
} from 'lucide-react';
import { api } from '@/lib/api';
import { motion } from 'framer-motion';
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

interface LoanRow {
  loan_id: string;
  borrower_name: string;
  loan_amount: string;
  loan_type: string;
  status: string;
  application_date: string;
  closing_date: string;
  lock_date: string;
  interest_rate: string;
  loan_officer_name: string;
  loan_officer_role: string;
  branch: string;
  fico_score: string;
  ltv: string;
  loan_purpose: string;
  credit_pull_date: string;
  property_address: string;
  property_city: string;
  property_state: string;
  property_zip: string;
  nmls_id: string;
}

const defaultColumns = [
  'loan_id',
  'borrower_name',
  'loan_amount',
  'loan_type',
  'status',
  'application_date',
  'closing_date',
  'lock_date',
  'interest_rate',
  'loan_officer_name',
  'loan_officer_role',
  'branch',
  'fico_score',
  'ltv',
  'loan_purpose',
  'credit_pull_date',
  'property_address',
  'property_city',
  'property_state',
  'property_zip',
  'nmls_id'
];

const loanTypes = ['Conventional', 'FHA', 'VA', 'USDA', 'Jumbo'];
const statuses = ['Active', 'Locked', 'Closed', 'Withdrawn', 'Denied'];
const loanPurposes = ['Purchase', 'Refinance', 'Cash-Out Refinance', 'Home Improvement'];
const branches = ['Downtown', 'Westside', 'North Branch', 'East Valley', 'Harbor District', 'Old Town', 'Lakeside', 'Airport Corridor', 'Tech Park', 'Riverside'];
const loanOfficers = ['Sarah Chen', 'Michael Rodriguez', 'Emily Johnson', 'David Kim', 'Jessica Martinez', 'Kyle Morrison', 'Shaniqua Davis', 'Patrick O\'Malley', 'Rosa Gutierrez', 'Bradley Stone'];
const loanOfficerRoles = ['Loan Officer', 'Senior LO', 'Branch Manager', 'Team Lead', 'Senior Loan Officer'];
const states = ['CA', 'NY', 'TX', 'FL', 'IL', 'PA', 'OH', 'GA', 'NC', 'MI', 'NJ', 'VA', 'WA', 'AZ', 'MA', 'TN', 'IN', 'MO', 'MD', 'WI'];

export default function CSVEditor() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [rows, setRows] = useState<LoanRow[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);

  // Load sample data on mount
  useEffect(() => {
    // Start with 5 empty rows
    const initialRows: LoanRow[] = Array.from({ length: 5 }, (_, i) => ({
      loan_id: `LOAN-${String(i + 1).padStart(3, '0')}`,
      borrower_name: '',
      loan_amount: '',
      loan_type: 'Conventional',
      status: 'Active',
      application_date: '',
      closing_date: '',
      lock_date: '',
      interest_rate: '',
      loan_officer_name: '',
      loan_officer_role: 'Loan Officer',
      branch: '',
      fico_score: '',
      ltv: '',
      loan_purpose: 'Purchase',
      credit_pull_date: '',
      property_address: '',
      property_city: '',
      property_state: '',
      property_zip: '',
      nmls_id: ''
    }));
    setRows(initialRows);
  }, []);

  const handleCellChange = (index: number, field: keyof LoanRow, value: string) => {
    const newRows = [...rows];
    newRows[index] = { ...newRows[index], [field]: value };
    setRows(newRows);
  };

  const addRow = () => {
    const newRow: LoanRow = {
      loan_id: `LOAN-${String(rows.length + 1).padStart(3, '0')}`,
      borrower_name: '',
      loan_amount: '',
      loan_type: 'Conventional',
      status: 'Active',
      application_date: '',
      closing_date: '',
      lock_date: '',
      interest_rate: '',
      loan_officer_name: '',
      loan_officer_role: 'Loan Officer',
      branch: '',
      fico_score: '',
      ltv: '',
      loan_purpose: 'Purchase',
      credit_pull_date: '',
      property_address: '',
      property_city: '',
      property_state: '',
      property_zip: '',
      nmls_id: ''
    };
    setRows([...rows, newRow]);
  };

  const deleteRow = (index: number) => {
    if (rows.length <= 1) {
      toast({
        title: 'Cannot Delete',
        description: 'You must have at least one row.',
        variant: 'destructive',
      });
      return;
    }
    const newRows = rows.filter((_, i) => i !== index);
    setRows(newRows);
  };

  const validateRow = (row: LoanRow, index: number): string[] => {
    const errors: string[] = [];
    if (!row.loan_id.trim()) {
      errors.push(`Row ${index + 1}: Loan ID is required`);
    }
    if (!row.borrower_name.trim()) {
      errors.push(`Row ${index + 1}: Borrower name is required`);
    }
    if (row.loan_amount && isNaN(parseFloat(row.loan_amount))) {
      errors.push(`Row ${index + 1}: Loan amount must be a number`);
    }
    if (row.interest_rate && (isNaN(parseFloat(row.interest_rate)) || parseFloat(row.interest_rate) < 0 || parseFloat(row.interest_rate) > 100)) {
      errors.push(`Row ${index + 1}: Interest rate must be a number between 0 and 100`);
    }
    if (row.application_date && isNaN(Date.parse(row.application_date))) {
      errors.push(`Row ${index + 1}: Application date must be a valid date (YYYY-MM-DD)`);
    }
    if (row.closing_date && isNaN(Date.parse(row.closing_date))) {
      errors.push(`Row ${index + 1}: Closing date must be a valid date (YYYY-MM-DD)`);
    }
    if (row.lock_date && isNaN(Date.parse(row.lock_date))) {
      errors.push(`Row ${index + 1}: Lock date must be a valid date (YYYY-MM-DD)`);
    }
    return errors;
  };

  const validateAllRows = (): boolean => {
    const allErrors: string[] = [];
    rows.forEach((row, index) => {
      const errors = validateRow(row, index);
      allErrors.push(...errors);
    });

    if (allErrors.length > 0) {
      toast({
        title: 'Validation Errors',
        description: allErrors.slice(0, 5).join(', ') + (allErrors.length > 5 ? ` and ${allErrors.length - 5} more...` : ''),
        variant: 'destructive',
      });
      return false;
    }
    return true;
  };

  const exportToCSV = () => {
    if (!validateAllRows()) return;

    // Filter out empty rows (rows with only loan_id)
    const validRows = rows.filter(row => row.borrower_name.trim() || row.loan_amount.trim());

    if (validRows.length === 0) {
      toast({
        title: 'No Data',
        description: 'Please add at least one row with data before exporting.',
        variant: 'destructive',
      });
      return;
    }

    // Create CSV content
    const headers = defaultColumns.join(',');
    const csvRows = validRows.map(row =>
      defaultColumns.map(col => {
        const value = row[col as keyof LoanRow] || '';
        // Escape commas and quotes in CSV
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',')
    );

    const csvContent = [headers, ...csvRows].join('\n');

    // Download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `loan-data-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: 'CSV Exported',
      description: `Exported ${validRows.length} rows to CSV file.`,
    });
  };

  const handleUpload = async () => {
    if (!validateAllRows()) return;

    // Filter out empty rows
    const validRows = rows.filter(row => row.borrower_name.trim() || row.loan_amount.trim());

    if (validRows.length === 0) {
      toast({
        title: 'No Data',
        description: 'Please add at least one row with data before uploading.',
        variant: 'destructive',
      });
      return;
    }

    setIsUploading(true);

    try {
      // Convert rows to CSV
      const headers = defaultColumns.join(',');
      const csvRows = validRows.map(row =>
        defaultColumns.map(col => {
          const value = row[col as keyof LoanRow] || '';
          if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        }).join(',')
      );
      const csvContent = [headers, ...csvRows].join('\n');

      // Create a File object from the CSV content
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const file = new File([blob], 'loan-data.csv', { type: 'text/csv' });

      // Upload using FormData
      const formData = new FormData();
      formData.append('csv', file);

      const result = await api.request<{
        success: boolean;
        records_processed: number;
        records_failed: number;
        errors: string[];
        message: string;
      }>('/api/los/demo/upload', {
        method: 'POST',
        body: formData,
      });

      toast({
        title: result.success ? 'Data Uploaded Successfully' : 'Upload Completed with Errors',
        description: result.message || `Processed ${result.records_processed || 0} records. ${result.records_failed || 0} failed.`,
        variant: result.success ? 'default' : 'destructive',
      });
    } catch (error: any) {
      console.error('Error uploading CSV:', error);
      toast({
        title: 'Upload Failed',
        description: error.message || 'Failed to upload data. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleImportCSV = async () => {
    if (!importFile) return;

    setIsImporting(true);
    try {
      const text = await importFile.text();
      const lines = text.split('\n').filter(line => line.trim());
      
      if (lines.length < 2) {
        toast({
          title: 'Invalid CSV',
          description: 'CSV file must have at least a header row and one data row.',
          variant: 'destructive',
        });
        setIsImporting(false);
        return;
      }

      // Parse header
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      
      // Parse data rows
      const importedRows: LoanRow[] = [];
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        const row: LoanRow = {
          loan_id: '',
          borrower_name: '',
          loan_amount: '',
          loan_type: 'Conventional',
          status: 'Active',
          application_date: '',
          closing_date: '',
          lock_date: '',
          interest_rate: '',
          loan_officer_name: '',
          loan_officer_role: 'Loan Officer',
          branch: '',
          fico_score: '',
          ltv: '',
          loan_purpose: 'Purchase',
          credit_pull_date: '',
          property_address: '',
          property_city: '',
          property_state: '',
          property_zip: '',
          nmls_id: ''
        };

        headers.forEach((header, index) => {
          const normalizedHeader = header.toLowerCase().replace(/\s+/g, '_');
          // Try exact match first
          if (defaultColumns.includes(normalizedHeader)) {
            (row as any)[normalizedHeader] = values[index] || '';
          } else {
            // Try partial match for common variations
            const matchingColumn = defaultColumns.find(col => 
              normalizedHeader.includes(col) || col.includes(normalizedHeader)
            );
            if (matchingColumn && values[index]) {
              (row as any)[matchingColumn] = values[index] || '';
            }
          }
        });

        // Only add row if it has at least loan_id or borrower_name
        if (row.loan_id || row.borrower_name) {
          importedRows.push(row);
        }
      }

      if (importedRows.length === 0) {
        toast({
          title: 'No Valid Data',
          description: 'CSV file does not contain valid loan data.',
          variant: 'destructive',
        });
      } else {
        setRows(importedRows);
        toast({
          title: 'CSV Imported',
          description: `Imported ${importedRows.length} rows from CSV file.`,
        });
        setShowImportDialog(false);
        setImportFile(null);
      }
    } catch (error: any) {
      console.error('Error importing CSV:', error);
      toast({
        title: 'Import Failed',
        description: error.message || 'Failed to import CSV file. Please check the format.',
        variant: 'destructive',
      });
    } finally {
      setIsImporting(false);
    }
  };

  const loadTemplate = () => {
    // Load template data
    const templateRows: LoanRow[] = Array.from({ length: 10 }, (_, i) => ({
      loan_id: `LOAN-${String(i + 1).padStart(3, '0')}`,
      borrower_name: `Borrower ${i + 1}`,
      loan_amount: String(300000 + i * 25000),
      loan_type: loanTypes[i % loanTypes.length],
      status: i < 3 ? 'Active' : i < 6 ? 'Locked' : 'Closed',
      application_date: new Date(2024, 0, 15 + i).toISOString().split('T')[0],
      closing_date: i >= 6 ? new Date(2024, 2, 15 + i).toISOString().split('T')[0] : '',
      lock_date: i >= 3 && i < 6 ? new Date(2024, 1, 10 + i).toISOString().split('T')[0] : '',
      interest_rate: (6.0 + (i * 0.1)).toFixed(2),
      loan_officer_name: loanOfficers[i % loanOfficers.length],
      loan_officer_role: loanOfficerRoles[i % loanOfficerRoles.length],
      branch: branches[i % branches.length],
      fico_score: String(680 + (i * 10)),
      ltv: String(70 + (i % 15)),
      loan_purpose: loanPurposes[i % loanPurposes.length],
      credit_pull_date: new Date(2024, 0, 10 + i).toISOString().split('T')[0],
      property_address: `${100 + i} Main Street`,
      property_city: 'Anytown',
      property_state: states[i % states.length],
      property_zip: `9000${i % 10}`,
      nmls_id: `NMLS${String(100000 + i).padStart(6, '0')}`
    }));
    setRows(templateRows);
    toast({
      title: 'Template Loaded',
      description: 'Loaded 10 sample rows. Edit them as needed.',
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <div className="container mx-auto px-4 pt-24 pb-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-6"
        >
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <Button
                variant="ghost"
                onClick={() => navigate(-1)}
                className="mb-4"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <h1 className="text-3xl font-light text-slate-900 dark:text-white tracking-tight">
                CSV Data Editor
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 font-light mt-2">
                Create and edit loan data online. Export to CSV or upload directly to the system.
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <Card className="border-slate-200 dark:border-slate-700">
            <CardContent className="pt-6">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  onClick={() => setShowImportDialog(true)}
                  className="flex items-center gap-2"
                >
                  <FileUp className="h-4 w-4" />
                  Import CSV
                </Button>
                <Button
                  variant="outline"
                  onClick={loadTemplate}
                  className="flex items-center gap-2"
                >
                  <FileText className="h-4 w-4" />
                  Load Template
                </Button>
                <Button
                  variant="outline"
                  onClick={addRow}
                  className="flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add Row
                </Button>
                <Button
                  variant="outline"
                  onClick={exportToCSV}
                  className="flex items-center gap-2"
                >
                  <Download className="h-4 w-4" />
                  Export CSV
                </Button>
                <Button
                  onClick={handleUpload}
                  disabled={isUploading}
                  className="flex items-center gap-2 ml-auto"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" />
                      Upload to System
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Data Table */}
          <Card className="border-slate-200 dark:border-slate-700">
            <CardHeader>
              <CardTitle className="text-lg font-light">Loan Data ({rows.length} rows)</CardTitle>
              <CardDescription className="text-sm font-light">
                Edit the data below. Empty rows will be filtered out on export/upload.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">#</TableHead>
                      <TableHead>Loan ID</TableHead>
                      <TableHead>Borrower</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>App Date</TableHead>
                      <TableHead>Close Date</TableHead>
                      <TableHead>Lock Date</TableHead>
                      <TableHead>Rate</TableHead>
                      <TableHead>LO Name</TableHead>
                      <TableHead>LO Role</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead>FICO</TableHead>
                      <TableHead>LTV</TableHead>
                      <TableHead>Purpose</TableHead>
                      <TableHead>Credit Pull</TableHead>
                      <TableHead>Property Address</TableHead>
                      <TableHead>City</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead>Zip</TableHead>
                      <TableHead>NMLS ID</TableHead>
                      <TableHead className="w-20">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">{index + 1}</TableCell>
                        <TableCell>
                          <Input
                            value={row.loan_id}
                            onChange={(e) => handleCellChange(index, 'loan_id', e.target.value)}
                            placeholder="LOAN-001"
                            className="w-32"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={row.borrower_name}
                            onChange={(e) => handleCellChange(index, 'borrower_name', e.target.value)}
                            placeholder="John Doe"
                            className="w-40"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={row.loan_amount}
                            onChange={(e) => handleCellChange(index, 'loan_amount', e.target.value)}
                            placeholder="350000"
                            className="w-32"
                          />
                        </TableCell>
                        <TableCell>
                          <select
                            value={row.loan_type}
                            onChange={(e) => handleCellChange(index, 'loan_type', e.target.value)}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {loanTypes.map(type => (
                              <option key={type} value={type}>{type}</option>
                            ))}
                          </select>
                        </TableCell>
                        <TableCell>
                          <select
                            value={row.status}
                            onChange={(e) => handleCellChange(index, 'status', e.target.value)}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {statuses.map(status => (
                              <option key={status} value={status}>{status}</option>
                            ))}
                          </select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="date"
                            value={row.application_date}
                            onChange={(e) => handleCellChange(index, 'application_date', e.target.value)}
                            className="w-40"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="date"
                            value={row.closing_date}
                            onChange={(e) => handleCellChange(index, 'closing_date', e.target.value)}
                            className="w-40"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="date"
                            value={row.lock_date}
                            onChange={(e) => handleCellChange(index, 'lock_date', e.target.value)}
                            className="w-40"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            value={row.interest_rate}
                            onChange={(e) => handleCellChange(index, 'interest_rate', e.target.value)}
                            placeholder="6.25"
                            className="w-24"
                          />
                        </TableCell>
                        <TableCell>
                          <select
                            value={row.loan_officer_name}
                            onChange={(e) => handleCellChange(index, 'loan_officer_name', e.target.value)}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <option value="">Select LO</option>
                            {loanOfficers.map(lo => (
                              <option key={lo} value={lo}>{lo}</option>
                            ))}
                          </select>
                        </TableCell>
                        <TableCell>
                          <select
                            value={row.loan_officer_role}
                            onChange={(e) => handleCellChange(index, 'loan_officer_role', e.target.value)}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {loanOfficerRoles.map(role => (
                              <option key={role} value={role}>{role}</option>
                            ))}
                          </select>
                        </TableCell>
                        <TableCell>
                          <select
                            value={row.branch}
                            onChange={(e) => handleCellChange(index, 'branch', e.target.value)}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <option value="">Select Branch</option>
                            {branches.map(branch => (
                              <option key={branch} value={branch}>{branch}</option>
                            ))}
                          </select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={row.fico_score}
                            onChange={(e) => handleCellChange(index, 'fico_score', e.target.value)}
                            placeholder="720"
                            className="w-20"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={row.ltv}
                            onChange={(e) => handleCellChange(index, 'ltv', e.target.value)}
                            placeholder="75"
                            className="w-20"
                          />
                        </TableCell>
                        <TableCell>
                          <select
                            value={row.loan_purpose}
                            onChange={(e) => handleCellChange(index, 'loan_purpose', e.target.value)}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {loanPurposes.map(purpose => (
                              <option key={purpose} value={purpose}>{purpose}</option>
                            ))}
                          </select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="date"
                            value={row.credit_pull_date}
                            onChange={(e) => handleCellChange(index, 'credit_pull_date', e.target.value)}
                            className="w-40"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={row.property_address}
                            onChange={(e) => handleCellChange(index, 'property_address', e.target.value)}
                            placeholder="123 Main St"
                            className="w-32"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={row.property_city}
                            onChange={(e) => handleCellChange(index, 'property_city', e.target.value)}
                            placeholder="Anytown"
                            className="w-28"
                          />
                        </TableCell>
                        <TableCell>
                          <select
                            value={row.property_state}
                            onChange={(e) => handleCellChange(index, 'property_state', e.target.value)}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <option value="">State</option>
                            {states.map(state => (
                              <option key={state} value={state}>{state}</option>
                            ))}
                          </select>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={row.property_zip}
                            onChange={(e) => handleCellChange(index, 'property_zip', e.target.value)}
                            placeholder="90000"
                            className="w-24"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={row.nmls_id}
                            onChange={(e) => handleCellChange(index, 'nmls_id', e.target.value)}
                            placeholder="NMLS123456"
                            className="w-32"
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteRow(index)}
                            className="text-red-600 hover:text-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Import Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import CSV File</DialogTitle>
            <DialogDescription>
              Select a CSV file to import. The file should have columns matching the loan data format.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="csv-file">CSV File</Label>
              <Input
                id="csv-file"
                type="file"
                accept=".csv"
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                className="mt-2"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImportDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleImportCSV} disabled={!importFile || isImporting}>
              {isImporting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Importing...
                </>
              ) : (
                'Import'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
