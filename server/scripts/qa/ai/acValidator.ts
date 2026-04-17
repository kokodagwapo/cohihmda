import { createHash } from "crypto";
import { resolve } from "path";
import { startAction, transitionAction } from "../../../src/services/aiAgentOrchestrator.js";
import { redactToJson } from "../../../src/utils/aiRedactor.js";
import { uploadFailureArtifacts, buildS3ConsoleUrl, buildS3DirectUrl } from "../lib/s3Upload.js";
import type { QaTargetIssue, QaArtifactLink } from "../lib/atlassianReporter.js";
import { readIssueAcceptanceCriteria, postJiraComment, type JiraAcReadResult } from "./jiraAcReader.js";
import { generatePlan, type GeneratedPlanResult } from "./planGenerator.js";
import { validatePlan } from "./planValidator.js";
import { executePlan, type ExecutePlanResult } from "./planExecutor.js";
import { approvePlan, type PlanApprovalDecision } from "./planApprover.js";
import type { IssueAcValidationResult, StatementResult, TestPlan } from "./types.js";
import type { LlmClient } from "./llm/openAiClient.js";

const REPO_ROOT = resolve(process.cwd(), "..");

export interface RunAcValidatorParams {
  targets: QaTargetIssue[];
  environment: string;
  buildNumber: string;
  baseUrl: string;
  llmClient: LlmClient;
}

function sha256(input: unknown): string {
  return createHash("sha256").update(typeof input === "string" ? input : JSON.stringify(input)).digest("hex");
}

function createRequestId(issueKey: string, buildNumber: string): string {
  return `qa-ac-${buildNumber}-${issueKey.toLowerCase()}`;
}

function getMaxTokensPerRun(): number {
  return Number(process.env.QA_AC_MAX_TOKENS_PER_RUN || "200000");
}

function getMaxIssuesPerRun(): number {
  return Number(process.env.QA_AC_MAX_ISSUES_PER_RUN || "10");
}

async function recordStageAction<T extends object>(
  parentActionId: string,
  requestId: string,
  actionType: string,
  metadata: Record<string, unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const actionId = await startAction({
    agentId: "ai-ac-validator",
    actionType,
    requestId,
    metadata: {
      parentActionId,
      ...metadata,
    },
  });

  try {
    const result = await run();
    await transitionAction({
      actionId,
      status: "executed",
      metadata: {
        parentActionId,
        ...metadata,
        ...result,
      },
    });
    return result;
  } catch (error) {
    await transitionAction({
      actionId,
      status: "failed",
      metadata: {
        parentActionId,
        ...metadata,
      },
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function buildStatementResults(
  statements: Array<{ index: number; category: any; statement: string }>,
  plan: TestPlan,
  stepResults: Array<{ stepId: string; status: "passed" | "failed"; error?: string; screenshotPath?: string }>,
  artifactLinksByPath: Map<string, string>,
): StatementResult[] {
  return statements.map((statement) => {
    const prefix = `ac${statement.index}-`;
    const matchingSteps = plan.steps.filter((step) => step.id.startsWith(prefix));
    const matchingResults = stepResults.filter((result) => result.stepId.startsWith(prefix));
    const hasFailure = matchingResults.some((result) => result.status === "failed");
    const hasAny = matchingResults.length > 0;
    const evidenceLinks = matchingResults
      .map((result) => result.screenshotPath)
      .filter((path): path is string => Boolean(path))
      .map((path) => artifactLinksByPath.get(path) ?? path);

    return {
      index: statement.index,
      category: statement.category,
      statement: statement.statement,
      status: !hasAny ? "inconclusive" : hasFailure ? "failed" : "passed",
      stepIds: matchingSteps.map((step) => step.id),
      ...(hasFailure && {
        error: matchingResults.find((result) => result.status === "failed")?.error ?? "Unknown execution failure",
      }),
      evidenceLinks,
    };
  });
}

async function uploadAcArtifacts(
  screenshotPaths: string[],
  environment: string,
  buildNumber: string,
  issueKey: string,
): Promise<Map<string, QaArtifactLink>> {
  const bucket = process.env.AI_ARTIFACTS_BUCKET;
  const region = process.env.AWS_REGION ?? "us-east-2";
  const linksByPath = new Map<string, QaArtifactLink>();

  if (!bucket || screenshotPaths.length === 0) {
    return linksByPath;
  }

  const uploaded = await uploadFailureArtifacts({
    repoRoot: process.cwd().endsWith("server") ? REPO_ROOT : process.cwd(),
    environment,
    buildNumber: `${buildNumber}-${issueKey.toLowerCase()}`,
    bucket,
    failurePaths: screenshotPaths,
  });

  for (const artifact of uploaded) {
    linksByPath.set(artifact.localPath, {
      label: artifact.localPath.split(/[/\\]/).pop() ?? artifact.s3Key,
      localPath: artifact.localPath,
      s3Key: artifact.s3Key,
      consoleUrl: buildS3ConsoleUrl(bucket, artifact.s3Key, region),
      directUrl: buildS3DirectUrl(bucket, artifact.s3Key, region),
      contentType: artifact.contentType,
    });
  }

  return linksByPath;
}

export async function runAcValidator(params: RunAcValidatorParams): Promise<IssueAcValidationResult[]> {
  const maxIssuesPerRun = getMaxIssuesPerRun();
  const maxTokensPerRun = getMaxTokensPerRun();
  let consumedTokens = 0;
  const results: IssueAcValidationResult[] = [];

  const runnableTargets = params.targets.slice(0, maxIssuesPerRun);
  const skippedTargets = params.targets.slice(maxIssuesPerRun);
  skippedTargets.forEach((target) => {
    results.push({
      issueKey: target.issueKey,
      issueSummary: target.issueSummary,
      status: "inconclusive",
      statements: [],
      approvalStatus: "skipped_max_issues",
      confluenceSummary: "Skipped AC validation because QA_AC_MAX_ISSUES_PER_RUN was exceeded.",
      screenshotPaths: [],
    });
  });

  for (const target of runnableTargets) {
    const requestId = createRequestId(target.issueKey, params.buildNumber);
    const parentActionId = await startAction({
      agentId: "ai-ac-validator",
      actionType: "ac_validation",
      requestId,
      metadata: {
        issueKey: target.issueKey,
        issueSummary: target.issueSummary,
        environment: params.environment,
        pipelineBuild: params.buildNumber,
      },
    });

    try {
      await transitionAction({
        actionId: parentActionId,
        status: "approved",
        metadata: {
          issueKey: target.issueKey,
          approvalStatus: "auto_read_only",
        },
      });

      const issue = await recordStageAction<JiraAcReadResult>(
        parentActionId,
        requestId,
        "jira_ac_read",
        { issueKey: target.issueKey },
        async () => ({ ...(await readIssueAcceptanceCriteria(target.issueKey)) }),
      );

      if ("error" in issue && issue.error) {
        await postJiraComment(
          target.issueKey,
          `AI AC Validator could not parse the approved Acceptance Criteria block: ${issue.error}. Please normalize the Jira description format and retry.`,
        ).catch(() => {});

        const result: IssueAcValidationResult = {
          issueKey: target.issueKey,
          issueSummary: target.issueSummary,
          status: "parse_error",
          statements: [],
          approvalStatus: "auto_read_only",
          confluenceSummary: issue.error,
          screenshotPaths: [],
        };

        await transitionAction({
          actionId: parentActionId,
          status: "failed",
          metadata: {
            issueKey: target.issueKey,
            issueSummary: target.issueSummary,
            environment: params.environment,
            approvalStatus: "auto_read_only",
            redactedAcText: redactToJson({
              issueKey: target.issueKey,
              issueSummary: target.issueSummary,
              environment: params.environment,
              statement: issue.blockText ?? issue.descriptionText ?? "",
            }),
          },
          errorMessage: issue.error,
        });
        results.push(result);
        continue;
      }

      const statements = issue.statements ?? [];
      if (statements.length === 0) {
        throw new Error(`No acceptance criteria statements found for ${target.issueKey}`);
      }

      const generatedPlan = await recordStageAction<GeneratedPlanResult>(
        parentActionId,
        requestId,
        "plan_generation",
        { issueKey: target.issueKey },
        async () => {
          const result = await generatePlan({
            issueKey: target.issueKey,
            issueSummary: target.issueSummary,
            environment: params.environment,
            statements,
            llmClient: params.llmClient,
          });
          return result;
        },
      );

      consumedTokens += Number(generatedPlan.tokensIn ?? 0) + Number(generatedPlan.tokensOut ?? 0);
      if (consumedTokens > maxTokensPerRun) {
        throw new Error(`QA_AC_MAX_TOKENS_PER_RUN exceeded (${consumedTokens} > ${maxTokensPerRun})`);
      }

      const validation = await recordStageAction<PlanApprovalDecision & { stepCount: number }>(
        parentActionId,
        requestId,
        "plan_validation",
        { issueKey: target.issueKey },
        async () => {
          const planValidation = validatePlan(generatedPlan.plan);
          const approval = approvePlan(generatedPlan.plan);
          if (!planValidation.ok) {
            throw new Error(planValidation.errors.join("; "));
          }
          if (!approval.approved) {
            throw new Error(approval.reason ?? "Plan approval failed");
          }
          return {
            approvalStatus: approval.approvalStatus,
            stepCount: generatedPlan.plan.steps.length,
          };
        },
      );

      const execution = await recordStageAction<ExecutePlanResult>(
        parentActionId,
        requestId,
        "plan_execution",
        { issueKey: target.issueKey },
        async () => {
          const result = await executePlan({
            plan: generatedPlan.plan,
            issueKey: target.issueKey,
            baseUrl: params.baseUrl,
            buildNumber: params.buildNumber,
          });
          return {
            stepResults: result.stepResults,
            screenshotPaths: result.screenshotPaths,
          };
        },
      );

      const artifactLinksByPath = await uploadAcArtifacts(
        execution.screenshotPaths ?? [],
        params.environment,
        params.buildNumber,
        target.issueKey,
      );

      const statementResults = buildStatementResults(
        statements,
        generatedPlan.plan,
        execution.stepResults,
        new Map([...artifactLinksByPath.entries()].map(([path, artifact]) => [path, artifact.consoleUrl])),
      );
      const overallStatus = statementResults.some((statement) => statement.status === "failed")
        ? "failed"
        : "passed";
      const resultHash = sha256({ statementResults, stepResults: execution.stepResults });

      await recordStageAction(
        parentActionId,
        requestId,
        "result_reporting",
        { issueKey: target.issueKey },
        async () => ({
          overallStatus,
          statementResults,
          resultHash,
        }),
      );

      const issueResult: IssueAcValidationResult = {
        issueKey: target.issueKey,
        issueSummary: target.issueSummary,
        status: overallStatus,
        statements: statementResults,
        modelName: generatedPlan.modelName,
        modelTemperature: 0,
        tokensIn: generatedPlan.tokensIn,
        tokensOut: generatedPlan.tokensOut,
        promptHash: sha256(generatedPlan.redactedInput),
        planHash: sha256(generatedPlan.plan),
        resultHash,
        approvalStatus: validation.approvalStatus as string,
        confluenceSummary:
          overallStatus === "passed"
            ? `${statementResults.length} AC statement(s) validated successfully.`
            : "One or more AC statements failed validation.",
        screenshotPaths: [...artifactLinksByPath.values()].map((artifact) => artifact.consoleUrl),
      };

      await transitionAction({
        actionId: parentActionId,
        status: overallStatus === "passed" ? "executed" : "failed",
        metadata: {
          issueKey: target.issueKey,
          issueSummary: target.issueSummary,
          environment: params.environment,
          modelName: generatedPlan.modelName,
          modelTemperature: 0,
          tokensIn: generatedPlan.tokensIn,
          tokensOut: generatedPlan.tokensOut,
          promptHash: issueResult.promptHash,
          planHash: issueResult.planHash,
          resultHash: issueResult.resultHash,
          perStatementResults: statementResults,
          approvalStatus: issueResult.approvalStatus,
          redactedAcText: generatedPlan.redactedInput,
        },
        errorMessage:
          overallStatus === "failed"
            ? "One or more acceptance criteria statements failed validation."
            : undefined,
      });

      results.push(issueResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await transitionAction({
        actionId: parentActionId,
        status: "failed",
        metadata: {
          issueKey: target.issueKey,
          issueSummary: target.issueSummary,
          environment: params.environment,
        },
        errorMessage: message,
      });
      results.push({
        issueKey: target.issueKey,
        issueSummary: target.issueSummary,
        status: /reject/i.test(message) ? "rejected" : "inconclusive",
        statements: [],
        approvalStatus: "auto_read_only",
        confluenceSummary: message,
        screenshotPaths: [],
      });
    }
  }

  return results;
}
