/**
 * Research Lab widget catalog snapshot (client-built, server-stored on session).
 */

export interface ResearchWidgetCatalogMetaEntry {
  id: string;
  name: string;
  dataSource: string;
  dashboardPath: string;
  dashboardLabel: string;
  sectionId?: string;
}

export interface ResearchWidgetContext {
  catalog: string;
  meta: ResearchWidgetCatalogMetaEntry[];
}
