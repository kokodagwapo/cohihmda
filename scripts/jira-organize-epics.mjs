/**
 * Create COHI epics (idempotent), link backlog issues to the right epic, close duplicate dashboard ticket.
 *
 *   node --env-file=jira-import.env.local scripts/jira-organize-epics.mjs --dry-run
 *   node --env-file=jira-import.env.local scripts/jira-organize-epics.mjs
 */
import process from "process";

const PROJECT = process.env.JIRA_PROJECT_KEY || "COHI";
const BASE = (process.env.JIRA_BASE_URL || "").replace(/\/$/, "");
const EMAIL = process.env.JIRA_EMAIL || "";
const TOKEN = process.env.JIRA_API_TOKEN || "";

const EPIC_BATCH_LABEL = "cohi-epic-setup-2026-03";

const dryRun = process.argv.includes("--dry-run");

const AUTH = {
  Authorization: `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`, "utf8").toString("base64")}`,
  Accept: "application/json",
  "Content-Type": "application/json",
};

async function api(path, opts = {}) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, { ...opts, headers: { ...AUTH, ...opts.headers } });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`${opts.method || "GET"} ${path} -> ${res.status}: ${text.slice(0, 600)}`);
    err.body = json;
    throw err;
  }
  return json;
}

/**
 * Team-managed (next-gen) uses `parent`; company-managed often uses Epic Link custom field.
 * editmeta is authoritative for what the project accepts.
 * @returns {{ mode: 'parent' } | { mode: 'epicLink', fieldId: string }}
 */
async function detectLinkStrategy(sampleIssueKey) {
  const meta = await api(`/rest/api/3/issue/${sampleIssueKey}/editmeta`);
  const fields = meta.fields || {};
  if (fields.parent) {
    return { mode: "parent" };
  }
  for (const [fieldId, spec] of Object.entries(fields)) {
    const name = (spec?.name || "").toLowerCase();
    const custom = spec?.schema?.custom || "";
    if (name.includes("epic link") || custom.includes("gh-epic-link")) {
      return { mode: "epicLink", fieldId };
    }
  }
  return { mode: "parent" };
}

async function jiraSearchJqlPage(jql, nextPageToken, maxResults = 50) {
  const url = new URL(`${BASE}/rest/api/3/search/jql`);
  url.searchParams.set("jql", jql);
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("fields", "summary,issuetype,labels");
  if (nextPageToken) url.searchParams.set("nextPageToken", nextPageToken);
  return api(url.pathname + url.search);
}

async function fetchIssuesWithJql(jql) {
  const out = [];
  let token = null;
  while (true) {
    const page = await jiraSearchJqlPage(jql, token, 50);
    for (const issue of page.issues || []) out.push(issue);
    token = page.nextPageToken || null;
    if (!token || !(page.issues || []).length) break;
  }
  return out;
}

const EPIC_DEFINITIONS = [
  { slug: "tenant-builder", summary: "COHI — Tenant experience & Cohi Builder" },
  { slug: "workbench", summary: "COHI — Workbench & reporting (PPT/canvas)" },
  { slug: "data-integrations", summary: "COHI — Data & LOS integrations (CSV, webhooks, CRM)" },
  { slug: "ai-platform", summary: "COHI — AI platform (prompts, LLM cost, usage)" },
  { slug: "compliance", summary: "COHI — Compliance & fair lending (HMDA, etc.)" },
  { slug: "exec-insights", summary: "COHI — Executive & dashboard insights" },
  { slug: "quality-ops", summary: "COHI — Quality, refresh, mobile & QA batches" },
  { slug: "partner-mct", summary: "COHI — Partner & MCT thin app" },
];

function epicIndexFromLabels(labels) {
  const L = new Set(labels || []);
  if (L.has("qa-finding") || L.has("qa-umbrella-batch")) return 6;
  if (L.has("mct") || L.has("thin-app")) return 7;
  if (L.has("cohi-builder") || L.has("lender-profile") || L.has("onboarding")) return 0;
  if (L.has("powerpoint") || L.has("workbench")) return 1;
  if (
    L.has("csv") ||
    L.has("webhooks") ||
    L.has("encompass") ||
    L.has("crm") ||
    (L.has("integration") && !L.has("partner-integration"))
  )
    return 2;
  if (L.has("prompts") || L.has("llm-cost") || L.has("token-tracking") || L.has("caching") || L.has("observability"))
    return 3;
  if (L.has("hmda") || L.has("fair-lending")) return 4;
  if (
    L.has("insights") ||
    L.has("dashboard") ||
    L.has("ux-tabs") ||
    L.has("bottlenecks") ||
    L.has("dashboard-insights")
  )
    return 5;
  if (L.has("mobile") || L.has("refresh") || L.has("coheus-classic")) return 6;
  if (L.has("data-quality")) return 5;
  if (L.has("partner-integration")) return 7;
  return 5;
}

async function ensureEpics() {
  const existing = await fetchIssuesWithJql(
    `project = ${PROJECT} AND labels = ${EPIC_BATCH_LABEL} ORDER BY key ASC`,
  );
  const bySlug = new Map();
  for (const issue of existing) {
    const labels = issue.fields.labels || [];
    for (const def of EPIC_DEFINITIONS) {
      if (labels.includes(`cohi-epic-${def.slug}`)) {
        bySlug.set(def.slug, issue.key);
        break;
      }
    }
  }

  const keys = [];
  for (const def of EPIC_DEFINITIONS) {
    if (bySlug.has(def.slug)) {
      keys.push({ slug: def.slug, key: bySlug.get(def.slug), summary: def.summary, existed: true });
      continue;
    }
    if (dryRun) {
      console.log(`[dry-run] Would create Epic: ${def.summary}`);
      keys.push({ slug: def.slug, key: `NEW-EPIC-${def.slug}`, summary: def.summary, existed: false });
      continue;
    }
    const fields = {
      project: { key: PROJECT },
      summary: def.summary,
      issuetype: { name: "Epic" },
      labels: [EPIC_BATCH_LABEL, "cohi-backlog-draft", `cohi-epic-${def.slug}`],
    };
    const created = await api("/rest/api/3/issue", {
      method: "POST",
      body: JSON.stringify({ fields }),
    });
    keys.push({ slug: def.slug, key: created.key, summary: def.summary, existed: false });
    console.log(`Created Epic ${created.key} — ${def.summary}`);
  }
  return keys;
}

async function assignEpic(issueKey, epicKey, strategy) {
  if (dryRun) {
    console.log(`[dry-run] Would link ${issueKey} -> ${epicKey} (${strategy.mode})`);
    return;
  }
  const fields =
    strategy.mode === "parent"
      ? { parent: { key: epicKey } }
      : { [strategy.fieldId]: epicKey };
  await api(`/rest/api/3/issue/${issueKey}`, {
    method: "PUT",
    body: JSON.stringify({ fields }),
  });
  console.log(`Linked ${issueKey} -> ${strategy.mode === "parent" ? "parent" : "Epic Link"} ${epicKey}`);
}

async function addComment(issueKey, body) {
  if (dryRun) {
    console.log(`[dry-run] Comment on ${issueKey}: ${body.slice(0, 80)}...`);
    return;
  }
  await api(`/rest/api/3/issue/${issueKey}/comment`, {
    method: "POST",
    body: JSON.stringify({
      body: {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: body }] }],
      },
    }),
  });
}

async function transitionIssue(issueKey, transitionNameSubstring) {
  const { transitions } = await api(`/rest/api/3/issue/${issueKey}/transitions`);
  const t = transitions.find(
    (x) =>
      x.name.toLowerCase().includes(transitionNameSubstring.toLowerCase()) ||
      (transitionNameSubstring === "done" && x.to?.statusCategory?.key === "done"),
  );
  if (!t) {
    console.error(`No transition matching "${transitionNameSubstring}" for ${issueKey}:`, transitions.map((x) => x.name));
    return false;
  }
  if (dryRun) {
    console.log(`[dry-run] Would transition ${issueKey} via "${t.name}"`);
    return true;
  }
  await api(`/rest/api/3/issue/${issueKey}/transitions`, {
    method: "POST",
    body: JSON.stringify({ transition: { id: t.id } }),
  });
  console.log(`Transitioned ${issueKey} -> ${t.name}`);
  return true;
}

async function main() {
  if (!BASE || !EMAIL || !TOKEN) {
    console.error("Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN (e.g. --env-file=jira-import.env.local)");
    process.exit(1);
  }

  const epicKeys = await ensureEpics();
  const slugToEpicKey = new Map(epicKeys.map((e) => [e.slug, e.key]));

  const backlog = await fetchIssuesWithJql(
    `project = ${PROJECT} AND labels = cohi-backlog-draft ORDER BY key ASC`,
  );

  const sample = backlog.find((i) => (i.fields.issuetype?.name || "") !== "Epic");
  if (!sample) {
    console.error("No non-Epic issues found to detect link strategy.");
    process.exit(1);
  }
  const strategy = await detectLinkStrategy(sample.key);
  console.error(`Link strategy from ${sample.key} editmeta: ${strategy.mode}\n`);

  for (const issue of backlog) {
    const key = issue.key;
    const type = issue.fields.issuetype?.name || "";
    if (type === "Epic") continue;
    const labels = issue.fields.labels || [];
    if (labels.some((l) => l.startsWith("cohi-epic-") && l !== EPIC_BATCH_LABEL)) continue;

    const idx = epicIndexFromLabels(labels);
    const slug = EPIC_DEFINITIONS[idx].slug;
    const epicKey = slugToEpicKey.get(slug);
    if (!epicKey || epicKey.startsWith("NEW-EPIC-")) continue;

    try {
      await assignEpic(key, epicKey, strategy);
    } catch (e) {
      console.error(`${key}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  const dup = "COHI-11";
  const canon = "COHI-39";
  await addComment(
    dup,
    `Superseded by ${canon} (dashboard insights — partial rollout / Maylin review). Closing as duplicate to keep one canonical card.`,
  );
  const closed =
    (await transitionIssue(dup, "done")) ||
    (await transitionIssue(dup, "close")) ||
    (await transitionIssue(dup, "cancel")) ||
    (await transitionIssue(dup, "won"));

  if (!closed && !dryRun) {
    console.error(`Could not auto-close ${dup}; close it manually and mark as duplicate of ${canon}.`);
  }

  console.error("\nDone. Verify Epics and issue links in Jira.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
