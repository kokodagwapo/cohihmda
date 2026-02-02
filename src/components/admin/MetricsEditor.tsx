import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Plus,
  Edit2,
  Trash2,
  Save,
  X,
  Play,
  Code,
  History,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ArrowLeft,
  Eye,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAdminTenant } from "@/contexts/AdminTenantContext";
import { cn } from "@/lib/utils";

interface MetricDefinition {
  id: string;
  metric_id?: string;
  name: string;
  description: string;
  category: string;
  formula?: string;
  sqlQuery?: string;
  sql_query?: string;
  defaultDateField?: string;
  default_date_field?: string;
  notes?: string;
  is_system?: boolean;
  is_override?: boolean;
  is_active?: boolean;
  version?: number;
}

interface HistoryEntry {
  id: string;
  action: string;
  old_value: MetricDefinition | null;
  new_value: MetricDefinition | null;
  changed_at: string;
  changed_by_name: string;
}

interface TestResult {
  success: boolean;
  result?: number | string;
  rowCount?: number;
  error?: string;
  hint?: string;
  query?: string;
}

const CATEGORIES = [
  { value: "status", label: "Status" },
  { value: "turn_time", label: "Turn Time" },
  { value: "revenue", label: "Revenue" },
  { value: "pull_through", label: "Pull-Through" },
  { value: "volume", label: "Volume" },
  { value: "count", label: "Count" },
  { value: "custom", label: "Custom" },
];

interface MetricsEditorProps {
  /** Pre-selected metric ID to edit */
  initialMetricId?: string;
  /** Callback when metric is saved */
  onSave?: (metric: MetricDefinition) => void;
  /** Callback to go back to catalog view */
  onBack?: () => void;
}

export function MetricsEditor({
  initialMetricId,
  onSave,
  onBack,
}: MetricsEditorProps) {
  const { toast } = useToast();
  const { selectedTenantId } = useAdminTenant();

  // Form state
  const [metricId, setMetricId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("custom");
  const [formula, setFormula] = useState("");
  const [sqlQuery, setSqlQuery] = useState("");
  const [defaultDateField, setDefaultDateField] = useState("");
  const [notes, setNotes] = useState("");
  const [ignoreDateFilter, setIgnoreDateFilter] = useState(false);

  // UI state
  const [isEditing, setIsEditing] = useState(!initialMetricId);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [currentMetric, setCurrentMetric] = useState<MetricDefinition | null>(
    null
  );

  // Load metric if editing
  useEffect(() => {
    if (initialMetricId) {
      loadMetric(initialMetricId);
      loadHistory(initialMetricId);
    }
  }, [initialMetricId, selectedTenantId]);

  const loadMetric = async (id: string) => {
    setLoading(true);
    try {
      const params = selectedTenantId ? `?tenant_id=${selectedTenantId}` : "";
      const response = await api.request<{ metrics: MetricDefinition[] }>(
        `/api/metrics/catalog${params}`
      );
      const metric = response.metrics?.find((m) => m.id === id);

      if (metric) {
        setCurrentMetric(metric);
        setMetricId(metric.id);
        setName(metric.name);
        setDescription(metric.description || "");
        setCategory(metric.category);
        setFormula(metric.formula || "");
        setSqlQuery(metric.sqlQuery || metric.sql_query || "");
        setDefaultDateField(
          metric.defaultDateField || metric.default_date_field || ""
        );
        setNotes(metric.notes || "");
      } else {
        toast({ title: "Metric not found", variant: "destructive" });
      }
    } catch (error: any) {
      toast({
        title: "Failed to load metric",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async (id: string) => {
    setLoadingHistory(true);
    try {
      const params = selectedTenantId ? `?tenant_id=${selectedTenantId}` : "";
      const response = await api.request<{ history: HistoryEntry[] }>(
        `/api/metrics/${id}/history${params}`
      );
      setHistory(response.history || []);
    } catch (error) {
      // History might not exist for in-memory catalog metrics
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleTest = async () => {
    if (!sqlQuery.trim()) {
      toast({
        title: "SQL Query required",
        description: "Enter a SQL query to test",
        variant: "destructive",
      });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const params = selectedTenantId ? `?tenant_id=${selectedTenantId}` : "";
      const response = await api.request<TestResult>(
        `/api/metrics/${metricId || "test"}/test${params}`,
        {
          method: "POST",
          body: JSON.stringify({ sqlQuery }),
        }
      );
      setTestResult(response);

      if (response.success) {
        toast({
          title: "Query test passed",
          description: `Result: ${response.result}`,
        });
      }
    } catch (error: any) {
      setTestResult({
        success: false,
        error: error.message || "Test failed",
        hint: "Check your SQL syntax and column names",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    // Validation
    if (!metricId.trim()) {
      toast({ title: "Metric ID required", variant: "destructive" });
      return;
    }
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    if (!sqlQuery.trim()) {
      toast({ title: "SQL Query required", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const params = selectedTenantId ? `?tenant_id=${selectedTenantId}` : "";
      const payload = {
        metricId,
        name,
        description,
        category,
        formula,
        sqlQuery,
        defaultDateField: defaultDateField || null,
        notes: notes || null,
        ignoreDateFilter,
      };

      let response;
      if (initialMetricId) {
        // Update existing
        response = await api.request<{ metric: MetricDefinition }>(
          `/api/metrics/${initialMetricId}${params}`,
          {
            method: "PUT",
            body: JSON.stringify(payload),
          }
        );
        toast({ title: "Metric updated", description: response.metric.name });
      } else {
        // Create new
        response = await api.request<{ metric: MetricDefinition }>(
          `/api/metrics${params}`,
          {
            method: "POST",
            body: JSON.stringify(payload),
          }
        );
        toast({ title: "Metric created", description: response.metric.name });
      }

      setCurrentMetric(response.metric);
      setIsEditing(false);
      onSave?.(response.metric);
    } catch (error: any) {
      toast({
        title: "Failed to save metric",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!initialMetricId) return;

    try {
      const params = selectedTenantId ? `?tenant_id=${selectedTenantId}` : "";
      await api.request(`/api/metrics/${initialMetricId}${params}`, {
        method: "DELETE",
      });
      toast({ title: "Metric deleted" });
      setDeleteDialogOpen(false);
      onBack?.();
    } catch (error: any) {
      toast({
        title: "Failed to delete metric",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const resetForm = () => {
    if (currentMetric) {
      setMetricId(currentMetric.id);
      setName(currentMetric.name);
      setDescription(currentMetric.description || "");
      setCategory(currentMetric.category);
      setFormula(currentMetric.formula || "");
      setSqlQuery(currentMetric.sqlQuery || currentMetric.sql_query || "");
      setDefaultDateField(
        currentMetric.defaultDateField || currentMetric.default_date_field || ""
      );
      setNotes(currentMetric.notes || "");
    }
    setIsEditing(false);
    setTestResult(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        <span className="ml-2 text-slate-500">Loading metric...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {onBack && (
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Catalog
            </Button>
          )}
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
              {initialMetricId
                ? isEditing
                  ? "Edit Metric"
                  : "Metric Details"
                : "Create New Metric"}
            </h2>
            {currentMetric && (
              <div className="flex items-center gap-2 mt-1">
                {currentMetric.is_system && (
                  <Badge variant="secondary" className="text-xs">
                    System
                  </Badge>
                )}
                {currentMetric.is_override && (
                  <Badge variant="outline" className="text-xs text-amber-600">
                    Override
                  </Badge>
                )}
                {currentMetric.version && (
                  <Badge variant="outline" className="text-xs">
                    v{currentMetric.version}
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {initialMetricId && !isEditing && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditing(true)}
              >
                <Edit2 className="w-4 h-4 mr-1" />
                Edit
              </Button>
              {!currentMetric?.is_system && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600 hover:bg-red-50"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  Delete
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <Tabs defaultValue="details" className="w-full">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="sql">SQL Query</TabsTrigger>
          {initialMetricId && (
            <TabsTrigger value="history">History</TabsTrigger>
          )}
        </TabsList>

        {/* Details Tab */}
        <TabsContent value="details" className="space-y-4 mt-4">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="metricId">Metric ID</Label>
                  <Input
                    id="metricId"
                    value={metricId}
                    onChange={(e) =>
                      setMetricId(
                        e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_")
                      )
                    }
                    placeholder="e.g., avg_cycle_time"
                    disabled={!isEditing || !!initialMetricId}
                    className="font-mono"
                  />
                  <p className="text-xs text-slate-500">
                    Unique identifier (lowercase, underscores)
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <Select
                    value={category}
                    onValueChange={setCategory}
                    disabled={!isEditing}
                  >
                    <SelectTrigger id="category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((cat) => (
                        <SelectItem key={cat.value} value={cat.value}>
                          {cat.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">Display Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Average Cycle Time"
                  disabled={!isEditing}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe what this metric measures and how it should be interpreted..."
                  rows={3}
                  disabled={!isEditing}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="defaultDateField">Default Date Field</Label>
                  <Input
                    id="defaultDateField"
                    value={defaultDateField}
                    onChange={(e) => setDefaultDateField(e.target.value)}
                    placeholder="e.g., application_date"
                    disabled={!isEditing}
                    className="font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="formula">Formula (Human-readable)</Label>
                  <Input
                    id="formula"
                    value={formula}
                    onChange={(e) => setFormula(e.target.value)}
                    placeholder="e.g., Avg([App-Close])"
                    disabled={!isEditing}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes & Caveats</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Document any estimation methodology, data quality notes, or caveats..."
                  rows={2}
                  disabled={!isEditing}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SQL Query Tab */}
        <TabsContent value="sql" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Code className="w-4 h-4" />
                SQL Query
              </CardTitle>
              <CardDescription>
                PostgreSQL SELECT expression that calculates the metric value
                from the loans table (aliased as 'l')
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={sqlQuery}
                onChange={(e) => setSqlQuery(e.target.value)}
                placeholder={`Example:
AVG(CASE 
  WHEN l.closing_date IS NOT NULL AND l.application_date IS NOT NULL 
  THEN DATE(l.closing_date) - DATE(l.application_date) 
  ELSE NULL 
END)`}
                rows={10}
                disabled={!isEditing}
                className="font-mono text-sm"
              />

              {isEditing && (
                <div className="flex items-center justify-between">
                  <Button
                    variant="outline"
                    onClick={handleTest}
                    disabled={testing || !sqlQuery.trim()}
                  >
                    {testing ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Testing...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 mr-2" />
                        Test Query
                      </>
                    )}
                  </Button>
                </div>
              )}

              {testResult && (
                <Alert variant={testResult.success ? "default" : "destructive"}>
                  {testResult.success ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  <AlertTitle>
                    {testResult.success ? "Test Passed" : "Test Failed"}
                  </AlertTitle>
                  <AlertDescription>
                    {testResult.success ? (
                      <>
                        <p>
                          Result: <strong>{testResult.result}</strong>
                        </p>
                        {testResult.rowCount !== undefined && (
                          <p className="text-xs text-slate-500">
                            Rows processed: {testResult.rowCount}
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <p>{testResult.error}</p>
                        {testResult.hint && (
                          <p className="text-xs mt-1 text-slate-500">
                            {testResult.hint}
                          </p>
                        )}
                      </>
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* History Tab */}
        {initialMetricId && (
          <TabsContent value="history" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <History className="w-4 h-4" />
                  Version History
                </CardTitle>
                <CardDescription>
                  Track all changes made to this metric definition
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingHistory ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                  </div>
                ) : history.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-8">
                    No history available for this metric
                  </p>
                ) : (
                  <div className="space-y-4">
                    {history.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-start gap-4 p-3 rounded-lg border border-slate-200 dark:border-slate-700"
                      >
                        <Badge
                          variant={
                            entry.action === "delete"
                              ? "destructive"
                              : "secondary"
                          }
                          className="capitalize"
                        >
                          {entry.action}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-600 dark:text-slate-400">
                            {entry.changed_by_name || "Unknown user"}
                          </p>
                          <p className="text-xs text-slate-400">
                            {new Date(entry.changed_at).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* Action Buttons */}
      {isEditing && (
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
          <Button variant="outline" onClick={resetForm} disabled={saving}>
            <X className="w-4 h-4 mr-1" />
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Metric
              </>
            )}
          </Button>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Metric</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this metric? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default MetricsEditor;
