/**
 * Tenant Duplication Service
 * Duplicates a tenant database with anonymized personnel names and branch numbers.
 * Creates a new tenant, copies configuration and loan/employee data,
 * and replaces PII with pseudonyms.
 */

import pg from "pg";
import { pool as managementPool } from "../config/managementDatabase.js";
import { decryptField } from "./encryption.js";
import {
  createTenant,
  getTenant,
  updateTenantStatus,
  TenantInfo,
} from "./tenantProvisioningService.js";

const { Pool } = pg;

// ── In-progress lock to prevent concurrent duplications of the same slug ──
const inProgressSlugs = new Set<string>();

// ── Name pools (matches anonymization migration) ──────────────────────

const FAKE_FIRST_NAMES = [
  "Michael", "Sarah", "David", "Jennifer", "Robert", "Emily", "James", "Amanda",
  "William", "Jessica", "Richard", "Ashley", "Joseph", "Stephanie", "Thomas", "Nicole",
  "Christopher", "Elizabeth", "Daniel", "Melissa", "Matthew", "Michelle", "Anthony", "Laura",
  "Mark", "Kimberly", "Steven", "Rebecca", "Paul", "Rachel", "Andrew", "Heather",
  "Joshua", "Amy", "Kenneth", "Angela", "Kevin", "Megan", "Brian", "Christina",
  "George", "Samantha", "Timothy", "Katherine", "Ronald", "Lisa", "Edward", "Nancy",
  "Jason", "Karen",
];

const FAKE_LAST_NAMES = [
  "Johnson", "Williams", "Brown", "Davis", "Miller", "Wilson", "Moore", "Taylor",
  "Anderson", "Thomas", "Jackson", "White", "Harris", "Martin", "Thompson", "Garcia",
  "Martinez", "Robinson", "Clark", "Rodriguez", "Lewis", "Lee", "Walker", "Hall",
  "Allen", "Young", "Hernandez", "King", "Wright", "Lopez", "Hill", "Scott",
  "Green", "Adams", "Baker", "Gonzalez", "Nelson", "Carter", "Mitchell", "Perez",
  "Roberts", "Turner", "Phillips", "Campbell", "Parker", "Evans", "Edwards", "Collins",
  "Stewart", "Morris",
];

// ── Anonymization mapping types ───────────────────────────────────────

export interface AnonymizationMappings {
  /** Maps original full name -> pseudonym full name */
  nameMap: Map<string, string>;
  /** Maps original first name -> pseudonym first name (for employees) */
  firstNameMap: Map<string, string>;
  /** Maps original last name -> pseudonym last name (for employees) */
  lastNameMap: Map<string, string>;
  /** Maps original branch -> anonymized branch */
  branchMap: Map<string, string>;
  /** Maps original orgid -> anonymized orgid */
  orgIdMap: Map<string, string>;
  /** Maps original employee_id -> anonymized employee_id */
  employeeIdMap: Map<string, string>;
  /** Maps original email -> anonymized email */
  emailMap: Map<string, string>;
  /** Maps original *_id fields (loan_officer_id, etc.) -> anonymized ID */
  personnelIdMap: Map<string, string>;
}

// ── Config tables that get copied verbatim ────────────────────────────
// Note: encompass_field_swaps is excluded because it has a FK to
// los_connections, which we intentionally skip (contains LOS credentials).

export const CONFIG_TABLES = [
  "personas",
  "custom_fields",
  // "range_rules" removed – dropped by migration 010_remove_range_rules
  "scoring_weights",
  "staffing_unit_targets",
  "tenant_calculations",
  "complexity_components",
  "tenant_roles",
  "role_field_filters",
];

// Loan-related data tables copied as-is (no PII)
export const LOAN_DATA_TABLES = [
  "loan_predictions",
  "ai_pattern_learnings",
  "historical_loan_bucket_cache",
  "bucket_thresholds_cache",
  "historical_bucket_totals",
  "historical_bucket_combos",
  "risk_band_definitions",
  "turn_time_baselines",
  "human_pattern_stats",
  "categorical_risk_definitions",
  "persistent_top_patterns",
  "outcome_numeric_risk_profiles",
];

// Batch size for loan copying
const BATCH_SIZE = 1000;

// ── Helper: get columns that exist in both source and destination ─────

interface CommonColumnsResult {
  columns: string[];
  /** Set of column names that are json/jsonb type (need JSON.stringify before insert) */
  jsonbColumns: Set<string>;
}

async function getCommonColumns(
  srcPool: pg.Pool,
  dstPool: pg.Pool,
  table: string
): Promise<CommonColumnsResult> {
  const colQuery = `
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `;
  const [srcResult, dstResult] = await Promise.all([
    srcPool.query(colQuery, [table]),
    dstPool.query(colQuery, [table]),
  ]);

  const srcCols = new Set(srcResult.rows.map((r: any) => r.column_name as string));
  const dstCols = new Set(dstResult.rows.map((r: any) => r.column_name as string));

  // Build a map of destination column types for the common columns
  const dstTypeMap = new Map<string, string>(
    dstResult.rows.map((r: any) => [r.column_name as string, r.data_type as string])
  );

  // Intersection: only columns present in both
  const columns = [...srcCols].filter((c) => dstCols.has(c));

  // Identify json/jsonb columns (these need JSON.stringify; Postgres array columns do NOT)
  const jsonbColumns = new Set<string>(
    columns.filter((c) => {
      const dt = dstTypeMap.get(c) || "";
      return dt === "jsonb" || dt === "json";
    })
  );

  if (srcCols.size !== dstCols.size) {
    const srcOnly = [...srcCols].filter((c) => !dstCols.has(c));
    const dstOnly = [...dstCols].filter((c) => !srcCols.has(c));
    if (srcOnly.length > 0) {
      console.log(`[TenantDuplication] ${table}: ${srcOnly.length} source-only columns skipped: ${srcOnly.slice(0, 5).join(", ")}${srcOnly.length > 5 ? "..." : ""}`);
    }
    if (dstOnly.length > 0) {
      console.log(`[TenantDuplication] ${table}: ${dstOnly.length} destination-only columns (empty): ${dstOnly.slice(0, 5).join(", ")}${dstOnly.length > 5 ? "..." : ""}`);
    }
  }

  return { columns, jsonbColumns };
}

/** Serialize a row value for insertion. JSONB columns need JSON.stringify; everything else is passed as-is. */
function serializeValue(value: any, colName: string, jsonbColumns: Set<string>): any {
  if (value === null || value === undefined) return value;
  if (jsonbColumns.has(colName) && typeof value === "object") {
    return JSON.stringify(value);
  }
  return value;
}

// ── Helper: get a pool to a tenant's database ─────────────────────────

export async function getTenantPoolById(tenantId: string): Promise<{ pool: pg.Pool; cleanup: () => Promise<void> }> {
  const result = await managementPool.query(
    `SELECT database_name, database_host, database_port,
            database_user, database_password_encrypted
     FROM coheus_tenants WHERE id = $1`,
    [tenantId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Tenant ${tenantId} not found`);
  }

  const row = result.rows[0];
  const password =
    (await decryptField(row.database_password_encrypted)) ||
    row.database_password_encrypted;

  const isLocal =
    row.database_host === "localhost" || row.database_host === "127.0.0.1";

  const pool = new Pool({
    host: row.database_host,
    port: row.database_port,
    database: row.database_name,
    user: row.database_user,
    password,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });

  return { pool, cleanup: () => pool.end() };
}

// ── Pseudonym generation ──────────────────────────────────────────────

function generatePseudonym(index: number): { first: string; last: string; full: string } {
  // Cycle through all first/last combinations (50×50 = 2,500 unique names)
  // before any repetition occurs
  const first = FAKE_FIRST_NAMES[index % FAKE_FIRST_NAMES.length];
  const last = FAKE_LAST_NAMES[Math.floor(index / FAKE_FIRST_NAMES.length) % FAKE_LAST_NAMES.length];
  return {
    first,
    last,
    full: `${first} ${last}`,
  };
}

// ── Build anonymization mappings ──────────────────────────────────────

export async function buildAnonymizationMappings(
  srcPool: pg.Pool
): Promise<AnonymizationMappings> {
  const nameMap = new Map<string, string>();
  const firstNameMap = new Map<string, string>();
  const lastNameMap = new Map<string, string>();
  const branchMap = new Map<string, string>();
  const orgIdMap = new Map<string, string>();
  const employeeIdMap = new Map<string, string>();
  const emailMap = new Map<string, string>();
  const personnelIdMap = new Map<string, string>();

  let nameCounter = 0;

  // Helper to register a name and return its pseudonym
  const getOrCreateNameMapping = (fullName: string): string => {
    const normalized = fullName.trim();
    if (!normalized) return "";
    const existing = nameMap.get(normalized);
    if (existing) return existing;
    const pseudo = generatePseudonym(nameCounter++);
    nameMap.set(normalized, pseudo.full);
    return pseudo.full;
  };

  // 1. Scan employees for unique names, branches, IDs
  console.log("[TenantDuplication] Scanning employees for anonymization mappings...");
  const employees = await srcPool.query(
    `SELECT DISTINCT first_name, last_name, email, employee_id, branch
     FROM public.employees`
  );

  for (const emp of employees.rows) {
    const fullName = `${emp.first_name || ""} ${emp.last_name || ""}`.trim();
    if (fullName) {
      const normalized = fullName;
      if (!nameMap.has(normalized)) {
        const pseudo = generatePseudonym(nameCounter++);
        nameMap.set(normalized, pseudo.full);
        firstNameMap.set(emp.first_name || "", pseudo.first);
        lastNameMap.set(emp.last_name || "", pseudo.last);
      }
    }

    if (emp.email && !emailMap.has(emp.email)) {
      const pseudo = generatePseudonym(emailMap.size);
      emailMap.set(emp.email, `${pseudo.first.toLowerCase()}.${pseudo.last.toLowerCase().replace(/\s+/g, "")}@example.com`);
    }

    if (emp.employee_id && !employeeIdMap.has(emp.employee_id)) {
      employeeIdMap.set(emp.employee_id, `EMP-${String(employeeIdMap.size + 1).padStart(3, "0")}`);
    }

    if (emp.branch && !branchMap.has(emp.branch)) {
      branchMap.set(emp.branch, `Branch ${String(branchMap.size + 1).padStart(3, "0")}`);
    }
  }

  // 2. Scan loans for additional unique personnel names, branches, IDs
  console.log("[TenantDuplication] Scanning loans for additional anonymization mappings...");

  const personnelNameCols = [
    "loan_officer", "processor", "underwriter", "closer",
    "loan_interviewer", "account_executive",
  ];
  const personnelIdCols = [
    "loan_officer_id", "legacy_loan_officer_id", "loan_processor_id",
    "underwriter_id", "closer_id",
  ];

  // Get distinct personnel names from loans
  for (const col of personnelNameCols) {
    const res = await srcPool.query(
      `SELECT DISTINCT "${col}" FROM public.loans WHERE "${col}" IS NOT NULL AND "${col}" != ''`
    );
    for (const row of res.rows) {
      getOrCreateNameMapping(row[col]);
    }
  }

  // Get distinct personnel IDs from loans
  for (const col of personnelIdCols) {
    const res = await srcPool.query(
      `SELECT DISTINCT "${col}" FROM public.loans WHERE "${col}" IS NOT NULL AND "${col}" != ''`
    );
    for (const row of res.rows) {
      const origId = row[col];
      if (origId && !personnelIdMap.has(origId)) {
        personnelIdMap.set(origId, `PID-${String(personnelIdMap.size + 1).padStart(4, "0")}`);
      }
    }
  }

  // Get distinct branches and orgids from loans
  const branchRes = await srcPool.query(
    `SELECT DISTINCT branch FROM public.loans WHERE branch IS NOT NULL AND branch != ''`
  );
  for (const row of branchRes.rows) {
    if (!branchMap.has(row.branch)) {
      branchMap.set(row.branch, `Branch ${String(branchMap.size + 1).padStart(3, "0")}`);
    }
  }

  const orgRes = await srcPool.query(
    `SELECT DISTINCT orgid FROM public.loans WHERE orgid IS NOT NULL AND orgid != ''`
  );
  for (const row of orgRes.rows) {
    if (!orgIdMap.has(row.orgid)) {
      orgIdMap.set(row.orgid, `ORG-${String(orgIdMap.size + 1).padStart(3, "0")}`);
    }
  }

  // 3. Scan encompass_users for IDs, names, and emails
  console.log("[TenantDuplication] Scanning encompass_users for anonymization mappings...");
  try {
    const encompassUsers = await srcPool.query(
      `SELECT encompass_user_id, username, email, first_name, last_name
       FROM public.encompass_users`,
    );
    for (const eu of encompassUsers.rows) {
      if (eu.encompass_user_id && !personnelIdMap.has(eu.encompass_user_id)) {
        personnelIdMap.set(eu.encompass_user_id, `PID-${String(personnelIdMap.size + 1).padStart(4, "0")}`);
      }
      const fullName = `${eu.first_name || ""} ${eu.last_name || ""}`.trim();
      if (fullName) getOrCreateNameMapping(fullName);
      if (eu.email && !emailMap.has(eu.email)) {
        const pseudo = generatePseudonym(emailMap.size);
        emailMap.set(eu.email, `${pseudo.first.toLowerCase()}.${pseudo.last.toLowerCase().replace(/\s+/g, "")}@example.com`);
      }
    }
    console.log(`[TenantDuplication] encompass_users: ${encompassUsers.rows.length} rows scanned`);
  } catch (err: any) {
    console.warn(`[TenantDuplication] encompass_users scan skipped: ${err.message}`);
  }

  console.log(
    `[TenantDuplication] Mappings built: ${nameMap.size} names, ${branchMap.size} branches, ` +
    `${orgIdMap.size} orgids, ${employeeIdMap.size} employee IDs, ${personnelIdMap.size} personnel IDs`
  );

  return {
    nameMap,
    firstNameMap,
    lastNameMap,
    branchMap,
    orgIdMap,
    employeeIdMap,
    emailMap,
    personnelIdMap,
  };
}

// ── Copy config tables verbatim ───────────────────────────────────────

export async function copyConfigTables(
  srcPool: pg.Pool,
  dstPool: pg.Pool
): Promise<void> {
  for (const table of CONFIG_TABLES) {
    try {
      // Get columns common to both source and destination
      const { columns, jsonbColumns } = await getCommonColumns(srcPool, dstPool, table);
      if (columns.length === 0) {
        console.log(`[TenantDuplication] ${table}: no common columns (skipped)`);
        continue;
      }

      const colList = columns.map((c) => `"${c}"`).join(", ");
      const { rows } = await srcPool.query(`SELECT ${colList} FROM public."${table}"`);
      if (rows.length === 0) {
        console.log(`[TenantDuplication] ${table}: 0 rows (skipped)`);
        continue;
      }

      const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");

      // Insert each row
      let inserted = 0;
      for (const row of rows) {
        const values = columns.map((c) => serializeValue(row[c], c, jsonbColumns));
        try {
          await dstPool.query(
            `INSERT INTO public."${table}" (${colList}) VALUES (${placeholders})
             ON CONFLICT DO NOTHING`,
            values
          );
          inserted++;
        } catch (err: any) {
          // Log but don't fail on individual row errors (e.g. FK violations)
          console.warn(`[TenantDuplication] ${table}: row insert error: ${err.message}`);
        }
      }
      console.log(`[TenantDuplication] ${table}: ${inserted}/${rows.length} rows copied`);
    } catch (err: any) {
      console.warn(`[TenantDuplication] ${table}: table copy error: ${err.message}`);
    }
  }
}

// ── Copy employees with anonymization ─────────────────────────────────

export async function copyEmployeesAnonymized(
  srcPool: pg.Pool,
  dstPool: pg.Pool,
  mappings: AnonymizationMappings
): Promise<number> {
  // Get columns common to both source and destination
  const { columns, jsonbColumns } = await getCommonColumns(srcPool, dstPool, "employees");
  if (columns.length === 0) return 0;

  const colList = columns.map((c) => `"${c}"`).join(", ");
  const { rows } = await srcPool.query(`SELECT ${colList} FROM public.employees`);
  if (rows.length === 0) {
    console.log("[TenantDuplication] employees: 0 rows (skipped)");
    return 0;
  }

  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");

  let inserted = 0;
  for (const row of rows) {
    // Anonymize fields
    const fullName = `${row.first_name || ""} ${row.last_name || ""}`.trim();
    const pseudoFull = mappings.nameMap.get(fullName) || generatePseudonym(inserted).full;
    const parts = pseudoFull.split(" ");
    const anonFirst = parts[0] || row.first_name;
    const anonLast = parts.slice(1).join(" ") || row.last_name;

    row.first_name = anonFirst;
    row.last_name = anonLast;
    row.email = mappings.emailMap.get(row.email) ||
      `${anonFirst.toLowerCase()}.${anonLast.toLowerCase().replace(/\s+/g, "")}@example.com`;
    row.employee_id = mappings.employeeIdMap.get(row.employee_id) ||
      `EMP-${String(inserted + 1).padStart(3, "0")}`;
    row.branch = row.branch ? (mappings.branchMap.get(row.branch) || row.branch) : null;

    const values = columns.map((c) => serializeValue(row[c], c, jsonbColumns));

    try {
      await dstPool.query(
        `INSERT INTO public.employees (${colList}) VALUES (${placeholders})
         ON CONFLICT DO NOTHING`,
        values
      );
      inserted++;
    } catch (err: any) {
      console.warn(`[TenantDuplication] employees: row insert error: ${err.message}`);
    }
  }

  console.log(`[TenantDuplication] employees: ${inserted}/${rows.length} rows copied (anonymized)`);
  return inserted;
}

// ── Copy encompass_users with anonymization ───────────────────────────

export async function copyEncompassUsersAnonymized(
  srcPool: pg.Pool,
  dstPool: pg.Pool,
  mappings: AnonymizationMappings,
): Promise<number> {
  const GENERATED_COLS = new Set(["full_name"]);
  const FK_NULL_COLS = new Set(["los_connection_id", "cohi_user_id"]);

  let srcCols: string[];
  let dstCols: Set<string>;
  let dstJsonbCols: Set<string>;
  try {
    const src = await getCommonColumns(srcPool, dstPool, "encompass_users");
    srcCols = src.columns;
    dstCols = new Set(srcCols);
    dstJsonbCols = src.jsonbColumns;
  } catch {
    console.log("[TenantDuplication] encompass_users: table not found in source or destination (skipped)");
    return 0;
  }

  const columns = srcCols.filter((c) => !GENERATED_COLS.has(c));
  if (columns.length === 0) return 0;

  const colList = columns.map((c) => `"${c}"`).join(", ");
  const srcColList = srcCols.filter((c) => !GENERATED_COLS.has(c)).map((c) => `"${c}"`).join(", ");
  const { rows } = await srcPool.query(`SELECT ${srcColList} FROM public.encompass_users`);
  if (rows.length === 0) {
    console.log("[TenantDuplication] encompass_users: 0 rows (skipped)");
    return 0;
  }

  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  let inserted = 0;

  for (const row of rows) {
    // Map encompass_user_id to same anonymized ID used in loans
    if (row.encompass_user_id) {
      row.encompass_user_id = mappings.personnelIdMap.get(row.encompass_user_id.trim()) || row.encompass_user_id;
    }

    // Anonymize username
    if (row.username) {
      const mapped = mappings.nameMap.get(row.username.trim());
      row.username = mapped ? mapped.toLowerCase().replace(/\s+/g, ".") : `user-${inserted + 1}`;
    }

    // Anonymize name fields
    const origFullName = `${row.first_name || ""} ${row.last_name || ""}`.trim();
    const pseudoFull = origFullName ? (mappings.nameMap.get(origFullName) || generatePseudonym(inserted).full) : generatePseudonym(inserted).full;
    const parts = pseudoFull.split(" ");
    row.first_name = parts[0] || null;
    row.last_name = parts.slice(1).join(" ") || null;

    // Anonymize email
    if (row.email) {
      row.email = mappings.emailMap.get(row.email)
        || `${(row.first_name || "user").toLowerCase()}.${(row.last_name || String(inserted + 1)).toLowerCase().replace(/\s+/g, "")}@example.com`;
    }

    // Null out FK columns that reference tables we don't copy
    for (const col of FK_NULL_COLS) {
      if (col in row) row[col] = null;
    }

    const values = columns.map((c) => serializeValue(row[c], c, dstJsonbCols));

    try {
      await dstPool.query(
        `INSERT INTO public.encompass_users (${colList}) VALUES (${placeholders})
         ON CONFLICT DO NOTHING`,
        values,
      );
      inserted++;
    } catch (err: any) {
      console.warn(`[TenantDuplication] encompass_users: row insert error: ${err.message}`);
    }
  }

  console.log(`[TenantDuplication] encompass_users: ${inserted}/${rows.length} rows copied (anonymized)`);
  return inserted;
}

// ── Copy loans with anonymization (batched) ───────────────────────────

export async function copyLoansAnonymized(
  srcPool: pg.Pool,
  dstPool: pg.Pool,
  mappings: AnonymizationMappings
): Promise<number> {
  // Get columns common to both source and destination
  // This handles dynamic columns (additional fields) that exist in source but not destination
  const { columns, jsonbColumns } = await getCommonColumns(srcPool, dstPool, "loans");
  if (columns.length === 0) return 0;

  const colList = columns.map((c) => `"${c}"`).join(", ");
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");

  // Count total loans
  const countResult = await srcPool.query(`SELECT COUNT(*) as cnt FROM public.loans`);
  const totalLoans = parseInt(countResult.rows[0].cnt, 10);

  if (totalLoans === 0) {
    console.log("[TenantDuplication] loans: 0 rows (skipped)");
    return 0;
  }

  console.log(`[TenantDuplication] Copying ${totalLoans} loans in batches of ${BATCH_SIZE} (${columns.length} columns)...`);

  // Build sets of columns we'll anonymize (only if they exist in the common set)
  const columnSet = new Set(columns);
  const nameFields = [
    "loan_officer", "processor", "underwriter", "closer",
    "loan_interviewer", "account_executive",
  ].filter((f) => columnSet.has(f));
  const idFields = [
    "loan_officer_id", "legacy_loan_officer_id", "loan_processor_id",
    "underwriter_id", "closer_id",
  ].filter((f) => columnSet.has(f));
  const hasBranch = columnSet.has("branch");
  const hasOrgid = columnSet.has("orgid");

  let totalInserted = 0;
  let errorCount = 0;
  let offset = 0;

  while (offset < totalLoans) {
    const { rows } = await srcPool.query(
      `SELECT ${colList} FROM public.loans ORDER BY id LIMIT $1 OFFSET $2`,
      [BATCH_SIZE, offset]
    );

    if (rows.length === 0) break;

    for (const row of rows) {
      // Anonymize personnel name fields
      for (const field of nameFields) {
        if (row[field]) {
          row[field] = mappings.nameMap.get(row[field].trim()) || row[field];
        }
      }

      // Anonymize personnel ID fields
      for (const field of idFields) {
        if (row[field]) {
          row[field] = mappings.personnelIdMap.get(row[field].trim()) || row[field];
        }
      }

      // Anonymize branch and orgid
      if (hasBranch && row.branch) {
        row.branch = mappings.branchMap.get(row.branch) || row.branch;
      }
      if (hasOrgid && row.orgid) {
        row.orgid = mappings.orgIdMap.get(row.orgid) || row.orgid;
      }

      // Insert into destination using only common columns
      const values = columns.map((c) => serializeValue(row[c], c, jsonbColumns));

      try {
        await dstPool.query(
          `INSERT INTO public.loans (${colList}) VALUES (${placeholders})
           ON CONFLICT DO NOTHING`,
          values
        );
        totalInserted++;
      } catch (err: any) {
        errorCount++;
        if (errorCount <= 3) {
          console.warn(`[TenantDuplication] loans: row insert error: ${err.message}`);
        }
      }
    }

    offset += rows.length;
    console.log(`[TenantDuplication] loans: ${totalInserted}/${totalLoans} processed...`);
  }

  if (errorCount > 3) {
    console.warn(`[TenantDuplication] loans: ${errorCount} total row errors (suppressed after first 3)`);
  }
  console.log(`[TenantDuplication] loans: ${totalInserted}/${totalLoans} rows copied (anonymized)`);
  return totalInserted;
}

// ── Copy loan-related data tables (no PII) ────────────────────────────

export async function copyLoanRelatedData(
  srcPool: pg.Pool,
  dstPool: pg.Pool
): Promise<void> {
  for (const table of LOAN_DATA_TABLES) {
    try {
      // Get columns common to both source and destination
      const { columns, jsonbColumns } = await getCommonColumns(srcPool, dstPool, table);
      if (columns.length === 0) {
        console.log(`[TenantDuplication] ${table}: no common columns (skipped)`);
        continue;
      }

      const colList = columns.map((c) => `"${c}"`).join(", ");
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");

      const countRes = await srcPool.query(`SELECT COUNT(*) as cnt FROM public."${table}"`);
      const total = parseInt(countRes.rows[0].cnt, 10);
      if (total === 0) {
        console.log(`[TenantDuplication] ${table}: 0 rows (skipped)`);
        continue;
      }

      let inserted = 0;
      let offset = 0;

      while (offset < total) {
        const { rows } = await srcPool.query(
          `SELECT ${colList} FROM public."${table}" ORDER BY id LIMIT $1 OFFSET $2`,
          [BATCH_SIZE, offset]
        );
        if (rows.length === 0) break;

        for (const row of rows) {
          const values = columns.map((c) => serializeValue(row[c], c, jsonbColumns));

          try {
            await dstPool.query(
              `INSERT INTO public."${table}" (${colList}) VALUES (${placeholders})
               ON CONFLICT DO NOTHING`,
              values
            );
            inserted++;
          } catch {
            // Silently skip rows with FK violations, etc.
          }
        }

        offset += rows.length;
      }

      console.log(`[TenantDuplication] ${table}: ${inserted}/${total} rows copied`);
    } catch (err: any) {
      console.warn(`[TenantDuplication] ${table}: table copy error: ${err.message}`);
    }
  }
}

// ── Main orchestrator ─────────────────────────────────────────────────

export interface DuplicateTenantResult {
  newTenant: TenantInfo;
  stats: {
    configTablesCopied: number;
    employeesCopied: number;
    loansCopied: number;
    encompassUsersCopied: number;
    loanDataTablesCopied: number;
    anonymizationMappings: {
      names: number;
      branches: number;
      orgIds: number;
      employeeIds: number;
      personnelIds: number;
    };
  };
}

export async function duplicateTenantAnonymized(
  sourceId: string,
  newName: string,
  newSlug: string,
  options?: { autoRefresh?: boolean }
): Promise<DuplicateTenantResult> {
  console.log(`[TenantDuplication] Starting duplication of tenant ${sourceId} -> "${newName}" (${newSlug})`);

  // 0a. In-progress lock — reject if a duplication for this slug is already running
  if (inProgressSlugs.has(newSlug)) {
    throw new Error(`A duplication to slug "${newSlug}" is already in progress`);
  }

  // 0b. Check if slug already exists
  const existingSlug = await managementPool.query(
    `SELECT id, status FROM coheus_tenants WHERE slug = $1`,
    [newSlug]
  );
  if (existingSlug.rows.length > 0) {
    const existing = existingSlug.rows[0];
    const canReuse = existing.status === "provisioning" || existing.status === "deleted";
    if (canReuse) {
      console.log(`[TenantDuplication] Cleaning up ${existing.status} tenant with slug "${newSlug}" (id: ${existing.id})`);
      await managementPool.query(
        `DELETE FROM coheus_tenants WHERE id = $1`,
        [existing.id]
      );
      try {
        const dbName = `coheus_tenant_${newSlug.replace(/-/g, "_")}`;
        await managementPool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
        console.log(`[TenantDuplication] Dropped orphan database "${dbName}"`);
      } catch (dropErr: any) {
        console.warn(`[TenantDuplication] Could not drop orphan database: ${dropErr.message}`);
      }
    } else {
      throw new Error(`A tenant with slug "${newSlug}" already exists`);
    }
  }

  // 0c. Acquire the lock
  inProgressSlugs.add(newSlug);

  try {
    // 1. Verify source tenant exists
    const sourceTenant = await getTenant(sourceId);
    if (!sourceTenant) {
      throw new Error(`Source tenant ${sourceId} not found`);
    }
    if (sourceTenant.status === "deleted") {
      throw new Error(`Cannot duplicate a deleted tenant`);
    }

    console.log(`[TenantDuplication] Source tenant: "${sourceTenant.name}" (${sourceTenant.database_name})`);

    // 2. Create the new tenant (this creates the database + schema + runs migrations)
    let newTenant: TenantInfo;
    try {
      newTenant = await createTenant({
        name: newName,
        slug: newSlug,
        deployment_type: sourceTenant.deployment_type as "cloud" | "on_premise" | "per_lender_aws",
      });
      await managementPool.query(
        `UPDATE coheus_tenants
         SET is_demo = true,
             source_tenant_id = $2,
             last_refreshed_at = NOW(),
             auto_refresh = $3,
             updated_at = NOW()
         WHERE id = $1`,
        [newTenant.id, sourceId, options?.autoRefresh ?? false]
      );
      console.log(`[TenantDuplication] New tenant created: "${newTenant.name}" (${newTenant.database_name})`);
    } catch (err: any) {
      throw new Error(`Failed to create new tenant: ${err.message}`);
    }

    // 3. Get pools for both databases
    const src = await getTenantPoolById(sourceId);
    const dst = await getTenantPoolById(newTenant.id);

    try {
      // Set new tenant back to provisioning while we copy data
      await updateTenantStatus(newTenant.id, "provisioning");

      // 4. Build anonymization mappings from source data
      console.log("[TenantDuplication] Building anonymization mappings...");
      const mappings = await buildAnonymizationMappings(src.pool);

      // 5. Copy config tables verbatim
      console.log("[TenantDuplication] Copying config tables...");
      await copyConfigTables(src.pool, dst.pool);

      // 6. Copy employees with anonymization
      console.log("[TenantDuplication] Copying employees (anonymized)...");
      const employeesCopied = await copyEmployeesAnonymized(src.pool, dst.pool, mappings);

      // 7. Copy loans with anonymization
      console.log("[TenantDuplication] Copying loans (anonymized)...");
      const loansCopied = await copyLoansAnonymized(src.pool, dst.pool, mappings);

      // 7b. Copy encompass_users with anonymization
      console.log("[TenantDuplication] Copying encompass_users (anonymized)...");
      const encompassUsersCopied = await copyEncompassUsersAnonymized(src.pool, dst.pool, mappings);

      // 8. Copy loan-related data tables
      console.log("[TenantDuplication] Copying loan-related data tables...");
      await copyLoanRelatedData(src.pool, dst.pool);

      // 9. Mark new tenant as active
      await updateTenantStatus(newTenant.id, "active");
      console.log(`[TenantDuplication] Duplication complete! New tenant "${newName}" is active.`);

      return {
        newTenant: { ...newTenant, status: "active" },
        stats: {
          configTablesCopied: CONFIG_TABLES.length,
          employeesCopied,
          loansCopied,
          encompassUsersCopied,
          loanDataTablesCopied: LOAN_DATA_TABLES.length,
          anonymizationMappings: {
            names: mappings.nameMap.size,
            branches: mappings.branchMap.size,
            orgIds: mappings.orgIdMap.size,
            employeeIds: mappings.employeeIdMap.size,
            personnelIds: mappings.personnelIdMap.size,
          },
        },
      };
    } catch (err: any) {
      console.error(`[TenantDuplication] Error during data copy:`, err);
      // Leave tenant in provisioning status so admin can clean up
      throw new Error(`Tenant duplication failed during data copy: ${err.message}`);
    } finally {
      await src.cleanup();
      await dst.cleanup();
    }
  } finally {
    // Always release the slug lock
    inProgressSlugs.delete(newSlug);
  }
}
