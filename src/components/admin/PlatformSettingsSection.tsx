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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Mail,
  Plus,
} from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

interface PlatformSetting {
  setting_key: string;
  has_value: boolean;
  encrypted: boolean;
  description: string | null;
  updated_at: string;
}

type FeedbackNotificationUser = {
  id: string;
  user_name: string;
  email: string;
};

type FeedbackNotificationRecipient = {
  id: string;
  user_name: string;
  email: string;
  created_by: string;
};

export function PlatformSettingsSection() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
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

  // Dev email safeguard state
  const [devEmails, setDevEmails] = useState<string[]>([]);
  const [devEmailInput, setDevEmailInput] = useState("");
  const [devEmailLoading, setDevEmailLoading] = useState(false);
  const [devEmailBusy, setDevEmailBusy] = useState(false);
  const [redirectEnabled, setRedirectEnabled] = useState(false);
  const [redirectToggleBusy, setRedirectToggleBusy] = useState(false);
  const [feedbackNotificationUsers, setFeedbackNotificationUsers] = useState<FeedbackNotificationUser[]>([]);
  const [feedbackNotificationRecipients, setFeedbackNotificationRecipients] = useState<FeedbackNotificationRecipient[]>([]);
  const [feedbackRecipientSource, setFeedbackRecipientSource] = useState<"existing_user" | "new_user">("existing_user");
  const [selectedFeedbackUserId, setSelectedFeedbackUserId] = useState("");
  const [newFeedbackUserName, setNewFeedbackUserName] = useState("");
  const [newFeedbackEmail, setNewFeedbackEmail] = useState("");
  const [feedbackRecipientsLoading, setFeedbackRecipientsLoading] = useState(false);
  const [feedbackRecipientBusy, setFeedbackRecipientBusy] = useState(false);

  const selectedFeedbackUser = feedbackNotificationUsers.find((user) => user.id === selectedFeedbackUserId) || null;

  const fetchDevEmails = useCallback(async () => {
    try {
      setDevEmailLoading(true);
      const [emailResult, toggleResult] = await Promise.all([
        api.request<{ emails: string[] }>("/api/admin/platform-settings/fallout-dev-emails"),
        api.request<{ enabled: boolean }>("/api/admin/platform-settings/fallout-redirect-toggle"),
      ]);
      setDevEmails(emailResult.emails ?? []);
      setRedirectEnabled(toggleResult.enabled ?? false);
    } catch {
      // Non-critical — the setting may not exist yet
    } finally {
      setDevEmailLoading(false);
    }
  }, []);

  const fetchFeedbackNotificationData = useCallback(async () => {
    try {
      setFeedbackRecipientsLoading(true);
      const [usersResult, recipientsResult] = await Promise.all([
        api.getFeedbackNotificationUsers(),
        api.getFeedbackNotificationRecipients(),
      ]);
      setFeedbackNotificationUsers(usersResult.users || []);
      setFeedbackNotificationRecipients(recipientsResult.recipients || []);
    } catch (err: any) {
      toast({
        title: "Error",
        description: err?.message || "Failed to load feedback notification recipients.",
        variant: "destructive",
      });
    } finally {
      setFeedbackRecipientsLoading(false);
    }
  }, []);

  const resetFeedbackRecipientForm = () => {
    setSelectedFeedbackUserId("");
    setNewFeedbackUserName("");
    setNewFeedbackEmail("");
  };

  const handleAddFeedbackRecipient = async () => {
    try {
      setFeedbackRecipientBusy(true);
      if (feedbackRecipientSource === "existing_user") {
        if (!selectedFeedbackUserId) {
          toast({
            title: "User required",
            description: "Please select an existing user.",
            variant: "destructive",
          });
          return;
        }
        await api.createFeedbackNotificationRecipient({
          source: "existing_user",
          user_id: selectedFeedbackUserId,
        });
      } else {
        const nextName = newFeedbackUserName.trim();
        const nextEmail = newFeedbackEmail.trim();
        if (!nextName || !nextEmail) {
          toast({
            title: "Missing fields",
            description: "User name and email are required for a new user.",
            variant: "destructive",
          });
          return;
        }
        await api.createFeedbackNotificationRecipient({
          source: "new_user",
          user_name: nextName,
          email: nextEmail,
        });
      }

      toast({
        title: "Recipient added",
        description: "Feedback notification recipient added successfully.",
      });
      resetFeedbackRecipientForm();
      await fetchFeedbackNotificationData();
    } catch (err: any) {
      toast({
        title: "Error",
        description: err?.message || "Failed to add recipient.",
        variant: "destructive",
      });
    } finally {
      setFeedbackRecipientBusy(false);
    }
  };

  const handleRemoveFeedbackRecipient = async (id: string) => {
    try {
      setFeedbackRecipientBusy(true);
      await api.deleteFeedbackNotificationRecipient(id);
      setFeedbackNotificationRecipients((prev) => prev.filter((item) => item.id !== id));
      toast({
        title: "Recipient removed",
        description: "Recipient removed from feedback notifications.",
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err?.message || "Failed to remove recipient.",
        variant: "destructive",
      });
    } finally {
      setFeedbackRecipientBusy(false);
    }
  };

  const handleToggleRedirect = async () => {
    try {
      setRedirectToggleBusy(true);
      const next = !redirectEnabled;
      const result = await api.request<{ enabled: boolean }>(
        "/api/admin/platform-settings/fallout-redirect-toggle",
        { method: "PUT", body: JSON.stringify({ enabled: next }) },
      );
      setRedirectEnabled(result.enabled);
      toast({
        title: result.enabled ? "Email redirect enabled" : "Email redirect disabled",
        description: result.enabled
          ? "Fallout alert emails will be redirected to the configured addresses."
          : "Fallout alert emails will go to real recipients.",
      });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to update toggle", variant: "destructive" });
    } finally {
      setRedirectToggleBusy(false);
    }
  };

  const handleAddDevEmail = async () => {
    const email = devEmailInput.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: "Invalid email", description: "Please enter a valid email address.", variant: "destructive" });
      return;
    }
    if (devEmails.includes(email)) {
      toast({ title: "Duplicate", description: "This email is already in the list." });
      setDevEmailInput("");
      return;
    }
    try {
      setDevEmailBusy(true);
      const result = await api.request<{ emails: string[] }>(
        "/api/admin/platform-settings/fallout-dev-emails",
        { method: "POST", body: JSON.stringify({ email }) },
      );
      setDevEmails(result.emails ?? []);
      setDevEmailInput("");
      toast({ title: "Email added", description: `${email} will now receive redirected fallout alerts in dev.` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to add email", variant: "destructive" });
    } finally {
      setDevEmailBusy(false);
    }
  };

  const handleRemoveDevEmail = async (email: string) => {
    try {
      setDevEmailBusy(true);
      const result = await api.request<{ emails: string[] }>(
        "/api/admin/platform-settings/fallout-dev-emails",
        { method: "DELETE", body: JSON.stringify({ email }) },
      );
      setDevEmails(result.emails ?? []);
      toast({ title: "Email removed", description: `${email} removed from dev email list.` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to remove email", variant: "destructive" });
    } finally {
      setDevEmailBusy(false);
    }
  };

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
    fetchDevEmails();
    if (isSuperAdmin) {
      fetchFeedbackNotificationData();
    }
  }, [fetchSettings, fetchDevEmails, fetchFeedbackNotificationData, isSuperAdmin]);

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
        {isSuperAdmin ? (
          <>
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

        {/* Fallout Email Redirect Safeguard */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-amber-500" />
                <div>
                  <CardTitle className="text-base">Fallout Alert Email Redirect</CardTitle>
                  <CardDescription className="text-sm mt-0.5">
                    When enabled, all fallout alert emails to real LOs and managers are redirected to the addresses below — regardless of environment. Use this to safely test distribution without emailing real users.
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {redirectEnabled ? (
                  <Badge variant="default" className="bg-amber-500">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    Redirect On
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-slate-500 border-slate-300">
                    <Check className="h-3 w-3 mr-1" />
                    Direct Send
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {devEmailLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">
                      {redirectEnabled ? "Redirect active — emails go to safe list" : "Redirect inactive — emails go to real recipients"}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {redirectEnabled
                        ? devEmails.length > 0
                          ? `All LO and manager emails will be sent to: ${devEmails.join(", ")}`
                          : "No safe emails configured — all LO/manager emails will be blocked"
                        : "Fallout alerts will be sent to the actual loan officers and managers"}
                    </p>
                  </div>
                  <Button
                    variant={redirectEnabled ? "destructive" : "outline"}
                    size="sm"
                    onClick={handleToggleRedirect}
                    disabled={redirectToggleBusy}
                    className="ml-4 shrink-0"
                  >
                    {redirectToggleBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : null}
                    {redirectEnabled ? "Disable Redirect" : "Enable Redirect"}
                  </Button>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Safe redirect addresses</p>
                  {devEmails.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {devEmails.map((email) => (
                        <span
                          key={email}
                          className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 pl-3 pr-1.5 py-1 text-sm font-mono"
                        >
                          {email}
                          <button
                            type="button"
                            onClick={() => handleRemoveDevEmail(email)}
                            disabled={devEmailBusy}
                            className="rounded-full p-0.5 hover:bg-rose-100 dark:hover:bg-rose-900/40 hover:text-rose-600 dark:hover:text-rose-400 transition-colors disabled:opacity-50"
                            title={`Remove ${email}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Input
                      type="email"
                      placeholder="Add email address..."
                      value={devEmailInput}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setDevEmailInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddDevEmail();
                        }
                      }}
                      className="max-w-sm text-sm"
                      disabled={devEmailBusy}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleAddDevEmail}
                      disabled={devEmailBusy || !devEmailInput.trim()}
                    >
                      {devEmailBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : (
                        <Plus className="h-4 w-4 mr-1" />
                      )}
                      Add
                    </Button>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    These addresses receive all redirected emails when redirect is active. Non-production environments automatically redirect even without the toggle.
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <Mail className="h-5 w-5 text-blue-500" />
              <div>
                <CardTitle className="text-base">Feedback Notification Recipients</CardTitle>
                <CardDescription className="text-sm mt-0.5">
                  Manage who receives new feedback submission emails.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {feedbackRecipientsLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading recipients...
              </div>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Recipient Type</Label>
                    <Select
                      value={feedbackRecipientSource}
                      onValueChange={(value) => {
                        setFeedbackRecipientSource(value as "existing_user" | "new_user");
                        resetFeedbackRecipientForm();
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="existing_user">Existing User</SelectItem>
                        <SelectItem value="new_user">New User</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {feedbackRecipientSource === "existing_user" ? (
                    <>
                      <div className="space-y-2">
                        <Label>Name</Label>
                        <Select value={selectedFeedbackUserId} onValueChange={setSelectedFeedbackUserId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select user..." />
                          </SelectTrigger>
                          <SelectContent>
                            {feedbackNotificationUsers.map((user) => (
                              <SelectItem key={user.id} value={user.id}>
                                {user.user_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Email (auto-filled)</Label>
                        <Input
                          value={selectedFeedbackUser?.email || ""}
                          readOnly
                          disabled
                          placeholder="Select an existing user"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="space-y-2">
                        <Label>User Name</Label>
                        <Input
                          value={newFeedbackUserName}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => setNewFeedbackUserName(e.target.value)}
                          placeholder="Enter full name"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Email</Label>
                        <Input
                          type="email"
                          value={newFeedbackEmail}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => setNewFeedbackEmail(e.target.value)}
                          placeholder="Enter email"
                        />
                      </div>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleAddFeedbackRecipient()}
                    disabled={
                      feedbackRecipientBusy ||
                      (feedbackRecipientSource === "existing_user" && !selectedFeedbackUserId) ||
                      (feedbackRecipientSource === "new_user" &&
                        (!newFeedbackUserName.trim() || !newFeedbackEmail.trim()))
                    }
                  >
                    {feedbackRecipientBusy ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4 mr-1" />
                    )}
                    Add Recipient
                  </Button>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Current recipients</p>
                  {feedbackNotificationRecipients.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">No recipients configured yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {feedbackNotificationRecipients.map((recipient) => (
                        <span
                          key={recipient.id}
                          className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 pl-3 pr-1.5 py-1 text-sm"
                        >
                          <span className="font-medium">{recipient.user_name}</span>
                          <span className="text-slate-400">|</span>
                          <span className="font-mono">{recipient.email}</span>
                          <button
                            type="button"
                            onClick={() => void handleRemoveFeedbackRecipient(recipient.id)}
                            disabled={feedbackRecipientBusy}
                            className="rounded-full p-0.5 hover:bg-rose-100 dark:hover:bg-rose-900/40 hover:text-rose-600 dark:hover:text-rose-400 transition-colors disabled:opacity-50"
                            title={`Remove ${recipient.email}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
          </Card>
          </>
        ) : null}

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
