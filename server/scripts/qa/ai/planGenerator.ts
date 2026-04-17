import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { redactToJson } from "../../../src/utils/aiRedactor.js";
import { TestPlanSchema, type ACStatement, type TestPlan } from "./types.js";
import type { LlmClient } from "./llm/openAiClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface GeneratePlanParams {
  issueKey: string;
  issueSummary: string;
  environment: string;
  statements: ACStatement[];
  llmClient: LlmClient;
}

export interface GeneratedPlanResult {
  plan: TestPlan;
  rawResponse: string;
  redactedInput: string;
  redactedOutput: string;
  tokensIn: number;
  tokensOut: number;
  modelName: string;
  fallbackUsed: boolean;
}

function readPromptFile(filename: string): string {
  return readFileSync(join(__dirname, "llm", "prompts", filename), "utf8");
}

function readFewShotExamples(): unknown {
  return JSON.parse(readPromptFile("planGenerator.fewshot.json"));
}

export async function generatePlan(params: GeneratePlanParams): Promise<GeneratedPlanResult> {
  const redactedInput = redactToJson({
    issueKey: params.issueKey,
    issueSummary: params.issueSummary,
    environment: params.environment,
    statements: params.statements.map((statement) => ({
      statement: statement.statement,
      category: statement.category,
      issueKey: params.issueKey,
      issueSummary: params.issueSummary,
      environment: params.environment,
    })),
  });

  const generated = await params.llmClient.generatePlan({
    systemPrompt: readPromptFile("planGenerator.system.md"),
    issueKey: params.issueKey,
    redactedAcText: redactedInput,
    fewShotExamples: readFewShotExamples(),
  });

  const plan = TestPlanSchema.parse(generated.plan);
  return {
    plan,
    rawResponse: generated.rawResponse,
    redactedInput,
    redactedOutput: redactToJson(generated.plan),
    tokensIn: generated.tokensIn,
    tokensOut: generated.tokensOut,
    modelName: generated.modelName,
    fallbackUsed: generated.fallbackUsed,
  };
}
