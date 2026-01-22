import { ReactNode } from 'react';
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
  Zap,
  Brain,
  FileText,
  Server,
  Shield,
  CheckCircle2,
  Cloud,
  CreditCard,
  ChevronRight,
  X,
  Database,
} from 'lucide-react';
import type { AdminSection } from '@/hooks/admin/useAdminState';

const adminSections = [
  { id: 'overview' as AdminSection, label: 'Overview', icon: BarChart3, description: 'System statistics and metrics', color: 'text-blue-300 dark:text-blue-400/70' },
  { id: 'tenants' as AdminSection, label: 'Tenants', icon: Building2, description: 'Manage tenant accounts', color: 'text-emerald-300 dark:text-emerald-400/70' },
  { id: 'users' as AdminSection, label: 'Users', icon: Users, description: 'User management', color: 'text-purple-300 dark:text-purple-400/70' },
  { id: 'los' as AdminSection, label: 'LOS Settings', icon: Link2, description: 'Loan Origination System connections', color: 'text-orange-300 dark:text-orange-400/70' },
  { id: 'synapse' as AdminSection, label: 'Synapse Connect', icon: Zap, description: 'Vendor API integrations', color: 'text-amber-300 dark:text-amber-400/70' },
  { id: 'rag-voice' as AdminSection, label: 'RAG & Voice Agentic', icon: Brain, description: 'Aletheia voice settings, topics, rules, and costs', color: 'text-orange-300 dark:text-orange-400/70' },
  { id: 'demo' as AdminSection, label: 'Demo Data', icon: FileText, description: 'Upload test CSV files with anonymized data', color: 'text-indigo-300 dark:text-indigo-400/70' },
  { id: 'system' as AdminSection, label: 'System', icon: Server, description: 'System configuration', color: 'text-cyan-300 dark:text-cyan-400/70' },
  { id: 'security' as AdminSection, label: 'Security', icon: Shield, description: 'Security settings', color: 'text-rose-300 dark:text-rose-400/70' },
  { id: 'soc2' as AdminSection, label: 'SOC 2 Compliance', icon: CheckCircle2, description: 'Audit trail and compliance monitoring', color: 'text-green-300 dark:text-green-400/70' },
  { id: 'deployment' as AdminSection, label: 'Deployment', icon: Cloud, description: 'Manage deployment instances', color: 'text-sky-300 dark:text-sky-400/70' },
  { id: 'stripe' as AdminSection, label: 'Stripe Payments', icon: CreditCard, description: 'Subscription and billing management', color: 'text-violet-300 dark:text-violet-400/70' },
  { id: 'aws-hosting' as AdminSection, label: 'AWS Hosting', icon: Cloud, description: 'Per-lender AWS hosting and billing', color: 'text-orange-300 dark:text-orange-400/70' },
  { id: 'metrics-catalog' as AdminSection, label: 'Metrics Catalog', icon: Database, description: 'Browse all available metrics and formulas', color: 'text-teal-300 dark:text-teal-400/70' },
];

interface AdminLayoutProps {
  activeSection: AdminSection;
  mobileMenuOpen: boolean;
  onSectionChange: (section: AdminSection) => void;
  onMobileMenuChange: (open: boolean) => void;
  children: ReactNode;
}

export const AdminLayout = ({
  activeSection,
  mobileMenuOpen,
  onSectionChange,
  onMobileMenuChange,
  children,
}: AdminLayoutProps) => {
  const renderNavButton = (section: typeof adminSections[0], isMobile: boolean = false) => {
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
              <Settings className="h-5 w-5 text-blue-500" strokeWidth={1.5} />
              Navigation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 p-3">
            {adminSections.map((section) => renderNavButton(section, false))}
          </CardContent>
        </Card>
      </div>

      {/* Mobile Sidebar Sheet */}
      <Sheet open={mobileMenuOpen} onOpenChange={onMobileMenuChange}>
        <SheetContent side="left" className="w-[85vw] sm:w-[320px] p-0 overflow-y-auto">
          <div className="h-full flex flex-col">
            <SheetHeader className="px-6 pt-6 pb-4 border-b border-blue-100/50 dark:border-slate-700/50 bg-gradient-to-r from-blue-50/50 to-purple-50/50">
              <div className="flex items-center justify-between">
                <SheetTitle className="text-xl font-thin text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                  <Settings className="h-5 w-5 text-blue-500" strokeWidth={1.5} />
                  Navigation
                </SheetTitle>
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
              {adminSections.map((section) => renderNavButton(section, true))}
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

