/**
 * Create Jira Cloud issues from docs/COHI_JIRA_IMPORT.json
 *
 * Prereqs: Node 20.6+ (for --env-file) or set env vars manually.
 *
 *   copy jira-import.env.example jira-import.env.local
 *   # edit jira-import.env.local — add JIRA_API_TOKEN
 *
 *   node --env-file=jira-import.env.local scripts/jira-import-from-json.mjs --report
 *   node --env-file=jira-import.env.local scripts/jira-import-from-json.mjs --dry-run
 *   node --env-file=jira-import.env.local scripts/jira-import-from-json.mjs --skip-existing
 *   node --env-file=jira-import.env.local scripts/jira-import-from-json.mjs --only-label=qa-finding --skip-existing
 *
 * Re-import safety: without --skip-existing, every run POSTs new issues (duplicates).
 * With --skip-existing, skips any issue whose summary exactly matches an issue already in project COHI.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const importPath = path.join(root, "docs", "COHI_JIRA_IMPORT.json");

const PROJECT_KEY = process.env.JIRA_PROJECT_KEY || "COHI";

const BASE = (process.env.JIRA_BASE_URL || "").replace(/\/$/, "");
const EMAIL = process.env.JIRA_EMAIL || "";
const TOKEN = process.env.JIRA_API_TOKEN || "";

const argv = process.argv.slice(2);
const args = new Set(argv);
const dryRun = args.has("--dry-run");
const report = args.has("--report");
const skipExisting = args.has("--skip-existing");
const onlyLabel = argv.find((a) => a.startsWith("--only-label="))?.split("=")[1];
const customJql = argv.find((a) => a.startsWith("--jql="))?.split("=").slice(1).join("=");

function basicAuthHeader() {
  const raw = `${EMAIL}:${TOKEN}`;
  const b64 = Buffer.from(raw, "utf8").toString("base64");
  return `Basic ${b64}`;
}

const authHeaders = {
  Authorization: basicAuthHeader(),
  Accept: "application/json",
};

/**
 * Jira Cloud removed GET /rest/api/3/search (410). Use /rest/api/3/search/jql with nextPageToken.
 * @see https://developer.atlassian.com/changelog/#CHANGE-2046
 */
async function jiraSearchPage(jql, nextPageToken, maxResults = 50) {
  const url = new URL(`${BASE}/rest/api/3/search/jql`);
  url.searchParams.set("jql", jql);
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("fields", "summary,issuetype,labels,created,status");
  if (nextPageToken) {
    url.searchParams.set("nextPageToken", nextPageToken);
  }
  const res = await fetch(url, { headers: authHeaders });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = {};
  }
  if (!res.ok) {
    throw new Error(`Jira search/jql ${res.status}: ${text.slice(0, 800)}`);
  }
  return json;
}

/** All issues in project matching JQL (paginated). */
async function fetchAllIssueSummaries(jql) {
  const summaries = new Map();
  let nextPageToken = null;
  const pageSize = 50;
  while (true) {
    const page = await jiraSearchPage(jql, nextPageToken, pageSize);
    const batch = page.issues || [];
    for (const issue of batch) {
      const s = (issue.fields?.summary || "").trim();
      if (s) summaries.set(s, issue.key);
    }
    nextPageToken = page.nextPageToken || null;
    if (!nextPageToken || batch.length === 0) break;
  }
  return summaries;
}

async function createIssue(body) {
  const url = `${BASE}/rest/api/3/issue`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`Jira ${res.status}: ${text.slice(0, 500)}`);
    err.details = json;
    throw err;
  }
  return json;
}

async function runReport() {
  const jql =
    customJql ||
    `project = ${PROJECT_KEY} AND labels = cohi-backlog-draft ORDER BY created DESC`;
  console.error(`JQL: ${jql}\n`);
  let nextPageToken = null;
  const pageSize = 50;
  let n = 0;
  while (true) {
    const page = await jiraSearchPage(jql, nextPageToken, pageSize);
    const batch = page.issues || [];
    for (const issue of batch) {
      n += 1;
      const f = issue.fields;
      const labels = (f.labels || []).join(", ");
      const st = f.status?.name || "";
      const created = f.created?.slice(0, 10) || "";
      const typ = f.issuetype?.name || "";
      console.log(`${issue.key}\t${created}\t${typ}\t${st}\t${f.summary}`);
      if (labels) console.log(`\tlabels: ${labels}`);
    }
    nextPageToken = page.nextPageToken || null;
    if (!nextPageToken || batch.length === 0) break;
  }
  console.error(`\nPrinted ${n} issue(s).`);
  if (n === 0 && !customJql) {
    console.error(
      "\nNo issues with label cohi-backlog-draft. Try:\n  node ... --report --jql=project=COHI ORDER BY created DESC",
    );
  }
}

async function main() {
  if (!BASE || !EMAIL || !TOKEN) {
    console.error(
      "Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN (e.g. node --env-file=jira-import.env.local ...)",
    );
    process.exit(1);
  }

  if (report) {
    await runReport();
    return;
  }

  const data = JSON.parse(fs.readFileSync(importPath, "utf8"));
  const issues = data.issues || [];

  let list = issues;
  if (onlyLabel) {
    list = issues.filter((item) => (item.fields.labels || []).includes(onlyLabel));
    console.error(`Filter --only-label=${onlyLabel}: ${list.length} issue(s)\n`);
  }

  let existingBySummary = null;
  if (skipExisting) {
    console.error(
      `Loading existing summaries from project ${PROJECT_KEY} (for --skip-existing)...`,
    );
    const jql = `project = ${PROJECT_KEY}`;
    existingBySummary = await fetchAllIssueSummaries(jql);
    console.error(`Found ${existingBySummary.size} issue(s) in project.\n`);
  }

  if (dryRun) {
    for (let i = 0; i < list.length; i++) {
      const s = list[i].fields.summary;
      const t = list[i].fields.issuetype?.name;
      const wouldSkip =
        existingBySummary && existingBySummary.has(s.trim()) ? ` [SKIP: exists as ${existingBySummary.get(s.trim())}]` : "";
      console.log(`${i + 1}. [${t}] ${s}${wouldSkip}`);
    }
    console.error(`\nDry run: ${list.length} issue(s). Remove --dry-run to POST.`);
    if (!skipExisting) {
      console.error(
        "Warning: without --skip-existing, a real import creates duplicates if summaries already exist.\n",
      );
    }
    return;
  }

  const created = [];
  let skipped = 0;
  for (let i = 0; i < list.length; i++) {
    const payload = { fields: list[i].fields };
    const summary = payload.fields.summary.trim();
    if (existingBySummary && existingBySummary.has(summary)) {
      skipped += 1;
      console.log(`SKIP ${existingBySummary.get(summary)} — ${summary}`);
      continue;
    }
    try {
      const out = await createIssue(payload);
      created.push(out);
      existingBySummary?.set(summary, out.key);
      console.log(`OK ${out.key} — ${summary}`);
    } catch (e) {
      console.error(`FAIL — ${summary}`);
      console.error(e.message);
      process.exitCode = 1;
      break;
    }
    await new Promise((r) => setTimeout(r, 350));
  }

  if (skipped) console.error(`\nSkipped ${skipped} (already in ${PROJECT_KEY}).`);
  if (created.length) {
    console.error(`\nCreated ${created.length} issue(s). Link QA children to umbrella in Jira UI if needed.`);
  } else if (!process.exitCode) {
    console.error("\nNo new issues created (all skipped or empty list).");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
