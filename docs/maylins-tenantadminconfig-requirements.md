1. Purpose 

The Coheus Cohi Mapping Tool enables lenders to self-service map their Loan Origination System (LOS) data to the Coheus data dictionary. It supports schema extraction, intelligent auto-mapping, dictionary extension, field substitution, role-based filters, guideline-driven range rules, and configurable scoring weights. The tool powers Cohi’s daily insights, dashboards, alerts, and prioritization logic. 

2. In Scope 

- LOS schema extraction and auto-mapping 
- Add and manage additional LOS data fields 
- Swap and override default Coheus dictionary fields 
- Filter creation with role/persona governance 
- Range editor for guideline and outlier highlighting 
- Weight management for TopTiering Score and Loan Complexity 
- Versioning, audit, and governance controls 

3. Users and Personas 

• Lender Admin – Owns mappings, filters, ranges, and scoring weights 
• Operations Manager – Manages operational filters and complexity rules 
• Sales Manager – Consumes TopTiering insights and prioritization 
• Executive – Views summarized insights and trends 
• Analyst / Power User – Builds dashboards and saved views 
• Coheus Support – Read-only or assisted access (audited) 

4. LOS Schema Extraction and Auto-Mapping 

The system shall extract LOS schemas including field IDs, labels, data types, entities, enumerations, and usage indicators. Cohi shall identify fields actively used by the lender and automatically map them to the default Coheus data dictionary using exact, fuzzy, and semantic matching. Each mapping shall include a confidence score and be reviewable prior to publishing. 

5. Additional LOS Data Fields 

Lenders shall be able to add additional LOS fields beyond the default dictionary. Added fields must include metadata, formatting rules, and role-based visibility controls. These fields may be used in dashboards, filters, insights, and scoring models where enabled. 

6. Swap and Override Dictionary Fields 

Lenders may replace the LOS field feeding a default Coheus dictionary element. Swaps must validate data compatibility and preview impact on dashboards and insights. All changes must be versioned with rollback support and audit history. 

7. Filters and Persona Management 

Users with permission may create filters on any enabled data field using numeric, categorical, date, and logical operators. Filters can be scoped to individuals, teams, personas, or organization-wide use. Admins control visibility and lock standard filters. 

8. Range Editor and Guideline Highlighting 

The Range Editor allows lenders to define thresholds for key fields such as LTV, DTI, FICO, Loan Amount, and Interest Rate. Violations trigger visual indicators (e.g., red font), tooltips, and Cohi alerts. Rules may vary by product, channel, occupancy, and loan purpose, and are fully versioned and auditable. 

9. Scoring Weights Management 

The tool shall allow lenders to manage weighted scoring models for TopTiering Score and Loan Complexity. Weights are configurable separately for Sales and Operations personas. The system enforces total-weight validation, provides impact previews, and versions all scoring configurations. 

10. Governance, Versioning, and Audit 

All mappings, filters, ranges, and scoring configurations must support draft and published states, version history, rollback, and full audit logs including user, timestamp, and rationale. 

11. Non-Functional Requirements 

• Role-based access control (RBAC) 
• Tenant isolation 
• Encryption in transit and at rest 
• Deterministic and explainable scoring 
• Performance SLAs for schema extraction and publishing 
• High availability and fault tolerance 