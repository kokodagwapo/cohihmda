import { createHash } from "crypto";
import { resolve } from "path";
import { startAction, transitionAction } from "../lib/aiLedgerClient.js";
import { redactToJson } from "../../../src/utils/aiRedactor.js";
import { uploadFailureArtifacts, buildS3ConsoleUrl, buildS3DirectUrl } from "../lib/s3Upload.js";
import type { QaTargetIssue, QaArtifactLink } from "../lib/atlassianReporter.js";
import { transitionJiraIssueToEvidenceReview } from "../lib/atlassianReporter.js";
import { seedQaAgentTenant, teardownQaAgentTenant } from "../lib/qaFixtureSeeder.js";
import { readIssueAcceptanceCriteria, postJiraComment, type JiraAcReadResult } from "./jiraAcReader.js";
import { generatePlan, type GeneratedPlanResult } from "./planGenerator.js";
import { validatePlan } from "./planValidator.js";
import { executePlan, type ExecutePlanResult } from "./planExecutor.js";
import { approvePlan, type PlanApprovalDecision } from "./planApprover.js";
import { buildEvidencePackage } from "./evidencePackager.js";
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

function getMaxWritesPerIssue(): number {
  return Number(process.env.QA_AC_MAX_WRITES_PER_ISSUE || "10");
}

function getMaxWritesPerRun(): number {
  return Number(process.env.QA_AC_MAX_WRITES_PER_RUN || "25");
}

function getMaxDurationSecPerIssue(): number {
  return Number(process.env.QA_AC_MAX_DURATION_SEC_PER_ISSUE || "900");
}

function requireTeardownSuccess(): boolean {
  return process.env.QA_AC_REQUIRE_TEARDOWN_SUCCESS === "true";
}

function isDryRun(): boolean {
  return process.env.QA_AC_DRY_RUN === "true";
}

/**
 * Comma-separated list of Jira keys the AC validator should skip without
 * attempting to parse or plan — e.g. infrastructure/control-plane tickets
 * whose acceptance criteria describe architecture rather than user-visible
 * behavior an agent could exercise. Parsing those tickets produces noisy
 * `parse_error` ledger rows without any QA value.
 */
function getSkipIssueKeys(): Set<string> {
  const raw = process.env.QA_AC_SKIP_ISSUES ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0),
  );
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
  const maxWritesPerIssue = getMaxWritesPerIssue();
  const maxWritesPerRun = getMaxWritesPerRun();
  const maxDurationSecPerIssue = getMaxDurationSecPerIssue();
  const mustTeardownCleanly = requireTeardownSuccess();
  const dryRun = isDryRun();
  const skipIssueKeys = getSkipIssueKeys();
  let consumedTokens = 0;
  let writesPerformedThisRun = 0;
  const results: IssueAcValidationResult[] = [];

  // Peel off opt-out tickets (infra/meta) before applying the per-run cap so
  // they don't consume capacity.
  const candidateTargets = params.targets.filter((target) => {
    if (skipIssueKeys.has(target.issueKey.toUpperCase())) {
      results.push({
        issueKey: target.issueKey,
        issueSummary: target.issueSummary,
        status: "inconclusive",
        statements: [],
        approvalStatus: "skipped_opt_out",
        confluenceSummary:
          "Skipped AC validation because this issue is listed in QA_AC_SKIP_ISSUES (infrastructure/meta ticket with non-behavioral acceptance criteria).",
        screenshotPaths: [],
      });
      console.log(
        `[AcValidator] ${target.issueKey} — skipped via QA_AC_SKIP_ISSUES`,
      );
      return false;
    }
    return true;
  });

  const runnableTargets = candidateTargets.slice(0, maxIssuesPerRun);
  const skippedTargets = candidateTargets.slice(maxIssuesPerRun);

  console.log(
    `[AcValidator] Starting — issues=${params.targets.length} (running=${runnableTargets.length}, over-limit=${skippedTargets.length}, opt-out=${skipIssueKeys.size}), dryRun=${dryRun}, maxWritesPerIssue=${maxWritesPerIssue}, maxWritesPerRun=${maxWritesPerRun}`,
  );
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
    console.log(`[AcValidator] ${target.issueKey} — begin (requestId=${requestId})`);
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
      const issue = await recordStageAction<JiraAcReadResult>(
        parentActionId,
        requestId,
        "jira_ac_read",
        { issueKey: target.issueKey },
        async () => ({ ...(await readIssueAcceptanceCriteria(target.issueKey)) }),
      );

      if ("error" in issue && issue.error) {
        console.warn(`[AcValidator] ${target.issueKey} — AC parse error: ${issue.error}`);
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
      console.log(
        `[AcValidator] ${target.issueKey} — parsed ${statements.length} AC statement(s); generating plan...`,
      );

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
      console.log(
        `[AcValidator] ${target.issueKey} — plan generated: model=${generatedPlan.modelName}, steps=${generatedPlan.plan.steps.length}, tokensIn=${generatedPlan.tokensIn ?? "?"}, tokensOut=${generatedPlan.tokensOut ?? "?"}`,
      );

      const validation = await recordStageAction<PlanApprovalDecision & { stepCount: number }>(
        parentActionId,
        requestId,
        "plan_validation",
        { issueKey: target.issueKey },
        async () => {
          const planValidation = validatePlan(generatedPlan.plan);
          generatedPlan.plan = planValidation.plan;
          if (planValidation.writesPlanned > maxWritesPerIssue) {
            throw new Error(
              `QA_AC_MAX_WRITES_PER_ISSUE exceeded by plan (${planValidation.writesPlanned} > ${maxWritesPerIssue})`,
            );
          }
          if (writesPerformedThisRun + planValidation.writesPlanned > maxWritesPerRun) {
            throw new Error(
              `QA_AC_MAX_WRITES_PER_RUN exceeded by plan (${writesPerformedThisRun + planValidation.writesPlanned} > ${maxWritesPerRun})`,
            );
          }
          const approval = approvePlan(planValidation.plan);
          if (!planValidation.ok) {
            throw new Error(planValidation.errors.join("; "));
          }
          if (!approval.approved) {
            throw new Error(approval.reason ?? "Plan approval failed");
          }
          await transitionAction({
            actionId: parentActionId,
            status: "approved",
            metadata: {
              issueKey: target.issueKey,
              planHash: approval.planHash,
              approvalStatus: approval.approvalStatus,
              elevatedSteps: approval.elevatedSteps,
            },
          });
          return {
            approved: true,
            approvalStatus: approval.approvalStatus,
            planHash: approval.planHash,
            elevatedSteps: approval.elevatedSteps,
            tokenMatched: approval.tokenMatched,
            stepCount: planValidation.plan.steps.length,
          };
        },
      );

      console.log(
        `[AcValidator] ${target.issueKey} — plan approved: approvalStatus=${validation.approvalStatus}, writesPlanned≈${validation.stepCount}, elevatedSteps=${(validation.elevatedSteps ?? []).length}`,
      );

      if (dryRun) {
        const dryRunResult: IssueAcValidationResult = {
          issueKey: target.issueKey,
          issueSummary: target.issueSummary,
          status: "inconclusive",
          statements: [],
          modelName: generatedPlan.modelName,
          modelTemperature: 0,
          tokensIn: generatedPlan.tokensIn,
          tokensOut: generatedPlan.tokensOut,
          promptHash: sha256(generatedPlan.redactedInput),
          planHash: validation.planHash,
          approvalStatus: "dry_run",
          confluenceSummary: "Plan generated and approved, but execution was skipped because QA_AC_DRY_RUN=true.",
          screenshotPaths: [],
          elevatedSteps: validation.elevatedSteps,
        };

        await transitionAction({
          actionId: parentActionId,
          status: "executed",
          metadata: {
            issueKey: target.issueKey,
            issueSummary: target.issueSummary,
            environment: params.environment,
            dryRun: true,
            approvalStatus: dryRunResult.approvalStatus,
            planHash: dryRunResult.planHash,
            elevatedSteps: validation.elevatedSteps,
          },
        });

        console.log(
          `[AcValidator] ${target.issueKey} — dry run complete: planHash=${dryRunResult.planHash?.slice(0, 12)}…, status=inconclusive (execution skipped)`,
        );
        results.push(dryRunResult);
        continue;
      }

      let execution: ExecutePlanResult | null = null;
      let evidencePackage: IssueAcValidationResult["evidencePackage"];
      let teardownErrors: string[] = [];
      let teardownDeletedIds: string[] = [];
      let qaAgentRunTag = `qa-agent-run-${params.buildNumber}`;

      try {
        const fixtureSeed = await recordStageAction<{
          qaAgentRunTag: string;
          manifestPath: string;
          resourceCount: number;
        }>(
          parentActionId,
          requestId,
          "fixture_seed",
          { issueKey: target.issueKey },
          async () => {
            const seeded = await seedQaAgentTenant({
              baseUrl: params.baseUrl,
              buildNumber: params.buildNumber,
              issueKey: target.issueKey,
            });
            qaAgentRunTag = seeded.qaAgentRunTag;
            return {
              qaAgentRunTag: seeded.qaAgentRunTag,
              manifestPath: seeded.manifestPath,
              resourceCount: seeded.resources.length,
            };
          },
        );
        qaAgentRunTag = fixtureSeed.qaAgentRunTag;

        const executionStartedAt = Date.now();
        execution = await recordStageAction<ExecutePlanResult>(
          parentActionId,
          requestId,
          "plan_execution",
          { issueKey: target.issueKey, qaAgentRunTag },
          async () => {
            const result = await executePlan({
              plan: generatedPlan.plan,
              issueKey: target.issueKey,
              baseUrl: params.baseUrl,
              buildNumber: params.buildNumber,
            });
            return result;
          },
        );
        const executionDurationSec = (Date.now() - executionStartedAt) / 1000;
        if (executionDurationSec > maxDurationSecPerIssue) {
          throw new Error(
            `QA_AC_MAX_DURATION_SEC_PER_ISSUE exceeded (${executionDurationSec.toFixed(1)}s > ${maxDurationSecPerIssue}s)`,
          );
        }
        if (execution.writesPerformed > maxWritesPerIssue) {
          throw new Error(
            `QA_AC_MAX_WRITES_PER_ISSUE exceeded at execution time (${execution.writesPerformed} > ${maxWritesPerIssue})`,
          );
        }
        writesPerformedThisRun += execution.writesPerformed;
        if (writesPerformedThisRun > maxWritesPerRun) {
          throw new Error(
            `QA_AC_MAX_WRITES_PER_RUN exceeded (${writesPerformedThisRun} > ${maxWritesPerRun})`,
          );
        }

        const artifactLinksByPath = await uploadAcArtifacts(
          execution.screenshotPaths ?? [],
          params.environment,
          params.buildNumber,
          target.issueKey,
        );

        evidencePackage = await recordStageAction(
          parentActionId,
          requestId,
          "evidence_packaging",
          { issueKey: target.issueKey, qaAgentRunTag },
          async () =>
            buildEvidencePackage({
              issueKey: target.issueKey,
              environment: params.environment,
              buildNumber: params.buildNumber,
              qaAgentRunTag,
              stepResults: execution!.stepResults,
              artifactPaths: [
                ...execution!.screenshotPaths,
                ...execution!.harPaths,
                ...execution!.domSnapshotPaths,
                ...execution!.stepResults
                  .map((step) => step.downloadPath)
                  .filter((path): path is string => Boolean(path)),
              ],
            }),
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

        const jiraMovedToEvidenceReview = await transitionJiraIssueToEvidenceReview(target.issueKey);
        const issueResult: IssueAcValidationResult = {
          issueKey: target.issueKey,
          issueSummary: target.issueSummary,
          modelName: generatedPlan.modelName,
          modelTemperature: 0,
          tokensIn: generatedPlan.tokensIn,
          tokensOut: generatedPlan.tokensOut,
          promptHash: sha256(generatedPlan.redactedInput),
          planHash: validation.planHash,
          resultHash,
          approvalStatus: "pending_evidence_review",
          statements: statementResults,
          status: overallStatus,
          confluenceSummary:
            overallStatus === "passed"
              ? `${statementResults.length} AC statement(s) validated successfully. Evidence is awaiting review.`
              : "One or more AC statements failed validation. Evidence is awaiting review.",
          screenshotPaths: [...artifactLinksByPath.values()].map((artifact) => artifact.consoleUrl),
          evidencePackage,
          writesPerformed: execution.writesPerformed,
          elevatedSteps: validation.elevatedSteps,
        };

        await transitionAction({
          actionId: parentActionId,
          status: "pending_evidence_review",
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
            evidencePackage,
            writesPerformed: execution.writesPerformed,
            elevatedSteps: validation.elevatedSteps,
            jiraMovedToEvidenceReview,
          },
        });

        console.log(
          `[AcValidator] ${target.issueKey} — execution complete: status=${issueResult.status}, writes=${execution.writesPerformed}, evidenceManifest=${evidencePackage?.manifestS3Url ?? "local"}, jiraMovedToEvidenceReview=${jiraMovedToEvidenceReview}`,
        );
        results.push(issueResult);
      } finally {
        const teardown = await teardownQaAgentTenant({
          baseUrl: params.baseUrl,
          buildNumber: params.buildNumber,
          issueKey: target.issueKey,
        }).catch((error) => ({
          qaAgentRunTag,
          manifestPath: "",
          deletedResourceIds: [],
          errors: [error instanceof Error ? error.message : String(error)],
        }));
        teardownErrors = teardown.errors;
        teardownDeletedIds = teardown.deletedResourceIds;
      }

      if (teardownErrors.length > 0 && mustTeardownCleanly) {
        throw new Error(`QA fixture teardown failed: ${teardownErrors.join("; ")}`);
      }

      if (teardownDeletedIds.length > 0 || teardownErrors.length > 0) {
        await transitionAction({
          actionId: parentActionId,
          status: "pending_evidence_review",
          metadata: {
            issueKey: target.issueKey,
            qaAgentRunTag,
            teardownDeletedIds,
            teardownErrors,
          },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[AcValidator] ${target.issueKey} — failed: ${message}`);
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
        approvalStatus: /broad-scope|approval/i.test(message) ? "pending_pre_approval" : "execution_failed",
        confluenceSummary: message,
        screenshotPaths: [],
      });
    }
  }

  const byStatus = results.reduce<Record<string, number>>((acc, r) => {
    const key = `${r.status}/${r.approvalStatus ?? "n/a"}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(byStatus)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  console.log(
    `[AcValidator] Run complete — ${results.length} issue(s): ${summary || "no results"}`,
  );

  return results;
}
