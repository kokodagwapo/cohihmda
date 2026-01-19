import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { FileUpload } from '@/components/ui/file-upload';
import { createFieldMapping } from '@/lib/losFieldLibrary';
import Papa from 'papaparse';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { 
  Download, 
  FileText, 
  Loader2, 
  AlertCircle,
  Database,
  Upload,
  CheckCircle2,
} from 'lucide-react';

interface DemoDataSectionProps {
  onUploadSuccess?: () => void;
}

interface ImportProgress {
  status?: string;
  phase: string;
  totalRecords: number;
  processedRecords: number;
  insertedRecords: number;
  updatedRecords: number;
  skippedRecords: number;
  errorRecords: number;
  currentBatch?: number;
  totalBatches?: number;
  message?: string;
  estimatedTimeRemaining?: number;
}

export function DemoDataSection({ onUploadSuccess }: DemoDataSectionProps) {
  const [demoCsvFile, setDemoCsvFile] = useState<File | null>(null);
  const [demoCsvColumns, setDemoCsvColumns] = useState<string[]>([]);
  const [demoFieldMapping, setDemoFieldMapping] = useState<Record<string, string>>({});
  const [detectingColumns, setDetectingColumns] = useState(false);
  const [uploadingDemoCsv, setUploadingDemoCsv] = useState(false);
  const [insertingSampleData, setInsertingSampleData] = useState(false);
  const [resettingData, setResettingData] = useState(false);
  const [showInsertDialog, setShowInsertDialog] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [demoUploadResult, setDemoUploadResult] = useState<{
    success: boolean;
    records_processed: number;
    records_failed: number;
    errors: string[];
    message: string;
  } | null>(null);
  const { toast } = useToast();

  const handleDemoCsvFileSelect = async (file: File) => {
    setDemoCsvFile(file);
    setDemoUploadResult(null);
    setDetectingColumns(true);
    setDemoCsvColumns([]);
    setDemoFieldMapping({});

    try {
      const text = await file.text();
      
      // Remove BOM if present (common in Excel-exported CSV files)
      const csvText = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
      
      if (!csvText || csvText.trim().length === 0) {
        toast({
          title: 'Empty File',
          description: 'The CSV file appears to be empty.',
          variant: 'destructive',
        });
        setDetectingColumns(false);
        return;
      }

      // Parse CSV with Papa.parse for proper handling of quoted fields, different delimiters, etc.
      const parseResult = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
        preview: 1, // Only need first row to detect columns
      });

      if (parseResult.errors && parseResult.errors.length > 0) {
        const criticalErrors = parseResult.errors.filter((err: any) => 
          err.type !== 'Quotes' && err.type !== 'Delimiter' && err.code !== 'MissingQuotes'
        );
        
        if (criticalErrors.length > 0) {
          console.error('CSV parsing errors:', criticalErrors);
          toast({
            title: 'CSV Parse Error',
            description: `Failed to parse CSV: ${criticalErrors[0].message || 'Invalid CSV format'}`,
            variant: 'destructive',
          });
          setDetectingColumns(false);
          return;
        }
      }

      // Extract columns from parsed data or meta
      const columns = parseResult.meta?.fields || 
                     (parseResult.data && parseResult.data.length > 0 ? Object.keys(parseResult.data[0]) : []);

      if (columns.length === 0) {
        toast({
          title: 'No Columns Detected',
          description: 'Could not detect column headers in the CSV file. Please ensure the first row contains column names.',
          variant: 'destructive',
        });
        setDetectingColumns(false);
        return;
      }

      // Automatically create field mapping
      const autoMapping = createFieldMapping(columns);
      setDemoCsvColumns(columns);
      setDemoFieldMapping(autoMapping);
      setDetectingColumns(false);
    } catch (error: any) {
      console.error('Error reading CSV file:', error);
      toast({
        title: 'File Read Error',
        description: error.message || 'Failed to read CSV file. Please ensure it is a valid CSV file.',
        variant: 'destructive',
      });
      setDetectingColumns(false);
    }
  };

  const handleDemoCsvFileRemove = () => {
    setDemoCsvFile(null);
    setDemoCsvColumns([]);
    setDemoFieldMapping({});
    setDemoUploadResult(null);
  };


  // Poll for import progress
  const pollImportProgress = async (jobId: string) => {
    const maxAttempts = 6000; // 10 minutes (6000 * 100ms)
    let attempts = 0;
    
    const poll = async () => {
      if (attempts >= maxAttempts) {
        setUploadingDemoCsv(false);
        setImportProgress(null);
        toast({
          title: 'Import Timeout',
          description: 'Import is taking longer than expected. Please check server logs.',
          variant: 'destructive',
        });
        return;
      }
      
      try {
        console.log(`Polling progress for job ${jobId}, attempt ${attempts + 1}`);
        const progress = await api.request<ImportProgress & { status: string }>(`/api/dashboard/import/progress/${jobId}`);
        console.log('Progress received:', {
          status: progress.status,
          phase: progress.phase,
          processed: progress.processedRecords,
          total: progress.totalRecords,
          inserted: progress.insertedRecords,
          updated: progress.updatedRecords,
        });
        setImportProgress(progress);
        
        // Check if completed
        if (progress.status === 'completed') {
          console.log('Import completed successfully');
          
          // Update progress to show 100% completion
          setImportProgress({
            ...progress,
            processedRecords: progress.totalRecords,
            phase: 'done',
            message: progress.message || 'Import completed successfully!',
          });
          
          // Show success result
          const totalProcessed = progress.insertedRecords + progress.updatedRecords;
          const message = progress.message || `Successfully imported ${totalProcessed} records`;
          
          setDemoUploadResult({
            success: true,
            records_processed: totalProcessed,
            records_failed: progress.errorRecords,
            errors: [],
            message: message,
          });
          
          toast({
            title: 'Import Complete',
            description: message,
          });
          
          // Keep progress visible for 3 seconds to show completion state
          setTimeout(() => {
            console.log('Clearing progress UI after 3 seconds');
            setImportProgress(null);
            setUploadingDemoCsv(false);
            setDemoCsvFile(null);
            setDemoCsvColumns([]);
            setDemoFieldMapping({});
            
            // Trigger refresh of dashboard data
            onUploadSuccess?.();
          }, 3000);
          
          return;
        } else if (progress.status === 'failed') {
          console.log('Import failed');
          // Show error result
          setDemoUploadResult({
            success: false,
            records_processed: 0,
            records_failed: progress.totalRecords,
            errors: [progress.message || 'Import failed'],
            message: progress.message || 'Import failed',
          });
          
          setImportProgress(null);
          setUploadingDemoCsv(false);
          
          toast({
            title: 'Import Failed',
            description: progress.message || 'An error occurred during import',
            variant: 'destructive',
          });
          return;
        }
        
        // Continue polling if still processing
        attempts++;
        setTimeout(poll, 100); // Poll every 100ms for real-time updates
      } catch (error) {
        console.error('Error fetching import progress:', error);
        // Stop polling on error
        setImportProgress(null);
        setUploadingDemoCsv(false);
        
        toast({
          title: 'Progress Error',
          description: 'Unable to fetch import progress. The import may still be running.',
          variant: 'destructive',
        });
      }
    };
    
    // Start polling immediately (no delay)
    console.log('Starting progress polling for job:', jobId);
    // Use setImmediate equivalent to poll as fast as possible
    Promise.resolve().then(poll);
  };

  const handleDownloadTemplate = async (type: 'business-overview' | 'top-tiering' | 'leaderboard' | 'combined') => {
    try {
      const token = localStorage.getItem('auth_token');
      const { getApiUrl } = await import('@/lib/api');
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/dashboard/csv/template?type=${type}`, {
        method: 'GET',
        headers: token ? {
          'Authorization': `Bearer ${token}`,
        } : {},
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to download template');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${type}-template.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: 'Template downloaded',
        description: `CSV template for ${type.replace('-', ' ')} has been downloaded.`,
      });
    } catch (error: any) {
      console.error('Error downloading template:', error);
      toast({
        title: 'Download failed',
        description: error.message || 'Failed to download CSV template',
        variant: 'destructive',
      });
    }
  };

  const handleInsertSampleData = async () => {
    setInsertingSampleData(true);
    try {
      const result = await api.request<{
        success: boolean;
        employees_inserted: number;
        loans_inserted: number;
        message: string;
        summary?: {
          total: number;
          funded: number;
          active: number;
          withdrawn: number;
          denied: number;
          totalVolume: string;
        };
      }>('/api/dashboard/reset-sample-data', {
        method: 'POST',
      });

      toast({
        title: 'Sample Data Inserted',
        description: result.message || `Inserted ${result.employees_inserted} employees and ${result.loans_inserted} loans (full drilldowns).`,
      });

      if (result.summary) {
        toast({
          title: '📊 Data Summary',
          description: `Total: ${result.summary.total} | Funded: ${result.summary.funded} | Active: ${result.summary.active} | Volume: ${result.summary.totalVolume}`,
          duration: 6000,
        });
      }

      onUploadSuccess?.();
    } catch (error: any) {
      console.error('Error inserting sample data:', error);
      toast({
        title: 'Insert Failed',
        description: error.message || 'Failed to insert sample data',
        variant: 'destructive',
      });
    } finally {
      setInsertingSampleData(false);
      setShowInsertDialog(false);
    }
  };

  const handleResetAndPopulate = async () => {
    setResettingData(true);
    try {
      const result = await api.request<{
        success: boolean;
        employees_inserted: number;
        loans_inserted: number;
        summary: {
          total: number;
          funded: number;
          active: number;
          withdrawn: number;
          denied: number;
          totalVolume: string;
        };
        message: string;
      }>('/api/dashboard/reset-sample-data', {
        method: 'POST',
      });

      toast({
        title: '✅ Data Reset Complete',
        description: result.message,
        duration: 7000,
      });

      if (result.summary) {
        toast({
          title: '📊 Data Summary',
          description: `Total: ${result.summary.total} loans | Funded: ${result.summary.funded} | Active: ${result.summary.active} | Volume: ${result.summary.totalVolume}`,
          duration: 6000,
        });
      }

      onUploadSuccess?.();
    } catch (error: any) {
      console.error('Error resetting data:', error);
      toast({
        title: 'Reset Failed',
        description: error.message || 'Failed to reset and populate data',
        variant: 'destructive',
      });
    } finally {
      setResettingData(false);
      setShowResetDialog(false);
    }
  };

  const handleResetOnly = async () => {
    setResettingData(true);
    try {
      const result = await api.request<{
        success: boolean;
        message: string;
      }>('/api/dashboard/reset-data', {
        method: 'POST',
      });

      toast({
        title: 'Data Cleared',
        description: result.message || 'All tenant data has been removed.',
      });

      onUploadSuccess?.();
    } catch (error: any) {
      console.error('Error resetting data:', error);
      toast({
        title: 'Reset Failed',
        description: error.message || 'Failed to reset data',
        variant: 'destructive',
      });
    } finally {
      setResettingData(false);
    }
  };

  const handleUpload = async () => {
    if (!demoCsvFile) {
      toast({
        title: 'No File Selected',
        description: 'Please select a CSV file to upload.',
        variant: 'destructive',
      });
      return;
    }

    setUploadingDemoCsv(true);
    setDemoUploadResult(null);

    try {
      // Save field mappings if they exist
      if (demoFieldMapping && Object.keys(demoFieldMapping).length > 0) {
        const fieldMappings: Record<string, { source: string; target: string }> = {};
        for (const [source, target] of Object.entries(demoFieldMapping)) {
          fieldMappings[source] = { source, target };
        }
        
        await api.request('/api/field-mappings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fieldMappings,
            customDisplayNames: {},
          }),
        });
      }

      const formData = new FormData();
      formData.append('file', demoCsvFile);
      formData.append('sectionType', 'unified'); // Use unified for demo data

      const response = await api.request('/api/dashboard/import/loans', {
        method: 'POST',
        body: formData,
        headers: {
          // Don't set Content-Type, let browser set it with boundary
        },
      });

      const uploadResponse = response as { 
        jobId?: string;
        message?: string;
        totalRecords?: number;
        status?: string;
      };
      
      // Start polling immediately if jobId is provided
      if (uploadResponse.jobId) {
        console.log('Received jobId:', uploadResponse.jobId, 'Total records:', uploadResponse.totalRecords);
        setImportJobId(uploadResponse.jobId);
        
        // Initialize progress state immediately
        setImportProgress({
          phase: 'parsing',
          totalRecords: uploadResponse.totalRecords || 0,
          processedRecords: 0,
          insertedRecords: 0,
          updatedRecords: 0,
          skippedRecords: 0,
          errorRecords: 0,
          message: 'Starting import...',
        });
        
        console.log('Starting polling for import...');
        // Start polling immediately (non-blocking)
        setTimeout(() => pollImportProgress(uploadResponse.jobId), 0);
      } else {
        // Fallback for old-style synchronous response (shouldn't happen)
        setUploadingDemoCsv(false);
        toast({
          title: 'Import Started',
          description: 'Import is processing...',
        });
      }
    } catch (error: any) {
      console.error('Error uploading CSV:', error);
      setDemoUploadResult({
        success: false,
        records_processed: 0,
        records_failed: 0,
        errors: [error.message || 'Upload failed'],
        message: error.message || 'Failed to upload CSV file',
      });
      toast({
        title: 'Upload failed',
        description: error.message || 'Failed to upload CSV file',
        variant: 'destructive',
      });
      setUploadingDemoCsv(false);
      setImportProgress(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Info Card */}
      <Card className="border-slate-200 dark:border-slate-700 bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 dark:bg-indigo-900/40 rounded-lg">
              <FileText className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <CardTitle className="text-xl font-thin text-slate-900 dark:text-white tracking-tight">
                Demo Data Management
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light mt-1">
                Download CSV templates for each dashboard section or insert sample data directly into the database.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="p-4 bg-white/60 dark:bg-slate-800/40 rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-amber-500 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-base font-extralight text-slate-900 dark:text-white mb-1">For Testing & Demo Only</p>
                <p className="text-xs text-slate-500 dark:text-slate-500 font-light">
                  CSV templates match the exact data structures used in Business Overview, Leaderboard, and Top Tiering sections. Sample data can be inserted directly for quick testing.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* CSV Templates Section */}
      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardHeader>
          <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
            Download CSV Templates
          </CardTitle>
          <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
            Download templates for each dashboard section. Each template includes sample data matching the section's data structure.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Button
              variant="outline"
              onClick={() => handleDownloadTemplate('business-overview')}
              className="flex items-center justify-start gap-2 font-light"
            >
              <Download className="h-4 w-4" />
              <div className="text-left">
                <div className="font-medium">Business Overview</div>
                <div className="text-xs text-slate-500">Active loans, closed loans, cycle time, pull-through, credit pulls</div>
              </div>
            </Button>

            <Button
              variant="outline"
              onClick={() => handleDownloadTemplate('top-tiering')}
              className="flex items-center justify-start gap-2 font-light"
            >
              <Download className="h-4 w-4" />
              <div className="text-left">
                <div className="font-medium">Top Tiering</div>
                <div className="text-xs text-slate-500">Productivity, profitability, complexity scores</div>
              </div>
            </Button>

            <Button
              variant="outline"
              onClick={() => handleDownloadTemplate('leaderboard')}
              className="flex items-center justify-start gap-2 font-light"
            >
              <Download className="h-4 w-4" />
              <div className="text-left">
                <div className="font-medium">Leaderboard</div>
                <div className="text-xs text-slate-500">Employee performance, loans closed, revenue</div>
              </div>
            </Button>

            <Button
              variant="outline"
              onClick={() => handleDownloadTemplate('combined')}
              className="flex items-center justify-start gap-2 font-light"
            >
              <Download className="h-4 w-4" />
              <div className="text-left">
                <div className="font-medium">Combined Template</div>
                <div className="text-xs text-slate-500">All sections - employees and loans together</div>
              </div>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Sample Data Management */}
      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardHeader>
          <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
            Sample Data Management
          </CardTitle>
          <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
            Populate the dashboard with realistic demo data covering Business Overview, Leaderboard, and Loan Funnel drilldowns.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800/30">
              <h4 className="text-sm font-medium text-slate-900 dark:text-white mb-2">Insert Full Demo Data</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-light mb-3">
                Inserts comprehensive demo data (Business Overview, Leaderboard, Loan Funnel drilldowns). Use after resetting to populate fresh data.
              </p>
              <Button
                onClick={() => setShowInsertDialog(true)}
                disabled={insertingSampleData || resettingData}
                variant="outline"
                className="font-extralight w-full"
              >
                {insertingSampleData ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Inserting...
                  </>
                ) : (
                  <>
                    <Database className="h-4 w-4 mr-2" />
                    Insert Full Demo Data
                  </>
                )}
              </Button>
            </div>

            <div className="p-4 border border-red-200 dark:border-red-800/50 rounded-lg bg-red-50 dark:bg-red-900/10">
              <h4 className="text-sm font-medium text-red-900 dark:text-red-100 mb-2">Reset (Clear All Data)</h4>
              <p className="text-xs text-red-600 dark:text-red-400 font-light mb-3">
                Deletes ALL existing data for this tenant and leaves it empty. Then use "Insert Full Demo Data" to repopulate.
              </p>
              <Button
                onClick={() => setShowResetDialog(true)}
                disabled={insertingSampleData || resettingData}
                variant="destructive"
                className="font-extralight w-full"
              >
                {resettingData ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Resetting...
                  </>
                ) : (
                  <>
                    <Database className="h-4 w-4 mr-2" />
                    Reset Data
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 rounded-lg">
            <p className="text-xs text-blue-700 dark:text-blue-300 font-light">
              <strong>Realistic Data Includes:</strong> ~1,800 loans across 2025 (YTD), 12 loan officers with varied performance, and full drilldowns for Business Overview, Leaderboard, and Loan Funnel modals.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Insert confirmation dialog */}
      <AlertDialog open={showInsertDialog} onOpenChange={setShowInsertDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800">
              <Database className="h-6 w-6 text-slate-800 dark:text-slate-100" />
            </div>
            <AlertDialogTitle className="text-lg font-semibold text-slate-900 dark:text-white">
              Populate Full Demo Data
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-slate-600 dark:text-slate-400">
              This will populate full demo data (Business Overview, Leaderboard, Loan Funnel drilldowns) and replace existing demo data. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={insertingSampleData}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleInsertSampleData} disabled={insertingSampleData}>
              {insertingSampleData ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Working...
                </div>
              ) : (
                'OK'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset confirmation dialog */}
      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-800/50">
              <Database className="h-6 w-6 text-rose-600 dark:text-rose-300" />
            </div>
            <AlertDialogTitle className="text-lg font-semibold text-slate-900 dark:text-white">
              Reset (Clear All Data)
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-slate-600 dark:text-slate-400">
              This will DELETE ALL existing data for this tenant and leave it empty. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resettingData}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetOnly} disabled={resettingData} className="bg-rose-600 hover:bg-rose-700">
              {resettingData ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Resetting...
                </div>
              ) : (
                'OK'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* CSV Upload Section */}
      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardHeader>
          <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
            Upload CSV File
          </CardTitle>
          <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
            Upload a CSV file using any of the templates above. The system will automatically detect and map fields.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* CSV Upload */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-base font-extralight">CSV File</Label>
              <FileUpload
                onFileSelect={handleDemoCsvFileSelect}
                onRemove={handleDemoCsvFileRemove}
                value={demoCsvFile}
                disabled={uploadingDemoCsv || detectingColumns}
                acceptedFileTypes=".csv"
              />
              {detectingColumns && (
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Detecting CSV columns and mapping fields...
                </div>
              )}
              {!detectingColumns && demoCsvFile && demoCsvColumns.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  {demoCsvColumns.length} columns detected and mapped automatically
                </div>
              )}
            </div>

            {/* Upload Button */}
            <Button
              onClick={handleUpload}
              disabled={!demoCsvFile || uploadingDemoCsv || detectingColumns}
              className="font-extralight"
            >
              {uploadingDemoCsv ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload CSV
                </>
              )}
            </Button>

            {/* Import Progress */}
            {importProgress && uploadingDemoCsv && (
              <div className="p-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20">
                <div className="space-y-3">
                  {/* Progress Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
                      <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                        {importProgress.phase === 'parsing' && 'Parsing CSV...'}
                        {importProgress.phase === 'transforming' && 'Transforming data...'}
                        {importProgress.phase === 'checking' && 'Checking for duplicates...'}
                        {importProgress.phase === 'inserting' && 'Inserting new records...'}
                        {importProgress.phase === 'updating' && 'Updating existing records...'}
                        {importProgress.phase === 'finalizing' && 'Finalizing import...'}
                      </span>
                    </div>
                    {importProgress.estimatedTimeRemaining && importProgress.estimatedTimeRemaining > 0 && (
                      <span className="text-xs text-blue-600 dark:text-blue-400 font-light">
                        ~{Math.ceil(importProgress.estimatedTimeRemaining / 1000)}s remaining
                      </span>
                    )}
                  </div>

                  {/* Progress Bar */}
                  {importProgress.totalRecords > 0 && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-blue-700 dark:text-blue-300 font-light">
                        <span>
                          {importProgress.processedRecords} / {importProgress.totalRecords} records
                        </span>
                        <span>
                          {Math.round((importProgress.processedRecords / importProgress.totalRecords) * 100)}%
                        </span>
                      </div>
                      <Progress 
                        value={Math.min(100, (importProgress.processedRecords / importProgress.totalRecords) * 100)} 
                        className="h-2"
                      />
                    </div>
                  )}

                  {/* Batch Progress (for insert/update phases) */}
                  {(importProgress.phase === 'inserting' || importProgress.phase === 'updating') && 
                   importProgress.currentBatch && importProgress.totalBatches && (
                    <div className="text-xs text-blue-700 dark:text-blue-300 font-light">
                      Processing batch {importProgress.currentBatch} of {importProgress.totalBatches}
                    </div>
                  )}

                  {/* Statistics */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div className="text-center p-2 bg-white/50 dark:bg-slate-800/50 rounded">
                      <div className="text-emerald-600 dark:text-emerald-400 font-medium">
                        {importProgress.insertedRecords}
                      </div>
                      <div className="text-slate-600 dark:text-slate-400 font-light">Inserted</div>
                    </div>
                    <div className="text-center p-2 bg-white/50 dark:bg-slate-800/50 rounded">
                      <div className="text-blue-600 dark:text-blue-400 font-medium">
                        {importProgress.updatedRecords}
                      </div>
                      <div className="text-slate-600 dark:text-slate-400 font-light">Updated</div>
                    </div>
                    <div className="text-center p-2 bg-white/50 dark:bg-slate-800/50 rounded">
                      <div className="text-amber-600 dark:text-amber-400 font-medium">
                        {importProgress.skippedRecords}
                      </div>
                      <div className="text-slate-600 dark:text-slate-400 font-light">Skipped</div>
                    </div>
                    <div className="text-center p-2 bg-white/50 dark:bg-slate-800/50 rounded">
                      <div className="text-red-600 dark:text-red-400 font-medium">
                        {importProgress.errorRecords}
                      </div>
                      <div className="text-slate-600 dark:text-slate-400 font-light">Errors</div>
                    </div>
                  </div>

                  {/* Status Message */}
                  {importProgress.message && (
                    <p className="text-xs text-blue-700 dark:text-blue-300 font-light">
                      {importProgress.message}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Upload Result */}
            {demoUploadResult && (
              <div className={`p-4 rounded-lg border ${
                demoUploadResult.success
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
                  : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
              }`}>
                <div className="flex items-start gap-2">
                  {demoUploadResult.success ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${
                      demoUploadResult.success
                        ? 'text-emerald-900 dark:text-emerald-100'
                        : 'text-red-900 dark:text-red-100'
                    }`}>
                      {demoUploadResult.message}
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 font-light">
                      Processed: {demoUploadResult.records_processed} | Failed: {demoUploadResult.records_failed}
                    </p>
                    {demoUploadResult.errors.length > 0 && (
                      <div className="mt-2 text-xs text-red-600 dark:text-red-400 font-light">
                        {demoUploadResult.errors.slice(0, 3).map((error, idx) => (
                          <div key={idx}>• {error}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
