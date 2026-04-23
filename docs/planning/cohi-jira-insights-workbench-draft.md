# Cohi Jira Draft - Insights and Workbench Integration

- Date: 2026-04-21
- Status: Draft - pending approval before Jira entry
- Target Jira project: Cohi
- Recommendation: create 1 epic for the larger chat/workbench initiative and 2 standalone stories for the Insights improvements

## What I Found In The Codebase

- The main `Insights` experience is centered on `src/pages/Dashboard.tsx`, which currently renders `CohiPromptsCard` as the primary section on `/insights`.
- There is already a full standalone data-quality product surface at `src/pages/DataQualityDashboard.tsx`, backed by `server/src/routes/dataQuality.ts` and mounted at `/api/data-quality`.
- The current Insights UI already supports drill-down patterns through `src/components/dashboard/InsightDetailModal.tsx` and related evidence/detail flows, so "summary first, details on demand" fits the existing interaction model.
- In the current Insights card model, the top-line insight is the `headline`, while the supporting text shown underneath it is the `understory`. For this backlog, "improve highlights" should be interpreted as improving the `understory` presentation.
- The current functional category model is limited to five agent-backed categories: `operations`, `sales`, `finance`, `secondary_marketing`, and `compliance`. Data quality is currently treated mostly as a cross-cutting note or a compliance/context signal, not as its own first-class agent category.
- Workbench already has a reusable report-generation pipeline:
  - `src/components/workbench/report/ReportBuilder.tsx`
  - `src/components/workbench/WorkbenchCanvas.tsx`
  - `server/src/routes/reports.ts`
- Main chat already supports:
  - opening content in Workbench via `src/components/dashboard/CohiChatPanel.tsx` and `src/utils/chatToCanvas.ts`
  - single-item PDF/PPT export from chat visualizations
- The main gap is that dynamic multi-slide PPT/PDF generation is wired through Workbench actions, not the main chat flow yet.

## Recommended Jira Structure

### Story 1

**Issue type:** Story  
**Summary:** Insights: add a dedicated data quality category and section to the main Insights experience  
**Parent:** None  
**Priority:** High

### Description

Add `Data Quality` as a first-class category within the main `Insights` experience so users can quickly judge whether the insight set is trustworthy, current, and complete enough to act on.

This work should reuse the existing Data Quality dashboard and APIs rather than rebuilding them. The goal is to surface an executive-friendly summary inside `Insights`, support dedicated category generation/refresh behavior, and give users a clean path into deeper data-quality analysis when needed.

### Why this is grounded in the current product

- `Dashboard.tsx` already hosts the main Insights landing experience.
- `DataQualityDashboard.tsx` and `/api/data-quality/*` already provide the deeper data-quality metrics, warnings, field health, and range-analysis primitives.
- Insights generation logic already references data-quality findings in several places under `server/src/services/insights/`, but today that logic is mostly embedded into compliance/context handling rather than modeled as its own category.
- The existing category/agent framework already supports category-specific planning and evaluation, which makes data quality a good candidate for a dedicated sixth category rather than a one-off card.

### Scope

- Add a new `Data Quality` functional category to the Insights experience alongside the existing category tabs
- Add a new data-quality summary section or card within the main `/insights` page
- Surface a small set of high-value signals, such as:
  - overall quality score
  - count of critical issues
  - major warning groups
  - freshness/completeness indicators where appropriate
- Add dedicated data-quality agent handling, following the same overall category pattern as the other functional categories
- Give users a clear drill-down path to the existing `/data-quality` experience
- Align wording so users understand whether a problem is:
  - a platform insight
  - a data-quality warning
  - or a trust/freshness indicator

### Acceptance criteria

- Users can see `Data Quality` as a first-class category within the main `Insights` experience
- Users can see a dedicated data-quality section on the main `Insights` page
- The section summarizes current data-quality health in an executive-friendly way
- Data quality can be refreshed/generated through a dedicated category flow consistent with the other functional categories
- The section links users to more detailed data-quality analysis
- The section does not overwhelm the existing Insights layout or duplicate the full data-quality dashboard
- The section respects tenant filtering and existing dashboard context

### Technical notes

- Likely frontend entry points:
  - `src/pages/Dashboard.tsx`
  - `src/components/dashboard/CohiPromptsCard.tsx`
- Likely backend/data sources:
  - `server/src/routes/dataQuality.ts`
  - `server/src/services/insights/agents/categoryDefinitions.ts`
  - `server/src/services/insights/agents/insightPlannerAgent.ts`
  - `server/src/services/insights/agents/insightEvaluatorAgent.ts`
  - possibly `server/src/services/dashboard/analyticsService.ts` if summary data needs to be blended into existing Insights payloads

### Suggested subtasks

- Design the summary information architecture for data quality inside Insights
- Define the new `Data Quality` category contract and dedicated agent behavior
- Define the minimum viable metric set to surface on `/insights`
- Implement frontend card/section and navigation to detailed views
- Reuse or adapt existing data-quality APIs for summary payloads
- Add category-tab, generation, and refresh support for the new data-quality lane
- Validate empty-state and low-data tenant behavior

## Story 2

**Issue type:** Story  
**Summary:** Insights: improve readability with bullet highlights, visual grouping, and progressive disclosure  
**Parent:** None  
**Priority:** High

### Description

Improve the `Insights` UI/UX so it is easier to scan, read, and act on. The current experience has strong signal, but the supporting `understory` content is denser than it needs to be for executive review.

The goal is to make insight cards easier to scan by converting `understory` content into cleaner bullet-style summaries, adding light visual grouping/background treatment, and making the path from summary to detailed evidence more obvious.

### Why this is grounded in the current product

- `CohiPromptsCard.tsx` is already the primary rendering surface for grouped insights and bucketed categories.
- `InsightDetailModal.tsx` and evidence/detail modals already support a "dive deeper" model.
- In the current component model, the `headline` is the top-line title and the `understory` is the text block rendered beneath it. This story should focus primarily on making the `understory` easier to scan.
- This means the product can shift toward summary-first presentation without inventing a new drill-down system.

### Scope

- Redesign the `understory` presentation for fast scanning
- Convert dense `understory` text into clearer bullet-style summaries where possible
- Introduce light background treatments or visual cards that distinguish:
  - priority / severity
  - insight buckets
  - headline vs supporting detail
- Make it more obvious how a user moves from:
  - quick highlights
  - to supporting context
  - to detailed evidence
- Preserve mobile/responsive readability

### Acceptance criteria

- Insight summaries are easier to scan than the current presentation
- `Understory` content is rendered in a bullet-friendly or similarly structured executive format
- Important content is visually grouped without making the page feel heavy or cluttered
- Users have a clear and consistent path from summary to detail
- Existing insight actions and drill-down behavior continue to work

### Technical notes

- Primary implementation surface:
  - `src/components/dashboard/CohiPromptsCard.tsx`
- Existing drill-down/detail surfaces to preserve:
  - `src/components/dashboard/InsightDetailModal.tsx`
  - `src/components/dashboard/DashboardInsightEvidenceModal.tsx`
- Shared UI primitives likely useful:
  - `src/components/ui/card.tsx`
  - `src/components/ui/collapsible.tsx`
  - `src/components/ui/accordion.tsx`

### Suggested subtasks

- Audit the current `headline` / `understory` information hierarchy
- Define a new summary presentation pattern for `understory` content
- Implement bullet-style `understory` rendering and visual grouping treatment
- Tighten spacing, typography, and contrast for readability
- Validate behavior across buckets, tabs, and responsive layouts

## Epic 3

**Issue type:** Epic  
**Summary:** Chat visualizations: prominent export and Build in Canvas handoff  
**Parent:** None  
**Priority:** High

### Description

Improve the export UX for chart visualizations already generated inside the main Cohi Chat panel.

Today, `Download PDF`, `Add to PowerPoint`, and `Save to Workbench` are available, but they are buried inside a per-visualization overflow menu. Users who ask a normal Cohi Chat question such as "Show me loans declined with credit score over 720" can receive the right chart, but they do not get an obvious next step to either export it immediately or continue building a deck in Workbench.

This epic should make the per-visualization export actions prominent and add a direct `Build in Canvas` path that opens Workbench with that chart already on a new canvas and the existing PowerPoint Editor open on slide 1.

### What exists today

- `CohiChatPanel.tsx` already supports:
  - `handleDownloadPDF` for a simple client-side PDF export
  - `handleAddToPowerPoint` for a simple client-side PPTX export
  - `handleSaveToWorkbench` for saving a chart as a new canvas
- `WorkbenchCanvas.tsx` already hosts the `ReportBuilder`
- `ReportBuilder.tsx` already builds initial slides from the current canvas widgets when no preloaded report definition is provided

### Prototype-backed recommendation

Keep this effort focused on the chart visualization the user already sees in chat. Do not introduce intent detection, artifact cards, or multi-slide auto-generation from a whole conversation in this phase.

## Epic 3 - Child Story A

**Issue type:** Story  
**Summary:** Cohi Chat: promote per-visualization PDF and PowerPoint export controls  
**Parent:** Epic 3

### Description

Move `Download PDF` and `Download PowerPoint` out of the hidden `Save & export` overflow menu and make them visible directly in the chart action footer for every visualization generated in main Cohi Chat.

Keep less-frequent actions such as image export, copy link, and email options in a smaller overflow so the chart action area remains clean.

### Acceptance criteria

- Every assistant chat message that contains a visualization shows visible export actions directly in the chart footer
- Users can download a simple PDF from the chart with one obvious click
- Users can download a simple PowerPoint from the chart with one obvious click
- Existing image / email / copy link actions still work from the overflow menu
- Existing export handlers are reused; no separate export path is introduced for the same single-chart action

### Technical notes

- Primary file:
  - `src/components/dashboard/CohiChatPanel.tsx`
- Existing handlers to reuse:
  - `handleDownloadPDF`
  - `handleAddToPowerPoint`
- Existing overflow section to simplify:
  - `EnhancedChatMessageBubble` chart footer in `CohiChatPanel.tsx`

## Epic 3 - Child Story B

**Issue type:** Story  
**Summary:** Cohi Chat: add Build in Canvas handoff that opens Workbench PowerPoint Editor on the selected chart  
**Parent:** Epic 3

### Description

Add a `Build in Canvas` action to each chat visualization so the user can move from a single chart in chat to a one-chart Workbench canvas and immediately continue editing it in the existing PowerPoint Editor.

This should create a new Workbench canvas from the selected visualization, navigate the user into that canvas, and auto-open the existing `ReportBuilder` so slide 1 is already seeded from that chart.

### Acceptance criteria

- Every assistant chat message that contains a visualization exposes a visible `Build in Canvas` action
- Clicking `Build in Canvas` creates a new Workbench canvas from the selected visualization only
- The user lands inside that new canvas rather than the generic Workbench hub
- The existing PowerPoint Editor opens automatically for that new canvas
- The first slide is already seeded from the selected chart
- The existing thread-level `Open in Workbench` action remains unchanged for multi-visualization export

### Technical notes

- Primary files:
  - `src/components/dashboard/CohiChatPanel.tsx`
  - `src/pages/MyDashboard.tsx`
  - `src/components/workbench/WorkbenchCanvas.tsx`
  - `src/components/workbench/report/ReportBuilder.tsx`
- Reuse the same single-visualization canvas payload shape currently used by `handleSaveToWorkbench`
- Prefer additive changes:
  - reuse `ReportBuilder` auto-slide generation from current canvas widgets
  - auto-open the editor from `WorkbenchCanvas` when arriving from the chat handoff

## Recommended Jira Creation Order

1. Story 1: data quality section in Insights
2. Story 2: readability and progressive disclosure improvements in Insights
3. Epic 3
4. Epic 3 - Child Story A
5. Epic 3 - Child Story B

## Notes For Review

- I recommend keeping items 1 and 2 as separate stories because they solve different product problems:
  - trust / data confidence
  - readability / executive UX
- I recommend making item 3 an epic because it spans the main chat surface, Workbench canvas creation, and the existing PowerPoint Editor handoff.
- If you want, I can next convert this document into:
  - cleaner Jira-ready ticket text with tighter business language
  - or direct Jira issue creation through the Atlassian integration after you approve it
