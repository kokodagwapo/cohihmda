/**
 * Shared sidebar section chrome (matches ReportsSidebar "My Dashboards").
 */

import { useRef, useState, type ReactNode, isValidElement, cloneElement } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const SIDEBAR_SECTION_BUTTON_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "12px 10px",
  background: "transparent",
  border: "none",
  textAlign: "left",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-start",
  gap: 10,
  transition: "all 0.2s ease",
};

export function sidebarSectionRowHover(isDarkMode: boolean) {
  return {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      e.currentTarget.style.backgroundColor = isDarkMode
        ? "rgba(148, 163, 184, 0.08)"
        : "rgba(0, 0, 0, 0.02)";
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      e.currentTarget.style.backgroundColor = "transparent";
    },
  };
}

export function useSidebarFlyout() {
  const [open, setOpen] = useState(false);
  const leaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onEnter = () => {
    if (leaveRef.current) clearTimeout(leaveRef.current);
    setOpen(true);
  };

  const onLeave = () => {
    leaveRef.current = window.setTimeout(() => setOpen(false), 150);
  };

  return { open, setOpen, onEnter, onLeave, leaveRef };
}

export function SidebarSectionIcon({
  icon: Icon,
  className,
}: {
  icon: LucideIcon;
  className?: string;
}) {
  return (
    <div className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-slate-100 dark:bg-slate-800/30">
      <Icon
        className={cn(
          "w-[18px] h-[18px] text-slate-600 dark:text-slate-400",
          className,
        )}
      />
    </div>
  );
}

export function SidebarExpandableSection({
  isDarkMode,
  isExpanded,
  sectionExpanded,
  onToggleSection,
  icon: Icon,
  label,
  children,
  flyoutChildren,
  flyoutWidth = "w-56",
  onCollapsedClick,
  collapsedTooltip,
}: {
  isDarkMode: boolean;
  isExpanded: boolean;
  sectionExpanded: boolean;
  onToggleSection: () => void;
  icon: LucideIcon;
  label: string;
  children: ReactNode;
  flyoutChildren: ReactNode | ((close: () => void) => ReactNode);
  flyoutWidth?: string;
  /** When set, collapsed sidebar icon click navigates; hover still opens the flyout. */
  onCollapsedClick?: () => void;
  collapsedTooltip?: string;
}) {
  const flyout = useSidebarFlyout();

  const renderFlyoutChildren = () => {
    const close = () => flyout.setOpen(false);
    if (typeof flyoutChildren === "function") {
      return flyoutChildren(close);
    }
    if (isValidElement(flyoutChildren)) {
      return cloneElement(flyoutChildren, {
        onItemActivate: close,
      } as { onItemActivate?: () => void });
    }
    return flyoutChildren;
  };

  if (isExpanded) {
    return (
      <div className="mb-2">
        <button
          type="button"
          onClick={onToggleSection}
          style={SIDEBAR_SECTION_BUTTON_STYLE}
          {...sidebarSectionRowHover(isDarkMode)}
        >
          <SidebarSectionIcon icon={Icon} />
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex-1 m-0">
            {label}
          </p>
          <ChevronDown
            size={18}
            style={{
              color: isDarkMode ? "#94a3b8" : "#64748b",
              transform: sectionExpanded ? "none" : "rotate(-90deg)",
              transition: "transform 0.2s ease",
              flexShrink: 0,
            }}
          />
        </button>
        <AnimatePresence initial={false}>
          {sectionExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              style={{ overflow: "hidden" }}
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  const collapsedIcon = onCollapsedClick ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        flyout.setOpen(false);
        onCollapsedClick();
      }}
      className="w-9 h-9 rounded-lg flex items-center justify-center bg-slate-50 dark:bg-slate-800/30"
    >
      <Icon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
    </button>
  ) : (
    <div
      className="w-9 h-9 rounded-lg flex items-center justify-center bg-slate-50 dark:bg-slate-800/30"
      aria-hidden
    >
      <Icon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
    </div>
  );

  const collapsedAnchor = (
    <div
      className="w-full flex justify-center py-2"
      onMouseEnter={flyout.onEnter}
      onMouseLeave={flyout.onLeave}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="inline-flex">{collapsedIcon}</div>
        </TooltipTrigger>
        <TooltipContent side="right">{collapsedTooltip ?? label}</TooltipContent>
      </Tooltip>
    </div>
  );

  return (
    <Popover open={flyout.open} onOpenChange={flyout.setOpen}>
      <PopoverAnchor asChild>{collapsedAnchor}</PopoverAnchor>
      <PopoverContent
        side="right"
        align="start"
        className={cn(flyoutWidth, "max-h-[70vh] overflow-y-auto p-2")}
        onMouseEnter={flyout.onEnter}
        onMouseLeave={flyout.onLeave}
      >
        <div className="flex items-center gap-2 px-2 pb-2">
          <SidebarSectionIcon icon={Icon} />
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 m-0">
            {label}
          </p>
        </div>
        {renderFlyoutChildren()}
      </PopoverContent>
    </Popover>
  );
}

export function SidebarNavRow({
  isDarkMode,
  isExpanded,
  icon: Icon,
  label,
  active,
  onClick,
}: {
  isDarkMode: boolean;
  isExpanded: boolean;
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  if (!isExpanded) {
    return (
      <div className="w-full flex justify-center py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onClick}
              className={cn(
                "w-9 h-9 rounded-lg flex items-center justify-center",
                active
                  ? "bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-400/40"
                  : "bg-slate-50 dark:bg-slate-800/30",
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon
                className={cn(
                  "w-4 h-4",
                  active
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-slate-500 dark:text-slate-400",
                )}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={onClick}
        style={SIDEBAR_SECTION_BUTTON_STYLE}
        {...sidebarSectionRowHover(isDarkMode)}
        aria-current={active ? "page" : undefined}
      >
        <SidebarSectionIcon
          icon={Icon}
          className={
            active ? "text-emerald-600 dark:text-emerald-400" : undefined
          }
        />
        <p
          className={cn(
            "text-sm font-semibold flex-1 m-0",
            active
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-slate-900 dark:text-slate-100",
          )}
        >
          {label}
        </p>
      </button>
    </div>
  );
}
