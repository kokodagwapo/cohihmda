import { parseAcceptanceCriteria } from "./acParser.js";
import type { ACStatement } from "./types.js";

interface AtlassianConfig {
  siteUrl: string;
  email: string;
  apiToken: string;
}

export interface JiraAcReadResult {
  issueKey: string;
  issueSummary: string;
  issueStatus: string;
  descriptionText: string;
  blockText?: string;
  statements?: ACStatement[];
  error?: string;
}

function loadAtlassianConfig(): AtlassianConfig {
  const rawSiteUrl = process.env.ATLASSIAN_SITE_URL;
  const email = process.env.ATLASSIAN_EMAIL;
  const apiToken = process.env.ATLASSIAN_API_TOKEN;

  if (!rawSiteUrl || !email || !apiToken) {
    throw new Error(
      "ATLASSIAN_SITE_URL, ATLASSIAN_EMAIL, and ATLASSIAN_API_TOKEN are required for AC validation",
    );
  }

  return {
    siteUrl: rawSiteUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, ""),
    email,
    apiToken,
  };
}

function authHeader(cfg: AtlassianConfig): string {
  return "Basic " + Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString("base64");
}

async function jiraRequest(cfg: AtlassianConfig, method: string, path: string, body?: unknown): Promise<any> {
  const response = await fetch(`https://${cfg.siteUrl}/rest/api/3${path}`, {
    method,
    headers: {
      Authorization: authHeader(cfg),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Jira ${method} ${path} failed ${response.status}: ${text.slice(0, 300)}`);
  }

  return response.json().catch(() => ({}));
}

function flattenAdfNode(node: any, orderedIndex = 1): string {
  if (!node) return "";
  if (Array.isArray(node)) {
    return node.map((entry, index) => flattenAdfNode(entry, index + 1)).join("");
  }

  if (typeof node.text === "string") {
    return node.text;
  }

  switch (node.type) {
    case "doc":
      return flattenAdfNode(node.content);
    case "heading":
      return `${flattenAdfNode(node.content)}\n`;
    case "paragraph":
      return `${flattenAdfNode(node.content)}\n`;
    case "codeBlock":
      return `${flattenAdfNode(node.content)}\n`;
    case "orderedList":
      return (node.content ?? [])
        .map((item: any, index: number) => `${index + 1}. ${flattenAdfNode(item).trim()}\n`)
        .join("");
    case "bulletList":
      return (node.content ?? [])
        .map((item: any) => `- ${flattenAdfNode(item).trim()}\n`)
        .join("");
    case "listItem":
      return flattenAdfNode(node.content);
    case "hardBreak":
      return "\n";
    default:
      return flattenAdfNode(node.content);
  }
}

function flattenJiraDescription(description: unknown): string {
  if (!description) return "";
  if (typeof description === "string") return description;
  return flattenAdfNode(description).replace(/\n{3,}/g, "\n\n").trim();
}

export async function postJiraComment(issueKey: string, text: string): Promise<void> {
  const cfg = loadAtlassianConfig();
  await jiraRequest(cfg, "POST", `/issue/${issueKey}/comment`, {
    body: {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text }],
        },
      ],
    },
  });
}

export async function readIssueAcceptanceCriteria(issueKey: string): Promise<JiraAcReadResult> {
  const cfg = loadAtlassianConfig();
  const issue = await jiraRequest(
    cfg,
    "GET",
    `/issue/${encodeURIComponent(issueKey)}?fields=summary,status,description`,
  );

  const issueSummary = String(issue?.fields?.summary ?? "Unknown issue");
  const issueStatus = String(issue?.fields?.status?.name ?? "Unknown");
  const descriptionText = flattenJiraDescription(issue?.fields?.description);
  const parsed = parseAcceptanceCriteria(descriptionText);

  if ("error" in parsed) {
    return {
      issueKey,
      issueSummary,
      issueStatus,
      descriptionText,
      blockText: parsed.blockText,
      error: parsed.error,
    };
  }

  return {
    issueKey,
    issueSummary,
    issueStatus,
    descriptionText,
    blockText: parsed.blockText,
    statements: parsed.statements,
  };
}
