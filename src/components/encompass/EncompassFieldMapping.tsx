/**
 * Encompass Field Mapping Component
 * UI for managing client-specific Encompass field ID mappings (field swaps)
 * Enhanced with auto-discovery, smart suggestions, and bulk actions
 */

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Command as CommandPrimitive } from "cmdk";
import { Progress } from "@/components/ui/progress";
import {
  Trash2,
  Edit2,
  Search,
  CheckCircle2,
  ChevronsUpDown,
  Sparkles,
  Loader2,
  TrendingUp,
  AlertTriangle,
  HelpCircle,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  X,
  Calendar,
  Hash,
  Type,
  ToggleLeft,
  DollarSign,
  Percent,
  Check,
  ChevronDown,
  ChevronRight,
  Layers,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

// Types for auto-mapping suggestions
interface MappingSuggestion {
  coheusAlias: string;
  postgresqlColumn: string;
  defaultFieldId: string | null;
  suggestedFieldId: string | null;
  suggestedFieldDescription?: string;
  confidence: number;
  confidenceLevel: "high" | "medium" | "low" | "none";
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

// Field data types for UI display
type FieldDataType =
  | "date"
  | "number"
  | "string"
  | "boolean"
  | "currency"
  | "percentage";

// Field category type
type FieldCategory =
  | "loan_info"
  | "property"
  | "borrower"
  | "pricing"
  | "investor"
  | "underwriting"
  | "dates"
  | "team"
  | "arm"
  | "payment_mi"
  | "heloc"
  | "compliance"
  | "fees";

// Category info from API
interface CategoryInfo {
  category: FieldCategory;
  label: string;
  description: string;
  order: number;
}

interface FieldMapping {
  coheusAlias: string;
  defaultEncompassFieldId: string;
  postgresqlColumn: string;
  isValid?: boolean; // Whether default field ID exists in RDB
  swappedFieldId?: string; // Current swapped field ID if exists
  category: FieldCategory;
  categoryLabel: string;
  categoryOrder: number;
  fieldType: FieldDataType;
  criticality?: "critical" | "non_critical";
  isCritical?: boolean;
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
  isPlatformAdmin?: boolean;
}


export function EncompassFieldMapping({
  losConnectionId,
  tenantId,
  isPlatformAdmin = false,
}: EncompassFieldMappingProps) {
  const { toast } = useToast();
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [rdbFields, setRdbFields] = useState<EncompassRdbField[]>([]);
  const [swaps, setSwaps] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAlias, setEditingAlias] = useState<string | null>(null);
  const [newFieldId, setNewFieldId] = useState("");
  const [fieldSearchQuery, setFieldSearchQuery] = useState(""); // Separate search for RDB field dropdown
  const [fieldPopoverOpen, setFieldPopoverOpen] = useState(false);
  const commandInputRef =
    React.useRef<React.ElementRef<typeof CommandPrimitive.Input>>(null);

  // Auto-discovery state
  const [suggestions, setSuggestions] = useState<MappingSuggestion[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(
    new Set()
  );
  const [isApplyingSuggestions, setIsApplyingSuggestions] = useState(false);
  const [suggestionStats, setSuggestionStats] = useState({
    highConfidenceCount: 0,
    mediumConfidenceCount: 0,
    lowConfidenceCount: 0,
    unmappedCount: 0,
  });

  // Sorting and filtering state
  type SortField =
    | "coheusAlias"
    | "postgresqlColumn"
    | "status"
    | "defaultFieldId"
    | "confidence";
  type SortDirection = "asc" | "desc";

  const [sortField, setSortField] = useState<SortField>("status");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc"); // Invalid fields first by default
  const [filterMode, setFilterMode] = useState<"all" | "invalid">("all");
  const [fixPopoverOpen, setFixPopoverOpen] = useState<string | null>(null); // Track which field's popover is open


  // Category state
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [criticalCounts, setCriticalCounts] = useState<{
    critical: number;
    nonCritical: number;
  }>({ critical: 0, nonCritical: 0 });
  const [selectedCategory, setSelectedCategory] = useState<
    FieldCategory | "all"
  >("all");
  const [criticalityFilter, setCriticalityFilter] = useState<
    "all" | "critical" | "standard"
  >("all");
  const [expandedCategories, setExpandedCategories] = useState<
    Set<FieldCategory>
  >(new Set());

  // Focus the input when popover opens
  useEffect(() => {
    if (fieldPopoverOpen) {
      const timer = setTimeout(() => {
        const input = document.querySelector(
          "[cmdk-input]"
        ) as HTMLInputElement;
        if (input) {
          input.focus();
          input.select();
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [fieldPopoverOpen]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      if (!tenantId) {
        toast({
          title: "Error",
          description: "Tenant ID is required to load field mappings",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      if (!losConnectionId) {
        toast({
          title: "Error",
          description: "Connection ID is required to load field mappings",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      // Load field mappings (with categories)
      const mappingsResponse = await api.request<{
        mappings: FieldMapping[];
        categories: CategoryInfo[];
        criticalCounts?: { critical: number; nonCritical: number };
      }>("/api/encompass/field-mappings");

      if (mappingsResponse.categories) {
        setCategories(mappingsResponse.categories);
      }
      if (mappingsResponse.criticalCounts) {
        setCriticalCounts(mappingsResponse.criticalCounts);
      }

      // Load saved field swaps
      const swapsResponse = await api.request<{ swaps: FieldSwap[] }>(
        `/api/encompass/field-swaps/${losConnectionId}?tenant_id=${tenantId}`
      );

      // Load RDB fields separately - may fail if Encompass auth fails, but that's OK
      let rdbFieldsResponse: {
        rdbFields: EncompassRdbField[];
        warning?: string;
        error?: string;
      };
      try {
        rdbFieldsResponse = await api.request<{
          rdbFields: EncompassRdbField[];
          warning?: string;
          error?: string;
        }>(`/api/encompass/fields/${losConnectionId}?tenant_id=${tenantId}`);
      } catch (error: any) {
        rdbFieldsResponse = {
          rdbFields: [],
          warning: "Unable to fetch RDB fields for validation",
        };
      }

      // Show warning if RDB fields couldn't be loaded
      if (rdbFieldsResponse.warning || rdbFieldsResponse.error) {
        toast({
          title: "Warning",
          description:
            rdbFieldsResponse.warning ||
            rdbFieldsResponse.error ||
            "RDB fields unavailable - validation disabled",
          variant: "default",
        });
      }

      setRdbFields(rdbFieldsResponse.rdbFields || []);

      // Build swaps map
      const swapsMap = new Map<string, string>();
      (swapsResponse.swaps || []).forEach((swap) => {
        swapsMap.set(swap.coheusAlias, swap.encompassFieldId);
      });
      setSwaps(swapsMap);

      // Validate each mapping against RDB fields
      setValidating(true);
      const rdbFieldIds = new Set(
        (rdbFieldsResponse.rdbFields || []).map((f) => f.fieldID)
      );

      const mappingsArray = mappingsResponse.mappings || [];

      const validatedMappings = mappingsArray.map((mapping) => {
        const swappedFieldId = swapsMap.get(mapping.coheusAlias);
        const effectiveFieldId =
          swappedFieldId || mapping.defaultEncompassFieldId;

        // RDB fields might be in format "3142" or "Fields.3142", so try multiple formats
        const normalizedFieldId = effectiveFieldId.replace(/^Fields\./, "");
        const withFieldsPrefix = effectiveFieldId.startsWith("Fields.")
          ? effectiveFieldId
          : `Fields.${effectiveFieldId}`;

        const isValid =
          rdbFieldIds.has(effectiveFieldId) ||
          rdbFieldIds.has(normalizedFieldId) ||
          rdbFieldIds.has(withFieldsPrefix);

        return {
          ...mapping,
          isValid,
          swappedFieldId: swappedFieldId || undefined,
        };
      });

      setMappings(validatedMappings);
      setValidating(false);
    } catch (error: any) {
      console.error("Failed to load field mappings:", error);
      toast({
        title: "Error",
        description: "Failed to load field mappings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [losConnectionId, tenantId, toast]);

  // Load field mappings and swaps on mount / when connection or tenant changes
  useEffect(() => {
    if (losConnectionId && tenantId) {
      loadData();
    }
  }, [loadData]);

  const handleSaveSwap = async (alias: string, fieldId: string) => {
    try {
      if (!tenantId) {
        toast({
          title: "Error",
          description: "Tenant ID is required to save field mappings",
          variant: "destructive",
        });
        return;
      }

      await api.request(`/api/encompass/field-swaps?tenant_id=${tenantId}`, {
        method: "POST",
        body: JSON.stringify({
          losConnectionId,
          coheusAlias: alias,
          encompassFieldId: fieldId,
          swapType: "Standard",
        }),
      });

      // Update local state without triggering a full reload
      const newSwaps = new Map(swaps);
      newSwaps.set(alias, fieldId);
      setSwaps(newSwaps);

      // Re-validate the updated mapping locally
      const rdbFieldIds = new Set(rdbFields.map((f) => f.fieldID));
      setMappings((prev) =>
        prev.map((m) => {
          if (m.coheusAlias !== alias) return m;
          const normalizedFieldId = fieldId.replace(/^Fields\./, "");
          const withFieldsPrefix = fieldId.startsWith("Fields.")
            ? fieldId
            : `Fields.${fieldId}`;
          const isValid =
            rdbFieldIds.has(fieldId) ||
            rdbFieldIds.has(normalizedFieldId) ||
            rdbFieldIds.has(withFieldsPrefix);
          return { ...m, swappedFieldId: fieldId, isValid };
        })
      );

      toast({
        title: "Saved",
        description: `${alias} mapped to ${fieldId}`,
      });

      setIsDialogOpen(false);
      setEditingAlias(null);
      setNewFieldId("");
    } catch (error: any) {
      console.error("Error saving field swap:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to save field swap",
        variant: "destructive",
      });
    }
  };

  const handleDeleteSwap = async (alias: string) => {
    try {
      if (!tenantId) {
        toast({
          title: "Error",
          description: "Tenant ID is required to delete field mappings",
          variant: "destructive",
        });
        return;
      }

      await api.request(
        `/api/encompass/field-swaps/${losConnectionId}?tenant_id=${tenantId}`,
        {
          method: "DELETE",
          body: JSON.stringify({
            coheusAlias: alias,
          }),
        }
      );

      // Update local state without triggering a full reload
      const newSwaps = new Map(swaps);
      newSwaps.delete(alias);
      setSwaps(newSwaps);

      // Re-validate using the default field ID
      const rdbFieldIds = new Set(rdbFields.map((f) => f.fieldID));
      setMappings((prev) =>
        prev.map((m) => {
          if (m.coheusAlias !== alias) return m;
          const defaultId = m.defaultEncompassFieldId;
          const normalizedFieldId = defaultId.replace(/^Fields\./, "");
          const withFieldsPrefix = defaultId.startsWith("Fields.")
            ? defaultId
            : `Fields.${defaultId}`;
          const isValid =
            rdbFieldIds.has(defaultId) ||
            rdbFieldIds.has(normalizedFieldId) ||
            rdbFieldIds.has(withFieldsPrefix);
          return { ...m, swappedFieldId: undefined, isValid };
        })
      );

      toast({
        title: "Reverted",
        description: `${alias} restored to default mapping`,
      });
    } catch (error: any) {
      console.error("Error deleting field swap:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete field swap",
        variant: "destructive",
      });
    }
  };

  const openEditDialog = (alias: string, currentFieldId?: string) => {
    setEditingAlias(alias);
    setNewFieldId(currentFieldId || "");
    setFieldSearchQuery(""); // Reset search when opening dialog
    setFieldPopoverOpen(false); // Close popover when opening dialog
    setIsDialogOpen(true);
  };

  // ============================================================================
  // Auto-Discovery Handlers
  // ============================================================================

  const handleAnalyzeFields = useCallback(async () => {
    if (!tenantId || !losConnectionId) {
      toast({
        title: "Error",
        description: "Tenant ID and Connection ID are required",
        variant: "destructive",
      });
      return;
    }

    setIsAnalyzing(true);
    setAnalyzeProgress(10);
    setShowSuggestions(false);
    setSuggestions([]);
    setSelectedSuggestions(new Set());

    try {
      // Step 1: Run analysis
      setAnalyzeProgress(30);

      const response = await api.request<SuggestionsResponse>(
        `/api/encompass/discovery/suggestions/${losConnectionId}?tenant_id=${tenantId}&run_analysis=true&sample_size=50`
      );

      setAnalyzeProgress(60);

      if (response.success && response.suggestions) {
        setSuggestions(response.suggestions);
        setSuggestionStats({
          highConfidenceCount: response.highConfidenceCount,
          mediumConfidenceCount: response.mediumConfidenceCount,
          lowConfidenceCount: response.lowConfidenceCount,
          unmappedCount: response.unmappedCount,
        });

        // Step 2: Auto-apply high-confidence suggestions
        const highConfidenceFixes = response.suggestions.filter(
          (s) =>
            s.confidenceLevel === "high" &&
            s.suggestedFieldId &&
            s.suggestedFieldId !== s.defaultFieldId
        );

        if (highConfidenceFixes.length > 0) {
          setAnalyzeProgress(80);

          const suggestionsToApply = highConfidenceFixes.map((s) => ({
            coheusAlias: s.coheusAlias,
            fieldId: s.suggestedFieldId!,
          }));

          try {
            const applyResponse = await api.request<{
              success: boolean;
              applied: number;
              errors: string[];
            }>(
              `/api/encompass/discovery/apply/${losConnectionId}?tenant_id=${tenantId}`,
              {
                method: "POST",
                body: JSON.stringify({ suggestions: suggestionsToApply }),
              }
            );

            if (applyResponse.success && applyResponse.applied > 0) {
              toast({
                title: "Auto-Fix Applied",
                description: `Applied ${applyResponse.applied} high-confidence fix${applyResponse.applied !== 1 ? "es" : ""}. ${response.mediumConfidenceCount + response.lowConfidenceCount} fields need manual review.`,
              });

              // Reload field data only (not the parent)
              await loadData();
            }

            if (applyResponse.errors && applyResponse.errors.length > 0) {
              console.warn("Some auto-fixes failed:", applyResponse.errors);
            }
          } catch (applyError: any) {
            console.error("Error applying auto-fixes:", applyError);
            // Still show the suggestions for manual review
            setShowSuggestions(true);
            toast({
              title: "Partial Auto-Fix",
              description: `Analysis found ${response.highConfidenceCount} fixes but failed to apply them. Use the Fix button on each field.`,
              variant: "destructive",
            });
          }
        } else {
          // No high-confidence fixes found, show suggestions for manual review
          setShowSuggestions(true);
          toast({
            title: "Analysis Complete",
            description: `No high-confidence fixes found. ${response.mediumConfidenceCount} medium-confidence suggestions available -- use the Fix button on each field to review.`,
          });
        }
      }
    } catch (error: any) {
      console.error("Error analyzing fields:", error);
      toast({
        title: "Analysis Failed",
        description: error.message || "Failed to analyze fields",
        variant: "destructive",
      });
    } finally {
      setAnalyzeProgress(100);
      setTimeout(() => {
        setIsAnalyzing(false);
        setAnalyzeProgress(0);
      }, 500);
    }
  }, [tenantId, losConnectionId, toast, loadData]);

  const handleToggleSuggestion = useCallback((alias: string) => {
    setSelectedSuggestions((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(alias)) {
        newSet.delete(alias);
      } else {
        newSet.add(alias);
      }
      return newSet;
    });
  }, []);

  const handleSelectAllByConfidence = useCallback(
    (level: "high" | "medium" | "low" | "all") => {
      const toSelect = suggestions.filter((s) => {
        if (!s.suggestedFieldId) return false;
        if (level === "all") return s.confidenceLevel !== "none";
        return s.confidenceLevel === level;
      });

      setSelectedSuggestions(new Set(toSelect.map((s) => s.coheusAlias)));
    },
    [suggestions]
  );

  const handleApplySelectedSuggestions = useCallback(async () => {
    if (selectedSuggestions.size === 0) {
      toast({
        title: "No Suggestions Selected",
        description: "Please select at least one suggestion to apply",
        variant: "default",
      });
      return;
    }

    if (!tenantId || !losConnectionId) {
      toast({
        title: "Error",
        description: "Tenant ID and Connection ID are required",
        variant: "destructive",
      });
      return;
    }

    setIsApplyingSuggestions(true);

    try {
      const suggestionsToApply = suggestions
        .filter(
          (s) => selectedSuggestions.has(s.coheusAlias) && s.suggestedFieldId
        )
        .map((s) => ({
          coheusAlias: s.coheusAlias,
          fieldId: s.suggestedFieldId!,
        }));

      const response = await api.request<{
        success: boolean;
        applied: number;
        errors: string[];
      }>(
        `/api/encompass/discovery/apply/${losConnectionId}?tenant_id=${tenantId}`,
        {
          method: "POST",
          body: JSON.stringify({ suggestions: suggestionsToApply }),
        }
      );

      if (response.success) {
        toast({
          title: "Mappings Applied",
          description: `Successfully applied ${response.applied} field mappings`,
        });

        // Refresh field data only (not the parent)
        setShowSuggestions(false);
        setSelectedSuggestions(new Set());
        await loadData();
      }

      if (response.errors && response.errors.length > 0) {
        console.warn(
          "Some mappings failed:",
          response.errors
        );
      }
    } catch (error: any) {
      console.error(
        "[EncompassFieldMapping] Error applying suggestions:",
        error
      );
      toast({
        title: "Error",
        description: error.message || "Failed to apply suggestions",
        variant: "destructive",
      });
    } finally {
      setIsApplyingSuggestions(false);
    }
  }, [
    selectedSuggestions,
    suggestions,
    tenantId,
    losConnectionId,
    toast,
  ]);

  const getConfidenceBadge = (
    level: "high" | "medium" | "low" | "none",
    confidence: number
  ) => {
    switch (level) {
      case "high":
        return (
          <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {confidence}%
          </Badge>
        );
      case "medium":
        return (
          <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-0">
            <TrendingUp className="h-3 w-3 mr-1" />
            {confidence}%
          </Badge>
        );
      case "low":
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

  // Helper function to get suggestions for a specific alias
  // Only returns high-confidence suggestions (>= 70%) to avoid showing bad matches
  const getSuggestionsForAlias = useCallback(
    (alias: string) => {
      return suggestions
        .filter(
          (s) =>
            s.coheusAlias === alias && s.suggestedFieldId && s.confidence >= 70
        )
        .sort((a, b) => b.confidence - a.confidence); // Highest confidence first
    },
    [suggestions]
  );

  // Check if analysis has been run (even if no good suggestions)
  const hasAnalysisRun = useCallback(
    (alias: string) => {
      return suggestions.some((s) => s.coheusAlias === alias);
    },
    [suggestions]
  );

  // Get the best confidence score for a mapping (from all suggestions for that alias)
  const getConfidenceForMapping = useCallback(
    (alias: string): number => {
      const allSuggestions = suggestions.filter(
        (s) => s.coheusAlias === alias && s.suggestedFieldId
      );
      if (allSuggestions.length === 0) return -1; // No suggestions = lowest priority
      return Math.max(...allSuggestions.map((s) => s.confidence));
    },
    [suggestions]
  );

  // Calculate invalid fields count
  const invalidFieldsCount = mappings.filter((m) => !m.isValid).length;

  // Calculate category stats
  const categoryStats = React.useMemo(() => {
    const stats: Record<FieldCategory, { total: number; invalid: number }> =
      {} as Record<FieldCategory, { total: number; invalid: number }>;
    for (const mapping of mappings) {
      if (!stats[mapping.category]) {
        stats[mapping.category] = { total: 0, invalid: 0 };
      }
      stats[mapping.category].total++;
      if (!mapping.isValid) {
        stats[mapping.category].invalid++;
      }
    }
    return stats;
  }, [mappings]);

  // Group mappings by category
  const mappingsByCategory = React.useMemo(() => {
    const grouped: Record<FieldCategory, FieldMapping[]> = {} as Record<
      FieldCategory,
      FieldMapping[]
    >;
    for (const mapping of mappings) {
      if (!grouped[mapping.category]) {
        grouped[mapping.category] = [];
      }
      grouped[mapping.category].push(mapping);
    }
    return grouped;
  }, [mappings]);

  // Toggle category expansion
  const toggleCategory = (category: FieldCategory) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  // Expand all categories
  const expandAllCategories = () => {
    setExpandedCategories(new Set(categories.map((c) => c.category)));
  };

  // Collapse all categories
  const collapseAllCategories = () => {
    setExpandedCategories(new Set());
  };

  // Filter and sort mappings
  const filteredMappings = mappings
    .filter((mapping) => {
      // Apply search filter
      const matchesSearch =
        mapping.coheusAlias.toLowerCase().includes(searchQuery.toLowerCase()) ||
        mapping.defaultEncompassFieldId
          .toLowerCase()
          .includes(searchQuery.toLowerCase()) ||
        mapping.postgresqlColumn
          .toLowerCase()
          .includes(searchQuery.toLowerCase());

      // Apply category filter
      const matchesCategory =
        selectedCategory === "all" || mapping.category === selectedCategory;

      // Apply criticality filter
      const matchesCriticality =
        criticalityFilter === "all" ||
        (criticalityFilter === "critical" && !!mapping.isCritical) ||
        (criticalityFilter === "standard" && !mapping.isCritical);

      // Apply invalid filter
      if (filterMode === "invalid") {
        return (
          matchesSearch &&
          matchesCategory &&
          matchesCriticality &&
          !mapping.isValid
        );
      }
      return matchesSearch && matchesCategory && matchesCriticality;
    })
    .sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case "coheusAlias":
          comparison = a.coheusAlias.localeCompare(b.coheusAlias);
          break;
        case "postgresqlColumn":
          comparison = a.postgresqlColumn.localeCompare(b.postgresqlColumn);
          break;
        case "defaultFieldId":
          comparison = a.defaultEncompassFieldId.localeCompare(
            b.defaultEncompassFieldId
          );
          break;
        case "status":
          // Invalid fields (false) should come before valid fields (true) when desc
          comparison = a.isValid === b.isValid ? 0 : a.isValid ? 1 : -1;
          break;
        case "confidence": {
          // Sort by confidence score from suggestions
          const confA = getConfidenceForMapping(a.coheusAlias);
          const confB = getConfidenceForMapping(b.coheusAlias);
          comparison = confA - confB;
          break;
        }
        default:
          comparison = 0;
      }

      return sortDirection === "desc" ? -comparison : comparison;
    });

  // Handle column header click for sorting
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  // Get sort icon for a column
  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="h-3 w-3 ml-1 opacity-50" />;
    }
    return sortDirection === "asc" ? (
      <ArrowUp className="h-3 w-3 ml-1" />
    ) : (
      <ArrowDown className="h-3 w-3 ml-1" />
    );
  };

  // Get icon for field data type
  const getFieldTypeIcon = (fieldType: FieldDataType) => {
    switch (fieldType) {
      case "date":
        return <Calendar className="h-3.5 w-3.5 text-blue-500" />;
      case "currency":
        return <DollarSign className="h-3.5 w-3.5 text-green-500" />;
      case "percentage":
        return <Percent className="h-3.5 w-3.5 text-purple-500" />;
      case "number":
        return <Hash className="h-3.5 w-3.5 text-orange-500" />;
      case "boolean":
        return <ToggleLeft className="h-3.5 w-3.5 text-pink-500" />;
      default:
        return <Type className="h-3.5 w-3.5 text-slate-400" />;
    }
  };

  // Get label for field data type
  const getFieldTypeLabel = (fieldType: FieldDataType) => {
    switch (fieldType) {
      case "date":
        return "Date";
      case "currency":
        return "Currency";
      case "percentage":
        return "Percentage";
      case "number":
        return "Number";
      case "boolean":
        return "Boolean";
      default:
        return "Text";
    }
  };

  // ============================================================================
  // Legacy Config Import Handlers
  // ============================================================================


  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-slate-500">
            Loading field mappings...
          </div>
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
              Map Coheus field aliases to your Encompass Reporting Database
              (RDB) field IDs. Invalid fields need to be fixed - the field may
              need to be added to your RDB or mapped to a different ID.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-0">
              Critical: {criticalCounts.critical}
            </Badge>
            <Badge variant="secondary">
              Standard: {criticalCounts.nonCritical}
            </Badge>
          </div>

          {/* Analysis Progress - shown inline when running */}
          {isAnalyzing && (
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 flex items-center gap-3">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                Analyzing fields... This may take a moment.
              </span>
              <Progress
                value={analyzeProgress}
                className="h-2 flex-1 max-w-xs"
              />
            </div>
          )}

          {/* Search and Filter Toolbar */}
          <div className="space-y-3">
            {/* Row 1: Search + Category + Criticality + Filter */}
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search by alias or field ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Category Filter */}
              <Select
                value={selectedCategory}
                onValueChange={(value) =>
                  setSelectedCategory(value as FieldCategory | "all")
                }
              >
                <SelectTrigger className="w-[200px] shrink-0">
                  <Layers className="h-3 w-3 mr-2" />
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    All Categories ({mappings.length})
                  </SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.category} value={cat.category}>
                      <div className="flex items-center justify-between w-full">
                        <span>{cat.label}</span>
                        <span className="ml-2 text-xs text-slate-500">
                          ({categoryStats[cat.category]?.total || 0})
                          {(categoryStats[cat.category]?.invalid || 0) > 0 && (
                            <span className="text-red-500 ml-1">
                              {categoryStats[cat.category]?.invalid} invalid
                            </span>
                          )}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Criticality Filter */}
              <Select
                value={criticalityFilter}
                onValueChange={(value) =>
                  setCriticalityFilter(value as "all" | "critical" | "standard")
                }
              >
                <SelectTrigger className="w-[180px] shrink-0">
                  <SelectValue placeholder="Criticality" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Criticality</SelectItem>
                  <SelectItem value="critical">
                    Critical ({criticalCounts.critical})
                  </SelectItem>
                  <SelectItem value="standard">
                    Standard ({criticalCounts.nonCritical})
                  </SelectItem>
                </SelectContent>
              </Select>

              {/* Valid / Invalid Filter */}
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant={filterMode === "all" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilterMode("all")}
                >
                  All
                </Button>
                <Button
                  variant={filterMode === "invalid" ? "destructive" : "outline"}
                  size="sm"
                  onClick={() => setFilterMode("invalid")}
                >
                  {invalidFieldsCount > 0 ? `${invalidFieldsCount} Invalid` : "Invalid"}
                </Button>
              </div>

              {/* Expand/Collapse All */}
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={expandAllCategories}
                  className="h-8 px-2"
                  title="Expand all categories"
                >
                  <ChevronDown className="h-3 w-3" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={collapseAllCategories}
                  className="h-8 px-2"
                  title="Collapse all categories"
                >
                  <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            </div>

            {/* Row 2: Auto-Fix action bar (only when invalid fields exist) */}
            {isPlatformAdmin && invalidFieldsCount > 0 && (
              <div className="flex items-center gap-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                <span className="text-sm text-amber-800 dark:text-amber-200">
                  {invalidFieldsCount} field{invalidFieldsCount !== 1 ? "s" : ""} could not be validated against your Encompass RDB.
                </span>
                <Button
                  size="sm"
                  onClick={() => {
                    setFilterMode("invalid");
                    handleAnalyzeFields();
                  }}
                  disabled={isAnalyzing}
                  className="ml-auto shrink-0"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3 w-3 mr-1" />
                      Auto-Fix
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>


          {/* Field Mappings - Categorized Accordion */}
          <div className="space-y-2">
            {filteredMappings.length === 0 ? (
              <div className="text-center text-slate-500 py-8 border rounded-lg">
                {validating
                  ? "Validating fields..."
                  : "No field mappings found"}
              </div>
            ) : (
              categories
                .filter((cat) => {
                  // Only show categories that have filtered mappings
                  return filteredMappings.some(
                    (m) => m.category === cat.category
                  );
                })
                .map((cat) => {
                  const categoryMappings = filteredMappings.filter(
                    (m) => m.category === cat.category
                  );
                  const categoryInvalidCount = categoryMappings.filter(
                    (m) => !m.isValid
                  ).length;
                  const isExpanded = expandedCategories.has(cat.category);

                  return (
                    <Collapsible
                      key={cat.category}
                      open={isExpanded}
                      onOpenChange={() => toggleCategory(cat.category)}
                    >
                      <CollapsibleTrigger className="w-full">
                        <div
                          className={cn(
                            "flex items-center justify-between p-3 rounded-lg border bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors",
                            categoryInvalidCount > 0 &&
                              "border-l-4 border-l-amber-400"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-slate-500" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-slate-500" />
                            )}
                            <span className="font-medium">{cat.label}</span>
                            <Badge variant="secondary" className="text-xs">
                              {categoryMappings.length} field
                              {categoryMappings.length !== 1 ? "s" : ""}
                            </Badge>
                            {categoryInvalidCount > 0 && (
                              <Badge variant="destructive" className="text-xs">
                                <AlertTriangle className="h-3 w-3 mr-1" />
                                {categoryInvalidCount} invalid
                              </Badge>
                            )}
                          </div>
                          <span className="text-xs text-slate-500">
                            {cat.description}
                          </span>
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="mt-1 border rounded-lg overflow-hidden">
                          <div className="w-full overflow-x-auto">
                            <Table className="table-fixed w-full">
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-[22%] min-w-[140px]">
                                    Field
                                  </TableHead>
                                  <TableHead className="w-[6%] min-w-[50px]">
                                    Type
                                  </TableHead>
                                  <TableHead className="w-[12%] min-w-[80px]">
                                    Status
                                  </TableHead>
                                  <TableHead className="w-[30%] min-w-[200px]">
                                    Encompass Field ID
                                  </TableHead>
                                  <TableHead className="w-[14%] min-w-[80px]">
                                    Actions
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {categoryMappings.map((mapping) => {
                                  const swappedFieldId = mapping.swappedFieldId;
                                  const effectiveFieldId =
                                    swappedFieldId ||
                                    mapping.defaultEncompassFieldId;
                                  const isValid = mapping.isValid ?? false;
                                  const isSwapped = !!swappedFieldId;
                                  const fieldSuggestions =
                                    getSuggestionsForAlias(mapping.coheusAlias);

                                  return (
                                    <TableRow
                                      key={mapping.coheusAlias}
                                      className={cn(
                                        "transition-colors",
                                        !isValid &&
                                          "bg-red-50 dark:bg-red-900/20 border-l-4 border-l-red-500"
                                      )}
                                    >
                                      {/* Field name */}
                                      <TableCell
                                        className="font-medium"
                                        title={`${mapping.coheusAlias}\nDB column: ${mapping.postgresqlColumn}`}
                                      >
                                        <div className="flex items-center gap-2">
                                          <span className="text-sm">{mapping.coheusAlias}</span>
                                          {mapping.isCritical ? (
                                            <Badge className="h-5 px-1.5 text-[10px] bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-0">
                                              Critical
                                            </Badge>
                                          ) : (
                                            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                                              Standard
                                            </Badge>
                                          )}
                                        </div>
                                      </TableCell>
                                      {/* Type */}
                                      <TableCell>
                                        <div
                                          className="flex items-center gap-1"
                                          title={getFieldTypeLabel(mapping.fieldType)}
                                        >
                                          {getFieldTypeIcon(mapping.fieldType)}
                                        </div>
                                      </TableCell>
                                      {/* Status */}
                                      <TableCell>
                                        {isValid ? (
                                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                                        ) : (
                                          <Badge variant="destructive" className="text-xs">
                                            Invalid
                                          </Badge>
                                        )}
                                      </TableCell>
                                      {/* Encompass Field ID */}
                                      <TableCell>
                                        <div className="flex items-center gap-2">
                                          <span
                                            className="font-mono text-xs text-slate-700 dark:text-slate-300 break-all"
                                            title={effectiveFieldId}
                                          >
                                            {effectiveFieldId}
                                          </span>
                                          {isSwapped && (
                                            <Badge variant="outline" className="text-xs shrink-0">
                                              Custom
                                            </Badge>
                                          )}
                                        </div>
                                      </TableCell>
                                      <TableCell>
                                        <div className="flex items-center gap-1 flex-wrap">
                                          {/* Fix button with suggestion popover for invalid fields */}
                                          {isPlatformAdmin && !isValid && (
                                            <Popover
                                              open={
                                                fixPopoverOpen ===
                                                mapping.coheusAlias
                                              }
                                              onOpenChange={(open) =>
                                                setFixPopoverOpen(
                                                  open
                                                    ? mapping.coheusAlias
                                                    : null
                                                )
                                              }
                                            >
                                              <PopoverTrigger asChild>
                                                <Button
                                                  variant="ghost"
                                                  size="sm"
                                                  className="h-8 px-2 shrink-0 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                                                  title="Quick fix suggestions"
                                                >
                                                  <Sparkles className="h-4 w-4 mr-1" />
                                                  <span className="text-xs">
                                                    Fix
                                                  </span>
                                                </Button>
                                              </PopoverTrigger>
                                              <PopoverContent
                                                className="w-96 p-0"
                                                align="start"
                                              >
                                                <div className="p-3 border-b">
                                                  <h4 className="font-medium text-sm">
                                                    Fix: {mapping.coheusAlias}
                                                  </h4>
                                                  <p className="text-xs text-slate-500 mt-1">
                                                    Default field:{" "}
                                                    <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">
                                                      {
                                                        mapping.defaultEncompassFieldId
                                                      }
                                                    </code>
                                                  </p>
                                                </div>

                                                {/* High confidence suggestions */}
                                                {fieldSuggestions.length >
                                                  0 && (
                                                  <>
                                                    <div className="px-3 py-2 bg-emerald-50 dark:bg-emerald-900/20 border-b">
                                                      <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                                                        High Confidence Matches
                                                      </p>
                                                    </div>
                                                    <div className="max-h-48 overflow-y-auto">
                                                      {fieldSuggestions.map(
                                                        (s) => (
                                                          <div
                                                            key={
                                                              s.suggestedFieldId
                                                            }
                                                            className="flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer border-b last:border-b-0"
                                                            onClick={() => {
                                                              handleSaveSwap(
                                                                mapping.coheusAlias,
                                                                s.suggestedFieldId!
                                                              );
                                                              setFixPopoverOpen(
                                                                null
                                                              );
                                                            }}
                                                          >
                                                            <div className="flex-1 min-w-0">
                                                              <p className="font-mono text-sm truncate">
                                                                {
                                                                  s.suggestedFieldId
                                                                }
                                                              </p>
                                                              {s.suggestedFieldDescription && (
                                                                <p className="text-xs text-slate-500 truncate">
                                                                  {
                                                                    s.suggestedFieldDescription
                                                                  }
                                                                </p>
                                                              )}
                                                            </div>
                                                            <Badge className="ml-2 shrink-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                                                              {s.confidence}%
                                                            </Badge>
                                                          </div>
                                                        )
                                                      )}
                                                    </div>
                                                  </>
                                                )}

                                                {/* No good matches found - suggest field may need to be added */}
                                                {hasAnalysisRun(
                                                  mapping.coheusAlias
                                                ) &&
                                                  fieldSuggestions.length ===
                                                    0 && (
                                                    <div className="p-4 bg-amber-50 dark:bg-amber-900/20">
                                                      <div className="flex items-start gap-2">
                                                        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                                                        <div>
                                                          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                                                            No confident match
                                                            found
                                                          </p>
                                                          <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                                                            This field may need
                                                            to be added to the
                                                            Encompass Reporting
                                                            Database (RDB).
                                                            Contact your
                                                            Encompass
                                                            administrator to add
                                                            the field, or use
                                                            the Edit button to
                                                            manually select a
                                                            field if you know
                                                            the correct ID.
                                                          </p>
                                                        </div>
                                                      </div>
                                                    </div>
                                                  )}

                                                {/* Analysis not run yet */}
                                                {!hasAnalysisRun(
                                                  mapping.coheusAlias
                                                ) && (
                                                  <div className="p-4 text-center">
                                                    <p className="text-sm text-slate-500 mb-3">
                                                      Click to analyze and find
                                                      suggestions
                                                    </p>
                                                    <Button
                                                      size="sm"
                                                      onClick={() => {
                                                        setFixPopoverOpen(null);
                                                        handleAnalyzeFields();
                                                      }}
                                                    >
                                                      <Sparkles className="h-3 w-3 mr-1" />
                                                      Analyze Fields
                                                    </Button>
                                                  </div>
                                                )}

                                                {/* Manual selection option */}
                                                <div className="p-3 border-t bg-slate-50 dark:bg-slate-800/50">
                                                  <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="w-full"
                                                    onClick={() => {
                                                      setFixPopoverOpen(null);
                                                      openEditDialog(
                                                        mapping.coheusAlias,
                                                        swappedFieldId ||
                                                          mapping.defaultEncompassFieldId
                                                      );
                                                    }}
                                                  >
                                                    <Edit2 className="h-3 w-3 mr-2" />
                                                    Browse All RDB Fields
                                                  </Button>
                                                </div>
                                              </PopoverContent>
                                            </Popover>
                                          )}
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 w-8 p-0 shrink-0"
                                            onClick={() =>
                                              openEditDialog(
                                                mapping.coheusAlias,
                                                swappedFieldId ||
                                                  mapping.defaultEncompassFieldId
                                              )
                                            }
                                            title={
                                              isValid
                                                ? "Change field mapping"
                                                : "Select valid field"
                                            }
                                          >
                                            <Edit2
                                              className={`h-4 w-4 ${
                                                !isValid ? "text-amber-500" : ""
                                              }`}
                                            />
                                          </Button>
                                          {isSwapped && (
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-8 w-8 p-0 shrink-0"
                                              onClick={() =>
                                                handleDeleteSwap(
                                                  mapping.coheusAlias
                                                )
                                              }
                                              title="Remove swap (use default)"
                                            >
                                              <Trash2 className="h-4 w-4 text-red-500" />
                                            </Button>
                                          )}
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })
            )}
          </div>

          {/* Edit Dialog */}
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingAlias ? "Edit Field Mapping" : "Add Field Mapping"}
                </DialogTitle>
                <DialogDescription>
                  {editingAlias && (
                    <>
                      Update the Encompass field ID for{" "}
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
                            ?.defaultEncompassFieldId || ""
                        }
                        disabled
                      />
                    </div>
                    <div>
                      <Label>Encompass Field ID</Label>
                      {rdbFields.length > 0 ? (
                        <Popover
                          open={fieldPopoverOpen}
                          onOpenChange={setFieldPopoverOpen}
                          modal={false}
                        >
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              role="combobox"
                              aria-expanded={fieldPopoverOpen}
                              className="w-full justify-between"
                              type="button"
                            >
                              {newFieldId
                                ? rdbFields.find(
                                    (field) => field.fieldID === newFieldId
                                  )?.fieldID || newFieldId
                                : "Select a field from your RDB..."}
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
                                const input = document.querySelector(
                                  "[cmdk-input]"
                                ) as HTMLInputElement;
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
                                <CommandEmpty>
                                  No matching fields found.
                                </CommandEmpty>
                                <CommandGroup>
                                  {rdbFields
                                    .filter((field) => {
                                      if (!fieldSearchQuery.trim()) return true;
                                      const searchLower =
                                        fieldSearchQuery.toLowerCase();
                                      return (
                                        field.fieldID
                                          .toLowerCase()
                                          .includes(searchLower) ||
                                        field.description
                                          ?.toLowerCase()
                                          .includes(searchLower) ||
                                        field.fieldID
                                          .replace(/^Fields\./, "")
                                          .includes(searchLower)
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
                                          setFieldSearchQuery("");
                                        }}
                                      >
                                        <Check
                                          className={cn(
                                            "mr-2 h-4 w-4",
                                            newFieldId === field.fieldID
                                              ? "opacity-100"
                                              : "opacity-0"
                                          )}
                                        />
                                        <div className="flex flex-col">
                                          <span className="font-mono text-xs font-semibold">
                                            {field.fieldID}
                                          </span>
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
                          Selected:{" "}
                          <span className="font-mono font-semibold">
                            {newFieldId}
                          </span>
                          {rdbFields.find((f) => f.fieldID === newFieldId)
                            ?.description && (
                            <div className="text-slate-500 mt-1">
                              {
                                rdbFields.find((f) => f.fieldID === newFieldId)
                                  ?.description
                              }
                            </div>
                          )}
                        </div>
                      )}
                      <p className="text-xs text-slate-500 mt-1">
                        {rdbFields.length > 0
                          ? `Select from ${rdbFields.length} available RDB fields. Start typing to search and filter.`
                          : "Enter the Encompass field ID used in your instance"}
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
                    setNewFieldId("");
                    setFieldSearchQuery("");
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
