import type { Step } from "react-joyride";
import { isUnifiedChatClientEnabled } from "@/lib/unifiedChatEnvelope";
import {
  desktopSidebarTourTarget,
  prepareDesktopSidebarTourStep,
  type CohiTourSidebarAnchor,
} from "@/lib/tourTargets";

const sidebarTourStep = (
  anchor: CohiTourSidebarAnchor,
  step: Omit<Step, "target" | "before">,
): Step => {
  const target = desktopSidebarTourTarget(anchor);
  return {
    ...step,
    target,
    placement: step.placement ?? "right",
    disableScrolling: true,
    spotlightPadding: 0,
    before: () => prepareDesktopSidebarTourStep(target),
  };
};

const welcomeTourStepsLegacy: Step[] = [
  {
    target: "body",
    content:
      "Welcome to Cohi! This quick tour will show you the key areas of the platform. You can replay this tour anytime from Settings.",
    placement: "center",
    disableBeacon: true,
    title: "Welcome to Cohi",
  },
  {
    target: '[aria-label="Main navigation"]',
    content:
      "This is your main navigation bar. From here you can access Insights, TopTiering analytics, your Workbench, and the Research Lab.",
    placement: "bottom",
    title: "Navigation",
  },
  {
    target: '[aria-label="Insights menu"]',
    content:
      "The Insights page is your home base. It shows AI-generated Daily Briefings, industry news, performance leaderboards, and KPI overviews.",
    placement: "bottom",
    title: "Insights Dashboard",
  },
  /*   {
    target: '[aria-label="Dashboard menu"]',
    content: 'The Dashboard menu gives you access to TopTiering analytics: Loan Funnel, Scorecards, Credit Risk, Financial Modeling, and more.',
    placement: 'bottom',
    title: 'TopTiering Analytics',
  }, */
  {
    target: '[aria-label="My Workbench"]',
    content:
      "The Workbench is your custom dashboard builder. Create canvases, add widgets, and use AI to generate charts and reports from natural language.",
    placement: "bottom",
    title: "My Workbench",
  },
  {
    target: '[aria-label="Research Lab"]',
    content:
      "The Research Lab is your AI-powered analyst. Ask deep questions about your data and get comprehensive research reports.",
    placement: "bottom",
    title: "Research Lab",
  },
  {
    target: "body",
    content:
      'That\'s the basics! Explore each section to learn more. Look for the "?" icon on any page for contextual help, or use Cohi Chat to ask questions anytime.',
    placement: "center",
    title: "You're All Set!",
  },
];

/** Welcome tour when unified Cohi Chat IA is enabled. */
export const welcomeTourStepsUnified: Step[] = [
  {
    target: "body",
    content:
      "Welcome to Cohi! This quick tour will show you the key areas of the platform. You can replay this tour anytime from Settings.",
    placement: "center",
    disableBeacon: true,
    title: "Welcome to Cohi",
  },
  {
    target: '[aria-label="Main navigation"]',
    content:
      "This is your main navigation bar. From here you can access Insights, TopTiering analytics, your Workbench, and Communications Center. Deep research lives inside Cohi Chat.",
    placement: "bottom",
    title: "Navigation",
  },
  {
    target: '[aria-label="Insights menu"]',
    content:
      "The Insights page is your home base. It shows AI-generated Daily Briefings, industry news, performance leaderboards, and KPI overviews.",
    placement: "bottom",
    title: "Insights Dashboard",
  },
  sidebarTourStep("insights", {
    content:
      "Insights in the sidebar is a single button that opens the full Insights page. Cohi Insights and Cohi Mortgage News are still on that page—only duplicate sidebar shortcuts were removed.",
    title: "Insights",
  }),
  sidebarTourStep("myDashboards", {
    content:
      "My Dashboards lists your pinned TopTiering dashboards and pinned workbench canvases together, collapsed by default. Pin from any dashboard or canvas the same way you always have.",
    title: "My Dashboards",
  }),
  {
    target: '[data-track="nav_communications_center"]',
    content:
      "Communications Center is in the top navigation now (where Research Lab used to be). Same distributions, templates, and permissions—just a clearer home while Research runs in Cohi Chat.",
    placement: "bottom",
    title: "Communications Center",
  },
  {
    target: "body",
    content:
      'That\'s the basics! Cohi Chat is centralized under the top bar on every page. Explore Help Center for guides, or take the **Cohi Chat Tour** from "What You Can Ask Cohi" for a hands-on walkthrough.',
    placement: "center",
    title: "You're All Set!",
  },
];

export const welcomeTourSteps = isUnifiedChatClientEnabled()
  ? welcomeTourStepsUnified
  : welcomeTourStepsLegacy;

export const cohiChatTourSteps: Step[] = isUnifiedChatClientEnabled()
  ? [
      {
        target: "body",
        content:
          "Welcome back—nothing you relied on went away. Cohi Chat now lives in one band directly under the top navigation, on every page. General questions, Research, custom insights, and Workbench building all start here instead of separate chat panels.",
        placement: "center",
        disableBeacon: true,
        title: "One place to talk to Cohi",
      },
      {
        target: '[data-tour="unified-chat-shell"]',
        content:
          "This is Cohi Chat. Ask a question from Insights, a dashboard, or the Workbench—the assistant and your conversation stay with you.",
        placement: "bottom",
        title: "Your chat, front and center",
      },
      {
        target: '[data-tour="unified-chat-type"]',
        content:
          "Use the chat type menu to pick the mode. Chat (default) is for quick data and navigation questions. Research, formerly Research Lab, runs the full analyst workflow. Insight builder drafts custom insight prompts that feed My Insights. Workbench helps you build dashboards and widgets. Same engines as before—one unified chat.",
        placement: "bottom",
        title: "Choose how Cohi helps",
      },
      {
        target: '[data-tour="unified-chat-suggestions"]',
        content:
          "Not sure what to ask? Suggested prompts change with the chat type you selected. Click one to start, or type your own question in the box below.",
        placement: "top",
        title: "Try an example",
      },
      {
        target: '[data-tour="unified-chat-composer"]',
        content:
          "Type here and press Send. Cohi still understands your loan data, can generate charts and reports, and can point you to pages in the app. Be specific with dates, metrics, and channels—just like before.",
        placement: "top",
        title: "Ask anything",
      },
      {
        target: '[data-tour="unified-chat-layout"]',
        content:
          "Need more space? Expand to Taller, Full page, or Split screen (page on the left, chat on the right). Research automatically opens full page when you start an investigation—same experience, less clutter.",
        placement: "bottom",
        title: "Resize when you need room",
      },
      sidebarTourStep("insights", {
        content:
          "Insights in the sidebar now takes you straight to the insights page. Cohi Insights and Cohi Mortgage News are still on that page—only the extra sidebar shortcuts were removed so navigation stays simple.",
        title: "Insights — same page, simpler sidebar",
      }),
      sidebarTourStep("myDashboards", {
        content:
          "My Dashboards still lists your pinned dashboards and pinned workbenches—together, collapsed by default. Pin from any canvas the same way you always have; open them from here.",
        title: "My Dashboards",
      }),
      sidebarTourStep("folders", {
        content:
          "Folders let you group past conversations—like projects in other chat apps. Create folders, nest up to five levels, then add chats two ways: drag a conversation from History onto a folder, or click the Move to folder button on any chat row and pick a destination from the menu. Your old Research sessions appear here too.",
        title: "Organize with folders",
      }),
      sidebarTourStep("history", {
        content:
          "History shows your latest chats across all chat types. Click any row to resume. Research no longer keeps a separate session column inside the workspace—everything is in this one timeline.",
        title: "Recent conversations",
      }),
      sidebarTourStep("fullHistory", {
        content:
          "Open Full History to search every thread, filter by chat type, and browse older sessions with pagination.",
        title: "Full History",
      }),
      {
        target: '[data-track="nav_communications_center"]',
        content:
          "Communications Center moved to the top navigation (where Research Lab used to be). The feature is unchanged—same distributions, templates, and permissions—just easier to find while Research lives in chat.",
        placement: "bottom",
        title: "Communications Center",
      },
      {
        target: "body",
        content:
          "That's the new layout. Explore Help Center articles for example queries per mode, or replay this tour anytime from What You Can Ask Cohi.",
        placement: "center",
        title: "You're set",
      },
    ]
  : [];

export const workbenchTourSteps: Step[] = [
  {
    target: '[data-tour="workbench-sidebar"]',
    content:
      "Your canvases are listed here. Create new ones, organize into folders, and quickly switch between dashboards.",
    placement: "right",
    disableBeacon: true,
    title: "Canvas Sidebar",
  },
  {
    target: '[data-tour="workbench-canvas"]',
    content:
      "This is your canvas area. Drag and drop widgets to build custom dashboards. Auto-save keeps your work safe.",
    placement: "center",
    title: "Canvas Area",
  },
  {
    target: '[data-tour="workbench-add-widget"]',
    content:
      "Click here to add widgets from the catalog, or use the AI assistant to create widgets from natural language descriptions.",
    placement: "bottom",
    title: "Add Widgets",
  },
  {
    target: '[data-tour="workbench-chat"]',
    content:
      "The Workbench AI assistant can create widgets, modify charts, generate SQL queries, and build full reports from your instructions.",
    placement: "left",
    title: "AI Assistant",
  },
  {
    target: '[data-tour="workbench-share"]',
    content:
      "Share your dashboards with team members, add them to team folders, or generate shareable links.",
    placement: "bottom",
    title: "Share & Collaborate",
  },
  {
    target: '[data-tour="workbench-export"]',
    content:
      "Export your dashboard as a PowerPoint presentation or PDF report with one click.",
    placement: "bottom",
    title: "Export Reports",
  },
];

export const researchLabTourSteps: Step[] = [
  {
    target: '[data-tour="research-sessions"]',
    content:
      "Your session history lives here. Previous investigations are saved automatically so you can revisit them anytime. Sessions shared with you by other users also appear here.",
    placement: "right",
    disableBeacon: true,
    title: "Session Sidebar",
  },
  {
    target: '[data-tour="research-input"]',
    content:
      "Type your research question here. Be specific — for example, 'What factors are driving loan fallout in our Wholesale channel?' The AI analyst will plan, investigate, and synthesize insights from your data.",
    placement: "bottom",
    title: "Ask a Question",
  },
  {
    target: '[data-tour="research-suggestions"]',
    content:
      "Not sure where to start? Pick one of these suggested topics covering pipeline health, personnel performance, risk patterns, and more.",
    placement: "bottom",
    title: "Topic Suggestions",
  },
  {
    target: '[data-tour="research-timeline"]',
    content:
      "Watch the AI work through its investigation in real-time. Each step — planning queries, executing SQL, analyzing results — is shown as it happens. You can pause the investigation and steer it with follow-up instructions.",
    placement: "left",
    title: "Live Timeline",
  },
  {
    target: '[data-tour="research-findings"]',
    content:
      "Findings appear here as the AI discovers insights. Each finding has a confidence level, key metrics, and supporting evidence. Click any finding to drill down into the underlying data, export tables, or save visualizations to your Workbench.",
    placement: "top",
    title: "Research Findings",
  },
  {
    target: '[data-tour="research-report"]',
    content:
      "Once the investigation completes, a synthesized report is generated with an executive summary, ranked insights, and recommendations you can act on.",
    placement: "top",
    title: "Synthesized Report",
  },
  {
    target: '[data-tour="research-share"]',
    content:
      "Share your research session with specific colleagues, or — if you're an admin — make it globally visible to everyone in your organization.",
    placement: "bottom",
    title: "Share Session",
  },
  {
    target: '[data-tour="research-export"]',
    content:
      "Export the full research report to Excel, PDF, PowerPoint, or as an image to share outside the platform.",
    placement: "bottom",
    title: "Export Report",
  },
  {
    target: '[data-tour="research-followup"]',
    content:
      "After the investigation completes, use this input to ask follow-up questions. The AI retains full context from the session, so you can drill deeper into any finding or ask for a different angle.",
    placement: "top",
    title: "Follow-Up Chat",
  },
];

export const topTieringTourSteps: Step[] = [
  {
    target: '[data-tour="toptiering-nav"]',
    content:
      "Navigate between analytics views using the Dashboard menu. Each view offers a different perspective on your pipeline performance.",
    placement: "bottom",
    disableBeacon: true,
    title: "Analytics Navigation",
  },
  {
    target: '[data-tour="toptiering-filters"]',
    content:
      "Filter analytics by date range, branch, channel, and other dimensions to focus your analysis.",
    placement: "bottom",
    title: "Analytics Filters",
  },
  {
    target: '[data-tour="toptiering-chart"]',
    content:
      "Interactive charts let you drill down into the data. Hover for details, click segments to filter, and zoom into time ranges.",
    placement: "top",
    title: "Interactive Charts",
  },
  {
    target: '[data-tour="toptiering-table"]',
    content:
      "Detailed data tables complement the charts. Sort, filter, and export for deeper analysis.",
    placement: "top",
    title: "Detail Tables",
  },
];

export const adminTourSteps: Step[] = [
  {
    target: '[data-tour="admin-org"]',
    content:
      "Organization Settings — Update your organization profile, display name, and branding.",
    placement: "right",
    disableBeacon: true,
    title: "Organization Settings",
  },
  {
    target: '[data-tour="admin-users"]',
    content:
      "Manage your organization's users here. Add new users, assign roles, control access, and monitor login activity.",
    placement: "right",
    title: "User Management",
  },
  {
    target: '[data-tour="admin-roles"]',
    content:
      "Create custom roles with specific section access, field restrictions, and row-level filters for fine-grained permissions.",
    placement: "right",
    title: "Access & Permissions",
  },
  {
    target: '[data-tour="admin-sso"]',
    content:
      "Configure Single Sign-On (SAML, OIDC) so users can log in with your identity provider.",
    placement: "right",
    title: "SSO Configuration",
  },
  {
    target: '[data-tour="admin-connections"]',
    content:
      "Set up and manage your LOS connection (e.g. Encompass) and sync schedules.",
    placement: "right",
    title: "Connections & Integrations",
  },
  {
    target: '[data-tour="admin-loan-folders"]',
    content:
      "Choose which Encompass loan folders Cohi syncs data from. Only loans in selected folders appear in dashboards and reports.",
    placement: "right",
    title: "Loan Folders",
  },
  {
    target: '[data-tour="admin-data-config"]',
    content:
      "Map LOS fields to Cohi data — default mappings, additional fields, and population stats for Encompass.",
    placement: "right",
    title: "Field Mapping",
  },
  {
    target: '[data-tour="admin-revenue"]',
    content:
      "Configure revenue and margin formulas so scorecards and reports use your preferred revenue fields.",
    placement: "right",
    title: "Revenue",
  },
  {
    target: '[data-tour="admin-scoring-weights"]',
    content:
      "Set scorecard weights for Sales and Operations, loan complexity rules, and monthly unit targets.",
    placement: "right",
    title: "Scoring & Weights",
  },
  {
    target: '[data-tour="admin-data-quality"]',
    content:
      "Monitor data completeness and resolve mapping or sync issues that affect your metrics.",
    placement: "right",
    title: "Data Quality",
  },
  {
    target: '[data-tour="admin-knowledge-center"]',
    content:
      "Add documents to the knowledge base to enhance Cohi Chat with your organization's context.",
    placement: "right",
    title: "Knowledge Center",
  },
  {
    target: "body",
    content:
      "You've seen the main admin sections. Use Help Center (?) for detailed articles on each area, or click any section to configure it.",
    placement: "center",
    title: "Admin Tour Complete",
  },
];

export const financialModelingTourSteps: Step[] = [
  {
    target: '[data-tour="fms-parameters"]',
    content:
      "Set your scenario parameters: adjust interest rates, volume projections, margin assumptions, and more.",
    placement: "right",
    disableBeacon: true,
    title: "Scenario Parameters",
  },
  {
    target: '[data-tour="fms-run"]',
    content:
      "Run the model to see projected outcomes based on your parameters.",
    placement: "bottom",
    title: "Run Projection",
  },
  {
    target: '[data-tour="fms-results"]',
    content:
      "Compare scenarios side-by-side. See how different assumptions affect revenue, volume, and profitability.",
    placement: "top",
    title: "Compare Outcomes",
  },
  {
    target: '[data-tour="fms-export"]',
    content:
      "Export your financial model results for presentations and planning sessions.",
    placement: "bottom",
    title: "Export Results",
  },
];

export type TourId =
  | "welcome"
  | "cohi-chat"
  | "workbench"
  | "research"
  | "toptiering"
  | "admin"
  | "financial-modeling";

export const tourRegistry: Record<TourId, { steps: Step[]; label: string }> = {
  welcome: { steps: welcomeTourSteps, label: "Welcome Tour" },
  "cohi-chat": { steps: cohiChatTourSteps, label: "Cohi Chat Tour" },
  workbench: { steps: workbenchTourSteps, label: "Workbench Tour" },
  research: { steps: researchLabTourSteps, label: "Research Lab Tour" },
  toptiering: { steps: topTieringTourSteps, label: "TopTiering Tour" },
  admin: { steps: adminTourSteps, label: "Admin Panel Tour" },
  "financial-modeling": {
    steps: financialModelingTourSteps,
    label: "Financial Modeling Tour",
  },
};

export function tourHasSteps(tourId: TourId): boolean {
  return (tourRegistry[tourId]?.steps.length ?? 0) > 0;
}
