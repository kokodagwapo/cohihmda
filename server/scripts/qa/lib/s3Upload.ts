/**
 * S3 Artifact Uploader for QA Runner
 *
 * Uploads Playwright report artifacts to S3 after each test run.
 * Uses the same bucket and key-convention as aiRedactor.ts in the main app.
 *
 * Key convention:
 *   ai-control-plane/{env}/{yyyy}/{mm}/{dd}/qa-runs/{build}/{type}/{filename}
 *
 * AWS credentials come from OIDC in the pipeline step (no static keys).
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createReadStream, statSync, existsSync, readdirSync } from "fs";
import { join, basename } from "path";
import { createHash } from "crypto";
import { execSync } from "child_process";

export interface UploadedArtifact {
  s3Key: string;
  sizeBytes: number;
  contentType: string;
  localPath: string;
}

function getS3Client(): S3Client {
  return new S3Client({ region: process.env.AWS_REGION ?? "us-east-2" });
}

function buildKey(
  environment: string,
  buildNumber: string,
  artifactType: string,
  filename: string
): string {
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
    artifactType,
    filename,
  ].join("/");
}

function guessMimeType(filePath: string): string {
  if (filePath.endsWith(".zip")) return "application/zip";
  if (filePath.endsWith(".tar.gz") || filePath.endsWith(".tgz")) return "application/gzip";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  if (filePath.endsWith(".webm")) return "video/webm";
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".html")) return "text/html";
  return "application/octet-stream";
}

async function uploadFile(
  client: S3Client,
  bucket: string,
  localPath: string,
  s3Key: string
): Promise<UploadedArtifact> {
  const stat = statSync(localPath);
  const stream = createReadStream(localPath);
  const contentType = guessMimeType(localPath);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: stream,
      ContentType: contentType,
    })
  );

  return {
    s3Key,
    sizeBytes: stat.size,
    contentType,
    localPath,
  };
}

/**
 * Zip and upload the full Playwright HTML report directory.
 * Returns the S3 key of the uploaded archive or null if skipped.
 */
export async function uploadHtmlReport(opts: {
  repoRoot: string;
  environment: string;
  buildNumber: string;
  bucket: string;
}): Promise<string | null> {
  const reportDir = join(opts.repoRoot, "playwright-report");
  if (!existsSync(reportDir)) {
    console.warn("[S3Upload] playwright-report/ directory not found, skipping HTML report upload");
    return null;
  }

  const archivePath = join(opts.repoRoot, "test-results", "playwright-report.tar.gz");
  try {
    execSync(`tar -czf "${archivePath}" -C "${opts.repoRoot}" playwright-report`, {
      stdio: "pipe",
    });
  } catch (err) {
    console.warn("[S3Upload] Failed to create report archive:", err);
    return null;
  }

  const s3Key = buildKey(opts.environment, opts.buildNumber, "html-report", "playwright-report.tar.gz");
  const client = getS3Client();

  try {
    await uploadFile(client, opts.bucket, archivePath, s3Key);
    console.log(`[S3Upload] HTML report uploaded: s3://${opts.bucket}/${s3Key}`);
    return s3Key;
  } catch (err) {
    console.warn("[S3Upload] Failed to upload HTML report:", err);
    return null;
  }
}

/**
 * Upload per-test failure artifacts (screenshots, traces, videos).
 * Walks the test-results/ directory for known artifact extensions.
 */
export async function uploadFailureArtifacts(opts: {
  repoRoot: string;
  environment: string;
  buildNumber: string;
  bucket: string;
  failurePaths: string[];
}): Promise<UploadedArtifact[]> {
  if (opts.failurePaths.length === 0) return [];

  const client = getS3Client();
  const uploaded: UploadedArtifact[] = [];

  for (const localPath of opts.failurePaths) {
    if (!existsSync(localPath)) continue;

    let artifactType = "misc";
    if (localPath.endsWith(".png") || localPath.endsWith(".jpg")) artifactType = "screenshots";
    else if (localPath.endsWith(".zip")) artifactType = "traces";
    else if (localPath.endsWith(".webm")) artifactType = "videos";

    const s3Key = buildKey(
      opts.environment,
      opts.buildNumber,
      artifactType,
      basename(localPath)
    );

    try {
      const artifact = await uploadFile(client, opts.bucket, localPath, s3Key);
      uploaded.push(artifact);
      console.log(`[S3Upload] Artifact uploaded: s3://${opts.bucket}/${s3Key}`);
    } catch (err) {
      console.warn(`[S3Upload] Failed to upload ${localPath}:`, err);
    }
  }

  return uploaded;
}
