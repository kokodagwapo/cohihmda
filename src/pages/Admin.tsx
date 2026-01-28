import { useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Navigation } from '@/components/layout/Navigation';
import { AdminPreloader } from '@/components/admin/AdminPreloader';
import { AdminContainer } from '@/components/admin/AdminContainer';
import { AdminLayout, isPlatformStaff } from '@/components/admin/AdminLayout';
import { OverviewSection } from '@/components/admin/OverviewSection';
import { TenantsSection } from '@/components/admin/TenantsSection';
import { SystemSection } from '@/components/admin/SystemSection';
import { SecuritySection } from '@/components/admin/SecuritySection';
import { LOSSettingsSection } from '@/components/admin/LOSSettingsSection';
import { SynapseSection } from '@/components/admin/SynapseSection';
import { DeploymentSection } from '@/components/admin/DeploymentSection';
import { RAGVoiceSection } from '@/components/admin/RAGVoiceSection';
import { UserManagementSection } from '@/components/admin/UserManagementSection';
import { RolesPermissionsSection } from '@/components/admin/RolesPermissionsSection';
import { SSOConfigSection } from '@/components/admin/SSOConfigSection';
import { OrgSettingsSection } from '@/components/admin/OrgSettingsSection';
import { DataQualitySection } from '@/components/admin/DataQualitySection';
import { TenantConfigSection } from '@/components/admin/tenant-config';
import { SOC2ComplianceSection } from '@/components/admin/SOC2ComplianceSection';
import { StripeSection } from '@/components/admin/StripeSection';
import { AWSHostingSection } from '@/components/admin/AWSHostingSection';
import { DemoDataSection } from '@/components/admin/DemoDataSection';
import { MetricsCatalogSection } from '@/components/admin/MetricsCatalogSection';
import { TenantSelectorCard } from '@/components/admin/TenantSelectorCard';
import { Button } from '@/components/ui/button';
import { Menu, Settings, Crown, Briefcase } from 'lucide-react';
import { useAdminState, AdminSection } from '@/hooks/admin/useAdminState';
import { useAdminStats } from '@/hooks/admin/useAdminStats';
import { useSystemInfo } from '@/hooks/admin/useSystemInfo';
import { useTenants } from '@/hooks/admin/useTenants';
import { useSecurityInfo } from '@/hooks/admin/useSecurityInfo';
import { useLOSConnections } from '@/hooks/admin/useLOSConnections';
import { useSynapseConnections } from '@/hooks/admin/useSynapseConnections';
import { useDeployments } from '@/hooks/admin/useDeployments';
import { useRAGSettings } from '@/hooks/admin/useRAGSettings';
import { useUsers } from '@/hooks/admin/useUsers';
import { useStripeData } from '@/hooks/admin/useStripeData';
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { AdminTenantProvider, useAdminTenant } from '@/contexts/AdminTenantContext';

export const Admin = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  
  // Determine user role and if they're platform staff (Cohi internal)
  const userRole = user?.role || 'user';
  const isPlatform = isPlatformStaff(userRole);
  const tenantName = user?.tenant_name;
  
  // Determine default section based on role
  const defaultSection: AdminSection = isPlatform ? 'overview' : 'org-overview';
  
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
  } = useAdminState();

  // Data hooks
  const { stats, loading: statsLoading, refetch: refetchStats } = useAdminStats();
  const { systemInfo, loading: systemLoading, loadSystemInfo } = useSystemInfo();
  const { 
    tenants, 
    loading: tenantsLoading, 
    loadTenants,
    createTenant,
    updateTenant,
    deleteTenant,
  } = useTenants();
  const { securityInfo, loading: securityLoading, loadSecurityInfo } = useSecurityInfo();
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
    vendorConnections,
    vendorCatalog,
    loading: synapseLoading,
    loadSynapseData,
    testConnection: testSynapseConnection,
    createConnection: createSynapseConnection,
  } = useSynapseConnections();
  const {
    deployments,
    syncEvents,
    deploymentsLoading,
    syncEventsLoading,
    loadDeployments,
    loadSyncEvents,
    provision,
    register,
    startSync,
    failover,
  } = useDeployments();
  const {
    ragVoiceSettings,
    ragVoiceCosts,
    loading: ragVoiceLoading,
    loadRagVoiceData,
    saveRagVoiceSettings,
    saveApiKeys,
  } = useRAGSettings();
  const {
    users,
    loading: usersLoading,
    loadUsers,
    createUser,
    updateUser,
    deleteUser,
  } = useUsers();
  const {
    subscriptionPlans,
    subscriptions,
    loading: stripeLoading,
    loadStripeData,
  } = useStripeData();

  // Local state for search
  const [searchQuery, setSearchQuery] = useState('');
  
  // Check if user has admin access (either platform staff or tenant admin)
  const isAdmin = useMemo(() => {
    return isPlatform || userRole === 'tenant_admin';
  }, [isPlatform, userRole]);

  // Set initial section based on role and handle initial load
  useEffect(() => {
    // Set the default section based on user role
    if (!isPlatform && activeSection === 'overview') {
      setActiveSection('org-overview');
    } else if (isPlatform && activeSection === 'org-overview') {
      setActiveSection('overview');
    }
    
    // Set initial load to false after brief delay
    const timeout = setTimeout(() => {
      setInitialLoad(false);
    }, 500);

    return () => clearTimeout(timeout);
  }, [isPlatform, activeSection, setActiveSection, setInitialLoad]);

  // Lazy load section data
  useEffect(() => {
    const loadSectionData = async () => {
      if (isSectionLoaded(activeSection)) {
        return;
      }

      try {
        switch (activeSection) {
          case 'tenants':
            await loadTenants();
            break;
          case 'users':
            await loadUsers();
            break;
          case 'roles':
            // Roles section loads its own data
            break;
          case 'sso':
            // SSO section loads its own data
            break;
          case 'org':
            // Org settings section loads its own data
            break;
          case 'data-quality':
            // Data quality section loads its own data
            break;
          case 'system':
            await loadSystemInfo();
            break;
          case 'security':
            await loadSecurityInfo();
            break;
          case 'los':
            // For tenant admins, automatically load their tenant's LOS data
            if (!isPlatform && user?.tenant_id) {
              await loadLosData(user.tenant_id);
            } else {
              await loadLosData();
            }
            break;
          case 'synapse':
            await loadSynapseData();
            break;
          case 'deployment':
            await loadDeployments();
            await loadSyncEvents();
            break;
          case 'rag-voice':
            await loadRagVoiceData(false);
            break;
          case 'metrics-catalog':
            // Metrics catalog loads on demand, no pre-loading needed
            break;
        }
        markSectionLoaded(activeSection);
      } catch (error) {
        console.error(`Error loading ${activeSection} data:`, error);
      }
    };

    if (!initialLoad && activeSection !== 'overview') {
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
    loadSynapseData,
    loadDeployments,
    loadSyncEvents,
    loadRagVoiceData,
    isPlatform,
    user?.tenant_id,
  ]);

  // Get current section name for mobile header
  const getCurrentSectionLabel = () => {
    const sections = [
      { id: 'overview', label: 'Platform Overview' },
      { id: 'org-overview', label: 'Overview' },
      { id: 'tenants', label: 'Tenants' },
      { id: 'users', label: 'Users' },
      { id: 'roles', label: 'Roles & Permissions' },
      { id: 'sso', label: 'SSO Configuration' },
      { id: 'org', label: 'Organization Settings' },
      { id: 'data-quality', label: 'Data Quality' },
      { id: 'data-config', label: 'Data Configuration' },
      { id: 'los', label: 'LOS Settings' },
      { id: 'synapse', label: 'Integrations' },
      { id: 'rag-voice', label: 'AI Assistant' },
      { id: 'demo', label: 'Demo Data' },
      { id: 'system', label: 'System' },
      { id: 'security', label: 'Platform Security' },
      { id: 'soc2', label: 'SOC 2 Compliance' },
      { id: 'deployment', label: 'Deployment' },
      { id: 'stripe', label: 'Stripe Payments' },
      { id: 'aws-hosting', label: 'AWS Hosting' },
      { id: 'metrics-catalog', label: 'Metrics Catalog' },
    ];
    return sections.find(s => s.id === activeSection)?.label || 'Overview';
  };
  
  // Get page title and description based on role
  const pageTitle = isPlatform ? 'Platform Admin' : 'Organization Settings';
  const pageDescription = isPlatform 
    ? 'Manage tenants, platform settings, and monitor system health'
    : 'Manage your organization\'s users, settings, and integrations';
  const HeaderIcon = isPlatform ? Crown : Briefcase;

  return (
    <AdminTenantProvider>
      <AdminContainer isAdmin={isAdmin}>
        <div className="min-h-screen bg-gradient-to-br from-blue-50/30 via-white to-blue-50/20 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950/50">
          {/* Preloader */}
          <AdminPreloader show={initialLoad} />
        
        <Navigation />
        
        {/* Background pattern */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.03),transparent_50%),radial-gradient(circle_at_80%_80%,rgba(168,85,247,0.02),transparent_50%)] pointer-events-none" />
        
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 pt-20 sm:pt-24 pb-8 sm:pb-12 relative z-10">
          {/* Header */}
          <div className="mb-6 sm:mb-10">
            <div className="flex items-center gap-3 sm:gap-4 mb-3">
              <div className={`h-10 sm:h-12 w-1 rounded-full shadow-lg flex-shrink-0 ${
                isPlatform 
                  ? 'bg-gradient-to-b from-amber-500 to-orange-500' 
                  : 'bg-gradient-to-b from-blue-500 to-purple-500'
              }`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <HeaderIcon className={`h-8 w-8 sm:h-10 sm:w-10 ${
                    isPlatform ? 'text-amber-500' : 'text-blue-500'
                  }`} strokeWidth={1.5} />
                  <h1 className="text-3xl sm:text-5xl lg:text-6xl font-thin text-slate-900 dark:text-white tracking-tight">
                    {pageTitle}
                  </h1>
                </div>
                <p className="text-sm sm:text-base lg:text-lg text-slate-600 dark:text-slate-400 font-extralight tracking-wide mt-2 sm:mt-2.5">
                  {pageDescription}
                </p>
                {tenantName && !isPlatform && (
                  <p className="text-sm text-blue-600 dark:text-blue-400 font-medium mt-1">
                    {tenantName}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Mobile Hamburger Menu Button */}
          <div className="lg:hidden mb-4 sm:mb-6 flex items-center justify-between">
            <Button
              variant="outline"
              size="lg"
              onClick={() => setMobileMenuOpen(true)}
              className="h-11 sm:h-12 px-4 border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 shadow-sm hover:shadow-md transition-all duration-300 rounded-xl touch-manipulation"
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5 sm:h-5 sm:w-5 mr-2 text-slate-700 dark:text-slate-300" strokeWidth={1.5} />
              <span className="text-base font-extralight text-slate-700 dark:text-slate-300">Menu</span>
            </Button>
            {/* Show current section on mobile */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/90 dark:bg-slate-800/70 border border-slate-200/60 dark:border-slate-700/50">
              <Settings className="h-4 w-4 text-blue-600 dark:text-blue-400" strokeWidth={1.5} />
              <span className="text-sm sm:text-base font-extralight text-slate-700 dark:text-slate-300 truncate max-w-[120px] sm:max-w-none">
                {getCurrentSectionLabel()}
              </span>
            </div>
          </div>

          {/* Global Tenant Selector - Only shown for platform admins */}
          {isPlatform && (
            <div className="mb-6">
              <TenantSelectorCard />
            </div>
          )}

          <AdminLayout
            activeSection={activeSection}
            mobileMenuOpen={mobileMenuOpen}
            onSectionChange={setActiveSection}
            onMobileMenuChange={setMobileMenuOpen}
            userRole={userRole}
            tenantName={tenantName}
          >
            {/* Platform Overview Section (Super Admin) */}
            {activeSection === 'overview' && isPlatform && (
              <OverviewSection stats={stats} overviewLoading={statsLoading} />
            )}

            {/* Organization Overview Section (Tenant Admin) */}
            {activeSection === 'org-overview' && !isPlatform && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <div className="space-y-6">
                  <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6">
                    <h2 className="text-2xl font-light text-slate-900 dark:text-white mb-4">
                      Welcome, {user?.full_name || 'Admin'}
                    </h2>
                    <p className="text-slate-600 dark:text-slate-400 mb-6">
                      Manage your organization's users, integrations, and settings from this dashboard.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                        <h3 className="text-lg font-medium text-blue-900 dark:text-blue-100">Users</h3>
                        <p className="text-sm text-blue-700 dark:text-blue-300">Manage team members and permissions</p>
                      </div>
                      <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
                        <h3 className="text-lg font-medium text-purple-900 dark:text-purple-100">Integrations</h3>
                        <p className="text-sm text-purple-700 dark:text-purple-300">Connect your LOS and vendors</p>
                      </div>
                      <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/20 dark:to-emerald-800/20 rounded-lg p-4 border border-emerald-200 dark:border-emerald-800">
                        <h3 className="text-lg font-medium text-emerald-900 dark:text-emerald-100">Data Quality</h3>
                        <p className="text-sm text-emerald-700 dark:text-emerald-300">Monitor data health and issues</p>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Tenants Section */}
            {activeSection === 'tenants' && (
              <TenantsSection
                tenants={tenants}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onCreateTenant={createTenant}
                onUpdateTenant={updateTenant}
                onDeleteTenant={deleteTenant}
                onRefresh={loadTenants}
              />
            )}

            {/* Users Section */}
            {activeSection === 'users' && (
              <UserManagementSection />
            )}

            {/* Roles & Permissions Section */}
            {activeSection === 'roles' && (
              <RolesPermissionsSection />
            )}

            {/* SSO Configuration Section */}
            {activeSection === 'sso' && (
              <SSOConfigSection />
            )}

            {/* Organization Settings Section */}
            {activeSection === 'org' && (
              <OrgSettingsSection />
            )}

            {/* Data Quality Section */}
            {activeSection === 'data-quality' && (
              <DataQualitySection />
            )}

            {/* Data Configuration Section */}
            {activeSection === 'data-config' && (
              <TenantConfigSection />
            )}

            {/* System Section */}
            {activeSection === 'system' && (
              <SystemSection systemInfo={systemInfo} loading={systemLoading} />
            )}

            {/* Security Section */}
            {activeSection === 'security' && (
              <SecuritySection
                securityInfo={securityInfo}
                loading={securityLoading}
                onNavigate={setActiveSection}
              />
            )}

            {/* SOC 2 Compliance Section */}
            {activeSection === 'soc2' && (
              <SOC2ComplianceSection />
            )}

            {/* LOS Settings Section */}
            {activeSection === 'los' && (
              <LOSSettingsSection
                losConnections={losConnections}
                losTypes={losTypes}
                loading={losLoading}
                tenantMetrics={tenantMetrics}
                loadingMetrics={loadingMetrics}
                onTest={testLosConnection}
                onSync={syncLosConnection}
                onToggle={toggleLosConnection}
                onCreate={createLosConnection}
                onUpdate={updateLosConnection}
                onDelete={deleteLosConnection}
                onLoadLosData={loadLosData}
                onLoadMetrics={async (tenantId) => {
                  setLoadingMetrics(true);
                  try {
                    const metrics = await api.request(`/api/admin/tenants/${tenantId}/metrics`);
                    setTenantMetrics(metrics.metrics);
                  } catch (error: any) {
                    console.error('Error loading tenant metrics:', error);
                    toast({
                      title: 'Error',
                      description: 'Failed to load tenant metrics',
                      variant: 'destructive',
                    });
                  } finally {
                    setLoadingMetrics(false);
                  }
                }}
              />
            )}

            {/* Synapse Connect Section */}
            {activeSection === 'synapse' && (
              <SynapseSection
                vendorConnections={vendorConnections}
                vendorCatalog={vendorCatalog}
                loading={synapseLoading}
                onTest={testSynapseConnection}
                onCreate={createSynapseConnection}
                onRefresh={loadSynapseData}
              />
            )}

            {/* Demo Data Section */}
            {activeSection === 'demo' && (
              <DemoDataSection />
            )}

            {/* Deployment Section */}
            {activeSection === 'deployment' && (
              <DeploymentSection
                deployments={deployments}
                syncEvents={syncEvents}
                deploymentsLoading={deploymentsLoading}
                syncEventsLoading={syncEventsLoading}
                onProvision={provision}
                onRegister={register}
                onSync={startSync}
                onFailover={failover}
              />
            )}

            {/* Stripe Payments Section */}
            {activeSection === 'stripe' && (
              <StripeSection
                subscriptionPlans={subscriptionPlans}
                subscriptions={subscriptions}
                loading={stripeLoading}
                onRefresh={loadStripeData}
              />
            )}

            {/* AWS Hosting Section */}
            {activeSection === 'aws-hosting' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <AWSHostingSection />
              </motion.div>
            )}

            {/* RAG & Voice Section */}
            {activeSection === 'rag-voice' && (
              <RAGVoiceSection
                ragVoiceSettings={ragVoiceSettings}
                ragVoiceCosts={ragVoiceCosts}
                loading={ragVoiceLoading}
                onSave={saveRagVoiceSettings}
                onRefresh={loadRagVoiceData}
                onSaveApiKeys={saveApiKeys}
              />
            )}

            {/* Metrics Catalog Section */}
            {activeSection === 'metrics-catalog' && (
              <MetricsCatalogSection />
            )}
          </AdminLayout>
        </div>
      </div>
      </AdminContainer>
    </AdminTenantProvider>
  );
};

export default Admin;
