/**
 * Revenue Formula Tab
 * Build custom revenue calculation formulas from available loan fields
 * Allows tenants to define their own revenue formula matching their Qlik/legacy systems
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
  FileUp,
  ArrowRight,
  Search,
  Parentheses,
  X,
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

// Mapping from Qlik field names to Encompass LOS field IDs
// This allows us to look up existing columns by their LOS field ID or generate new ones
const QLIK_TO_LOS_FIELD_ID: Record<string, string> = {
  // Purchase Advice fields
  "purchase advice sell amount": "2208",
  "pa sell amt": "2208",
  "purchase advice srp amount": "2206",
  "pa srp amt": "2206",
  "purchase adv expected int pymt from investor": "2836",
  "purchase advice expected interest payment from investor": "2836",
  "expected interest payment from investor": "2836",
  "purchase advice expctd payout 1 amt": "2596",
  "purchase advice expected payout 1 amount": "2596",
  "purchase advice payout 1": "2596",
  "pa payout 1": "2596",
  "purchase advice expctd payout 2 amt": "2597",
  "purchase advice expected payout 2 amount": "2597",
  "purchase advice payout 2": "2597",
  "pa payout 2": "2597",
  "purchase advice expctd pymt 2 amt": "2597",
  "purchase advice expctd payout 3 amt": "2598",
  "purchase advice expected payout 3 amount": "2598",
  "purchase advice payout 3": "2598",
  "pa payout 3": "2598",
  "purchase advice expctd pymt 3 amt": "2598",
  "purchase advice expctd payout 4 amt": "2599",
  "purchase advice expected payout 4 amount": "2599",
  "purchase advice payout 4": "2599",
  "pa payout 4": "2599",
  "purchase advice expctd payout 5 amt": "2600",
  "purchase advice expected payout 5 amount": "2600",
  "purchase advice payout 5": "2600",
  "pa payout 5": "2600",

  // Line 800 fields
  "line 800 total borrower paid amount": "NEWHUD2.X28",
  "line 800 total borrower paid": "NEWHUD2.X28",
  "line 800 borr": "NEWHUD2.X28",
  "line 800 total seller paid amount": "NEWHUD2.X29",
  "line 800 total seller paid": "NEWHUD2.X29",
  "line 800 seller": "NEWHUD2.X29",

  // Fee fields
  "fees appraisal fee borr": "NEWHUD.X1109",
  "appraisal fee borrower": "NEWHUD.X1109",
  "fees appraisal fee borrower": "NEWHUD.X1109",
  "fees interest borr": "334",
  "fees interest borrower": "334",
  "interest fees borrower": "334",
  "origination fee borrower paid": "NEWHUD.X1164",
  "orig fee borr pd": "NEWHUD.X1164",
  "origination fees seller paid": "NEWHUD.X1180",
  "origination fees seller": "NEWHUD.X1180",
  "orig fees seller": "NEWHUD.X1180",
  "origination points": "NEWHUD.X627",

  // Credits
  "lender credits": "NEWHUD.X1136",
  "lender credit": "NEWHUD.X1136",
  "cd lender credits": "CD3.X61",
  "cd applied cure": "NEWHUD.X1210",

  // Warehouse (custom fields - may vary by client)
  "warehouse line fee": "CX.WHL.FEE",
  "warehouse fee": "CX.WHL.FEE",
  "warehouse line interest": "CX.WHL.INT",
  "warehouse interest": "CX.WHL.INT",

  // Base buy / pricing
  "base buy": "3236",
  "rate lock buy side base price rate": "3236",
  "base buy ($)": "3236",

  // Loan fields
  "loan amount": "2",
};

// Helper to generate a column name from a display name/description
function generateColumnName(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "") // Remove special chars
    .replace(/\s+/g, "_") // Replace spaces with underscores
    .replace(/_+/g, "_") // Remove duplicate underscores
    .replace(/^_|_$/g, "") // Remove leading/trailing underscores
    .substring(0, 63); // PostgreSQL column name limit
}

/**
 * Parse a Qlik-style formula and extract fields with their operators
 * Example: [Field A] + [Field B] - [Field C]
 * Searches existing tenant columns by LOS field ID and fuzzy name matching
 */
function parseQlikFormula(
  qlikFormula: string,
  tenantFields: TenantField[]
): {
  components: Array<{
    qlikName: string;
    dbField: string | null;
    operator: "+" | "-";
    label: string;
    losFieldId?: string;
  }>;
  unmappedFields: string[];
} {
  const components: Array<{
    qlikName: string;
    dbField: string | null;
    operator: "+" | "-";
    label: string;
    losFieldId?: string;
  }> = [];
  const unmappedFields: string[] = [];

  // Remove parentheses - we flatten the formula for simplicity
  const formulaText = qlikFormula.replace(/[()]/g, " ");

  // Find all [Field Name] patterns with their preceding operator
  const fieldPattern = /([+-]?)\s*\[([^\]]+)\]/g;
  let match;
  let isFirst = true;

  while ((match = fieldPattern.exec(formulaText)) !== null) {
    const operatorChar = match[1]?.trim() || "+";
    const qlikFieldName = match[2].trim();

    // Normalize the Qlik field name for lookup
    const normalizedName = qlikFieldName.toLowerCase().trim();

    // Look up the Encompass field ID from our mapping
    const losFieldId = QLIK_TO_LOS_FIELD_ID[normalizedName];

    // Determine operator (first field is always +)
    const operator: "+" | "-" = isFirst
      ? "+"
      : operatorChar === "-"
      ? "-"
      : "+";
    isFirst = false;

    // Try to find existing column:
    // 1. First by LOS field ID match
    // 2. Then by fuzzy name match
    let matchedField: TenantField | undefined;

    if (losFieldId && tenantFields.length > 0) {
      // Search by LOS field ID
      matchedField = tenantFields.find((f) => f.losFieldId === losFieldId);
    }

    if (!matchedField && tenantFields.length > 0) {
      // Fuzzy name match - convert Qlik name to potential column name and search
      const potentialColumnName = generateColumnName(qlikFieldName);

      // Try exact match first
      matchedField = tenantFields.find((f) => f.value === potentialColumnName);

      // Try partial match - column contains key words from the Qlik field
      if (!matchedField) {
        const keyWords = normalizedName
          .split(/\s+/)
          .filter((w) => w.length > 2);
        matchedField = tenantFields.find((f) => {
          const colLower = f.value.toLowerCase();
          return keyWords.every((kw) =>
            colLower.includes(kw.replace(/[^a-z0-9]/g, ""))
          );
        });
      }
    }

    if (matchedField) {
      components.push({
        qlikName: qlikFieldName,
        dbField: matchedField.value,
        operator,
        label: matchedField.label || qlikFieldName,
        losFieldId,
      });
    } else {
      unmappedFields.push(qlikFieldName);
      components.push({
        qlikName: qlikFieldName,
        dbField: null,
        operator,
        label: qlikFieldName,
        losFieldId,
      });
    }
  }

  return { components, unmappedFields };
}

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
  const { selectedTenantId, isTenantAdmin } = useAdminTenant();

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

  // LOS connection for adding fields
  const [losConnectionId, setLosConnectionId] = useState<string | null>(null);
  const [addingMissingFields, setAddingMissingFields] = useState(false);

  // Qlik import state
  const [showQlikImport, setShowQlikImport] = useState(false);
  const [qlikFormulaText, setQlikFormulaText] = useState("");
  const [qlikParseResult, setQlikParseResult] = useState<{
    components: Array<{
      qlikName: string;
      dbField: string | null;
      operator: "+" | "-";
      label: string;
      losFieldId?: string;
    }>;
    unmappedFields: string[];
  } | null>(null);

  // Load existing formula, available fields, and LOS connection on mount
  useEffect(() => {
    loadFormula();
    loadTenantFields();
    loadLosConnection();
  }, [selectedTenantId]);

  // Load LOS connection ID for creating additional fields
  const loadLosConnection = async () => {
    try {
      const tenantParam = selectedTenantId
        ? `?tenant_id=${selectedTenantId}`
        : "";
      const response = await api.request<{
        connections: { id: string; los_type: string }[];
      }>(`/api/tenant-config/los-connections${tenantParam}`);
      // Get the first Encompass connection (typically there's only one)
      const encompassConnection = response.connections?.find(
        (c) => c.los_type === "encompass"
      );
      setLosConnectionId(encompassConnection?.id || null);
    } catch (error: any) {
      console.error("Error loading LOS connection:", error);
    }
  };

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

  // Get missing field column names with their LOS field IDs from the Qlik mapping
  const getMissingFieldsWithLosId = useCallback((): Array<{
    columnName: string;
    losFieldId: string;
    qlikLabel: string;
  }> => {
    const missingFieldNames = getMissingFields();
    const results: Array<{
      columnName: string;
      losFieldId: string;
      qlikLabel: string;
    }> = [];

    for (const columnName of missingFieldNames) {
      // Find the formula component to get its label
      const component = formula.formula_components.find(
        (c) => c.field === columnName
      );
      const label = component?.label || columnName;

      // Look up the LOS field ID from our Qlik mapping
      // We need to reverse-lookup: find what Qlik name maps to this column name
      const normalizedLabel = label.toLowerCase().trim();
      const losFieldId = QLIK_TO_LOS_FIELD_ID[normalizedLabel];

      if (losFieldId) {
        results.push({ columnName, losFieldId, qlikLabel: label });
      } else {
        console.log(
          `[RevenueFormula] Missing field "${columnName}" (${label}) has no LOS field ID mapping`
        );
      }
    }

    console.log(
      `[RevenueFormula] Missing fields: ${
        missingFieldNames.length
      }, with LOS field IDs: ${results.length}, LOS connection: ${
        losConnectionId || "none"
      }`
    );
    return results;
  }, [getMissingFields, formula.formula_components, losConnectionId]);

  // Add missing fields to the database - fetches descriptions from Encompass RDB
  const addMissingFieldsToDatabase = async () => {
    if (!losConnectionId) {
      toast({
        title: "Error",
        description:
          "No LOS connection found. Please configure an Encompass connection first.",
        variant: "destructive",
      });
      return;
    }

    const missingFields = getMissingFieldsWithLosId();
    if (missingFields.length === 0) {
      toast({
        title: "No Fields to Add",
        description:
          "All fields either exist or don't have Encompass field ID mappings.",
      });
      return;
    }

    setAddingMissingFields(true);
    try {
      const tenantParam = selectedTenantId
        ? `?tenant_id=${selectedTenantId}`
        : "";

      // Call backend endpoint that fetches Encompass descriptions and creates columns
      const response = await api.request<{
        success: boolean;
        message: string;
        results: Array<{
          losFieldId: string;
          columnName: string;
          displayName: string;
          success: boolean;
          error?: string;
        }>;
        requiresSync: boolean;
      }>(
        `/api/tenant-config/additional-fields/batch-create-from-encompass${tenantParam}`,
        {
          method: "POST",
          body: JSON.stringify({
            losConnectionId,
            fields: missingFields.map((f) => ({
              losFieldId: f.losFieldId,
              fallbackDisplayName: f.qlikLabel, // Used if Encompass lookup fails
            })),
          }),
        }
      );

      const successCount = response.results.filter((r) => r.success).length;
      const alreadyExisted = response.results.filter(
        (r) => r.error === "Field already exists"
      ).length;

      if (response.success || successCount > 0) {
        // Update formula components with the new column names from Encompass
        const columnNameMap = new Map(
          response.results
            .filter((r) => r.success)
            .map((r) => [r.losFieldId, r.columnName])
        );

        // Update formula to use the new column names
        setFormula((prev) => ({
          ...prev,
          formula_components: prev.formula_components.map((comp) => {
            // Find the LOS field ID for this component
            const normalizedLabel = comp.label.toLowerCase().trim();
            const losFieldId = QLIK_TO_LOS_FIELD_ID[normalizedLabel];
            const newColumnName = losFieldId
              ? columnNameMap.get(losFieldId)
              : undefined;

            if (newColumnName && !isFieldAvailable(comp.field)) {
              return { ...comp, field: newColumnName };
            }
            return comp;
          }),
          is_validated: false,
        }));

        toast({
          title: "Fields Added Successfully",
          description: `${successCount} field(s) added to database${
            alreadyExisted > 0 ? ` (${alreadyExisted} already existed)` : ""
          }. Column names generated from Encompass descriptions. Run a data sync to populate values.`,
          duration: 8000,
        });
        // Reload tenant fields to update the UI
        await loadTenantFields();
      } else {
        toast({
          title: "Failed to Add Fields",
          description: response.message,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error Adding Fields",
        description: error.message || "Failed to add fields to database",
        variant: "destructive",
      });
    } finally {
      setAddingMissingFields(false);
    }
  };

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

  // Handle parsing Qlik formula text
  const handleParseQlikFormula = () => {
    if (!qlikFormulaText.trim()) {
      toast({
        title: "Error",
        description: "Please paste a Qlik formula first",
        variant: "destructive",
      });
      return;
    }

    const result = parseQlikFormula(qlikFormulaText, tenantFields);
    setQlikParseResult(result);

    const mappedCount = result.components.filter((c) => c.dbField).length;
    const unmappedCount = result.unmappedFields.length;

    if (unmappedCount > 0 && mappedCount > 0) {
      toast({
        title: "Partially Mapped",
        description: `Mapped ${mappedCount} fields to existing columns. ${unmappedCount} field(s) need to be added.`,
      });
    } else if (unmappedCount > 0) {
      toast({
        title: "Fields Not Found",
        description: `${unmappedCount} field(s) not found in database. They will need to be added.`,
        variant: "destructive",
      });
    } else if (mappedCount > 0) {
      toast({
        title: "All Fields Mapped",
        description: `Successfully mapped all ${mappedCount} fields to existing database columns.`,
      });
    }
  };

  // Import the parsed Qlik formula into the formula builder
  const handleImportQlikFormula = () => {
    if (!qlikParseResult || qlikParseResult.components.length === 0) {
      toast({
        title: "Error",
        description:
          "No valid fields to import. Please parse the formula first.",
        variant: "destructive",
      });
      return;
    }

    // Convert ALL components to FormulaComponent format
    // For unmapped fields, generate a column name from the Qlik name
    const allComponents: FormulaComponent[] = qlikParseResult.components.map(
      (c, index) => {
        // For mapped fields, use the existing column
        // For unmapped fields, generate a column name from the Qlik field name
        const columnName = c.dbField || generateColumnName(c.qlikName);

        // Check if this is a "Base Buy" type field (pricing percentage)
        const isBaseBuy =
          c.qlikName.toLowerCase().includes("base buy") ||
          c.qlikName.toLowerCase().includes("base price rate") ||
          c.losFieldId === "3236";

        return {
          id: Date.now().toString() + index,
          type: "field" as const,
          field: columnName,
          operator: c.operator,
          label: c.label,
          isBaseBuy,
        };
      }
    );

    if (allComponents.length === 0) {
      toast({
        title: "Error",
        description: "No fields could be parsed from the formula.",
        variant: "destructive",
      });
      return;
    }

    // Replace the current formula with the imported one
    setFormula((prev) => ({
      ...prev,
      formula_components: allComponents,
      is_validated: false,
    }));

    // Close the import dialog
    setShowQlikImport(false);
    setQlikFormulaText("");
    setQlikParseResult(null);

    // Count how many fields need to be created
    const missingCount = allComponents.filter(
      (c) => !isFieldAvailable(c.field)
    ).length;
    const existingCount = allComponents.length - missingCount;

    if (missingCount > 0) {
      toast({
        title: "Formula Imported - Fields Need to be Added",
        description: `Imported ${allComponents.length} fields. ${existingCount} exist in DB, ${missingCount} need to be added. Use "Add Missing Fields to DB" button.`,
        duration: 8000,
      });
    } else {
      toast({
        title: "Formula Imported Successfully",
        description: `All ${allComponents.length} field(s) exist in your database. You can test and save the formula.`,
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
      const autoAddableCount = getMissingFieldsWithLosId().length;
      toast({
        title: "Missing Fields - Cannot Test",
        description:
          autoAddableCount > 0
            ? `${missingFields.length} field(s) missing. Click "Add Fields from Encompass" to auto-create them, then test again.`
            : `${missingFields.length} field(s) missing: ${missingFields.join(
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
      const autoAddableCount = getMissingFieldsWithLosId().length;
      toast({
        title: "Missing Fields - Cannot Save",
        description:
          autoAddableCount > 0
            ? `${missingFields.length} field(s) missing. Click "Add Fields from Encompass" to auto-create them, then save again.`
            : `${missingFields.length} field(s) missing: ${missingFields.join(
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowQlikImport(true)}
              className="font-light bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/30 dark:hover:bg-indigo-950/50 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300"
            >
              <FileUp className="h-4 w-4 mr-2" />
              Import from Qlik
            </Button>
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

        {/* Missing Fields Warning with Auto-Add */}
        {fieldsLoaded && getMissingFields().length > 0 && (
          <Alert className="bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800 dark:text-amber-200 text-sm">
              <div className="flex flex-col gap-3">
                <div>
                  <span className="font-medium">Missing Fields:</span> The
                  following fields in your formula don't exist in this tenant's
                  database:{" "}
                  <span className="font-mono text-xs">
                    {getMissingFields().join(", ")}
                  </span>
                </div>

                {getMissingFieldsWithLosId().length > 0 ? (
                  <div className="flex items-center justify-between gap-4 p-2 bg-amber-100 dark:bg-amber-900/40 rounded">
                    <p className="text-xs">
                      <strong>{getMissingFieldsWithLosId().length}</strong>{" "}
                      field(s) can be auto-added from Encompass. Column names
                      will be generated from Encompass field descriptions. After
                      adding, run a data sync.
                    </p>
                    {losConnectionId ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={addMissingFieldsToDatabase}
                        disabled={addingMissingFields}
                        className="shrink-0 bg-amber-200 hover:bg-amber-300 dark:bg-amber-800 dark:hover:bg-amber-700 border-amber-500 text-amber-900 dark:text-amber-100 font-medium"
                      >
                        {addingMissingFields ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Plus className="h-4 w-4 mr-2" />
                        )}
                        Add {getMissingFieldsWithLosId().length} Field
                        {getMissingFieldsWithLosId().length > 1 ? "s" : ""} from
                        Encompass
                      </Button>
                    ) : (
                      <span className="text-xs text-red-600 dark:text-red-400">
                        No LOS connection found - configure one in Integrations
                        tab first
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    These fields don't have Encompass field ID mappings. Add
                    them manually via the Additional Fields tab or remove them
                    from the formula.
                  </p>
                )}
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
                    Use the Qlik Import feature above or add Additional Fields.
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

      {/* Qlik Import Dialog */}
      <Dialog open={showQlikImport} onOpenChange={setShowQlikImport}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-thin flex items-center gap-2">
              <FileUp className="h-5 w-5" />
              Import Revenue Formula from Qlik
            </DialogTitle>
            <DialogDescription className="font-light">
              Paste your Qlik revenue formula below. Fields in square brackets
              (e.g., [Field Name]) will be automatically mapped to database
              columns.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Instructions */}
            <Alert className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
              <Info className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-700 dark:text-blue-300 text-sm">
                <strong>Supported format:</strong> Qlik-style formulas with
                field names in square brackets.
                <br />
                <span className="font-mono text-xs">
                  Example: [Field A] + [Field B] - [Field C]
                </span>
              </AlertDescription>
            </Alert>

            {/* Formula Input */}
            <div className="space-y-2">
              <Label htmlFor="qlik-formula">Qlik Formula</Label>
              <Textarea
                id="qlik-formula"
                value={qlikFormulaText}
                onChange={(e) => {
                  setQlikFormulaText(e.target.value);
                  setQlikParseResult(null); // Clear previous parse result
                }}
                placeholder="Paste your Qlik formula here, e.g.:
[Purchase Advice Sell Amount] + [Line 800 Total Borrower Paid Amount] - [Fees Appraisal Fee Borr] + [Line 800 Total Seller Paid Amount] - [Lender Credits]"
                rows={4}
                className="font-mono text-sm"
              />
            </div>

            {/* Parse Button */}
            <Button
              onClick={handleParseQlikFormula}
              disabled={!qlikFormulaText.trim()}
              variant="outline"
              className="w-full"
            >
              <ArrowRight className="h-4 w-4 mr-2" />
              Parse Formula
            </Button>

            {/* Parse Results */}
            {qlikParseResult && (
              <div className="space-y-4">
                <Separator />

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    Parsed Fields
                    <Badge variant="secondary">
                      {qlikParseResult.components.length} found
                    </Badge>
                    {qlikParseResult.unmappedFields.length > 0 && (
                      <Badge variant="destructive">
                        {qlikParseResult.unmappedFields.length} unmapped
                      </Badge>
                    )}
                  </Label>

                  <div className="max-h-[200px] overflow-y-auto space-y-2 p-3 bg-slate-50 dark:bg-slate-800/30 rounded-lg">
                    {qlikParseResult.components.map((comp, index) => (
                      <div
                        key={index}
                        className={cn(
                          "flex items-center gap-3 p-2 rounded border",
                          comp.dbField
                            ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800"
                            : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"
                        )}
                      >
                        <Badge variant="outline" className="w-8 justify-center">
                          {comp.operator}
                        </Badge>
                        <div className="flex-1">
                          <div className="text-sm font-medium">
                            {comp.qlikName}
                          </div>
                          {comp.dbField ? (
                            <div className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" />→{" "}
                              {comp.dbField}
                            </div>
                          ) : (
                            <div className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                              <AlertCircle className="h-3 w-3" />
                              Not mapped - will be skipped
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Unmapped Fields Warning */}
                {qlikParseResult.unmappedFields.length > 0 && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      <strong>Unmapped fields:</strong> The following fields
                      could not be automatically mapped and will be skipped:
                      <ul className="mt-1 text-xs">
                        {qlikParseResult.unmappedFields.map((field, i) => (
                          <li key={i}>• {field}</li>
                        ))}
                      </ul>
                      <span className="text-xs mt-2 block">
                        You can manually add these fields after import if they
                        exist in your database.
                      </span>
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowQlikImport(false);
                setQlikFormulaText("");
                setQlikParseResult(null);
              }}
              className="font-light"
            >
              Cancel
            </Button>
            <Button
              onClick={handleImportQlikFormula}
              disabled={
                !qlikParseResult ||
                qlikParseResult.components.filter((c) => c.dbField).length === 0
              }
              className="font-light"
            >
              <FileUp className="h-4 w-4 mr-2" />
              Import{" "}
              {qlikParseResult
                ? `(${
                    qlikParseResult.components.filter((c) => c.dbField).length
                  } fields)`
                : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
