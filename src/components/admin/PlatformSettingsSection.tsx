/**
 * Platform Settings Section
 * Manage platform-wide API keys and configuration
 */

import { useState, useEffect, useCallback, useRef, type ChangeEvent } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Settings,
  Key,
  Eye,
  EyeOff,
  Check,
  X,
  Loader2,
  RefreshCw,
  AlertCircle,
  Shield,
  Download,
  FileUp,
  FileText,
} from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

interface PlatformSetting {
  setting_key: string;
  has_value: boolean;
  encrypted: boolean;
  description: string | null;
  updated_at: string;
}

export function PlatformSettingsSection() {
  const releaseNotesImportRef = useRef<HTMLInputElement | null>(null);
  const [settings, setSettings] = useState<PlatformSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit state for each setting
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showValue, setShowValue] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [releaseNotesBusy, setReleaseNotesBusy] = useState<"import" | "export" | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { valid: boolean; message: string }>
  >({});

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.request<{ settings: PlatformSetting[] }>(
        "/api/admin/platform-settings"
      );
      setSettings(response.settings);
    } catch (err: any) {
      console.error("[PlatformSettings] Error fetching settings:", err);
      if (
        err.message?.includes("503") ||
        err.message?.includes("not configured")
      ) {
        setError(
          "Platform settings table not configured. Please run database migrations."
        );
      } else {
        setError(err.message || "Failed to load platform settings");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleEdit = (key: string) => {
    setEditingKey(key);
    setEditValue("");
    setShowValue(false);
  };

  const handleCancel = () => {
    setEditingKey(null);
    setEditValue("");
    setShowValue(false);
  };

  const handleSave = async () => {
    if (!editingKey) return;

    try {
      setSaving(true);
      await api.request(`/api/admin/platform-settings/${editingKey}`, {
        method: "PUT",
        body: JSON.stringify({ value: editValue || null }),
      });

      toast({
        title: "Setting Updated",
        description: `${editingKey} has been updated successfully.`,
      });

      setEditingKey(null);
      setEditValue("");

      // Clear test result for this key
      setTestResults((prev) => {
        const next = { ...prev };
        delete next[editingKey];
        return next;
      });

      // Refresh settings
      fetchSettings();
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to save setting",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (key: string) => {
    try {
      setTesting(key);
      const response = await api.request<{ valid: boolean; message: string }>(
        `/api/admin/platform-settings/${key}/test`
      );
      setTestResults((prev) => ({ ...prev, [key]: response }));

      if (response.valid) {
        toast({
          title: "API Key Valid",
          description: response.message,
        });
      } else {
        toast({
          title: "API Key Invalid",
          description: response.message,
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({
        title: "Test Failed",
        description: err.message || "Failed to test API key",
        variant: "destructive",
      });
    } finally {
      setTesting(null);
    }
  };

  const getSettingLabel = (key: string): string => {
    const labels: Record<string, string> = {
      openai_api_key: "OpenAI API Key",
      gemini_api_key: "Gemini API Key",
      anthropic_api_key: "Anthropic API Key",
      default_embedding_model: "Default Embedding Model",
    };
    return labels[key] || key;
  };

  const getSettingIcon = (key: string) => {
    if (key.includes("api_key")) {
      return <Key className="h-5 w-5 text-amber-500" />;
    }
    return <Settings className="h-5 w-5 text-slate-500" />;
  };

  const handleReleaseNotesExport = async () => {
    setReleaseNotesBusy("export");
    try {
      const result = await api.request<{
        version: string;
        exportedAt: string;
        exportedBy: string;
        notes: unknown[];
      }>("/api/admin/release-notes/export");

      const json = JSON.stringify(result, null, 2);
      const blob = new Blob([json], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `release-notes-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      toast({
        title: "Export complete",
        description: `Downloaded ${result.notes?.length || 0} release notes.`,
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to export release notes",
        variant: "destructive",
      });
    } finally {
      setReleaseNotesBusy(null);
    }
  };

  const triggerReleaseNotesImport = () => {
    releaseNotesImportRef.current?.click();
  };

  const handleReleaseNotesImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setReleaseNotesBusy("import");
    try {
      const content = await file.text();
      const parsed = JSON.parse(content);
      const overwriteAll = window.confirm(
        "Overwrite all existing release notes before import?\n\nSelect OK for full replace, Cancel to merge and replace matching version+title entries only.",
      );

      const response = await api.request<{
        result?: {
          imported: number;
          updated: number;
          skipped: number;
          totalProcessed: number;
        };
      }>("/api/admin/release-notes/import", {
        method: "POST",
        body: JSON.stringify({
          importData: parsed,
          options: {
            overwriteAll,
            replaceMatching: true,
          },
        }),
      });

      const stats = response.result;
      toast({
        title: "Import complete",
        description: stats
          ? `Processed ${stats.totalProcessed}. Imported ${stats.imported}, updated ${stats.updated}, skipped ${stats.skipped}.`
          : "Release notes imported successfully.",
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to import release notes",
        variant: "destructive",
      });
    } finally {
      setReleaseNotesBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-800 dark:text-slate-200">
            Platform Settings
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Configure platform-wide API keys and settings for global features
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchSettings}
          disabled={loading}
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {/* Info Banner */}
      <Alert>
        <Shield className="h-4 w-4" />
        <AlertDescription>
          API keys are encrypted using AWS KMS and stored securely. These keys
          are used for platform-level features like processing Global Knowledge
          Library documents.
        </AlertDescription>
      </Alert>

      {/* Settings Cards */}
      <div className="grid gap-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-indigo-500" />
              <div>
                <CardTitle className="text-base">Release Notes Transfer</CardTitle>
                <CardDescription className="text-sm mt-0.5">
                  Export and import release notes JSON for manual curation and backups.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <input
              ref={releaseNotesImportRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => void handleReleaseNotesImport(e)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleReleaseNotesExport()}
                disabled={releaseNotesBusy !== null}
              >
                {releaseNotesBusy === "export" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Export JSON
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={triggerReleaseNotesImport}
                disabled={releaseNotesBusy !== null}
              >
                {releaseNotesBusy === "import" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileUp className="h-4 w-4 mr-2" />
                )}
                Import JSON
              </Button>
            </div>
          </CardContent>
        </Card>

        {settings.map((setting) => (
          <Card key={setting.setting_key}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {getSettingIcon(setting.setting_key)}
                  <div>
                    <CardTitle className="text-base">
                      {getSettingLabel(setting.setting_key)}
                    </CardTitle>
                    {setting.description && (
                      <CardDescription className="text-sm mt-0.5">
                        {setting.description}
                      </CardDescription>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {setting.encrypted && (
                    <Badge variant="secondary" className="text-xs">
                      <Shield className="h-3 w-3 mr-1" />
                      Encrypted
                    </Badge>
                  )}
                  {setting.has_value ? (
                    <Badge variant="default" className="bg-emerald-500">
                      <Check className="h-3 w-3 mr-1" />
                      Configured
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-amber-600 border-amber-300"
                    >
                      <AlertCircle className="h-3 w-3 mr-1" />
                      Not Set
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {editingKey === setting.setting_key ? (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        type={showValue ? "text" : "password"}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        placeholder={
                          setting.has_value
                            ? "Enter new value to replace"
                            : "Enter value"
                        }
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                        onClick={() => setShowValue(!showValue)}
                      >
                        {showValue ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <Button onClick={handleSave} disabled={saving}>
                      {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                    </Button>
                    <Button variant="outline" onClick={handleCancel}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  {setting.setting_key.includes("api_key") && (
                    <p className="text-xs text-slate-500">
                      {setting.has_value
                        ? "Leave empty and save to keep the existing value, or enter a new value to replace it."
                        : "Enter your API key. It will be encrypted before storage."}
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="text-sm text-slate-500">
                    {setting.has_value ? (
                      setting.encrypted ? (
                        <span className="font-mono">••••••••••••••••</span>
                      ) : (
                        <span className="italic">Value configured</span>
                      )
                    ) : (
                      <span className="text-amber-600">No value set</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {(setting.setting_key === "openai_api_key" ||
                      setting.setting_key === "gemini_api_key") &&
                      setting.has_value && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleTest(setting.setting_key)}
                          disabled={testing === setting.setting_key}
                        >
                          {testing === setting.setting_key ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-1" />
                          ) : testResults[setting.setting_key]?.valid ? (
                            <Check className="h-4 w-4 mr-1 text-emerald-500" />
                          ) : testResults[setting.setting_key]?.valid ===
                            false ? (
                            <X className="h-4 w-4 mr-1 text-red-500" />
                          ) : null}
                          Test
                        </Button>
                      )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(setting.setting_key)}
                    >
                      {setting.has_value ? "Update" : "Configure"}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {settings.length === 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No platform settings found. Please ensure the database migrations
            have been run.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
