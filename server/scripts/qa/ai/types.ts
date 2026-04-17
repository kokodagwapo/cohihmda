import { z } from "zod";

export const AC_CATEGORY_VALUES = [
  "ROUTE",
  "UI",
  "API",
  "ASSERTION",
  "STATE",
  "MUTATION",
] as const;
export const AcCategorySchema = z.enum(AC_CATEGORY_VALUES);

export const STEP_SCOPE_VALUES = ["readonly", "self_scoped", "broad_scope"] as const;
export const StepScopeSchema = z.enum(STEP_SCOPE_VALUES);
export type StepScope = z.infer<typeof StepScopeSchema>;

export const API_METHOD_VALUES = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;
export const ApiMethodSchema = z.enum(API_METHOD_VALUES);
export type ApiMethod = z.infer<typeof ApiMethodSchema>;

const BaseStepSchema = z.object({
  id: z.string().min(1),
  requiresElevation: z.boolean().optional(),
  scope: StepScopeSchema.optional(),
});

const StepExpectationSchema = z.object({
  locator: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
});

export const AcStatementSchema = z.object({
  index: z.number().int().positive(),
  category: AcCategorySchema,
  statement: z.string().min(1),
  raw: z.string().min(1),
});

export type ACStatement = z.infer<typeof AcStatementSchema>;

export const GotoStepSchema = BaseStepSchema.extend({
  kind: z.literal("goto"),
  url: z.string().min(1),
  expect: StepExpectationSchema.default({}),
});

export const ApiStepSchema = BaseStepSchema.extend({
  kind: z.literal("api"),
  method: ApiMethodSchema,
  path: z.string().min(1),
  expectStatus: z.number().int().min(100).max(599),
  body: z.record(z.unknown()).optional(),
  expectBodyContains: z.string().min(1).optional(),
});

export const ClickStepSchema = BaseStepSchema.extend({
  kind: z.literal("click"),
  locator: z.string().min(1),
  expect: StepExpectationSchema.default({}),
});

export const FillStepSchema = BaseStepSchema.extend({
  kind: z.literal("fill"),
  locator: z.string().min(1),
  value: z.string(),
  expect: z
    .object({
      locator: z.string().min(1).optional(),
    })
    .optional(),
});

export const AssertStepSchema = BaseStepSchema.extend({
  kind: z.literal("assert"),
  locator: z.string().min(1),
  toBeVisible: z.boolean().optional(),
  toContainText: z.string().min(1).optional(),
  toHaveValue: z.string().min(1).optional(),
});

export const WaitForStepSchema = BaseStepSchema.extend({
  kind: z.literal("waitFor"),
  locator: z.string().min(1),
  state: z.enum(["visible", "hidden", "attached", "detached"]),
  timeout: z.number().int().positive().max(120_000).optional(),
});

export const UploadStepSchema = BaseStepSchema.extend({
  kind: z.literal("upload"),
  locator: z.string().min(1),
  fixtureFile: z.string().min(1),
});

export const SelectStepSchema = BaseStepSchema.extend({
  kind: z.literal("select"),
  locator: z.string().min(1),
  option: z.string().min(1),
});

export const PressStepSchema = BaseStepSchema.extend({
  kind: z.literal("press"),
  keys: z.string().min(1),
});

export const ExpectDownloadStepSchema = BaseStepSchema.extend({
  kind: z.literal("expectDownload"),
  triggerLocator: z.string().min(1),
  filenameMatches: z.string().min(1).optional(),
  contentType: z.string().min(1).optional(),
});

export const PlanStepSchema = z.discriminatedUnion("kind", [
  GotoStepSchema,
  ApiStepSchema,
  ClickStepSchema,
  FillStepSchema,
  AssertStepSchema,
  WaitForStepSchema,
  UploadStepSchema,
  SelectStepSchema,
  PressStepSchema,
  ExpectDownloadStepSchema,
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

const STEP_SCOPE_JSON_SCHEMA = {
  type: "string",
  enum: [...STEP_SCOPE_VALUES],
} as const;

const BASE_STEP_JSON_SCHEMA = {
  id: { type: "string" },
  requiresElevation: { type: "boolean" },
  scope: STEP_SCOPE_JSON_SCHEMA,
} as const;

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
              ...BASE_STEP_JSON_SCHEMA,
              kind: { const: "goto" },
              url: { type: "string" },
              expect: {
                type: "object",
                additionalProperties: false,
                properties: {
                  locator: { type: "string" },
                  text: { type: "string" },
                  url: { type: "string" },
                },
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["id", "kind", "method", "path", "expectStatus"],
            properties: {
              ...BASE_STEP_JSON_SCHEMA,
              kind: { const: "api" },
              method: { type: "string", enum: [...API_METHOD_VALUES] },
              path: { type: "string" },
              expectStatus: { type: "integer" },
              body: {
                type: "object",
                additionalProperties: true,
              },
              expectBodyContains: { type: "string" },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["id", "kind", "locator", "expect"],
            properties: {
              ...BASE_STEP_JSON_SCHEMA,
              kind: { const: "click" },
              locator: { type: "string" },
              expect: {
                type: "object",
                additionalProperties: false,
                properties: {
                  locator: { type: "string" },
                  text: { type: "string" },
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
              ...BASE_STEP_JSON_SCHEMA,
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
              ...BASE_STEP_JSON_SCHEMA,
              kind: { const: "assert" },
              locator: { type: "string" },
              toBeVisible: { type: "boolean" },
              toContainText: { type: "string" },
              toHaveValue: { type: "string" },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["id", "kind", "locator", "state"],
            properties: {
              ...BASE_STEP_JSON_SCHEMA,
              kind: { const: "waitFor" },
              locator: { type: "string" },
              state: { type: "string", enum: ["visible", "hidden", "attached", "detached"] },
              timeout: { type: "integer" },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["id", "kind", "locator", "fixtureFile"],
            properties: {
              ...BASE_STEP_JSON_SCHEMA,
              kind: { const: "upload" },
              locator: { type: "string" },
              fixtureFile: { type: "string" },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["id", "kind", "locator", "option"],
            properties: {
              ...BASE_STEP_JSON_SCHEMA,
              kind: { const: "select" },
              locator: { type: "string" },
              option: { type: "string" },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["id", "kind", "keys"],
            properties: {
              ...BASE_STEP_JSON_SCHEMA,
              kind: { const: "press" },
              keys: { type: "string" },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["id", "kind", "triggerLocator"],
            properties: {
              ...BASE_STEP_JSON_SCHEMA,
              kind: { const: "expectDownload" },
              triggerLocator: { type: "string" },
              filenameMatches: { type: "string" },
              contentType: { type: "string" },
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
  domSnapshotPath: z.string().optional(),
  harPath: z.string().optional(),
  downloadPath: z.string().optional(),
  error: z.string().optional(),
  observedStatus: z.number().int().optional(),
  observedBodySnippet: z.string().optional(),
  requestCount: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
});

export type StepExecutionResult = z.infer<typeof StepExecutionResultSchema>;

export const EvidencePackageSchema = z.object({
  manifestS3Key: z.string().optional(),
  manifestS3Url: z.string().url(),
  manifestHash: z.string(),
  signature: z.string(),
});

export type EvidencePackage = z.infer<typeof EvidencePackageSchema>;

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
  evidencePackage: EvidencePackageSchema.optional(),
  writesPerformed: z.number().int().nonnegative().optional(),
  elevatedSteps: z.array(z.string()).default([]),
});

export type IssueAcValidationResult = z.infer<typeof IssueAcValidationResultSchema>;
