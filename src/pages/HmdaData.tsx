import { useEffect, useMemo, useState } from "react";
import { Building2, Database, Map, Search } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useDashboardVisibility } from "@/hooks/useDashboardVisibility";
import { cn } from "@/lib/utils";
import type { ReportData } from "@/data/reportSimulations";

const DEFAULT_HMDA_APP_URL = "/hmda-app/";

type HmdaSection = "search" | "lenders" | "products" | "geography";

const SECTIONS: Array<{
  id: HmdaSection;
  label: string;
  path: string;
  icon: typeof Building2;
}> = [
  { id: "search", label: "HMDA Search", path: "", icon: Search },
  { id: "lenders", label: "Lenders", path: "", icon: Building2 },
  { id: "products", label: "Products", path: "products", icon: Database },
  { id: "geography", label: "Geography", path: "geography", icon: Map },
];

function buildEmbedSrc(baseUrl: string, sectionPath: string): string {
  const root = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const path = sectionPath ? `${root}${sectionPath}` : root;
  const url = new URL(path, window.location.origin);
  url.searchParams.set("embed", "1");
  return url.origin === window.location.origin
    ? `${url.pathname}${url.search}`
    : url.toString();
}

const HmdaData = () => {
  const { user } = useAuth();
  const { dashboardVisibility, handleVisibilityChange } = useDashboardVisibility();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<HmdaSection>("search");
  const [loadedSections, setLoadedSections] = useState<Set<HmdaSection>>(
    () => new Set(["search"]),
  );

  const hmdaBaseUrl =
    (import.meta.env.VITE_HMDA_APP_URL as string | undefined)?.trim() ||
    DEFAULT_HMDA_APP_URL;

  const iframeSrcBySection = useMemo(
    () =>
      Object.fromEntries(
        SECTIONS.map((section) => [section.id, buildEmbedSrc(hmdaBaseUrl, section.path)]),
      ) as Record<HmdaSection, string>,
    [hmdaBaseUrl],
  );

  const handleSectionChange = (next: HmdaSection) => {
    setActiveSection(next);
    setLoadedSections((prev) => {
      if (prev.has(next)) return prev;
      const copy = new Set(prev);
      copy.add(next);
      return copy;
    });
  };

  // Warm geography in the background so first open feels faster.
  useEffect(() => {
    if (loadedSections.has("geography")) return;
    const timer = window.setTimeout(() => {
      setLoadedSections((prev) => {
        if (prev.has("geography")) return prev;
        const copy = new Set(prev);
        copy.add("geography");
        return copy;
      });
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [loadedSections]);

  return (
    <DashboardLayout
      enableChat={false}
      isAuthenticated={!!user}
      mobileMenuOpen={mobileMenuOpen}
      onMobileMenuToggle={() => setMobileMenuOpen((prev) => !prev)}
      dashboardVisibility={dashboardVisibility}
      onVisibilityChange={handleVisibilityChange}
      onReportClick={(_report: ReportData) => {}}
    >
      <div className="flex h-[calc(100vh-4rem)] flex-col bg-slate-50/80 dark:bg-slate-950">
        <header className="shrink-0 px-4 py-3 sm:px-6 bg-white/35 dark:bg-slate-900/20 backdrop-blur-xl border-b border-white/35 dark:border-slate-700/35 shadow-[0_10px_28px_rgba(15,23,42,0.08)] dark:shadow-[0_12px_34px_rgba(0,0,0,0.28)]">
          <Tabs
            value={activeSection}
            onValueChange={(v) => handleSectionChange(v as HmdaSection)}
            className="mt-0"
          >
            <TabsList className="grid h-auto w-full max-w-2xl grid-cols-4 bg-white/55 dark:bg-slate-900/35 backdrop-blur-md p-1 border border-white/45 dark:border-slate-700/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]">
              {SECTIONS.map(({ id, label, icon: Icon }) => (
                <TabsTrigger
                  key={id}
                  value={id}
                  className={cn(
                    "flex items-center justify-center gap-1.5 py-2 text-sm font-medium",
                    "data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm",
                    "dark:data-[state=active]:bg-slate-900 dark:data-[state=active]:text-emerald-400",
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span>{label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </header>

        <div className="relative min-h-0 flex-1 bg-white dark:bg-slate-950">
          {Array.from(loadedSections).map((sectionId) => (
            <iframe
              key={sectionId}
              src={iframeSrcBySection[sectionId]}
              title={`HMDA Data - ${SECTIONS.find((s) => s.id === sectionId)?.label ?? "Lenders"}`}
              className={cn(
                "absolute inset-0 h-full w-full border-0 bg-white dark:bg-slate-950 transition-opacity duration-200",
                activeSection === sectionId
                  ? "opacity-100 pointer-events-auto"
                  : "opacity-0 pointer-events-none",
              )}
              allow="clipboard-read; clipboard-write; geolocation; fullscreen"
              referrerPolicy="no-referrer"
            />
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default HmdaData;
