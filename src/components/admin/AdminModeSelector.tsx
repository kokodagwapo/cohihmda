/**
 * Admin Mode Selector
 *
 * Tab bar component for platform admins to switch between:
 * - Platform Management: Cohi internal platform operations
 * - Tenant Context: Managing a specific tenant (impersonation)
 */

import { motion } from "framer-motion";
import { Crown, Building2, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AdminMode } from "@/hooks/admin/useAdminState";

interface AdminModeSelectorProps {
  mode: AdminMode;
  onModeChange: (mode: AdminMode) => void;
  selectedTenantName?: string | null;
}

export function AdminModeSelector({
  mode,
  onModeChange,
  selectedTenantName,
}: AdminModeSelectorProps) {
  const tabs = [
    {
      id: "platform" as AdminMode,
      label: "Platform Management",
      description: "Cohi internal operations",
      icon: Crown,
      color: "amber",
    },
    {
      id: "tenant" as AdminMode,
      label: "Tenant Context",
      description: selectedTenantName || "Select a tenant",
      icon: Building2,
      color: "emerald",
    },
  ];

  return (
    <div className="bg-white dark:bg-slate-800/50 rounded-2xl border border-slate-200/60 dark:border-slate-700/50 p-1.5 shadow-sm">
      <div className="flex gap-1.5">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = mode === tab.id;
          const colorClasses = {
            amber: {
              active: "from-amber-500 to-orange-500 shadow-amber-500/30",
              icon: "text-amber-500",
              iconActive: "text-white",
            },
            emerald: {
              active: "from-emerald-500 to-teal-500 shadow-emerald-500/30",
              icon: "text-emerald-500",
              iconActive: "text-white",
            },
          };
          const colors = colorClasses[tab.color as keyof typeof colorClasses];

          return (
            <motion.button
              key={tab.id}
              onClick={() => onModeChange(tab.id)}
              className={`
                relative flex-1 flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300
                ${
                  isActive
                    ? `bg-gradient-to-r ${colors.active} shadow-lg`
                    : "hover:bg-slate-100 dark:hover:bg-slate-700/50"
                }
              `}
              whileHover={!isActive ? { scale: 1.01 } : undefined}
              whileTap={{ scale: 0.98 }}
            >
              <div
                className={`
                  p-2 rounded-lg transition-all
                  ${
                    isActive
                      ? "bg-white/25"
                      : "bg-slate-100 dark:bg-slate-700/50"
                  }
                `}
              >
                <Icon
                  className={`h-5 w-5 ${
                    isActive ? colors.iconActive : colors.icon
                  }`}
                  strokeWidth={1.5}
                />
              </div>
              <div className="flex-1 text-left min-w-0">
                <div
                  className={`
                    text-sm font-medium tracking-tight
                    ${
                      isActive
                        ? "text-white"
                        : "text-slate-700 dark:text-slate-300"
                    }
                  `}
                >
                  {tab.label}
                </div>
                <div
                  className={`
                    text-xs truncate
                    ${
                      isActive
                        ? "text-white/80"
                        : "text-slate-500 dark:text-slate-500"
                    }
                  `}
                >
                  {tab.description}
                </div>
              </div>
              {/* Badge for tenant context showing selected tenant */}
              {tab.id === "tenant" && selectedTenantName && !isActive && (
                <Badge
                  variant="secondary"
                  className="ml-2 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs"
                >
                  {selectedTenantName.length > 15
                    ? selectedTenantName.substring(0, 15) + "..."
                    : selectedTenantName}
                </Badge>
              )}
              {/* No tenant selected indicator */}
              {tab.id === "tenant" && !selectedTenantName && !isActive && (
                <Badge
                  variant="outline"
                  className="ml-2 text-xs text-slate-500 border-slate-300 dark:border-slate-600"
                >
                  None
                </Badge>
              )}
              {isActive && (
                <motion.div
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 200, damping: 15 }}
                >
                  <ChevronRight
                    className="h-4 w-4 text-white"
                    strokeWidth={2.5}
                  />
                </motion.div>
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

export default AdminModeSelector;
