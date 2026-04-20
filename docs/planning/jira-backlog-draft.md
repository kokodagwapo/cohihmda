# Cohi Jira Items - Draft for Review

- Date: 2026-04-20
- Status: Draft - for review
- Target Jira project: Cohi
- Assignment approach: Create unassigned; note intended owner in the description

## Summary

| Item | Type | Summary | Intended owner |
| --- | --- | --- | --- |
| 1 | Epic | MCT distribution model: partner portal vs separate hosted apps with shared token brokerage | Marko |
| 1a | Task | Design spike: evaluate MCT distribution options, admin model, and shared token architecture | Marko |
| 2 | Epic | Multi-channel dashboards review & relabeling (TPO and other channels) | Caitlin |
| 3 | Epic | Section access: groups, roles, and per-group insights | John and team |
| 4 | Task | Automate client CSV upload & ingestion into Cohi data model | John and team |

## Item 1

**Issue type:** Epic  
**Summary:** MCT distribution model: partner portal vs separate hosted apps with shared token brokerage  
**Owner:** Marko  
**Parent:** None

### Description

Owner: Marko

Problem:
The original MCT Configurator was built as a tool for MCT to connect lenders into MCT Live, with Cohi acting as the intermediary for obtaining lender Encompass Partner Connect API credentials from ICE and hosting the tool. Now that Cohi exists, there is an opportunity to upsell those same lenders into a slimmed-down Cohi experience, but the right product and hosting model needs to be defined.

Goal:
Define the right MCT distribution model for offering Cohi to MCT lenders while preserving the existing configurator, without creating a separate dedicated AWS account or instance for each lender.

Candidate solution paths:
- Option A: MCT Partner Portal
  - One dedicated MCT environment or partner deployment
  - Multiple lender tenants inside that environment
  - Existing MCT Configurator preserved as an operational module
  - Cohi Lite exposed through the same partner experience, with constrained dashboards, chats, research labs, and insights
  - Shared client context and shared Encompass token handling where the same lender exists in both systems
- Option B: Separate hosted apps with shared token brokerage
  - MCT Configurator and Cohi remain separate user experiences
  - Shared token handling still prevents duplicate Encompass token usage across both systems
  - Lenders can be upsold into a slim Cohi offering without building a unified wrapper experience first
  - System boundaries stay cleaner, but the overall product story is less unified

Admin and access model:
- Cohi acts as Platform Admin for infrastructure, provisioning controls, entitlements, support, and break-glass operations
- MCT acts as Partner Admin across the lender tenants they bring into the program
- Lenders act as Tenant Admins for their own organizations
- Lender users remain tenant-scoped end users

Guardrails:
- Do not spin up a dedicated instance or AWS account per lender
- Do not give MCT unrestricted access to lender dashboards, chats, or insights by default
- Use least privilege for MCT, with access focused on onboarding, integration status, tenant management, and support workflows unless broader access is explicitly part of the commercial model

In scope:
- Product and architecture definition for both candidate distribution paths
- Recommendation on whether to pursue a unified partner portal or separate hosted experiences first
- Shared identity model across configurator and Cohi Lite where appropriate
- Partner admin versus tenant admin permission boundaries
- Lender provisioning and invitation workflows
- Feature entitlement model for Cohi Lite versus future upsell tiers
- Shared client mapping and Encompass token brokerage to stay aligned with ICE partner token-use guidelines
- Cross-system navigation or wrapper experience if the partner-portal path is selected

Open questions to resolve:
- Which path is the recommended starting point: unified partner portal or separate hosted apps with shared token brokerage?
- What is the implementation and operational tradeoff between the two paths in time to market, upsell potential, and product complexity?
- Can MCT impersonate a lender admin for support, or only manage operational metadata?
- Can MCT see any lender content, or only onboarding, integration, and usage health?
- Does MCT create lender tenants directly, or does Cohi approve and provision them?
- Who owns billing and contracts: Cohi direct, MCT reseller, or a hybrid model?
- What exact features belong in Cohi Lite versus paid upgrades?
- Is the wrapper a shared shell with embedded modules, or a linked experience with shared auth and client context?
- Where is the system of record for client identity, invitations, entitlements, and Encompass token ownership?

Out of scope:
- Standing up a separate dedicated deployment for every lender
- General MCT Configurator work that is unrelated to the MCT distribution strategy and shared-token architecture

## Item 1a

**Issue type:** Task  
**Summary:** Design spike: evaluate MCT distribution options, admin model, and shared token architecture  
**Owner:** Marko  
**Parent:** Item 1 - MCT distribution model: partner portal vs separate hosted apps with shared token brokerage

### Description

Owner: Marko

Create a short design and discovery package that compares the two candidate MCT distribution paths, including the relationship between the configurator, Cohi Lite, tenant provisioning, and shared Encompass token handling.

Expected deliverables:
- Recommendation between:
  - unified MCT partner portal with embedded or linked Cohi Lite
  - separate hosted MCT Configurator and Cohi experiences with shared token brokerage
- Recommended deployment model for the selected path
- Proposed admin hierarchy: Platform Admin, Partner Admin, Tenant Admin, Tenant User
- Permission matrix covering what Cohi can see, what MCT can see, and what lenders can manage
- Cohi Lite entitlement definition, including which dashboards, chats, research labs, and insights are enabled, limited, or disabled
- Proposal for shared auth, invitations, and client mapping across the configurator and Cohi
- Proposed source of truth for Encompass token storage, refresh, and ownership
- Notes on how the token-sharing approach stays within ICE partner token guidance
- Recommended UX approach for the wrapper or shell experience
- Follow-up implementation ticket breakdown and phased rollout suggestion

Questions this spike should answer:
- Which path should ship first: partner portal or separate hosted apps with shared token brokerage?
- If separate hosted apps are chosen first, what would keep the door open for a later portal unification?
- What is the minimum viable Cohi Lite package for MCT-distributed lenders?
- Should MCT have support impersonation capabilities, and if so, under what audit controls?
- Which system owns lifecycle actions such as invite, suspend, upgrade, and offboard?
- What lender data, if any, is visible to MCT by default?

## Item 2

**Issue type:** Epic  
**Summary:** Multi-channel dashboards review & relabeling (TPO and other channels)  
**Owner:** Caitlin  
**Parent:** None

### Description

Owner: Caitlin

Review all dashboards in Cohi and determine what must change so they make sense across other lending channels beyond the current model.

Example:
For TPO channels, labels and concepts such as "Loan Officers" and "Branches" may need to become "Account Executives" and "Brokers." Similar changes may be needed elsewhere depending on channel context.

Deliverables:
- Inventory of all dashboards in scope
- Per-dashboard list of labels, filters, metrics, and groupings that need channel-aware treatment
- Recommendations on where simple relabeling is enough versus where a dashboard needs channel-specific logic or variants
- Notes on any reporting or UX risks caused by channel terminology differences

## Item 3

**Issue type:** Epic  
**Summary:** Section access: groups, roles, and per-group insights  
**Owner:** John and team  
**Parent:** None

### Description

Owner: John and team

Build out groups and roles in Cohi so a wider audience can use the platform without seeing data they should not have access to.

Core objectives:
- Support creation of groups and roles that can be preconfigured by branch or similar organizational unit
- Restrict access to sections, datasets, and insights based on those groups and roles
- Ensure users only see the data and insights appropriate for their assigned scope
- Allow broader platform adoption without exposing inappropriate data

Included considerations:
- Branch-based default groups
- Role and permission model
- Group assignment and administration workflows
- Insight generation tailored to each group or role
- Alignment with the multi-tenant and data-isolation model already documented in Cohi

Related reference:
- `docs/architecture/MULTI_TENANT.md`

## Item 4

**Issue type:** Task  
**Summary:** Automate client CSV upload & ingestion into Cohi data model  
**Owner:** John and team  
**Parent:** None

### Description

Owner: John and team

Find a way for clients to automatically upload CSV files and for Cohi to ingest those files into the platform data model.

Examples of source data:
- Servicing data
- Accounting data
- Other client-specific datasets the customer wants added to the model

Considerations to cover:
- Upload mechanism options such as SFTP, managed drop location, or direct secure upload
- Validation and schema contract for inbound files
- Mapping imported fields into the Cohi data model
- Error handling, retry behavior, and operational visibility
- Client isolation and permissions around file ingestion

Goal:
Reduce manual handling of external CSV datasets and make it easier to operationalize recurring client data feeds.

## Skipped Items

### Item 5

**Title:** CohiHQ - workflow  
**Owner:** Maylin  
**Status:** Skipped for now

Reason:
Scope is still TBD, so this item was intentionally not drafted into Jira-ready form yet.

## Next Steps

1. Review and edit the wording in this file.
2. Decide whether any of these should be broken into additional child tasks before Jira entry.
3. When ready, either paste them into Jira manually or ask me to create them through the Atlassian integration.
