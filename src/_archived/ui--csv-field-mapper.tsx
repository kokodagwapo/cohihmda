import * as React from 'react';
import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { ArrowRight, Check, Edit2, Save, X, ChevronDown } from 'lucide-react';
import { LOS_FIELD_LIBRARY, findFieldByAlias, createFieldMapping, type LOSField } from '@/lib/losFieldLibrary';
import { api } from '@/lib/api';

interface CSVFieldMapperProps {
  csvColumns: string[];
  systemFields?: SystemField[];
  onMappingChange: (mapping: Record<string, string>) => void;
  initialMapping?: Record<string, string>;
  className?: string;
}

export interface SystemField {
  id: string;
  label: string;
  required?: boolean;
  description?: string;
  category?: string;
}

// Get system fields from LOS field library - now returns ALL fields
const getSystemFieldsFromLibrary = (): SystemField[] => {
  // Return all fields from library, sorted by category and display name
  return LOS_FIELD_LIBRARY
    .sort((a, b) => {
      // Sort by category first, then by display name
      if (a.category !== b.category) {
        const categoryOrder: Record<string, number> = {
          'basic': 1,
          'borrower': 2,
          'property': 3,
          'financial': 4,
          'underwriting': 5,
          'closing': 6,
          'servicing': 7,
          'metadata': 8,
        };
        return (categoryOrder[a.category] || 99) - (categoryOrder[b.category] || 99);
      }
      return a.displayName.localeCompare(b.displayName);
    })
    .map(field => ({
      id: field.sourceKey,
      label: field.displayName,
      required: field.required,
      description: field.description,
      category: field.category,
    }));
};

export function CSVFieldMapper({
  csvColumns,
  systemFields = getSystemFieldsFromLibrary(),
  onMappingChange,
  initialMapping = {},
  className,
}: CSVFieldMapperProps) {
  const [mapping, setMapping] = useState<Record<string, string>>(initialMapping);
  const [customDisplayNames, setCustomDisplayNames] = useState<Record<string, string>>({});
  const [editingField, setEditingField] = useState<string | null>(null);
  const [suggestedMappings, setSuggestedMappings] = useState<Record<string, string>>({});
  const [openDropdowns, setOpenDropdowns] = useState<Record<string, boolean>>({});
  const [searchQueries, setSearchQueries] = useState<Record<string, string>>({});

  // Auto-suggest mappings when CSV columns change
  useEffect(() => {
    const suggestMappings = async () => {
      try {
        const response = await api.request<{ suggestions: Record<string, string> }>('/api/field-mappings/suggest', {
          method: 'POST',
          body: JSON.stringify({ csvHeaders: csvColumns }),
        });
        setSuggestedMappings(response.suggestions);
        
        // Auto-apply ALL suggested mappings automatically
        const autoMapping = { ...mapping, ...response.suggestions };
        setMapping(autoMapping);
        onMappingChange(autoMapping);
      } catch (error) {
        console.warn('Failed to get suggested mappings:', error);
        // Fallback to library-based suggestions
        const libraryMappings = createFieldMapping(csvColumns);
        setSuggestedMappings(libraryMappings);
        // Auto-apply ALL library-based mappings automatically
        const autoMapping = { ...mapping, ...libraryMappings };
        setMapping(autoMapping);
        onMappingChange(autoMapping);
      }
    };

    if (csvColumns.length > 0) {
      suggestMappings();
    }
  }, [csvColumns]);

  useEffect(() => {
    onMappingChange(mapping);
  }, [mapping, onMappingChange]);

  const handleMappingChange = (systemFieldId: string, csvColumn: string) => {
    setMapping(prev => {
      const newMapping = { ...prev };
      
      // Remove previous mapping for this system field
      Object.keys(newMapping).forEach(key => {
        if (newMapping[key] === systemFieldId) {
          delete newMapping[key];
        }
      });
      
      // Add new mapping
      if (csvColumn && csvColumn !== 'none') {
        newMapping[csvColumn] = systemFieldId;
      }
      
      return newMapping;
    });
  };

  const getMappedColumn = (systemFieldId: string): string => {
    return Object.keys(mapping).find(key => mapping[key] === systemFieldId) || 'none';
  };

  const getDisplayName = (fieldId: string): string => {
    if (customDisplayNames[fieldId]) {
      return customDisplayNames[fieldId];
    }
    const field = systemFields.find(f => f.id === fieldId);
    return field?.label || fieldId;
  };

  const handleCustomDisplayName = (fieldId: string, displayName: string) => {
    setCustomDisplayNames(prev => ({
      ...prev,
      [fieldId]: displayName,
    }));
  };

  const saveCustomDisplayName = async (fieldId: string) => {
    try {
      await api.request('/api/field-mappings', {
        method: 'POST',
        body: JSON.stringify({
          fieldMappings: mapping,
          customDisplayNames: customDisplayNames,
        }),
      });
      setEditingField(null);
    } catch (error) {
      console.error('Failed to save custom display name:', error);
    }
  };

  return (
    <div className={className}>
      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
        <CardHeader>
          <CardTitle className="text-sm font-light text-slate-900 dark:text-white">
            Map CSV Columns to System Fields
          </CardTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-light mt-1">
            Match your CSV column names to the system fields. You can customize field display names while preserving the original source.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {systemFields.map((field) => {
            const mappedColumn = getMappedColumn(field.id);
            const isSuggested = suggestedMappings[mappedColumn] === field.id;
            
            return (
              <div key={field.id} className="flex items-center gap-4 p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {editingField === field.id ? (
                      <div className="flex items-center gap-2 flex-1">
                        <Input
                          value={customDisplayNames[field.id] || field.label}
                          onChange={(e) => handleCustomDisplayName(field.id, e.target.value)}
                          className="font-light text-sm h-7"
                          placeholder={field.label}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => {
                            saveCustomDisplayName(field.id);
                          }}
                        >
                          <Save className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => {
                            setEditingField(null);
                            setCustomDisplayNames(prev => {
                              const updated = { ...prev };
                              delete updated[field.id];
                              return updated;
                            });
                          }}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Label className="text-sm font-light text-slate-900 dark:text-white">
                          {getDisplayName(field.id)}
                          {field.required && <span className="text-red-500 ml-1">*</span>}
                        </Label>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          onClick={() => setEditingField(field.id)}
                          title="Customize display name"
                        >
                          <Edit2 className="h-3 w-3 text-slate-400" />
                        </Button>
                      </>
                    )}
                  </div>
                  {field.description && (
                    <p className="text-xs text-slate-500 dark:text-slate-500 font-light">
                      {field.description}
                    </p>
                  )}
                  {mappedColumn !== 'none' && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 font-light mt-1">
                      Source: <span className="font-mono">{mappedColumn}</span>
                      {isSuggested && (
                        <span className="ml-2 text-emerald-600 dark:text-emerald-400">(Auto-detected)</span>
                      )}
                    </p>
                  )}
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <Popover
                    open={openDropdowns[field.id] || false}
                    onOpenChange={(open) => setOpenDropdowns(prev => ({ ...prev, [field.id]: open }))}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        className="w-full justify-between font-light"
                      >
                        <span className="truncate">
                          {mappedColumn === 'none' 
                            ? 'Select source field...' 
                            : mappedColumn}
                        </span>
                        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[400px] p-0" align="start">
                      <Command>
                        <CommandInput 
                          placeholder="Search fields..." 
                          value={searchQueries[field.id] || ''}
                          onValueChange={(value) => setSearchQueries(prev => ({ ...prev, [field.id]: value }))}
                        />
                        <CommandList>
                          <CommandEmpty>No fields found.</CommandEmpty>
                          <CommandGroup heading="Not Mapped">
                            <CommandItem
                              value="none"
                              onSelect={() => {
                                handleMappingChange(field.id, 'none');
                                setOpenDropdowns(prev => ({ ...prev, [field.id]: false }));
                              }}
                            >
                              <Check
                                className={`mr-2 h-4 w-4 ${mappedColumn === 'none' ? 'opacity-100' : 'opacity-0'}`}
                              />
                              <span className="text-slate-400">-- Not mapped --</span>
                            </CommandItem>
                          </CommandGroup>
                          <CommandGroup heading="CSV Columns">
                            {csvColumns
                              .filter(column => {
                                const query = (searchQueries[field.id] || '').toLowerCase();
                                return !query || column.toLowerCase().includes(query);
                              })
                              .map((column) => {
                                const isSuggestedForThis = suggestedMappings[column] === field.id;
                                return (
                                  <CommandItem
                                    key={column}
                                    value={column}
                                    onSelect={() => {
                                      handleMappingChange(field.id, column);
                                      setOpenDropdowns(prev => ({ ...prev, [field.id]: false }));
                                    }}
                                  >
                                    <Check
                                      className={`mr-2 h-4 w-4 ${mappedColumn === column ? 'opacity-100' : 'opacity-0'}`}
                                    />
                                    <div className="flex items-center gap-2">
                                      <span>{column}</span>
                                      {isSuggestedForThis && (
                                        <span className="text-xs text-emerald-600 dark:text-emerald-400">(Suggested)</span>
                                      )}
                                    </div>
                                  </CommandItem>
                                );
                              })}
                          </CommandGroup>
                          <CommandGroup heading="Encompass ICE Fields">
                            {LOS_FIELD_LIBRARY
                              .filter(libField => {
                                const query = (searchQueries[field.id] || '').toLowerCase();
                                if (!query) return true;
                                const searchText = `${libField.displayName} ${libField.encompassFieldId || ''} ${libField.sourceKey} ${libField.aliases?.join(' ') || ''}`.toLowerCase();
                                return searchText.includes(query);
                              })
                              .map((libField) => {
                                // Create display value with Encompass field ID if available
                                const fieldValue = libField.encompassFieldId 
                                  ? `${libField.displayName} (${libField.encompassFieldId})`
                                  : libField.displayName;
                                const fieldKey = libField.encompassFieldId || libField.sourceKey;
                                const isSelected = mappedColumn === fieldKey || mappedColumn === libField.sourceKey;
                                return (
                                  <CommandItem
                                    key={libField.sourceKey}
                                    value={fieldKey}
                                    onSelect={() => {
                                      handleMappingChange(field.id, fieldKey);
                                      setOpenDropdowns(prev => ({ ...prev, [field.id]: false }));
                                    }}
                                  >
                                    <Check
                                      className={`mr-2 h-4 w-4 ${isSelected ? 'opacity-100' : 'opacity-0'}`}
                                    />
                                    <div className="flex flex-col">
                                      <span>{fieldValue}</span>
                                      {libField.description && (
                                        <span className="text-xs text-slate-500">{libField.description}</span>
                                      )}
                                    </div>
                                  </CommandItem>
                                );
                              })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                {mappedColumn !== 'none' && (
                  <Check className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
