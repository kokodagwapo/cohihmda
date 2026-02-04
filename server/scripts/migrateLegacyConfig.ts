/**
 * Legacy Coheus Config Migration Script
 *
 * Parses legacy Qlik-based Coheus XML configuration files and generates
 * a JSON file with field swaps to import into the new Coheus system.
 *
 * Usage:
 *   npx tsx server/scripts/migrateLegacyConfig.ts --input <path-to-xml>
 *   npx tsx server/scripts/migrateLegacyConfig.ts --inputDir <path-to-dir>
 *
 * Options:
 *   --input <file>      Single XML file to process
 *   --inputDir <dir>    Directory containing XML files to batch process
 *   --output <file>     Output JSON file (default: <input>_migration.json)
 *   --outputDir <dir>   Output directory for batch processing
 */

import * as fs from "fs";
import * as path from "path";
import { DEFAULT_ENCOMPASS_FIELD_MAPPINGS } from "../src/config/defaultEncompassFieldMappings.js";

// ============================================================================
// Types
// ============================================================================

interface FieldSwap {
  coheusAlias: string;
  defaultFieldId: string;
  newFieldId: string;
}

interface AdditionalField {
  fieldId: string;
  alias: string;
}

interface MigrationResult {
  clientInfo: {
    instanceId: string;
    sourceFile: string;
    migratedAt: string;
  };
  fieldSwaps: FieldSwap[];
  additionalFields: AdditionalField[];
  summary: {
    totalFieldsInLegacy: number;
    matchingDefaults: number;
    fieldSwaps: number;
    additionalFields: number;
  };
}

interface LegacyField {
  id: string;
  alias: string;
}

// ============================================================================
// XML Parsing Utilities
// ============================================================================

/**
 * Extract client ID from <ClientInfo Id="...">
 */
function extractClientId(xmlContent: string): string {
  const match = xmlContent.match(/<ClientInfo\s+Id="([^"]+)"/);
  return match ? match[1] : "unknown";
}

/**
 * Extract all <Field Id="..." Alias="..."/> entries from <DataDictionary> section
 */
function extractDataDictionary(xmlContent: string): LegacyField[] {
  const fields: LegacyField[] = [];

  // Find the DataDictionary section
  const ddMatch = xmlContent.match(
    /<DataDictionary>([\s\S]*?)<\/DataDictionary>/
  );
  if (!ddMatch) {
    console.warn("No <DataDictionary> section found in XML");
    return fields;
  }

  const ddContent = ddMatch[1];

  // Extract all Field elements
  // Handles both self-closing and normal forms
  const fieldRegex = /<Field\s+Id="([^"]+)"\s+Alias="([^"]+)"\s*\/?\s*>/g;
  let match;

  while ((match = fieldRegex.exec(ddContent)) !== null) {
    const id = match[1];
    const alias = match[2];
    fields.push({ id, alias });
  }

  return fields;
}

/**
 * Normalize field ID for comparison
 * - Strips "Fields." prefix if present
 * - Handles various formats like "Fields.317", "317", "LoanTeamMember.Name.Loan Officer"
 */
function normalizeFieldId(fieldId: string): string {
  // Remove leading "Fields." if present (but keep other prefixes like "Loan." or "Log.")
  if (fieldId.startsWith("Fields.")) {
    return fieldId.substring(7);
  }
  return fieldId;
}

/**
 * Check if two field IDs are equivalent
 */
function fieldIdsMatch(id1: string, id2: string): boolean {
  const norm1 = normalizeFieldId(id1);
  const norm2 = normalizeFieldId(id2);
  return norm1 === norm2;
}

// ============================================================================
// Migration Logic
// ============================================================================

/**
 * Build a map of alias → default field ID from the default mappings
 */
function buildDefaultMappingsMap(): Map<string, string> {
  const map = new Map<string, string>();

  for (const [alias, fieldId] of Object.entries(
    DEFAULT_ENCOMPASS_FIELD_MAPPINGS
  )) {
    // Store with normalized alias (case-insensitive matching)
    map.set(alias.toLowerCase(), fieldId);
  }

  return map;
}

/**
 * Process a single XML file and generate migration result
 */
function processLegacyXml(
  xmlContent: string,
  sourceFileName: string
): MigrationResult {
  const clientId = extractClientId(xmlContent);
  const legacyFields = extractDataDictionary(xmlContent);
  const defaultMappings = buildDefaultMappingsMap();

  const fieldSwaps: FieldSwap[] = [];
  const additionalFields: AdditionalField[] = [];
  let matchingDefaults = 0;

  // Track seen aliases to handle duplicates (legacy files have some duplicate entries)
  const seenAliases = new Set<string>();

  for (const field of legacyFields) {
    const aliasLower = field.alias.toLowerCase();

    // Skip duplicates (keep first occurrence)
    if (seenAliases.has(aliasLower)) {
      continue;
    }
    seenAliases.add(aliasLower);

    const defaultFieldId = defaultMappings.get(aliasLower);

    if (defaultFieldId) {
      // Alias exists in default mappings
      if (!fieldIdsMatch(field.id, defaultFieldId)) {
        // Field ID differs - this is a swap
        fieldSwaps.push({
          coheusAlias: field.alias,
          defaultFieldId: defaultFieldId,
          newFieldId: field.id,
        });
      } else {
        // Field ID matches default
        matchingDefaults++;
      }
    } else {
      // Alias not in default mappings - additional field
      additionalFields.push({
        fieldId: field.id,
        alias: field.alias,
      });
    }
  }

  return {
    clientInfo: {
      instanceId: clientId,
      sourceFile: sourceFileName,
      migratedAt: new Date().toISOString(),
    },
    fieldSwaps,
    additionalFields,
    summary: {
      totalFieldsInLegacy: seenAliases.size,
      matchingDefaults,
      fieldSwaps: fieldSwaps.length,
      additionalFields: additionalFields.length,
    },
  };
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(): {
  input?: string;
  inputDir?: string;
  output?: string;
  outputDir?: string;
} {
  const args = process.argv.slice(2);
  const result: {
    input?: string;
    inputDir?: string;
    output?: string;
    outputDir?: string;
  } = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--input":
        result.input = args[++i];
        break;
      case "--inputDir":
        result.inputDir = args[++i];
        break;
      case "--output":
        result.output = args[++i];
        break;
      case "--outputDir":
        result.outputDir = args[++i];
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
Legacy Coheus Config Migration Script

Parses legacy Qlik-based Coheus XML configuration files and generates
a JSON file with field swaps to import into the new Coheus system.

Usage:
  npx tsx server/scripts/migrateLegacyConfig.ts --input <path-to-xml>
  npx tsx server/scripts/migrateLegacyConfig.ts --inputDir <path-to-dir>

Options:
  --input <file>      Single XML file to process
  --inputDir <dir>    Directory containing XML files to batch process
  --output <file>     Output JSON file (default: <input>_migration.json)
  --outputDir <dir>   Output directory for batch processing (default: ./migrations)
  --help, -h          Show this help message

Examples:
  # Process single file
  npx tsx server/scripts/migrateLegacyConfig.ts \\
    --input QlikAppsAndLogicDictionaryDocs/CoheusLegacyConfigs/3011118900_full_xml.xml

  # Batch process directory
  npx tsx server/scripts/migrateLegacyConfig.ts \\
    --inputDir QlikAppsAndLogicDictionaryDocs/CoheusLegacyConfigs/ \\
    --outputDir ./migrations
  `);
}

function processFile(inputPath: string, outputPath?: string): void {
  console.log(`\nProcessing: ${inputPath}`);

  if (!fs.existsSync(inputPath)) {
    console.error(`  ❌ File not found: ${inputPath}`);
    return;
  }

  const xmlContent = fs.readFileSync(inputPath, "utf-8");
  const fileName = path.basename(inputPath);

  const result = processLegacyXml(xmlContent, fileName);

  // Determine output path
  const outPath = outputPath || inputPath.replace(/\.xml$/i, "_migration.json");

  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

  console.log(`  ✅ Client ID: ${result.clientInfo.instanceId}`);
  console.log(
    `  📊 Total fields in legacy: ${result.summary.totalFieldsInLegacy}`
  );
  console.log(`  ✓  Matching defaults: ${result.summary.matchingDefaults}`);
  console.log(`  🔄 Field swaps: ${result.summary.fieldSwaps}`);
  console.log(`  ➕ Additional fields: ${result.summary.additionalFields}`);
  console.log(`  💾 Output: ${outPath}`);
}

function processDirectory(inputDir: string, outputDir?: string): void {
  console.log(`\nProcessing directory: ${inputDir}`);

  if (!fs.existsSync(inputDir)) {
    console.error(`❌ Directory not found: ${inputDir}`);
    process.exit(1);
  }

  const outDir = outputDir || "./migrations";
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
    console.log(`📁 Created output directory: ${outDir}`);
  }

  const files = fs
    .readdirSync(inputDir)
    .filter((f) => f.toLowerCase().endsWith(".xml"));

  if (files.length === 0) {
    console.log("No XML files found in directory");
    return;
  }

  console.log(`Found ${files.length} XML file(s)`);

  let successCount = 0;
  let errorCount = 0;

  for (const file of files) {
    const inputPath = path.join(inputDir, file);
    const outputFileName = file.replace(/\.xml$/i, "_migration.json");
    const outputPath = path.join(outDir, outputFileName);

    try {
      processFile(inputPath, outputPath);
      successCount++;
    } catch (error) {
      console.error(`  ❌ Error processing ${file}:`, error);
      errorCount++;
    }
  }

  console.log(`\n========================================`);
  console.log(`Summary: ${successCount} successful, ${errorCount} errors`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log("🔄 Legacy Coheus Config Migration Tool");
  console.log("========================================");

  const args = parseArgs();

  if (!args.input && !args.inputDir) {
    console.error(
      "❌ Error: Please provide --input <file> or --inputDir <directory>"
    );
    console.log("Use --help for usage information");
    process.exit(1);
  }

  if (args.input) {
    processFile(args.input, args.output);
  } else if (args.inputDir) {
    processDirectory(args.inputDir, args.outputDir);
  }

  console.log("\n✅ Migration complete!");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
