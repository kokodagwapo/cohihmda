# Cohi Jira Items - Draft for Review

- Date: 2026-04-20
- Status: Draft - for review
- Target Jira project: Cohi
- Assignment approach: Create unassigned; note intended owner in the description

## Summary

| Item | Type | Summary | Intended owner |
| --- | --- | --- | --- |
| 1 | Epic | Shared Encompass Token System (Cohi ↔ MCT Configurator) | Marko |
| 1a | Task | Design spike: shared Encompass token system (Cohi ↔ MCT) | Marko |
| 2 | Epic | Multi-channel dashboards review & relabeling (TPO and other channels) | Caitlin |
| 3 | Epic | Section access: groups, roles, and per-group insights | John and team |
| 4 | Task | Automate client CSV upload & ingestion into Cohi data model | John and team |

## Item 1

**Issue type:** Epic  
**Summary:** Shared Encompass Token System (Cohi ↔ MCT Configurator)  
**Owner:** Marko  
**Parent:** None

### Description

Owner: Marko

Problem:
Clients who live on both Cohi and the MCT Configurator are consuming Encompass tokens twice, which creates unnecessary token usage and needs to align with ICE partner guidelines.

Goal:
Build a shared token layer so both apps can reuse the same Encompass tokens for a given client, with centralized control over refresh and rotation behavior.

Context:
- The MCT Configurator work lives in a separate repo and board.
- This item is for the Cohi-side integration and the shared token contract between the two applications.
- The intent is to prevent overuse of Encompass tokens when the same client exists in both apps.

In scope:
- Shared token storage or service of record
- Auth contract between Cohi and MCT Configurator
- Refresh and rotation ownership
- Per-client token mapping
- Migration path for existing shared clients
- Usage tracking and visibility against ICE partner constraints

Out of scope:
- General MCT Configurator project spin-up work unrelated to shared token handling

## Item 1a

**Issue type:** Task  
**Summary:** Design spike: shared Encompass token system (Cohi ↔ MCT)  
**Owner:** Marko  
**Parent:** Item 1 - Shared Encompass Token System (Cohi ↔ MCT Configurator)

### Description

Owner: Marko

Create a short design and discovery package for the shared Encompass token approach between Cohi and the MCT Configurator.

Expected deliverables:
- Proposed source of truth for token storage
- Auth and access contract between the two apps
- Refresh and rotation ownership model
- Per-client mapping approach
- Migration approach for existing clients already using one or both systems
- Notes on how the approach stays within ICE partner token guidance
- Follow-up implementation ticket breakdown

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
