export interface HelpArticle {
  id: string;
  slug: string;
  title: string;
  category: string;
  categorySlug: string;
  summary: string;
  content: string;
  relatedTour?: string;
  adminOnly?: boolean;
}

export interface HelpCategory {
  slug: string;
  label: string;
  icon: string;
  description: string;
  adminOnly?: boolean;
}

export const helpCategories: HelpCategory[] = [
  {
    slug: "getting-started",
    label: "Getting Started",
    icon: "Rocket",
    description: "First steps and platform overview",
  },
  {
    slug: "insights",
    label: "Insights",
    icon: "Zap",
    description: "Daily briefings, news, and dashboards",
  },
  {
    slug: "workbench",
    label: "Workbench",
    icon: "LayoutPanelLeft",
    description: "Custom dashboards and widgets",
  },
  {
    slug: "toptiering",
    label: "TopTiering Analytics",
    icon: "TrendingUp",
    description: "Funnels, scorecards, and comparisons",
  },
  {
    slug: "cohi-chat",
    label: "Cohi Chat",
    icon: "MessageSquare",
    description: "Unified chat, modes, history, and example queries",
  },
  {
    slug: "settings",
    label: "Settings",
    icon: "Settings",
    description: "Account preferences and security",
  },
  {
    slug: "admin",
    label: "Admin",
    icon: "Shield",
    description: "User management, LOS, and configuration",
    adminOnly: true,
  },
  {
    slug: "faq",
    label: "FAQ",
    icon: "HelpCircle",
    description: "Common questions and troubleshooting",
  },
  {
    slug: "glossary",
    label: "Glossary",
    icon: "BookOpen",
    description: "Mortgage terms and metric definitions",
  },
];

export const helpArticles: HelpArticle[] = [
  // ─── Getting Started ───────────────────────────────────────────────
  {
    id: "gs-first-steps",
    slug: "first-steps",
    title: "First Steps After Login",
    category: "Getting Started",
    categorySlug: "getting-started",
    summary: "What to do when you first log in to Cohi.",
    content: `# First Steps After Login

When you first log in to Cohi, you'll be greeted with the **Insights** dashboard. Here's what to do:

## 1. Take the Welcome Tour
If this is your first time, we'll offer a guided tour. Accept it to learn the layout in under 2 minutes.

## 2. Review Cohi Insights
The AI-generated Cohi Insights appear at the top of the Insights page. They summarize key changes in your loan pipeline, highlight risks, and surface opportunities.

## 3. Check the Business Overview
Scroll down to the Business Overview section for a snapshot of your organization's KPIs: active loans, revenue metrics, pull-through rates, and cycle times.

## 4. Explore the Navigation
Use the top navigation bar to access:
- **Insights** — Your home dashboard with AI briefings and KPIs
- **Dashboard** — TopTiering analytics (funnels, scorecards, comparisons)
- **My Workbench** — Build custom dashboards with drag-and-drop widgets
- **Cohi Chat (Research)** — Deep AI investigations from the chat band on any page

## 5. Set Up Your Profile
Visit **Settings** (from the user menu, top-right) to change your password, enable MFA for security, and set your preferred theme.`,
  },
  {
    id: "gs-understanding-dashboard",
    slug: "understanding-dashboard",
    title: "Understanding Your Dashboard",
    category: "Getting Started",
    categorySlug: "getting-started",
    summary: "Learn what each section of the Insights dashboard shows you.",
    content: `# Understanding Your Dashboard

The Insights dashboard is divided into several sections, each providing a different perspective on your business:

## Cohi Insights
AI-generated executive insights that highlight significant changes, risks, and opportunities in your loan pipeline. Bookmark any insight to track it; monitored items appear under **Insights → My Insights → Tracked insights** (see [Tracking Insights to Your Watchlist](/help/insights/tracking-insights)). For the personal feed, see [My Insights](/help/insights/my-insights); for saved custom prompts, see [My Prompts](/help/insights/my-prompts).

## Cohi Mortgage News
Curated industry news aggregated from trusted sources, keeping you informed about market conditions.

## Leaderboard
Performance rankings showing your top loan officers and branches by volume, revenue, and pull-through rates.

## Business Overview
High-level KPIs including:
- **Active Loans** — Current pipeline count and value
- **Revenue Metrics** — Gain on sale, SRP, origination fees
- **Pull-Through Rates** — Percentage of applications that close
- **Cycle Times** — Average days from application to closing

## Closing & Fallout Forecast
ML-powered predictions showing which loans are at risk of falling out and which are on track to close. Risk bands help you prioritize follow-up actions.

## Reports Sidebar
The left sidebar lets you toggle section visibility. Click the section names to jump directly to them.`,
  },
  {
    id: "gs-navigating",
    slug: "navigating-the-platform",
    title: "Navigating the Platform",
    category: "Getting Started",
    categorySlug: "getting-started",
    summary: "How to find your way around Cohi.",
    content: `# Navigating the Platform

## Top Navigation Bar
The navigation bar at the top of every page provides access to all major sections:

- **Insights** (dropdown) — Jump to Cohi Insights or Cohi Mortgage News
- **Dashboard** (dropdown) — Access TopTiering analytics including Scorecards, Credit Risk, Financial Modeling, and more
- **My Workbench** — Your custom dashboard builder
- **Cohi Chat** — Unified AI assistant (Chat, Research, Insight builder, Workbench) on every page

## Right Side Controls
- **Tenant Selector** — Switch between tenants (platform admins only)
- **Channel Selector** — Filter data by channel (Retail, Wholesale, etc.)
- **Help** — Opens the Help Center (question mark icon)
- **What's New** — View recent platform updates (bell icon)
- **Theme Toggle** — Switch between light and dark mode (sun/moon icon)
- **User Menu** — Access Home, Settings, Admin panel, and logout

## Reports Sidebar
On the Insights page, a collapsible sidebar on the left provides quick navigation between dashboard sections.

## Navigation Search and Pinning
- Use sidebar search to find dashboards and pages quickly
- Pin frequently used pages for one-click access
- Reorder pinned pages to match your workflow priorities

## Keyboard Shortcuts
- Use **arrow keys** in dropdown menus to navigate items
- Press **Enter** to select
- Press **Escape** to close dropdowns`,
  },
  {
    id: "gs-profile",
    slug: "setting-up-profile",
    title: "Setting Up Your Profile",
    category: "Getting Started",
    categorySlug: "getting-started",
    summary: "Configure your account preferences and security.",
    content: `# Setting Up Your Profile

Visit **Settings** from the user menu (top-right) to configure your account.

## Account
- **Change Password** — Update your password (requires current password)
- **Multi-Factor Authentication** — Enable MFA for additional security using an authenticator app (TOTP)

## Appearance
- **Theme** — Choose Light, Dark, or System (follows your OS setting) via the **Appearance** tab or the sun/moon toggle in the navigation bar

## Profile Information
Your name, email, and role are managed by your administrator. Contact them if you need changes.`,
  },

  // ─── Insights ──────────────────────────────────────────────────────
  {
    id: "ins-daily-briefings",
    slug: "daily-briefings",
    title: "Reading Your Cohi Insights",
    category: "Insights",
    categorySlug: "insights",
    summary: "How AI-generated insights work and how to use them.",
    content: `# Reading Your Cohi Insights

Cohi's AI analyzes your loan data continuously and generates executive-level insights about significant changes, emerging risks, and opportunities.

## How Insights Are Generated
The AI examines patterns across your entire pipeline including:
- Volume changes by branch, LO, or channel
- Pull-through rate fluctuations
- Turn time anomalies
- Revenue shifts
- Risk concentration patterns

## Reading an Insight
Each insight card shows:
- **Title** — A concise summary of the finding
- **Severity** — How significant the change is
- **Details** — Click to expand for full analysis and supporting data

## Tracking Insights
Click the bookmark icon on any insight to add it to your watchlist. Tracked insights are monitored over time, and you'll see updates if the underlying situation changes. View and manage tracked items on the **My Insights** tab — see [Tracking Insights to Your Watchlist](/help/insights/tracking-insights).

## Asking Follow-Up Questions
Open any insight's detail view and use the chat feature to ask follow-up questions. For example: "Which specific loans are contributing to this trend?" or "How does this compare to last quarter?"`,
  },
  {
    id: "ins-tracking",
    slug: "tracking-insights",
    title: "Tracking Insights to Your Watchlist",
    category: "Insights",
    categorySlug: "insights",
    summary: "Monitor important insights over time.",
    content: `# Tracking Insights to Your Watchlist

Tracked insights live on the **Insights** page under the **My Insights** tab, in the **Tracked insights** section at the bottom of that tab.

## Adding to Watchlist
Click the **bookmark icon** on any insight card—in either the **Insights** tab (organization-wide Cohi Insights) or **My Insights** (your personalized feed)—to track it. Tracked items appear in **Tracked insights** on the **My Insights** tab, where you can monitor how they evolve over time.

## Why Track Insights?
Tracking is useful for:
- Monitoring a concerning trend (e.g., declining pull-through in a branch)
- Following up on an opportunity (e.g., a growing product segment)
- Keeping executives informed about key metrics

## Managing Your Watchlist
- Open **Insights → My Insights** and scroll to **Tracked insights**
- Remove items by clicking the bookmark icon again on the original card, or from the watchlist
- Insights update automatically as new data arrives`,
  },
  {
    id: "ins-my-insights",
    slug: "my-insights",
    title: "My Insights",
    category: "Insights",
    categorySlug: "insights",
    summary:
      "Overview of your personal Insights tab: profile-based cards and watchlist.",
    content: `# My Insights

On the **Insights** page, switch to **My Insights** for your personal dashboard on top of the tenant-wide briefing. Organization-wide AI briefings remain on the **Insights** tab; **My Insights** is scoped to **you**.

## What's on this tab

**Personalized cards** — Cohi summarizes how you tend to use the product (pages you visit, filters you apply across dashboards and analytics, themes in chat, Workbench usage, insight feedback). After each sync, new cards aim at that footprint. Behavioral cards explain **why you're seeing this** when grounded in your interest profile.

**Tracked insights** — Bookmarking still bookmarks the insight; monitored items gather in **Tracked insights** at the bottom of this tab. Tracking behavior is unchanged from before—only the home for the list moved here. Details: [Tracking Insights to Your Watchlist](/help/insights/tracking-insights).

**My Prompts** — Saved questions produce **custom** My Insights cards (they carry a **Custom Insight** cue and reference the originating prompt). How to author, schedule, specifier, run, edit, disable, or delete prompts is documented in **[My Prompts](/help/insights/my-prompts)**.

## Insights vs My Insights (quick contrast)

| Aspect | **Insights** tab | **My Insights** tab |
| --- | --- | --- |
| Audience | Whole organization | You only |
| Source | Tenant insight agents | Your profile + prompts you saved |
| Watchlist bucket | Bookmark from insights here or on My Insights | **Tracked insights** lists every bookmark |

## Practical tips

Keep using Cohi the way you already do—changing filters and asking questions—is what keeps personalization relevant. Combine tenant briefings (**Insights**) with your personal lane (**My Insights**) so nothing important gets noisy.

**See also:** [My Prompts](/help/insights/my-prompts) · [Reading Your Cohi Insights](/help/insights/daily-briefings) · [Using Insight Builder in Cohi Chat](/help/cohi-chat/insight-builder-mode)`,
  },
  {
    id: "ins-my-prompts",
    slug: "my-prompts",
    title: "My Prompts",
    category: "Insights",
    categorySlug: "insights",
    summary:
      "Save custom prompts that become My Insights cards—form fields, Insight builder, and examples.",
    content: `# My Prompts

**My Prompts** lives inside **Insights → My Insights**. Each saved prompt is a question or analysis you ask Cohi to run periodically or when you explicitly trigger it; the output appears as cards in **My Insights** beside your personalized behavioral cards.

## Add or edit prompts

Choose **Add Prompt** from the My Prompts block, or **Edit** from the row menu for an existing prompt:

**Title** — Short label identifying the insight in lists and badges.

**Schedule** — Dropdown with two choices:
- **Batch (with My Insights sync)** — Runs when My Insights refreshes alongside new ingest.
- **On demand** — Does not auto-run; use **Run** (play icon) on the prompt row whenever you want a fresh card now.

Subsidiary help text in the modal: batch prompts piggy-back on sync; on-demand waits for your Run action.

**Prompt text** — The natural-language briefing you want synthesized into a card (patterns, cohort comparisons, diagnostics, operational triage wording, etc.). This is narrative direction; narrowing the **loan cohort** belongs in Specifiers unless you deliberately keep it conversational only.

**Tag** — Optional. Tags categorize the synthesized card inside My Insights lanes. Default stays **(blank)** per product copy.

**Specifiers** — Optional filters you attach with **Add specifier**. Each row has a loans-table **Column** dropdown and matching **Filter** choices (loan type FHA, branch 2001, status application denied, and similar). Those rows behave like chained AND clauses: only loans matching **every** specifier are included before Cohi runs your Prompt text—and they are structured filters, not text you paste inside the Prompt field. Insight builder previews often draft suggestive specifiers; **Add Prompt** exposes the exact same specifier panel UI. Rows can be cleared with row **X**.

Closing actions: **Cancel** closes without saving drafts; **Save changes** persists the prompt for batch/sync or on-demand **Run**.

For the conversational authoring path—and **Approve**, **Request changes**, and preview cards—see [Using Insight Builder](/help/cohi-chat/insight-builder-mode); approved drafts sync into **My Prompts** without re-entering modal fields blind.

Heavy jobs can overlap oddly: batched prompts, manually triggered **Run**, and full refresh passes should be staggered if one hangs—only one strenuous My Insights pathway should churn at once.

Prompt rows meanwhile carry **On** toggles and **Run** / **Edit** / trash controls so upkeep rarely needs reopening the modal.

Back to contextual overview: [My Insights](/help/insights/my-insights).

## Examples (realistic saved prompts)

**Example A — FHA denial patterns**

Title: FHA Denial Patterns  
Schedule: Batch (with My Insights sync)  
Prompt Text: Are there any patterns in FHA denials? What are the top reasons and which LOs have the highest denial rates?  
Tag: (blank)  
Specifiers:
- Loan Type (\`loan_type\`) · **Loan Type: FHA**
- Current Loan Status · **Current Loan Status: Application denied**

**Example B — Branch 2001 weekly health**

Title: Branch 2001 weekly health  
Schedule: Batch (with My Insights sync)  
Prompt Text: How is Branch 2001 performing this week compared to last month? Focus on pull-through and cycle time.  
Tag: (blank)  
Specifiers: Branch (\`branch\`) · **Branch: 2001**`,
  },
  {
    id: "ins-details",
    slug: "insight-details",
    title: "Drilling into Insight Details",
    category: "Insights",
    categorySlug: "insights",
    summary: "Get the full picture behind any insight.",
    content: `# Drilling into Insight Details

## Opening Detail View
Click on any insight card to open its full detail modal. The detail view provides:

## What You'll See
- **Full Analysis** — The complete AI-generated analysis with context
- **Supporting Data** — Charts, tables, and metrics that back up the insight
- **Related Metrics** — Key performance indicators relevant to this insight
- **Trend History** — How this metric has changed over time

## Follow-Up Chat
Use the built-in chat within the insight detail to ask questions like:
- "What's driving this change?"
- "Which loans are affected?"
- "How does this compare to previous periods?"
- "What actions should I take?"

The AI will respond with data-backed answers specific to the insight you're viewing.`,
  },
  {
    id: "ins-followup",
    slug: "insight-chat",
    title: "Asking Follow-Up Questions via Insight Chat",
    category: "Insights",
    categorySlug: "insights",
    summary: "Use AI chat to dig deeper into any insight.",
    content: `# Asking Follow-Up Questions via Insight Chat

## Accessing Insight Chat
When viewing an insight's detail modal, you'll find a chat input at the bottom. This chat is context-aware and understands which insight you're examining.

## Effective Questions
Here are some examples of effective follow-up questions:

**Drill-Down Questions:**
- "Break this down by branch"
- "Which loan officers are contributing most?"
- "Show me the specific loans involved"

**Comparison Questions:**
- "How does this compare to last month?"
- "What was this metric a year ago?"
- "Which channel performs best here?"

**Action-Oriented Questions:**
- "What should I do about this?"
- "Who should I talk to first?"
- "What's the estimated revenue impact?"

## Tips
- Be specific — the more detail in your question, the better the answer
- Reference the insight context — "Why is *this* branch declining?" is better than "Why are branches declining?"
- Ask for data — "Show me the numbers" gives you tables and charts`,
  },

  // ─── Workbench ─────────────────────────────────────────────────────
  {
    id: "wb-first-canvas",
    slug: "first-canvas",
    title: "Creating Your First Canvas",
    category: "Workbench",
    categorySlug: "workbench",
    summary: "Get started building custom dashboards.",
    relatedTour: "workbench",
    content: `# Creating Your First Canvas

## What is a Canvas?
A canvas is a custom dashboard where you arrange widgets (charts, tables, KPIs) to create the exact view you need.

## Creating a Canvas
1. Navigate to **My Workbench** from the top navigation
2. Click **New Blank Canvas** in the sidebar
3. Give your canvas a name (e.g., "Q1 Pipeline Review")
4. Start adding widgets

## Adding Widgets
There are two ways to add widgets:

### From the Catalog
Click the **Add** button to browse pre-built widgets including:
- KPI cards
- Bar, line, and pie charts
- Data tables
- Text and narrative blocks

### Using AI
Open the AI assistant panel and describe what you want:
- "Create a bar chart showing loan volume by branch for the last 90 days"
- "Add a KPI card showing total revenue this month"
- "Build a table of all loans closing in the next 30 days"

## Auto-Save
Your canvas auto-saves as you make changes. No need to manually save.`,
  },
  {
    id: "wb-ai-widgets",
    slug: "ai-widgets",
    title: "Adding Widgets: Manual vs AI",
    category: "Workbench",
    categorySlug: "workbench",
    summary: "Two ways to build your dashboard.",
    content: `# Adding Widgets: Manual vs AI

## Manual Widget Creation
Click **Add** to open the widget catalog. Browse categories, preview widgets, and click to add them to your canvas.

After adding, configure the widget:
- Set the data source and filters
- Choose chart type and colors
- Set the time range
- Resize and position by dragging

## AI-Powered Widget Creation
Open the AI assistant in the Workbench and describe what you need in plain English:

**Examples:**
- "Show me a donut chart of loan types for the current pipeline"
- "Create a leaderboard of top 10 LOs by funded volume this quarter"
- "Build a line chart of monthly origination volume for the past 12 months"
- "Add a table showing all loans with DTI over 43%"

The AI generates the SQL query, creates the widget, and places it on your canvas. You can then modify it further through the AI or manual configuration.

## Modifying Widgets
Select any widget and:
- Drag to reposition
- Drag edges to resize
- Click the more options menu (three-dot icon) to configure
- Ask the AI: "Change this chart to a line chart" or "Add a filter for Retail channel"`,
  },
  {
    id: "wb-customize",
    slug: "customizing-widgets",
    title: "Customizing Widget Appearance",
    category: "Workbench",
    categorySlug: "workbench",
    summary: "Fine-tune your dashboard visuals.",
    content: `# Customizing Widget Appearance

## Widget Configuration
Click the **more options menu** (three-dot icon) on any widget to access its configuration panel:

- **Title** — Set a descriptive title
- **Chart Type** — Switch between bar, line, area, pie, donut, treemap, or table
- **Colors** — Choose from preset color schemes or set custom colors
- **Axes** — Configure axis labels, formatting, and ranges
- **Filters** — Add data filters specific to this widget
- **Time Range** — Override the canvas default time range

## Layout
- **Drag** widgets to reposition them on the canvas
- **Resize** by dragging the edges or corners
- Widgets snap to a grid for alignment
- Multiple canvases let you organize by topic (e.g., "Sales", "Operations", "Executive")

## Widget Types
- **KPI Cards** — Single metric with trend indicator
- **Bar Charts** — Compare categories
- **Line Charts** — Show trends over time
- **Pie/Donut Charts** — Show composition
- **Area Charts** — Volume trends with filled areas
- **Treemaps** — Hierarchical data visualization
- **Pivot Tables** — Cross-tabulated data analysis
- **Text Blocks** — Add notes and narrative context`,
  },
  {
    id: "wb-ai-assistant",
    slug: "workbench-ai",
    title: "Using the AI Assistant to Build Dashboards",
    category: "Workbench",
    categorySlug: "workbench",
    summary: "Build dashboards with natural language.",
    content: `# Using the AI Assistant to Build Dashboards

## Opening the AI Assistant
The AI assistant panel is available in the Workbench. Click the chat icon to open it.

## What Can the AI Do?
- **Create Widgets** — "Add a bar chart of funded volume by month"
- **Modify Widgets** — "Change the colors to blue and green"
- **Generate SQL** — "Write a query for all loans with LTV > 80%"
- **Answer Questions** — "What's the average turn time for FHA loans?"
- **Explain Data** — "What does the pull-through rate mean?"
- **Build Reports** — "Create a PowerPoint with pipeline overview slides"

## Tips for Best Results
1. **Be specific about metrics** — "Revenue" is vague; "Gain on sale for the last 90 days" is precise
2. **Mention the chart type** — "Bar chart", "line chart", "table" helps the AI choose the right format
3. **Specify filters** — "For the Retail channel only" or "Exclude withdrawn loans"
4. **Iterate** — Start with a basic widget and refine: "Now break it down by branch" or "Add a trend line"

## Multi-Step Dashboards
You can build entire dashboards through conversation:
1. "Create a canvas called Q1 Review"
2. "Add a KPI card for total funded volume"
3. "Add a bar chart comparing branches"
4. "Add a line chart showing monthly trends"
5. "Generate a PowerPoint report from this canvas"`,
  },
  {
    id: "wb-sharing",
    slug: "sharing-dashboards",
    title: "Sharing Dashboards and Team Folders",
    category: "Workbench",
    categorySlug: "workbench",
    summary: "Collaborate with your team on dashboards.",
    content: `# Sharing Dashboards and Team Folders

## Sharing a Canvas
1. Open the canvas you want to share
2. Click the **Share** button
3. Choose sharing options:
   - **Share with specific users** — Select team members by name
   - **Share with team** — Make it available to everyone in your organization
   - **Generate link** — Create a shareable URL

## Distribution-Based Sharing
If you send a canvas using **Content distribution**, recipients are shared onto the canvas automatically with **viewer** permission.

- Learn more: **Distributing Canvases and Content**
- Learn more: **Managing Recipient Lists**
- Learn more: **Auto-Inviting External Recipients**

This is useful for recurring updates where admins need to send the latest canvas to a fixed audience.

## Team Folders
Organize shared dashboards into folders:
1. Go to **Workbench > Team Folders** from the sidebar
2. Create folders for different departments or topics (e.g., "Executive Reports", "Sales Dashboards")
3. Move canvases into folders for easy discovery

## Favorites
Star any canvas to add it to your Favorites for quick access.

## Permissions
- **View** — Others can see the dashboard but not modify
- **Edit** — Others can make changes (careful with this!)
- Canvas owners always retain full control

## Canvas-Only Recipients
Some recipients are provisioned as **canvas-only** users. They get a slim, read-only experience focused on shared canvases and do not have full platform access.

See: **Viewing Shared Canvases (Canvas-Only Users)**`,
  },
  {
    id: "wb-reports",
    slug: "generating-reports",
    title: "Generating Reports (PPTX/PDF)",
    category: "Workbench",
    categorySlug: "workbench",
    summary: "Export dashboards as presentations or documents.",
    content: `# Generating Reports (PPTX/PDF)

## Building a Report
The Report Builder creates professional PowerPoint or PDF documents from your Workbench data.

### Using the AI
Ask the AI assistant: "Generate a report on our Q1 pipeline performance." The AI will:
1. Select relevant data and metrics
2. Create formatted slides
3. Add charts and visualizations
4. Include executive summary text

### Manual Report Building
1. Click **Export** or **Generate Report** in the Workbench
2. Select which widgets to include
3. Choose a template layout
4. Add a title and subtitle
5. Click **Generate**

## Export Formats
- **PowerPoint (PPTX)** — Editable presentation with charts and data
- **PDF** — Fixed-format document for offline sharing or archival

## Tips
- Use the AI to generate a first draft, then refine manually
- Include KPI summaries at the beginning of reports
- Add context slides with text blocks explaining key findings
- Reports reflect your current filters and time range selections

## Important: Distribution Uses Links
Content distribution sends **secure links**, not PDF/PPTX attachments. If you want recurring delivery, create a schedule in **Workbench > Distributions**.

See: **Distributing Canvases and Content**`,
  },
  {
    id: "wb-distributions",
    slug: "distributing-content",
    title: "Distributing Canvases and Content",
    category: "Workbench",
    categorySlug: "workbench",
    summary: "Schedule secure, link-based delivery for canvases and other content.",
    content: `# Distributing Canvases and Content

## What Distributions Do
Distributions let admins schedule recurring delivery of:
- **Canvases**
- **Reports**
- **Insight Digests**

Delivery is link-based. Recipients get an email with a summary and a **View in Coheus** link.

## Create a Schedule
1. Go to **Workbench > Distributions**
2. Click **Create Schedule**
3. Enter a name and optional email summary
4. Choose content type and content item
5. Set frequency and send time
6. Choose a recipient list and/or enter direct emails
7. Save the schedule

## Direct Emails vs Recipient Lists
- **Direct emails** are quick for one-off or ad-hoc recipients.
- **Recipient lists** are better for reusable audiences and role-based delivery.

You can combine both in one schedule.

## Send Now vs Scheduled Runs
- **Send now** runs immediately and records a history row.
- Scheduled runs execute automatically based on your frequency/time settings.

## Send History
Open **History** on a schedule to review:
- Status (success, partial failure, failed)
- Recipients delivered
- Invite status (invited vs invite failed)
- Run duration

## Manage Existing Schedules
- **Edit** to update content, recipients, or timing
- **Deactivate** to stop future runs
- Re-enable or duplicate as needed for new campaigns`,
  },
  {
    id: "wb-recipient-lists",
    slug: "recipient-lists",
    title: "Managing Recipient Lists",
    category: "Workbench",
    categorySlug: "workbench",
    summary: "Build reusable recipient groups for content distribution.",
    content: `# Managing Recipient Lists

## Why Use Recipient Lists
Recipient lists reduce manual entry and keep recurring distributions consistent.

## Create a Recipient List
1. Go to **Workbench > Distributions**
2. In **Recipient lists**, click **Create Recipient List**
3. Add a name and optional description
4. Add recipients from one or more sources

## Recipient Sources
- **Specific users**: pick users directly
- **Role-based users**: include users by role
- **External emails**: paste comma/semicolon-separated addresses

## Dynamic Role Resolution
If **Resolve roles at send time** is enabled, membership is recalculated each run using current user roles.

## Auto-Invite External Emails
Enable auto-invite to provision unknown external emails as canvas-only users. Optionally add auto-invited users to a selected group.

## Maintenance Tips
- Review lists monthly for stale recipients
- Keep naming clear (for example: "Weekly Executive Distribution")
- Prefer lists over long direct-email strings for recurring schedules`,
  },
  {
    id: "wb-auto-invite",
    slug: "auto-inviting-external-recipients",
    title: "Auto-Inviting External Recipients",
    category: "Workbench",
    categorySlug: "workbench",
    summary: "Provision external recipients as canvas-only users during distribution.",
    content: `# Auto-Inviting External Recipients

## What Auto-Invite Does
When enabled, unknown recipient emails are automatically provisioned as:
- **Canvas-only user** persona
- **No loan access** visibility

This allows external recipients to access shared canvases securely without giving full platform access.

## Where to Enable It
- **Recipient list level**: Auto-invite external emails in that list
- **Schedule level**: Auto-invite direct emails entered on the schedule

## First-Time Recipient Flow
1. Distribution run detects an unknown email
2. User account is created as canvas-only
3. A password reset/set email is sent
4. Recipient sets password and signs in
5. Recipient opens the shared canvas link

## Invite Status in History
History shows:
- **Invited count**
- **Invite failed count**

Use this to verify onboarding outcomes after each run.

## Troubleshooting
- If invite failed, check send history and mail provider health
- If reset link expired, send another distribution or use forgot password
- If recipient can sign in but sees nothing, verify canvas share entries and recipient email accuracy`,
  },
  {
    id: "wb-canvas-viewer",
    slug: "viewing-shared-canvases",
    title: "Viewing Shared Canvases (Canvas-Only Users)",
    category: "Workbench",
    categorySlug: "workbench",
    summary: "What recipients see when they are invited as canvas-only users.",
    content: `# Viewing Shared Canvases (Canvas-Only Users)

## Canvas-Only Access
Canvas-only users are intended for shared-canvas consumption. They do not have full analytics/admin navigation.

## What Canvas-Only Users Can Do
- Open shared canvases
- Navigate between canvases shared with them
- Bookmark useful canvases

## What Canvas-Only Users Cannot Do
- Edit canvas content
- Add widgets, rich text, or background changes
- Clear canvases
- Schedule distributions
- Access unrelated admin/analytics areas

## Reading Shared Content
The shared canvas opens in a read-only mode. If your organization updates the canvas, viewers see the latest content from the same link.

## Common Issues
### I cannot see any canvases
- Confirm the exact email matches the shared recipient email
- Ask an admin to verify your canvas share was created

### My link does not work
- Sign in first, then open the link again
- If this is a first login, complete password setup before opening the canvas link`,
  },

  {
    id: "wb-fallout-alerts",
    slug: "fallout-alerts",
    title: "Configuring Fallout Alerts",
    category: "Workbench",
    categorySlug: "workbench",
    summary: "Set up automated email alerts for high-risk loans and track loan officer responses.",
    content: `# Configuring Fallout Alerts

## What Are Fallout Alerts?
Fallout Alerts automatically notify loan officers and managers when loans in the pipeline are at high risk of falling out. The system uses the Closing & Fallout Forecast risk scores to identify at-risk loans and sends actionable emails.

## Where to Configure
Navigate to **Workbench > Distributions** and select the **Fallout** tab, or go directly to \`/workbench/distributions?tab=fallout\`.

## Settings Tab
Configure how and when alerts are sent:

### Alert Criteria
- **Enable/Disable** — Turn fallout alerts on or off
- **Minimum Risk Score** — Only include loans at or above this threshold (0–100)
- **Risk Levels** — Choose which levels to include: Very High, High, Medium, Low

### Delivery Options
- **Frequency** — Realtime (immediate), Daily Digest, or Weekly Digest
- **Target Loan Officers** — Select specific LOs or choose "All visible"
- **Notify Managers** — Send a separate summary email to managers
- **Manager Card Delivery** — Send managers a detailed email with individual loan cards
- **Manager Recipients** — Specify which managers receive alerts
- **Custom Message** — Add an optional message included in LO emails

### Testing
- **Manual Test Recipients** — Enter comma-separated emails to test alerts without selecting actual LOs
- **Send Alerts Now** — Trigger an immediate alert run

## LO Responses Tab
After alerts are sent, track loan officer responses:
- **Search** by loan number, LO name, or recipient
- **Filter** by response type
- **Response Types:**
  - **Resolved** — LO has acknowledged and addressed the risk
  - **Working on it** — LO is actively managing the loan
  - **Need help** — LO is requesting assistance

## What Loan Officers Receive
Each alert email includes:
- Personalized greeting
- For each loan: loan number, risk level and score, loan amount, outlook, estimated close date, risk factors, and recommended actions
- Three response buttons: **Resolved**, **Working on it**, **Need help**
- Optional link to open the full coaching view in the platform
- Response links expire after 7 days

## Single-Loan Alerts
From any **Loan Drilldown Modal** (in the Fallout Forecast), you can send an alert for a single loan:
1. Open a loan card from the Critical Loans section
2. Click **Email Now**
3. The primary recipient is the loan officer on file
4. Optionally add extra recipients and a personal message
5. Send the alert

## Manager Summary Emails
When **Notify Managers** is enabled, managers receive:
- A summary of all high-risk loans and breakdown by loan officer
- Link to the dashboard for full details

## Tips
- Start with a higher minimum risk score (e.g., 70+) and lower it as your team adjusts
- Use Daily Digest to avoid alert fatigue
- Review the LO Responses tab weekly to identify patterns and coaching opportunities`,
  },

  // ─── Insights (continued) ───────────────────────────────────────────
  {
    id: "ins-audio-briefings",
    slug: "audio-briefings",
    title: "Cohi Daily Audio Briefings",
    category: "Insights",
    categorySlug: "insights",
    summary: "Listen to AI-generated audio briefings about your pipeline and market.",
    content: `# Cohi Daily Audio Briefings

## What Are Audio Briefings?
Audio Briefings are AI-generated spoken summaries of your organization's key metrics, market conditions, and pipeline highlights. Think of them as a personalized news broadcast for your lending operation.

## Two Briefing Types

### On-Demand Briefing (Cohi News Brief)
Found in the **Cohi Mortgage News** section on the Insights page:
- Click the **radio icon** to generate a briefing in real time
- The AI creates a ~90-second spoken summary from your latest data
- Controls: Play, Pause, Mute, End
- Ask follow-up questions by voice (microphone) or text during playback

### Pre-Generated Briefing (Cohi Briefing)
Found in the **Cohi Insights** section on the Insights page:
- A **Play** button appears when a pre-generated briefing is available
- Briefings are ~2–3 minutes and cover deeper insight analysis
- Adjust playback speed (0.75x to 1.5x) and use the seek bar to skip around
- Ask follow-up questions by voice or text during playback

## Nightly Scheduled Generation
Your admin can enable nightly briefing generation so a fresh audio summary is ready every morning. When enabled, the briefing is generated overnight using the latest data and is available when you first open the Insights page.

## Tips
- Listen during your morning commute or while reviewing email
- Use voice follow-ups for hands-free interaction
- Briefings update as new data arrives — listen again later in the day for an updated view`,
  },
  {
    id: "ins-newsletter",
    slug: "daily-newsletter",
    title: "Daily Brief Newsletter",
    category: "Insights",
    categorySlug: "insights",
    summary: "Subscribe to daily email newsletters with market and pipeline updates.",
    content: `# Daily Brief Newsletter

## What Is It?
The Daily Brief Newsletter is an automated email delivered to your inbox with a market snapshot, industry news, pipeline digest, and tracked metrics — all without needing to log into the platform.

## What's Included
Each newsletter can contain:
- **Market Snapshot** — Key rate and market data
- **Industry News** — Curated headlines from MBA, Freddie Mac, and other trusted sources
- **Pipeline Digest** — Summary of your organization's pipeline changes
- **Tracked Metrics** — Updates on metrics you're monitoring

## Subscribing
1. Navigate to the **Insights** page
2. Look for the newsletter subscription controls in the Daily Brief section
3. Enable delivery and configure your preferred schedule

## Preview
Before sending, you can preview the newsletter content to see exactly what recipients will receive. This is useful for admins who want to verify content before enabling delivery to the team.

## Delivery Schedule
Configure when newsletters are sent. Common options include:
- Daily (morning delivery)
- Custom schedule based on your organization's needs

## Who Receives It
Newsletter distribution can be configured by your admin. Individual users can opt in or out based on their preferences.`,
  },

  // ─── TopTiering ────────────────────────────────────────────────────
  /*   {
    id: "tt-funnel",
    slug: "loan-funnel",
    title: "Loan Funnel Analysis",
    category: "TopTiering Analytics",
    categorySlug: "toptiering",
    summary: "Understanding conversion rates at each milestone.",
    relatedTour: "toptiering",
    content: `# Loan Funnel Analysis

## What is the Loan Funnel?
The Loan Funnel visualizes how loans move through your pipeline from application to funding. It shows:
- How many loans are at each stage
- Conversion rates between stages
- Where the biggest drop-offs occur

## Reading the Funnel
- **Wider sections** represent more loans at that stage
- **Narrowing** shows where loans fall out
- **Conversion percentages** appear between stages

## Key Metrics
- **Total Applications** — Loans entering the top of the funnel
- **Stage Conversion** — Percentage moving from one stage to the next
- **Overall Pull-Through** — Percentage of applications that ultimately fund
- **Fallout Rate** — Percentage of loans that don't complete

## Using Filters
Filter the funnel by:
- Date range
- Branch or channel
- Loan type or product
- Loan officer

This helps identify where specific segments are underperforming.`,
  }, */
  {
    id: "tt-fallout-forecast",
    slug: "fallout-forecast",
    title: "Closing & Fallout Forecast",
    category: "TopTiering Analytics",
    categorySlug: "toptiering",
    summary: "ML-powered predictions for loan closing, withdrawal, and denial risk.",
    content: `# Closing & Fallout Forecast

## What Is It?
The Closing & Fallout Forecast uses machine learning to predict which loans in your pipeline are likely to close, withdraw, be denied, or close late. It helps teams prioritize follow-up actions on at-risk loans before they fall out.

## Key Metrics
The dashboard displays five primary KPIs:
- **Active Loans** — Total loans currently in the pipeline
- **Predicted Closing** — Loans the model expects to close successfully
- **Likely Withdraw** — Loans showing withdrawal risk patterns
- **Likely Deny** — Loans with denial risk indicators
- **Likely Close Late** — Loans expected to close but past their target date

## Critical Loans
Below the KPIs, a **Critical Loans** section displays loan cards for the highest-risk files. Each card shows:
- Loan number and borrower info
- Risk level badge (Very High, High, Medium, Low)
- Risk score (0–100)
- Key risk factors driving the prediction
- Loan officer and branch

Click any loan card to open the **Loan Drilldown Modal** with full details, fallout alert history, and the option to send an alert.

## Prediction Zones
The model classifies loans into 6 prediction zones based on risk score and trajectory direction:
- Zones differentiate between **improving** and **deteriorating** risk
- For denied loans, direction-based zones distinguish between loans trending toward recovery vs those accelerating toward denial
- VA loans use updated rules where higher LTV alone is not treated as an automatic denial signal

## Filters
- **Date range** — Focus on loans within a specific period
- **Channel** — Filter by Retail, Wholesale, etc.
- **Branch / LO** — Narrow to specific teams or individuals

## Related Features
- **Fallout Alerts** — Automatically email loan officers about high-risk loans (see: Configuring Fallout Alerts)
- **Critical Loans Export** — Export the critical loans list to CSV for offline review`,
  },
  {
    id: "tt-actors",
    slug: "actors-dashboard",
    title: "Actors Dashboard",
    category: "TopTiering Analytics",
    categorySlug: "toptiering",
    summary: "Compare performance across loan officers, processors, underwriters, and other roles.",
    content: `# Actors Dashboard

## What Is It?
The Actors Dashboard provides a configurable view of personnel performance across different roles in your lending operation — loan officers, processors, underwriters, closers, and branches.

## What You Can See
- **Loan Status Distribution** — Visual breakdown of loan statuses across the pipeline
- **KPI Summary** — Key performance indicators for the selected actor type
- **Up to Four Actor Tables** — Configure which roles to display and compare side by side

## Actor Types
Each table can show a different role:
- **Loan Officers** — Volume, pull-through, revenue
- **Processors** — Units processed, turn times, resubmission rates
- **Underwriters** — Approval/denial rates, condition counts, turn times
- **Closers** — Closing volume, turn times, on-time rates
- **Branches** — Aggregated metrics at the branch level

## Metrics Per Actor
- Volume and unit counts
- Turn times (average days per milestone)
- Approval and denial rates
- Loan status breakdown

## Filters
- Date range selection
- Channel filtering
- Entity/actor selection for targeted comparisons

## Workbench Integration
Actors widgets are available in the Workbench for inclusion in custom dashboards and recurring reports.`,
  },
  {
    id: "tt-leaderboard",
    slug: "leaderboard",
    title: "Leaderboard",
    category: "TopTiering Analytics",
    categorySlug: "toptiering",
    summary: "See rankings of loan officers and branches by key production metrics.",
    content: `# Leaderboard

## What Is It?
The Leaderboard ranks your loan officers and branches by production metrics, making it easy to identify top performers and track competitive standings.

## Ranking Criteria
Rankings are available by:
- **Closed Loans** — Number of loans that have closed
- **Revenue** — Total revenue generated
- **Pull-Through Rate** — Percentage of applications that fund

## Time Periods
View rankings for:
- **WTD** — Week to Date
- **MTD** — Month to Date
- **QTD** — Quarter to Date
- **LM** — Last Month
- **LQ** — Last Quarter
- **LY** — Last Year
- **Custom** — Any date range you define

## What You See
Each entry in the leaderboard shows:
- **Rank** — Position based on the selected metric
- **Name** — Loan officer or branch name
- **Units** — Number of loans
- **Volume** — Total dollar amount
- **Icons** — Top performers (ranks 1–5) are highlighted with visual indicators

## Use Cases
- Recognize and reward top-producing loan officers
- Track ranking changes month over month
- Compare branch-level production
- Motivate teams with visible performance standings

## Where to Find It
The Leaderboard appears on the **Insights** dashboard and is also available as a standalone view under the Dashboard navigation.`,
  },
  {
    id: "tt-sales-scorecard-overview",
    slug: "sales-scorecard-overview",
    title: "Sales Scorecard Overview",
    category: "TopTiering Analytics",
    categorySlug: "toptiering",
    summary: "High-level sales performance summary with custom date controls and Workbench integration.",
    content: `# Sales Scorecard Overview

## What Is It?
The Sales Scorecard Overview provides a high-level summary of sales performance across your organization, complementing the detailed Sales Scorecard with a broader perspective.

## Key Features
- **Custom Date Controls** — Select specific date ranges for bar and column comparisons
- **Trend Analysis** — Visual trends showing how sales metrics change over time
- **Tier Distribution** — See how loan officers and branches distribute across Top, Second, and Bottom tiers

## Metrics Shown
- Production volume (applications, closings, fundings)
- Revenue and margin
- Pull-through rates
- Growth comparisons across periods

## Workbench Integration
Sales Scorecard Overview widgets can be added directly to Workbench canvases, allowing you to combine sales overview data with other analytics on a single custom dashboard.

## Relationship to Other Scorecards
- **Sales Scorecard** — Detailed individual and branch-level tiering with full metric breakdowns
- **Sales Scorecard Overview** — Summary view optimized for quick review and trend spotting
- **Sales Trends** — Historical trend analysis with momentum indicators

Use the Overview for leadership check-ins and the detailed Scorecard for coaching conversations.`,
  },
  {
    id: "tt-comparison",
    slug: "toptiering-comparison",
    title: "TopTiering Comparison",
    category: "TopTiering Analytics",
    categorySlug: "toptiering",
    summary: "Compare performance across tiers.",
    content: `# TopTiering Comparison

## What is TopTiering?
TopTiering segments your loan officers, branches, or channels into performance tiers (Top, Middle, Bottom) based on key metrics.

## How It Works
1. Select the entity to tier (LOs, branches, or channels)
2. Choose the metrics for comparison (volume, revenue, pull-through, cycle time)
3. Set the time period
4. View results showing how each entity ranks

## Key Views
- **Tier Distribution** — How many entities fall into each tier
- **Metric Comparison** — Side-by-side comparison of key metrics by tier
- **Trend Analysis** — How tier membership has changed over time
- **Detail Table** — Full breakdown with all metrics for each entity

## Use Cases
- Identify top performers and what they do differently
- Find underperformers who need coaching or support
- Benchmark branches against each other
- Track improvement over time`,
  },
  {
    id: "tt-credit-risk",
    slug: "credit-risk",
    title: "Credit Risk Management",
    category: "TopTiering Analytics",
    categorySlug: "toptiering",
    summary: "Monitor credit quality and risk concentration.",
    content: `# Credit Risk Management

## Overview
The Credit Risk Management dashboard monitors the credit quality of your loan portfolio and identifies risk concentrations.

## Key Metrics
- **FICO Distribution** — Breakdown of loans by credit score ranges
- **LTV Ratios** — Loan-to-value distribution
- **DTI Distribution** — Debt-to-income ratio analysis
- **Product Mix** — Distribution across loan types (Conventional, FHA, VA, etc.)

## Risk Indicators
- **High LTV Concentration** — Too many loans with LTV > 80%
- **Low FICO Volume** — Unusual volume of lower credit score loans
- **DTI Outliers** — Loans with DTI ratios near or above limits

## Using This Dashboard
- Monitor trends in credit quality over time
- Compare risk profiles across branches and channels
- Identify segments that may need additional oversight
- Support compliance reporting and audits`,
  },
  {
    id: "tt-scorecards",
    slug: "scorecards",
    title: "Company & Operations Scorecards",
    category: "TopTiering Analytics",
    categorySlug: "toptiering",
    summary: "Monitor organizational performance.",
    content: `# Company & Operations Scorecards

## Company Scorecard
A high-level view of your entire organization's performance with metrics including:
- Total volume (applications, closings, fundings)
- Revenue (gain on sale, SRP, fees)
- Pull-through rates by channel and product
- Year-over-year comparisons

## Operations Scorecard
Focused on operational efficiency:
- **Turn Times** — Average days for each processing step
- **Condition Turnaround** — How quickly conditions are cleared
- **Touch Count** — Number of times a file is touched before closing
- **Resubmission Rate** — Percentage of files requiring resubmission

## Sales Scorecard
Focused on sales team performance:
- Production volume by LO
- Revenue per LO
- Pipeline conversion rates
- Growth trends

## Trends Views
Both Operations and Sales have companion Trends pages showing how metrics change over time. Use these to identify improvements or degradation in performance.`,
  },
  {
    id: "tt-pricing-dashboard",
    slug: "pricing-dashboard",
    title: "Pricing Dashboard",
    category: "TopTiering Analytics",
    categorySlug: "toptiering",
    summary:
      "Track pricing performance, margin drivers, and segment-level variance.",
    content: `# Pricing Dashboard

## What It Shows
The Pricing Dashboard helps you monitor how pricing decisions affect volume, conversion, and revenue outcomes.

## Common Views
- **Pricing performance trends** over time
- **Segment comparisons** by branch, channel, product, or other dimensions
- **Margin-related metrics** to understand profitability tradeoffs
- **Detailed tables** for deep drill-down and export

## Filters
Use filters to narrow the analysis by:
- Date range
- Branch or channel
- Product type
- Entity or actor selections for targeted comparisons

## Recommended Workflow
1. Start broad with organization-level metrics
2. Narrow to specific channels or products
3. Compare outlier segments against baseline performance
4. Export detailed results for team reviews

## Workbench
Pricing widgets are available in Workbench so you can combine pricing analysis with scorecards and operational metrics on one canvas.`,
  },
  {
    id: "tt-pipeline-analysis",
    slug: "pipeline-analysis",
    title: "Pipeline Analysis Dashboard",
    category: "TopTiering Analytics",
    categorySlug: "toptiering",
    summary:
      "Analyze pipeline shape, movement, and trend snapshots over time.",
    content: `# Pipeline Analysis Dashboard

## Overview
Pipeline Analysis provides a focused view of pipeline movement and composition so teams can spot shifts early and prioritize action.

## What You Can Analyze
- Volume and status distribution across the pipeline
- Trend snapshots over time for historical comparison
- Segment-level differences by branch, channel, and product
- Movement patterns that may indicate friction or concentration risk

## How to Use It
1. Select date range and key filters
2. Review aggregate trends first
3. Drill into segments with unusual movement
4. Compare current behavior against prior periods

## Workbench Integration
Pipeline Analysis widgets can be added to Workbench canvases so you can pair pipeline views with scorecard, lock, and complexity insights in one dashboard.`,
  },
  {
    id: "tt-sales-trends",
    slug: "sales-trends",
    title: "Sales Trends",
    category: "TopTiering Analytics",
    categorySlug: "toptiering",
    summary: "Track sales performance over time.",
    content: `# Sales Trends

## What Sales Trends Shows
The Sales Trends view tracks sales team performance metrics over time, helping you identify patterns and seasonal variations.

## Key Metrics
- **Volume Trends** — Monthly/quarterly application and funding counts
- **Revenue Trends** — Revenue metrics tracked over time
- **LO Performance** — Individual loan officer trends
- **Branch Comparison** — How branches perform relative to each other over time

## Using Trends Data
- Identify seasonal patterns in origination volume
- Spot declining performance early
- Measure the impact of initiatives or market changes
- Set realistic targets based on historical data`,
  },
  {
    id: "tt-lock-stratification",
    slug: "lock-stratification",
    title: "Lock Stratification",
    category: "TopTiering Analytics",
    categorySlug: "toptiering",
    summary:
      "Segment lock performance and monitor lock behavior with dynamic filters.",
    content: `# Lock Stratification

## What It Does
Lock Stratification helps you break down lock-related performance across dimensions such as branch, channel, product, and timeframe.

## Key Use Cases
- Identify where lock behavior differs across teams
- Compare lock performance across cohorts
- Spot segments with elevated risk or weaker conversion patterns
- Build targeted follow-up actions for operations and sales leaders

## Dynamic Filtering
Use dynamic filters to isolate the combinations that matter most for your review cadence.

## Workbench
Lock Stratification widgets are available in Workbench so you can include lock analysis in recurring dashboards and exported reports.`,
  },
  {
    id: "tt-loan-complexity-dashboard",
    slug: "loan-complexity-dashboard",
    title: "Loan Complexity Dashboard",
    category: "TopTiering Analytics",
    categorySlug: "toptiering",
    summary:
      "Monitor complexity patterns and drill into high-friction segments.",
    content: `# Loan Complexity Dashboard

## Overview
The Loan Complexity dashboard helps operations and sales teams identify where files are becoming harder to process and where extra support is needed.

## What You Can See
- Complexity distribution across the active pipeline
- Segment-level complexity by branch, product, and channel
- Individual selection and filtering for targeted reviews
- Trend behavior to detect improving or worsening complexity

## Why It Matters
Loan complexity is often linked to turn times, fallout risk, and staffing load. Tracking it helps teams prioritize process improvements.

## Best Practices
1. Review complexity trends weekly
2. Compare high-complexity segments to turn-time outcomes
3. Flag repeated high-friction patterns for remediation
4. Add complexity widgets to Workbench for recurring leadership reviews`,
  },
  {
    id: "tt-fms",
    slug: "financial-modeling",
    title: "Financial Modeling Sandbox",
    category: "TopTiering Analytics",
    categorySlug: "toptiering",
    summary: "Run what-if scenarios and projections.",
    relatedTour: "financial-modeling",
    content: `# Financial Modeling Sandbox

## What Is It?
The Financial Modeling Sandbox lets you run "what-if" scenarios to project the impact of different assumptions on your business outcomes.

## Setting Parameters
Adjust scenario variables including:
- **Interest Rate Changes** — How do rate shifts affect volume?
- **Volume Projections** — What if applications increase/decrease by X%?
- **Margin Assumptions** — How do margin changes affect revenue?
- **Staffing Changes** — Impact of adding or reducing staff

## Running Scenarios
1. Set your baseline parameters
2. Adjust one or more variables
3. Click **Run** to generate projections
4. Review the results including projected revenue, volume, and profitability

## Comparing Scenarios
Create multiple scenarios and compare them side by side to evaluate different strategic options.

## Exporting
Export your scenario results for presentations and strategic planning meetings.`,
  },
  {
    id: "tt-workflow-conversion",
    slug: "workflow-conversion",
    title: "Workflow Conversion",
    category: "TopTiering Analytics",
    categorySlug: "toptiering",
    summary: "Analyze milestone-to-milestone conversion rates and turn times.",
    content: `# Workflow Conversion

## What Is It?
The Workflow Conversion dashboard measures how efficiently loans move between milestones in your pipeline. Unlike the Loan Funnel (which shows the full pipeline shape), this view lets you define specific milestone pairs and track the conversion rate or average turn time between them.

## Key Concepts
- **Segment** — A pair of milestones (e.g., Application → Submitted, Submitted → Approved). Each segment card shows how many loans reached each milestone and the conversion percentage or turn time between them.
- **Conversion %** — The percentage of loans that reached the "From" milestone and also reached the "To" milestone within the selected period.
- **Turn Time** — The average number of days between the two milestones for loans that completed both.

## Filters & Controls
- **Period** — Choose from MTD, Last Month, QTD, Last Quarter, YTD, Last Year, or a custom date range.
- **Calculation** — Switch between Conversion % and Turn Time views.
- **Grouping** — View data at the Workflow level (overall) or by Individual loan officers.
- **Segments** — Add, remove, or customize milestone pairs. Click the + / − buttons to manage segments, or use the dropdowns to change which milestones a segment spans.

## Reading the Charts
Each segment card contains a combined bar-and-line chart. Bars represent loan counts and the line shows the conversion rate or turn time over time (daily or monthly buckets depending on the date range).

## Drilling Into Loans
Click the loan count on a segment card to open a modal listing the individual loans in that segment. This is useful for investigating specific bottlenecks.

## Use Cases
- Identify which workflow steps have the lowest conversion rates
- Track process improvements by monitoring turn time trends
- Compare individual loan officer conversion rates to the team average`,
  },
  {
    id: "tt-loan-detail",
    slug: "loan-detail",
    title: "Loan Detail",
    category: "TopTiering Analytics",
    categorySlug: "toptiering",
    summary: "Browse and export a detailed table of all loans.",
    content: `# Loan Detail

## What Is It?
The Loan Detail page provides a comprehensive, sortable table of every loan in your pipeline. It displays dozens of data fields pulled directly from your LOS, making it the go-to view for looking up individual loans or exporting raw data.

## Available Columns
The table includes columns across several categories:
- **Loan Info** — Loan Number, Loan Type, Loan Program, Loan Purpose, Loan Folder, Loan Term
- **Financial** — Volume (Loan Amount), WAC (Weighted Average Coupon), FICO, LTV, Back-End DTI
- **People** — Loan Officer, Processor, Underwriter, Closer
- **Property** — Street, City, State, County, Zip
- **Dates** — Application, Credit Pull, Loan Estimate Sent/Received, Approval, Closing, Funding, and many more
- **Status** — Current Loan Status, Current Milestone, Locked Flag, Lock Expiration, Investor

## Sorting
Click any column header to sort the table by that column. Click again to reverse the sort direction. An arrow indicator shows the active sort column and direction.

## Exporting
Click **Export to Excel** to download the full dataset as a spreadsheet. This is useful for offline analysis, audits, or sharing with stakeholders who don't have platform access.

## Performance
The table uses virtualized rendering, meaning only the rows visible on screen are rendered. This keeps the page fast even with thousands of loans.

## Channel & Tenant Filtering
The table respects the global Channel and Tenant selectors in the navigation bar, so you only see loans matching your current context.`,
  },
  {
    id: "tt-high-performers",
    slug: "high-performers",
    title: "High Performers",
    category: "TopTiering Analytics",
    categorySlug: "toptiering",
    summary: "View rankings of top loan officers and teams.",
    content: `# High Performers

## What Is It?
The High Performers dashboard ranks your loan officers and teams by production metrics. It surfaces who your top producers are and how they compare across different time periods and measurement criteria.

## Rankings Tables
The page shows two tables:
- **Top Loan Officers** — Individual LO rankings with columns for Rank, Units, Volume, and product mix percentages (Government, Conventional, Refinance, Purchase).
- **Top Teams/Branches** — Aggregated rankings at the team or branch level with the same metrics.

## Filters
- **Date Type** — Choose which date to measure by: Funding Date, Closing Date, or Application Date. This changes which loans are included in the rankings.
- **Time Period** — Select from MTD (Month To Date), Last Month, YTD (Year To Date), Last Year, or Rolling 13 Months.
- **Search** — Type to filter the table by name.

## Metrics Explained
- **Rank** — Position in the leaderboard based on total units
- **Units** — Number of loans
- **Volume** — Total dollar amount of loans
- **Govt %** — Percentage of loans that are government products (FHA, VA, USDA)
- **Conv %** — Percentage of conventional loans
- **Refi %** — Percentage of refinance transactions
- **Purch %** — Percentage of purchase transactions

## Exporting
Use the export button to download rankings as an Excel file. Multiple export formats are available including full data or summary views.

## Use Cases
- Recognize and reward top-producing loan officers
- Identify production patterns (e.g., LOs who specialize in government products)
- Compare team-level output across branches
- Track individual ranking changes month over month`,
  },

  // ─── Cohi Chat ─────────────────────────────────────────────────────
  {
    id: "cc-overview",
    slug: "what-you-can-ask",
    title: "What You Can Ask Cohi",
    category: "Cohi Chat",
    categorySlug: "cohi-chat",
    summary: "Cohi Chat in one place—modes, layout, and what you can ask.",
    relatedTour: "cohi-chat",
    content: `# What You Can Ask Cohi

## One chat, same capabilities
Cohi Chat is still your AI assistant for loan data, analytics, and navigation. What changed is **where** you use it: one chat band **below the top navigation** on every page, instead of a separate panel on the right or scattered entry points.

Your past conversations, Research sessions, and Workbench chats are part of the **same history**—see Chat History, Folders, and Full History in this Help category.

## Where to find it
- Open any page (Insights, dashboards, Workbench)—the chat band appears under the top bar.
- Use **layout controls** to stay compact, go taller, fill the page, or split the screen with page content.
- **Research** opens in full-page layout when you start an investigation (same Timeline / Findings / Report workflow as the former Research Lab).

## Chat types
Pick a type before you send—the assistant routes your request the same way as the old dedicated screens:

- **Chat** — Quick metrics, definitions, navigation (same as general Cohi Chat / data questions). Default for new conversations. → [Using Chat mode](/help/cohi-chat/chat-mode)
- **Research** — Deep investigations, reports, timeline (same as Research Lab). → [Using Research](/help/cohi-chat/research-mode)
- **Insight builder** — Author custom insight prompts in conversation. → [Using Insight builder](/help/cohi-chat/insight-builder-mode)
- **Workbench** — Create widgets, canvases, SQL, exports (same as Workbench AI assistant). → [Using Cohi Chat in the Workbench](/help/cohi-chat/chat-in-workbench)

## What you can ask (Chat mode)
### Data questions
- "How many loans are in our current pipeline?"
- "What's the average loan amount for FHA loans?"
- "Which branch has the highest pull-through rate?"

### Analytical questions
- "Why did our volume drop last month?"
- "Compare Retail vs Wholesale performance"

### Help and navigation
- "How do I create a dashboard?"
- "Where can I find the Loan Funnel?"

### Reports
- "Generate a pipeline summary report"
- "Create a PowerPoint for the executive meeting"

## Tips
- Be specific with time periods and metrics.
- Switch chat type when you need Research, insight prompts, or dashboard building—no need to leave the page.`,
  },
  {
    id: "cc-chat-mode",
    slug: "chat-mode",
    title: "Using Chat Mode in Cohi Chat",
    category: "Cohi Chat",
    categorySlug: "cohi-chat",
    summary:
      "Default chat type—quick answers, charts, navigation, and exports.",
    content: `# Using Chat Mode in Cohi Chat

## Same assistant, Chat mode
**Chat** is the default type for new conversations. Use it for everyday questions about your loan data, product definitions, and where to find reports in Cohi—without starting a full Research investigation or opening Workbench.

Select **Chat** in the chat type menu on the unified band below the top navigation. You can use it on any page (Insights, dashboards, Workbench, etc.).

## What kind of response to expect
Cohi answers in **plain language**, streamed as it is generated. Depending on your question, a turn may include:

- **Text** — A direct answer, explanation, or summary (often grounded in your tenant’s loan data when the question is analytical).
- **Chart or table** — When the question calls for metrics over time or breakdowns, Cohi may attach an interactive **visualization** you can inspect in the chat thread.
- **Navigation links** — For “where do I find…?” questions, Cohi can suggest **links to dashboards and pages** in the app (for example Pipeline Analysis, Leaderboard, or Workbench).
- **Follow-up suggestions** — Short **suggested questions** appear after many turns so you can drill down without rephrasing everything.

Chat mode uses the same data and knowledge pipeline as the former global Cohi Chat / Data Chat experience. It is optimized for **fast, conversational** answers—not the multi-step Research timeline.

## What you can ask

### Data and metrics
Ask for counts, averages, rankings, and comparisons. Include **time period** and **filters** when you can (branch, LO, product, channel).

- "How many loans are in our current pipeline?"
- "What's the average loan amount for FHA loans?"
- "Top 5 loan officers by funded volume this month"
- "Compare Retail vs Wholesale pull-through last quarter"

### Analytical and diagnostic (lightweight)
You can ask *why* or *what changed* style questions; Cohi will query and summarize. For multi-step investigations with a formal report, switch to **Research** instead.

- "Why did our volume drop last month?"
- "Which branch has the highest pull-through rate?"

### Definitions and policy
- "What are the FHA requirements?"
- "What does fallout rate mean in Cohi?"

### Help and navigation
- "How do I create a dashboard?"
- "Where can I find the Loan Funnel?"
- "Open help for example queries"

### Reports and exports from chat
When a visualization is shown, you can **export** (PDF, PowerPoint) or **save to Workbench** from the artifact actions on that turn—useful for one-off charts without building a full canvas first.

## What Chat mode does not do
- **Research workspace** — No Timeline / Findings / Report tabs; no Deep analysis toggle. Use **Research** for that.
- **Insight prompt authoring** — No approve/deny preview card for My Insights. Use **Insight builder**.
- **Canvas editing** — No automatic widget placement on a Workbench canvas unless you use **Workbench** type (or save a chart from chat into Workbench).

## Tips
- Be specific: metric name, date range, branch or LO, loan type.
- Use follow-up suggestions to refine the same thread.
- Switch to **Research** when you need a structured investigation and exportable report; switch to **Workbench** when you are building or editing a dashboard.`,
  },
  {
    id: "cc-research-mode",
    slug: "research-mode",
    title: "Using Research in Cohi Chat",
    category: "Cohi Chat",
    categorySlug: "cohi-chat",
    summary:
      "Deep investigations with timeline, findings, reports, and follow-ups.",
    relatedTour: "research",
    content: `# Using Research in Cohi Chat

## What is Research?
**Research** is Cohi's AI-powered analyst for complex loan-data questions. Unlike **Chat** mode (quick answers and charts), Research runs **deep, multi-step analysis**—querying your data, reasoning through drivers, and producing structured findings you can drill into, share, and export.

Select **Research** in the chat type menu on the unified band below the top navigation (any page). Past sessions—including those started in the former standalone Research Lab—appear in **unified chat history**; resume from **History**, **Folders**, or **Full History**.

## Starting a session
1. Open Cohi Chat and choose **Research** as the chat type.
2. Optionally enable **Deep analysis** for longer investigations (checkbox appears only in Research type).
3. Type your question or pick a **topic suggestion** on the empty state.
4. Click **Investigate** (or **Get answer** in quick mode) or press Enter.
5. The shell **expands to full page** automatically. Watch the **Timeline** as agents work; review **Findings** and the **Report** as they complete.

You can attach **CSV uploads** when starting a session (same as Data Explorer / legacy Research Lab). Session lists live in the **app sidebar** (History / Full History)—not a separate SESSIONS column inside Research.

## What kind of response to expect
Each turn updates the **Research workspace**:

- **Timeline** — Steps the analyst takes (queries, reasoning, checkpoints) in real time.
- **Findings** — Evidence cards with severity, category, charts, and drill-downs.
- **Report** — Narrative summary for executives; shareable and exportable.

**Quick** vs **Deep analysis**:

| Option | Best for |
|--------|----------|
| **Quick** (default) | Focused questions; faster path to answer and report. |
| **Deep analysis** | Broader topics; more agent steps, richer timeline, longer run. |

## Good research questions
Research fits **why**, **what changed**, and **where to act**—not single KPI lookups.

- "What factors are driving loan fallout in our Wholesale channel?"
- "How has our turn time performance changed over the past 6 months?"
- "Which branches have the highest and lowest pull-through rates, and why?"
- "Identify risk patterns in our FHA loan portfolio"
- "Compare Q4 vs Q1 performance across all metrics"

### Topic suggestions
When you are not sure where to start, use the built-in starters (also in [Example Queries](/help/cohi-chat/example-queries)):

- Pipeline health and conversion performance
- LO scorecard and performance outliers
- Risk patterns (FICO, LTV, DTI)
- Turn time trends by role
- Product mix and channel analysis
- Revenue drivers and margin concentration

## Interpreting findings
Findings are organized for scanability and prioritization:

- **Severity** — Critical, High, Medium, Low, or Informational
- **Category** — Performance, Risk, Operations, Revenue, and related areas
- **Evidence** — Data and analysis supporting each finding

Click a finding card to open:

- **Summary** — What was discovered
- **Supporting data** — Charts, tables, metrics
- **Root cause analysis** — Why it is happening
- **Recommendations** — Suggested next steps
- **Affected entities** — Branches, LOs, loan types, or channels involved

### Severity guide
- **Critical** — Immediate attention (e.g., significant revenue or risk exposure)
- **High** — Address soon
- **Medium** — Worth monitoring
- **Low** — Awareness item
- **Informational** — Context and background

Use **drill-down** views where offered to inspect underlying loans or segments.

## Following up with the analyst
After the initial run completes, use **Continue the conversation** in the Research workspace. The AI retains **full session context**.

Effective follow-ups:

- "Drill deeper into finding #2 — which specific loans are involved?"
- "What would happen if we improved turn times by 5 days?"
- "Show me the month-over-month trend for the risk patterns you identified"
- "Who are the top performers and what are they doing differently?"
- "Create an action plan based on these findings"
- "Summarize the key takeaways for an executive audience"

Tips: reference **finding numbers or titles**, ask for **comparisons** across branches or LOs, and request **charts** when a table is hard to scan.

## Actions in the Research workspace
- **Share** and **Export** report outputs
- **Save to Workbench** — Push findings or visualizations to a canvas
- **New investigation** — Start a fresh topic in a new Research thread
- **Move from Insights** — Some insight cards still offer "investigate further" into Research

## What Research does not do
- **Quick metric lookups** — Use **Chat** for "how many loans…" without a full investigation.
- **My Insights prompt authoring** — Use **Insight builder**.
- **Workbench layout editing** — Use **Workbench** on a canvas (you can still save Research outputs there).

## Tips
- Lead with a **clear topic**; Deep analysis works best with a slightly broader scope.
- Keep follow-ups in the **same conversation** so history and folders stay coherent.
- For one-off charts without a formal report, **Chat** is faster; for audit-style steps and exportable narrative, use **Research**.`,
  },
  {
    id: "cc-insight-builder-mode",
    slug: "insight-builder-mode",
    title: "Using Insight Builder in Cohi Chat",
    category: "Cohi Chat",
    categorySlug: "cohi-chat",
    summary:
      "Create and approve custom My Insights prompts through conversation.",
    content: `# Using Insight Builder in Cohi Chat

## Same prompt list, Insight builder type
**Insight builder** helps you create **custom insight prompts** for **My Insights** on the Insights page—through conversation instead of filling the editor cold. Select **Insight builder** in the chat type menu, then describe what you want Cohi to watch or analyze. Context for the tab is in **[My Insights](/help/insights/my-insights)**; the Add Prompt modal, schedules, specifiers, and examples are covered in **[My Prompts](/help/insights/my-prompts)**.

Saved prompts run on the same schedule and specifier rules as prompts you create manually on \`/insights\`.

## What kind of response to expect
Insight builder turns usually fall into two phases:

### 1. Gathering
Cohi asks **clarifying questions** when something important is missing or ambiguous—for example:

- **Schedule** — Recurring **batch** (e.g. weekly digest) vs **on-demand** (run when you open it).
- **Scope** — Branch, LO, loan type, channel, or other filters.
- **Column mapping** — If a filter name does not match your loans table, Cohi suggests valid column names.

Answer in plain language in the same thread.

### 2. Preview
When enough detail is present, Cohi shows an inline **Review insight prompt draft** card with:

- **Title**
- **Prompt text** — What the insight agent should analyze each run
- **Schedule** — Batch or on-demand
- **Category tag** (optional) — Operations, Sales, Finance, Secondary marketing, Compliance
- **Specifiers** — Structured filters (branch, loan type, etc.)

You can **edit any field directly** in the preview before saving.

**Approve** — Persists the prompt to your **My Insights** list (enabled by default). The card becomes read-only and shows as saved.

**Request changes** — Sends your feedback back to Cohi to revise the draft in-thread. Nothing is saved until you Approve.

Cohi will **not** write to your prompt list without an explicit **Approve**.

## What you can ask
Describe the insight you want in natural language—branch performance, risk patterns, operational triage, etc.

- "Create a weekly batch insight for Branch 204: pull-through and cycle time vs last month"
- "Create an insight about FHA denial patterns—top reasons and LO denial rates"
- "Create an on-demand insight to triage suspended loans—aging and top suspend reasons"
- "Set up a recurring insight comparing my branch to similar-sized branches"

See [Example Queries](/help/cohi-chat/example-queries) for more starters.

After save, open **Insights → My Insights → My Prompts** to **edit, disable, or delete** the prompt like any other saved row. Modal fields and specifier behavior are spelled out under **[My Prompts](/help/insights/my-prompts)**.

## What Insight builder does not do
- **Run the insight immediately in chat** — It authors the **prompt definition**; execution happens on the Insights schedule or when you trigger on-demand insights.
- **Replace Research** — Research produces investigative reports; insight prompts feed your **daily / on-demand insight** feed.
- **Build Workbench dashboards** — Use **Workbench** for canvases and widgets.

## Tips
- State **who or what** the insight is for (branch, product, LO cohort) up front to reduce back-and-forth.
- Choose **batch** for recurring monitoring; **on-demand** for ad-hoc checks.
- Review **specifiers** in the preview—they control which loans the insight considers.
- Use **Request changes** with specific corrections ("use funding date, not lock date") rather than starting over.`,
  },
  {
    id: "cc-examples",
    slug: "example-queries",
    title: "Example Queries",
    category: "Cohi Chat",
    categorySlug: "cohi-chat",
    summary: "Starter questions for each chat type.",
    content: `# Example Queries for Cohi Chat

Examples below match the **suggested prompts** shown when you pick each chat type. Capabilities are the same as before—only the entry point is centralized.

For how each type behaves and what responses look like, see the dedicated guides: [Chat mode](/help/cohi-chat/chat-mode), [Research](/help/cohi-chat/research-mode), [Insight builder](/help/cohi-chat/insight-builder-mode), and [Workbench](/help/cohi-chat/chat-in-workbench).

## Chat (general)
- "What's important to know today?"
- "Show me loan volume by month"
- "What are the FHA requirements?"
- "Top loan officers by revenue"

## Pipeline and performance (Chat)
- "How many active loans do we have?"
- "What's our pull-through rate this quarter?"
- "Top 5 loan officers by funded volume this month"
- "Compare all branches by revenue"

## Research
- "Overall pipeline health and conversion performance"
- "LO scorecard: compute TTS scores, tier distribution, and performance outliers"
- "Risk patterns and credit exposure: FICO, LTV, DTI distribution"
- "Turn time trends and operational efficiency by role"
- "Product mix and channel analysis: loan type, purpose, and program breakdown"

Enable **Deep analysis** (Research type only) for longer investigations.

## Insight builder
- "Create a weekly batch insight for Branch 204: pull-through and cycle time vs last month"
- "Create an insight about FHA denial patterns—top reasons and LO denial rates"
- "Create an on-demand insight to triage suspended loans—aging and top suspend reasons"

Review the preview card, edit fields, then **Approve** to save to your prompt list on Insights.

## Workbench
- "Prepare a board-ready overview of this month's performance"
- "Add a bar chart of monthly funded volume"
- "Build an executive dashboard with key KPIs"
- "Generate a PowerPoint from this canvas"

When you are on a canvas, Workbench mode is **context-aware**—it knows which widgets you are editing.`,
  },
  {
    id: "cc-workbench",
    slug: "chat-in-workbench",
    title: "Using Cohi Chat in the Workbench",
    category: "Cohi Chat",
    categorySlug: "cohi-chat",
    summary: "AI-powered dashboard building in Workbench chat type.",
    content: `# Using Cohi Chat in the Workbench

## Same assistant, Workbench mode
Workbench still has AI-powered dashboard building. Select **Workbench** in the chat type menu on the unified chat band (on the Workbench page or anywhere else).

You no longer need a separate right-side chat drawer—the **same conversation** can include general questions and Workbench actions when the type is set to Workbench.

## What you can do
### Widget creation
- "Add a bar chart of monthly funded volume"
- "Create a KPI card for average loan amount"

### Widget modification
- "Change this chart to a line chart"
- "Add a filter for Conventional loans only"

### Canvas and layout
- "Create a new canvas called 'Monthly Review'"
- "Arrange the widgets in a 2x2 grid"

### SQL and reports
- "Write a SQL query to find all loans with rate > 7%"
- "Generate a PowerPoint from this canvas"

## Context-aware behavior
On a Workbench canvas, Cohi receives your **canvas and widget context** automatically—the same as the former Workbench AI panel.

## My Dashboards
Pin canvases from the sidebar **My Dashboards** section (with pinned TopTiering dashboards). Pins sync across devices with no per-user cap.`,
  },
  {
    id: "cc-data-chat",
    slug: "data-chat-page",
    title: "Chat History, Folders, and Full History",
    category: "Cohi Chat",
    categorySlug: "cohi-chat",
    summary:
      "Find, organize, and resume every Cohi conversation in one place.",
    content: `# Chat History, Folders, and Full History

## One timeline for everything
General chat, **Research** sessions, **Insight builder** threads, and **Workbench** conversations all appear in the **same history**. Legacy Research Lab sessions were merged in—you will not lose past work.

## Sidebar: History
The **History** section lists your most recent chats. Click a row to resume on the page where you left off. Each row shows a **chat type** label (Chat, Research, Insight builder, Workbench).

## Sidebar: Folders
Use **Folders** to organize conversations:
- Create folders and nest up to **five** levels
- **Drag** a chat from **History** onto a folder, or use the **Move to folder** button on a conversation row (in History or Full History) and choose a folder from the menu
- Rename or delete folders—deleting moves chats to the parent folder or **unsorted**
- Folders are private to you (no sharing in v1)

A chat can live in **at most one folder** at a time.

## Full History page
Open **Full History** from the sidebar to:
- **Search** across all conversations
- **Filter by chat type**
- Browse with **pagination** when you have more than 50 results

Route: /chat/history

## Standalone Data Chat page
If you bookmarked the old Data Chat or /cohi-chat route, you land on the same **unified chat** experience. Use **Chat** type for focused analysis threads; use folders and Full History to pick up later.

## Tips
- Start broad, then narrow with follow-ups in the same thread
- Move important Research or Workbench outputs into dashboards or reports when you are ready to share`,
  },

  // ─── Settings ──────────────────────────────────────────────────────
  {
    id: "set-password",
    slug: "changing-password",
    title: "Changing Your Password",
    category: "Settings",
    categorySlug: "settings",
    summary: "Update your login credentials.",
    content: `# Changing Your Password

## Steps
1. Click your **user avatar** in the top-right corner
2. Select **Settings**
3. In the **Account** tab, find the **Change Password** section
4. Enter your **current password**
5. Enter and confirm your **new password**
6. Click **Update Password**

## Password Requirements
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one special character

## Forgot Your Password?
If you can't log in, use the **Forgot Password** link on the login page to receive a reset email.`,
  },
  {
    id: "set-mfa",
    slug: "setting-up-mfa",
    title: "Setting Up MFA",
    category: "Settings",
    categorySlug: "settings",
    summary: "Add multi-factor authentication for security.",
    content: `# Setting Up Multi-Factor Authentication (MFA)

## Why Use MFA?
MFA adds a second layer of security beyond your password. Even if your password is compromised, attackers can't access your account without the second factor.

## Setting Up
1. Go to **Settings > Account**
2. Click **Enable MFA**
3. Scan the QR code with your authenticator app (Google Authenticator, Authy, 1Password, etc.)
4. Enter the 6-digit verification code from your app
5. Save your **backup codes** in a secure location

## Logging In with MFA
After entering your password, you'll be prompted for a 6-digit code from your authenticator app.

## MFA Enforcement
Your organization's admin may enforce MFA for all users. When MFA is enforced:
- All users are required to set up MFA on their next login
- You cannot disable MFA while enforcement is active
- This ensures consistent security across the entire organization

## Disabling MFA
If MFA is not enforced by your admin, you can disable it from Settings — but we recommend keeping it enabled for security.`,
  },
  {
    id: "set-preferences",
    slug: "preferences",
    title: "Theme Preferences",
    category: "Settings",
    categorySlug: "settings",
    summary: "Customize your theme and display settings.",
    content: `# Theme Preferences

## Theme
Choose your preferred visual theme:
- **Light** — White backgrounds with dark text
- **Dark** — Dark backgrounds with light text (easier on the eyes)
- **System** — Automatically follows your operating system preference

You can change the theme in two ways:
1. Go to **Settings > Appearance** and select your theme
2. Use the **sun/moon icon** in the top navigation bar to toggle between light and dark mode
3. Open the **user menu** (top-right) and use the **Theme** submenu to pick Light, Dark, or System`,
  },

  // ─── Admin ─────────────────────────────────────────────────────────
  {
    id: "adm-overview",
    slug: "admin-overview",
    title: "Admin Overview",
    category: "Admin",
    categorySlug: "admin",
    summary: "Tour of all admin sections: users, data, revenue, and more.",
    adminOnly: true,
    relatedTour: "admin",
    content: `# Admin Overview

The Admin panel is where you manage your organization's users, data connections, revenue formulas, scorecard weights, and AI settings.

## Main Sections (Tenant Admin)

- **Organization Settings** — Profile, display name, branding
- **Users** — Add users, assign roles, manage access
- **Access & Permissions** — Custom roles, section access, field and row-level restrictions
- **SSO Configuration** — Single Sign-On with your IdP
- **Connections & Integrations** — LOS (e.g. Encompass) connection and sync
- **Loan Folders** — Choose which Encompass loan folders to sync
- **Field Mapping** — Map LOS fields to Cohi (default + additional fields)
- **Revenue** — Revenue and margin formulas for scorecards
- **Scoring & Weights** — Sales/Operations weights, loan complexity, unit targets
- **Data Quality** — Monitor completeness and fix mapping/sync issues
- **Knowledge Center** — Documents for Cohi Chat (RAG)
- **AI Assistant** — Voice and rules for Cohi Chat
- **Import / Export** — Legacy import, config backup/restore (platform admin)

Use the **Start Tour** button below to walk through each section in the Admin sidebar. For step-by-step help on a topic, use the other articles in this Admin category.`,
  },
  {
    id: "adm-users",
    slug: "managing-users",
    title: "Managing Users and Roles",
    category: "Admin",
    categorySlug: "admin",
    summary: "Add users, assign roles, control access.",
    adminOnly: true,
    relatedTour: "admin",
    content: `# Managing Users and Roles

## Adding Users
1. Go to **Admin** from the user menu
2. Navigate to the **Users** section
3. Click **Add User**
4. Enter email, name, and select a role
5. The user will receive an invitation email

## Access Profiles
Users are managed with a single access profile:
- **Tenant admin** — Full app access plus tenant administration
- **Full user** — Full app access without tenant admin actions
- **Canvas-only user** — Can open shared canvases only

## Loan Visibility
Loan visibility is configured only for **Full user** profiles:
- **Encompass scope** — Loans visible in Encompass
- **Manual scope** — Admin-curated loan access
- **All loans** — Full tenant loan visibility
- **No loan access** — No direct loan-level visibility

Canvas-only users always use **No loan access**.

## Managing Access
- **Deactivate** users who leave the organization
- **Change roles** as responsibilities evolve
- **Monitor login activity** to ensure security

## Managing Auto-Invited Users
- Filter users by access profile to review canvas-only recipients
- Move them into groups if needed for access governance
- Deactivate accounts that should no longer receive shared canvases

See also: **Distribution Administration**`,
  },
  {
    id: "adm-distributions",
    slug: "distribution-administration",
    title: "Distribution Administration",
    category: "Admin",
    categorySlug: "admin",
    summary: "Admin responsibilities for distribution schedules, recipients, and failures.",
    adminOnly: true,
    content: `# Distribution Administration

## Who Can Manage Distributions
Distribution setup is intended for tenant and platform admins.

## Operational Checklist
- Keep recipient lists current
- Prefer recipient lists for recurring schedules
- Use direct emails for temporary recipients only
- Validate run history after major list/schedule changes

## Monitoring Send History
For each run, review:
- Delivery status
- Successful vs failed recipients
- Invite status (invited vs invite failed)
- Duration and recurring failure patterns

## Managing Auto-Invited Recipients
Auto-invited users are created with restricted canvas-only access. Admins should:
- Confirm users are assigned to the correct groups
- Deactivate users when external access is no longer needed
- Audit access periodically for least-privilege compliance

## Troubleshooting Failures
- Check recipient validity and duplicates
- Confirm email provider health and permissions
- Re-run using **Send now** after resolving issues
- Document recurring issues for platform support`,
  },
  {
    id: "adm-los",
    slug: "connecting-los",
    title: "Configuring LOS Connections",
    category: "Admin",
    categorySlug: "admin",
    summary:
      "Set up your Loan Origination System in Connections & Integrations.",
    adminOnly: true,
    content: `# Configuring LOS Connections

LOS connections are managed under **Admin > Connections & Integrations**. See also the **Connections & Integrations** and **Field Mapping** help articles for full details.

## Supported Systems
Cohi integrates with:
- **Encompass** — Full API integration with sync, field mapping, and optional webhooks
- **Other LOS** — Via Universal Connector (CSV/SFTP import)

## Setting Up Encompass
1. Go to **Admin > Connections & Integrations**
2. Click **Add Connection** (or Add Encompass Connection)
3. Enter your Encompass credentials (Client ID, Client Secret, Instance ID)
4. Configure sync frequency (e.g. every 15 minutes)
5. Save and run an initial sync
6. Go to **Admin > Loan Folders** to select which Encompass folders to sync

## Field Mapping
After the connection is created, configure which Encompass fields map to Cohi in **Admin > Field Mapping**. Cohi maps most standard fields automatically; use Field Discovery there for custom fields.

## Loan Folders
Folder selection has moved to a dedicated section. Go to **Admin > Loan Folders** to choose which Encompass loan folders Cohi pulls data from.

## Monitoring Sync
In **Connections & Integrations**, view last sync timestamp, loan counts, and any errors. Fix sync or mapping issues there or in **Data Quality**.`,
  },
  {
    id: "adm-knowledge",
    slug: "knowledge-base",
    title: "Knowledge Base Management",
    category: "Admin",
    categorySlug: "admin",
    summary: "Enhance Cohi Chat with your organization's documents.",
    adminOnly: true,
    content: `# Knowledge Base Management

## What Is It?
The Knowledge Base stores documents that Cohi Chat uses to provide organization-specific answers. This is powered by RAG (Retrieval-Augmented Generation).

## Adding Documents
1. Go to **Admin > Knowledge Base** (or navigate to /admin/knowledge-base)
2. Click **Upload Document**
3. Supported formats: PDF, DOCX, TXT, MD
4. Documents are automatically processed and indexed

## Use Cases
Upload documents like:
- Company policies and procedures
- Product guidelines and pricing sheets
- Compliance requirements
- Training materials
- Process documentation

## How It Works
When a user asks Cohi Chat a question, the AI:
1. Searches the knowledge base for relevant content
2. Combines it with loan data context
3. Generates an answer that incorporates your organization's specific information

## Managing Documents
- View all uploaded documents and their indexing status
- Delete outdated documents
- Re-index documents after updates`,
  },
  {
    id: "adm-sso",
    slug: "sso-configuration",
    title: "SSO Configuration",
    category: "Admin",
    categorySlug: "admin",
    summary: "Set up Single Sign-On for your organization.",
    adminOnly: true,
    content: `# SSO Configuration

## Overview
SSO (Single Sign-On) allows your users to log in to Cohi using your organization's identity provider (IdP).

## Supported Protocols
- **SAML 2.0** — Works with Okta, Azure AD, OneLogin, etc.
- **OIDC** — OpenID Connect for modern identity providers
- **AWS Cognito** — Direct Cognito integration

## Setup Steps
1. Go to **Admin > SSO Settings**
2. Select your identity provider type
3. Enter the configuration details provided by your IdP
4. Test the connection
5. Enable SSO for your organization

## User Provisioning
When SSO is enabled:
- New users are automatically created on first login
- User attributes (name, email) are synced from the IdP
- Roles can be mapped from IdP groups

## Security Notes
- SSO users cannot change their password in Cohi (managed by IdP)
- MFA is typically handled by the IdP
- SSO sessions follow your IdP's session timeout policies`,
  },
  {
    id: "adm-data-quality",
    slug: "data-quality",
    title: "Data Quality",
    category: "Admin",
    categorySlug: "admin",
    summary: "Monitor and resolve data completeness and mapping issues.",
    adminOnly: true,
    content: `# Data Quality

The **Data Quality** section in Admin (under Data) helps you monitor and resolve issues that affect your loan data and metrics.

## What the Data Quality Section Shows
- **Data completeness** — How complete your synced data is across key fields
- **Field population rates** — Percentage of loans with each field populated
- **Issues and alerts** — Missing or inconsistent data that may affect scorecards and reports

## Common Issues
- **Missing fields** — Important fields not synced from the LOS (fix in **Field Mapping** and **Connections & Integrations**)
- **Incorrect mappings** — Fields mapped to wrong Cohi columns (fix in **Field Mapping**)
- **Stale data** — Sync not running or failing (check **Connections & Integrations**)

## Fixing Issues
1. Use the Data Quality dashboard to identify low population or problem areas
2. For mapping problems, go to **Admin > Field Mapping** to adjust Encompass field mappings
3. For sync problems, go to **Admin > Connections & Integrations** to check sync status and errors
4. Revenue metrics depend on correct mapping of Gain on Sale, SRP, fees, and concessions — verify those in Field Mapping and Revenue if numbers look wrong`,
  },
  {
    id: "adm-org",
    slug: "organization-settings",
    title: "Organization Settings",
    category: "Admin",
    categorySlug: "admin",
    summary: "Organization profile, display name, and branding.",
    adminOnly: true,
    content: `# Organization Settings

## Overview
The **Organization Settings** section in Admin lets you manage your tenant's profile and how your organization appears across Cohi.

## What You Can Configure
- **Organization name** — Display name used in the app and in reports
- **Branding** — Logo and visual identity (where supported)
- **Profile details** — Contact and company information used for support and reporting

## Where to Find It
Go to **Admin** from the user menu, then select **Organization Settings** in the sidebar under the Organization category.

## Who Can Edit
Only users with admin or tenant admin access can change organization settings. Changes apply to the entire organization.`,
  },
  {
    id: "adm-connections",
    slug: "connections",
    title: "Connections & Integrations",
    category: "Admin",
    categorySlug: "admin",
    summary: "LOS setup, sync schedules, and vendor integrations.",
    adminOnly: true,
    content: `# Connections & Integrations

## Overview
The **Connections & Integrations** section is where you add and manage your Loan Origination System (LOS) connection and other data sources.

## Supported LOS
- **Encompass** — Full API integration with field mapping, sync schedules, and optional webhooks
- **Other LOS** — Via Universal Connector (CSV/SFTP) for bulk import

## Setting Up an Encompass Connection
1. Go to **Admin > Connections & Integrations**
2. Click **Add Connection** (or **Add Encompass Connection**)
3. Enter your Encompass API credentials (Client ID, Client Secret, Instance ID)
4. Configure sync frequency (e.g. every 15 minutes)
5. Save and run an initial sync
6. After connecting, go to **Admin > Loan Folders** to choose which folders to sync

## After Connection
- **Loan Folders** — Select which Encompass loan folders to sync (see **Admin > Loan Folders**)
- **Field Mapping** — Configure which Encompass fields map to Cohi (see Field Mapping section)
- **Sync status** — View last sync time, loan counts, and any errors
- **Multiple connections** — Some tenants use more than one Encompass instance; you can add multiple connections

## Monitoring
Check sync status and history regularly. Failed syncs or rate limits will appear in the connection details.`,
  },
  {
    id: "adm-loan-folders",
    slug: "loan-folders",
    title: "Loan Folders",
    category: "Admin",
    categorySlug: "admin",
    summary:
      "Select which Encompass loan folders to sync into Cohi.",
    adminOnly: true,
    content: `# Loan Folders

## Overview
The **Loan Folders** section lets you choose which Encompass loan folders Cohi syncs data from. Only loans in selected folders will appear in your dashboards, scorecards, and reports.

## Prerequisites
You must have at least one Encompass connection configured in **Admin > Connections & Integrations** before you can manage folders.

## Selecting Folders
1. Go to **Admin > Loan Folders**
2. Each Encompass connection is shown as a card with its name, instance ID, and status
3. Available folders are fetched directly from your Encompass instance
4. Check the boxes next to the folders you want to sync
5. Click **Save Folders** to apply your selection

## Refreshing the Folder List
If new folders have been created in Encompass, click **Refresh Folders** on the relevant connection card. This re-fetches the full folder list from Encompass in real time.

## Common Issues
- **"No folders available"** — The Encompass API credentials may have expired or the connection may be offline. Check the warning or error message displayed on the card and verify the connection in **Connections & Integrations**.
- **Authentication errors (401)** — The API user's credentials need to be refreshed or the user may not have permission to list folders in Encompass.
- **Folders appear empty after saving** — After changing folder selections, a sync must run before new loans appear. Syncs run on the configured schedule (typically every 15 minutes) or can be triggered manually.

## Who Can Use It
Loan Folders management is available to **tenant admins**, **platform admins**, and **super admins**.`,
  },
  {
    id: "adm-revenue",
    slug: "revenue-configuration",
    title: "Revenue Configuration",
    category: "Admin",
    categorySlug: "admin",
    summary: "Revenue and margin formulas, component weights.",
    adminOnly: true,
    content: `# Revenue Configuration

## Overview
The **Revenue** section in Admin defines how Cohi calculates revenue and margin for scorecards, reports, and Financial Modeling.

## What You Configure
- **Revenue formula** — Which LOS fields contribute to total revenue (e.g. Gain on Sale, SRP, origination fees, concessions)
- **Component weights** — How much each component counts toward the total (e.g. 50% GoS, 50% SRP)
- **Margin and unit metrics** — How margin and revenue-per-unit are derived

## Prerequisites
Revenue fields must be correctly mapped in **Field Mapping** (Admin > Field Mapping). If revenue numbers look wrong, verify those mappings first, then adjust the formula here.

## Where It's Used
- Sales Scorecard and Sales Trends
- Financial Modeling sandbox
- Workbench widgets and reports that use revenue metrics
- Leaderboards and pipeline value

## Saving Changes
After you save the revenue formula, existing scorecards and reports will use the new definition. No need to re-sync loan data.`,
  },
  {
    id: "adm-scoring",
    slug: "scoring-weights",
    title: "Scoring & Weights",
    category: "Admin",
    categorySlug: "admin",
    summary: "Scorecard weights, loan complexity, unit targets.",
    adminOnly: true,
    content: `# Scoring & Weights

## Overview
The **Scoring & Weights** section configures how Cohi computes Sales and Operations scorecards, loan complexity, and monthly unit targets.

## Sales Weights
Set the weight of each metric in the Sales Scorecard, for example:
- Volume, margin, unit count, pull-through, turn time, concession
- Weights are percentages that sum to 100

## Operations Weights
Set the weight of each metric in the Operations Scorecard, for example:
- Units, turn time, complexity
- Adjust to reflect what matters most for your operations

## Loan Complexity
Configure how loan complexity is calculated for the Operations Scorecard:
- **Categories** — Loan type, purpose, product (e.g. FHA, Conventional, Refinance)
- **Ranges** — Loan amount, FICO, DTI, LTV with min/max bands
- **Weights** — How much each component contributes to the complexity score

You can add or remove conditions and set weights per category or range. This affects the complexity component of the Operations Scorecard.

## Unit Targets
Set monthly unit targets by role (Processor, Underwriter, Closer, Other). These are used by:
- Financial Modeling (capacity and staffing scenarios)
- Operations Scorecard (performance vs target)

## Saving
Save each tab (Sales Weights, Operations Weights, Complexity, Unit Targets) as needed. Changes apply to the current tenant.`,
  },
  {
    id: "adm-ai-assistant",
    slug: "ai-assistant",
    title: "AI Assistant Configuration",
    category: "Admin",
    categorySlug: "admin",
    summary: "Voice settings, RAG topics, and rules for Cohi Chat.",
    adminOnly: true,
    content: `# AI Assistant Configuration

## Overview
The **AI Assistant** (RAG & Voice) section configures how Cohi Chat behaves for your organization — including voice settings, topics, and rules.

## What You Can Configure
- **Voice settings** — If voice input/output is enabled for your tenant
- **Topics** — Curated topics or data areas the AI can focus on
- **Rules and guardrails** — Instructions or constraints that apply to AI responses (e.g. compliance wording, disclaimers)

## Knowledge Base
The documents that feed Cohi Chat are managed in **Knowledge Center** (Admin > Knowledge Center). Upload PDFs, DOCX, or text files there; the AI Assistant settings control how that knowledge is used in conversation.

## Who Can Access
Typically only platform admins and tenant admins can change AI Assistant settings. Check your role if you don't see this section.`,
  },
  {
    id: "adm-transfer",
    slug: "import-export",
    title: "Import / Export",
    category: "Admin",
    categorySlug: "admin",
    summary: "Legacy config import and tenant config export/import.",
    adminOnly: true,
    content: `# Import / Export

## Overview
The **Import / Export** section (under Admin > Data) is used for legacy configuration import and for exporting or importing tenant configuration between environments.

## Typical Uses
- **Legacy import** — Migrate configuration from an older or external system into Cohi
- **Export** — Download the current tenant's configuration (e.g. field mappings, revenue formula, scoring weights) for backup or audit
- **Import** — Apply a previously exported configuration to this tenant (e.g. after cloning a tenant or moving from staging to production)

## Who Can Use It
Import/Export is usually restricted to **platform admins** (e.g. super_admin, platform_admin). Tenant admins may only see this section if their role allows it.

## Caution
Importing configuration will overwrite existing settings for the areas included in the import. Export a backup first if you are unsure.`,
  },

  // ─── FAQ ───────────────────────────────────────────────────────────
  {
    id: "faq-data-delay",
    slug: "data-delay",
    title: "Why is my data not up to date?",
    category: "FAQ",
    categorySlug: "faq",
    summary: "Data syncs every 15 minutes from your LOS.",
    content: `# Why is my data not up to date?

Cohi syncs data from your LOS on a schedule (typically every 15 minutes). There are a few reasons data might appear delayed:

## Sync Schedule
- Data refreshes every **15 minutes** by default
- The sync processes all changed loans since the last sync
- Large pipelines may take a few minutes to process

## Possible Issues
- **Sync paused or failing** — Check Admin > LOS Connections for status
- **API rate limits** — Your LOS may throttle API requests during peak hours
- **Field not mapped** — The data exists in your LOS but the field isn't mapped in Cohi

## What to Do
1. Check the last sync timestamp in the Admin panel
2. If sync is failing, review error logs
3. Contact your admin if you don't have access to sync settings
4. A manual sync can be triggered from Admin > LOS Connections`,
  },
  {
    id: "faq-missing-loans",
    slug: "missing-loans",
    title: "Why can't I see certain loans?",
    category: "FAQ",
    categorySlug: "faq",
    summary: "Access controls and filters may be limiting your view.",
    content: `# Why can't I see certain loans?

## Possible Reasons

### Role-Based Access
Your role may restrict which loans you can see:
- **Loan Officers** — Only see loans assigned to them
- **Processors** — Only see files assigned to them
- **Branch-Filtered Roles** — Only see loans from their branch

### Active Filters
Check if you have filters applied:
- Look for active filter indicators on the page
- Click **Clear** to reset your filters

### Channel Selection
The channel selector in the top nav filters all data. Make sure it's set to "All Channels" if you want to see everything.

### Archived Loans
Very old or archived loans may not appear in the default view.

## Need Access?
Contact your administrator to:
- Adjust your role permissions
- Add you to the appropriate branch access group
- Grant access to specific loan folders`,
  },
  {
    id: "faq-metric-calculation",
    slug: "metric-calculations",
    title: "How are metrics calculated?",
    category: "FAQ",
    categorySlug: "faq",
    summary: "Understanding how Cohi computes key metrics.",
    content: `# How Are Metrics Calculated?

## Pull-Through Rate
**Formula:** (Funded Loans ÷ Total Applications) × 100
Measures what percentage of applications ultimately get funded.

## Cycle Time
**Formula:** Funding Date − Application Date (in calendar days)
Measures the total time from application to funding.

## Turn Time
Time between specific milestones:
- **Submission to Underwriting** — Days from submitted to first UW decision
- **UW to Conditions** — Days from approval to conditions cleared
- **CTC to Closing** — Days from Clear to Close to closing date

## Revenue
Revenue calculations depend on your configured revenue fields:
- **Gain on Sale** — Revenue from selling the loan above par
- **SRP** — Service Release Premium from servicing rights
- **Origination Fees** — Direct fees from origination
- **Net Revenue** — Total revenue minus costs/concessions

## Fallout Rate
**Formula:** (Denied + Withdrawn Loans) ÷ Total Applications × 100
Percentage of loans that don't complete the process.

Contact your admin if metrics don't match your expectations — field mapping may need adjustment.`,
  },

  // ─── Glossary ──────────────────────────────────────────────────────
  {
    id: "gl-terms",
    slug: "mortgage-terms",
    title: "Mortgage Industry Terms",
    category: "Glossary",
    categorySlug: "glossary",
    summary: "Common mortgage terms used in Cohi.",
    content: `# Mortgage Industry Terms

## Loan Types
- **Conventional** — Loans not insured by the federal government
- **FHA** — Federal Housing Administration insured loans
- **VA** — Department of Veterans Affairs guaranteed loans
- **USDA** — United States Department of Agriculture rural housing loans
- **Jumbo** — Loans exceeding conforming loan limits

## Key Metrics
- **LTV (Loan-to-Value)** — Loan amount divided by property value
- **CLTV (Combined LTV)** — Total of all liens divided by property value
- **DTI (Debt-to-Income)** — Monthly debt payments divided by gross monthly income
- **FICO Score** — Credit score from Fair Isaac Corporation (300-850)
- **APR (Annual Percentage Rate)** — Annualized cost of borrowing including fees

## Pipeline Terms
- **Pull-Through Rate** — Percentage of applications that reach funding
- **Fallout** — Loans that don't complete (denied, withdrawn, suspended)
- **Lock** — Rate lock commitment from lender to borrower
- **Clear to Close (CTC)** — All conditions met, ready for closing docs
- **Funding** — Disbursement of loan proceeds

## Revenue Terms
- **Gain on Sale (GoS)** — Profit from selling a loan above its production cost
- **SRP (Service Release Premium)** — Payment for releasing servicing rights
- **Par Pricing** — Base price for a loan without points or rebates
- **Basis Point (bps)** — 1/100th of one percent (0.01%)
- **Margin** — Difference between loan rate and funding cost

## Origination Process
- **Application (1003)** — The mortgage application form
- **Processing** — Gathering and verifying documentation
- **Underwriting** — Evaluating the loan for approval
- **Conditions** — Requirements that must be met before approval/closing
- **Closing** — The formal signing of loan documents
- **Funding** — The disbursement of loan funds`,
  },
  {
    id: "gl-metrics",
    slug: "metric-definitions",
    title: "Metric Definitions",
    category: "Glossary",
    categorySlug: "glossary",
    summary: "How key metrics in Cohi are defined.",
    content: `# Metric Definitions in Cohi

## Volume Metrics
- **Applications** — Count of new loan applications received
- **Submissions** — Count of loans submitted to underwriting
- **Approvals** — Count of loans receiving approval
- **Closings** — Count of loans that have closed
- **Fundings** — Count of loans that have funded
- **Funded Volume ($)** — Total dollar amount of funded loans

## Performance Metrics
- **Pull-Through Rate (%)** — Fundings ÷ Applications × 100
- **Fallout Rate (%)** — (Denied + Withdrawn) ÷ Applications × 100
- **Cycle Time (days)** — Average calendar days from Application to Funding
- **Turn Time (days)** — Average business days between specific milestones

## Revenue Metrics
- **Total Revenue ($)** — Sum of all revenue components (GoS + SRP + Fees)
- **Revenue per Loan ($)** — Total Revenue ÷ Number of Funded Loans
- **Revenue per LO ($)** — Total Revenue ÷ Number of Active Loan Officers
- **Basis Points (bps)** — Revenue as a percentage of funded volume

## Operational Metrics
- **Loans per LO** — Average number of active loans per loan officer
- **Resubmission Rate (%)** — Percentage of files requiring re-underwriting
- **Condition Count** — Average number of conditions per loan
- **Touch Count** — Average number of processing touches per file

## Risk Metrics
- **Average FICO** — Mean credit score across the pipeline
- **Average LTV (%)** — Mean loan-to-value ratio
- **Average DTI (%)** — Mean debt-to-income ratio
- **Concentration Risk** — Percentage of volume in any single product/channel`,
  },
];

export function getArticlesByCategory(categorySlug: string): HelpArticle[] {
  return helpArticles.filter((a) => a.categorySlug === categorySlug);
}

export function getArticleBySlug(
  categorySlug: string,
  articleSlug: string,
): HelpArticle | undefined {
  return helpArticles.find(
    (a) => a.categorySlug === categorySlug && a.slug === articleSlug,
  );
}

export function searchArticles(query: string): HelpArticle[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return helpArticles.filter(
    (a) =>
      a.title.toLowerCase().includes(q) ||
      a.summary.toLowerCase().includes(q) ||
      a.content.toLowerCase().includes(q) ||
      a.category.toLowerCase().includes(q),
  );
}
