#!/usr/bin/env node
/**
 * Fetch HMDA modified-LAR per-institution files directly from FFIEC and
 * aggregate them into the hmdaInsights schema used by the dashboard.
 *
 * Why: The FFIEC Data Browser API does NOT serve 2025 yet (only 2018–2024),
 * but the modified-LAR per-LEI raw files for 2025 ARE published at
 *   https://ffiec.cfpb.gov/data-publication/modified-lar/2025
 * (per-institution endpoint: /file/modifiedLar/year/2025/institution/<lei>/txt/header).
 *
 * This script streams each per-LEI file, parses every loan record, and writes
 * an enriched lender JSON with full hmdaInsights (loan_type 1-4 originated /
 * applications / dollar volume, action_taken 1-8, denial_reason 1-10, median
 * interest_rate / rate_spread / loan_term / CLTV / DTI).
 *
 * Usage:
 *   node scripts/fetch-hmda-mlar-insights.mjs --year=2025
 *   node scripts/fetch-hmda-mlar-insights.mjs --year=2025 --concurrency=10 --min-orig=1
 *   node scripts/fetch-hmda-mlar-insights.mjs --year=2025 --limit=50 --resume
 *
 * Output: public/data/lenders-from-hmda.json (year rows replaced/merged in place)
 */
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { HMDA_CACHE_DIR, HMDA_DATA_DIR } from "./paths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_PATH = path.join(HMDA_DATA_DIR, "lenders-from-hmda.json");
const CHECKPOINT_DIR = path.join(HMDA_CACHE_DIR, "mlar-insights");

// MLAR column indices (0-based) — confirmed from header row of 2025 files.
const COL = {
  activityYear: 0,
  lei: 1,
  loanType: 2,
  loanPurpose: 3,
  preapproval: 4,
  constructionMethod: 5,
  occupancyType: 6,
  loanAmount: 7,
  actionTaken: 8,
  stateCode: 9,
  countyCode: 10,
  censusTract: 11,
  rateSpread: 46,
  hoepaStatus: 47,
  lienStatus: 48,
  denial1: 51,
  denial2: 52,
  denial3: 53,
  denial4: 54,
  interestRate: 60,
  dti: 62,
  cltv: 63,
  loanTermMonths: 64,
  submission: 75,
  initiallyPayable: 76,
  reverseMortgage: 82,
  openEndLineOfCredit: 83,
  businessPurpose: 84,
};

const CONFORMING = { 2022: 647200, 2023: 726200, 2024: 766550, 2025: 806500 };

function parseArgs() {
  const out = {
    year: 2025,
    concurrency: 8,
    minOrig: 1,
    limit: 0,
    resume: false,
    requestTimeoutMs: 120_000,
    retries: 3,
  };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--year=")) out.year = parseInt(a.slice(7), 10);
    else if (a.startsWith("--concurrency=")) out.concurrency = Math.max(1, parseInt(a.slice(14), 10));
    else if (a.startsWith("--min-orig=")) out.minOrig = parseInt(a.slice(11), 10);
    else if (a.startsWith("--limit=")) out.limit = parseInt(a.slice(8), 10);
    else if (a === "--resume") out.resume = true;
  }
  return out;
}

function median(arr) {
  if (!arr.length) return null;
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function toNumber(v) {
  if (v == null || v === "" || v === "NA" || v === "Exempt") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fetchFilers(year) {
  return new Promise((resolve, reject) => {
    const url = `https://ffiec.cfpb.gov/v2/reporting/filers/${year}`;
    https
      .get(
        url,
        {
          headers: {
            accept: "application/json",
            "user-agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) cohi-warehouse-etl/1.0",
            referer: "https://ffiec.cfpb.gov/data-publication/modified-lar",
          },
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`filers HTTP ${res.statusCode}`));
          }
          let chunks = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (chunks += c));
          res.on("end", () => {
            try {
              const j = JSON.parse(chunks);
              resolve(Array.isArray(j.institutions) ? j.institutions : []);
            } catch (e) {
              reject(e);
            }
          });
        },
      )
      .on("error", reject);
  });
}

function makeEmptyInsights(year) {
  return {
    schemaVersion: 2,
    reportingYear: year,
    totalApplications: 0,
    totalOriginated: 0,
    actionTaken: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 },
    denialReasons: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0 },
    denialReasonsSuppressedCount: 0,
    denialCount: 0,
    withdrawalCount: 0,
    incompleteCount: 0,
    approvedNotAcceptedCount: 0,
    purchasedLoanCount: 0,
    originatedMedianInterestRate: null,
    originatedMedianRateSpread: null,
    originatedMedianLoanTermMonths: null,
    originatedMedianCltv: null,
    originatedMedianDti: null,
    spreadSampleSize: 0,
    termSampleSize: 0,
    cltvSampleSize: 0,
    dtiSampleSize: 0,
    interestRateSampleSize: 0,
    loanTypeSummary: {
      1: { applications: 0, originated: 0, dollarVolume: 0 },
      2: { applications: 0, originated: 0, dollarVolume: 0 },
      3: { applications: 0, originated: 0, dollarVolume: 0 },
      4: { applications: 0, originated: 0, dollarVolume: 0 },
    },
    lienOnOriginated: {},
    hoepaOnOriginated: {},
    submissionOnApplications: {},
    initiallyPayableOnApplications: {},
    geographyHhiStates: null,
    topStateOriginationShare: null,
    stateBreakdown: [],
    topCounties: [],
    topMsas: [],
    quarterlyFromLar: null,
    monthlyFromLar: null,
    hasActionTakenDate: false,
    databrowserSource: false,
    source: `modifiedLar-${year}-direct`,
    note: "Aggregated directly from FFIEC modified-LAR per-institution file.",
  };
}

function aggregateLine(cols, agg, samples, perRow) {
  if (cols.length < 84) return;
  const action = parseInt(cols[COL.actionTaken], 10);
  if (!action) return;
  agg.totalApplications += 1;
  if (action >= 1 && action <= 8) {
    agg.actionTaken[action] = (agg.actionTaken[action] || 0) + 1;
  }
  if (action === 1) agg.totalOriginated += 1;
  if (action === 3) agg.denialCount += 1;
  if (action === 4) agg.withdrawalCount += 1;
  if (action === 5) agg.incompleteCount += 1;
  if (action === 2) agg.approvedNotAcceptedCount += 1;
  if (action === 6) agg.purchasedLoanCount += 1;

  const loanType = parseInt(cols[COL.loanType], 10);
  const amount = toNumber(cols[COL.loanAmount]) || 0;
  if (loanType >= 1 && loanType <= 4) {
    const lt = agg.loanTypeSummary[loanType];
    lt.applications += 1;
    if (action === 1) {
      lt.originated += 1;
      lt.dollarVolume += amount;
    }
  }

  if (action === 3) {
    let any = false;
    for (const idx of [COL.denial1, COL.denial2, COL.denial3, COL.denial4]) {
      const dr = parseInt(cols[idx], 10);
      if (dr >= 1 && dr <= 10) {
        agg.denialReasons[dr] = (agg.denialReasons[dr] || 0) + 1;
        any = true;
      }
    }
    if (!any) agg.denialReasonsSuppressedCount += 1;
  }

  if (action === 1) {
    const ir = toNumber(cols[COL.interestRate]);
    if (ir != null) samples.interestRate.push(ir);
    const rs = toNumber(cols[COL.rateSpread]);
    if (rs != null) samples.rateSpread.push(rs);
    const lt = toNumber(cols[COL.loanTermMonths]);
    if (lt != null) samples.loanTerm.push(lt);
    const cltv = toNumber(cols[COL.cltv]);
    if (cltv != null) samples.cltv.push(cltv);
    const dtiRaw = cols[COL.dti];
    const dti = toNumber(dtiRaw);
    if (dti != null) samples.dti.push(dti);
    perRow.states.add(String(cols[COL.stateCode] || ""));
    const lien = parseInt(cols[COL.lienStatus], 10);
    if (lien) agg.lienOnOriginated[lien] = (agg.lienOnOriginated[lien] || 0) + 1;
    const hoepa = parseInt(cols[COL.hoepaStatus], 10);
    if (hoepa) agg.hoepaOnOriginated[hoepa] = (agg.hoepaOnOriginated[hoepa] || 0) + 1;
  }
  const sub = parseInt(cols[COL.submission], 10);
  if (sub) agg.submissionOnApplications[sub] = (agg.submissionOnApplications[sub] || 0) + 1;
  const ip = parseInt(cols[COL.initiallyPayable], 10);
  if (ip) agg.initiallyPayableOnApplications[ip] = (agg.initiallyPayableOnApplications[ip] || 0) + 1;
}

function finalizeInsights(agg, samples) {
  agg.originatedMedianInterestRate = median(samples.interestRate);
  agg.originatedMedianRateSpread = median(samples.rateSpread);
  agg.originatedMedianLoanTermMonths = median(samples.loanTerm);
  agg.originatedMedianCltv = median(samples.cltv);
  agg.originatedMedianDti = median(samples.dti);
  agg.interestRateSampleSize = samples.interestRate.length;
  agg.spreadSampleSize = samples.rateSpread.length;
  agg.termSampleSize = samples.loanTerm.length;
  agg.cltvSampleSize = samples.cltv.length;
  agg.dtiSampleSize = samples.dti.length;
}

function getProductsFromAgg(agg, conforming) {
  const products = new Set();
  const lt = agg.loanTypeSummary;
  if (lt[1].originated > 0) {
    products.add("Conventional");
    const avgConv = lt[1].dollarVolume / Math.max(1, lt[1].originated);
    if (avgConv > conforming) products.add("Jumbo");
  }
  if (lt[2].originated > 0) products.add("FHA");
  if (lt[3].originated > 0) products.add("VA");
  if (lt[4].originated > 0) products.add("USDA");
  return [...products];
}

function fetchMlarStreaming(lei, year, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = `https://ffiec.cfpb.gov/file/modifiedLar/year/${year}/institution/${lei}/txt/header`;
    const req = https.get(
      url,
      {
        headers: {
          accept: "text/csv,text/plain,*/*",
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) cohi-warehouse-etl/1.0",
          referer: "https://ffiec.cfpb.gov/data-publication/modified-lar",
        },
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode === 404) {
          res.resume();
          return resolve({ found: false });
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const agg = makeEmptyInsights(year);
        const samples = {
          interestRate: [],
          rateSpread: [],
          loanTerm: [],
          cltv: [],
          dti: [],
        };
        const perRow = { states: new Set() };

        let header = null;
        let rowCount = 0;
        let bytes = 0;
        res.on("data", (c) => (bytes += c.length));
        const rl = readline.createInterface({ input: res, crlfDelay: Infinity });
        rl.on("line", (line) => {
          if (!line) return;
          if (header == null) {
            header = line;
            return;
          }
          rowCount += 1;
          const cols = line.split("|");
          aggregateLine(cols, agg, samples, perRow);
        });
        rl.on("close", () => {
          finalizeInsights(agg, samples);
          resolve({
            found: true,
            insights: agg,
            stateCount: perRow.states.size,
            rowCount,
            bytes,
          });
        });
        rl.on("error", reject);
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("request timeout"));
    });
  });
}

async function fetchMlarWithRetry(lei, year, opts) {
  let lastErr = null;
  for (let attempt = 0; attempt < opts.retries; attempt++) {
    try {
      return await fetchMlarStreaming(lei, year, opts.requestTimeoutMs);
    } catch (e) {
      lastErr = e;
      const delay = Math.min(5_000, 400 * (attempt + 1));
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr || new Error("unknown fetch error");
}

function checkpointPath(year) {
  return path.join(CHECKPOINT_DIR, `mlar-insights-${year}.json`);
}

function loadCheckpoint(year) {
  const file = checkpointPath(year);
  if (!fs.existsSync(file)) return { byLei: {} };
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { byLei: {} };
  }
}

function saveCheckpoint(year, state) {
  fs.mkdirSync(path.dirname(checkpointPath(year)), { recursive: true });
  fs.writeFileSync(checkpointPath(year), JSON.stringify(state));
}

async function main() {
  const opts = parseArgs();
  const year = opts.year;
  console.log(`[mlar-insights] year=${year} concurrency=${opts.concurrency} resume=${opts.resume}`);

  const filers = await fetchFilers(year);
  if (!filers.length) throw new Error(`No filers returned for ${year}`);
  console.log(`[mlar-insights] ${filers.length} filers for ${year}`);

  const targets = opts.limit > 0 ? filers.slice(0, opts.limit) : filers;
  const state = opts.resume ? loadCheckpoint(year) : { byLei: {} };

  let idx = 0;
  let done = 0;
  let withData = Object.keys(state.byLei).length;
  let failures = 0;
  const failuresByLei = {};
  const t0 = Date.now();

  const conforming = CONFORMING[year] || 806500;

  const workers = Array.from({ length: opts.concurrency }, async () => {
    while (idx < targets.length) {
      const i = idx++;
      const inst = targets[i];
      const lei = inst.lei;
      if (!lei) continue;
      if (opts.resume && state.byLei[lei]) {
        done += 1;
        continue;
      }
      try {
        const out = await fetchMlarWithRetry(lei, year, opts);
        if (out.found && out.insights.totalApplications >= opts.minOrig) {
          state.byLei[lei] = {
            insights: out.insights,
            stateCount: out.stateCount,
            rowCount: out.rowCount,
            name: inst.name,
            orig: out.insights.totalOriginated,
            dollarVol: Object.values(out.insights.loanTypeSummary).reduce(
              (a, b) => a + (b.dollarVolume || 0),
              0,
            ),
            products: getProductsFromAgg(out.insights, conforming),
          };
          withData += 1;
        }
      } catch (e) {
        failures += 1;
        failuresByLei[lei] = String(e.message || e).slice(0, 200);
      }
      done += 1;
      if (done % 25 === 0 || done === targets.length) {
        if (done % 100 === 0 || done === targets.length) saveCheckpoint(year, state);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        const rate = (done / Math.max(1, parseFloat(elapsed))).toFixed(1);
        process.stdout.write(
          `\r[mlar-insights] ${done}/${targets.length} | withData=${withData} | failures=${failures} | ${elapsed}s | ${rate}/s   `,
        );
      }
    }
  });
  await Promise.all(workers);
  process.stdout.write("\n");
  saveCheckpoint(year, state);
  console.log(`[mlar-insights] checkpoint saved: ${checkpointPath(year)}`);
  if (failures) {
    console.log(`[mlar-insights] ${failures} fetch failures (first 5):`);
    for (const [lei, msg] of Object.entries(failuresByLei).slice(0, 5)) {
      console.log(`  ${lei}: ${msg}`);
    }
  }

  // Merge into lenders-from-hmda.json
  fs.mkdirSync(HMDA_DATA_DIR, { recursive: true });
  let existing = [];
  if (fs.existsSync(SRC_PATH)) {
    existing = JSON.parse(fs.readFileSync(SRC_PATH, "utf8"));
  }
  const all = Array.isArray(existing) ? existing : [];
  const otherYears = all.filter((r) => Number(r.dataYear) !== Number(year));
  // Build new year rows from filers + insights (prefer filer name; fallback to prior name)
  const priorByLei = new Map();
  for (const r of all) {
    if (!r.lei) continue;
    if (!priorByLei.has(r.lei)) priorByLei.set(r.lei, r);
  }
  const newRows = [];
  for (const inst of filers) {
    const lei = inst.lei;
    if (!lei) continue;
    const entry = state.byLei[lei];
    if (!entry) continue;
    const prior = priorByLei.get(lei) || {};
    newRows.push({
      lei,
      name: entry.name || prior.name || lei,
      nmls: prior.nmls || "",
      type: prior.type || "IMB",
      dataYear: year,
      orig: entry.orig,
      dollarVol: entry.dollarVol,
      branches: prior.branches ?? null,
      states: Math.min(50, entry.stateCount || 0),
      fico: prior.fico ?? null,
      ltv: prior.ltv ?? null,
      dti: prior.dti ?? null,
      rate:
        entry.insights.originatedMedianInterestRate != null
          ? Number(entry.insights.originatedMedianInterestRate)
          : prior.rate ?? 6.75,
      hmdaRate:
        entry.insights.originatedMedianInterestRate != null
          ? Number(entry.insights.originatedMedianInterestRate)
          : null,
      rateSource:
        entry.insights.originatedMedianInterestRate != null ? "hmda-mlar" : "estimated",
      products: entry.products.length ? entry.products : prior.products || ["Conventional"],
      conf: Math.min(95, 70 + Math.floor((entry.orig || 0) / 5000)),
      hmdaInsights: entry.insights,
    });
  }
  newRows.sort((a, b) => (b.orig || 0) - (a.orig || 0));

  const merged = [...otherYears, ...newRows];
  fs.writeFileSync(SRC_PATH, JSON.stringify(merged));
  console.log(
    `[mlar-insights] wrote ${SRC_PATH} — ${newRows.length} ${year} rows merged with ${otherYears.length} other-year rows.`,
  );
}

main().catch((e) => {
  console.error("[mlar-insights] failed:", e);
  process.exit(1);
});
