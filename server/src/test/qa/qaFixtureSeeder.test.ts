import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import {
  seedQaAgentTenant,
  teardownQaAgentTenant,
} from "../../../scripts/qa/lib/qaFixtureSeeder.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../../../../");

describe("qaFixtureSeeder teardown", () => {
  const issueKey = "COHI-96";
  const buildNumber = "4242";
  const storageStatePath = join(REPO_ROOT, "test-results", "qa-fixture-storage.json");
  const manifestPath = join(
    REPO_ROOT,
    "test-results",
    "ac-validator",
    issueKey,
    buildNumber,
    "fixture-manifest.json",
  );

  beforeEach(() => {
    mkdirSync(dirname(storageStatePath), { recursive: true });
    writeFileSync(
      storageStatePath,
      JSON.stringify({
        origins: [
          {
            origin: "https://example.com",
            localStorage: [{ name: "auth_token", value: "test-token" }],
          },
        ],
      }),
      "utf8",
    );

    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(
      manifestPath,
      JSON.stringify({
        resources: [
          {
            kind: "canvas",
            id: "canvas-1",
            deletePath: "/api/workbench/canvases/canvas-1",
          },
        ],
      }),
      "utf8",
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "",
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(join(REPO_ROOT, "test-results", "ac-validator", issueKey, buildNumber), {
      recursive: true,
      force: true,
    });
    rmSync(storageStatePath, { force: true });
  });

  it("treats repeated teardown as idempotent", async () => {
    const first = await teardownQaAgentTenant({
      baseUrl: "https://example.com",
      buildNumber,
      issueKey,
      storageStatePath,
    });

    expect(first.errors).toEqual([]);
    expect(first.deletedResourceIds).toEqual(["canvas-1"]);
    expect(existsSync(manifestPath)).toBe(false);

    const second = await teardownQaAgentTenant({
      baseUrl: "https://example.com",
      buildNumber,
      issueKey,
      storageStatePath,
    });

    expect(second.errors).toEqual([]);
    expect(second.deletedResourceIds).toEqual([]);
  });

  it("seeds canvases via the mounted workbench canvas CRUD route", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "canvas-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ document: { id: "doc-1" } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await seedQaAgentTenant({
      baseUrl: "https://example.com",
      buildNumber,
      issueKey,
      storageStatePath,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://example.com/api/workbench/canvases");
    expect(result.resources).toEqual([
      {
        kind: "canvas",
        id: "canvas-1",
        deletePath: "/api/workbench/canvases/canvas-1",
      },
      {
        kind: "knowledge_document",
        id: "doc-1",
        deletePath: "/api/knowledge-center/documents/doc-1",
      },
    ]);
  });
});
