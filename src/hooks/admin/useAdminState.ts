import { useState, useCallback, useEffect } from "react";

export type AdminSection =
  | "overview"
  | "tenants"
  | "platform-team" // Cohi internal team management (super_admin only)
  | "users"
  | "sso"
  | "org"
  | "data-quality"
  | "data-config" // Field mapping only
  | "revenue" // Revenue formulas (own section)
  | "scoring-weights" // Scorecard weights and loan complexity (own section)
  | "data-transfer" // Legacy import, export/import (platform admin only)
  | "infrastructure" // Renamed from 'system' for clarity
  | "security-compliance" // Combined security and SOC 2
  | "connections" // Combined LOS + Synapse integrations
  | "loan-folders" // Encompass folder selection per connection
  | "dev-tools" // Developer tools including demo data
  | "stripe"
  | "rag-voice"
  | "metrics-catalog"
  | "knowledge-library" // Global knowledge library (platform admin)
  | "knowledge-center" // Tenant knowledge center
  | "ai-prompts" // AI prompt configuration (platform admin)
  | "insight-feedback" // Insight feedback review & training (platform admin)
  | "sync-management" // Cross-tenant sync schedule management (platform admin)
  | "platform-settings" // Platform API keys and settings (platform admin)
  | "analytics"; // User behavior analytics (page views, sessions, funnels, replays)

// Admin mode: platform (Cohi internal management) vs tenant (tenant context/impersonation)
export type AdminMode = "platform" | "tenant";

const ADMIN_MODE_STORAGE_KEY = "cohi_admin_mode";

// Helper to get initial mode from localStorage
const getInitialMode = (): AdminMode => {
  if (typeof window === "undefined") return "platform";
  const stored = localStorage.getItem(ADMIN_MODE_STORAGE_KEY);
  if (stored === "platform" || stored === "tenant") {
    return stored;
  }
  return "platform";
};

export const useAdminState = () => {
  const [activeSection, setActiveSection] = useState<AdminSection>("overview");
  const [sectionDataLoaded, setSectionDataLoaded] = useState<Set<AdminSection>>(
    new Set()
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);

  // Admin mode state with localStorage persistence
  const [adminMode, setAdminModeState] = useState<AdminMode>(getInitialMode);

  // Persist admin mode to localStorage
  useEffect(() => {
    localStorage.setItem(ADMIN_MODE_STORAGE_KEY, adminMode);
  }, [adminMode]);

  // Set admin mode and optionally change to appropriate default section
  const setAdminMode = useCallback(
    (mode: AdminMode, changeSection: boolean = true) => {
      setAdminModeState(mode);
      if (changeSection) {
        if (mode === "platform") {
          setActiveSection("overview");
        } else {
          setActiveSection("users");
        }
      }
    },
    []
  );

  const markSectionLoaded = useCallback((section: AdminSection) => {
    setSectionDataLoaded((prev) => new Set(prev).add(section));
  }, []);

  const isSectionLoaded = useCallback(
    (section: AdminSection): boolean => {
      return sectionDataLoaded.has(section);
    },
    [sectionDataLoaded]
  );

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
    adminMode,
    setAdminMode,
  };
};
