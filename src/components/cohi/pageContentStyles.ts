/** Shared layout tokens for insights page content blocks and chat shell. */

import { cn } from "@/lib/utils";

/** Uniform vertical rhythm between title, chat, insights, and page body (12px). */
export const DASHBOARD_SECTION_GAP = "gap-3";

/** Full-bleed horizontal padding on /insights scroll regions. */
export const PAGE_CONTENT_GUTTER = "px-3 sm:px-6 md:px-8 lg:px-12";

export const PAGE_INSIGHTS_CARD =
  "relative overflow-hidden rounded-2xl sm:rounded-3xl border border-slate-200/60 dark:border-slate-700/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-[0_8px_32px_rgba(15,23,42,0.08)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.24)]";

/** Top Tiering dashboard pages: horizontal padding aligned with chat shell. */
export const DASHBOARD_PAGE_GUTTER = "px-2 sm:px-4";

export const DASHBOARD_PAGE_CONTENT_COLUMN =
  "max-w-[1800px] mx-auto w-full min-w-0";

export const DASHBOARD_MAIN_SCROLL = "flex-1 overflow-y-auto min-h-0";

/** Scrollable <main> — vertical spacing comes from grid/content gap, not py on main. */
export const DASHBOARD_MAIN_CLASSNAME = cn(
  DASHBOARD_MAIN_SCROLL,
  DASHBOARD_PAGE_GUTTER,
);

/** Inner page column: same width as chat + uniform section spacing. */
export const DASHBOARD_PAGE_CONTENT_STACK = cn(
  DASHBOARD_PAGE_CONTENT_COLUMN,
  "flex flex-col",
  DASHBOARD_SECTION_GAP,
);

/** Chat shell horizontal padding only (stacked band). */
export const DASHBOARD_CHAT_SHELL_GUTTER = DASHBOARD_PAGE_GUTTER;

/** Space between page title bar and chat shell. */
export const DASHBOARD_TITLE_TO_CHAT_GAP = "pt-3";
