/**
 * Agent Persona Definitions
 *
 * Defines the two workbench agent personas (Data Scientist and Mortgage Expert)
 * and their associated knowledge categories, prompt config IDs, and suggested
 * starter questions.
 *
 * These are also exported for use in the frontend via the /api/cohi-chat/personas
 * endpoint so the WorkbenchCohiPanel can render the persona selector without
 * hardcoding values client-side.
 */

export type AgentPersonaId = "data-scientist" | "mortgage-expert";

export interface AgentPersona {
  id: AgentPersonaId;
  name: string;
  description: string;
  /** Lucide icon name for use in UI */
  icon: string;
  /** Prompt config ID used to load the persona supplement from defaultPromptConfigs */
  promptConfigId: string;
  /** Knowledge center categories to scope RAG retrieval to */
  knowledgeCategories: string[];
  /** Starter suggested questions shown in the empty panel state */
  suggestedQuestions: string[];
}

export const AGENT_PERSONAS: Record<AgentPersonaId, AgentPersona> = {
  "data-scientist": {
    id: "data-scientist",
    name: "Data Scientist",
    description: "Statistical analysis, distributions, outliers, and trend decomposition",
    icon: "flask-conical",
    promptConfigId: "cohi_workbench.data_scientist",
    knowledgeCategories: ["Analytics", "Market Intel"],
    suggestedQuestions: [
      "Analyze the distribution of loan amounts by product type",
      "What statistical outliers exist in processing times this quarter?",
      "Show the correlation between credit scores and pull-through rates",
      "Build a trend analysis of monthly volume with percentile breakdown",
      "Which loan officers have abnormal cycle time variance?",
    ],
  },
  "mortgage-expert": {
    id: "mortgage-expert",
    name: "Mortgage Expert",
    description: "Compliance, pipeline management, industry benchmarks, and executive narratives",
    icon: "landmark",
    promptConfigId: "cohi_workbench.mortgage_expert",
    knowledgeCategories: ["Regulations", "Guidelines", "Compliance", "Products", "Policy"],
    suggestedQuestions: [
      "Show me loans at risk of lock expiration this week",
      "What does our denial rate look like by product type?",
      "Build a TRID compliance timing dashboard",
      "Analyze pipeline velocity by loan officer vs. prior month",
      "Which products have the highest fallout rate?",
    ],
  },
};

/** Ordered list for UI rendering */
export const AGENT_PERSONA_LIST: AgentPersona[] = Object.values(AGENT_PERSONAS);

/** Default persona for new workbench sessions */
export const DEFAULT_PERSONA_ID: AgentPersonaId = "mortgage-expert";
