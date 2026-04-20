import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { redactToJson } from "../../../src/utils/aiRedactor.js";
import { TestPlanSchema, type ACStatement, type TestPlan } from "./types.js";
import type { LlmClient } from "./llm/openAiClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface PlanTestContext {
  /**
   * App-relative URL of a canvas that has already been seeded by the QA agent
   * and is safe to open during plan execution (e.g., `/workbench/<uuid>`).
   *
   * When present, the planner is instructed to prepend a `goto` to this URL
   * for any AC that asserts a canvas-scoped element, since `/my-dashboard`
   * and `/workbench` render the hub rather than a canvas.
   */
  seededCanvasUrl?: string;
}

export interface GeneratePlanParams {
  issueKey: string;
  issueSummary: string;
  environment: string;
  statements: ACStatement[];
  llmClient: LlmClient;
  testContext?: PlanTestContext;
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

function buildSelfCorrectionPrompt(basePrompt: string, zodErrors: z.ZodIssue[]): string {
  const errorLines = zodErrors.map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "(root)";
    return `- ${path}: ${issue.message} (code=${issue.code})`;
  });
  return [
    basePrompt,
    "",
    "A previous attempt produced a plan that FAILED schema validation with these errors:",
    ...errorLines,
    "",
    "Regenerate the full TestPlan so that every listed error is fixed. Pay special attention to per-step required fields: `api` steps MUST include both `path` and `expectStatus`. Return JSON only.",
  ].join("\n");
}

function buildTestContextPrompt(basePrompt: string, testContext: PlanTestContext): string {
  const lines: string[] = [];
  if (testContext.seededCanvasUrl) {
    lines.push(
      `- testContext.seededCanvasUrl = "${testContext.seededCanvasUrl}" (a workbench canvas owned by the QA agent; open this URL before asserting any canvas-scoped UI).`,
    );
  }
  if (lines.length === 0) {
    return basePrompt;
  }
  return [
    basePrompt,
    "",
    "Runtime test context for this plan:",
    ...lines,
  ].join("\n");
}

export async function generatePlan(params: GeneratePlanParams): Promise<GeneratedPlanResult> {
  const redactedInput = redactToJson({
    issueKey: params.issueKey,
    issueSummary: params.issueSummary,
    environment: params.environment,
    testContext: params.testContext,
    statements: params.statements.map((statement) => ({
      statement: statement.statement,
      category: statement.category,
      issueKey: params.issueKey,
      issueSummary: params.issueSummary,
      environment: params.environment,
    })),
  });

  const fileSystemPrompt = readPromptFile("planGenerator.system.md");
  const baseSystemPrompt = params.testContext
    ? buildTestContextPrompt(fileSystemPrompt, params.testContext)
    : fileSystemPrompt;
  const fewShot = readFewShotExamples();

  const generated = await params.llmClient.generatePlan({
    systemPrompt: baseSystemPrompt,
    issueKey: params.issueKey,
    redactedAcText: redactedInput,
    fewShotExamples: fewShot,
  });

  const firstParse = TestPlanSchema.safeParse(generated.plan);
  if (firstParse.success) {
    return {
      plan: firstParse.data,
      rawResponse: generated.rawResponse,
      redactedInput,
      redactedOutput: redactToJson(generated.plan),
      tokensIn: generated.tokensIn,
      tokensOut: generated.tokensOut,
      modelName: generated.modelName,
      fallbackUsed: generated.fallbackUsed,
    };
  }

  // One-shot self-correction: feed the validation errors back to the model
  // so it can produce a compliant plan. This recovers from common mistakes
  // like dropped required fields without failing the entire AC validation.
  const issues = firstParse.error.issues;
  console.log(
    `[planGenerator] First plan for ${params.issueKey} failed schema (${issues.length} issue(s)); attempting self-correction...`,
  );
  const repaired = await params.llmClient.generatePlan({
    systemPrompt: buildSelfCorrectionPrompt(baseSystemPrompt, issues),
    issueKey: params.issueKey,
    redactedAcText: redactedInput,
    fewShotExamples: fewShot,
  });

  const plan = TestPlanSchema.parse(repaired.plan);
  return {
    plan,
    rawResponse: repaired.rawResponse,
    redactedInput,
    redactedOutput: redactToJson(repaired.plan),
    tokensIn: generated.tokensIn + repaired.tokensIn,
    tokensOut: generated.tokensOut + repaired.tokensOut,
    modelName: repaired.modelName,
    fallbackUsed: generated.fallbackUsed || repaired.fallbackUsed,
  };
}
