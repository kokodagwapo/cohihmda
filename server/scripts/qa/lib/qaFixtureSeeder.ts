import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

export interface SeedQaAgentTenantParams {
  baseUrl: string;
  buildNumber: string;
  issueKey: string;
  storageStatePath?: string;
}

export interface SeededQaResource {
  kind: "canvas" | "knowledge_document";
  id: string;
  deletePath: string;
}

export interface SeedQaAgentTenantResult {
  qaAgentRunTag: string;
  manifestPath: string;
  resources: SeededQaResource[];
}

export interface TeardownQaAgentTenantResult {
  qaAgentRunTag: string;
  manifestPath: string;
  deletedResourceIds: string[];
  errors: string[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../../../../");
const DEFAULT_STORAGE_STATE_PATH = join(REPO_ROOT, "e2e", ".auth", "admin.json");

function resolveStorageStatePath(storageStatePath?: string): string {
  return storageStatePath || process.env.QA_AC_STORAGE_STATE_PATH || DEFAULT_STORAGE_STATE_PATH;
}

function buildRunTag(buildNumber: string): string {
  return `qa-agent-run-${buildNumber}`;
}

function buildManifestPath(issueKey: string, buildNumber: string): string {
  return join(REPO_ROOT, "test-results", "ac-validator", issueKey, buildNumber, "fixture-manifest.json");
}

function extractAuthToken(storageStatePath: string, baseUrl: string): string {
  if (!existsSync(storageStatePath)) {
    throw new Error(`QA storage state not found at ${storageStatePath}`);
  }

  const raw = JSON.parse(readFileSync(storageStatePath, "utf8")) as {
    origins?: Array<{ origin?: string; localStorage?: Array<{ name?: string; value?: string }> }>;
  };
  const targetOrigin = new URL(baseUrl).origin;
  for (const origin of raw.origins ?? []) {
    if (origin.origin !== targetOrigin && !origin.localStorage?.some((entry) => entry.name === "auth_token")) {
      continue;
    }
    const token = origin.localStorage?.find((entry) => entry.name === "auth_token")?.value;
    if (token) {
      return token;
    }
  }

  throw new Error(`auth_token was not found in ${storageStatePath}`);
}

function authHeaders(authToken: string, qaAgentRunTag: string): Record<string, string> {
  return {
    Authorization: `Bearer ${authToken}`,
    "X-QA-Agent-Run": qaAgentRunTag,
  };
}

async function expectJson<T>(response: Response, context: string): Promise<T> {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${context} failed with ${response.status}: ${text.slice(0, 400)}`);
  }
  return (await response.json()) as T;
}

function buildSeedCanvasContent(qaAgentRunTag: string): Record<string, unknown> {
  return {
    layoutVersion: "freeform-v1",
    metadata: {
      qaAgentRunTag,
      seededBy: "ai-ac-validator",
    },
    layout: [
      {
        i: "qa-agent-widget-group-1",
        x: 12,
        y: 24,
        w: 560,
        h: 340,
        type: "widget_group",
        payload: {
          type: "widget_group",
          groupId: "qa-agent-seeded-group",
          title: "QA Agent Smoke Widget",
          sectionType: "company-scorecard",
          widgetIds: [],
          filtersCollapsed: true,
          items: [
            {
              kind: "cohi",
              id: "qa-agent-seeded-kpi",
              title: "Seeded QA Widget",
              sql: "SELECT COUNT(*)::int AS total_loans FROM public.loans",
              vizConfig: {
                type: "kpi",
                dataKey: "total_loans",
                label: "Total Loans",
              },
              explanation: "Fixture widget created for autonomous QA teardown validation.",
            },
          ],
        },
      },
    ],
    annotations: [],
    background: { type: "color", value: "#ffffff" },
    uploadsMeta: [],
  };
}

export async function seedQaAgentTenant(
  params: SeedQaAgentTenantParams,
): Promise<SeedQaAgentTenantResult> {
  const qaAgentRunTag = buildRunTag(params.buildNumber);
  const manifestPath = buildManifestPath(params.issueKey, params.buildNumber);
  const storageStatePath = resolveStorageStatePath(params.storageStatePath);
  const authToken = extractAuthToken(storageStatePath, params.baseUrl);
  const resources: SeededQaResource[] = [];
  const headers = authHeaders(authToken, qaAgentRunTag);

  mkdirSync(dirname(manifestPath), { recursive: true });

  try {
    const canvasResponse = await fetch(
      `${params.baseUrl.replace(/\/+$/, "")}/api/workbench/canvases`,
      {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        title: `QA Agent Seed ${params.issueKey}`,
        content: buildSeedCanvasContent(qaAgentRunTag),
        visibility: "private",
        qaAgentRunTag,
      }),
      },
    );
    const canvas = await expectJson<{ id: string }>(canvasResponse, "Seed canvas");
    resources.push({
      kind: "canvas",
      id: canvas.id,
      deletePath: `/api/workbench/canvases/${canvas.id}`,
    });

    const formData = new FormData();
    formData.set(
      "file",
      new Blob(
        [
          [
            `QA Agent fixture for ${params.issueKey}`,
            "",
            `Run tag: ${qaAgentRunTag}`,
            "This document exists only so the autonomous validator can test upload and teardown paths safely.",
          ].join("\n"),
        ],
        { type: "text/plain" },
      ),
      `${qaAgentRunTag}.txt`,
    );
    formData.set("title", `QA Agent Fixture ${params.issueKey}`);
    formData.set("category", "QA Agent");
    formData.set("tags", JSON.stringify(["qa-agent", qaAgentRunTag, params.issueKey]));
    formData.set("qaAgentRunTag", qaAgentRunTag);

    const documentResponse = await fetch(
      `${params.baseUrl.replace(/\/+$/, "")}/api/knowledge-center/documents/upload`,
      {
        method: "POST",
        headers,
        body: formData,
      },
    );
    const documentPayload = await expectJson<{ document: { id: string } }>(
      documentResponse,
      "Seed knowledge document",
    );
    resources.push({
      kind: "knowledge_document",
      id: documentPayload.document.id,
      deletePath: `/api/knowledge-center/documents/${documentPayload.document.id}`,
    });

    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          qaAgentRunTag,
          createdAt: new Date().toISOString(),
          resources,
        },
        null,
        2,
      ),
      "utf8",
    );

    return {
      qaAgentRunTag,
      manifestPath,
      resources,
    };
  } catch (error) {
    await teardownQaAgentTenant({
      baseUrl: params.baseUrl,
      buildNumber: params.buildNumber,
      issueKey: params.issueKey,
      storageStatePath,
    }).catch(() => {});
    throw error;
  }
}

export async function teardownQaAgentTenant(
  params: SeedQaAgentTenantParams,
): Promise<TeardownQaAgentTenantResult> {
  const qaAgentRunTag = buildRunTag(params.buildNumber);
  const manifestPath = buildManifestPath(params.issueKey, params.buildNumber);
  const deletedResourceIds: string[] = [];
  const errors: string[] = [];

  if (!existsSync(manifestPath)) {
    return {
      qaAgentRunTag,
      manifestPath,
      deletedResourceIds,
      errors,
    };
  }

  const storageStatePath = resolveStorageStatePath(params.storageStatePath);
  const authToken = extractAuthToken(storageStatePath, params.baseUrl);
  const headers = authHeaders(authToken, qaAgentRunTag);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    resources?: SeededQaResource[];
  };
  const resources = [...(manifest.resources ?? [])].reverse();

  for (const resource of resources) {
    try {
      const response = await fetch(`${params.baseUrl.replace(/\/+$/, "")}${resource.deletePath}`, {
        method: "DELETE",
        headers: {
          ...headers,
          Accept: "application/json",
        },
      });
      if (!response.ok && response.status !== 404) {
        const text = await response.text().catch(() => "");
        throw new Error(`${resource.kind} ${resource.id} delete failed with ${response.status}: ${text.slice(0, 400)}`);
      }
      deletedResourceIds.push(resource.id);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (errors.length === 0) {
    rmSync(manifestPath, { force: true });
  }

  return {
    qaAgentRunTag,
    manifestPath,
    deletedResourceIds,
    errors,
  };
}
