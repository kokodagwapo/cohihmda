import { useState, useCallback } from 'react';

export type AdminSection = 
  | 'overview' 
  | 'org-overview'  // Tenant admin overview (their org only)
  | 'tenants' 
  | 'platform-team'  // Cohi internal team management (super_admin only)
  | 'users'
  | 'roles'
  | 'sso'
  | 'org'
  | 'data-quality'
  | 'data-config'  // Tenant data configuration (field mappings, ranges, filters, scoring)
  | 'infrastructure'  // Renamed from 'system' for clarity
  | 'security-compliance'  // Combined security and SOC 2
  | 'connections'  // Combined LOS + Synapse integrations
  | 'dev-tools'  // Developer tools including demo data
  | 'deployment' 
  | 'stripe' 
  | 'rag-voice' 
  | 'aws-hosting'
  | 'metrics-catalog';

export const useAdminState = () => {
  const [activeSection, setActiveSection] = useState<AdminSection>('overview');
  const [sectionDataLoaded, setSectionDataLoaded] = useState<Set<AdminSection>>(new Set());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);

  const markSectionLoaded = useCallback((section: AdminSection) => {
    setSectionDataLoaded(prev => new Set(prev).add(section));
  }, []);

  const isSectionLoaded = useCallback((section: AdminSection): boolean => {
    return sectionDataLoaded.has(section);
  }, [sectionDataLoaded]);

  const changeSection = useCallback((section: AdminSection) => {
    setActiveSection(section);
    setMobileMenuOpen(false);
  }, []);

  return {
    activeSection,
    setActiveSection: changeSection,
    sectionDataLoaded,
    markSectionLoaded,
    isSectionLoaded,
    mobileMenuOpen,
    setMobileMenuOpen,
    loading,
    setLoading,
    initialLoad,
    setInitialLoad,
  };
};

