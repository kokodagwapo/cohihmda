import React from 'react';
import { Navigation } from '@/components/layout/Navigation';
import { Footer } from '@/components/layout/Footer';
import { ReportsSidebar } from '@/components/dashboard/ReportsSidebar';
import { DashboardVisibility } from '@/components/dashboard/ReportsSidebar';
import { ReportData } from '@/data/reportSimulations';

interface DashboardLayoutProps {
  children: React.ReactNode;
  isAuthenticated: boolean;
  mobileMenuOpen: boolean;
  onMobileMenuToggle: () => void;
  dashboardVisibility: DashboardVisibility;
  onVisibilityChange: (visibility: DashboardVisibility) => void;
  onReportClick: (report: ReportData) => void;
}

export function DashboardLayout({
  children,
  isAuthenticated,
  mobileMenuOpen,
  onMobileMenuToggle,
  dashboardVisibility,
  onVisibilityChange,
  onReportClick
}: DashboardLayoutProps) {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-950">
      <Navigation 
        onMenuToggle={onMobileMenuToggle} 
        menuOpen={mobileMenuOpen} 
      />
      
      {/* Reports Sidebar */}
      {isAuthenticated && (
        <ReportsSidebar 
          onReportClick={onReportClick}
          visibility={dashboardVisibility}
          onVisibilityChange={onVisibilityChange}
          mobileMenuOpen={mobileMenuOpen}
          onMobileMenuToggle={onMobileMenuToggle}
        />
      )}
      
      {children}
      
      <Footer />
    </div>
  );
}

