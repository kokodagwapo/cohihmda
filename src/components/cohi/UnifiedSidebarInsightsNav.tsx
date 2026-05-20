/**
 * Single Insights nav control (meeting spec §6.1) when unified chat IA is on.
 */

import { Sun } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { SidebarNavRow } from "@/components/cohi/sidebarNavPrimitives";

export function UnifiedSidebarInsightsNav({
  isDarkMode,
  collapsed,
}: {
  isDarkMode: boolean;
  collapsed: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const active = location.pathname === "/insights";

  return (
    <SidebarNavRow
      isDarkMode={isDarkMode}
      isExpanded={!collapsed}
      icon={Sun}
      label="Insights"
      active={active}
      onClick={() => navigate("/insights")}
    />
  );
}
