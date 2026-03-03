# Workbench and Widget Rules

## Dynamic Filters vs. Default Filters

### 1. Default Filters Must Not Appear in "Add Filter" List
- When a section type has **default/built-in filters** that filter by a **specific dimension value** (e.g. "Loan Status" = Active/Funded/All), that dimension must **not** be offered again in the "Add filter" (dynamic filter) picker.
- **Important distinction:** A dropdown that chooses **what type of entity or actor to group by** (e.g. "Entity: Branch vs Channel vs Investor", "Actor: Loan Officer vs Account Executive") is **not** the same as a filter that restricts to a **specific value** (e.g. "Branch = 1000", "Loan Officer = John Smith"). The latter (Branch, Loan Officer, Channel, Investor as specific-value filters) are valid options in the "Add filter" list and must **not** be in `SECTION_BUILTIN_FILTER_COLUMNS` unless they are literally the same UI control (e.g. a dedicated "Branch" dropdown with distinct values). Only exclude dimensions that are already exposed as a default filter controlling the same thing (e.g. "Loan Status" dropdown → exclude `current_loan_status`).

### 2. Where This Is Configured
- In `WidgetGroup.tsx`, the list of built-in dimension columns per section is **`SECTION_BUILTIN_FILTER_COLUMNS`**. Each key is a `SectionType`; each value is an array of **API column names** (same as in `AVAILABLE_FILTER_DIMENSIONS`).
- **Rule:** Only add a dimension here if the section already has a default filter in the UI that filters by that same dimension (e.g. Loan Status dropdown). Do **not** add dimensions that are only used as "entity/actor type" selectors (e.g. for pricing-dashboard, do not add branch, loan_officer, channel, investor_name; only add current_loan_status).

### 3. When Adding a New Section Type or New Default Filters
- If you add a new section type with its own filter row, add to `SECTION_BUILTIN_FILTER_COLUMNS[sectionType]` only those dimensions that are **already default filters** (dropdowns that filter by specific dimension values).
- If you add a new default filter that filters by a specific dimension value (e.g. a "Loan Status" dropdown), add the corresponding API column name to `SECTION_BUILTIN_FILTER_COLUMNS` for that section.

### 4. How `existingColumns` Is Built for AddFilterPicker
- When rendering `AddFilterPicker`, `existingColumns` must include:
  1. Any `optionsSource` columns from `SECTION_FILTER_CONFIG[sectionType]` (for data-driven sections),
  2. `SECTION_BUILTIN_FILTER_COLUMNS[sectionType]`,
  3. Already-added dynamic filters: `(filters.dynamicFilters || []).map((f) => f.column)`.
- This ensures default filters and already-added dynamic filters are never offered again in the picker.
