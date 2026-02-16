/**
 * Additional Fields Tab
 * Manages client-defined additional loan fields that are dynamically added to the loans table
 * These fields are extracted from the LOS during sync and available for RAG/AI queries
 */

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus,
  MoreVertical,
  Pencil,
  Trash2,
  Database,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Search,
  ChevronsUpDown,
  X,
  RefreshCw,
} from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

// Types
interface AdditionalField {
  id: string;
  losConnectionId: string;
  losFieldId: string;
  columnName: string;
  displayName: string;
  dataType:
    | "string"
    | "number"
    | "date"
    | "boolean"
    | "currency"
    | "percentage";
  dbColumnType: string;
  category?: string;
  description?: string;
  isEnabled: boolean;
  includeInRag: boolean;
  sortOrder: number;
  columnCreated: boolean;
  createdAt: string;
  updatedAt: string;
}

interface DiscoveredField {
  fieldId: string;
  description: string;
  format?: string;
  fieldType?: number;
  isCustom: boolean;
  source: "rdb" | "custom";
}

interface AdditionalFieldsTabProps {
  losConnectionId: string;
  tenantId: string;
  onRefresh?: () => void;
}

const DATA_TYPES = [
  { value: "string", label: "Text", description: "Free-form text values" },
  {
    value: "number",
    label: "Number",
    description: "Numeric values with decimals",
  },
  { value: "date", label: "Date", description: "Date values (MM/DD/YYYY)" },
  {
    value: "boolean",
    label: "Yes/No",
    description: "True/false or Y/N values",
  },
  { value: "currency", label: "Currency", description: "Dollar amounts" },
  {
    value: "percentage",
    label: "Percentage",
    description: "Percentage values (rates, ratios)",
  },
] as const;

export function AdditionalFieldsTab({
  losConnectionId,
  tenantId,
  onRefresh,
}: AdditionalFieldsTabProps) {
  const { toast } = useToast();

  // State
  const [fields, setFields] = useState<AdditionalField[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedField, setSelectedField] = useState<AdditionalField | null>(
    null
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    exists: boolean;
    description?: string;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // RDB Field Discovery State
  const [discoveredFields, setDiscoveredFields] = useState<DiscoveredField[]>(
    []
  );
  const [isLoadingFields, setIsLoadingFields] = useState(false);
  const [fieldsError, setFieldsError] = useState<string | null>(null);
  const [fieldPickerOpen, setFieldPickerOpen] = useState(false);
  const [fieldSearchQuery, setFieldSearchQuery] = useState("");

  // Form state for add/edit
  const [formData, setFormData] = useState({
    losFieldId: "",
    displayName: "",
    dataType: "string" as AdditionalField["dataType"],
    description: "",
  });
  const [generatedColumnName, setGeneratedColumnName] = useState("");

  // Fetch fields
  const fetchFields = useCallback(async () => {
    // Don't fetch if no tenant is selected
    if (!tenantId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const data = await api.request<{ fields: AdditionalField[] }>(
        `/api/tenant-config/additional-fields?connection_id=${losConnectionId}&tenant_id=${tenantId}`
      );
      setFields(data.fields || []);
    } catch (error: any) {
      console.error("Error fetching additional fields:", error);
      toast({
        title: "Error",
        description: "Failed to load additional fields",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [losConnectionId, tenantId, toast]);

  useEffect(() => {
    fetchFields();
  }, [fetchFields]);

  // Fetch discovered fields from Encompass RDB
  const fetchDiscoveredFields = useCallback(async () => {
    setIsLoadingFields(true);
    setFieldsError(null);
    try {
      const data = await api.request<{
        success: boolean;
        discoveredFields: DiscoveredField[];
        rdbFieldCount: number;
        customFieldCount: number;
        warning?: string;
      }>(
        `/api/encompass/discovery/fields/${losConnectionId}?tenant_id=${tenantId}`
      );

      if (data.discoveredFields) {
        // Sort fields: custom fields first (CX.*), then by fieldId
        const sorted = [...data.discoveredFields].sort((a, b) => {
          // Put custom fields first
          if (a.isCustom !== b.isCustom) {
            return a.isCustom ? -1 : 1;
          }
          return a.fieldId.localeCompare(b.fieldId);
        });
        setDiscoveredFields(sorted);
      }

      if (data.warning) {
        setFieldsError(data.warning);
      }
    } catch (error: any) {
      console.error("Error fetching discovered fields:", error);
      setFieldsError(error.message || "Failed to fetch fields from Encompass");
    } finally {
      setIsLoadingFields(false);
    }
  }, [losConnectionId, tenantId]);

  // Load discovered fields when add dialog opens
  useEffect(() => {
    if (isAddDialogOpen && discoveredFields.length === 0 && !isLoadingFields) {
      fetchDiscoveredFields();
    }
  }, [
    isAddDialogOpen,
    discoveredFields.length,
    isLoadingFields,
    fetchDiscoveredFields,
  ]);

  // Focus the command input when field picker opens
  useEffect(() => {
    if (fieldPickerOpen) {
      const timer = setTimeout(() => {
        const input = document.querySelector(
          "[cmdk-input]"
        ) as HTMLInputElement;
        if (input) {
          input.focus();
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [fieldPickerOpen]);

  // Generate column name preview
  const generateColumnName = async (displayName: string) => {
    if (!displayName.trim()) {
      setGeneratedColumnName("");
      return;
    }

    try {
      const tenantParam = tenantId ? `?tenant_id=${tenantId}` : "";
      const data = await api.request<{ columnName: string }>(
        `/api/tenant-config/additional-fields/generate-column-name${tenantParam}`,
        {
          method: "POST",
          body: JSON.stringify({ displayName }),
        }
      );
      setGeneratedColumnName(data.columnName);
    } catch (error) {
      // Ignore errors for preview
    }
  };

  // Validate field exists in LOS
  const validateField = async (losFieldId: string) => {
    if (!losFieldId.trim()) {
      setValidationResult(null);
      return;
    }

    setIsValidating(true);
    try {
      const tenantParam = tenantId ? `?tenant_id=${tenantId}` : "";
      const data = await api.request<{ exists: boolean; description?: string }>(
        `/api/tenant-config/additional-fields/validate${tenantParam}`,
        {
          method: "POST",
          body: JSON.stringify({ losConnectionId, losFieldId }),
        }
      );
      setValidationResult(data);
    } catch (error) {
      setValidationResult(null);
    } finally {
      setIsValidating(false);
    }
  };

  // Infer data type from field format and fieldType
  const inferDataType = (
    field: DiscoveredField
  ): AdditionalField["dataType"] => {
    // Check format string first (most reliable)
    if (field.format) {
      const f = field.format.toUpperCase();
      if (f.includes("DATE") || f.includes("TIME")) return "date";
      if (f.includes("YN") || f === "X") return "boolean";
      if (f.includes("DECIMAL") || f === "NUMERIC") return "number";
      if (f.includes("INTEGER") || f === "INT") return "number";
      if (f.includes("CURRENCY") || f.includes("$") || f.includes("MONEY"))
        return "currency";
      if (f.includes("PERCENT") || f.includes("%") || f.includes("RATE"))
        return "percentage";
    }

    // Check fieldType number (Encompass field type codes)
    // 0 = String, 1 = Decimal, 2 = Date, 3 = YN (boolean), 4 = Integer
    if (field.fieldType !== undefined) {
      switch (field.fieldType) {
        case 1:
          return "number"; // Decimal
        case 2:
          return "date";
        case 3:
          return "boolean"; // YN
        case 4:
          return "number"; // Integer
      }
    }

    // Check description for hints (last resort)
    if (field.description) {
      const desc = field.description.toLowerCase();
      if (desc.includes("date") || desc.includes("time")) return "date";
      if (
        desc.includes("amount") ||
        desc.includes("balance") ||
        desc.includes("payment")
      )
        return "currency";
      if (
        desc.includes("rate") ||
        desc.includes("percent") ||
        desc.includes("ratio")
      )
        return "percentage";
      if (
        desc.includes("count") ||
        desc.includes("number") ||
        desc.includes("score")
      )
        return "number";
    }

    return "string";
  };

  // Handle selecting a field from the picker
  const handleSelectDiscoveredField = (field: DiscoveredField) => {
    const detectedType = inferDataType(field);
    setFormData((prev) => ({
      ...prev,
      losFieldId: field.fieldId,
      displayName: field.description || field.fieldId,
      dataType: detectedType,
    }));
    generateColumnName(field.description || field.fieldId);
    setValidationResult({ exists: true, description: field.description });
    setFieldPickerOpen(false);
    setFieldSearchQuery("");
  };

  // Filter discovered fields by search
  const filteredDiscoveredFields = discoveredFields.filter((field) => {
    if (!fieldSearchQuery.trim()) return true;
    const query = fieldSearchQuery.toLowerCase();
    return (
      field.fieldId.toLowerCase().includes(query) ||
      (field.description && field.description.toLowerCase().includes(query))
    );
  });

  // Handle form input changes
  const handleInputChange = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));

    if (field === "displayName") {
      generateColumnName(value);
    }

    if (field === "losFieldId") {
      setValidationResult(null);
    }
  };

  // Reset form
  const resetForm = () => {
    setFormData({
      losFieldId: "",
      displayName: "",
      dataType: "string",
      description: "",
    });
    setGeneratedColumnName("");
    setValidationResult(null);
    setFieldSearchQuery("");
    setFieldPickerOpen(false);
  };

  // Add new field
  const handleAddField = async () => {
    if (!formData.losFieldId.trim() || !formData.displayName.trim()) {
      toast({
        title: "Validation Error",
        description: "LOS Field ID and Display Name are required",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const tenantParam = tenantId ? `?tenant_id=${tenantId}` : "";
      const response = await api.request<{
        field: AdditionalField;
        message?: string;
        requiresSync?: boolean;
      }>(`/api/tenant-config/additional-fields${tenantParam}`, {
        method: "POST",
        body: JSON.stringify({
          losConnectionId,
          losFieldId: formData.losFieldId,
          displayName: formData.displayName,
          dataType: formData.dataType,
          description: formData.description || null,
          includeInRag: true, // Always include in RAG
        }),
      });

      toast({
        title: "Field Added",
        description:
          response.message ||
          "Additional field created successfully. Run a data sync to populate this field for existing loans.",
        duration: 6000,
      });

      setIsAddDialogOpen(false);
      resetForm();
      fetchFields();
      onRefresh?.();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to add field",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Update field
  const handleUpdateField = async () => {
    if (!selectedField) return;

    setIsSaving(true);
    try {
      const tenantParam = tenantId ? `?tenant_id=${tenantId}` : "";
      await api.request<{ field: AdditionalField }>(
        `/api/tenant-config/additional-fields/${selectedField.id}${tenantParam}`,
        {
          method: "PUT",
          body: JSON.stringify({
            displayName: formData.displayName,
            description: formData.description || null,
          }),
        }
      );

      toast({
        title: "Success",
        description: "Field updated successfully",
      });

      setIsEditDialogOpen(false);
      setSelectedField(null);
      resetForm();
      fetchFields();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update field",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Toggle field enabled state
  const handleToggleEnabled = async (field: AdditionalField) => {
    try {
      const tenantParam = tenantId ? `?tenant_id=${tenantId}` : "";
      await api.request<{ field: AdditionalField }>(
        `/api/tenant-config/additional-fields/${field.id}${tenantParam}`,
        {
          method: "PUT",
          body: JSON.stringify({ isEnabled: !field.isEnabled }),
        }
      );

      toast({
        title: "Success",
        description: `Field ${field.isEnabled ? "disabled" : "enabled"}`,
      });

      fetchFields();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to toggle field",
        variant: "destructive",
      });
    }
  };

  // Delete field
  const handleDeleteField = async () => {
    if (!selectedField) return;

    setIsSaving(true);
    try {
      const tenantParam = tenantId ? `?tenant_id=${tenantId}` : "";
      await api.request<{ success: boolean }>(
        `/api/tenant-config/additional-fields/${selectedField.id}${tenantParam}`,
        { method: "DELETE" }
      );

      toast({
        title: "Success",
        description:
          "Field deleted successfully. The column has been removed from the database.",
      });

      setIsDeleteDialogOpen(false);
      setSelectedField(null);
      fetchFields();
      onRefresh?.();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete field",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Open edit dialog
  const openEditDialog = (field: AdditionalField) => {
    setSelectedField(field);
    setFormData({
      losFieldId: field.losFieldId,
      displayName: field.displayName,
      dataType: field.dataType,
      description: field.description || "",
    });
    setGeneratedColumnName(field.columnName);
    setIsEditDialogOpen(true);
  };

  // Filter fields by search
  const filteredFields = fields.filter((field) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      field.displayName.toLowerCase().includes(query) ||
      field.losFieldId.toLowerCase().includes(query) ||
      field.columnName.toLowerCase().includes(query) ||
      (field.category && field.category.toLowerCase().includes(query))
    );
  });

  // Get data type label
  const getDataTypeLabel = (dataType: string) => {
    const type = DATA_TYPES.find((t) => t.value === dataType);
    return type?.label || dataType;
  };

  // Show message if no tenant is selected
  if (!tenantId) {
    return (
      <Card className="border-slate-200 dark:border-slate-700">
        <CardContent className="py-8">
          <div className="text-center text-slate-500">
            <Database className="h-12 w-12 mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-medium">No Tenant Selected</p>
            <p className="text-xs text-slate-400 mt-1">
              Please select a tenant from the dropdown above to manage
              additional fields.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="border-slate-200 dark:border-slate-700">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-medium text-slate-900 dark:text-white flex items-center gap-2">
                <Database className="h-4 w-4" />
                Additional Fields
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light mt-1">
                Add custom LOS fields to sync beyond the default Coheus fields.
                These fields are added as columns to your loans table and can be
                used for AI queries.
              </CardDescription>
            </div>
            <Button
              onClick={() => {
                resetForm();
                setIsAddDialogOpen(true);
              }}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Field
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Search */}
          {fields.length > 0 && (
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search fields..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          )}

          {/* Fields Table */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : fields.length === 0 ? (
            <div className="text-center py-12">
              <Database
                className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-4"
                strokeWidth={1.5}
              />
              <p className="text-sm text-slate-500 dark:text-slate-400 font-light mb-2">
                No additional fields configured
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500 font-light mb-4">
                Add custom LOS fields to extract additional data from your
                Encompass system
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  resetForm();
                  setIsAddDialogOpen(true);
                }}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                Add Your First Field
              </Button>
            </div>
          ) : (
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Display Name</TableHead>
                    <TableHead>LOS Field ID</TableHead>
                    <TableHead>Column Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-center">Enabled</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredFields.map((field) => (
                    <TableRow key={field.id}>
                      <TableCell className="font-medium">
                        <div>{field.displayName}</div>
                        {field.description && (
                          <p className="text-xs text-slate-500 mt-0.5">
                            {field.description}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {field.losFieldId}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-500">
                        {field.columnName}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {getDataTypeLabel(field.dataType)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={field.isEnabled}
                          onCheckedChange={() => handleToggleEnabled(field)}
                        />
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => openEditDialog(field)}
                            >
                              <Pencil className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600"
                              onClick={() => {
                                setSelectedField(field);
                                setIsDeleteDialogOpen(true);
                              }}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Stats */}
          {fields.length > 0 && (
            <div className="flex items-center gap-4 mt-4 text-xs text-slate-500">
              <span>
                {fields.length} field{fields.length !== 1 ? "s" : ""} total
              </span>
              <span>{fields.filter((f) => f.isEnabled).length} enabled</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Field Dialog */}
      <Dialog
        open={isAddDialogOpen}
        onOpenChange={(open) => {
          // Don't close if the field picker is open
          if (!open && fieldPickerOpen) return;
          setIsAddDialogOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-[500px] overflow-visible">
          <DialogHeader>
            <DialogTitle>Add Additional Field</DialogTitle>
            <DialogDescription>
              Add a new field from your LOS system. A new column will be created
              in your loans table.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* LOS Field Picker */}
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="losFieldId">
                  LOS Field ID <span className="text-red-500">*</span>
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={fetchDiscoveredFields}
                  disabled={isLoadingFields}
                  className="h-6 text-xs"
                >
                  {isLoadingFields ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <RefreshCw className="h-3 w-3 mr-1" />
                  )}
                  Refresh Fields
                </Button>
              </div>

              {/* Field Picker Combobox */}
              <Popover
                open={fieldPickerOpen}
                onOpenChange={setFieldPickerOpen}
                modal={false}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={fieldPickerOpen}
                    className="w-full justify-between font-normal h-auto min-h-[40px] py-2"
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setFieldPickerOpen(!fieldPickerOpen);
                    }}
                  >
                    {formData.losFieldId ? (
                      <div className="flex flex-col items-start text-left min-w-0 flex-1">
                        <span className="font-mono text-xs font-medium truncate w-full">
                          {formData.losFieldId}
                        </span>
                        {formData.displayName &&
                          formData.displayName !== formData.losFieldId && (
                            <span className="text-xs text-slate-500 truncate w-full">
                              {formData.displayName}
                            </span>
                          )}
                      </div>
                    ) : (
                      <span className="text-slate-500">
                        Search or select a field...
                      </span>
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[450px] p-0"
                  align="start"
                  side="bottom"
                  style={{ zIndex: 9999 }}
                  onOpenAutoFocus={(e) => {
                    e.preventDefault();
                    setTimeout(() => {
                      const input = document.querySelector(
                        "[cmdk-input]"
                      ) as HTMLInputElement;
                      if (input) {
                        input.focus();
                      }
                    }, 100);
                  }}
                  onCloseAutoFocus={(e) => e.preventDefault()}
                  onInteractOutside={(e) => {
                    // Prevent closing when clicking inside the popover
                    const target = e.target as HTMLElement;
                    if (
                      target.closest("[cmdk-root]") ||
                      target.closest('[role="listbox"]')
                    ) {
                      e.preventDefault();
                    }
                  }}
                >
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Search fields by ID or description..."
                      value={fieldSearchQuery}
                      onValueChange={setFieldSearchQuery}
                    />
                    <CommandList className="max-h-[300px]">
                      {isLoadingFields ? (
                        <div className="flex items-center justify-center py-6">
                          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                          <span className="ml-2 text-sm text-slate-500">
                            Loading fields from Encompass...
                          </span>
                        </div>
                      ) : fieldsError ? (
                        <div className="p-4 text-center">
                          <AlertCircle className="h-5 w-5 text-amber-500 mx-auto mb-2" />
                          <p className="text-sm text-slate-600">
                            {fieldsError}
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={fetchDiscoveredFields}
                            className="mt-2"
                          >
                            Try Again
                          </Button>
                        </div>
                      ) : filteredDiscoveredFields.length === 0 ? (
                        <CommandEmpty>
                          {fieldSearchQuery
                            ? "No fields match your search."
                            : "No fields available."}
                        </CommandEmpty>
                      ) : (
                        <>
                          {/* Custom Fields Group */}
                          {filteredDiscoveredFields.some((f) => f.isCustom) && (
                            <CommandGroup heading="Custom Fields (CX.*)">
                              {filteredDiscoveredFields
                                .filter((f) => f.isCustom)
                                .slice(0, 50)
                                .map((field) => (
                                  <CommandItem
                                    key={field.fieldId}
                                    value={field.fieldId}
                                    onSelect={() =>
                                      handleSelectDiscoveredField(field)
                                    }
                                    className="flex items-start gap-2 py-2"
                                  >
                                    <div className="flex-1 min-w-0">
                                      <div className="font-mono text-xs text-emerald-700">
                                        {field.fieldId}
                                      </div>
                                      {field.description && (
                                        <div className="text-xs text-slate-500 truncate">
                                          {field.description}
                                        </div>
                                      )}
                                    </div>
                                    {field.format && (
                                      <Badge
                                        variant="outline"
                                        className="text-[10px] shrink-0"
                                      >
                                        {field.format}
                                      </Badge>
                                    )}
                                  </CommandItem>
                                ))}
                            </CommandGroup>
                          )}

                          {/* RDB Fields Group */}
                          {filteredDiscoveredFields.some(
                            (f) => !f.isCustom
                          ) && (
                            <CommandGroup heading="Standard Fields (RDB)">
                              {filteredDiscoveredFields
                                .filter((f) => !f.isCustom)
                                .slice(0, 100)
                                .map((field) => (
                                  <CommandItem
                                    key={field.fieldId}
                                    value={field.fieldId}
                                    onSelect={() =>
                                      handleSelectDiscoveredField(field)
                                    }
                                    className="flex items-start gap-2 py-2"
                                  >
                                    <div className="flex-1 min-w-0">
                                      <div className="font-mono text-xs text-blue-700">
                                        {field.fieldId}
                                      </div>
                                      {field.description && (
                                        <div className="text-xs text-slate-500 truncate">
                                          {field.description}
                                        </div>
                                      )}
                                    </div>
                                    {field.format && (
                                      <Badge
                                        variant="outline"
                                        className="text-[10px] shrink-0"
                                      >
                                        {field.format}
                                      </Badge>
                                    )}
                                  </CommandItem>
                                ))}
                            </CommandGroup>
                          )}

                          {filteredDiscoveredFields.length > 150 && (
                            <div className="py-2 px-3 text-xs text-center text-slate-500 border-t">
                              Showing first 150 results. Type to filter...
                            </div>
                          )}
                        </>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              {/* Manual Entry Option */}
              <div className="flex items-center gap-2">
                <Input
                  id="losFieldId"
                  placeholder="Or enter manually: CX.CUSTOMFIELD1"
                  value={formData.losFieldId}
                  onChange={(e) =>
                    handleInputChange("losFieldId", e.target.value)
                  }
                  onBlur={() => validateField(formData.losFieldId)}
                  className="flex-1"
                />
                {formData.losFieldId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      handleInputChange("losFieldId", "");
                      setValidationResult(null);
                    }}
                    className="h-9 w-9 shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {validationResult && (
                <p
                  className={`text-xs ${
                    validationResult.exists
                      ? "text-emerald-600"
                      : "text-amber-600"
                  }`}
                >
                  {validationResult.exists ? (
                    <>
                      <CheckCircle2 className="h-3 w-3 inline mr-1" />
                      Field found
                      {validationResult.description
                        ? `: ${validationResult.description}`
                        : ""}
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-3 w-3 inline mr-1" />
                      Field not found in LOS (may still work if valid)
                    </>
                  )}
                </p>
              )}

              <p className="text-xs text-slate-500">
                Search from available fields or enter manually (e.g.,
                CX.CUSTOMFIELD1 for custom fields)
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="displayName">
                Display Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="displayName"
                placeholder="e.g., Custom Revenue Code"
                value={formData.displayName}
                onChange={(e) =>
                  handleInputChange("displayName", e.target.value)
                }
              />
              {generatedColumnName && (
                <p className="text-xs text-slate-500">
                  Column name:{" "}
                  <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">
                    {generatedColumnName}
                  </code>
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="dataType">Data Type</Label>
              <Select
                value={formData.dataType}
                onValueChange={(value) => handleInputChange("dataType", value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {DATA_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      <div>
                        <span>{type.label}</span>
                        <span className="text-xs text-slate-500 ml-2">
                          - {type.description}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                placeholder="Brief description of this field..."
                value={formData.description}
                onChange={(e) =>
                  handleInputChange("description", e.target.value)
                }
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddField}
              disabled={
                isSaving ||
                !formData.losFieldId.trim() ||
                !formData.displayName.trim()
              }
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                "Add Field"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Field Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Additional Field</DialogTitle>
            <DialogDescription>
              Update the field metadata. Note: LOS Field ID and column name
              cannot be changed.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>LOS Field ID</Label>
              <Input
                value={formData.losFieldId}
                disabled
                className="bg-slate-50"
              />
            </div>

            <div className="grid gap-2">
              <Label>Column Name</Label>
              <Input
                value={generatedColumnName}
                disabled
                className="bg-slate-50 font-mono text-sm"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="editDisplayName">Display Name</Label>
              <Input
                id="editDisplayName"
                value={formData.displayName}
                onChange={(e) =>
                  handleInputChange("displayName", e.target.value)
                }
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="editDescription">Description</Label>
              <Textarea
                id="editDescription"
                value={formData.description}
                onChange={(e) =>
                  handleInputChange("description", e.target.value)
                }
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsEditDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleUpdateField} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Additional Field</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedField?.displayName}"?
              This will:
              <ul className="list-disc ml-6 mt-2 space-y-1">
                <li>Remove the column from your loans table</li>
                <li>Delete all data stored in this field</li>
                <li>This action cannot be undone</li>
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteField}
              className="bg-red-600 hover:bg-red-700"
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete Field"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
