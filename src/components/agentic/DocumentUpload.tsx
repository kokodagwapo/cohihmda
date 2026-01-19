import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload, FileText, CheckCircle, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';

interface DocumentUploadProps {
  disabled?: boolean;
}

export function DocumentUpload({ disabled }: DocumentUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [verificationResult, setVerificationResult] = useState<any>(null);
  const { toast } = useToast();

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    
    try {
      // Get current user's tenant
      const { user } = await api.getCurrentUser();
      if (!user) throw new Error('Not authenticated');

      // Get profile via API
      const profile = await api.request<{ tenant_id?: string | null }>('/api/user/profile');
      if (!profile?.tenant_id) throw new Error('No tenant found');

      // Upload to S3 via Express backend (TODO: Implement S3 upload endpoint)
      const filePath = `${profile.tenant_id}/${Date.now()}_${file.name}`;
      const formData = new FormData();
      formData.append('file', file);
      formData.append('path', filePath);
      
      const uploadResponse = await api.request('/api/documents/upload', {
        method: 'POST',
        body: formData,
      });

      if ((uploadResponse as any)?.error) throw new Error((uploadResponse as any).error);

      setUploadedFile(file.name);

      // Simulate verification (in real app, this would be an edge function)
      setTimeout(() => {
        const mockResult = {
          status: 'verified',
          extracted_data: {
            document_type: 'pay_stub',
            income: 8500,
            employer: 'Tech Corp',
          },
          confidence_score: 0.95,
          flags: [],
        };
        setVerificationResult(mockResult);
        
        toast({
          title: 'Document verified',
          description: 'Income information extracted successfully',
        });
      }, 2000);

    } catch (error: any) {
      toast({
        title: 'Upload failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  }, [toast]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Document Verification</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-primary'
            }`}
          >
            <input
              type="file"
              onChange={handleFileUpload}
              disabled={disabled || uploading}
              accept="image/*,.pdf"
              className="hidden"
              id="file-upload"
            />
            <label
              htmlFor="file-upload"
              className={`cursor-pointer ${disabled ? 'pointer-events-none' : ''}`}
            >
              <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-sm font-medium mb-2">
                {uploading ? 'Uploading...' : 'Upload Document'}
              </p>
              <p className="text-xs text-muted-foreground">
                Pay stub, bank statement, or ID document
              </p>
            </label>
          </div>

          {uploadedFile && (
            <div className="flex items-center gap-3 p-4 bg-muted rounded-lg">
              <FileText className="h-8 w-8 text-primary" />
              <div className="flex-1">
                <p className="font-medium">{uploadedFile}</p>
                <p className="text-sm text-muted-foreground">
                  {verificationResult ? 'Verified' : 'Processing...'}
                </p>
              </div>
              {verificationResult && (
                verificationResult.status === 'verified' ? (
                  <CheckCircle className="h-6 w-6 text-green-600" />
                ) : (
                  <AlertTriangle className="h-6 w-6 text-yellow-600" />
                )
              )}
            </div>
          )}

          {verificationResult && (
            <Card className="bg-muted/50">
              <CardContent className="pt-6">
                <h4 className="font-semibold mb-2">Verification Results</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status:</span>
                    <span className="font-medium capitalize">
                      {verificationResult.status}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Monthly Income:</span>
                    <span className="font-medium">
                      ${verificationResult.extracted_data.income.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Confidence:</span>
                    <span className="font-medium">
                      {(verificationResult.confidence_score * 100).toFixed(0)}%
                    </span>
                  </div>
                  {verificationResult.extracted_data.employer && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Employer:</span>
                      <span className="font-medium">
                        {verificationResult.extracted_data.employer}
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
