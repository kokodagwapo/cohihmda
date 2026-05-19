# Cohi Chat Centralization — Technical Requirements (Meeting Notes Compilation)

**Status:** Requirements / specification (compiled from stakeholder meeting notes)  
**Audience:** Product, engineering, design  
**Related planning:** [cohi-chat-unified-architecture.md](./cohi-chat-unified-architecture.md), [unified-chat-rollout.md](./unified-chat-rollout.md). **Resolved decisions:** [§10](#10-product-decisions-resolved). **Unified history migration (draft):** [§11](#11-unified-history-migration-technical-draft).

---

## 1. Purpose and product goal

**Primary objective:** Consolidate all Cohi conversational experiences into **one central chat surface** so a single chat session can support general assistance, research workflows, custom insight prompt authoring, and workbench creation—without users switching between disconnected chat UIs.

**Success criteria (high level):**

- One obvious entry point for “talking to Cohi” on every application page.
- Mode-specific behavior is explicit (user-selected chat type), not implicit or hidden behind separate top-level products where possible.
- Research Lab is no longer a standalone page; it runs **inside** the unified chat when the user chooses the research mode.
- Sidebar and top navigation reflect the new information architecture (fewer duplicate entry points, clearer history and folders).

---

## 2. Global chat shell — placement and layout

### 2.1 Remove right-rail chat

- **Requirement:** Remove Cohi Chat from the **right side** of the layout (current / legacy placement).
- **Requirement:** Chat is no longer a persistent narrow rail; it becomes a **primary horizontal band** aligned with main content.

### 2.2 Default placement and sizing

- **Location:** Directly **below the top navigation bar** and **above all page-specific content**, spanning the **same horizontal width** as the main content column / **content boxes** used on each page (aligned with page content width, not arbitrary full-bleed).
- **Default state:** Opens in a **compact “new chat”** presentation.
- **Initial dimensions (v1):** Default chat band height `**500px`** (starting point; responsive refinements for very small viewports may be defined during build). Width matches the **same width as the content boxes** inside each page.

### 2.3 Expanded layouts (user-controlled)

From the default compact state, the user must be able to expand the chat to:


| Mode              | Behavior                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Taller inline** | Chat occupies more vertical space; **page content moves down** (document flow).                                                                                                                                                                                                                                                                                                                                   |
| **Full page**     | Chat fills the **main content region** only: it consumes the full **usable** area below the top bar and beside the sidebar (i.e. **top navigation and sidebar remain visible**). Routed page content is not shown in that region while in this mode (or is minimized per design).                                                                                                                                 |
| **Split screen**  | **Left half:** page content. **Right half:** chat. **Scroll:** If the pointer is over the chat panel **and** the chat content is scrollable, **wheel / touch scroll affects the chat**; otherwise scroll affects the **page** (main content). **Mobile:** split mode **does not** persist as side-by-side; use **stacked** layout or **full-screen chat** only (exact breakpoint behavior during implementation). |


**Research mode:** **Full page** may also be entered **automatically** on research-driving submit ([§4.6](#46-research-shell-behavior-and-layout-deltas)), not only via manual user control.

### 2.4 Expand state vs navigation

- **Requirement:** Chat **expansion size / layout state** resets to the **default compact** presentation on **in-app route navigation** (moving between pages via normal app navigation) and on **full browser refresh**, unless an exception below applies.
- **Exception — in-app links from Cohi Chat:** When the user follows a **link that originates from within Cohi Chat** (e.g. chat-generated URL, history entry, or other chat-embedded navigation), the app should navigate to the destination **without changing** the current chat **expansion size** (preserve compact / tall / full / split as-is for that transition).
- **Exception — Research submission:** When the user **submits** a message in **Research** mode that **drives the main research layout** (Timeline / Findings / Report—at minimum the **initial** research query; follow-up sends in the same thread typically keep this state), the shell **automatically switches** to **Full page** as defined in [§2.3](#23-expanded-layouts-user-controlled), so the research surface has enough room without relying on the default **500px** band ([§4.6](#46-research-shell-behavior-and-layout-deltas)).

## 3. Chat type selector (input affordance)

**Requirement:** The chat input area exposes an explicit control for **chat type**, analogous to Cursor’s mode selector (e.g. Agent, Plan, Debug).

**Required modes (labels from notes):**


| Mode                | Intended use                                                                                                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Chat**            | General conversational use; **default for every new session** ([§10](#10-product-decisions-resolved)).                                                                                                          |
| **Research**        | Runs the **full Research Lab experience**; **Full page** on research submit; **no** in-UI session rail ([§4](#4-research-lab-migration-into-cohi-chat), [§4.6](#46-research-shell-behavior-and-layout-deltas)). |
| **Insight builder** | Creating **new insight custom prompts**; includes natural-language-driven prompt population (see [Section 5](#5-insight-builder--custom-prompts-from-conversation)).                                            |
| **Workbench**       | Creating **new workbenches**; may overlap **existing** chat flows (e.g. “make a dashboard”)—see [§8](#8-workbench-mode).                                                                                        |


**Requirement:** Changing chat type should have predictable effects on available options (e.g. Research-only checkboxes) and on backend routing/orchestration.

**Requirement — access:** **Research**, **Insight builder**, and **Workbench** are **not** behind additional entitlements versus general chat: **any user who can use Cohi Chat** may select these modes ([§10](#10-product-decisions-resolved)).

---

## 4. Research Lab migration into Cohi Chat

### 4.1 Scope of migration

When **Research** is selected as the chat type:

- **Requirement:** The **entire** current Research Lab implementation is in scope: **timeline, findings, report, orchestration logic, and all supporting behavior**—not a reduced subset.
- **Requirement:** The feature moves **off its dedicated page** and executes **within** the unified Cohi Chat container.
- **Presentation:** Visual styling should match **Cohi Chat** for cohesion. **Required layout deltas** (supersede “keep identical layout” where they conflict): no in-research **sessions** rail; **Full page** auto-expand on research-driving submit ([§4.6](#46-research-shell-behavior-and-layout-deltas)). **Otherwise** preserve the **Timeline / Findings / Report** structure, tab model, and main content density **where feasible** (document any further forced deltas).

### 4.2 Deep analysis option

- **Requirement:** “Deep analysis” (or equivalent today) remains available.
- **Requirement:** Expose it as a **checkbox** (or toggle) that is **only enabled / visible when Research** is the selected chat type.

### 4.3 Navigation

- **Requirement:** Remove the **Research Lab** entry from the **top navigation bar** (see [Section 6.2](#62-top-navigation-bar)).

### 4.4 Sessions and history

- **Requirement:** Research-mode conversations are **first-class** in the **unified** history model: they appear with other Cohi Chat threads in recents, full history, and folders, with **backwards compatibility** for legacy Research sessions as defined in [§7.3](#73-unified-history-research-lab--cohi-chat). **Do not** duplicate that history inside the Research workspace as a **left “SESSIONS” rail** ([§4.6](#46-research-shell-behavior-and-layout-deltas)).

### 4.5 Legacy `/research-lab` route (interim)

- **Requirement (v1):** Requests to `**/research-lab`** should **redirect** to `**/insights`**. The unified chat’s type selector should be set to **Research** when landing from this redirect so the user lands in the Research experience in context.
- **Deprecation:** `**/research-lab` is deprecated.** The path should **eventually be removed entirely** once metrics show low usage and bookmarks have migrated; until then redirects must preserve user expectations ([§11](#11-unified-history-migration-technical-draft)).
- **Deep links:** Older Research-specific URLs must **continue to resolve** (redirect into unified chat with the correct session); see [§7.3](#73-unified-history-research-lab--cohi-chat) and [§11](#11-unified-history-migration-technical-draft).

### 4.6 Research shell behavior and layout deltas

- **Requirement — auto Full page on submit:** When the user **submits** a research-driving message (see exception in [§2.4](#24-expand-state-vs-navigation)), the unified chat shell **automatically expands** to **Full page** ([§2.3](#23-expanded-layouts-user-controlled)): the research UI uses the full **main content region** below the top bar and beside the **app** sidebar, so Timeline, Findings, Report, “At a glance,” and related dense layouts have the **horizontal and vertical room** previously shared between the report and the **removed** session rail (reference screenshot: legacy Research Lab with **SESSIONS** + report + **Continue the conversation**—target is **report-width** behavior without duplicating session navigation).
- **Requirement — remove in-research session list:** Remove the **left-hand Research session history** UI (e.g. **SESSIONS** column with “Search sessions…”, **MY SESSIONS**, per-session rows and tags). Session choice, search, and recents live in the **global app sidebar** ([§6.4](#64-sidebar-order-top-to-bottom), [§7](#7-chat-history--folders-and-recents)) only, avoiding duplicate navigation.
- **Requirement — preserve core research workspace:** Keep the **primary** research workspace: tabs such as **Timeline / Findings / Report / Complete**, the report and findings bodies, primary actions the product retains (e.g. Share, Export, New Investigation—subject to existing rules), and the **Continue the conversation** / follow-up composer **within** the research surface, restyled to **Cohi Chat** chrome as in §4.1.

---

## 5. Insight builder — custom prompts from conversation

**Requirement (Insight builder mode):** Users can describe desired insights in natural language—for example:

> “Create an insights prompt that will analyze the Product mix and channel analysis (loan type, purpose, and program) for branch 2001.”

**System behavior:**

1. Interpret the user’s intent and map it to the **insight custom prompt** data model (all relevant fields the product uses today for user-defined prompts).
2. When **required or high-impact information is missing or ambiguous** (for example **schedule** / cadence, scope, filters, or data definitions), **Cohi must ask follow-up questions** in chat rather than guessing or leaving critical fields silently empty.
3. **Automatically populate** the prompt fields (title, schedule, prompt text, specifiers, and any other editor fields) using the user’s answers and stated intent.
4. Before any write to the prompt list, show an **inline summary card** embedding a **structured preview** of the draft prompt. Users must be able to **edit any field directly in that preview** before deciding.
5. The user must choose **Approve** or **Deny**. **Do not persist** until **Approve** is clicked. **Deny** must open a follow-up that **asks the user** to explain what is wrong, what should change, or what is missing, so Cohi can revise the draft in-thread.
6. After **Approve**, **persist** the result as a new prompt in the **user’s prompt list** (same list / surface as today’s “My Insights” / custom prompts UX on `/insights` or equivalent). The user should still be able to **edit** from `/insights` after save, as today.

**Cohesion with Section 3:** This flow is the **Insight builder** chat type; it should not require a separate product entry point beyond mode selection plus user message.

---

## 6. Information architecture — sidebar and top nav

### 6.1 Insights section (sidebar)

- **Requirement:** Condense the sidebar **Insights** area to a **single control** (e.g. button or link) that navigates to `**/insights`**.
- **Requirement:** Remove **sidebar-only** shortcuts for **“Cohi Insights”** and **“Cohi Mortgage News.”** **Cohi Insights** and **Cohi Mortgage News** must **remain on the `/insights` page exactly as they do today** (same tabs, sections, or controls—no removal of those experiences from the page). The change is **navigation only:** both are already reachable from `/insights`, so duplicate sidebar entries are unnecessary.
- **Product decision:** There are **no** changes to `/insights` **page content**, **roles**, or **entitlements** for those areas beyond removing redundant sidebar entry points ([§10](#10-product-decisions-resolved)).

### 6.2 Top navigation bar

- **Requirement:** Remove the **Research Lab** button from the top bar.
- **Requirement:** Replace that slot with the **Communications Center** control, implemented **identically** to the **existing** Communications Center entry elsewhere in the app: **same route**, **same permissions** (if any today), and **same behavior**. Only the **top nav** placement changes (Research Lab removed from top nav; Research is not re-added to the sidebar in that slot).

### 6.3 “My Dashboards” (sidebar)

- **Requirement:** **My Dashboards** aggregates:
  - **Pinned dashboards** (existing behavior), and  
  - **Pinned workbenches**, modeled **the same way** as pinned dashboards and the **current** pinned-workbench implementation where it already exists.
- **Requirement:** **No per-user cap** on the number of pins. Pins are **per user** and **sync across devices** (same semantics as pinned dashboards today).
- **Requirement:** Section is **collapsed by default**.

### 6.4 Sidebar order (top to bottom)

1. **Insights** — single button → `/insights`
2. **My Dashboards** — pinned dashboards + pinned workbenches; collapsed by default
3. **Folders** — chat history organization (see [Section 7](#7-chat-history-folders-and-recents))
4. **History** — last few chat sessions (recents)
5. **Full History** — control that opens a **dedicated page** listing full chat history

---

## 7. Chat history — folders and recents

### 7.1 Folders

- **Requirement:** Users can create **folders** that group **Cohi chat history**, similar to ChatGPT’s project/folder patterns.
- **Requirement:** **Folders may contain sub-folders.** **Maximum nesting depth:** **5** levels (define “level” consistently in implementation—e.g. root folder as depth 1 or document max tree depth in tickets).
- **Requirement:** **No maximum** number of folders per user.
- **Requirement:** **No folder sharing** in v1 (folders are private to the owning user, same as chat history scope).
- **Requirement — rename:** Users can **rename** a folder. Renaming updates that folder’s identity and any **internal path / hierarchy references** needed so nested folders and contents remain consistent.
- **Requirement — delete folder:** Deleting a folder **removes the folder**. **Chats** that were only in that folder become: (a) children of the **parent** folder if one exists, or (b) **unsorted** (not in any folder) if there is **no** parent.
- **Requirement — delete parent:** Deleting a folder **also deletes descendant folders** (cascade). **Chats** in the deleted subtree are reassigned using the same rule as a single-folder delete: move to the **nearest surviving ancestor** of the folder that was explicitly deleted, or to **unsorted** if there is no such ancestor.
- **Requirement:** A given **chat may belong to at most one folder** at a time (no multi-folder membership).
- **Requirement:** Grouping is explicit: chats saved or assigned into a folder stay associated until moved, deleted, or affected by folder delete rules above.

### 7.2 History vs Full History

- **Sidebar “History”:** Shows only the **most recent** subset of chats (exact count **TBD** during UI implementation).
- **“Full History” page:** Dedicated page listing unified history with:
  - **Search** across history.
  - **Filter by chat type:** Chat, Research, Insight builder, Workbench.
  - **Pagination** when the result set is **longer than 50** rows (page size aligned with filter/search results).
- **Retention (v1):** Chat threads are **not deleted** by automated retention. **Note:** A future product decision **may** introduce retention or archival; engineering should avoid hard-coding “forever” assumptions that block a later policy.

### 7.3 Unified history (Research Lab + Cohi Chat)

- **Requirement:** With **one** unified Cohi Chat surface, **history is one logical timeline** for the user: sidebar **History**, **Full History**, and **Folders** all operate on the **same combined** set of threads/sessions—not siloed lists per legacy product.
- **Requirement:** **Research Lab** history (sessions, saved research runs, or whatever constitutes a resumable **Research** session today—align naming to implementation) must be **merged** into that unified model so Research work appears **alongside** general chat, Insight builder, and Workbench threads in recents, full history, and folder assignment.
- **Backwards compatibility — user data:** **Existing** Research Lab sessions must **remain visible and openable** after cutover (no “orphaned” history). Users must not lose prior Research threads when the standalone Research page is retired; they surface in the **same** history UX as other chats.
- **Backwards compatibility — links and IDs:** **Bookmarks and deep links** that pointed at the standalone Research Lab (or session-specific URLs) must **keep working** by **redirecting** into unified chat with the correct session resumed, **without breaking** legacy URL formats during transition (see [§11](#11-unified-history-migration-technical-draft)).

**Cohesion:** This aligns with [§4](#4-research-lab-migration-into-cohi-chat) (Research runs inside unified chat) and [§9](#9-cross-cutting-themes) (single chat location).

---

## 8. Workbench mode

- **Requirement:** When **Workbench** is the selected chat type, the chat is the primary UX for **creating new workbenches** (authoring flow, confirmations, and any templates or defaults should align with existing workbench creation rules).

**Current implementation note:** Workbench-related behavior may **already be partially implemented** in Cohi Chat today—for example, a user can instruct the assistant to **make or populate a dashboard**, and the system responds with the appropriate workbench-oriented actions. Treat that behavior as **existing capability to preserve**, not greenfield invention.

**Refactor vs rewrite:** Introducing **Workbench** as an explicit chat type will likely require **routing, prompts, UI affordances, and session semantics** to change so the product clearly distinguishes “general chat” from “workbench authoring.” Expect **implementation changes** (mode selector, context flags, orchestration entry points) even when the user-visible outcome is similar to what chat already does for dashboard-style requests.

**Logic parity:** The **underlying logic** that creates **charts, widgets, dashboards, and other workbench artifacts** (tooling, action schemas, data queries, validation) should **remain the same** as today unless a deliberate migration is documented. Mode selection should **repackage and gate** that logic, not replace it with a parallel implementation.

**Implementation planning gate:** Before writing a detailed engineering plan for **Workbench mode**, **investigate** the codebase to identify **exactly** what runs today when users create a **workbench** or **custom dashboard** (routes, services, prompts, tool/action pipelines). The explicit **Workbench** chat type should **reuse and relocate** that implementation—not reinvent it—subject to the **mode-routing and UX changes** described earlier in this section.

**Relationship to architecture:** This aligns with the broader “unified chat” direction described in [cohi-chat-unified-architecture.md](./cohi-chat-unified-architecture.md) (single surface, context passed structurally).

---

## 9. Cross-cutting themes

- **Single chat location:** All conversational workflows route through the same shell; mode switches behavior instead of spawning unrelated chat panels.
- **Unified history:** Research sessions and other chat modes share **one** timeline and storage semantics ([§7.3](#73-unified-history-research-lab--cohi-chat)).
- **Visual cohesion:** Research Lab UI adopts Cohi Chat chrome while preserving internal layout where possible.
- **Discoverability:** Modes are explicit at input time; special options (e.g. deep analysis) are gated by mode to reduce confusion.
- **Access parity:** Non-Chat modes (**Research**, **Insight builder**, **Workbench**) use the **same access policy** as general chat—no extra feature flags for those modes ([§10](#10-product-decisions-resolved)).

---

## 10. Product decisions (resolved)

*Decisions below supersede the former “open questions” list; they are folded into §2–§9 above.*


| #   | Topic                                  | Decision                                                                                                                                                                                                                                                                       |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Default chat type for **new sessions** | **Chat**                                                                                                                                                                                                                                                                       |
| 2   | Chat **expand state**                  | Resets to default compact on **route navigation** and on **full browser refresh**, **except** when the user follows a **link that originated inside Cohi Chat**—then navigate **without** changing chat size ([§2.4](#24-expand-state-vs-navigation))                          |
| 3   | Default chat band sizing               | **500px** height; width matches **page content boxes** ([§2.2](#22-default-placement-and-sizing))                                                                                                                                                                              |
| 4   | **Split screen** scroll / mobile       | Pointer over **scrollable chat** → scroll chat; else scroll **page**. Mobile: **stacked** or **full-screen chat** only ([§2.3](#23-expanded-layouts-user-controlled))                                                                                                          |
| 5   | `**/research-lab`**                    | **Redirect to `/insights`**; set chat type to **Research** on landing. Route is **deprecated**; plan to **remove entirely** later ([§4.5](#45-legacy-research-lab-route-interim), [§11](#11-unified-history-migration-technical-draft))                                        |
| 6   | `**/insights` content / roles**        | **No change** beyond sidebar navigation ([§6.1](#61-insights-section-sidebar))                                                                                                                                                                                                 |
| 7   | **Pinned workbenches**                 | Same product rules as **pinned dashboards** / current pins: **no per-user limit**, **sync across devices**, **per-user** ([§6.3](#63-my-dashboards-sidebar))                                                                                                                   |
| 8   | **Folders**                            | No max folder count; **max nesting depth 5**; **no sharing** (v1); **rename** + **delete** implemented; delete moves chats to **parent** or **unsorted**; **cascade-delete** child folders; **one folder per chat** ([§7.1](#71-folders))                                      |
| 9   | **Full history page**                  | **Search**; **filter by type** (Chat, Research, Insight builder, Workbench); **pagination** when list **> 50**; **no automated deletion** of chats for now—retention **may change later** ([§7.2](#72-history-vs-full-history))                                                |
| 10  | **Unified history / legacy Research**  | Technical approach documented in [§11](#11-unified-history-migration-technical-draft) for stakeholder approval; **old Research URLs must keep working** via redirect into unified chat                                                                                         |
| 11  | **Insight builder** approval UX        | **Inline summary card**; **editable preview fields**; **Approve** / **Deny**; **Deny** prompts user for what is wrong / what to change ([§5](#5-insight-builder--custom-prompts-from-conversation))                                                                            |
| 12  | **Workbench mode**                     | **Investigate** current workbench / custom-dashboard creation paths **before** detailed implementation plan; **transfer** existing behavior into explicit mode ([§8](#8-workbench-mode))                                                                                       |
| 13  | **Communications Center** (top nav)    | **Same** implementation as existing control: **same route**, **same permissions**; replaces **Research Lab only in top nav** ([§6.2](#62-top-navigation-bar))                                                                                                                  |
| 14  | **Mode entitlements**                  | **None** beyond general chat access ([§3](#3-chat-type-selector-input-affordance))                                                                                                                                                                                             |
| 15  | **Research workspace chrome**          | On **research-driving submit**, auto **Full page** ([§2.3](#23-expanded-layouts-user-controlled), [§2.4](#24-expand-state-vs-navigation)); **remove** left **SESSIONS** rail; sessions only in **app sidebar** History ([§4.6](#46-research-shell-behavior-and-layout-deltas)) |


### 10.1 Minor follow-ups (not blocking v1 intent)

- **Sidebar “History” recents count:** pick a default cap during UI build.
- **500px band on very small viewports:** confirm min-height / overflow behavior if 500px exceeds viewport height.
- **Research “submit” event:** confirm whether **every** follow-up in **Continue the conversation** re-triggers Full page animation or only the **first** run that materializes Timeline/Findings/Report ([§4.6](#46-research-shell-behavior-and-layout-deltas)).

---

## 11. Unified history migration (technical draft)

**Status:** Draft for **engineering + stakeholder review** (per product decision table §10 item 10). Revise after codebase audit of Research Lab session storage and Cohi Chat conversation stores.

### 11.1 Objectives

- Present a **single** chronological (or user-sortable) history list combining **legacy Research Lab sessions** and **Cohi Chat** threads.
- **Do not break** existing bookmarks, emails, or integrations that reference **old Research URLs** or session IDs.
- Avoid a risky “big bang” data rewrite without a rollback path.

### 11.2 Canonical model (target)

- Introduce or extend a **canonical conversation** record used by the unified UI. Core fields include stable `**conversation_id`**, `**owner_user_id**`, `**tenant_id**` (if applicable), `**chat_type**` (`chat` | `research` | `insight_builder` | `workbench`), `**title**`, `**updated_at**`, and nullable `**folder_id**` (UUID; linkage to a folders table may add a foreign key when that DDL exists — v1 stores `folder_id` without FK per COHI-395).
- **Legacy lineage (two distinct fields — both persisted on `unified_chat_conversations`):**
  - `**legacy_source`** — Provenance enum for audit and migration (e.g. `cohi_chat`, `research_lab`, …). Indicates *which product or store* the row originated from.
  - `**legacy_ref*`* — Optional opaque **legacy identifier** (e.g. pre-unified Research session id) used for redirects, `**legacy_id` → `conversation_id`** maps (§11.3), and API bridges. This is *not* the same as `legacy_source`: use both when both apply.
- **Research-specific payload** (timeline, findings, report state) either **remains in existing Research tables** keyed by `conversation_id` / mapped foreign key, or is **copied** once into a unified blob—**prefer normalizing reads** through a service layer before picking physical schema.

### 11.3 Read path (phased)

1. **Dual-read adapter:** A `HistoryRepository` (name illustrative) loads “unified rows” by **unioning** (or sequential merging of) legacy Research session queries and Cohi Chat conversation queries, normalizing each row to the canonical shape. Sidebar recents and Full History call this adapter only.
2. **Stable ID map:** Maintain an optional `**legacy_id → conversation_id`** map for Research sessions created before cutover so redirects and API lookups stay **O(1)**.
3. **Redirects:** `/research-lab` and legacy session URLs hit a **router** that resolves the legacy ID, then issues a **302/307** to `/insights` (or the host route for unified chat) with query parameters such as `resume=<id>` and `mode=research`, preserving §4.5 and §7.3. **Old URL patterns stay registered** until traffic dies—then remove routes per §4.5 deprecation note.

### 11.4 Write path

- **New Research threads** created after cutover write **only** to the canonical store (and any Research-specific extension tables), so dual-read is temporary.
- **New Chat / Insight builder / Workbench** threads continue the unified write model already planned for Cohi Chat.

### 11.5 Backfill job (optional but recommended)

- Offline or gradual job attaches `**legacy_source`** (and `**legacy_ref*`* where a stable legacy id is known) and ensures every historical Research session appears in unified history queries (may only populate an index/MV if physical merge is deferred).
- Run with **idempotency** and metrics; pause if error rate exceeds threshold.

### 11.6 Validation / exit criteria

- Spot-check: N legacy Research URLs open the **correct resumed session** in unified chat with **Research** mode active.
- Full History filters return merged rows; pagination >50 works under load tests.
- No duplicate rows for the same logical session after backfill.

---

## 12. Traceability — note clusters merged in this doc


| Original note theme                                                                                                      | Primary section                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Central chat; one chat does everything                                                                                   | [§1](#1-purpose-and-product-goal), [§9](#9-cross-cutting-themes)                                                                            |
| Top band layout; remove right chat; expand modes                                                                         | [§2](#2-global-chat-shell--placement-and-layout)                                                                                            |
| Chat / Research / Insight builder / Workbench modes                                                                      | [§3](#3-chat-type-selector-input-affordance)                                                                                                |
| Research Lab in chat; auto Full page; no SESSIONS rail; deep analysis; `/research-lab` redirect                          | [§4](#4-research-lab-migration-into-cohi-chat), [§2.4](#24-expand-state-vs-navigation)                                                      |
| Unified history: merge Research Lab sessions with Cohi Chat; backwards compatibility                                     | [§7.3](#73-unified-history-research-lab--cohi-chat), [§4.4](#44-sessions-and-history), [§11](#11-unified-history-migration-technical-draft) |
| NL → custom prompt fields → user prompt list                                                                             | [§5](#5-insight-builder--custom-prompts-from-conversation)                                                                                  |
| Sidebar: single Insights → `/insights`; remove duplicate sidebar links only (Cohi Insights & Mortgage News stay on page) | [§6.1](#61-insights-section-sidebar)                                                                                                        |
| My Dashboards + pinned workbenches                                                                                       | [§6.3](#63-my-dashboards-sidebar)                                                                                                           |
| Sidebar order; History; Full History                                                                                     | [§6.4](#64-sidebar-order-top-to-bottom), [§7](#7-chat-history--folders-and-recents)                                                         |
| Top nav: Research lab → Communications Center                                                                            | [§6.2](#62-top-navigation-bar)                                                                                                              |
| Folders for chats                                                                                                        | [§7.1](#71-folders)                                                                                                                         |
| Workbench mode; explicit mode vs partial chat today; same artifact logic                                                 | [§8](#8-workbench-mode)                                                                                                                     |


*Resolved product decisions:* [§10](#10-product-decisions-resolved). *Migration draft:* [§11](#11-unified-history-migration-technical-draft).

---

*Document generated from compiled meeting notes; [§11](#11-unified-history-migration-technical-draft) requires stakeholder approval before build lock-in.*