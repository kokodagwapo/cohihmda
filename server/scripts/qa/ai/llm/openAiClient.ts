import { postOpenAIChatCompletions } from "../../../../src/services/openai/chatCompletionsCompat.js";
import { TEST_PLAN_JSON_SCHEMA } from "../types.js";

export interface GeneratePlanInput {
  systemPrompt: string;
  issueKey: string;
  redactedAcText: string;
  fewShotExamples?: unknown;
}

export interface GeneratePlanOutput {
  rawResponse: string;
  plan: unknown;
  tokensIn: number;
  tokensOut: number;
  modelName: string;
  fallbackUsed: boolean;
}

export interface LlmClient {
  generatePlan(input: GeneratePlanInput): Promise<GeneratePlanOutput>;
}

function getConfiguredModel(): { primary: string; fallback: string } {
  return {
    primary: process.env.QA_AC_OPENAI_MODEL || "gpt-5.4",
    fallback: process.env.QA_AC_OPENAI_FALLBACK_MODEL || "gpt-5.3",
  };
}

function getOpenAiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for AI AC validation");
  }
  return apiKey;
}

async function requestPlan(model: string, input: GeneratePlanInput): Promise<Response> {
  const apiKey = getOpenAiKey();
  return postOpenAIChatCompletions(
    apiKey,
    {
      model,
      temperature: 0,
      messages: [
        { role: "system", content: input.systemPrompt },
        ...(input.fewShotExamples
          ? [{ role: "system", content: `Few-shot examples:\n${JSON.stringify(input.fewShotExamples)}` }]
          : []),
        {
          role: "user",
          content: JSON.stringify({
            issueKey: input.issueKey,
            acceptanceCriteria: input.redactedAcText,
          }),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "TestPlan",
          schema: TEST_PLAN_JSON_SCHEMA,
          strict: true,
        },
      },
    },
    4000,
  );
}

async function parseErrorMessage(response: Response): Promise<string> {
  const payload = await response.json().catch(() => ({}));
  return String(payload?.error?.message ?? response.statusText ?? "Unknown OpenAI error");
}

async function parseSuccessResponse(response: Response): Promise<{
  rawResponse: string;
  plan: unknown;
  tokensIn: number;
  tokensOut: number;
}> {
  const payload = await response.json().catch(() => ({}));
  const message = payload?.choices?.[0]?.message;
  const rawResponse =
    typeof message?.content === "string"
      ? message.content
      : typeof payload?.choices?.[0]?.message === "string"
        ? payload.choices[0].message
        : JSON.stringify(message ?? {});

  let plan: unknown;
  try {
    plan = JSON.parse(rawResponse);
  } catch {
    plan = payload?.choices?.[0]?.message?.parsed ?? {};
  }

  return {
    rawResponse,
    plan,
    tokensIn: Number(payload?.usage?.prompt_tokens ?? 0),
    tokensOut: Number(payload?.usage?.completion_tokens ?? 0),
  };
}

export class OpenAiLlmClient implements LlmClient {
  async generatePlan(input: GeneratePlanInput): Promise<GeneratePlanOutput> {
    const { primary, fallback } = getConfiguredModel();

    const primaryResponse = await requestPlan(primary, input);
    if (primaryResponse.ok) {
      const parsed = await parseSuccessResponse(primaryResponse);
      return { ...parsed, modelName: primary, fallbackUsed: false };
    }

    const primaryError = await parseErrorMessage(primaryResponse);
    const shouldFallback =
      fallback &&
      fallback !== primary &&
      /model|not found|does not exist|unsupported/i.test(primaryError);

    if (!shouldFallback) {
      throw new Error(`OpenAI plan generation failed for ${primary}: ${primaryError}`);
    }

    const fallbackResponse = await requestPlan(fallback, input);
    if (!fallbackResponse.ok) {
      const fallbackError = await parseErrorMessage(fallbackResponse);
      throw new Error(
        `OpenAI plan generation failed for ${primary} and fallback ${fallback}: ${fallbackError}`,
      );
    }

    const parsed = await parseSuccessResponse(fallbackResponse);
    return { ...parsed, modelName: fallback, fallbackUsed: true };
  }
}
