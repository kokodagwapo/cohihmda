#!/usr/bin/env node
/**
 * Build public/data/geo-drilldown-from-hmda.json from HMDA combined MLAR files.
 *
 * Auto-discovers all MLAR files in the project root:
 *   {year}_combined_mlar_header.txt   (pipe-delimited, with header row)
 *   {year}_combined_mlar_header.zip   (zip containing a .txt inside)
 *
 * Only rows with action_taken = 1 (originated) are counted.
 * Writes/merges one year at a time so re-running for a single year
 * does not wipe data for other years already in the output.
 *
 * Usage:
 *   node scripts/build-geo-drilldown-hmda.mjs            # all found MLAR years
 *   node scripts/build-geo-drilldown-hmda.mjs 2025       # specific year only
 *   node scripts/build-geo-drilldown-hmda.mjs 2024 2025  # multiple years
 *
 * npm: npm run hmda:geo
 */

import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import zlib from "zlib";
import { pipeline } from "stream/promises";
import { HMDA_DATA_DIR, HMDA_MLAR_DIR } from "./paths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(HMDA_DATA_DIR, "geo-drilldown-from-hmda.json");

const TOP_COUNTIES_PER_STATE = null; // null = keep all
const TOP_TRACTS_PER_COUNTY = 12;

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtTract(v) {
  const t = (v || "").trim();
  if (!t) return "unknown";
  if (t.includes(".")) {
    const [left, right] = t.split(".");
    return `${left.padStart(6, "0")}.${right.slice(0, 2).padEnd(2, "0")}`;
  }
  if (/^\d+$/.test(t)) {
    if (t.length > 6) return `${t.slice(0, -2).padStart(6, "0")}.${t.slice(-2)}`;
    return `${t.padStart(6, "0")}.00`;
  }
  return t;
}

function findCol(headers, ...candidates) {
  const lc = headers.map((h) => h.toLowerCase().trim());
  for (const name of candidates) {
    const i = lc.indexOf(name.toLowerCase());
    if (i !== -1) return i;
  }
  return -1;
}

// ── race/ethnicity diversity helpers ─────────────────────────────────────────

/**
 * Map HMDA `derived_race` + `derived_ethnicity` to one of six buckets used for
 * Simpson's Diversity Index.  Returns null when race/ethnicity is unknown/exempt
 * so those rows are excluded from the denominator.
 */
function raceBucket(raceRaw, ethRaw) {
  const r = (raceRaw || "").trim().toLowerCase();
  const e = (ethRaw  || "").trim().toLowerCase();
  if (
    r === "race not available" || r === "free form text only" || r === "exempt" || r === "" ||
    e === "ethnicity not available" || e === "free form text only" || e === "exempt"
  ) return null;
  if (e === "hispanic or latino") return "hispanic";
  if (r === "white") return "white";
  if (r === "black or african american") return "black";
  if (r === "asian") return "asian";
  if (r === "american indian or alaska native") return "nativeAm";
  if (r === "native hawaiian or other pacific islander") return "pacificIsl";
  return "other";
}

function computeDiversityMetrics(buckets) {
  const counts = Object.values(buckets);
  const total  = counts.reduce((s, n) => s + n, 0);
  if (total < 10) return { diversityScore: null, minorityShare: null };
  const simpson = 1 - counts.reduce((s, n) => s + (n / total) ** 2, 0);
  const diversityScore = Math.round(simpson * 100);
  const minority = total - (buckets.white || 0);
  const minorityShare = Math.round((minority / total) * 1000) / 10;
  return { diversityScore, minorityShare };
}

function emptyRaceBuckets() {
  return { white: 0, black: 0, asian: 0, hispanic: 0, nativeAm: 0, pacificIsl: 0, other: 0 };
}

// ── aggregation ──────────────────────────────────────────────────────────────

async function aggregateLines(lineIter) {
  /** @type {Map<string, {units:number,volume:number,counties:Map<string,{units:number,volume:number,tracts:Map<string,{units:number,volume:number}>}>,raceBuckets:object}>} */
  const agg = new Map();

  let headerParsed = false;
  let sep = "|";
  let idxAction = 8, idxState = 9, idxCounty = 10, idxTract = 11, idxAmount = 7;
  let idxRace = -1, idxEthnicity = -1;
  let processed = 0;

  for await (const raw of lineIter) {
    const line = typeof raw === "string" ? raw : raw.toString("utf8");
    const trimmed = line.trimEnd();
    if (!trimmed) continue;

    if (!headerParsed) {
      sep = trimmed.includes("|") ? "|" : ",";
      const headers = trimmed.split(sep).map((h) => h.trim());
      idxAction    = findCol(headers, "action_taken");
      idxState     = findCol(headers, "state_code", "derived_msa-md", "state");
      idxCounty    = findCol(headers, "county_code", "county");
      idxTract     = findCol(headers, "census_tract", "tract_number");
      idxAmount    = findCol(headers, "loan_amount", "loan_amount_000s");
      idxRace      = findCol(headers, "derived_race");
      idxEthnicity = findCol(headers, "derived_ethnicity");
      if (idxAction < 0) { idxAction = 8; idxState = 9; idxCounty = 10; idxTract = 11; idxAmount = 7; }
      process.stdout.write(
        `  Header: ${headers.length} cols | action@${idxAction} state@${idxState} county@${idxCounty} tract@${idxTract} amount@${idxAmount} race@${idxRace} eth@${idxEthnicity}\n`
      );
      headerParsed = true;
      continue;
    }

    const cols = trimmed.split(sep);
    const needed = Math.max(idxAction, idxState, idxCounty, idxTract, idxAmount);
    if (cols.length <= needed) continue;

    const actionTaken = (cols[idxAction] || "").trim();
    const state = (cols[idxState] || "").trim().toUpperCase();
    if (!state) continue;

    if (idxRace >= 0) {
      const bucket = raceBucket(
        idxRace      >= 0 ? cols[idxRace]      : "",
        idxEthnicity >= 0 ? cols[idxEthnicity] : "",
      );
      if (bucket) {
        if (!agg.has(state)) agg.set(state, { units: 0, volume: 0, counties: new Map(), raceBuckets: emptyRaceBuckets() });
        agg.get(state).raceBuckets[bucket] = (agg.get(state).raceBuckets[bucket] || 0) + 1;
      }
    }

    if (actionTaken !== "1") continue;

    let county = (cols[idxCounty] || "").trim();
    if (!county || county === "NA" || county === "Exempt") county = "000";
    else if (/^\d+$/.test(county)) county = county.padStart(3, "0");

    const tract = fmtTract(cols[idxTract]);
    const rawAmt = (cols[idxAmount] || "").trim();
    const amt = /^\d+$/.test(rawAmt) ? parseInt(rawAmt, 10) : 0;

    if (!agg.has(state)) agg.set(state, { units: 0, volume: 0, counties: new Map(), raceBuckets: emptyRaceBuckets() });
    const srec = agg.get(state);
    srec.units++;
    srec.volume += amt;

    if (!srec.counties.has(county)) srec.counties.set(county, { units: 0, volume: 0, tracts: new Map() });
    const crec = srec.counties.get(county);
    crec.units++;
    crec.volume += amt;

    if (!crec.tracts.has(tract)) crec.tracts.set(tract, { units: 0, volume: 0 });
    const trec = crec.tracts.get(tract);
    trec.units++;
    trec.volume += amt;

    processed++;
    if (processed % 1_000_000 === 0) process.stdout.write(`  ... ${processed.toLocaleString()} originated rows\n`);
  }

  return { agg, processed };
}

function finalize(agg) {
  const out = {};
  for (const [state, srec] of agg) {
    const counties = [];
    for (const [countyCode, crec] of srec.counties) {
      const tracts = [...crec.tracts.entries()]
        .map(([t, td]) => ({ censusTract: t, units: td.units, volume: td.volume }))
        .sort((a, b) => b.units - a.units)
        .slice(0, TOP_TRACTS_PER_COUNTY);
      counties.push({ countyCode, fips: countyCode, units: crec.units, volume: crec.volume, topCensusTracts: tracts });
    }
    counties.sort((a, b) => b.units - a.units);
    const countiesOut = TOP_COUNTIES_PER_STATE ? counties.slice(0, TOP_COUNTIES_PER_STATE) : counties;
    const { diversityScore, minorityShare } = computeDiversityMetrics(srec.raceBuckets || emptyRaceBuckets());
    const stateRecord = { units: srec.units, volume: srec.volume, counties: countiesOut };
    if (diversityScore !== null) stateRecord.diversityScore = diversityScore;
    if (minorityShare  !== null) stateRecord.minorityShare  = minorityShare;
    out[state] = stateRecord;
  }
  return out;
}

// ── file readers ─────────────────────────────────────────────────────────────

async function processTxt(filePath, year) {
  console.log(`  Reading ${path.basename(filePath)} (plain text) ...`);
  const fileStream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  const { agg, processed } = await aggregateLines(rl);
  console.log(`  ${year}: originated=${processed.toLocaleString()}, states=${agg.size}`);
  return finalize(agg);
}

async function processZip(filePath, year) {
  // Node has no native zip reader; we use unzip via child_process if available,
  // or fall back to a manual inflate of the inner .txt entry using zlib.
  // For reliability we try the npm 'unzipper' package first, then fallback.
  console.log(`  Reading ${path.basename(filePath)} (zip) ...`);
  try {
    const unzipper = await import("unzipper");
    let found = false;
    return await new Promise((resolve, reject) => {
      const agg = new Map();
      let processed = 0;
      let headerParsed = false;
      let sep = "|";
      let idxAction = 8, idxState = 9, idxCounty = 10, idxTract = 11, idxAmount = 7;
      let idxRace = -1, idxEthnicity = -1;

      const zip = fs.createReadStream(filePath).pipe(unzipper.Parse({ forceStream: true }));
      zip.on("entry", (entry) => {
        if (!entry.path.toLowerCase().endsWith(".txt")) { entry.autodrain(); return; }
        found = true;
        const rl = readline.createInterface({ input: entry, crlfDelay: Infinity });

        rl.on("line", (line) => {
          const trimmed = line.trimEnd();
          if (!trimmed) return;
          if (!headerParsed) {
            sep = trimmed.includes("|") ? "|" : ",";
            const headers = trimmed.split(sep).map((h) => h.trim());
            idxAction    = findCol(headers, "action_taken");
            idxState     = findCol(headers, "state_code", "derived_msa-md", "state");
            idxCounty    = findCol(headers, "county_code", "county");
            idxTract     = findCol(headers, "census_tract", "tract_number");
            idxAmount    = findCol(headers, "loan_amount", "loan_amount_000s");
            idxRace      = findCol(headers, "derived_race");
            idxEthnicity = findCol(headers, "derived_ethnicity");
            if (idxAction < 0) { idxAction = 8; idxState = 9; idxCounty = 10; idxTract = 11; idxAmount = 7; }
            process.stdout.write(
              `  Header: ${headers.length} cols | action@${idxAction} state@${idxState} county@${idxCounty} tract@${idxTract} amount@${idxAmount} race@${idxRace} eth@${idxEthnicity}\n`
            );
            headerParsed = true;
            return;
          }
          const cols = trimmed.split(sep);
          const needed = Math.max(idxAction, idxState, idxCounty, idxTract, idxAmount);
          if (cols.length <= needed) return;
          const actionTaken = (cols[idxAction] || "").trim();
          const state = (cols[idxState] || "").trim().toUpperCase();
          if (!state) return;
          if (idxRace >= 0) {
            const bucket = raceBucket(
              idxRace      >= 0 ? cols[idxRace]      : "",
              idxEthnicity >= 0 ? cols[idxEthnicity] : "",
            );
            if (bucket) {
              if (!agg.has(state)) agg.set(state, { units: 0, volume: 0, counties: new Map(), raceBuckets: emptyRaceBuckets() });
              agg.get(state).raceBuckets[bucket] = (agg.get(state).raceBuckets[bucket] || 0) + 1;
            }
          }
          if (actionTaken !== "1") return;
          let county = (cols[idxCounty] || "").trim();
          if (!county || county === "NA" || county === "Exempt") county = "000";
          else if (/^\d+$/.test(county)) county = county.padStart(3, "0");
          const tract = fmtTract(cols[idxTract]);
          const rawAmt = (cols[idxAmount] || "").trim();
          const amt = /^\d+$/.test(rawAmt) ? parseInt(rawAmt, 10) : 0;
          if (!agg.has(state)) agg.set(state, { units: 0, volume: 0, counties: new Map(), raceBuckets: emptyRaceBuckets() });
          const srec = agg.get(state);
          srec.units++;
          srec.volume += amt;
          if (!srec.counties.has(county)) srec.counties.set(county, { units: 0, volume: 0, tracts: new Map() });
          const crec = srec.counties.get(county);
          crec.units++;
          crec.volume += amt;
          if (!crec.tracts.has(tract)) crec.tracts.set(tract, { units: 0, volume: 0 });
          const trec = crec.tracts.get(tract);
          trec.units++;
          trec.volume += amt;
          processed++;
          if (processed % 1_000_000 === 0) process.stdout.write(`  ... ${processed.toLocaleString()} originated rows\n`);
        });
        rl.on("close", () => {
          console.log(`  ${year}: originated=${processed.toLocaleString()}, states=${agg.size}`);
          resolve(finalize(agg));
        });
        rl.on("error", reject);
      });
      zip.on("close", () => { if (!found) reject(new Error(`No .txt file found inside ${filePath}`)); });
      zip.on("error", reject);
    });
  } catch (e) {
    if (e.code === "ERR_MODULE_NOT_FOUND" || e.code === "MODULE_NOT_FOUND") {
      throw new Error(
        `The 'unzipper' npm package is required to process .zip MLAR files.\n` +
        `Run: npm install --save-dev unzipper\n` +
        `Or extract the zip manually so ${year}_combined_mlar_header.txt is in ${HMDA_MLAR_DIR}.`
      );
    }
    throw e;
  }
}

function findMlar(year) {
  for (const suffix of [".txt", ".zip"]) {
    const p = path.join(HMDA_MLAR_DIR, `${year}_combined_mlar_header${suffix}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2).filter((a) => /^\d{4}$/.test(a)).map(Number);

  let yearsToRun;
  if (args.length > 0) {
    yearsToRun = args;
  } else {
    yearsToRun = [];
    for (let y = 2018; y <= 2030; y++) {
      if (findMlar(y)) yearsToRun.push(y);
    }
  }

  if (yearsToRun.length === 0) {
    console.error(
      `No MLAR files found in ${HMDA_MLAR_DIR}.\n` +
      "Place {year}_combined_mlar_header.txt (or .zip) in that folder.\n" +
      "Example: 2025_combined_mlar_header.zip  or  2025_combined_mlar_header.txt\n" +
      "Override folder with HMDA_MLAR_DIR env."
    );
    process.exit(1);
  }

  console.log(`Years to process: ${yearsToRun.join(", ")}`);

  // Load existing output to merge
  let existing = {};
  if (fs.existsSync(OUT_PATH)) {
    try { existing = JSON.parse(fs.readFileSync(OUT_PATH, "utf8")); } catch (_) { existing = {}; }
  }
  const meta = existing.meta || {
    source: "CFPB HMDA combined MLAR",
    note: "City/ZIP are not available in this public file variant; county and census tract shown.",
  };
  meta.topCountiesPerState = TOP_COUNTIES_PER_STATE ?? "all";
  meta.topTractsPerCounty = TOP_TRACTS_PER_COUNTY;

  for (const year of yearsToRun) {
    const mlarPath = findMlar(year);
    if (!mlarPath) { console.log(`SKIP ${year}: no MLAR file found.`); continue; }

    console.log(`\nBuilding ${year} from ${path.basename(mlarPath)} ...`);
    const data = mlarPath.endsWith(".zip")
      ? await processZip(mlarPath, year)
      : await processTxt(mlarPath, year);

    existing[String(year)] = data;
    meta[`${year}Source`] = `CFPB HMDA combined MLAR (${path.basename(mlarPath)})`;
    meta.updatedAt = new Date().toISOString();
    console.log(`${year}: ${Object.keys(data).length} states written.`);
  }

  existing.meta = meta;
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(existing));
  console.log(`\nWrote ${OUT_PATH}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
