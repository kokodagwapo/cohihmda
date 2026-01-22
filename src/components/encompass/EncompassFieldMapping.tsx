/**
 * Encompass Field Mapping Component
 * UI for managing client-specific Encompass field ID mappings (field swaps)
 */

import * as React from 'react';
import { useState, useEffect } from 'react';
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
import { Trash2, Plus, Edit2, Search, AlertCircle, CheckCircle2, XCircle, Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

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
        <CardTitle>Encompass Field Mapping</CardTitle>
        <CardDescription>
          Configure client-specific Encompass field IDs for Coheus aliases. Use this when your
          Encompass instance uses different field IDs than the default mapping.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
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
