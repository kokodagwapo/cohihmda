import React, { Fragment, useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef, lazy, Suspense, useDeferredValue, useTransition, startTransition, createContext, useContext } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useHmdaAuth } from '@hmda/context/HmdaAuthBridge';
import { useHmdaSprinkle } from '@hmda/context/HmdaSprinkleContext';
import ConstellationCanvas from "./ConstellationCanvas";
import marketSignals from "./market-signals.json";
// Registry JSONs are fetched lazily from /public/data/ to keep them out of the JS bundle (~1 MB saved)
import { publicAssetUrl } from '@hmda/utils/publicAssetUrl.js';
import {
  mergeFfiecDispositionIntoBase,
  mergeLenderInsightsIntoRow,
  FFIEC_ACTIONS_ALL,
  nmlsConsumerAccessCompanyUrl,
  hmdaInsightsMatchesYear,
  selectHmdaInsightsForYear,
  selectHmdaInsightsForLenderRow,
  larDetailYearForPanel,
  setFfiecLarMaxReportingYear,
  ffiecHmdaFieldReferenceUrl,
} from '@hmda/utils/hmdaFfiecLive.js';
import HmdaProductBreakdownPanel from "./HmdaProductBreakdownPanel.jsx";
import HmdaProductDimensionTables from "./HmdaProductDimensionTables.jsx";
import { aggregateProductHmdaMetrics, HMDA_PRODUCT_LOAN_TYPE_CODE, sumProductLoanTypeUnits } from "./productHmdaMetrics.js";
import {
  fetchHmdaLenders,
  fetchStaticHmdaLendersBootstrap,
  fetchGeoDrilldown,
  fetchGeoDrilldownStatic,
  fetchGeoDrilldownFullStatic,
  mergeGeoDrilldownPayload,
  hydrateGeoDrilldownYear,
  fetchHmdaMeta,
  fetchWarehouseStats,
  fetchLenderQuarterHistory,
  HMDA_DEFAULT_ANCHOR_YEAR,
  buildHmdaRequestedYears,
} from '@hmda/services/hmdaApi.js';
import {
  fetchHmdaYearsManifest,
  yearOptionsFromManifest,
  yearPickerBadge,
  isLenderYearAvailable,
} from '@hmda/services/hmdaYearsManifest.js';
import {
  fetchLenderManifest,
  fetchLenderQuery,
  fetchLenderSuggest,
  fetchProductSummary,
  fetchHmdaSyncCheck,
  clearLenderPagerCache,
} from '@hmda/services/hmdaLenderPager.js';
import { runHmdaMorningSync } from '@hmda/services/hmdaMorningSync.js';
import {
  enrichLendersFromFfiecApi,
  fetchFullLenderInsights,
  fetchMapLenderInsightsBatch,
} from '@hmda/services/hmdaInsightsEnrich.js';
import { resolveMapLenderFromSearch } from "./geography/geo-map-lender-filter.js";
import { resolveGeoDrilldownYear, geoDrilldownYearHasData } from "./geography/geo-drilldown-year.js";
import { buildDispositionByState, getPanelDisposition, resolveDispositionYear, aggregateLarYearDispositionPool } from "./geography/geo-hmda-disposition.js";
import { loadTractCentroids } from "./geography/geo-map-features.js";
import { useGeographyTabAnalytics } from "./hooks/useGeographyTabAnalytics.js";
import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import "./hmda-dashboard.css";
import "./hmda-geography-premium.css";
import {
  Accordion,
  AccordionContent,
  HmdaLenderModalAccordionItem,
  HmdaLenderModalAccordionTrigger,
} from "./components/HmdaLenderModalAccordion.jsx";
import HmdaLenderModalRegistryPanel from "./components/HmdaLenderModalRegistryPanel.jsx";
import {
  Accordion as HmdaLenderCardAccordion,
  AccordionContent as HmdaLenderCardAccordionContent,
  HmdaLenderCardAccordionItem,
  HmdaLenderCardAccordionTrigger,
} from "./components/HmdaLenderCardAccordion.jsx";
import { BarChart3, ChevronRight, ChevronsUpDown, ChevronsDownUp, GitCompareArrows, HardHat, Home, Layers, Medal, PanelTopClose, PanelTopOpen, Pin, ShieldCheck, Sparkles, TrendingUp, Wallet, Wheat } from "lucide-react";
import "./geography/hmda-geography-mapbox.css";

function importGeographyMapbox(retriesLeft = 3, delayMs = 900) {
  return import("./geography/HmdaGeographyMapbox.jsx").catch((err) => {
    const msg = String(err?.message || err)
    if (
      retriesLeft <= 0 ||
      !(
        msg.includes("Failed to fetch dynamically imported module") ||
        msg.includes("Importing a module script failed")
      )
    ) {
      throw err
    }
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        importGeographyMapbox(retriesLeft - 1, delayMs).then(resolve).catch(reject)
      }, delayMs)
    })
  })
}
const HmdaGeographyMapbox = lazy(() => importGeographyMapbox())
import "./hmda-executive-premium.css";
import "./hmda-glass-ui.css";
import { HmdaNavAuth } from "./saas/HmdaNavAuth.jsx";
import HmdaHeroSearchCombo from "./HmdaHeroSearchCombo.jsx";
import { motion } from "framer-motion";
import { HmdaLegalDisclaimer, HmdaPoweredPreloader } from "./HmdaPlatformUi.jsx";
import { fetchLenderRegistry, mergeRegistryWithLenderRow } from '@hmda/services/lenderRegistryClient.js';

/** Freemium: default 3 pins; `VITE_HMDA_PREMIUM_PINS=true` forces expanded compare in dev; otherwise server entitlements. */
const HMDA_PREMIUM_PINS_UNLIMITED = import.meta.env.VITE_HMDA_PREMIUM_PINS === "true";
/** When true, lender modal refreshes HMDA disposition counts from FFIEC Data Browser via `/api/hmda/ffiec/aggregations` (requires dev:api or deployed server). */
const HMDA_FFIRC_LIVE = import.meta.env.VITE_HMDA_FFIRC_LIVE === "1";

/* Mobile-first breakpoints (px) */
const BP_MOBILE = 768;
const BP_TABLET = 1024;

/* ─────────────────────────────────────────────────────
   TOOLTIP DEFINITIONS
   ───────────────────────────────────────────────────── */
const TIPS = {
  verified: "Product data derived from HMDA records and cross-checked where available. Data may be incomplete; verify independently.",
  partial: "Some product data from HMDA; may be incomplete. Independent verification recommended.",
  pending: "Lender present in HMDA dataset; product detail may be limited.",
  "All Status": "Show lenders in all statuses: Verified, Partial, and Pending.",
  "Data Year": "Dashboard reporting year for lender totals and rankings. When the badge says details use an earlier LAR year, only detailed LAR-derived fields such as applications, denials, product breakdown, and geography detail use the latest LAR loaded in this dashboard.",
  IMB: "Independent Mortgage Bank — non-depository lender that originates and often services mortgage loans without taking deposits.",
  Bank: "Depository institution — federally or state-chartered bank that accepts deposits and originates mortgage loans.",
  "Credit Union": "Member-owned cooperative financial institution offering mortgage lending to members at competitive rates.",
  CU: "Credit Union — member-owned cooperative offering mortgage lending at competitive rates.",
  "All Types": "Show all institution types: IMBs, Banks, and Credit Unions.",
  Channel: "Origination channel: Retail (direct-to-consumer), Wholesale (broker-sourced), or Correspondent (purchased from other lenders).",
  Conventional: "Fannie Mae / Freddie Mac conforming loans. Includes conforming and high-balance limits. Typically 620+ FICO required.",
  FHA: "Federal Housing Administration — government-insured with lower down payment (3.5%) and credit requirements (580+ FICO).",
  VA: "Dept. of Veterans Affairs — zero down payment exclusively for eligible veterans, active military, and surviving spouses.",
  USDA: "U.S. Dept. of Agriculture Rural Development — zero down payment for eligible rural and suburban properties.",
  "Non-QM": "Non-Qualified Mortgage — outside standard QM rules. Includes bank statement, DSCR, asset depletion, foreign national programs.",
  Jumbo: "Exceeds conforming limits ($766,550 in most areas). Requires higher FICO, larger reserves, and bigger down payment.",
  HELOC: "Home Equity Line of Credit — revolving credit secured by home equity, typically second-lien position.",
  Construction: "Construction-to-permanent loans financing new home builds, converting to standard mortgage upon completion.",
  All: "Show lenders offering any product type.",
  Branches:
    "When a number appears, it may be a legacy loan-count proxy from an older extract—not NMLS offices. When shown as —, HMDA does not provide branch counts; use NMLS Consumer Access or the lender.",
  Units: "Count of originated loans (HMDA action_taken = originated) for this institution and reporting year in this file.",
  States:
    "Count of U.S. states with HMDA-reported originated loans for this institution in this extract (LAR-backed when available), capped at 50 in some builds—not the same as –states licensed.—",
  "Min FICO":
    "Median credit score (HMDA credit_score) on originated loans in this extract when rebuilt from MLAR—or — if missing / legacy placeholder row (620/97/50 pattern). Not the lender's advertised program minimum.",
  "Max LTV":
    "Median combined LTV (HMDA combined_loan_to_value_ratio) on originated loans when present—or — if missing / legacy placeholder. Not a stated product max.",
  "Max DTI":
    "Median DTI (HMDA debt_to_income_ratio) on originated loans when present—or — if missing / legacy placeholder. Not a policy cap.",
  branches:
    "Branch count sourced from: Banks & savings → FDIC Summary of Deposits API (SOD, api.fdic.gov) — official annual branch census. Credit unions · NCUA quarterly call report ZIP (Credit Union Branch Information file). Independent mortgage companies · distinct HMDA counties (best free proxy; NMLS branch data costs $7K–$85K/yr). Verify exact office locations at nmlsconsumeraccess.org.",
  states:
    "States with at least one HMDA-reported originated loan for this LEI in this reporting year (per this extract). Not a license map.",
  minFico: "HMDA LAR reports credit score model type only (e.g. Equifax Beacon 5.0) — not the applicant's actual score. Median FICO is not derivable from public HMDA data.",
  maxLtv: "Median CLTV on originated loans from the FFIEC public LAR CSV (loan_to_value_ratio field, action_taken=1). Source: CFPB HMDA Data Browser.",
  maxDti: "Median DTI on originated loans from FFIEC public LAR CSV (debt_to_income_ratio, action_taken=1). HMDA reports DTI in buckets — midpoint used. Source: CFPB HMDA Data Browser.",
  hmdaMetricNA: "Not yet computed for this lender. CLTV and DTI are derived from the FFIEC public LAR CSV stream. Run backfill-hmda-cltv-dti.mjs to populate. Branch counts from NMLS, not HMDA.",
  avgLoanSize:
    "Average originated loan amount: HMDA-reported total originated dollar volume ÷ originated loan count for this institution and year in this file (same figures as Volume and Units). If volume was imputed in the pipeline, this average is approximate.",
  "Current Rate": "Rate source: HMDA (median of actual originated loans from HMDA filing) or market benchmark (Optimal Blue OBMMI — not this lender's actual quote). Verify rates with the lender.",
  Volume:
    "Sum of loan amounts on HMDA-reported originated loans for this institution and reporting year in this file. When the pipeline lacks summed amounts, volume may be estimated from loan count × a benchmark average—hover other tiles for context.",
  "3yr Trend": "HMDA-sourced quarterly trend (originations and dollar volume). Estimated from annual HMDA filings. Click for full breakdown.",
  "Sort by": "Change the sort to re-rank lenders. Rank # updates to match the selected metric (Originations, Volume, Name, or Rate Spread).",
  confidence: "Completeness of HMDA-derived data for this lender. Green ≥ 80, Yellow ≥ 65, Red < 65. Not a guarantee of accuracy.",
  "Total HMDA Lenders": "Total originators in CFPB HMDA dataset meeting reporting threshold (≥ 25 closed-end loans/year).",
  "Websites Matched": "HMDA lenders with a known public website URL. Links are for reference only; we do not guarantee accuracy.",
  "Products Extracted": "Lenders with product-type information available from HMDA or public sources. Verify with the lender.",
  "Avg Confidence": "Average completeness score across lenders. Not a guarantee of accuracy.",
  Name: "Sort alphabetically by institution name.",
  Originations: "Sort by total loans originated (HMDA).",
  Rate: "Sort by rate where available (HMDA or market benchmark).",
  "Products Offered": "Mortgage product types associated with this lender from HMDA and public data. Verify with the lender.",
  "Product chip units":
    "Originated unit counts for Conventional / FHA / VA / USDA come from HMDA loan_type (1–4) in this file—either FFIEC Data Browser aggregates or MLAR/CSV merge. Jumbo, HELOC, Non-QM, and Construction are not HMDA loan_type buckets; those chips show — unless only one such tag exists and a remainder after 1–4 is attributed (~). Any multi-tag remainder is one line below.",
  "Product chip unallocated":
    "These originated units are not assigned to individual marketing tags: HMDA only breaks out loan_type 1–4. The total is (originated loans − sum of those four types) in this file.",
  "Product chip no loan_type":
    "This lender row has no loan_type originated counts in the loaded file (empty or missing hmdaInsights.loanTypeSummary). Re-merge from the FFIEC LAR extract to show per–loan-type units; total originations above are still from HMDA.",
  "5yr History": "12-quarter performance trend Q1 2022–Q4 2024 showing origination volume and dollar volume (HMDA-sourced).",
  "States Licensed": "U.S. states where this lender holds an active NMLS license and is originating loans.",
  "Institution Type": "Classification of lender charter type per industry conventions. Not regulatory or compliance advice.",
  "Loan Units": "Total individual mortgage loans closed in the most recent annual reporting period (HMDA).",
  "Dollar Volume": "Aggregate dollar amount of all originations in the trailing 12-month period (HMDA).",
  "Product Coverage": "Distribution of mortgage product types across HMDA lenders in this panel. For reference only.",
  "Top States": "States with the highest concentration of active mortgage lenders, ranked by lender count (HMDA).",
  "3Y All HMDA Lenders Production": "Total funded loan units and dollar volume across the full 2022, 2023, and 2024 HMDA lender panels.",
  "Data Pipeline": "Data is from CFPB HMDA and other public sources. Processed with automated tools; may be incomplete or outdated.",
  "Coverage Summary": "Geographic coverage completeness across all 50 states + DC (HMDA data).",
  "Confidence Score": "Completeness score (0–100) based on HMDA and public data availability. Not a guarantee of accuracy.",
  "Visit Website": "Opens the lender's public website in a new tab for your own verification.",
  "Quarterly Breakdown": "Quarter-by-quarter values with period-over-period change percentages shown as green (up) or red (down) arrows.",
  "NMLS": "Nationwide Multistate Licensing System ID — unique federal identifier assigned to every mortgage lender and loan originator.",
  "HMDA Import": "Mortgage origination records from the Consumer Financial Protection Bureau's Home Mortgage Disclosure Act dataset.",
  "URL Discovery": "Matching of HMDA lender entities to public website URLs using NMLS and public information.",
  "Data sources": "Data shown is from HMDA and other public sources only. Verify with the lender.",
  "AI Extraction": "Structured data derived from HMDA and other public sources. May be incomplete; verify with the lender.",
  Validation: "Data is cross-referenced with HMDA and public registries where available. Independent verification recommended.",
  "Vol. Share": "State's share of loan volume relative to the highest-volume state (%). Based on HMDA originations; not a measure of lender quality.",
  "HMDA outcomes": "Counts and shares from CFPB HMDA Loan Application Register for the reporting year — one row per covered application or loan. Not the same as internal LOS pull-through.",
  "HMDA denial reasons": "Reason codes reported on denied applications (HMDA). Multiple reasons may be reported per denial.",
  "Peer benchmark":
    "Each percentage is computed only among lenders in this dashboard’s panel (same HMDA reporting year; institutions with at least 75 applications in the loaded data). It states what share of those panel lenders report a higher or lower value than this institution for that metric—for example, what share report a higher denial rate, or a lower origination share. This is not a national benchmark and does not rank credit quality.",
  "Rate spread (HMDA)": "Difference between APR and APOR for reporting, when present in HMDA. Median across originated loans; exempt or missing values excluded.",
  rateSpread: "Median rate spread (APR minus APOR) on originated loans from FFIEC public LAR CSV (rate_spread, action_taken=1). A key pricing-competitiveness signal — lower spread means tighter pricing relative to market. Exempt/N/A rows excluded. Source: CFPB HMDA Data Browser.",
  "HMDA market segment":
    "National benchmark for the same HMDA reporting year and loan_type segment (all originated loans in the file), using the same binned medians as the lender view. This is disclosed HMDA pricing structure—not the lender’s live rate sheet.",
  "Pin compare":
    "Pin lenders for Compare (side-by-side). The maximum number of pinned lenders depends on your plan (free tier: 3; Premium: higher). Unpin anytime or use Clear.",
  "Map lender geography":
    "Open Geography with this lender’s HMDA originations by state (hover states and counties; county detail loads on zoom).",
  "HMDA LAR timing":
    "Monthly counts use action_taken_date from the public LAR when present. This is reported activity timing, not modeled quarterly splits from annual totals.",
  "HMDA state concentration":
    "Herfindahl-style concentration (sum of squared state shares of originated loans). Higher = more concentrated in fewer states.",
  "HMDA pipeline drill":
    "HMDA does not define pipeline fallout. Here, fallout-style outcomes are public LAR action_taken values that did not result in a originated loan under the reported disposition (typically codes 2–5). Counts are from the same CFPB HMDA extract as the rest of this panel—verify in the official Data Browser.",
  hmdaApps: "Total HMDA Loan Application Register rows (covered applications and loans) for this institution and reporting year.",
  hmdaDeny: "Denied-application count (HMDA action_taken). Shown as units on lender tiles; compare Apps for the full disposition set.",
  hmdaWd: "Withdrawn-application count (HMDA action_taken). Shown as units on lender tiles.",
  hmdaOrigShr: "Originated-loan count in this HMDA extract. Shown as units on lender tiles (not a share %).",
};

/** Compare modal — short factual hover text per metric row (key = row `k`). */
const COMPARE_MODAL_METRIC_TIPS = {
  originations:
    "Count of mortgage originations for this lender and HMDA reporting year in the loaded panel file.",
  dollarVol:
    "Sum of originated loan amounts (HMDA-reported) for that lender and year in this dataset—not a live balance sheet figure.",
  currentRate:
    "Rate shown in this record, often estimated from public market series when not issuer-quoted; not a real-time offer or lock.",
  branches:
    "Branches on cards: legacy loan-count proxy when present; otherwise —. HMDA has no branch field—confirm offices with NMLS or the lender.",
  states: "States with HMDA-reported originated loans in this extract; not the same as licensing footprint.",
  minFico: "Median HMDA credit score on originated loans in this file when present; — if legacy placeholder or missing.",
  maxLtv: "Median HMDA combined LTV on originated loans when present; — if legacy placeholder or missing.",
  maxDti: "Median HMDA DTI on originated loans when present; — if legacy placeholder or missing.",
  avgLoanSize:
    "Average originated loan size from HMDA / originated count in this file (when both are present).",
  hmdaApps: "Total HMDA Loan Application Register rows (covered applications and loans) for this institution and reporting year.",
  hmdaDeny: "Denied-application count (HMDA action_taken) in the reporting year. Cards show units; compare ranks by the same count (lower = fewer denials). See Apps for the application denominator.",
  hmdaWd: "Withdrawn-application count (HMDA action_taken). Shown as units on cards; compare ranks by count (lower = fewer withdrawals).",
  hmdaOrigShr: "Originated-loan count in the HMDA extract. Shown as units on cards; compare ranks by count (higher = more originations).",
  hmdaSpr:
    "Median rate spread on originated loans where HMDA reports a spread; NA/Exempt rows are excluded. Requires merged LAR or Data Browser CSV in the pipeline.",
  hmdaTerm:
    "Median loan term in months on originated loans in the merged HMDA extract; requires the same enrichment as median spread.",
  products:
    "Product tags derived from HMDA loan characteristics (type, purpose, occupancy, etc.) for grouping only—not an official product list.",
};

/** Default reporting year when that year exists in `public/data/lenders-from-hmda.json`. Add 2025 with `npm run hmda:extract -- 2025` (MLAR file). FFIEC Data Browser aggregations may not accept a new year until CFPB enables it. */
const HMDA_PREFERRED_YEAR = String(HMDA_DEFAULT_ANCHOR_YEAR);
/** 2025 + previous 10 calendar years (FFIEC live data currently 2018–2024). */
const AVAILABLE_YEARS_DEFAULT = ["2025", "2024", "2023", "2022", "2021", "2020", "2019", "2018", "2017", "2016", "2015"];
const HMDA_COMPLETE_BY_YEAR = { 2022: 4456, 2023: 5099, 2024: 4894, 2025: 4774 };
const LENDER_MAP_COLORS = ["#f59e0b", "#3b82f6", "#10b981", "#ef4444", "#8b5cf6"];

/* ─────────────────────────────────────────────────────
   DATA
   ───────────────────────────────────────────────────── */
/* Optimal Blue OBMMI 30-Year Conforming — factual quarterly rates (Q1 2022 to Q4 2024, plus 2025-2026) */
const PMMS_QUARTERLY_RATES_3Y = [3.76,5.23,5.55,6.42, 6.42,6.70,7.20,7.07, 6.82,6.87,6.94,6.82, 6.65,6.44,6.28,6.15, 6.09];

/* Quarterly shares and YoY factors aligned to 2022-2024 */
const YOY_3Y = [0.65,1,0.97];
const QUARTERLY_ORIG_SHARES_3Y = [0.22,0.24,0.26,0.28, 0.22,0.24,0.26,0.28, 0.23,0.25,0.26,0.26];
const EST_HISTORY_START_YEAR = 2022;
const EST_YEAR_FACTORS = [0.65, 1, 0.97, 1.02];
const EST_QUARTERLY_SHARES_BY_YEAR = [
  [0.22, 0.24, 0.26, 0.28], // 2022
  [0.22, 0.24, 0.26, 0.28], // 2023
  [0.23, 0.25, 0.26, 0.26], // 2024
  [0.24, 0.25, 0.25, 0.26], // 2025+
];
const MARKET_FACTS_2025_2026 = marketSignals?.quarters || [];
const MARKET_FACTS_UPDATED_AT = marketSignals?.updatedAt || null;

function buildEstimatedHmdaHistory(orig, dataYear) {
  const originations = Number(orig) || 0;
  const endYear = Math.max(2024, Number(dataYear || 2024));
  const yearsCount = Math.max(1, endYear - EST_HISTORY_START_YEAR + 1);
  const out = [];
  for (let y = 0; y < yearsCount; y++) {
    const shares = EST_QUARTERLY_SHARES_BY_YEAR[y] || EST_QUARTERLY_SHARES_BY_YEAR[EST_QUARTERLY_SHARES_BY_YEAR.length - 1];
    const factor = EST_YEAR_FACTORS[y] != null ? EST_YEAR_FACTORS[y] : EST_YEAR_FACTORS[EST_YEAR_FACTORS.length - 1];
    for (let q = 0; q < 4; q++) {
      out.push(Math.round(originations * shares[q] * factor));
    }
  }
  return out;
}

const AVG_LOAN_2023 = 380000;
const KNOWN_LENDER_WEBSITES = {
  "united wholesale mortgage":"https://www.uwm.com",
  "united wholesale mortgage llc":"https://www.uwm.com",
  "rocket mortgage llc":"https://www.rocketmortgage.com",
  "crosscountry mortgage llc":"https://crosscountrymortgage.com",
  "loan depot com llc":"https://www.loandepot.com",
  "pennymac loan services llc":"https://www.pennymac.com",
  "freedom mortgage corporation":"https://www.freedommortgage.com",
  "mr cooper":"https://www.mrcooper.com",
  "newrez llc":"https://www.newrez.com",
  "fairway independent mortgage corporation":"https://www.fairway.com",
  "guild mortgage company llc":"https://www.guildmortgage.com",
  "movement mortgage llc":"https://movement.com",
  "planet home lending llc":"https://www.planethomelending.com",
  "cmg mortgage inc":"https://www.cmgfi.com",
  "prime lending a plainscapital company":"https://www.primelending.com",
  "rate":"https://www.rate.com",
  "bank of america national association":"https://www.bankofamerica.com",
  "jpmorgan chase bank national association":"https://www.chase.com",
  "wells fargo bank n a":"https://www.wellsfargo.com",
  "citizens bank national association":"https://www.citizensbank.com",
  "pnc bank national association":"https://www.pnc.com",
  "truist bank":"https://www.truist.com",
  "flagstar bank n a":"https://www.flagstar.com",
  "navy federal credit union":"https://www.navyfederal.org",
  "usaa federal savings bank":"https://www.usaa.com",
  "caliber home loans inc":"https://www.newrez.com",
  "home point financial corporation":"https://www.homepoint.com",
};
const normLenderName = (n="") => n.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();

/** Stable cache key — matches mergeLendersIntoCache (`lei|dataYear`). */
function lenderCacheKey(lender) {
  if (!lender) return "";
  const lei = String(lender.lei || "").trim().toUpperCase();
  const year = Number(lender.dataYear) || 0;
  if (lei && year) return `${lei}|${year}`;
  const nmls = String(lender.nmls || "").trim();
  if (nmls && year) return `nmls:${nmls}|${year}`;
  if (lender.id != null && year) return `id:${lender.id}|${year}`;
  if (lender.id != null) return `id:${lender.id}`;
  const name = normLenderName(lender.name);
  return name ? `name:${name}|${year || 0}` : "";
}

/** Numeric rank for UI — never surface cache keys (e.g. LEI|year) as rank. */
function resolveLenderDisplayRank(rankMap, lenderId, fallbackRank) {
  const raw = rankMap?.get?.(lenderId);
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0 && n < 1_000_000) return Math.round(n);
  const fb = Number(fallbackRank);
  if (fallbackRank == null || !Number.isFinite(fb) || fb <= 0) return null;
  return Math.round(fb);
}

/** Resolve a lender row from panel cache — never match numeric id alone (not unique across years). */
function findLenderInList(list, ref) {
  if (!ref || !Array.isArray(list) || !list.length) return null;
  const wantKey = lenderCacheKey(ref);
  if (wantKey) {
    const byKey = list.find((row) => lenderCacheKey(row) === wantKey);
    if (byKey) return byKey;
  }
  const lei = String(ref.lei || "").trim().toUpperCase();
  const year = Number(ref.dataYear) || 0;
  if (lei && year) {
    const byLei = list.find(
      (row) => String(row.lei || "").trim().toUpperCase() === lei && Number(row.dataYear) === year,
    );
    if (byLei) return byLei;
  }
  const nmls = String(ref.nmls || "").trim();
  if (nmls && year) {
    const byNmls = list.find(
      (row) => String(row.nmls || "").trim() === nmls && Number(row.dataYear) === year,
    );
    if (byNmls) return byNmls;
  }
  const norm = normLenderName(ref.name);
  if (norm && year) {
    const byName = list.find(
      (row) => normLenderName(row.name) === norm && Number(row.dataYear) === year,
    );
    if (byName) return byName;
  }
  return null;
}

function scoreNavSearchLender(lender, term) {
  const s = String(term || "").trim().toLowerCase();
  if (!s) return 0;
  const name = String(lender?.name || "").trim().toLowerCase();
  const tokens = s.split(/\s+/).filter(Boolean);
  if (name === s) return 1000;
  if (name.startsWith(s)) return 920;
  if (tokens.length > 1 && tokens.every((t) => name.includes(t))) return 860;
  if (name.includes(s)) return 780;
  const nmls = String(lender?.nmls || "");
  if (nmls && nmls.includes(s)) return 640;
  const lei = String(lender?.lei || "").toLowerCase();
  if (lei && lei.includes(s)) return 600;
  return 0;
}

const isLikelyGibberishName = (name = "") => {
  const n = String(name || "").trim();
  if (!n) return true;
  if (/\b(LLC|INC|BANK|MORTGAGE|CORP|COMPANY|CREDIT|UNION|NATIONAL|FINANCIAL|HOME|LENDING)\b/i.test(n)) return false;
  const letters = (n.match(/[A-Za-z]/g) || []).length;
  const digits = (n.match(/[0-9]/g) || []).length;
  const tokens = n.split(/\s+/).filter(Boolean);
  if (letters < 6) return true;
  if (digits > letters * 0.35) return true;
  if (tokens.length === 1 && n.length > 18) return true;
  if (!/[aeiou]/i.test(n) && letters > 8) return true;
  return false;
};
const resolveLenderWebsite = (name) => {
  const normalized = normLenderName(name);
  if (KNOWN_LENDER_WEBSITES[normalized]) {
    return { website: KNOWN_LENDER_WEBSITES[normalized], websiteVerified: true };
  }
  const withLlc = `${normalized} llc`.trim();
  if (KNOWN_LENDER_WEBSITES[withLlc]) {
    return { website: KNOWN_LENDER_WEBSITES[withLlc], websiteVerified: true };
  }
  for (const [key, url] of Object.entries(KNOWN_LENDER_WEBSITES)) {
    if (normalized.startsWith(key) || key.startsWith(normalized)) {
      return { website: url, websiteVerified: true };
    }
  }
  const search = `https://www.google.com/search?q=${encodeURIComponent(`${name} mortgage official website`)}`;
  return { website: search, websiteVerified: false };
};

// FDIC bank and NCUA credit union registries — loaded lazily from /data/ (not bundled)
const BANK_REGISTRY = new Set();
const CU_REGISTRY = new Set();
(async () => {
  try {
    const [banks, cus] = await Promise.all([
      fetch('/data/bank_registry.json').then(r => r.json()),
      fetch('/data/credit_union_registry.json').then(r => r.json()),
    ]);
    if (Array.isArray(banks)) banks.forEach(v => BANK_REGISTRY.add(v));
    if (Array.isArray(cus)) cus.forEach(v => CU_REGISTRY.add(v));
  } catch { /* registries optional — type classification gracefully degrades */ }
})();

const normRegName = (s) => {
  if (!s || typeof s !== "string") return "";
  let n = s.toUpperCase().replace(/\s+/g, " ").trim();
  n = n.replace(/,?\s*NATIONAL ASSOCIATION\s*$/i, "").replace(/,?\s*N\.?\s*A\.?\s*$/i, "");
  n = n.replace(/,?\s*INC\.?\s*$/i, "").replace(/,?\s*LLC\.?\s*$/i, "").replace(/,?\s*CORP\.?\s*$/i, "");
  n = n.replace(/,?\s*CORPORATION\s*$/i, "").replace(/,?\s*CO\.?\s*$/i, "");
  n = n.replace(/\s*\([^)]*\)\s*$/g, "").replace(/\s+/g, " ").trim();
  return n;
};

const inferInstitutionType = (name, fallback) => {
  const norm = normRegName(name);
  if (norm && CU_REGISTRY.has(norm)) return "Credit Union";
  if (norm && BANK_REGISTRY.has(norm)) return "Bank";
  const n = String(name || "").toUpperCase();
  if (/\bCREDIT\s+UNION\b|\bFCU\b|\bFEDERAL\s+CREDIT\s+UNION\b/.test(n)) return "Credit Union";
  if (/\bBANK\b|\bNATIONAL\s+ASSOCIATION\b|\bFEDERAL\s+SAVINGS\b|\bSAVINGS\s+BANK\b|\bN\.?A\.?\b/.test(n)) return "Bank";
  return fallback || "IMB";
};

const inferChannel = (name) => {
  const n = String(name || "").toUpperCase();
  if (/\bWHOLESALE\b|\bUWM\b|UNITED WHOLESALE|PLAZA HOME MORTGAGE|RESIDENTIAL WHOLESALE|LOANSTREAM|OCMBC\b/.test(n)) return "wholesale";
  if (/\bCORRESPONDENT\b/.test(n)) return "correspondent";
  if (/\bRETAIL\b|\bDIRECT\b/.test(n)) return "retail";
  return "retail";
};

function applyLenderContentOverrides(lenders, blob) {
  if (!blob || Number(blob.schemaVersion) !== 1 || !blob.byLei || typeof blob.byLei !== "object") return lenders;
  return lenders.map((l) => {
    const p = blob.byLei[l.lei];
    if (!p || typeof p !== "object") return l;
    const o = { ...l };
    if (typeof p.website === "string" && p.website.trim()) o.website = p.website.trim();
    if (typeof p.websiteVerified === "boolean") o.websiteVerified = p.websiteVerified;
    if (typeof p.nameDisplay === "string" && p.nameDisplay.trim()) o.name = p.nameDisplay.trim();
    if (typeof p.contentNote === "string" && p.contentNote.trim()) o.lenderContentNote = p.contentNote.trim();
    return o;
  });
}

function toNullableDashboardNumber(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Legacy aggregate rows used fixed 620/97/50 and branches = max(1, floor(orig/500)). */
function isLegacyHmdaDashboardPlaceholderRow(lender) {
  const o = Number(lender?.originations ?? lender?.units ?? 0);
  if (!Number.isFinite(o) || o < 0) return false;
  const proxySites = Math.max(1, Math.floor(o / 500));
  return (
    Number(lender?.minFico) === 620 &&
    Number(lender?.maxLtv) === 97 &&
    Number(lender?.maxDti) === 50 &&
    Number(lender?.branches) === proxySites
  );
}

/**
 * Branch count display.
 * Priority:
 *   1. branchCount (FDIC SOD for banks, NCUA for CUs, HMDA counties for IMBs)
 *   2. hmdaInsights.hmdaCountyCount (HMDA geographic footprint proxy)
 * Never shows the legacy proxy value (originations/500).
 */
function fmtBranchSitesCell(l) {
  // 1. Real branch data from FDIC/NCUA/HMDA backfill
  const bc = l?.branchCount;
  if (bc != null && Number.isFinite(Number(bc)) && Number(bc) > 0) {
    return Number(bc).toLocaleString();
  }
  // 2. HMDA county count as proxy (populated by backfill-hmda-branches.mjs)
  const cc = l?.hmdaInsights?.hmdaCountyCount;
  if (cc != null && Number.isFinite(Number(cc)) && Number(cc) > 0) {
    return Number(cc).toLocaleString();
  }
  if (!isLegacyHmdaDashboardPlaceholderRow(l)) {
    if (l?.branches != null && Number.isFinite(Number(l.branches))) return Number(l.branches).toLocaleString();
  }
  return "—";
}

/** Tooltip label for branch metric explains data source. */
function branchSourceLabel(l) {
  const src = l?.branchSource;
  if (src === "FDIC-SOD" || src === "FDIC-SOD-fuzzy") return "FDIC SOD";
  if (src === "NCUA" || src === "NCUA-fuzzy") return "NCUA";
  if (src === "HMDA-counties") return "HMDA counties";
  if (l?.hmdaInsights?.hmdaCountyCount > 0) return "HMDA counties";
  return null;
}

/** Returns numeric branch sort value for compare/rank. */
function branchSortValue(l) {
  const bc = l?.branchCount;
  if (bc != null && Number.isFinite(Number(bc))) return Number(bc);
  const cc = l?.hmdaInsights?.hmdaCountyCount;
  if (cc != null && Number.isFinite(Number(cc))) return Number(cc);
  if (!isLegacyHmdaDashboardPlaceholderRow(l) && l?.branches != null && Number.isFinite(Number(l.branches))) return Number(l.branches);
  return null;
}

/** Med. FICO: not available from HMDA LAR (score type only, not value). Always "—". */
function fmtMedianFicoCell(_l) {
  return "—";
}

/**
 * Med. Rate Spread (originatedMedianRateSpread) — rate above PMMS on originated loans.
 * A key pricing-competitiveness signal for lending executives.
 * Source: FFIEC public LAR CSV (rate_spread, action_taken=1).
 */
function fmtMedianRateSpread(l) {
  const v = selectHmdaInsightsForLenderRow(l)?.originatedMedianRateSpread;
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  return n >= 0 ? `+${n.toFixed(2)}%` : `${n.toFixed(2)}%`;
}

function creditRateSpreadSortValue(l) {
  const v = selectHmdaInsightsForLenderRow(l)?.originatedMedianRateSpread;
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Number(v);
}

/**
 * Med. CLTV: prefer hmdaInsights.originatedMedianCltv (from LAR CSV stream),
 * fallback to legacy maxLtv only if not a placeholder.
 */
function fmtMedianCltvCell(l) {
  const hmda = selectHmdaInsightsForLenderRow(l)?.originatedMedianCltv;
  if (hmda != null && Number.isFinite(Number(hmda))) return `${Math.round(Number(hmda))}%`;
  if (!isLegacyHmdaDashboardPlaceholderRow(l)) {
    const n = toNullableDashboardNumber(l?.maxLtv);
    if (n != null) return `${Math.round(n)}%`;
  }
  return "—";
}

/**
 * Med. DTI: prefer hmdaInsights.originatedMedianDti (from LAR CSV stream),
 * fallback to legacy maxDti only if not a placeholder.
 */
function fmtMedianDtiCell(l) {
  const hmda = selectHmdaInsightsForLenderRow(l)?.originatedMedianDti;
  if (hmda != null && Number.isFinite(Number(hmda))) return `${Math.round(Number(hmda))}%`;
  if (!isLegacyHmdaDashboardPlaceholderRow(l)) {
    const n = toNullableDashboardNumber(l?.maxDti);
    if (n != null) return `${Math.round(n)}%`;
  }
  return "—";
}

function fmtDollar(n) {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return "—";
  if (x >= 1e9) return `$${(x / 1e9).toFixed(1)}B`;
  if (x >= 1e6) return `$${(x / 1e6).toFixed(0)}M`;
  if (x >= 1e3) return `$${(x / 1e3).toFixed(0)}K`;
  return `$${Math.round(x)}`;
}
/** Full dollar amount with grouping (cockpit totals, exports). */
function fmtDollarFull(n) {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x) || x < 0) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Math.round(x));
}
function fmtUnits(n) {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return "—";
  return x >= 1000 ? `${(x / 1000).toFixed(1)}K` : String(Math.round(x));
}
/** HMDA LAR action counts (denials, withdrawals, originated) — full precision like Apps row. */
function fmtHmdaLarCount(n) {
  const x = n == null ? NaN : Number(n);
  if (!Number.isFinite(x) || x < 0) return "—";
  return Math.round(x).toLocaleString();
}
function fmtBigUnits(n) {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return "—";
  return x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1000 ? `${(x / 1000).toFixed(1)}K` : String(Math.round(x));
}
function fmtRate(r) {
  const x = typeof r === "number" ? r : Number(r);
  if (!Number.isFinite(x)) return "—";
  return `${x.toFixed(3)}%`;
}
function fmtOriginationsCell(l) {
  const o = l?.originations ?? l?.units;
  const x = Number(o);
  if (!Number.isFinite(x)) return "—";
  return Math.round(x).toLocaleString();
}

function creditFicoSortValue(_l) {
  return null; // HMDA LAR does not expose raw FICO scores; only credit score type codes
}

function creditLtvSortValue(l) {
  const hmda = selectHmdaInsightsForLenderRow(l)?.originatedMedianCltv;
  if (hmda != null && Number.isFinite(Number(hmda))) return Number(hmda);
  if (!isLegacyHmdaDashboardPlaceholderRow(l)) return toNullableDashboardNumber(l?.maxLtv);
  return null;
}

function creditDtiSortValue(l) {
  const hmda = selectHmdaInsightsForLenderRow(l)?.originatedMedianDti;
  if (hmda != null && Number.isFinite(Number(hmda))) return Number(hmda);
  if (!isLegacyHmdaDashboardPlaceholderRow(l)) return toNullableDashboardNumber(l?.maxDti);
  return null;
}

function compareLendersBySortField(a, b, sortField, sortDir) {
  const asc = sortDir === "asc";
  const cmpNum = (av, bv) => {
    const aNull = av == null || (typeof av === "number" && !Number.isFinite(av));
    const bNull = bv == null || (typeof bv === "number" && !Number.isFinite(bv));
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    if (av < bv) return asc ? -1 : 1;
    if (av > bv) return asc ? 1 : -1;
    return 0;
  };
  if (sortField === "rateSpread") {
    return cmpNum(creditRateSpreadSortValue(a), creditRateSpreadSortValue(b));
  }
  let av = a[sortField];
  let bv = b[sortField];
  if (typeof av === "string") {
    av = av.toLowerCase();
    bv = (bv != null ? bv : "").toString().toLowerCase();
    if (av < bv) return asc ? -1 : 1;
    if (av > bv) return asc ? 1 : -1;
    return 0;
  }
  av = av == null || !Number.isFinite(Number(av)) ? null : Number(av);
  bv = bv == null || !Number.isFinite(Number(bv)) ? null : Number(bv);
  return cmpNum(av, bv);
}

function computeLenders(raw, { lite = false } = {}) {
  const cleanId = (v) => {
    const s = String(v ?? "").trim();
    return s ? s : null;
  };

  if (lite) {
    return raw.map((l, i) => {
      const hmdaInsights = l.hmdaInsights || null;
      const websiteInfo = resolveLenderWebsite(l.name);
      const dollarVol = (l.dollarVol ?? l.orig * (l.avgLoanAmount || AVG_LOAN_2023)) || l.orig * (l.avgLoanAmount || AVG_LOAN_2023);
      const resolvedStates =
        hmdaInsights?.hmdaStateCount ??
        (Array.isArray(hmdaInsights?.stateBreakdown) && hmdaInsights.stateBreakdown.length > 0
          ? hmdaInsights.stateBreakdown.length
          : l.states);
      return {
        id: cleanId(l.lei) && l.dataYear ? `${cleanId(l.lei)}|${Number(l.dataYear)}` : (l.rank ?? i + 1),
        lei: cleanId(l.lei) || "",
        name: l.name,
        nmls: cleanId(l.nmls) || "",
        type: inferInstitutionType(l.name, l.type),
        channel: inferChannel(l.name),
        dataYear: l.dataYear || 2025,
        states: resolvedStates,
        originations: l.orig,
        confidence: l.conf,
        dataDate: l.rateScrapedAt ? l.rateScrapedAt.split("T")[0] : null,
        rateSource: l.rateSource === "scraped" ? "hmda" : l.hmdaRate != null ? "hmda" : l.rateSource || "estimated",
        products:
          Array.isArray(l.products) && l.products.length ? l.products : ["Conventional"],
        minFico: toNullableDashboardNumber(l.fico),
        maxLtv: toNullableDashboardNumber(l.ltv),
        maxDti: toNullableDashboardNumber(l.dti),
        branches: toNullableDashboardNumber(l.branches),
        units: l.orig,
        dollarVol,
        currentRate:
          l.hmdaRate != null
            ? l.hmdaRate
            : l.rate != null
              ? l.rate
              : PMMS_QUARTERLY_RATES_3Y[PMMS_QUARTERLY_RATES_3Y.length - 1],
        history: [],
        rateHist: [],
        volHist: [],
        qLabels: [],
        website: l.website || (websiteInfo.websiteVerified ? websiteInfo.website : null),
        websiteVerified: l.websiteVerified ?? websiteInfo.websiteVerified,
        branchCount: l.branchCount ?? toNullableDashboardNumber(l.branches),
        branchSource: l.branchSource || null,
        status: l.conf >= 90 ? "verified" : l.conf >= 75 ? "partial" : "pending",
        stateList:
          Array.isArray(hmdaInsights?.stateBreakdown) && hmdaInsights.stateBreakdown.length > 0
            ? hmdaInsights.stateBreakdown.map((r) => r.state).filter(Boolean)
            : [],
        hmdaInsights,
        originationBreakdown: l.originationBreakdown || null,
        hmdaPeer: null,
      };
    });
  }

  const rowsByLei = new Map();
  const rowsByNormName = new Map();
  raw.forEach((row) => {
    const lei = String(row?.lei || "").trim();
    if (!lei) return;
    if (!rowsByLei.has(lei)) rowsByLei.set(lei, []);
    rowsByLei.get(lei).push(row);
  });
  raw.forEach((row) => {
    const nm = normLenderName(String(row?.name || ""));
    if (!nm) return;
    if (!rowsByNormName.has(nm)) rowsByNormName.set(nm, []);
    rowsByNormName.get(nm).push(row);
  });

  return raw.map((l, i) => {
    const currentYear = Number(l.dataYear || 2023);
    const lei = cleanId(l.lei) || "";
    const normName = normLenderName(String(l.name || ""));
    const sameLeiRows = lei ? (rowsByLei.get(lei) || []) : [];
    const fallback = sameLeiRows
      .filter((r) => r !== l && Number(r.dataYear || 0) < currentYear)
      .sort((a, b) => Number(b.dataYear || 0) - Number(a.dataYear || 0))[0] || null;
    const sameNameRows = normName ? (rowsByNormName.get(normName) || []) : [];
    const fallbackByName = sameNameRows
      .filter((r) => r !== l && Number(r.dataYear || 0) < currentYear)
      .sort((a, b) => Number(b.dataYear || 0) - Number(a.dataYear || 0))[0] || null;

    // For newly ingested years (e.g. 2025), backfill missing detail chips from prior-year same-LEI row.
    const products = Array.isArray(l.products) && l.products.length
      ? l.products
      : (Array.isArray(fallback?.products) && fallback.products.length ? fallback.products : ["Conventional"]);
    const fico = l.fico != null ? l.fico : (fallback?.fico ?? null);
    const ltv = l.ltv != null ? l.ltv : (fallback?.ltv ?? null);
    const dti = l.dti != null ? l.dti : (fallback?.dti ?? null);
    let hmdaInsights = l.hmdaInsights || null;
    if (!hmdaInsights && fallback?.hmdaInsights) {
      const fy = Number(fallback.hmdaInsights.reportingYear ?? fallback.dataYear);
      if (fy === currentYear) hmdaInsights = fallback.hmdaInsights;
    }
    const hmdaRate = l.hmdaRate != null ? l.hmdaRate : (fallback?.hmdaRate ?? null);
    const resolvedLei = cleanId(l.lei) || cleanId(fallback?.lei) || cleanId(fallbackByName?.lei) || "";
    const resolvedNmls = cleanId(l.nmls) || cleanId(fallback?.nmls) || cleanId(fallbackByName?.nmls) || "";

    const dollarVol = (l.dollarVol ?? l.orig * (l.avgLoanAmount || AVG_LOAN_2023)) || l.orig * (l.avgLoanAmount || AVG_LOAN_2023);
    const stateCountFromHmda =
      hmdaInsights?.hmdaStateCount ??
      (Array.isArray(hmdaInsights?.stateBreakdown) && hmdaInsights.stateBreakdown.length > 0
        ? hmdaInsights.stateBreakdown.length
        : null);
    const resolvedStates = stateCountFromHmda != null && stateCountFromHmda > 0 ? stateCountFromHmda : l.states;
    const resolvedStateList =
      Array.isArray(hmdaInsights?.stateBreakdown) && hmdaInsights.stateBreakdown.length > 0
        ? hmdaInsights.stateBreakdown.map((r) => r.state).filter(Boolean)
        : ["CA","TX","FL","NY","IL","PA","OH","GA","NC","MI","NJ","VA","WA","AZ","MA","TN","MD","MN","WI","CO","AL","SC","LA","KY","OR","OK","CT","UT","IA","NV","AR","MS","KS","NE","NM","WV","ID","HI","NH","ME","MT","RI","DE","SD","ND","AK","VT","WY","DC"].slice(0, resolvedStates);
    const history = Array.isArray(l.quarterHistory) && l.quarterHistory.length
      ? l.quarterHistory.map((q) => Number(q.originations) || 0)
      : buildEstimatedHmdaHistory(l.orig, l.dataYear);
    const rateHist = Array.isArray(l.quarterHistory) && l.quarterHistory.length
      ? l.quarterHistory.map((q) => Number(q.avgRate) || PMMS_QUARTERLY_RATES_3Y[PMMS_QUARTERLY_RATES_3Y.length - 1])
      : [...PMMS_QUARTERLY_RATES_3Y];
    const volHist = history.map((u,q)=>Math.round(u*(dollarVol/l.orig)));
    const qLabels = Array.from({ length: history.length }, (_, q) => `Q${(q % 4) + 1} '${String(EST_HISTORY_START_YEAR + Math.floor(q / 4)).slice(2)}`);
    const websiteInfo = resolveLenderWebsite(l.name);
    const inferredType = inferInstitutionType(l.name, l.type);
    const channel = inferChannel(l.name);
    /* Only use real dates; no fabricated "last updated" — show data year when no rate date exists */
    const dataDate = l.rateScrapedAt ? l.rateScrapedAt.split("T")[0] : null;
    return {
      id: resolvedLei && l.dataYear ? `${resolvedLei}|${Number(l.dataYear)}` : i + 1, lei:resolvedLei || "", name:l.name, nmls:resolvedNmls, type:inferredType, channel,
      dataYear:l.dataYear || 2023,
      states:resolvedStates, originations:l.orig, confidence:l.conf,
      dataDate,
      rateSource:l.rateSource==="scraped"?"hmda":hmdaRate!=null?"hmda":l.rateSource||"estimated",
      products,
      minFico: toNullableDashboardNumber(fico),
      maxLtv: toNullableDashboardNumber(ltv),
      maxDti: toNullableDashboardNumber(dti),
      branches: toNullableDashboardNumber(l.branches),
      units:l.orig, dollarVol, currentRate:hmdaRate!=null?hmdaRate:l.rate!=null?l.rate:PMMS_QUARTERLY_RATES_3Y[PMMS_QUARTERLY_RATES_3Y.length-1],
      history, rateHist, volHist, qLabels,
      website:websiteInfo.website,
      websiteVerified:websiteInfo.websiteVerified,
      status:l.conf>=90?"verified":l.conf>=75?"partial":"pending",
      stateList:resolvedStateList,
      hmdaInsights,
      originationBreakdown: l.originationBreakdown || null,
      hmdaPeer: null,
    };
  });
}

const STATS = { totalLenders:5099, matchedToWebsite:3842, withProductData:2487, avgConfidence:89, statesFullCoverage:50, lastRefresh:"2026-02-18", hmdaMatch:96.1, weeklyDelta:"+84" };

/** Cohi AI instruction: answer only factual HMDA data; never subjective comments, opinions, or key takeaways. */
const COHI_INSTRUCTIONS = "Answer only what is factual from HMDA data. Never provide subjective comments, opinions, or key takeaways.";

const DEMO_STORAGE = { NEVER: "cohi_demo_never", DISMISS_UNTIL: "cohi_demo_dismiss_until", SEEN: "cohi_demo_seen" };
const DEMO_STEPS = [
  { id: "welcome", title: "HMDA DataBank guided tour", body: "This tour shows you how to find lenders, validate identities (NMLS/LEI), and compare production. Click Next to continue.", target: null },
  { id: "search", title: "Search & analyze", body: "HMDA search finds lenders and geography. Data analyst uploads CSV or Excel and compares to public HMDA with Gemini — brief factual bullets.", target: "hero-search" },
  { id: "lenders", title: "Lenders tab", body: "Browse the lender panel for your selected HMDA year. Ranking is based on HMDA dollar volume (and you can sort by loan count or volume).", target: "nav-lenders" },
  { id: "filters", title: "Filter + sort", body: "Use Year, Type, Channel, and Product filters to narrow results. Use Sort by to change the ordering (Name, Originations, Rate Spread, Volume).", target: "filter-bar" },
  { id: "compare", title: "Pin lenders to Compare", body: `Open a lender to pin for comparison (free tier: 3 lenders; Premium: more). Then open Compare for side-by-side facts.`, target: "nav-lenders" },
  { id: "history", title: "HMDA historical production", body: "Open any lender to view HMDA history (2022–2024): originations and dollar volume. Tap a card to drill into quarterly detail.", target: "demo-rate-section" },
  { id: "demo-contact", title: "Official address + phone", body: "In the lender modal, contact fields come from LEI registry data when available. Always verify with the lender’s official site.", target: "demo-contact-section" },
  { id: "products", title: "Products tab", body: "See lender coverage by product type and drill into product details and lenders per product.", target: "nav-products" },
  { id: "geography", title: "Geography tab", body: "Explore lender coverage by state and drill down by county and census tract to see where production concentrates.", target: "nav-geography" },
  { id: "done", title: "Done", body: "That’s it. Use  Guided tour. anytime to replay. Tip: Pin a few lenders and use Compare for quick diligence.", target: null },
];

const STATE_NAMES = {CA:"California",TX:"Texas",FL:"Florida",NY:"New York",IL:"Illinois",PA:"Pennsylvania",OH:"Ohio",GA:"Georgia",NC:"North Carolina",MI:"Michigan",NJ:"New Jersey",VA:"Virginia",AZ:"Arizona",WA:"Washington",MA:"Massachusetts",CO:"Colorado",TN:"Tennessee",MD:"Maryland",IN:"Indiana",MN:"Minnesota",MO:"Missouri",WI:"Wisconsin",SC:"South Carolina",AL:"Alabama",LA:"Louisiana",KY:"Kentucky",OR:"Oregon",OK:"Oklahoma",CT:"Connecticut",UT:"Utah",IA:"Iowa",NV:"Nevada",AR:"Arkansas",MS:"Mississippi",KS:"Kansas",NE:"Nebraska",NM:"New Mexico",ID:"Idaho",WV:"West Virginia",HI:"Hawaii",NH:"New Hampshire",ME:"Maine",MT:"Montana",DE:"Delaware",SD:"South Dakota",ND:"North Dakota",AK:"Alaska",RI:"Rhode Island",VT:"Vermont",WY:"Wyoming",DC:"District of Columbia"};
const US_STATES_TOPO_JSON = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";
const FIPS_TO_STATE = {
  "01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT","10":"DE","11":"DC","12":"FL","13":"GA",
  "15":"HI","16":"ID","17":"IL","18":"IN","19":"IA","20":"KS","21":"KY","22":"LA","23":"ME","24":"MD","25":"MA",
  "26":"MI","27":"MN","28":"MS","29":"MO","30":"MT","31":"NE","32":"NV","33":"NH","34":"NJ","35":"NM","36":"NY",
  "37":"NC","38":"ND","39":"OH","40":"OK","41":"OR","42":"PA","44":"RI","45":"SC","46":"SD","47":"TN","48":"TX",
  "49":"UT","50":"VT","51":"VA","53":"WA","54":"WV","55":"WI","56":"WY",
};

const ALL_PRODUCTS = ["Conventional","FHA","VA","USDA","Non-QM","Jumbo","HELOC","Construction"];

/** Horizontal lender-card strip: core products first, then A–Z for any other tags. */
const LENDER_CARD_PRODUCT_DISPLAY_ORDER = ["Conventional", "FHA", "VA", "USDA", "Jumbo", "HELOC", "Non-QM", "Construction"];

function sortLenderProductsForDisplay(products) {
  if (!Array.isArray(products) || products.length === 0) return [];
  const rank = (p) => {
    const i = LENDER_CARD_PRODUCT_DISPLAY_ORDER.indexOf(p);
    return i === -1 ? 200 : i;
  };
  return [...products].sort((a, b) => rank(a) - rank(b) || String(a).localeCompare(String(b)));
}

/** HMDA action_taken — CFPB public LAR (typical closed-end reporting). */
const HMDA_ACTION_LABELS = {
  1: "Loan originated",
  2: "Approved, not accepted",
  3: "Application denied",
  4: "Application withdrawn",
  5: "File closed — incomplete",
  6: "Loan purchased",
  7: "Preapproval request denied",
  8: "Preapproval approved, not accepted",
};

const HMDA_DENIAL_REASON_LABELS = {
  1: "Debt-to-income ratio",
  2: "Employment history",
  3: "Credit history",
  4: "Collateral",
  5: "Insufficient cash",
  6: "Unverifiable information",
  7: "Credit app incomplete",
  8: "Mortgage insurance denied",
  9: "Other",
  10: "Not applicable",
};

const HMDA_LIEN_LABELS = { 1: "First lien", 2: "Subordinate lien" };

const HMDA_SUBMISSION_LABELS = {
  1: "Submitted directly",
  2: "Not submitted directly",
  3: "N/A",
  4: "Exempt",
};

const HMDA_PAYABLE_LABELS = {
  1: "Payable to institution",
  2: "Not payable to institution",
  3: "N/A",
  4: "Exempt",
};

function shortHmdaDemoLabel(label) {
  const s = String(label || "");
  if (s === "Not Hispanic or Latino") return "Not Hispanic";
  if (s === "Hispanic or Latino") return "Hispanic";
  if (s === "Black or African American") return "Black";
  if (s === "American Indian or Alaska Native") return "Am. Indian/AK";
  if (s === "Native Hawaiian or Other Pacific Islander") return "NH/PI";
  if (s === "2 or more minority races") return "2+ minorities";
  if (s === "Ethnicity Not Available" || s === "Race Not Available" || s === "Sex Not Available") return "Not reported";
  return s.length > 24 ? `${s.slice(0, 22)}…` : s;
}

/** Top categories with share of total (public LAR aggregate counts). */
function topHmdaCountsShareLine(counts, maxItems = 2) {
  const entries = Object.entries(counts || {})
    .map(([k, n]) => [k, Number(n) || 0])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (total <= 0) return null;
  return entries
    .slice(0, maxItems)
    .map(([k, n]) => `${shortHmdaDemoLabel(k)} ${fmtPct(n, total)}`)
    .join(" · ");
}

function topHmdaHistEntry(hist, labels) {
  const entries = Object.entries(hist || {})
    .map(([k, n]) => [k, Number(n) || 0])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  const [code, count] = entries[0];
  const total = entries.reduce((s, [, n]) => s + n, 0);
  const label = labels?.[code] || labels?.[String(code)] || `Code ${code}`;
  return total > 0 ? `${label} ${fmtPct(count, total)}` : label;
}

/** CFPB HMDA loan_type (numeric codes in LAR). */
const HMDA_LOAN_TYPE_LABELS = {
  1: "Conventional",
  2: "FHA",
  3: "VA",
  4: "USDA / RHS",
};

function labelHmdaLoanType(key) {
  const n = Number(key);
  if (HMDA_LOAN_TYPE_LABELS[n]) return HMDA_LOAN_TYPE_LABELS[n];
  if (key != null && String(key).trim() !== "") return `Type ${key}`;
  return "Other";
}

const HMDA_PURPOSE_ROLLUP = {
  'Home purchase': 'Purchase',
  Refinancing: 'Refinance - Rate and Term',
  'Streamline refi': 'Refinance - Rate and Term',
  'IRRRL refinancing': 'Refinance - Rate and Term',
  'Home improvement': 'Refinance - Rate and Term',
  'Cash-out refinancing': 'Refinance - Cash out',
  'Cash-out / line draw': 'Refinance - Cash out',
};

/** Originated loan count from a loanTypeSummary row (`{ originated }`) or legacy numeric. */
function originatedCountFromLoanTypeRow(v) {
  if (v == null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.round(v));
  if (typeof v === "object" && v.originated != null && Number.isFinite(Number(v.originated))) {
    return Math.max(0, Math.round(Number(v.originated)));
  }
  return 0;
}

const HMDA_LOAN_TYPE_DONUT_COLORS = { 1: "#0033A0", 2: "#00A651", 3: "#38bdf8", 4: "#f59e0b" };
function donutColorForHmdaLoanTypeKey(k) {
  const n = Number(k);
  if (Number.isFinite(n) && HMDA_LOAN_TYPE_DONUT_COLORS[n] != null) return HMDA_LOAN_TYPE_DONUT_COLORS[n];
  return "#94a3b8";
}

const HMDA_CARD_PRODUCTS_WITH_LOAN_TYPE = new Set(["Conventional", "FHA", "VA", "USDA"]);

/** Per-product originated units from static `originationBreakdown.byProduct` (2025 export). */
function productRowsFromOriginationBreakdown(lender) {
  const byProd = lender?.originationBreakdown?.byProduct;
  if (!byProd || typeof byProd !== "object") return null;
  const rows = [];
  for (const [product, row] of Object.entries(byProd)) {
    const n = row?.originated;
    if (n != null && Number.isFinite(Number(n)) && Number(n) > 0) {
      rows.push({
        product,
        units: Math.round(Number(n)),
        approx: Boolean(row.approximate),
        source: "breakdown",
      });
    }
  }
  rows.sort((a, b) => b.units - a.units);
  return rows.length ? rows : null;
}

function originatedFromBreakdownByProduct(lender, productName) {
  const row = lender?.originationBreakdown?.byProduct?.[productName];
  const n = row?.originated;
  return n != null && Number.isFinite(Number(n)) ? Math.round(Number(n)) : null;
}

/** Originated units from `hmdaInsights.loanTypeSummary` for lender card chips (populated from MLAR / enriched extract). */
function originatedForProductFromSummary(lender, productName) {
  const h = selectHmdaInsightsForLenderRow(lender)?.loanTypeSummary;
  if (h && typeof h === "object") {
    const get = (code) => {
      const row = h[String(code)] ?? h[code];
      const n = row?.originated;
      return n != null && Number.isFinite(Number(n)) ? Math.round(Number(n)) : null;
    };
    if (productName === "Conventional") {
      const n = get(1);
      if (n != null) return n;
    }
    if (productName === "FHA") {
      const n = get(2);
      if (n != null) return n;
    }
    if (productName === "VA") {
      const n = get(3);
      if (n != null) return n;
    }
    if (productName === "USDA") {
      const n = get(4);
      if (n != null) return n;
    }
  }
  return originatedFromBreakdownByProduct(lender, productName);
}

function extraProductTagsForLender(lender) {
  const products = lender?.products || [];
  return products.filter((p) => !HMDA_CARD_PRODUCTS_WITH_LOAN_TYPE.has(p));
}

/** Sum originated units for one loan_type code across lender rows (LAR companion year). */
function sumLoanTypeUnitsForLenders(lenders, code, allLenders = null, panelYear = null) {
  return sumProductLoanTypeUnits(lenders, code, allLenders, panelYear);
}

/** Sum originated counts for HMDA loan_type 1–4; `hasData` false when summary missing or no originated fields. */
function sumLoanTypeOriginated14(lender) {
  const h = selectHmdaInsightsForLenderRow(lender)?.loanTypeSummary;
  if (!h || typeof h !== "object") return { sum: 0, hasData: false };
  let sum = 0;
  let hasData = false;
  for (const code of [1, 2, 3, 4]) {
    const row = h[String(code)] ?? h[code];
    const n = row?.originated;
    if (n != null && Number.isFinite(Number(n))) {
      hasData = true;
      sum += Math.round(Number(n));
    }
  }
  return { sum, hasData };
}

/**
 * Only when there is exactly one –extra— product tag and loan_type 1–4 sums below total originated:
 * attribute the remainder to that tag (still an aggregate bucket—not a true HELOC vs jumbo split).
 */
function estimatedUnitsSingleExtraProduct(lender, productName) {
  const extras = extraProductTagsForLender(lender);
  if (!extras.includes(productName) || extras.length !== 1) return null;
  const { sum, hasData } = sumLoanTypeOriginated14(lender);
  if (!hasData) return null;
  const total = lender?.originations ?? 0;
  if (!Number.isFinite(total) || total <= 0) return null;
  const rem = Math.max(0, Math.round(total - sum));
  return rem > 0 ? rem : null;
}

/** Positive remainder when originated total exceeds sum of loan_type 1–4 (HMDA has no per-tag split for Non-QM / Jumbo / etc.). */
function unallocatedOriginationsAfterLoanTypes14(lender) {
  const { sum, hasData } = sumLoanTypeOriginated14(lender);
  if (!hasData) return null;
  const total = lender?.originations ?? 0;
  if (!Number.isFinite(total) || total <= 0) return null;
  const rem = Math.max(0, Math.round(total - sum));
  return rem > 0 ? rem : null;
}

function lenderProductChipUnits(lender, productName) {
  const exact = originatedForProductFromSummary(lender, productName);
  if (exact != null) return { u: exact, approx: false };
  const est = estimatedUnitsSingleExtraProduct(lender, productName);
  if (est != null) return { u: est, approx: true };
  return { u: null, approx: false };
}

const LOAN_TYPE_TO_PRODUCT = { 1: "Conventional", 2: "FHA", 3: "VA", 4: "USDA" };

/** Originated units by HMDA loan_type from FFIEC LAR (companion year when panel > FFIEC max). */
function loanTypeProductRows(lender) {
  const h = selectHmdaInsightsForLenderRow(lender)?.loanTypeSummary;
  if (h && typeof h === "object") {
    const rows = [];
    for (const code of [1, 2, 3, 4]) {
      const row = h[String(code)] ?? h[code];
      const units = originatedCountFromLoanTypeRow(row);
      if (units > 0 && LOAN_TYPE_TO_PRODUCT[code]) {
        rows.push({ product: LOAN_TYPE_TO_PRODUCT[code], units, approx: false, source: "lar" });
      }
    }
    rows.sort((a, b) => b.units - a.units);
    if (rows.length) return rows;
  }
  return productRowsFromOriginationBreakdown(lender);
}

const HMDA_PRODUCT_LUCIDE_ICONS = {
  Conventional: Home,
  FHA: ShieldCheck,
  VA: Medal,
  USDA: Wheat,
  "Non-QM": Sparkles,
  Jumbo: TrendingUp,
  HELOC: Wallet,
  Construction: HardHat,
};

function hmdaProductBrandTone(product, dk) {
  if (product === "Conventional") return { bg: dk ? "rgba(129,140,248,0.16)" : "rgba(224,231,255,0.88)", bd: dk ? "rgba(129,140,248,0.30)" : "rgba(99,102,241,0.24)", fg: dk ? "#C4B5FD" : "#4338CA" };
  if (product === "FHA") return { bg: dk ? "rgba(52,211,153,0.16)" : "rgba(220,252,231,0.88)", bd: dk ? "rgba(52,211,153,0.28)" : "rgba(16,185,129,0.24)", fg: dk ? "#6EE7B7" : "#047857" };
  if (product === "VA") return { bg: dk ? "rgba(56,189,248,0.16)" : "rgba(224,242,254,0.9)", bd: dk ? "rgba(56,189,248,0.30)" : "rgba(14,165,233,0.24)", fg: dk ? "#7DD3FC" : "#0369A1" };
  if (product === "USDA") return { bg: dk ? "rgba(245,158,11,0.16)" : "rgba(254,243,199,0.9)", bd: dk ? "rgba(245,158,11,0.30)" : "rgba(245,158,11,0.24)", fg: dk ? "#FCD34D" : "#92400E" };
  if (product === "Jumbo") return { bg: dk ? "rgba(167,139,250,0.16)" : "rgba(237,233,254,0.92)", bd: dk ? "rgba(167,139,250,0.28)" : "rgba(124,58,237,0.22)", fg: dk ? "#C4B5FD" : "#6D28D9" };
  if (product === "HELOC") return { bg: dk ? "rgba(45,212,191,0.14)" : "rgba(204,251,241,0.88)", bd: dk ? "rgba(45,212,191,0.28)" : "rgba(20,184,166,0.22)", fg: dk ? "#5EEAD4" : "#0F766E" };
  if (product === "Non-QM") return { bg: dk ? "rgba(244,114,182,0.14)" : "rgba(252,231,243,0.92)", bd: dk ? "rgba(244,114,182,0.28)" : "rgba(219,39,119,0.2)", fg: dk ? "#F9A8D4" : "#BE185D" };
  if (product === "Construction") return { bg: dk ? "rgba(251,146,60,0.14)" : "rgba(255,237,213,0.92)", bd: dk ? "rgba(251,146,60,0.28)" : "rgba(234,88,12,0.22)", fg: dk ? "#FDBA74" : "#C2410C" };
  return { bg: dk ? "rgba(148,163,184,0.16)" : "rgba(241,245,249,0.95)", bd: dk ? "rgba(148,163,184,0.26)" : "rgba(100,116,139,0.22)", fg: dk ? "#CBD5E1" : "#334155" };
}

function HmdaProductChipIcon({ product, tone, dk, muted = false, size = 11 }) {
  const Icon = HMDA_PRODUCT_LUCIDE_ICONS[product] || Layers;
  return (
    <span
      className="hmda-product-chip-icon"
      style={{
        width: muted ? 18 : 16,
        height: muted ? 18 : 16,
        borderRadius: muted ? 6 : 999,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: muted ? tone.bg : dk ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.78)",
        color: tone.fg,
        border: muted ? `1px solid ${tone.bd}` : "none",
        flexShrink: 0,
        boxSizing: "border-box",
      }}
      aria-hidden
    >
      <Icon size={size} strokeWidth={2.25} />
    </span>
  );
}

/** Same product chips + HMDA counts as grid/list lender cards; optional section title. */
function HmdaLenderOriginationsByProduct({ lender, c, dk, isMobile, Tip, marginBottom = 10, showSectionTitle = true, chipsTextAlign = "center", hideEmptyProducts = false, hideUnallocatedNote = false, mutedProductChips = false }) {
  const extras = extraProductTagsForLender(lender);
  const unalloc = unallocatedOriginationsAfterLoanTypes14(lender);
  const showUnallocRow = unalloc != null && extras.length > 1;
  const sortedProducts = sortLenderProductsForDisplay(lender.products);
  const fmtExactUnits = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n)).toLocaleString() : "—");
  const productChipTone = (product) => {
    const brand = hmdaProductBrandTone(product, dk);
    if (mutedProductChips) {
      return {
        ...brand,
        bg: brand.bg,
        bd: brand.bd,
      };
    }
    return brand;
  };
  const visibleProducts = hideEmptyProducts
    ? sortedProducts.filter((p) => lenderProductChipUnits(lender, p).u != null)
    : sortedProducts;
  const hasAnyCount = sortedProducts.some((p) => lenderProductChipUnits(lender, p).u != null);
  const panelYear = Number(lender?.dataYear);
  const larYear = larDetailYearForPanel(panelYear);
  const larCompanion = Number.isFinite(panelYear) && panelYear > larYear;
  const productUnitRows = loanTypeProductRows(lender);
  const hasLei = /^[A-Z0-9]{20}$/i.test(String(lender?.lei || "").trim());
  const enrichAttempted =
    Number(lender?.insightsEnrichLarYear) === larYear && lender?.insightsEnrichAttemptedAt != null;
  const loadingProductMix =
    hasLei &&
    !productUnitRows?.length &&
    !enrichAttempted &&
    (lender?.originations || 0) > 0 &&
    Number.isFinite(panelYear);

  const renderProductChip = (p, u, approx, key = p) => {
    const tone = productChipTone(p);
    const baseTip = TIPS[p] || p;
    const unitLine = approx
      ? `~${fmtExactUnits(u)} units (estimated).`
      : larCompanion
        ? `${fmtExactUnits(u)} originated (HMDA loan_type, ${larYear} FFIEC LAR; ${panelYear} panel total may differ).`
        : `${fmtExactUnits(u)} originated (HMDA loan_type, ${larYear} FFIEC LAR).`;
    const tipText =
      u != null ? `${baseTip}\n\n${unitLine}` : `${baseTip}\n\nNo HMDA loan_type originated count for this product.`;
    return (
      <Tip key={key} text={tipText}>
        <span
          className={`hmda-product-chip${mutedProductChips ? " hmda-product-chip--muted" : ""}`}
          style={{
            display: "inline-flex",
            flexDirection: "row",
            alignItems: "center",
            flexWrap: "nowrap",
            gap: 5,
            padding: mutedProductChips ? "2px 0" : "4px 9px",
            borderRadius: mutedProductChips ? 0 : 999,
            background: mutedProductChips ? "transparent" : tone.bg,
            color: c.tagText,
            border: mutedProductChips ? "none" : `1px solid ${tone.bd}`,
            cursor: "help",
            flex: "0 0 auto",
            whiteSpace: "nowrap",
            boxSizing: "border-box",
          }}
        >
          <HmdaProductChipIcon product={p} tone={tone} dk={dk} muted={mutedProductChips} />
          <span style={{ fontSize: mutedProductChips ? 10 : 9.5, fontWeight: mutedProductChips ? 600 : 700, lineHeight: 1.2, color: tone.fg }}>{p}</span>
          <span style={{ fontSize: 8, fontWeight: 800, color: c.text4, opacity: mutedProductChips ? 0.35 : 0.45, lineHeight: 1 }}>•</span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: tone.fg,
              fontFamily: "'JetBrains Mono',monospace",
              lineHeight: 1.2,
              minWidth: "3.2em",
              textAlign: "right",
            }}
          >
            {approx ? "~" : ""}
            {fmtExactUnits(u)}
          </span>
        </span>
      </Tip>
    );
  };

  return (
    <div style={{ marginBottom, textAlign: chipsTextAlign }}>
      {showSectionTitle && (
        <div
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            color: c.text3,
            marginBottom: 6,
          }}
        >
          Originations by product
          {Number.isFinite(panelYear) ? (
            <span style={{ fontWeight: 600, color: c.text2 }}> · HMDA {panelYear}</span>
          ) : null}
        </div>
      )}

      {productUnitRows?.length ? (
        <Tip text={TIPS["Product chip units"]} pos="bottom">
          <div
            className={`hmda-lender-product-chips${mutedProductChips ? " hmda-product-chips--muted" : ""}`}
            style={{
              display: "flex",
              flexWrap: isMobile ? "nowrap" : "wrap",
              justifyContent: isMobile ? "flex-start" : chipsTextAlign === "center" ? "center" : "flex-start",
              alignItems: "center",
              gap: "6px 8px",
              width: "100%",
              maxWidth: "100%",
              boxSizing: "border-box",
              overflowX: isMobile ? "auto" : "visible",
              WebkitOverflowScrolling: isMobile ? "touch" : undefined,
              paddingBottom: isMobile ? 2 : 0,
              cursor: "help",
            }}
          >
            {productUnitRows.map(({ product, units, approx }) =>
              renderProductChip(product, units, approx, `pu-${product}`),
            )}
          </div>
        </Tip>
      ) : loadingProductMix ? (
        <span style={{ fontSize: 11, color: c.text3 }}>Loading product mix from FFIEC…</span>
      ) : !hasAnyCount && sortedProducts.length > 0 ? (
        <Tip
          text={`Total ${fmtUnits(lender.originations)} originated loans across ${sortedProducts.length} product type${sortedProducts.length > 1 ? "s" : ""}. Per-product breakdown requires HMDA loan_type data — re-run hmda:insights-databrowser to populate counts.`}
          pos="bottom"
        >
          <div
            className={`hmda-lender-product-chips${mutedProductChips ? " hmda-product-chips--muted" : ""}`}
            style={{
              display: "flex",
              flexWrap: isMobile ? "nowrap" : "wrap",
              justifyContent: isMobile ? "flex-start" : chipsTextAlign === "center" ? "center" : "flex-start",
              alignItems: "center",
              gap: "5px 6px",
              width: "100%",
              overflowX: isMobile ? "auto" : "visible",
              paddingBottom: isMobile ? 2 : 0,
              cursor: "help",
            }}
          >
            {visibleProducts.map((p) => {
              const tone = productChipTone(p);
              return (
              <span
                key={p}
                className={`hmda-product-chip${mutedProductChips ? " hmda-product-chip--muted" : ""}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 9px 3px 7px",
                  borderRadius: 999,
                  background: dk ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.06)",
                  border: `1px solid ${c.drillBorder}`,
                  flex: "0 0 auto",
                  whiteSpace: "nowrap",
                }}
              >
                <HmdaProductChipIcon product={p} tone={tone} dk={dk} muted={mutedProductChips} size={10} />
                <span style={{ fontSize: 9, fontWeight: 700, color: c.text2, lineHeight: 1.2 }}>{p}</span>
              </span>
              );
            })}
            <span style={{ fontSize: 9, fontWeight: 600, color: c.text3, whiteSpace: "nowrap", paddingLeft: 2 }}>
              {fmtExactUnits(lender.originations)} total
            </span>
          </div>
        </Tip>
      ) : (
        <Tip text={TIPS["Product chip units"]} pos="bottom">
          <div
            className={`hmda-lender-product-chips${mutedProductChips ? " hmda-product-chips--muted" : ""}`}
            style={{
              display: "flex",
              flexWrap: isMobile ? "nowrap" : "wrap",
              justifyContent: isMobile ? "flex-start" : chipsTextAlign === "center" ? "center" : "flex-start",
              alignItems: "center",
              gap: "6px 8px",
              width: "100%",
              maxWidth: "100%",
              boxSizing: "border-box",
              overflowX: isMobile ? "auto" : "visible",
              WebkitOverflowScrolling: isMobile ? "touch" : undefined,
              paddingBottom: isMobile ? 2 : 0,
              cursor: "help",
            }}
          >
            {visibleProducts.map((p) => {
              const { u, approx } = lenderProductChipUnits(lender, p);
              const tone = productChipTone(p);
              const baseTip = TIPS[p] || p;
              const tipText =
                u != null
                  ? `${baseTip}\n\n${approx ? `~${fmtExactUnits(u)} units: remainder after HMDA loan_type 1–4, shown on the only non–loan_type tag on this card.` : `${fmtExactUnits(u)} originated (HMDA loan_type 1–4).`}`
                  : `${baseTip}\n\nNo HMDA loan_type originated count for this product.`;
              return (
                <Tip key={p} text={tipText}>
                  <span
                    className={`hmda-product-chip${mutedProductChips ? " hmda-product-chip--muted" : ""}`}
                    style={{
                      display: "inline-flex",
                      flexDirection: "row",
                      alignItems: "center",
                      flexWrap: "nowrap",
                      gap: 5,
                      padding: "4px 9px",
                      borderRadius: 999,
                      background: tone.bg,
                      color: c.tagText,
                      border: `1px solid ${tone.bd}`,
                      cursor: "help",
                      flex: "0 0 auto",
                      whiteSpace: "nowrap",
                      boxSizing: "border-box",
                    }}
                  >
                    <HmdaProductChipIcon product={p} tone={tone} dk={dk} muted={mutedProductChips} />
                    <span style={{ fontSize: 9.5, fontWeight: 700, lineHeight: 1.2, color: tone.fg }}>{p}</span>
                    <span style={{ fontSize: 8, fontWeight: 800, color: c.text4, opacity: 0.45, lineHeight: 1 }}>•</span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        color: u != null ? tone.fg : c.text4,
                        fontFamily: "'JetBrains Mono',monospace",
                        lineHeight: 1.2,
                        minWidth: "3.2em",
                        textAlign: "right",
                        opacity: u != null ? 1 : 0.45,
                      }}
                    >
                      {u != null ? (
                        <>
                          {approx && "~"}
                          {fmtExactUnits(u)}
                        </>
                      ) : (
                        "—"
                      )}
                    </span>
                  </span>
                </Tip>
              );
            })}
          </div>
        </Tip>
      )}

      {showUnallocRow && !hideUnallocatedNote && (
        <Tip text={TIPS["Product chip unallocated"]} pos="bottom">
          <div
            style={{
              marginTop: 8,
              marginLeft: "auto",
              marginRight: "auto",
              maxWidth: "100%",
              padding: "5px 10px",
              borderRadius: 10,
              fontSize: 9,
              fontWeight: 600,
              color: c.text3,
              lineHeight: 1.35,
              background: dk ? "rgba(255,255,255,0.04)" : "rgba(15,23,42,0.06)",
              border: `1px dashed ${c.drillBorder}`,
              cursor: "help",
              textAlign: "center",
            }}
          >
            <span style={{ fontWeight: 800, color: c.text2 }}>Not in HMDA loan_type: </span>~{fmtUnits(unalloc)} units combined for {extras.join(", ")}.
          </div>
        </Tip>
      )}
    </div>
  );
}

function fmtPct(num, den) {
  if (!den || den <= 0) return "—";
  return `${((100 * num) / den).toFixed(1)}%`;
}

/** Panel benchmark when no institution LAR is loaded yet (aligned with product dimension tables). */
const HMDA_PANEL_DISPOSITION_BENCHMARK = {
  pullthroughRate: 0.72,
  denialRate: 0.14,
  withdrawnRate: 0.09,
  incompleteRate: 0.05,
  approvedNotAcceptedRate: 0.02,
};

function resolvePanelDispositionBenchmark(allLenders, pyResolved) {
  const larY = larDetailYearForPanel(pyResolved);
  const dispYear = resolveDispositionYear(allLenders || [], pyResolved);
  const candidates = [
    [getPanelDisposition(allLenders || [], dispYear), dispYear],
    [getPanelDisposition(allLenders || [], larY), larY],
    [aggregateLarYearDispositionPool(allLenders || [], larY), larY],
    [aggregateLarYearDispositionPool(allLenders || [], dispYear), dispYear],
  ];
  for (const [disp, year] of candidates) {
    if (disp) return { disp, year };
  }
  return { disp: null, year: larY || pyResolved };
}

function buildPanelEstimatedDisposition(panelOrig, pyResolved, allLenders) {
  const { disp: panelDisp, year: dispositionYear } = resolvePanelDispositionBenchmark(allLenders, pyResolved);
  const useBenchmark = !panelDisp?.pullthroughRate || panelDisp.pullthroughRate <= 0 || panelDisp.pullthroughRate >= 1;
  const pt = useBenchmark ? HMDA_PANEL_DISPOSITION_BENCHMARK.pullthroughRate : panelDisp.pullthroughRate;
  const denialRate = useBenchmark ? HMDA_PANEL_DISPOSITION_BENCHMARK.denialRate : panelDisp.denialRate || 0;
  const withdrawnRate = useBenchmark ? HMDA_PANEL_DISPOSITION_BENCHMARK.withdrawnRate : panelDisp.withdrawnRate || 0;
  const incompleteRate = useBenchmark ? HMDA_PANEL_DISPOSITION_BENCHMARK.incompleteRate : panelDisp.incompleteRate || 0;
  const anaRate = useBenchmark
    ? HMDA_PANEL_DISPOSITION_BENCHMARK.approvedNotAcceptedRate
    : panelDisp.totalApplications > 0
      ? (panelDisp.approvedNotAcceptedCount || 0) / panelDisp.totalApplications
      : 0;
  const appsEst = Math.max(panelOrig, Math.round(panelOrig / pt));
  const denied = Math.round(appsEst * denialRate);
  const withdrawn = Math.round(appsEst * withdrawnRate);
  const incomplete = Math.round(appsEst * incompleteRate);
  const approvedNotAccepted = Math.round(appsEst * anaRate);
  const nonOrig = Math.max(0, appsEst - panelOrig);
  return {
    source: "panel-estimated",
    reportingYear: null,
    panelYear: pyResolved,
    dispositionYear,
    benchmarkOnly: useBenchmark,
    totalApplications: appsEst,
    originated: panelOrig,
    nonOrigination: nonOrig,
    pullthroughPct: (panelOrig / appsEst) * 100,
    nonOriginationPct: (nonOrig / appsEst) * 100,
    denied,
    withdrawn,
    incomplete,
    approvedNotAccepted,
    falloutDetail: denied + withdrawn + incomplete + approvedNotAccepted,
    insights: null,
  };
}

/** Best available LAR disposition for pipeline / pull-through (FFIEC public LAR when present). */
function resolveLenderLarDisposition(lender, panelYear, allLenders = null) {
  const py = Number(panelYear);
  const pyResolved = Number.isFinite(py) ? py : Number(lender?.dataYear);
  const larYear = larDetailYearForPanel(pyResolved);
  const panelOrig = Number(lender?.originations ?? lender?.units ?? 0);
  let h = selectHmdaInsightsForYear(lender, larYear);
  if ((!h || !(h.totalApplications > 0)) && (lender?.hmdaInsights?.totalApplications || 0) > 0) {
    h = lender.hmdaInsights;
  }
  if (h && (h.totalApplications || 0) > 0) {
    const ta = h.totalApplications;
    const larY = Number(h.reportingYear) || larYear;
    const larOrig = h.totalOriginated || 0;
    const originated =
      Number.isFinite(pyResolved) && pyResolved > larY && panelOrig > 0 ? panelOrig : larOrig || panelOrig || 0;
    const nonOrig = Math.max(0, ta - originated);
    const pre = h.approvedNotAcceptedCount ?? h.actionTaken?.[2] ?? h.actionTaken?.["2"] ?? 0;
    const deny = h.denialCount || 0;
    const wd = h.withdrawalCount || 0;
    const inc = h.incompleteCount || 0;
    const falloutDetail = Number(pre) + Number(deny) + Number(wd) + Number(inc);
    return {
      source: "lar",
      reportingYear: larY,
      panelYear: pyResolved,
      panelOrigAhead: Number.isFinite(pyResolved) && pyResolved > larY && panelOrig > 0,
      totalApplications: ta,
      originated,
      nonOrigination: nonOrig,
      pullthroughPct: ta > 0 ? (originated / ta) * 100 : null,
      nonOriginationPct: ta > 0 ? (nonOrig / ta) * 100 : null,
      denied: deny,
      withdrawn: wd,
      incomplete: inc,
      approvedNotAccepted: Number(pre),
      falloutDetail,
      insights: h,
    };
  }
  if (panelOrig > 0) {
    return buildPanelEstimatedDisposition(panelOrig, pyResolved, allLenders);
  }
  return null;
}

const HMDA_DRILL_SUPPRESS_MIN = 5;

function dominantLoanTypeFromInsights(h) {
  if (!h?.loanTypeSummary) return null;
  let best = null;
  let bestN = 0;
  for (const [k, v] of Object.entries(h.loanTypeSummary)) {
    const o = v?.originated || 0;
    if (o > bestN) {
      bestN = o;
      best = k;
    }
  }
  return best;
}

/** marketRef: { byYear: { "2024": { byLoanType: { Conventional: { medianRateSpread, medianLoanTermMonths } } } } } } */
function marketSegmentForYear(marketRef, dataYear) {
  if (!marketRef) return null;
  const y = String(dataYear || 2023);
  return marketRef.byYear?.[y] || marketRef[y] || null;
}

function HmdaMicroSpark({ values, color, w = 100, h = 26 }) {
  if (!values?.length) return null;
  const mx = Math.max(1, ...values);
  const n = values.length;
  const pad = 2;
  const pts = values
    .map((v, i) => {
      const x = pad + (n === 1 ? (w - pad * 2) / 2 : (i / (n - 1)) * (w - pad * 2));
      const y = h - pad - (v / mx) * (h - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" points={pts} />
    </svg>
  );
}

/** Add peer comparison percentiles per dataYear (same panel as dashboard). */
function enrichHmdaPeers(lenders) {
  const byYear = new Map();
  for (const l of lenders) {
    const y = l.dataYear || 2023;
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(l);
  }
  /** Denial / withdrawal / incomplete / spread: % of panel lenders with a strictly higher value than this institution. */
  const pctPeersWorseWhenLowerIsBetter = (peerVals, x) => {
    if (x == null || !Number.isFinite(x) || peerVals.length < 8) return null;
    return Math.round((100 * peerVals.filter((v) => v > x).length) / peerVals.length);
  };
  /** Origination share / median term: % of panel lenders with a strictly lower value than this institution. */
  const pctPeersWorseWhenHigherIsBetter = (peerVals, x) => {
    if (x == null || !Number.isFinite(x) || peerVals.length < 8) return null;
    return Math.round((100 * peerVals.filter((v) => v < x).length) / peerVals.length);
  };
  for (const [, arr] of byYear) {
    const panel = arr.filter((l) => {
      const h = selectHmdaInsightsForLenderRow(l);
      return h && (h.totalApplications || 0) >= 75;
    });
    if (panel.length < 20) {
      for (const l of arr) {
        l.hmdaPeer = null;
      }
      continue;
    }
    const denialRates = panel.map((l) => {
      const h = selectHmdaInsightsForLenderRow(l);
      return (h.denialCount || 0) / h.totalApplications;
    });
    const withdrawRates = panel.map((l) => {
      const h = selectHmdaInsightsForLenderRow(l);
      return (h.withdrawalCount || 0) / h.totalApplications;
    });
    const origShares = panel.map((l) => {
      const h = selectHmdaInsightsForLenderRow(l);
      return (h.totalOriginated || 0) / h.totalApplications;
    });
    const spreads = panel
      .map((l) => selectHmdaInsightsForLenderRow(l)?.originatedMedianRateSpread)
      .filter((v) => v != null && Number.isFinite(v));
    const terms = panel
      .map((l) => selectHmdaInsightsForLenderRow(l)?.originatedMedianLoanTermMonths)
      .filter((v) => v != null && Number.isFinite(v));
    const incompleteRates = panel.map((l) => {
      const h = selectHmdaInsightsForLenderRow(l);
      return (h.incompleteCount || 0) / h.totalApplications;
    });

    for (const l of arr) {
      const h = selectHmdaInsightsForLenderRow(l);
      if (!h || (h.totalApplications || 0) < 75) {
        l.hmdaPeer = null;
        continue;
      }
      const t = h.totalApplications;
      const myDr = (h.denialCount || 0) / t;
      const myWr = (h.withdrawalCount || 0) / t;
      const myOs = (h.totalOriginated || 0) / t;
      const myInc = (h.incompleteCount || 0) / t;
      l.hmdaPeer = {
        panelSize: panel.length,
        denialRateBetterThanPct: pctPeersWorseWhenLowerIsBetter(denialRates, myDr),
        withdrawalRateBetterThanPct: pctPeersWorseWhenLowerIsBetter(withdrawRates, myWr),
        incompleteRateBetterThanPct: pctPeersWorseWhenLowerIsBetter(incompleteRates, myInc),
        originationShareBetterThanPct: pctPeersWorseWhenHigherIsBetter(origShares, myOs),
        medianSpreadBetterThanPct:
          h.originatedMedianRateSpread != null && spreads.length >= 8
            ? pctPeersWorseWhenLowerIsBetter(spreads, h.originatedMedianRateSpread)
            : null,
        medianTermBetterThanPct:
          h.originatedMedianLoanTermMonths != null && terms.length >= 8
            ? pctPeersWorseWhenHigherIsBetter(terms, h.originatedMedianLoanTermMonths)
            : null,
      };
    }
  }
  return lenders;
}

/** Six core HMDA LAR metrics (aligned with Compare modal). */
function HmdaLarSnapshotGrid({ lender, c, isMobile, compact, Tip: TipComp }) {
  const h = selectHmdaInsightsForLenderRow(lender);
  if (!h) return null;
  const Tp = TipComp || (({ children }) => <>{children}</>);
  const ta = h.totalApplications || 0;
  const peer = lender?.hmdaPeer;
  const labFs = compact ? "7px" : "8px";
  const valFs = compact ? "10px" : "12px";
  const gap = compact ? 4 : 8;
  const pad = compact ? "5px 6px" : "8px 9px";
  const cells = [
    { k: "apps", l: "HMDA apps", v: ta.toLocaleString() },
    { k: "deny", l: "Denials", v: ta > 0 ? fmtHmdaLarCount(h.denialCount ?? 0) : "—" },
    { k: "wd", l: "Withdrawals", v: ta > 0 ? fmtHmdaLarCount(h.withdrawalCount ?? 0) : "—" },
    { k: "orig", l: "Originated", v: ta > 0 ? fmtHmdaLarCount(h.totalOriginated ?? 0) : "—" },
    {
      k: "spr",
      l: "Med spread",
      v: h.originatedMedianRateSpread != null && Number.isFinite(h.originatedMedianRateSpread) ? `${h.originatedMedianRateSpread}%` : "—",
    },
    {
      k: "term",
      l: "Med term",
      v:
        h.originatedMedianLoanTermMonths != null && Number.isFinite(h.originatedMedianLoanTermMonths)
          ? `${Math.round(h.originatedMedianLoanTermMonths)} mo`
          : "—",
    },
  ];
  return (
    <div style={{ width: "100%" }}>
      {!compact && (
        <div style={{ fontSize: "9px", fontWeight: 700, color: c.text3, marginBottom: 6, letterSpacing: "0.05em", textTransform: "uppercase" }}>
          HMDA LAR snapshot ({h.reportingYear})
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(3, minmax(0, 1fr))" : "repeat(6, minmax(0, 1fr))", gap }}>
        {cells.map((cell) => (
          <div key={cell.k} style={{ padding: pad, borderRadius: compact ? 6 : 8, background: c.statBg, border: `1px solid ${c.drillBorder}` }}>
            <div style={{ fontSize: labFs, color: c.text4, fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase", marginBottom: 2 }}>{cell.l}</div>
            <div style={{ fontSize: valFs, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: c.text2 }}>{cell.v}</div>
          </div>
        ))}
      </div>
      {peer && !compact && (
        <Tp text={TIPS["Peer benchmark"]} pos="bottom">
            <div style={{ marginTop: 8, fontSize: "9px", color: c.text3, lineHeight: 1.45, cursor: "help" }}>
            Peer panel (n={peer.panelSize}):{" "}
            {peer.denialRateBetterThanPct != null && <span>{peer.denialRateBetterThanPct}% of panel: higher denial rate ↓ </span>}
            {peer.withdrawalRateBetterThanPct != null && <span>{peer.withdrawalRateBetterThanPct}% of panel: higher withdrawal rate ↓ </span>}
            {peer.originationShareBetterThanPct != null && <span>{peer.originationShareBetterThanPct}% of panel: lower origination share ↓ </span>}
            {peer.medianSpreadBetterThanPct != null && <span>{peer.medianSpreadBetterThanPct}% of panel: higher median spread ↑ </span>}
            {peer.medianTermBetterThanPct != null && <span>{peer.medianTermBetterThanPct}% of panel: lower median term</span>}
            {peer.incompleteRateBetterThanPct != null && <span> ↑ {peer.incompleteRateBetterThanPct}% of panel: higher incomplete rate</span>}
          </div>
        </Tp>
      )}
    </div>
  );
}

/** Compact funnel, denial breakdown (suppressed small n), LAR monthly orig trend, vs national loan_type segment. */
function HmdaDrilldownExtras({ lender, c, isMobile, marketRef, Tip: TipComp }) {
  const h = selectHmdaInsightsForLenderRow(lender);
  if (!h) return null;
  const Tp = TipComp || (({ children }) => <>{children}</>);
  const ta = h.totalApplications || 0;
  if (ta <= 0) return null;

  const seg = marketSegmentForYear(marketRef, lender.dataYear);
  const domLt = dominantLoanTypeFromInsights(h);
  const mkt = domLt && seg?.byLoanType ? seg.byLoanType[domLt] : null;

  const orig = h.totalOriginated || 0;
  const deny = h.denialCount || 0;
  const wd = h.withdrawalCount || 0;
  const inc = h.incompleteCount || 0;

  const bar = (key, label, count, color) => {
    const pct = ta > 0 ? (100 * count) / ta : 0;
    return (
      <div key={key} style={{ flex: 1, minWidth: isMobile ? "22%" : "18%" }}>
        <div style={{ fontSize: "7px", color: c.text4, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 2 }}>{label}</div>
        <div style={{ height: 4, borderRadius: 3, background: c.drillBorder, overflow: "hidden", marginBottom: 2 }}>
          <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: color, borderRadius: 3 }} />
        </div>
        <div style={{ fontSize: "10px", fontWeight: 800, fontFamily: "'JetBrains Mono',monospace", color: c.text2, lineHeight: 1.15 }}>{fmtHmdaLarCount(count)}</div>
        <div style={{ fontSize: "7px", fontWeight: 600, fontFamily: "'JetBrains Mono',monospace", color: c.text4, lineHeight: 1.1 }}>{pct.toFixed(1)}% of apps</div>
      </div>
    );
  };

  const denialEntries = Object.entries(h.denialReasons || {})
    .map(([code, count]) => ({
      code,
      count,
      label: HMDA_DENIAL_REASON_LABELS[String(code)] || `Code ${code}`,
    }))
    .filter((d) => d.count >= HMDA_DRILL_SUPPRESS_MIN)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  const lastMonths = (h.monthlyFromLar || []).slice(-14);
  const moOrig = lastMonths.map((x) => x.originated || 0);

  return (
    <div style={{ marginTop: 6, padding: "8px 9px", borderRadius: 8, background: c.statBg, border: `1px solid ${c.drillBorder}` }}>
      <Tp text={TIPS["HMDA outcomes"]} pos="bottom">
        <div style={{ fontSize: "7px", fontWeight: 800, color: c.text4, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6, cursor: "help" }}>
          HMDA outcome mix (reported) –
        </div>
      </Tp>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {bar("o", "Orig", orig, c.success)}
        {bar("d", "Denied", deny, c.danger)}
        {bar("w", "Withdrawn", wd, "#f59e0b")}
        {bar("i", "Incomplete", inc, c.text3)}
      </div>

      {denialEntries.length > 0 && (
        <>
          <div style={{ height: 1, background: c.drillBorder, margin: "8px 0" }} />
          <Tp text={TIPS["HMDA denial reasons"]} pos="bottom">
            <div style={{ fontSize: "7px", fontWeight: 700, color: c.text4, marginBottom: 4, cursor: "help" }}>Top denial reasons –</div>
          </Tp>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {denialEntries.map((d) => (
              <div key={d.code} style={{ display: "flex", justifyContent: "space-between", gap: 6, fontSize: "9px" }}>
                <span style={{ color: c.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, flexShrink: 0 }}>
                  {d.count.toLocaleString()}
                  {deny > 0 ? ` (${fmtPct(d.count, deny)})` : ""}
                </span>
              </div>
            ))}
          </div>
          {(h.denialReasonsSuppressedCount || 0) > 0 && (
            <div style={{ fontSize: "8px", color: c.text4, marginTop: 4 }}>
              Additional reason codes suppressed (counts under {HMDA_DRILL_SUPPRESS_MIN}): {h.denialReasonsSuppressedCount.toLocaleString()} mentions
            </div>
          )}
        </>
      )}

      {moOrig.some((v) => v > 0) && (
        <>
          <div style={{ height: 1, background: c.drillBorder, margin: "8px 0" }} />
          <Tp text={TIPS["HMDA LAR timing"]} pos="bottom">
            <div style={{ fontSize: "7px", fontWeight: 700, color: c.text4, marginBottom: 4, cursor: "help" }}>Originations by month (LAR action date) –</div>
          </Tp>
          <HmdaMicroSpark values={moOrig} color={c.accent} w={isMobile ? 140 : 180} h={28} />
        </>
      )}

      {mkt && domLt && (h.originatedMedianRateSpread != null || h.originatedMedianLoanTermMonths != null) && (
        <>
          <div style={{ height: 1, background: c.drillBorder, margin: "8px 0" }} />
          <Tp text={TIPS["HMDA market segment"]} pos="bottom">
            <div style={{ fontSize: "7px", fontWeight: 700, color: c.text4, marginBottom: 4, cursor: "help" }}>Vs national HMDA ({domLt}) –</div>
          </Tp>
          <div style={{ fontSize: "9px", color: c.text2, lineHeight: 1.4 }}>
            {h.originatedMedianRateSpread != null && mkt.medianRateSpread != null && (
              <div>
                Median rate spread: lender <strong style={{ fontFamily: "'JetBrains Mono',monospace" }}>{h.originatedMedianRateSpread}%</strong> · national segment{" "}
                <strong style={{ fontFamily: "'JetBrains Mono',monospace" }}>{mkt.medianRateSpread}%</strong>
              </div>
            )}
            {h.originatedMedianLoanTermMonths != null && mkt.medianLoanTermMonths != null && (
              <div>
                Median term: lender <strong style={{ fontFamily: "'JetBrains Mono',monospace" }}>{Math.round(h.originatedMedianLoanTermMonths)} mo</strong> · national{" "}
                <strong style={{ fontFamily: "'JetBrains Mono',monospace" }}>{Math.round(mkt.medianLoanTermMonths)} mo</strong>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function HmdaCompactLenderMetrics({ lender, c, isMobile, marketRef, Tip }) {
  if (!selectHmdaInsightsForLenderRow(lender)) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
      <HmdaLarSnapshotGrid lender={lender} c={c} isMobile={isMobile} compact Tip={Tip} />
      <HmdaDrilldownExtras lender={lender} c={c} isMobile={isMobile} marketRef={marketRef} Tip={Tip} />
    </div>
  );
}

/** Declinations, withdrawals, incomplete files, and HMDA analog to pipeline fallout — with official CFPB / FFIEC links. */
function HmdaPublicPipelineDrilldown({ lender, c, isMobile, dk, Tip: TipComp }) {
  const h = selectHmdaInsightsForLenderRow(lender);
  const Tp = TipComp || (({ children }) => <>{children}</>);
  if (!h || !(h.totalApplications > 0)) return null;
  const ta = h.totalApplications;

  const actionTakenCount = (code) => {
    const s = String(code);
    const raw = h.actionTaken?.[s] ?? h.actionTaken?.[code];
    if (raw != null && Number.isFinite(Number(raw))) return Math.max(0, Math.round(Number(raw)));
    if (code === 3) return h.denialCount || 0;
    if (code === 4) return h.withdrawalCount || 0;
    if (code === 5) return h.incompleteCount || 0;
    return 0;
  };

  const pipelineRows = [
    { code: 3, label: HMDA_ACTION_LABELS[3] },
    { code: 4, label: HMDA_ACTION_LABELS[4] },
    { code: 5, label: HMDA_ACTION_LABELS[5] },
    { code: 2, label: HMDA_ACTION_LABELS[2] },
  ].map((r) => ({
    ...r,
    count: actionTakenCount(r.code),
    pct: ta > 0 ? fmtPct(actionTakenCount(r.code), ta) : "—",
  }));

  const falloutSum = pipelineRows.reduce((s, r) => s + r.count, 0);
  const pre7 = actionTakenCount(7);
  const pre8 = actionTakenCount(8);

  const denialEntries = Object.entries(h.denialReasons || {})
    .map(([code, count]) => ({
      code,
      count,
      label: HMDA_DENIAL_REASON_LABELS[String(code)] || `Code ${code}`,
    }))
    .filter((d) => d.count >= HMDA_DRILL_SUPPRESS_MIN)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const linkRow = (href, label) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "11px", fontWeight: 700, color: c.accent, textDecoration: "none" }}
    >
      {label} {IC.ext}
    </a>
  );

  return (
    <div
      style={{
        marginTop: 8,
        marginBottom: 4,
        padding: isMobile ? "12px" : "14px 16px",
        borderRadius: 14,
        background: c.drillBg,
        border: `1px solid ${c.drillBorder}`,
        userSelect: "text",
        WebkitUserSelect: "text",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", marginBottom: 10 }}>
        <Tp text={TIPS["HMDA pipeline drill"]} pos="bottom">
          <span style={{ fontSize: "10px", color: c.text3, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "help" }}>
            HMDA public records — declinations, withdrawals & fallout –
          </span>
        </Tp>
        <span style={{ fontSize: "9px", color: c.text4 }}>
          Reporting year {h.reportingYear} · {ta.toLocaleString()} LAR rows
        </span>
      </div>

      <p style={{ fontSize: "10px", color: c.text3, lineHeight: 1.5, margin: "0 0 10px" }}>
        Official HMDA uses the <strong style={{ color: c.text2 }}>action_taken</strong> field on each public Loan Application Register row. –Fallout— here means{" "}
        <strong style={{ color: c.text2 }}>non-origination dispositions</strong> (codes 2–5): approved but not accepted, denied, withdrawn, or closed incomplete—not your internal LOS pull-through.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
        {pipelineRows.map((r) => (
          <div
            key={r.code}
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr auto" : "1fr auto auto",
              gap: 8,
              alignItems: "center",
              fontSize: "11px",
              padding: "6px 8px",
              borderRadius: 8,
              background: c.statBg,
              border: `1px solid ${c.drillBorder}`,
            }}
          >
            <span style={{ color: c.text2 }}>
              <span style={{ color: c.text4, fontFamily: "'JetBrains Mono',monospace", fontSize: "10px", marginRight: 6 }}>{r.code}</span>
              {r.label}
            </span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, color: c.text2, textAlign: isMobile ? "right" : "left" }}>{r.count.toLocaleString()}</span>
            {!isMobile && <span style={{ color: c.text4, fontSize: "10px", fontFamily: "'JetBrains Mono',monospace" }}>{r.pct}</span>}
          </div>
        ))}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr auto" : "1fr auto auto",
            gap: 8,
            alignItems: "center",
            fontSize: "11px",
            padding: "8px 10px",
            borderRadius: 10,
            background: dk ? "rgba(99,102,241,0.12)" : "rgba(99,102,241,0.08)",
            border: `1px solid ${c.accent}33`,
          }}
        >
          <span style={{ fontWeight: 800, color: c.text2 }}>Combined fallout analog (codes 2–5)</span>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 800, color: c.accent }}>{falloutSum.toLocaleString()}</span>
          {!isMobile && <span style={{ color: c.text4, fontSize: "10px", fontFamily: "'JetBrains Mono',monospace" }}>{ta > 0 ? fmtPct(falloutSum, ta) : "—"}</span>}
        </div>
      </div>

      {(pre7 > 0 || pre8 > 0) && (
        <div style={{ fontSize: "10px", color: c.text3, marginBottom: 10, lineHeight: 1.45 }}>
          Preapproval outcomes in this file:{" "}
          {pre7 > 0 && (
            <span>
              {HMDA_ACTION_LABELS[7]} <strong style={{ fontFamily: "'JetBrains Mono',monospace" }}>{pre7.toLocaleString()}</strong>
              {pre8 > 0 ? " · " : ""}
            </span>
          )}
          {pre8 > 0 && (
            <span>
              {HMDA_ACTION_LABELS[8]} <strong style={{ fontFamily: "'JetBrains Mono',monospace" }}>{pre8.toLocaleString()}</strong>
            </span>
          )}
        </div>
      )}

      {denialEntries.length > 0 && (
        <>
          <Tp text={TIPS["HMDA denial reasons"]} pos="bottom">
            <div style={{ fontSize: "10px", fontWeight: 700, color: c.text3, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em", cursor: "help" }}>
              Declination reasons (denied rows) –
            </div>
          </Tp>
          <div style={{ display: "grid", gap: 4, marginBottom: 12, maxHeight: 140, overflowY: "auto" }}>
            {denialEntries.map((d) => (
              <div key={d.code} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, fontSize: "10px" }}>
                <span style={{ color: c.text2 }}>{d.label}</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>{d.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ fontSize: "9px", color: c.text4, lineHeight: 1.5, marginBottom: 10 }}>
        Verify counts and field definitions in the regulators" tools. Reason codes with small counts may be suppressed above (threshold {HMDA_DRILL_SUPPRESS_MIN}) to reduce re-identification risk.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8, borderTop: `1px solid ${c.drillBorder}` }}>
        <span style={{ fontSize: "9px", fontWeight: 800, color: c.text4, letterSpacing: "0.06em", textTransform: "uppercase" }}>Official HMDA sources</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {linkRow("https://www.consumerfinance.gov/hmda/", "CFPB — Home Mortgage Disclosure Act (HMDA)")}
          {linkRow("https://ffiec.cfpb.gov/data-browser", "FFIEC HMDA Data Browser (public LAR)")}
          {linkRow(
            ffiecHmdaFieldReferenceUrl(h.reportingYear),
            `HMDA data specification & field reference (${h.reportingYear})`,
          )}
        </div>
      </div>
    </div>
  );
}

/** Source attribution + verify links for pipeline / declinations panel. */
function HmdaModalPipelineSources({ lender, registry, py, lei, c }) {
  const nmlsId = registry?.nmls?.id || lender?.nmls;
  const nmlsUrl = registry?.nmls?.url || nmlsConsumerAccessCompanyUrl(nmlsId);
  const gleifUrl = lei ? `https://search.gleif.org/#/record/${encodeURIComponent(lei)}` : null;
  const fdicCert = registry?.fdic?.cert;
  const fdicUrl = fdicCert
    ? `https://banks.data.fdic.gov/bank-profile?cert=${encodeURIComponent(fdicCert)}`
    : "https://banks.data.fdic.gov/";
  const ncuaUrl = "https://mapping.ncua.gov/";
  const hmdaUrl = lei
    ? `https://ffiec.cfpb.gov/data-browser/entity/${encodeURIComponent(lei)}`
    : "https://ffiec.cfpb.gov/data-browser";

  const chips = [
    { id: "hmda", label: "HMDA", href: hmdaUrl, title: "CFPB / FFIEC Home Mortgage Disclosure Act public LAR" },
    { id: "gleif", label: "LEI / GLEIF", href: gleifUrl, title: "Global Legal Entity Identifier Foundation registry" },
    { id: "nmls", label: "NMLS", href: nmlsUrl, title: "Nationwide Multistate Licensing System Consumer Access" },
    { id: "fdic", label: "FDIC", href: fdicUrl, title: "Federal Deposit Insurance Corporation institution data" },
    { id: "ncua", label: "NCUA", href: ncuaUrl, title: "National Credit Union Administration locator" },
  ];

  return (
    <div className="hmda-lender-modal-pipeline-sources">
      <div className="hmda-lender-modal-pipeline-sources__head">
        <span className="hmda-lender-modal-pipeline-sources__label">Sources</span>
        {lei ? (
          <span className="hmda-lender-modal-pipeline-links__meta">
            <span className="hmda-lender-modal-pipeline-links__meta-label">LEI</span>
            <span className="hmda-lender-modal-pipeline-links__meta-value">{lei}</span>
          </span>
        ) : null}
      </div>
      <div className="hmda-lender-modal-pipeline-sources__chips">
        {chips.map((chip) =>
          chip.href ? (
            <a
              key={chip.id}
              href={chip.href}
              target="_blank"
              rel="noopener noreferrer"
              className="hmda-lender-modal-pipeline-sources__chip"
              title={chip.title}
            >
              {chip.label} {IC.ext}
            </a>
          ) : (
            <span key={chip.id} className="hmda-lender-modal-pipeline-sources__chip hmda-lender-modal-pipeline-sources__chip--muted" title={chip.title}>
              {chip.label}
            </span>
          ),
        )}
      </div>
      <div className="hmda-lender-modal-pipeline-links__actions">
        <a href={hmdaUrl} target="_blank" rel="noopener noreferrer" className="hmda-lender-modal-pipeline-links__link">
          FFIEC Data Browser {IC.ext}
        </a>
        <a href={ffiecHmdaFieldReferenceUrl(py)} target="_blank" rel="noopener noreferrer" className="hmda-lender-modal-pipeline-links__link">
          Field reference ({py}) {IC.ext}
        </a>
      </div>
    </div>
  );
}

/** Pull-through & declinations from FFIEC LAR (or panel-only fallback with verify links). */
function HmdaModalPipelinePanel({ lender, panelYear, c, isMobile, Tip: TipComp, allLenders = null, registry = null }) {
  const disposition = resolveLenderLarDisposition(lender, panelYear, allLenders);
  const Tp = TipComp || (({ children }) => <>{children}</>);
  const py = Number(panelYear ?? lender?.dataYear ?? HMDA_PREFERRED_YEAR);
  const lei = lender?.lei ? String(lender.lei).trim().toUpperCase() : "";

  const cell = (label, value, sub, tone = "slate") => (
    <div className={`hmda-lender-modal-metric-cell${tone !== "slate" ? ` hmda-lender-modal-metric-cell--${tone}` : ""}`}>
      <span className="hmda-lender-modal-metric-cell__label">{label}</span>
      <span className="hmda-lender-modal-metric-cell__value">{value}</span>
      {sub ? <span className="hmda-lender-modal-metric-cell__sub">{sub}</span> : null}
    </div>
  );

  const sourceStrip = <HmdaModalPipelineSources lender={lender} registry={registry} py={py} lei={lei} c={c} />;

  if (!disposition) {
    return (
      <div className="hmda-lender-modal-pipeline-panel" style={{ userSelect: "text", WebkitUserSelect: "text" }}>
        <p className="hmda-lender-modal-pipeline-formula">
          <strong>Pull-through</strong> = originated ÷ total applications.{" "}
          <strong>Non-origination</strong> = applications − originated.
        </p>
      </div>
    );
  }

  const {
    totalApplications: ta,
    nonOrigination: nonOrig,
    reportingYear: larY,
    source,
    panelOrigAhead,
  } = disposition;
  const orig = disposition.originated;
  const pullPct = disposition.pullthroughPct != null ? `${disposition.pullthroughPct.toFixed(1)}%` : "—";
  const nonOrigPct = disposition.nonOriginationPct != null ? `${disposition.nonOriginationPct.toFixed(1)}%` : "—";
  const isEstimated = source === "panel-estimated";
  const appsLabel = isEstimated ? `${ta.toLocaleString()} est.` : `${ta.toLocaleString()} applications`;

  return (
    <div className="hmda-lender-modal-pipeline-panel">
      <Tp text={TIPS["HMDA pipeline drill"]} pos="bottom">
        <div className="hmda-lender-modal-pullthrough-hero">
          <div className="hmda-lender-modal-pullthrough-hero__main">
            <span className="hmda-lender-modal-pullthrough-hero__label">Pull-through</span>
            <span className="hmda-lender-modal-pullthrough-hero__value">{pullPct}</span>
          </div>
          <div className="hmda-lender-modal-pullthrough-hero__formula">
            <span>{fmtHmdaLarCount(orig)} closed</span>
            <span className="hmda-lender-modal-pullthrough-hero__op" aria-hidden>÷</span>
            <span>{appsLabel}</span>
          </div>
          <div className="hmda-lender-modal-pullthrough-hero__side">
            <span className="hmda-lender-modal-pullthrough-hero__side-label">Non-origination</span>
            <span className="hmda-lender-modal-pullthrough-hero__side-value">{nonOrigPct}</span>
            <span className="hmda-lender-modal-pullthrough-hero__side-sub">{fmtHmdaLarCount(nonOrig)} (apps − orig)</span>
          </div>
        </div>
      </Tp>

      <div className="hmda-lender-modal-lar-card">
        <div className="hmda-lender-modal-lar-card__head">
          <span className="hmda-lender-modal-lar-card__title">
            {isEstimated ? "Panel production (estimated apps)" : "Disposition breakdown"}
          </span>
          <span className="hmda-lender-modal-lar-card__year">
            {isEstimated ? `HMDA ${py}` : `LAR ${larY}`}
          </span>
        </div>
        {isEstimated ? (
          <p className="hmda-lender-modal-lar-card__note">
            {disposition.benchmarkOnly
              ? `Declinations and application counts estimated from HMDA panel benchmark until FFIEC LAR loads for this institution.`
              : `Application and declination counts estimated from panel disposition benchmark (HMDA ${disposition.dispositionYear}) until institution LAR loads.`}
          </p>
        ) : null}
        {!isEstimated && Number.isFinite(py) && larY && py > larY ? (
          <p className="hmda-lender-modal-lar-card__note">
            Panel <strong>{py}</strong> closed loans above; applications from FFIEC public LAR <strong>{larY}</strong>.
          </p>
        ) : null}
        <div className={`hmda-lender-modal-lar-card__grid${isMobile ? " hmda-lender-modal-lar-card__grid--mobile" : ""}`}>
          {cell(
            isEstimated ? "Applications (est.)" : "Applications",
            ta.toLocaleString(),
            isEstimated ? `Panel benchmark ${disposition.dispositionYear}` : `${larY} LAR rows`,
          )}
          {cell(
            panelOrigAhead || isEstimated ? "Originated (panel)" : "Originated",
            fmtHmdaLarCount(orig),
            pullPct !== "—" ? `${pullPct} pull-through` : fmtPct(orig, ta),
            "accent",
          )}
          {cell(
            isEstimated ? "Denied (est.)" : "Denied",
            fmtHmdaLarCount(disposition.denied),
            ta > 0 ? fmtPct(disposition.denied, ta) : null,
            "danger",
          )}
          {cell(
            isEstimated ? "Withdrawn (est.)" : "Withdrawn",
            fmtHmdaLarCount(disposition.withdrawn),
            ta > 0 ? fmtPct(disposition.withdrawn, ta) : null,
          )}
          {cell(
            isEstimated ? "Incomplete (est.)" : "Incomplete",
            fmtHmdaLarCount(disposition.incomplete ?? 0),
            ta > 0 ? fmtPct(disposition.incomplete ?? 0, ta) : null,
          )}
        </div>
        {(disposition.approvedNotAccepted ?? 0) > 0 ? (
          <div className="hmda-lender-modal-lar-card__fallout">
            {cell(
              isEstimated ? "Approved not accepted (est.)" : "Approved not accepted",
              fmtHmdaLarCount(disposition.approvedNotAccepted),
              ta > 0 ? fmtPct(disposition.approvedNotAccepted, ta) : null,
            )}
          </div>
        ) : null}
        <div className="hmda-lender-modal-lar-card__fallout">
          {cell(
            "Non-origination (apps − orig)",
            fmtHmdaLarCount(nonOrig),
            nonOrigPct !== "—" ? `${nonOrigPct} of applications` : null,
          )}
        </div>
      </div>
    </div>
  );
}

function HmdaModalLarDispositionSummary(props) {
  return <HmdaModalPipelinePanel {...props} />;
}

function HmdaModalPipelineNoLarFallback({ lender, c, isMobile }) {
  return <HmdaModalPipelinePanel lender={lender} panelYear={lender?.dataYear} c={c} isMobile={isMobile} />;
}

function HmdaInsightsPanel({ selected, c, isMobile, countyFipsNames, marketRef, Tip: TipComp }) {
  const h = selectHmdaInsightsForLenderRow(selected);
  if (!h) return null;
  const Tp = TipComp || (({ children }) => <>{children}</>);
  const peer = selected.hmdaPeer;
  const ta = h.totalApplications || 0;
  const actionOrder = ["1", "2", "3", "4", "5", "6", "7", "8"];
  const rows = actionOrder
    .map((code) => {
      const count = h.actionTaken?.[code] ?? 0;
      if (!count) return null;
      return { code, count, label: HMDA_ACTION_LABELS[code] || `Action ${code}`, pct: fmtPct(count, ta) };
    })
    .filter(Boolean);
  const denialEntriesRaw = Object.entries(h.denialReasons || {})
    .map(([code, count]) => ({
      code,
      count,
      label: HMDA_DENIAL_REASON_LABELS[String(code)] || `Code ${code}`,
    }))
    .sort((a, b) => b.count - a.count);
  const denialEntries = denialEntriesRaw.filter((d) => d.count >= HMDA_DRILL_SUPPRESS_MIN);
  const domLtFull = dominantLoanTypeFromInsights(h);
  const segFull = marketSegmentForYear(marketRef, selected.dataYear);
  const mktFull = domLtFull && segFull?.byLoanType ? segFull.byLoanType[domLtFull] : null;

  return (
    <div style={{ marginBottom: "14px", padding: isMobile ? "12px" : "14px 16px", borderRadius: "14px", background: c.drillBg, border: `1px solid ${c.drillBorder}` }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
        <Tp text={TIPS["HMDA outcomes"]} pos="bottom">
          <span style={{ fontSize: "10px", color: c.text3, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "help" }}>
            HMDA application outcomes ({h.reportingYear}) –
          </span>
        </Tp>
        <span style={{ fontSize: "9px", color: c.text4 }}>
          {ta.toLocaleString()} covered rows ·{" "}
          {h.liveFfiecClientMerged ? "Dispositions merged from live FFIEC Data Browser API. " : ""}
          Source: CFPB HMDA LAR
        </span>
      </div>

      {peer && (
        <div style={{ marginBottom: "12px", padding: "10px 12px", borderRadius: "10px", background: c.statBg, border: `1px solid ${c.drillBorder}` }}>
          <Tp text={TIPS["Peer benchmark"]} pos="bottom">
            <div style={{ fontSize: "9px", color: c.text3, fontWeight: 700, marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.04em", cursor: "help" }}>
              Panel distribution ({peer.panelSize} lenders, same year) –
            </div>
          </Tp>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3, 1fr)", gap: "8px", fontSize: "10px", color: c.text2 }}>
            {peer.denialRateBetterThanPct != null && (
              <div>
                <span style={{ color: c.text4 }}>Denial rate</span>
                <div style={{ fontWeight: 700, color: c.accent, lineHeight: 1.3 }}>
                  {peer.denialRateBetterThanPct}% of panel: higher denial rate
                </div>
              </div>
            )}
            {peer.withdrawalRateBetterThanPct != null && (
              <div>
                <span style={{ color: c.text4 }}>Withdrawal rate</span>
                <div style={{ fontWeight: 700, color: c.accent, lineHeight: 1.3 }}>
                  {peer.withdrawalRateBetterThanPct}% of panel: higher withdrawal rate
                </div>
              </div>
            )}
            {peer.originationShareBetterThanPct != null && (
              <div>
                <span style={{ color: c.text4 }}>Origination share</span>
                <div style={{ fontWeight: 700, color: c.accent, lineHeight: 1.3 }}>
                  {peer.originationShareBetterThanPct}% of panel: lower origination share
                </div>
              </div>
            )}
            {peer.medianSpreadBetterThanPct != null && (
              <div>
                <Tp text={TIPS["Rate spread (HMDA)"]} pos="top">
                  <span style={{ color: c.text4, cursor: "help" }}>Median rate spread (originated) –</span>
                </Tp>
                <div style={{ fontWeight: 700, color: c.accent, lineHeight: 1.3 }}>
                  {peer.medianSpreadBetterThanPct}% of panel: higher median spread
                </div>
              </div>
            )}
            {peer.medianTermBetterThanPct != null && (
              <div>
                <span style={{ color: c.text4 }}>Median term (originated)</span>
                <div style={{ fontWeight: 700, color: c.accent, lineHeight: 1.3 }}>
                  {peer.medianTermBetterThanPct}% of panel: lower median term
                </div>
              </div>
            )}
            {peer.incompleteRateBetterThanPct != null && (
              <div>
                <span style={{ color: c.text4 }}>Incomplete file rate</span>
                <div style={{ fontWeight: 700, color: c.accent, lineHeight: 1.3 }}>
                  {peer.incompleteRateBetterThanPct}% of panel: higher incomplete rate
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ fontSize: "10px", fontWeight: 700, color: c.text3, marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Action taken (all rows)</div>
      <div style={{ display: "grid", gap: "4px", marginBottom: "12px" }}>
        {rows.map((r) => (
          <div key={r.code} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "8px", alignItems: "center", fontSize: "11px" }}>
            <span style={{ color: c.text2 }}>{r.label}</span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>{r.count.toLocaleString()}</span>
            <span style={{ color: c.text4, fontSize: "10px" }}>{r.pct}</span>
          </div>
        ))}
      </div>

      {denialEntriesRaw.length > 0 && (
        <>
          <Tp text={TIPS["HMDA denial reasons"]} pos="bottom">
            <div style={{ fontSize: "10px", fontWeight: 700, color: c.text3, marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.04em", cursor: "help" }}>
              Denial reason codes (denied apps) –
            </div>
          </Tp>
          <div style={{ fontSize: "9px", color: c.text4, marginBottom: "6px", lineHeight: 1.4 }}>
            Reason rows with counts under {HMDA_DRILL_SUPPRESS_MIN} are suppressed in this view to reduce re-identification risk.
            {(h.denialReasonsSuppressedCount || 0) > 0 && (
              <span> Extract reports {h.denialReasonsSuppressedCount.toLocaleString()} such mentions aggregated.</span>
            )}
          </div>
          {denialEntries.length === 0 ? (
            <div style={{ fontSize: "10px", color: c.text3, marginBottom: "12px", lineHeight: 1.45 }}>
              All denial-reason counts are below {HMDA_DRILL_SUPPRESS_MIN} in this view; individual codes suppressed.
            </div>
          ) : (
            <div style={{ display: "grid", gap: "4px", marginBottom: "12px", maxHeight: "140px", overflowY: "auto" }}>
              {denialEntries.slice(0, 12).map((d) => (
                <div key={d.code} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "8px", fontSize: "10px" }}>
                  <span style={{ color: c.text2 }}>{d.label}</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>{d.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
        <div style={{ padding: "10px", borderRadius: "10px", background: c.statBg }}>
          <div style={{ fontSize: "9px", color: c.text4, marginBottom: "4px" }}>Originated loans — median rate spread</div>
          <div style={{ fontSize: "15px", fontWeight: 800, fontFamily: "'JetBrains Mono',monospace" }}>{h.originatedMedianRateSpread != null ? `${h.originatedMedianRateSpread}%` : "—"}</div>
          <div style={{ fontSize: "9px", color: c.text4 }}>n = {(h.spreadSampleSize || 0).toLocaleString()} (non-exempt)</div>
        </div>
        <div style={{ padding: "10px", borderRadius: "10px", background: c.statBg }}>
          <div style={{ fontSize: "9px", color: c.text4, marginBottom: "4px" }}>Originated loans — median term</div>
          <div style={{ fontSize: "15px", fontWeight: 800, fontFamily: "'JetBrains Mono',monospace" }}>{h.originatedMedianLoanTermMonths != null ? `${h.originatedMedianLoanTermMonths} mo` : "—"}</div>
          <div style={{ fontSize: "9px", color: c.text4 }}>n = {(h.termSampleSize || 0).toLocaleString()}</div>
        </div>
      </div>

      {mktFull && domLtFull && (h.originatedMedianRateSpread != null || h.originatedMedianLoanTermMonths != null) && (
        <div style={{ marginBottom: "12px", padding: "10px 12px", borderRadius: "10px", background: c.statBg, border: `1px solid ${c.drillBorder}` }}>
          <Tp text={TIPS["HMDA market segment"]} pos="bottom">
            <div style={{ fontSize: "10px", fontWeight: 700, color: c.text3, marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.04em", cursor: "help" }}>
              Versus national HMDA ({domLtFull}) –
            </div>
          </Tp>
          <div style={{ fontSize: "11px", color: c.text2, lineHeight: 1.45 }}>
            {h.originatedMedianRateSpread != null && mktFull.medianRateSpread != null && (
              <div>
                Median rate spread: this lender <strong style={{ fontFamily: "'JetBrains Mono',monospace" }}>{h.originatedMedianRateSpread}%</strong> · national {domLtFull}{" "}
                <strong style={{ fontFamily: "'JetBrains Mono',monospace" }}>{mktFull.medianRateSpread}%</strong>
              </div>
            )}
            {h.originatedMedianLoanTermMonths != null && mktFull.medianLoanTermMonths != null && (
              <div>
                Median term: this lender <strong style={{ fontFamily: "'JetBrains Mono',monospace" }}>{Math.round(h.originatedMedianLoanTermMonths)} mo</strong> · national{" "}
                <strong style={{ fontFamily: "'JetBrains Mono',monospace" }}>{Math.round(mktFull.medianLoanTermMonths)} mo</strong>
              </div>
            )}
          </div>
        </div>
      )}

      {h.quarterlyFromLar && h.quarterlyFromLar.length > 0 && (
        <div style={{ marginBottom: "12px" }}>
          <div style={{ fontSize: "10px", fontWeight: 700, color: c.text3, marginBottom: "6px", textTransform: "uppercase" }}>Quarterly (from LAR action date)</div>
          <div style={{ display: "grid", gap: "4px", maxHeight: "120px", overflowY: "auto" }}>
            {h.quarterlyFromLar.map((q) => (
              <div key={q.period} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "8px", fontSize: "10px" }}>
                <span style={{ color: c.text2 }}>{q.period}</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>Orig {q.originated?.toLocaleString?.() ?? q.originated}</span>
                <span style={{ color: c.text4, fontFamily: "'JetBrains Mono',monospace" }}>App {q.applications?.toLocaleString?.() ?? q.applications}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {h.monthlyFromLar && h.monthlyFromLar.length > 0 && (
        <div style={{ marginBottom: "12px" }}>
          <Tp text={TIPS["HMDA LAR timing"]} pos="bottom">
            <div style={{ fontSize: "10px", fontWeight: 700, color: c.text3, marginBottom: "6px", textTransform: "uppercase", cursor: "help" }}>
              Monthly (LAR action date) — originations –
            </div>
          </Tp>
          <HmdaMicroSpark
            values={h.monthlyFromLar.slice(-24).map((x) => x.originated || 0)}
            color={c.accent}
            w={isMobile ? 260 : 520}
            h={36}
          />
        </div>
      )}

      {h.stateBreakdown && h.stateBreakdown.length > 0 && (
        <div style={{ marginBottom: "12px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
            <div style={{ fontSize: "10px", fontWeight: 700, color: c.text3, textTransform: "uppercase" }}>States (top by originations)</div>
            {h.geographyHhiStates != null && (
              <Tp text={TIPS["HMDA state concentration"]} pos="bottom">
                <span style={{ fontSize: "9px", color: c.text4, cursor: "help" }}>
                  HHI {h.geographyHhiStates.toFixed(4)}
                  {h.topStateOriginationShare != null && ` · top state ${(h.topStateOriginationShare * 100).toFixed(1)}%`} –
                </span>
              </Tp>
            )}
          </div>
          <div style={{ display: "grid", gap: "4px", maxHeight: "160px", overflowY: "auto" }}>
            {h.stateBreakdown.slice(0, 15).map((s) => (
              <div key={s.state} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "8px", fontSize: "10px" }}>
                <span style={{ color: c.text2 }}>{STATE_NAMES[s.state] || s.state}</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>{(s.originated || 0).toLocaleString()} orig</span>
                <span style={{ color: c.text4, fontFamily: "'JetBrains Mono',monospace" }}>{(s.applications || 0).toLocaleString()} rows</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {h.topCounties && h.topCounties.length > 0 && (
        <div style={{ marginBottom: "12px" }}>
          <div style={{ fontSize: "10px", fontWeight: 700, color: c.text3, marginBottom: "6px", textTransform: "uppercase" }}>Top counties (by originated loans)</div>
          <div style={{ display: "grid", gap: "4px", maxHeight: "140px", overflowY: "auto" }}>
            {h.topCounties.map((co) => {
              const raw = String(co.countyCode || "").trim();
              const suffix3 = raw.length >= 5 ? raw.replace(/^\d{2}(\d{3})$/, "$1") || raw.slice(-3) : raw.padStart(3, "0");
              const ck = `${co.state}-${suffix3}`;
              const nm = countyFipsNames?.[ck] || countyFipsNames?.[`${co.state}-${raw.padStart(3, "0")}`];
              return (
                <div key={`${co.state}-${raw || suffix3}`} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "8px", fontSize: "10px" }}>
                  <span style={{ color: c.text2 }}>{nm || ck}</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>{co.originated.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {h.topMsas && h.topMsas.length > 0 && (
        <div style={{ marginBottom: "12px" }}>
          <div style={{ fontSize: "10px", fontWeight: 700, color: c.text3, marginBottom: "6px", textTransform: "uppercase" }}>Top MSAs (derived_msa_md)</div>
          <div style={{ display: "grid", gap: "4px" }}>
            {h.topMsas.map((m) => (
              <div key={m.msaCode} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "8px", fontSize: "10px" }}>
                <span style={{ color: c.text2, fontFamily: "'JetBrains Mono',monospace" }}>{m.msaCode}</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>{m.originated.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {h.loanTypeSummary && Object.keys(h.loanTypeSummary).length > 0 && (
        <div style={{ marginBottom: "12px" }}>
          <div style={{ fontSize: "10px", fontWeight: 700, color: c.text3, marginBottom: "6px", textTransform: "uppercase" }}>Loan type (HMDA loan_type)</div>
          <div style={{ display: "grid", gap: "4px", maxHeight: "120px", overflowY: "auto" }}>
            {Object.entries(h.loanTypeSummary)
              .sort((a, b) => (b[1].originated || 0) - (a[1].originated || 0))
              .map(([lt, v]) => (
                <div key={lt} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "6px", fontSize: "10px" }}>
                  <span style={{ color: c.text2 }}>{lt}</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{(v.originated || 0).toLocaleString()} orig</span>
                  <span style={{ color: c.text4, fontFamily: "'JetBrains Mono',monospace" }}>{fmtPct(v.originated, v.applications)} conv.</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {(Object.keys(h.lienOnOriginated || {}).length > 0 || Object.keys(h.hoepaOnOriginated || {}).length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px", marginBottom: "8px" }}>
          {Object.keys(h.lienOnOriginated || {}).length > 0 && (
            <div style={{ padding: "8px 10px", borderRadius: "10px", background: c.statBg, fontSize: "10px" }}>
              <div style={{ fontWeight: 700, color: c.text3, marginBottom: "4px" }}>Lien (originated)</div>
              {Object.entries(h.lienOnOriginated).map(([code, n]) => (
                <div key={code} style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                  <span style={{ color: c.text2 }}>{HMDA_LIEN_LABELS[code] || `Lien ${code}`}</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{n.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
          {Object.keys(h.hoepaOnOriginated || {}).length > 0 && (
            <div style={{ padding: "8px 10px", borderRadius: "10px", background: c.statBg, fontSize: "10px" }}>
              <div style={{ fontWeight: 700, color: c.text3, marginBottom: "4px" }}>HOEPA (originated)</div>
              {Object.entries(h.hoepaOnOriginated).map(([code, n]) => (
                <div key={code} style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                  <span style={{ color: c.text2 }}>Status {code}</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{n.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {(Object.keys(h.submissionOnApplications || {}).length > 0 || Object.keys(h.initiallyPayableOnApplications || {}).length > 0) && (
        <div style={{ fontSize: "10px", color: c.text2 }}>
          {Object.keys(h.submissionOnApplications || {}).length > 0 && (
            <div style={{ marginBottom: "6px" }}>
              <span style={{ fontWeight: 700, color: c.text3 }}>Submission of application: </span>
              {Object.entries(h.submissionOnApplications)
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ")}
            </div>
          )}
          {Object.keys(h.initiallyPayableOnApplications || {}).length > 0 && (
            <div>
              <span style={{ fontWeight: 700, color: c.text3 }}>Initially payable: </span>
              {Object.entries(h.initiallyPayableOnApplications)
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ")}
            </div>
          )}
        </div>
      )}

      {!h.quarterlyFromLar?.length && (
        <p style={{ fontSize: "9px", color: c.text4, margin: "10px 0 0", lineHeight: 1.4 }}>
          Quarterly timing from LAR requires <code style={{ fontSize: "8px" }}>action_taken_date</code> in your extract file. If absent, use the estimated quarterly chart below (annual HMDA).
        </p>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────
   THEMES
   ───────────────────────────────────────────────────── */
const TK = {
  dark: {
    bg:"#080c18",
    bgGrad:"radial-gradient(ellipse 120% 80% at 10% 0%, rgba(55,48,107,0.2) 0%, transparent 50%), radial-gradient(ellipse 100% 60% at 90% 100%, rgba(30,64,120,0.14) 0%, transparent 50%), radial-gradient(ellipse 70% 50% at 80% 20%, rgba(129,140,248,0.08) 0%, transparent 45%), radial-gradient(ellipse 50% 40% at 15% 85%, rgba(52,211,153,0.06) 0%, transparent 50%), #080c18",
    surface:"rgba(255,255,255,0.035)",surfaceHover:"rgba(255,255,255,0.065)",
    surfaceRaised:"rgba(255,255,255,0.055)",
    border:"rgba(255,255,255,0.07)",borderHover:"rgba(255,255,255,0.14)",borderAccent:"rgba(99,102,241,0.3)",
    text:"#e8eaed",text2:"rgba(255,255,255,0.6)",text3:"rgba(255,255,255,0.38)",text4:"rgba(255,255,255,0.2)",
    accent:"#818cf8",accent2:"#6366f1",accentSoft:"rgba(129,140,248,0.15)",accentSoft2:"rgba(99,102,241,0.1)",
    gradText:"linear-gradient(135deg, #818cf8 0%, #c084fc 100%)",
    gradBtn:"linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
    success:"#4ade80",successSoft:"rgba(74,222,128,0.12)",
    warning:"#fbbf24",warningSoft:"rgba(251,191,36,0.12)",
    danger:"#f87171",dangerSoft:"rgba(248,113,113,0.12)",
    info:"#818cf8",infoSoft:"rgba(129,140,248,0.12)",
    purple:"#c084fc",purpleSoft:"rgba(192,132,252,0.12)",
    cyan:"#22d3ee",cyanSoft:"rgba(34,211,238,0.1)",
    inputBg:"rgba(255,255,255,0.04)",inputBorder:"rgba(255,255,255,0.08)",
    chip:"rgba(255,255,255,0.05)",chipText:"rgba(255,255,255,0.5)",chipActive:"rgba(129,140,248,0.26)",
    nav:"rgba(255,255,255,0.04)",navBorder:"rgba(165,180,252,0.14)",
    statBg:"rgba(0,0,0,0.25)",barTrack:"rgba(255,255,255,0.07)",
    tag:"rgba(255,255,255,0.07)",tagText:"rgba(255,255,255,0.6)",
    modal:"rgba(12,15,30,0.97)",modalBorder:"rgba(255,255,255,0.1)",overlay:"rgba(0,0,0,0.06)",overlayLender:"rgba(0,0,0,0.52)",
    live:"rgba(74,222,128,0.1)",liveBorder:"rgba(74,222,128,0.25)",
    toggle:"rgba(255,255,255,0.06)",toggleIcon:"rgba(255,255,255,0.6)",
    divider:"rgba(255,255,255,0.06)",
    shadow:"0 8px 32px rgba(0,0,0,0.4)",shadowLg:"0 20px 60px rgba(0,0,0,0.5)",
    drillBg:"rgba(255,255,255,0.025)",drillBorder:"rgba(255,255,255,0.06)",
    scrollThumb:"rgba(255,255,255,0.1)",
    tipBg:"#1e2340",tipBorder:"rgba(255,255,255,0.12)",tipText:"rgba(255,255,255,0.85)",tipShadow:"0 8px 32px rgba(0,0,0,0.5)",
    tierTop:"#6BA3E8",tierTopSoft:"rgba(107,163,232,0.15)",tierTopBg:"rgba(107,163,232,0.06)",
    tierMid:"#F0C75E",tierMidSoft:"rgba(240,199,94,0.15)",tierMidBg:"rgba(240,199,94,0.06)",
    tierBot:"#4ade80",tierBotSoft:"rgba(74,222,128,0.15)",tierBotBg:"rgba(74,222,128,0.06)",
  },
  light: {
    bg:"#eef0f1",
    bgGrad:"radial-gradient(ellipse 100% 70% at 50% -15%, rgba(15,23,42,0.04) 0%, transparent 50%), radial-gradient(ellipse 80% 55% at 100% 100%, rgba(111,69,214,0.04) 0%, transparent 48%), #eef0f1",
    surface:"rgba(255,255,255,0.9)",surfaceHover:"rgba(255,255,255,0.97)",
    surfaceRaised:"rgba(255,255,255,0.95)",
    border:"rgba(15,23,42,0.08)",borderHover:"rgba(15,23,42,0.14)",borderAccent:"rgba(111,69,214,0.35)",
    text:"#0f172a",text2:"#334155",text3:"#64748b",text4:"#94a3b8",
    accent:"#5b4fcf",accent2:"#4338ca",accentSoft:"rgba(111,69,214,0.12)",accentSoft2:"rgba(111,69,214,0.06)",
    gradText:"linear-gradient(135deg, #5b4fcf 0%, #4338ca 100%)",
    gradBtn:"linear-gradient(135deg, #5b4fcf 0%, #4338ca 100%)",
    success:"#15803d",successSoft:"rgba(21,128,61,0.1)",
    warning:"#c2410c",warningSoft:"rgba(194,65,12,0.1)",
    danger:"#b91c1c",dangerSoft:"rgba(185,28,28,0.08)",
    info:"#0369a1",infoSoft:"rgba(3,105,161,0.1)",
    purple:"#6d28d9",purpleSoft:"rgba(109,40,217,0.1)",
    cyan:"#0e7490",cyanSoft:"rgba(14,116,144,0.08)",
    inputBg:"rgba(255,255,255,0.92)",inputBorder:"rgba(15,23,42,0.1)",
    chip:"rgba(15,23,42,0.05)",chipText:"#475569",chipActive:"rgba(99,102,241,0.07)",
    nav:"rgba(255,255,255,0.88)",navBorder:"rgba(15,23,42,0.08)",
    statBg:"rgba(15,23,42,0.04)",barTrack:"rgba(15,23,42,0.08)",
    tag:"rgba(15,23,42,0.06)",tagText:"#475569",
    modal:"rgba(255,255,255,0.98)",modalBorder:"rgba(15,23,42,0.1)",overlay:"rgba(15,23,42,0.04)",overlayLender:"rgba(255,255,255,0.05)",
    live:"rgba(21,128,61,0.1)",liveBorder:"rgba(21,128,61,0.22)",
    toggle:"rgba(15,23,42,0.06)",toggleIcon:"#64748b",
    divider:"rgba(15,23,42,0.08)",
    shadow:"0 8px 32px rgba(15,23,42,0.06)",shadowLg:"0 20px 50px rgba(15,23,42,0.08)",
    drillBg:"rgba(15,23,42,0.03)",drillBorder:"rgba(15,23,42,0.08)",
    scrollThumb:"rgba(15,23,42,0.2)",
    tipBg:"#ffffff",tipBorder:"rgba(15,23,42,0.09)",tipText:"#1e293b",tipShadow:"0 4px 20px rgba(15,23,42,0.1), 0 1px 4px rgba(15,23,42,0.06)",
    tierTop:"#5B8DEF",tierTopSoft:"rgba(59,130,246,0.14)",tierTopBg:"rgba(59,130,246,0.08)",
    tierMid:"#E8B84A",tierMidSoft:"rgba(232,184,74,0.14)",tierMidBg:"rgba(232,184,74,0.08)",
    tierBot:"#4CB648",tierBotSoft:"rgba(76,182,72,0.14)",tierBotBg:"rgba(76,182,72,0.08)",
  }
};

/* ─────────────────────────────────────────────────────
   ICONS (minimal SVG)
   ───────────────────────────────────────────────────── */
const mk = (d, w = 20, sw = 1.65) => <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{d}</svg>;
const IC = {
  search: mk(<><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>, 18, 2),
  building: mk(
    <>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M9 22v-3h6v3" />
    </>,
    20,
    1.65
  ),
  globe: mk(<><circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="4" ry="10"/><line x1="2" y1="12" x2="22" y2="12"/></>),
  chart: mk(
    <>
      <path d="M3 3v18h18" />
      <path d="M7 16v-5" />
      <path d="M12 16V8" />
      <path d="M17 16v-9" />
    </>,
    20,
    1.65
  ),
  shield: mk(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>),
  refresh: mk(<><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></>,16,2),
  up: mk(<><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></>,14,2.5),
  down: mk(<><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></>,14,2.5),
  database: mk(
    <>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v6c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      <path d="M3 12v7c0 1.66 4 3 9 3s9-1.34 9-3v-7" />
    </>,
    20,
    1.65
  ),
  layers: mk(<><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></>),
  map: mk(
    <>
      <path d="M3 6 9 3 15 6 21 3v15l-6 3-6-3-6 3V6" />
      <path d="M9 3v15" />
      <path d="M15 6v15" />
    </>,
    20,
    1.65
  ),
  filter: mk(<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>,16,2),
  x: mk(<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,14,2.5),
  ext: mk(<><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></>,13,2),
  chevRight: mk(<polyline points="9 18 15 12 9 6"/>,16,2),
  chevDown: mk(<polyline points="6 9 12 15 18 9"/>,16,2),
  back: mk(<><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></>,18,2),
  users: mk(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>),
  target: mk(<><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></>),
  rate: mk(<><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>,16,2),
  dollar: mk(<><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>,14,2),
  trend: mk(<><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></>,16,2),
  home: mk(<><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>,14,2),
  key: mk(<><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></>,14,2),
  percent: mk(<><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></>,14,2),
  credit: mk(<><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></>,14,2),
  mapPin: mk(<><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></>,14,2),
  activity: mk(<><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></>,14,2),
  zap: mk(<><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></>,14,2),
  /** Guided product tour — compass needle (not sparkles / “new” metaphor) */
  tour: mk(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7l4 5-4 5-4-5 4-5z" />
    </>,
    16,
    2
  ),
  sparkles: mk(
    <>
      <path d="M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
      <circle cx="12" cy="12" r="2.5" />
    </>,
    17,
    1.55
  ),
};

/** Header rail: slightly larger strokes (Lucide-like) for icon + label clusters */
const icHeader = (d) => mk(d, 18, 2);
const IC_HEADER = {
  home: icHeader(
    <>
      <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </>,
  ),
  compass: icHeader(
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z" />
    </>,
  ),
};

/** Pastel icon well for main nav + mobile menu tabs */
function HmdaTabIconWell({ tabId, dark, children }) {
  const P = {
    lenders: dark ? { bg: "rgba(129,140,248,0.24)", fg: "#c4b5fd" } : { bg: "rgba(199,210,254,0.52)", fg: "#4338ca" },
    products: dark ? { bg: "rgba(52,211,153,0.2)", fg: "#6ee7b7" } : { bg: "rgba(187,247,208,0.5)", fg: "#047857" },
    geography: dark ? { bg: "rgba(56,189,248,0.22)", fg: "#7dd3fc" } : { bg: "rgba(186,230,253,0.55)", fg: "#0369a1" },
  };
  const p = P[tabId] || P.lenders;
  return (
    <span
      className="hmda-tab-icon-well"
      style={{
        width: 32,
        height: 32,
        borderRadius: 11,
        background: p.bg,
        color: p.fg,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        boxShadow: dark ? "inset 0 1px 0 rgba(255,255,255,0.07)" : "inset 0 1px 0 rgba(255,255,255,0.7)",
      }}
    >
      {children}
    </span>
  );
}

/**
 * Track-record panel: multi-year LEI time series shown when user opts in from search bar.
 * Pure presentational; data + scope state computed by parent so memoization works.
 */
function HmdaLenderTrackRecordPanel({
  lender,
  rows,
  scopedRows,
  totals,
  range,
  onRangeChange,
  availableYears,
  onClose,
  onPin,
  isPinned,
  pinDisabled,
  maxPins,
  onOpenMap,
  onOpenProfile,
  c,
  isMobile,
}) {
  const lenderYears = (rows || []).map((r) => r.year).sort((a, b) => a - b);
  const minYear = lenderYears[0];
  const maxYear = lenderYears[lenderYears.length - 1];
  const noData = !rows || rows.length === 0;

  const sparkPath = useMemo(() => {
    if (!scopedRows || scopedRows.length === 0) return null;
    const w = 280;
    const h = 60;
    const xs = scopedRows.map((r) => r.year);
    const vs = scopedRows.map((r) => r.units);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minV = 0;
    const maxV = Math.max(1, ...vs);
    const dx = maxX === minX ? 1 : maxX - minX;
    const dv = maxV - minV || 1;
    const pts = scopedRows.map((r) => {
      const x = ((r.year - minX) / dx) * (w - 12) + 6;
      const y = h - 6 - ((r.units - minV) / dv) * (h - 12);
      return [x, y];
    });
    const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
    const area = `${line} L ${pts[pts.length - 1][0].toFixed(1)} ${h - 6} L ${pts[0][0].toFixed(1)} ${h - 6} Z`;
    return { line, area, pts, w, h };
  }, [scopedRows]);

  const peak = totals?.peakYearRow;
  const denialPct = totals?.denialRate != null ? (totals.denialRate * 100).toFixed(1) + "%" : "—";

  return (
    <div
      className="hmda-track-record-overlay"
      role="dialog"
      aria-label={`Track record for ${lender?.name || "lender"}`}
      style={{
        position: "fixed",
        top: isMobile ? 76 : 180,
        left: "50%",
        transform: "translateX(-50%)",
        width: isMobile ? "calc(100% - 20px)" : "min(720px, calc(100vw - 32px))",
        maxHeight: "min(640px, calc(100vh - 120px))",
        background: c.surface,
        border: `1px solid ${c.border}`,
        borderRadius: 18,
        boxShadow: "0 24px 64px rgba(15,23,42,0.22), 0 4px 12px rgba(15,23,42,0.08)",
        zIndex: 1500,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        animation: "rise 0.22s ease",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "14px 18px",
          borderBottom: `1px solid ${c.border}`,
          background: `linear-gradient(180deg, ${c.chip} 0%, transparent 100%)`,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: c.text4,
              marginBottom: 2,
            }}
          >
            Lender track record
          </div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: c.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {lender?.name}
          </div>
          <div style={{ fontSize: 11, color: c.text3, marginTop: 2 }}>
            HMDA {minYear ?? "—"}{minYear !== maxYear ? `–${maxYear ?? ""}` : ""} · {rows?.length || 0} reporting year
            {(rows?.length || 0) === 1 ? "" : "s"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <button
            type="button"
            onClick={onPin}
            disabled={pinDisabled}
            style={{
              border: `1px solid ${c.border}`,
              background: isPinned ? c.chipActive : c.surface,
              color: isPinned ? c.accent : c.text2,
              padding: "7px 10px",
              borderRadius: 9,
              fontSize: 11,
              fontWeight: 700,
              cursor: pinDisabled ? "not-allowed" : "pointer",
              opacity: pinDisabled ? 0.5 : 1,
            }}
            title={pinDisabled ? `Maximum ${maxPins} lenders pinned` : isPinned ? "Pinned" : "Pin to compare"}
          >
            {isPinned ? "Pinned" : "Pin"}
          </button>
          <button
            type="button"
            onClick={onOpenMap}
            style={{
              border: `1px solid ${c.border}`,
              background: c.surface,
              color: c.text2,
              padding: "7px 10px",
              borderRadius: 9,
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
            }}
            title="Open on geography map"
          >
            Map
          </button>
          <button
            type="button"
            onClick={onOpenProfile}
            style={{
              border: `1px solid ${c.border}`,
              background: c.surface,
              color: c.text2,
              padding: "7px 10px",
              borderRadius: 9,
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
            }}
            title="Open lender profile"
          >
            Profile
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close track record"
            style={{
              border: "none",
              background: c.chip,
              color: c.text2,
              width: 30,
              height: 30,
              borderRadius: 9,
              cursor: "pointer",
              fontSize: 14,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ×
          </button>
        </div>
      </header>

      <div
        style={{
          padding: "12px 18px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          borderBottom: `1px solid ${c.border}`,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", color: c.text3, textTransform: "uppercase" }}>
          Scope
        </span>
        <button
          type="button"
          onClick={() => onRangeChange({ mode: "all", start: null, end: null })}
          style={{
            border: `1px solid ${c.border}`,
            background: range.mode === "all" ? c.chipActive : c.surface,
            color: range.mode === "all" ? c.accent : c.text2,
            padding: "6px 12px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          All years
        </button>
        <button
          type="button"
          onClick={() =>
            onRangeChange({
              mode: "range",
              start: range.start || (minYear ? String(minYear) : null),
              end: range.end || (maxYear ? String(maxYear) : null),
            })
          }
          style={{
            border: `1px solid ${c.border}`,
            background: range.mode === "range" ? c.chipActive : c.surface,
            color: range.mode === "range" ? c.accent : c.text2,
            padding: "6px 12px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Year range
        </button>
        {range.mode === "range" && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <select
              value={String(range.start ?? "")}
              onChange={(e) => onRangeChange({ ...range, mode: "range", start: e.target.value })}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: `1px solid ${c.border}`,
                background: c.surface,
                color: c.text2,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {availableYears.map((y) => (
                <option key={`s-${y}`} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <span style={{ color: c.text3, fontSize: 11 }}>to</span>
            <select
              value={String(range.end ?? "")}
              onChange={(e) => onRangeChange({ ...range, mode: "range", end: e.target.value })}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: `1px solid ${c.border}`,
                background: c.surface,
                color: c.text2,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {availableYears.map((y) => (
                <option key={`e-${y}`} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {noData ? (
        <div style={{ padding: 32, textAlign: "center", color: c.text3, fontSize: 13 }}>
          No multi-year HMDA records loaded for this LEI yet.
        </div>
      ) : (
        <div style={{ padding: "14px 18px 18px", overflowY: "auto" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)",
              gap: 10,
              marginBottom: 14,
            }}
          >
            {[
              { label: "Originations", value: fmtUnits(totals.units), hint: `${scopedRows.length} yr` },
              { label: "Total volume", value: fmtDollar(totals.volume), hint: "scoped" },
              { label: "Denial rate", value: denialPct, hint: `${fmtUnits(totals.applications)} apps` },
              {
                label: "Peak year",
                value: peak ? String(peak.year) : "—",
                hint: peak ? `${fmtUnits(peak.units)} orig.` : "",
              },
            ].map((m) => (
              <div
                key={m.label}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  background: c.chip,
                  border: `1px solid ${c.border}`,
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", color: c.text4, textTransform: "uppercase" }}>
                  {m.label}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: c.text, marginTop: 2 }}>{m.value}</div>
                {m.hint ? <div style={{ fontSize: 10, color: c.text3, marginTop: 1 }}>{m.hint}</div> : null}
              </div>
            ))}
          </div>

          {sparkPath ? (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: c.text3, marginBottom: 6, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                Originations by year
              </div>
              <div style={{ background: c.chip, borderRadius: 10, padding: "8px 12px", border: `1px solid ${c.border}` }}>
                <svg width="100%" height={sparkPath.h} viewBox={`0 0 ${sparkPath.w} ${sparkPath.h}`} preserveAspectRatio="none" style={{ display: "block" }}>
                  <path d={sparkPath.area} fill={c.accent} opacity={0.18} />
                  <path d={sparkPath.line} fill="none" stroke={c.accent} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                  {sparkPath.pts.map((p, i) => (
                    <circle key={i} cx={p[0]} cy={p[1]} r={2.4} fill={c.accent} />
                  ))}
                </svg>
              </div>
            </div>
          ) : null}

          <div style={{ borderRadius: 10, overflow: "hidden", border: `1px solid ${c.border}` }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: c.chip }}>
                  {["Year", "Units", "Volume", "Apps", "Denied", "Deny rate"].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: h === "Year" ? "left" : "right",
                        padding: "8px 10px",
                        fontSize: 10,
                        fontWeight: 800,
                        color: c.text3,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        borderBottom: `1px solid ${c.border}`,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scopedRows.map((r) => (
                  <tr key={r.year}>
                    <td style={{ padding: "8px 10px", fontWeight: 700, color: c.text2 }}>{r.year}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", color: c.text2 }}>{fmtUnits(r.units)}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", color: c.text2 }}>{fmtDollar(r.volume)}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", color: c.text3 }}>
                      {r.applications ? fmtUnits(r.applications) : "—"}
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "right", color: c.text3 }}>
                      {r.denials ? fmtUnits(r.denials) : "—"}
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "right", color: c.text3 }}>
                      {r.denialRate != null ? `${(r.denialRate * 100).toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function lenderMetricPalette(tone, dk) {
  const P = {
    violet: dk
      ? { bg: "rgba(129,140,248,0.18)", fg: "#a5b4fc", b: "rgba(165,180,252,0.22)", chip: "rgba(255,255,255,0.08)" }
      : { bg: "rgba(237,242,255,0.92)", fg: "#4338ca", b: "rgba(129,140,248,0.2)", chip: "rgba(255,255,255,0.88)" },
    mint: dk
      ? { bg: "rgba(52,211,153,0.15)", fg: "#6ee7b7", b: "rgba(52,211,153,0.2)", chip: "rgba(255,255,255,0.08)" }
      : { bg: "rgba(220,252,231,0.88)", fg: "#047857", b: "rgba(16,185,129,0.22)", chip: "rgba(255,255,255,0.82)" },
    sky: dk
      ? { bg: "rgba(56,189,248,0.15)", fg: "#7dd3fc", b: "rgba(56,189,248,0.2)", chip: "rgba(255,255,255,0.08)" }
      : { bg: "rgba(224,242,254,0.92)", fg: "#0369a1", b: "rgba(14,165,233,0.22)", chip: "rgba(255,255,255,0.85)" },
    rose: dk
      ? { bg: "rgba(244,114,182,0.14)", fg: "#f9a8d4", b: "rgba(244,114,182,0.2)", chip: "rgba(255,255,255,0.08)" }
      : { bg: "rgba(252,231,243,0.9)", fg: "#be185d", b: "rgba(244,114,182,0.22)", chip: "rgba(255,255,255,0.85)" },
    amber: dk
      ? { bg: "rgba(250,204,21,0.12)", fg: "#fcd34d", b: "rgba(250,204,21,0.18)", chip: "rgba(255,255,255,0.08)" }
      : { bg: "rgba(254,243,199,0.9)", fg: "#b45309", b: "rgba(245,158,11,0.22)", chip: "rgba(255,255,255,0.85)" },
    lilac: dk
      ? { bg: "rgba(167,139,250,0.14)", fg: "#c4b5fd", b: "rgba(167,139,250,0.2)", chip: "rgba(255,255,255,0.08)" }
      : { bg: "rgba(245,243,255,0.95)", fg: "#6d28d9", b: "rgba(139,92,246,0.2)", chip: "rgba(255,255,255,0.9)" },
    slate: dk
      ? { bg: "rgba(148,163,184,0.14)", fg: "#cbd5e1", b: "rgba(148,163,184,0.2)", chip: "rgba(255,255,255,0.08)" }
      : { bg: "rgba(241,245,249,0.95)", fg: "#475569", b: "rgba(100,116,139,0.2)", chip: "rgba(255,255,255,0.9)" },
    /** Intelligence cockpit — neutral slate tiles (no mint/violet wash) */
    exec: dk
      ? { bg: "rgba(148,163,184,0.1)", fg: "#94a3b8", b: "rgba(148,163,184,0.16)", chip: "rgba(255,255,255,0.05)" }
      : { bg: "rgba(248,250,252,0.98)", fg: "#64748b", b: "rgba(15,23,42,0.06)", chip: "#ffffff" },
  };
  return P[tone] || P.violet;
}

/** Pastel metric tile for lender grid cards */
function LenderCardMetric({ dk, tone, icon, label, value, tip, Tip: TipComp, compact, valueFs, alignEnd = false, iconTint, variant = "boxed" }) {
  const Tp = TipComp || (({ children }) => <>{children}</>);
  if (variant === "clean") {
    const inner = (
      <div className={`hmda-lcard-metric-clean${alignEnd ? " hmda-lcard-metric-clean--end" : ""}`}>
        <div className="hmda-lcard-metric-clean__label">{label}</div>
        <div className="hmda-lcard-metric-clean__value" style={valueFs ? { fontSize: valueFs } : undefined}>
          {value}
        </div>
      </div>
    );
    return tip ? (
      <Tp text={tip} pos="bottom">
        {inner}
      </Tp>
    ) : (
      inner
    );
  }
  const p = lenderMetricPalette(tone, dk);
  const iconBox = compact ? 30 : 36;
  const pad = compact ? "8px 10px" : "10px 14px";
  const labFs = compact ? "8px" : "10px";
  const valFs = valueFs || (compact ? "14px" : "16px");
  const iconClass = iconTint ? `hmda-lmetric-icon hmda-lmetric-icon--${iconTint}` : undefined;
  const inner = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? 8 : 10,
        padding: pad,
        borderRadius: compact ? 12 : 14,
        background: p.bg,
        border: `1px solid ${p.b}`,
        minWidth: 0,
        flex: compact ? "1 1 auto" : "1 1 0%",
      }}
    >
      <span
        className={iconClass}
        style={{
          width: iconBox,
          height: iconBox,
          borderRadius: compact ? 9 : 11,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: p.chip,
          color: p.fg,
          flexShrink: 0,
          boxShadow: dk ? "inset 0 1px 0 rgba(255,255,255,0.06)" : "inset 0 1px 0 #fff",
        }}
      >
        {icon}
      </span>
      <div style={{ minWidth: 0, flex: 1, textAlign: alignEnd ? "right" : "left" }}>
        <div
          style={{
            fontSize: labFs,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: dk ? "rgba(255,255,255,0.42)" : tone === "exec" ? "#94a3b8" : "rgba(30,58,82,0.55)",
            marginBottom: 1,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: valFs,
            fontWeight: 800,
            fontFamily: "'JetBrains Mono',monospace",
            color: dk ? "#f8fafc" : "#0f172a",
            lineHeight: 1.15,
          }}
        >
          {value}
        </div>
      </div>
    </div>
  );
  return tip ? (
    <Tp text={tip} pos="bottom">
      {inner}
    </Tp>
  ) : (
    inner
  );
}

/** Grid card: one centered row — states/avg/spread/CLTV/DTI + HMDA apps/deny/wd/funded (compact type). */
function HmdaGridCardStatBand({ lender, c, dk = false, Tip: TipComp, isMobile = false, cockpitVisual = false, denseWide = false, marginBottom = 8, onViewDetails = null }) {
  const Tp = TipComp || (({ children }) => <>{children}</>);
  const h = selectHmdaInsightsForLenderRow(lender);
  const avgLoan =
    lender.originations > 0 ? fmtDollar(Math.round(lender.dollarVol / lender.originations)) : "—";

  // Use real HMDA median interest rate when available (present for most lenders)
  const medianRate = h?.originatedMedianInterestRate != null && Number.isFinite(Number(h.originatedMedianInterestRate))
    ? `${Number(h.originatedMedianInterestRate).toFixed(3)}%`
    : null;

  // Prefer real HMDA medians; fall back to legacy values only if not the 620/97/50 placeholder
  const spreadVal = fmtMedianRateSpread(lender);
  const cltvVal = fmtMedianCltvCell(lender);
  const dtiVal = fmtMedianDtiCell(lender);

  const cellBg = cockpitVisual ? "transparent" : dk ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.75)";
  const cellBd = cockpitVisual ? "transparent" : c.drillBorder;

  const micro = (key, label, value, tip, highlight = false, footer = null) => (
    <Tp key={key} text={tip} pos="bottom">
      <div
        className={cockpitVisual ? "hmda-lcard-stat-clean" : undefined}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          gap: cockpitVisual ? 3 : 2,
          minWidth: 0,
          padding: cockpitVisual ? "2px 0" : "5px 8px",
          borderRadius: cockpitVisual ? 0 : 9,
          background: cellBg,
          border: cockpitVisual ? "none" : `1px solid ${cellBd}`,
          cursor: tip ? "help" : "default",
        }}
      >
        <span
          style={{
            fontSize: cockpitVisual ? 9 : 8,
            fontWeight: 500,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: cockpitVisual ? (dk ? "rgba(255,255,255,0.45)" : "#94a3b8") : cockpitVisual && highlight ? c.text3 : highlight ? c.accent : c.text3,
            lineHeight: 1,
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: cockpitVisual ? 13 : 11,
            fontWeight: 500,
            fontFamily: "var(--font-mono)",
            color:
              cockpitVisual
                ? value === "—"
                  ? (dk ? "rgba(255,255,255,0.35)" : "#94a3b8")
                  : (dk ? "#f8fafc" : "#0f172a")
                : cockpitVisual && highlight
                  ? value === "—"
                    ? c.text4
                    : c.text2
                  : highlight
                    ? c.accent
                    : value === "—"
                      ? c.text4
                      : c.text2,
            lineHeight: 1.15,
            opacity: value === "—" ? 0.6 : 1,
          }}
        >
          {value}
        </span>
        {footer}
      </div>
    </Tp>
  );

  const hasFdicNcua = lender?.branchSource?.startsWith("FDIC") || lender?.branchSource?.startsWith("NCUA");
  const branchVal = fmtBranchSitesCell(lender);
  const branchLabel = hasFdicNcua ? "Branches" : "Counties";

  const pieces = [
    // Branches / Counties — show when real data or HMDA county proxy exists
    ...(branchVal !== "—" ? [micro("co", branchLabel, branchVal, TIPS.branches)] : []),
    micro("st", "States", String(lender.states), TIPS.states),
    micro("avg", "Avg loan", avgLoan, TIPS.avgLoanSize),
    // Show median rate (real HMDA data) instead of always-blank FICO/CLTV/DTI
    ...(medianRate
      ? [micro("mr", "Med Rate", medianRate, TIPS["Current Rate"], true)]
      : []),
    // Show Rate Spread / CLTV / DTI only when real data exists
    ...(spreadVal !== "—" ? [micro("sp", "Spread", spreadVal, TIPS.rateSpread)] : []),
    ...(cltvVal !== "—" ? [micro("ltv", "CLTV", cltvVal, TIPS.maxLtv)] : []),
    ...(dtiVal !== "—" ? [micro("dti", "DTI", dtiVal, TIPS.maxDti)] : []),
  ];
  if (h && (h.totalApplications || 0) > 0) {
    const ta = h.totalApplications;
    pieces.push(
      micro("ap", "Apps", ta.toLocaleString(), TIPS.hmdaApps),
      micro("dn", "Deny", ta > 0 ? fmtHmdaLarCount(h.denialCount ?? 0) : "—", TIPS.hmdaDeny),
      micro("wd", "W/D", ta > 0 ? fmtHmdaLarCount(h.withdrawalCount ?? 0) : "—", TIPS.hmdaWd),
      micro("fd", "Funded", ta > 0 ? fmtHmdaLarCount(h.totalOriginated ?? 0) : "—", TIPS.hmdaOrigShr)
    );
  }
  const withSep = pieces;
  return (
    <>
      <div
        className="hmda-grid-card-stat-band"
        style={{
          display: "grid",
          gridTemplateColumns: isMobile
            ? "repeat(2, minmax(0, 1fr))"
            : denseWide
              ? "repeat(auto-fill, minmax(88px, 1fr))"
              : cockpitVisual
                ? "repeat(4, minmax(0, 1fr))"
                : "repeat(5, minmax(0, 1fr))",
          alignItems: "stretch",
          gap: cockpitVisual ? "8px 16px" : "5px 6px",
          marginBottom: onViewDetails ? 0 : marginBottom,
          padding: cockpitVisual ? "8px 0 4px" : "8px 10px",
          borderRadius: cockpitVisual ? 0 : 10,
          background: cockpitVisual ? "transparent" : dk ? "rgba(255,255,255,0.04)" : "rgba(15,23,42,0.05)",
          border: cockpitVisual ? "none" : `1px solid ${c.drillBorder}`,
        }}
      >
        {withSep}
      </div>
      {onViewDetails && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom, paddingTop: 4 }}>
          <button
            type="button"
            onClick={onViewDetails}
            style={{
              padding: "3px 0",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: dk ? "rgba(255,255,255,0.55)" : c.text3,
              background: "none",
              border: "none",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              transition: "color 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = dk ? "rgba(255,255,255,0.9)" : c.text2; }}
            onMouseLeave={e => { e.currentTarget.style.color = dk ? "rgba(255,255,255,0.55)" : c.text3; }}
          >
            View details <span aria-hidden style={{ fontSize: 11 }}>→</span>
          </button>
        </div>
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────
   CENSUS TRACT POSITION HASH
   ───────────────────────────────────────────────────── */
function fipsHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Max SVG circles for national census-tract layer (sorted by volume). */
const CENSUS_TRACT_MAP_DOT_CAP = 6000;

/* ─────────────────────────────────────────────────────
   THEME CONTEXT — shared with Tip / FilterDropdown
   ───────────────────────────────────────────────────── */
const HmdaThemeCtx = createContext({ c: {}, dk: false });

function Tip({ children, text, pos = "bottom", maxW = 280 }) {
  const { c } = useContext(HmdaThemeCtx);
  const [show, setShow] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const [finalX, setFinalX] = useState(null);
  const ref = useRef(null);
  const tipRef = useRef(null);
  const tm = useRef(null);

  const enter = () => { tm.current = setTimeout(() => setShow(true), 320); };
  const leave = () => { clearTimeout(tm.current); setShow(false); setAnchorRect(null); setFinalX(null); };

  useEffect(() => {
    if (show && ref.current) {
      setAnchorRect(ref.current.getBoundingClientRect());
      setFinalX(null);
    }
  }, [show]);

  // After tooltip renders, clamp X within viewport
  useLayoutEffect(() => {
    if (show && tipRef.current && anchorRect) {
      const tip = tipRef.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const margin = 14;
      let x = anchorRect.left + anchorRect.width / 2;
      if (x - tip.width / 2 < margin) x = tip.width / 2 + margin;
      if (x + tip.width / 2 > vw - margin) x = vw - tip.width / 2 - margin;
      setFinalX(x);
    }
  }, [show, anchorRect]);

  if (!text) return children;

  const tipX = finalX ?? (anchorRect ? anchorRect.left + anchorRect.width / 2 : -9999);
  const tipY = anchorRect ? (pos === "bottom" ? anchorRect.bottom + 10 : anchorRect.top - 10) : 0;

  // Portal to document.body so backdrop-filter stacking context doesn't clip us
  const tooltip = show && anchorRect ? createPortal(
    <span
      ref={tipRef}
      style={{
        position: "fixed",
        left: `${tipX}px`,
        top: pos === "bottom" ? `${tipY}px` : "auto",
        bottom: pos === "top" ? `${window.innerHeight - tipY}px` : "auto",
        transform: "translateX(-50%)",
        zIndex: 2147483647,
        pointerEvents: "none",
        maxWidth: `${maxW}px`,
        width: "max-content",
        padding: "8px 12px",
        borderRadius: "8px",
        background: c.tipBg,
        border: `1px solid ${c.tipBorder}`,
        boxShadow: c.tipShadow,
        color: c.tipText,
        fontSize: "11.5px",
        fontWeight: 450,
        lineHeight: 1.55,
        letterSpacing: "0.01em",
        fontFamily: "'Inter','Plus Jakarta Sans',sans-serif",
        animation: "tipInDown 0.15s ease",
      }}
    >{text}</span>,
    document.body
  ) : null;

  return (
    <span ref={ref} onMouseEnter={enter} onMouseLeave={leave} style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      {children}
      {tooltip}
    </span>
  );
}

const HMDA_FILTER_MENU_Z = 10050;

function FilterDropdown({ id, label, displayValue, open, onToggle, children, hasActive = false, displayClassName = "", minimal = false }) {
  const { c, dk } = useContext(HmdaThemeCtx);
  const anchorRef = useRef(null);
  const [menuPos, setMenuPos] = useState(null);

  const updateMenuPos = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, left: rect.left, minWidth: Math.max(rect.width, 120) });
  }, []);

  useLayoutEffect(() => {
    if (!open) { setMenuPos(null); return; }
    updateMenuPos();
    window.addEventListener("resize", updateMenuPos);
    window.addEventListener("scroll", updateMenuPos, true);
    return () => {
      window.removeEventListener("resize", updateMenuPos);
      window.removeEventListener("scroll", updateMenuPos, true);
    };
  }, [open, updateMenuPos, displayValue]);

  const menuPanel =
    open && menuPos && typeof document !== "undefined"
      ? createPortal(
          <div
            role="listbox"
            data-hmda-filter-menu
            className="hmda-filter-menu-portal"
            style={{
              position: "fixed", top: menuPos.top, left: menuPos.left,
              minWidth: menuPos.minWidth, padding: "8px", borderRadius: "12px",
              background: c.surface, border: `1px solid ${c.border}`,
              boxShadow: dk ? "0 12px 32px rgba(0,0,0,0.35)" : "0 12px 28px rgba(15,23,42,0.14)",
              zIndex: HMDA_FILTER_MENU_Z, maxHeight: "min(320px, calc(100vh - 24px))",
              overflowY: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={anchorRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        aria-label={`${label}: ${displayValue}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={(e) => { e.stopPropagation(); onToggle(open ? null : id); }}
        className="filter-group"
        style={{
          display: "inline-flex", alignItems: "center",
          gap: minimal ? "5px" : "8px",
          padding: minimal ? "7px 10px" : "10px 14px",
          borderRadius: minimal ? "9px" : "10px",
          border: `1px solid ${open ? c.borderHover : c.inputBorder}`,
          background: open ? c.surfaceRaised : c.inputBg,
          cursor: "pointer", fontSize: minimal ? "12px" : "13px",
          fontFamily: "inherit",
          color: hasActive ? c.accent : c.text2,
          transition: "all 0.2s ease",
          boxShadow: open ? (dk ? "0 8px 24px rgba(0,0,0,0.2)" : "0 8px 20px rgba(15,23,42,0.08)") : "none",
          whiteSpace: "nowrap",
        }}
      >
        {!minimal ? (
          <span className="hmda-label" style={{ fontSize: "10px", letterSpacing: "0.06em", textTransform: "uppercase", color: c.text4 }}>
            {label}
          </span>
        ) : null}
        <span className={`${displayClassName || ""} hmda-heading-2`.trim()} style={{ fontWeight: 700 }}>
          {displayValue}
        </span>
        <span style={{ opacity: 0.55, transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s", fontSize: minimal ? 11 : 12 }}>▾</span>
      </button>
      {menuPanel}
    </div>
  );
}

/* ─────────────────────────────────────────────────────
   MAIN COMPONENT
   ───────────────────────────────────────────────────── */
export default function App({ onCanvasReady, onHeroReady, initialTab, embedMode = false } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const sprinkleUi = useHmdaSprinkle();
  const { maxComparePins } = useHmdaAuth();
  const maxPinnedLenders = HMDA_PREMIUM_PINS_UNLIMITED ? 99 : maxComparePins;
  const LENDER_PAGE_SIZE = 12;
  const PAGE_SIZE = 20;
  const DEPLOY_TAG = "2026-02-17T18:11Z";
  const [theme, setTheme] = useState("light");
  const [LENDERS, setLENDERS] = useState([]);
  const [lenderManifest, setLenderManifest] = useState(null);
  const [lenderQuery, setLenderQuery] = useState({ lenders: [], total: 0, totalPages: 1, page: 0, loading: false, fetched: false });
  const [productSummaryData, setProductSummaryData] = useState(null);
  const [productSummaryLoading, setProductSummaryLoading] = useState(false);
  const [productDrillQuery, setProductDrillQuery] = useState({ members: [], total: 0, totalPages: 1, loading: false });
  const [suggestLenders, setSuggestLenders] = useState([]);
  const [AVAILABLE_YEARS, setAVAILABLE_YEARS] = useState(AVAILABLE_YEARS_DEFAULT);
  /** Years with at least one lender row from FFIEC (subset of AVAILABLE_YEARS). */
  const [yearsWithData, setYearsWithData] = useState([]);
  const [hmdaYearsManifest, setHmdaYearsManifest] = useState(null);
  const [geoDrilldownHmda, setGeoDrilldownHmda] = useState(null);
  const [geoDrilldownLoading, setGeoDrilldownLoading] = useState(false);
  const [countyFipsNames, setCountyFipsNames] = useState({});
  const [hmdaMarketRef, setHmdaMarketRef] = useState(null);
  const [lendersLoading, setLendersLoading] = useState(false);
  const [tab, setTab] = useState(() => initialTab || "lenders");
  const [demoBubbles, setDemoBubbles] = useState({lenders:true,products:true,geography:true});
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [sortField, setSortField] = useState("originations");
  const [sortDir, setSortDir] = useState("desc");
  const [typeF, setTypeF] = useState("all");
  const [statusF, setStatusF] = useState("all");
  const [channelF, setChannelF] = useState("all");
  const [prodF, setProdF] = useState("all");
  const [yearF, setYearF] = useState(HMDA_PREFERRED_YEAR);
  const [selected, setSelected] = useState(null);
  const [productCardDrill, setProductCardDrill] = useState(null); // product name from Products tab
  const [productCardSortField, setProductCardSortField] = useState("originations");
  const [productCardSortDir, setProductCardSortDir] = useState("desc");
  const [productCardPage, setProductCardPage] = useState(1);
  const [productsLenderSearch, setProductsLenderSearch] = useState("");
  const [productsSelectedLender, setProductsSelectedLender] = useState(null);
  const [productsSearchOpen, setProductsSearchOpen] = useState(false);
  const [productsSuggestLenders, setProductsSuggestLenders] = useState([]);
  const [productsSuggestLoading, setProductsSuggestLoading] = useState(false);
  // Live loan-type snapshot fetched on-demand for the Products card when static data is empty
  const [productsLtSnapshot, setProductsLtSnapshot] = useState(null);
  const [productsLtLoading, setProductsLtLoading] = useState(false);
  const [coverageDrill, setCoverageDrill] = useState(null);
  const [geoStateLenderPage, setGeoStateLenderPage] = useState(1);
  const [geoMarketTopLenderPage, setGeoMarketTopLenderPage] = useState(1);
  const [showCensusTracts, setShowCensusTracts] = useState(false);
  const [geoMapCanvasReady, setGeoMapCanvasReady] = useState(false);
  /** Increment to reset map-local UI (layers, search, fly preset) from Geography toolbar. */
  const [geoMapUiResetNonce, setGeoMapUiResetNonce] = useState(0);
  const [productSortField, setProductSortField] = useState("pct");
  const [productSortDir, setProductSortDir] = useState("desc");
  const [geoSortField, setGeoSortField] = useState("lenders");
  const [geoSortDir, setGeoSortDir] = useState("desc");
  const [histView, setHistView] = useState(null); // null | "originations" | "rate" | "volume"
  const [warehouseLenderCount, setWarehouseLenderCount] = useState(null);
  const [viewMode, setViewMode] = useState("grid"); // "grid" | "list"
  /** List layout only after user picks list while on Lenders; tab entry always opens grid. */
  const [lendersExplicitList, setLendersExplicitList] = useState(false);
  const lendersUseGrid = !lendersExplicitList;

  const goToLendersTab = useCallback((options = {}) => {
    setLendersExplicitList(false);
    setViewMode("grid");
    setTab("lenders");
    setMobileMenuOpen(false);
    if (options.forceResults) setForceResults(true);
    if (options.heroTop100USA === true) {
      setSortField("dollarVol");
      setSortDir("desc");
      setHeroTop100USA(true);
    } else if (options.heroTop100USA === false) {
      setHeroTop100USA(false);
    }
  }, []);

  const [currentPage, setCurrentPage] = useState(1);
  const [pinnedIds, setPinnedIds] = useState([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareFsActive, setCompareFsActive] = useState(false);
  const comparePanelRef = useRef(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFilter, setOpenFilter] = useState(null);
  const [updateRecordsFormOpen, setUpdateRecordsFormOpen] = useState(false);
  const [updateRecordsForm, setUpdateRecordsForm] = useState({ name: "", position: "", email: "", phone: "", message: "" });
  const [updateRecordsSubmitted, setUpdateRecordsSubmitted] = useState(false);
  const [updateRecordsError, setUpdateRecordsError] = useState("");
  const [updateRecordsSubmitting, setUpdateRecordsSubmitting] = useState(false);
  const sessionStartRef = useRef(null);
  const sessionIdRef = useRef(null);
  const tabsViewedRef = useRef([]);
  const compareUsedRef = useRef(false);
  const lendersViewedRef = useRef([]);
  const lendersDataReadyRef = useRef(false);
  const fullPanelYearLoadedRef = useRef(null);
  const productsPanelLoadedRef = useRef(null);
  const geographyPanelLoadedRef = useRef(null);
  const heroReadyNotifiedRef = useRef(false);
  const geoCoreAuxLoadedRef = useRef(false);
  const usaTopoLoadedRef = useRef(false);
  const activitySentRef = useRef(false);
  const [lenderRegistryCache, setLenderRegistryCache] = useState({});
  const [lenderRegistryLoading, setLenderRegistryLoading] = useState(false);
  const [ffiecLiveSnapshot, setFfiecLiveSnapshot] = useState(null);
  const [ffiecModalInsightsLoading, setFfiecModalInsightsLoading] = useState(false);
  const [fredMacroStrip, setFredMacroStrip] = useState(null);
  const selectedRef = useRef(selected);
  const [geoHoverState, setGeoHoverState] = useState(null);
  const [mapSelectedState, setMapSelectedState] = useState(null);
  const [mapSelectedCountyCode, setMapSelectedCountyCode] = useState(null);
  const [mapSelectedCensusTract, setMapSelectedCensusTract] = useState(null);
  const [mapStateModalOpen, setMapStateModalOpen] = useState(false);
  const [geoSupportTypeDrill, setGeoSupportTypeDrill] = useState("all");
  const [openHeroTopLenders, setOpenHeroTopLenders] = useState(false);
  const [heroTop100USA, setHeroTop100USA] = useState(false);
  const [geoCountyQuery, setGeoCountyQuery] = useState("");
  const [geoCountyPage, setGeoCountyPage] = useState(1);
  /** Geography analytics: map choropleth metric and lender ranking metric */
  const [geoMapMetric, setGeoMapMetric] = useState("units");
  const [geoTopNLimit, setGeoTopNLimit] = useState(40);
  const [geoLenderRankBy, setGeoLenderRankBy] = useState("volume");
  const [usaStateFeatures, setUsaStateFeatures] = useState([]);
  const [viewportW, setViewportW] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 1200));
  const [mounted, setMounted] = useState(false);
  const [forceResults, setForceResults] = useState(
    () => initialTab === "geography" || initialTab === "products" || initialTab === "lenders",
  );
  const [searchMode, setSearchMode] = useState("search"); // "search" | "ai"
  const [demoActive, setDemoActive] = useState(false);
  const [demoStep, setDemoStep] = useState(0);
  const [demoSpotlight, setDemoSpotlight] = useState(null); // { x, y, w, h }
  const searchInputRef = useRef(null);
  const heroSearchRef = useRef(null);
  // Lender previewed in the hero section before the user commits to a tab
  const [heroPreviewLender, setHeroPreviewLender] = useState(null);
  const showResults = useMemo(() => forceResults || (q && String(q).trim().length > 0), [forceResults, q]);
  const shouldLoadLenders = useMemo(() => {
    const typed = String(qInput || "").trim();
    const searched = String(q || "").trim();
    if (typed.length >= 2 || /^\d+$/.test(typed)) return true;
    if (searched.length > 0) return true;
    if (!showResults) return false;
    // Geography map uses geo-drilldown JSON — don't download the 21MB lender panel first.
    if (tab === "geography") return false;
    // Products tab loads a lightweight product summary instead of the full lender panel.
    if (tab === "products") return false;
    return true;
  }, [showResults, qInput, q, tab]);
  useEffect(()=>{setMounted(true);},[]);

  useEffect(() => {
    fetchHmdaMeta()
      .then((meta) => {
        const yrs = meta?.years || meta?.yearWindow?.available || [];
        const nums = yrs.map(Number).filter((y) => y >= 2018);
        if (nums.length) setFfiecLarMaxReportingYear(Math.max(...nums));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchWarehouseStats()
      .then((stats) => {
        if (!stats?.ready) return;
        const yearRow = (stats.coverage || []).find((r) => Number(r.year) === Number(yearF));
        const count = yearRow?.lenderCount ?? stats.lenderYearFacts;
        if (count > 0) setWarehouseLenderCount(count);
      })
      .catch(() => {});
  }, [yearF]);

  useEffect(() => {
    if (!selected?.lei) return;
    let cancelled = false;
    fetchLenderQuarterHistory({ lei: selected.lei, year: selected.dataYear || yearF })
      .then((res) => {
        const quarters = res?.quarters || [];
        if (cancelled || !quarters.length) return;
        setSelected((prev) => {
          if (!prev || String(prev.lei).toUpperCase() !== String(selected.lei).toUpperCase()) return prev;
          const history = quarters.map((q) => Number(q.originations) || 0);
          const rateHist = quarters.map((q) => Number(q.avgRate) || PMMS_QUARTERLY_RATES_3Y[PMMS_QUARTERLY_RATES_3Y.length - 1]);
          const volHist = history.map((u) => Math.round(u * ((prev.dollarVol || 0) / Math.max(1, prev.originations || prev.orig || 1))));
          const qLabels = quarters.map((q) => `Q${q.quarter} '${String(q.year).slice(2)}`);
          return { ...prev, history, rateHist, volHist, qLabels, quarterHistory: quarters };
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selected?.lei, selected?.dataYear, yearF]);

  /** Defer bulk enrich so visible-page product mix requests run first. */
  useEffect(() => {
    if (!shouldLoadLenders || !LENDERS.length || !HMDA_FFIRC_LIVE) return;
    const py = Number(yearF);
    const ly = larDetailYearForPanel(py);
    const t = setTimeout(() => {
      const rows = LENDERS.filter(
        (l) => Number(l.dataYear) === py && /^[A-Z0-9]{20}$/i.test(String(l.lei || "").trim()),
      );
      if (!rows.length) return;
      enrichLendersFromFfiecApi(rows, ly, setLENDERS, { limit: 24 }).catch(() => {});
    }, 8000);
    return () => clearTimeout(t);
  }, [yearF, shouldLoadLenders, LENDERS.length]);

  /** Safety: clear loading overlay once rows land (fixes startTransition race). */
  useEffect(() => {
    if ((LENDERS.length > 0 || lenderQuery.lenders?.length > 0) && lendersLoading) {
      lendersDataReadyRef.current = true;
      setLendersLoading(false);
    }
  }, [LENDERS.length, lenderQuery.lenders?.length, lendersLoading]);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const hmdaInsightsForModal = useMemo(() => {
    if (!selected) return null;
    const panelYear = Number(selected.dataYear ?? yearF ?? HMDA_PREFERRED_YEAR);
    const larYear = larDetailYearForPanel(panelYear);
    const lei = selected.lei ? String(selected.lei).trim().toUpperCase() : "";
    const key = `${lei}|${larYear}`;
    if (ffiecLiveSnapshot?.key === key && ffiecLiveSnapshot.merged) {
      if (hmdaInsightsMatchesYear(ffiecLiveSnapshot.merged, larYear)) return ffiecLiveSnapshot.merged;
    }
    return selectHmdaInsightsForYear(selected, larYear);
  }, [selected, ffiecLiveSnapshot, yearF]);

  const selectedForHmdaModal = useMemo(
    () => (selected ? { ...selected, hmdaInsights: hmdaInsightsForModal || selected.hmdaInsights } : null),
    [selected, hmdaInsightsForModal],
  );

  const modalHmdaYear = useMemo(
    () => (selected ? Number(selected.dataYear ?? yearF ?? HMDA_PREFERRED_YEAR) : null),
    [selected, yearF],
  );

  const modalLarYear = useMemo(
    () => (modalHmdaYear != null ? larDetailYearForPanel(modalHmdaYear) : null),
    [modalHmdaYear],
  );

  const modalLarIsCompanion = modalHmdaYear != null && modalLarYear != null && modalHmdaYear > modalLarYear;

  const modalHasYearMatchedLar = useMemo(() => {
    const h = hmdaInsightsForModal;
    if (!h || modalLarYear == null) return false;
    return hmdaInsightsMatchesYear(h, modalLarYear) && (h.totalApplications || 0) > 0;
  }, [hmdaInsightsForModal, modalLarYear]);

  const modalPipelineDisposition = useMemo(
    () => resolveLenderLarDisposition(selectedForHmdaModal || selected, modalHmdaYear, LENDERS),
    [selected, selectedForHmdaModal, modalHmdaYear, LENDERS],
  );

  const [modalAccordionOpen, setModalAccordionOpen] = useState([]);
  const [modalAccordionShowAll, setModalAccordionShowAll] = useState(false);

  const modalAccordionSectionIds = useMemo(() => {
    if (!selected) return [];
    const ids = ["identity", "production", "pipeline", "credit"];
    if (modalHasYearMatchedLar) {
      ids.push("drill-pipeline", "drill-outcomes");
      const lt = selectedForHmdaModal?.hmdaInsights?.loanTypeSummary;
      if (lt && Object.keys(lt).length > 0) ids.push("drill-products");
    }
    ids.push("sources");
    return ids;
  }, [selected, modalHasYearMatchedLar, selectedForHmdaModal?.hmdaInsights?.loanTypeSummary]);

  useEffect(() => {
    setModalAccordionOpen([]);
    setModalAccordionShowAll(false);
  }, [selected?.id]);

  const handleModalAccordionChange = useCallback(
    (next) => {
      if (modalAccordionShowAll) {
        if (next.length < modalAccordionSectionIds.length) {
          setModalAccordionShowAll(false);
          setModalAccordionOpen(next.length ? [next[next.length - 1]] : []);
        } else {
          setModalAccordionOpen(next);
        }
        return;
      }
      if (next.length > 1) {
        const added = next.find((v) => !modalAccordionOpen.includes(v));
        setModalAccordionOpen(added ? [added] : [next[next.length - 1]]);
        return;
      }
      setModalAccordionOpen(next);
    },
    [modalAccordionOpen, modalAccordionSectionIds.length, modalAccordionShowAll],
  );

  const toggleModalAccordionShowAll = useCallback(() => {
    if (modalAccordionShowAll) {
      setModalAccordionShowAll(false);
      setModalAccordionOpen([]);
      return;
    }
    setModalAccordionShowAll(true);
    setModalAccordionOpen(modalAccordionSectionIds);
  }, [modalAccordionShowAll, modalAccordionSectionIds]);

  useEffect(() => {
    const leiRaw = selected?.lei != null ? String(selected.lei).trim().toUpperCase() : "";
    const lei = /^[A-Z0-9]{20}$/.test(leiRaw) ? leiRaw : null;
    if (!lei) {
      setFfiecLiveSnapshot(null);
      return;
    }
    const panelYear = Number(selected.dataYear ?? yearF ?? HMDA_PREFERRED_YEAR);
    const year = larDetailYearForPanel(panelYear);
    if (!Number.isFinite(year) || year < 2017 || year > 2035) {
      setFfiecLiveSnapshot(null);
      setFfiecModalInsightsLoading(false);
      return;
    }
    const key = `${lei}|${year}`;
    let cancelled = false;
    setFfiecLiveSnapshot(null);
    setFfiecModalInsightsLoading(true);
    const orig = Number(selected.originations || selected.units || 0);
    const includeMedians = orig > 0 && orig <= 600000;
    const finish = () => {
      if (!cancelled) setFfiecModalInsightsLoading(false);
    };
    fetchFullLenderInsights(lei, year, { includeMedians })
      .then((insights) => {
        if (cancelled || !insights || insights.error) return;
        const cur = selectedRef.current;
        if (!cur || String(cur.lei || "").trim().toUpperCase() !== lei) return;
        const y = larDetailYearForPanel(Number(cur.dataYear ?? yearF ?? HMDA_PREFERRED_YEAR));
        if (y !== year) return;
        const merged = mergeLenderInsightsIntoRow(cur, insights).hmdaInsights;
        if (!hmdaInsightsMatchesYear(merged, year)) return;
        setFfiecLiveSnapshot({ key, merged });
        setLENDERS((prev) =>
          prev.map((l) => (l.id === cur.id ? mergeLenderInsightsIntoRow(l, insights) : l)),
        );
      })
      .catch(() => {
        if (cancelled) return;
        const params = new URLSearchParams({
          years: String(year),
          leis: lei,
          states: "0",
          medians: "0",
          demographics: "1",
        });
        fetch(`/api/hmda/ffiec/lender-insights?${params}`)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
          .then((body) => {
            if (cancelled) return;
            const cur = selectedRef.current;
            if (!cur || String(cur.lei || "").trim().toUpperCase() !== lei) return;
            const insights = body?.insights?.[lei];
            if (!insights || insights.error) return;
            const merged = mergeLenderInsightsIntoRow(cur, insights).hmdaInsights;
            if (!merged || !hmdaInsightsMatchesYear(merged, year)) return;
            setFfiecLiveSnapshot({ key, merged });
            setLENDERS((prev) =>
              prev.map((l) => (l.id === cur.id ? mergeLenderInsightsIntoRow(l, insights) : l)),
            );
          })
          .catch(() => {
            if (!cancelled) setFfiecLiveSnapshot(null);
          });
      })
      .finally(finish);
    return () => {
      cancelled = true;
      setFfiecModalInsightsLoading(false);
    };
  }, [selected?.id, selected?.lei, selected?.dataYear, yearF]);

  useEffect(() => {
    if (!HMDA_FFIRC_LIVE || !selected) {
      setFredMacroStrip(null);
      return;
    }
    let cancelled = false;
    fetch("/api/fred/latest-series?ids=MORTGAGE30US,DGS10,OBMMIFHA30YF")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!cancelled && body?.ok && body.series) setFredMacroStrip(body);
      })
      .catch(() => {
        if (!cancelled) setFredMacroStrip(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.id]);

  /** Keep filter on 2025 by default; only change if user picked another valid year. */
  useEffect(() => {
    if (!AVAILABLE_YEARS.length) return;
    const ys = AVAILABLE_YEARS.map(String);
    setYearF((prev) => {
      if (prev === HMDA_PREFERRED_YEAR) return HMDA_PREFERRED_YEAR;
      return ys.includes(prev) ? prev : HMDA_PREFERRED_YEAR;
    });
  }, [AVAILABLE_YEARS]);

  useEffect(() => {
    if (selected?.id != null) {
      setHistView(null);
    }
  }, [selected?.id]);

  useEffect(() => {
    if (showResults && !sessionStartRef.current) {
      sessionStartRef.current = Date.now();
      sessionIdRef.current = Date.now().toString(36) + Math.random().toString(36).slice(2);
    }
  }, [showResults]);

  useEffect(() => {
    if (showResults && tab) tabsViewedRef.current.push(tab);
  }, [showResults, tab]);

  useEffect(() => {
    if (compareOpen) compareUsedRef.current = true;
  }, [compareOpen]);

  useEffect(() => {
    const sync = () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      setCompareFsActive(!!comparePanelRef.current && fsEl === comparePanelRef.current);
    };
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  useEffect(() => {
    if (compareOpen) return;
    setCompareFsActive(false);
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl?.classList?.contains?.("hmda-modal-compare-panel")) {
      const ex = document.exitFullscreen || document.webkitExitFullscreen;
      ex?.call(document)?.catch?.(() => {});
    }
  }, [compareOpen]);

  const toggleCompareFullscreen = useCallback(() => {
    const el = comparePanelRef.current;
    if (!el) return;
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (!fsEl) {
      const rq = el.requestFullscreen || el.webkitRequestFullscreen;
      rq?.call(el)?.catch?.(() => {});
    } else if (fsEl === el) {
      const ex = document.exitFullscreen || document.webkitExitFullscreen;
      ex?.call(document)?.catch?.(() => {});
    }
  }, []);

  const RECORD_UPDATE_API = import.meta.env.VITE_RECORD_UPDATE_API_URL || "/api/record-update";
  const HMDA_ACTIVITY_API = import.meta.env.VITE_HMDA_ACTIVITY_API_URL || "/api/hmda-activity";

  const sendActivity = useCallback(() => {
    if (activitySentRef.current || !sessionStartRef.current) return;
    activitySentRef.current = true;
    const durationSeconds = Math.round((Date.now() - sessionStartRef.current) / 1000);
    let visitorKey;
    try {
      visitorKey = localStorage.getItem("hmda_visitor_key");
      if (!visitorKey) {
        visitorKey = `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
        localStorage.setItem("hmda_visitor_key", visitorKey);
      }
    } catch {
      visitorKey = undefined;
    }
    const payload = {
      sessionId: sessionIdRef.current || undefined,
      visitorKey: visitorKey || undefined,
      durationSeconds,
      tabsViewed: [...new Set(tabsViewedRef.current)].slice(0, 50),
      compareUsed: compareUsedRef.current,
      lendersViewed: lendersViewedRef.current.slice(-50),
    };
    if (navigator.sendBeacon && typeof Blob !== "undefined") {
      try {
        navigator.sendBeacon(HMDA_ACTIVITY_API, new Blob([JSON.stringify(payload)], { type: "application/json" }));
      } catch (_) {}
    } else {
      fetch(HMDA_ACTIVITY_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), keepalive: true }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!showResults) return;
    const onVisibility = () => { if (document.visibilityState === "hidden") sendActivity(); };
    const onPageHide = () => sendActivity();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      sendActivity();
    };
  }, [showResults, sendActivity]);

  useLayoutEffect(() => {
    if (!showResults) return;
    if (tab === "products" || tab === "geography") return;
    if (tab === "lenders" && shouldLoadLenders && !lenderQuery.fetched) {
      setLendersLoading(true);
      return;
    }
    if (lendersDataReadyRef.current || LENDERS.length > 0 || lenderQuery.lenders?.length > 0) return;
    setLendersLoading(true);
  }, [showResults, LENDERS.length, lenderQuery.lenders?.length, lenderQuery.fetched, tab, shouldLoadLenders]);

  const notifyHeroBrowseReady = useCallback(() => {
    if (heroReadyNotifiedRef.current) return;
    heroReadyNotifiedRef.current = true;
    onHeroReady?.();
  }, [onHeroReady]);

  /* Landing: dismiss route preloader once hero shell is mounted (no lender JSON yet). */
  useEffect(() => {
    if (!mounted) return;
    notifyHeroBrowseReady();
  }, [mounted, notifyHeroBrowseReady]);

  const applyLenderPack = useCallback((lenderPack, overrides, { bootstrap = false } = {}) => {
    const raw = lenderPack?.lenders || [];
    if (!raw.length) return false;
    if (lenderPack.source === "api" || lenderPack.source === "api+static") {
      const label = bootstrap ? "bootstrap" : "panel";
      console.info(`[HMDA] Loaded ${raw.length} lender rows (${label}, ${lenderPack.meta?.year || HMDA_PREFERRED_YEAR})`);
    }
    const yearsFromData = [...new Set(raw.map((l) => String(l.dataYear || "")).filter(Boolean))].sort(
      (a, b) => Number(b) - Number(a),
    );
    const requestedFromMeta = (
      lenderPack.meta?.yearsRequested ||
      lenderPack.yearsRequested ||
      buildHmdaRequestedYears(HMDA_DEFAULT_ANCHOR_YEAR)
    )
      .map(String)
      .filter(Boolean);
    const years = [...new Set([...requestedFromMeta, ...AVAILABLE_YEARS_DEFAULT.map(String)])].sort(
      (a, b) => Number(b) - Number(a),
    );
    setAVAILABLE_YEARS(years);
    setYearsWithData(yearsFromData);
    if (!yearsFromData.includes(String(yearF))) {
      setYearF(yearsFromData[0] || HMDA_PREFERRED_YEAR);
    }

    const computed = computeLenders(raw, { lite: bootstrap });
    const withOverrides = applyLenderContentOverrides(computed, overrides);

    if (bootstrap) {
      setLENDERS(withOverrides);
      lendersDataReadyRef.current = true;
      const schedulePeers =
        typeof requestIdleCallback === "function"
          ? requestIdleCallback
          : (cb) => setTimeout(cb, 1200);
      schedulePeers(() => {
        setLENDERS((prev) => (prev.length ? enrichHmdaPeers(prev) : prev));
      });
      return true;
    }

    startTransition(() => {
      const fullComputed = computeLenders(raw);
      const fullWithOverrides = enrichHmdaPeers(applyLenderContentOverrides(fullComputed, overrides));
      setLENDERS(fullWithOverrides);
      lendersDataReadyRef.current = true;
      if (HMDA_FFIRC_LIVE) {
        const panelY = Number(HMDA_PREFERRED_YEAR);
        const enrichYear = larDetailYearForPanel(panelY);
        const rowsForYear = fullWithOverrides.filter((l) => Number(l.dataYear) === panelY);
        enrichLendersFromFfiecApi(rowsForYear, enrichYear, setLENDERS, { limit: 24 }).catch(() => {});
      }
    });
    return true;
  }, [yearF]);

  const mergeLendersIntoCache = useCallback((rows) => {
    if (!rows?.length) return;
    setLENDERS((prev) => {
      const byKey = new Map(prev.map((l) => [`${l.lei}|${l.dataYear}`, l]));
      for (const row of rows) {
        byKey.set(`${row.lei}|${row.dataYear}`, row);
      }
      return [...byKey.values()];
    });
  }, []);

  /** Keep paginated grid rows in sync when FFIEC insights merge into lender state. */
  const applyLenderRowUpdates = useCallback((updater) => {
    setLENDERS(updater);
    setLenderQuery((prev) => ({
      ...prev,
      lenders: updater(prev.lenders || []),
    }));
  }, []);

  /** Static years manifest — drives year picker labels and available lender years. */
  useEffect(() => {
    if (!showResults) return;
    let cancelled = false;
    fetchHmdaYearsManifest()
      .then((manifest) => {
        if (cancelled || !manifest) return;
        setHmdaYearsManifest(manifest);
        const opts = yearOptionsFromManifest(manifest, AVAILABLE_YEARS_DEFAULT);
        setAVAILABLE_YEARS(opts);
        setYearsWithData(manifest.lenderYears || opts);
        if (manifest.larDetailMaxYear) {
          setFfiecLarMaxReportingYear(manifest.larDetailMaxYear);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showResults]);

  /** Per-year lender manifest + morning sync (once per day after 5am). */
  useEffect(() => {
    if (!showResults) return;
    let cancelled = false;
    fetchLenderManifest({ years: yearF })
      .then((manifest) => {
        if (!cancelled) setLenderManifest(manifest);
      })
      .catch(() => {});
    runHmdaMorningSync(() => fetchHmdaSyncCheck({ years: yearF }))
      .then(({ stale }) => {
        if (stale) clearLenderPagerCache();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showResults, yearF]);

  /** Paginated lender grid — one page at a time from static pages or API. */
  useEffect(() => {
    if (!shouldLoadLenders || tab !== "lenders") return;

    let cancelled = false;
    setLendersLoading(true);
    setLenderQuery((prev) => ({ ...prev, loading: true, fetched: false }));

    const loadOverrides = () =>
      fetch(publicAssetUrl("data/lender-content-overrides.json"), { cache: "default" })
        .then((r) => (r.ok ? r.json() : { schemaVersion: 1, byLei: {} }))
        .catch(() => ({ schemaVersion: 1, byLei: {} }));

    (async () => {
      try {
        const [overrides, result] = await Promise.all([
          loadOverrides(),
          fetchLenderQuery({
            years: yearF,
            page: Math.max(0, currentPage - 1),
            pageSize: LENDER_PAGE_SIZE,
            q,
            typeF,
            statusF,
            channelF,
            prodF,
            sort: sortField,
            dir: sortDir,
          }),
        ]);
        if (cancelled) return;

        const computed = applyLenderContentOverrides(
          computeLenders(result.lenders || [], { lite: true }),
          overrides,
        );
        const rankMap = new Map();
        const pageIndex = result.page ?? Math.max(0, currentPage - 1);
        const pageBase = pageIndex * LENDER_PAGE_SIZE;
        computed.forEach((l, idx) => rankMap.set(l.id, pageBase + idx + 1));

        setLenderQuery({
          lenders: computed,
          total: result.total ?? computed.length,
          totalPages: result.totalPages ?? 1,
          page: pageIndex,
          rankMap,
          loading: false,
          fetched: true,
        });
        mergeLendersIntoCache(computed);
        lendersDataReadyRef.current = true;
        setLendersLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error("[HMDA] paginated lenders load failed:", err);
        setLendersLoading(false);
        setLenderQuery((prev) => ({ ...prev, loading: false, fetched: true }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    shouldLoadLenders,
    tab,
    currentPage,
    q,
    sortField,
    sortDir,
    typeF,
    statusF,
    channelF,
    prodF,
    yearF,
    mergeLendersIntoCache,
  ]);

  /** Product mix summary — refetch when panel year changes (Products tab shows loading). */
  useEffect(() => {
    if (!showResults) return;
    let cancelled = false;
    const panelY = Number(yearF) || Number(HMDA_PREFERRED_YEAR);
    setProductSummaryData((prev) =>
      prev != null && Number(prev.meta?.dataYear) === panelY ? prev : null,
    );
    if (tab === "products") setProductSummaryLoading(true);
    fetchProductSummary({ years: yearF })
      .then((summary) => {
        if (cancelled || !summary) return;
        if (Number(summary.meta?.dataYear) !== panelY) return;
        setProductSummaryData(summary);
      })
      .catch((e) => {
        if (!cancelled) console.warn("[HMDA] product summary failed:", e?.message);
      })
      .finally(() => {
        if (!cancelled && tab === "products") setProductSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showResults, tab, yearF]);

  /** Product drill modal — paginated members for selected product. */
  useEffect(() => {
    if (!productCardDrill) {
      setProductDrillQuery({ members: [], total: 0, totalPages: 1, loading: false });
      return;
    }
    let cancelled = false;
    setProductDrillQuery((prev) => ({ ...prev, loading: true }));

    fetchLenderQuery({
      years: Number(yearF) || Number(HMDA_PREFERRED_YEAR),
      page: Math.max(0, productCardPage - 1),
      pageSize: PAGE_SIZE,
      prodF: productCardDrill,
      sort: productCardSortField,
      dir: productCardSortDir,
    })
      .then((result) => {
        if (cancelled) return;
        const members = computeLenders(result.lenders || [], { lite: true });
        mergeLendersIntoCache(members);
        setProductDrillQuery({
          members,
          total: result.total ?? members.length,
          totalPages: result.totalPages ?? 1,
          loading: false,
        });
      })
      .catch(() => {
        if (!cancelled) setProductDrillQuery({ members: [], total: 0, totalPages: 1, loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [productCardDrill, productCardPage, productCardSortField, productCardSortDir, yearF, mergeLendersIntoCache]);

  /** Debounced typeahead from paginated suggest endpoint. */
  useEffect(() => {
    const term = String(qInput || "").trim();
    if (term.length < 2 && !/^\d+$/.test(term)) {
      setSuggestLenders([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      fetchLenderSuggest({ years: yearF, q: term, limit: 8 })
        .then((rows) => {
          if (!cancelled) {
            const normalized = (rows || []).map((l) => ({
              ...l,
              id:
                l.lei && l.dataYear
                  ? `${String(l.lei).trim().toUpperCase()}|${Number(l.dataYear)}`
                  : l.id || l.lei || l.nmls || "",
              originations: l.originations ?? l.orig ?? 0,
              nmls: String(l.nmls || l.nmlsNumber || ""),
              type: l.type || "",
              products: l.products || [],
              stateList: l.stateList || [],
              channel: l.channel || "",
              status: l.status || "",
            }));
            setSuggestLenders(normalized);
            mergeLendersIntoCache(normalized);
          }
        })
        .catch(() => {
          if (!cancelled) setSuggestLenders([]);
        });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [qInput, yearF, mergeLendersIntoCache]);

  /** Products tab — avoid full static panel preload; search/dimensions now use API-backed endpoints. */
  useEffect(() => {
    if (!showResults || tab !== "products") return;
    productsPanelLoadedRef.current = String(yearF);
  }, [showResults, tab, yearF]);

  /** Geography tab — preload only top rows for rankings; do not parse the full static lender panel. */
  useEffect(() => {
    if (!showResults || tab !== "geography") return;
    const yearKey = String(yearF);
    if (geographyPanelLoadedRef.current === yearKey) return;

    let cancelled = false;
    (async () => {
      try {
        const result = await fetchLenderQuery({
          years: yearF,
          page: 0,
          pageSize: 100,
          sort: "dollarVol",
          dir: "desc",
        });
        if (cancelled || !result?.lenders?.length) return;
        const overrides = await fetch(publicAssetUrl("data/lender-content-overrides.json"), { cache: "default" })
          .then((r) => (r.ok ? r.json() : { schemaVersion: 1, byLei: {} }))
          .catch(() => ({ schemaVersion: 1, byLei: {} }));
        const computed = applyLenderContentOverrides(
          computeLenders(result.lenders, { lite: true }),
          overrides,
        );
        mergeLendersIntoCache(computed);
        geographyPanelLoadedRef.current = yearKey;
      } catch (e) {
        if (!cancelled) console.warn("[HMDA] geography panel lender preload failed:", e?.message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showResults, tab, yearF, mergeLendersIntoCache]);

  /** Products tab lender search — debounced suggest API across full static/API panel. */
  useEffect(() => {
    if (tab !== "products") return;
    const term = String(productsLenderSearch || "").trim();
    if (term.length < 2 && !/^\d+$/.test(term)) {
      setProductsSuggestLenders([]);
      setProductsSuggestLoading(false);
      return;
    }
    let cancelled = false;
    setProductsSuggestLoading(true);
    const t = setTimeout(() => {
      fetchLenderSuggest({ years: yearF, q: term, limit: 12 })
        .then((rows) => {
          if (cancelled) return;
          const normalized = (rows || []).map((l) => ({
            ...l,
            id:
              l.lei && l.dataYear
                ? `${String(l.lei).trim().toUpperCase()}|${Number(l.dataYear)}`
                : l.id || l.lei || l.nmls || "",
            originations: l.originations ?? l.orig ?? 0,
            nmls: String(l.nmls || l.nmlsNumber || ""),
            type: l.type || "",
            products: l.products || [],
            stateList: l.stateList || [],
            channel: l.channel || "",
            status: l.status || "",
          }));
          setProductsSuggestLenders(normalized);
          mergeLendersIntoCache(normalized);
        })
        .catch(() => {
          if (!cancelled) setProductsSuggestLenders([]);
        })
        .finally(() => {
          if (!cancelled) setProductsSuggestLoading(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [tab, productsLenderSearch, yearF, mergeLendersIntoCache]);

  /** Legacy full-panel loader — prefetch selected year into LENDERS cache when paginated path misses. */
  useEffect(() => {
    if (!shouldLoadLenders) return;
    if (yearsWithData.includes(String(yearF))) return;
    if (fullPanelYearLoadedRef.current === yearF) return;

    let cancelled = false;
    setLendersLoading(true);

    const loadOverrides = () =>
      fetch(publicAssetUrl("data/lender-content-overrides.json"), { cache: "default" })
        .then((r) => (r.ok ? r.json() : { schemaVersion: 1, byLei: {} }))
        .catch(() => ({ schemaVersion: 1, byLei: {} }));

    (async () => {
      try {
        const [overrides, full] = await Promise.all([
          loadOverrides(),
          fetchStaticHmdaLendersBootstrap(yearF),
        ]);
        if (cancelled) return;
        if (full && applyLenderPack(full, overrides, { bootstrap: false })) {
          fullPanelYearLoadedRef.current = yearF;
        }
      } catch (e) {
        if (!cancelled) console.warn("[HMDA] full lender panel load failed:", e?.message);
      } finally {
        if (!cancelled) setLendersLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shouldLoadLenders, yearF, yearsWithData, applyLenderPack]);

  useEffect(() => {
    if (!showResults) return;
    if (lendersDataReadyRef.current) setLendersLoading(false);

    const jsonFetch = (path) =>
      fetch(publicAssetUrl(path), { cache: "default" }).then((r) => {
        if (!r.ok) throw new Error(`${path} HTTP ${r.status}`);
        return r.json();
      });

    let cancelled = false;

    if (!geoCoreAuxLoadedRef.current) {
      geoCoreAuxLoadedRef.current = true;
      jsonFetch("data/county-fips-names.json")
        .then((data) => {
          if (!cancelled) setCountyFipsNames(data);
        })
        .catch(() => {});
      fetch(publicAssetUrl("data/hmda-market-reference.json"), { cache: "default" })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((data) => {
          if (!cancelled) setHmdaMarketRef(data);
        })
        .catch(() => {
          if (!cancelled) setHmdaMarketRef(null);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [showResults]);

  useEffect(() => {
    if (!initialTab) return;
    if (initialTab === "lenders") {
      setTab("lenders");
      setForceResults(true);
      return;
    }
    if (initialTab === "geography") {
      setTab("geography");
      setForceResults(true);
      void loadTractCentroids();
      void import("./geography/HmdaGeographyMapbox.jsx");
      return;
    }
    if (initialTab === "products") {
      setTab("products");
      setForceResults(true);
    }
  }, [initialTab]);

  const filterBarRef = useRef(null);
  useEffect(() => {
    if (!openFilter) return;
    const h = (e) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (filterBarRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-hmda-filter-menu]")) return;
      setOpenFilter(null);
    };
    const t = setTimeout(() => document.addEventListener("click", h), 0);
    return () => { clearTimeout(t); document.removeEventListener("click", h); };
  }, [openFilter]);
  const heroTopLendersRef = useRef(null);
  useEffect(() => {
    if (!openHeroTopLenders) return;
    const h = (e) => {
      if (heroTopLendersRef.current && !heroTopLendersRef.current.contains(e.target)) setOpenHeroTopLenders(false);
    };
    const t = setTimeout(() => document.addEventListener("click", h), 0);
    return () => { clearTimeout(t); document.removeEventListener("click", h); };
  }, [openHeroTopLenders]);
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        (heroSearchRef.current || searchInputRef.current)?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") window.__COHI_DEPLOY_TAG__ = DEPLOY_TAG;
  }, [DEPLOY_TAG]);
  useEffect(() => {
    if (typeof window !== "undefined") window.__COHI_INSTRUCTIONS__ = COHI_INSTRUCTIONS;
  }, []);

  const startDemo = useCallback(() => {
    setDemoActive(true);
    setDemoStep(0);
    setForceResults(false);
    setQ("");setQInput("");
  }, []);
  const dismissDemo = useCallback((mode) => {
    setDemoActive(false);
    if (typeof window !== "undefined") {
      if (mode === "never") localStorage.setItem(DEMO_STORAGE.NEVER, "1");
      else if (mode === "2weeks") localStorage.setItem(DEMO_STORAGE.DISMISS_UNTIL, String(Date.now() + 14 * 24 * 60 * 60 * 1000));
      if (mode === "never" || mode === "2weeks" || !mode) localStorage.setItem(DEMO_STORAGE.SEEN, "1");
    }
  }, []);
  const demoNext = useCallback(() => {
    const nextStep = demoStep + 1;
    const next = DEMO_STEPS[nextStep];
    if (next?.id === "lenders" || next?.id === "filters" || next?.id === "compare") {
      goToLendersTab({ forceResults: true });
    } else if (next?.id === "history" || next?.id === "demo-contact") {
      goToLendersTab({ forceResults: true });
      setSelected(LENDERS[0] ?? null);
    } else if (next?.id === "products") {
      setSelected(null);
      setTab("products");
    } else if (next?.id === "geography") setTab("geography");
    if (demoStep >= DEMO_STEPS.length - 1) {
      dismissDemo();
      return;
    }
    setDemoStep((s) => Math.min(s + 1, DEMO_STEPS.length - 1));
  }, [demoStep, dismissDemo, goToLendersTab]);

  useEffect(() => {
    if (!mounted || !demoActive) return;
    const step = DEMO_STEPS[demoStep];
    const target = step?.target;
    const updateSpotlight = () => {
      if (!target) {
        setDemoSpotlight(null);
        return;
      }
      const el = document.querySelector(`[data-demo-target="${target}"]`);
      if (el) {
        // Ensure the element is visible before measuring (avoids spotlight drifting during smooth scroll)
        try { el.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" }); } catch {}
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const r = el.getBoundingClientRect();
            setDemoSpotlight({ x: r.left, y: r.top, w: r.width, h: r.height });
          });
        });
      } else {
        setDemoSpotlight(null);
      }
    };
    const delay = (step?.id === "history" || step?.id === "demo-contact") ? 260 : 120;
    let tries = 0;
    let t = null;
    const tick = () => {
      tries += 1;
      updateSpotlight();
      const ok = !target || !!document.querySelector(`[data-demo-target="${target}"]`);
      if (ok || tries >= 10) return;
      t = setTimeout(tick, 80);
    };
    t = setTimeout(tick, delay);
    return () => { if (t) clearTimeout(t); };
  }, [demoActive, demoStep, mounted, tab, showResults, selected]);

  useEffect(() => {
    if (!mounted || demoActive) return;
    if (initialTab === "geography" || initialTab === "products" || initialTab === "lenders") return;
    if (typeof window === "undefined") return;
    if (localStorage.getItem(DEMO_STORAGE.NEVER)) return;
    const until = localStorage.getItem(DEMO_STORAGE.DISMISS_UNTIL);
    if (until && Date.now() < Number(until)) return;
    if (localStorage.getItem(DEMO_STORAGE.SEEN)) return;
    const t = setTimeout(() => startDemo(), 800);
    return () => clearTimeout(t);
  }, [mounted, demoActive, startDemo, initialTab]);

  const tourFromMarketingNavRef = useRef(false);
  useEffect(() => {
    if (!mounted || tourFromMarketingNavRef.current) return;
    const params = new URLSearchParams(location.search);
    if (params.get("tour") !== "1") return;
    tourFromMarketingNavRef.current = true;
    startDemo();
    navigate({ pathname: location.pathname, search: "" }, { replace: true });
  }, [mounted, location.search, location.pathname, startDemo, navigate]);

  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    if (!showResults || tab !== "geography") return;
    if (usaTopoLoadedRef.current) return;
    let cancelled = false;
    const loadUsMap = async () => {
      try {
        const res = await fetch(US_STATES_TOPO_JSON);
        if (!res.ok) throw new Error(`Map ${res.status}`);
        const topo = await res.json();
        const feats = feature(topo, topo.objects.states).features || [];
        if (!cancelled) {
          setUsaStateFeatures(feats);
          usaTopoLoadedRef.current = true;
        }
      } catch (e) {
        if (!cancelled) setUsaStateFeatures([]);
      }
    };
    loadUsMap();
    return () => {
      cancelled = true;
    };
  }, [showResults, tab]);

  const c = TK[theme];
  const dk = theme==="dark";
  const pinCapDisplay = HMDA_PREMIUM_PINS_UNLIMITED ? "~" : maxPinnedLenders;
  const isMobile = viewportW < BP_MOBILE;
  const isTablet = viewportW < BP_TABLET;

  const panelYear = useMemo(
    () => Number(yearF) || Number(HMDA_PREFERRED_YEAR),
    [yearF],
  );

  const panelYearLenders = useMemo(
    () => LENDERS.filter((l) => Number(l.dataYear) === panelYear),
    [LENDERS, panelYear],
  );

  useEffect(() => {
  }, [tab, yearF, panelYear, LENDERS.length, panelYearLenders.length, lenderQuery.lenders, lenderQuery.total]);

  const productsSearchMatches = useMemo(() => {
    const term = String(productsLenderSearch || "").trim().toLowerCase();
    if (term.length < 2 && !/^\d+$/.test(term)) return [];
    const tokens = term.split(/\s+/).filter(Boolean);
    const matchesTerm = (l) => {
      const name = String(l.name || "").toLowerCase();
      const lei = String(l.lei || "").toLowerCase();
      const nmls = String(l.nmls || "").toLowerCase();
      if (lei.includes(term) || nmls.includes(term)) return true;
      if (tokens.length > 1) return tokens.every((t) => name.includes(t));
      return name.includes(term);
    };
    const pool = new Map();
    for (const row of [...productsSuggestLenders, ...panelYearLenders]) {
      if (!matchesTerm(row)) continue;
      const key = row.id || `${String(row.lei || "").toUpperCase()}|${Number(row.dataYear)}`;
      if (!key || pool.has(key)) continue;
      pool.set(key, row);
    }
    return [...pool.values()]
      .sort((a, b) => (Number(b.originations ?? b.orig) || 0) - (Number(a.originations ?? a.orig) || 0))
      .slice(0, 12);
  }, [productsLenderSearch, productsSuggestLenders, panelYearLenders]);

  const selectProductsLender = useCallback((l) => {
    const normalized = computeLenders([l], { lite: true })[0] || l;
    setProductsSelectedLender(normalized);
    setProductsLenderSearch(normalized.name || "");
    setProductsSearchOpen(false);
    setProductsLtSnapshot(null);
    mergeLendersIntoCache([normalized]);
  }, [mergeLendersIntoCache]);

  /** When year changes, re-resolve the Products-tab selected lender to the same LEI in the new year's data. */
  useEffect(() => {
    if (!productsSelectedLender) return;
    const lei = String(productsSelectedLender.lei || "").trim().toUpperCase();
    if (!lei) return;
    const match = panelYearLenders.find(
      (l) => String(l.lei || "").trim().toUpperCase() === lei,
    );
    if (match && match !== productsSelectedLender) {
      setProductsSelectedLender(match);
      setProductsLtSnapshot(null);
    }
  }, [panelYear, panelYearLenders]);

  /**
   * Fetch loan-type summary on-demand from FFIEC when the selected Products lender
   * doesn't have loanTypeSummary populated in the static JSON (e.g. 2024/2023/2022).
   */
  useEffect(() => {
    if (!productsSelectedLender?.lei) return;
    const lei = String(productsSelectedLender.lei).trim().toUpperCase();
    const larY = larDetailYearForPanel(panelYear);
    const hi = (productsSelectedLender.hmdaInsights || {});
    const lts = hi.loanTypeSummary;
    const hasSummary = lts && Object.values(lts).some(v => (v?.originated || 0) > 0);
    if (hasSummary) { setProductsLtSnapshot(null); return; }
    const byProd = productsSelectedLender.originationBreakdown?.byProduct;
    if (byProd && Object.keys(byProd).length > 0) { setProductsLtSnapshot(null); return; }
    // Need to fetch
    let cancelled = false;
    setProductsLtLoading(true);
    const snapshotKey = `${lei}|${larY}`;
    fetchFullLenderInsights(lei, larY, { includeMedians: false })
      .then(insights => {
        if (cancelled) return;
        const newLts = insights?.loanTypeSummary || {};
        if (Object.keys(newLts).length) {
          setProductsLtSnapshot({ key: snapshotKey, loanTypeSummary: newLts });
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setProductsLtLoading(false); });
    return () => { cancelled = true; };
  }, [productsSelectedLender, panelYear]);

  /**
   * Lender-specific product distribution for HmdaProductDimensionTables.
   * Built from hmdaInsights.loanTypeSummary (or live FFIEC snapshot) when a
   * lender is selected in the Products search, so all six dimension tables
   * reflect that lender's data rather than the market panel.
   */
  const lenderTableDistribution = useMemo(() => {
    if (!productsSelectedLender) return null;
    const l = productsSelectedLender;
    const larY = larDetailYearForPanel(panelYear);
    const h = selectHmdaInsightsForYear(l, larY) || l.hmdaInsights || {};
    const snapshotKey = `${String(l.lei||"").trim().toUpperCase()}|${larY}`;
    const lts = (h.loanTypeSummary && Object.keys(h.loanTypeSummary).length > 0)
      ? h.loanTypeSummary
      : (productsLtSnapshot?.key === snapshotKey ? productsLtSnapshot.loanTypeSummary : null);

    const NAME_TO_CODE = { Conventional: "1", FHA: "2", VA: "3", USDA: "4" };
    const medianSpread = h.originatedMedianRateSpread ?? null;
    const medianCltv  = h.originatedMedianCltv ?? null;

    return ["Conventional", "FHA", "VA", "USDA"].map(name => {
      const row = lts?.[NAME_TO_CODE[name]] || {};
      const unitsOriginated = row.originated || 0;
      return {
        name,
        count: 1,
        unitsOriginated,
        avgSpread: "—", avgLtv: "—", avgDti: "—",
        topLenders: [l.name || ""],
        hmda: {
          hasData: unitsOriginated > 0,
          applications: row.applications || 0,
          originated: unitsOriginated,
          volume: row.dollarVolume || 0,
          medianSpread,
          medianCltv,
          loanPurposes: [],
        },
      };
    });
  }, [productsSelectedLender, panelYear, productsLtSnapshot]);

  /**
   * When a lender is selected, normalize their row so dataYear matches panelYear —
   * getPanelDisposition filters by dataYear, so if the stored object has 2025 but
   * panelYear is 2024 the disposition would be empty.
   */
  const lenderForTables = useMemo(() => {
    if (!productsSelectedLender) return null;
    return { ...productsSelectedLender, dataYear: panelYear };
  }, [productsSelectedLender, panelYear]);

  const productMembersByName = useMemo(() => {
    const buckets = Object.fromEntries(ALL_PRODUCTS.map((p) => [p, []]));
    for (const lender of panelYearLenders) {
      for (const product of lender.products || []) {
        if (buckets[product]) buckets[product].push(lender);
      }
    }
    return buckets;
  }, [panelYearLenders]);

  // Product counts for filter chips (manifest when available, else year-scoped panel).
  const prodCounts = useMemo(() => {
    if (lenderManifest?.prodCounts) return lenderManifest.prodCounts;
    const map = { all: panelYearLenders.length };
    for (const p of ALL_PRODUCTS) map[p] = productMembersByName[p]?.length || 0;
    return map;
  }, [lenderManifest, panelYearLenders, productMembersByName]);

  const productSummaryForYear = useMemo(() => {
    if (!productSummaryData?.products?.length) return null;
    if (Number(productSummaryData.meta?.dataYear) !== panelYear) return null;
    return productSummaryData;
  }, [productSummaryData, panelYear]);

  // Product distribution — year-scoped summary JSON; fallback to in-memory panel lenders.
  const productDistribution = useMemo(() => {
    const year = panelYear;
    const yearLenders = panelYearLenders;
    const enrichHmda = (p) => {
      const ltCode = HMDA_PRODUCT_LOAN_TYPE_CODE[p.name];
      const unitsOriginated = p.unitsOriginated ?? (ltCode ? sumLoanTypeUnitsForLenders(yearLenders, ltCode, LENDERS, year) : null);
      const hmda = yearLenders.length
        ? aggregateProductHmdaMetrics(yearLenders, p.name, {
            allLenders: LENDERS,
            panelYear: year,
            unitsOriginated,
          })
        : (p.hmda || { hasData: false, applications: 0, originated: 0 });
      return {
        name: p.name,
        count: p.count,
        unitsOriginated,
        avgSpread: "—",
        avgLtv: "—",
        avgDti: "—",
        topLenders: p.topLenders || [],
        hmda,
      };
    };
    if (productSummaryForYear?.products?.length) {
      return productSummaryForYear.products.map(enrichHmda);
    }
    return ALL_PRODUCTS.map((name) => {
      const members = productMembersByName[name] || [];
      const withSpread = members.filter((l) => creditRateSpreadSortValue(l) != null);
      const withLtv = members.filter((l) => creditLtvSortValue(l) != null);
      const withDti = members.filter((l) => creditDtiSortValue(l) != null);
      const avgSpread = withSpread.length ? Math.round(withSpread.reduce((s, l) => s + (creditRateSpreadSortValue(l) || 0), 0) / withSpread.length * 100) / 100 : "—";
      const avgLtv = withLtv.length ? Math.round(withLtv.reduce((s, l) => s + l.maxLtv, 0) / withLtv.length) : "—";
      const avgDti = withDti.length ? Math.round(withDti.reduce((s, l) => s + l.maxDti, 0) / withDti.length) : "—";
      const topLenders = [...members].sort((a, b) => (b.dollarVol || 0) - (a.dollarVol || 0)).slice(0, 5).map(l => l.name);
      const ltCode = HMDA_PRODUCT_LOAN_TYPE_CODE[name];
      const unitsOriginated = ltCode ? sumLoanTypeUnitsForLenders(panelYearLenders, ltCode, LENDERS, panelYear) : null;
      const hmda = aggregateProductHmdaMetrics(panelYearLenders, name, {
        allLenders: LENDERS,
        panelYear,
        unitsOriginated,
      });
      return { name, count: members.length, unitsOriginated, avgSpread, avgLtv, avgDti, topLenders, hmda };
    });
  }, [productSummaryForYear, productMembersByName, panelYearLenders, LENDERS, panelYear]);

  const channelCounts = useMemo(() => {
    if (lenderManifest?.channelCounts) return lenderManifest.channelCounts;
    const map = { all: panelYearLenders.length };
    ["retail","wholesale","correspondent"].forEach(ch => {
      map[ch] = panelYearLenders.filter(l => l.channel === ch).length;
    });
    return map;
  }, [lenderManifest, panelYearLenders]);

  const openDimensionOnMap = useCallback((payload) => {
    const config = payload?.row?.drill || payload?.config
    const row = payload?.row
    if (!config) return
    if (config.product) setProdF(config.product)
    const mapMetric = config.mapMetric || 'units'
    setGeoMapMetric(mapMetric === 'avgLoan' ? 'avg' : mapMetric)
    setForceResults(true)
    setTab('geography')
    if (location.pathname !== '/geography') {
      navigate('/geography')
    }
    setMapSelectedState(null)
    setMapSelectedCountyCode(null)
    setMapSelectedCensusTract(null)
    setGeoMapUiResetNonce((n) => n + 1)
  }, [location.pathname, navigate])

  const handleDimensionRowDrill = useCallback(({ table, row }) => {
    if (!row?.drill) return
    openDimensionOnMap({ table, row, config: row.drill })
  }, [openDimensionOnMap])

  const [geoMapYear, setGeoMapYear] = useState(HMDA_PREFERRED_YEAR);
  /** Explicit lender map focus (grid/list map icon); overrides search-only resolution. */
  const [mapFocusLenderKey, setMapFocusLenderKey] = useState(null);

  useEffect(() => {
    setGeoMapYear(String(yearF));
  }, [yearF]);

  const geoDrilldownSliceYear = useMemo(
    () => resolveGeoDrilldownYear(geoDrilldownHmda, geoMapYear),
    [geoDrilldownHmda, geoMapYear],
  );

  const lendersWithSuggest = useMemo(() => {
    if (!suggestLenders.length) return LENDERS;
    const normalized = suggestLenders.map((l) => ({
      ...l,
      id:
        l.lei && l.dataYear
          ? `${String(l.lei).trim().toUpperCase()}|${Number(l.dataYear)}`
          : l.id || l.lei || l.nmls || "",
      originations: l.originations ?? l.orig ?? 0,
      nmls: String(l.nmls || l.nmlsNumber || ""),
      type: l.type || "",
      products: l.products || [],
      stateList: l.stateList || [],
      channel: l.channel || "",
      status: l.status || "",
    }));
    const existingKeys = new Set(LENDERS.map((l) => `${l.lei}|${l.dataYear}`));
    const extra = normalized.filter((l) => !existingKeys.has(`${l.lei}|${l.dataYear}`));
    return extra.length ? [...LENDERS, ...extra] : LENDERS;
  }, [LENDERS, suggestLenders]);

  const geoMapLender = useMemo(() => {
    const mapYear =
      tab === "geography"
        ? Number(geoMapYear) || panelYear
        : panelYear;
    if (mapFocusLenderKey?.lei) {
      const lei = String(mapFocusLenderKey.lei).trim().toUpperCase();
      const year = Number(mapFocusLenderKey.year) || mapYear;
      const ref = { ...mapFocusLenderKey, lei, dataYear: year };
      const fromKey = findLenderInList(lendersWithSuggest, ref);
      if (fromKey) return fromKey;
      return {
        id: `${lei}|${year}`,
        lei,
        name: mapFocusLenderKey.name || `LEI ${lei}`,
        nmls: String(mapFocusLenderKey.nmls || ""),
        dataYear: year,
        originations:
          mapFocusLenderKey.originations ??
          mapFocusLenderKey.units ??
          mapFocusLenderKey.orig ??
          0,
        type: mapFocusLenderKey.type || "",
        products: mapFocusLenderKey.products || [],
        stateList: mapFocusLenderKey.stateList || [],
        channel: mapFocusLenderKey.channel || "",
        status: mapFocusLenderKey.status || "",
        hmdaInsights: mapFocusLenderKey.hmdaInsights || null,
      };
    }
    if (q && String(q).trim().length >= 2) return resolveMapLenderFromSearch(q, lendersWithSuggest, mapYear);
    return null;
  }, [mapFocusLenderKey, q, lendersWithSuggest, panelYear, geoMapYear, tab]);

  const [geoMapLenderInsights, setGeoMapLenderInsights] = useState(null);
  const [geoMapLenderInsightsLoading, setGeoMapLenderInsightsLoading] = useState(false);

  useEffect(() => {
    if (!geoMapLender?.lei) {
      setGeoMapLenderInsights(null);
      setGeoMapLenderInsightsLoading(false);
      return;
    }
    const rawInsightYear =
      tab === "geography"
        ? Number(geoMapYear) || Number(geoMapLender.dataYear) || Number(mapFocusLenderKey?.year) || panelYear
        : Number(geoMapLender.dataYear) || Number(mapFocusLenderKey?.year) || Number(geoMapYear) || panelYear;
    const insightYear = larDetailYearForPanel(rawInsightYear);
    const existing = geoMapLender.hmdaInsights?.stateBreakdown;
    if (
      Array.isArray(existing) &&
      existing.length > 0 &&
      hmdaInsightsMatchesYear(geoMapLender.hmdaInsights, insightYear)
    ) {
      setGeoMapLenderInsights(geoMapLender.hmdaInsights);
      return;
    }
    setGeoMapLenderInsights(null);
    setGeoMapLenderInsightsLoading(true);
    let cancelled = false;
    const lei = String(geoMapLender.lei).trim().toUpperCase();
    fetchFullLenderInsights(lei, insightYear, { includeMedians: false })
      .then((ins) => {
        if (cancelled) return;
        if (ins && !ins.error) {
          setGeoMapLenderInsights(ins);
          setMapFocusLenderKey((prev) => {
            if (!prev || String(prev.lei || "").trim().toUpperCase() !== lei) return prev;
            return { ...prev, hmdaInsights: ins };
          });
          setLENDERS((prev) =>
            prev.map((l) => {
              if (String(l.lei || "").toUpperCase() !== lei) return l;
              const ly = larDetailYearForPanel(Number(l.dataYear) || panelYear);
              if (ly !== insightYear) return l;
              return mergeLenderInsightsIntoRow(l, ins);
            }),
          );
        }
      })
      .catch((e) => {
        console.warn("[HMDA] map lender insights failed:", e?.message);
      })
      .finally(() => {
        if (!cancelled) setGeoMapLenderInsightsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [geoMapLender, mapFocusLenderKey, geoMapYear, panelYear, tab]);

  const mapLenderFocus = useMemo(() => {
    if (!geoMapLender) return null;
    const selectedFocusYear =
      tab === "geography"
        ? Number(geoMapYear) || Number(geoMapLender.dataYear) || Number(mapFocusLenderKey?.year) || panelYear
        : Number(geoMapLender.dataYear) || Number(mapFocusLenderKey?.year) || Number(geoMapYear) || panelYear;
    return {
      lei: geoMapLender.lei,
      name: geoMapLender.name,
      year: selectedFocusYear,
      insights: geoMapLenderInsights || geoMapLender.hmdaInsights || null,
      originations: geoMapLender.originations ?? geoMapLender.units ?? geoMapLender.orig ?? 0,
    };
  }, [geoMapLender, mapFocusLenderKey, geoMapYear, panelYear, geoMapLenderInsights, tab]);

  const searchMapLender = useMemo(() => {
    const term = (q || qInput || "").trim()
    if (term.length < 2) return null
    return resolveMapLenderFromSearch(term, lendersWithSuggest, panelYear)
  }, [q, qInput, lendersWithSuggest, panelYear])

  /**
   * When the user navigates to the Products tab with a specific lender already
   * focused in the main search, auto-populate the Products card so they see that
   * lender's breakdown without a separate search.
   */
  useEffect(() => {
    if (tab !== "products") return;
    if (productsSelectedLender) return;
    const focus = searchMapLender || (mapFocusLenderKey?.lei ? { lei: mapFocusLenderKey.lei, name: mapFocusLenderKey.name } : null);
    if (!focus?.lei) return;
    const lei = String(focus.lei).trim().toUpperCase();
    const match = panelYearLenders.find(l => String(l.lei||"").trim().toUpperCase() === lei);
    if (match) {
      setProductsSelectedLender(match);
      setProductsLenderSearch(match.name || "");
      setProductsLtSnapshot(null);
    }
  }, [tab, searchMapLender, mapFocusLenderKey, panelYearLenders, productsSelectedLender]);

  const setLenderMapFocus = useCallback(
    (lender) => {
      if (!lender?.lei) return;
      const name = String(lender.name || "").trim();
      const year = Number(lender.dataYear) || panelYear;
      const lei = String(lender.lei).trim().toUpperCase();
      setMapFocusLenderKey({
        lei,
        year,
        name,
        nmls: lender.nmls || "",
        originations: lender.originations ?? lender.units ?? lender.orig ?? 0,
        type: lender.type || "",
        products: lender.products || [],
        stateList: lender.stateList || [],
        channel: lender.channel || "",
        status: lender.status || "",
        hmdaInsights: lender.hmdaInsights || null,
      });
      setQ(name);
      setQInput(name);
      setShowSuggestions(false);
      setForceResults(true);
      setShowCensusTracts(true);
      setMapSelectedState(null);
      setMapSelectedCountyCode(null);
      setMapSelectedCensusTract(null);
      setGeoMapUiResetNonce((n) => n + 1);
    },
    [panelYear],
  );

  const openLenderOnMap = useCallback(
    (lender) => {
      if (!lender?.lei) return;
      const year = Number(lender.dataYear) || panelYear;
      setLenderMapFocus(lender);
      setTab("geography");
      setGeoMapYear(String(year));
      if (location.pathname !== "/geography") {
        navigate("/geography");
      }
    },
    [panelYear, location.pathname, navigate, setLenderMapFocus],
  );

  const openSearchLenderOnMap = useCallback(() => {
    if (!searchMapLender) return;
    openLenderOnMap(searchMapLender);
  }, [searchMapLender, openLenderOnMap]);

  const renderLenderMapBtn = (lender, { compact = false } = {}) => (
    <Tip text={TIPS["Map lender geography"]} pos="left">
      <button
        type="button"
        className={`hmda-search-lender-map-btn hmda-lender-card-map-btn${compact ? "" : " hmda-lender-card-map-btn--labeled"}`}
        onClick={(e) => {
          e.stopPropagation();
          openLenderOnMap(lender);
        }}
        aria-label={`Map ${lender.name} originations by state on geography (HMDA ${lender.dataYear || panelYear})`}
        title={`Map ${lender.name} by state`}
      >
        {IC.mapPin}
        {!compact && <span className="hmda-lender-card-map-btn__label">Map</span>}
      </button>
    </Tip>
  );

  const hmdaSearchLenderMapBtn = searchMapLender ? (
    <button
      type="button"
      className="hmda-search-lender-map-btn"
      onClick={openSearchLenderOnMap}
      aria-label={`Map ${searchMapLender.name} loan closings on geography for HMDA ${panelYear}`}
      title={`Map ${searchMapLender.name} on geography (HMDA ${panelYear})`}
    >
      {IC.mapPin}
    </button>
  ) : null

  const geoDrilldownLoadGenRef = useRef(0);

  /** Geography: static JSON first (map paint), then live FFIEC merge after idle. */
  useEffect(() => {
    if (!showResults || tab !== "geography") return;
    const year = geoMapYear || HMDA_PREFERRED_YEAR;
    const gen = ++geoDrilldownLoadGenRef.current;
    let cancelled = false;
    let liveTimer = null;

    const stillCurrent = () => !cancelled && geoDrilldownLoadGenRef.current === gen;

    if (!geoDrilldownHmda) setGeoDrilldownLoading(true);

    const applyDrilldown = (data) => {
      if (!stillCurrent() || !data) return;
      setGeoDrilldownHmda(data);
      setGeoDrilldownLoading(false);
    };

    fetchGeoDrilldownStatic(year)
      .then(async (fast) => {
        if (!stillCurrent()) return;
        const anchor = String(year || HMDA_PREFERRED_YEAR);

        if (fast?.data) {
          applyDrilldown(fast.data);
          if (fast.partial) {
            fetchGeoDrilldownFullStatic()
              .then((full) => {
                if (!stillCurrent() || !full?.data) return;
                const merged = mergeGeoDrilldownPayload(full.data, fast.data, { preferIncomingTotals: false })
                  || full.data;
                setGeoDrilldownHmda(merged);
              })
              .catch(() => {});
          }
          if (!geoDrilldownYearHasData(fast.data, anchor)) {
            hydrateGeoDrilldownYear(fast.data, anchor)
              .then((hydrated) => {
                if (stillCurrent() && hydrated) setGeoDrilldownHmda(hydrated);
              })
              .catch(() => {});
          }
        } else {
          try {
            const live = await fetchGeoDrilldown(year);
            if (stillCurrent() && live?.data) applyDrilldown(live.data);
            else if (stillCurrent()) setGeoDrilldownLoading(false);
          } catch (e) {
            if (stillCurrent()) {
              console.error("[HMDA] geo drilldown load failed:", e);
              setGeoDrilldownLoading(false);
            }
          }
          return;
        }

        const liveGeoEnabled =
          import.meta.env.VITE_HMDA_GEO_LIVE === "1" ||
          (import.meta.env.PROD && import.meta.env.VITE_HMDA_GEO_LIVE !== "0");
        if (!liveGeoEnabled) return;

        liveTimer = setTimeout(() => {
          if (!stillCurrent()) return;
          fetchGeoDrilldown(year)
            .then(({ data, source }) => {
              if (!stillCurrent() || !data) return;
              if (source !== "static") {
                console.info(`[HMDA] Geography drilldown loaded (${source})`);
              }
              setGeoDrilldownHmda(data);
            })
            .catch((e) => {
              if (!stillCurrent()) return;
              console.warn("[HMDA] geo live refresh failed:", e?.message || e);
            });
        }, 8000);
      })
      .catch(() => {
        if (!stillCurrent()) return;
        fetchGeoDrilldown(year)
          .then(({ data }) => {
            if (stillCurrent() && data) applyDrilldown(data);
            else if (stillCurrent()) setGeoDrilldownLoading(false);
          })
          .catch(() => {
            if (stillCurrent()) setGeoDrilldownLoading(false);
          });
      });

    return () => {
      cancelled = true;
      if (liveTimer) clearTimeout(liveTimer);
    };
  }, [showResults, tab, geoMapYear]);

  /** Phase 1: as soon as the Geography tab is selected, fire <link rel="prefetch"> for all
   *  map data assets (county names, metrics, tract manifest, geo-drilldown).
   *  Does NOT require mapReady — this warms the browser cache before Mapbox GL even loads. */
  useEffect(() => {
    if (tab !== "geography") return;
    const year = String(geoMapYear || panelYear || HMDA_PREFERRED_YEAR);
    let t = null;
    const prefetch = () => {
      import("./geography/preload-geography-assets.js")
        .then((m) =>
          m.preloadGeographyAssets(year, {
            includeGeoSummary: true,
            includeGeoDrilldown: false,
            includeCountyNames: true,
            includeCountyMetrics: true,
            // Prefetch the tract manifest + first national-top so they're
            // cached well before the user zooms in.
            includeTracts: true,
            includeNationalTracts: true,
          }),
        )
        .catch(() => {});
    };
    if (typeof requestIdleCallback === "function") {
      const h = requestIdleCallback(prefetch, { timeout: 1500 });
      return () => cancelIdleCallback(h);
    }
    t = setTimeout(prefetch, 300);
    return () => clearTimeout(t);
  }, [tab, panelYear, geoMapYear]);

  /** Phase 2: after map canvas is ready, fully load tracts + centroids (requires Mapbox context). */
  useEffect(() => {
    if (tab !== "geography") return;
    if (!geoMapCanvasReady) return;
    const runWhenIdle =
      typeof requestIdleCallback === "function"
        ? requestIdleCallback
        : (cb) => requestAnimationFrame(() => cb({ didTimeout: false, timeRemaining: () => 0 }));
    const cancelIdle =
      typeof cancelIdleCallback === "function"
        ? cancelIdleCallback
        : () => {};
    const idleId = runWhenIdle(() => {
      import("./geography/preload-geography-assets.js")
        .then((m) =>
          m.preloadGeographyAssets(String(geoMapYear || panelYear || HMDA_PREFERRED_YEAR), {
            includeCountyNames: true,
            includeCountyMetrics: true,
            includeTracts: showCensusTracts,
            includeNationalTracts: false,
          }),
        )
        .catch(() => {});
      if (showCensusTracts) void loadTractCentroids();
    });
    return () => cancelIdle(idleId);
  }, [tab, panelYear, geoMapYear, geoMapCanvasReady, showCensusTracts]);

  /**
   * Pre-warm geography JSON while the user is on any other tab.
   * Fires via requestIdleCallback so it never competes with the current tab's renders.
   * When the user eventually clicks Geography the data is already in memory.
   */
  useEffect(() => {
    if (!showResults || geoDrilldownHmda) return;
    let handle = null;
    const warm = () => {
      fetchGeoDrilldownStatic(panelYear || HMDA_PREFERRED_YEAR)
        .then((fast) => {
          if (fast?.data) setGeoDrilldownHmda(fast.data);
        })
        .catch(() => {});
    };
    if (typeof requestIdleCallback === "function") {
      handle = requestIdleCallback(warm, { timeout: 3000 });
    } else {
      handle = setTimeout(warm, 1500);
    }
    return () => {
      if (typeof cancelIdleCallback === "function") cancelIdleCallback(handle);
      else clearTimeout(handle);
    };
  }, [showResults, panelYear, geoDrilldownHmda]);

  useEffect(() => {
    setGeoMarketTopLenderPage(1);
  }, [panelYear]);

  const canonicalNameByLei = useMemo(() => {
    const scoreName = (name = "") => {
      const v = String(name || "").trim();
      if (!v) return -1;
      let score = 0;
      if (!isLikelyGibberishName(v)) score += 100;
      if (/[A-Za-z]/.test(v)) score += 20;
      score += Math.min(40, Math.round((v.match(/[A-Za-z]/g) || []).length / 2));
      if (/\b(LLC|INC|BANK|MORTGAGE|CORP|CREDIT|UNION)\b/i.test(v)) score += 15;
      score -= (v.match(/[0-9]/g) || []).length * 2;
      return score;
    };
    const best = new Map();
    for (const lender of LENDERS) {
      if (!lender.lei) continue;
      const prev = best.get(lender.lei);
      const next = { name: lender.name || "", score: scoreName(lender.name), year: Number(lender.dataYear || 0) };
      if (!prev || next.score > prev.score || (next.score === prev.score && next.year > prev.year)) {
        best.set(lender.lei, next);
      }
    }
    const out = new Map();
    best.forEach((v, lei) => out.set(lei, v.name));
    return out;
  }, [LENDERS]);

  const normalizeLenderForDisplay = useCallback((lender) => {
    const raw = String(lender?.name || "").trim();
    const canonical = lender?.lei ? canonicalNameByLei.get(lender.lei) : "";
    const resolved = (!raw || isLikelyGibberishName(raw)) && canonical ? canonical : raw;
    const safeName = resolved || (lender?.lei ? `LEI ${lender.lei}` : "Unknown Lender");
    if (safeName === raw) return lender;
    return { ...lender, name: safeName };
  }, [canonicalNameByLei]);

  const lendersForYear = useMemo(() => {
    const y = parseInt(yearF, 10);
    return LENDERS.filter((l) => l.dataYear === y);
  }, [LENDERS, yearF]);

  const usePaginatedLenderGrid = tab === "lenders";

  const filteredData = useMemo(() => {
    if (usePaginatedLenderGrid) {
      const list = lenderQuery.lenders || [];
      const rankMap = lenderQuery.rankMap || new Map(list.map((l) => [l.id, l.rank || l.id]));
      return { list, rankMap };
    }
    let r = lendersForYear;
    if (q) {
      const s = q.toLowerCase();
      r = r.filter(
        (l) =>
          l.name.toLowerCase().includes(s) ||
          l.nmls.includes(s) ||
          l.type.toLowerCase().includes(s) ||
          (l.lei && l.lei.toLowerCase().includes(s)) ||
          (l.channel && l.channel.toLowerCase().includes(s)) ||
          (l.stateList && l.stateList.some((st) => st.toLowerCase() === s)) ||
          (l.products && l.products.some((p) => p.toLowerCase().includes(s))) ||
          (l.status && l.status.toLowerCase().includes(s)),
      );
    }
    if (typeF !== "all") r = r.filter((l) => l.type === typeF);
    if (statusF !== "all") r = r.filter((l) => l.status === statusF);
    if (channelF !== "all") r = r.filter((l) => l.channel === channelF);
    if (prodF !== "all") r = r.filter((l) => l.products.includes(prodF));
    r = [...r].sort((a, b) => compareLendersBySortField(a, b, sortField, sortDir));
    const rankMap = new Map();
    r.forEach((lender, idx) => rankMap.set(lender.id, idx + 1));
    return { list: r, rankMap };
  }, [usePaginatedLenderGrid, lenderQuery, lendersForYear, q, sortField, sortDir, typeF, statusF, channelF, prodF]);

  const deferredFilteredData = useDeferredValue(filteredData);
  const filtered = deferredFilteredData.list;
  const lenderRankMap = deferredFilteredData.rankMap;

  const cohiUploadTheme = useMemo(
    () => ({
      dk,
      surface: c.surface,
      border: c.border,
      text: c.text,
      textMuted: c.text4,
      accent: c.accent,
      chip: c.chip,
      hmdaContext: {
        loadedLenders: lenderManifest?.recordCount ?? LENDERS.length,
        lendersMatchingFilters: filtered.length,
        selectedYear: yearF,
        dashboardTab: tab,
      },
    }),
    [dk, c.surface, c.border, c.text, c.text4, c.accent, c.chip, lenderManifest?.recordCount, LENDERS.length, filtered.length, yearF, tab],
  );

  useEffect(() => {
    if (sortField === "confidence") setSortField("dollarVol");
  }, [sortField]);
  useEffect(() => {
    setCurrentPage(1);
    setHeroTop100USA(false);
  }, [q,sortField,sortDir,typeF,statusF,channelF,prodF,yearF,viewMode]);
  useEffect(() => {
    if (tab !== "geography") {
      setMapSelectedState(null);
      setMapSelectedCountyCode(null);
      setMapSelectedCensusTract(null);
      setMapStateModalOpen(false);
      setGeoMapCanvasReady(false);
    }
  }, [tab]);

  useEffect(() => {
    setMapSelectedCountyCode(null);
    setMapSelectedCensusTract(null);
    setGeoCountyQuery("");
    setGeoCountyPage(1);
  }, [mapSelectedState, panelYear]);

  useEffect(() => {
    setGeoSupportTypeDrill("all");
  }, [panelYear, tab]);

  const displayLenders = heroTop100USA ? filtered.slice(0, 100) : filtered;
  const totalPages = usePaginatedLenderGrid
    ? Math.max(1, lenderQuery.totalPages || 1)
    : Math.max(1, Math.ceil(displayLenders.length / LENDER_PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pagedLenders = useMemo(() => {
    if (usePaginatedLenderGrid) return displayLenders;
    const start = (safePage - 1) * LENDER_PAGE_SIZE;
    return displayLenders.slice(start, start + LENDER_PAGE_SIZE);
  }, [usePaginatedLenderGrid, displayLenders, safePage]);
  const filteredRawCount = usePaginatedLenderGrid ? (lenderQuery.total || 0) : filteredData.list.length;

  /** Priority FFIEC enrich for visible page only (avoids re-running on full 4.7k list). */
  useEffect(() => {
    if (!showResults || !HMDA_FFIRC_LIVE || !pagedLenders.length) return;
    const py = Number(yearF);
    const ly = larDetailYearForPanel(py);
    const visible = pagedLenders.filter(
      (l) => Number(l.dataYear) === py && /^[A-Z0-9]{20}$/i.test(String(l.lei || "").trim()),
    );
    if (!visible.length) return;
    enrichLendersFromFfiecApi(visible, ly, applyLenderRowUpdates, { limit: LENDER_PAGE_SIZE }).catch(() => {});
  }, [showResults, yearF, safePage, viewMode, pagedLenders, applyLenderRowUpdates]);

  const [dismissedNavSearchLenderIds, setDismissedNavSearchLenderIds] = useState(() => new Set());

  useEffect(() => {
    setDismissedNavSearchLenderIds(new Set());
  }, [q]);

  const dismissNavSearchLender = useCallback(
    (l, e) => {
      e?.stopPropagation?.();
      e?.preventDefault?.();
      const key = lenderCacheKey(l);
      setDismissedNavSearchLenderIds((prev) => {
        const next = new Set(prev);
        if (key) next.add(key);
        return next;
      });
      const lei = String(l.lei || "").trim().toUpperCase();
      const year = Number(l.dataYear) || panelYear;
      setMapFocusLenderKey((prev) => {
        if (!prev?.lei) return prev;
        if (String(prev.lei).toUpperCase() === lei && (Number(prev.year) || panelYear) === year) return null;
        return prev;
      });
    },
    [panelYear],
  );

  const navSearchResults = useMemo(() => {
    const term = String(q || "").trim();
    if (!term) return [];

    const pool = new Map();
    const addMatches = (rows) => {
      for (const row of rows || []) {
        const score = scoreNavSearchLender(row, term);
        if (score <= 0) continue;
        const key = lenderCacheKey(row);
        if (!key) continue;
        const prev = pool.get(key);
        if (!prev || score > prev.score) pool.set(key, { row, score });
      }
    };

    addMatches(lendersForYear);
    addMatches(suggestLenders);
    if (!pool.size) addMatches(filtered);

    return [...pool.values()]
      .sort((a, b) => b.score - a.score || (b.row.originations || 0) - (a.row.originations || 0))
      .map(({ row }) => normalizeLenderForDisplay(row))
      .filter((l) => !dismissedNavSearchLenderIds.has(lenderCacheKey(l)))
      .slice(0, isMobile ? 4 : 8);
  }, [q, lendersForYear, suggestLenders, filtered, normalizeLenderForDisplay, isMobile, dismissedNavSearchLenderIds]);

  const searchSuggestions = useMemo(() => {
    const termRaw = String(qInput || "").trim();
    if (!termRaw) return [];
    const isNumericOnly = /^\d+$/.test(termRaw);
    if (!isNumericOnly && termRaw.length < 2) return [];
    const term = termRaw.toLowerCase();
    const tokens = term.split(/\s+/).filter(Boolean);
    const nameMatchesTokens = (name) => {
      const n = String(name || "").toLowerCase();
      return tokens.every((t) => n.includes(t));
    };
    const seen = new Set();
    const results = [];
    const addUnique = (label, category) => {
      const key = label.toLowerCase();
      if (!seen.has(key) && results.length < 10) {
        seen.add(key);
        results.push({ label, category });
      }
    };
    const searchPool = lendersForYear.length ? lendersForYear : LENDERS;
    const lenderNameMatches = (suggestLenders.length ? suggestLenders : searchPool)
      .filter((l) => nameMatchesTokens(l.name))
      .sort((a, b) => (b.units || b.originations || b.orig || 0) - (a.units || a.originations || a.orig || 0));
    for (const l of lenderNameMatches) {
      if (results.length >= 10) break;
      addUnique(l.name, "Lender");
    }
    for (const l of searchPool) {
      if (results.length >= 10) break;
      if (l.nmls && String(l.nmls).toLowerCase().includes(term)) addUnique(`${l.nmls} — ${l.name}`, "NMLS");
      if (l.lei && l.lei.toLowerCase().includes(term)) addUnique(`${l.lei} — ${l.name}`, "LEI");
    }
    if (results.length < 10) {
      const types = [...new Set(searchPool.map((l) => l.type))].filter((t) => t.toLowerCase().includes(term));
      types.forEach((t) => addUnique(t, "Type"));
    }
    if (results.length < 10) {
      const channels = [...new Set(searchPool.map((l) => l.channel).filter(Boolean))].filter((ch) => ch.toLowerCase().includes(term));
      channels.forEach((ch) => addUnique(ch, "Channel"));
    }
    if (results.length < 10) {
      const products = [...new Set(searchPool.flatMap((l) => l.products || []))].filter((p) => p.toLowerCase().includes(term));
      products.forEach((p) => addUnique(p, "Product"));
    }
    if (results.length < 10) {
      for (const [code, name] of Object.entries(STATE_NAMES)) {
        if (results.length >= 10) break;
        if (name.toLowerCase().includes(term) || code.toLowerCase().includes(term)) addUnique(`${code} — ${name}`, "State");
      }
    }
    if (results.length < 10 && term.length >= 2 && geoDrilldownHmda && countyFipsNames && typeof countyFipsNames === "object") {
      const y = geoDrilldownSliceYear;
      const byYear = geoDrilldownHmda[y] || {};
      outer: for (const [st, row] of Object.entries(byYear)) {
        for (const cRow of row?.counties || []) {
          if (!cRow) continue;
          if (results.length >= 10) break outer;
          const co = normCountyCode(cRow.countyCode);
          const key = `${st}-${co}`;
          const nm = countyFipsNames[key];
          const label = nm ? `${nm} (${key})` : `${key} (County)`;
          if (!label.toLowerCase().includes(term) && !`${st} ${co}`.toLowerCase().includes(term)) continue;
          addUnique(label, "County");
        }
      }
    }
    return results;
  }, [qInput, LENDERS, lendersForYear, suggestLenders, geoDrilldownHmda, countyFipsNames, geoDrilldownSliceYear]);

  const commitSearch = useCallback((val) => {
    const v = (val || "").trim();
    setQInput(v); setShowSuggestions(false);
    if (v) {
      const lender = resolveMapLenderFromSearch(v, lendersWithSuggest, panelYear);
      if (lender?.lei) {
        // Hero page → show preview card so user can choose where to go.
        if (!showResults) {
          setHeroPreviewLender(lender);
          setQ(v);
          return;
        }
        // Lenders tab → filter the list to that lender (the accordion card
        // already shows everything; no redirect needed).
        if (tab === "lenders") {
          setHeroPreviewLender(null);
          startTransition(() => { setQ(v); });
          return;
        }
        openLenderOnMap(lender);
        return;
      }
    } else {
      setMapFocusLenderKey(null);
      setHeroPreviewLender(null);
    }
    setHeroPreviewLender(null);
    startTransition(() => {
      setQ(v);
      if (v) setForceResults(true);
    });
  }, [lendersWithSuggest, panelYear, openLenderOnMap, showResults, tab]);

  const suggestionToQueryValue = useCallback((s) => {
    if (s.category === "NMLS" || s.category === "LEI" || s.category === "State") {
      return String(s.label).split(" — ")[0];
    }
    return s.label;
  }, []);

  const clearSearch = useCallback(() => {
    setQ("");
    setQInput("");
    setShowSuggestions(false);
    setMapFocusLenderKey(null);
    setHeroPreviewLender(null);
  }, []);

  /** Logo / Home — return to `/` hero search landing (SPA reset, no full reload). */
  const goToLandingHome = useCallback(() => {
    setForceResults(false);
    setQ("");
    setQInput("");
    setShowSuggestions(false);
    setSelected(null);
    setHeroTop100USA(false);
    setLendersExplicitList(false);
    setViewMode("grid");
    setTab("lenders");
    setMobileMenuOpen(false);
    setCompareOpen(false);
    setDemoActive(false);
    setMapFocusLenderKey(null);
    if (location.pathname !== "/") {
      navigate("/");
    }
  }, [location.pathname, navigate]);

  const onLandingLogoNavClick = useCallback(
    (e) => {
      const path = location.pathname;
      const onDataBank =
        path === "/" ||
        path === "/products" ||
        path === "/geography" ||
        path === "/hmda" ||
        path.startsWith("/hmda/");
      if (!onDataBank) return;

      if (path !== "/" || showResults) {
        e.preventDefault();
        goToLandingHome();
      }
    },
    [location.pathname, showResults, goToLandingHome],
  );

  useEffect(() => {
    if (!showSuggestions) return;
    const onDown = (e) => {
      if (e.target.closest?.("[data-hmda-search-ui]")) return;
      setShowSuggestions(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [showSuggestions]);

  const countyGlobalSearchResults = useMemo(() => {
    const term = String(q || "").trim().toLowerCase();
    if (!term) return [];
    const y = geoDrilldownSliceYear;
    const byYear = geoDrilldownHmda?.[y] || {};
    const rows = [];
    Object.entries(byYear).forEach(([stateCode, stateRow]) => {
      (stateRow?.counties || []).filter(Boolean).forEach((cRow) => {
        const countyCode = normCountyCode(cRow.countyCode);
        const countyKey = `${stateCode}-${countyCode}`;
        const countyName = countyFipsNames[countyKey] || null;
        const countyLabel = countyName ? `${countyName} (${countyKey})` : `${countyKey} (County FIPS ${countyCode})`;
        const searchText = `${countyLabel} ${stateCode} ${countyCode}`.toLowerCase();
        if (!searchText.includes(term)) return;
        rows.push({
          stateCode,
          countyCode,
          countyLabel,
          units: cRow.units || 0,
          volume: cRow.volume || 0,
        });
      });
    });
    return rows
      .sort((a, b) => (b.units || 0) - (a.units || 0))
      .slice(0, isMobile ? 5 : 10);
  }, [q, isMobile, geoDrilldownHmda, countyFipsNames, geoDrilldownSliceYear]);

  const doSort = useCallback((f) => {
    startTransition(() => {
      if (sortField === f) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortField(f);
        setSortDir(f === "name" || f === "currentRate" ? "asc" : "desc");
      }
    });
  }, [sortField]);
  const doProductSort = useCallback((field) => {
    startTransition(() => {
      if (productSortField === field) {
        setProductSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setProductSortField(field);
        setProductSortDir(field === "name" ? "asc" : "desc");
      }
    });
  }, [productSortField]);
  const doGeoSort = useCallback((field) => {
    startTransition(() => {
      if (geoSortField === field) {
        setGeoSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setGeoSortField(field);
        setGeoSortDir(field === "state" ? "asc" : "desc");
      }
    });
  }, [geoSortField]);
  const doProductCardSort = useCallback((field) => {
    if (productCardSortField === field) {
      setProductCardSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setProductCardSortField(field);
      setProductCardSortDir(field === "name" ? "asc" : "desc");
    }
  }, [productCardSortField]);
  const openLender = useCallback((l) => {
    if (!l) return;
    const key = lenderCacheKey(l);
    if (key) {
      lendersViewedRef.current.push({
        key,
        lei: l.lei,
        dataYear: l.dataYear,
        ...(typeof l.name === "string" && l.name.trim() ? { name: l.name.trim().slice(0, 120) } : {}),
      });
    }
    setHistView(null);
    const full = findLenderInList(LENDERS, l);
    let pick = l;
    if (full) {
      const sameLei =
        l.lei &&
        full.lei &&
        String(l.lei).trim().toUpperCase() === String(full.lei).trim().toUpperCase();
      const sameName = normLenderName(l.name) === normLenderName(full.name);
      if (sameLei || sameName) pick = full;
    }
    setSelected(pick);
  }, [LENDERS]);
  const handleReset = goToLandingHome;
  const openCountyFromGlobalSearch = useCallback((stateCode, countyCode) => {
    setTab("geography");
    setMapSelectedState(stateCode);
    setMapSelectedCountyCode(normCountyCode(countyCode));
    setMapSelectedCensusTract(null);
    setMapStateModalOpen(false);
  }, []);
  const togglePin = useCallback((lender) => {
    const key = lenderCacheKey(lender) || lender.id;
    setPinnedIds((prev) => {
      if (prev.includes(key)) return prev.filter((id) => id !== key);
      if (prev.length >= maxPinnedLenders) return prev;
      return [...prev, key];
    });
  }, [maxPinnedLenders]);
  const clearPinned = useCallback(() => setPinnedIds([]), []);

  /** Returns true if a lender is currently pinned (handles both LEI|year and legacy id keys). */
  const isPinned = useCallback(
    (lender) => {
      if (!lender) return false;
      const key = lenderCacheKey(lender) || lender.id;
      return pinnedIds.includes(key);
    },
    [pinnedIds],
  );

  const lendersByKey = useMemo(() => {
    const map = new Map();
    LENDERS.forEach((l) => {
      const key = lenderCacheKey(l) || l.id;
      map.set(key, l);
      map.set(l.id, l); // keep id fallback for older pinned state
    });
    return map;
  }, [LENDERS]);

  // Keep lendersById for any remaining usages that reference it
  const lendersById = useMemo(() => {
    const map = new Map();
    LENDERS.forEach((l) => map.set(l.id, l));
    return map;
  }, [LENDERS]);

  const pinnedLenders = useMemo(
    () => pinnedIds.map((id) => lendersByKey.get(id) || lendersById.get(id)).filter(Boolean),
    [pinnedIds, lendersByKey, lendersById]
  );

  useEffect(() => {
    if (!compareOpen && pinnedIds.length === 0) return;
  }, [compareOpen, pinnedIds, pinnedLenders, panelYear]);

  const searchLenderIsPinned = searchMapLender ? isPinned(searchMapLender) : false;
  const searchLenderPinDisabled =
    !searchLenderIsPinned && pinnedLenders.length >= maxPinnedLenders;

  const hmdaSearchLenderPinBtn = searchMapLender ? (
    <Tip
      text={
        searchLenderPinDisabled
          ? `Maximum ${maxPinnedLenders} lenders pinned`
          : searchLenderIsPinned
            ? "Unpin from compare"
            : "Pin to compare"
      }
      pos="bottom"
    >
      <button
        type="button"
        className={`hmda-search-lender-pin-btn${searchLenderIsPinned ? " is-active" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          if (searchLenderPinDisabled) return;
          togglePin(searchMapLender);
        }}
        disabled={searchLenderPinDisabled}
        aria-pressed={searchLenderIsPinned}
        aria-label={
          searchLenderIsPinned
            ? `Unpin ${searchMapLender.name} from compare`
            : `Pin ${searchMapLender.name} to compare`
        }
        title={
          searchLenderIsPinned
            ? "Pinned"
            : searchLenderPinDisabled
              ? `Pin limit ${maxPinnedLenders} reached`
              : "Pin to compare"
        }
      >
        <Pin size={14} strokeWidth={2.2} aria-hidden />
      </button>
    </Tip>
  ) : null;

  const [trackRecordOpen, setTrackRecordOpen] = useState(false);
  /** Year-range scope for track record: { mode: 'all' | 'range', start, end } */
  const [trackRecordRange, setTrackRecordRange] = useState({ mode: "all", start: null, end: null });

  /** Per-year rows for the searched lender (LEI × year time series). */
  const searchLenderTrackRows = useMemo(() => {
    if (!searchMapLender?.lei) return [];
    const lei = String(searchMapLender.lei).trim().toUpperCase();
    const rows = LENDERS.filter((l) => String(l.lei || "").trim().toUpperCase() === lei);
    rows.sort((a, b) => Number(a.dataYear) - Number(b.dataYear));
    return rows.map((r) => {
      const h = r.hmdaInsights;
      const apps = Number(h?.totalApplications) || 0;
      const denials = Number(h?.denialCount) || 0;
      return {
        year: Number(r.dataYear),
        units: Number(r.originations || r.units || 0),
        volume: Number(r.dollarVol || 0),
        applications: apps,
        denials,
        denialRate: apps > 0 ? denials / apps : null,
      };
    });
  }, [searchMapLender, LENDERS]);

  const trackRecordScopedRows = useMemo(() => {
    if (!searchLenderTrackRows.length) return [];
    if (trackRecordRange.mode === "all") return searchLenderTrackRows;
    const s = Number(trackRecordRange.start);
    const e = Number(trackRecordRange.end);
    if (!Number.isFinite(s) || !Number.isFinite(e)) return searchLenderTrackRows;
    return searchLenderTrackRows.filter((r) => r.year >= Math.min(s, e) && r.year <= Math.max(s, e));
  }, [searchLenderTrackRows, trackRecordRange]);

  const trackRecordTotals = useMemo(() => {
    const t = trackRecordScopedRows.reduce(
      (acc, r) => ({
        units: acc.units + r.units,
        volume: acc.volume + r.volume,
        applications: acc.applications + r.applications,
        denials: acc.denials + r.denials,
      }),
      { units: 0, volume: 0, applications: 0, denials: 0 },
    );
    const peakYearRow = trackRecordScopedRows.reduce(
      (best, r) => (best == null || r.units > best.units ? r : best),
      null,
    );
    const denialRate = t.applications > 0 ? t.denials / t.applications : null;
    return { ...t, peakYearRow, denialRate };
  }, [trackRecordScopedRows]);

  const trackRecordYearOptions = useMemo(
    () => AVAILABLE_YEARS.map(String),
    [AVAILABLE_YEARS],
  );

  useEffect(() => {
    if (!trackRecordOpen) return;
    if (trackRecordRange.mode !== "range") return;
    if (trackRecordRange.start && trackRecordRange.end) return;
    if (!searchLenderTrackRows.length) return;
    const years = searchLenderTrackRows.map((r) => r.year);
    setTrackRecordRange((prev) => ({
      mode: "range",
      start: prev.start || String(Math.min(...years)),
      end: prev.end || String(Math.max(...years)),
    }));
  }, [trackRecordOpen, trackRecordRange.mode, trackRecordRange.start, trackRecordRange.end, searchLenderTrackRows]);

  const hmdaSearchLenderTrackBtn = searchMapLender ? (
    <Tip text={`Track record across years`} pos="bottom">
      <button
        type="button"
        className={`hmda-search-lender-track-btn${trackRecordOpen ? " is-active" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          setTrackRecordOpen((v) => !v);
        }}
        aria-pressed={trackRecordOpen}
        aria-label={`Show ${searchMapLender.name} track record across HMDA years`}
        title={`Track record · ${searchMapLender.name}`}
      >
        <TrendingUp size={14} strokeWidth={2.2} aria-hidden />
      </button>
    </Tip>
  ) : null;

  const [pinnedInsightsMap, setPinnedInsightsMap] = useState(() => new Map());
  const mapInsightsFetchedRef = useRef(new Set());

  /** Geography map: batch FFIEC state breakdown for pinned compare lenders (primary uses dedicated fetch above). */
  useEffect(() => {
    if (tab !== "geography") return;
    const rawInsightYear =
      Number(geoMapYear) ||
      Number(geoMapLender?.dataYear) ||
      Number(mapFocusLenderKey?.year) ||
      panelYear;
    const insightYear = larDetailYearForPanel(rawInsightYear);
    const primaryLei = geoMapLender?.lei ? String(geoMapLender.lei).trim().toUpperCase() : null;
    const candidates = [];
    for (const p of pinnedLenders) {
      const lei = String(p.lei || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{20}$/.test(lei)) continue;
      if (primaryLei && lei === primaryLei) continue;
      if (mapInsightsFetchedRef.current.has(`${lei}|${insightYear}`)) continue;
      if (pinnedInsightsMap.has(lei)) continue;
      const rowInsights = pinnedInsightsMap.get(lei) || p.hmdaInsights;
      const has =
        Array.isArray(rowInsights?.stateBreakdown) &&
        rowInsights.stateBreakdown.length > 0 &&
        hmdaInsightsMatchesYear(rowInsights, insightYear);
      if (!has) candidates.push({ lei });
    }
    if (!candidates.length) return;
    let cancelled = false;
    const leis = [...new Set(candidates.map((c) => c.lei))];
    for (const lei of leis) mapInsightsFetchedRef.current.add(`${lei}|${insightYear}`);

    fetchMapLenderInsightsBatch(leis, insightYear)
      .then((map) => {
        if (cancelled || !map) return;
        setPinnedInsightsMap((prev) => {
          const next = new Map(prev);
          for (const [lei, ins] of Object.entries(map)) {
            if (ins) next.set(lei, ins);
          }
          return next;
        });
        setLENDERS((prev) =>
          prev.map((l) => {
            const lei = String(l.lei || "").trim().toUpperCase();
            const ins = map[lei];
            if (!ins) return l;
            const ly = larDetailYearForPanel(Number(l.dataYear) || panelYear);
            if (ly !== insightYear) return l;
            return mergeLenderInsightsIntoRow(l, ins);
          }),
        );
      })
      .catch((e) => {
        if (!cancelled) console.warn("[HMDA] map insights batch failed:", e?.message);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, geoMapLender, pinnedLenders, geoMapYear, mapFocusLenderKey, panelYear, pinnedInsightsMap]);

  const mapLenderFocusList = useMemo(() => {
    const list = [];
    if (geoMapLender) {
      list.push({
        lei: String(geoMapLender.lei || "").toUpperCase(),
        name: geoMapLender.name,
        year: mapLenderFocus?.year || panelYear,
        insights: geoMapLenderInsights || geoMapLender.hmdaInsights || null,
        color: LENDER_MAP_COLORS[0],
      });
    }
    let colorIdx = 1;
    for (const p of pinnedLenders) {
      const lei = String(p.lei || "").toUpperCase();
      if (!lei) continue;
      if (list.some((x) => x.lei === lei)) continue;
      list.push({
        lei,
        name: p.name,
        year: larDetailYearForPanel(Number(p.dataYear) || panelYear),
        insights: pinnedInsightsMap.get(lei) || p.hmdaInsights || null,
        color: LENDER_MAP_COLORS[colorIdx % LENDER_MAP_COLORS.length],
      });
      colorIdx++;
    }
    return list;
  }, [geoMapLender, geoMapLenderInsights, pinnedLenders, pinnedInsightsMap, mapLenderFocus, panelYear]);

  const productDrillRows = useMemo(() => {
    const rows = productDistribution.map((p) => ({
      name: p.name,
      lenders: p.count,
      avgSpread: p.avgSpread,
      avgLtv: p.avgLtv,
      avgDti: p.avgDti,
    }));
    return rows.sort((a, b) => {
      let av = a[productSortField];
      let bv = b[productSortField];
      if (typeof av === "string") {
        av = av.toLowerCase();
        bv = bv.toLowerCase();
      }
      if (av === bv) return 0;
      return productSortDir === "asc" ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });
  }, [productDistribution, productSortField, productSortDir]);

  const geoStateData = useMemo(() => {
    const y = geoDrilldownSliceYear;
    const geoYear = geoDrilldownHmda?.[y] || {};
    const allStates = [...new Set(Object.keys(STATE_NAMES))];
    const rows = allStates.map((st) => {
      const geo = geoYear[st];
      const loanUnits = geo ? (geo.units || 0) : 0;
      const loanVolume = geo ? (geo.volume || 0) : 0;
      const countyCount = geo ? (geo.counties || []).length : 0;
      return { state: st, loanUnits, volume: loanVolume, countyCount };
    });
    const maxUnits = Math.max(1, ...rows.map(r => r.loanUnits));
    return rows.map(r => ({
      ...r,
      density: r.loanUnits ? Math.round((r.loanUnits / maxUnits) * 1000) / 10 : 0,
    })).sort((a, b) => b.loanUnits - a.loanUnits);
  }, [geoDrilldownSliceYear, geoDrilldownHmda]);

  const geographyDispositionSnapshot = useMemo(() => {
    if (tab !== "geography") return null;
    const dispositionYear = resolveDispositionYear(panelYearLenders, panelYear);
    return {
      byState: buildDispositionByState(panelYearLenders, dispositionYear),
      national: getPanelDisposition(panelYearLenders, dispositionYear),
      dispositionYear,
    };
  }, [tab, panelYearLenders, panelYear]);

  const geographyTabAnalytics = useGeographyTabAnalytics({
    tab,
    lenders: LENDERS,
    panelYear,
    geoLenderRankBy,
    geoTopNLimit,
    geoMapLender,
    mapLenderFocusList,
    geoStateData,
    geoSupportTypeDrill,
  });

  const geographyDrillRows = useMemo(() => {
    const rows = geoStateData.map((s) => ({
      state: s.state,
      countyCount: s.countyCount || 0,
      density: s.density,
      loanUnits: s.loanUnits || 0,
      volume: s.volume || 0,
    }));
    return rows.sort((a, b) => {
      let av = a[geoSortField];
      let bv = b[geoSortField];
      if (typeof av === "string") {
        av = av.toLowerCase();
        bv = bv.toLowerCase();
      }
      if (av === bv) return 0;
      return geoSortDir === "asc" ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });
  }, [geoStateData, geoSortField, geoSortDir]);

  const geoStateMapByCode = useMemo(
    () => Object.fromEntries(geoStateData.map((s) => [s.state, s])),
    [geoStateData]
  );

  /** Legacy SVG tract dots — disabled; Mapbox tract layer handles this. */
  const censusTractMapDots = useMemo(() => [], []);

  const selectedMapStateData = useMemo(
    () => (mapSelectedState ? geoStateMapByCode[mapSelectedState] || null : null),
    [mapSelectedState, geoStateMapByCode]
  );

  const selectedStateLenderRows = useMemo(() => {
    if (!mapSelectedState) return [];
    const st = mapSelectedState;
    return LENDERS
      .filter((l) => Number(l.dataYear) === panelYear)
      .map(normalizeLenderForDisplay)
      .map((l) => {
        const breakdown = Array.isArray(l.hmdaInsights?.stateBreakdown) ? l.hmdaInsights.stateBreakdown : [];
        const row = breakdown.find((s) => s && s.state === st);
        const stateOrig = row?.originated ?? 0;
        const nationalOrig = l.originations || 0;
        const nationalVol = l.dollarVol || 0;
        const avgLoan = nationalOrig > 0 ? nationalVol / nationalOrig : 0;
        const useState = stateOrig > 0;
        return {
          ...l,
          estStateUnits: useState ? stateOrig : nationalOrig,
          estStateVol: useState ? Math.round(stateOrig * avgLoan) : nationalVol,
        };
      })
      .sort((a, b) => (b.estStateUnits || 0) - (a.estStateUnits || 0));
  }, [LENDERS, mapSelectedState, panelYear, normalizeLenderForDisplay]);

  useEffect(() => {
    if (tab !== "geography") return;
  }, [tab, panelYear, geoMapYear, geoDrilldownSliceYear, mapSelectedState, LENDERS.length, panelYearLenders.length, selectedStateLenderRows.length, geoStateData]);

  const selectedStateGeoFacts = useMemo(() => {
    if (!mapSelectedState) return null;
    const y = geoDrilldownSliceYear;
    const inYear = geoDrilldownHmda?.[y];
    const row = inYear?.[mapSelectedState];
    if (!row) return null;
    const safeCounties = Array.isArray(row.counties)
      ? row.counties
          .filter(Boolean)
          .map((cRow) => ({
            ...cRow,
            topCensusTracts: Array.isArray(cRow?.topCensusTracts) ? cRow.topCensusTracts.filter(Boolean) : [],
          }))
      : [];
    return {
      year: Number(y),
      units: row.units || 0,
      volume: row.volume || 0,
      counties: safeCounties,
      note: geoDrilldownHmda?.meta?.note || "City/ZIP unavailable in this HMDA file variant.",
    };
  }, [mapSelectedState, geoDrilldownSliceYear, geoDrilldownHmda]);

  useEffect(() => {
    if (!mapStateModalOpen || !selectedStateGeoFacts || mapSelectedCountyCode) return;
    const firstCounty = selectedStateGeoFacts.counties?.[0]?.countyCode || null;
    if (firstCounty) setMapSelectedCountyCode(normCountyCode(firstCounty));
  }, [mapStateModalOpen, selectedStateGeoFacts, mapSelectedCountyCode]);

  useEffect(() => {
    setMapSelectedCensusTract(null);
  }, [mapSelectedCountyCode]);

  const selectedCountyGeo = useMemo(() => {
    if (!selectedStateGeoFacts || !mapSelectedCountyCode) return null;
    return (
      selectedStateGeoFacts.counties.find(
        (cRow) => cRow && normCountyCode(cRow.countyCode) === normCountyCode(mapSelectedCountyCode)
      ) || null
    );
  }, [selectedStateGeoFacts, mapSelectedCountyCode]);

  useEffect(() => {
    if (!mapStateModalOpen || !selectedCountyGeo || mapSelectedCensusTract) return;
    const firstTract = selectedCountyGeo.topCensusTracts?.[0]?.censusTract || null;
    if (firstTract) setMapSelectedCensusTract(firstTract);
  }, [mapStateModalOpen, selectedCountyGeo, mapSelectedCensusTract]);

  const selectedCountyLenderRows = useMemo(() => {
    if (!selectedCountyGeo || !selectedStateGeoFacts) return [];
    const countyShare = (selectedStateGeoFacts.units || 0) > 0 ? (selectedCountyGeo.units || 0) / selectedStateGeoFacts.units : 0;
    return selectedStateLenderRows
      .map((l) => {
        const estCountyUnits = Math.round((l.estStateUnits || 0) * countyShare);
        const estCountyVol = Math.round((l.estStateVol || 0) * countyShare);
        return { ...l, estCountyUnits, estCountyVol };
      })
      .filter((l) => (l.estCountyUnits || 0) > 0)
      .sort((a, b) => (b.estCountyUnits || 0) - (a.estCountyUnits || 0));
  }, [selectedCountyGeo, selectedStateGeoFacts, selectedStateLenderRows]);

  const selectedCountyRankedRows = useMemo(() => {
    if (!selectedCountyGeo) return [];
    const countyUnits = selectedCountyGeo.units || 0;
    return selectedCountyLenderRows.map((l, idx) => ({
      ...l,
      rank: idx + 1,
      countySharePct: countyUnits ? Math.round(((l.estCountyUnits || 0) / countyUnits) * 1000) / 10 : 0,
    }));
  }, [selectedCountyGeo, selectedCountyLenderRows]);

  const selectedCountyRankedTop20Rows = useMemo(
    () => selectedCountyRankedRows.slice(0, 20),
    [selectedCountyRankedRows]
  );

  const selectedCensusGeo = useMemo(() => {
    if (!selectedCountyGeo || !mapSelectedCensusTract) return null;
    return (
      (selectedCountyGeo.topCensusTracts || []).find(
        (t) => String(t?.censusTract || "") === String(mapSelectedCensusTract || "")
      ) || null
    );
  }, [selectedCountyGeo, mapSelectedCensusTract]);

  const selectedCensusLenderRows = useMemo(() => {
    if (!selectedCensusGeo || !selectedCountyGeo) return [];
    const countyUnits = selectedCountyGeo.units || 0;
    const tractShare = countyUnits > 0 ? (selectedCensusGeo.units || 0) / countyUnits : 0;
    return selectedCountyLenderRows
      .map((l) => {
        const estTractUnits = Math.round((l.estCountyUnits || 0) * tractShare);
        const estTractVol = Math.round((l.estCountyVol || 0) * tractShare);
        return { ...l, estTractUnits, estTractVol };
      })
      .filter((l) => (l.estTractUnits || 0) > 0)
      .sort((a, b) => (b.estTractUnits || 0) - (a.estTractUnits || 0))
      .slice(0, 8);
  }, [selectedCensusGeo, selectedCountyGeo, selectedCountyLenderRows]);

  const countyTopLenderEstByCode = useMemo(() => {
    if (!selectedStateGeoFacts || !selectedStateLenderRows.length) return {};
    const stateUnits = selectedStateGeoFacts.units || 0;
    const topState = selectedStateLenderRows[0];
    if (!topState || stateUnits <= 0) return {};
    const out = {};
    selectedStateGeoFacts.counties.filter(Boolean).forEach((cRow) => {
      const countyShare = (cRow.units || 0) / stateUnits;
      out[normCountyCode(cRow.countyCode)] = {
        name: topState.name,
        units: Math.round((topState.estStateUnits || 0) * countyShare),
      };
    });
    return out;
  }, [selectedStateGeoFacts, selectedStateLenderRows]);

  const countyTop20LendersByCode = useMemo(() => {
    if (!selectedStateGeoFacts || !selectedStateLenderRows.length) return {};
    const stateUnits = selectedStateGeoFacts.units || 0;
    if (stateUnits <= 0) return {};
    const baseTop20 = selectedStateLenderRows.slice(0, 20);
    const out = {};
    selectedStateGeoFacts.counties.filter(Boolean).forEach((cRow) => {
      const code = normCountyCode(cRow.countyCode);
      const countyShare = (cRow.units || 0) / stateUnits;
      out[code] = baseTop20.map((l) => ({
        id: l.id,
        name: l.name,
        units: Math.round((l.estStateUnits || 0) * countyShare),
      }));
    });
    return out;
  }, [selectedStateGeoFacts, selectedStateLenderRows]);

  const mapModalCountyRows = useMemo(() => {
    if (!selectedStateGeoFacts) return [];
    return selectedStateGeoFacts.counties.filter(Boolean).map((cRow) => {
      const key = normCountyCode(cRow.countyCode);
      return {
        ...cRow,
        countyCode: key,
        topCensusTracts: Array.isArray(cRow.topCensusTracts) ? cRow.topCensusTracts.filter(Boolean) : [],
        topLender: countyTopLenderEstByCode[key] || null,
        top20Lenders: countyTop20LendersByCode[key] || [],
      };
    });
  }, [selectedStateGeoFacts, countyTopLenderEstByCode, countyTop20LendersByCode]);

  const mapModalCensusCount = useMemo(
    () => mapModalCountyRows.reduce((n, cRow) => n + ((cRow.topCensusTracts || []).length || 0), 0),
    [mapModalCountyRows]
  );

  const countySearchOptions = useMemo(() => {
    if (!selectedStateGeoFacts || !mapSelectedState) return [];
    return (selectedStateGeoFacts.counties || [])
      .filter(Boolean)
      .map((cRow) => {
        const countyCode = normCountyCode(cRow.countyCode);
        const countyKey = `${mapSelectedState}-${countyCode}`;
        const countyName = countyFipsNames[countyKey];
        const countyLabel = countyName ? `${countyName} (${countyKey})` : `${countyKey} (County FIPS ${countyCode})`;
        const searchText = `${countyLabel} ${countyCode}`.toLowerCase();
        return {
          countyCode,
          countyLabel,
          units: cRow.units || 0,
          volume: cRow.volume || 0,
          searchText,
        };
      })
      .sort((a, b) => (b.units || 0) - (a.units || 0));
  }, [selectedStateGeoFacts, mapSelectedState]);

  const countySearchMatches = useMemo(() => {
    const qCounty = String(geoCountyQuery || "").trim().toLowerCase();
    if (!qCounty) return [];
    return countySearchOptions.filter((row) => row.searchText.includes(qCounty)).slice(0, 12);
  }, [geoCountyQuery, countySearchOptions]);

  const selectCountyFromSearch = useCallback((countyCode) => {
    setMapSelectedCountyCode(normCountyCode(countyCode));
    setMapSelectedCensusTract(null);
    setGeoCountyPage(1);
  }, []);

  useEffect(() => {
    setGeoCountyPage(1);
  }, [mapSelectedCountyCode]);

  const countyRankPageSize = 50;
  const countyRankTotalPages = Math.max(1, Math.ceil((selectedCountyRankedRows.length || 0) / countyRankPageSize));
  const countyRankSafePage = Math.min(geoCountyPage, countyRankTotalPages);
  const countyRankPagedRows = useMemo(() => {
    const start = (countyRankSafePage - 1) * countyRankPageSize;
    return selectedCountyRankedRows.slice(start, start + countyRankPageSize);
  }, [countyRankSafePage, selectedCountyRankedRows]);

  const productCardDrillData = useMemo(() => {
    if (!productCardDrill) return null;
    if (productDrillQuery.members?.length || productDrillQuery.total > 0) {
      const members = productDrillQuery.members || [];
      const totalUnits = members.reduce((s, l) => s + (l.units || l.originations || 0), 0);
      const totalVolume = members.reduce((s, l) => s + (l.dollarVol || 0), 0);
      const ltCode = HMDA_PRODUCT_LOAN_TYPE_CODE[productCardDrill];
      const unitsOriginated = ltCode ? sumLoanTypeUnitsForLenders(members, ltCode, LENDERS, panelYear) : null;
      const hmda = aggregateProductHmdaMetrics(members, productCardDrill, {
        allLenders: LENDERS,
        panelYear,
        unitsOriginated,
      });
      return {
        product: productCardDrill,
        members,
        totalUnits,
        totalVolume,
        totalMemberCount: productDrillQuery.total,
        yearBreakdown: [{ year: panelYear, units: totalUnits, volume: totalVolume }],
        hmda,
      };
    }
    const members = LENDERS.filter((l) => l.products.includes(productCardDrill));
    const activeYears = AVAILABLE_YEARS.map(Number).filter((y) => y >= 2022);
    const yearBreakdown = activeYears.map((y) => {
      const rows = members.filter((m) => Number(m.dataYear) === y);
      const units = rows.reduce((n, r) => n + (r.originations || 0), 0);
      const volume = rows.reduce((n, r) => n + (r.dollarVol || 0), 0);
      return { year: y, lenders: rows.length, units, volume };
    });
    const totalUnits = members.reduce((n, r) => n + (r.originations || 0), 0);
    const totalVolume = members.reduce((n, r) => n + (r.dollarVol || 0), 0);
    const sorted = [...members].sort((a, b) => {
      let av = a[productCardSortField];
      let bv = b[productCardSortField];
      if (typeof av === "string") {
        av = av.toLowerCase();
        bv = bv.toLowerCase();
      }
      if (av === bv) return 0;
      return productCardSortDir === "asc" ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });
    const yearLenders = members.filter((m) => Number(m.dataYear) === panelYear);
    const ltCode = HMDA_PRODUCT_LOAN_TYPE_CODE[productCardDrill];
    const unitsOriginated = ltCode ? sumLoanTypeUnitsForLenders(yearLenders, ltCode, LENDERS, panelYear) : null;
    const hmda = aggregateProductHmdaMetrics(yearLenders, productCardDrill, {
      allLenders: LENDERS,
      panelYear,
      unitsOriginated,
    });
    return { product: productCardDrill, members: sorted, totalUnits, totalVolume, yearBreakdown, hmda };
  }, [LENDERS, productCardDrill, productCardSortField, productCardSortDir, panelYear, productDrillQuery]);

  useEffect(() => {
    setProductCardPage(1);
  }, [productCardDrill, productCardSortField, productCardSortDir]);

  const productCardTotalPages = Math.max(
    1,
    productDrillQuery.totalPages ||
      Math.ceil((productCardDrillData?.totalMemberCount || productCardDrillData?.members?.length || 0) / PAGE_SIZE),
  );
  const productCardSafePage = Math.min(productCardPage, productCardTotalPages);
  const productCardPagedMembers = useMemo(() => {
    if (!productCardDrillData) return [];
    if (productDrillQuery.members?.length) return productDrillQuery.members;
    const start = (productCardSafePage - 1) * PAGE_SIZE;
    return productCardDrillData.members.slice(start, start + PAGE_SIZE);
  }, [productCardDrillData, productDrillQuery.members, productCardSafePage, PAGE_SIZE]);

  const lenderQuarterNowcast = useMemo(() => {
    if (!selected) return [];
    const panelRows = LENDERS.filter((l) => Number(l.dataYear) === panelYear);
    const panelUnits = panelRows.reduce((n, r) => n + (r.originations || 0), 0);
    const lenderShare = panelUnits ? (selected.originations || 0) / panelUnits : 0;
    const avgLoan = selected.originations ? (selected.dollarVol || 0) / selected.originations : AVG_LOAN_2023;

    const baseFRED = MARKET_FACTS_2025_2026.find((r) => r.fredOrigB)?.fredOrigB || 1;
    const basePMMS = (MARKET_FACTS_2025_2026.find((r) => (r.obmmi30??r.pmms30))?.obmmi30 ?? MARKET_FACTS_2025_2026.find((r) => r.pmms30)?.pmms30) || 6.5;
    const baseMBA = MARKET_FACTS_2025_2026.find((r) => r.mbaPurchase)?.mbaPurchase || 170;
    const lastSeen = { fred: baseFRED, pmms: basePMMS, mba: baseMBA };

    const rows = MARKET_FACTS_2025_2026.map((row) => {
      const fredVal = row.fredOrigB ?? lastSeen.fred;
      const pmmsVal = (row.obmmi30??row.pmms30) ?? lastSeen.pmms;
      const mbaVal = row.mbaPurchase ?? lastSeen.mba;
      if (row.fredOrigB != null) lastSeen.fred = row.fredOrigB;
      if ((row.obmmi30??row.pmms30) != null) lastSeen.pmms = (row.obmmi30??row.pmms30);
      if (row.mbaPurchase != null) lastSeen.mba = row.mbaPurchase;

      const fredFactor = fredVal / baseFRED;
      const mbaFactor = mbaVal / baseMBA;
      const rateFactor = 1 + (basePMMS - pmmsVal) * 0.05;
      const marketFactor = Math.max(0.6, Math.min(1.6, fredFactor * 0.5 + mbaFactor * 0.35 + rateFactor * 0.15));

      const unitsEstimate = Math.round((selected.originations || 0) * 0.25 * marketFactor);
      const volumeEstimate = Math.round(unitsEstimate * avgLoan);
      const lenderMarketUnitsProxy = Math.round(fredVal * 1000 * lenderShare);
      return {
        ...row,
        unitsEstimate,
        volumeEstimate,
        lenderMarketUnitsProxy,
        marketFactor,
      };
    });
    return rows.sort((a, b) => {
      const [aYearRaw, aQRaw] = String(a.quarter || "").split("-Q");
      const [bYearRaw, bQRaw] = String(b.quarter || "").split("-Q");
      const aYear = Number(aYearRaw) || 0;
      const bYear = Number(bYearRaw) || 0;
      const aQ = Number(aQRaw) || 0;
      const bQ = Number(bQRaw) || 0;
      if (aYear !== bYear) return bYear - aYear;
      return bQ - aQ;
    });
  }, [LENDERS, selected, panelYear]);

  useEffect(() => {
    if (!selected) return;
    const leiRaw = selected?.lei != null ? String(selected.lei).trim().toUpperCase() : "";
    const cacheKey = selected.id ?? leiRaw;
    if (!cacheKey || lenderRegistryCache[cacheKey]) return;
    let cancelled = false;
    const websiteInfo = resolveLenderWebsite(selected.name);
    setLenderRegistryLoading(true);
    fetchLenderRegistry({
      lei: leiRaw || undefined,
      name: selected.name,
      type: selected.type,
      nmls: selected.nmls,
      website: selected.website || (websiteInfo.websiteVerified ? websiteInfo.website : undefined),
      websiteVerified: selected.websiteVerified || websiteInfo.websiteVerified,
      branchCount: selected.branchCount ?? selected.branches,
      branchSource: selected.branchSource,
      states: selected.states,
    })
      .then((data) => {
        if (!cancelled) {
          setLenderRegistryCache((prev) => ({
            ...prev,
            [cacheKey]: mergeRegistryWithLenderRow(data, selected, websiteInfo),
          }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLenderRegistryCache((prev) => ({
            ...prev,
            [cacheKey]: mergeRegistryWithLenderRow({ error: true }, selected, websiteInfo),
          }));
        }
      })
      .finally(() => {
        if (!cancelled) setLenderRegistryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, lenderRegistryCache]);

  // --- Shared micro-components ---
  const Badge = ({children,variant="default",tip}) => {
    const m={success:{bg:c.successSoft,cl:c.success},warning:{bg:c.warningSoft,cl:c.warning},danger:{bg:c.dangerSoft,cl:c.danger},info:{bg:c.infoSoft,cl:c.info},purple:{bg:c.purpleSoft,cl:c.purple},default:{bg:c.chip,cl:c.text2}};
    const s=m[variant]||m.default;
    const inner = <span style={{display:"inline-flex",alignItems:"center",padding:"4px 10px",borderRadius:"8px",fontSize:"10.5px",fontWeight:700,letterSpacing:"0.05em",textTransform:"uppercase",background:s.bg,color:s.cl,whiteSpace:"nowrap",cursor:tip?"help":"default"}}>{children}</span>;
    return tip ? <Tip text={tip}>{inner}</Tip> : inner;
  };

  const Ring = ({value,size=48,showTip=false}) => {
    const r=(size-7)/2,ci=2*Math.PI*r,off=ci-(value/100)*ci;
    const cl=value>80?c.success:value>65?c.warning:c.danger;
    const svg = <svg width={size} height={size} style={{transform:"rotate(-90deg)",flexShrink:0,cursor:showTip?"help":"default"}}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={c.barTrack} strokeWidth="3.5"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={cl} strokeWidth="3.5" strokeDasharray={ci} strokeDashoffset={off} strokeLinecap="round" style={{transition:"stroke-dashoffset 0.8s ease"}}/>
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central" fill={cl} fontSize="12" fontWeight="700" fontFamily="'JetBrains Mono',monospace" style={{transform:"rotate(90deg)",transformOrigin:"center"}}>{value}</text>
    </svg>;
    return showTip ? <Tip text={TIPS.confidence}>{svg}</Tip> : svg;
  };

  const Bar = ({pct,color=c.accent,h=7}) => (
    <div style={{width:"100%",height:`${h}px`,borderRadius:`${h}px`,background:c.barTrack,overflow:"hidden"}}>
      <div style={{width:`${pct}%`,height:"100%",borderRadius:`${h}px`,background:color,transition:"width 0.7s cubic-bezier(0.4,0,0.2,1)"}}/>
    </div>
  );
  const PastelIcon = ({icon, bg = c.chip, fg = c.accent}) => (
    <span style={{width:"22px",height:"22px",borderRadius:"8px",display:"inline-flex",alignItems:"center",justifyContent:"center",background:bg,color:fg,border:`1px solid ${c.drillBorder}`}}>
      {React.cloneElement(icon, { width: 13, height: 13 })}
    </span>
  );
  const ModalDueDiligenceNote = ({ onRequestUpdateRecords, compact }) => (
    <div
      style={{
        marginBottom: compact ? "8px" : "14px",
        padding: compact ? "8px 10px" : "12px 14px",
        borderRadius: "9px",
        background: dk ? "rgba(255,255,255,0.05)" : "rgba(248,250,252,0.95)",
        border: dk ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(15,23,42,0.08)",
        fontSize: compact ? "9px" : "10px",
        color: c.text3,
        lineHeight: 1.45,
        display: "flex",
        gap: "10px",
        alignItems: "flex-start",
        boxShadow: "none",
      }}
    >
      <PastelIcon icon={IC.shield} bg={dk ? "rgba(255,255,255,0.08)" : "rgba(248,250,252,0.98)"} fg={dk ? "#94a3b8" : "#64748b"} />
      <div style={{ flex: 1, minWidth: 0 }}>
        Data shown is derived from publicly available HMDA (Home Mortgage Disclosure Act) source data. We use agentic tools to process and present it; data may be inconsistent or incomplete. We do not guarantee accuracy or completeness. This is not legal, regulatory, or financial advice. Rankings are based on dollar volume (HMDA) and do not imply conclusions about discrimination, fairness, or lender quality. Please conduct your own research and verification.
        {onRequestUpdateRecords && (
          <> If you would like us to update our records,{" "}
            <button type="button" onClick={onRequestUpdateRecords} style={{background:"none",border:"none",padding:0,fontSize:"inherit",color:c.accent,textDecoration:"underline",cursor:"pointer",fontWeight:600}}>click here</button>.
          </>
        )}
      </div>
    </div>
  );

  // Sparkline SVG
  const Spark = ({data,color=c.accent,w=120,h=32,showArea=true}) => {
    if(!data||!data.length) return null;
    const mn=Math.min(...data),mx=Math.max(...data),range=mx-mn||1;
    const pts=data.map((v,i)=>[i/(data.length-1)*w, h-((v-mn)/range)*(h-4)-2]);
    const line=pts.map((p,i)=>i===0?`M${p[0]},${p[1]}`:`L${p[0]},${p[1]}`).join(" ");
    const area=line+` L${w},${h} L0,${h} Z`;
    const trend=data[data.length-1]>data[0];
    const cl=color||(trend?c.success:c.danger);
    return <svg width={w} height={h} style={{display:"block",overflow:"visible"}}>
      {showArea&&<path d={area} fill={`${cl}15`}/>}
      <path d={line} fill="none" stroke={cl} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx={pts[pts.length-1][0]} cy={pts[pts.length-1][1]} r="2.5" fill={cl}/>
    </svg>;
  };

  const fmtDateTime = (isoLike) => {
    if (!isoLike) return "Not available";
    const dt = new Date(isoLike);
    if (Number.isNaN(dt.getTime())) return String(isoLike);
    return dt.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };
  function normCountyCode(countyCode = "") {
    const digits = String(countyCode || "").replace(/\D/g, "");
    if (!digits) return "000";
    return digits.slice(-3).padStart(3, "0");
  }
  const fmtCountyLabel = (stateCode = "", countyCode = "") => {
    const st = String(stateCode || "").trim();
    const cc = normCountyCode(countyCode);
    const key = `${st}-${cc}`;
    const countyName = countyFipsNames[key];
    if (countyName) return `${countyName} (${key})`;
    return `${key} (County FIPS ${cc})`;
  };
  const fmtCensusTract = (tract = "") => {
    const t = String(tract || "").trim();
    if (!t || t === "unknown") return "Census tract unavailable";
    const compact = t.replace(".", "");
    if (compact.length >= 11) {
      const st = compact.slice(0, 2);
      const cc = compact.slice(2, 5);
      const tractCore = compact.slice(5, 11);
      const tractFmt = `${tractCore.slice(0, 4)}.${tractCore.slice(4)}`;
      return `Census tract ${tractFmt} (State ${st}, County ${cc})`;
    }
    return `Census tract ${t}`;
  };
  const censusTractPlainEnglish = (tract = "") => {
    const t = String(tract || "").trim();
    if (!t || t === "unknown") {
      return "Census tract unavailable: this is a small Census-defined area inside a county.";
    }
    const compact = t.replace(".", "");
    if (compact.length >= 11) {
      const st = compact.slice(0, 2);
      const cc = compact.slice(2, 5);
      return `Small neighborhood-sized Census area in State ${st}, County ${cc} (typically 2,500-8,000 residents).`;
    }
    return "Small neighborhood-sized Census area used to compare lending across parts of a county.";
  };
  const fmtAddress = (addr) => {
    if (!addr) return "Not available";
    const parts = [
      ...(addr.addressLines || []),
      [addr.city, addr.region, addr.postalCode].filter(Boolean).join(", "),
      addr.country || "",
    ].filter(Boolean);
    return parts.join(", ");
  };
  const Card = ({children,style:s={},className="",onClick,pad=28}) => (
    <div onClick={onClick} className={`card-glass ${className}`} style={{background:c.surface,backdropFilter:"blur(28px)",WebkitBackdropFilter:"blur(28px)",border:`1px solid ${c.border}`,borderRadius:"22px",padding:`${pad}px`,transition:"all 0.3s cubic-bezier(0.4,0,0.2,1)",cursor:onClick?"pointer":"default",...s}}>{children}</div>
  );

  const SortBtn = ({field,label}) => {
    const inner = <button className="sort-btn" onClick={()=>doSort(field)} style={{display:"inline-flex",alignItems:"center",gap:"6px",padding:"8px 16px",borderRadius:"12px",border:"none",cursor:"pointer",fontSize:"13px",fontWeight:600,fontFamily:"inherit",background:sortField===field?c.chipActive:c.chip,color:sortField===field?c.accent:c.chipText,transition:"all 0.2s ease"}}>
      {label}{sortField===field&&(sortDir==="desc"?IC.down:IC.up)}
    </button>;
    return TIPS[label] ? <Tip text={TIPS[label]} pos="bottom">{inner}</Tip> : inner;
  };

  const Chip = ({active,children,onClick,count,tip,compact=false}) => {
    const inner = <button onClick={onClick} className="chip-btn" style={{display:"inline-flex",alignItems:"center",gap:compact?"5px":"6px",padding:compact?"6px 11px":"8px 16px",borderRadius:compact?"10px":"12px",border:"none",cursor:"pointer",fontSize:compact?"12px":"13px",fontWeight:compact?500:600,fontFamily:"inherit",background:active?c.chipActive:c.chip,color:active?c.accent:c.chipText,transition:"all 0.2s ease"}}>
      {children}
      {count!==undefined&&<span style={{fontSize:compact?"10px":"11px",fontWeight:700,padding:compact?"1px 7px":"2px 8px",borderRadius:"8px",background:active?c.accentSoft:dk?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.05)",color:active?c.accent:c.text3,minWidth:compact?"20px":"22px",textAlign:"center"}}>{count}</span>}
    </button>;
    return tip ? <Tip text={tip} pos="bottom">{inner}</Tip> : inner;
  };

  const tabs = [
    { id: "lenders", label: "Lenders", icon: IC.building },
    { id: "products", label: "Products", icon: IC.database },
    { id: "geography", label: "Geography", icon: IC.map },
  ];

  const hmdaToolbarHomeBtn = (
    <Tip text="Home — search landing" pos="bottom">
      <button
        type="button"
        className="hmda-nav-home-btn tab-item"
        onClick={() => {
          handleReset();
          setMobileMenuOpen(false);
        }}
        title="Home — search landing"
        aria-label="Home — search landing"
        style={{
          padding: isMobile ? "8px" : "7px 11px",
          borderRadius: "11px",
          border: "none",
          cursor: "pointer",
          background: "transparent",
          color: c.chipText,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: isMobile ? 0 : 7,
          flexShrink: 0,
          fontFamily: "inherit",
          transition: "all 0.15s ease",
          whiteSpace: "nowrap",
        }}
      >
        <span
          className="hmda-tab-icon-well"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: 9,
            flexShrink: 0,
            background: dk ? "rgba(251, 191, 36, 0.22)" : "rgba(254, 243, 199, 0.75)",
            color: dk ? "#fcd34d" : "#b45309",
          }}
          aria-hidden
        >
          {IC_HEADER.home}
        </span>
        {!isMobile && (
          <span style={{ fontSize: "13px", fontWeight: 600, letterSpacing: "-0.01em" }}>Home</span>
        )}
      </button>
    </Tip>
  );

  /** Lenders tab: shared toolbar fragments (mobile stacks filters; desktop stays one row). */
  const hmdaLendersToolbarTabIcons = embedMode ? null : (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }} role="tablist" aria-label="HMDA sections">
      {hmdaToolbarHomeBtn}
      {tabs.map((tb) => (
        <Tip key={tb.id} text={isMobile ? tb.label : undefined} pos="bottom">
          <button
            type="button"
            role="tab"
            aria-selected={tab === tb.id}
            aria-label={tb.label}
            data-demo-target={tb.id === "lenders" ? "nav-lenders" : tb.id === "products" ? "nav-products" : tb.id === "geography" ? "nav-geography" : undefined}
            onClick={() => {
              if (tb.id === "lenders") goToLendersTab({ forceResults: showResults });
              else {
                setTab(tb.id);
                setMobileMenuOpen(false);
              }
            }}
            style={{
              padding: isMobile ? "8px" : "7px 11px",
              borderRadius: "11px",
              border: "none",
              cursor: "pointer",
              background: tab === tb.id ? c.chipActive : "transparent",
              color: tab === tb.id ? c.accent : c.chipText,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: isMobile ? 0 : 7,
              boxShadow: tab === tb.id ? `0 2px 10px ${dk ? "rgba(129,140,248,0.12)" : "rgba(99,102,241,0.08)"}` : "none",
              transition: "all 0.15s ease",
              whiteSpace: "nowrap",
            }}
          >
            <HmdaTabIconWell tabId={tb.id} dark={dk}>
              <span style={{ display: "inline-flex", opacity: tab === tb.id ? 1 : 0.82 }}>{tb.icon}</span>
            </HmdaTabIconWell>
            {!isMobile && (
              <span style={{ fontSize: "13px", fontWeight: 600, letterSpacing: "-0.01em" }}>{tb.label}</span>
            )}
          </button>
        </Tip>
      ))}
    </div>
  );

  const hmdaLendersFilterNodes = (
    <>
      <Tip text={TIPS["Data Year"]} pos="bottom">
        <FilterDropdown minimal id="year" label="Year" displayValue={yearF} open={openFilter === "year"} onToggle={setOpenFilter} hasActive={false}>
          {AVAILABLE_YEARS.map((v) => {
            const hasData = isLenderYearAvailable(hmdaYearsManifest, v) &&
              (yearsWithData.length === 0 || yearsWithData.includes(String(v)));
            const badge = yearPickerBadge(hmdaYearsManifest, v);
            return (
            <button
              key={v}
              onClick={() => {
                startTransition(() => setYearF(v));
                setOpenFilter(null);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "10px 14px",
                borderRadius: "8px",
                border: "none",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: 600,
                fontFamily: "inherit",
                background: yearF === v ? c.chipActive : "transparent",
                color: yearF === v ? c.accent : hasData ? c.text2 : c.text4,
                marginBottom: "2px",
                opacity: hasData ? 1 : 0.65,
              }}
            >
              {v}
              {badge || (!hasData ? " · API pending" : "")}
            </button>
            );
          })}
          {Number(larDetailYearForPanel(panelYear)) < Number(panelYear) ? (
            <div style={{ margin: "8px 10px 4px", padding: "8px 10px", borderRadius: "9px", background: c.chip, color: c.text3, fontSize: "11px", lineHeight: 1.35, fontWeight: 600 }}>
              HMDA {panelYear} lender totals are selected. Detailed LAR fields use {larDetailYearForPanel(panelYear)} until {panelYear} LAR detail is loaded in this dashboard.
            </div>
          ) : null}
        </FilterDropdown>
      </Tip>
      <FilterDropdown minimal id="type" label="Type" displayValue={typeF === "all" ? "All" : typeF} open={openFilter === "type"} onToggle={setOpenFilter} hasActive={typeF !== "all"}>
        {["all", "IMB", "Bank", "Credit Union"].map((v) => (
          <button
            key={v}
            onClick={() => {
              startTransition(() => setTypeF(v));
              setOpenFilter(null);
            }}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "10px 14px",
              borderRadius: "8px",
              border: "none",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
              fontFamily: "inherit",
              background: typeF === v ? c.chipActive : "transparent",
              color: typeF === v ? c.accent : c.text2,
              marginBottom: "2px",
            }}
          >
            {v === "all" ? "All" : v}
          </button>
        ))}
      </FilterDropdown>
      <FilterDropdown minimal id="product" label="Product" displayValue={prodF === "all" ? "All" : prodF} open={openFilter === "product"} onToggle={setOpenFilter} hasActive={prodF !== "all"}>
        {["all", ...ALL_PRODUCTS].map((v) => (
          <button
            key={v}
            onClick={() => {
              startTransition(() => setProdF(v));
              setOpenFilter(null);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              textAlign: "left",
              padding: "10px 14px",
              borderRadius: "8px",
              border: "none",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
              fontFamily: "inherit",
              background: prodF === v ? c.chipActive : "transparent",
              color: prodF === v ? c.accent : c.text2,
              marginBottom: "2px",
            }}
          >
            <span>{v === "all" ? "All" : v}</span>
            {v !== "all" && <span style={{ fontSize: "11px", fontFamily: "'JetBrains Mono',monospace", color: c.text3 }}>{prodCounts[v]?.toLocaleString()}</span>}
          </button>
        ))}
      </FilterDropdown>
      <FilterDropdown
        minimal
        id="channel"
        label="Channel"
        displayValue={channelF === "all" ? "All" : channelF === "retail" ? "Rtl" : channelF === "wholesale" ? "Whsl" : "Corr"}
        open={openFilter === "channel"}
        onToggle={setOpenFilter}
        hasActive={channelF !== "all"}
      >
        {["all", "retail", "wholesale", "correspondent"].map((v) => (
          <button
            key={v}
            onClick={() => {
              startTransition(() => setChannelF(v));
              setOpenFilter(null);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              textAlign: "left",
              padding: "10px 14px",
              borderRadius: "8px",
              border: "none",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
              fontFamily: "inherit",
              background: channelF === v ? c.chipActive : "transparent",
              color: channelF === v ? c.accent : c.text2,
              marginBottom: "2px",
            }}
          >
            <span>{v === "all" ? "All" : v === "retail" ? "Retail" : v === "wholesale" ? "Wholesale" : "Correspondent"}</span>
            {v !== "all" && <span style={{ fontSize: "11px", fontFamily: "'JetBrains Mono',monospace", color: c.text3 }}>{channelCounts[v]?.toLocaleString()}</span>}
          </button>
        ))}
      </FilterDropdown>
      <Tip text={TIPS["Sort by"]} pos="bottom">
        <FilterDropdown minimal id="sort" label="Sort by" displayValue={sortField === "name" ? "Name" : sortField === "originations" ? "Orig" : sortField === "rateSpread" ? "Spr" : "Vol"} open={openFilter === "sort"} onToggle={setOpenFilter} hasActive={true}>
          {[
            { f: "name", l: "Name" },
            { f: "originations", l: "Originations (loan count)" },
            { f: "rateSpread", l: "Rate Spread (pricing competitiveness)" },
            { f: "dollarVol", l: "Volume ($)" },
          ].map(({ f, l }) => (
            <button
              key={f}
              onClick={() => {
                doSort(f);
                setOpenFilter(null);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                textAlign: "left",
                padding: "10px 14px",
                borderRadius: "8px",
                border: "none",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: 600,
                fontFamily: "inherit",
                background: sortField === f ? c.chipActive : "transparent",
                color: sortField === f ? c.accent : c.text2,
                marginBottom: "2px",
              }}
            >
              <span>{l}</span>
              {sortField === f && <span>{sortDir === "desc" ? "▾" : ""}</span>}
            </button>
          ))}
        </FilterDropdown>
      </Tip>
    </>
  );

  const hmdaLendersViewModeToggle = (
    <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "3px", borderRadius: "10px", background: c.chip, border: `1px solid ${c.drillBorder}`, flexShrink: 0 }}>
      <button
        type="button"
        aria-label="Grid view"
        aria-pressed={lendersUseGrid}
        onClick={() => {
          setLendersExplicitList(false);
          setViewMode("grid");
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 34,
          height: 30,
          borderRadius: "8px",
          border: "none",
          cursor: "pointer",
          background: lendersUseGrid ? c.chipActive : "transparent",
          color: lendersUseGrid ? c.accent : c.chipText,
          transition: "all 0.18s ease",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="List view"
        aria-pressed={!lendersUseGrid}
        onClick={() => {
          setLendersExplicitList(true);
          setViewMode("list");
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 34,
          height: 30,
          borderRadius: "8px",
          border: "none",
          cursor: "pointer",
          background: !lendersUseGrid ? c.chipActive : "transparent",
          color: !lendersUseGrid ? c.accent : c.chipText,
          transition: "all 0.18s ease",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      </button>
    </div>
  );

  const hmdaLendersCountChip = (
    <Tip text={`${filtered.length.toLocaleString()} lenders match filters`} pos="bottom">
      <div
        style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 8px", borderRadius: "10px", background: c.chip, border: `1px solid ${c.drillBorder}`, flexShrink: 0 }}
        aria-label={`${filtered.length.toLocaleString()} lenders`}
      >
        <span style={{ display: "inline-flex", opacity: 0.85, color: c.text3 }} aria-hidden>
          {IC.building}
        </span>
        <span className="hmda-mono" style={{ fontSize: "13px", fontWeight: 700, color: c.text }}>
          {filtered.length.toLocaleString()}
        </span>
      </div>
    </Tip>
  );

  const hmdaLendersPinsToolbar = (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: isMobile ? 0 : "auto" }}>
      <Tip text={!HMDA_PREMIUM_PINS_UNLIMITED && pinnedLenders.length >= maxPinnedLenders ? "Pin limit reached — premium unlocks more compare slots" : "Pinned for compare"} pos="bottom">
        <div style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 8px", borderRadius: "10px", background: c.chip, border: `1px solid ${c.drillBorder}` }} aria-label={`Pinned ${pinnedLenders.length} of ${pinCapDisplay}`}>
          <span style={{ display: "inline-flex", opacity: 0.85, color: c.text3 }} aria-hidden>
            {IC.mapPin}
          </span>
          <span style={{ fontSize: "12px", fontWeight: 700, color: c.accent, fontFamily: "'JetBrains Mono',monospace" }}>
            {pinnedLenders.length}/{pinCapDisplay}
          </span>
        </div>
      </Tip>
      <Tip
        text={
          pinnedLenders.length < 2
            ? `View compare · pin ${Math.max(2 - pinnedLenders.length, 0)} more lender${pinnedLenders.length === 1 ? "" : "s"} to enable`
            : `View compare · ${pinnedLenders.length} lender${pinnedLenders.length === 1 ? "" : "s"} side-by-side`
        }
        pos="bottom"
      >
        <button
          type="button"
          aria-label={pinnedLenders.length < 2 ? "View compare (pin at least 2 lenders)" : `View compare of ${pinnedLenders.length} pinned lenders`}
          onClick={() => setCompareOpen(true)}
          disabled={pinnedLenders.length < 2}
          className="sort-btn hmda-btn-playful hmda-compare-toolbar-btn"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 34,
            borderRadius: "10px",
            border: "none",
            cursor: pinnedLenders.length < 2 ? "not-allowed" : "pointer",
            background: pinnedLenders.length < 2 ? c.chip : c.chipActive,
            color: pinnedLenders.length < 2 ? c.chipText : c.accent,
            opacity: pinnedLenders.length < 2 ? 0.55 : 1,
          }}
        >
          <GitCompareArrows size={17} strokeWidth={2} aria-hidden />
        </button>
      </Tip>
      <Tip text="Clear pinned lenders" pos="bottom">
        <button
          type="button"
          aria-label="Clear pinned lenders"
          onClick={clearPinned}
          disabled={pinnedLenders.length === 0}
          className="sort-btn"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 34,
            borderRadius: "10px",
            border: "none",
            cursor: pinnedLenders.length === 0 ? "not-allowed" : "pointer",
            background: c.chip,
            color: c.chipText,
            opacity: pinnedLenders.length === 0 ? 0.5 : 1,
          }}
        >
          {IC.x}
        </button>
      </Tip>
    </div>
  );

  const statusBadge = s => s==="verified"?<Badge variant="success" tip={TIPS.verified}>Verified</Badge>:s==="partial"?<Badge variant="warning" tip={TIPS.partial}>Partial</Badge>:<Badge variant="danger" tip={TIPS.pending}>Pending</Badge>;
  const typeBadge = t => t==="IMB"?<Badge variant="info" tip={TIPS.IMB}>IMB</Badge>:t==="Bank"?<Badge variant="purple" tip={TIPS.Bank}>Bank</Badge>:(t==="Credit Union"||t==="CU")?<Badge variant="default" tip={TIPS.CU}>CU</Badge>:<Badge variant="info" tip={TIPS.IMB}>IMB</Badge>;

  const DEMO_MESSAGES = {
    lenders: "Browse all HMDA lenders across the reporting years in the loaded panel (e.g. 2022–2025). Filter by type, year, status, or product. Click any lender row to see their full profile with origination data and product details.",
    products: "Explore mortgage product types offered across lenders. See adoption rates, average credit profiles, and which lenders have the highest volume in each product category.",
    geography: "Visualize lender coverage across the US map. Drill into states and counties to see which lenders are active in specific markets.",
  };

  const DemoBubble = ({section}) => {
    if (!demoBubbles[section]) return null;
    return (
      <div style={{position:"relative",marginBottom:"16px",padding:"14px 18px",borderRadius:"14px",background:`linear-gradient(135deg, ${c.infoSoft}, ${dk?"rgba(99,102,241,0.12)":"rgba(99,102,241,0.06)"})`,border:`1px solid ${c.info}22`,display:"flex",alignItems:"flex-start",gap:"12px",animation:"rise 0.4s ease"}}>
        <span style={{fontSize:"20px",flexShrink:0,marginTop:"1px"}}></span>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:"13px",fontWeight:600,color:c.text,lineHeight:1.55}}>{DEMO_MESSAGES[section]}</div>
        </div>
        <button onClick={()=>setDemoBubbles(prev=>({...prev,[section]:false}))} style={{border:"none",background:c.chip,borderRadius:"8px",width:"26px",height:"26px",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:c.text3,flexShrink:0,fontSize:"13px",fontWeight:700}}>"</button>
      </div>
    );
  };

  const lendersTabAwaitingData =
    tab === "lenders" &&
    showResults &&
    shouldLoadLenders &&
    (lendersLoading || lenderQuery.loading || !lenderQuery.fetched);

  /* ─────────────────────────────────────────────────────
     RENDER
     ───────────────────────────────────────────────────── */
  return (
    <HmdaThemeCtx.Provider value={{ c, dk }}>
    <div data-hmda-theme={theme} data-hmda-sprinkle={sprinkleUi ? "1" : "0"} data-hmda-embed={embedMode ? "1" : "0"} className="hmda-premium-exec hmda-route-shell" style={{minHeight:embedMode?"100%":"100vh",display:"flex",flexDirection:"column",color:c.text,position:"relative",overflow:"hidden",background: dk ? undefined : "transparent"}}>
      <HmdaPoweredPreloader show={showResults && tab !== "geography" && (lendersTabAwaitingData || (tab === "products" && productSummaryLoading && !productSummaryForYear && !panelYearLenders.length))} lenderCount={warehouseLenderCount} />
      {/* Constellation background — direct import (no lazy), fires onReady to dismiss the page preloader */}
      <ConstellationCanvas dark={dk} executiveLight={!dk} clearCenter={!showResults} onReady={onCanvasReady} />

      <style>{`
        * { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility; }
        @keyframes gradientShift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
        @keyframes orbFloat{0%,100%{transform:translate(0,0) scale(1);opacity:0.8}33%{transform:translate(3%,-2%) scale(1.05);opacity:1}66%{transform:translate(-2%,2%) scale(0.98);opacity:0.9}}
        @keyframes starTwinkle{0%,100%{opacity:0.7}50%{opacity:1}}
        .constellation-star{animation:starTwinkle 2.5s ease-in-out infinite}
        *{box-sizing:border-box;margin:0;padding:0;}
        *{scrollbar-width:thin;scrollbar-color:${dk?"rgba(255,255,255,0.10)":"rgba(0,0,0,0.10)"} transparent;}
        ::-webkit-scrollbar{width:2px;height:2px;}
        ::-webkit-scrollbar-track{background:transparent;}
        ::-webkit-scrollbar-thumb{background:${dk?"rgba(255,255,255,0.12)":"rgba(0,0,0,0.12)"};border-radius:2px;}
        ::-webkit-scrollbar-thumb:hover{background:${dk?"rgba(255,255,255,0.22)":"rgba(0,0,0,0.22)"};}
        ::-webkit-scrollbar-corner{background:transparent;}
        @keyframes rise{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes slideRight{from{opacity:0;transform:translateX(-12px)}to{opacity:1;transform:translateX(0)}}
        @keyframes tipIn{from{opacity:0;transform:translateX(-50%) translateY(-4px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        @keyframes tipInDown{from{opacity:0;transform:translateX(-50%) translateY(-4px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1;box-shadow:0 0 0 4px ${c.accent}40, 0 0 40px ${c.accent}30}50%{opacity:0.9;box-shadow:0 0 0 6px ${c.accent}50, 0 0 50px ${c.accent}40}}
        @keyframes viewLabelPulsate{0%,100%{opacity:1}50%{opacity:0.82}}
        .view-mode-label{animation:viewLabelPulsate 2.2s ease-in-out infinite;}
        .card-glass{box-shadow:${dk?"0 4px 20px rgba(0,0,0,0.15)":"0 4px 20px rgba(15,23,42,0.05)"};}
        .card-glass:hover{background:${c.surfaceHover} !important;border-color:${c.borderHover} !important;transform:translateY(-3px);box-shadow:${c.shadow};}
        .lcard-item{animation:rise 0.45s ease both;}
        .lcard-item:hover{background:${c.surfaceHover} !important;border-color:${c.borderHover} !important;transform:translateY(-3px);box-shadow:${c.shadow};}
        .lcard-item:hover .lcard-arrow svg{opacity:1 !important;}
        .lcard-arrow:hover{background:${c.chipActive} !important;}
        .drill-row:hover{border-color:${c.borderHover} !important;transform:translateX(2px);}
        .chip-btn,.sort-btn{transition:all 0.2s ease, transform 0.16s ease;}
        .chip-btn:hover,.sort-btn:hover{background:${dk?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.06)"} !important;transform:translateY(-1px);}
        .tab-item{transition:all 0.25s;}
        .tab-item:hover{background:${dk?"rgba(255,255,255,0.05)":"rgba(0,0,0,0.03)"} !important;}
        .hmda-demo-dismiss-btn{
          display:inline-flex;
          align-items:center;
          gap:6px;
          padding:6px 10px;
          border-radius:10px;
          border:1px solid ${dk?"rgba(255,255,255,0.10)":"rgba(15,23,42,0.10)"};
          background:${dk?"rgba(255,255,255,0.04)":"rgba(15,23,42,0.03)"};
          color:${c.text3};
          cursor:pointer;
          font-size:11px;
          font-weight:500;
          font-family:inherit;
          letter-spacing:-0.005em;
          transition: background 0.16s ease, border-color 0.16s ease, transform 0.16s ease, color 0.16s ease;
        }
        .hmda-demo-dismiss-btn svg{opacity:0.72}
        .hmda-demo-dismiss-btn:hover{
          background:${dk?"rgba(255,255,255,0.06)":"rgba(15,23,42,0.05)"};
          border-color:${dk?"rgba(255,255,255,0.16)":"rgba(15,23,42,0.14)"};
          color:${c.text2};
          transform:translateY(-1px);
        }
        .hmda-demo-dismiss-btn:active{transform:translateY(0px)}
        .toolbar-shell{background:${c.surface};border:1px solid ${c.border};border-radius:16px;${sprinkleUi && !dk ? "backdrop-filter:none !important;-webkit-backdrop-filter:none !important;" : "backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);"}box-shadow:${dk?"0 8px 28px rgba(0,0,0,0.28)":"0 4px 24px rgba(15,23,42,0.06)"};}
        .filter-group{transition:all 0.22s ease;}
        .filter-group:hover{border-color:${c.borderHover} !important;background:${c.surfaceRaised} !important;}
        .sort-strip{background:${c.surface};border:1px solid ${c.border};border-radius:14px;box-shadow:${dk?"0 6px 20px rgba(0,0,0,0.22)":"0 6px 18px rgba(15,23,42,0.05)"};}
        .drill-row{transition:all 0.2s;cursor:pointer;border-radius:14px;padding:14px 18px;}
        .drill-row:hover{background:${dk?"rgba(255,255,255,0.04)":"rgba(0,0,0,0.025)"};transform:translateX(4px);}
        .overlay-enter{animation:rise 0.3s ease;}
        .toggle-theme{transition:all 0.3s;}
        .toggle-theme:hover{transform:scale(1.08);background:${dk?"rgba(255,255,255,0.1)":"rgba(0,0,0,0.07)"} !important;}
        .grad-title{font-family:inherit;font-weight:500;letter-spacing:0.06em;font-size:12px;text-transform:uppercase;background:linear-gradient(135deg,${c.accent} 0%,${c.accent2||c.accent} 50%,${dk?"#a5b4fc":c.accent2} 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
        .bg-orb{pointer-events:none;}
      `}</style>

      {/* "" FIXED HEADER (mobile-first, safe area) — hidden when embedded in Cohi "" */}
      {!embedMode && (
      <header data-hmda-sprinkle-chrome={sprinkleUi&&!dk?"1":undefined} style={sprinkleUi&&!dk?{position:"fixed",top:"max(10px, env(safe-area-inset-top, 0px))",left:"max(16px, env(safe-area-inset-left, 0px))",right:"max(16px, env(safe-area-inset-right, 0px))",zIndex:1000,background:"transparent",border:"none",borderRadius:0,boxShadow:"none",opacity:mounted?1:0,transition:"opacity 0.6s ease",paddingTop:0,backdropFilter:"none",WebkitBackdropFilter:"none"}:{position:"fixed",top:0,left:0,right:0,zIndex:1000,background:c.surface,borderBottom:`1px solid ${c.border}`,opacity:mounted?1:0,transition:"opacity 0.6s ease",paddingTop:"env(safe-area-inset-top, 0)",backdropFilter:"blur(18px) saturate(145%)",WebkitBackdropFilter:"blur(18px) saturate(145%)"}}>
        <div style={{maxWidth:"1480px",margin:"0 auto",padding:sprinkleUi&&!dk&&!isMobile?"10px 12px 10px 20px":isMobile?"10px 12px 10px 16px":"14px 28px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:isMobile?"8px":"12px",fontFamily:"var(--font-sans)"}}>
          {/* Logo + title */}
          <Link
            to="/"
            onClick={onLandingLogoNavClick}
            aria-label="Coheus HMDA DataBank — Coheus home"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: isMobile ? '8px' : '12px',
              cursor: 'pointer',
              flexShrink: isMobile ? 1 : 0,
              textDecoration: 'none',
              ...(isMobile ? { flex: 1, minWidth: 0 } : {}),
            }}
          >
            <img
              src="/coheus-logo.png"
              alt=""
              width={140}
              height={40}
              aria-hidden
              style={{
                height: isMobile ? 56 : 72,
                width: 'auto',
                display: 'block',
                flexShrink: 0,
                borderRadius: isMobile ? 12 : 14,
                objectFit: 'contain',
              }}
            />
            <h1
              style={{
                fontSize: isMobile ? '15px' : '17px',
                lineHeight: 1.2,
                margin: 0,
                fontWeight: 750,
                letterSpacing: '-0.02em',
                display: 'flex',
                flexDirection: isMobile ? 'column' : 'row',
                flexWrap: 'wrap',
                alignItems: isMobile ? 'flex-start' : 'baseline',
                gap: isMobile ? '1px' : '10px',
                ...(isMobile ? { flex: 1 } : {}),
              }}
            >
              <span
                className="grad-title"
                style={{
                  textTransform: 'none',
                  fontSize: isMobile ? 'clamp(16px, 4.5vw, 20px)' : 'clamp(18px, 1.9vw, 24px)',
                  fontWeight: 650,
                  letterSpacing: '-0.03em',
                }}
              >
                HMDA
              </span>
              <span
                style={{
                  fontSize: isMobile ? '11px' : '12px',
                  fontWeight: 650,
                  letterSpacing: '-0.02em',
                  lineHeight: 1.25,
                  color: dk ? '#f8fafc' : '#0f172a',
                }}
              >
                DataBank
              </span>
            </h1>
          </Link>

          {/* Desktop action buttons */}
          {!isMobile && (
            <div className="hmda-header-actions" style={{display:"flex",alignItems:"center",gap:sprinkleUi&&!dk?"8px":"6px",flexWrap:"wrap",justifyContent:"flex-end"}}>
              <button type="button" onClick={handleReset} className={`toggle-theme hmda-header-cmd${sprinkleUi&&!dk?" hmda-header-cmd--labeled":""}`} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:8,fontFamily:"inherit"}} title="Home — search landing" aria-label="Home — search landing">
                <span className="hmda-header-cmd__glyph" aria-hidden>{IC_HEADER.home}</span>
                <span className="hmda-header-cmd__label">Home</span>
              </button>
              <HmdaNavAuth dk={dk} accent={c.accent} surface={c.toggle} border={c.border} textMuted={c.text4} isMobile={false} sprinkleMinimal={sprinkleUi&&!dk} />
            </div>
          )}

          {/* Mobile: hamburger (Sign Up / Sign In live in menu) */}
          {isMobile && (
            <div style={{display:"flex",alignItems:"center",gap:"8px",flexShrink:0}}>
              <button onClick={()=>setMobileMenuOpen(o=>!o)} style={{width:"38px",height:"38px",borderRadius:"11px",border:`1px solid ${mobileMenuOpen?c.accent+"44":c.border}`,cursor:"pointer",background:mobileMenuOpen?c.chipActive:c.toggle,color:mobileMenuOpen?c.accent:c.toggleIcon,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"4px",transition:"all 0.2s ease",padding:"10px"}} aria-label="Menu">
                <span style={{display:"block",width:"16px",height:"1.5px",background:"currentColor",borderRadius:"2px",transition:"all 0.25s ease",transform:mobileMenuOpen?"rotate(45deg) translate(4px,4px)":"none"}}/>
                <span style={{display:"block",width:"16px",height:"1.5px",background:"currentColor",borderRadius:"2px",transition:"all 0.25s ease",opacity:mobileMenuOpen?0:1}}/>
                <span style={{display:"block",width:"16px",height:"1.5px",background:"currentColor",borderRadius:"2px",transition:"all 0.25s ease",transform:mobileMenuOpen?"rotate(-45deg) translate(4px,-4px)":"none"}}/>
              </button>
            </div>
          )}
        </div>
      </header>
      )}

      {/* "" MOBILE MENU DROPDOWN "" */}
      {!embedMode && isMobile && mobileMenuOpen && (
        <>
          <div onClick={()=>setMobileMenuOpen(false)} style={{position:"fixed",inset:0,zIndex:998,background:"transparent"}} />
          <div className="overlay-enter" style={{position:"fixed",top:isMobile?"62px":"72px",left:"12px",right:"12px",zIndex:999,borderRadius:"18px",background:sprinkleUi&&!dk?"rgba(255,255,255,0.72)":dk?"rgba(8,10,28,0.92)":"rgba(255,255,255,0.95)",border:`1px solid ${sprinkleUi&&!dk?"rgba(255,255,255,0.45)":dk?"rgba(255,255,255,0.10)":"rgba(200,210,230,0.80)"}`,boxShadow:dk?"0 20px 60px rgba(0,0,0,0.55)":"0 20px 50px rgba(15,23,42,0.12)",backdropFilter:sprinkleUi&&!dk?"blur(22px) saturate(175%)":"blur(28px) saturate(180%)",overflow:"hidden"}}>
            {/* Tabs (when in dashboard) */}
            {showResults && (
              <>
                <div style={{padding:"10px 10px 6px",display:"flex",flexDirection:"column",gap:"2px"}}>
                  <div style={{fontSize:"10px",fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:c.text4,padding:"4px 10px 6px"}}>Navigate</div>
                  {tabs.map(tb=>(
                    <button key={tb.id} onClick={()=>{if(tb.id==="lenders")goToLendersTab({forceResults:showResults});else{setTab(tb.id);setMobileMenuOpen(false);}}} style={{display:"flex",alignItems:"center",gap:"12px",width:"100%",padding:"12px 14px",borderRadius:"12px",border:"none",cursor:"pointer",fontSize:"14px",fontWeight:600,fontFamily:"inherit",background:tab===tb.id?c.chipActive:"transparent",color:tab===tb.id?c.accent:c.text2,textAlign:"left",transition:"all 0.15s ease"}}>
                      <HmdaTabIconWell tabId={tb.id} dark={dk}><span style={{display:"inline-flex",opacity:tab===tb.id?1:0.88}}>{tb.icon}</span></HmdaTabIconWell>
                      {tb.label}
                      {tab===tb.id && <span style={{marginLeft:"auto",width:"6px",height:"6px",borderRadius:"50%",background:c.accent,flexShrink:0}} />}
                    </button>
                  ))}
                </div>
                <div style={{height:"1px",background:dk?"rgba(255,255,255,0.07)":"rgba(0,0,0,0.06)",margin:"0 14px"}} />
              </>
            )}
            {/* Account / SaaS */}
            <div style={{padding:"6px 10px 10px",display:"flex",flexDirection:"column",gap:"2px"}}>
              <div style={{fontSize:"10px",fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:c.text4,padding:"6px 10px 4px"}}>Account</div>
              <HmdaNavAuth dk={dk} accent={c.accent} surface={c.toggle} border={c.border} textMuted={c.text4} isMobile onOpenMenu={setMobileMenuOpen} />
            </div>
            {/* Actions */}
            <div style={{padding:"6px 10px 10px",display:"flex",flexDirection:"column",gap:"2px"}}>
              <div style={{fontSize:"10px",fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:c.text4,padding:"6px 10px 4px"}}>Actions</div>
              <button type="button" onClick={()=>{handleReset();setMobileMenuOpen(false);}} title="Home — search landing" aria-label="Home — search landing" style={{display:"flex",alignItems:"center",gap:"12px",width:"100%",padding:"12px 14px",borderRadius:"12px",border:"none",cursor:"pointer",fontSize:"14px",fontWeight:600,fontFamily:"inherit",background:"transparent",color:c.text2,textAlign:"left"}}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{opacity:0.55}}><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                Home
              </button>
              <Link to="/" onClick={()=>setMobileMenuOpen(false)} style={{display:"flex",alignItems:"center",gap:"12px",width:"100%",padding:"12px 14px",borderRadius:"12px",fontSize:"14px",fontWeight:600,fontFamily:"inherit",background:"transparent",color:c.text2,textDecoration:"none"}}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{opacity:0.55}}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                Coheus.com
              </Link>
            </div>
          </div>
        </>
      )}

      <div className="hmda-container hmda-container-pastel" style={{position:"relative",zIndex:1,paddingTop:embedMode?0:(isMobile?(sprinkleUi&&!dk?"88px":"72px"):(sprinkleUi&&!dk?"112px":"100px")),paddingBottom:0}}>

        {!showResults ? (
          /* "" HERO (search landing) — mobile-first, thin modern "" */
          <div className="hmda-hero hmda-ds-hero">
            <h2 className="hmda-heading-1 hmda-hero-display-title">
              <span className="title-light">Executive-grade</span>{' '}
              <span className="title-strong">mortgage market intelligence.</span>
            </h2>
            <div
              className="toolbar-shell hmda-hero-toolbar hmda-ds-hero-toolbar hmda-ds-hero-toolbar-surface hmda-ds-hero-search-stack"
              data-demo-target="hero-search"
              data-hmda-search-ui
            >
              <div className="hmda-hero-actions hmda-ds-hero-actions hmda-ds-hero-actions--merged">
                <button type="button" onClick={()=>{startTransition(()=>{goToLendersTab({forceResults:true,heroTop100USA:false});});}} className="chip-btn hmda-hero-pastel-chip hmda-hero-action-min hmda-ds-hero-cta hmda-ds-hero-cta--blue">{IC.building} Browse all lenders</button>
                <button type="button" onClick={()=>{startTransition(()=>{setTab("geography");setForceResults(true);});}} className="chip-btn hmda-hero-pastel-chip hmda-hero-action-min hmda-ds-hero-cta hmda-ds-hero-cta--green">{IC.map} Geography</button>
                <Link to="/products" className="chip-btn hmda-hero-pastel-chip hmda-hero-action-min hmda-ds-hero-cta hmda-ds-hero-cta--teal" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>{IC.database} Product Type</Link>
                <button type="button" onClick={()=>{startTransition(()=>{goToLendersTab({forceResults:true,heroTop100USA:true});});}} className="chip-btn hmda-hero-pastel-chip hmda-hero-action-min hmda-ds-hero-cta hmda-ds-hero-cta--lime">{IC.chart} Top 100 USA</button>
              </div>
              <HmdaHeroSearchCombo
                isMobile={isMobile}
                dk={dk}
                c={c}
                IC={IC}
                cohiUploadTheme={cohiUploadTheme}
                qInput={qInput}
                setQInput={setQInput}
                showSuggestions={showSuggestions}
                setShowSuggestions={setShowSuggestions}
                searchSuggestions={searchSuggestions}
                commitSearch={commitSearch}
                clearSearch={clearSearch}
                heroSearchRef={heroSearchRef}
                hmdaSearchLenderMapBtn={hmdaSearchLenderMapBtn}
                suggestionToQueryValue={suggestionToQueryValue}
              />
            </div>

            {/* ── Hero lender preview card ── */}
            {heroPreviewLender && (()=>{
              const pl = heroPreviewLender;
              const plUnits = pl.originations ?? pl.orig ?? 0;
              const plVol   = pl.dollarVol ?? 0;
              const plHi    = pl.hmdaInsights || {};
              const plLts   = plHi.loanTypeSummary || {};
              const LTYPE   = {1:"Conventional",2:"FHA",3:"VA",4:"USDA"};
              const ltRows  = Object.entries(plLts)
                .map(([k,v])=>({label:LTYPE[k]||`Type ${k}`,orig:v?.originated||0}))
                .filter(r=>r.orig>0).sort((a,b)=>b.orig-a.orig);
              const ltTotal = ltRows.reduce((s,r)=>s+r.orig,0)||plUnits||1;
              const fmtU = (n)=>n>=1e6?`${(n/1e6).toFixed(1)}M`:n>=1e3?`${(n/1e3).toFixed(1)}K`:String(Math.round(n));
              const fmtD = (n)=>n>=1e12?`$${(n/1e12).toFixed(1)}T`:n>=1e9?`$${(n/1e9).toFixed(1)}B`:n>=1e6?`$${(n/1e6).toFixed(0)}M`:`$${Math.round(n/1e3)}K`;
              return (
                <div style={{marginTop:"20px",animation:"rise 0.35s ease",width:"100%",maxWidth:"680px",alignSelf:"center"}}>
                  <div style={{borderRadius:"20px",background:dk?"rgba(15,23,42,0.82)":"rgba(255,255,255,0.92)",border:`1px solid ${dk?"rgba(129,140,248,0.22)":"rgba(99,102,241,0.18)"}`,backdropFilter:"blur(20px)",overflow:"hidden",boxShadow:dk?"0 16px 48px rgba(0,0,0,0.35)":"0 16px 40px rgba(15,23,42,0.08)"}}>
                    {/* Header */}
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"10px",padding:"16px 18px 14px",borderBottom:`1px solid ${dk?"rgba(255,255,255,0.06)":"rgba(226,232,240,0.6)"}`}}>
                      <div style={{display:"flex",alignItems:"center",gap:"12px",minWidth:0}}>
                        <div style={{width:"44px",height:"44px",borderRadius:"13px",flexShrink:0,background:dk?"rgba(99,102,241,0.18)":"rgba(99,102,241,0.10)",border:`1px solid ${dk?"rgba(129,140,248,0.25)":"rgba(99,102,241,0.22)"}`,display:"flex",alignItems:"center",justifyContent:"center",color:dk?"#818CF8":"#4F46E5",fontSize:"15px",fontWeight:800}}>
                          {pl.name?.slice(0,2)||"??"}
                        </div>
                        <div style={{minWidth:0}}>
                          <div style={{fontSize:"15px",fontWeight:700,color:dk?"rgba(248,250,252,0.95)":"#0f172a",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",letterSpacing:"-0.02em"}}>{pl.name}</div>
                          <div style={{fontSize:"11px",fontWeight:500,color:dk?"rgba(148,163,184,0.75)":"#64748b",marginTop:"2px"}}>{pl.type||"Lender"}{pl.nmls?` · NMLS ${pl.nmls}`:""} · HMDA {panelYear}</div>
                        </div>
                      </div>
                      <button type="button" onClick={()=>{setHeroPreviewLender(null);clearSearch();}} aria-label="Dismiss" style={{border:"none",background:dk?"rgba(255,255,255,0.07)":"rgba(15,23,42,0.06)",borderRadius:"9px",width:"28px",height:"28px",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:dk?"rgba(148,163,184,0.7)":"#94a3b8",fontSize:"13px",fontWeight:700,flexShrink:0}}>{IC.x}</button>
                    </div>

                    {/* Stats */}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"1px",background:dk?"rgba(255,255,255,0.04)":"rgba(226,232,240,0.4)"}}>
                      {[
                        {label:"Units Originated",val:plUnits>0?fmtU(plUnits):"—",accent:dk?"#818CF8":"#4F46E5"},
                        {label:"Loan Volume",val:plVol>0?fmtD(plVol):"—",accent:dk?"#34D399":"#059669"},
                        {label:"States Active",val:pl.states||"—",accent:dk?"#FCD34D":"#D97706"},
                      ].map(s=>(
                        <div key={s.label} style={{padding:"14px 16px",background:dk?"rgba(15,23,42,0.5)":"rgba(255,255,255,0.7)"}}>
                          <div style={{fontSize:"9px",fontWeight:600,letterSpacing:"0.09em",textTransform:"uppercase",color:dk?"rgba(148,163,184,0.7)":"#94a3b8",marginBottom:"5px"}}>{s.label}</div>
                          <div style={{fontSize:"20px",fontWeight:700,letterSpacing:"-0.03em",fontFamily:"var(--font-mono,'JetBrains Mono'),ui-monospace,monospace",color:s.accent}}>{s.val}</div>
                        </div>
                      ))}
                    </div>

                    {/* Loan type mix if available */}
                    {ltRows.length>0 && (
                      <div style={{padding:"14px 18px",borderBottom:`1px solid ${dk?"rgba(255,255,255,0.05)":"rgba(226,232,240,0.5)"}`}}>
                        <div style={{fontSize:"9px",fontWeight:600,letterSpacing:"0.09em",textTransform:"uppercase",color:dk?"rgba(148,163,184,0.7)":"#94a3b8",marginBottom:"10px"}}>Loan Type Mix</div>
                        <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
                          {ltRows.map(r=>{
                            const pct=Math.round((r.orig/ltTotal)*100);
                            return(
                              <div key={r.label} style={{display:"flex",alignItems:"center",gap:"10px"}}>
                                <span style={{fontSize:"12px",fontWeight:500,color:dk?"rgba(226,232,240,0.75)":"#475569",minWidth:"90px"}}>{r.label}</span>
                                <div style={{flex:1,height:"5px",borderRadius:"3px",background:dk?"rgba(255,255,255,0.07)":"rgba(0,0,0,0.05)",overflow:"hidden"}}>
                                  <div style={{height:"100%",width:`${pct}%`,borderRadius:"3px",background:"linear-gradient(90deg,#6366f1,#818cf877)",transition:"width 0.7s ease"}}/>
                                </div>
                                <span style={{fontSize:"11px",fontWeight:600,color:dk?"rgba(148,163,184,0.75)":"#64748b",minWidth:"56px",textAlign:"right",fontFamily:"var(--font-mono,'JetBrains Mono'),ui-monospace,monospace"}}>{fmtU(r.orig)} ({pct}%)</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div style={{display:"flex",gap:"8px",padding:"14px 18px",flexWrap:"wrap"}}>
                      <button type="button" onClick={()=>openLenderOnMap(pl)} style={{flex:"1 1 140px",padding:"11px 14px",borderRadius:"12px",border:"none",cursor:"pointer",fontSize:"13px",fontWeight:700,background:dk?"rgba(99,102,241,0.22)":"rgba(99,102,241,0.10)",color:dk?"#818CF8":"#4F46E5",display:"flex",alignItems:"center",justifyContent:"center",gap:"6px",transition:"background 0.15s"}} onMouseEnter={e=>e.currentTarget.style.background=dk?"rgba(99,102,241,0.32)":"rgba(99,102,241,0.18)"} onMouseLeave={e=>e.currentTarget.style.background=dk?"rgba(99,102,241,0.22)":"rgba(99,102,241,0.10)"}>
                        {IC.mapPin} View on Map
                      </button>
                      <button type="button" onClick={()=>{setProductsSelectedLender(pl);setProductsLenderSearch(pl.name||"");setProductsLtSnapshot(null);startTransition(()=>{setForceResults(true);setTab("products");if(location.pathname!=="/products")navigate("/products");});setHeroPreviewLender(null);}} style={{flex:"1 1 120px",padding:"11px 14px",borderRadius:"12px",border:"none",cursor:"pointer",fontSize:"13px",fontWeight:700,background:dk?"rgba(52,211,153,0.14)":"rgba(5,150,105,0.08)",color:dk?"#34D399":"#059669",display:"flex",alignItems:"center",justifyContent:"center",gap:"6px",transition:"background 0.15s"}} onMouseEnter={e=>e.currentTarget.style.background=dk?"rgba(52,211,153,0.22)":"rgba(5,150,105,0.15)"} onMouseLeave={e=>e.currentTarget.style.background=dk?"rgba(52,211,153,0.14)":"rgba(5,150,105,0.08)"}>
                        {IC.database} Products
                      </button>
                      <button type="button" onClick={()=>{startTransition(()=>{setForceResults(true);setQ(pl.name||"");setQInput(pl.name||"");setTab("lenders");if(location.pathname!=="/")navigate("/");});setHeroPreviewLender(null);}} style={{flex:"1 1 120px",padding:"11px 14px",borderRadius:"12px",border:"none",cursor:"pointer",fontSize:"13px",fontWeight:700,background:dk?"rgba(255,255,255,0.05)":"rgba(15,23,42,0.05)",color:dk?"rgba(226,232,240,0.8)":"#475569",display:"flex",alignItems:"center",justifyContent:"center",gap:"6px",transition:"background 0.15s"}} onMouseEnter={e=>e.currentTarget.style.background=dk?"rgba(255,255,255,0.09)":"rgba(15,23,42,0.09)"} onMouseLeave={e=>e.currentTarget.style.background=dk?"rgba(255,255,255,0.05)":"rgba(15,23,42,0.05)"}>
                        {IC.building} Lenders
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        ) : (
          <>
        {/* "" NAV (products / geography — lenders tab uses merged toolbar in lenders panel) "" */}
        {!embedMode && tab !== "lenders" ? (
        <nav className="hmda-nav hmda-nav-pastel" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"8px",flexWrap:"nowrap",marginBottom:isMobile?"12px":"20px",padding:isMobile?"4px 4px":"5px 6px",width:"100%",maxWidth:"100%",position:"relative",zIndex:showSuggestions&&searchSuggestions.length>0?1101:"auto"}}>
          <div style={{display:"flex",gap:"4px",flex:isMobile?1:"unset",alignItems:"center"}}>
            {hmdaToolbarHomeBtn}
            {tabs.map(tb=>(
              <button key={tb.id} data-demo-target={tb.id==="lenders"?"nav-lenders":tb.id==="products"?"nav-products":tb.id==="geography"?"nav-geography":undefined} className="tab-item" onClick={()=>{if(tb.id==="lenders")goToLendersTab({forceResults:showResults});else{setTab(tb.id);setMobileMenuOpen(false);}}} style={{display:"flex",alignItems:"center",justifyContent:isMobile?"center":"flex-start",gap:"8px",padding:isMobile?"10px 0":"11px 22px",borderRadius:"12px",border:"none",cursor:"pointer",fontSize:isMobile?"13px":"14px",fontFamily:"inherit",background:tab===tb.id?c.chipActive:"transparent",color:tab===tb.id?c.accent:c.chipText,boxShadow:tab===tb.id?`0 1px 6px ${dk?"rgba(129,140,248,0.10)":"rgba(99,102,241,0.05)"}`:"none",flexShrink:0,flex:isMobile?1:"unset"}}>
                <HmdaTabIconWell tabId={tb.id} dark={dk}><span style={{display:"inline-flex",opacity:tab===tb.id?1:0.82}}>{tb.icon}</span></HmdaTabIconWell>
                {!isMobile && tb.label}
                {isMobile && <span className="hmda-label" style={{fontSize:"10px",display:"block",opacity:tab===tb.id?1:0.6}}>{tb.label}</span>}
              </button>
            ))}
          </div>
          {!isMobile && tab !== "products" && <div className="toolbar-shell" data-hmda-search-ui style={{display:"flex",flexDirection:"row",alignItems:"center",gap:"8px",padding:"6px 8px",width:"50%",maxWidth:"680px",minWidth:"460px",position:"relative"}}>
            <div className="hmda-nav-search-well" style={{display:"flex",alignItems:"center",gap:"10px",flex:1,minWidth:0,padding:"9px 11px"}}>
              <span style={{color:c.text3,flexShrink:0}}>{IC.search}</span>
              <input type="text" placeholder="Search lender, county, city, MSA, or census tract..." value={qInput} onChange={e=>{setQInput(e.target.value);setShowSuggestions(true);}}
                onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();commitSearch(qInput);}}}
                onFocus={()=>{const t=qInput.trim();if(/^\d+$/.test(t)||t.length>=2)setShowSuggestions(true);}}
                style={{flex:1,border:"none",outline:"none",background:"transparent",color:c.text,fontSize:"14px",fontFamily:"inherit",fontWeight:500,minWidth:0}}/>
              {qInput&&<button onClick={clearSearch} style={{border:"none",background:c.chip,borderRadius:"8px",width:"26px",height:"26px",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:c.text3,flexShrink:0}}>{IC.x}</button>}
              {hmdaSearchLenderPinBtn}
              {hmdaSearchLenderTrackBtn}
              {hmdaSearchLenderMapBtn}
            </div>
            {showSuggestions&&searchSuggestions.length>0&&(
              <div data-hmda-search-ui style={{position:"absolute",top:"100%",left:"8px",right:"8px",marginTop:"4px",padding:"6px",borderRadius:"12px",background:c.surface,border:`1px solid ${c.border}`,boxShadow:dk?"0 12px 32px rgba(0,0,0,0.35)":"0 12px 28px rgba(15,23,42,0.1)",zIndex:1300,maxHeight:"280px",overflowY:"auto"}}>
                {searchSuggestions.map((s,i)=>(
                  <button key={i} type="button" onClick={()=>commitSearch(suggestionToQueryValue(s))} style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",padding:"10px 12px",borderRadius:"8px",border:"none",cursor:"pointer",fontSize:"13px",fontWeight:500,fontFamily:"inherit",background:"transparent",color:c.text2,textAlign:"left",gap:"8px"}}
                    onMouseEnter={e=>e.currentTarget.style.background=dk?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.03)"}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.label}</span>
                    <span style={{fontSize:"10px",fontWeight:700,letterSpacing:"0.04em",textTransform:"uppercase",color:c.text4,flexShrink:0,padding:"2px 6px",borderRadius:"4px",background:c.chip}}>{s.category}</span>
                  </button>
                ))}
              </div>
            )}
            <Tip
              text={
                pinnedLenders.length < 2
                  ? `Pin ${Math.max(2 - pinnedLenders.length, 0)} more lender${pinnedLenders.length === 1 ? "" : "s"} to compare`
                  : `Compare ${pinnedLenders.length} pinned lenders`
              }
              pos="bottom"
            >
              <button
                type="button"
                aria-label={pinnedLenders.length < 2 ? "Compare pinned lenders (pin at least 2)" : `Compare ${pinnedLenders.length} pinned lenders`}
                onClick={() => { if (pinnedLenders.length >= 2) setCompareOpen(true); }}
                disabled={pinnedLenders.length < 2}
                className="hmda-nav-compare-btn"
                data-active={pinnedLenders.length >= 2 ? "true" : "false"}
                style={{
                  position: "relative",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  border: `1px solid ${pinnedLenders.length >= 2 ? "rgba(99,102,241,0.28)" : c.border}`,
                  background: pinnedLenders.length >= 2 ? c.chipActive : c.surface,
                  color: pinnedLenders.length >= 2 ? c.accent : c.text3,
                  cursor: pinnedLenders.length < 2 ? "not-allowed" : "pointer",
                  opacity: pinnedLenders.length < 2 ? 0.55 : 1,
                  flexShrink: 0,
                  transition: "background 0.15s ease, color 0.15s ease, border-color 0.15s ease",
                }}
              >
                <GitCompareArrows size={17} strokeWidth={2} aria-hidden />
                {pinnedLenders.length > 0 && (
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      top: -5,
                      right: -5,
                      minWidth: 18,
                      height: 18,
                      padding: "0 5px",
                      borderRadius: 999,
                      background: c.accent,
                      color: "#fff",
                      fontSize: 10,
                      fontWeight: 800,
                      fontFamily: "'JetBrains Mono',monospace",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                      boxShadow: "0 2px 6px rgba(15,23,42,0.18)",
                      border: `1.5px solid ${c.surface}`,
                    }}
                  >
                    {pinnedLenders.length}
                  </span>
                )}
              </button>
            </Tip>
          </div>}
        </nav>
        ) : null}

        {trackRecordOpen && searchMapLender ? (
          <HmdaLenderTrackRecordPanel
            lender={searchMapLender}
            rows={searchLenderTrackRows}
            scopedRows={trackRecordScopedRows}
            totals={trackRecordTotals}
            range={trackRecordRange}
            onRangeChange={setTrackRecordRange}
            availableYears={trackRecordYearOptions}
            onClose={() => setTrackRecordOpen(false)}
            onPin={() => togglePin(searchMapLender)}
            isPinned={searchLenderIsPinned}
            pinDisabled={searchLenderPinDisabled}
            maxPins={maxPinnedLenders}
            onOpenMap={() => openLenderOnMap(searchMapLender)}
            onOpenProfile={() => openLender(searchMapLender)}
            c={c}
            isMobile={isMobile}
          />
        ) : null}

        {/* Mobile: search below nav when not on lenders merged toolbar */}
        {isMobile && showResults && tab !== "lenders" && (
          <div className="toolbar-shell" data-hmda-search-ui style={{marginBottom:"16px",padding:"10px 12px",borderRadius:"12px",background:c.inputBg,border:`1px solid ${c.inputBorder}`,position:"relative"}}>
            <div style={{display:"flex",alignItems:"center",gap:"10px",minWidth:0}}>
              <span style={{color:c.text3,flexShrink:0}}>{IC.search}</span>
              <input
                type="text"
                placeholder="Search lender, county, city, MSA, or census tract..."
                value={qInput}
                onChange={e=>{setQInput(e.target.value);setShowSuggestions(true);}}
                onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();commitSearch(qInput);}}}
                onFocus={()=>{const t=qInput.trim();if(/^\d+$/.test(t)||t.length>=2)setShowSuggestions(true);}}
                style={{flex:1,border:"none",outline:"none",background:"transparent",color:c.text,fontSize:"15px",fontFamily:"inherit",fontWeight:500,minWidth:0}}
                aria-label="Search lenders"
              />
              {qInput&&<button onClick={clearSearch} style={{border:"none",background:c.chip,borderRadius:"8px",width:"28px",height:"28px",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:c.text3,flexShrink:0}} aria-label="Clear search">{IC.x}</button>}
              {hmdaSearchLenderPinBtn}
              {hmdaSearchLenderTrackBtn}
              {hmdaSearchLenderMapBtn}
            </div>
            {showSuggestions&&searchSuggestions.length>0&&(
              <div className="hmda-search-suggestions" data-hmda-search-ui style={{position:"absolute",top:"100%",left:"12px",right:"12px",marginTop:"4px",padding:"6px",borderRadius:"12px",background:c.surface,border:`1px solid ${c.border}`,boxShadow:dk?"0 12px 32px rgba(0,0,0,0.35)":"0 12px 28px rgba(15,23,42,0.1)",zIndex:1300}}>
                {searchSuggestions.map((s,i)=>(
                  <button key={i} type="button" onClick={()=>commitSearch(suggestionToQueryValue(s))} style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",padding:"12px 14px",borderRadius:"8px",border:"none",cursor:"pointer",fontSize:"14px",fontWeight:500,fontFamily:"inherit",background:"transparent",color:c.text2,textAlign:"left",gap:"8px",minHeight:"44px",boxSizing:"border-box"}}
                    onMouseEnter={e=>e.currentTarget.style.background=dk?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.03)"}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.label}</span>
                    <span style={{fontSize:"10px",fontWeight:700,letterSpacing:"0.04em",textTransform:"uppercase",color:c.text4,flexShrink:0,padding:"2px 6px",borderRadius:"4px",background:c.chip}}>{s.category}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Shared quick search results (Overview / Products / Geography) — hidden when lender map is active */}
        {q.trim() && tab!=="lenders" && !mapFocusLenderKey?.lei && (
          <Card className="hmda-nav-search-card hmda-inspector-glass" style={{marginBottom:"18px",padding:0}} pad={0}>
            <header className="hmda-inspector-glass__head">
              <div className="hmda-inspector-glass__title-block">
                <span className="hmda-inspector-glass__badge">Search</span>
                <h2 className="hmda-inspector-glass__title">
                  <span className="title-light">Results for</span>{' '}
                  <span className="title-strong">&ldquo;{q}&rdquo;</span>
                </h2>
                <p className="hmda-inspector-glass__subtitle">
                  Click a county for geography drilldown, or a lender for profile details.
                </p>
              </div>
              {navSearchResults.length > 0 && (
                <button
                  type="button"
                  onClick={()=>goToLendersTab({forceResults:true})}
                  className="hmda-inspector-glass__cta"
                >
                  Open in Lenders
                </button>
              )}
            </header>
            <div className="hmda-inspector-glass__body">
            {(countyGlobalSearchResults.length > 0 || navSearchResults.length > 0) ? (
              <>
                {countyGlobalSearchResults.length > 0 && (
                  <div>
                    <div className="hmda-inspector-glass__section-label">
                      County matches
                    </div>
                    <div className="hmda-inspector-glass__grid">
                      {countyGlobalSearchResults.map((row)=>(
                        <div
                          key={`global-county-${row.stateCode}-${row.countyCode}`}
                          role="button"
                          tabIndex={0}
                          onClick={()=>openCountyFromGlobalSearch(row.stateCode, row.countyCode)}
                          onKeyDown={(e)=>{ if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCountyFromGlobalSearch(row.stateCode, row.countyCode); } }}
                          className="hmda-inspector-glass__row"
                        >
                          <div className="hmda-inspector-glass__row-main">
                            <div className="hmda-inspector-glass__row-title">
                              {row.countyLabel}
                            </div>
                            <div className="hmda-inspector-glass__row-meta">
                              {row.stateCode} · HMDA {panelYear}
                            </div>
                          </div>
                          <div className="hmda-inspector-glass__metric">{fmtUnits(row.units)}</div>
                          <div className="hmda-inspector-glass__metric">{fmtDollar(row.volume)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {navSearchResults.length > 0 && (
                  <div>
                    <div className="hmda-inspector-glass__section-label">
                      Lender matches
                    </div>
                    <div className="hmda-inspector-glass__grid">
                      {navSearchResults.map((l)=>(
                        <div
                          key={`global-search-${lenderCacheKey(l) || l.id}`}
                          className="hmda-inspector-glass__lender-card"
                          onClick={()=>l.lei ? openLenderOnMap(l) : openLender(l)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e)=>{ if (e.key === "Enter" || e.key === " ") { e.preventDefault(); l.lei ? openLenderOnMap(l) : openLender(l); } }}
                        >
                          <div className="hmda-inspector-glass__lender-head">
                            <div className="hmda-inspector-glass__row-main">
                              <div className="hmda-inspector-glass__row-title">
                                {l.name}
                              </div>
                              <div className="hmda-inspector-glass__row-meta">
                                <span>#{l.nmls}</span>
                                <span>{l.dataYear}</span>
                                <span>{fmtUnits(l.originations)} units</span>
                                <span>{fmtDollar(l.dollarVol)}</span>
                              </div>
                            </div>
                            <div className="hmda-nav-search-lender-actions" style={{display:"flex",alignItems:"center",gap:"4px",flexShrink:0}}>
                              <button
                                type="button"
                                onClick={(e)=>{e.stopPropagation();togglePin(l);}}
                                className="sort-btn"
                                style={{border:"none",padding:"6px 9px",borderRadius:"9px",cursor:"pointer",fontSize:"11px",fontWeight:700,background:isPinned(l)?c.chipActive:"rgba(255,255,255,0.55)",color:isPinned(l)?c.accent:"#475569",borderWidth:1,borderStyle:"solid",borderColor:"rgba(255,255,255,0.75)"}}
                              >
                                {isPinned(l) ? "Pinned" : "Pin"}
                              </button>
                              <button
                                type="button"
                                className="hmda-nav-search-lender-remove"
                                onClick={(e) => dismissNavSearchLender(l, e)}
                                aria-label={`Remove ${l.name} from search results`}
                                title="Remove from matches"
                              >
                                {IC.x}
                              </button>
                            </div>
                          </div>
                          <div className="hmda-inspector-glass__lender-metrics">
                            <HmdaCompactLenderMetrics lender={l} c={c} isMobile={isMobile} marketRef={hmdaMarketRef} Tip={Tip} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="hmda-inspector-glass__empty">
                No county or lender matches found.
              </div>
            )}
            </div>
          </Card>
        )}

        {/* ───────────────────────────────────────────────────── LENDERS ───────────────────────────────────────────────────── */}
        {tab==="lenders"&&(
          <div className="hmda-lenders-tab-stack" style={{animation:"rise 0.4s ease",paddingBottom:isMobile?"100px":0}}>
            <div ref={filterBarRef} data-demo-target="filter-bar" className={`hmda-filter-bar${openFilter ? " hmda-filter-bar--menu-open" : ""}${showSuggestions && searchSuggestions.length > 0 ? " hmda-filter-bar--search-open" : ""}`} style={{marginBottom:isMobile?"8px":"12px",width:"100%",alignSelf:"stretch",marginTop:isMobile?0:"-4px",position:"relative",zIndex:(showSuggestions&&searchSuggestions.length>0)?1101:(openFilter?10040:1)}}>
              {isMobile ? (
              <div
                className="toolbar-shell hmda-nav-filter-merge hmda-filter-toolbar-pastel hmda-filter-toolbar--mf"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "stretch",
                  gap: 8,
                  padding: "8px 8px",
                  width: "100%",
                  maxWidth: "100%",
                  borderRadius: 14,
                  overflowX: "visible",
                  boxSizing: "border-box",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, width: "100%", flexWrap: "wrap", minWidth: 0 }}>
                  {hmdaLendersToolbarTabIcons}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: "auto" }}>
                    {hmdaLendersViewModeToggle}
                    {hmdaLendersCountChip}
                  </div>
                </div>
                <div className="hmda-filter-toolbar-mobile-filters">{hmdaLendersFilterNodes}</div>
                <div className="toolbar-shell" data-hmda-search-ui style={{ width: "100%", padding: "6px 8px", borderRadius: "11px", position: "relative", boxSizing: "border-box" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                    <span style={{ color: c.text3, flexShrink: 0 }} aria-hidden>
                      {IC.search}
                    </span>
                    <input
                      type="text"
                      placeholder="Search lender, county, MSA…"
                      value={qInput}
                      onChange={(e) => {
                        setQInput(e.target.value);
                        setShowSuggestions(true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitSearch(qInput);
                        }
                      }}
                      onFocus={() => {
                        const t = qInput.trim();
                        if (/^\d+$/.test(t) || t.length >= 2) setShowSuggestions(true);
                      }}
                      aria-label="Search lenders and geography"
                      style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: c.text, fontSize: "16px", fontFamily: "inherit", fontWeight: 500, minWidth: 0 }}
                    />
                    {qInput && (
                      <button type="button" onClick={clearSearch} aria-label="Clear search" style={{ border: "none", background: c.chip, borderRadius: "8px", width: "28px", height: "28px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: c.text3, flexShrink: 0 }}>
                        {IC.x}
                      </button>
                    )}
                    {hmdaSearchLenderMapBtn}
                  </div>
                  {showSuggestions && searchSuggestions.length > 0 && (
                    <div data-hmda-search-ui style={{ position: "absolute", top: "100%", left: "10px", right: "10px", marginTop: "4px", padding: "6px", borderRadius: "12px", background: c.surface, border: `1px solid ${c.border}`, boxShadow: dk ? "0 12px 32px rgba(0,0,0,0.35)" : "0 12px 28px rgba(15,23,42,0.1)", zIndex: 1300, maxHeight: "min(280px, 50vh)", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
                      {searchSuggestions.map((s, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => commitSearch(suggestionToQueryValue(s))}
                          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "10px 12px", borderRadius: "8px", border: "none", cursor: "pointer", fontSize: "13px", fontWeight: 500, fontFamily: "inherit", background: "transparent", color: c.text2, textAlign: "left", gap: "8px" }}
                        >
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
                          <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: c.text4, flexShrink: 0, padding: "2px 6px", borderRadius: "4px", background: c.chip }}>{s.category}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, flexWrap: "wrap", width: "100%", minWidth: 0 }}>
                  {hmdaLendersPinsToolbar}
                </div>
              </div>
              ) : (
              <div className="toolbar-shell hmda-nav-filter-merge hmda-filter-toolbar-pastel" style={{ display: "flex", flexWrap: "nowrap", alignItems: "center", gap: "8px", padding: "8px 14px", width: "100%", borderRadius: "14px", overflowX: showSuggestions && searchSuggestions.length > 0 ? "visible" : "auto", overflowY: "visible" }}>
                {hmdaLendersToolbarTabIcons}
                <div aria-hidden style={{ width: 1, height: 22, background: c.drillBorder, flexShrink: 0, opacity: 0.85 }} />
                <div style={{ display: "flex", alignItems: "center", flexWrap: "nowrap", gap: 6, flexShrink: 0 }}>{hmdaLendersFilterNodes}</div>
                <div aria-hidden style={{ width: 1, height: 22, background: c.drillBorder, flexShrink: 0, opacity: 0.85 }} />
                <div className="toolbar-shell hmda-lenders-toolbar-search" data-hmda-search-ui style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "8px", flex: "0 1 280px", minWidth: 160, maxWidth: 300, position: "relative", padding: "4px 8px" }}>
                  <div className="hmda-nav-search-well" style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: 0, padding: "7px 9px" }}>
                    <span style={{ color: c.text3, flexShrink: 0 }} aria-hidden>
                      {IC.search}
                    </span>
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Search lender…"
                      value={qInput}
                      onChange={(e) => {
                        setQInput(e.target.value);
                        setShowSuggestions(true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitSearch(qInput);
                        }
                        if (e.key === "Escape") setShowSuggestions(false);
                      }}
                      onFocus={() => {
                        const t = qInput.trim();
                        if (/^\d+$/.test(t) || t.length >= 2) setShowSuggestions(true);
                      }}
                      aria-label="Search lenders and geography"
                      aria-autocomplete="list"
                      aria-expanded={showSuggestions && searchSuggestions.length > 0}
                      aria-controls="hmda-lenders-search-suggest"
                      style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: c.text, fontSize: "13px", fontFamily: "inherit", fontWeight: 500, minWidth: 0 }}
                    />
                    {qInput && (
                      <button type="button" onClick={clearSearch} aria-label="Clear search" style={{ border: "none", background: c.chip, borderRadius: "8px", width: "26px", height: "26px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: c.text3, flexShrink: 0 }}>
                        {IC.x}
                      </button>
                    )}
                    {hmdaSearchLenderMapBtn}
                  </div>
                  {showSuggestions && searchSuggestions.length > 0 && (
                    <div id="hmda-lenders-search-suggest" role="listbox" data-hmda-search-ui style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, padding: "6px", borderRadius: "12px", background: c.surface, border: `1px solid ${c.border}`, boxShadow: dk ? "0 12px 32px rgba(0,0,0,0.35)" : "0 12px 28px rgba(15,23,42,0.12)", zIndex: 1300, maxHeight: "280px", overflowY: "auto" }}>
                      {searchSuggestions.map((s, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => commitSearch(suggestionToQueryValue(s))}
                          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "10px 12px", borderRadius: "8px", border: "none", cursor: "pointer", fontSize: "13px", fontWeight: 500, fontFamily: "inherit", background: "transparent", color: c.text2, textAlign: "left", gap: "8px" }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.03)")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                        >
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
                          <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: c.text4, flexShrink: 0, padding: "2px 6px", borderRadius: "4px", background: c.chip }}>{s.category}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div aria-hidden style={{ width: 1, height: 22, background: c.drillBorder, flexShrink: 0, opacity: 0.85 }} />
                {hmdaLendersViewModeToggle}
                {hmdaLendersCountChip}
                {hmdaLendersPinsToolbar}
              </div>
              )}

              {isMobile&&(
                <div style={{position:"fixed",left:"10px",right:"10px",bottom:"10px",zIndex:95,display:"flex",alignItems:"center",gap:"8px",padding:"10px",borderRadius:"14px",background:c.surfaceRaised,border:`1px solid ${c.border}`,backdropFilter:"blur(16px)",boxShadow:dk?"0 10px 24px rgba(0,0,0,0.35)":"0 10px 24px rgba(15,23,42,0.08)"}}>
                  <div style={{fontSize:"11px",fontWeight:700,color:c.text3,whiteSpace:"nowrap"}}>Pinned</div>
                  <div style={{fontSize:"12px",fontWeight:700,color:c.accent,fontFamily:"'JetBrains Mono',monospace",whiteSpace:"nowrap"}}>{pinnedLenders.length}/{pinCapDisplay}</div>
                  <button
                    onClick={()=>setCompareOpen(true)}
                    disabled={pinnedLenders.length < 2}
                    className="sort-btn hmda-btn-playful"
                    style={{flex:1,border:"none",padding:"10px 12px",borderRadius:"10px",cursor:pinnedLenders.length < 2 ? "not-allowed" : "pointer",fontSize:"13px",fontWeight:700,background:pinnedLenders.length < 2 ? c.chip : c.chipActive,color:pinnedLenders.length < 2 ? c.chipText : c.accent,opacity:pinnedLenders.length < 2 ? 0.55 : 1}}
                  >
                    <span style={{display:"inline-flex",marginRight:6,verticalAlign:"middle",opacity:0.9}}><GitCompareArrows size={15} strokeWidth={2} aria-hidden /></span>Compare
                  </button>
                  <button
                    onClick={clearPinned}
                    disabled={pinnedLenders.length === 0}
                    className="sort-btn"
                    style={{border:"none",padding:"10px 12px",borderRadius:"10px",cursor:pinnedLenders.length === 0 ? "not-allowed" : "pointer",fontSize:"12px",fontWeight:700,background:c.chip,color:c.chipText,opacity:pinnedLenders.length === 0 ? 0.5 : 1}}
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            <div className="hmda-lenders-results-rule" style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"8px"}}>
              <div style={{height:"1px",flex:1,background:dk?"linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.14) 40%, rgba(255,255,255,0.04) 100%)":"linear-gradient(90deg, transparent 0%, rgba(15,23,42,0.18) 40%, rgba(15,23,42,0.05) 100%)"}} />
              <span style={{width:"5px",height:"5px",borderRadius:"50%",background:c.accent,opacity:0.65,flexShrink:0}} />
              <div style={{height:"1px",flex:1,background:dk?"linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.14) 60%, transparent 100%)":"linear-gradient(90deg, rgba(15,23,42,0.05) 0%, rgba(15,23,42,0.18) 60%, transparent 100%)"}} />
            </div>

            {/* Cards */}
            {lendersTabAwaitingData ? null : (lenderQuery.lenders?.length > 0 || LENDERS.length > 0) && lendersUseGrid ? (
            <div className="hmda-results-panel">
            <div className="hmda-results-grid">
              {pagedLenders.map((l,i)=>{
                const gRank = resolveLenderDisplayRank(
                  lenderRankMap,
                  l.id,
                  (safePage - 1) * LENDER_PAGE_SIZE + i + 1,
                );
                const instClass = l.type === "Credit Union" ? "Credit Union" : l.type === "Bank" ? "Depository" : "IMB";
                const leadTone = l.type === "Credit Union" ? "cu" : l.type === "Bank" ? "bank" : "imb";
                return (
                <div
                  key={lenderCacheKey(l) || l.id}
                  className="lcard-item hmda-results-grid-card hmda-results-grid-card--clean hmda-results-grid-card--accordion"
                  style={{
                    padding: "0",
                    cursor: "default",
                    animationDelay:`${Math.min(i,12)*0.04}s`,
                    transition:"transform 0.22s ease, box-shadow 0.22s ease",
                    overflow:"hidden",
                  }}
                >
                  <div className="hmda-results-grid-card-inner">
                    <div
                      className="hmda-results-grid-card-head hmda-results-grid-card-head--interactive hmda-results-list-row-minimal hmda-results-grid-card-head--minimal"
                      role="button"
                      tabIndex={0}
                      onClick={() => openLender(l)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openLender(l);
                        }
                      }}
                    >
                      <div className={`hmda-results-list-rank-minimal hmda-results-list-rank-minimal--${leadTone}`} aria-hidden>
                        <span className="hmda-results-list-rank-minimal-num">{gRank}</span>
                      </div>
                      <div className="hmda-results-list-identity-minimal">
                        <span className="hmda-results-list-name-minimal">{l.name}</span>
                        <span
                          className="hmda-results-list-meta-minimal"
                          aria-label={`${instClass}, NMLS ${String(l.nmls || "").trim() || "—"}, ${l.originations.toLocaleString()} originations`}
                        >
                          <span className="hmda-results-list-meta-type">{instClass}</span>
                          {!isMobile && (
                            <>
                              <span className="hmda-results-list-meta-dot">·</span>
                              <Tip text={TIPS.NMLS}>
                                <span className="hmda-results-list-meta-nmls">NMLS {String(l.nmls || "").trim() || "—"}</span>
                              </Tip>
                            </>
                          )}
                        </span>
                      </div>
                      <div className="hmda-results-list-tail-minimal hmda-results-grid-head-tail-minimal">
                        {renderLenderMapBtn(l, { compact: true })}
                        <Tip text={TIPS["Pin compare"]} pos="left">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              togglePin(l);
                            }}
                            disabled={!isPinned(l) && pinnedLenders.length >= maxPinnedLenders}
                            className="hmda-results-list-pin-minimal hmda-results-grid-pin--icon-only"
                            aria-label={isPinned(l) ? "Unpin lender" : "Pin lender for compare"}
                            title={!isPinned(l) && pinnedLenders.length >= maxPinnedLenders ? `Maximum ${maxPinnedLenders} lenders pinned` : undefined}
                          >
                            <Pin
                              size={13}
                              strokeWidth={2.2}
                              aria-hidden
                              className={isPinned(l) ? "hmda-action-pin-icon hmda-action-pin-icon--active" : "hmda-action-pin-icon"}
                            />
                          </button>
                        </Tip>
                        <span className="lcard-arrow hmda-results-list-chevron-minimal hmda-results-grid-card-open-chevron" aria-hidden>
                          {IC.chevRight}
                        </span>
                      </div>
                    </div>

                    <div className="hmda-results-grid-card-body hmda-results-grid-card-sheet hmda-results-grid-card-body--accordion" onClick={(e) => e.stopPropagation()}>
                    <HmdaLenderCardAccordion type="multiple" defaultValue={["production"]} className="hmda-lender-card-accordion w-full">
                      <HmdaLenderCardAccordionItem value="production">
                        <HmdaLenderCardAccordionTrigger
                          icon={BarChart3}
                          title="Production"
                          sub={`HMDA ${l.dataYear || yearF || HMDA_PREFERRED_YEAR} · ${fmtUnits(l.units)} units · ${l.states ?? "—"} states`}
                        />
                        <HmdaLenderCardAccordionContent className="hmda-lender-card-accordion-content">
                          <div
                            className="hmda-lcard-metrics-row hmda-lcard-metrics-row--clean"
                            style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 14 : 20, marginBottom: 10 }}
                          >
                            <LenderCardMetric variant="clean" dk={dk} tone={dk ? "exec" : "mint"} icon={IC.chart} label="Units Closed" value={fmtUnits(l.units)} tip={TIPS.Units} Tip={Tip} valueFs={isMobile ? "22px" : "24px"} alignEnd={false} iconTint="chart" />
                            <LenderCardMetric variant="clean" dk={dk} tone={dk ? "exec" : "violet"} icon={IC.dollar} label="Volume" value={fmtDollar(l.dollarVol)} tip={TIPS["Volume"]} Tip={Tip} valueFs={isMobile ? "17px" : "18px"} alignEnd iconTint="dollar" />
                          </div>
                          <HmdaGridCardStatBand lender={l} c={c} dk={dk} Tip={Tip} isMobile={isMobile} cockpitVisual marginBottom={0} onViewDetails={() => setSelected(l)} />
                        </HmdaLenderCardAccordionContent>
                      </HmdaLenderCardAccordionItem>

                      <HmdaLenderCardAccordionItem value="products">
                        <HmdaLenderCardAccordionTrigger
                          icon={Layers}
                          title="Product mix"
                          sub="Originations by HMDA loan type"
                        />
                        <HmdaLenderCardAccordionContent className="hmda-lender-card-accordion-content">
                          <HmdaLenderOriginationsByProduct lender={l} c={c} dk={dk} isMobile={isMobile} Tip={Tip} marginBottom={0} hideEmptyProducts hideUnallocatedNote mutedProductChips />
                        </HmdaLenderCardAccordionContent>
                      </HmdaLenderCardAccordionItem>
                    </HmdaLenderCardAccordion>
                    </div>
                  </div>
                </div>
              );})}
            </div>
            </div>
            ) : (
            <div className="hmda-results-panel">
            <div className="hmda-lender-list-stack">
              {pagedLenders.map((l,i)=>{
                const rank = resolveLenderDisplayRank(
                  lenderRankMap,
                  l.id,
                  (safePage - 1) * LENDER_PAGE_SIZE + i + 1,
                );
                const instClass = l.type === "Credit Union" ? "Credit Union" : l.type === "Bank" ? "Depository" : "IMB";
                const leadTone = l.type === "Credit Union" ? "cu" : l.type === "Bank" ? "bank" : "imb";
                const hInsights = l?.hmdaInsights;
                const listMedianRate =
                  hInsights?.originatedMedianInterestRate != null && Number.isFinite(Number(hInsights.originatedMedianInterestRate))
                    ? `${Number(hInsights.originatedMedianInterestRate).toFixed(3)}%`
                    : null;
                const listSpread = fmtMedianRateSpread(l);
                return (
                <div
                  key={l.id}
                  className="lcard-item hmda-results-grid-card hmda-results-list-card hmda-results-list-card--minimal"
                  onClick={()=>openLender(l)}
                  style={{
                    background: dk ? c.surface : "#ffffff",
                    backdropFilter: dk ? "blur(24px)" : "none",
                    WebkitBackdropFilter: dk ? "blur(24px)" : "none",
                    border: `1px solid ${dk ? c.border : "rgba(59, 130, 246, 0.14)"}`,
                    borderRadius: "10px",
                    padding: "0",
                    cursor: "pointer",
                    animationDelay:`${Math.min(i,12)*0.04}s`,
                    transition:"transform 0.2s ease, box-shadow 0.22s ease, border-color 0.2s ease",
                    overflow:"hidden",
                    boxShadow: dk ? "0 2px 14px rgba(0,0,0,0.12)" : "0 1px 3px rgba(15,23,42,0.06), 0 8px 24px rgba(15,23,42,0.04)",
                  }}
                >
                  <div className="hmda-results-list-row-minimal">
                    <div className={`hmda-results-list-rank-minimal hmda-results-list-rank-minimal--${leadTone}`} aria-hidden>
                      <span className="hmda-results-list-rank-minimal-num">{rank}</span>
                    </div>
                    <div className="hmda-results-list-identity-minimal">
                      <span className="hmda-results-list-name-minimal">{l.name}</span>
                      <span className="hmda-results-list-meta-minimal" aria-label={`${instClass}, NMLS ${String(l.nmls || "").trim() || "—"}, ${l.originations.toLocaleString()} originations`}>
                        <span className="hmda-results-list-meta-type">{instClass}</span>
                        {!isMobile && (
                          <>
                            <span className="hmda-results-list-meta-dot">·</span>
                            <Tip text={TIPS.NMLS}>
                              <span className="hmda-results-list-meta-nmls">NMLS {String(l.nmls || "").trim() || "—"}</span>
                            </Tip>
                          </>
                        )}
                      </span>
                    </div>
                    <div className="hmda-results-list-stats-minimal" role="group" aria-label="Key lender metrics">
                      <Tip text={TIPS.Units} pos="bottom">
                        <div className="hmda-results-list-stat-minimal">
                          <span className="hmda-results-list-stat-label">Units</span>
                          <span className="hmda-results-list-stat-value">{fmtUnits(l.units)}</span>
                        </div>
                      </Tip>
                      <Tip text={TIPS["Volume"]} pos="bottom">
                        <div className="hmda-results-list-stat-minimal">
                          <span className="hmda-results-list-stat-label">Volume</span>
                          <span className="hmda-results-list-stat-value">{fmtDollar(l.dollarVol)}</span>
                        </div>
                      </Tip>
                      <Tip text={TIPS.states} pos="bottom">
                        <div className="hmda-results-list-stat-minimal">
                          <span className="hmda-results-list-stat-label">States</span>
                          <span className="hmda-results-list-stat-value">{String(l.states)}</span>
                        </div>
                      </Tip>
                      {listMedianRate && (
                        <Tip text={TIPS["Current Rate"]} pos="bottom">
                          <div className="hmda-results-list-stat-minimal hmda-results-list-stat-minimal--hide-sm">
                            <span className="hmda-results-list-stat-label">Med rate</span>
                            <span className="hmda-results-list-stat-value">{listMedianRate}</span>
                          </div>
                        </Tip>
                      )}
                      {listSpread !== "—" && (
                        <Tip text={TIPS.rateSpread} pos="bottom">
                          <div className="hmda-results-list-stat-minimal">
                            <span className="hmda-results-list-stat-label">Spread</span>
                            <span className="hmda-results-list-stat-value">{listSpread}</span>
                          </div>
                        </Tip>
                      )}
                    </div>
                    <div className="hmda-results-list-tail-minimal">
                      {renderLenderMapBtn(l)}
                      <Tip text={TIPS["Pin compare"]} pos="left">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePin(l);
                          }}
                          disabled={!isPinned(l) && pinnedLenders.length >= maxPinnedLenders}
                          className="hmda-results-list-pin-minimal hmda-results-grid-pin--labeled"
                          aria-label={isPinned(l) ? "Unpin lender" : "Pin lender for compare"}
                          title={!isPinned(l) && pinnedLenders.length >= maxPinnedLenders ? `Maximum ${maxPinnedLenders} lenders pinned` : undefined}
                          style={{
                            border: "none",
                            padding: "6px 10px",
                            borderRadius: "6px",
                            cursor: !isPinned(l) && pinnedLenders.length >= maxPinnedLenders ? "not-allowed" : "pointer",
                            fontSize: 11,
                            fontWeight: 700,
                            background: isPinned(l) ? c.chipActive : dk ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.05)",
                            color: isPinned(l) ? c.accent : c.chipText,
                            opacity: !isPinned(l) && pinnedLenders.length >= maxPinnedLenders ? 0.45 : 1,
                          }}
                        >
                          <Pin
                            size={13}
                            strokeWidth={2.2}
                            aria-hidden
                            className={isPinned(l) ? "hmda-action-pin-icon hmda-action-pin-icon--active" : "hmda-action-pin-icon"}
                          />
                          <span>{isPinned(l) ? "Pinned" : "Pin"}</span>
                        </button>
                      </Tip>
                      <span className="lcard-arrow hmda-results-list-chevron-minimal" aria-hidden>{IC.chevRight}</span>
                    </div>
                  </div>
                </div>
              );})}
            </div>
            </div>
            )}
            {filtered.length>0&&(
              <div className="hmda-lenders-pagination-bar" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"10px",marginTop:"14px",padding:"10px 12px",borderRadius:"12px",background:c.surface,border:`1px solid ${c.border}`}}>
                <span style={{fontSize:"12px",color:c.text3,fontWeight:600}}>
                  Showing {(safePage-1)*LENDER_PAGE_SIZE+1}-{Math.min(safePage*LENDER_PAGE_SIZE, filteredRawCount)} of {filteredRawCount}
                </span>
                <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                  <button onClick={()=>setCurrentPage(p=>Math.max(1,p-1))} disabled={safePage===1} className="sort-btn" style={{padding:"7px 12px",borderRadius:"10px",border:"none",cursor:safePage===1?"not-allowed":"pointer",fontSize:"12px",fontWeight:700,background:c.chip,color:c.chipText,opacity:safePage===1?0.45:1}}>Prev</button>
                  <span style={{fontSize:"12px",fontWeight:700,color:c.text2,fontFamily:"'JetBrains Mono',monospace"}}>{safePage} / {totalPages}</span>
                  <button onClick={()=>setCurrentPage(p=>Math.min(totalPages,p+1))} disabled={safePage===totalPages} className="sort-btn" style={{padding:"7px 12px",borderRadius:"10px",border:"none",cursor:safePage===totalPages?"not-allowed":"pointer",fontSize:"12px",fontWeight:700,background:c.chip,color:c.chipText,opacity:safePage===totalPages?0.45:1}}>Next</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ───────────────────────────────────────────────────── PRODUCTS ───────────────────────────────────────────────────── */}
        {tab==="products"&&(
          <div style={{animation:"rise 0.4s ease"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"10px",marginBottom:"18px"}}>
              <h3 className="hmda-heading-2" style={{fontSize:"18px",margin:0}}>Market composition</h3>
              <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                <span style={{fontSize:"12px",color:c.text3,fontWeight:600}}>Year</span>
                <select value={yearF} onChange={e=>{const v=e.target.value;startTransition(()=>{setYearF(v);setProductsSearchOpen(false);setProductsSuggestLenders([]);});}} style={{padding:"8px 12px",borderRadius:"10px",border:`1px solid ${c.border}`,background:c.surface,color:c.text2,fontSize:"13px",fontWeight:600,fontFamily:"inherit",cursor:"pointer"}}>
                  {AVAILABLE_YEARS.map((y) => (
                    <option key={y} value={y}>{y}{yearPickerBadge(hmdaYearsManifest, y)}</option>
                  ))}
                </select>
              </div>
            </div>

            {productSummaryData?.meta?.insightsBackfillNote ? (
              <p className="hmda-product-dimension-footnote" role="status" style={{ margin: "0 0 14px", padding: "10px 14px", borderRadius: "12px", border: `1px solid ${c.border}`, background: dk ? "rgba(255,255,255,0.04)" : "rgba(248,250,252,0.9)" }}>
                {productSummaryData.meta.insightsBackfillNote}
              </p>
            ) : null}
            {/* Lender search scoped to Products tab */}
            <div style={{position:"relative",marginBottom:"18px"}}>
              <div style={{display:"flex",alignItems:"center",gap:"8px",padding:"10px 14px",borderRadius:"14px",border:`1px solid ${c.border}`,background:c.surface,backdropFilter:"blur(12px)"}}>
                <span style={{fontSize:"14px",color:c.text3,display:"inline-flex"}} aria-hidden>{IC.search}</span>
                <input
                  type="search"
                  placeholder="Search lender name, LEI, or NMLS…"
                  value={productsLenderSearch}
                  onChange={(e)=>{setProductsLenderSearch(e.target.value);setProductsSearchOpen(true);setProductsSelectedLender(null);}}
                  onFocus={()=>setProductsSearchOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && productsSearchMatches[0]) {
                      e.preventDefault();
                      selectProductsLender(productsSearchMatches[0]);
                    }
                    if (e.key === "Escape") setProductsSearchOpen(false);
                  }}
                  aria-label="Search lenders on Products tab"
                  aria-expanded={productsSearchOpen && productsLenderSearch.trim().length >= 2}
                  aria-controls="hmda-products-lender-suggest"
                  style={{flex:1,minWidth:0,background:"transparent",border:"none",outline:"none",fontSize:"13px",fontWeight:600,color:c.text,fontFamily:"inherit"}}
                />
                {productsSuggestLoading ? (
                  <span style={{fontSize:"11px",color:c.text3,fontWeight:600,flexShrink:0}}>…</span>
                ) : null}
                {productsLenderSearch ? (
                  <button type="button" onClick={()=>{setProductsLenderSearch("");setProductsSearchOpen(false);setProductsSelectedLender(null);setProductsSuggestLenders([]);}} style={{border:"none",background:"transparent",cursor:"pointer",color:c.text3,fontSize:"16px",display:"inline-flex"}} aria-label="Clear lender search">{IC.x}</button>
                ) : null}
              </div>
              {productsSearchOpen && productsLenderSearch.trim().length >= 2 ? (
                <div id="hmda-products-lender-suggest" role="listbox" style={{position:"absolute",top:"calc(100% + 6px)",left:0,right:0,zIndex:100,borderRadius:"14px",border:`1px solid ${c.border}`,background:c.surface,boxShadow:dk?"0 12px 40px rgba(0,0,0,0.40)":"0 12px 40px rgba(15,23,42,0.10)",overflow:"hidden"}}>
                  {productsSearchMatches.length ? productsSearchMatches.map((l, i) => {
                      const larY = larDetailYearForPanel(panelYear);
                      const h = selectHmdaInsightsForYear(l, larY);
                      const units = l.originations ?? l.orig ?? 0;
                      return (
                        <button key={l.id || `${l.lei}-${i}`} type="button" role="option" onClick={() => selectProductsLender(l)} style={{display:"flex",alignItems:"center",gap:"10px",width:"100%",padding:"10px 14px",border:"none",borderBottom:i<productsSearchMatches.length-1?`1px solid ${c.border}`:"none",background:"transparent",cursor:"pointer",textAlign:"left",color:c.text,fontFamily:"inherit"}}>
                          <span style={{fontSize:"12px",fontWeight:700,color:c.text3,flexShrink:0}}>{i+1}</span>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:"13px",fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{l.name}</div>
                            <div style={{fontSize:"10px",color:c.text3}}>HMDA {panelYear} · {fmtUnits(units)} units · {fmtDollar(l.dollarVol||0)}</div>
                          </div>
                          {(h?.loanTypeSummary && Object.keys(h.loanTypeSummary).length > 0) || l.originationBreakdown?.byProduct ? (
                            <span style={{fontSize:"10px",padding:"2px 7px",borderRadius:"5px",background:c.accent+"18",color:c.accent,fontWeight:700,flexShrink:0}}>HMDA Data</span>
                          ) : null}
                        </button>
                      );
                    }) : (
                    <p style={{margin:0,padding:"12px 14px",fontSize:"12px",color:c.text3,fontWeight:600}}>
                      {productsSuggestLoading ? "Searching lenders…" : `No lenders match “${productsLenderSearch.trim()}” for HMDA ${panelYear}.`}
                    </p>
                  )}
                </div>
              ) : null}
            </div>

            {/* Selected lender market composition */}
            {productsSelectedLender && (()=>{
              const l = productsSelectedLender;
              const larY = larDetailYearForPanel(panelYear);
              const h = selectHmdaInsightsForYear(l, larY);
              const insights = h || l.hmdaInsights;
              // Normalize originations: 2025/2022 use `orig`, others use `originations`
              const lUnits = l.originations || l.orig || 0;
              const totalApps = insights?.totalApplications || insights?.applications || 0;
              // Normalize originated: 2022/2023 use `totalOriginated`, newer use `originated`
              const originated = insights?.originated || insights?.totalOriginated || 0;
              const pullthrough = totalApps > 0 ? originated / totalApps : 0;

              // Build loan type rows — 2025 uses originationBreakdown.byProduct (name keys),
              // 2024/earlier with data uses hmdaInsights.loanTypeSummary (numeric code keys).
              // Fall back to productsLtSnapshot (fetched on-demand from FFIEC) for years without static data.
              const snapshotKey = `${String(l.lei||"").trim().toUpperCase()}|${larY}`;
              const liveLts = productsLtSnapshot?.key === snapshotKey ? productsLtSnapshot.loanTypeSummary : null;
              let ltRows = [];
              const byProd = l.originationBreakdown?.byProduct;
              if (byProd && Object.keys(byProd).length > 0) {
                // 2025 structure: keys are product names, values have hmdaLoanType + originated
                const ltNameMap = { Conventional:"Conventional", FHA:"FHA", VA:"VA", USDA:"USDA / RHS" };
                const hmdaOnly = ["Conventional","FHA","VA","USDA"];
                ltRows = hmdaOnly
                  .map(name => {
                    const row = byProd[name];
                    if (!row || !row.originated) return null;
                    return { label: ltNameMap[name] || name, code: name, originated: row.originated, total: lUnits };
                  })
                  .filter(Boolean)
                  .sort((a,b) => b.originated - a.originated);
              } else {
                // Use static loanTypeSummary first, fall back to live FFIEC snapshot
                const ltSummary = (insights?.loanTypeSummary && Object.keys(insights.loanTypeSummary).length)
                  ? insights.loanTypeSummary
                  : (liveLts || {});
                ltRows = Object.entries(ltSummary)
                  .map(([code,row]) => ({
                    label: HMDA_LOAN_TYPE_LABELS[code] || `Type ${code}`,
                    code,
                    originated: row?.originated || 0,
                    total: totalApps,
                  }))
                  .filter(r => r.originated > 0)
                  .sort((a,b) => b.originated - a.originated);
              }
              const ltTotal = ltRows.reduce((s,r) => s + r.originated, 0) || lUnits || 1;

              const purpRows = insights?.loanPurposeSummary ? Object.entries(insights.loanPurposeSummary).map(([code,row])=>{
                const label = HMDA_PURPOSE_ROLLUP[code] || code;
                const o = row?.originated || 0;
                return { label, code, originated: o };
              }).filter(r=>r.originated>0).sort((a,b)=>b.originated-a.originated) : [];

              // If this lender has no data for the selected year, show a notice
              const noYearData = !panelYearLenders.some(pl => String(pl.lei||"").trim().toUpperCase() === String(l.lei||"").trim().toUpperCase());

              return (
                <div className="hmda-product-dimension-card hmda-product-dimension-card--clean hmda-product-dimension-card--blue" style={{animation:"rise 0.4s ease",marginBottom:"24px"}}>
                  <header className="hmda-product-dimension-card__header" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"10px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                      <div style={{width:"40px",height:"40px",borderRadius:"12px",background:dk?"rgba(99,102,241,0.18)":"rgba(99,102,241,0.10)",border:`1px solid ${dk?"rgba(129,140,248,0.25)":"rgba(99,102,241,0.22)"}`,display:"flex",alignItems:"center",justifyContent:"center",color:dk?"#818CF8":"#4F46E5",fontSize:"16px",fontWeight:800}}>{l.name?.slice(0,2)}</div>
                      <div>
                        <h4 className="hmda-product-dimension-card__title hmda-heading-2">{l.name}</h4>
                        <div style={{fontSize:"11px",fontWeight:500,color:dk?"rgba(148,163,184,0.82)":"#64748b",letterSpacing:"-0.01em",marginTop:"2px"}}>{l.type} · NMLS {l.nmls||"—"} · HMDA {panelYear}{noYearData ? ` · No ${panelYear} data` : ""}</div>
                      </div>
                    </div>
                    <button onClick={()=>{setProductsSelectedLender(null);setProductsLenderSearch("");}} style={{border:"none",background:dk?"rgba(255,255,255,0.06)":"rgba(15,23,42,0.05)",borderRadius:"10px",width:"28px",height:"28px",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:dk?"rgba(148,163,184,0.82)":"#64748b",fontSize:"13px",fontWeight:700,transition:"background 0.15s ease"}} onMouseEnter={e=>e.currentTarget.style.background=dk?"rgba(255,255,255,0.10)":"rgba(15,23,42,0.09)"} onMouseLeave={e=>e.currentTarget.style.background=dk?"rgba(255,255,255,0.06)":"rgba(15,23,42,0.05)"}>{IC.x}</button>
                  </header>

                  <div style={{padding:"0 12px 14px"}}>
                    {/* Stat grid */}
                    <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(4, minmax(0, 1fr))",gap:"8px",marginBottom:"16px"}}>
                      {[
                        {label:"Units Closed",value:fmtUnits(lUnits),accent:dk?"#818CF8":"#4F46E5"},
                        {label:"Volume",value:fmtDollar(l.dollarVol||0),accent:dk?"#34D399":"#059669"},
                        {label:"States",value:l.states||"—",accent:dk?"#FCD34D":"#D97706"},
                        {label:"Pull-through",value:pullthrough>0?`${(pullthrough*100).toFixed(1)}%`:"—",accent:dk?"#F472B6":"#DB2777"},
                      ].map(s=>{
                        return (
                          <div key={s.label} style={{display:"flex",alignItems:"center",gap:"10px",padding:"10px 12px",borderRadius:"14px",background:dk?"rgba(255,255,255,0.03)":"rgba(255,255,255,0.50)",border:`1px solid ${dk?"rgba(255,255,255,0.06)":"rgba(226,232,240,0.60)"}`}}>
                            <div style={{width:"8px",height:"8px",borderRadius:"50%",background:s.accent,flexShrink:0,opacity:0.85}} />
                            <div>
                              <div style={{fontSize:"10px",fontWeight:500,letterSpacing:"0.08em",textTransform:"uppercase",color:dk?"rgba(148,163,184,0.82)":"#64748b",marginBottom:"3px"}}>{s.label}</div>
                              <div style={{fontSize:"13px",fontWeight:500,letterSpacing:"-0.03em",fontFamily:"var(--font-mono, 'JetBrains Mono'), ui-monospace, monospace",color:dk?"rgba(226,232,240,0.88)":"#334155"}}>{s.value}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Loan type mix — show rows when available, loading pulse when fetching */}
                    {(ltRows.length > 0 || productsLtLoading) && (
                      <div style={{marginBottom:"14px"}}>
                        <div style={{fontSize:"10px",fontWeight:500,letterSpacing:"0.08em",textTransform:"uppercase",color:dk?"rgba(148,163,184,0.82)":"#64748b",marginBottom:"10px",padding:"0 4px",display:"flex",alignItems:"center",gap:"8px"}}>
                          Loan type mix (HMDA {panelYear})
                          {productsLtLoading && ltRows.length === 0 && <span style={{display:"inline-block",width:"10px",height:"10px",borderRadius:"50%",background:c.accent,opacity:0.6,animation:"pulse 1.2s ease-in-out infinite"}} />}
                        </div>
                        {productsLtLoading && ltRows.length === 0 ? (
                          <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
                            {[90,70,50,30].map((w,i)=>(
                              <div key={i} style={{height:"34px",borderRadius:"8px",background:dk?"rgba(255,255,255,0.05)":"rgba(15,23,42,0.04)",animation:"pulse 1.4s ease-in-out infinite",animationDelay:`${i*0.12}s`}} />
                            ))}
                          </div>
                        ) : (
                          <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
                            {ltRows.map(r=>{
                              const pct = Math.round((r.originated / ltTotal) * 100);
                              return (
                                <div key={r.code} className="hmda-product-dimension-table__row" style={{display:"flex",alignItems:"center",gap:"12px",padding:"8px 10px"}}>
                                  <span className="hmda-product-dimension-table__category" style={{minWidth:"90px"}}>{r.label}</span>
                                  <div style={{flex:1,height:"6px",borderRadius:"3px",background:dk?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.06)",overflow:"hidden"}}>
                                    <div style={{height:"100%",width:`${pct}%`,borderRadius:"3px",background:`linear-gradient(90deg,${c.accent},${c.accent}77)`,transition:"width 0.7s ease"}} />
                                  </div>
                                  <span className="hmda-product-dimension-metric__value" style={{minWidth:"70px",textAlign:"right"}}>{fmtUnits(r.originated)} ({pct}%)</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Loan purpose mix */}
                    {purpRows.length>0 && (
                      <div>
                        <div style={{fontSize:"10px",fontWeight:500,letterSpacing:"0.08em",textTransform:"uppercase",color:dk?"rgba(148,163,184,0.82)":"#64748b",marginBottom:"10px",padding:"0 4px"}}>Loan purpose mix</div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:"6px"}}>
                          {purpRows.map(r=>{
                            const pct = originated>0?Math.round((r.originated/originated)*100):0;
                            return (
                              <span key={r.code} style={{padding:"5px 11px",borderRadius:"10px",fontSize:"12px",fontWeight:500,letterSpacing:"-0.015em",background:dk?"rgba(255,255,255,0.05)":"rgba(255,255,255,0.55)",border:`1px solid ${dk?"rgba(255,255,255,0.08)":"rgba(226,232,240,0.55)"}`,color:dk?"rgba(248,250,252,0.88)":"#334155"}}>
                                {r.label} <span style={{color:dk?"#818CF8":"#4F46E5",fontWeight:600}}>{pct}%</span>
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <p className="hmda-product-dimension-footnote" style={{marginTop:"12px"}}>
                      Data from FFIEC HMDA LAR · LEI {l.lei?.slice(0,8)}… · Data year {panelYear}{liveLts ? " · loan type via FFIEC live" : ""}
                    </p>
                  </div>
                </div>
              );
            })()}

            <HmdaProductDimensionTables
              key={`product-dim-${panelYear}${lenderForTables ? `-${lenderForTables.lei}` : ""}`}
              productDistribution={lenderTableDistribution && lenderTableDistribution.some(p => p.unitsOriginated > 0) ? lenderTableDistribution : productDistribution}
              lenders={lenderForTables ? [lenderForTables] : panelYearLenders}
              panelYear={panelYear}
              isMobile={isMobile}
              onRowDrill={handleDimensionRowDrill}
              lenderContext={lenderForTables ? { name: lenderForTables.name, lei: lenderForTables.lei, originations: lenderForTables.originations || lenderForTables.orig || 0 } : null}
              onClearLenderContext={() => { setProductsSelectedLender(null); setProductsLenderSearch(""); setProductsLtSnapshot(null); }}
            />
          </div>
        )}

        {/* ───────────────────────────────────────────────────── GEOGRAPHY ───────────────────────────────────────────────────── */}
        {tab==="geography"&&geographyTabAnalytics&&(()=>{
          const {
            geoYearLenders,
            geoTotalVol,
            geoTotalUnits,
            geoAvgLoan,
            geoLenderCount,
            geoVisibleLenders,
            geoRankVal,
            geoTopLendersCapped,
            geoTopMaxVal,
            instTypes,
            instTypeTotals,
            instTotalVol,
            selectedTypeMeta,
            selectedTypeMembers,
            loanTypeSorted,
            loanTypeTotal,
            topStatesByVol,
            topStatesByUnits,
          } = geographyTabAnalytics;

          const geoRankFmt = (l) => {
            if (geoLenderRankBy === "units") return fmtUnits(l.originations ?? l.orig ?? 0);
            if (geoLenderRankBy === "avg") {
              const u = l.originations ?? l.orig ?? 0;
              return u > 0 ? fmtDollar(Math.round((l.dollarVol || 0) / u)) : "—";
            }
            return fmtDollar(l.dollarVol || 0);
          };
          const geoTopTotalPages = Math.max(1, Math.ceil(geoTopLendersCapped.length / PAGE_SIZE));
          const geoTopSafePage = Math.min(geoMarketTopLenderPage, geoTopTotalPages);
          const geoTopSliceStart = (geoTopSafePage - 1) * PAGE_SIZE;
          const geoTopLenders = geoTopLendersCapped.slice(geoTopSliceStart, geoTopSliceStart + PAGE_SIZE);

          const selectedTypeVol = selectedTypeMembers.reduce((s, l) => s + (l.dollarVol || 0), 0);
          const selectedTypeUnits = selectedTypeMembers.reduce((s, l) => s + (l.originations || l.orig || 0), 0);
          const selectedTypeAvgLoan = selectedTypeUnits > 0 ? Math.round(selectedTypeVol / selectedTypeUnits) : 0;
          const selectedTypeTopLenders = [...selectedTypeMembers]
            .sort((a, b) => (b.dollarVol || 0) - (a.dollarVol || 0))
            .slice(0, 3);

          const mapboxMetric = geoMapMetric === "avg" ? "avgLoan" : geoMapMetric;
          const onMapboxMetricChange = (id) => setGeoMapMetric(id === "avgLoan" ? "avg" : id);

          // SVG donut helper
          const DonutChart = ({data,total,size=80}) => {
            const r = size*0.38, cx = size/2, cy = size/2;
            let angle = -Math.PI/2;
            const slices = data.map(d=>{
              const pct = d.value/total;
              const start = angle;
              angle += pct * Math.PI * 2;
              const x1 = cx + r*Math.cos(start), y1 = cy + r*Math.sin(start);
              const x2 = cx + r*Math.cos(angle), y2 = cy + r*Math.sin(angle);
              const largeArc = pct > 0.5 ? 1 : 0;
              const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
              return {path, color:d.color, pct};
            });
            const inner = r * 0.55;
            return (
              <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{flexShrink:0}}>
                {slices.map((s,i)=><path key={i} d={s.path} fill={s.color} opacity={0.88}/>)}
                <circle cx={cx} cy={cy} r={inner} fill={dk?"#0f172a":"#fff"}/>
              </svg>
            );
          };

          const geoPremiumActions = (
            <div className="hmda-geo-premium-actions">
                <button
                  type="button"
                  className="hmda-geo-premium-btn"
                  onClick={() => {
                    setMapSelectedState(null);
                    setMapSelectedCountyCode(null);
                    setMapSelectedCensusTract(null);
                    setShowCensusTracts(true);
                    setGeoStateLenderPage(1);
                    setGeoMarketTopLenderPage(1);
                    setGeoMapUiResetNonce((n) => n + 1);
                  }}
                >
                  Reset filters
                </button>
            </div>
          );

          return (
          <div className="hmda-geography-premium hmda-geography-premium--map-hero">
            <motion.div className="hmda-geo-premium-header" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
              <div>
                <div className="hmda-geo-premium-badge">HMDA Analytics</div>
                <h2 className="hmda-geo-premium-title">Geography</h2>
                <p className="hmda-geo-premium-sub">Explore HMDA lending activity by state, lender concentration, volume, and production footprint. Source: CFPB HMDA &middot; {panelYear} &middot; 1&ndash;4 family.</p>
              </div>
              {geoPremiumActions}
            </motion.div>

            <div className="hmda-geo-filter-bar" role="toolbar" aria-label="Geography filters" style={{ display: "none" }}>
              <span className={`hmda-geo-pill hmda-geo-pill--status ${!mapSelectedState ? "hmda-geo-pill--active" : ""}`}>{!mapSelectedState ? "Coverage: National" : `Coverage: ${mapSelectedState}`}</span>
              <label className="hmda-geo-pill hmda-geo-pill--field" style={{ gap: "8px" }}>
                Year
                <select
                  value={yearF}
                  onChange={(e) => {
                    const v = e.target.value;
                    startTransition(() => setYearF(v));
                    setGeoStateLenderPage(1);
                    setGeoMarketTopLenderPage(1);
                  }}
                  className="hmda-geo-pill-select"
                  style={{ border: "none", background: "transparent", font: "inherit", fontWeight: 700, color: "inherit", cursor: "pointer" }}
                >
                  {AVAILABLE_YEARS.map((y) => (
                    <option key={y} value={y}>{y}{yearPickerBadge(hmdaYearsManifest, y)}</option>
                  ))}
                </select>
              </label>
              <span className="hmda-geo-pill hmda-geo-pill--label">Map shading</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
                {[{ k: "volume", l: "Dollar volume" }, { k: "units", l: "Loan units" }, { k: "avg", l: "Average loan size" }].map((x) => (
                  <button
                    key={x.k}
                    type="button"
                    className={`hmda-geo-pill hmda-geo-pill--choice ${geoMapMetric === x.k ? "hmda-geo-pill--active" : ""}`}
                    onClick={() => {
                      setGeoMapMetric(x.k);
                      setGeoLenderRankBy(x.k);
                      setGeoMarketTopLenderPage(1);
                    }}
                    style={{ cursor: "pointer", border: "none", font: "inherit" }}
                  >
                    {x.l}
                  </button>
                ))}
              </div>
              <label className="hmda-geo-pill hmda-geo-pill--field" style={{ gap: "8px" }}>
                Show top
                <select className="hmda-geo-pill-select" value={geoTopNLimit} onChange={(e) => { setGeoTopNLimit(Number(e.target.value)); setGeoMarketTopLenderPage(1); }} style={{ border: "none", background: "transparent", font: "inherit", fontWeight: 700, color: "inherit", cursor: "pointer" }}>
                  {[10, 20, 30, 40, 50].map((n) => (
                    <option key={n} value={n}>{n} lenders</option>
                  ))}
                </select>
              </label>
              {mapSelectedState && (
                <button type="button" className="hmda-geo-pill hmda-geo-pill--choice hmda-geo-pill--active" onClick={() => { setMapSelectedState(null); setGeoStateLenderPage(1); }} style={{ cursor: "pointer", border: "none", font: "inherit" }}>
                  Clear state
                </button>
              )}
            </div>

            <div className="hmda-geo-hero-section">
              <Suspense
                fallback={
                  <div
                    className="hmda-geo-skeleton hmda-geo-card-surface"
                    style={{ minHeight: 480, width: "100%" }}
                    aria-busy="true"
                    aria-label="Loading map"
                  />
                }
              >
              <HmdaGeographyMapbox
                geoDrilldownHmda={geoDrilldownHmda}
                drilldownYear={geoMapYear}
                onDrilldownYearChange={setGeoMapYear}
                panelYear={panelYear}
                geoStateData={geoStateData}
                mapLenderFocus={mapLenderFocus}
                mapLenderFocusInsightsLoading={geoMapLenderInsightsLoading}
                mapLenderFocusList={mapLenderFocusList}
                availableYears={AVAILABLE_YEARS}
                lenders={panelYearLenders}
                dispositionSnapshot={geographyDispositionSnapshot}
                geoMapMetric={mapboxMetric}
                onGeoMapMetricChange={onMapboxMetricChange}
                mapSelectedState={mapSelectedState}
                onSelectState={(st) => {
                  setMapSelectedState(st);
                  setMapSelectedCountyCode(null);
                  setMapSelectedCensusTract(null);
                  setGeoStateLenderPage(1);
                }}
                onClearState={() => {
                  setMapSelectedState(null);
                  setMapSelectedCountyCode(null);
                  setMapSelectedCensusTract(null);
                  setShowCensusTracts(true);
                  setGeoStateLenderPage(1);
                }}
                onGeoAreaSelect={(geo) => {
                  if (geo?.state) setMapSelectedState(geo.state);
                  if (geo?.countyFips) {
                    const fips = String(geo.countyFips).replace(/\D/g, "").padStart(5, "0");
                    setMapSelectedCountyCode(fips.slice(-3));
                  }
                  if (geo?.censusTract) setMapSelectedCensusTract(geo.censusTract);
                  setGeoStateLenderPage(1);
                }}
                onNavigateToLenders={(geo) => {
                  if (geo?.state) setMapSelectedState(geo.state);
                  if (geo?.countyFips) {
                    const fips = String(geo.countyFips).replace(/\D/g, "").padStart(5, "0");
                    setMapSelectedCountyCode(fips.slice(-3));
                  }
                  if (geo?.censusTract) setMapSelectedCensusTract(geo.censusTract);
                  setGeoStateLenderPage(1);
                  requestAnimationFrame(() => {
                    document.getElementById("hmda-geo-lender-panel")?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
                  });
                }}
                showCensusTracts={showCensusTracts}
                onToggleCensusTracts={() => setShowCensusTracts((v) => !v)}
                onSetShowCensusTracts={setShowCensusTracts}
                dk={dk}
                fullscreen
                toolbarActions={geoPremiumActions}
                resetUiNonce={geoMapUiResetNonce}
                onInitialMapReady={() => setGeoMapCanvasReady(true)}
              />
              </Suspense>
            </div>

            {geoDrilldownHmda && String(panelYear) !== String(geoDrilldownSliceYear) ? (
              <p className="hmda-geo-drilldown-year-note" role="status">
                Geography aggregates (map, state cards, drilldown) use HMDA <strong>{geoDrilldownSliceYear}</strong>
                {hmdaYearsManifest?.years?.[String(panelYear)]?.tractFallbackYear &&
                hmdaYearsManifest.years[String(panelYear)].tractFallbackYear !== geoDrilldownSliceYear
                  ? ` (tract tiles use ${hmdaYearsManifest.years[String(panelYear)].tractFallbackYear})`
                  : ""}
                {" "}— the latest year available in static geo assets for panel year <strong>{panelYear}</strong>.
                Lender totals and rankings use HMDA <strong>{panelYear}</strong>.
                {hmdaYearsManifest?.years?.[String(panelYear)]?.partial ? " Run `npm run hmda:geo -- 2025` when MLAR is available for county/tract detail." : ""}
              </p>
            ) : null}

            {/* "" National KPI strip "" */}
            <div className="hmda-geo-kpi-grid" style={{marginBottom:"16px"}}>
              {[
                {label:"Total Lenders",value:geoLenderCount.toLocaleString(),sub:`HMDA ${panelYear}`,icon:IC.building,cls:"hmda-geo-kpi-card--lenders"},
                {label:"Total Volume",value:fmtDollar(geoTotalVol),sub:"originated",icon:IC.dollar,cls:"hmda-geo-kpi-card--volume"},
                {label:"Total Units",value:fmtUnits(geoTotalUnits),sub:"loans originated",icon:IC.chart,cls:"hmda-geo-kpi-card--units"},
                {label:"Avg Loan Size",value:fmtDollar(geoAvgLoan),sub:"national median",icon:IC.percent,cls:"hmda-geo-kpi-card--avg"},
              ].map(m=>(
                <div key={m.label} className={`hmda-geo-kpi-card ${m.cls}`}>
                  <div className="hmda-geo-kpi-label" style={{display:"flex",alignItems:"center",gap:"6px"}}>
                    <span className="hmda-geo-kpi-icon" style={{display:"inline-flex"}}>{m.icon}</span>{m.label}
                  </div>
                  <div className="hmda-geo-kpi-value">{m.value}</div>
                  <div className="hmda-geo-kpi-sub">{m.sub}</div>
                </div>
              ))}
            </div>

            {/* "── Main: map (left) · top lenders (right) ──" */}
            <div className="hmda-geo-main-grid" id="hmda-geo-lender-panel">
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                {geoDrilldownLoading && !geoDrilldownHmda && !mapSelectedState && <div className="hmda-geo-skeleton hmda-geo-card-surface" style={{ minHeight: 280 }} aria-busy="true" aria-label="Loading geography data" />}

                {/* Legacy SVG map — replaced by Mapbox hero */}
                {false && !mapSelectedState && (()=>{
                  const stateDataMap = Object.fromEntries(geoStateData.map(s=>[s.state,s]));
                  const maxUnitsForMap = Math.max(1, ...geoStateData.map(s => s.loanUnits || 0));
                  const activeStatesCount = geoStateData.filter((s) => (s.loanUnits || 0) > 0).length;
                  const projection = geoAlbersUsa().scale(1200).translate([490, 320]);
                  const pathGen = geoPath(projection);
                  const mapLabelRows = usaStateFeatures.map((geo) => {
                    const fips = String(geo.id).padStart(2, "0");
                    const st = FIPS_TO_STATE[fips];
                    if (!st) return null;
                    if (["DC","DE","MD","NJ","CT","RI","MA"].includes(st)) return null;
                    const sd = stateDataMap[st] || null;
                    if (!sd) return null;
                    const area = pathGen.area(geo);
                    if (!Number.isFinite(area) || area < 220) return null;
                    const [cx, cy] = pathGen.centroid(geo);
                    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
                    const fullName = STATE_NAMES[st] || st;
                    const label = area > 2400 && fullName.length <= 11 ? fullName : st;
                    return { st, label, cx, cy, area };
                  }).filter(Boolean);
                  return (
                    <Card className="hmda-geo-card hmda-geo-glass" style={{borderRadius:"22px",padding:isMobile?"10px":"18px",background:dk?"rgba(255,255,255,0.03)":"rgba(255,255,255,0.72)",backdropFilter:"blur(20px) saturate(150%)",WebkitBackdropFilter:"blur(20px) saturate(150%)",border:`1px solid ${dk?"rgba(255,255,255,0.08)":"rgba(255,255,255,0.6)"}`,boxShadow:dk?"0 4px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.04)":"0 4px 24px rgba(15,23,42,0.05), inset 0 1px 0 rgba(255,255,255,0.8)"}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"10px",flexWrap:"wrap",marginBottom:"10px",padding:"2px 2px 0"}}>
                        <div className="hmda-heading-2" style={{display:"flex",alignItems:"center",gap:"8px",fontSize:"13px",color:c.text2}}>
                          <PastelIcon icon={IC.map} bg="rgba(59,130,246,0.14)" fg="#2563EB" />
                          Interactive U.S. lender density map
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:"6px",flexWrap:"wrap"}}>
                          <span className="hmda-label hmda-pill" style={{padding:"4px 9px",borderRadius:"999px",background:c.chip,border:`1px solid ${c.drillBorder}`,fontSize:"10px",color:c.text3}}>
                            {activeStatesCount} states with activity
                          </span>
                          <span className="hmda-label hmda-pill" style={{padding:"4px 9px",borderRadius:"999px",background:c.chip,border:`1px solid ${c.drillBorder}`,fontSize:"10px",color:c.text3}}>
                            Click a state for county drilldown
                          </span>
                          <button onClick={() => setShowCensusTracts(v => !v)} className="sort-btn hmda-pill" style={{display:"flex",alignItems:"center",gap:"5px",border:`1px solid ${showCensusTracts ? "#f59e0b" : c.drillBorder}`,padding:"4px 10px",borderRadius:"999px",cursor:"pointer",fontSize:"10px",background: showCensusTracts ? "rgba(245,158,11,0.12)" : c.chip,color: showCensusTracts ? "#f59e0b" : c.text3,transition:"all 0.18s ease"}}>
                            <span style={{fontSize:"11px"}}>—</span>
                            {showCensusTracts ? "Hide" : "Show"} Census Tracts
                          </button>
                        </div>
                      </div>
                      <div className="hmda-map-glass-inner" style={{position:"relative",width:"100%",borderRadius:"18px",overflow:"hidden",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)"}}>
                        <svg viewBox="0 0 980 640" style={{width:"100%",height:"auto",display:"block"}}>
                          <defs>
                            <linearGradient id="mapPanelGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                              <stop offset="0%" stopColor={dk ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.58)"} />
                              <stop offset="50%" stopColor={dk ? "rgba(248,250,252,0.04)" : "rgba(248,250,252,0.45)"} />
                              <stop offset="100%" stopColor={dk ? "rgba(226,232,240,0.03)" : "rgba(241,245,249,0.38)"} />
                            </linearGradient>
                            <filter id="mapStateGlow">
                              <feDropShadow dx="0" dy="0" stdDeviation="2.3" floodColor={dk ? "#94a3b8" : "#60a5fa"} floodOpacity="0.35" />
                            </filter>
                            <filter id="tractGlow" x="-150%" y="-150%" width="400%" height="400%">
                              <feGaussianBlur stdDeviation="2.2" result="blur" />
                              <feComposite in="SourceGraphic" in2="blur" operator="over" />
                            </filter>
                            <filter id="tractGlowBright" x="-200%" y="-200%" width="500%" height="500%">
                              <feGaussianBlur stdDeviation="3.5" result="blur" />
                              <feComposite in="SourceGraphic" in2="blur" operator="over" />
                            </filter>
                            <radialGradient id="tractStarGold" cx="50%" cy="50%" r="50%">
                              <stop offset="0%" stopColor="#fde68a" stopOpacity="1" />
                              <stop offset="60%" stopColor="#f59e0b" stopOpacity="0.8" />
                              <stop offset="100%" stopColor="#d97706" stopOpacity="0" />
                            </radialGradient>
                            <radialGradient id="tractStarBlue" cx="50%" cy="50%" r="50%">
                              <stop offset="0%" stopColor="#bfdbfe" stopOpacity="1" />
                              <stop offset="60%" stopColor="#60a5fa" stopOpacity="0.75" />
                              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                            </radialGradient>
                            <radialGradient id="tractStarCyan" cx="50%" cy="50%" r="50%">
                              <stop offset="0%" stopColor="#e0f2fe" stopOpacity="1" />
                              <stop offset="60%" stopColor="#38bdf8" stopOpacity="0.65" />
                              <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
                            </radialGradient>
                          </defs>
                          <rect x="8" y="8" width="964" height="624" rx="16" fill="url(#mapPanelGrad)" stroke={dk ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.5)"} strokeWidth="1" />
                          {usaStateFeatures.map((geo) => {
                            const fips = String(geo.id).padStart(2, "0");
                            const st = FIPS_TO_STATE[fips];
                            if (!st) return null;
                            const d = pathGen(geo);
                            if (!d) return null;
                            const sd = stateDataMap[st] || null;
                            const intensity = sd ? sd.loanUnits / maxUnitsForMap : 0;
                            const isSelected = mapSelectedState === st;
                            const isHovered = geoHoverState === st;
                            const mapColor = sd ? c.accent : c.text4;
                            const fill = sd ? mapColor : (dk ? "rgba(255,255,255,0.03)" : "rgba(15,23,42,0.04)");
                            const fillOpacity = sd ? (isSelected ? 0.76 : isHovered ? 0.64 : Math.max(0.24, intensity * 0.72)) : 0.45;
                            const stroke = isSelected || isHovered ? mapColor : (dk ? "rgba(255,255,255,0.16)" : "rgba(15,23,42,0.14)");
                            return (
                              <path
                                key={`state-${st}`}
                                d={d}
                                fill={fill}
                                fillOpacity={fillOpacity}
                                stroke={stroke}
                                strokeWidth={isSelected ? 2.1 : isHovered ? 1.6 : 0.9}
                                filter={isSelected || isHovered ? "url(#mapStateGlow)" : undefined}
                                style={{cursor:sd?"pointer":"default",transition:"all 0.2s ease"}}
                                onMouseEnter={() => sd && setGeoHoverState(st)}
                                onMouseLeave={() => setGeoHoverState(null)}
                                onClick={() => {
                                  if (!sd) return;
                                  setMapSelectedState(prev => prev === st ? null : st);
                                  setMapSelectedCountyCode(null);
                                  setMapSelectedCensusTract(null);
                                  setGeoStateLenderPage(1);
                                }}
                              />
                            );
                          })}
                          {showCensusTracts && censusTractMapDots.length > 0 && (() => {
                            const maxU = censusTractMapDots[0]?.units || 1;
                            return (
                              <g key="census-tract-celestial">
                                {censusTractMapDots.map((dot) => {
                                  const t = Math.pow(Math.min(1, dot.units / maxU), 0.45);
                                  const r = 1.1 + t * 4.4;
                                  const opacity = 0.22 + t * 0.72;
                                  const grad = t > 0.68 ? "url(#tractStarGold)" : t > 0.36 ? "url(#tractStarBlue)" : "url(#tractStarCyan)";
                                  const glow = t > 0.6 ? "url(#tractGlowBright)" : "url(#tractGlow)";
                                  return (
                                    <circle
                                      key={dot.key}
                                      cx={dot.x} cy={dot.y} r={r}
                                      fill={grad}
                                      fillOpacity={opacity}
                                      filter={glow}
                                      style={{pointerEvents:"none"}}
                                    />
                                  );
                                })}
                              </g>
                            );
                          })()}
                          {mapLabelRows.map((row) => (
                            <text
                              key={`map-label-${row.st}`}
                              x={row.cx}
                              y={row.cy}
                              textAnchor="middle"
                              dominantBaseline="central"
                              style={{
                                fontSize: row.label.length > 3 ? "8.5px" : "9.5px",
                                fontWeight: 700,
                                letterSpacing: "0.02em",
                                fill: mapSelectedState === row.st ? c.accent : (dk ? "rgba(255,255,255,0.82)" : "rgba(26,57,92,0.88)"),
                                paintOrder: "stroke",
                                stroke: dk ? "rgba(15,23,42,0.5)" : "rgba(255,255,255,0.66)",
                                strokeWidth: 2.2,
                                pointerEvents: "none",
                              }}
                            >
                              {row.label}
                            </text>
                          ))}
                        </svg>
                      </div>
                      {showCensusTracts && (
                        <div style={{display:"flex",alignItems:"center",gap:"12px",flexWrap:"wrap",padding:"8px 10px",marginTop:"6px",borderRadius:"10px",background:c.drillBg,border:`1px solid rgba(245,158,11,0.22)`,fontSize:"10px",fontWeight:600,color:c.text3}}>
                          <span style={{fontWeight:700,color:"#f59e0b"}}>★ Census Tract Layer</span>
                          <span style={{display:"flex",alignItems:"center",gap:"4px"}}><span style={{width:"8px",height:"8px",borderRadius:"50%",background:"#fde68a",display:"inline-block",boxShadow:"0 0 5px #f59e0b"}}></span> High volume</span>
                          <span style={{display:"flex",alignItems:"center",gap:"4px"}}><span style={{width:"6px",height:"6px",borderRadius:"50%",background:"#60a5fa",display:"inline-block",boxShadow:"0 0 4px #3b82f6"}}></span> Mid volume</span>
                          <span style={{display:"flex",alignItems:"center",gap:"4px"}}><span style={{width:"4px",height:"4px",borderRadius:"50%",background:"#38bdf8",display:"inline-block",boxShadow:"0 0 3px #0ea5e9"}}></span> Low volume</span>
                          <span style={{marginLeft:"auto",color:c.text4,maxWidth:"min(520px,100%)"}}>Dot size + brightness = volume · Illustrative layout inside state (not tract boundaries). Public HMDA has no street-level coordinates.</span>
                        </div>
                      )}
                      {geoHoverState && stateDataMap[geoHoverState] && (
                        <div style={{marginTop:"10px",padding:"10px 12px",borderRadius:"10px",background:c.drillBg,border:`1px solid ${c.drillBorder}`,display:"flex",alignItems:isMobile?"flex-start":"center",justifyContent:"space-between",gap:isMobile?"6px":"10px",flexWrap:"wrap",flexDirection:isMobile?"column":"row"}}>
                          <div style={{fontSize:"12px",fontWeight:700,color:c.text2}}>{geoHoverState} {STATE_NAMES[geoHoverState] ? `· ${STATE_NAMES[geoHoverState]}` : ""}</div>
                          <div style={{display:"flex",alignItems:"center",gap:isMobile?"8px":"10px",fontSize:"11px",color:c.text3,flexWrap:"wrap"}}>
                            <span>{stateDataMap[geoHoverState].countyCount || 0} counties</span>
                            <span>{fmtUnits(stateDataMap[geoHoverState].loanUnits || 0)} loans</span>
                            <span>{fmtDollar(stateDataMap[geoHoverState].volume || 0)} volume</span>
                          </div>
                        </div>
                      )}
                      <Tip text={TIPS["Vol. Share"]} pos="top">
                        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"12px",marginTop:"8px",flexWrap:"wrap",cursor:"help",fontSize:"11px",color:c.text3}}>
                          <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                            <div style={{width:"10px",height:"10px",borderRadius:"4px",background:c.accent,opacity:0.5}} />
                            <span>Lower volume</span>
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                            <div style={{width:"10px",height:"10px",borderRadius:"4px",background:c.accent,opacity:0.9}} />
                            <span>Higher volume</span>
                          </div>
                        </div>
                      </Tip>
                    </Card>
                  );
                })()}

                {/* "" STATE selected: lender list "" */}
                {mapSelectedState && selectedMapStateData && (
                  <div style={{animation:"rise 0.3s ease"}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"10px",flexWrap:"wrap",marginBottom:"14px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:"10px",minWidth:0}}>
                        <button onClick={()=>{setMapSelectedState(null);setGeoStateLenderPage(1);}} className="sort-btn" style={{border:`1px solid ${c.border}`,padding:"6px 12px",borderRadius:"10px",cursor:"pointer",fontSize:"11px",fontWeight:700,background:c.chip,color:c.text3,display:"flex",alignItems:"center",gap:"5px",flexShrink:0}}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>
                          Back to all states
                        </button>
                        <div style={{minWidth:0}}>
                          <div style={{fontSize:"20px",fontWeight:800,letterSpacing:"-0.03em",color:c.text2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{STATE_NAMES[mapSelectedState] || mapSelectedState} <span style={{fontSize:"14px",fontWeight:600,color:c.text3}}>({mapSelectedState})</span></div>
                          <div style={{fontSize:"11px",color:c.text3}}>HMDA {panelYear} · Lenders ranked by dollar volume (HMDA)</div>
                        </div>
                      </div>
                      <button onClick={()=>setMapStateModalOpen(true)} className="sort-btn" style={{border:`1px solid ${c.accent}44`,padding:"7px 14px",borderRadius:"10px",cursor:"pointer",fontSize:"11px",fontWeight:700,background:dk?"rgba(99,102,241,0.12)":"rgba(99,102,241,0.08)",color:c.accent,display:"flex",alignItems:"center",gap:"5px",flexShrink:0}}>
                        {IC.mapPin} County Drilldown
                      </button>
                    </div>

                    <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(4,minmax(0,1fr))",gap:"8px",marginBottom:"14px"}}>
                      {[
                        {label:"Counties",value:(selectedMapStateData.countyCount||0).toLocaleString(),bg:dk?"rgba(96,165,250,0.12)":"rgba(59,130,246,0.09)",fg:dk?"#60A5FA":"#1D4ED8",icon:IC.mapPin},
                        {label:"Loan Units",value:fmtUnits(selectedStateGeoFacts?.units||selectedMapStateData.loanUnits||0),bg:dk?"rgba(129,140,248,0.13)":"rgba(99,102,241,0.09)",fg:dk?"#818CF8":"#4F46E5",icon:IC.chart},
                        {label:"Loan Volume",value:fmtDollar(selectedStateGeoFacts?.volume||selectedMapStateData.volume||0),bg:dk?"rgba(52,211,153,0.12)":"rgba(16,185,129,0.09)",fg:dk?"#34D399":"#059669",icon:IC.dollar},
                        {label:"Vol. Share",value:`${selectedMapStateData.density||0}%`,bg:dk?"rgba(251,191,36,0.12)":"rgba(245,158,11,0.09)",fg:dk?"#FCD34D":"#D97706",icon:IC.percent},
                      ].map((m)=>(
                        <div key={m.label} style={{padding:"12px 14px",borderRadius:"14px",background:m.bg,border:`1px solid ${m.fg}22`,display:"flex",alignItems:"center",gap:"10px"}}>
                          <span style={{color:m.fg,flexShrink:0,display:"inline-flex"}}>{m.icon}</span>
                          <div>
                            <div style={{fontSize:"10px",fontWeight:700,letterSpacing:"0.05em",textTransform:"uppercase",color:m.fg,opacity:0.8,marginBottom:"3px"}}>{m.label}</div>
                            <div style={{fontSize:"16px",fontWeight:800,fontFamily:"'JetBrains Mono',monospace",color:m.fg}}>{m.value}</div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {selectedStateLenderRows.length === 0 ? (
                      <div style={{padding:"40px",textAlign:"center",color:c.text3,fontSize:"13px",borderRadius:"16px",background:c.drillBg,border:`1px solid ${c.drillBorder}`}}>No lender data for {panelYear}.</div>
                    ) : (()=>{
                      const GEO_PS = 25;
                      const geoTotalPages = Math.ceil(selectedStateLenderRows.length / GEO_PS);
                      const geoSafePage = Math.min(geoStateLenderPage, geoTotalPages);
                      const geoPagedRows = selectedStateLenderRows.slice((geoSafePage-1)*GEO_PS, geoSafePage*GEO_PS);
                      return (<>
                      <div style={{display:"flex",flexDirection:"column",gap:"6px",marginBottom:"12px"}}>
                        {geoPagedRows.map((l, i) => {
                          const rank = (geoSafePage-1)*GEO_PS + i + 1;
                          return (
                          <div key={`geo-lrow-${l.id}`} className="lcard-item" onClick={()=>openLender(l)} style={{background:c.surface,backdropFilter:"blur(24px)",border:`1px solid ${c.border}`,borderRadius:"14px",padding:"0",cursor:"pointer",animationDelay:`${Math.min(i,12)*0.03}s`,transition:"all 0.25s ease",overflow:"hidden"}}>
                            <div style={{display:"flex",alignItems:"stretch"}}>
                              <div style={{display:"flex",alignItems:"center",justifyContent:"center",minWidth:isMobile?"42px":"52px",borderRight:`1px solid ${c.divider}`,flexShrink:0}}>
                                <span style={{fontSize:"14px",fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:c.text3,lineHeight:1}}>{rank}</span>
                              </div>
                              <div style={{flex:1,padding:"12px 16px",display:"grid",gridTemplateColumns:isMobile?"1fr":`minmax(220px,1.4fr) repeat(4,minmax(75px,1fr))`,gap:"8px",alignItems:"center"}}>
                                <div style={{minWidth:0}}>
                                  <div className="hmda-heading-2" style={{fontSize:"14px",lineHeight:1.2,marginBottom:"4px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{l.name}</div>
                                  <div style={{display:"flex",gap:"6px",alignItems:"center",flexWrap:"wrap"}}>
                                    <span style={{fontSize:"11px",color:c.text3,fontFamily:"'JetBrains Mono',monospace"}}>#{l.nmls}</span>
                                    {typeBadge(l.type)}
                                  </div>
                                </div>
                                <div style={{textAlign:"center"}}>
                                  <div style={{fontSize:"9px",color:c.text3,textTransform:"uppercase",fontWeight:700,letterSpacing:"0.06em",marginBottom:"2px"}}>Volume</div>
                                  <div style={{fontSize:"14px",fontWeight:700,fontFamily:"'JetBrains Mono',monospace"}}>{fmtDollar(l.dollarVol)}</div>
                                </div>
                                <div style={{textAlign:"center"}}>
                                  <div style={{fontSize:"9px",color:c.text3,textTransform:"uppercase",fontWeight:700,letterSpacing:"0.06em",marginBottom:"2px"}}>Units Closed</div>
                                  <div style={{fontSize:"14px",fontWeight:700,fontFamily:"'JetBrains Mono',monospace"}}>{fmtUnits(l.originations||0)}</div>
                                </div>
                                <div style={{textAlign:"center"}}>
                                  <div style={{fontSize:"9px",color:c.text3,textTransform:"uppercase",fontWeight:700,letterSpacing:"0.06em",marginBottom:"2px"}}>Branches</div>
                                  <div style={{fontSize:"14px",fontWeight:700,fontFamily:"'JetBrains Mono',monospace"}}>{fmtBranchSitesCell(l)}</div>
                                </div>
                                <div style={{textAlign:"center"}}>
                                  <div style={{fontSize:"9px",color:c.text3,textTransform:"uppercase",fontWeight:700,letterSpacing:"0.06em",marginBottom:"2px"}}>States</div>
                                  <div style={{fontSize:"14px",fontWeight:700,fontFamily:"'JetBrains Mono',monospace"}}>{l.states||0}</div>
                                </div>
                              </div>
                            </div>
                            <div style={{padding:"8px 12px 10px",borderTop:`1px solid ${c.divider}`}}>
                              <HmdaCompactLenderMetrics lender={l} c={c} isMobile={isMobile} marketRef={hmdaMarketRef} Tip={Tip} />
                            </div>
                          </div>
                          );
                        })}
                      </div>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"10px",padding:"10px 12px",borderRadius:"12px",background:c.surface,border:`1px solid ${c.border}`}}>
                        <span style={{fontSize:"12px",color:c.text3,fontWeight:600}}>Showing {(geoSafePage-1)*GEO_PS+1}–{Math.min(geoSafePage*GEO_PS,selectedStateLenderRows.length)} of {selectedStateLenderRows.length}</span>
                        <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                          <button onClick={()=>setGeoStateLenderPage(p=>Math.max(1,p-1))} disabled={geoSafePage===1} className="sort-btn" style={{padding:"7px 12px",borderRadius:"10px",border:"none",cursor:geoSafePage===1?"not-allowed":"pointer",fontSize:"12px",fontWeight:700,background:c.chip,color:c.chipText,opacity:geoSafePage===1?0.45:1}}>Prev</button>
                          <span style={{fontSize:"12px",fontWeight:700,color:c.text2,fontFamily:"'JetBrains Mono',monospace"}}>{geoSafePage} / {geoTotalPages}</span>
                          <button onClick={()=>setGeoStateLenderPage(p=>Math.min(geoTotalPages,p+1))} disabled={geoSafePage===geoTotalPages} className="sort-btn" style={{padding:"7px 12px",borderRadius:"10px",border:"none",cursor:geoSafePage===geoTotalPages?"not-allowed":"pointer",fontSize:"12px",fontWeight:700,background:c.chip,color:c.chipText,opacity:geoSafePage===geoTotalPages?0.45:1}}>Next</button>
                        </div>
                      </div>
                      </>);
                    })()}
                  </div>
                )}

                {/* "" CARDS view "" */}
                {!mapSelectedState && (
                <>
                  <Card style={{marginBottom:"12px",padding:isMobile?"12px":"14px",borderRadius:"16px"}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"10px",flexWrap:"wrap"}}>
                      <div className="hmda-heading-2" style={{display:"flex",alignItems:"center",gap:"8px",fontSize:"12px",color:c.text2}}>
                        <PastelIcon icon={IC.layers} bg="rgba(99,102,241,0.12)" fg="#4F46E5" />
                        Card view sorted by lender concentration
                      </div>
                      <div className="hmda-label" style={{fontSize:"11px",color:c.text3}}>
                        Public HMDA originated totals · filing year {geoDrilldownSliceYear} · click a card for drilldown
                      </div>
                    </div>
                  </Card>
                  <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(auto-fill,minmax(220px,1fr))",gap:"12px",marginBottom:"28px"}}>
                    {geoStateData.map((s,i)=>(
                      <Card key={s.state} onClick={()=>{setMapSelectedState(s.state);setMapSelectedCountyCode(null);setMapSelectedCensusTract(null);setMapStateModalOpen(true);}} style={{padding:"16px",animation:"rise 0.45s ease both",animationDelay:`${Math.min(i,14)*0.04}s`,borderRadius:"16px"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px"}}>
                          <div>
                            <div className="hmda-mono hmda-heading-2" style={{fontSize:"24px",fontWeight:600,color:c.accent,lineHeight:1}}>{s.state}</div>
                            <div className="hmda-label" style={{fontSize:"11px",color:c.text3,marginTop:"3px"}}>{STATE_NAMES[s.state] || s.state}</div>
                          </div>
                          <span className="hmda-label hmda-pill" style={{padding:"4px 10px",borderRadius:"8px",fontSize:"11px",background:c.accentSoft||c.chip,color:c.accent}}>#{i+1}</span>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginBottom:"10px"}}>
                          <div style={{padding:"8px",borderRadius:"10px",background:c.statBg,border:`1px solid ${c.drillBorder}`}}>
                            <div className="hmda-label" style={{fontSize:"10px",color:c.text3,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:"3px"}}>Counties</div>
                            <div className="hmda-mono" style={{fontSize:"18px",fontWeight:600,color:c.text2}}>{(s.countyCount || 0).toLocaleString()}</div>
                          </div>
                          <div style={{padding:"8px",borderRadius:"10px",background:c.statBg,border:`1px solid ${c.drillBorder}`}}>
                            <div className="hmda-label" style={{fontSize:"10px",color:c.text3,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:"3px"}}>Loan Units</div>
                            <div className="hmda-mono" style={{fontSize:"18px",fontWeight:600,color:c.text2}}>{fmtUnits(s.loanUnits || 0)}</div>
                          </div>
                        </div>
                        <Bar pct={s.density} color={c.accent}/>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"8px",marginTop:"8px"}}>
                          <div className="hmda-label" style={{fontSize:"10px",color:c.text3}}>{fmtDollar(s.volume || 0)} volume</div>
                          <div className="hmda-label" style={{fontSize:"11px",color:c.text4}}>{s.density}% vs top state (units)</div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </>
                )}

                {/* Left column: two donut charts stacked */}
                <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
                  {/* Institution Type donut */}
                  <Card style={{padding:"16px 18px",borderRadius:"18px",background:dk?"rgba(255,255,255,0.03)":"rgba(255,255,255,0.9)"}}>
                    <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"12px"}}>
                      <PastelIcon icon={IC.building} bg="rgba(0,166,81,0.13)" fg={dk?"#34D399":"#059669"}/>
                      <div className="hmda-heading-2" style={{fontSize:"13px"}}>Institution Type</div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:"16px"}}>
                      <DonutChart data={instTypeTotals.map(t=>({label:t.label,color:t.color,value:t.vol}))} total={instTotalVol} size={84}/>
                      <div style={{flex:1,display:"flex",flexDirection:"column",gap:"6px",minWidth:0}}>
                        {instTypeTotals.map((t) => {
                          const pct = Math.round((t.vol / instTotalVol) * 100);
                          return (
                            <div key={t.k} style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                              <div style={{ width: "8px", height: "8px", borderRadius: "2px", background: t.color, flexShrink: 0, marginTop: "3px" }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px" }}>
                                  <span style={{ fontSize: "10px", color: c.text2, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.label}</span>
                                  <span style={{ fontSize: "10px", fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: c.text3, flexShrink: 0 }}>{pct}%</span>
                                </div>
                                <div style={{ fontSize: "9px", color: c.text4, fontWeight: 600, marginTop: "2px" }}>
                                  {fmtDollar(t.vol)} · {t.count.toLocaleString()} lenders
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </Card>

                  {/* Loan Type donut */}
                  <Card style={{padding:"16px 18px",borderRadius:"18px",background:dk?"rgba(255,255,255,0.03)":"rgba(255,255,255,0.9)"}}>
                    <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"12px"}}>
                      <PastelIcon icon={IC.layers} bg="rgba(59,130,246,0.13)" fg={dk?"#60A5FA":"#1D4ED8"}/>
                      <div className="hmda-heading-2" style={{fontSize:"13px"}}>Loan Type</div>
                    </div>
                    {loanTypeSorted.length > 0 && loanTypeTotal > 0 ? (
                      <div style={{display:"flex",alignItems:"center",gap:"16px"}}>
                        <DonutChart
                          data={loanTypeSorted.map(([k, v]) => ({
                            label: labelHmdaLoanType(k),
                            color: donutColorForHmdaLoanTypeKey(k),
                            value: v,
                          }))}
                          total={loanTypeTotal}
                          size={84}
                        />
                        <div style={{flex:1,display:"flex",flexDirection:"column",gap:"5px",minWidth:0}}>
                          {loanTypeSorted.map(([k, v]) => {
                            const pct = Math.round((v / loanTypeTotal) * 100);
                            const col = donutColorForHmdaLoanTypeKey(k);
                            return (
                              <div key={k} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <div style={{ width: "8px", height: "8px", borderRadius: "2px", background: col, flexShrink: 0 }} />
                                <span style={{ fontSize: "10px", color: c.text2, fontWeight: 600, flex: 1 }}>{labelHmdaLoanType(k)}</span>
                                <span style={{ fontSize: "10px", fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: c.text3, flexShrink: 0 }}>{pct}% · {fmtUnits(v)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div style={{fontSize:"11px",color:c.text3,padding:"8px 0"}}>Loan type breakdown appears when lender rows include HMDA loan_type originated counts (Data Browser / extract pipeline).</div>
                    )}
                  </Card>
                </div>
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }} style={{ minWidth: 0 }}>
            {/* "" Main analytics grid: bar chart + donuts "" */}
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":isTablet?"1fr 1fr":"1fr",gap:"14px",marginBottom:"18px",alignItems:"start"}}>

              {/* Top Lenders by Volume — horizontal bar chart */}
              <Card className="hmda-geo-top-lenders-card" style={{padding:"16px 18px",borderRadius:"18px",background:dk?"rgba(255,255,255,0.03)":"rgba(255,255,255,0.92)"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"14px",gap:"8px",flexWrap:"wrap"}}>
                  <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                    <PastelIcon icon={IC.chart} bg="rgba(15,23,42,0.13)" fg={dk?"#60A5FA":"#1D4ED8"}/>
                    <div className="hmda-heading-2" style={{fontSize:"13px"}}>Top lenders{geoLenderRankBy === "units" ? " (units)" : geoLenderRankBy === "avg" ? " (avg loan)" : " (volume)"}</div>
                  </div>
                  <span style={{fontSize:"10px",color:c.text3,fontWeight:600}}>HMDA {panelYear}</span>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:"3px"}}>
                  {geoTopLenders.map((l,i)=>{
                    const rank = geoTopSliceStart + i + 1;
                    const barPct = Math.round((geoRankVal(l) / geoTopMaxVal) * 100);
                    const instClass = l.type === "Credit Union" ? "Credit Union" : l.type === "Bank" ? "Depository" : "IMB";
                    const typeColor = instClass === "Depository" ? "#00A651" : instClass === "Credit Union" ? "#38bdf8" : "#0033A0";
                    const isTop3 = rank <= 3;
                    const unitsValue = fmtUnits(l.originations || l.orig || 0);
                    const volumeValue = fmtDollar(l.dollarVol || 0);
                    const rankMetricLabel =
                      geoLenderRankBy === "units" ? `Ranked by units · ${geoRankFmt(l)}` :
                      geoLenderRankBy === "avg" ? `Ranked by avg loan · ${geoRankFmt(l)}` :
                      null;
                    return (
                      <div key={l.id} className="hmda-geo-top-lender-row" onClick={()=>openLender(l)} style={{display:"flex",alignItems:"center",gap:"8px",padding:"7px 8px",borderRadius:"10px",cursor:"pointer",transition:"background 0.15s",background:"transparent"}}
                        onMouseEnter={e=>{e.currentTarget.style.background=dk?"rgba(255,255,255,0.04)":"rgba(15,23,42,0.04)";}}
                        onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
                        <span style={{fontSize:"10px",fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:c.text3,minWidth:"22px",textAlign:"right",opacity:0.7}}>{rank}</span>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"4px"}}>
                            <span style={{fontSize:"11px",fontWeight:isTop3?700:600,color:c.text2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{l.name}</span>
                            <span style={{ fontSize: "9px", fontWeight: 700, color: typeColor, border: `1px solid ${typeColor}33`, background: dk ? "rgba(255,255,255,0.03)" : `${typeColor}12`, padding: "2px 6px", borderRadius: "999px", whiteSpace: "nowrap" }}>
                              {instClass}
                            </span>
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"5px",flexWrap:"wrap"}}>
                            <span className="hmda-geo-top-lender-metric hmda-geo-top-lender-metric--units" style={{fontSize:"9px",fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:c.text2}}>Units {unitsValue}</span>
                            <span className="hmda-geo-top-lender-metric hmda-geo-top-lender-metric--volume" style={{fontSize:"9px",fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:typeColor}}>Vol {volumeValue}</span>
                            {rankMetricLabel && (
                              <span style={{fontSize:"9px",color:c.text3,opacity:0.82}}>{rankMetricLabel}</span>
                            )}
                          </div>
                          <div style={{width:"100%",height:isTop3?7:5,borderRadius:"999px",background:dk?"rgba(255,255,255,0.06)":"rgba(15,23,42,0.08)",overflow:"hidden"}}>
                            <div style={{width:`${barPct}%`,height:"100%",borderRadius:"999px",background:typeColor,opacity:isTop3?0.92:0.72,transition:"width 0.6s cubic-bezier(0.4,0,0.2,1)"}}/>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {geoTopLendersCapped.length > PAGE_SIZE && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginTop: "12px", padding: "10px 8px", borderRadius: "12px", background: c.drillBg, border: `1px solid ${c.drillBorder}` }}>
                    <span style={{ fontSize: "12px", color: c.text3, fontWeight: 600 }}>
                      Showing {geoTopSliceStart + 1}-{Math.min(geoTopSliceStart + PAGE_SIZE, geoTopLendersCapped.length)} of {geoTopLendersCapped.length}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <button type="button" onClick={() => setGeoMarketTopLenderPage((p) => Math.max(1, p - 1))} disabled={geoTopSafePage === 1} className="sort-btn" style={{ padding: "7px 12px", borderRadius: "10px", border: "none", cursor: geoTopSafePage === 1 ? "not-allowed" : "pointer", fontSize: "12px", fontWeight: 700, background: c.chip, color: c.chipText, opacity: geoTopSafePage === 1 ? 0.45 : 1 }}>Prev</button>
                      <span style={{ fontSize: "12px", fontWeight: 700, color: c.text2, fontFamily: "'JetBrains Mono',monospace" }}>{geoTopSafePage} / {geoTopTotalPages}</span>
                      <button type="button" onClick={() => setGeoMarketTopLenderPage((p) => Math.min(geoTopTotalPages, p + 1))} disabled={geoTopSafePage === geoTopTotalPages} className="sort-btn" style={{ padding: "7px 12px", borderRadius: "10px", border: "none", cursor: geoTopSafePage === geoTopTotalPages ? "not-allowed" : "pointer", fontSize: "12px", fontWeight: 700, background: c.chip, color: c.chipText, opacity: geoTopSafePage === geoTopTotalPages ? 0.45 : 1 }}>Next</button>
                    </div>
                  </div>
                )}
                {/* Legend */}
                <div style={{display:"flex",alignItems:"center",gap:"12px",flexWrap:"wrap",marginTop:"12px",paddingTop:"10px",borderTop:`1px solid ${c.divider}`}}>
                  {[{color:"#0033A0",label:"IMB"},{color:"#00A651",label:"Depository"},{color:"#38bdf8",label:"Credit Union"}].map(t=>(
                    <div key={t.label} style={{display:"flex",alignItems:"center",gap:"5px",fontSize:"10px",color:c.text3}}>
                      <div style={{width:"10px",height:"10px",borderRadius:"3px",background:t.color,flexShrink:0}}/>
                      {t.label}
                    </div>
                  ))}
                </div>
              </Card>

            </div>
              </motion.div>
            </div>

            {/* ── Supporting panels: Top states by vol / Top states by units / State detail ── */}
            <motion.div className="hmda-geo-support-grid" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.18 }}>

              {/* Top states by volume */}
              <Card style={{ padding: "16px 18px", borderRadius: "18px", background: dk ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.9)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                  <PastelIcon icon={IC.chart} bg="rgba(30,64,175,0.12)" fg={dk ? "#818CF8" : "#1e40af"} />
                  <div className="hmda-heading-2" style={{ fontSize: "13px" }}>Top States by Volume</div>
                  <span style={{ marginLeft: "auto", fontSize: "10px", color: c.text3, fontWeight: 600 }}>HMDA {panelYear}</span>
                </div>
                {geoDrilldownLoading && !geoDrilldownHmda ? (
                  <div className="hmda-geo-skeleton" style={{ minHeight: 140 }} aria-busy="true" aria-label="Loading state volume data" />
                ) : topStatesByVol.length === 0 ? (
                  <div style={{ fontSize: "11px", color: c.text3, padding: "12px 0" }}>No state volume data available. Open Geography tab with a loaded geo-drilldown file.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {topStatesByVol.map((s, i) => {
                      const pct = Math.round(((s.volume || 0) / topStatesByVol[0].volume) * 100);
                      const isSelected = mapSelectedState === s.state;
                      return (
                        <button
                          key={s.state}
                          type="button"
                          onClick={() => {
                            setMapSelectedState(s.state);
                            setGeoStateLenderPage(1);
                            setMapStateModalOpen(true);
                          }}
                          style={{ display: "flex", alignItems: "center", gap: "8px", padding: "5px 6px", borderRadius: "8px", cursor: "pointer", border: "none", font: "inherit", background: isSelected ? (dk ? "rgba(129,140,248,0.14)" : "rgba(30,64,175,0.08)") : "transparent", textAlign: "left", transition: "background 0.15s" }}
                          aria-pressed={isSelected}
                        >
                          <span style={{ fontSize: "10px", fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: c.text3, minWidth: "18px", textAlign: "right" }}>{i + 1}</span>
                          <span style={{ fontSize: "10px", fontWeight: 700, color: isSelected ? c.accent : c.text2, minWidth: "26px" }}>{s.state}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ width: "100%", height: 5, borderRadius: "999px", background: dk ? "rgba(255,255,255,0.06)" : "rgba(30,64,175,0.08)", overflow: "hidden" }}>
                              <div style={{ width: `${pct}%`, height: "100%", borderRadius: "999px", background: isSelected ? c.accent : (dk ? "#818CF8" : "#3b82f6"), opacity: isSelected ? 1 : 0.7, transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)" }} />
                            </div>
                          </div>
                          <span style={{ fontSize: "10px", fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: c.text3, flexShrink: 0 }}>{fmtDollar(s.volume || 0)}</span>
                          <span style={{ fontSize: "10px", color: c.text3, opacity: 0.78, minWidth: "70px", textAlign: "right" }}>{fmtUnits(s.loanUnits || 0)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {topStatesByVol.length > 0 && (
                  <div style={{ marginTop: "10px", paddingTop: "8px", borderTop: `1px solid ${c.divider}`, fontSize: "10px", color: c.text3 }}>
                    Click a state row to open county and census tract drilldown.
                  </div>
                )}
              </Card>

              {/* Top states by units */}
              <Card style={{ padding: "16px 18px", borderRadius: "18px", background: dk ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.9)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                  <PastelIcon icon={IC.layers} bg="rgba(5,150,105,0.12)" fg={dk ? "#34D399" : "#059669"} />
                  <div className="hmda-heading-2" style={{ fontSize: "13px" }}>Top States by Units</div>
                  <span style={{ marginLeft: "auto", fontSize: "10px", color: c.text3, fontWeight: 600 }}>HMDA {panelYear}</span>
                </div>
                {geoDrilldownLoading && !geoDrilldownHmda ? (
                  <div className="hmda-geo-skeleton" style={{ minHeight: 140 }} aria-busy="true" aria-label="Loading state units data" />
                ) : topStatesByUnits.length === 0 ? (
                  <div style={{ fontSize: "11px", color: c.text3, padding: "12px 0" }}>No state unit data available.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {topStatesByUnits.map((s, i) => {
                      const pct = Math.round(((s.loanUnits || 0) / topStatesByUnits[0].loanUnits) * 100);
                      const isSelected = mapSelectedState === s.state;
                      return (
                        <button
                          key={s.state}
                          type="button"
                          onClick={() => {
                            setMapSelectedState(s.state);
                            setGeoStateLenderPage(1);
                            setMapStateModalOpen(true);
                          }}
                          style={{ display: "flex", alignItems: "center", gap: "8px", padding: "5px 6px", borderRadius: "8px", cursor: "pointer", border: "none", font: "inherit", background: isSelected ? (dk ? "rgba(52,211,153,0.12)" : "rgba(5,150,105,0.08)") : "transparent", textAlign: "left", transition: "background 0.15s" }}
                          aria-pressed={isSelected}
                        >
                          <span style={{ fontSize: "10px", fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: c.text3, minWidth: "18px", textAlign: "right" }}>{i + 1}</span>
                          <span style={{ fontSize: "10px", fontWeight: 700, color: isSelected ? (dk ? "#34D399" : "#059669") : c.text2, minWidth: "26px" }}>{s.state}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ width: "100%", height: 5, borderRadius: "999px", background: dk ? "rgba(255,255,255,0.06)" : "rgba(5,150,105,0.08)", overflow: "hidden" }}>
                              <div style={{ width: `${pct}%`, height: "100%", borderRadius: "999px", background: isSelected ? (dk ? "#34D399" : "#059669") : (dk ? "#34D399" : "#10b981"), opacity: isSelected ? 1 : 0.7, transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)" }} />
                            </div>
                          </div>
                          <span style={{ fontSize: "10px", fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: c.text3, flexShrink: 0 }}>{fmtUnits(s.loanUnits || 0)}</span>
                          <span style={{ fontSize: "10px", color: c.text3, opacity: 0.78, minWidth: "78px", textAlign: "right" }}>{fmtDollar(s.volume || 0)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {topStatesByUnits.length > 0 && (
                  <div style={{ marginTop: "10px", paddingTop: "8px", borderTop: `1px solid ${c.divider}`, fontSize: "10px", color: c.text3 }}>
                    Click a state row to open county and census tract drilldown.
                  </div>
                )}
              </Card>

              {/* Selected state detail strip OR lender mix (national fallback) */}
              {mapSelectedState && selectedMapStateData ? (
                <Card style={{ padding: "16px 18px", borderRadius: "18px", background: dk ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.9)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                    <PastelIcon icon={IC.mapPin} bg="rgba(99,102,241,0.12)" fg={dk ? "#818CF8" : "#4f46e5"} />
                    <div className="hmda-heading-2" style={{ fontSize: "13px" }}>{mapSelectedState} &mdash; {STATE_NAMES[mapSelectedState] || mapSelectedState}</div>
                    <button type="button" onClick={() => { setMapSelectedState(null); setGeoStateLenderPage(1); }} style={{ marginLeft: "auto", fontSize: "10px", fontWeight: 700, color: c.accent, border: "none", background: "transparent", cursor: "pointer", padding: "4px 8px" }}>Clear</button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px" }}>
                    {[
                      { label: "State Volume", value: fmtDollar(selectedMapStateData.volume || 0) },
                      { label: "State Units", value: fmtUnits(selectedMapStateData.loanUnits || 0) },
                      { label: "Avg Loan", value: (selectedMapStateData.loanUnits || 0) > 0 ? fmtDollar(Math.round((selectedMapStateData.volume || 0) / selectedMapStateData.loanUnits)) : "—" },
                      { label: "Active Lenders", value: (selectedMapStateData.lenderCount || 0) > 0 ? selectedMapStateData.lenderCount.toLocaleString() : "—" },
                    ].map((m) => (
                      <div key={m.label} style={{ padding: "9px 10px", borderRadius: "10px", background: c.drillBg, border: `1px solid ${c.drillBorder}` }}>
                        <div style={{ fontSize: "10px", textTransform: "uppercase", fontWeight: 700, color: c.text3, marginBottom: "3px" }}>{m.label}</div>
                        <div style={{ fontSize: "14px", fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: c.accent }}>{m.value}</div>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={() => setMapStateModalOpen(true)} style={{ width: "100%", padding: "10px", borderRadius: "12px", border: `1px solid ${c.drillBorder}`, background: c.chip, color: c.accent, fontSize: "12px", fontWeight: 700, cursor: "pointer", transition: "background 0.15s" }}>
                    View county &amp; census drilldown &rarr;
                  </button>
                </Card>
              ) : (
                <Card style={{ padding: "16px 18px", borderRadius: "18px", background: dk ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.9)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                    <PastelIcon icon={IC.building} bg="rgba(245,158,11,0.12)" fg={dk ? "#FCD34D" : "#d97706"} />
                    <div className="hmda-heading-2" style={{ fontSize: "13px" }}>Lender Mix by Type</div>
                    <span style={{ marginLeft: "auto", fontSize: "10px", color: c.text3, fontWeight: 600 }}>HMDA {panelYear}</span>
                  </div>
                  {instTypeTotals.length > 0 ? (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "10px" }}>
                        <DonutChart data={instTypeTotals.map(t => ({ label: t.label, color: t.color, value: t.vol }))} total={instTotalVol} size={72} />
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
                          {instTypeTotals.map((t) => {
                            const pct = Math.round((t.vol / instTotalVol) * 100);
                            const isActive = geoSupportTypeDrill === t.k;
                            return (
                              <button
                                key={t.k}
                                type="button"
                                onClick={() => setGeoSupportTypeDrill((prev) => (prev === t.k ? "all" : t.k))}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "6px",
                                  border: "none",
                                  cursor: "pointer",
                                  borderRadius: "8px",
                                  padding: "4px 6px",
                                  background: isActive ? (dk ? "rgba(129,140,248,0.16)" : "rgba(99,102,241,0.10)") : "transparent",
                                  textAlign: "left",
                                  width: "100%",
                                  font: "inherit",
                                }}
                                aria-pressed={isActive}
                              >
                                <div style={{ width: "8px", height: "8px", borderRadius: "2px", background: t.color, flexShrink: 0 }} />
                                <span style={{ fontSize: "10px", color: c.text2, fontWeight: 600, flex: 1 }}>{t.label}</span>
                                <span style={{ fontSize: "10px", fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: c.text3 }}>{pct}%</span>
                                <span style={{ fontSize: "10px", color: c.text3 }}>{t.count.toLocaleString()}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      {selectedTypeMeta && (
                        <div style={{ marginBottom: "10px", border: `1px solid ${c.drillBorder}`, borderRadius: "10px", padding: "9px 10px", background: c.drillBg }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "7px" }}>
                            <div style={{ fontSize: "11px", fontWeight: 700, color: c.text2 }}>
                              {selectedTypeMeta.label} drilldown
                            </div>
                            <button
                              type="button"
                              onClick={() => setGeoSupportTypeDrill("all")}
                              style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: "10px", color: c.accent, fontWeight: 700, padding: 0 }}
                            >
                              Clear
                            </button>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "6px", marginBottom: selectedTypeTopLenders.length ? "7px" : 0 }}>
                            <div style={{ fontSize: "10px", color: c.text3 }}><span style={{ fontWeight: 700, color: c.text2 }}>{selectedTypeMembers.length.toLocaleString()}</span> lenders</div>
                            <div style={{ fontSize: "10px", color: c.text3 }}><span style={{ fontWeight: 700, color: c.text2 }}>{fmtDollar(selectedTypeVol)}</span> volume</div>
                            <div style={{ fontSize: "10px", color: c.text3 }}><span style={{ fontWeight: 700, color: c.text2 }}>{selectedTypeAvgLoan > 0 ? fmtDollar(selectedTypeAvgLoan) : "—"}</span> avg loan</div>
                          </div>
                          {selectedTypeTopLenders.length > 0 && (
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              {selectedTypeTopLenders.map((l, i) => (
                                <button
                                  key={`${l.id}-${i}`}
                                  type="button"
                                  onClick={() => openLender(l)}
                                  style={{ width: "100%", border: "none", background: "transparent", cursor: "pointer", textAlign: "left", padding: "3px 0", display: "flex", alignItems: "center", gap: "6px", font: "inherit" }}
                                >
                                  <span style={{ fontSize: "10px", color: c.text3, minWidth: "12px" }}>{i + 1}.</span>
                                  <span style={{ fontSize: "10px", fontWeight: 700, color: c.text2, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name}</span>
                                  <span style={{ fontSize: "10px", color: c.text3, fontFamily: "'JetBrains Mono',monospace" }}>{fmtDollar(l.dollarVol || 0)}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <div style={{ fontSize: "10px", color: c.text3, borderTop: `1px solid ${c.divider}`, paddingTop: "8px" }}>
                        {geoLenderCount.toLocaleString()} institutions &middot; {fmtDollar(geoTotalVol)} total originated &middot; click a type to drill in
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: "11px", color: c.text3, padding: "8px 0" }}>Lender type data loads with the lenders panel.</div>
                  )}
                </Card>
              )}
            </motion.div>
          </div>
          );
        })()}

        {mapStateModalOpen && mapSelectedState && selectedMapStateData && (
          <div
            className="overlay-enter hmda-modal-overlay"
            onClick={(e)=>{ if (e.target === e.currentTarget) setMapStateModalOpen(false); }}
            style={{background:c.overlay,zIndex:95}}
          >
            <div onClick={e=>e.stopPropagation()} className="hmda-modal-panel hmda-modal-pastel-accent hmda-geo-state-drill-modal hmda-geo-state-drill-modal--clean" style={{padding:isMobile?"16px 14px 24px":"22px",width:isMobile?"100%":"min(1220px,96vw)",maxHeight:isMobile?"92vh":undefined,overflowY:"auto",marginTop:isMobile?"env(safe-area-inset-top, 0)":"0",marginBottom:isMobile?"env(safe-area-inset-bottom, 0)":"40px"}}>
              <div className="hmda-geo-drill-modal-header">
                <div>
                  <h3 className="hmda-heading-2 hmda-geo-drill-modal-title">
                    {mapSelectedState} {STATE_NAMES[mapSelectedState] || mapSelectedState} — County/Census Loan Drilldown
                  </h3>
                  <div className="hmda-geo-drill-modal-sub">
                    Lenders by county, census tract loan counts, and reporting dates for HMDA year {selectedStateGeoFacts?.year || panelYear}
                  </div>
                </div>
                <button type="button" onClick={()=>setMapStateModalOpen(false)} className="hmda-geo-drill-modal-close" aria-label="Close drilldown">{IC.x}</button>
              </div>
              <ModalDueDiligenceNote onRequestUpdateRecords={()=>setUpdateRecordsFormOpen(true)} />

              <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(3,minmax(0,1fr))",gap:"8px",marginBottom:"12px"}}>
                {[
                  {l:"Counties Tracked",v:mapModalCountyRows.length.toLocaleString(),ic:IC.mapPin,bg:"rgba(79,70,229,0.10)",fg:"#4F46E5"},
                  {l:"Census Tracts Listed",v:mapModalCensusCount.toLocaleString(),ic:IC.layers,bg:"rgba(16,185,129,0.12)",fg:"#0F766E"},
                  {l:"Date Coverage",v:`HMDA ${selectedStateGeoFacts?.year || panelYear}`,ic:IC.refresh,bg:"rgba(56,189,248,0.14)",fg:"#0369A1"},
                ].map((m)=>(
                  <div key={m.l} className="hmda-geo-drill-stat-card" style={{padding:"10px 11px",borderRadius:"10px",background:c.drillBg,border:`1px solid ${c.drillBorder}`}}>
                    <div className="hmda-label" style={{display:"flex",alignItems:"center",gap:"6px",fontSize:"10px",letterSpacing:"0.05em",textTransform:"uppercase",color:c.text3,marginBottom:"4px"}}>
                      <PastelIcon icon={m.ic} bg={m.bg} fg={m.fg} />
                      {m.l}
                    </div>
                    <div className="hmda-mono" style={{fontSize:"15px",fontWeight:600,color:c.accent}}>{m.v}</div>
                  </div>
                ))}
              </div>

              <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"minmax(0,1.05fr) minmax(0,0.95fr)",gap:"10px"}}>
                <div className="hmda-geo-drill-panel" style={{border:`1px solid ${c.drillBorder}`,borderRadius:"12px",padding:isMobile?"8px":"10px"}}>
                  <div className="hmda-heading-2" style={{display:"flex",alignItems:"center",gap:"8px",fontSize:isMobile?"12px":"13px",color:c.text2,marginBottom:"8px",flexWrap:"wrap"}}>
                    <PastelIcon icon={IC.mapPin} bg="rgba(99,102,241,0.12)" fg="#4338CA" />
                    Counties (click row for full drilldown)
                    <Tip text="County labels show the real U.S. county name from Census county FIPS reference files."><span style={{fontSize:"11px",color:c.text3,cursor:"help"}}>–</span></Tip>
                  </div>
                  <div className="hmda-geo-drill-search" style={{marginBottom:"8px",padding:"8px",borderRadius:"9px",background:c.surfaceRaised,border:`1px solid ${c.drillBorder}`}}>
                    <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                      <span style={{color:c.text3,display:"inline-flex",alignItems:"center",justifyContent:"center"}}>{IC.search}</span>
                      <input
                        type="text"
                        value={geoCountyQuery}
                        onChange={(e)=>setGeoCountyQuery(e.target.value)}
                        onKeyDown={(e)=>{
                          if (e.key === "Enter" && countySearchMatches[0]) {
                            selectCountyFromSearch(countySearchMatches[0].countyCode);
                          }
                        }}
                        placeholder="Search county name or FIPS"
                        style={{flex:1,minWidth:0,height:"30px",padding:"0 9px",borderRadius:"8px",border:`1px solid ${c.drillBorder}`,background:c.surface,color:c.text2,fontSize:"11px",outline:"none"}}
                      />
                    </div>
                    {geoCountyQuery.trim() && (
                      <div style={{marginTop:"6px",display:"flex",flexDirection:"column",gap:"5px",maxHeight:"150px",overflowY:"auto",paddingRight:"2px"}}>
                        {countySearchMatches.length ? countySearchMatches.map((row)=>(
                          <button
                            key={`modal-county-search-${row.countyCode}`}
                            onClick={()=>selectCountyFromSearch(row.countyCode)}
                            className="sort-btn"
                            style={{border:"none",textAlign:"left",padding:"7px 8px",borderRadius:"8px",cursor:"pointer",background:mapSelectedCountyCode===row.countyCode?c.chipActive:c.drillBg,color:c.text2,display:"grid",gridTemplateColumns:"1fr auto",gap:"8px",fontSize:"10px"}}
                          >
                            <span style={{fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{row.countyLabel}</span>
                            <span style={{fontFamily:"'JetBrains Mono',monospace",color:c.text3}}>{fmtUnits(row.units)}</span>
                          </button>
                        )) : (
                          <div style={{fontSize:"10px",color:c.text3}}>No county matches for "{geoCountyQuery}".</div>
                        )}
                      </div>
                    )}
                  </div>
                  <div style={{overflowX:isMobile?"visible":"auto"}}>
                    {!isMobile && (
                    <div className="hmda-geo-drill-table-head" style={{minWidth:"760px",display:"grid",gridTemplateColumns:"1.45fr 0.8fr 0.9fr 1.15fr 1.3fr",gap:"8px",padding:"8px 10px",borderRadius:"10px",background:c.statBg,border:`1px solid ${c.drillBorder}`,marginBottom:"8px"}}>
                      {["County", "Loans", "$ Volume", "Lenders by originations", "Census Tract Snapshot"].map((h)=>(
                        <div key={h} style={{fontSize:"10px",fontWeight:700,letterSpacing:"0.05em",textTransform:"uppercase",color:c.text3}}>{h}</div>
                      ))}
                    </div>
                    )}
                    <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
                      {mapModalCountyRows.slice(0, 18).map((cRow)=>(
                        <div key={`modal-c-${cRow.countyCode}`} onClick={()=>{setMapSelectedCountyCode(normCountyCode(cRow.countyCode));setMapSelectedCensusTract(null);}} className={`drill-row${mapSelectedCountyCode===normCountyCode(cRow.countyCode)?" hmda-geo-drill-row--selected":""}`} style={isMobile?{padding:"10px",borderRadius:"12px",background:mapSelectedCountyCode===normCountyCode(cRow.countyCode)?c.surfaceRaised:c.drillBg,border:`1px solid ${mapSelectedCountyCode===normCountyCode(cRow.countyCode)?c.accent:c.drillBorder}`,cursor:"pointer"}:{minWidth:"760px",display:"grid",gridTemplateColumns:"1.45fr 0.8fr 0.9fr 1.15fr 1.3fr",gap:"8px",padding:"9px 10px",borderRadius:"10px",background:mapSelectedCountyCode===normCountyCode(cRow.countyCode)?c.surfaceRaised:c.drillBg,border:`1px solid ${mapSelectedCountyCode===normCountyCode(cRow.countyCode)?c.accent:c.drillBorder}`,cursor:"pointer"}}>
                          <div style={{fontSize:"12px",fontWeight:700,color:c.text2,marginBottom:isMobile?"4px":0}}>
                            {fmtCountyLabel(mapSelectedState, cRow.countyCode)}
                            <span style={{fontSize:"10px",color:c.text3,fontWeight:600,marginLeft:isMobile?"8px":"0",display:isMobile?"inline":"block",marginTop:isMobile?"0":"2px"}}>FIPS {normCountyCode(cRow.countyCode)}</span>
                          </div>
                          {isMobile ? (
                            <div style={{display:"flex",gap:"12px",marginBottom:"6px"}}>
                              <div><span style={{fontSize:"9px",fontWeight:700,textTransform:"uppercase",color:c.text3}}>Loans </span><span style={{fontSize:"11px",fontFamily:"'JetBrains Mono',monospace",color:c.accent}}>{fmtUnits(cRow.units || 0)}</span></div>
                              <div><span style={{fontSize:"9px",fontWeight:700,textTransform:"uppercase",color:c.text3}}>Vol </span><span style={{fontSize:"11px",fontFamily:"'JetBrains Mono',monospace",color:c.accent}}>{fmtDollar(cRow.volume || 0)}</span></div>
                            </div>
                          ) : (<>
                            <div style={{fontSize:"12px",fontFamily:"'JetBrains Mono',monospace",color:c.accent}}>{fmtUnits(cRow.units || 0)}</div>
                            <div style={{fontSize:"12px",fontFamily:"'JetBrains Mono',monospace",color:c.accent}}>{fmtDollar(cRow.volume || 0)}</div>
                          </>)}
                          <div style={{display:"flex",flexDirection:"column",gap:"3px",fontSize:"11px",color:c.text2,minWidth:0,marginBottom:isMobile?"4px":0}}>
                            {(cRow.top20Lenders || []).slice(0,2).map((tl)=>(
                              <div key={`modal-top20-preview-${cRow.countyCode}-${tl.id}`} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"6px"}}>
                                <span style={{fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:isMobile?"180px":"150px"}}>{tl.name}</span>
                                <span style={{fontSize:"10px",color:c.text3,fontFamily:"'JetBrains Mono',monospace"}}>{fmtUnits(tl.units || 0)}</span>
                              </div>
                            ))}
                            <span style={{fontSize:"10px",color:c.text3}}>+18 more in drilldown</span>
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:"6px",flexWrap:"wrap"}}>
                            {(cRow.topCensusTracts || []).slice(0, 1).map((t)=>(
                              <span key={`modal-ct-${cRow.countyCode}-${t.censusTract}`} onClick={(e)=>{e.stopPropagation();setMapSelectedCountyCode(normCountyCode(cRow.countyCode));setMapSelectedCensusTract(t.censusTract);}} className="hmda-geo-drill-tract-chip" style={{padding:"4px 7px",borderRadius:"8px",fontSize:"10px",fontWeight:700,color:c.text2,background:c.chip,border:`1px solid ${c.drillBorder}`,cursor:"pointer"}}>
                                {fmtCensusTract(t.censusTract)} · {fmtUnits(t.units || 0)}
                              </span>
                            ))}
                            {(cRow.topCensusTracts || []).length > 1 && (
                              <span style={{padding:"4px 7px",borderRadius:"8px",fontSize:"10px",fontWeight:700,color:c.text3,background:c.statBg,border:`1px dashed ${c.drillBorder}`}}>
                                +{(cRow.topCensusTracts || []).length - 1} more
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="hmda-geo-drill-panel" style={{border:`1px solid ${c.drillBorder}`,borderRadius:"12px",padding:"10px"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"8px",marginBottom:"8px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:"8px",fontSize:"13px",fontWeight:700,color:c.text2}}>
                      <PastelIcon icon={IC.building} bg="rgba(20,184,166,0.12)" fg="#0F766E" />
                      {selectedCountyGeo ? `${fmtCountyLabel(mapSelectedState, selectedCountyGeo.countyCode)} Details` : "Select a county"}
                    </div>
                  </div>

                  {selectedCountyGeo ? (
                    <>
                      <div style={{fontSize:"11px",color:c.text3,marginBottom:"8px"}}>
                        Application date scope: HMDA reporting year {selectedStateGeoFacts?.year || panelYear}. City-level granularity is unavailable in this source; county and census are shown.
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginBottom:"8px"}}>
                        <div className="hmda-geo-drill-metric" style={{padding:"9px 10px",borderRadius:"10px",background:c.drillBg,border:`1px solid ${c.drillBorder}`}}>
                          <div style={{fontSize:"10px",textTransform:"uppercase",fontWeight:700,color:c.text3,marginBottom:"4px"}}>County Loans</div>
                          <div style={{fontSize:"15px",fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:c.accent}}>{fmtUnits(selectedCountyGeo.units || 0)}</div>
                        </div>
                        <div className="hmda-geo-drill-metric" style={{padding:"9px 10px",borderRadius:"10px",background:c.drillBg,border:`1px solid ${c.drillBorder}`}}>
                          <div style={{fontSize:"10px",textTransform:"uppercase",fontWeight:700,color:c.text3,marginBottom:"4px"}}>County Volume</div>
                          <div style={{fontSize:"15px",fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:c.accent}}>{fmtDollar(selectedCountyGeo.volume || 0)}</div>
                        </div>
                      </div>

                      <div style={{fontSize:"11px",fontWeight:700,color:c.text2,marginBottom:"6px"}}>Who originated loans in this county (by HMDA originations)</div>
                      {!isMobile && (
                      <div className="hmda-geo-drill-table-head" style={{display:"grid",gridTemplateColumns:"44px 1fr 84px 70px 92px",gap:"8px",padding:"6px 8px",borderRadius:"8px",background:c.statBg,border:`1px solid ${c.drillBorder}`,fontSize:"9px",fontWeight:700,letterSpacing:"0.04em",textTransform:"uppercase",color:c.text3,marginBottom:"6px"}}>
                        {["Rank","Lender","Loans","Share","Volume"].map((h)=><div key={`modal-county-h-${h}`}>{h}</div>)}
                      </div>
                      )}
                      <div style={{display:"flex",flexDirection:"column",gap:"6px",marginBottom:"10px",maxHeight:"230px",overflowY:"auto",paddingRight:"4px"}}>
                        {selectedCountyRankedTop20Rows.map((l)=>(
                          <div key={`modal-l-${l.id}`} onClick={()=>openLender(l)} className="drill-row" style={{borderRadius:"10px",background:c.drillBg,border:`1px solid ${c.drillBorder}`,cursor:"pointer",overflow:"hidden"}}>
                            <div style={isMobile?{padding:"8px"}:{display:"grid",gridTemplateColumns:"44px 1fr 84px 70px 92px",gap:"8px",padding:"8px 9px"}}>
                            {isMobile ? (<>
                              <div style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"3px"}}>
                                <span style={{fontSize:"11px",fontWeight:800,fontFamily:"'JetBrains Mono',monospace",color:c.accent}}>#{l.rank}</span>
                                <span style={{fontSize:"11px",fontWeight:700,color:c.text2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{l.name}</span>
                              </div>
                              <div style={{display:"flex",gap:"8px",fontSize:"10px"}}>
                                <span style={{fontFamily:"'JetBrains Mono',monospace",color:c.accent}}>{fmtUnits(l.estCountyUnits || 0)}</span>
                                <span style={{fontFamily:"'JetBrains Mono',monospace",color:c.text2}}>{l.countySharePct}%</span>
                                <span style={{fontFamily:"'JetBrains Mono',monospace",color:c.accent}}>{fmtDollar(l.estCountyVol || 0)}</span>
                              </div>
                            </>) : (<>
                              <div style={{fontSize:"11px",fontWeight:800,fontFamily:"'JetBrains Mono',monospace",color:c.accent}}>#{l.rank}</div>
                              <div style={{fontSize:"12px",fontWeight:700,color:c.text2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{l.name}</div>
                              <div style={{fontSize:"11px",fontFamily:"'JetBrains Mono',monospace",color:c.accent}}>{fmtUnits(l.estCountyUnits || 0)}</div>
                              <div style={{fontSize:"11px",fontFamily:"'JetBrains Mono',monospace",color:c.text2}}>{l.countySharePct}%</div>
                              <div style={{fontSize:"11px",fontFamily:"'JetBrains Mono',monospace",color:c.accent}}>{fmtDollar(l.estCountyVol || 0)}</div>
                            </>)}
                            </div>
                            <div className="hmda-geo-drill-lender-meta" style={{padding:isMobile?"4px 8px 8px":"4px 9px 8px",borderTop:`1px solid ${c.drillBorder}`}}>
                              <HmdaCompactLenderMetrics lender={l} c={c} isMobile={isMobile} marketRef={hmdaMarketRef} Tip={Tip} />
                            </div>
                          </div>
                        ))}
                      </div>

                      <div style={{display:"flex",alignItems:"center",gap:"8px",fontSize:"11px",fontWeight:700,color:c.text2,marginBottom:"6px"}}>
                        <PastelIcon icon={IC.layers} bg="rgba(124,58,237,0.12)" fg="#6D28D9" />
                        Census tracts where loans were applied (factual HMDA counts)
                        <Tip text="A census tract is a small neighborhood-sized Census geography (usually about 2,500 to 8,000 people). It helps compare lending patterns within a county."><span style={{fontSize:"11px",color:c.text3,cursor:"help"}}>–</span></Tip>
                      </div>
                      <div style={{fontSize:"10px",color:c.text3,marginBottom:"6px"}}>
                        Plain-language view: each tract is a local neighborhood area inside the selected county. Higher tract counts mean more originated loans in that local area.
                      </div>
                      <div style={{display:"flex",flexDirection:"column",gap:"6px",maxHeight:"220px",overflowY:"auto",paddingRight:"4px"}}>
                        {(selectedCountyGeo.topCensusTracts || []).slice(0, 16).map((t)=>(
                          <div key={`modal-t-${selectedCountyGeo.countyCode}-${t.censusTract}`} onClick={()=>setMapSelectedCensusTract(t.censusTract)} className={`drill-row${mapSelectedCensusTract===t.censusTract?" hmda-geo-drill-row--selected":""}`} style={{display:"grid",gridTemplateColumns:"1fr 80px 90px",gap:"8px",padding:"8px 9px",borderRadius:"10px",background:mapSelectedCensusTract===t.censusTract?c.surfaceRaised:c.drillBg,border:`1px solid ${mapSelectedCensusTract===t.censusTract?c.accent:c.drillBorder}`,cursor:"pointer"}}>
                            <Tip text={censusTractPlainEnglish(t.censusTract)} pos="bottom">
                              <div style={{fontSize:"11px",fontWeight:700,color:c.text2,cursor:"help"}}>{fmtCensusTract(t.censusTract)}</div>
                            </Tip>
                            <div style={{fontSize:"11px",fontFamily:"'JetBrains Mono',monospace",color:c.accent}}>{fmtUnits(t.units || 0)}</div>
                            <div style={{fontSize:"10px",color:c.text3}}>Date: {selectedStateGeoFacts?.year || panelYear}</div>
                          </div>
                        ))}
                      </div>
                      {selectedCensusGeo && (
                        <div className="hmda-geo-drill-detail-block" style={{marginTop:"10px",padding:"10px",borderRadius:"10px",background:c.surfaceRaised,border:`1px solid ${c.border}`}}>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"8px",flexWrap:"wrap",marginBottom:"7px"}}>
                            <div style={{display:"flex",alignItems:"center",gap:"8px",fontSize:"12px",fontWeight:700,color:c.text2}}>
                              <PastelIcon icon={IC.mapPin} bg="rgba(37,99,235,0.12)" fg="#1D4ED8" />
                              Location Loan Drilldown: {fmtCensusTract(selectedCensusGeo.censusTract)}
                            </div>
                            <div style={{fontSize:"10px",color:c.text3}}>HMDA {selectedStateGeoFacts?.year || panelYear}</div>
                          </div>
                          <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(3,minmax(0,1fr))",gap:"8px",marginBottom:"8px"}}>
                            {[
                              {label:"Tract Loans",value:fmtUnits(selectedCensusGeo.units || 0)},
                              {label:"County Share",value:`${selectedCountyGeo?.units ? Math.round(((selectedCensusGeo.units || 0) / selectedCountyGeo.units) * 1000) / 10 : 0}%`},
                              {label:"Est Tract Volume",value:fmtDollar(Math.round((selectedCountyGeo?.volume || 0) * ((selectedCountyGeo?.units || 0) ? ((selectedCensusGeo.units || 0) / selectedCountyGeo.units) : 0)))},
                            ].map((m)=>(
                              <div key={m.label} className="hmda-geo-drill-metric" style={{padding:"8px 9px",borderRadius:"9px",background:c.drillBg,border:`1px solid ${c.drillBorder}`}}>
                                <div style={{fontSize:"10px",fontWeight:700,letterSpacing:"0.04em",textTransform:"uppercase",color:c.text3,marginBottom:"3px"}}>{m.label}</div>
                                <div style={{fontSize:"14px",fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:c.accent}}>{m.value}</div>
                              </div>
                            ))}
                          </div>
                          <div style={{fontSize:"11px",fontWeight:700,color:c.text2,marginBottom:"6px"}}>Lenders in this tract (by originations, estimated)</div>
                          <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
                            {selectedCensusLenderRows.length ? selectedCensusLenderRows.map((l)=>(
                              <div key={`tract-l-${l.id}`} onClick={()=>openLender(l)} className="drill-row" style={{borderRadius:"9px",background:c.drillBg,border:`1px solid ${c.drillBorder}`,cursor:"pointer",overflow:"hidden"}}>
                                <div style={{display:"grid",gridTemplateColumns:"1fr 90px 110px",gap:"8px",padding:"7px 8px"}}>
                                  <div style={{fontSize:"11px",fontWeight:700,color:c.text2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{l.name}</div>
                                  <div style={{fontSize:"11px",fontFamily:"'JetBrains Mono',monospace",color:c.accent}}>{fmtUnits(l.estTractUnits || 0)}</div>
                                  <div style={{fontSize:"11px",fontFamily:"'JetBrains Mono',monospace",color:c.accent}}>{fmtDollar(l.estTractVol || 0)}</div>
                                </div>
                                <div className="hmda-geo-drill-lender-meta" style={{padding:"4px 8px 6px",borderTop:`1px solid ${c.drillBorder}`}}>
                                  <HmdaCompactLenderMetrics lender={l} c={c} isMobile={isMobile} marketRef={hmdaMarketRef} Tip={Tip} />
                                </div>
                              </div>
                            )) : (
                              <div style={{fontSize:"11px",color:c.text3}}>No tract-level lender estimate available.</div>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{fontSize:"12px",color:c.text3}}>Pick a county from the left table to see lenders, census tracts, and date context.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ───────────────────────────────────────────────────── DETAIL MODAL ───────────────────────────────────────────────────── */}
        {selected&&(
          <div className="overlay-enter hmda-modal-overlay hmda-modal-lender" onClick={e=>{if(e.target===e.currentTarget)setSelected(null);}} style={{background:c.overlayLender}}>
            <div
              className="hmda-modal-panel hmda-modal-protected hmda-modal-pastel-accent hmda-lender-modal-panel hmda-lender-modal-panel--clean hmda-lender-modal-panel--modern hmda-lender-modal-panel--dense"
              style={{
                padding: 0,
                userSelect: "none",
                WebkitUserSelect: "none",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                maxHeight: isMobile ? "92vh" : "calc(100vh - 1.5rem - 28px)",
              }}
              onClick={e=>e.stopPropagation()}
              onContextMenu={e=>e.preventDefault()}
              onCopy={e=>e.preventDefault()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="hmda-lender-modal-title"
            >
              <div className="hmda-results-grid-card-inner hmda-results-grid-card--clean hmda-lender-modal-card">
              {selected ? (() => {
                const modalRank = resolveLenderDisplayRank(lenderRankMap, selected.id, null);
                const instClass = selected.type === "Credit Union" ? "Credit Union" : selected.type === "Bank" ? "Depository" : "IMB";
                const leadTone = selected.type === "Credit Union" ? "cu" : selected.type === "Bank" ? "bank" : "imb";
                const pinBtnStyle = {
                  flexShrink: 0,
                  border: "none",
                  padding: isMobile ? "5px 10px" : "6px 12px",
                  minHeight: 32,
                  borderRadius: 10,
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 600,
                  background: "transparent",
                  color: isPinned(selected) ? c.accent : c.text3,
                  opacity: isPinned(selected) ? 1 : 0.85,
                };
                const modalRegistryKey = selected.id ?? selected.lei;
                const modalRegistry = modalRegistryKey ? lenderRegistryCache[modalRegistryKey] : null;
                const modalRegistryLoading = lenderRegistryLoading && !modalRegistry;
                const modalLeiShort = selected.lei ? String(selected.lei).trim().toUpperCase() : null;
                const modalAvgLoan =
                  selected.originations > 0 ? fmtDollar(Math.round(selected.dollarVol / selected.originations)) : "—";
                const modalHeaderKpis = (
                  <div className="hmda-lender-modal-header-kpis hmda-lender-modal-header-kpis--strip" aria-label="Key production metrics">
                    <Tip text={TIPS.Units} pos="bottom">
                      <div className="hmda-lender-modal-header-kpi">
                        <span className="hmda-lender-modal-header-kpi__label">Units closed</span>
                        <span className="hmda-lender-modal-header-kpi__value">{fmtUnits(selected.units)}</span>
                      </div>
                    </Tip>
                    <Tip text={TIPS["Volume"]} pos="bottom">
                      <div className="hmda-lender-modal-header-kpi">
                        <span className="hmda-lender-modal-header-kpi__label">Volume</span>
                        <span className="hmda-lender-modal-header-kpi__value">{fmtDollar(selected.dollarVol)}</span>
                      </div>
                    </Tip>
                    <Tip text={TIPS.states} pos="bottom">
                      <div className="hmda-lender-modal-header-kpi">
                        <span className="hmda-lender-modal-header-kpi__label">States</span>
                        <span className="hmda-lender-modal-header-kpi__value">{selected.states ?? "—"}</span>
                      </div>
                    </Tip>
                    <Tip text={TIPS.avgLoanSize} pos="bottom">
                      <div className="hmda-lender-modal-header-kpi">
                        <span className="hmda-lender-modal-header-kpi__label">Avg loan</span>
                        <span className="hmda-lender-modal-header-kpi__value">{modalAvgLoan}</span>
                      </div>
                    </Tip>
                  </div>
                );
                return (
                  <>
              <header className="hmda-results-grid-card-head hmda-lender-modal-header">
                <div className="hmda-lender-modal-header-inner hmda-lender-modal-header-inner--merged hmda-lender-modal-header-inner--compact">
                  <div className="hmda-lender-modal-header-primary">
                    {modalRank != null ? (
                      <div className={`hmda-lcard-leading-well hmda-lcard-leading-well--${leadTone} hmda-lcard-leading-well--clean`}>
                        <span className="hmda-lcard-leading-rank">#{modalRank}</span>
                      </div>
                    ) : null}
                    <div className="hmda-lcard-main">
                      <h2 id="hmda-lender-modal-title" className="hmda-heading-2 hmda-lcard-title hmda-lender-modal-title">
                        {selected.name}
                      </h2>
                      <div className="hmda-lender-modal-meta">
                        <span className={`hmda-lender-modal-meta-chip hmda-lender-modal-meta-chip--type hmda-lender-modal-meta-chip--${leadTone}`}>
                          <span className="hmda-lender-modal-meta-chip__icon" aria-hidden>{React.cloneElement(IC.building, { width: 10, height: 10 })}</span>
                          {instClass}
                        </span>
                        <Tip text={TIPS.NMLS}>
                          <span className="hmda-lender-modal-meta-chip hmda-lender-modal-meta-chip--mono">
                            NMLS {String(selected.nmls || "").trim() || "—"}
                          </span>
                        </Tip>
                        {selected.lei ? (
                          <Tip text={`LEI ${selected.lei}`}>
                            <span className="hmda-lender-modal-meta-chip hmda-lender-modal-meta-chip--mono">
                              LEI {modalLeiShort}
                            </span>
                          </Tip>
                        ) : null}
                        {modalRegistry?.gleif?.legalName && modalRegistry.gleif.legalName !== selected.name ? (
                          <span className="hmda-lender-modal-meta-chip hmda-lender-modal-meta-chip--legal" title={modalRegistry.gleif.legalName}>
                            Legal · {modalRegistry.gleif.legalName.length > 22 ? `${modalRegistry.gleif.legalName.slice(0, 22)}…` : modalRegistry.gleif.legalName}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="hmda-lender-modal-header-toolbar">
                      {renderLenderMapBtn(selected)}
                      <Tip text={TIPS["Pin compare"]} pos="left">
                        <button
                          type="button"
                          onClick={() => togglePin(selected)}
                          className="hmda-results-grid-pin hmda-results-grid-pin--labeled"
                          aria-label={isPinned(selected) ? "Unpin lender" : "Pin lender for compare"}
                          style={pinBtnStyle}
                        >
                          <Pin
                            size={13}
                            strokeWidth={2.2}
                            aria-hidden
                            className={isPinned(selected) ? "hmda-action-pin-icon hmda-action-pin-icon--active" : "hmda-action-pin-icon"}
                          />
                          <span>{isPinned(selected) ? "Pinned" : "Pin"}</span>
                        </button>
                      </Tip>
                      <button
                        type="button"
                        onClick={toggleModalAccordionShowAll}
                        className="hmda-results-grid-pin hmda-results-grid-pin--labeled"
                        aria-expanded={modalAccordionShowAll}
                        aria-label={modalAccordionShowAll ? "Collapse all sections" : "Expand all sections"}
                        style={pinBtnStyle}
                      >
                        {modalAccordionShowAll
                          ? <ChevronsDownUp size={13} strokeWidth={2.2} aria-hidden />
                          : <ChevronsUpDown size={13} strokeWidth={2.2} aria-hidden />
                        }
                        <span>Expand</span>
                      </button>
                      <button type="button" className="hmda-lender-modal-close" onClick={() => setSelected(null)} aria-label="Close lender details">
                        {IC.x}
                      </button>
                    </div>
                  </div>
                  {modalHeaderKpis}
                </div>
              </header>

              <div className="hmda-lender-modal-scroll">
              <div className="hmda-lender-modal-body hmda-lender-modal-body--accordion">
              <Accordion
                type="multiple"
                value={modalAccordionOpen}
                onValueChange={handleModalAccordionChange}
                className="hmda-lender-modal-accordion w-full -space-y-px"
              >
              <HmdaLenderModalAccordionItem value="identity">
                <HmdaLenderModalAccordionTrigger>Identity & contact</HmdaLenderModalAccordionTrigger>
                <AccordionContent className="hmda-lender-modal-accordion-content" data-demo-target="demo-contact-section">
                  <HmdaLenderModalRegistryPanel
                    lender={selected}
                    registry={modalRegistry}
                    registryLoading={modalRegistryLoading}
                    fmtAddress={fmtAddress}
                    fmtBranchSitesCell={fmtBranchSitesCell}
                    branchSourceLabel={branchSourceLabel}
                    c={c}
                    IC={IC}
                  />
                </AccordionContent>
              </HmdaLenderModalAccordionItem>

              <HmdaLenderModalAccordionItem value="production">
                <HmdaLenderModalAccordionTrigger aside={`HMDA ${modalHmdaYear}`}>Production details</HmdaLenderModalAccordionTrigger>
                <AccordionContent className="hmda-lender-modal-accordion-content">
                  <HmdaLenderOriginationsByProduct lender={selectedForHmdaModal} c={c} dk={dk} isMobile={isMobile} Tip={Tip} marginBottom={0} hideEmptyProducts hideUnallocatedNote mutedProductChips />
                </AccordionContent>
              </HmdaLenderModalAccordionItem>

              <HmdaLenderModalAccordionItem value="pipeline">
                <HmdaLenderModalAccordionTrigger
                  aside={
                    modalPipelineDisposition?.source === "lar"
                      ? `LAR ${modalPipelineDisposition.reportingYear}`
                      : ffiecModalInsightsLoading
                        ? "Loading…"
                        : `HMDA ${modalHmdaYear}`
                  }
                >
                  Pipeline · pull-through & declinations
                </HmdaLenderModalAccordionTrigger>
                <AccordionContent className="hmda-lender-modal-accordion-content">
                {ffiecModalInsightsLoading ? (
                  <div className="hmda-lender-modal-inset hmda-lender-modal-inset--muted" style={{ color: c.text3 }}>
                    Loading LAR disposition from FFIEC…
                  </div>
                ) : (
                  <HmdaModalPipelinePanel
                    lender={selectedForHmdaModal || selected}
                    panelYear={modalHmdaYear}
                    c={c}
                    isMobile={isMobile}
                    Tip={Tip}
                    allLenders={LENDERS}
                    registry={modalRegistry}
                  />
                )}
                </AccordionContent>
              </HmdaLenderModalAccordionItem>

              <HmdaLenderModalAccordionItem value="credit">
                <HmdaLenderModalAccordionTrigger>Credit profile</HmdaLenderModalAccordionTrigger>
                <AccordionContent className="hmda-lender-modal-accordion-content">
                <div className={`hmda-lender-modal-metric-grid${isMobile ? " hmda-lender-modal-metric-grid--stack" : ""}`}>
                  {[
                    { l: "Rate Spread", v: fmtMedianRateSpread(selected), tip: TIPS.rateSpread },
                    { l: "Med. CLTV", v: fmtMedianCltvCell(selected), tip: TIPS.maxLtv },
                    { l: "Med. DTI", v: fmtMedianDtiCell(selected), tip: TIPS.maxDti },
                  ].map((x) => {
                    const inner = (
                      <div key={x.l} className="hmda-lender-modal-metric-tile">
                        <div className="hmda-lender-modal-metric-tile__label">{x.l}</div>
                        <div className={`hmda-lender-modal-metric-tile__value${x.v === "—" ? " hmda-lender-modal-metric-tile__value--empty" : ""}`}>{x.v}</div>
                      </div>
                    );
                    return x.tip ? <Tip key={x.l} text={x.tip} pos="bottom">{inner}</Tip> : inner;
                  })}
                </div>
                </AccordionContent>
              </HmdaLenderModalAccordionItem>

              {modalHasYearMatchedLar ? (
                <HmdaLenderModalAccordionItem value="drill-pipeline">
                  <HmdaLenderModalAccordionTrigger aside={`LAR ${modalLarYear}`}>Full pipeline drilldown</HmdaLenderModalAccordionTrigger>
                  <AccordionContent className="hmda-lender-modal-accordion-content">
                    <div id="hmda-lender-modal-pipeline-drill">
                      <HmdaPublicPipelineDrilldown lender={selectedForHmdaModal} c={c} isMobile={isMobile} dk={dk} Tip={Tip} />
                    </div>
                  </AccordionContent>
                </HmdaLenderModalAccordionItem>
              ) : null}

              {modalHasYearMatchedLar &&
              selectedForHmdaModal?.hmdaInsights?.loanTypeSummary &&
              Object.keys(selectedForHmdaModal.hmdaInsights.loanTypeSummary).length > 0 ? (
                <HmdaLenderModalAccordionItem value="drill-products">
                  <HmdaLenderModalAccordionTrigger aside={`HMDA ${modalHmdaYear}`}>Product mix by loan type</HmdaLenderModalAccordionTrigger>
                  <AccordionContent className="hmda-lender-modal-accordion-content">
                    <div id="hmda-lender-modal-product-mix-panel" className="hmda-lender-modal-inset hmda-lender-modal-inset--flush">
                        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.9fr 0.9fr 0.7fr", gap: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: c.text3, background: dk ? "rgba(56,189,248,0.12)" : "linear-gradient(90deg, rgba(224,242,254,0.9) 0%, rgba(219,234,254,0.65) 100%)", padding: "9px 12px" }}>
                          <span>Product</span>
                          <span style={{ textAlign: "right" }}>Units Closed</span>
                          <span style={{ textAlign: "right" }}>Volume</span>
                          <span style={{ textAlign: "right" }}>Share</span>
                        </div>
                        {Object.entries(selectedForHmdaModal.hmdaInsights.loanTypeSummary)
                          .sort((a, b) => (b[1].originated || 0) - (a[1].originated || 0))
                          .map(([lt, v], idx) => {
                            const units = v.originated || 0;
                            const origTot = selectedForHmdaModal.hmdaInsights.totalOriginated || selected.originations || 0;
                            let vol = v.dollarVolume != null && Number.isFinite(v.dollarVolume) && v.dollarVolume > 0 ? v.dollarVolume : null;
                            if (vol == null && units > 0 && origTot > 0 && (selected.dollarVol || 0) > 0) {
                              vol = Math.round((units / origTot) * (selected.dollarVol || 0));
                            }
                            const denom = origTot || 1;
                            const share = denom > 0 ? (100 * units) / denom : 0;
                            return (
                              <div
                                key={lt}
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "1.2fr 0.9fr 0.9fr 0.7fr",
                                  gap: 0,
                                  fontSize: 11,
                                  padding: "8px 10px",
                                  borderTop: `1px solid ${c.drillBorder}`,
                                  background: idx % 2 === 0 ? "transparent" : c.statBg,
                                  alignItems: "center",
                                }}
                              >
                                <span style={{ color: c.text2, fontWeight: 600 }}>{labelHmdaLoanType(lt)}</span>
                                <span style={{ textAlign: "right", fontFamily: "'JetBrains Mono',monospace" }}>{units.toLocaleString()}</span>
                                <span style={{ textAlign: "right", fontFamily: "'JetBrains Mono',monospace" }}>{vol != null ? fmtDollar(vol) : "—"}</span>
                                <span style={{ textAlign: "right", fontFamily: "'JetBrains Mono',monospace", color: c.accent }}>{share.toFixed(1)}%</span>
                              </div>
                            );
                          })}
                      </div>
                  </AccordionContent>
                </HmdaLenderModalAccordionItem>
              ) : null}

              {modalHasYearMatchedLar ? (
                <HmdaLenderModalAccordionItem value="drill-outcomes">
                  <HmdaLenderModalAccordionTrigger aside={`HMDA ${modalHmdaYear}`}>Application outcomes</HmdaLenderModalAccordionTrigger>
                  <AccordionContent className="hmda-lender-modal-accordion-content">
                    <div id="hmda-lender-modal-insights-panel">
                      <HmdaInsightsPanel selected={selectedForHmdaModal} c={c} isMobile={isMobile} countyFipsNames={countyFipsNames} marketRef={hmdaMarketRef} Tip={Tip} />
                    </div>
                  </AccordionContent>
                </HmdaLenderModalAccordionItem>
              ) : null}

              <HmdaLenderModalAccordionItem value="sources">
                <HmdaLenderModalAccordionTrigger>Sources & notes</HmdaLenderModalAccordionTrigger>
                <AccordionContent className="hmda-lender-modal-accordion-content hmda-lender-modal-footer">
                <div className="hmda-lender-modal-sources-layout">
                  <HmdaModalPipelineSources
                    lender={selected}
                    registry={modalRegistry}
                    py={Number(modalHmdaYear ?? selected?.dataYear ?? HMDA_PREFERRED_YEAR)}
                    lei={selected?.lei ? String(selected.lei).trim().toUpperCase() : ""}
                    c={c}
                  />
                  {modalLarIsCompanion ? (
                    <HmdaLarCompanionNotice panelYear={modalHmdaYear} larYear={modalLarYear} c={c} compact />
                  ) : null}
                  {HMDA_FFIRC_LIVE && fredMacroStrip?.series ? (
                    <div className="hmda-lender-modal-inset hmda-lender-modal-inset--muted hmda-lender-modal-footer__macro" style={{ color: c.text3 }}>
                      <span style={{ fontWeight: 700, color: c.text2 }}>Market context (FRED)</span>
                      <span style={{ color: c.text4, marginLeft: 6 }}>— not lender-specific</span>
                      <div className="hmda-lender-modal-footer__macro-grid">
                        {["MORTGAGE30US", "DGS10", "OBMMIFHA30YF"].map((id) => {
                          const pt = fredMacroStrip.series[id];
                          if (!pt || !Number.isFinite(pt.value)) return null;
                          const label = id === "MORTGAGE30US" ? "30Y mortgage" : id === "DGS10" ? "10Y Treasury" : "30Y FHA (OBMMI)";
                          return (
                            <span key={id} className="hmda-lender-modal-footer__macro-item">
                              {label}: <strong>{pt.value.toFixed(2)}</strong>
                              <span className="hmda-lender-modal-footer__macro-date"> ({pt.date})</span>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  {selected.lenderContentNote ? (
                    <p className="hmda-lender-modal-footer__note">{selected.lenderContentNote}</p>
                  ) : null}
                  <HmdaLegalDisclaimer c={c} compact showFeedbackLinks className="hmda-lender-modal-disclaimer" />
                  <p className="hmda-lender-modal-footnote" style={{ color: c.text4 }}>
                    Rankings reflect reported volume; verify independently.{" "}
                    <button type="button" onClick={() => setUpdateRecordsFormOpen(true)} className="hmda-lender-modal-footnote-link" style={{ color: c.accent }}>
                      Request a record update
                    </button>
                    .
                  </p>
                </div>
                </AccordionContent>
              </HmdaLenderModalAccordionItem>
              </Accordion>

              </div>{/* hmda-lender-modal-body */}
              </div>{/* hmda-lender-modal-scroll */}
                  </>
                );
              })() : null}
              </div>{/* hmda-lender-modal-card */}
            </div>
          </div>
        )}

        {/* ───────────────────────────────────────────────────── COMPARE MODAL ───────────────────────────────────────────────────── */}
        {compareOpen&&(()=>{
          const glassOverlay = dk?"rgba(0,0,0,0.22)":"rgba(255,255,255,0.14)";
          const cellBg = dk?"rgba(255,255,255,0.04)":"rgba(255,255,255,0.32)";
          const typeAccent = (t) => t==="Bank"?"#7C3AED":t==="Credit Union"?"#0F766E":"#1D4ED8";
          const hmdaBg = dk ? "rgba(148,163,184,0.12)" : "rgba(71,85,105,0.08)";
          const hmdaFg = dk ? "#CBD5E1" : "#334155";
          const compareRows = [
            {k:"originations",label:"Originations",icon:IC.chart,   bg:dk?"rgba(129,140,248,0.14)":"rgba(99,102,241,0.10)",  fg:dk?"#818CF8":"#4F46E5", num:(l)=>{ const x = Number(l?.originations ?? l?.units); return Number.isFinite(x) ? x : null; }, fmt:(l)=>fmtOriginationsCell(l), best:"max"},
            {k:"dollarVol",   label:"$ Volume",    icon:IC.dollar,  bg:dk?"rgba(52,211,153,0.13)":"rgba(16,185,129,0.09)",   fg:dk?"#34D399":"#059669", num:(l)=>l.dollarVol,           fmt:(l)=>fmtDollar(l.dollarVol),         best:"max"},
            {k:"avgLoanSize", label:"Avg loan",    icon:IC.rate,    bg:dk?"rgba(52,211,153,0.10)":"rgba(16,185,129,0.07)",   fg:dk?"#34D399":"#059669", num:(l)=>(l.originations > 0 ? l.dollarVol / l.originations : null), fmt:(l)=>(l.originations > 0 ? fmtDollar(Math.round(l.dollarVol / l.originations)) : "—"), best:"max"},
            {k:"currentRate", label:"Rate",        icon:IC.rate,    bg:dk?"rgba(251,191,36,0.13)":"rgba(245,158,11,0.09)",   fg:dk?"#FCD34D":"#D97706", num:(l)=>{ const x = Number(l?.currentRate); return Number.isFinite(x) ? x : null; }, fmt:(l,c2)=><span style={{display:"flex",alignItems:"baseline",gap:"3px"}}>{fmtRate(l.currentRate)}{l.rateSource==="estimated"&&<span style={{fontSize:"9px",fontWeight:600,opacity:0.6,letterSpacing:"0.03em"}}>est.</span>}</span>,    best:"min"},
            {k:"branches",    label:"Counties",  icon:IC.building,bg:dk?"rgba(244,114,182,0.13)":"rgba(236,72,153,0.08)", fg:dk?"#F472B6":"#BE185D", num:(l)=>branchSortValue(l), fmt:(l)=>fmtBranchSitesCell(l), best:"max"},
            {k:"states",      label:"States",      icon:IC.mapPin,  bg:dk?"rgba(96,165,250,0.13)":"rgba(59,130,246,0.09)",   fg:dk?"#60A5FA":"#1D4ED8", num:(l)=>l.states,              fmt:(l)=>String(l.states),               best:"max"},
            {k:"rateSpread",  label:"Rate Spread",  icon:IC.rate,    bg:dk?"rgba(167,139,250,0.13)":"rgba(139,92,246,0.09)", fg:dk?"#A78BFA":"#7C3AED", num:(l)=>creditRateSpreadSortValue(l), fmt:(l)=>fmtMedianRateSpread(l), best:"min"},
            {k:"maxLtv",      label:"Med. CLTV",    icon:IC.percent, bg:dk?"rgba(45,212,191,0.13)":"rgba(20,184,166,0.09)",   fg:dk?"#2DD4BF":"#0F766E", num:(l)=>creditLtvSortValue(l), fmt:(l)=>fmtMedianCltvCell(l),                 best:"max"},
            {k:"maxDti",      label:"Med. DTI",    icon:IC.key,     bg:dk?"rgba(251,146,60,0.13)":"rgba(249,115,22,0.09)",   fg:dk?"#FB923C":"#C2410C", num:(l)=>creditDtiSortValue(l), fmt:(l)=>fmtMedianDtiCell(l),                 best:"max"},
            {k:"hmdaApps",    label:"HMDA · Applications", icon:IC.chart, bg:hmdaBg, fg:hmdaFg, num:(l)=>(l.hmdaInsights != null ? (l.hmdaInsights.totalApplications ?? 0) : null), fmt:(l)=> (l.hmdaInsights ? (l.hmdaInsights.totalApplications ?? 0).toLocaleString() : "—"), best:"max"},
            {k:"hmdaDeny",    label:"HMDA · Denials", icon:IC.percent, bg:hmdaBg, fg:hmdaFg, num:(l)=>{ const h=l.hmdaInsights; if(!h||(h.totalApplications||0)<=0)return null; return h.denialCount ?? 0; }, fmt:(l)=>{ const h=l.hmdaInsights; if(!h||(h.totalApplications||0)<=0)return "—"; return fmtHmdaLarCount(h.denialCount ?? 0); }, best:"min"},
            {k:"hmdaWd",      label:"HMDA · Withdrawals", icon:IC.percent, bg:hmdaBg, fg:hmdaFg, num:(l)=>{ const h=l.hmdaInsights; if(!h||(h.totalApplications||0)<=0)return null; return h.withdrawalCount ?? 0; }, fmt:(l)=>{ const h=l.hmdaInsights; if(!h||(h.totalApplications||0)<=0)return "—"; return fmtHmdaLarCount(h.withdrawalCount ?? 0); }, best:"min"},
            {k:"hmdaOrigShr", label:"HMDA · Originated", icon:IC.chart, bg:hmdaBg, fg:hmdaFg, num:(l)=>{ const h=l.hmdaInsights; if(!h||(h.totalApplications||0)<=0)return null; return h.totalOriginated ?? 0; }, fmt:(l)=>{ const h=l.hmdaInsights; if(!h||(h.totalApplications||0)<=0)return "—"; return fmtHmdaLarCount(h.totalOriginated ?? 0); }, best:"max"},
            {k:"hmdaSpr",     label:"HMDA · Median rate spread", icon:IC.rate, bg:hmdaBg, fg:hmdaFg, num:(l)=>{ const v=l.hmdaInsights?.originatedMedianRateSpread; return v!=null&&Number.isFinite(v)?v:null; }, fmt:(l)=>{ const v=l.hmdaInsights?.originatedMedianRateSpread; return v!=null&&Number.isFinite(v)?`${v}%`:"—"; }, best:"min"},
            {k:"hmdaTerm",    label:"HMDA · Median term", icon:IC.key, bg:hmdaBg, fg:hmdaFg, num:(l)=>{ const v=l.hmdaInsights?.originatedMedianLoanTermMonths; return v!=null&&Number.isFinite(v)?v:null; }, fmt:(l)=>{ const v=l.hmdaInsights?.originatedMedianLoanTermMonths; return v!=null&&Number.isFinite(v)?`${Math.round(v)} mo`:"—"; }, best:"max"},
            {k:"products",    label:"Products",    icon:IC.layers,  bg:dk?"rgba(148,163,184,0.10)":"rgba(100,116,139,0.07)",fg:dk?"#94A3B8":"#475569", num:null, fmt:null,              best:null},
          ].map((r) => ({ ...r, tip: COMPARE_MODAL_METRIC_TIPS[r.k] || "" }));
          const compareRowHasAnyPinnedValue = (row) => {
            if (!row.num) return true;
            return pinnedLenders.some((l) => {
              const v = row.num(l);
              return v != null && !(typeof v === "number" && !Number.isFinite(v));
            });
          };
          const compareRowsForDisplay = compareRows.filter(compareRowHasAnyPinnedValue);
          const productsCompareRow = compareRowsForDisplay.find((r) => r.k === "products");
          const getBestId = (row) => {
            if (!row.best || !row.num || pinnedLenders.length < 2) return null;
            let bestVal = row.best==="max" ? -Infinity : Infinity;
            let bestId = null;
            pinnedLenders.forEach(l => {
              const v = row.num(l);
              if (v == null || (typeof v === "number" && !Number.isFinite(v))) return;
              if (row.best==="max" && v > bestVal) { bestVal=v; bestId=l.id; }
              if (row.best==="min" && v < bestVal) { bestVal=v; bestId=l.id; }
            });
            return bestId;
          };
          const compareLightFullscreen = compareFsActive && !dk;
          return (
          <div className="overlay-enter hmda-modal-overlay hmda-modal-compare" onClick={e=>{if(e.target===e.currentTarget)setCompareOpen(false);}} style={{background:glassOverlay,zIndex:104}}>
            <div ref={comparePanelRef} onClick={e=>e.stopPropagation()} className={`hmda-modal-panel hmda-modal-pastel-accent hmda-modal-compare-panel hmda-modal-compare-panel--clean${compareLightFullscreen ? " hmda-compare-fs-light" : ""}`} style={{padding:isMobile?"16px 14px 24px":"26px",maxWidth:isMobile?"100%":"1240px",width:isMobile?"100%":"96%",maxHeight:isMobile?"92vh":undefined,overflowY:"auto"}}>

              <div className="hmda-compare-header">
                <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                  <div className="hmda-compare-icon-well" style={{color:c.accent}}>{IC.layers}</div>
                  <div>
                    <h2 className="hmda-compare-title">Compare Lenders</h2>
                    <div className="hmda-compare-subtitle">Pinned lenders side-by-side across key metrics</div>
                  </div>
                </div>
                <div className="hmda-compare-toolbar">
                  <button type="button" onClick={toggleCompareFullscreen} aria-label={compareFsActive ? "Exit fullscreen" : "Fullscreen"} className="hmda-compare-toolbar-btn sort-btn">{compareFsActive ? (isMobile ? "Exit" : "Exit fullscreen") : (isMobile ? "Full" : "Fullscreen")}</button>
                  <button type="button" onClick={clearPinned} className="hmda-compare-toolbar-btn sort-btn">Clear Pinned</button>
                  <button type="button" onClick={()=>setCompareOpen(false)} aria-label="Close compare" className="hmda-compare-toolbar-btn hmda-compare-toolbar-btn--icon">{IC.x}</button>
                </div>
              </div>
              <ModalDueDiligenceNote onRequestUpdateRecords={()=>setUpdateRecordsFormOpen(true)} />

              {pinnedLenders.length < 2 ? (
                <div style={{padding:"40px 16px",textAlign:"center",color:c.text3,fontSize:"13px"}}>
                  Pin at least 2 lenders to compare.
                </div>
              ) : isMobile ? (
                <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
                  {pinnedLenders.map((l)=>(
                    <div key={`mobile-compare-${l.id}`} className="hmda-compare-mobile-card">
                      <div style={{height:"4px",background:`linear-gradient(90deg, ${typeAccent(l.type)}, ${typeAccent(l.type)}88)`}} />
                      <div style={{padding:"12px"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"8px",marginBottom:"10px"}}>
                          <div style={{minWidth:0}}>
                            <div style={{fontSize:"13px",fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",marginBottom:"3px"}}>{l.name}</div>
                            <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
                              {typeBadge(l.type)}
                              <span style={{fontSize:"10px",color:c.text3,fontFamily:"'JetBrains Mono',monospace"}}>{l.dataYear}</span>
                            </div>
                          </div>
                          <button onClick={()=>togglePin(l)} className="hmda-compare-unpin-btn sort-btn" style={{padding:"5px 10px",borderRadius:"9px",cursor:"pointer",fontSize:"10px",fontWeight:700,color:c.text3}}>Unpin</button>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px"}}>
                          {compareRowsForDisplay.filter((r) => r.k !== "products").map((row)=>(
                            <div key={`${row.k}-${l.id}`} className="hmda-compare-metric-chip" style={{padding:"8px 10px",borderRadius:"10px",background:row.bg}}>
                              <Tip text={row.tip} pos="top" maxW={300}>
                                <span style={{display:"flex",alignItems:"center",gap:"4px",marginBottom:"2px",cursor:row.tip?"help":"default"}}>
                                  <span style={{color:row.fg,opacity:0.8,display:"inline-flex"}}>{row.icon}</span>
                                  <span style={{fontSize:"9px",fontWeight:700,letterSpacing:"0.05em",textTransform:"uppercase",color:row.fg}}>{row.label}</span>
                                </span>
                              </Tip>
                              <div style={{fontSize:"13px",fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:row.fg}}>{row.fmt(l)}</div>
                            </div>
                          ))}
                          <div style={{gridColumn:"1 / -1",padding:"8px 10px",borderRadius:"10px",background:productsCompareRow.bg}} className="hmda-compare-metric-chip">
                            <Tip text={productsCompareRow.tip} pos="top" maxW={300}>
                              <span style={{display:"flex",alignItems:"center",gap:"4px",marginBottom:"5px",cursor:productsCompareRow.tip?"help":"default"}}>
                                <span style={{color:productsCompareRow.fg,opacity:0.8,display:"inline-flex"}}>{productsCompareRow.icon}</span>
                                <span style={{fontSize:"9px",fontWeight:700,letterSpacing:"0.05em",textTransform:"uppercase",color:productsCompareRow.fg}}>Products</span>
                              </span>
                            </Tip>
                            <div style={{display:"flex",flexWrap:"wrap",gap:"4px"}}>
                              {(l.products || []).map((p, i) => (
                                <span key={`${l.id}-p-${i}-${p}`} style={{padding:"2px 7px",borderRadius:"5px",fontSize:"10px",fontWeight:700,background:c.tag,color:c.tagText}}>{p}</span>
                              ))}
                            </div>
                          </div>
                          {l.hmdaInsights && (
                            <div style={{gridColumn:"1 / -1",marginTop:8}}>
                              <HmdaCompactLenderMetrics lender={l} c={c} isMobile={isMobile} marketRef={hmdaMarketRef} Tip={Tip} />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{overflowX:"auto"}}>
                  <div style={{minWidth:`${Math.max(800, pinnedLenders.length * 210)}px`,display:"grid",gridTemplateColumns:`200px repeat(${pinnedLenders.length}, minmax(190px, 1fr))`,gap:"8px"}}>

                    <div style={{padding:"10px 12px",display:"flex",alignItems:"center",gap:"6px",fontSize:"10px",fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:c.text3}}>
                      {IC.filter} Metrics
                    </div>
                    {pinnedLenders.map((l)=>(
                      <div key={`head-${l.id}`} className="hmda-compare-lender-head">
                        <div style={{height:"4px",background:`linear-gradient(90deg, ${typeAccent(l.type)}, ${typeAccent(l.type)}66)`}} />
                        <div style={{padding:"10px 12px"}}>
                          <div style={{fontSize:"13px",fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",marginBottom:"6px"}}>{l.name}</div>
                          <div style={{display:"flex",gap:"6px",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}}>
                            <div style={{display:"flex",gap:"5px",alignItems:"center"}}>
                              {typeBadge(l.type)}
                              <span style={{fontSize:"10px",color:c.text3,fontFamily:"'JetBrains Mono',monospace"}}>{l.dataYear}</span>
                            </div>
                            <button onClick={()=>togglePin(l)} className="hmda-compare-unpin-btn sort-btn" style={{padding:"3px 9px",borderRadius:"8px",cursor:"pointer",fontSize:"10px",fontWeight:700,color:c.text3}}>Unpin</button>
                          </div>
                        </div>
                      </div>
                    ))}

                    {compareRowsForDisplay.map((row)=>{
                      const bestId = getBestId(row);
                      return (
                      <Fragment key={`row-${row.k}`}>
                        <Tip text={row.tip} pos="bottom" maxW={300}>
                          <span
                            className="hmda-compare-metric-label"
                            style={{
                              padding:"10px 14px",
                              borderRadius:"12px",
                              background:row.bg,
                              display:"flex",
                              alignItems:"center",
                              gap:"8px",
                              cursor:row.tip?"help":"default",
                              width:"100%",
                              boxSizing:"border-box",
                            }}
                          >
                            <span style={{color:row.fg,flexShrink:0,display:"inline-flex"}}>{row.icon}</span>
                            <span style={{fontSize:"11px",fontWeight:700,color:row.fg,letterSpacing:"0.03em"}}>{row.label}</span>
                          </span>
                        </Tip>
                        {pinnedLenders.map((l)=>{
                          const isWinner = bestId === l.id;
                          if (row.k === "products") return (
                            <div key={`${row.k}-${l.id}`} className="hmda-compare-value-cell" style={{padding:"8px 10px",borderRadius:"12px",display:"flex",flexWrap:"wrap",gap:"4px",alignItems:"flex-start"}}>
                              {(l.products || []).map((p, i) => (
                                <span key={`${l.id}-p-${i}-${p}`} style={{padding:"2px 7px",borderRadius:"5px",fontSize:"10px",fontWeight:700,background:c.tag,color:c.tagText}}>{p}</span>
                              ))}
                            </div>
                          );
                          return (
                          <div key={`${row.k}-${l.id}`} className={`hmda-compare-value-cell${isWinner ? " hmda-compare-value-cell--winner" : ""}`} style={{
                            padding:"10px 14px",borderRadius:"12px",
                            background: isWinner ? row.bg : cellBg,
                            boxShadow: isWinner ? `0 0 0 2px ${row.fg}40, 0 4px 20px ${row.fg}22` : "none",
                            fontSize:"14px",fontWeight:700,
                            fontFamily:"'JetBrains Mono',monospace",
                            color: isWinner ? row.fg : c.text2,
                            display:"flex",alignItems:"center",gap:"6px",
                            transition:"all 0.2s ease",
                          }}>
                            {isWinner && <span style={{fontSize:"9px",fontWeight:800,color:row.fg,letterSpacing:"0.04em",background:`${row.fg}18`,padding:"1px 5px",borderRadius:"4px"}}>BEST</span>}
                            {row.fmt(l)}
                          </div>
                        );})}
                      </Fragment>
                    );})}
                  </div>
                  {pinnedLenders.some((x) => x.hmdaInsights) && (
                    <div style={{ marginTop: "18px" }}>
                      <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: c.text3, marginBottom: "10px" }}>
                        HMDA LAR — outcomes, denials, timing, vs national segment
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: `repeat(${pinnedLenders.length}, minmax(200px, 1fr))`, gap: "10px" }}>
                        {pinnedLenders.map((l) => (
                          <div key={`cmp-hmda-${l.id}`} className="hmda-compare-hmda-block" style={{ padding: "10px", borderRadius: "14px" }}>
                            <div style={{ fontSize: "11px", fontWeight: 700, marginBottom: 8, color: c.text2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name}</div>
                            <HmdaCompactLenderMetrics lender={l} c={c} isMobile={false} marketRef={hmdaMarketRef} Tip={Tip} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <HmdaLegalDisclaimer c={c} compact />
            </div>
          </div>
          );
        })()}

        {/* ───────────────────────────────────────────────────── PRODUCT CARD DRILLDOWN MODAL ───────────────────────────────────────────────────── */}
        {productCardDrillData&&(()=>{
          const PROD_CLR = {Conventional:dk?"#818CF8":"#4F46E5",FHA:dk?"#34D399":"#059669",VA:dk?"#F87171":"#DC2626",USDA:dk?"#2DD4BF":"#0F766E","Non-QM":dk?"#A78BFA":"#7C3AED",Jumbo:dk?"#FCD34D":"#D97706",HELOC:dk?"#F472B6":"#BE185D",Construction:dk?"#FB923C":"#C2410C"};
          const pc = PROD_CLR[productCardDrillData.product] || c.accent;
          const glassOverlay = dk?"rgba(2,4,18,0.72)":"rgba(246, 249, 252, 0.75)";
          const glassBg = dk?"rgba(8,10,28,0.70)":"rgba(255,255,255,0.97)";
          const glassBorder = dk?"rgba(255,255,255,0.10)":"rgba(43, 94, 167, 0.12)";
          const glassShadow = dk?"0 40px 100px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.06)":"0 16px 48px rgba(43, 94, 167, 0.12)";
          const cellBg = dk?"rgba(255,255,255,0.04)":"rgba(255,255,255,0.65)";
          const cellBorder = dk?"rgba(255,255,255,0.08)":"rgba(200,210,230,0.60)";
          const maxYearUnits = Math.max(1, ...productCardDrillData.yearBreakdown.map(y=>y.units));
          return (
          <div className="overlay-enter" onClick={e=>{if(e.target===e.currentTarget)setProductCardDrill(null);}} style={{position:"fixed",inset:0,zIndex:102,display:"flex",alignItems:"flex-start",justifyContent:"center",background:glassOverlay,backdropFilter:"blur(18px) saturate(160%)",overflowY:"auto"}}>
            <div className="hmda-modal-pastel-accent" style={{background:glassBg,border:`1px solid ${glassBorder}`,borderRadius:isMobile?"22px":"28px",padding:isMobile?"18px":"28px",maxWidth:isMobile?"96vw":"1100px",width:"96%",boxShadow:glassShadow,backdropFilter:"blur(32px) saturate(180%)",marginTop:"96px",marginBottom:"40px"}}>

              {/* Header */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:"12px",marginBottom:"6px",flexWrap:"wrap"}}>
                <div style={{display:"flex",alignItems:"center",gap:"12px"}}>
                  <div style={{width:"44px",height:"44px",borderRadius:"14px",background:`${pc}18`,border:`1px solid ${pc}33`,display:"flex",alignItems:"center",justifyContent:"center",color:pc,flexShrink:0,fontSize:"20px",fontWeight:800}}>{productCardDrillData.product.slice(0,2)}</div>
                  <div>
                    <h2 style={{fontSize:"22px",fontWeight:800,letterSpacing:"-0.02em",marginBottom:"3px"}}>{productCardDrillData.product}</h2>
                    <div style={{fontSize:"12px",color:c.text3,maxWidth:"480px",lineHeight:1.4}}>{TIPS[productCardDrillData.product]||""}</div>
                  </div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                  <button onClick={()=>setProductCardDrill(null)} style={{width:"36px",height:"36px",borderRadius:"12px",border:`1px solid ${cellBorder}`,cursor:"pointer",background:dk?"rgba(255,255,255,0.07)":"rgba(255,255,255,0.70)",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",color:c.text3}}>{IC.x}</button>
                </div>
              </div>

              <div style={{height:"1px",background:dk?"rgba(255,255,255,0.08)":`${pc}22`,margin:"14px 0"}} />
              <ModalDueDiligenceNote onRequestUpdateRecords={()=>setUpdateRecordsFormOpen(true)} />

              {/* Hero stats */}
              <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(4,minmax(0,1fr))",gap:"10px",marginBottom:"18px"}}>
                {[
                  {l:"Lenders",v:(productCardDrillData.totalMemberCount ?? productCardDrillData.members.length).toLocaleString(),bg:`${pc}14`,fg:pc,icon:IC.building},
                  {l:"Total Units",v:fmtUnits(productCardDrillData.totalUnits),bg:dk?"rgba(129,140,248,0.13)":"rgba(99,102,241,0.09)",fg:dk?"#818CF8":"#4F46E5",icon:IC.chart},
                  {l:"Total Volume",v:fmtDollar(productCardDrillData.totalVolume),bg:dk?"rgba(52,211,153,0.12)":"rgba(16,185,129,0.09)",fg:dk?"#34D399":"#059669",icon:IC.dollar},
                  {l:"Avg Units / Lender",v:((productCardDrillData.totalMemberCount ?? productCardDrillData.members.length)?Math.round(productCardDrillData.totalUnits/(productCardDrillData.totalMemberCount ?? productCardDrillData.members.length)):0).toLocaleString(),bg:dk?"rgba(251,191,36,0.12)":"rgba(245,158,11,0.09)",fg:dk?"#FCD34D":"#D97706",icon:IC.rate},
                ].map(s=>(
                  <div key={s.l} style={{padding:"12px 14px",borderRadius:"14px",background:s.bg,border:`1px solid ${s.fg}22`,display:"flex",alignItems:"center",gap:"10px"}}>
                    <span style={{color:s.fg,flexShrink:0,display:"inline-flex"}}>{s.icon}</span>
                    <div>
                      <div style={{fontSize:"10px",fontWeight:700,letterSpacing:"0.05em",textTransform:"uppercase",color:s.fg,opacity:0.8,marginBottom:"3px"}}>{s.l}</div>
                      <div style={{fontSize:"16px",fontWeight:800,fontFamily:"'JetBrains Mono',monospace",color:s.fg}}>{s.v}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginBottom: "18px", padding: "14px 16px", borderRadius: "16px", background: cellBg, border: `1px solid ${cellBorder}` }}>
                <div style={{ fontSize: "11px", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: c.text3, marginBottom: "10px" }}>
                  HMDA {panelYear} product breakdown
                </div>
                <HmdaProductBreakdownPanel metrics={productCardDrillData.hmda} productName={productCardDrillData.product} accent={pc} c={c} dk={dk} />
              </div>

              {/* Year breakdown */}
              <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":`repeat(${Math.min(productCardDrillData.yearBreakdown.length, 4)},minmax(0,1fr))`,gap:"10px",marginBottom:"18px"}}>
                {productCardDrillData.yearBreakdown.map((y,yi)=>{
                  const barPct = Math.round((y.units / maxYearUnits) * 100);
                  const isLatest = yi === productCardDrillData.yearBreakdown.length - 1;
                  return (
                  <div key={y.year} style={{padding:"14px 16px",borderRadius:"16px",background:isLatest?`${pc}10`:cellBg,border:`1px solid ${isLatest?pc+"33":cellBorder}`,backdropFilter:"blur(8px)"}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"10px"}}>
                      <div style={{fontSize:"15px",fontWeight:800,color:isLatest?pc:c.text2}}>{y.year}</div>
                      {isLatest && <span style={{fontSize:"9px",fontWeight:700,letterSpacing:"0.05em",padding:"2px 7px",borderRadius:"5px",background:`${pc}20`,color:pc,textTransform:"uppercase"}}>Latest</span>}
                    </div>
                    <div style={{height:"6px",borderRadius:"3px",background:dk?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.08)",overflow:"hidden",marginBottom:"12px"}}>
                      <div style={{height:"100%",width:`${barPct}%`,borderRadius:"3px",background:`linear-gradient(90deg, ${pc}, ${pc}77)`,transition:"width 0.7s ease"}} />
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px"}}>
                      {[
                        {label:"Lenders",value:y.lenders.toLocaleString()},
                        {label:"Units",value:fmtUnits(y.units)},
                        {label:"Volume",value:fmtDollar(y.volume)},
                      ].map(s=>(
                        <div key={s.label}>
                          <div style={{fontSize:"9px",color:c.text3,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:"2px"}}>{s.label}</div>
                          <div style={{fontSize:"12px",fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:c.text2}}>{s.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  );
                })}
              </div>

              {/* Sort bar */}
              <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"10px",flexWrap:"wrap"}}>
                <span style={{fontSize:"11px",color:c.text3,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>Sort by:</span>
                {[{k:"originations",l:"Units"},{k:"dollarVol",l:"Volume"},{k:"states",l:"States"},{k:"branches",l:"Branches"},{k:"name",l:"Name"},{k:"dataYear",l:"Year"}].map(h=>(
                  <button key={h.k} onClick={()=>doProductCardSort(h.k)} className="sort-btn" style={{padding:"5px 11px",borderRadius:"8px",border:`1px solid ${productCardSortField===h.k?pc+"66":cellBorder}`,cursor:"pointer",fontSize:"11px",fontWeight:700,background:productCardSortField===h.k?`${pc}14`:(dk?"rgba(255,255,255,0.06)":"rgba(255,255,255,0.60)"),color:productCardSortField===h.k?pc:c.text3}}>
                    {h.l} {productCardSortField===h.k?(productCardSortDir==="asc"?"▴":"▾"):""}
                  </button>
                ))}
              </div>

              {/* Lender list rows */}
              <div style={{display:"flex",flexDirection:"column",gap:"6px",marginBottom:"12px"}}>
                {productCardPagedMembers.map((m, idx)=>{
                  const rank = (productCardSafePage-1)*PAGE_SIZE+idx+1;
                  return (
                  <div key={`${m.id}-${idx}`} className="lcard-item" onClick={()=>openLender(m)} style={{borderRadius:"12px",background:cellBg,border:`1px solid ${cellBorder}`,backdropFilter:"blur(8px)",overflow:"hidden",cursor:"pointer",transition:"all 0.2s ease"}}>
                    <div style={{display:"flex",alignItems:"stretch"}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"center",minWidth:"48px",borderRight:`1px solid ${cellBorder}`,flexShrink:0}}>
                        <span style={{fontSize:"13px",fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:c.text3,lineHeight:1}}>{rank}</span>
                      </div>
                      <div style={{flex:1,padding:"10px 14px",display:"grid",gridTemplateColumns:isMobile?"1fr":`minmax(200px,1.6fr) repeat(4,minmax(70px,1fr))`,gap:"8px",alignItems:"center"}}>
                        <div style={{minWidth:0}}>
                          <div style={{fontSize:"13px",fontWeight:700,lineHeight:1.2,marginBottom:"3px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.name}</div>
                          <div style={{display:"flex",gap:"5px",alignItems:"center",flexWrap:"wrap"}}>
                            <span style={{fontSize:"10px",color:c.text3,fontFamily:"'JetBrains Mono',monospace"}}>#{m.nmls}</span>
                            {typeBadge(m.type)}
                            <span style={{fontSize:"9px",padding:"1px 5px",borderRadius:"4px",background:`${pc}18`,color:pc,fontWeight:700}}>{m.dataYear}</span>
                          </div>
                        </div>
                        <div style={{textAlign:"center"}}>
                          <div style={{fontSize:"9px",color:c.text3,textTransform:"uppercase",fontWeight:700,letterSpacing:"0.06em",marginBottom:"2px"}}>Volume</div>
                          <div style={{fontSize:"13px",fontWeight:700,fontFamily:"'JetBrains Mono',monospace"}}>{fmtDollar(m.dollarVol)}</div>
                        </div>
                        <div style={{textAlign:"center"}}>
                          <div style={{fontSize:"9px",color:c.text3,textTransform:"uppercase",fontWeight:700,letterSpacing:"0.06em",marginBottom:"2px"}}>Units Closed</div>
                          <div style={{fontSize:"13px",fontWeight:700,fontFamily:"'JetBrains Mono',monospace"}}>{fmtUnits(m.originations||0)}</div>
                        </div>
                        <div style={{textAlign:"center"}}>
                          <div style={{fontSize:"9px",color:c.text3,textTransform:"uppercase",fontWeight:700,letterSpacing:"0.06em",marginBottom:"2px"}}>States</div>
                          <div style={{fontSize:"13px",fontWeight:700,fontFamily:"'JetBrains Mono',monospace"}}>{m.states||0}</div>
                        </div>
                        <div style={{textAlign:"center"}}>
                          <div style={{fontSize:"9px",color:c.text3,textTransform:"uppercase",fontWeight:700,letterSpacing:"0.06em",marginBottom:"2px"}}>Branches</div>
                          <div style={{fontSize:"13px",fontWeight:700,fontFamily:"'JetBrains Mono',monospace"}}>{fmtBranchSitesCell(m)}</div>
                        </div>
                      </div>
                    </div>
                    <div style={{ padding: "8px 12px 10px", borderTop: `1px solid ${cellBorder}`, background: dk ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)" }}>
                      <HmdaCompactLenderMetrics lender={m} c={c} isMobile={isMobile} marketRef={hmdaMarketRef} Tip={Tip} />
                    </div>
                  </div>
                  );
                })}
              </div>

              {/* Pagination */}
              {(productCardDrillData.totalMemberCount ?? productCardDrillData.members.length)>0&&(
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"10px",padding:"10px 12px",borderRadius:"12px",background:cellBg,border:`1px solid ${cellBorder}`}}>
                  <span style={{fontSize:"12px",color:c.text3,fontWeight:600}}>Showing {(productCardSafePage-1)*PAGE_SIZE+1}–{Math.min(productCardSafePage*PAGE_SIZE,productCardDrillData.totalMemberCount ?? productCardDrillData.members.length)} of {productCardDrillData.totalMemberCount ?? productCardDrillData.members.length}</span>
                  <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                    <button onClick={()=>setProductCardPage(p=>Math.max(1,p-1))} disabled={productCardSafePage===1} className="sort-btn" style={{padding:"7px 12px",borderRadius:"10px",border:"none",cursor:productCardSafePage===1?"not-allowed":"pointer",fontSize:"12px",fontWeight:700,background:dk?"rgba(255,255,255,0.08)":"rgba(255,255,255,0.70)",color:c.chipText,opacity:productCardSafePage===1?0.45:1}}>Prev</button>
                    <span style={{fontSize:"12px",fontWeight:700,color:c.text2,fontFamily:"'JetBrains Mono',monospace"}}>{productCardSafePage} / {productCardTotalPages}</span>
                    <button onClick={()=>setProductCardPage(p=>Math.min(productCardTotalPages,p+1))} disabled={productCardSafePage===productCardTotalPages} className="sort-btn" style={{padding:"7px 12px",borderRadius:"10px",border:"none",cursor:productCardSafePage===productCardTotalPages?"not-allowed":"pointer",fontSize:"12px",fontWeight:700,background:dk?"rgba(255,255,255,0.08)":"rgba(255,255,255,0.70)",color:c.chipText,opacity:productCardSafePage===productCardTotalPages?0.45:1}}>Next</button>
                  </div>
                </div>
              )}
            </div>
          </div>
          );
        })()}

          </>
        )}
      </div>

      {/* "" FIXED BOTTOM SEARCH BAR (hidden per product request) "" */}

      {/* "" DEMO OVERLAY "" */}
      {demoActive && (
        <div style={{position:"fixed",inset:0,zIndex:9999,pointerEvents:"auto"}}>
          <div onClick={(e)=>{e.stopPropagation();}} style={{position:"absolute",inset:0,background:"transparent"}} />
          {demoSpotlight && (
            <div style={{position:"fixed",left:demoSpotlight.x-8,top:demoSpotlight.y-8,width:demoSpotlight.w+16,height:demoSpotlight.h+16,borderRadius:"16px",border:`3px solid ${c.accent}`,boxShadow:`0 0 0 4px ${c.accent}40, 0 0 40px ${c.accent}30`,pointerEvents:"none",animation:"pulse 2s ease-in-out infinite"}} />
          )}
          <div style={{position:"fixed",left:"50%",bottom:demoSpotlight?"80px":"50%",transform:demoSpotlight?"translateX(-50%)":"translate(-50%,50%)",maxWidth:"420px",width:"calc(100% - 32px)",zIndex:10001}}>
            <div className="hmda-demo-modal" style={{background:c.modal,borderRadius:"22px",border:`1px solid ${c.border}`,boxShadow:dk?"0 24px 60px rgba(0,0,0,0.5)":"0 24px 48px rgba(15,23,42,0.08)",padding:"28px 26px 24px",animation:"rise 0.35s ease"}}>
              <div style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"14px"}}>
                <span className="hmda-demo-icon-pulse" style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:"40px",height:"40px",borderRadius:"12px",background:dk?"rgba(99,102,241,0.2)":"rgba(99,102,241,0.1)"}}>
                  {DEMO_STEPS[demoStep]?.id==="welcome"?<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 10 16 16 12" fill={c.accent} stroke="none"/></svg>:DEMO_STEPS[demoStep]?.id==="compare"?<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>:DEMO_STEPS[demoStep]?.id==="demo-rate"?<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>:DEMO_STEPS[demoStep]?.id==="demo-contact"?<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>:DEMO_STEPS[demoStep]?.id==="done"?<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 10 16 16 12" fill={c.accent} stroke="none"/></svg>}
                </span>
                <h3 style={{fontSize:"18px",margin:0,color:c.text}}>{DEMO_STEPS[demoStep]?.title}</h3>
              </div>
              <p style={{fontSize:"14px",lineHeight:1.6,color:c.text2,margin:0,marginBottom:"22px",fontWeight:400}}>{DEMO_STEPS[demoStep]?.body}</p>
              <div style={{display:"flex",flexDirection:"column",gap:"16px",alignItems:"center",width:"100%"}}>
                <div style={{display:"flex",gap:"10px",flexWrap:"wrap",justifyContent:"center"}}>
                  <button onClick={demoNext} className="hmda-demo-btn-primary" style={{display:"inline-flex",alignItems:"center",gap:"6px",padding:"10px 18px",borderRadius:"12px",border:"none",cursor:"pointer",fontSize:"14px",fontFamily:"inherit",background:c.accent,color:"#fff",boxShadow:`0 4px 14px ${c.accent}50`}}>
                    {demoStep>=DEMO_STEPS.length-1?"Done" : "Next"} →
                  </button>
                  <button onClick={()=>dismissDemo()} className="hmda-demo-btn-ghost" style={{display:"inline-flex",alignItems:"center",padding:"10px 14px",borderRadius:"12px",border:"none",cursor:"pointer",fontSize:"13px",fontFamily:"inherit",background:c.chip,color:c.chipText}}>
                    Skip tour
                  </button>
                </div>
                <div style={{display:"flex",gap:"8px",flexWrap:"wrap",justifyContent:"center"}}>
                  <button onClick={()=>dismissDemo("2weeks")} className="hmda-demo-dismiss-btn">
                    <span className="hmda-demo-icon-pulse"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></span>
                    Don't show for 2 weeks
                  </button>
                  <button onClick={()=>dismissDemo("never")} className="hmda-demo-dismiss-btn">
                    <span className="hmda-demo-icon-pulse"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/><line x1="19.07" y1="4.93" x2="4.93" y2="19.07"/></svg></span>
                    Never show again
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* "" Update records request form modal "" */}
      {updateRecordsFormOpen && (
        <div className="overlay-enter hmda-modal-overlay" onClick={e=>{if(e.target===e.currentTarget){setUpdateRecordsFormOpen(false);setUpdateRecordsSubmitted(false);setUpdateRecordsForm({name:"",position:"",email:"",phone:"",message:""});}}} style={{background:c.overlay,zIndex:102}}>
          <div onClick={e=>e.stopPropagation()} className="hmda-modal-panel hmda-modal-pastel-accent" style={{background:c.modal,border:`1px solid ${c.modalBorder}`,borderRadius:isMobile?"18px":"20px",padding:isMobile?"20px 16px 24px":"28px",maxWidth:"440px",width:"100%",boxShadow:c.shadowLg,maxHeight:isMobile?"90vh":undefined,overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"20px"}}>
              <h3 style={{fontSize:"18px",fontWeight:700,margin:0,letterSpacing:"-0.02em"}}>Request record update</h3>
              <button type="button" onClick={()=>{setUpdateRecordsFormOpen(false);setUpdateRecordsSubmitted(false);setUpdateRecordsForm({name:"",position:"",email:"",phone:"",message:""});}} style={{width:"32px",height:"32px",borderRadius:"8px",border:"none",cursor:"pointer",background:c.chip,display:"flex",alignItems:"center",justifyContent:"center",color:c.text3,fontSize:"18px",lineHeight:1}} aria-label="Close">×</button>
            </div>
            {updateRecordsSubmitted ? (
              <div style={{padding:"16px 0",fontSize:"14px",color:c.text2}}>
                Thank you. We have received your request and will follow up as needed.
              </div>
            ) : (
              <form onSubmit={async (e)=>{
                e.preventDefault();
                setUpdateRecordsError("");
                setUpdateRecordsSubmitting(true);
                try {
                  const res = await fetch(RECORD_UPDATE_API, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      name: updateRecordsForm.name.trim(),
                      position: updateRecordsForm.position.trim() || undefined,
                      email: updateRecordsForm.email.trim(),
                      phone: updateRecordsForm.phone.trim() || undefined,
                      message: updateRecordsForm.message.trim(),
                    }),
                  });
                  if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.error || `Request failed (${res.status})`);
                  }
                  setUpdateRecordsSubmitted(true);
                  setUpdateRecordsForm({ name: "", position: "", email: "", phone: "", message: "" });
                } catch (err) {
                  setUpdateRecordsError(err.message || "Could not submit. Try again or email sales@teraverde.com.");
                } finally {
                  setUpdateRecordsSubmitting(false);
                }
              }} style={{display:"flex",flexDirection:"column",gap:"14px"}}>
                <div>
                  <label style={{display:"block",fontSize:"11px",fontWeight:700,color:c.text3,letterSpacing:"0.04em",textTransform:"uppercase",marginBottom:"4px"}}>Name</label>
                  <input type="text" value={updateRecordsForm.name} onChange={e=>setUpdateRecordsForm(f=>({...f,name:e.target.value}))} required placeholder="Your name" style={{width:"100%",padding:"10px 12px",borderRadius:"10px",border:`1px solid ${c.inputBorder}`,background:c.inputBg,color:c.text2,fontSize:"14px",fontFamily:"inherit",boxSizing:"border-box"}} />
                </div>
                <div>
                  <label style={{display:"block",fontSize:"11px",fontWeight:700,color:c.text3,letterSpacing:"0.04em",textTransform:"uppercase",marginBottom:"4px"}}>Position</label>
                  <input type="text" value={updateRecordsForm.position} onChange={e=>setUpdateRecordsForm(f=>({...f,position:e.target.value}))} placeholder="Job title / role" style={{width:"100%",padding:"10px 12px",borderRadius:"10px",border:`1px solid ${c.inputBorder}`,background:c.inputBg,color:c.text2,fontSize:"14px",fontFamily:"inherit",boxSizing:"border-box"}} />
                </div>
                <div>
                  <label style={{display:"block",fontSize:"11px",fontWeight:700,color:c.text3,letterSpacing:"0.04em",textTransform:"uppercase",marginBottom:"4px"}}>Email</label>
                  <input type="email" value={updateRecordsForm.email} onChange={e=>setUpdateRecordsForm(f=>({...f,email:e.target.value}))} required placeholder="you@company.com" style={{width:"100%",padding:"10px 12px",borderRadius:"10px",border:`1px solid ${c.inputBorder}`,background:c.inputBg,color:c.text2,fontSize:"14px",fontFamily:"inherit",boxSizing:"border-box"}} />
                </div>
                <div>
                  <label style={{display:"block",fontSize:"11px",fontWeight:700,color:c.text3,letterSpacing:"0.04em",textTransform:"uppercase",marginBottom:"4px"}}>Phone</label>
                  <input type="tel" value={updateRecordsForm.phone} onChange={e=>setUpdateRecordsForm(f=>({...f,phone:e.target.value}))} placeholder="Optional" style={{width:"100%",padding:"10px 12px",borderRadius:"10px",border:`1px solid ${c.inputBorder}`,background:c.inputBg,color:c.text2,fontSize:"14px",fontFamily:"inherit",boxSizing:"border-box"}} />
                </div>
                <div>
                  <label style={{display:"block",fontSize:"11px",fontWeight:700,color:c.text3,letterSpacing:"0.04em",textTransform:"uppercase",marginBottom:"4px"}}>Message / What data to update</label>
                  <textarea value={updateRecordsForm.message} onChange={e=>setUpdateRecordsForm(f=>({...f,message:e.target.value}))} required placeholder="Describe the correction or update you are requesting" rows={4} style={{width:"100%",padding:"10px 12px",borderRadius:"10px",border:`1px solid ${c.inputBorder}`,background:c.inputBg,color:c.text2,fontSize:"14px",fontFamily:"inherit",resize:"vertical",boxSizing:"border-box"}} />
                </div>
                {updateRecordsError && <p style={{margin:0,fontSize:"12px",color:c.danger||"#dc2626"}}>{updateRecordsError}</p>}
                <div style={{display:"flex",gap:"10px",marginTop:"6px"}}>
                  <button type="submit" disabled={updateRecordsSubmitting} style={{flex:1,padding:"12px 16px",borderRadius:"10px",border:"none",cursor:updateRecordsSubmitting?"not-allowed":"pointer",background:c.gradBtn,color:"#fff",fontSize:"14px",fontWeight:700,fontFamily:"inherit",opacity:updateRecordsSubmitting?0.7:1}}>{updateRecordsSubmitting ? "Sending&" : "Submit request"}</button>
                  <button type="button" onClick={()=>{setUpdateRecordsFormOpen(false);setUpdateRecordsForm({name:"",position:"",email:"",phone:"",message:""});}} style={{padding:"12px 16px",borderRadius:"10px",border:`1px solid ${c.border}`,cursor:"pointer",background:"transparent",color:c.text2,fontSize:"14px",fontWeight:600,fontFamily:"inherit"}}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

    </div>
    </HmdaThemeCtx.Provider>
  );
}

