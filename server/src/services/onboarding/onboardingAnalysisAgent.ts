/**
 * Onboarding Analysis Agent
 *
 * LLM-powered schema analysis that replaces the rule-based field matching wizard.
 * Fetches sample loans via the existing discovery service, sends field definitions
 * + sample values to the LLM, and returns structured recommendations for field
 * swaps, revenue fields, additional fields, and data quality flags.
 */

import pg from "pg";
import {
  callLLM,
  safeExecuteSQL,
  getSchemaContext,
  getOpenAIKey,
  formatResultsForLLM,
  type LLMMessage,
} from "../research/tools.js";
import { EncompassFieldDiscoveryService } from "../encompassFieldDiscoveryService.js";
import {
  DEFAULT_ENCOMPASS_FIELD_MAPPINGS,
  FIELD_CATEGORIES,
  FIELD_CATEGORY_MAP,
  type FieldCategory,
} from "../../config/defaultEncompassFieldMappings.js";

// ============================================================================
// Types
// ============================================================================

export interface OnboardingAnalysis {
  fieldSwapRecommendations: FieldSwapRecommendation[];
  revenueFieldCandidates: RevenueFieldCandidate[];
  suggestedAdditionalFields: SuggestedAdditionalField[];
  dataQualityFlags: DataQualityFlag[];
  rdbMissingFields: RdbMissingField[];
  summary: string;
}

export interface FieldSwapRecommendation {
  coheusAlias: string;
  recommendedFieldId: string;
  confidence: number;
  reasoning: string;
  currentPopulation: number;
  sampleValues: string[];
}

export interface RevenueFieldCandidate {
  fieldId: string;
  fieldDescription: string;
  detectedRole: "base_price" | "fee" | "credit" | "other";
  populationRate: number;
}

export interface SuggestedAdditionalField {
  fieldId: string;
  description: string;
  populationRate: number;
  reason: string;
}

export interface DataQualityFlag {
  field: string;
  issue: string;
  severity: "critical" | "warning" | "info";
  recommendation: string;
}

export interface RdbMissingField {
  fieldId: string;
  coheusAlias?: string;
  description: string;
  fieldReaderPopulation?: number;
  canonicalName?: string;
}

export type AnalysisPhase =
  | "discovery"
  | "sampling"
  | "analyzing"
  | "matching"
  | "quality_check"
  | "complete"
  | "error";

export interface AnalysisEvent {
  type: "phase" | "progress" | "result" | "error";
  phase?: AnalysisPhase;
  message?: string;
  data?: any;
  timestamp: number;
}

export type OnAnalysisEvent = (event: AnalysisEvent) => void;

// ============================================================================
// System Prompt
// ============================================================================

const ANALYSIS_SYSTEM_PROMPT = `You are an expert data engineer specializing in mortgage lending systems. You are analyzing an Encompass LOS integration to recommend optimal field mappings for the Coheus analytics platform.

Your job:
1. FIELD MATCHING: For each Coheus alias, determine which Encompass field best maps to it by examining field descriptions, sample values, and population rates. Consider semantic meaning, not just keyword overlap.
2. REVENUE DETECTION: Identify fields that look like revenue components (base price rates, origination fees, seller fees, lender credits, SRP, etc.)
3. ADDITIONAL FIELDS: Identify valuable custom fields (CX.*) that are well-populated and worth adding as analytics dimensions.
4. DATA QUALITY: Flag fields with quality issues (low population on critical fields, stale data, date inconsistencies, suspicious value distributions).

CRITICAL RULES FOR FIELD MATCHING:
- You will receive a "Default Mapping Health Check" section that cross-references every default field against the Encompass sample. Fields marked "NEEDS SWAP" have <10% population — you MUST recommend a swap for each of these if a better alternative exists. Fields marked "NOT in sample" may not exist in this instance — also recommend swaps for these.
- DO NOT recommend swapping a field listed as "Healthy". If the default mapping is working fine, do NOT include it in fieldSwapRecommendations at all.
- Only recommend a swap when: (a) the current mapping has low population but a better-populated alternative exists, (b) the current mapping points to the wrong semantic field, or (c) there is no current mapping.
- Each Encompass field ID should map to AT MOST ONE Coheus alias. Do not recommend the same Encompass field for two different aliases (e.g., 1109 is "Base Loan Amount", not "Loan Amount" — those are distinct fields).
- Pay close attention to the default mapping definitions. "Loan Amount" defaults to field 2, "Base Loan Amount" defaults to field 1109. These are DIFFERENT fields with different meanings.
- Field IDs are shown WITHOUT the "Fields." namespace prefix (e.g., "2" not "Fields.2"). When recommending a field, use the bare ID as shown in the available fields list.
- Confidence should be 0-100. Above 85 = high confidence, 60-85 = medium, below 60 = low.
- For field matching, prefer fields with higher population rates when descriptions are similarly relevant.
- A field with <10% population is suspicious for critical fields (like dates, amounts).
- Revenue fields typically have field IDs containing "rate", "price", "fee", "credit", "srp", "margin", or values that look like percentages (e.g., 100.5, 99.75) or dollar amounts.
- Custom fields (CX.*) with >50% population are candidates for additional fields.
- All discovered fields are sampled for population. If a field shows pop=0%, it is genuinely unpopulated in the sample. Use -1 only if a field you want to recommend is NOT listed in the available fields section at all.
- Always provide clear reasoning for each recommendation.

Respond with valid JSON matching this schema:
{
  "fieldSwapRecommendations": [
    {
      "coheusAlias": "string - the Coheus alias name",
      "recommendedFieldId": "string - the Encompass field ID to map to",
      "confidence": "number 0-100",
      "reasoning": "string - why this mapping is recommended",
      "currentPopulation": "number 0-100 - population rate of the recommended field",
      "sampleValues": ["array of up to 3 sample values"]
    }
  ],
  "revenueFieldCandidates": [
    {
      "fieldId": "string",
      "fieldDescription": "string",
      "detectedRole": "base_price | fee | credit | other",
      "populationRate": "number 0-100"
    }
  ],
  "suggestedAdditionalFields": [
    {
      "fieldId": "string",
      "description": "string",
      "populationRate": "number 0-100, or -1 if the field was not included in the sample extract and population is unknown",
      "reason": "string"
    }
  ],
  "dataQualityFlags": [
    {
      "field": "string - field ID or alias",
      "issue": "string - description of the quality issue",
      "severity": "critical | warning | info",
      "recommendation": "string - what to do about it"
    }
  ],
  "summary": "string - 2-3 sentence executive summary of the analysis"
}`;

// ============================================================================
// Main Analysis Function
// ============================================================================

export type SamplingStrategy = "pipeline" | "fullLoan" | "hybrid";

export async function runOnboardingAnalysis(
  tenantId: string,
  connectionId: string,
  tenantPool: pg.Pool,
  onEvent: OnAnalysisEvent,
  samplingStrategy: SamplingStrategy = "hybrid"
): Promise<OnboardingAnalysis> {
  const emit = (
    type: AnalysisEvent["type"],
    phase?: AnalysisPhase,
    message?: string,
    data?: any
  ) => {
    onEvent({ type, phase, message, data, timestamp: Date.now() });
  };

  try {
    // Phase 1: Discovery
    emit("phase", "discovery", "Discovering available Encompass fields...");
    const discoveryService = new EncompassFieldDiscoveryService(tenantPool);

    const discoveryResult = await discoveryService.discoverAvailableFields(
      tenantId,
      connectionId,
      true
    );
    emit(
      "progress",
      "discovery",
      `Found ${discoveryResult.rdbFieldCount} RDB fields and ${discoveryResult.customFieldCount} custom fields`
    );

    // Phase 2: Sampling — analyze field population from actual loans
    emit("phase", "sampling", "Analyzing field population from sample loans...");
    console.log(`[OnboardingAnalysis] Using sampling strategy: ${samplingStrategy}`);

    let analysisResult: {
      populationStats: any[];
      sampleSize: number;
      analyzedAt: Date;
      fieldsWithData: number;
      fieldsWithoutData: number;
      rdbMissingFields: RdbMissingField[];
    };

    if (samplingStrategy === "hybrid") {
      // -------------------------------------------------------------------
      // Hybrid: Phase 1 pipeline (default field population) + Phase 2 full loan (discovery) + Phase 3 Field Reader (gap fill)
      // -------------------------------------------------------------------
      emit("progress", "sampling", "Hybrid: Phase 1 — pipeline for default fields...");

      const defaultFieldIds = [...new Set(Object.values(DEFAULT_ENCOMPASS_FIELD_MAPPINGS))].filter(
        (id) => !isBorrowerPiiField(id.startsWith("Fields.") ? id.substring(7) : id)
      );
      const pipelineBatchSize = 300;
      const pipelineStats: any[] = [];
      let pipelineSampleSize = 0;
      for (let i = 0; i < defaultFieldIds.length; i += pipelineBatchSize) {
        const batch = defaultFieldIds.slice(i, i + pipelineBatchSize);
        emit("progress", "sampling", `Pipeline batch ${Math.floor(i / pipelineBatchSize) + 1} (${batch.length} default fields)...`);
        try {
          const batchResult = await discoveryService.analyzeFieldPopulation(
            tenantId,
            connectionId,
            { sampleSize: 200, fieldsToAnalyze: batch },
          );
          pipelineStats.push(...batchResult.populationStats);
          pipelineSampleSize = batchResult.sampleSize;
        } catch (err: any) {
          console.warn(`[OnboardingAnalysis:Hybrid] Pipeline batch failed: ${err.message}`);
        }
        if (i + pipelineBatchSize < defaultFieldIds.length) {
          await new Promise((r) => setTimeout(r, 1500));
        }
      }

      emit("progress", "sampling", "Hybrid: Phase 2 — full-loan discovery...");
      const fullLoanResult = await discoveryService.analyzeFieldPopulationViaFullLoans(
        tenantId,
        connectionId,
        {
          sampleSize: 30,
          emit: (type, phase, message) => emit(type as any, phase as any, message),
        },
      );

      const { fieldIdToJsonPath } = fullLoanResult;
      const pathPopMap = new Map<string, any>();
      for (const stat of fullLoanResult.populationStats) {
        pathPopMap.set(stat.fieldId, stat);
        pathPopMap.set(stat.fieldId.toLowerCase(), stat);
      }
      const enrichedStats: any[] = [...fullLoanResult.populationStats];
      const seenIds = new Set(fullLoanResult.populationStats.map((s: any) => s.fieldId));

      const addStat = (id: string, stat: any) => {
        if (!seenIds.has(id)) {
          seenIds.add(id);
          enrichedStats.push({ ...stat, fieldId: id });
        }
      };

      for (const [responseFieldId, jsonPath] of fieldIdToJsonPath) {
        const normalized = jsonPath
          .replace(/^\$\.?/, "")
          .replace(/\[(\d+)\]/g, ".$1");
        const stat = pathPopMap.get(normalized) || pathPopMap.get(normalized.toLowerCase());
        if (stat) {
          addStat(responseFieldId, stat);
          if (!responseFieldId.startsWith("Fields.") && !responseFieldId.startsWith("Loan.")) {
            addStat(`Fields.${responseFieldId}`, stat);
          }
          if (responseFieldId.startsWith("Fields.")) {
            addStat(responseFieldId.substring(7), stat);
          }
        }
      }

      const defaultToResponseId = new Map<string, string>();
      for (const defaultId of Object.values(DEFAULT_ENCOMPASS_FIELD_MAPPINGS)) {
        if (fieldIdToJsonPath.has(defaultId)) defaultToResponseId.set(defaultId, defaultId);
        else {
          const bare = defaultId.startsWith("Fields.") ? defaultId.substring(7) : null;
          if (bare && fieldIdToJsonPath.has(bare)) defaultToResponseId.set(defaultId, bare);
        }
      }
      for (const [, defaultId] of Object.entries(DEFAULT_ENCOMPASS_FIELD_MAPPINGS)) {
        const responseId = defaultToResponseId.get(defaultId);
        if (!responseId) continue;
        const jsonPath = fieldIdToJsonPath.get(responseId);
        if (!jsonPath) continue;
        const normalized = jsonPath.replace(/^\$\.?/, "").replace(/\[(\d+)\]/g, ".$1");
        const stat = pathPopMap.get(normalized) || pathPopMap.get(normalized.toLowerCase());
        if (stat) addStat(defaultId, stat);
      }

      const pipelineFieldIds = new Set(
        pipelineStats.map((s: any) => s.fieldId).concat(
          pipelineStats
            .filter((s: any) => s.fieldId.startsWith("Fields."))
            .map((s: any) => s.fieldId.substring(7)),
        ),
      );
      const missingDefaultIds = defaultFieldIds.filter((id) => {
        const bare = id.startsWith("Fields.") ? id.substring(7) : id;
        return !pipelineFieldIds.has(id) && !pipelineFieldIds.has(bare);
      });

      let fieldReaderStats: any[] = [];
      if (missingDefaultIds.length > 0) {
        emit("progress", "sampling", `Hybrid: Phase 3 — Field Reader for ${missingDefaultIds.length} missing default fields...`);
        try {
          const loanGuids = await discoveryService.getRecentLoanGuids(
            tenantId,
            connectionId,
            5,
          );
          if (loanGuids.length > 0) {
            fieldReaderStats = await discoveryService.getFieldPopulationViaFieldReader(
              tenantId,
              connectionId,
              loanGuids,
              missingDefaultIds,
            );
            for (const s of fieldReaderStats) {
              addStat(s.fieldId, s);
              if (s.fieldId.startsWith("Fields.")) addStat(s.fieldId.substring(7), s);
              else if (!["Loan.", "Borrower.", "CoBorrower.", "Property.", "CX.", "SubjectProperty."].some((p) => s.fieldId.startsWith(p))) {
                addStat(`Fields.${s.fieldId}`, s);
              }
            }
          }
        } catch (err: any) {
          console.warn(`[OnboardingAnalysis:Hybrid] Field Reader phase failed: ${err.message}`);
        }
      }

      // --- RDB detection via canonicalFields ---
      emit("progress", "sampling", "Checking Reporting Database field configuration...");
      const rdbMissing: RdbMissingField[] = [];
      try {
        const canonicalFields = await discoveryService.getCanonicalFields(tenantId, connectionId);
        const canonicalSet = new Set<string>();
        for (const cf of canonicalFields) {
          const cn = cf.canonicalName;
          canonicalSet.add(cn);
          canonicalSet.add(cn.toLowerCase());
          if (cn.startsWith("Fields.")) canonicalSet.add(cn.substring(7));
          else if (!cn.includes(".")) canonicalSet.add(`Fields.${cn}`);
        }

        const reverseAlias = new Map<string, string>();
        for (const [alias, fid] of Object.entries(DEFAULT_ENCOMPASS_FIELD_MAPPINGS)) {
          reverseAlias.set(fid, alias);
          if (fid.startsWith("Fields.")) reverseAlias.set(fid.substring(7), alias);
        }

        const fieldReaderMap = new Map<string, number>();
        for (const s of fieldReaderStats) {
          fieldReaderMap.set(s.fieldId, s.populationRate ?? 0);
          if (s.fieldId.startsWith("Fields.")) fieldReaderMap.set(s.fieldId.substring(7), s.populationRate ?? 0);
        }

        const enrichedMap = new Map<string, number>();
        for (const s of enrichedStats) {
          enrichedMap.set(s.fieldId, s.populationRate ?? 0);
        }

        for (const defaultId of defaultFieldIds) {
          const bare = defaultId.startsWith("Fields.") ? defaultId.substring(7) : defaultId;
          const inRdb = canonicalSet.has(defaultId) || canonicalSet.has(bare) || canonicalSet.has(defaultId.toLowerCase());
          if (inRdb) continue;

          const pStat = pipelineStats.find((s: any) => s.fieldId === defaultId || s.fieldId === bare);
          if (pStat && pStat.populationRate > 0) continue;

          const frPop = fieldReaderMap.get(defaultId) ?? fieldReaderMap.get(bare);
          const flPop = enrichedMap.get(defaultId) ?? enrichedMap.get(bare);
          const verifiedPop = frPop ?? flPop;

          const alias = reverseAlias.get(defaultId) ?? reverseAlias.get(bare);
          const desc = discoveryResult.discoveredFields.find(
            (f: any) => f.fieldId === defaultId || f.fieldId === bare,
          )?.description ?? defaultId;

          rdbMissing.push({
            fieldId: defaultId,
            coheusAlias: alias,
            description: desc,
            fieldReaderPopulation: verifiedPop,
            canonicalName: `Fields.${bare}`,
          });
        }

        if (rdbMissing.length > 0) {
          console.log(`[OnboardingAnalysis:Hybrid] ${rdbMissing.length} default fields NOT in RDB: ${rdbMissing.map((f) => f.fieldId).join(", ")}`);
        } else {
          console.log(`[OnboardingAnalysis:Hybrid] All default fields found in RDB canonical set (${canonicalSet.size} entries)`);
        }
      } catch (err: any) {
        console.warn(`[OnboardingAnalysis:Hybrid] Canonical fields check failed (non-fatal): ${err.message}`);
      }

      const mergedStats = [...enrichedStats, ...pipelineStats];
      const sampleSize = pipelineSampleSize || fullLoanResult.sampleSize;
      const fieldsWithData = mergedStats.filter((s: any) => s.populationRate > 0).length;
      analysisResult = {
        populationStats: mergedStats,
        sampleSize,
        analyzedAt: new Date(),
        fieldsWithData,
        fieldsWithoutData: mergedStats.length - fieldsWithData,
        rdbMissingFields: rdbMissing,
      };

      emit(
        "progress",
        "sampling",
        `Hybrid complete: ${pipelineStats.length} pipeline, ${enrichedStats.length} discovery, ${fieldReaderStats.length} Field Reader, ${rdbMissing.length} RDB-missing; ${sampleSize} loans`,
      );
    } else if (samplingStrategy === "fullLoan") {
      // -------------------------------------------------------------------
      // Full-Loan strategy: GET /v3/loans/{id} for complete loan objects
      // -------------------------------------------------------------------
      emit("progress", "sampling", "Using full-loan sampling (GET /v3/loans)...");

      const fullLoanResult = await discoveryService.analyzeFieldPopulationViaFullLoans(
        tenantId,
        connectionId,
        {
          sampleSize: 30,
          emit: (type, phase, message) => emit(type as any, phase as any, message),
        }
      );

      // The v3 standard field schema endpoint provides jsonPath for each field ID,
      // allowing us to bridge between:
      //   - Default mapping field IDs (e.g., "Fields.2", "Fields.353")
      //   - JSON paths in the loan objects (e.g., "baseLoanAmount", "ltv")
      // Use the fieldIdToJsonPath map from the discovery result to enrich
      // the population stats so the popMap can be queried by field ID.
      const { fieldIdToJsonPath } = fullLoanResult;

      console.log(
        `[OnboardingAnalysis:FullLoan] fieldIdToJsonPath: ${fieldIdToJsonPath.size} mappings`
      );

      // Build a reverse lookup: normalized jsonPath → population stat
      const pathPopMap = new Map<string, any>();
      for (const stat of fullLoanResult.populationStats) {
        pathPopMap.set(stat.fieldId, stat);
        pathPopMap.set(stat.fieldId.toLowerCase(), stat);
      }

      // Enrich population stats: for each default field ID that has a
      // resolved jsonPath, create alias entries in the stats so the popMap
      // (built later) can be queried by "Fields.2", "2", "Loan.LoanFolder", etc.
      const enrichedStats: any[] = [...fullLoanResult.populationStats];
      const seenIds = new Set(fullLoanResult.populationStats.map((s: any) => s.fieldId));
      let mappedCount = 0;

      // Build a reverse map from the default config: defaultFieldId → response fieldId
      // so we can bridge config IDs like "Fields.2" to whatever the API returned.
      const defaultToResponseId = new Map<string, string>();
      for (const defaultId of Object.values(DEFAULT_ENCOMPASS_FIELD_MAPPINGS)) {
        // The API might have been queried with "Fields.2" but responded with fieldId "2"
        if (fieldIdToJsonPath.has(defaultId)) {
          defaultToResponseId.set(defaultId, defaultId);
        } else {
          // Try bare version
          const bare = defaultId.startsWith("Fields.") ? defaultId.substring(7) : null;
          if (bare && fieldIdToJsonPath.has(bare)) {
            defaultToResponseId.set(defaultId, bare);
          }
        }
      }

      const addStat = (id: string, stat: any) => {
        if (!seenIds.has(id)) {
          seenIds.add(id);
          enrichedStats.push({ ...stat, fieldId: id });
        }
      };

      for (const [responseFieldId, jsonPath] of fieldIdToJsonPath) {
        // Normalize the jsonPath: remove "$." prefix, convert [N] → .N
        const normalized = jsonPath
          .replace(/^\$\.?/, "")
          .replace(/\[(\d+)\]/g, ".$1");

        const stat = pathPopMap.get(normalized) || pathPopMap.get(normalized.toLowerCase());
        if (stat) {
          mappedCount++;
          // Index under the raw response field ID
          addStat(responseFieldId, stat);
          // Index under "Fields.{responseFieldId}" if not already prefixed
          if (!responseFieldId.startsWith("Fields.") && !responseFieldId.startsWith("Loan.")) {
            addStat(`Fields.${responseFieldId}`, stat);
          }
          // Index under bare form (strip "Fields." prefix)
          if (responseFieldId.startsWith("Fields.")) {
            addStat(responseFieldId.substring(7), stat);
          }
        }
      }

      // Also ensure every DEFAULT_ENCOMPASS_FIELD_MAPPINGS key is reachable
      for (const [, defaultId] of Object.entries(DEFAULT_ENCOMPASS_FIELD_MAPPINGS)) {
        const responseId = defaultToResponseId.get(defaultId);
        if (!responseId) continue;
        const jsonPath = fieldIdToJsonPath.get(responseId);
        if (!jsonPath) continue;
        const normalized = jsonPath.replace(/^\$\.?/, "").replace(/\[(\d+)\]/g, ".$1");
        const stat = pathPopMap.get(normalized) || pathPopMap.get(normalized.toLowerCase());
        if (stat) {
          addStat(defaultId, stat);
        }
      }

      console.log(
        `[OnboardingAnalysis:FullLoan] Enriched: ${mappedCount} field IDs bridged to JSON paths (${enrichedStats.length} total stat entries)`
      );

      analysisResult = {
        populationStats: enrichedStats,
        sampleSize: fullLoanResult.sampleSize,
        analyzedAt: fullLoanResult.analyzedAt,
        fieldsWithData: fullLoanResult.fieldsWithData,
        fieldsWithoutData: fullLoanResult.fieldsWithoutData,
        rdbMissingFields: [],
      };

      emit(
        "progress",
        "sampling",
        `Full-loan sampling: ${analysisResult.sampleSize} loans, ${mappedCount}/${fieldIdToJsonPath.size} field IDs bridged, ${enrichedStats.length} total entries`
      );
    } else {
      // -------------------------------------------------------------------
      // Pipeline strategy (default): batched POST /v3/loanPipeline calls
      // -------------------------------------------------------------------

      // Collect bare IDs for all default mappings FIRST so they land in batch 1
      // and are guaranteed to be sampled even if later batches fail (409 / timeout).
      const defaultBareIds = new Set<string>();
      for (const fieldId of Object.values(DEFAULT_ENCOMPASS_FIELD_MAPPINGS)) {
        const bare = fieldId.startsWith("Fields.") ? fieldId.substring(7) : fieldId;
        if (!isBorrowerPiiField(bare)) defaultBareIds.add(bare);
      }

      const discoveredIds = new Set(
        discoveryResult.discoveredFields.map((f) => f.fieldId)
      );
      for (const bare of defaultBareIds) {
        discoveredIds.add(bare);
      }

      const remainingIds = [...discoveredIds]
        .filter((id) => !isBorrowerPiiField(id) && !defaultBareIds.has(id));
      const allFieldIds = [...defaultBareIds, ...remainingIds];

      const BATCH_SIZE = 300;
      const totalBatches = Math.ceil(allFieldIds.length / BATCH_SIZE);
      const allStats: any[] = [];
      let sampleSize = 0;

      for (let i = 0; i < allFieldIds.length; i += BATCH_SIZE) {
        const batch = allFieldIds.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        emit(
          "progress",
          "sampling",
          `Sampling batch ${batchNum}/${totalBatches} (${batch.length} fields)...`
        );

        try {
          const batchResult = await discoveryService.analyzeFieldPopulation(
            tenantId,
            connectionId,
            { sampleSize: 200, fieldsToAnalyze: batch }
          );
          allStats.push(...batchResult.populationStats);
          sampleSize = batchResult.sampleSize;
        } catch (err: any) {
          console.warn(
            `[OnboardingAnalysis] Batch ${batchNum}/${totalBatches} failed: ${err.message}`
          );
        }

        if (i + BATCH_SIZE < allFieldIds.length) {
          await new Promise((r) => setTimeout(r, 1500));
        }
      }

      // Check whether any default mapping fields were lost to failed batches
      const sampledFieldIds = new Set(allStats.map((s: any) => s.fieldId));
      const missingDefaults = [...defaultBareIds].filter(
        (id) => !sampledFieldIds.has(id)
      );
      if (missingDefaults.length > 0) {
        console.warn(
          `[OnboardingAnalysis] ${missingDefaults.length} default fields missing after batch sampling — retrying: ${missingDefaults.slice(0, 10).join(", ")}${missingDefaults.length > 10 ? "..." : ""}`
        );
        emit("progress", "sampling", `Retrying ${missingDefaults.length} default fields...`);
        try {
          const retryResult = await discoveryService.analyzeFieldPopulation(
            tenantId,
            connectionId,
            { sampleSize: 200, fieldsToAnalyze: missingDefaults }
          );
          allStats.push(...retryResult.populationStats);
          if (!sampleSize) sampleSize = retryResult.sampleSize;
        } catch (err: any) {
          console.error(
            `[OnboardingAnalysis] Retry for default fields also failed: ${err.message}`
          );
        }
      }

      const fieldsWithData = allStats.filter(
        (s: any) => s.populationRate > 0
      ).length;
      analysisResult = {
        populationStats: allStats,
        sampleSize,
        analyzedAt: new Date(),
        fieldsWithData,
        fieldsWithoutData: allStats.length - fieldsWithData,
        rdbMissingFields: [],
      };

      emit(
        "progress",
        "sampling",
        `Analyzed ${analysisResult.sampleSize} loans — ${fieldsWithData}/${allFieldIds.length} fields have data`
      );
    }

    // Also query the loans table for a quick data profile
    let dataProfile = "";
    try {
      const profileResult = await safeExecuteSQL(
        `SELECT
           COUNT(*) as total_loans,
           COUNT(DISTINCT loan_officer) as unique_los,
           MIN(application_date) as earliest_app,
           MAX(application_date) as latest_app,
           COUNT(CASE WHEN current_loan_status = 'Active Loan' THEN 1 END) as active_loans
         FROM public.loans`,
        tenantPool
      );
      dataProfile = formatResultsForLLM(profileResult);
    } catch {
      dataProfile = "(Could not query loans table profile)";
    }

    // Phase 3: Analyzing — build context for LLM
    emit("phase", "analyzing", "Building analysis context for AI...");

    // The Encompass field definitions API returns bare IDs ("353", "VASUMM.X23")
    // but our default mappings use "Fields."-prefixed IDs ("Fields.353", "Fields.VASUMM.X23").
    // Canonical names (Loan.*, Borrower.*, CX.*) never get the prefix — only RDB fields do.
    // Index every stat under both formats so downstream lookups always resolve.
    const CANONICAL_PREFIXES = ["Loan.", "Borrower.", "CoBorrower.", "Property.", "CX.", "SubjectProperty."];
    const isCanonical = (id: string) => CANONICAL_PREFIXES.some((p) => id.startsWith(p));

    const popMap = new Map<string, any>();
    for (const p of analysisResult.populationStats as any[]) {
      popMap.set(p.fieldId, p);
      if (p.fieldId.startsWith("Fields.")) {
        popMap.set(p.fieldId.substring(7), p);
      } else if (!isCanonical(p.fieldId)) {
        popMap.set(`Fields.${p.fieldId}`, p);
      }
    }

    // Verify default mapping fields are in the popMap
    const missingFromPop: string[] = [];
    for (const [alias, defaultId] of Object.entries(DEFAULT_ENCOMPASS_FIELD_MAPPINGS)) {
      if (!popMap.has(defaultId)) {
        const bare = defaultId.startsWith("Fields.") ? defaultId.substring(7) : defaultId;
        const hasBare = popMap.has(bare);
        missingFromPop.push(`${alias}=${defaultId} (bare=${bare}, hasBare=${hasBare})`);
      }
    }
    if (missingFromPop.length > 0) {
      console.warn(`[OnboardingAnalysis] ${missingFromPop.length} default fields NOT in popMap: ${missingFromPop.join("; ")}`);
    } else {
      console.log(`[OnboardingAnalysis] All ${Object.keys(DEFAULT_ENCOMPASS_FIELD_MAPPINGS).length} default mapping fields found in popMap ✓`);
    }

    const coheusAliases = buildAliasContext();
    const fieldContext = buildFieldContext(
      discoveryResult.discoveredFields as any[],
      popMap
    );

    // Fetch current active field swaps so the LLM knows what's already mapped
    const currentSwapsContext = await buildCurrentSwapsContext(
      tenantPool,
      connectionId
    );

    // Check population of currently-mapped fields from the actual loans table
    const currentPopulationContext = await buildCurrentPopulationContext(
      tenantPool
    );

    // Cross-reference default mappings against sample population to flag problems
    const rdbMissingSet = new Set(analysisResult.rdbMissingFields.map((f) => f.fieldId));
    const defaultFieldHealthContext = buildDefaultFieldHealthContext(popMap, rdbMissingSet);

    // Phase 4: Matching — split into two parallel LLM calls so neither hits
    // token limits. Pass 1 handles field matching + quality flags; Pass 2
    // handles revenue detection + additional field suggestions.
    emit("phase", "matching", "Running AI-powered semantic field matching...");
    const apiKey = await getOpenAIKey(tenantId);

    const sharedContext = [
      `## Coheus Alias Definitions (fields we need to map)\n${coheusAliases}`,
      `\n## Current Active Field Mappings (defaults + tenant swaps)\n${currentSwapsContext}`,
      `\n## Current Field Population in Loans Table\n${currentPopulationContext}`,
      `\n## Default Mapping Health Check (from Encompass sample)\n${defaultFieldHealthContext}`,
      `\n## Available Encompass Fields with Population Stats\n${fieldContext}`,
      `\n## Tenant Data Profile\n${dataProfile}`,
    ].join("\n");

    // --- Pass 1: Field Swaps + Data Quality ---
    const pass1Messages: LLMMessage[] = [
      { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          sharedContext,
          `\nFocus on FIELD SWAP RECOMMENDATIONS and DATA QUALITY FLAGS only.`,
          `- For every field in the health check marked "NEEDS SWAP" or "NOT in sample", recommend a swap if a better alternative exists.`,
          `- Do NOT recommend swapping fields marked "NOT IN RDB" — these need to be added to the Encompass Reporting Database by the admin, not swapped to a different field.`,
          `- Do NOT recommend swapping fields that are already well-populated and correctly mapped.`,
          `- Each Encompass field ID should only map to one Coheus alias.`,
          `- Flag data quality concerns (low population on critical fields, suspicious distributions, etc.)`,
          `\nRespond with JSON: { "fieldSwapRecommendations": [...], "dataQualityFlags": [...], "summary": "..." }`,
        ].join("\n"),
      },
    ];

    // --- Pass 2: Revenue Detection + Additional Fields ---
    const pass2Messages: LLMMessage[] = [
      { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          sharedContext,
          `\nFocus on REVENUE FIELD DETECTION and SUGGESTED ADDITIONAL FIELDS only.`,
          `- Identify all fields that look like revenue/profitability components (base price, fees, credits, SRP, margin, etc.)`,
          `- Suggest valuable custom fields (CX.*) and other well-populated fields worth adding as analytics dimensions.`,
          `\nRespond with JSON: { "revenueFieldCandidates": [...], "suggestedAdditionalFields": [...] }`,
        ].join("\n"),
      },
    ];

    const llmOpts = { temperature: 0.2, maxTokens: 16000, jsonMode: true };
    const [rawPass1, rawPass2] = await Promise.all([
      callLLM(pass1Messages, apiKey, llmOpts),
      callLLM(pass2Messages, apiKey, llmOpts),
    ]);

    // Phase 5: Quality check — parse and merge
    emit("phase", "quality_check", "Validating analysis results...");

    let analysis: OnboardingAnalysis;
    try {
      const p1 = JSON.parse(rawPass1);
      const p2 = JSON.parse(rawPass2);

      analysis = {
        fieldSwapRecommendations: (p1.fieldSwapRecommendations || []).map(
          (r: any) => ({
            coheusAlias: r.coheusAlias || "",
            recommendedFieldId: r.recommendedFieldId || "",
            confidence: Math.min(100, Math.max(0, Number(r.confidence) || 0)),
            reasoning: r.reasoning || "",
            currentPopulation: Number(r.currentPopulation) || 0,
            sampleValues: Array.isArray(r.sampleValues)
              ? r.sampleValues.slice(0, 5)
              : [],
          })
        ),
        revenueFieldCandidates: (p2.revenueFieldCandidates || []).map(
          (r: any) => ({
            fieldId: r.fieldId || "",
            fieldDescription: r.fieldDescription || "",
            detectedRole: ["base_price", "fee", "credit", "other"].includes(
              r.detectedRole
            )
              ? r.detectedRole
              : "other",
            populationRate: Number(r.populationRate) || 0,
          })
        ),
        suggestedAdditionalFields: (p2.suggestedAdditionalFields || []).map(
          (r: any) => ({
            fieldId: r.fieldId || "",
            description: r.description || "",
            populationRate: Number(r.populationRate) || 0,
            reason: r.reason || "",
          })
        ),
        dataQualityFlags: (p1.dataQualityFlags || []).map((r: any) => ({
          field: r.field || "",
          issue: r.issue || "",
          severity: ["critical", "warning", "info"].includes(r.severity)
            ? r.severity
            : "info",
          recommendation: r.recommendation || "",
        })),
        rdbMissingFields: analysisResult.rdbMissingFields,
        summary: p1.summary || "Analysis complete.",
      };
    } catch (parseErr: any) {
      console.error("[OnboardingAnalysis] Failed to parse LLM response:", parseErr.message);
      throw new Error("Failed to parse analysis results from AI. Please try again.");
    }

    // Complete
    emit("phase", "complete", "Analysis complete!", analysis);
    emit("result", undefined, undefined, analysis);

    return analysis;
  } catch (err: any) {
    emit("phase", "error", err.message);
    emit("error", undefined, err.message);
    throw err;
  }
}

// ============================================================================
// Context Builders
// ============================================================================

function buildAliasContext(): string {
  const bare = (id: string) => id.startsWith("Fields.") ? id.substring(7) : id;
  const lines: string[] = [];
  const categories = Object.entries(FIELD_CATEGORIES).sort(
    ([, a], [, b]) => a.order - b.order
  );

  for (const [cat, info] of categories) {
    lines.push(`\n### ${info.label} (${info.description})`);

    const aliasesInCat = Object.entries(FIELD_CATEGORY_MAP)
      .filter(([, c]) => c === cat)
      .map(([alias]) => alias);

    for (const alias of aliasesInCat) {
      const defaultId = DEFAULT_ENCOMPASS_FIELD_MAPPINGS[alias] || "?";
      lines.push(`- "${alias}" → default: ${bare(defaultId)}`);
    }
  }

  return lines.join("\n");
}

function buildFieldContext(
  discoveredFields: Array<{
    fieldId: string;
    description: string;
    format?: string;
    isCustom: boolean;
  }>,
  popMap: Map<string, any>
): string {

  const lines: string[] = [];
  let shown = 0;

  // Prioritize fields with population data, limit total context
  const sorted = [...discoveredFields].sort((a, b) => {
    const popA = popMap.get(a.fieldId)?.populationRate ?? -1;
    const popB = popMap.get(b.fieldId)?.populationRate ?? -1;
    return popB - popA;
  });

  for (const field of sorted) {
    if (shown >= 800) break;
    const pop = popMap.get(field.fieldId);
    const parts = [
      `${field.fieldId}: "${field.description || "(no description)"}"`,
    ];
    if (field.format) parts.push(`format=${field.format}`);
    if (field.isCustom) parts.push("(custom)");
    if (pop) {
      parts.push(`pop=${pop.populationRate.toFixed(0)}%`);
      if (pop.sampleValues.length > 0) {
        parts.push(
          `samples=[${pop.sampleValues.slice(0, 3).map((v) => `"${v}"`).join(", ")}]`
        );
      }
      if (pop.detectedFormat) parts.push(`type=${pop.detectedFormat}`);
    }
    lines.push(parts.join(" | "));
    shown++;
  }

  return lines.join("\n");
}

/**
 * Cross-reference every default field mapping against the Encompass sample population.
 * Explicitly tells the LLM which defaults are healthy vs. need a swap.
 */
function buildDefaultFieldHealthContext(
  popMap: Map<string, { populationRate: number; sampleValues: string[] }>,
  rdbMissingFieldIds?: Set<string>,
): string {
  const bare = (id: string) => id.startsWith("Fields.") ? id.substring(7) : id;
  const healthy: string[] = [];
  const needsSwap: string[] = [];
  const notSampled: string[] = [];
  const notInRdb: string[] = [];

  for (const [alias, defaultId] of Object.entries(DEFAULT_ENCOMPASS_FIELD_MAPPINGS)) {
    const pop = popMap.get(defaultId);
    const displayId = bare(defaultId);

    if (rdbMissingFieldIds?.has(defaultId)) {
      notInRdb.push(`- "${alias}" → ${displayId} — NOT IN RDB (field exists on loans but is not in the Reporting Database; needs RDB config, not a swap)`);
      continue;
    }

    if (!pop) {
      console.warn(`[HealthCheck] "${alias}" (${defaultId}) NOT in popMap — keys checked: "${defaultId}", "${bare(defaultId)}". popMap size=${popMap.size}`);
      notSampled.push(`- "${alias}" → ${displayId} — NOT in sample (field may not exist in this instance)`);
    } else if (pop.populationRate < 10) {
      const samples = pop.sampleValues.length > 0
        ? ` samples=[${pop.sampleValues.slice(0, 2).map(v => `"${v}"`).join(", ")}]`
        : "";
      needsSwap.push(`- "${alias}" → ${displayId} — pop=${pop.populationRate.toFixed(0)}%${samples} ⚠ NEEDS SWAP`);
    } else {
      healthy.push(`- "${alias}" → ${displayId} — pop=${pop.populationRate.toFixed(0)}% ✓`);
    }
  }

  const lines: string[] = [];
  if (notInRdb.length > 0) {
    lines.push(`### Fields NOT IN RDB (${notInRdb.length} — need to be added to Encompass Reporting Database, do NOT recommend a swap for these):`);
    lines.push(...notInRdb);
  }
  if (needsSwap.length > 0) {
    lines.push(`\n### Fields that NEED a swap (${needsSwap.length} — low or zero population):`);
    lines.push(...needsSwap);
  }
  if (notSampled.length > 0) {
    lines.push(`\n### Fields NOT found in sample (${notSampled.length} — may not exist):`);
    lines.push(...notSampled);
  }
  if (healthy.length > 0) {
    lines.push(`\n### Healthy fields (${healthy.length} — do NOT swap these):`);
    lines.push(...healthy);
  }

  return lines.join("\n");
}

/**
 * Fetch current active field swaps and merge with defaults to show what's currently mapped.
 */
async function buildCurrentSwapsContext(
  tenantPool: pg.Pool,
  connectionId: string
): Promise<string> {
  const swaps = new Map<string, string>();

  try {
    const result = await tenantPool.query(
      `SELECT coheus_alias, encompass_field_id
       FROM public.encompass_field_swaps
       WHERE los_connection_id = $1 AND is_active = TRUE`,
      [connectionId]
    );
    for (const row of result.rows) {
      swaps.set(row.coheus_alias, row.encompass_field_id);
    }
  } catch {
    // Table may not exist yet
  }

  // Strip "Fields." prefix for display so IDs match the available-fields section format
  const bare = (id: string) => id.startsWith("Fields.") ? id.substring(7) : id;

  const lines: string[] = [
    "Each line shows: Alias → currently mapped Encompass field (source)",
    "If a tenant swap exists it overrides the default.",
    "",
  ];

  for (const [alias, defaultId] of Object.entries(DEFAULT_ENCOMPASS_FIELD_MAPPINGS)) {
    const swapId = swaps.get(alias);
    if (swapId && swapId !== defaultId) {
      lines.push(`"${alias}" → ${bare(swapId)} (tenant swap, default was ${bare(defaultId)})`);
    } else {
      lines.push(`"${alias}" → ${bare(defaultId)} (default)`);
    }
  }

  if (swaps.size > 0) {
    lines.unshift(`(${swaps.size} tenant-specific swap(s) active)\n`);
  }

  return lines.join("\n");
}

/**
 * Check population of key fields in the actual loans table so the LLM knows what's working.
 */
async function buildCurrentPopulationContext(
  tenantPool: pg.Pool
): Promise<string> {
  try {
    const result = await safeExecuteSQL(
      `SELECT
         COUNT(*) as total,
         COUNT(loan_amount) as loan_amount_pop,
         COUNT(interest_rate) as interest_rate_pop,
         COUNT(loan_term) as loan_term_pop,
         COUNT(base_loan_amount) as base_loan_amount_pop,
         COUNT(application_date) as app_date_pop,
         COUNT(closing_date) as closing_date_pop,
         COUNT(funding_date) as funding_date_pop,
         COUNT(loan_officer) as lo_pop,
         COUNT(current_loan_status) as status_pop,
         COUNT(fico_score) as fico_pop,
         COUNT(lock_date) as lock_date_pop,
         COUNT(rate_lock_buy_side_base_price_rate) as buy_price_pop,
         COUNT(ctc_date) as ctc_pop,
         COUNT(loan_purpose) as purpose_pop,
         COUNT(property_type) as prop_type_pop,
         COUNT(channel) as channel_pop
       FROM public.loans`,
      tenantPool
    );

    if (result.rows.length === 0) return "(No loans data)";

    const row = result.rows[0];
    const total = Number(row.total) || 1;
    const pct = (field: string) =>
      `${((Number(row[field]) / total) * 100).toFixed(0)}%`;

    return [
      `Total loans: ${total}`,
      `loan_amount: ${pct("loan_amount_pop")} populated`,
      `base_loan_amount: ${pct("base_loan_amount_pop")} populated`,
      `interest_rate: ${pct("interest_rate_pop")} populated`,
      `loan_term: ${pct("loan_term_pop")} populated`,
      `application_date: ${pct("app_date_pop")} populated`,
      `closing_date: ${pct("closing_date_pop")} populated`,
      `funding_date: ${pct("funding_date_pop")} populated`,
      `loan_officer: ${pct("lo_pop")} populated`,
      `current_loan_status: ${pct("status_pop")} populated`,
      `fico_score: ${pct("fico_pop")} populated`,
      `lock_date: ${pct("lock_date_pop")} populated`,
      `rate_lock_buy_side_base_price_rate: ${pct("buy_price_pop")} populated`,
      `ctc_date: ${pct("ctc_pop")} populated`,
      `loan_purpose: ${pct("purpose_pop")} populated`,
      `property_type: ${pct("prop_type_pop")} populated`,
      `channel: ${pct("channel_pop")} populated`,
    ].join("\n");
  } catch {
    return "(Could not query current field population)";
  }
}

/**
 * Check whether an Encompass field ID refers to borrower PII that we should
 * NOT pull during onboarding discovery (SSN, DOB, full name, email, phone,
 * address of borrower/co-borrower — NOT property address which is fine).
 *
 * Fields like "Borrower Self Employed" or "Borrower Marital Status" are
 * non-PII demographic/qualification fields and are allowed.
 */
const PII_FIELD_PATTERNS = [
  /^Fields\.(?:36|4000|4001|4002|4003|4004|65|66|97)$/i,  // SSN fields
  /^Fields\.(?:1402|1268)$/i,                               // DOB fields
  /^Borrower\./i,                                           // Borrower canonical names (name, address, etc.)
  /^CoBorrower\./i,                                         // Co-borrower canonical names
  /ssn/i,
  /social.?sec/i,
  /date.?of.?birth/i,
  /\bdob\b/i,
  /borrower.?email/i,
  /borrower.?phone/i,
  /borrower.?cell/i,
  /borrower.?home.?phone/i,
  /borrower.?work.?phone/i,
  /^Fields\.(?:1240|1241|1242|URLA\.X198|URLA\.X199)$/i,   // Borrower email/phone IDs
];

function isBorrowerPiiField(fieldId: string): boolean {
  return PII_FIELD_PATTERNS.some((pattern) => pattern.test(fieldId));
}
