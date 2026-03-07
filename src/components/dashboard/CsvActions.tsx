/**
 * CSV Actions Component
 * Provides download template and upload CSV functionality for Dashboard sections
 */

import { useState } from 'react';
import { Download, Upload, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FileUpload } from '@/components/ui/file-upload';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';

interface CsvActionsProps {
  sectionType: 'business-overview' | 'top-tiering' | 'leaderboard' | 'unified';
  onUploadSuccess?: () => void;
  className?: string;
}

export function CsvActions({ sectionType, onUploadSuccess, className }: CsvActionsProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const handleDownloadTemplate = async () => {
    setIsDownloading(true);
    try {
      const response = await api.fetchWithAuth(`/api/dashboard/csv/template?type=${sectionType}`, {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        // Handle unauthorized errors specifically
        if (response.status === 401) {
          throw new Error('Please log in to download templates');
        }
        const errorText = await response.text();
        let errorMessage = 'Failed to download template';
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error || errorMessage;
        } catch {
          errorMessage = errorText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sectionType}-template.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: 'Template downloaded',
        description: `CSV template for ${sectionType} has been downloaded.`,
      });
    } catch (error: any) {
      console.error('Error downloading template:', error);
      toast({
        title: 'Download failed',
        description: error.message || 'Failed to download CSV template',
        variant: 'destructive',
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleFileSelect = (file: File) => {
    setCsvFile(file);
  };

  const handleFileRemove = () => {
    setCsvFile(null);
  };

  const handleUpload = async () => {
    if (!csvFile) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', csvFile);
      formData.append('sectionType', sectionType);

      // Use the appropriate upload endpoint based on section type
      let endpoint = '/api/dashboard/import/loans';
      if (sectionType === 'leaderboard') {
        endpoint = '/api/dashboard/import/employees';
      }

      const response = await api.fetchWithAuth(endpoint, {
        method: 'POST',
        body: formData,
        // Don't set Content-Type, let browser set it with boundary for FormData
        credentials: 'include',
      });

      if (!response.ok) {
        // Handle unauthorized errors specifically
        if (response.status === 401) {
          throw new Error('Please log in to upload CSV files');
        }
        let errorData: any = { error: 'Upload failed' };
        try {
          const text = await response.text();
          if (text) {
            errorData = JSON.parse(text);
          }
        } catch (e) {
          errorData = { error: response.statusText || `HTTP ${response.status}` };
        }
        throw new Error(errorData.error || errorData.details || 'Failed to upload CSV file');
      }

      const responseData = await response.json();

      // Build detailed success message
      let description = '';
      if (responseData.message) {
        description = responseData.message;
      } else {
        const parts: string[] = [];
        if (responseData.inserted > 0) parts.push(`${responseData.inserted} new`);
        if (responseData.updated && responseData.updated > 0) parts.push(`${responseData.updated} updated`);
        if (parts.length > 0) {
          description = `Successfully imported ${(responseData.inserted || 0) + (responseData.updated || 0)} records (${parts.join(', ')})`;
        } else {
          description = `Successfully imported ${responseData.inserted || 0} records`;
        }
        if (responseData.skipped && responseData.skipped > 0) {
          description += `. ${responseData.skipped} duplicate${responseData.skipped === 1 ? '' : 's'} skipped`;
        }
        if (responseData.errors > 0) {
          description += `. ${responseData.errors} record${responseData.errors === 1 ? '' : 's'} had errors`;
        }
      }

      toast({
        title: 'Upload successful',
        description: description,
      });

      setCsvFile(null);
      setIsUploadDialogOpen(false);
      onUploadSuccess?.();
    } catch (error: any) {
      console.error('Error uploading CSV:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        fileName: csvFile?.name,
        fileSize: csvFile?.size,
      });
      
      // Provide more helpful error messages
      let errorMessage = error.message || 'Failed to upload CSV file';
      if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
        errorMessage = 'Unable to connect to server. Please check your connection and try again.';
      } else if (error.message?.includes('400') || error.message?.includes('parsing')) {
        errorMessage = 'CSV file format error. Please check the file format and try again.';
      } else if (error.message?.includes('500') || error.message?.includes('server')) {
        errorMessage = 'Server error. Please try again later.';
      }
      
      toast({
        title: 'Upload failed',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Button
        variant="outline"
        size="sm"
        onClick={handleDownloadTemplate}
        disabled={isDownloading}
        className="h-8 px-3 text-xs font-light"
      >
        {isDownloading ? (
          <>
            <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
            Downloading...
          </>
        ) : (
          <>
            <Download className="h-3 w-3 mr-1.5" />
            Template
          </>
        )}
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsUploadDialogOpen(true)}
        className="h-8 px-3 text-xs font-light"
      >
        <Upload className="h-3 w-3 mr-1.5" />
        Upload
      </Button>

      <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload CSV File</DialogTitle>
            <DialogDescription>
              Upload a CSV file for {sectionType}. Make sure it matches the template format.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <FileUpload
              onFileSelect={handleFileSelect}
              onRemove={handleFileRemove}
              value={csvFile}
              acceptedFileTypes=".csv"
              maxSize={250}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setIsUploadDialogOpen(false);
                  setCsvFile(null);
                }}
                disabled={isUploading}
              >
                Cancel
              </Button>
              <Button
                onClick={handleUpload}
                disabled={!csvFile || isUploading}
              >
                {isUploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  'Upload'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
