/**
 * Revenue Formula Tab
 * Build custom revenue calculation formulas from available loan fields
 * Allows tenants to define their own revenue formula
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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Plus,
  Trash2,
  DollarSign,
  Calculator,
  Save,
  Loader2,
  AlertCircle,
  CheckCircle2,
  GripVertical,
  ChevronDown,
  ChevronUp,
  Info,
  TestTube,
  RefreshCw,
  ArrowRight,
  Search,
  Parentheses,
  X,
  Copy,
  ClipboardPaste,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAdminTenant } from "@/contexts/AdminTenantContext";
import { cn } from "@/lib/utils";

interface RevenueFormulaTabProps {
  onRefresh: () => void;
}

// NOTE: Fields are now dynamically loaded from the tenant's database schema
// via the loadTenantFields() function. No hardcoded field list needed.

// Field categories for grouping in the UI
const FIELD_CATEGORIES = [
  { id: "pricing", label: "Pricing & Rates" },
  { id: "loan", label: "Loan Details" },
  { id: "fees", label: "Fees" },
  { id: "credits", label: "Credits & Adjustments" },
  { id: "purchase_advice", label: "Purchase Advice" },
  { id: "interest", label: "Interest" },
  { id: "other", label: "Other Numeric Fields" },
];

interface FormulaComponent {
  id: string;
  type: "field" | "group_start" | "group_end";
  field?: string;
  operator: "+" | "-";
  label: string;
  isBaseBuy?: boolean;
  coefficient?: number;
  groupId?: string; // Links group_start and group_end
}

interface RevenueFormula {
  id?: string;
  calculation_type: string;
  name: string;
  description: string;
  formula_components: FormulaComponent[];
  sql_expression?: string;
  is_active: boolean;
  is_validated: boolean;
  validation_result?: string;
}

// Interface for tenant schema fields with optional LOS field ID
interface TenantField {
  value: string; // column name
  label: string; // display name
  dataType: string;
  nullable: boolean;
  losFieldId?: string; // Encompass field ID if mapped
}

export function RevenueFormulaTab({ onRefresh }: RevenueFormulaTabProps) {
  const { toast } = useToast();
  const { selectedTenantId, isTenantAdmin, isPlatformAdmin } = useAdminTenant();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [formula, setFormula] = useState<RevenueFormula>({
    calculation_type: "revenue",
    name: "Custom Revenue Formula",
    description: "",
    formula_components: [],
    is_active: true,
    is_validated: false,
  });
  const [testResult, setTestResult] = useState<any>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(["pricing", "fees"])
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Search for available fields
  const [fieldSearch, setFieldSearch] = useState("");

  // Track selected components for grouping
  const [selectedForGroup, setSelectedForGroup] = useState<Set<string>>(
    new Set()
  );

  // Tenant schema fields - actual fields available in this tenant's loans table
  const [tenantFields, setTenantFields] = useState<TenantField[]>([]);
  const [loadingFields, setLoadingFields] = useState(false);

  // Export/Import formula between tenants
  const [showFormulaImport, setShowFormulaImport] = useState(false);
  const [importJsonText, setImportJsonText] = useState("");
  const [importParseError, setImportParseError] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<RevenueFormula | null>(null);

  // Load existing formula and available fields on mount
  useEffect(() => {
    loadFormula();
    loadTenantFields();
  }, [selectedTenantId]);

  // Track if tenant fields have been loaded (even if empty)
  const [fieldsLoaded, setFieldsLoaded] = useState(false);

  // Load actual available fields from the tenant's schema
  const loadTenantFields = async () => {
    setLoadingFields(true);
    setFieldsLoaded(false);
    try {
      const tenantParam = selectedTenantId
        ? `?tenant_id=${selectedTenantId}`
        : "";
      const response = await api.request<{ fields: TenantField[] }>(
        `/api/tenant-config/calculations/fields${tenantParam}`
      );
      setTenantFields(response.fields || []);
      console.log(
        `[RevenueFormula] Loaded ${
          response.fields?.length || 0
        } tenant fields from schema`
      );
    } catch (error: any) {
      console.error("Error loading tenant fields:", error);
      // Fall back to empty - will show warnings
      setTenantFields([]);
    } finally {
      setLoadingFields(false);
      setFieldsLoaded(true);
    }
  };

  // Check if a field exists in the tenant's schema
  const isFieldAvailable = useCallback(
    (fieldName: string): boolean => {
      if (!fieldsLoaded) return true; // Assume available if not loaded yet
      return tenantFields.some((f) => f.value === fieldName);
    },
    [tenantFields, fieldsLoaded]
  );

  // Get missing fields from current formula
  const getMissingFields = useCallback((): string[] => {
    if (!fieldsLoaded) return []; // Can't determine missing if not loaded
    return formula.formula_components
      .filter(
        (c) => c.type !== "group_start" && c.type !== "group_end" && c.field
      ) // Skip group markers and undefined fields
      .map((c) => c.field!)
      .filter((field) => !isFieldAvailable(field));
  }, [formula.formula_components, fieldsLoaded, isFieldAvailable]);

  const loadFormula = async () => {
    setLoading(true);
    try {
      const tenantParam = selectedTenantId
        ? `?tenant_id=${selectedTenantId}`
        : "";
      const response = await api.request<{ formula: RevenueFormula | null }>(
        `/api/tenant-config/calculations/revenue${tenantParam}`
      );

      if (response.formula) {
        setFormula(response.formula);
      } else {
        // Set default formula if none exists - start with empty formula
        setFormula({
          calculation_type: "revenue",
          name: "Custom Revenue Formula",
          description: "",
          formula_components: [],
          is_active: true,
          is_validated: false,
        });
      }
    } catch (error: any) {
      console.error("Error loading formula:", error);
      // Silently fail - will show empty formula builder
    } finally {
      setLoading(false);
    }
  };

  const addComponent = (field: string) => {
    // Look up from actual tenant fields (from database)
    const tenantField = tenantFields.find((f) => f.value === field);
    if (!tenantField) return;

    // Determine if this is a "Base Buy" field (pricing rate that needs special calculation)
    const isBaseBuy =
      field.toLowerCase().includes("base_price_rate") ||
      field.toLowerCase().includes("base_buy") ||
      tenantField.losFieldId === "3236";

    const newComponent: FormulaComponent = {
      id: Date.now().toString(),
      type: "field",
      field: tenantField.value,
      operator: "+",
      label: tenantField.label,
      isBaseBuy,
    };

    setFormula((prev) => ({
      ...prev,
      formula_components: [...prev.formula_components, newComponent],
      is_validated: false,
    }));
  };

  // Add a group around selected components or at the end
  const addGroup = () => {
    const groupId = Date.now().toString();

    if (selectedForGroup.size > 0) {
      // Wrap selected components in a group
      const selectedIndices = formula.formula_components
        .map((c, i) => (selectedForGroup.has(c.id) ? i : -1))
        .filter((i) => i !== -1)
        .sort((a, b) => a - b);

      if (selectedIndices.length === 0) return;

      const firstIdx = selectedIndices[0];
      const lastIdx = selectedIndices[selectedIndices.length - 1];

      // Get the operator of the first selected component for the group
      const firstComponent = formula.formula_components[firstIdx];
      const groupOperator = firstIdx === 0 ? "+" : firstComponent.operator;

      const newComponents = [...formula.formula_components];

      // Insert group start before first selected
      newComponents.splice(firstIdx, 0, {
        id: `${groupId}_start`,
        type: "group_start",
        operator: groupOperator,
        label: "(",
        groupId,
      });

      // Insert group end after last selected (accounting for inserted start)
      newComponents.splice(lastIdx + 2, 0, {
        id: `${groupId}_end`,
        type: "group_end",
        operator: "+",
        label: ")",
        groupId,
      });

      // If first component had an operator, reset it to + (group takes the operator)
      if (firstIdx > 0) {
        const adjustedFirstIdx = firstIdx + 1; // Account for inserted group_start
        newComponents[adjustedFirstIdx] = {
          ...newComponents[adjustedFirstIdx],
          operator: "+",
        };
      }

      setFormula((prev) => ({
        ...prev,
        formula_components: newComponents,
        is_validated: false,
      }));
      setSelectedForGroup(new Set());
    } else {
      // Add empty group at the end
      const startComponent: FormulaComponent = {
        id: `${groupId}_start`,
        type: "group_start",
        operator: formula.formula_components.length === 0 ? "+" : "+",
        label: "(",
        groupId,
      };

      const endComponent: FormulaComponent = {
        id: `${groupId}_end`,
        type: "group_end",
        operator: "+",
        label: ")",
        groupId,
      };

      setFormula((prev) => ({
        ...prev,
        formula_components: [
          ...prev.formula_components,
          startComponent,
          endComponent,
        ],
        is_validated: false,
      }));
    }
  };

  // Toggle component selection for grouping
  const toggleComponentSelection = (id: string) => {
    setSelectedForGroup((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const removeComponent = (id: string) => {
    // If removing a group start/end, remove both
    const component = formula.formula_components.find((c) => c.id === id);
    if (component?.type === "group_start" || component?.type === "group_end") {
      const groupId = component.groupId;
      setFormula((prev) => ({
        ...prev,
        formula_components: prev.formula_components.filter(
          (c) => c.groupId !== groupId
        ),
        is_validated: false,
      }));
      return;
    }

    setFormula((prev) => ({
      ...prev,
      formula_components: prev.formula_components.filter((c) => c.id !== id),
      is_validated: false,
    }));
  };

  const updateComponent = (id: string, updates: Partial<FormulaComponent>) => {
    setFormula((prev) => ({
      ...prev,
      formula_components: prev.formula_components.map((c) =>
        c.id === id ? { ...c, ...updates } : c
      ),
      is_validated: false,
    }));
  };

  const moveComponent = (index: number, direction: "up" | "down") => {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= formula.formula_components.length) return;

    const newComponents = [...formula.formula_components];
    [newComponents[index], newComponents[newIndex]] = [
      newComponents[newIndex],
      newComponents[index],
    ];

    setFormula((prev) => ({
      ...prev,
      formula_components: newComponents,
    }));
  };

  // Export formula to clipboard as JSON
  const handleExportFormula = async () => {
    if (formula.formula_components.length === 0) {
      toast({
        title: "Nothing to Export",
        description: "Add fields to the formula before exporting.",
        variant: "destructive",
      });
      return;
    }

    const exportData = {
      _type: "cohi_revenue_formula",
      _version: 1,
      _exportedAt: new Date().toISOString(),
      name: formula.name,
      description: formula.description,
      calculation_type: formula.calculation_type,
      formula_components: formula.formula_components,
      is_active: formula.is_active,
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(exportData, null, 2));
      toast({
        title: "Formula Copied",
        description: `Copied "${formula.name}" with ${formula.formula_components.filter((c) => c.type === "field").length} field(s) to clipboard. Paste it into another tenant's Revenue Formula tab.`,
        duration: 5000,
      });
    } catch {
      // Fallback for clipboard API not available
      const textArea = document.createElement("textarea");
      textArea.value = JSON.stringify(exportData, null, 2);
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      toast({
        title: "Formula Copied",
        description: `Copied "${formula.name}" to clipboard.`,
      });
    }
  };

  // Parse pasted formula JSON for import preview
  const handleParseImportJson = () => {
    setImportParseError(null);
    setImportPreview(null);

    if (!importJsonText.trim()) {
      setImportParseError("Please paste exported formula JSON first.");
      return;
    }

    try {
      const parsed = JSON.parse(importJsonText.trim());

      // Validate structure
      if (parsed._type !== "cohi_revenue_formula") {
        setImportParseError(
          "Invalid format. This doesn't look like an exported revenue formula. Make sure you copied from the Export button on another tenant's Revenue Formula tab."
        );
        return;
      }

      if (
        !Array.isArray(parsed.formula_components) ||
        parsed.formula_components.length === 0
      ) {
        setImportParseError(
          "The exported formula has no components. Nothing to import."
        );
        return;
      }

      // Validate each component has the required fields
      for (const comp of parsed.formula_components) {
        if (!comp.id || !comp.type || !comp.operator) {
          setImportParseError(
            "One or more formula components are malformed. Please re-export from the source tenant."
          );
          return;
        }
      }

      const preview: RevenueFormula = {
        calculation_type: parsed.calculation_type || "revenue",
        name: parsed.name || "Imported Revenue Formula",
        description: parsed.description || "",
        formula_components: parsed.formula_components,
        is_active: parsed.is_active ?? true,
        is_validated: false,
      };

      setImportPreview(preview);
    } catch (e: any) {
      setImportParseError(
        `Invalid JSON: ${e.message}. Make sure you pasted the complete exported text.`
      );
    }
  };

  // Apply the imported formula
  const handleApplyImportedFormula = () => {
    if (!importPreview) return;

    // Regenerate component IDs to avoid collisions
    const now = Date.now();
    const remappedComponents = importPreview.formula_components.map(
      (comp, idx) => {
        const newId = `${now}_${idx}`;
        // For group_start/group_end, remap groupId consistently
        if (comp.type === "group_start" || comp.type === "group_end") {
          return { ...comp, id: newId };
        }
        return { ...comp, id: newId };
      }
    );

    // Remap groupIds so paired group_start/group_end still match
    const groupIdMap = new Map<string, string>();
    const finalComponents = remappedComponents.map((comp) => {
      if (comp.groupId) {
        if (!groupIdMap.has(comp.groupId)) {
          groupIdMap.set(comp.groupId, `grp_${now}_${groupIdMap.size}`);
        }
        return { ...comp, groupId: groupIdMap.get(comp.groupId) };
      }
      return comp;
    });

    setFormula((prev) => ({
      ...prev,
      name: importPreview.name,
      description: importPreview.description,
      formula_components: finalComponents,
      is_active: importPreview.is_active,
      is_validated: false,
      validation_result: undefined,
    }));

    // Close dialog and reset
    setShowFormulaImport(false);
    setImportJsonText("");
    setImportParseError(null);
    setImportPreview(null);

    // Check for missing fields
    const fieldComponents = finalComponents.filter(
      (c) => c.type === "field" && c.field
    );
    const missingCount = fieldComponents.filter(
      (c) => !isFieldAvailable(c.field!)
    ).length;

    if (missingCount > 0) {
      toast({
        title: "Formula Imported - Some Fields Missing",
        description: `Imported ${fieldComponents.length} field(s). ${missingCount} field(s) don't exist in this tenant's database yet. Check the warning above to add them.`,
        variant: "destructive",
        duration: 8000,
      });
    } else {
      toast({
        title: "Formula Imported Successfully",
        description: `Imported "${importPreview.name}" with ${fieldComponents.length} field(s). Test and save when ready.`,
      });
    }
  };

  const generateSqlExpression = useCallback(
    (components: FormulaComponent[]): string => {
      if (components.length === 0) return "0";

      const parts: string[] = [];
      let isFirstInGroup = false;

      components.forEach((comp, index) => {
        // Handle group markers
        if (comp.type === "group_start") {
          const prefix = index === 0 ? "" : `${comp.operator} `;
          parts.push(`${prefix}(`);
          isFirstInGroup = true;
          return;
        }

        if (comp.type === "group_end") {
          parts.push(")");
          return;
        }

        // Handle field components
        let fieldExpr = "";

        if (comp.isBaseBuy && comp.field) {
          // Base Buy calculation: ((rate - 100) / 100) * loan_amount
          fieldExpr = `COALESCE(CASE WHEN ${comp.field} IS NOT NULL AND ${comp.field} != 0 THEN ROUND(((${comp.field} - 100.0) / 100.0) * loan_amount, 2) ELSE 0 END, 0)`;
        } else if (comp.field) {
          fieldExpr = `COALESCE(${comp.field}, 0)`;
        }

        if (index === 0 || isFirstInGroup) {
          parts.push(fieldExpr);
          isFirstInGroup = false;
        } else {
          parts.push(`${comp.operator} ${fieldExpr}`);
        }
      });

      return parts.join(" ");
    },
    []
  );

  const testFormula = async () => {
    // Wait for fields to load first
    if (!fieldsLoaded) {
      toast({
        title: "Please Wait",
        description:
          "Schema fields are still loading. Please try again in a moment.",
      });
      return;
    }

    // Check for missing fields first
    const missingFields = getMissingFields();
    if (missingFields.length > 0) {
      toast({
        title: "Missing Fields - Cannot Test",
        description: `${missingFields.length} field(s) missing: ${missingFields.join(
          ", "
        )}. Add them via Additional Fields or remove from formula.`,
        variant: "destructive",
      });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const tenantParam = selectedTenantId
        ? `?tenant_id=${selectedTenantId}`
        : "";
      const sqlExpression = generateSqlExpression(formula.formula_components);

      const response = await api.request<{ result: any }>(
        `/api/tenant-config/calculations/test${tenantParam}`,
        {
          method: "POST",
          body: JSON.stringify({
            sql_expression: sqlExpression,
            calculation_type: "revenue",
          }),
        }
      );

      setTestResult(response.result);

      // Update validation status
      setFormula((prev) => ({
        ...prev,
        is_validated: true,
        validation_result: "Test passed successfully",
      }));

      toast({
        title: "Test Successful",
        description: "Formula calculated correctly on sample data",
      });
    } catch (error: any) {
      setTestResult({ error: error.message });
      setFormula((prev) => ({
        ...prev,
        is_validated: false,
        validation_result: error.message,
      }));
      toast({
        title: "Test Failed",
        description: error.message || "Formula validation failed",
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  };

  const saveFormula = async () => {
    if (formula.formula_components.length === 0) {
      toast({
        title: "Validation Error",
        description: "At least one field is required in the formula",
        variant: "destructive",
      });
      return;
    }

    // Wait for fields to load first
    if (!fieldsLoaded) {
      toast({
        title: "Please Wait",
        description:
          "Schema fields are still loading. Please try again in a moment.",
      });
      return;
    }

    // Check for missing fields before saving
    const missingFields = getMissingFields();
    if (missingFields.length > 0) {
      toast({
        title: "Missing Fields - Cannot Save",
        description: `${missingFields.length} field(s) missing: ${missingFields.join(
          ", "
        )}. Add them via Additional Fields or remove from formula.`,
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const tenantParam = selectedTenantId
        ? `?tenant_id=${selectedTenantId}`
        : "";
      const sqlExpression = generateSqlExpression(formula.formula_components);

      await api.request(
        `/api/tenant-config/calculations/revenue${tenantParam}`,
        {
          method: "PUT",
          body: JSON.stringify({
            ...formula,
            sql_expression: sqlExpression,
          }),
        }
      );

      toast({
        title: "Success",
        description:
          "Revenue formula saved successfully. All revenue calculations will now use this formula.",
      });

      onRefresh();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save formula",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId);
      } else {
        newSet.add(categoryId);
      }
      return newSet;
    });
  };

  // Infer category from field name for organization
  const inferCategory = (fieldName: string): string => {
    const name = fieldName.toLowerCase();
    if (name.includes("rate") || name.includes("price") || name.includes("buy"))
      return "pricing";
    if (name.includes("loan_amount") || name.includes("loan_type"))
      return "loan";
    if (
      name.includes("fee") ||
      name.includes("appraisal") ||
      name.includes("line_800") ||
      name.includes("warehouse")
    )
      return "fees";
    if (name.includes("credit") || name.includes("cure")) return "credits";
    if (
      name.includes("purchase_advice") ||
      name.includes("pa_") ||
      name.includes("payout")
    )
      return "purchase_advice";
    if (name.includes("interest")) return "interest";
    return "other";
  };

  // Get actual tenant fields by category (from database, not hardcoded)
  // Uses filtered fields when search is active
  const getFieldsByCategory = (categoryId: string) => {
    return filteredTenantFields.filter(
      (f) => inferCategory(f.value) === categoryId
    );
  };

  const isFieldInFormula = (fieldValue: string) => {
    return formula.formula_components.some((c) => c.field === fieldValue);
  };

  // Generate preview expression with proper grouping
  const previewExpression = formula.formula_components
    .map((comp, index) => {
      if (comp.type === "group_start") {
        const prefix = index === 0 ? "" : ` ${comp.operator} `;
        return `${prefix}(`;
      }
      if (comp.type === "group_end") {
        return ")";
      }
      const prefix = index === 0 ? "" : ` ${comp.operator} `;
      return `${prefix}${comp.label}`;
    })
    .join("");

  // Filter fields by search term
  const filteredTenantFields = fieldSearch
    ? tenantFields.filter(
        (f) =>
          f.label.toLowerCase().includes(fieldSearch.toLowerCase()) ||
          f.value.toLowerCase().includes(fieldSearch.toLowerCase())
      )
    : tenantFields;

  if (loading) {
    return (
      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-thin text-slate-900 dark:text-white flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Revenue Formula
            </CardTitle>
            <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
              Build a custom revenue calculation formula from your available
              loan fields
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {isPlatformAdmin && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportFormula}
                  disabled={formula.formula_components.length === 0}
                  className="font-light bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
                  title="Copy formula to clipboard for pasting into another tenant"
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Export
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowFormulaImport(true)}
                  className="font-light bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-950/50 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300"
                  title="Import formula copied from another tenant"
                >
                  <ClipboardPaste className="h-4 w-4 mr-2" />
                  Import
                </Button>
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={loadFormula}
              disabled={loading}
              className="font-light"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Reset
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={testFormula}
              disabled={testing || formula.formula_components.length === 0}
              className="font-light"
            >
              {testing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <TestTube className="h-4 w-4 mr-2" />
              )}
              Test Formula
            </Button>
            <Button
              size="sm"
              onClick={saveFormula}
              disabled={saving || formula.formula_components.length === 0}
              className="font-light"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Formula
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Info Alert */}
        <Alert className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
          <Info className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-700 dark:text-blue-300 text-sm">
            Build your revenue formula by adding fields from the Available
            Fields section below. The formula will be used across all revenue
            calculations in dashboards, reports, and analytics.
            <br />
            <span className="font-medium">Note:</span> "Base Buy" fields are
            automatically calculated as: ((rate - 100) / 100) × Loan Amount
          </AlertDescription>
        </Alert>

        {/* Schema Loading Indicator */}
        {loadingFields && (
          <Alert className="bg-slate-50 dark:bg-slate-950/30 border-slate-200 dark:border-slate-800">
            <Loader2 className="h-4 w-4 text-slate-600 animate-spin" />
            <AlertDescription className="text-slate-700 dark:text-slate-300 text-sm">
              Loading tenant database schema...
            </AlertDescription>
          </Alert>
        )}

        {/* Missing Fields Warning */}
        {fieldsLoaded && getMissingFields().length > 0 && (
          <Alert className="bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800 dark:text-amber-200 text-sm">
              <div className="flex flex-col gap-2">
                <div>
                  <span className="font-medium">Missing Fields:</span> The
                  following fields in your formula don't exist in this tenant's
                  database:{" "}
                  <span className="font-mono text-xs">
                    {getMissingFields().join(", ")}
                  </span>
                </div>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Add them via the Additional Fields tab or remove them from the
                  formula.
                </p>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Formula Preview */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-sm font-medium">Formula Preview</Label>
            {formula.is_validated && (
              <Badge
                variant="outline"
                className="text-emerald-600 border-emerald-300"
              >
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Validated
              </Badge>
            )}
          </div>
          <div className="font-mono text-sm text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 p-3 rounded border min-h-[40px]">
            {previewExpression || (
              <span className="text-slate-400 italic">No fields added yet</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Formula Builder - Left Side */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">
                Current Formula Components
              </Label>
              <div className="flex items-center gap-2">
                {selectedForGroup.size > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addGroup}
                    className="h-7 text-xs"
                  >
                    <Parentheses className="h-3 w-3 mr-1" />
                    Group ({selectedForGroup.size})
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addGroup}
                  className="h-7 text-xs"
                  title="Add parentheses group"
                >
                  <Parentheses className="h-3 w-3 mr-1" />
                  Add ( )
                </Button>
                <Badge variant="secondary">
                  {
                    formula.formula_components.filter(
                      (c) => c.type !== "group_start" && c.type !== "group_end"
                    ).length
                  }{" "}
                  fields
                </Badge>
              </div>
            </div>

            <div className="space-y-2 min-h-[200px] p-4 bg-slate-50 dark:bg-slate-800/30 rounded-lg border-2 border-dashed border-slate-200 dark:border-slate-700">
              {formula.formula_components.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <Calculator className="h-12 w-12 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                  <p className="text-sm font-light">
                    Add fields from the right panel to build your formula
                  </p>
                </div>
              ) : (
                formula.formula_components.map((component, index) => {
                  // Handle group markers specially
                  if (component.type === "group_start") {
                    return (
                      <div
                        key={component.id}
                        className="flex items-center gap-2 p-2 bg-indigo-50 dark:bg-indigo-950/30 rounded-lg border border-indigo-200 dark:border-indigo-800"
                      >
                        {index > 0 && (
                          <Select
                            value={component.operator}
                            onValueChange={(v) =>
                              updateComponent(component.id, {
                                operator: v as "+" | "-",
                              })
                            }
                          >
                            <SelectTrigger className="w-16 h-7 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="+">+</SelectItem>
                              <SelectItem value="-">−</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                        <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">
                          (
                        </span>
                        <span className="text-xs text-indigo-500">
                          Group Start
                        </span>
                        <div className="flex-1" />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeComponent(component.id)}
                          className="h-6 w-6 p-0 text-slate-400 hover:text-red-600"
                          title="Remove group"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    );
                  }

                  if (component.type === "group_end") {
                    return (
                      <div
                        key={component.id}
                        className="flex items-center gap-2 p-2 bg-indigo-50 dark:bg-indigo-950/30 rounded-lg border border-indigo-200 dark:border-indigo-800"
                      >
                        <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">
                          )
                        </span>
                        <span className="text-xs text-indigo-500">
                          Group End
                        </span>
                      </div>
                    );
                  }

                  const fieldMissing = component.field
                    ? !isFieldAvailable(component.field)
                    : false;
                  const isSelected = selectedForGroup.has(component.id);

                  return (
                    <div
                      key={component.id}
                      className={cn(
                        "flex items-center gap-2 p-3 bg-white dark:bg-slate-800 rounded-lg border shadow-sm cursor-pointer transition-all",
                        fieldMissing
                          ? "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/20"
                          : isSelected
                          ? "border-indigo-400 dark:border-indigo-500 ring-2 ring-indigo-200 dark:ring-indigo-800"
                          : "border-slate-200 dark:border-slate-700 hover:border-slate-300"
                      )}
                      onClick={() => toggleComponentSelection(component.id)}
                    >
                      <div
                        className="flex flex-col gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0"
                          onClick={() => moveComponent(index, "up")}
                          disabled={index === 0}
                        >
                          <ChevronUp className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0"
                          onClick={() => moveComponent(index, "down")}
                          disabled={
                            index === formula.formula_components.length - 1
                          }
                        >
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </div>

                      {/* Operator */}
                      {index > 0 && component.type === "field" && (
                        <div onClick={(e) => e.stopPropagation()}>
                          <Select
                            value={component.operator}
                            onValueChange={(v) =>
                              updateComponent(component.id, {
                                operator: v as "+" | "-",
                              })
                            }
                          >
                            <SelectTrigger className="w-16 h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="+">+</SelectItem>
                              <SelectItem value="-">−</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      <div className="flex-1">
                        <span className="text-sm font-medium">
                          {component.label}
                        </span>
                        {component.isBaseBuy && (
                          <Badge variant="secondary" className="ml-2 text-xs">
                            Base Buy
                          </Badge>
                        )}
                        {isSelected && (
                          <Badge
                            variant="outline"
                            className="ml-2 text-xs border-indigo-300 text-indigo-600"
                          >
                            Selected
                          </Badge>
                        )}
                        {fieldMissing && (
                          <Badge variant="destructive" className="ml-2 text-xs">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            Field Missing
                          </Badge>
                        )}
                        <div
                          className={cn(
                            "text-xs font-mono",
                            fieldMissing
                              ? "text-red-600 dark:text-red-400"
                              : "text-slate-500"
                          )}
                        >
                          {component.field}
                        </div>
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeComponent(component.id);
                        }}
                        className="h-8 w-8 p-0 text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })
              )}
            </div>

            {selectedForGroup.size > 0 && (
              <p className="text-xs text-indigo-600 dark:text-indigo-400">
                Click fields to select/deselect for grouping, then click "Group"
                to wrap them in parentheses.
              </p>
            )}
          </div>

          {/* Available Fields - Right Side */}
          <div className="space-y-4">
            <Label className="text-sm font-medium">Available Fields</Label>

            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search fields..."
                value={fieldSearch}
                onChange={(e) => setFieldSearch(e.target.value)}
                className="pl-9 h-9"
              />
              {fieldSearch && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                  onClick={() => setFieldSearch("")}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>

            {fieldSearch && (
              <p className="text-xs text-slate-500">
                Showing {filteredTenantFields.length} of {tenantFields.length}{" "}
                fields
              </p>
            )}

            <div className="space-y-2 max-h-[350px] overflow-y-auto pr-2">
              {loadingFields && (
                <div className="text-center py-4 text-slate-500">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                  <p className="text-sm">Loading tenant database schema...</p>
                </div>
              )}

              {!loadingFields && tenantFields.length === 0 && (
                <div className="text-center py-6 text-slate-500 border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
                  <AlertCircle className="h-6 w-6 mx-auto mb-2 text-amber-500" />
                  <p className="text-sm font-medium">No numeric fields found</p>
                  <p className="text-xs text-slate-400 mt-1">
                    The tenant's database doesn't have numeric columns mapped
                    yet.
                    <br />
                    Add fields via the Additional Fields tab.
                  </p>
                </div>
              )}

              {!loadingFields &&
                tenantFields.length > 0 &&
                FIELD_CATEGORIES.map((category) => {
                  const fields = getFieldsByCategory(category.id);
                  if (fields.length === 0) return null;

                  const isExpanded = expandedCategories.has(category.id);

                  return (
                    <div
                      key={category.id}
                      className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden"
                    >
                      <button
                        onClick={() => toggleCategory(category.id)}
                        className="w-full flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left"
                      >
                        <span className="text-sm font-medium">
                          {category.label}
                        </span>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">
                            {fields.length}
                          </Badge>
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4 text-slate-400" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-slate-400" />
                          )}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="p-2 space-y-1 bg-white dark:bg-slate-900/50">
                          {fields.map((field) => {
                            const isInFormula = isFieldInFormula(field.value);
                            return (
                              <button
                                key={field.value}
                                onClick={() =>
                                  !isInFormula && addComponent(field.value)
                                }
                                disabled={isInFormula}
                                className={cn(
                                  "w-full flex items-center justify-between p-2 rounded text-left text-sm transition-colors",
                                  isInFormula
                                    ? "bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed"
                                    : "hover:bg-indigo-50 dark:hover:bg-indigo-950/30 hover:text-indigo-700 dark:hover:text-indigo-300"
                                )}
                              >
                                <span>{field.label}</span>
                                {isInFormula ? (
                                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                ) : (
                                  <Plus className="h-4 w-4" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

        {/* Test Results */}
        {testResult && (
          <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
            <Label className="text-sm font-medium mb-2 block">
              Test Results
            </Label>
            {testResult.error ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{testResult.error}</AlertDescription>
              </Alert>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                <div className="p-3 bg-white dark:bg-slate-900 rounded border">
                  <div className="text-xs text-slate-500 mb-1">
                    Sample Loans Tested
                  </div>
                  <div className="text-lg font-medium">
                    {testResult.loans_tested || 0}
                  </div>
                </div>
                <div className="p-3 bg-white dark:bg-slate-900 rounded border">
                  <div className="text-xs text-slate-500 mb-1">
                    Total Revenue
                  </div>
                  <div className="text-lg font-medium text-emerald-600">
                    ${(testResult.total_revenue || 0).toLocaleString()}
                  </div>
                </div>
                <div className="p-3 bg-white dark:bg-slate-900 rounded border">
                  <div className="text-xs text-slate-500 mb-1">
                    Avg Revenue/Loan
                  </div>
                  <div className="text-lg font-medium">
                    ${(testResult.avg_revenue || 0).toLocaleString()}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Advanced: Raw SQL */}
        <div className="space-y-2">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700"
          >
            {showAdvanced ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
            Advanced: View SQL Expression
          </button>

          {showAdvanced && (
            <div className="p-4 bg-slate-900 rounded-lg">
              <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap overflow-x-auto">
                {generateSqlExpression(formula.formula_components) ||
                  "-- No formula components"}
              </pre>
            </div>
          )}
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="description">Formula Description (optional)</Label>
          <Textarea
            id="description"
            value={formula.description}
            onChange={(e) =>
              setFormula((prev) => ({ ...prev, description: e.target.value }))
            }
            placeholder="Describe how this revenue formula works, e.g., 'Matches our Qlik production revenue calculation'"
            rows={2}
            className="font-light"
          />
        </div>
      </CardContent>

      {/* Import Formula from Another Tenant Dialog */}
      <Dialog
        open={showFormulaImport}
        onOpenChange={(open) => {
          setShowFormulaImport(open);
          if (!open) {
            setImportJsonText("");
            setImportParseError(null);
            setImportPreview(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-thin flex items-center gap-2">
              <ClipboardPaste className="h-5 w-5" />
              Import Revenue Formula
            </DialogTitle>
            <DialogDescription className="font-light">
              Paste a revenue formula exported from another tenant. Use the
              Export button on the source tenant to copy the formula first.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <Alert className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
              <Info className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-700 dark:text-blue-300 text-sm">
                <strong>How to use:</strong>
                <ol className="mt-1 ml-4 list-decimal text-xs space-y-1">
                  <li>
                    Go to the source tenant's Revenue Formula tab and click{" "}
                    <strong>Export</strong>
                  </li>
                  <li>Come back here and paste the copied text below</li>
                  <li>
                    Click <strong>Parse</strong> to preview, then{" "}
                    <strong>Apply</strong> to import
                  </li>
                </ol>
                <p className="mt-2 text-xs">
                  <strong>Note:</strong> This will replace your current formula.
                  Fields that don't exist in this tenant's database will be
                  flagged so you can add them.
                </p>
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label htmlFor="import-formula-json">
                Exported Formula (JSON)
              </Label>
              <Textarea
                id="import-formula-json"
                value={importJsonText}
                onChange={(e) => {
                  setImportJsonText(e.target.value);
                  setImportParseError(null);
                  setImportPreview(null);
                }}
                placeholder='Paste the exported formula JSON here...'
                rows={6}
                className="font-mono text-xs"
              />
            </div>

            <Button
              onClick={handleParseImportJson}
              disabled={!importJsonText.trim()}
              variant="outline"
              className="w-full"
            >
              <ArrowRight className="h-4 w-4 mr-2" />
              Parse Formula
            </Button>

            {importParseError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  {importParseError}
                </AlertDescription>
              </Alert>
            )}

            {importPreview && (
              <div className="space-y-4">
                <Separator />

                <div className="space-y-3">
                  <Label className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    Formula Preview
                  </Label>

                  <div className="p-3 bg-slate-50 dark:bg-slate-800/30 rounded-lg border space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        {importPreview.name}
                      </span>
                      <Badge variant="secondary">
                        {
                          importPreview.formula_components.filter(
                            (c) => c.type === "field"
                          ).length
                        }{" "}
                        fields
                      </Badge>
                    </div>
                    {importPreview.description && (
                      <p className="text-xs text-slate-500">
                        {importPreview.description}
                      </p>
                    )}

                    {/* Formula expression preview */}
                    <div className="font-mono text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 p-2 rounded border">
                      {importPreview.formula_components
                        .map((comp, index) => {
                          if (comp.type === "group_start") {
                            const prefix =
                              index === 0 ? "" : ` ${comp.operator} `;
                            return `${prefix}(`;
                          }
                          if (comp.type === "group_end") return ")";
                          const prefix =
                            index === 0 ? "" : ` ${comp.operator} `;
                          return `${prefix}${comp.label}`;
                        })
                        .join("")}
                    </div>

                    {/* Field list */}
                    <div className="max-h-[180px] overflow-y-auto space-y-1">
                      {importPreview.formula_components
                        .filter((c) => c.type === "field")
                        .map((comp, idx) => {
                          const exists = comp.field
                            ? isFieldAvailable(comp.field)
                            : false;
                          return (
                            <div
                              key={idx}
                              className={cn(
                                "flex items-center gap-2 p-2 rounded border text-xs",
                                exists
                                  ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800"
                                  : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"
                              )}
                            >
                              <Badge
                                variant="outline"
                                className="w-6 justify-center text-xs"
                              >
                                {comp.operator}
                              </Badge>
                              <div className="flex-1">
                                <span className="font-medium">
                                  {comp.label}
                                </span>
                                <span className="ml-2 font-mono text-slate-500">
                                  {comp.field}
                                </span>
                              </div>
                              {exists ? (
                                <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                              ) : (
                                <span className="text-red-600 dark:text-red-400 shrink-0 flex items-center gap-1">
                                  <AlertCircle className="h-3 w-3" />
                                  Missing
                                </span>
                              )}
                            </div>
                          );
                        })}
                    </div>

                    {/* Summary of field availability */}
                    {(() => {
                      const fieldComps =
                        importPreview.formula_components.filter(
                          (c) => c.type === "field" && c.field
                        );
                      const existCount = fieldComps.filter((c) =>
                        isFieldAvailable(c.field!)
                      ).length;
                      const missCount = fieldComps.length - existCount;
                      return missCount > 0 ? (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                          {missCount} field(s) missing in this tenant. After
                          importing, use "Add Fields from Encompass" to create
                          them.
                        </p>
                      ) : (
                        <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2">
                          All fields exist in this tenant's database.
                        </p>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowFormulaImport(false);
                setImportJsonText("");
                setImportParseError(null);
                setImportPreview(null);
              }}
              className="font-light"
            >
              Cancel
            </Button>
            <Button
              onClick={handleApplyImportedFormula}
              disabled={!importPreview}
              className="font-light"
            >
              <ClipboardPaste className="h-4 w-4 mr-2" />
              Apply Formula
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
