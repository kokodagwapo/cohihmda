#!/usr/bin/env node
/**
 * Tool to analyze Cohues Legacy Config XMLs and find common field aliases
 * across all data dictionaries.
 *
 * Usage: node scripts/find-common-data-dictionary-aliases.js [directory]
 *
 * Default directory: QlikAppsAndLogicDictionaryDocs/CoheusLegacyConfigs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default directory path
const DEFAULT_DIR = path.join(
  __dirname,
  "..",
  "QlikAppsAndLogicDictionaryDocs",
  "CoheusLegacyConfigs"
);

/**
 * Parse XML and extract Field elements from DataDictionary section
 * @param {string} xmlContent - Raw XML content
 * @returns {Array<{id: string, alias: string}>} Array of field objects
 */
function extractDataDictionaryFields(xmlContent) {
  const fields = [];

  // Find the DataDictionary section
  const dataDictMatch = xmlContent.match(
    /<DataDictionary>([\s\S]*?)<\/DataDictionary>/
  );
  if (!dataDictMatch) {
    return fields;
  }

  const dataDictContent = dataDictMatch[1];

  // Extract all Field elements with Id and Alias attributes
  const fieldRegex = /<Field\s+Id="([^"]+)"\s+Alias="([^"]+)"\s*\/>/g;
  let match;

  while ((match = fieldRegex.exec(dataDictContent)) !== null) {
    fields.push({
      id: match[1],
      alias: match[2],
    });
  }

  return fields;
}

/**
 * Get client info from XML
 * @param {string} xmlContent - Raw XML content
 * @returns {string} Client ID or 'Unknown'
 */
function getClientId(xmlContent) {
  const match = xmlContent.match(/<ClientInfo\s+Id="([^"]+)"/);
  return match ? match[1] : "Unknown";
}

/**
 * Main function to analyze XML files
 */
function analyzeXmlFiles(directory) {
  const dir = directory || DEFAULT_DIR;

  console.log("=".repeat(80));
  console.log("COMMON DATA DICTIONARY ALIASES FINDER");
  console.log("=".repeat(80));
  console.log(`\nAnalyzing directory: ${dir}\n`);

  // Get all XML files
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".xml"));
  } catch (err) {
    console.error(`Error reading directory: ${err.message}`);
    process.exit(1);
  }

  if (files.length === 0) {
    console.log("No XML files found in directory.");
    process.exit(0);
  }

  console.log(`Found ${files.length} XML file(s):\n`);

  // Store aliases per file
  const fileAliases = new Map(); // Map<filename, Set<alias>>
  const aliasDetails = new Map(); // Map<alias, Map<filename, Array<{id, alias}>>>
  const clientIds = new Map(); // Map<filename, clientId>

  // Process each file
  for (const file of files) {
    const filePath = path.join(dir, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const clientId = getClientId(content);
    const fields = extractDataDictionaryFields(content);

    clientIds.set(file, clientId);

    // Get unique aliases for this file
    const aliasSet = new Set();
    for (const field of fields) {
      aliasSet.add(field.alias);

      // Track details per alias per file
      if (!aliasDetails.has(field.alias)) {
        aliasDetails.set(field.alias, new Map());
      }
      const aliasFileMap = aliasDetails.get(field.alias);
      if (!aliasFileMap.has(file)) {
        aliasFileMap.set(file, []);
      }
      aliasFileMap.get(file).push(field);
    }

    fileAliases.set(file, aliasSet);
    console.log(`  - ${file} (Client ID: ${clientId})`);
    console.log(`    Total fields in DataDictionary: ${fields.length}`);
    console.log(`    Unique aliases: ${aliasSet.size}\n`);
  }

  // Find common aliases (present in ALL files)
  const fileNames = Array.from(fileAliases.keys());
  const allAliases = Array.from(aliasDetails.keys());

  const commonAliases = allAliases.filter((alias) => {
    const filesWithAlias = aliasDetails.get(alias);
    return filesWithAlias.size === files.length;
  });

  // Sort alphabetically
  commonAliases.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  console.log("=".repeat(80));
  console.log(
    `COMMON ALIASES (present in all ${files.length} files): ${commonAliases.length}`
  );
  console.log("=".repeat(80));
  console.log();

  // Print common aliases with their IDs per file
  for (const alias of commonAliases) {
    console.log(`"${alias}"`);
    const filesWithAlias = aliasDetails.get(alias);
    for (const [fileName, fields] of filesWithAlias) {
      const ids = fields.map((f) => f.id).join(", ");
      console.log(`    ${clientIds.get(fileName)}: ${ids}`);
    }
    console.log();
  }

  // Summary statistics
  console.log("=".repeat(80));
  console.log("SUMMARY");
  console.log("=".repeat(80));
  console.log(`Total unique aliases across all files: ${allAliases.length}`);
  console.log(
    `Common aliases (in ALL ${files.length} files): ${commonAliases.length}`
  );

  // Find aliases unique to each file
  console.log("\nAliases unique to each file:");
  for (const [file, aliases] of fileAliases) {
    const uniqueToThisFile = Array.from(aliases).filter((alias) => {
      const filesWithAlias = aliasDetails.get(alias);
      return filesWithAlias.size === 1;
    });
    console.log(
      `  ${clientIds.get(file)}: ${uniqueToThisFile.length} unique aliases`
    );
  }

  // Output as JSON for programmatic use
  const outputPath = path.join(dir, "common-aliases-report.json");
  const report = {
    generatedAt: new Date().toISOString(),
    directory: dir,
    filesAnalyzed: files.map((f) => ({
      filename: f,
      clientId: clientIds.get(f),
      totalFields: Array.from(aliasDetails.values())
        .filter((m) => m.has(f))
        .reduce((sum, m) => sum + m.get(f).length, 0),
      uniqueAliases: fileAliases.get(f).size,
    })),
    commonAliases: commonAliases.map((alias) => ({
      alias,
      fieldIds: Object.fromEntries(
        Array.from(aliasDetails.get(alias).entries()).map(([file, fields]) => [
          clientIds.get(file),
          fields.map((f) => f.id),
        ])
      ),
    })),
    totalUniqueAliases: allAliases.length,
    commonAliasCount: commonAliases.length,
  };

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\nDetailed report saved to: ${outputPath}`);

  // Also output just the common alias names
  const aliasListPath = path.join(dir, "common-aliases-list.txt");
  fs.writeFileSync(aliasListPath, commonAliases.join("\n"));
  console.log(`Simple alias list saved to: ${aliasListPath}`);

  return {
    commonAliases,
    report,
  };
}

// Run if called directly
analyzeXmlFiles(process.argv[2]);

export { analyzeXmlFiles, extractDataDictionaryFields };
