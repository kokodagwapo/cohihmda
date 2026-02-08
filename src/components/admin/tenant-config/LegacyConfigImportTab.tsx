/**
 * Legacy Config Import Tab
 *
 * Allows tenant admins to upload a legacy Coheus XML configuration file
 * and import field swaps and additional fields from it.
 */

import { useState, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Upload,
  FileText,
  ArrowRightLeft,
  Plus,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Info,
  RefreshCw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

// Types
interface FieldSwap {
  alias: string;
  clientFieldId: string;
  defaultFieldId: string;
  reason: "different_mapping" | "new_field_id_swap";
}

interface AdditionalField {
  alias: string;
  fieldId: string;
  columnName: string;
  dataType: "string" | "number" | "date" | "boolean" | "currency";
  category: string;
  source: "data_dictionary" | "adhoc" | "field_swap";
}

interface ImportAnalysis {
  clientName: string;
  clientId: string;
  totalFieldsInXml: number;
  fieldSwaps: FieldSwap[];
  additionalFields: AdditionalField[];
  matchingFields: number;
  warnings: string[];
}

interface ImportResult {
  success: boolean;
  fieldSwapsCreated: number;
  additionalFieldsCreated: number;
  errors: string[];
}

interface LOSConnection {
  id: string;
  name: string;
  provider: string;
}

interface LegacyConfigImportTabProps {
  tenantId: string;
}

export function LegacyConfigImportTab({
  tenantId,
}: LegacyConfigImportTabProps) {
  const { toast } = useToast();

  // State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [losConnections, setLosConnections] = useState<LOSConnection[]>([]);
  const [selectedConnection, setSelectedConnection] = useState<string>("");
  const [loadingConnections, setLoadingConnections] = useState(false);

  // Selection state
  const [selectedSwaps, setSelectedSwaps] = useState<Set<string>>(new Set());
  const [selectedAdditional, setSelectedAdditional] = useState<Set<string>>(
    new Set()
  );
  const [importSwaps, setImportSwaps] = useState(true);
  const [importAdditional, setImportAdditional] = useState(true);

  // Load LOS connections
  const loadConnections = useCallback(async () => {
    setLoadingConnections(true);
    try {
      const response = await api.request<{ connections: LOSConnection[] }>(
        `/api/tenant-config/los-connections?tenant_id=${tenantId}`
      );
      setLosConnections(response.connections || []);
      if (response.connections?.length === 1) {
        setSelectedConnection(response.connections[0].id);
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to load LOS connections",
        variant: "destructive",
      });
    } finally {
      setLoadingConnections(false);
    }
  }, [tenantId, toast]);

  // Handle file upload
  const handleFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      // Validate file type
      if (!file.name.endsWith(".xml")) {
        toast({
          title: "Invalid file type",
          description: "Please upload an XML file",
          variant: "destructive",
        });
        return;
      }

      setIsAnalyzing(true);
      setAnalysis(null);
      setImportResult(null);

      try {
        const xmlContent = await file.text();

        const response = await api.request<{ analysis: ImportAnalysis }>(
          `/api/tenant-config/legacy-import/analyze?tenant_id=${tenantId}`,
          {
            method: "POST",
            body: JSON.stringify({ xmlContent }),
          }
        );

        const analysisData = response.analysis;
        setAnalysis(analysisData);

        // Select all by default
        setSelectedSwaps(new Set(analysisData.fieldSwaps.map((s) => s.alias)));
        setSelectedAdditional(
          new Set(analysisData.additionalFields.map((f) => f.alias))
        );

        // Load connections if not already loaded
        if (losConnections.length === 0) {
          await loadConnections();
        }

        toast({
          title: "Analysis Complete",
          description: `Found ${analysisData.fieldSwaps.length} field swaps and ${analysisData.additionalFields.length} additional fields`,
        });
      } catch (error: any) {
        toast({
          title: "Analysis Failed",
          description: error.response?.data?.error || error.message,
          variant: "destructive",
        });
      } finally {
        setIsAnalyzing(false);
      }
    },
    [tenantId, losConnections.length, loadConnections, toast]
  );

  // Handle import
  const handleImport = useCallback(async () => {
    if (!analysis || !selectedConnection) {
      toast({
        title: "Missing selection",
        description: "Please select an LOS connection",
        variant: "destructive",
      });
      return;
    }

    setIsImporting(true);
    setImportResult(null);

    try {
      const response = await api.request<{ result: ImportResult }>(
        `/api/tenant-config/legacy-import/execute?tenant_id=${tenantId}`,
        {
          method: "POST",
          body: JSON.stringify({
            losConnectionId: selectedConnection,
            analysis,
            options: {
              importFieldSwaps: importSwaps,
              importAdditionalFields: importAdditional,
              selectedSwaps: importSwaps ? Array.from(selectedSwaps) : [],
              selectedAdditional: importAdditional
                ? Array.from(selectedAdditional)
                : [],
            },
          }),
        }
      );

      const result = response.result;
      setImportResult(result);

      if (result.success) {
        toast({
          title: "Import Successful",
          description: `Created ${result.fieldSwapsCreated} field swaps and ${result.additionalFieldsCreated} additional fields`,
        });
      } else {
        toast({
          title: "Import Completed with Errors",
          description: `${result.errors.length} errors occurred`,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Import Failed",
        description: error.response?.data?.error || error.message,
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  }, [
    analysis,
    selectedConnection,
    importSwaps,
    importAdditional,
    selectedSwaps,
    selectedAdditional,
    tenantId,
    toast,
  ]);

  // Toggle selection helpers
  const toggleSwap = (alias: string) => {
    setSelectedSwaps((prev) => {
      const next = new Set(prev);
      if (next.has(alias)) {
        next.delete(alias);
      } else {
        next.add(alias);
      }
      return next;
    });
  };

  const toggleAdditional = (alias: string) => {
    setSelectedAdditional((prev) => {
      const next = new Set(prev);
      if (next.has(alias)) {
        next.delete(alias);
      } else {
        next.add(alias);
      }
      return next;
    });
  };

  const selectAllSwaps = () => {
    if (analysis) {
      setSelectedSwaps(new Set(analysis.fieldSwaps.map((s) => s.alias)));
    }
  };

  const selectNoneSwaps = () => {
    setSelectedSwaps(new Set());
  };

  const selectAllAdditional = () => {
    if (analysis) {
      setSelectedAdditional(
        new Set(analysis.additionalFields.map((f) => f.alias))
      );
    }
  };

  const selectNoneAdditional = () => {
    setSelectedAdditional(new Set());
  };

  const reset = () => {
    setAnalysis(null);
    setImportResult(null);
    setSelectedSwaps(new Set());
    setSelectedAdditional(new Set());
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import Legacy Configuration
          </CardTitle>
          <CardDescription>
            Upload a legacy Coheus XML configuration file to import field
            mappings. This will create field swaps for fields with different
            Encompass IDs and additional fields for custom fields not in the
            default set.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div>
              <input
                type="file"
                accept=".xml"
                onChange={handleFileUpload}
                className="hidden"
                id="xml-upload"
                disabled={isAnalyzing}
              />
              <label htmlFor="xml-upload">
                <Button asChild disabled={isAnalyzing}>
                  <span>
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <FileText className="mr-2 h-4 w-4" />
                        Select XML File
                      </>
                    )}
                  </span>
                </Button>
              </label>
            </div>

            {analysis && (
              <Button variant="outline" onClick={reset}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Start Over
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Analysis Results */}
      {analysis && (
        <>
          {/* Summary Card */}
          <Card>
            <CardHeader>
              <CardTitle>Analysis Results</CardTitle>
              <CardDescription>
                Client: {analysis.clientName || analysis.clientId}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-2xl font-bold">
                    {analysis.totalFieldsInXml}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Total Fields in XML
                  </div>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-2xl font-bold text-green-600">
                    {analysis.matchingFields}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Matching (No Action)
                  </div>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-2xl font-bold text-orange-600">
                    {analysis.fieldSwaps.length}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Field Swaps Needed
                  </div>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">
                    {analysis.additionalFields.length}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Additional Fields
                  </div>
                </div>
              </div>

              {analysis.warnings.length > 0 && (
                <Alert className="mt-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Warnings</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4 mt-2">
                      {analysis.warnings.map((warning, i) => (
                        <li key={i}>{warning}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Field Swaps */}
          {analysis.fieldSwaps.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <ArrowRightLeft className="h-5 w-5" />
                      Field Swaps ({selectedSwaps.size} /{" "}
                      {analysis.fieldSwaps.length} selected)
                    </CardTitle>
                    <CardDescription>
                      These fields use different Encompass field IDs than the
                      defaults
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="import-swaps"
                      checked={importSwaps}
                      onCheckedChange={(checked) => setImportSwaps(!!checked)}
                    />
                    <Label htmlFor="import-swaps">Import Swaps</Label>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 mb-4">
                  <Button variant="outline" size="sm" onClick={selectAllSwaps}>
                    Select All
                  </Button>
                  <Button variant="outline" size="sm" onClick={selectNoneSwaps}>
                    Select None
                  </Button>
                </div>
                <div className="border rounded-lg max-h-[400px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12"></TableHead>
                        <TableHead>Alias</TableHead>
                        <TableHead>Default Field ID</TableHead>
                        <TableHead>Client Field ID</TableHead>
                        <TableHead>Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analysis.fieldSwaps.map((swap) => (
                        <TableRow key={swap.alias}>
                          <TableCell>
                            <Checkbox
                              checked={selectedSwaps.has(swap.alias)}
                              onCheckedChange={() => toggleSwap(swap.alias)}
                              disabled={!importSwaps}
                            />
                          </TableCell>
                          <TableCell className="font-medium">
                            {swap.alias}
                          </TableCell>
                          <TableCell className="font-mono text-sm text-muted-foreground">
                            {swap.defaultFieldId}
                          </TableCell>
                          <TableCell className="font-mono text-sm text-orange-600">
                            {swap.clientFieldId}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {swap.reason === "different_mapping"
                                ? "Different ID"
                                : "Explicit Swap"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Additional Fields */}
          {analysis.additionalFields.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Plus className="h-5 w-5" />
                      Additional Fields ({selectedAdditional.size} /{" "}
                      {analysis.additionalFields.length} selected)
                    </CardTitle>
                    <CardDescription>
                      Custom fields not in the default 260 - will create new
                      columns
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="import-additional"
                      checked={importAdditional}
                      onCheckedChange={(checked) =>
                        setImportAdditional(!!checked)
                      }
                    />
                    <Label htmlFor="import-additional">
                      Import Additional Fields
                    </Label>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 mb-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={selectAllAdditional}
                  >
                    Select All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={selectNoneAdditional}
                  >
                    Select None
                  </Button>
                </div>
                <div className="border rounded-lg max-h-[400px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12"></TableHead>
                        <TableHead>Alias</TableHead>
                        <TableHead>Field ID</TableHead>
                        <TableHead>Column Name</TableHead>
                        <TableHead>Data Type</TableHead>
                        <TableHead>Source</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analysis.additionalFields.map((field) => (
                        <TableRow key={field.alias}>
                          <TableCell>
                            <Checkbox
                              checked={selectedAdditional.has(field.alias)}
                              onCheckedChange={() =>
                                toggleAdditional(field.alias)
                              }
                              disabled={!importAdditional}
                            />
                          </TableCell>
                          <TableCell className="font-medium">
                            {field.alias}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {field.fieldId}
                          </TableCell>
                          <TableCell className="font-mono text-sm text-muted-foreground">
                            {field.columnName}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">{field.dataType}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{field.source}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Import Action */}
          <Card>
            <CardHeader>
              <CardTitle>Import Configuration</CardTitle>
              <CardDescription>
                Select the LOS connection and confirm the import
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <Label htmlFor="los-connection">LOS Connection</Label>
                  <Select
                    value={selectedConnection}
                    onValueChange={setSelectedConnection}
                  >
                    <SelectTrigger id="los-connection" className="mt-1">
                      <SelectValue placeholder="Select a connection..." />
                    </SelectTrigger>
                    <SelectContent>
                      {losConnections.map((conn) => (
                        <SelectItem key={conn.id} value={conn.id}>
                          {conn.name} ({conn.provider})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={loadConnections}
                  variant="outline"
                  disabled={loadingConnections}
                >
                  <RefreshCw
                    className={`h-4 w-4 ${
                      loadingConnections ? "animate-spin" : ""
                    }`}
                  />
                </Button>
              </div>

              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Import Summary</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4 mt-2">
                    {importSwaps && selectedSwaps.size > 0 && (
                      <li>
                        {selectedSwaps.size} field swap(s) will be
                        created/updated
                      </li>
                    )}
                    {importAdditional && selectedAdditional.size > 0 && (
                      <li>
                        {selectedAdditional.size} additional field(s) will be
                        created
                      </li>
                    )}
                    {(!importSwaps || selectedSwaps.size === 0) &&
                      (!importAdditional || selectedAdditional.size === 0) && (
                        <li>No changes will be made</li>
                      )}
                  </ul>
                </AlertDescription>
              </Alert>

              <Button
                onClick={handleImport}
                disabled={
                  isImporting ||
                  !selectedConnection ||
                  ((!importSwaps || selectedSwaps.size === 0) &&
                    (!importAdditional || selectedAdditional.size === 0))
                }
                className="w-full"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Import Selected Fields
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Import Result */}
          {importResult && (
            <Alert variant={importResult.success ? "default" : "destructive"}>
              {importResult.success ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              <AlertTitle>
                {importResult.success
                  ? "Import Complete"
                  : "Import Completed with Errors"}
              </AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4 mt-2">
                  <li>
                    {importResult.fieldSwapsCreated} field swap(s) created
                  </li>
                  <li>
                    {importResult.additionalFieldsCreated} additional field(s)
                    created
                  </li>
                  {importResult.errors.length > 0 && (
                    <li className="text-red-600">
                      {importResult.errors.length} error(s):
                      <ul className="list-disc pl-4 mt-1">
                        {importResult.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </li>
                  )}
                </ul>
                {importResult.success && (
                  <p className="mt-2 text-sm">
                    Remember to trigger a sync to pull data for the new fields.
                  </p>
                )}
              </AlertDescription>
            </Alert>
          )}
        </>
      )}
    </div>
  );
}
