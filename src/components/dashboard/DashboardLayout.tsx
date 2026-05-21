import React from 'react';
import { Navigation } from '@/components/layout/Navigation';
import { Footer } from '@/components/layout/Footer';
import { ReportsSidebar } from '@/components/dashboard/ReportsSidebar';
import { DashboardVisibility } from '@/components/dashboard/ReportsSidebar';
import { ReportData } from '@/data/reportSimulations';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';

interface DashboardLayoutProps {
  children: React.ReactNode;
  isAuthenticated: boolean;
  mobileMenuOpen: boolean;
  onMobileMenuToggle: () => void;
  dashboardVisibility: DashboardVisibility;
  onVisibilityChange: (visibility: DashboardVisibility) => void;
  onReportClick: (report: ReportData) => void;
  onSectionClick?: (sectionId: string) => void;
  headerContent?: React.ReactNode;
  /** Visitor's first name for personalized sidebar greeting */
  visitorFirstName?: string | null;
}

export function DashboardLayout({
  children,
  isAuthenticated,
  mobileMenuOpen,
  onMobileMenuToggle,
  dashboardVisibility,
  onVisibilityChange,
  onReportClick,
  onSectionClick,
  headerContent,
  visitorFirstName
}: DashboardLayoutProps) {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-950">
      <SidebarProvider defaultOpen={true}>
        <Navigation 
          onMenuToggle={onMobileMenuToggle} 
          menuOpen={mobileMenuOpen}
          onSectionClick={onSectionClick}
        />
        
        {/* Header Content (e.g., Tenant Selector) - Fixed position below nav */}
        {isAuthenticated && headerContent && (
          <div className="fixed top-14 sm:top-16 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700">
            <div className="container mx-auto px-3 sm:px-6 md:px-8 lg:px-12 py-2">
              {headerContent}
            </div>
          </div>
        )}
        
        {/* Reports Sidebar */}
        {isAuthenticated && (
          <ReportsSidebar 
            onReportClick={onReportClick}
            visibility={dashboardVisibility}
            onVisibilityChange={onVisibilityChange}
            mobileMenuOpen={mobileMenuOpen}
            onMobileMenuToggle={onMobileMenuToggle}
            onSectionClick={onSectionClick}
            visitorFirstName={visitorFirstName}
          />
        )}
        
        <SidebarInset className={`pt-16 bg-transparent w-full h-full ${headerContent ? 'mt-12' : ''}`}>
          {children}
        </SidebarInset>
      </SidebarProvider>
      
      <Footer />
    </div>
  );
}
