#!/usr/bin/env tsx

import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { fileURLToPath } from "url";
import { UNTAGGED_SPEC_ALLOWLIST } from "./untaggedSpecAllowlist.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const REPO_ROOT = resolve(__dirname, "../../../../");
const E2E_ROOT = join(REPO_ROOT, "e2e");

const VALID_JIRA_TAG_REGEX = /^@[A-Z][A-Z0-9]+-\d+$/;
const VALID_JIRA_KEY_REGEX = /\b[A-Z][A-Z0-9]+-\d+\b/g;
const MALFORMED_JIRA_LIKE_TAG_REGEX = /@[A-Za-z][A-Za-z0-9]*-?\d+/g;
const TEST_CALL_REGEX = /\btest(?:\.(?:skip|only|fixme|fail))?\s*\(/;

interface TestTitleRef {
  file: string;
  line: number;
  title: string;
}

interface LintError {
  file: string;
  line: number;
  message: string;
}

function walkSpecFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...walkSpecFiles(fullPath));
      continue;
    }
    if (entry.endsWith(".spec.ts")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function extractTitleFromLine(line: string): string | null {
  if (!TEST_CALL_REGEX.test(line) || line.includes("test.describe")) {
    return null;
  }

  const openParenIndex = line.indexOf("(");
  if (openParenIndex === -1) return null;

  let delimiter: "'" | '"' | "`" | null = null;
  let titleStart = -1;
  for (let i = openParenIndex + 1; i < line.length; i += 1) {
    const char = line[i];
    if (char === "'" || char === "\"" || char === "`") {
      delimiter = char;
      titleStart = i + 1;
      break;
    }
    if (!/\s/.test(char)) {
      return null;
    }
  }

  if (!delimiter || titleStart === -1) {
    return null;
  }

  let escaped = false;
  for (let i = titleStart; i < line.length; i += 1) {
    const char = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === delimiter) {
      return line.slice(titleStart, i);
    }
  }

  return null;
}

function extractTestTitles(filePath: string): TestTitleRef[] {
  const source = readFileSync(filePath, "utf8");
  return source
    .split(/\r?\n/)
    .map((line, index) => {
      const title = extractTitleFromLine(line);
      if (!title) return null;
      return {
        file: relative(REPO_ROOT, filePath).replace(/\\/g, "/"),
        line: index + 1,
        title,
      };
    })
    .filter((entry): entry is TestTitleRef => Boolean(entry));
}

function findMalformedTags(title: string): string[] {
  const candidates = title.match(MALFORMED_JIRA_LIKE_TAG_REGEX) ?? [];
  return candidates.filter((token) => !VALID_JIRA_TAG_REGEX.test(token));
}

function extractValidIssueKeys(title: string): string[] {
  return [...new Set(title.match(VALID_JIRA_KEY_REGEX) ?? [])];
}

async function verifyJiraKeysExist(issueKeys: string[]): Promise<string[]> {
  if (process.env.QA_LINT_VERIFY_JIRA !== "true" || issueKeys.length === 0) {
    return [];
  }

  const rawSiteUrl = process.env.ATLASSIAN_SITE_URL;
  const email = process.env.ATLASSIAN_EMAIL;
  const apiToken = process.env.ATLASSIAN_API_TOKEN;

  if (!rawSiteUrl || !email || !apiToken) {
    throw new Error(
      "QA_LINT_VERIFY_JIRA=true requires ATLASSIAN_SITE_URL, ATLASSIAN_EMAIL, and ATLASSIAN_API_TOKEN",
    );
  }

  const siteUrl = rawSiteUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const authHeader = "Basic " + Buffer.from(`${email}:${apiToken}`).toString("base64");
  const missingKeys = new Set(issueKeys);

  for (let index = 0; index < issueKeys.length; index += 50) {
    const chunk = issueKeys.slice(index, index + 50);
    const jql = `key in (${chunk.join(",")})`;
    const response = await fetch(
      `https://${siteUrl}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=key&maxResults=${chunk.length}`,
      {
        headers: {
          Authorization: authHeader,
          Accept: "application/json",
          "Accept-Language": "en-US",
        },
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Jira key verification failed ${response.status}: ${text.slice(0, 200)}`);
    }

    const payload = await response.json().catch(() => ({}));
    const returnedKeys = new Set<string>((payload?.issues ?? []).map((issue: any) => String(issue?.key ?? "")));
    chunk.forEach((key) => {
      if (returnedKeys.has(key)) {
        missingKeys.delete(key);
      }
    });
  }

  return [...missingKeys].sort();
}

async function main(): Promise<void> {
  const errors: LintError[] = [];
  const allIssueKeys = new Set<string>();
  const allowlistHits = new Set<string>();

  for (const filePath of walkSpecFiles(E2E_ROOT)) {
    const relativePath = relative(REPO_ROOT, filePath).replace(/\\/g, "/");
    const titles = extractTestTitles(filePath);
    const isAllowlisted = UNTAGGED_SPEC_ALLOWLIST.has(relativePath);
    let fileHasMissingTags = false;

    for (const testRef of titles) {
      const malformedTags = findMalformedTags(testRef.title);
      malformedTags.forEach((tag) => {
        errors.push({
          file: testRef.file,
          line: testRef.line,
          message: `Malformed Jira tag "${tag}". Expected @PROJECT-123 format.`,
        });
      });

      const issueKeys = extractValidIssueKeys(testRef.title);
      issueKeys.forEach((key) => allIssueKeys.add(key));

      if (issueKeys.length === 0) {
        fileHasMissingTags = true;
        if (!isAllowlisted) {
          errors.push({
            file: testRef.file,
            line: testRef.line,
            message: "Missing @COHI-* Jira tag on test title.",
          });
        }
      }
    }

    if (isAllowlisted) {
      allowlistHits.add(relativePath);
      if (!fileHasMissingTags) {
        errors.push({
          file: relativePath,
          line: 1,
          message: "File is allowlisted but no longer needs the exemption. Remove it from untaggedSpecAllowlist.ts.",
        });
      }
    }
  }

  const staleAllowlistEntries = [...UNTAGGED_SPEC_ALLOWLIST].filter((entry) => !allowlistHits.has(entry));
  staleAllowlistEntries.forEach((entry) => {
    errors.push({
      file: entry,
      line: 1,
      message: "Allowlist entry does not match any current spec file.",
    });
  });

  const missingJiraKeys = await verifyJiraKeysExist([...allIssueKeys].sort());
  missingJiraKeys.forEach((key) => {
    errors.push({
      file: "e2e",
      line: 1,
      message: `Jira key "${key}" was referenced in a test title but was not found in Jira.`,
    });
  });

  if (errors.length > 0) {
    console.error("\nQA test tag lint failed:\n");
    errors.forEach((error) => {
      console.error(`- ${error.file}:${error.line} ${error.message}`);
    });
    process.exit(1);
  }

  console.log("QA test tag lint passed.");
}

main().catch((error) => {
  console.error("QA test tag lint crashed:", error);
  process.exit(1);
});
