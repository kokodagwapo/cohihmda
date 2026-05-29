import { ReactNode, useMemo } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  Crown,
  Briefcase,
  Code2,
  BookOpen,
  MessageSquareHeart,
  RefreshCw,
  Calculator,
  ArrowLeftRight,
  Folder,
  Megaphone,
  Coins,
  Mail,
  Map as MapIcon,
} from "lucide-react";
import type { AdminSection, AdminMode } from "@/hooks/admin/useAdminState";

// Define which sections are available for each role type
type AdminSectionDef = {
  id: AdminSection;
  label: string;
  icon: any;
  description: string;
  color: string;
  // Which roles can see this section
  allowedRoles: (
    | "super_admin"
    | "platform_admin"
    | "support"
    | "tenant_admin"
  )[];
  // Optional category for grouping
  category?: string;
  // Which admin mode this section belongs to (platform vs tenant context)
  // 'platform' = platform-level management, 'tenant' = tenant context/impersonation
  mode?: "platform" | "tenant";
};

// Section definitions with categories for visual grouping
const allAdminSections: AdminSectionDef[] = [
  // ============ PLATFORM MANAGEMENT (mode: platform) ============
  {
    id: "overview" as AdminSection,
    label: "Platform Overview",
    icon: BarChart3,
    description: "Platform-wide statistics and metrics",
    color: "text-blue-300 dark:text-blue-400/70",
    allowedRoles: ["super_admin", "platform_admin", "support"],
    category: "Platform",
    mode: "platform",
  },
  {
    id: "tenants" as AdminSection,
    label: "Tenants",
    icon: Building2,
    description: "Manage all tenant accounts",
    color: "text-emerald-300 dark:text-emerald-400/70",
    allowedRoles: ["super_admin", "platform_admin"],
    category: "Platform",
    mode: "platform",
  },
  {
    id: "platform-team" as AdminSection,
    label: "Platform Team",
    icon: Crown,
    description: "Manage Cohi internal team members",
    color: "text-amber-300 dark:text-amber-400/70",
    allowedRoles: ["super_admin"],
    category: "Platform",
    mode: "platform",
  },
  {
    id: "knowledge-library" as AdminSection,
    label: "Global Knowledge Library",
    icon: BookOpen,
    description: "Manage global docs synced to all tenants",
    color: "text-indigo-300 dark:text-indigo-400/70",
    allowedRoles: ["super_admin", "platform_admin"],
    category: "Global Content",
    mode: "platform",
  },
  {
    id: "infrastructure" as AdminSection,
    label: "System Health",
    icon: Server,
    description: "System configuration and health",
    color: "text-cyan-300 dark:text-cyan-400/70",
    allowedRoles: ["super_admin", "platform_admin"],
    category: "Infrastructure",
    mode: "platform",
  },
  {
    id: "security-compliance" as AdminSection,
    label: "Security & Compliance",
    icon: Shield,
    description: "Security settings and SOC 2 audit trail",
    color: "text-rose-300 dark:text-rose-400/70",
    allowedRoles: ["super_admin", "platform_admin"],
    category: "Security",
    mode: "platform",
  },
  {
    id: "stripe" as AdminSection,
    label: "Stripe Payments",
    icon: CreditCard,
    description: "Subscription and billing management",
    color: "text-violet-300 dark:text-violet-400/70",
    allowedRoles: ["super_admin"],
    category: "Billing",
    mode: "platform",
  },
  {
    id: "dev-tools" as AdminSection,
    label: "Developer Tools",
    icon: Code2,
    description: "Demo data, testing, and diagnostics",
    color: "text-slate-300 dark:text-slate-400/70",
    allowedRoles: ["super_admin", "platform_admin"],
    category: "Developer",
    mode: "platform",
  },
  {
    id: "ai-prompts" as AdminSection,
    label: "AI Prompts",
    icon: Brain,
    description: "Manage system prompts for all AI features",
    color: "text-violet-300 dark:text-violet-400/70",
    allowedRoles: ["super_admin", "platform_admin"],
    category: "Developer",
    mode: "platform",
  },
  {
    id: "insight-feedback" as AdminSection,
    label: "Insight Feedback",
    icon: MessageSquareHeart,
    description: "Review feedback, manage training examples, run experiments",
    color: "text-emerald-300 dark:text-emerald-400/70",
    allowedRoles: ["super_admin", "platform_admin"],
    category: "Developer",
    mode: "platform",
  },
  {
    id: "release-notes" as AdminSection,
    label: "Release Notes",
    icon: Megaphone,
    description: "Compose and distribute product release notes",
    color: "text-indigo-300 dark:text-indigo-400/70",
    allowedRoles: ["super_admin", "platform_admin"],
    category: "Global Content",
    mode: "platform",
  },
  {
    id: "sync-management" as AdminSection,
    label: "Sync Management",
    icon: RefreshCw,
    description: "Cross-tenant sync schedules and status",
    color: "text-cyan-300 dark:text-cyan-400/70",
    allowedRoles: ["super_admin", "platform_admin"],
    category: "Infrastructure",
    mode: "platform",
  },
  {
    id: "hmda-data" as AdminSection,
    label: "HMDA Data",
    icon: MapIcon,
    description: "Public HMDA static data status and manual refresh",
    color: "text-amber-300 dark:text-amber-400/70",
    allowedRoles: ["super_admin", "platform_admin"],
    category: "Infrastructure",
    mode: "platform",
  },
  {
    id: "platform-settings" as AdminSection,
    label: "Platform Settings",
    icon: Settings,
    description: "API keys and platform-wide configuration",
    color: "text-slate-300 dark:text-slate-400/70",
    allowedRoles: ["super_admin", "platform_admin"],
    category: "Infrastructure",
    mode: "platform",
  },
  {
    id: "feedback-notification-recipients" as AdminSection,
    label: "Feedback Recipients",
    icon: Mail,
    description: "Manage feedback notification recipient list",
    color: "text-blue-300 dark:text-blue-400/70",
    allowedRoles: ["super_admin"],
    category: "Infrastructure",
    mode: "platform",
  },
  {
    id: "api-usage" as AdminSection,
    label: "API Usage",
    icon: Coins,
    description: "Per-tenant OpenAI token and cost tracking",
    color: "text-yellow-300 dark:text-yellow-400/70",
    allowedRoles: ["super_admin", "platform_admin"],
    category: "Infrastructure",
    mode: "platform",
  },
  {
    id: "usage-report" as AdminSection,
    label: "Usage Report",
    icon: BarChart3,
    description: "Cross-tenant session and engagement report",
    color: "text-indigo-300 dark:text-indigo-400/70",
    allowedRoles: ["super_admin", "platform_admin"],
    category: "Infrastructure",
    mode: "platform",
  },

  // ============ TENANT CONTEXT (mode: tenant) ============
  // These sections are for managing a specific tenant (impersonation for platform admins)
  {
    id: "org" as AdminSection,
    label: "Organization Settings",
    icon: Briefcase,
    description: "Organization profile and branding",
    color: "text-teal-300 dark:text-teal-400/70",
    allowedRoles: ["super_admin", "platform_admin", "tenant_admin"],
    category: "Organization",
    mode: "tenant",
  },
  {
    id: "users" as AdminSection,
    label: "Users & Access",
    icon: Users,
    description: "Manage users, groups, and Encompass imports",
    color: "text-purple-300 dark:text-purple-400/70",
    allowedRoles: ["super_admin", "platform_admin", "tenant_admin"],
    category: "Users & Access",
    mode: "tenant",
  },
  {
    id: "sso" as AdminSection,
    label: "SSO Configuration",
    icon: Key,
    description: "Single Sign-On settings",
    color: "text-yellow-300 dark:text-yellow-400/70",
    allowedRoles: ["super_admin", "platform_admin", "tenant_admin"],
    category: "Users & Access",
    mode: "tenant",
  },
  {
    id: "data-quality" as AdminSection,
    label: "Data Quality",
    icon: CheckCircle2,
    description: "Opens the Data Quality dashboard",
    color: "text-lime-300 dark:text-lime-400/70",
    allowedRoles: ["super_admin", "platform_admin", "tenant_admin"],
    category: "Data",
    mode: "tenant",
  },
  {
    id: "data-config" as AdminSection,
    label: "Field Mapping",
    icon: Link2,
    description: "Map LOS fields to Coheus data",
    color: "text-indigo-300 dark:text-indigo-400/70",
    allowedRoles: ["super_admin", "platform_admin", "tenant_admin"],
    category: "Data",
    mode: "tenant",
  },
  {
    id: "revenue" as AdminSection,
    label: "Revenue",
    icon: Calculator,
    description: "Revenue and margin formulas",
    color: "text-emerald-300 dark:text-emerald-400/70",
    allowedRoles: ["super_admin", "platform_admin", "tenant_admin"],
    category: "Data",
    mode: "tenant",
  },
  {
    id: "scoring-weights" as AdminSection,
    label: "Scoring & Weights",
    icon: BarChart3,
    description: "Scorecard weights and loan complexity",
    color: "text-violet-300 dark:text-violet-400/70",
    allowedRoles: ["super_admin", "platform_admin", "tenant_admin"],
    category: "Data",
    mode: "tenant",
  },
  {
    id: "data-transfer" as AdminSection,
    label: "Import / Export",
    icon: ArrowLeftRight,
    description: "Legacy config import and tenant config transfer",
    color: "text-amber-300 dark:text-amber-400/70",
    allowedRoles: ["super_admin", "platform_admin"],
    category: "Data",
    mode: "tenant",
  },
  {
    id: "connections" as AdminSection,
    label: "Connections & Integrations",
    icon: Link2,
    description: "LOS and vendor integrations",
    color: "text-orange-300 dark:text-orange-400/70",
    allowedRoles: ["super_admin", "platform_admin", "tenant_admin"],
    category: "Data",
    mode: "tenant",
  },
  {
    id: "loan-folders" as AdminSection,
    label: "Loan Folders",
    icon: Folder,
    description: "Manage which Encompass folders to sync from",
    color: "text-orange-300 dark:text-orange-400/70",
    allowedRoles: ["super_admin", "platform_admin", "tenant_admin"],
    category: "Data",
    mode: "tenant",
  },
  {
    id: "rag-voice" as AdminSection,
    label: "AI Assistant",
    icon: Brain,
    description: "Voice settings, topics, and rules",
    color: "text-violet-300 dark:text-violet-400/70",
    allowedRoles: ["super_admin", "platform_admin"],
    category: "AI & Knowledge",
    mode: "tenant",
  },
  {
    id: "knowledge-center" as AdminSection,
    label: "Knowledge Center",
    icon: BookOpen,
    description: "Browse and manage knowledge base",
    color: "text-indigo-300 dark:text-indigo-400/70",
    allowedRoles: ["super_admin", "platform_admin", "tenant_admin"],
    category: "AI & Knowledge",
    mode: "tenant",
  },
  // Metrics Catalog hidden for now
  // {
  //   id: "metrics-catalog" as AdminSection,
  //   label: "Metrics Catalog",
  //   icon: Database,
  //   description: "Browse all available metrics and formulas",
  //   color: "text-teal-300 dark:text-teal-400/70",
  //   allowedRoles: ["super_admin", "platform_admin", "tenant_admin"],
  //   category: "AI & Knowledge",
  //   mode: "tenant",
  // },
];

// Helper to check if user is platform staff (Cohi internal)
export function isPlatformStaff(role: string | undefined): boolean {
  return ["super_admin", "platform_admin", "support"].includes(role || "");
}

interface AdminLayoutProps {
  activeSection: AdminSection;
  mobileMenuOpen: boolean;
  onSectionChange: (section: AdminSection) => void;
  onMobileMenuChange: (open: boolean) => void;
  children: ReactNode;
  userRole?: string;
  tenantName?: string;
  adminMode?: AdminMode;
  selectedTenantName?: string | null;
}

export const AdminLayout = ({
  activeSection,
  mobileMenuOpen,
  onSectionChange,
  onMobileMenuChange,
  children,
  userRole = "user",
  tenantName,
  adminMode = "platform",
  selectedTenantName,
}: AdminLayoutProps) => {
  const isPlatform = isPlatformStaff(userRole);

  // Filter sections based on user role, mode, and organize by category
  const { visibleSections, categorizedSections } = useMemo(() => {
    const filtered = allAdminSections.filter((section) => {
      // Role check
      if (!section.allowedRoles.includes(userRole as any)) return false;

      // Mode check for platform admins
      if (isPlatform) {
        // Platform admins see sections for the current mode
        if (section.mode && section.mode !== adminMode) {
          return false;
        }
      } else {
        // Tenant admins only see tenant-mode sections
        if (section.mode && section.mode !== "tenant") {
          return false;
        }
      }

      return true;
    });

    // Group by category for rendering with dividers
    const byCategory = new Map<string, AdminSectionDef[]>();
    filtered.forEach((section) => {
      const category = section.category || "Other";
      if (!byCategory.has(category)) {
        byCategory.set(category, []);
      }
      byCategory.get(category)!.push(section);
    });

    return { visibleSections: filtered, categorizedSections: byCategory };
  }, [userRole, adminMode, isPlatform]);

  // Determine nav title and icon based on role and mode
  const navTitle = isPlatform
    ? adminMode === "platform"
      ? "Platform Management"
      : "Tenant Context"
    : "Organization Admin";
  const navIcon = isPlatform
    ? adminMode === "platform"
      ? Crown
      : Building2
    : Briefcase;
  const NavIcon = navIcon;

  const renderCategoryDivider = (category: string) => (
    <div key={`divider-${category}`} className="pt-3 pb-1 px-3">
      <div className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
        {category}
      </div>
    </div>
  );

  const renderNavButton = (
    section: AdminSectionDef,
    isMobile: boolean = false
  ) => {
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
        data-tour={`admin-${section.id}`}
        data-testid={`admin-${section.id}`}
        onClick={handleClick}
        className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-all duration-200 rounded-lg group ${
          isActive
            ? "bg-gradient-to-r from-blue-500 to-purple-500 shadow-sm shadow-blue-500/20"
            : "hover:bg-blue-50/60 dark:hover:bg-slate-700/40"
        }`}
        whileHover={!isMobile ? { x: 2 } : undefined}
        whileTap={{ scale: 0.98 }}
      >
        <div
          className={`p-1.5 rounded-md transition-all ${
            isActive
              ? "bg-white/25"
              : "bg-blue-100/50 dark:bg-slate-700/50 group-hover:bg-blue-200/50 dark:group-hover:bg-slate-600/50"
          }`}
        >
          <Icon
            className={`h-3.5 w-3.5 flex-shrink-0 ${
              isActive ? "text-white" : "text-blue-600 dark:text-slate-300"
            }`}
            strokeWidth={2}
          />
        </div>
        <span
          className={`text-sm font-light tracking-tight truncate ${
            isActive
              ? "text-white"
              : "text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white"
          }`}
        >
          {section.label}
        </span>
        {isActive && (
          <ChevronRight
            className="h-3.5 w-3.5 text-white flex-shrink-0 ml-auto"
            strokeWidth={2.5}
          />
        )}
      </motion.button>
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 h-full overflow-hidden">
      {/* Desktop Sidebar Navigation - Hidden on mobile */}
      <div className="hidden lg:block lg:col-span-1 overflow-y-auto">
        <Card className="border-blue-200/40 dark:border-slate-700/50 bg-white/95 dark:bg-slate-800/80 backdrop-blur-xl shadow-[0_8px_30px_rgba(59,130,246,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.3)] rounded-2xl overflow-hidden">
          <CardHeader className="py-3 px-3 border-b border-blue-100/50 dark:border-slate-700/50 bg-gradient-to-r from-blue-50/50 to-purple-50/50">
            <CardTitle className="text-sm font-medium text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
              <NavIcon
                className={`h-4 w-4 ${
                  isPlatform
                    ? adminMode === "platform"
                      ? "text-amber-500"
                      : "text-emerald-500"
                    : "text-blue-500"
                }`}
                strokeWidth={1.5}
              />
              {navTitle}
            </CardTitle>
            {!isPlatform && tenantName && (
              <p className="text-xs text-slate-500 dark:text-slate-400 font-light">
                {tenantName}
              </p>
            )}
            {isPlatform && adminMode === "tenant" && selectedTenantName && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                {selectedTenantName}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-0.5 p-2">
            {Array.from(categorizedSections.entries()).map(
              ([category, sections], index) => (
                <div key={category}>
                  {index > 0 && renderCategoryDivider(category)}
                  {index === 0 && <div className="pb-1" />}
                  {sections.map((section) => renderNavButton(section, false))}
                </div>
              )
            )}
          </CardContent>
        </Card>
      </div>

      {/* Mobile Sidebar Sheet */}
      <Sheet open={mobileMenuOpen} onOpenChange={onMobileMenuChange}>
        <SheetContent
          side="left"
          className="w-[85vw] sm:w-[320px] p-0 overflow-y-auto"
        >
          <div className="h-full flex flex-col">
            <SheetHeader className="px-6 pt-6 pb-4 border-b border-blue-100/50 dark:border-slate-700/50 bg-gradient-to-r from-blue-50/50 to-purple-50/50">
              <div className="flex items-center justify-between">
                <div>
                  <SheetTitle className="text-xl font-thin text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                    <NavIcon
                      className={`h-5 w-5 ${
                        isPlatform
                          ? adminMode === "platform"
                            ? "text-amber-500"
                            : "text-emerald-500"
                          : "text-blue-500"
                      }`}
                      strokeWidth={1.5}
                    />
                    {navTitle}
                  </SheetTitle>
                  {!isPlatform && tenantName && (
                    <p className="text-sm text-slate-500 dark:text-slate-400 font-light mt-1">
                      {tenantName}
                    </p>
                  )}
                  {isPlatform &&
                    adminMode === "tenant" &&
                    selectedTenantName && (
                      <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium mt-1">
                        {selectedTenantName}
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
              {Array.from(categorizedSections.entries()).map(
                ([category, sections], index) => (
                  <div key={category}>
                    {index > 0 && renderCategoryDivider(category)}
                    {index === 0 && <div className="pb-1" />}
                    {sections.map((section) => renderNavButton(section, true))}
                  </div>
                )
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <div className="lg:col-span-3 space-y-4 sm:space-y-6 w-full min-w-0 overflow-y-auto pb-8">
        {children}
      </div>
    </div>
  );
};
