import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { buildEvidencePackage } from "../../../scripts/qa/ai/evidencePackager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../../../../");

describe("evidencePackager", () => {
  afterEach(() => {
    delete process.env.AI_ARTIFACTS_BUCKET;
    delete process.env.QA_EVIDENCE_SIGNING_SECRET;
    rmSync(join(REPO_ROOT, "test-results", "ac-validator", "COHI-96", "999"), {
      recursive: true,
      force: true,
    });
  });

  it("creates a signed local manifest when S3 upload is disabled", async () => {
    process.env.QA_EVIDENCE_SIGNING_SECRET = "evidence-secret";
    const artifactDir = join(REPO_ROOT, "test-results", "ac-validator", "COHI-96", "999");
    mkdirSync(artifactDir, { recursive: true });
    const screenshotPath = join(artifactDir, "ac1.png");
    writeFileSync(screenshotPath, "fake-image", "utf8");

    const result = await buildEvidencePackage({
      issueKey: "COHI-96",
      environment: "dev",
      buildNumber: "999",
      qaAgentRunTag: "qa-agent-run-999",
      stepResults: [
        {
          stepId: "ac1-goto",
          status: "passed",
          screenshotPath,
          durationMs: 100,
          requestCount: 1,
        },
      ],
      artifactPaths: [screenshotPath],
    });

    expect(result.manifestHash).toHaveLength(64);
    expect(result.signature).toHaveLength(64);
    expect(result.manifestS3Url).toContain("local.invalid");
    expect(existsSync(join(artifactDir, "evidence-manifest.json"))).toBe(true);
    expect(existsSync(join(artifactDir, "evidence-package.tar.gz"))).toBe(true);
  });
});
