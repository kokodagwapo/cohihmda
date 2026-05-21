/**
 * Shared sidebar section chrome (matches ReportsSidebar "My Dashboards").
 */

import {
  forwardRef,
  useRef,
  useState,
  type ReactNode,
  isValidElement,
  cloneElement,
} from "react";
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
import { cohiTourIdFromDataTour } from "@/lib/tourTargets";

/** Matches top-nav `iconStyleMap` (Navigation.tsx). */
export type SidebarNavAccent =
  | "emerald"
  | "amber"
  | "blue"
  | "purple"
  | "yellow";

export const SIDEBAR_NAV_ACCENT: Record<
  SidebarNavAccent,
  {
    label: string;
    icon: string;
    iconTile: string;
    activeIconTile: string;
  }
> = {
  emerald: {
    label: "text-emerald-600 dark:text-emerald-400",
    icon: "text-emerald-500 dark:text-emerald-400",
    iconTile: "bg-emerald-500/10 dark:bg-emerald-500/20",
    activeIconTile:
      "bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-400/40",
  },
  amber: {
    label: "text-amber-600 dark:text-amber-400",
    icon: "text-amber-500 dark:text-amber-400",
    iconTile: "bg-amber-500/10 dark:bg-amber-500/20",
    activeIconTile:
      "bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-400/40",
  },
  blue: {
    label: "text-blue-600 dark:text-blue-400",
    icon: "text-blue-500 dark:text-blue-400",
    iconTile: "bg-blue-500/10 dark:bg-blue-500/20",
    activeIconTile:
      "bg-blue-50 dark:bg-blue-950/40 ring-1 ring-blue-400/40",
  },
  purple: {
    label: "text-purple-600 dark:text-purple-400",
    icon: "text-purple-500 dark:text-purple-400",
    iconTile: "bg-purple-500/10 dark:bg-purple-500/20",
    activeIconTile:
      "bg-purple-50 dark:bg-purple-950/40 ring-1 ring-purple-400/40",
  },
  yellow: {
    label: "text-yellow-600 dark:text-yellow-400",
    icon: "text-yellow-500 dark:text-yellow-400",
    iconTile: "bg-yellow-500/10 dark:bg-yellow-500/20",
    activeIconTile:
      "bg-yellow-50 dark:bg-yellow-950/40 ring-1 ring-yellow-400/40",
  },
};

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

/**
 * Joyride spotlight target for sidebar rows. The id sits on a wrapper (not the
 * button) so react-joyride uses viewport rect inside fixed + scrollable sidebar.
 */
export const SidebarTourAnchor = forwardRef<
  HTMLDivElement,
  {
    tourAnchorId?: string;
    className?: string;
    children: ReactNode;
  }
>(function SidebarTourAnchor({ tourAnchorId, className, children }, ref) {
  if (!tourAnchorId) {
    return <>{children}</>;
  }
  return (
    <div
      ref={ref}
      id={tourAnchorId}
      data-tour-spotlight-anchor=""
      className={cn("w-full shrink-0", className)}
    >
      {children}
    </div>
  );
});

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
  accent,
  className,
}: {
  icon: LucideIcon;
  accent?: SidebarNavAccent;
  className?: string;
}) {
  const accentStyles = accent ? SIDEBAR_NAV_ACCENT[accent] : null;
  return (
    <div
      className={cn(
        "flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center",
        accentStyles?.iconTile ?? "bg-slate-100 dark:bg-slate-800/30",
      )}
    >
      <Icon
        className={cn(
          "w-[18px] h-[18px]",
          accentStyles?.icon ?? "text-slate-600 dark:text-slate-400",
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
  accent,
  active = false,
  dataTour,
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
  accent?: SidebarNavAccent;
  active?: boolean;
  /** Joyride spotlight anchor (header row only). */
  dataTour?: string;
}) {
  const flyout = useSidebarFlyout();
  const accentStyles = accent ? SIDEBAR_NAV_ACCENT[accent] : null;
  const tourAnchorId = cohiTourIdFromDataTour(dataTour);

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
        <SidebarTourAnchor tourAnchorId={tourAnchorId}>
          <button
            type="button"
            onClick={onToggleSection}
            style={SIDEBAR_SECTION_BUTTON_STYLE}
            className={cn(
              "rounded-lg",
              active && accentStyles?.activeIconTile,
            )}
            {...(active ? {} : sidebarSectionRowHover(isDarkMode))}
          >
            <span className="inline-flex shrink-0 pointer-events-none">
              <SidebarSectionIcon icon={Icon} accent={accent} />
            </span>
            <p
              className={cn(
                "text-sm font-semibold flex-1 m-0",
                accentStyles?.label ?? "text-slate-900 dark:text-slate-100",
              )}
            >
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
        </SidebarTourAnchor>
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
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        flyout.setOpen(false);
        onCollapsedClick();
      }}
      className={cn(
        "w-9 h-9 rounded-lg flex items-center justify-center",
        active && accentStyles?.activeIconTile
          ? accentStyles.activeIconTile
          : accentStyles?.iconTile ?? "bg-slate-50 dark:bg-slate-800/30",
      )}
    >
      <Icon
        className={cn(
          "w-4 h-4",
          accentStyles?.icon ?? "text-slate-500 dark:text-slate-400",
        )}
      />
    </button>
  ) : (
    <div
      className={cn(
        "w-9 h-9 rounded-lg flex items-center justify-center",
        active && accentStyles?.activeIconTile
          ? accentStyles.activeIconTile
          : accentStyles?.iconTile ?? "bg-slate-50 dark:bg-slate-800/30",
      )}
      aria-label={label}
      role="img"
    >
      <Icon
        className={cn(
          "w-4 h-4",
          accentStyles?.icon ?? "text-slate-500 dark:text-slate-400",
        )}
        aria-hidden
      />
    </div>
  );

  const collapsedAnchor = (
    <SidebarTourAnchor
      tourAnchorId={tourAnchorId}
      className="flex justify-center py-2"
    >
      <div
        className="inline-flex"
        onMouseEnter={flyout.onEnter}
        onMouseLeave={flyout.onLeave}
      >
        {collapsedIcon}
      </div>
    </SidebarTourAnchor>
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
          <SidebarSectionIcon icon={Icon} accent={accent} />
          <p
            className={cn(
              "text-sm font-semibold m-0",
              accentStyles?.label ?? "text-slate-900 dark:text-slate-100",
            )}
          >
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
  accent = "emerald",
  dataTour,
}: {
  isDarkMode: boolean;
  isExpanded: boolean;
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
  accent?: SidebarNavAccent;
  dataTour?: string;
}) {
  const accentStyles = SIDEBAR_NAV_ACCENT[accent];
  const tourAnchorId = cohiTourIdFromDataTour(dataTour);

  if (!isExpanded) {
    return (
      <SidebarTourAnchor
        tourAnchorId={tourAnchorId}
        className="flex justify-center py-2"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onClick}
              className={cn(
                "w-9 h-9 rounded-lg flex items-center justify-center",
                active
                  ? accentStyles.activeIconTile
                  : accentStyles.iconTile,
              )}
              aria-current={active ? "page" : undefined}
            >
              <span className="inline-flex h-9 w-9 items-center justify-center pointer-events-none">
                <Icon className={cn("w-4 h-4", accentStyles.icon)} />
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      </SidebarTourAnchor>
    );
  }

  return (
    <SidebarTourAnchor tourAnchorId={tourAnchorId} className="mb-2">
      <button
        type="button"
        onClick={onClick}
        style={SIDEBAR_SECTION_BUTTON_STYLE}
        className={cn("rounded-lg", active && accentStyles.activeIconTile)}
        {...(active ? {} : sidebarSectionRowHover(isDarkMode))}
        aria-current={active ? "page" : undefined}
      >
        <span className="inline-flex shrink-0 pointer-events-none">
          <SidebarSectionIcon icon={Icon} accent={accent} />
        </span>
        <p className={cn("text-sm font-semibold flex-1 m-0", accentStyles.label)}>
          {label}
        </p>
      </button>
    </SidebarTourAnchor>
  );
}
