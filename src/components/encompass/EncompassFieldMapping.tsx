/**
 * Encompass Field Mapping Component
 * UI for managing client-specific Encompass field ID mappings (field swaps)
 * Enhanced with auto-discovery, smart suggestions, and bulk actions
 */

import * as React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Command as CommandPrimitive } from 'cmdk';
import { Progress } from '@/components/ui/progress';
import { 
  Trash2, 
  Edit2, 
  Search, 
  CheckCircle2, 
  XCircle, 
  Check, 
  ChevronsUpDown,
  Sparkles,
  Loader2,
  Zap,
  TrendingUp,
  AlertTriangle,
  HelpCircle,
  RefreshCw
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

// Types for auto-mapping suggestions
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

interface SuggestionsResponse {
  success: boolean;
  suggestions: MappingSuggestion[];
  highConfidenceCount: number;
  mediumConfidenceCount: number;
  lowConfidenceCount: number;
  unmappedCount: number;
  generatedAt: string;
}

interface FieldMapping {
  coheusAlias: string;
  defaultEncompassFieldId: string;
  postgresqlColumn: string;
  isValid?: boolean; // Whether default field ID exists in RDB
  swappedFieldId?: string; // Current swapped field ID if exists
}

interface FieldSwap {
  coheusAlias: string;
  encompassFieldId: string;
}

interface EncompassRdbField {
  fieldID: string;
  description: string;
  fieldType: number;
  format?: string;
}

interface EncompassFieldMappingProps {
  losConnectionId: string;
  tenantId?: string;
  onMappingChange?: () => void;
}

export function EncompassFieldMapping({
  losConnectionId,
  tenantId,
  onMappingChange,
}: EncompassFieldMappingProps) {
  const { toast } = useToast();
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [rdbFields, setRdbFields] = useState<EncompassRdbField[]>([]);
  const [swaps, setSwaps] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAlias, setEditingAlias] = useState<string | null>(null);
  const [newFieldId, setNewFieldId] = useState('');
  const [fieldSearchQuery, setFieldSearchQuery] = useState(''); // Separate search for RDB field dropdown
  const [fieldPopoverOpen, setFieldPopoverOpen] = useState(false);
  const commandInputRef = React.useRef<React.ElementRef<typeof CommandPrimitive.Input>>(null);

  // Auto-discovery state
  const [suggestions, setSuggestions] = useState<MappingSuggestion[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const [isApplyingSuggestions, setIsApplyingSuggestions] = useState(false);
  const [suggestionStats, setSuggestionStats] = useState({
    highConfidenceCount: 0,
    mediumConfidenceCount: 0,
    lowConfidenceCount: 0,
    unmappedCount: 0,
  });

  // Load field mappings and swaps
  useEffect(() => {
    if (losConnectionId && tenantId) {
      loadData();
    }
  }, [losConnectionId, tenantId]);

  // Focus the input when popover opens
  useEffect(() => {
    if (fieldPopoverOpen) {
      // Focus the command input after popover opens
      const timer = setTimeout(() => {
        const input = document.querySelector('[cmdk-input]') as HTMLInputElement;
        if (input) {
          input.focus();
          input.select();
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [fieldPopoverOpen]);

  const loadData = async () => {
    try {
      setLoading(true);
      
      if (!tenantId) {
        console.error('[EncompassFieldMapping] Tenant ID is missing');
        toast({
          title: 'Error',
          description: 'Tenant ID is required to load field mappings',
          variant: 'destructive',
        });
        setLoading(false);
        return;
      }

      if (!losConnectionId) {
        console.error('[EncompassFieldMapping] Connection ID is missing');
        toast({
          title: 'Error',
          description: 'Connection ID is required to load field mappings',
          variant: 'destructive',
        });
        setLoading(false);
        return;
      }

      console.log('[EncompassFieldMapping] Loading field mappings:', { losConnectionId, tenantId });

      // Load field mappings (from XML) - this should always work
      console.log('[EncompassFieldMapping] Step 1: Loading field mappings from XML...');
      const mappingsResponse = await api.request<{ mappings: FieldMapping[] }>('/api/encompass/field-mappings');
      console.log('[EncompassFieldMapping] Step 1 complete: Loaded', mappingsResponse.mappings?.length || 0, 'mappings');

      // Load saved field swaps - this should always work (just returns empty array if none)
      console.log('[EncompassFieldMapping] Step 2: Loading saved field swaps...');
      const swapsResponse = await api.request<{ swaps: FieldSwap[] }>(
        `/api/encompass/field-swaps/${losConnectionId}?tenant_id=${tenantId}`
      );
      console.log('[EncompassFieldMapping] Step 2 complete: Loaded', swapsResponse.swaps?.length || 0, 'swaps');

      // Load RDB fields separately - this may fail if Encompass auth fails, but that's OK
      console.log('[EncompassFieldMapping] Step 3: Loading RDB fields from Encompass (optional for validation)...');
      let rdbFieldsResponse: { rdbFields: EncompassRdbField[]; warning?: string; error?: string };
      try {
        rdbFieldsResponse = await api.request<{ rdbFields: EncompassRdbField[]; warning?: string; error?: string }>(
          `/api/encompass/fields/${losConnectionId}?tenant_id=${tenantId}`
        );
        console.log('[EncompassFieldMapping] Step 3 complete: Loaded', rdbFieldsResponse.rdbFields?.length || 0, 'RDB fields');
      } catch (error: any) {
        // If RDB fields fetch fails, return empty array - UI will work without validation
        console.warn('[EncompassFieldMapping] Step 3 failed: Unable to fetch RDB fields:', error);
        rdbFieldsResponse = { rdbFields: [], warning: 'Unable to fetch RDB fields for validation' };
      }

      console.log('[EncompassFieldMapping] Loaded mappings:', mappingsResponse.mappings?.length || 0);
      console.log('[EncompassFieldMapping] Loaded swaps:', swapsResponse.swaps?.length || 0);
      console.log('[EncompassFieldMapping] Loaded RDB fields:', rdbFieldsResponse.rdbFields?.length || 0);

      // Show warning if RDB fields couldn't be loaded
      if (rdbFieldsResponse.warning || rdbFieldsResponse.error) {
        toast({
          title: 'Warning',
          description: rdbFieldsResponse.warning || rdbFieldsResponse.error || 'RDB fields unavailable - validation disabled',
          variant: 'default',
        });
      }

      // Store RDB fields for field selection
      setRdbFields(rdbFieldsResponse.rdbFields || []);

      // Build swaps map
      const swapsMap = new Map<string, string>();
      (swapsResponse.swaps || []).forEach((swap) => {
        swapsMap.set(swap.coheusAlias, swap.encompassFieldId);
      });
      setSwaps(swapsMap);

      // Validate each mapping against RDB fields
      setValidating(true);
      const rdbFieldIds = new Set((rdbFieldsResponse.rdbFields || []).map(f => f.fieldID));
      
      // Debug: Log some sample RDB field IDs to see the format
      if (rdbFieldIds.size > 0) {
        const sampleIds = Array.from(rdbFieldIds).slice(0, 5);
        console.log('[EncompassFieldMapping] Sample RDB field IDs:', sampleIds);
      }
      
      // Debug: Log some sample default field IDs
      const sampleDefaults = (mappingsResponse.mappings || []).slice(0, 5).map(m => m.defaultEncompassFieldId);
      console.log('[EncompassFieldMapping] Sample default field IDs:', sampleDefaults);
      
      const mappingsArray = mappingsResponse.mappings || [];
      let debugCount = 0; // Track how many debug logs we've printed
      
      const validatedMappings = mappingsArray.map((mapping, index) => {
        const swappedFieldId = swapsMap.get(mapping.coheusAlias);
        const effectiveFieldId = swappedFieldId || mapping.defaultEncompassFieldId;
        
        // Check if the effective field ID exists in RDB
        // RDB fields might be in format "3142" or "Fields.3142", so try multiple formats
        const normalizedFieldId = effectiveFieldId.replace(/^Fields\./, '');
        const withFieldsPrefix = effectiveFieldId.startsWith('Fields.') ? effectiveFieldId : `Fields.${effectiveFieldId}`;
        
        const isValid = rdbFieldIds.has(effectiveFieldId) || 
                       rdbFieldIds.has(normalizedFieldId) ||
                       rdbFieldIds.has(withFieldsPrefix);
        
        // Debug first few failures to understand format mismatch
        if (!isValid && rdbFieldIds.size > 0 && debugCount < 5) {
          debugCount++;
          console.log(`[EncompassFieldMapping] Field "${mapping.coheusAlias}" validation:`, {
            defaultFieldId: mapping.defaultEncompassFieldId,
            effectiveFieldId,
            normalizedFieldId,
            withFieldsPrefix,
            exactMatch: rdbFieldIds.has(effectiveFieldId),
            normalizedMatch: rdbFieldIds.has(normalizedFieldId),
            withPrefixMatch: rdbFieldIds.has(withFieldsPrefix),
            sampleRdbIds: Array.from(rdbFieldIds).slice(0, 3),
          });
        }
        
        return {
          ...mapping,
          isValid,
          swappedFieldId: swappedFieldId || undefined,
        };
      });

      setMappings(validatedMappings);
      setValidating(false);
    } catch (error: any) {
      console.error('[EncompassFieldMapping] Error loading field mappings:', error);
      toast({
        title: 'Error',
        description: 'Failed to load field mappings',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSwap = async (alias: string, fieldId: string) => {
    try {
      if (!tenantId) {
        toast({
          title: 'Error',
          description: 'Tenant ID is required to save field mappings',
          variant: 'destructive',
        });
        return;
      }

      await api.request(`/api/encompass/field-swaps?tenant_id=${tenantId}`, {
        method: 'POST',
        body: JSON.stringify({
          losConnectionId,
          coheusAlias: alias,
          encompassFieldId: fieldId,
          swapType: 'Standard',
        }),
      });

      const newSwaps = new Map(swaps);
      newSwaps.set(alias, fieldId);
      setSwaps(newSwaps);

      toast({
        title: 'Success',
        description: 'Field swap saved successfully',
      });

      setIsDialogOpen(false);
      setEditingAlias(null);
      setNewFieldId('');
      onMappingChange?.();
    } catch (error: any) {
      console.error('Error saving field swap:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to save field swap',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteSwap = async (alias: string) => {
    try {
      if (!tenantId) {
        toast({
          title: 'Error',
          description: 'Tenant ID is required to delete field mappings',
          variant: 'destructive',
        });
        return;
      }

      await api.request(`/api/encompass/field-swaps/${losConnectionId}?tenant_id=${tenantId}`, {
        method: 'DELETE',
        body: JSON.stringify({
          coheusAlias: alias,
        }),
      });

      const newSwaps = new Map(swaps);
      newSwaps.delete(alias);
      setSwaps(newSwaps);

      toast({
        title: 'Success',
        description: 'Field swap deleted successfully',
      });

      onMappingChange?.();
    } catch (error: any) {
      console.error('Error deleting field swap:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete field swap',
        variant: 'destructive',
      });
    }
  };

  const openEditDialog = (alias: string, currentFieldId?: string) => {
    setEditingAlias(alias);
    setNewFieldId(currentFieldId || '');
    setFieldSearchQuery(''); // Reset search when opening dialog
    setFieldPopoverOpen(false); // Close popover when opening dialog
    setIsDialogOpen(true);
  };

  // ============================================================================
  // Auto-Discovery Handlers
  // ============================================================================

  const handleAnalyzeFields = useCallback(async () => {
    if (!tenantId || !losConnectionId) {
      toast({
        title: 'Error',
        description: 'Tenant ID and Connection ID are required',
        variant: 'destructive',
      });
      return;
    }

    setIsAnalyzing(true);
    setAnalyzeProgress(10);
    setShowSuggestions(false);
    setSuggestions([]);
    setSelectedSuggestions(new Set());

    try {
      // Show progress for discovery phase
      setAnalyzeProgress(30);
      
      // Call the suggestions API which does discovery + analysis + matching
      const response = await api.request<SuggestionsResponse>(
        `/api/encompass/discovery/suggestions/${losConnectionId}?tenant_id=${tenantId}&run_analysis=true&sample_size=50`
      );

      setAnalyzeProgress(90);

      if (response.success && response.suggestions) {
        setSuggestions(response.suggestions);
        setSuggestionStats({
          highConfidenceCount: response.highConfidenceCount,
          mediumConfidenceCount: response.mediumConfidenceCount,
          lowConfidenceCount: response.lowConfidenceCount,
          unmappedCount: response.unmappedCount,
        });
        
        // Auto-select high confidence suggestions that differ from current mapping
        const autoSelected = new Set<string>();
        response.suggestions.forEach(s => {
          if (s.confidenceLevel === 'high' && 
              s.suggestedFieldId && 
              s.suggestedFieldId !== s.defaultFieldId &&
              !s.isCurrentlyMapped) {
            autoSelected.add(s.coheusAlias);
          }
        });
        setSelectedSuggestions(autoSelected);
        setShowSuggestions(true);

        toast({
          title: 'Analysis Complete',
          description: `Found ${response.highConfidenceCount} high-confidence, ${response.mediumConfidenceCount} medium-confidence suggestions`,
        });
      }
    } catch (error: any) {
      console.error('[EncompassFieldMapping] Error analyzing fields:', error);
      toast({
        title: 'Analysis Failed',
        description: error.message || 'Failed to analyze fields',
        variant: 'destructive',
      });
    } finally {
      setAnalyzeProgress(100);
      setTimeout(() => {
        setIsAnalyzing(false);
        setAnalyzeProgress(0);
      }, 500);
    }
  }, [tenantId, losConnectionId, toast]);

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

  const handleSelectAllByConfidence = useCallback((level: 'high' | 'medium' | 'low' | 'all') => {
    const toSelect = suggestions.filter(s => {
      if (!s.suggestedFieldId) return false;
      if (level === 'all') return s.confidenceLevel !== 'none';
      return s.confidenceLevel === level;
    });
    
    setSelectedSuggestions(new Set(toSelect.map(s => s.coheusAlias)));
  }, [suggestions]);

  const handleApplySelectedSuggestions = useCallback(async () => {
    if (selectedSuggestions.size === 0) {
      toast({
        title: 'No Suggestions Selected',
        description: 'Please select at least one suggestion to apply',
        variant: 'default',
      });
      return;
    }

    if (!tenantId || !losConnectionId) {
      toast({
        title: 'Error',
        description: 'Tenant ID and Connection ID are required',
        variant: 'destructive',
      });
      return;
    }

    setIsApplyingSuggestions(true);

    try {
      const suggestionsToApply = suggestions
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
        toast({
          title: 'Mappings Applied',
          description: `Successfully applied ${response.applied} field mappings`,
        });
        
        // Refresh the data
        setShowSuggestions(false);
        setSelectedSuggestions(new Set());
        await loadData();
        onMappingChange?.();
      }

      if (response.errors && response.errors.length > 0) {
        console.warn('[EncompassFieldMapping] Some mappings failed:', response.errors);
      }
    } catch (error: any) {
      console.error('[EncompassFieldMapping] Error applying suggestions:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to apply suggestions',
        variant: 'destructive',
      });
    } finally {
      setIsApplyingSuggestions(false);
    }
  }, [selectedSuggestions, suggestions, tenantId, losConnectionId, toast, onMappingChange]);

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
          <Badge variant="secondary" className="text-slate-500">
            <HelpCircle className="h-3 w-3 mr-1" />
            N/A
          </Badge>
        );
    }
  };

  const filteredMappings = mappings.filter(
    (mapping) =>
      mapping.coheusAlias.toLowerCase().includes(searchQuery.toLowerCase()) ||
      mapping.defaultEncompassFieldId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      mapping.postgresqlColumn.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-slate-500">Loading field mappings...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Encompass Field Mapping</CardTitle>
            <CardDescription>
              Configure client-specific Encompass field IDs for Coheus aliases. Use this when your
              Encompass instance uses different field IDs than the default mapping.
            </CardDescription>
          </div>
          <Button
            onClick={handleAnalyzeFields}
            disabled={isAnalyzing || !tenantId || !losConnectionId}
            className="ml-4"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Auto-Analyze Fields
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Analysis Progress */}
          {isAnalyzing && (
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-center gap-2 mb-2">
                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                  Analyzing your Encompass fields...
                </span>
              </div>
              <Progress value={analyzeProgress} className="h-2" />
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">
                Discovering fields, fetching sample data, and generating smart suggestions
              </p>
            </div>
          )}

          {/* Suggestions Panel */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-amber-500" />
                  <span className="font-medium text-slate-900 dark:text-white">
                    Auto-Mapping Suggestions
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowSuggestions(false)}
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              </div>

              {/* Stats Summary */}
              <div className="flex flex-wrap gap-3 mb-4">
                <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  {suggestionStats.highConfidenceCount} High Confidence
                </Badge>
                <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-0">
                  <TrendingUp className="h-3 w-3 mr-1" />
                  {suggestionStats.mediumConfidenceCount} Medium
                </Badge>
                <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 border-0">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {suggestionStats.lowConfidenceCount} Low
                </Badge>
                <Badge variant="secondary">
                  <HelpCircle className="h-3 w-3 mr-1" />
                  {suggestionStats.unmappedCount} Unmapped
                </Badge>
              </div>

              {/* Quick Select Buttons */}
              <div className="flex flex-wrap gap-2 mb-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSelectAllByConfidence('high')}
                >
                  Select High Confidence
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSelectAllByConfidence('medium')}
                >
                  Select Medium
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSelectAllByConfidence('all')}
                >
                  Select All
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedSuggestions(new Set())}
                >
                  Clear Selection
                </Button>
              </div>

              {/* Suggestions Table */}
              <div className="border rounded-lg overflow-hidden mb-4 max-h-[300px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]">
                        <input
                          type="checkbox"
                          checked={selectedSuggestions.size > 0 && 
                            selectedSuggestions.size === suggestions.filter(s => s.suggestedFieldId).length}
                          onChange={(e) => {
                            if (e.target.checked) {
                              handleSelectAllByConfidence('all');
                            } else {
                              setSelectedSuggestions(new Set());
                            }
                          }}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                      </TableHead>
                      <TableHead>Coheus Alias</TableHead>
                      <TableHead>Suggested Field</TableHead>
                      <TableHead>Confidence</TableHead>
                      <TableHead>Population</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {suggestions
                      .filter(s => s.suggestedFieldId && s.confidenceLevel !== 'none')
                      .slice(0, 50)
                      .map((suggestion) => (
                        <TableRow 
                          key={suggestion.coheusAlias}
                          className={cn(
                            "cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800",
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
                              className="h-4 w-4 rounded border-slate-300"
                            />
                          </TableCell>
                          <TableCell className="font-medium text-sm">
                            {suggestion.coheusAlias}
                            {suggestion.isCurrentlyMapped && (
                              <Badge variant="outline" className="ml-2 text-xs">Mapped</Badge>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            <div>{suggestion.suggestedFieldId}</div>
                            {suggestion.suggestedFieldDescription && (
                              <div className="text-slate-500 truncate max-w-[200px]">
                                {suggestion.suggestedFieldDescription}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            {getConfidenceBadge(suggestion.confidenceLevel, suggestion.confidence)}
                          </TableCell>
                          <TableCell>
                            {suggestion.populationRate !== undefined ? (
                              <span className={cn(
                                "text-xs font-medium",
                                suggestion.populationRate > 50 ? "text-emerald-600" :
                                suggestion.populationRate > 0 ? "text-amber-600" : "text-slate-400"
                              )}>
                                {suggestion.populationRate}%
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-slate-500 max-w-[150px] truncate">
                            {suggestion.matchReason}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>

              {/* Apply Button */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">
                  {selectedSuggestions.size} suggestion{selectedSuggestions.size !== 1 ? 's' : ''} selected
                </span>
                <Button
                  onClick={handleApplySelectedSuggestions}
                  disabled={selectedSuggestions.size === 0 || isApplyingSuggestions}
                >
                  {isApplyingSuggestions ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Applying...
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      Apply Selected ({selectedSuggestions.size})
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search by alias, field ID, or column name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Field Mappings Table */}
          <div className="border rounded-lg overflow-hidden">
            <div className="w-full overflow-x-auto">
              <Table className="table-fixed w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[15%] min-w-[120px]">Coheus Alias</TableHead>
                    <TableHead className="w-[18%] min-w-[140px]">PostgreSQL Column</TableHead>
                    <TableHead className="w-[18%] min-w-[140px]">Default Field ID</TableHead>
                    <TableHead className="w-[12%] min-w-[90px]">Status</TableHead>
                    <TableHead className="w-[20%] min-w-[150px]">Current Field ID</TableHead>
                    <TableHead className="w-[17%] min-w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMappings.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-slate-500 py-8">
                        {validating ? 'Validating fields...' : 'No field mappings found'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredMappings.map((mapping) => {
                      const swappedFieldId = mapping.swappedFieldId;
                      const effectiveFieldId = swappedFieldId || mapping.defaultEncompassFieldId;
                      const isValid = mapping.isValid ?? false;
                      const isSwapped = !!swappedFieldId;

                      return (
                        <TableRow key={mapping.coheusAlias}>
                          <TableCell className="font-medium break-words" title={mapping.coheusAlias}>
                            <div className="break-words">{mapping.coheusAlias}</div>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-slate-500 break-words" title={mapping.postgresqlColumn}>
                            <div className="break-words">{mapping.postgresqlColumn}</div>
                          </TableCell>
                          <TableCell className="font-mono text-xs break-words" title={mapping.defaultEncompassFieldId}>
                            <div className="break-words">{mapping.defaultEncompassFieldId}</div>
                          </TableCell>
                          <TableCell>
                            {isValid ? (
                              <div className="flex items-center gap-1 flex-wrap">
                                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                                <span className="text-xs text-green-600">Valid</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 flex-wrap">
                                <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                                <span className="text-xs text-red-600">Not Found</span>
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            {isSwapped ? (
                              <div className="flex items-center gap-1 flex-wrap">
                                <Badge variant="secondary" className="font-mono text-xs break-words" title={swappedFieldId}>
                                  <span className="break-all">{swappedFieldId}</span>
                                </Badge>
                                <Badge variant="outline" className="text-xs shrink-0">Swapped</Badge>
                              </div>
                            ) : (
                              <span className="font-mono text-xs text-slate-500 break-words" title={effectiveFieldId}>
                                <div className="break-words">{effectiveFieldId}</div>
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1 flex-wrap">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 shrink-0"
                                onClick={() =>
                                  openEditDialog(
                                    mapping.coheusAlias,
                                    swappedFieldId || mapping.defaultEncompassFieldId
                                  )
                                }
                                title={isValid ? 'Change field mapping' : 'Select valid field'}
                              >
                                <Edit2 className={`h-4 w-4 ${!isValid ? 'text-amber-500' : ''}`} />
                              </Button>
                              {isSwapped && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0 shrink-0"
                                  onClick={() => handleDeleteSwap(mapping.coheusAlias)}
                                  title="Remove swap (use default)"
                                >
                                  <Trash2 className="h-4 w-4 text-red-500" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Edit Dialog */}
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingAlias ? 'Edit Field Mapping' : 'Add Field Mapping'}
                </DialogTitle>
                <DialogDescription>
                  {editingAlias && (
                    <>
                      Update the Encompass field ID for{' '}
                      <strong>{editingAlias}</strong>
                    </>
                  )}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                {editingAlias && (
                  <>
                    <div>
                      <Label>Coheus Alias</Label>
                      <Input value={editingAlias} disabled />
                    </div>
                    <div>
                      <Label>Default Encompass Field ID</Label>
                      <Input
                        value={
                          mappings.find((m) => m.coheusAlias === editingAlias)
                            ?.defaultEncompassFieldId || ''
                        }
                        disabled
                      />
                    </div>
                    <div>
                      <Label>Encompass Field ID</Label>
                      {rdbFields.length > 0 ? (
                        <Popover open={fieldPopoverOpen} onOpenChange={setFieldPopoverOpen} modal={false}>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              role="combobox"
                              aria-expanded={fieldPopoverOpen}
                              className="w-full justify-between"
                              type="button"
                            >
                              {newFieldId
                                ? rdbFields.find((field) => field.fieldID === newFieldId)?.fieldID || newFieldId
                                : 'Select a field from your RDB...'}
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent 
                            className="w-[462px] p-0 z-[9999]" 
                            align="start" 
                            side="bottom"
                            onOpenAutoFocus={(e) => {
                              e.preventDefault();
                              setTimeout(() => {
                                const input = document.querySelector('[cmdk-input]') as HTMLInputElement;
                                if (input) {
                                  input.focus();
                                }
                              }, 100);
                            }}
                          >
                              <Command shouldFilter={false}>
                                <CommandInput
                                  placeholder="Type to search..."
                                  value={fieldSearchQuery}
                                  onValueChange={setFieldSearchQuery}
                                />
                                <CommandList className="max-h-[400px]">
                                  <CommandEmpty>No matching fields found.</CommandEmpty>
                                  <CommandGroup>
                                    {rdbFields
                                      .filter((field) => {
                                        if (!fieldSearchQuery.trim()) return true;
                                        const searchLower = fieldSearchQuery.toLowerCase();
                                        return (
                                          field.fieldID.toLowerCase().includes(searchLower) ||
                                          field.description?.toLowerCase().includes(searchLower) ||
                                          field.fieldID.replace(/^Fields\./, '').includes(searchLower)
                                        );
                                      })
                                      .slice(0, 200)
                                      .map((field) => (
                                        <CommandItem
                                          key={field.fieldID}
                                          value={field.fieldID}
                                          onSelect={(currentValue) => {
                                            setNewFieldId(field.fieldID);
                                            setFieldPopoverOpen(false);
                                            setFieldSearchQuery('');
                                          }}
                                        >
                                          <Check
                                            className={cn(
                                              'mr-2 h-4 w-4',
                                              newFieldId === field.fieldID ? 'opacity-100' : 'opacity-0'
                                            )}
                                          />
                                          <div className="flex flex-col">
                                            <span className="font-mono text-xs font-semibold">{field.fieldID}</span>
                                            {field.description && (
                                              <span className="text-xs text-slate-500 truncate max-w-[300px]">
                                                {field.description}
                                              </span>
                                            )}
                                          </div>
                                        </CommandItem>
                                      ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                      ) : (
                        <Input
                          value={newFieldId}
                          onChange={(e) => setNewFieldId(e.target.value)}
                          placeholder="e.g., Fields.3142"
                        />
                      )}
                      {newFieldId && (
                        <div className="text-xs text-slate-600 mt-2 p-2 bg-slate-50 dark:bg-slate-800 rounded">
                          Selected: <span className="font-mono font-semibold">{newFieldId}</span>
                          {rdbFields.find((f) => f.fieldID === newFieldId)?.description && (
                            <div className="text-slate-500 mt-1">
                              {rdbFields.find((f) => f.fieldID === newFieldId)?.description}
                            </div>
                          )}
                        </div>
                      )}
                      <p className="text-xs text-slate-500 mt-1">
                        {rdbFields.length > 0
                          ? `Select from ${rdbFields.length} available RDB fields. Start typing to search and filter.`
                          : 'Enter the Encompass field ID used in your instance'}
                      </p>
                    </div>
                  </>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsDialogOpen(false);
                    setEditingAlias(null);
                    setNewFieldId('');
                    setFieldSearchQuery('');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (editingAlias && newFieldId) {
                      handleSaveSwap(editingAlias, newFieldId);
                    }
                  }}
                  disabled={!editingAlias || !newFieldId}
                >
                  Save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );
}
