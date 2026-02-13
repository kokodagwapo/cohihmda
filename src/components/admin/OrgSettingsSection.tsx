import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Building2,
  Upload,
  Save,
  Bell,
  BellOff,
  CreditCard,
  BarChart3,
  Users,
  Database,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  Image as ImageIcon,
  Mail,
  Activity,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminTenant } from "@/contexts/AdminTenantContext";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

/**
 * Organization settings interface
 */
interface OrgSettings {
  id: string;
  name: string;
  slug: string;
  display_name: string;
  logo_url?: string;
  primary_color?: string;
  primary_contact_email?: string;
  notification_preferences: NotificationPreferences;
  created_at: string;
  updated_at: string;
}

/**
 * Notification preferences
 */
interface NotificationPreferences {
  email_digest: boolean;
  email_digest_frequency: "daily" | "weekly" | "monthly";
  system_alerts: boolean;
  data_sync_notifications: boolean;
  performance_alerts: boolean;
  security_alerts: boolean;
}

/**
 * Subscription details
 */
interface Subscription {
  id: string;
  plan_name: string;
  plan_tier: "starter" | "professional" | "enterprise";
  status: "active" | "past_due" | "cancelled" | "trialing";
  current_period_start: string;
  current_period_end: string;
  user_limit: number;
  loan_limit: number;
  features: string[];
}

/**
 * Usage statistics
 */
interface UsageStats {
  users: {
    current: number;
    limit: number;
    percentage: number;
  };
  loans: {
    current: number;
    limit: number;
    percentage: number;
  };
  api_calls: {
    current: number;
    limit: number;
    percentage: number;
  };
  storage: {
    current: number;
    limit: number;
    percentage: number;
    unit: string;
  };
  last_sync: string;
  sync_status: "healthy" | "warning" | "error";
}


interface OrgSettingsSectionProps {
  tenantId?: string;
}

export function OrgSettingsSection({ tenantId: propTenantId }: OrgSettingsSectionProps) {
  const { user, isSuperAdmin, isTenantAdmin } = useAuth();
  const { selectedTenantId } = useAdminTenant();
  const { toast } = useToast();
  const tenantId = propTenantId || selectedTenantId || user?.tenant_id;
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [displayName, setDisplayName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [contactEmail, setContactEmail] = useState("");
  const [notifications, setNotifications] = useState<NotificationPreferences>({
    email_digest: true,
    email_digest_frequency: "weekly",
    system_alerts: true,
    data_sync_notifications: true,
    performance_alerts: false,
    security_alerts: true,
  });

  // Load settings on mount
  useEffect(() => {
    loadSettings();
    loadSubscription();
    loadUsage();
  }, [tenantId]);

  const loadSettings = async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await api.request<OrgSettings>(
        `/api/tenants/${tenantId}`,
      );
      setSettings(response);
      setDisplayName(response.display_name || response.name || "");
      setLogoUrl(response.logo_url || "");
      setContactEmail(response.primary_contact_email || "");
      if (response.notification_preferences) {
        setNotifications(response.notification_preferences);
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to load organization settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadSubscription = async () => {
    try {
      const response = await api.request<Subscription>(
        `/api/admin/subscription${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`,
      );
      setSubscription(response || null);
    } catch (error: any) {
      console.error("Failed to load subscription:", error);
      setSubscription(null);
    }
  };

  const loadUsage = async () => {
    if (!tenantId) return;
    try {
      const response = await api.request<UsageStats>(
        `/api/admin/tenants/${tenantId}/usage`,
      );
      setUsage(response);
    } catch (error: any) {
      console.error("Failed to load usage:", error);
      toast({
        title: "Error",
        description: "Failed to load usage statistics",
        variant: "destructive",
      });
    }
  };

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Logo must be less than 2MB",
          variant: "destructive",
        });
        return;
      }

      if (!file.type.startsWith("image/")) {
        toast({
          title: "Invalid file type",
          description: "Please select an image file",
          variant: "destructive",
        });
        return;
      }

      setLogoFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        setLogoPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveLogo = () => {
    setLogoFile(null);
    setLogoPreview(null);
    setLogoUrl("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSaveSettings = async () => {
    if (!tenantId) return;
    if (!displayName.trim()) {
      toast({
        title: "Validation Error",
        description: "Organization name is required",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      await api.request(`/api/tenants/${tenantId}/settings`, {
        method: "PUT",
        body: JSON.stringify({
          display_name: displayName.trim(),
          logo_url: logoUrl || undefined,
          primary_contact_email: contactEmail.trim() || undefined,
        }),
      });

      toast({
        title: "Success",
        description: "Organization settings saved successfully",
      });

      loadSettings();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save settings",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveNotifications = async () => {
    if (!tenantId) return;
    setSaving(true);
    try {
      await api.request(`/api/tenants/${tenantId}/settings`, {
        method: "PUT",
        body: JSON.stringify({
          notification_preferences: notifications,
        }),
      });

      toast({
        title: "Success",
        description: "Notification preferences updated",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update notification preferences",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
      case "trialing":
        return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
      case "past_due":
        return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
      case "cancelled":
        return "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400";
      default:
        return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
    }
  };

  const getSyncStatusColor = (status: string) => {
    switch (status) {
      case "healthy":
        return "text-emerald-500";
      case "warning":
        return "text-amber-500";
      case "error":
        return "text-rose-500";
      default:
        return "text-slate-400";
    }
  };

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-center h-64"
      >
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      {/* Header */}
      <div>
        <h2 className="text-2xl font-light text-slate-900 dark:text-white">
          Organization Settings
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Manage your organization profile, preferences, and view subscription
          details
        </p>
      </div>

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="subscription">Subscription</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
        </TabsList>

        {/* General Tab */}
        <TabsContent value="general" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Organization Profile</CardTitle>
              <CardDescription>
                Basic information about your organization
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Logo Upload */}
              <div className="space-y-2">
                <Label>Organization Logo</Label>
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 rounded-lg border-2 border-dashed border-slate-200 dark:border-slate-700 flex items-center justify-center bg-slate-50 dark:bg-slate-800 overflow-hidden">
                    {logoPreview || logoUrl ? (
                      <img
                        src={logoPreview || logoUrl}
                        alt="Logo preview"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <ImageIcon className="h-8 w-8 text-slate-400" />
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleLogoSelect}
                      className="hidden"
                      title="Upload organization logo"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Upload Logo
                    </Button>
                    {(logoPreview || logoUrl) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleRemoveLogo}
                        className="text-rose-600 hover:text-rose-700"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  Recommended: 200x200px or larger, PNG or SVG, max 2MB
                </p>
              </div>

              {/* Display Name */}
              <div className="space-y-2">
                <Label htmlFor="displayName">Organization Name</Label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g., ACME Mortgage Co."
                />
                <p className="text-xs text-slate-500">
                  This name will appear in reports and the dashboard header
                </p>
              </div>

              {/* Slug (read-only) */}
              {settings?.slug && (
                <div className="space-y-2">
                  <Label>Organization Slug</Label>
                  <Input
                    value={settings.slug}
                    disabled
                    className="bg-slate-50 dark:bg-slate-800 text-slate-500"
                  />
                  <p className="text-xs text-slate-500">
                    Unique identifier -- cannot be changed after creation
                  </p>
                </div>
              )}

              {/* Primary Contact Email */}
              <div className="space-y-2">
                <Label htmlFor="contactEmail">Primary Contact Email</Label>
                <Input
                  id="contactEmail"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="admin@example.com"
                />
                <p className="text-xs text-slate-500">
                  Main point of contact for this organization
                </p>
              </div>

              {/* Created Date (read-only) */}
              {settings?.created_at && (
                <div className="space-y-2">
                  <Label>Created</Label>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {new Date(settings.created_at).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                </div>
              )}

              <div className="pt-4 border-t flex justify-end">
                <Button onClick={handleSaveSettings} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                Notification Preferences
              </CardTitle>
              <CardDescription>
                Configure how and when you receive notifications
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Email Digest */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-slate-400" />
                    <Label>Email Digest</Label>
                  </div>
                  <p className="text-sm text-slate-500">
                    Receive a summary of activity via email
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Select
                    value={notifications.email_digest_frequency}
                    onValueChange={(v: any) =>
                      setNotifications((prev) => ({
                        ...prev,
                        email_digest_frequency: v,
                      }))
                    }
                    disabled={!notifications.email_digest}
                  >
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                  <Switch
                    checked={notifications.email_digest}
                    onCheckedChange={(checked) =>
                      setNotifications((prev) => ({
                        ...prev,
                        email_digest: checked,
                      }))
                    }
                  />
                </div>
              </div>

              {/* System Alerts */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-slate-400" />
                    <Label>System Alerts</Label>
                  </div>
                  <p className="text-sm text-slate-500">
                    Important system notifications and updates
                  </p>
                </div>
                <Switch
                  checked={notifications.system_alerts}
                  onCheckedChange={(checked) =>
                    setNotifications((prev) => ({
                      ...prev,
                      system_alerts: checked,
                    }))
                  }
                />
              </div>

              {/* Data Sync Notifications */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-slate-400" />
                    <Label>Data Sync Notifications</Label>
                  </div>
                  <p className="text-sm text-slate-500">
                    Notifications about LOS data synchronization
                  </p>
                </div>
                <Switch
                  checked={notifications.data_sync_notifications}
                  onCheckedChange={(checked) =>
                    setNotifications((prev) => ({
                      ...prev,
                      data_sync_notifications: checked,
                    }))
                  }
                />
              </div>

              {/* Performance Alerts */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-slate-400" />
                    <Label>Performance Alerts</Label>
                  </div>
                  <p className="text-sm text-slate-500">
                    Alerts when KPIs fall outside expected ranges
                  </p>
                </div>
                <Switch
                  checked={notifications.performance_alerts}
                  onCheckedChange={(checked) =>
                    setNotifications((prev) => ({
                      ...prev,
                      performance_alerts: checked,
                    }))
                  }
                />
              </div>

              {/* Security Alerts */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-slate-400" />
                    <Label>Security Alerts</Label>
                  </div>
                  <p className="text-sm text-slate-500">
                    Important security notifications (always recommended)
                  </p>
                </div>
                <Switch
                  checked={notifications.security_alerts}
                  onCheckedChange={(checked) =>
                    setNotifications((prev) => ({
                      ...prev,
                      security_alerts: checked,
                    }))
                  }
                />
              </div>

              <div className="pt-4 border-t flex justify-end">
                <Button onClick={handleSaveNotifications} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Save Preferences
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Subscription Tab */}
        <TabsContent value="subscription" className="space-y-6 mt-6">
          {subscription && (
            <>
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">Current Plan</CardTitle>
                      <CardDescription>
                        Your subscription details
                      </CardDescription>
                    </div>
                    <Badge className={getStatusColor(subscription.status)}>
                      {subscription.status === "active" && (
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                      )}
                      {subscription.status.charAt(0).toUpperCase() +
                        subscription.status.slice(1)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 mb-6">
                    <div className="p-4 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 text-white">
                      <Zap className="h-8 w-8" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-semibold text-slate-900 dark:text-white">
                        {subscription.plan_name}
                      </h3>
                      <p className="text-sm text-slate-500">
                        Renews on{" "}
                        {new Date(
                          subscription.current_period_end,
                        ).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 mb-6">
                    <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800">
                      <div className="flex items-center gap-2 mb-2">
                        <Users className="h-4 w-4 text-slate-400" />
                        <span className="text-sm text-slate-600 dark:text-slate-400">
                          User Limit
                        </span>
                      </div>
                      <p className="text-2xl font-semibold text-slate-900 dark:text-white">
                        {subscription.user_limit}
                      </p>
                    </div>
                    <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800">
                      <div className="flex items-center gap-2 mb-2">
                        <FileText className="h-4 w-4 text-slate-400" />
                        <span className="text-sm text-slate-600 dark:text-slate-400">
                          Loan Limit
                        </span>
                      </div>
                      <p className="text-2xl font-semibold text-slate-900 dark:text-white">
                        {subscription.loan_limit.toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-slate-900 dark:text-white mb-3">
                      Included Features
                    </h4>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {subscription.features.map((feature, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400"
                        >
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          {feature}
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Alert>
                <CreditCard className="h-4 w-4" />
                <AlertDescription>
                  To upgrade your plan or manage billing, please contact your
                  account manager or visit the billing portal.
                </AlertDescription>
              </Alert>
            </>
          )}
        </TabsContent>

        {/* Usage Tab */}
        <TabsContent value="usage" className="space-y-6 mt-6">
          {usage && (
            <>
              {/* Sync Status */}
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Activity
                        className={`h-5 w-5 ${getSyncStatusColor(usage.sync_status)}`}
                      />
                      <div>
                        <p className="font-medium text-slate-900 dark:text-white">
                          Data Sync Status
                        </p>
                        <p className="text-sm text-slate-500">
                          Last sync:{" "}
                          {new Date(usage.last_sync).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <Badge
                      className={
                        usage.sync_status === "healthy"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : usage.sync_status === "warning"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                            : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                      }
                    >
                      {usage.sync_status.charAt(0).toUpperCase() +
                        usage.sync_status.slice(1)}
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              {/* Usage Metrics */}
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Users */}
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-slate-400" />
                        <span className="font-medium text-slate-900 dark:text-white">
                          Users
                        </span>
                      </div>
                      <span className="text-sm text-slate-500">
                        {usage.users.current} / {usage.users.limit}
                      </span>
                    </div>
                    <Progress value={usage.users.percentage} className="h-2" />
                    <p className="text-xs text-slate-500 mt-2">
                      {usage.users.percentage}% of limit used
                    </p>
                  </CardContent>
                </Card>

                {/* Loans */}
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-slate-400" />
                        <span className="font-medium text-slate-900 dark:text-white">
                          Loans
                        </span>
                      </div>
                      <span className="text-sm text-slate-500">
                        {usage.loans.current.toLocaleString()} /{" "}
                        {usage.loans.limit.toLocaleString()}
                      </span>
                    </div>
                    <Progress value={usage.loans.percentage} className="h-2" />
                    <p className="text-xs text-slate-500 mt-2">
                      {usage.loans.percentage}% of limit used
                    </p>
                  </CardContent>
                </Card>

                {/* API Calls */}
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <BarChart3 className="h-4 w-4 text-slate-400" />
                        <span className="font-medium text-slate-900 dark:text-white">
                          API Calls (this month)
                        </span>
                      </div>
                      <span className="text-sm text-slate-500">
                        {usage.api_calls.current.toLocaleString()} /{" "}
                        {usage.api_calls.limit.toLocaleString()}
                      </span>
                    </div>
                    <Progress
                      value={usage.api_calls.percentage}
                      className="h-2"
                    />
                    <p className="text-xs text-slate-500 mt-2">
                      {usage.api_calls.percentage}% of limit used
                    </p>
                  </CardContent>
                </Card>

                {/* Storage */}
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Database className="h-4 w-4 text-slate-400" />
                        <span className="font-medium text-slate-900 dark:text-white">
                          Storage
                        </span>
                      </div>
                      <span className="text-sm text-slate-500">
                        {usage.storage.current} / {usage.storage.limit}{" "}
                        {usage.storage.unit}
                      </span>
                    </div>
                    <Progress
                      value={usage.storage.percentage}
                      className="h-2"
                    />
                    <p className="text-xs text-slate-500 mt-2">
                      {usage.storage.percentage}% of limit used
                    </p>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}

export default OrgSettingsSection;
