/**
 * Onboarding Chat Agent
 *
 * Interactive agent loop for Phase 2 of the onboarding flow. After the automated
 * analysis, the admin chats with this agent to finalize field mappings, revenue
 * formulas, scoring weights, and additional fields.
 *
 * Reuses the data analyst agent loop pattern with onboarding-specific tools.
 */

import pg from "pg";
import {
  callLLM,
  safeExecuteSQL,
  getSchemaContext,
  getOpenAIKey,
  formatResultsForLLM,
  type LLMMessage,
} from "../research/tools.js";
import type { OnboardingAnalysis } from "./onboardingAnalysisAgent.js";
import { AdditionalFieldService } from "../additionalFieldService.js";
import { saveFieldSwap } from "../encompassFieldMapper.js";

// ============================================================================
// Types
// ============================================================================

export interface ChatEvent {
  type: "thinking" | "tool_call" | "tool_result" | "response" | "action_card" | "error";
  message?: string;
  data?: any;
  timestamp: number;
}

export type OnChatEvent = (event: ChatEvent) => void;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface OnboardingChatParams {
  tenantId: string;
  connectionId: string;
  tenantPool: pg.Pool;
  userMessage: string;
  chatHistory: ChatMessage[];
  analysis: OnboardingAnalysis | null;
  onEvent: OnChatEvent;
}

// Tool action types emitted as action cards
export interface ActionCard {
  id: string;
  tool: string;
  description: string;
  params: Record<string, any>;
  status: "proposed" | "applied" | "rejected";
}

// ============================================================================
// System Prompt
// ============================================================================

function buildSystemPrompt(
  analysis: OnboardingAnalysis | null,
  schemaContext: string
): string {
  const analysisSection = analysis
    ? [
        "\n## Prior Analysis Results",
        `Summary: ${analysis.summary}`,
        analysis.fieldSwapRecommendations.length > 0
          ? `\n### Field Swap Recommendations (${analysis.fieldSwapRecommendations.length}):\n${analysis.fieldSwapRecommendations
              .map(
                (r) =>
                  `- "${r.coheusAlias}" → ${r.recommendedFieldId} (confidence=${r.confidence}%, pop=${r.currentPopulation}%) — ${r.reasoning}${r.sampleValues?.length ? ` [samples: ${r.sampleValues.join(", ")}]` : ""}`
              )
              .join("\n")}`
          : "\nNo field swap recommendations (current mappings look good).",
        analysis.revenueFieldCandidates.length > 0
          ? `\n### Revenue Field Candidates (${analysis.revenueFieldCandidates.length}):\n${analysis.revenueFieldCandidates
              .map(
                (r) =>
                  `- ${r.fieldId} (${r.fieldDescription}) → ${r.detectedRole}, pop=${r.populationRate}%`
              )
              .join("\n")}`
          : "",
        analysis.suggestedAdditionalFields.length > 0
          ? `\n### Suggested Additional Fields (${analysis.suggestedAdditionalFields.length}):\n${analysis.suggestedAdditionalFields
              .map(
                (r) =>
                  `- ${r.fieldId}: "${r.description}" (pop=${r.populationRate}%) — ${r.reason}`
              )
              .join("\n")}`
          : "",
        analysis.dataQualityFlags.length > 0
          ? `\n### Data Quality Flags (${analysis.dataQualityFlags.length}):\n${analysis.dataQualityFlags
              .map((f) => `- [${f.severity}] ${f.field}: ${f.issue} → ${f.recommendation}`)
              .join("\n")}`
          : "",
      ].join("\n")
    : "\n(No prior analysis available)";

  return `You are an onboarding configuration assistant for Coheus, a mortgage analytics platform. You help administrators finalize their Encompass LOS integration setup.

You have access to the following tools (call them by responding with JSON):

TOOLS:
1. "apply_field_swaps" - Apply field mapping swaps.
   Params: { "swaps": [{ "coheusAlias": "string", "fieldId": "string" }] }
   
2. "set_revenue_formula" - Set the tenant's revenue calculation formula.
   Params: { "components": [{ "name": "string", "field": "string", "operator": "+" | "-", "description": "string" }] }
   
3. "update_scoring_weights" - Update sales scorecard weights.
   Params: { "scorecardType": "string", "weights": [{ "metric_name": "string", "weight": "number 0-100", "description": "string" }] }
   
4. "add_additional_field" - Add a custom field to the analytics schema.
   Params: { "losFieldId": "string", "displayName": "string", "dataType": "string | number | date | boolean | currency | percentage", "description": "string" }
   
5. "query_data" - Execute a read-only SQL query against the tenant's data for exploration.
   Params: { "sql": "string", "explanation": "string" }

RESPONSE FORMAT:
Respond in JSON:
{
  "thinking": "Your internal reasoning (shown to the admin as a thinking indicator)",
  "action": "respond" | "tool",
  "tool": "tool_name (only when action=tool)",
  "params": { ... tool params (only when action=tool) },
  "message": "Your response message to the admin (always include, even with tool calls)"
}

GUIDELINES:
- Be conversational and helpful. Explain your recommendations.
- When proposing config changes, describe what you'll do and why before calling the tool.
- Include an "action_card" in your message when you propose a configuration change.
- Max 3 tool calls per conversation turn to keep responses focused.
- For query_data, only SELECT queries are allowed.
- When asked about data, use query_data to check actual values before making recommendations.
- Always provide context about population rates and sample values.
- If the admin says a recommendation is wrong (e.g., "Loan Amount is already right"), acknowledge it, explain why the analysis may have flagged it, and remove it from consideration.
- Use query_data proactively when discussing specific fields — e.g., check what values a field actually contains before recommending a swap.
- Be aware that Encompass field IDs map to specific meanings: e.g. Fields.2 = Loan Amount, Fields.1109 = Base Loan Amount. Don't confuse them.
- The admin is the domain expert. If they say a field is correct, trust them. Focus on fields they want help with.

${analysisSection}

## Database Schema
${schemaContext}`;
}

// ============================================================================
// Tool Executors
// ============================================================================

async function executeApplyFieldSwaps(
  tenantPool: pg.Pool,
  connectionId: string,
  params: { swaps: Array<{ coheusAlias: string; fieldId: string }> }
): Promise<string> {
  let applied = 0;
  const errors: string[] = [];

  for (const swap of params.swaps) {
    try {
      await saveFieldSwap(
        tenantPool,
        connectionId,
        swap.coheusAlias,
        swap.fieldId
      );
      applied++;
    } catch (err: any) {
      errors.push(`${swap.coheusAlias}: ${err.message}`);
    }
  }

  return errors.length > 0
    ? `Applied ${applied}/${params.swaps.length} swaps. Errors: ${errors.join("; ")}`
    : `Successfully applied ${applied} field swap(s).`;
}

async function executeSetRevenueFormula(
  tenantPool: pg.Pool,
  userId: string,
  params: {
    components: Array<{
      name: string;
      field: string;
      operator: "+" | "-";
      description: string;
    }>;
  }
): Promise<string> {
  try {
    // Deactivate existing revenue formulas
    await tenantPool.query(
      `UPDATE public.tenant_calculations
       SET is_active = FALSE, updated_at = NOW()
       WHERE calculation_type = 'revenue' AND is_active = TRUE`
    );

    // Build SQL expression from components
    const sqlParts = params.components.map(
      (c, i) =>
        i === 0
          ? `COALESCE(${c.field}, 0)`
          : `${c.operator} COALESCE(${c.field}, 0)`
    );
    const sqlExpression = sqlParts.join(" ");

    await tenantPool.query(
      `INSERT INTO public.tenant_calculations
         (calculation_type, name, description, formula_components, sql_expression, is_active, created_by, updated_by)
       VALUES ('revenue', 'Revenue Formula', 'Auto-configured via onboarding agent', $1, $2, TRUE, $3, $3)
       ON CONFLICT (calculation_type, name)
       DO UPDATE SET
         formula_components = EXCLUDED.formula_components,
         sql_expression = EXCLUDED.sql_expression,
         is_active = TRUE,
         is_validated = FALSE,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      [JSON.stringify(params.components), sqlExpression, userId]
    );

    return `Revenue formula set with ${params.components.length} component(s): ${params.components.map((c) => `${c.operator === "-" ? "-" : "+"}${c.name}`).join(" ")}`;
  } catch (err: any) {
    return `Error setting revenue formula: ${err.message}`;
  }
}

async function executeUpdateScoringWeights(
  tenantPool: pg.Pool,
  userId: string,
  params: {
    scorecardType: string;
    weights: Array<{
      metric_name: string;
      weight: number;
      description?: string;
    }>;
  }
): Promise<string> {
  let updated = 0;
  for (const w of params.weights) {
    try {
      await tenantPool.query(
        `INSERT INTO public.scoring_weights
           (scorecard_type, persona_id, metric_name, weight, description, created_by)
         VALUES ($1, NULL, $2, $3, $4, $5)
         ON CONFLICT (scorecard_type, metric_name) WHERE persona_id IS NULL
         DO UPDATE SET weight = $3, description = COALESCE($4, scoring_weights.description), updated_at = NOW()`,
        [
          params.scorecardType,
          w.metric_name,
          w.weight,
          w.description || null,
          userId,
        ]
      );
      updated++;
    } catch (err: any) {
      console.error(`[OnboardingChat] Error setting weight ${w.metric_name}:`, err.message);
    }
  }
  return `Updated ${updated}/${params.weights.length} scoring weight(s) for ${params.scorecardType}.`;
}

async function executeAddAdditionalField(
  tenantPool: pg.Pool,
  connectionId: string,
  userId: string,
  params: {
    losFieldId: string;
    displayName: string;
    dataType: string;
    description?: string;
  }
): Promise<string> {
  try {
    const svc = new AdditionalFieldService(tenantPool);
    const field = await svc.createField({
      losConnectionId: connectionId,
      losFieldId: params.losFieldId,
      displayName: params.displayName,
      dataType: params.dataType as any,
      description: params.description,
      createdBy: userId,
    });
    return `Added additional field "${params.displayName}" (${params.losFieldId}) as column ${field.columnName}.`;
  } catch (err: any) {
    return `Error adding additional field: ${err.message}`;
  }
}

async function executeQueryData(
  tenantPool: pg.Pool,
  params: { sql: string; explanation: string }
): Promise<string> {
  try {
    const result = await safeExecuteSQL(params.sql, tenantPool);
    return `Query returned ${result.rowCount} rows (${result.executionTimeMs}ms):\n${formatResultsForLLM(result)}`;
  } catch (err: any) {
    return `SQL Error: ${err.message}`;
  }
}

// ============================================================================
// Agent Loop
// ============================================================================

const MAX_ITERATIONS = 3;

export async function runOnboardingChat(
  params: OnboardingChatParams
): Promise<void> {
  const {
    tenantId,
    connectionId,
    tenantPool,
    userMessage,
    chatHistory,
    analysis,
    onEvent,
  } = params;

  const emit = (
    type: ChatEvent["type"],
    message?: string,
    data?: any
  ) => {
    onEvent({ type, message, data, timestamp: Date.now() });
  };

  const apiKey = await getOpenAIKey(tenantId);
  const schemaContext = await getSchemaContext(tenantId);
  const systemPrompt = buildSystemPrompt(analysis, schemaContext);

  // Build conversation
  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
  ];

  // Add chat history
  for (const msg of chatHistory) {
    messages.push({
      role: msg.role === "user" ? "user" : "assistant",
      content: msg.content,
    });
  }

  // Add current user message
  messages.push({ role: "user", content: userMessage });

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    emit("thinking", "Analyzing your request...");

    const raw = await callLLM(messages, apiKey, {
      temperature: 0.3,
      maxTokens: 3000,
      jsonMode: true,
    });

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // LLM returned invalid JSON — try to extract just the message if there's a
      // recognizable "message" field, otherwise emit the raw text cleaned up.
      const msgMatch = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      const fallback = msgMatch
        ? msgMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"')
        : raw.replace(/^\{.*?"message"\s*:\s*"|"\s*\}$/g, "").trim() || raw;
      emit("response", fallback);
      return;
    }

    if (parsed.thinking) {
      emit("thinking", parsed.thinking);
    }

    // Handle tool call
    if (parsed.action === "tool" && parsed.tool) {
      emit("tool_call", `Calling ${parsed.tool}...`, {
        tool: parsed.tool,
        params: parsed.params,
      });

      let toolResult: string;

      switch (parsed.tool) {
        case "apply_field_swaps":
          toolResult = await executeApplyFieldSwaps(
            tenantPool,
            connectionId,
            parsed.params
          );
          emit("action_card", parsed.message || "Applying field swaps", {
            id: `action-${Date.now()}`,
            tool: "apply_field_swaps",
            description: `Applied ${parsed.params?.swaps?.length || 0} field swap(s)`,
            params: parsed.params,
            status: "applied",
          });
          break;

        case "set_revenue_formula":
          toolResult = await executeSetRevenueFormula(
            tenantPool,
            "system",
            parsed.params
          );
          emit("action_card", parsed.message || "Setting revenue formula", {
            id: `action-${Date.now()}`,
            tool: "set_revenue_formula",
            description: `Revenue formula with ${parsed.params?.components?.length || 0} component(s)`,
            params: parsed.params,
            status: "applied",
          });
          break;

        case "update_scoring_weights":
          toolResult = await executeUpdateScoringWeights(
            tenantPool,
            "system",
            parsed.params
          );
          emit("action_card", parsed.message || "Updating scoring weights", {
            id: `action-${Date.now()}`,
            tool: "update_scoring_weights",
            description: `Updated ${parsed.params?.weights?.length || 0} weight(s)`,
            params: parsed.params,
            status: "applied",
          });
          break;

        case "add_additional_field":
          toolResult = await executeAddAdditionalField(
            tenantPool,
            connectionId,
            "system",
            parsed.params
          );
          emit("action_card", parsed.message || "Adding additional field", {
            id: `action-${Date.now()}`,
            tool: "add_additional_field",
            description: `Added ${parsed.params?.displayName || "field"}`,
            params: parsed.params,
            status: "applied",
          });
          break;

        case "query_data":
          toolResult = await executeQueryData(tenantPool, parsed.params);
          emit("tool_result", `Query result for: ${parsed.params?.explanation || "data check"}`, {
            sql: parsed.params?.sql,
            result: toolResult,
          });
          break;

        default:
          toolResult = `Unknown tool: ${parsed.tool}`;
      }

      // Feed tool result back and continue loop
      messages.push(
        { role: "assistant", content: raw },
        {
          role: "user",
          content: `Tool result for ${parsed.tool}:\n${toolResult}\n\nNow provide your response to the admin. If you need to call another tool, do so. Otherwise, set action to "respond".`,
        }
      );

      // If there's already a user-facing message, emit it
      if (parsed.message && parsed.tool !== "query_data") {
        emit("response", parsed.message);
      }

      continue;
    }

    // Final response
    emit("response", parsed.message || "I'm not sure how to help with that. Could you rephrase?");
    return;
  }

  // Fallback if max iterations reached
  emit(
    "response",
    "I've completed my analysis. Let me know if you need any other changes!"
  );
}
