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
    slug: "research-lab",
    label: "Research Lab",
    icon: "FlaskConical",
    description: "AI-powered data investigation",
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
    description: "AI assistant and natural language queries",
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

## 2. Review Your Daily Briefings
The AI-generated Daily Briefings appear at the top of the Insights page. They summarize key changes in your loan pipeline, highlight risks, and surface opportunities.

## 3. Check the Business Overview
Scroll down to the Business Overview section for a snapshot of your organization's KPIs: active loans, revenue metrics, pull-through rates, and cycle times.

## 4. Explore the Navigation
Use the top navigation bar to access:
- **Insights** — Your home dashboard with AI briefings and KPIs
- **Dashboard** — TopTiering analytics (funnels, scorecards, comparisons)
- **My Workbench** — Build custom dashboards with drag-and-drop widgets
- **Research Lab** — Ask deep analytical questions to the AI

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

## Cohi Daily Briefings
AI-generated executive insights that highlight significant changes, risks, and opportunities in your loan pipeline. Each insight can be tracked to your watchlist for monitoring.

## Mortgage News
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

- **Insights** (dropdown) — Jump to Daily Briefings or Mortgage News
- **Dashboard** (dropdown) — Access TopTiering analytics including Scorecards, Credit Risk, Financial Modeling, and more
- **My Workbench** — Your custom dashboard builder
- **Research Lab** — AI-powered data investigation tool

## Right Side Controls
- **Tenant Selector** — Switch between tenants (platform admins only)
- **Channel Selector** — Filter data by channel (Retail, Wholesale, etc.)
- **Help** — Opens the Help Center (question mark icon)
- **What's New** — View recent platform updates (bell icon)
- **Theme Toggle** — Switch between light and dark mode (sun/moon icon)
- **User Menu** — Access Home, Settings, Admin panel, and logout

## Reports Sidebar
On the Insights page, a collapsible sidebar on the left provides quick navigation between dashboard sections.

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
    title: "Reading Your Daily Briefings",
    category: "Insights",
    categorySlug: "insights",
    summary: "How AI-generated insights work and how to use them.",
    content: `# Reading Your Daily Briefings

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
Click the bookmark icon on any insight to add it to your watchlist. Tracked insights are monitored over time, and you'll see updates if the underlying situation changes.

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

## Adding to Watchlist
Click the **bookmark icon** on any insight card to track it. Tracked insights appear in your watchlist section where you can monitor how they evolve over time.

## Why Track Insights?
Tracking is useful for:
- Monitoring a concerning trend (e.g., declining pull-through in a branch)
- Following up on an opportunity (e.g., a growing product segment)
- Keeping executives informed about key metrics

## Managing Your Watchlist
- View all tracked insights from the watchlist panel
- Remove items by clicking the bookmark icon again
- Insights update automatically as new data arrives`,
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

  // ─── Research Lab ──────────────────────────────────────────────────
  {
    id: "rl-starting",
    slug: "starting-research",
    title: "Starting a Research Session",
    category: "Research Lab",
    categorySlug: "research-lab",
    summary: "How to use the AI research analyst.",
    relatedTour: "research",
    content: `# Starting a Research Session

## What is the Research Lab?
The Research Lab is an AI-powered analyst that investigates your loan data to answer complex questions. Unlike quick chat responses, the Research Lab performs deep, multi-step analysis.

## Starting a Session
1. Navigate to **Research Lab** from the top navigation
2. Type your research question in the input box
3. Click **Investigate** or press Enter
4. Watch the AI work through its investigation in real-time

## Good Research Questions
- "What factors are driving loan fallout in our Wholesale channel?"
- "How has our turn time performance changed over the past 6 months?"
- "Which branches have the highest and lowest pull-through rates, and why?"
- "Identify risk patterns in our FHA loan portfolio"
- "Compare Q4 vs Q1 performance across all metrics"

## Topic Suggestions
If you're not sure what to ask, click on one of the pre-built topic suggestions:
- Pipeline health analysis
- Personnel performance deep dive
- Risk pattern identification
- Turn time trends
- Product mix analysis
- Revenue driver investigation`,
  },
  {
    id: "rl-findings",
    slug: "interpreting-findings",
    title: "Interpreting Research Findings",
    category: "Research Lab",
    categorySlug: "research-lab",
    summary: "Understanding what the AI discovered.",
    content: `# Interpreting Research Findings

## Finding Structure
Each research session produces findings organized by:

- **Severity** — How significant the finding is (Critical, High, Medium, Low, Informational)
- **Category** — What area it relates to (Performance, Risk, Operations, Revenue, etc.)
- **Evidence** — The data and analysis supporting the finding

## Reading a Finding
Click on any finding card to see:
- **Summary** — A concise description of what was found
- **Supporting Data** — Charts, tables, and metrics
- **Root Cause Analysis** — Why this is happening
- **Recommendations** — Suggested actions to take
- **Affected Entities** — Which branches, LOs, or loan types are involved

## Severity Levels
- **Critical** — Immediate attention required (e.g., significant revenue loss)
- **High** — Important issue that should be addressed soon
- **Medium** — Notable finding worth monitoring
- **Low** — Minor observation for awareness
- **Informational** — Context and background data

## Following Up
Use the chat below the findings to ask follow-up questions about any discovery. The AI retains context from the full research session.`,
  },
  {
    id: "rl-followup",
    slug: "research-followup",
    title: "Following Up with the AI Analyst",
    category: "Research Lab",
    categorySlug: "research-lab",
    summary: "Continue the conversation after initial research.",
    content: `# Following Up with the AI Analyst

## Continuing the Conversation
After the initial research completes, you can ask follow-up questions in the chat. The AI remembers the full context of the session.

## Effective Follow-Ups
- "Drill deeper into finding #2 — which specific loans are involved?"
- "What would happen if we improved turn times by 5 days?"
- "Show me the month-over-month trend for the risk patterns you identified"
- "Who are the top performers and what are they doing differently?"
- "Create an action plan based on these findings"

## Tips
- Reference specific findings for targeted answers
- Ask for comparisons: "How does branch A compare to branch B on this metric?"
- Request visualizations: "Show this as a chart"
- Ask for summaries: "Summarize the key takeaways for an executive audience"`,
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
    summary: "Understand the AI assistant capabilities.",
    content: `# What You Can Ask Cohi

## Overview
Cohi Chat is an AI assistant available on every page. It understands your loan data schema and can answer questions, generate reports, and help you navigate the platform.

## Data Questions
- "How many loans are in our current pipeline?"
- "What's the average loan amount for FHA loans?"
- "Which branch has the highest pull-through rate?"
- "Show me all loans closing this week"

## Analytical Questions
- "Why did our volume drop last month?"
- "Compare Retail vs Wholesale performance"
- "What's trending in our turn times?"

## Help & Navigation
- "How do I create a dashboard?"
- "Where can I find the Loan Funnel?"
- "What does pull-through rate mean?"

## Report Generation
- "Generate a pipeline summary report"
- "Create a PowerPoint for the executive meeting"

## Tips
- Be specific with time periods: "last 30 days", "Q4 2025", "this month"
- Mention the metric: "funded volume" vs just "volume"
- Specify filters: "for Retail channel" or "in the West region"`,
  },
  {
    id: "cc-examples",
    slug: "example-queries",
    title: "Example Queries",
    category: "Cohi Chat",
    categorySlug: "cohi-chat",
    summary: "Sample questions to try with Cohi Chat.",
    content: `# Example Queries for Cohi Chat

## Pipeline Overview
- "How many active loans do we have?"
- "What's our current pipeline value?"
- "Show me the pipeline breakdown by status"

## Performance Metrics
- "What's our pull-through rate this quarter?"
- "Average cycle time from application to closing?"
- "Top 5 loan officers by funded volume this month"

## Branch & Channel Analysis
- "Compare all branches by revenue"
- "Which channel has the fastest turn times?"
- "Show me Wholesale pipeline health"

## Risk & Compliance
- "How many loans have LTV over 80%?"
- "What's our average FICO score?"
- "Show me the DTI distribution"

## Trends
- "How has our monthly volume changed over the past year?"
- "Is our pull-through rate improving?"
- "Show revenue trends by quarter"

## Data Queries
- "List all loans assigned to John Smith"
- "Show me loans in 'Clear to Close' status"
- "Find all jumbo loans over $1M"`,
  },
  {
    id: "cc-workbench",
    slug: "chat-in-workbench",
    title: "Using Cohi Chat in the Workbench",
    category: "Cohi Chat",
    categorySlug: "cohi-chat",
    summary: "AI-powered dashboard building.",
    content: `# Using Cohi Chat in the Workbench

## Workbench-Specific Capabilities
When using Cohi Chat within the Workbench, it gains additional capabilities:

## Widget Creation
- "Add a bar chart of monthly funded volume"
- "Create a KPI card for average loan amount"
- "Build a pie chart of loan types"

## Widget Modification
- "Change this chart to a line chart"
- "Update the colors to use a blue palette"
- "Add a filter for Conventional loans only"

## Dashboard Building
- "Create a new canvas called 'Monthly Review'"
- "Arrange the widgets in a 2x2 grid"

## SQL Generation
- "Write a SQL query to find all loans with rate > 7%"
- "Show me the SQL behind this widget"

## Report Building
- "Generate a PowerPoint from this canvas"
- "Create a PDF report with all widgets"

The Workbench AI assistant is context-aware — it knows which canvas and widgets you're working with.`,
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

## Disabling MFA
You can disable MFA from Settings, but we recommend keeping it enabled for security.`,
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
