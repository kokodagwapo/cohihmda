import { ReactNode, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Settings,
  BarChart3,
  Building2,
  Users,
  Link2,
  Brain,
  Server,
  Shield,
  Key,
  CheckCircle2,
  Cloud,
  CreditCard,
  ChevronRight,
  X,
  Database,
  Crown,
  Briefcase,
  Code2,
} from 'lucide-react';
import type { AdminSection } from '@/hooks/admin/useAdminState';

// Define which sections are available for each role type
type AdminSectionDef = {
  id: AdminSection;
  label: string;
  icon: any;
  description: string;
  color: string;
  // Which roles can see this section
  allowedRoles: ('super_admin' | 'platform_admin' | 'support' | 'tenant_admin')[];
  // Optional category for grouping
  category?: string;
};

// Section definitions with categories for visual grouping
const allAdminSections: AdminSectionDef[] = [
  // ============ PLATFORM MANAGEMENT ============
  { id: 'overview' as AdminSection, label: 'Platform Overview', icon: BarChart3, description: 'Platform-wide statistics and metrics', color: 'text-blue-300 dark:text-blue-400/70', allowedRoles: ['super_admin', 'platform_admin', 'support'], category: 'Platform' },
  { id: 'tenants' as AdminSection, label: 'Tenants', icon: Building2, description: 'Manage all tenant accounts', color: 'text-emerald-300 dark:text-emerald-400/70', allowedRoles: ['super_admin', 'platform_admin'], category: 'Platform' },
  { id: 'platform-team' as AdminSection, label: 'Platform Team', icon: Crown, description: 'Manage Cohi internal team members', color: 'text-amber-300 dark:text-amber-400/70', allowedRoles: ['super_admin'], category: 'Platform' },
  { id: 'deployment' as AdminSection, label: 'Deployment', icon: Cloud, description: 'Manage deployment instances', color: 'text-sky-300 dark:text-sky-400/70', allowedRoles: ['super_admin', 'platform_admin'], category: 'Platform' },
  
  // ============ ORGANIZATION (Tenant Admin) ============
  { id: 'org-overview' as AdminSection, label: 'Overview', icon: BarChart3, description: 'Organization statistics and health', color: 'text-blue-300 dark:text-blue-400/70', allowedRoles: ['tenant_admin'], category: 'Organization' },
  { id: 'org' as AdminSection, label: 'Organization Settings', icon: Briefcase, description: 'Organization profile and branding', color: 'text-teal-300 dark:text-teal-400/70', allowedRoles: ['tenant_admin'], category: 'Organization' },
  
  // ============ USER MANAGEMENT ============
  { id: 'users' as AdminSection, label: 'Users', icon: Users, description: 'Manage organization users', color: 'text-purple-300 dark:text-purple-400/70', allowedRoles: ['super_admin', 'platform_admin', 'tenant_admin'], category: 'Users & Access' },
  { id: 'roles' as AdminSection, label: 'Access & Permissions', icon: Shield, description: 'Feature access and action permissions', color: 'text-pink-300 dark:text-pink-400/70', allowedRoles: ['super_admin', 'platform_admin', 'tenant_admin'], category: 'Users & Access' },
  { id: 'sso' as AdminSection, label: 'SSO Configuration', icon: Key, description: 'Single Sign-On settings', color: 'text-yellow-300 dark:text-yellow-400/70', allowedRoles: ['super_admin', 'platform_admin', 'tenant_admin'], category: 'Users & Access' },
  
  // ============ DATA MANAGEMENT ============
  { id: 'data-quality' as AdminSection, label: 'Data Quality', icon: CheckCircle2, description: 'Monitor and resolve data issues', color: 'text-lime-300 dark:text-lime-400/70', allowedRoles: ['super_admin', 'platform_admin', 'tenant_admin'], category: 'Data' },
  { id: 'data-config' as AdminSection, label: 'Field Mapping & Rules', icon: Settings, description: 'Field mappings, ranges, filters, and scoring', color: 'text-indigo-300 dark:text-indigo-400/70', allowedRoles: ['super_admin', 'platform_admin', 'tenant_admin'], category: 'Data' },
  { id: 'connections' as AdminSection, label: 'Connections & Integrations', icon: Link2, description: 'LOS and vendor integrations', color: 'text-orange-300 dark:text-orange-400/70', allowedRoles: ['super_admin', 'platform_admin', 'tenant_admin'], category: 'Data' },
  
  // ============ AI & INTELLIGENCE ============
  { id: 'rag-voice' as AdminSection, label: 'AI Assistant', icon: Brain, description: 'Voice settings, topics, and rules', color: 'text-violet-300 dark:text-violet-400/70', allowedRoles: ['super_admin', 'platform_admin', 'tenant_admin'], category: 'AI' },
  { id: 'metrics-catalog' as AdminSection, label: 'Metrics Catalog', icon: Database, description: 'Browse all available metrics and formulas', color: 'text-teal-300 dark:text-teal-400/70', allowedRoles: ['super_admin', 'platform_admin', 'tenant_admin'], category: 'AI' },
  
  // ============ SECURITY & COMPLIANCE ============
  { id: 'security-compliance' as AdminSection, label: 'Security & Compliance', icon: Shield, description: 'Security settings and SOC 2 audit trail', color: 'text-rose-300 dark:text-rose-400/70', allowedRoles: ['super_admin', 'platform_admin'], category: 'Security' },
  { id: 'infrastructure' as AdminSection, label: 'Infrastructure', icon: Server, description: 'System configuration and health', color: 'text-cyan-300 dark:text-cyan-400/70', allowedRoles: ['super_admin', 'platform_admin'], category: 'Security' },
  
  // ============ BILLING ============
  { id: 'stripe' as AdminSection, label: 'Stripe Payments', icon: CreditCard, description: 'Subscription and billing management', color: 'text-violet-300 dark:text-violet-400/70', allowedRoles: ['super_admin'], category: 'Billing' },
  { id: 'aws-hosting' as AdminSection, label: 'AWS Hosting', icon: Cloud, description: 'Per-lender AWS hosting and billing', color: 'text-orange-300 dark:text-orange-400/70', allowedRoles: ['super_admin'], category: 'Billing' },
  
  // ============ DEVELOPER TOOLS ============
  { id: 'dev-tools' as AdminSection, label: 'Developer Tools', icon: Code2, description: 'Demo data, testing, and diagnostics', color: 'text-slate-300 dark:text-slate-400/70', allowedRoles: ['super_admin', 'platform_admin'], category: 'Developer' },
];

// Helper to check if user is platform staff (Cohi internal)
export function isPlatformStaff(role: string | undefined): boolean {
  return ['super_admin', 'platform_admin', 'support'].includes(role || '');
}

interface AdminLayoutProps {
  activeSection: AdminSection;
  mobileMenuOpen: boolean;
  onSectionChange: (section: AdminSection) => void;
  onMobileMenuChange: (open: boolean) => void;
  children: ReactNode;
  userRole?: string;
  tenantName?: string;
}

export const AdminLayout = ({
  activeSection,
  mobileMenuOpen,
  onSectionChange,
  onMobileMenuChange,
  children,
  userRole = 'user',
  tenantName,
}: AdminLayoutProps) => {
  // Filter sections based on user role and organize by category
  const { visibleSections, categorizedSections } = useMemo(() => {
    const filtered = allAdminSections.filter(section => 
      section.allowedRoles.includes(userRole as any)
    );
    
    // Group by category for rendering with dividers
    const byCategory = new Map<string, AdminSectionDef[]>();
    filtered.forEach(section => {
      const category = section.category || 'Other';
      if (!byCategory.has(category)) {
        byCategory.set(category, []);
      }
      byCategory.get(category)!.push(section);
    });
    
    return { visibleSections: filtered, categorizedSections: byCategory };
  }, [userRole]);

  const isPlatform = isPlatformStaff(userRole);
  const navTitle = isPlatform ? 'Platform Admin' : 'Organization Admin';
  const navIcon = isPlatform ? Crown : Briefcase;
  const NavIcon = navIcon;
  
  // Render category divider
  const renderCategoryDivider = (category: string) => (
    <div key={`divider-${category}`} className="pt-4 pb-2 px-4">
      <div className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
        {category}
      </div>
    </div>
  );

  const renderNavButton = (section: AdminSectionDef, isMobile: boolean = false) => {
    const Icon = section.icon;
    const isActive = activeSection === section.id;

    const handleClick = () => {
      onSectionChange(section.id);
      if (isMobile) {
        onMobileMenuChange(false);
      }
    };

    return (
      <motion.button
        key={section.id}
        onClick={handleClick}
        className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-all duration-300 rounded-xl group ${
          isActive
            ? 'bg-gradient-to-r from-blue-500 to-purple-500 shadow-lg shadow-blue-500/30'
            : 'hover:bg-blue-50/60 dark:hover:bg-slate-700/40 hover:shadow-sm'
        }`}
        whileHover={!isMobile ? { x: 4, scale: 1.01 } : undefined}
        whileTap={{ scale: 0.98 }}
      >
        <div className={`p-2 rounded-lg transition-all ${
          isActive
            ? 'bg-white/25'
            : 'bg-blue-100/50 dark:bg-slate-700/50 group-hover:bg-blue-200/50 dark:group-hover:bg-slate-600/50'
        }`}>
          <Icon 
            className={`h-4 w-4 flex-shrink-0 ${
              isActive 
                ? 'text-white'
                : 'text-blue-600 dark:text-slate-300'
            }`} 
            strokeWidth={2}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-base font-extralight tracking-tight ${
            isActive
              ? 'text-white'
              : 'text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white'
          }`}>
            {section.label}
          </div>
          <div className={`text-sm mt-0.5 font-thin truncate ${
            isActive
              ? 'text-white/80'
              : 'text-slate-500 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-400'
          }`}>
            {section.description}
          </div>
        </div>
        {isActive && (
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 15 }}
          >
            <ChevronRight className="h-4 w-4 text-white flex-shrink-0" strokeWidth={2.5} />
          </motion.div>
        )}
      </motion.button>
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
      {/* Desktop Sidebar Navigation - Hidden on mobile */}
      <div className="hidden lg:block lg:col-span-1">
        <Card className="sticky top-24 border-blue-200/40 dark:border-slate-700/50 bg-white/95 dark:bg-slate-800/80 backdrop-blur-xl shadow-[0_8px_30px_rgba(59,130,246,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.3)] rounded-2xl overflow-hidden">
          <CardHeader className="pb-4 border-b border-blue-100/50 dark:border-slate-700/50 bg-gradient-to-r from-blue-50/50 to-purple-50/50">
            <CardTitle className="text-xl font-thin text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
              <NavIcon className={`h-5 w-5 ${isPlatform ? 'text-amber-500' : 'text-blue-500'}`} strokeWidth={1.5} />
              {navTitle}
            </CardTitle>
            {tenantName && !isPlatform && (
              <p className="text-sm text-slate-500 dark:text-slate-400 font-light mt-1">
                {tenantName}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-1 p-3">
            {Array.from(categorizedSections.entries()).map(([category, sections], index) => (
              <div key={category}>
                {index > 0 && renderCategoryDivider(category)}
                {index === 0 && <div className="pb-1" />}
                {sections.map((section) => renderNavButton(section, false))}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Mobile Sidebar Sheet */}
      <Sheet open={mobileMenuOpen} onOpenChange={onMobileMenuChange}>
        <SheetContent side="left" className="w-[85vw] sm:w-[320px] p-0 overflow-y-auto">
          <div className="h-full flex flex-col">
            <SheetHeader className="px-6 pt-6 pb-4 border-b border-blue-100/50 dark:border-slate-700/50 bg-gradient-to-r from-blue-50/50 to-purple-50/50">
              <div className="flex items-center justify-between">
                <div>
                  <SheetTitle className="text-xl font-thin text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                    <NavIcon className={`h-5 w-5 ${isPlatform ? 'text-amber-500' : 'text-blue-500'}`} strokeWidth={1.5} />
                    {navTitle}
                  </SheetTitle>
                  {tenantName && !isPlatform && (
                    <p className="text-sm text-slate-500 dark:text-slate-400 font-light mt-1">
                      {tenantName}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onMobileMenuChange(false)}
                  className="h-8 w-8 rounded-lg"
                >
                  <X className="h-4 w-4" strokeWidth={2} />
                </Button>
              </div>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
              {Array.from(categorizedSections.entries()).map(([category, sections], index) => (
                <div key={category}>
                  {index > 0 && renderCategoryDivider(category)}
                  {index === 0 && <div className="pb-1" />}
                  {sections.map((section) => renderNavButton(section, true))}
                </div>
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <div className="lg:col-span-3 space-y-4 sm:space-y-6 w-full min-w-0">
        {children}
      </div>
    </div>
  );
};

