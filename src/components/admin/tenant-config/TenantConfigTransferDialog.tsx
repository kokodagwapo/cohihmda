/**
 * TenantConfigTransferDialog
 *
 * Platform-admin-only dialog for exporting and importing
 * a tenant's entire configuration as a JSON file.
 */

import { useState, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Upload,
  Loader2,
  FileJson,
  ArrowRight,
  Link2,
  AlertTriangle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAdminTenant } from "@/contexts/AdminTenantContext";

// ---------------------------------------------------------------------------
// Types (mirrors server-side types)
// ---------------------------------------------------------------------------

interface LosConnectionRef {
  id: string;
  name: string;
  losType: string;
}

interface TenantConfigExport {
  version: string;
  exportedAt: string;
  exportedBy: string;
  sourceTenant: { id: string; name: string; slug: string };
  losConnections: LosConnectionRef[];
  config: Record<string, any[]>;
}

interface ValidationReport {
  valid: boolean;
  version: string;
  sourceTenant: { id: string; name: string; slug: string };
  sectionCounts: Record<string, number>;
  unmappedConnections: LosConnectionRef[];
  conflicts: Record<string, number>;
  warnings: string[];
}

interface SectionImportResult {
  section: string;
  imported: number;
  skipped: number;
  deleted: number;
  errors: string[];
}

interface ImportResult {
  success: boolean;
  sections: SectionImportResult[];
  totalImported: number;
  totalSkipped: number;
  totalErrors: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SECTION_LABELS: Record<string, string> = {
  encompassFieldSwaps: "Encompass Field Swaps",
  additionalFieldDefinitions: "Additional Field Definitions",
  customFields: "Custom Fields Dictionary",
  scoringWeights: "Scoring Weights",
  complexityComponents: "Complexity Components",
  staffingUnitTargets: "Staffing Unit Targets",
  tenantCalculations: "Revenue/Margin Calculations",
  personas: "Personas",
  savedFilters: "Saved Filters (Org)",
  rangeRules: "Range / Guideline Rules",
};

const ALL_SECTIONS = Object.keys(SECTION_LABELS);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TenantConfigTransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  losConnections: any[];
}

export function TenantConfigTransferDialog({
  open,
  onOpenChange,
  losConnections,
}: TenantConfigTransferDialogProps) {
  const { toast } = useToast();
  const { selectedTenantId, currentTenantName } = useAdminTenant();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mode: "choose" | "export" | "import"
  const [mode, setMode] = useState<"choose" | "export" | "import">("choose");

  // Export state
  const [exportSections, setExportSections] = useState<Set<string>>(
    new Set(ALL_SECTIONS),
  );
  const [exporting, setExporting] = useState(false);

  // Import state
  const [importFile, setImportFile] = useState<TenantConfigExport | null>(null);
  const [importFileName, setImportFileName] = useState<string>("");
  const [importSections, setImportSections] = useState<Set<string>>(
    new Set(ALL_SECTIONS),
  );
  const [overwrite, setOverwrite] = useState(false);
  const [connectionMapping, setConnectionMapping] = useState<
    Record<string, string>
  >({});
  const [validationReport, setValidationReport] =
    useState<ValidationReport | null>(null);
  const [validating, setValidating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Reset all state when dialog is closed or mode changes
  const resetState = useCallback(() => {
    setMode("choose");
    setExportSections(new Set(ALL_SECTIONS));
    setExporting(false);
    setImportFile(null);
    setImportFileName("");
    setImportSections(new Set(ALL_SECTIONS));
    setOverwrite(false);
    setConnectionMapping({});
    setValidationReport(null);
    setValidating(false);
    setImporting(false);
    setImportResult(null);
  }, []);

  const handleOpenChange = (open: boolean) => {
    if (!open) resetState();
    onOpenChange(open);
  };

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  const handleExport = async () => {
    if (!selectedTenantId) return;
    setExporting(true);
    try {
      const data = await api.request<TenantConfigExport>(
        `/api/admin/tenant-config-transfer/export?tenant_id=${selectedTenantId}`,
      );

      // Filter sections if user unchecked some
      if (exportSections.size < ALL_SECTIONS.length) {
        for (const key of ALL_SECTIONS) {
          if (!exportSections.has(key)) {
            data.config[key] = [];
          }
        }
      }

      // Trigger download
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const slug = data.sourceTenant?.slug || "tenant";
      const date = new Date().toISOString().split("T")[0];
      a.download = `tenant-config-${slug}-${date}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Export Complete",
        description: `Configuration exported for ${data.sourceTenant?.name || "tenant"}`,
      });
    } catch (error: any) {
      toast({
        title: "Export Failed",
        description: error.message || "Could not export configuration",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Import - File Selection
  // -------------------------------------------------------------------------

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".json")) {
      toast({
        title: "Invalid File",
        description: "Please select a JSON file",
        variant: "destructive",
      });
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as TenantConfigExport;

      if (!parsed.version || !parsed.config) {
        toast({
          title: "Invalid Format",
          description:
            "This file does not appear to be a valid tenant config export",
          variant: "destructive",
        });
        return;
      }

      setImportFile(parsed);
      setImportFileName(file.name);

      // Pre-select sections that have data
      const withData = ALL_SECTIONS.filter(
        (s) => Array.isArray(parsed.config[s]) && parsed.config[s].length > 0,
      );
      setImportSections(new Set(withData));

      // Pre-fill connection mapping if only one target connection
      if (
        parsed.losConnections?.length > 0 &&
        losConnections.length === 1
      ) {
        const mapping: Record<string, string> = {};
        for (const src of parsed.losConnections) {
          mapping[src.id] = losConnections[0].id;
        }
        setConnectionMapping(mapping);
      }
    } catch {
      toast({
        title: "Parse Error",
        description: "Could not parse the selected JSON file",
        variant: "destructive",
      });
    }

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // -------------------------------------------------------------------------
  // Import - Validate
  // -------------------------------------------------------------------------

  const handleValidate = async () => {
    if (!selectedTenantId || !importFile) return;
    setValidating(true);
    try {
      const report = await api.request<ValidationReport>(
        `/api/admin/tenant-config-transfer/validate?tenant_id=${selectedTenantId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            importData: importFile,
            options: {
              overwrite,
              connectionMapping,
              selectedSections: Array.from(importSections),
            },
          }),
        },
      );
      setValidationReport(report);
    } catch (error: any) {
      toast({
        title: "Validation Failed",
        description: error.message || "Could not validate import",
        variant: "destructive",
      });
    } finally {
      setValidating(false);
    }
  };

  // -------------------------------------------------------------------------
  // Import - Execute
  // -------------------------------------------------------------------------

  const handleImport = async () => {
    if (!selectedTenantId || !importFile) return;
    setImporting(true);
    try {
      const result = await api.request<ImportResult>(
        `/api/admin/tenant-config-transfer/import?tenant_id=${selectedTenantId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            importData: importFile,
            options: {
              overwrite,
              connectionMapping,
              selectedSections: Array.from(importSections),
            },
          }),
        },
      );
      setImportResult(result);

      if (result.success) {
        toast({
          title: "Import Complete",
          description: `Imported ${result.totalImported} records across ${result.sections.length} sections`,
        });
      } else {
        toast({
          title: "Import Completed with Errors",
          description: `${result.totalImported} imported, ${result.totalErrors} errors`,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Import Failed",
        description: error.message || "Could not import configuration",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Section toggle helpers
  // -------------------------------------------------------------------------

  const toggleExportSection = (section: string) => {
    setExportSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const toggleImportSection = (section: string) => {
    setImportSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  // Figure out which source connections need mapping
  const sourceConnectionsNeeded = importFile
    ? (importFile.losConnections || []).filter((conn) => {
        // Only show connections referenced by field swaps or additional fields
        const hasSwaps = (importFile.config.encompassFieldSwaps || []).some(
          (s: any) => s.los_connection_id === conn.id,
        );
        const hasFields = (
          importFile.config.additionalFieldDefinitions || []
        ).some((f: any) => f.los_connection_id === conn.id);
        return hasSwaps || hasFields;
      })
    : [];

  const allConnectionsMapped =
    sourceConnectionsNeeded.length === 0 ||
    sourceConnectionsNeeded.every((c) => connectionMapping[c.id]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-medium">
            Configuration Transfer
          </DialogTitle>
          <DialogDescription>
            Export or import tenant configuration
            {currentTenantName ? ` for ${currentTenantName}` : ""}
          </DialogDescription>
        </DialogHeader>

        {/* ---- Mode Chooser ---- */}
        {mode === "choose" && (
          <div className="grid grid-cols-2 gap-4 pt-2">
            <Card
              className="cursor-pointer hover:border-indigo-400 transition-colors"
              onClick={() => setMode("export")}
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Download className="h-5 w-5 text-indigo-500" />
                  Export
                </CardTitle>
                <CardDescription className="text-sm font-light">
                  Download this tenant's configuration as a JSON file
                </CardDescription>
              </CardHeader>
            </Card>
            <Card
              className="cursor-pointer hover:border-indigo-400 transition-colors"
              onClick={() => setMode("import")}
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Upload className="h-5 w-5 text-indigo-500" />
                  Import
                </CardTitle>
                <CardDescription className="text-sm font-light">
                  Load configuration from a previously exported JSON file
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        )}

        {/* ---- Export Mode ---- */}
        {mode === "export" && (
          <div className="space-y-4 pt-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">
                  Select Sections to Export
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {ALL_SECTIONS.map((section) => (
                  <div
                    key={section}
                    className="flex items-center gap-3"
                  >
                    <Checkbox
                      id={`exp-${section}`}
                      checked={exportSections.has(section)}
                      onCheckedChange={() => toggleExportSection(section)}
                    />
                    <Label
                      htmlFor={`exp-${section}`}
                      className="text-sm font-light cursor-pointer"
                    >
                      {SECTION_LABELS[section]}
                    </Label>
                  </div>
                ))}
              </CardContent>
            </Card>

            <div className="flex justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMode("choose")}
              >
                Back
              </Button>
              <Button
                size="sm"
                onClick={handleExport}
                disabled={exporting || exportSections.size === 0}
              >
                {exporting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Export Configuration
              </Button>
            </div>
          </div>
        )}

        {/* ---- Import Mode ---- */}
        {mode === "import" && !importResult && (
          <div className="space-y-4 pt-2">
            {/* File upload */}
            {!importFile && (
              <Card>
                <CardContent className="py-8 flex flex-col items-center gap-3">
                  <FileJson className="h-12 w-12 text-slate-400" />
                  <p className="text-sm text-slate-500 font-light">
                    Select a tenant configuration JSON file
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleFileSelect}
                    className="hidden"
                    title="Select tenant configuration JSON file"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Choose File
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* File loaded — show details */}
            {importFile && (
              <>
                {/* Source info */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <FileJson className="h-4 w-4 text-indigo-500" />
                      {importFileName}
                    </CardTitle>
                    <CardDescription className="text-xs font-light">
                      Exported from{" "}
                      <span className="font-medium">
                        {importFile.sourceTenant?.name || "Unknown"}
                      </span>{" "}
                      on{" "}
                      {importFile.exportedAt
                        ? new Date(importFile.exportedAt).toLocaleDateString()
                        : "unknown date"}{" "}
                      by {importFile.exportedBy || "unknown"}
                    </CardDescription>
                  </CardHeader>
                </Card>

                {/* LOS Connection Mapping */}
                {sourceConnectionsNeeded.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Link2 className="h-4 w-4" />
                        LOS Connection Mapping
                      </CardTitle>
                      <CardDescription className="text-xs font-light">
                        Map source LOS connections to this tenant's connections
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {sourceConnectionsNeeded.map((src) => (
                        <div
                          key={src.id}
                          className="flex items-center gap-2"
                        >
                          <Badge
                            variant="secondary"
                            className="text-xs font-light shrink-0"
                          >
                            {src.name}
                          </Badge>
                          <ArrowRight className="h-3 w-3 text-slate-400 shrink-0" />
                          <Select
                            value={connectionMapping[src.id] || ""}
                            onValueChange={(val) =>
                              setConnectionMapping((prev) => ({
                                ...prev,
                                [src.id]: val,
                              }))
                            }
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Select target connection" />
                            </SelectTrigger>
                            <SelectContent>
                              {losConnections.map((conn: any) => (
                                <SelectItem
                                  key={conn.id}
                                  value={conn.id}
                                >
                                  {conn.connection_name || conn.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                      {!allConnectionsMapped && (
                        <p className="text-xs text-amber-600">
                          All connections must be mapped before import
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Section selection */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      Sections to Import
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {ALL_SECTIONS.map((section) => {
                      const count = Array.isArray(importFile.config[section])
                        ? importFile.config[section].length
                        : 0;
                      return (
                        <div
                          key={section}
                          className="flex items-center gap-3"
                        >
                          <Checkbox
                            id={`imp-${section}`}
                            checked={importSections.has(section)}
                            onCheckedChange={() =>
                              toggleImportSection(section)
                            }
                            disabled={count === 0}
                          />
                          <Label
                            htmlFor={`imp-${section}`}
                            className={`text-sm font-light cursor-pointer ${count === 0 ? "text-slate-400" : ""}`}
                          >
                            {SECTION_LABELS[section]}
                          </Label>
                          <Badge
                            variant={count > 0 ? "secondary" : "outline"}
                            className="text-xs ml-auto"
                          >
                            {count}
                          </Badge>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>

                {/* Overwrite toggle */}
                <div className="flex items-center justify-between px-1">
                  <div>
                    <Label className="text-sm font-medium">
                      Overwrite existing data
                    </Label>
                    <p className="text-xs text-slate-500 font-light">
                      Delete existing records in selected sections before
                      importing
                    </p>
                  </div>
                  <Switch checked={overwrite} onCheckedChange={setOverwrite} />
                </div>

                {overwrite && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle className="text-sm">Warning</AlertTitle>
                    <AlertDescription className="text-xs">
                      Overwrite mode will delete all existing records in the
                      selected sections before importing. This cannot be undone.
                    </AlertDescription>
                  </Alert>
                )}

                {/* Validation report */}
                {validationReport && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        {validationReport.valid ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-amber-500" />
                        )}
                        Validation{" "}
                        {validationReport.valid ? "Passed" : "Has Warnings"}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {Object.keys(validationReport.conflicts).length > 0 && (
                        <div className="text-xs text-slate-600">
                          <p className="font-medium mb-1">
                            Existing record conflicts:
                          </p>
                          {Object.entries(validationReport.conflicts).map(
                            ([section, count]) => (
                              <p key={section} className="ml-2 font-light">
                                {SECTION_LABELS[section] || section}: {count}{" "}
                                conflict(s)
                              </p>
                            ),
                          )}
                        </div>
                      )}
                      {validationReport.warnings.map((w, i) => (
                        <p
                          key={i}
                          className="text-xs text-amber-600 font-light"
                        >
                          {w}
                        </p>
                      ))}
                      {validationReport.valid &&
                        validationReport.warnings.length === 0 && (
                          <p className="text-xs text-green-600 font-light">
                            No issues detected. Ready to import.
                          </p>
                        )}
                    </CardContent>
                  </Card>
                )}

                {/* Actions */}
                <div className="flex justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setImportFile(null);
                      setImportFileName("");
                      setValidationReport(null);
                      setImportResult(null);
                    }}
                  >
                    Change File
                  </Button>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleValidate}
                      disabled={
                        validating ||
                        importSections.size === 0 ||
                        !allConnectionsMapped
                      }
                    >
                      {validating ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                      )}
                      Validate
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleImport}
                      disabled={
                        importing ||
                        importSections.size === 0 ||
                        !allConnectionsMapped
                      }
                    >
                      {importing ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Upload className="h-4 w-4 mr-2" />
                      )}
                      Import
                    </Button>
                  </div>
                </div>
              </>
            )}

            {/* Back button when no file loaded */}
            {!importFile && (
              <div className="flex justify-start">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setMode("choose")}
                >
                  Back
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ---- Import Results ---- */}
        {mode === "import" && importResult && (
          <div className="space-y-4 pt-2">
            <Alert variant={importResult.success ? "default" : "destructive"}>
              {importResult.success ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              <AlertTitle className="text-sm">
                Import {importResult.success ? "Successful" : "Completed with Errors"}
              </AlertTitle>
              <AlertDescription className="text-xs">
                {importResult.totalImported} records imported,{" "}
                {importResult.totalSkipped} skipped,{" "}
                {importResult.totalErrors} errors
              </AlertDescription>
            </Alert>

            <Card>
              <CardContent className="pt-4 space-y-2">
                {importResult.sections.map((sec) => (
                  <div
                    key={sec.section}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="font-light">
                      {SECTION_LABELS[sec.section] || sec.section}
                    </span>
                    <div className="flex items-center gap-2">
                      {sec.imported > 0 && (
                        <Badge
                          variant="secondary"
                          className="text-xs bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                        >
                          +{sec.imported}
                        </Badge>
                      )}
                      {sec.deleted > 0 && (
                        <Badge
                          variant="secondary"
                          className="text-xs bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                        >
                          -{sec.deleted}
                        </Badge>
                      )}
                      {sec.errors.length > 0 && (
                        <Badge variant="destructive" className="text-xs">
                          {sec.errors.length} err
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {importResult.sections.some((s) => s.errors.length > 0) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-red-600">
                    Errors
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  {importResult.sections
                    .flatMap((s) => s.errors)
                    .map((err, i) => (
                      <p key={i} className="text-xs text-red-600 font-light">
                        {err}
                      </p>
                    ))}
                </CardContent>
              </Card>
            )}

            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => handleOpenChange(false)}
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
