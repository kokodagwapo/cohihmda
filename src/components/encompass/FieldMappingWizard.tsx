/**
 * Field Mapping Wizard Component
 * Guided wizard for new LOS connection field mapping setup
 * Walks users through discovery, analysis, and bulk mapping application
 */

import * as React from 'react';
import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
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
  CheckCircle2, 
  XCircle, 
  Loader2,
  Sparkles,
  TrendingUp,
  AlertTriangle,
  HelpCircle,
  ArrowRight,
  ArrowLeft,
  Check,
  Database,
  Search,
  Zap,
  FileCheck
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

// Types
interface MappingSuggestion {
  coheusAlias: string;
  postgresqlColumn: string;
  defaultFieldId: string | null;
  suggestedFieldId: string | null;
  suggestedFieldDescription?: string;
  confidence: number;
  confidenceLevel: 'high' | 'medium' | 'low' | 'none';
  matchReason: string;
  populationRate?: number;
  isCurrentlyMapped: boolean;
  currentMappedFieldId?: string;
}

interface DiscoveryResult {
  discoveredFields: Array<{
    fieldId: string;
    description: string;
    format?: string;
    isCustom: boolean;
  }>;
  rdbFieldCount: number;
  customFieldCount: number;
}

interface SuggestionsResult {
  suggestions: MappingSuggestion[];
  highConfidenceCount: number;
  mediumConfidenceCount: number;
  lowConfidenceCount: number;
  unmappedCount: number;
}

interface FieldMappingWizardProps {
  losConnectionId: string;
  tenantId: string;
  connectionName?: string;
  onComplete?: () => void;
  onCancel?: () => void;
}

type WizardStep = 'welcome' | 'discovery' | 'analysis' | 'review' | 'complete';

export function FieldMappingWizard({
  losConnectionId,
  tenantId,
  connectionName,
  onComplete,
  onCancel,
}: FieldMappingWizardProps) {
  const { toast } = useToast();
  
  // Wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>('welcome');
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Data state
  const [discoveryResult, setDiscoveryResult] = useState<DiscoveryResult | null>(null);
  const [suggestionsResult, setSuggestionsResult] = useState<SuggestionsResult | null>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const [appliedCount, setAppliedCount] = useState(0);

  // Step handlers
  const handleStartDiscovery = useCallback(async () => {
    setCurrentStep('discovery');
    setIsLoading(true);
    setProgress(0);
    setError(null);

    try {
      // Phase 1: Field Discovery
      setProgress(20);
      const discoveryResponse = await api.request<{ success: boolean } & DiscoveryResult>(
        `/api/encompass/discovery/fields/${losConnectionId}?tenant_id=${tenantId}&use_cache=false`
      );

      if (!discoveryResponse.success) {
        throw new Error('Field discovery failed');
      }

      setDiscoveryResult({
        discoveredFields: discoveryResponse.discoveredFields,
        rdbFieldCount: discoveryResponse.rdbFieldCount,
        customFieldCount: discoveryResponse.customFieldCount,
      });

      // Phase 2: Analysis & Suggestions
      setCurrentStep('analysis');
      setProgress(50);

      const suggestionsResponse = await api.request<{ success: boolean } & SuggestionsResult>(
        `/api/encompass/discovery/suggestions/${losConnectionId}?tenant_id=${tenantId}&run_analysis=true&sample_size=50`
      );

      if (!suggestionsResponse.success) {
        throw new Error('Field analysis failed');
      }

      setSuggestionsResult({
        suggestions: suggestionsResponse.suggestions,
        highConfidenceCount: suggestionsResponse.highConfidenceCount,
        mediumConfidenceCount: suggestionsResponse.mediumConfidenceCount,
        lowConfidenceCount: suggestionsResponse.lowConfidenceCount,
        unmappedCount: suggestionsResponse.unmappedCount,
      });

      // Auto-select high confidence suggestions
      const autoSelected = new Set<string>();
      suggestionsResponse.suggestions.forEach(s => {
        if (s.confidenceLevel === 'high' && s.suggestedFieldId) {
          autoSelected.add(s.coheusAlias);
        }
      });
      setSelectedSuggestions(autoSelected);

      setProgress(100);
      setCurrentStep('review');
    } catch (err: any) {
      console.error('[FieldMappingWizard] Error:', err);
      setError(err.message || 'An error occurred during analysis');
      toast({
        title: 'Analysis Failed',
        description: err.message || 'Failed to analyze fields',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [losConnectionId, tenantId, toast]);

  const handleToggleSuggestion = useCallback((alias: string) => {
    setSelectedSuggestions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(alias)) {
        newSet.delete(alias);
      } else {
        newSet.add(alias);
      }
      return newSet;
    });
  }, []);

  const handleSelectByConfidence = useCallback((level: 'high' | 'medium' | 'all' | 'none') => {
    if (!suggestionsResult) return;

    if (level === 'none') {
      setSelectedSuggestions(new Set());
      return;
    }

    const toSelect = suggestionsResult.suggestions.filter(s => {
      if (!s.suggestedFieldId) return false;
      if (level === 'all') return s.confidenceLevel !== 'none';
      return s.confidenceLevel === level;
    });
    
    setSelectedSuggestions(new Set(toSelect.map(s => s.coheusAlias)));
  }, [suggestionsResult]);

  const handleApplyMappings = useCallback(async () => {
    if (selectedSuggestions.size === 0 || !suggestionsResult) {
      setCurrentStep('complete');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const suggestionsToApply = suggestionsResult.suggestions
        .filter(s => selectedSuggestions.has(s.coheusAlias) && s.suggestedFieldId)
        .map(s => ({
          coheusAlias: s.coheusAlias,
          fieldId: s.suggestedFieldId!,
        }));

      const response = await api.request<{ success: boolean; applied: number; errors: string[] }>(
        `/api/encompass/discovery/apply/${losConnectionId}?tenant_id=${tenantId}`,
        {
          method: 'POST',
          body: JSON.stringify({ suggestions: suggestionsToApply }),
        }
      );

      if (response.success) {
        setAppliedCount(response.applied);
        setCurrentStep('complete');
        toast({
          title: 'Mappings Applied',
          description: `Successfully applied ${response.applied} field mappings`,
        });
      }
    } catch (err: any) {
      console.error('[FieldMappingWizard] Error applying mappings:', err);
      setError(err.message || 'Failed to apply mappings');
      toast({
        title: 'Error',
        description: err.message || 'Failed to apply mappings',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [selectedSuggestions, suggestionsResult, losConnectionId, tenantId, toast]);

  const getConfidenceBadge = (level: 'high' | 'medium' | 'low' | 'none', confidence: number) => {
    switch (level) {
      case 'high':
        return (
          <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {confidence}%
          </Badge>
        );
      case 'medium':
        return (
          <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-0">
            <TrendingUp className="h-3 w-3 mr-1" />
            {confidence}%
          </Badge>
        );
      case 'low':
        return (
          <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 border-0">
            <AlertTriangle className="h-3 w-3 mr-1" />
            {confidence}%
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary">
            <HelpCircle className="h-3 w-3 mr-1" />
            N/A
          </Badge>
        );
    }
  };

  // Render steps
  const renderWelcomeStep = () => (
    <div className="text-center py-8">
      <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/40 rounded-full flex items-center justify-center mx-auto mb-6">
        <Sparkles className="h-8 w-8 text-blue-600 dark:text-blue-400" />
      </div>
      <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
        Smart Field Mapping Setup
      </h3>
      <p className="text-slate-600 dark:text-slate-400 mb-6 max-w-md mx-auto">
        We'll analyze your Encompass instance to automatically discover fields and suggest optimal mappings.
        This process typically takes 15-30 seconds.
      </p>
      <div className="flex flex-col gap-4 max-w-sm mx-auto text-left mb-8">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
            <Database className="h-4 w-4 text-emerald-600" />
          </div>
          <div>
            <p className="font-medium text-slate-900 dark:text-white text-sm">Discover Fields</p>
            <p className="text-xs text-slate-500">Find all available RDB and custom fields</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0">
            <Search className="h-4 w-4 text-amber-600" />
          </div>
          <div>
            <p className="font-medium text-slate-900 dark:text-white text-sm">Analyze Data</p>
            <p className="text-xs text-slate-500">Check field population from sample loans</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0">
            <Zap className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <p className="font-medium text-slate-900 dark:text-white text-sm">Smart Suggestions</p>
            <p className="text-xs text-slate-500">Get confidence-scored mapping recommendations</p>
          </div>
        </div>
      </div>
      <Button onClick={handleStartDiscovery} size="lg">
        Start Analysis
        <ArrowRight className="h-4 w-4 ml-2" />
      </Button>
    </div>
  );

  const renderDiscoveryStep = () => (
    <div className="text-center py-8">
      <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto mb-4" />
      <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
        Discovering Fields...
      </h3>
      <p className="text-slate-600 dark:text-slate-400 mb-4">
        Connecting to your Encompass instance and fetching field definitions
      </p>
      <Progress value={progress} className="max-w-xs mx-auto" />
    </div>
  );

  const renderAnalysisStep = () => (
    <div className="text-center py-8">
      <Loader2 className="h-12 w-12 animate-spin text-amber-600 mx-auto mb-4" />
      <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
        Analyzing Fields...
      </h3>
      <p className="text-slate-600 dark:text-slate-400 mb-4">
        Fetching sample loans and calculating field population rates
      </p>
      <Progress value={progress} className="max-w-xs mx-auto" />
      {discoveryResult && (
        <p className="text-sm text-slate-500 mt-4">
          Found {discoveryResult.rdbFieldCount} RDB fields, {discoveryResult.customFieldCount} custom fields
        </p>
      )}
    </div>
  );

  const renderReviewStep = () => (
    <div className="space-y-4">
      {/* Summary Stats */}
      {suggestionsResult && (
        <div className="flex flex-wrap gap-3 mb-4">
          <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {suggestionsResult.highConfidenceCount} High Confidence
          </Badge>
          <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-0">
            <TrendingUp className="h-3 w-3 mr-1" />
            {suggestionsResult.mediumConfidenceCount} Medium
          </Badge>
          <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 border-0">
            <AlertTriangle className="h-3 w-3 mr-1" />
            {suggestionsResult.lowConfidenceCount} Low
          </Badge>
        </div>
      )}

      {/* Quick Select */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Button variant="outline" size="sm" onClick={() => handleSelectByConfidence('high')}>
          Select High
        </Button>
        <Button variant="outline" size="sm" onClick={() => handleSelectByConfidence('medium')}>
          Select Medium
        </Button>
        <Button variant="outline" size="sm" onClick={() => handleSelectByConfidence('all')}>
          Select All
        </Button>
        <Button variant="outline" size="sm" onClick={() => handleSelectByConfidence('none')}>
          Clear
        </Button>
      </div>

      {/* Suggestions Table */}
      <div className="border rounded-lg overflow-hidden max-h-[350px] overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">
                <input
                  type="checkbox"
                  checked={selectedSuggestions.size > 0}
                  onChange={(e) => handleSelectByConfidence(e.target.checked ? 'all' : 'none')}
                  className="h-4 w-4 rounded"
                />
              </TableHead>
              <TableHead>Field</TableHead>
              <TableHead>Suggestion</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead>Population</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {suggestionsResult?.suggestions
              .filter(s => s.suggestedFieldId && s.confidenceLevel !== 'none')
              .slice(0, 100)
              .map((suggestion) => (
                <TableRow 
                  key={suggestion.coheusAlias}
                  className={cn(
                    "cursor-pointer",
                    selectedSuggestions.has(suggestion.coheusAlias) && "bg-blue-50 dark:bg-blue-900/20"
                  )}
                  onClick={() => handleToggleSuggestion(suggestion.coheusAlias)}
                >
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selectedSuggestions.has(suggestion.coheusAlias)}
                      onChange={() => handleToggleSuggestion(suggestion.coheusAlias)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 rounded"
                    />
                  </TableCell>
                  <TableCell className="font-medium text-sm">{suggestion.coheusAlias}</TableCell>
                  <TableCell className="font-mono text-xs">{suggestion.suggestedFieldId}</TableCell>
                  <TableCell>{getConfidenceBadge(suggestion.confidenceLevel, suggestion.confidence)}</TableCell>
                  <TableCell>
                    {suggestion.populationRate !== undefined ? (
                      <span className="text-xs">{suggestion.populationRate}%</span>
                    ) : '-'}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-sm text-slate-500">
        {selectedSuggestions.size} mapping{selectedSuggestions.size !== 1 ? 's' : ''} selected
      </p>
    </div>
  );

  const renderCompleteStep = () => (
    <div className="text-center py-8">
      <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/40 rounded-full flex items-center justify-center mx-auto mb-6">
        <FileCheck className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
      </div>
      <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
        Setup Complete!
      </h3>
      <p className="text-slate-600 dark:text-slate-400 mb-6">
        {appliedCount > 0 
          ? `Successfully applied ${appliedCount} field mappings to your configuration.`
          : 'Field mapping setup is complete. You can manually adjust mappings anytime.'}
      </p>
      <Button onClick={onComplete} size="lg">
        <Check className="h-4 w-4 mr-2" />
        Done
      </Button>
    </div>
  );

  const renderError = () => (
    <div className="text-center py-8">
      <div className="w-16 h-16 bg-red-100 dark:bg-red-900/40 rounded-full flex items-center justify-center mx-auto mb-6">
        <XCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
      </div>
      <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
        Analysis Failed
      </h3>
      <p className="text-slate-600 dark:text-slate-400 mb-6">
        {error || 'An unexpected error occurred. Please try again.'}
      </p>
      <div className="flex gap-3 justify-center">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => { setError(null); setCurrentStep('welcome'); }}>
          Try Again
        </Button>
      </div>
    </div>
  );

  return (
    <Card className="w-full max-w-3xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-blue-600" />
          Field Mapping Wizard
        </CardTitle>
        <CardDescription>
          {connectionName ? `Configure field mappings for ${connectionName}` : 'Configure field mappings for your LOS connection'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? renderError() : (
          <>
            {currentStep === 'welcome' && renderWelcomeStep()}
            {currentStep === 'discovery' && renderDiscoveryStep()}
            {currentStep === 'analysis' && renderAnalysisStep()}
            {currentStep === 'review' && renderReviewStep()}
            {currentStep === 'complete' && renderCompleteStep()}
          </>
        )}
      </CardContent>
      {currentStep === 'review' && !error && (
        <CardFooter className="flex justify-between">
          <Button variant="outline" onClick={onCancel}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <Button onClick={handleApplyMappings} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Applying...
              </>
            ) : selectedSuggestions.size > 0 ? (
              <>
                Apply {selectedSuggestions.size} Mappings
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            ) : (
              <>
                Skip & Finish
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

// Dialog wrapper for modal usage
interface FieldMappingWizardDialogProps extends FieldMappingWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FieldMappingWizardDialog({
  open,
  onOpenChange,
  ...props
}: FieldMappingWizardDialogProps) {
  const handleComplete = () => {
    props.onComplete?.();
    onOpenChange(false);
  };

  const handleCancel = () => {
    props.onCancel?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden">
        <FieldMappingWizard
          {...props}
          onComplete={handleComplete}
          onCancel={handleCancel}
        />
      </DialogContent>
    </Dialog>
  );
}
