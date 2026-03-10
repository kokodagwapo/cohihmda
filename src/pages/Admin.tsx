import { useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { Navigation } from "@/components/layout/Navigation";
import { AdminPreloader } from "@/components/admin/AdminPreloader";
import { AdminContainer } from "@/components/admin/AdminContainer";
import { AdminLayout, isPlatformStaff } from "@/components/admin/AdminLayout";
import { OverviewSection } from "@/components/admin/OverviewSection";
import { TenantsSection } from "@/components/admin/TenantsSection";
import { SystemSection } from "@/components/admin/SystemSection";
import { SecuritySection } from "@/components/admin/SecuritySection";
import { ConnectionsSection } from "@/components/admin/ConnectionsSection";
import { LoanFoldersSection } from "@/components/admin/LoanFoldersSection";
import { RAGVoiceSection } from "@/components/admin/RAGVoiceSection";
import { UserManagementSection } from "@/components/admin/UserManagementSection";
import { PlatformTeamSection } from "@/components/admin/PlatformTeamSection";
import { SSOConfigSection } from "@/components/admin/SSOConfigSection";
import { OrgSettingsSection } from "@/components/admin/OrgSettingsSection";
import { DataQualitySection } from "@/components/admin/DataQualitySection";
import { TenantConfigSection } from "@/components/admin/tenant-config";
import { SOC2ComplianceSection } from "@/components/admin/SOC2ComplianceSection";
import { StripeSection } from "@/components/admin/StripeSection";
import { DemoDataSection } from "@/components/admin/DemoDataSection";
// import { MetricsCatalogSection } from "@/components/admin/MetricsCatalogSection";
import { TenantSelectorCard } from "@/components/admin/TenantSelectorCard";
import { GlobalKnowledgeLibrary } from "@/components/admin/GlobalKnowledgeLibrary";
import { KnowledgeCenterSection } from "@/components/admin/KnowledgeCenterSection";
import { AIPromptManager } from "@/components/admin/AIPromptManager";
import { InsightFeedbackSection } from "@/components/admin/InsightFeedbackSection";
import { ReleaseNotesSection } from "@/components/admin/ReleaseNotesSection";
import { PlatformSettingsSection } from "@/components/admin/PlatformSettingsSection";
import { SyncManagementSection } from "@/components/admin/SyncManagementSection";
import { AnalyticsSection } from "@/components/admin/AnalyticsSection";
import { AdminModeSelector } from "@/components/admin/AdminModeSelector";
import { Button } from "@/components/ui/button";
import { Menu, Settings } from "lucide-react";
import {
  useAdminState,
  AdminSection,
  AdminMode,
} from "@/hooks/admin/useAdminState";
import { useAdminStats } from "@/hooks/admin/useAdminStats";
import { useSystemInfo } from "@/hooks/admin/useSystemInfo";
import { useTenants } from "@/hooks/admin/useTenants";
import { useSecurityInfo } from "@/hooks/admin/useSecurityInfo";
import { useLOSConnections } from "@/hooks/admin/useLOSConnections";
import { useRAGSettings } from "@/hooks/admin/useRAGSettings";
import { useStripeData } from "@/hooks/admin/useStripeData";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import {
  AdminTenantProvider,
  useAdminTenant,
} from "@/contexts/AdminTenantContext";

export const Admin = () => {
  const { toast } = useToast();
  const { user } = useAuth();

  // Determine user role and if they're platform staff (Cohi internal)
  const userRole = user?.role || "user";
  const isPlatform = isPlatformStaff(userRole);
  const tenantName = user?.tenant_name;

  // Determine default section based on role
  const defaultSection: AdminSection = isPlatform ? "overview" : "users";

  // State management
  const {
    activeSection,
    setActiveSection,
    mobileMenuOpen,
    setMobileMenuOpen,
    initialLoad,
    setInitialLoad,
    markSectionLoaded,
    isSectionLoaded,
    adminMode,
    setAdminMode,
  } = useAdminState();

  // Data hooks
  const {
    stats,
    loading: statsLoading,
    refetch: refetchStats,
  } = useAdminStats(isPlatform);
  const {
    systemInfo,
    loading: systemLoading,
    loadSystemInfo,
  } = useSystemInfo();
  const {
    tenants,
    loading: tenantsLoading,
    duplicating,
    duplicationProgress,
    refreshingDemoTenantId,
    loadTenants,
    createTenant,
    updateTenant,
    deleteTenant,
    duplicateTenant,
    refreshDemoTenant,
    updateDemoSettings,
  } = useTenants();
  const {
    securityInfo,
    loading: securityLoading,
    loadSecurityInfo,
  } = useSecurityInfo();
  const {
    losConnections,
    losTypes,
    loading: losLoading,
    loadLosData,
    testConnection: testLosConnection,
    syncConnection: syncLosConnection,
    toggleConnection: toggleLosConnection,
    createConnection: createLosConnection,
    updateConnection: updateLosConnection,
    deleteConnection: deleteLosConnection,
  } = useLOSConnections();

  // Tenant metrics for LOS section (loaded on demand)
  const [tenantMetrics, setTenantMetrics] = useState<any>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const {
    ragVoiceSettings,
    ragVoiceCosts,
    loading: ragVoiceLoading,
    loadRagVoiceData,
    saveRagVoiceSettings,
    saveApiKeys,
  } = useRAGSettings();
  const {
    subscriptionPlans,
    subscriptions,
    loading: stripeLoading,
    loadStripeData,
  } = useStripeData(isPlatform);

  // Local state for search
  const [searchQuery, setSearchQuery] = useState("");

  // Check if user has admin access (either platform staff or tenant admin)
  const isAdmin = useMemo(() => {
    return isPlatform || userRole === "tenant_admin";
  }, [isPlatform, userRole]);

  // Set initial section based on role/mode and handle initial load
  useEffect(() => {
    // Set the default section based on user role and admin mode
    if (!isPlatform && activeSection === "overview") {
      // Tenant admins should not see platform overview, redirect to users
      setActiveSection("users");
    } else if (isPlatform) {
      // Platform admins: ensure section matches mode
      if (adminMode === "platform" && activeSection === "users") {
        // Don't redirect -- users is valid in both modes
      } else if (adminMode === "tenant" && activeSection === "overview") {
        setActiveSection("users");
      }
    }

    // Set initial load to false after brief delay
    const timeout = setTimeout(() => {
      setInitialLoad(false);
    }, 500);

    return () => clearTimeout(timeout);
  }, [isPlatform, adminMode, activeSection, setActiveSection, setInitialLoad]);

  // Lazy load section data
  useEffect(() => {
    const loadSectionData = async () => {
      if (isSectionLoaded(activeSection)) {
        return;
      }

      try {
        switch (activeSection) {
          case "tenants":
            await loadTenants();
            break;
          case "users":
            // UserManagementSection handles its own data loading
            break;
          case "sso":
          case "org":
          case "data-quality":
            // These sections load their own data
            break;
          case "infrastructure":
            await loadSystemInfo();
            break;
          case "security-compliance":
            await loadSecurityInfo();
            break;
          case "connections":
            if (!isPlatform && user?.tenant_id) {
              await loadLosData(user.tenant_id);
            } else {
              await loadLosData();
            }
            break;
          case "rag-voice":
            await loadRagVoiceData(false);
            break;
          case "dev-tools":
            // These load on demand, no pre-loading needed
            break;
        }
        markSectionLoaded(activeSection);
      } catch (error) {
        console.error(`Error loading ${activeSection} data:`, error);
      }
    };

    if (!initialLoad && activeSection !== "overview") {
      loadSectionData();
    }
  }, [
    activeSection,
    initialLoad,
    isSectionLoaded,
    markSectionLoaded,
    loadTenants,
    loadSystemInfo,
    loadSecurityInfo,
    loadLosData,
    loadRagVoiceData,
    isPlatform,
    user?.tenant_id,
  ]);

  // Get current section name for mobile header
  const getCurrentSectionLabel = () => {
    const sections = [
      { id: "overview", label: "Platform Overview" },
      { id: "tenants", label: "Tenants" },
      { id: "users", label: "Users & Access" },
      { id: "sso", label: "SSO Configuration" },
      { id: "org", label: "Organization Settings" },
      { id: "data-quality", label: "Data Quality" },
      { id: "data-config", label: "Field Mapping" },
      { id: "revenue", label: "Revenue" },
      { id: "scoring-weights", label: "Scoring & Weights" },
      { id: "data-transfer", label: "Import / Export" },
      { id: "connections", label: "Connections & Integrations" },
      { id: "rag-voice", label: "AI Assistant" },
      { id: "knowledge-library", label: "Global Knowledge Library" },
      { id: "knowledge-center", label: "Knowledge Center" },
      { id: "infrastructure", label: "Infrastructure" },
      { id: "security-compliance", label: "Security & Compliance" },
      { id: "stripe", label: "Stripe Payments" },
      { id: "dev-tools", label: "Developer Tools" },
      { id: "ai-prompts", label: "AI Prompts" },
      { id: "insight-feedback", label: "Insight Feedback" },
      { id: "release-notes", label: "Release Notes" },
      { id: "platform-settings", label: "Platform Settings" },
      { id: "analytics", label: "User Analytics" },
    ];
    return sections.find((s) => s.id === activeSection)?.label || "Overview";
  };

  return (
    <AdminTenantProvider>
      <AdminContainer isAdmin={isAdmin}>
        <div className="h-screen overflow-hidden flex flex-col bg-gradient-to-br from-blue-50/30 via-white to-blue-50/20 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950/50">
          {/* Preloader */}
          <AdminPreloader show={initialLoad} />

          <Navigation />

          {/* Background pattern */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.03),transparent_50%),radial-gradient(circle_at_80%_80%,rgba(168,85,247,0.02),transparent_50%)] pointer-events-none" />

          <div className="flex-1 overflow-hidden flex flex-col container mx-auto px-4 sm:px-6 lg:px-8 pt-16 sm:pt-20 relative z-10">
            {/* Mobile Hamburger Menu Button */}
            <div className="lg:hidden mb-4 sm:mb-6 flex items-center justify-between flex-shrink-0">
              <Button
                variant="outline"
                size="lg"
                onClick={() => setMobileMenuOpen(true)}
                className="h-11 sm:h-12 px-4 border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 shadow-sm hover:shadow-md transition-all duration-300 rounded-xl touch-manipulation"
                aria-label="Open navigation menu"
              >
                <Menu
                  className="h-5 w-5 sm:h-5 sm:w-5 mr-2 text-slate-700 dark:text-slate-300"
                  strokeWidth={1.5}
                />
                <span className="text-base font-extralight text-slate-700 dark:text-slate-300">
                  Menu
                </span>
              </Button>
              {/* Show current section on mobile */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/90 dark:bg-slate-800/70 border border-slate-200/60 dark:border-slate-700/50">
                <Settings
                  className="h-4 w-4 text-blue-600 dark:text-blue-400"
                  strokeWidth={1.5}
                />
                <span className="text-sm sm:text-base font-extralight text-slate-700 dark:text-slate-300 truncate max-w-[120px] sm:max-w-none">
                  {getCurrentSectionLabel()}
                </span>
              </div>
            </div>

            {/* Admin Mode Selector and Tenant Selector - Only shown for platform admins */}
            {isPlatform && (
              <AdminModeAndTenantSelector
                adminMode={adminMode}
                onModeChange={setAdminMode}
              />
            )}

            <div className="flex-1 overflow-hidden">
            <AdminLayoutWithContext
              activeSection={activeSection}
              mobileMenuOpen={mobileMenuOpen}
              onSectionChange={setActiveSection}
              onMobileMenuChange={setMobileMenuOpen}
              userRole={userRole}
              tenantName={tenantName}
              adminMode={adminMode}
            >
              {/* Platform Overview Section (Super Admin) */}
              {activeSection === "overview" && isPlatform && (
                <OverviewSection stats={stats} overviewLoading={statsLoading} />
              )}

              {/* Tenants Section */}
              {activeSection === "tenants" && isPlatform && (
                <TenantsSection
                  tenants={tenants}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  onCreateTenant={createTenant}
                  onUpdateTenant={updateTenant}
                  onDeleteTenant={deleteTenant}
                  onDuplicateTenant={duplicateTenant}
                  onRefreshDemoTenant={refreshDemoTenant}
                  onUpdateDemoSettings={updateDemoSettings}
                  duplicating={duplicating}
                  duplicationProgress={duplicationProgress}
                  refreshingDemoTenantId={refreshingDemoTenantId}
                  onRefresh={loadTenants}
                />
              )}

              {/* Platform Team Section (Super Admin only) */}
              {activeSection === "platform-team" && isPlatform && <PlatformTeamSection />}

              {/* Users Section */}
              {activeSection === "users" && <UserManagementSection />}

              {/* SSO Configuration Section */}
              {activeSection === "sso" && <SSOConfigSection />}

              {/* Organization Settings Section */}
              {activeSection === "org" && <OrgSettingsSection />}

              {/* Data Quality Section */}
              {activeSection === "data-quality" && <DataQualitySection />}

              {/* Field Mapping */}
              {activeSection === "data-config" && (
                <TenantConfigSection section="mapping" />
              )}
              {/* Revenue */}
              {activeSection === "revenue" && (
                <TenantConfigSection section="revenue" />
              )}
              {/* Scoring & Weights */}
              {activeSection === "scoring-weights" && (
                <TenantConfigSection section="scoring" />
              )}
              {/* Import / Export (platform admin only) */}
              {activeSection === "data-transfer" && (
                <TenantConfigSection section="transfer" />
              )}

              {/* Infrastructure Section (formerly System) */}
              {activeSection === "infrastructure" && isPlatform && (
                <SystemSection
                  systemInfo={systemInfo}
                  loading={systemLoading}
                />
              )}

              {/* Security & Compliance Section (combined Security + SOC 2) */}
              {activeSection === "security-compliance" && isPlatform && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-6"
                >
                  {/* Section Header */}
                  <div className="flex items-center justify-between p-6 rounded-2xl bg-gradient-to-br from-rose-50 via-white to-red-50 dark:from-slate-800/50 dark:to-slate-900/50 border border-rose-200/40 dark:border-slate-700/50 shadow-lg shadow-rose-500/10">
                    <div>
                      <h2 className="text-4xl font-thin text-slate-900 dark:text-white tracking-tight mb-2">
                        Security & Compliance
                      </h2>
                      <p className="text-base text-slate-600 dark:text-slate-400 font-extralight tracking-wide">
                        Platform security settings and SOC 2 audit trail
                      </p>
                    </div>
                  </div>

                  {/* Security Settings */}
                  <SecuritySection
                    securityInfo={securityInfo}
                    loading={securityLoading}
                    onNavigate={setActiveSection}
                  />

                  {/* SOC 2 Compliance */}
                  <div className="mt-8">
                    <h3 className="text-2xl font-light text-slate-900 dark:text-white mb-4">
                      SOC 2 Compliance & Audit Trail
                    </h3>
                    <SOC2ComplianceSection />
                  </div>
                </motion.div>
              )}

              {/* Loan Folders Section */}
              {activeSection === "loan-folders" && <LoanFoldersSection />}

              {/* Connections & Integrations Section */}
              {activeSection === "connections" && (
                <ConnectionsSection
                  // LOS props
                  losConnections={losConnections}
                  losTypes={losTypes}
                  losLoading={losLoading}
                  tenantMetrics={tenantMetrics}
                  loadingMetrics={loadingMetrics}
                  onTestLos={testLosConnection}
                  onSyncLos={syncLosConnection}
                  onToggleLos={toggleLosConnection}
                  onCreateLos={createLosConnection}
                  onUpdateLos={updateLosConnection}
                  onDeleteLos={deleteLosConnection}
                  onLoadLosData={loadLosData}
                  onLoadMetrics={async (tenantId) => {
                    setLoadingMetrics(true);
                    try {
                      const metrics = await api.request(
                        `/api/admin/tenants/${tenantId}/metrics`
                      );
                      setTenantMetrics(metrics.metrics);
                    } catch (error: any) {
                      console.error("Error loading tenant metrics:", error);
                      toast({
                        title: "Error",
                        description: "Failed to load tenant metrics",
                        variant: "destructive",
                      });
                    } finally {
                      setLoadingMetrics(false);
                    }
                  }}
                />
              )}

              {/* Developer Tools Section (includes Demo Data) */}
              {activeSection === "dev-tools" && isPlatform && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-6"
                >
                  {/* Section Header */}
                  <div className="flex items-center justify-between p-6 rounded-2xl bg-gradient-to-br from-slate-50 via-white to-gray-50 dark:from-slate-800/50 dark:to-slate-900/50 border border-slate-200/40 dark:border-slate-700/50 shadow-lg shadow-slate-500/10">
                    <div>
                      <h2 className="text-4xl font-thin text-slate-900 dark:text-white tracking-tight mb-2">
                        Developer Tools
                      </h2>
                      <p className="text-base text-slate-600 dark:text-slate-400 font-extralight tracking-wide">
                        Demo data, testing utilities, and diagnostics
                      </p>
                    </div>
                  </div>

                  {/* Demo Data Upload */}
                  <DemoDataSection />
                </motion.div>
              )}

              {/* Stripe Payments Section */}
              {activeSection === "stripe" && isPlatform && (
                <StripeSection
                  subscriptionPlans={subscriptionPlans}
                  subscriptions={subscriptions}
                  loading={stripeLoading}
                  onRefresh={loadStripeData}
                />
              )}

              {/* RAG & Voice Section */}
              {activeSection === "rag-voice" && isPlatform && (
                <RAGVoiceSection
                  ragVoiceSettings={ragVoiceSettings}
                  ragVoiceCosts={ragVoiceCosts}
                  loading={ragVoiceLoading}
                  onSave={saveRagVoiceSettings}
                  onRefresh={loadRagVoiceData}
                  onSaveApiKeys={saveApiKeys}
                />
              )}

              {/* Global Knowledge Library Section (Platform Admin) */}
              {activeSection === "knowledge-library" && isPlatform && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <GlobalKnowledgeLibrary />
                </motion.div>
              )}

              {/* Knowledge Center Section (Tenant Admin) */}
              {activeSection === "knowledge-center" && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <KnowledgeCenterSection />
                </motion.div>
              )}

              {/* AI Prompts Section (Platform Admin) */}
              {activeSection === "ai-prompts" && isPlatform && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <AIPromptManager />
                </motion.div>
              )}

              {/* Insight Feedback Section (Platform Admin) */}
              {activeSection === "insight-feedback" && isPlatform && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <InsightFeedbackSection />
                </motion.div>
              )}

              {/* Release Notes Section (Platform Admin) */}
              {activeSection === "release-notes" && isPlatform && (
                <ReleaseNotesSection />
              )}

              {/* Platform Settings Section (Platform Admin) */}
              {activeSection === "platform-settings" && isPlatform && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <PlatformSettingsSection />
                </motion.div>
              )}

              {/* Sync Management Section (Platform Admin) */}
              {activeSection === "sync-management" && isPlatform && (
                <SyncManagementSection />
              )}

              {/* User Analytics (tenant + platform in tenant mode) */}
              {activeSection === "analytics" && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <AnalyticsSection />
                </motion.div>
              )}
            </AdminLayoutWithContext>
            </div>
          </div>
        </div>
      </AdminContainer>
    </AdminTenantProvider>
  );
};

/**
 * Helper component that wraps AdminModeSelector and TenantSelectorCard
 * to access the AdminTenantContext for the selected tenant name
 */
function AdminModeAndTenantSelector({
  adminMode,
  onModeChange,
}: {
  adminMode: AdminMode;
  onModeChange: (mode: AdminMode, changeSection?: boolean) => void;
}) {
  const { currentTenantName } = useAdminTenant();

  return (
    <div className="space-y-4 mb-6 flex-shrink-0">
      {/* Mode Selector Tabs */}
      <AdminModeSelector
        mode={adminMode}
        onModeChange={(mode) => onModeChange(mode, true)}
        selectedTenantName={currentTenantName}
      />

      {/* Prominent Tenant Selector when in tenant mode */}
      {adminMode === "tenant" && <TenantSelectorCard variant="prominent" />}
    </div>
  );
}

/**
 * Helper component that wraps AdminLayout to pass selected tenant context
 */
function AdminLayoutWithContext({
  children,
  adminMode,
  ...props
}: {
  children: React.ReactNode;
  adminMode: AdminMode;
  activeSection: AdminSection;
  mobileMenuOpen: boolean;
  onSectionChange: (section: AdminSection) => void;
  onMobileMenuChange: (open: boolean) => void;
  userRole: string;
  tenantName?: string;
}) {
  const { currentTenantName } = useAdminTenant();

  return (
    <AdminLayout
      {...props}
      adminMode={adminMode}
      selectedTenantName={currentTenantName}
    >
      {children}
    </AdminLayout>
  );
}

export default Admin;
