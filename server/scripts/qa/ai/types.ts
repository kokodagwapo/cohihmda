import { z } from "zod";

export const AC_CATEGORY_VALUES = ["ROUTE", "UI", "API", "ASSERTION", "STATE"] as const;
export const AcCategorySchema = z.enum(AC_CATEGORY_VALUES);

export const AcStatementSchema = z.object({
  index: z.number().int().positive(),
  category: AcCategorySchema,
  statement: z.string().min(1),
  raw: z.string().min(1),
});

export type ACStatement = z.infer<typeof AcStatementSchema>;

export const GotoStepSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("goto"),
  url: z.string().min(1),
  expect: z.object({
    locator: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
  }),
});

export const ApiStepSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("api"),
  method: z.enum(["GET", "HEAD"]),
  path: z.string().min(1),
  expectStatus: z.number().int().min(100).max(599),
});

export const ClickStepSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("click"),
  locator: z.string().min(1),
  expect: z.object({
    locator: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
  }),
});

export const FillStepSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("fill"),
  locator: z.string().min(1),
  value: z.string(),
  expect: z.object({
    locator: z.string().min(1).optional(),
  }).optional(),
});

export const AssertStepSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("assert"),
  locator: z.string().min(1),
  toBeVisible: z.boolean().optional(),
  toContainText: z.string().min(1).optional(),
});

export const PlanStepSchema = z.discriminatedUnion("kind", [
  GotoStepSchema,
  ApiStepSchema,
  ClickStepSchema,
  FillStepSchema,
  AssertStepSchema,
]);

export type PlanStep = z.infer<typeof PlanStepSchema>;

export const TestPlanSchema = z.object({
  planVersion: z.literal(1),
  issueKey: z.string().min(1),
  modelName: z.string().min(1),
  modelTemperature: z.literal(0),
  generatedAt: z.string().min(1),
  steps: z.array(PlanStepSchema).min(1),
});

export type TestPlan = z.infer<typeof TestPlanSchema>;

export const TEST_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["planVersion", "issueKey", "modelName", "modelTemperature", "generatedAt", "steps"],
  properties: {
    planVersion: { type: "integer", enum: [1] },
    issueKey: { type: "string" },
    modelName: { type: "string" },
    modelTemperature: { type: "integer", enum: [0] },
    generatedAt: { type: "string" },
    steps: {
      type: "array",
      minItems: 1,
      items: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["id", "kind", "url", "expect"],
            properties: {
              id: { type: "string" },
              kind: { const: "goto" },
              url: { type: "string" },
              expect: {
                type: "object",
                additionalProperties: false,
                properties: {
                  locator: { type: "string" },
                  text: { type: "string" },
                },
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["id", "kind", "method", "path", "expectStatus"],
            properties: {
              id: { type: "string" },
              kind: { const: "api" },
              method: { type: "string", enum: ["GET", "HEAD"] },
              path: { type: "string" },
              expectStatus: { type: "integer" },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["id", "kind", "locator", "expect"],
            properties: {
              id: { type: "string" },
              kind: { const: "click" },
              locator: { type: "string" },
              expect: {
                type: "object",
                additionalProperties: false,
                properties: {
                  locator: { type: "string" },
                  url: { type: "string" },
                },
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["id", "kind", "locator", "value"],
            properties: {
              id: { type: "string" },
              kind: { const: "fill" },
              locator: { type: "string" },
              value: { type: "string" },
              expect: {
                type: "object",
                additionalProperties: false,
                properties: {
                  locator: { type: "string" },
                },
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["id", "kind", "locator"],
            properties: {
              id: { type: "string" },
              kind: { const: "assert" },
              locator: { type: "string" },
              toBeVisible: { type: "boolean" },
              toContainText: { type: "string" },
            },
          },
        ],
      },
    },
  },
} as const;

export const StepExecutionResultSchema = z.object({
  stepId: z.string(),
  status: z.enum(["passed", "failed"]),
  screenshotPath: z.string().optional(),
  error: z.string().optional(),
  observedStatus: z.number().int().optional(),
});

export type StepExecutionResult = z.infer<typeof StepExecutionResultSchema>;

export const StatementResultSchema = z.object({
  index: z.number().int().positive(),
  category: AcCategorySchema,
  statement: z.string(),
  status: z.enum(["passed", "failed", "inconclusive", "parse_error", "rejected"]),
  stepIds: z.array(z.string()),
  error: z.string().optional(),
  evidenceLinks: z.array(z.string()).default([]),
});

export type StatementResult = z.infer<typeof StatementResultSchema>;

export const IssueAcValidationResultSchema = z.object({
  issueKey: z.string(),
  issueSummary: z.string(),
  status: z.enum(["passed", "failed", "inconclusive", "parse_error", "rejected"]),
  statements: z.array(StatementResultSchema),
  modelName: z.string().optional(),
  modelTemperature: z.number().optional(),
  tokensIn: z.number().int().nonnegative().optional(),
  tokensOut: z.number().int().nonnegative().optional(),
  promptHash: z.string().optional(),
  planHash: z.string().optional(),
  resultHash: z.string().optional(),
  approvalStatus: z.string().optional(),
  confluenceSummary: z.string().optional(),
  screenshotPaths: z.array(z.string()).default([]),
});

export type IssueAcValidationResult = z.infer<typeof IssueAcValidationResultSchema>;
