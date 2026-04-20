import { createHash, createHmac } from "crypto";
import { execFileSync } from "child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { basename, dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { EvidencePackage, StepExecutionResult } from "./types.js";
import { buildS3ConsoleUrl } from "../lib/s3Upload.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../../../../");

export interface BuildEvidencePackageParams {
  issueKey: string;
  environment: string;
  buildNumber: string;
  qaAgentRunTag: string;
  stepResults: StepExecutionResult[];
  artifactPaths: string[];
}

interface ManifestFileEntry {
  path: string;
  sha256: string;
  sizeBytes: number;
}

interface EvidenceManifest {
  issueKey: string;
  environment: string;
  buildNumber: string;
  qaAgentRunTag: string;
  generatedAt: string;
  fileCount: number;
  files: ManifestFileEntry[];
  stepResults: Array<Pick<
    StepExecutionResult,
    | "stepId"
    | "status"
    | "error"
    | "screenshotPath"
    | "domSnapshotPath"
    | "harPath"
    | "downloadPath"
    | "requestCount"
    | "durationMs"
  >>;
}

function getSigningSecret(): string {
  const secret = process.env.QA_EVIDENCE_SIGNING_SECRET || process.env.QA_RUNNER_HMAC_SECRET;
  if (!secret) {
    throw new Error("QA_EVIDENCE_SIGNING_SECRET or QA_RUNNER_HMAC_SECRET must be configured");
  }
  return secret;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function signatureFor(hash: string): string {
  return createHmac("sha256", getSigningSecret()).update(hash).digest("hex");
}

function getS3Client(): S3Client {
  return new S3Client({ region: process.env.AWS_REGION ?? "us-east-2" });
}

function buildEvidenceKey(environment: string, buildNumber: string, issueKey: string, filename: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return [
    "ai-control-plane",
    environment,
    yyyy,
    mm,
    dd,
    "qa-runs",
    buildNumber,
    "ac-evidence",
    issueKey.toLowerCase(),
    filename,
  ].join("/");
}

async function uploadFile(bucket: string, localPath: string, s3Key: string, contentType: string): Promise<void> {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: createReadStream(localPath),
      ContentType: contentType,
    }),
  );
}

function normalizeArtifactPaths(paths: string[]): string[] {
  return [...new Set(paths.filter((path) => !!path && existsSync(path)))];
}

export async function buildEvidencePackage(
  params: BuildEvidencePackageParams,
): Promise<EvidencePackage> {
  const artifactDir = join(REPO_ROOT, "test-results", "ac-validator", params.issueKey, params.buildNumber);
  mkdirSync(artifactDir, { recursive: true });

  const files = normalizeArtifactPaths(params.artifactPaths).map((path) => ({
    absolutePath: path,
    path: relative(REPO_ROOT, path).replace(/\\/g, "/"),
    sha256: sha256File(path),
    sizeBytes: statSync(path).size,
  }));

  const manifest: EvidenceManifest = {
    issueKey: params.issueKey,
    environment: params.environment,
    buildNumber: params.buildNumber,
    qaAgentRunTag: params.qaAgentRunTag,
    generatedAt: new Date().toISOString(),
    fileCount: files.length,
    files: files.map(({ path, sha256, sizeBytes }) => ({ path, sha256, sizeBytes })),
    stepResults: params.stepResults.map((result) => ({
      stepId: result.stepId,
      status: result.status,
      error: result.error,
      screenshotPath: result.screenshotPath,
      domSnapshotPath: result.domSnapshotPath,
      harPath: result.harPath,
      downloadPath: result.downloadPath,
      requestCount: result.requestCount,
      durationMs: result.durationMs,
    })),
  };

  const manifestPath = join(artifactDir, "evidence-manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  const manifestHash = sha256Json(manifest);
  const signature = signatureFor(manifestHash);
  const signaturePath = join(artifactDir, "evidence-signature.txt");
  writeFileSync(signaturePath, `${signature}\n`, "utf8");

  const tarballPath = join(artifactDir, "evidence-package.tar.gz");
  const relativeTarInputs = [
    relative(artifactDir, manifestPath),
    relative(artifactDir, signaturePath),
    ...files.map((file) => relative(artifactDir, file.absolutePath)),
  ];
  execFileSync(
    "tar",
    ["-czf", tarballPath, "-C", artifactDir, ...relativeTarInputs],
    { stdio: "pipe" },
  );

  const bucket = process.env.AI_ARTIFACTS_BUCKET;
  const region = process.env.AWS_REGION ?? "us-east-2";

  if (bucket) {
    const manifestKey = buildEvidenceKey(
      params.environment,
      params.buildNumber,
      params.issueKey,
      basename(manifestPath),
    );
    const signatureKey = buildEvidenceKey(
      params.environment,
      params.buildNumber,
      params.issueKey,
      basename(signaturePath),
    );
    const tarballKey = buildEvidenceKey(
      params.environment,
      params.buildNumber,
      params.issueKey,
      basename(tarballPath),
    );

    await uploadFile(bucket, manifestPath, manifestKey, "application/json");
    await uploadFile(bucket, signaturePath, signatureKey, "text/plain");
    await uploadFile(bucket, tarballPath, tarballKey, "application/gzip");

    return {
      manifestS3Key: manifestKey,
      // Use the S3 console URL (redirects into the AWS console and reuses
      // the reviewer's signed-in SSO session) rather than the bare
      // `https://<bucket>.s3.amazonaws.com/<key>` form. A direct S3 URL
      // requires AWS SigV4 request signing; being logged into the console
      // in another tab does NOT grant that auth, so direct URLs return
      // AccessDenied for humans clicking through from Confluence/Jira.
      //
      // The console URL matches the pattern used by `QaArtifactLink.consoleUrl`
      // for every other evidence artifact (screenshots, traces, videos), so
      // the manifest link is consistent with the rest of the evidence table.
      manifestS3Url: buildS3ConsoleUrl(bucket, manifestKey, region),
      manifestHash,
      signature,
    };
  }

  return {
    manifestS3Url: `https://local.invalid/${relative(REPO_ROOT, manifestPath).replace(/\\/g, "/")}`,
    manifestHash,
    signature,
  };
}
