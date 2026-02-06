import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the common aliases list
const commonAliasesPath = path.join(__dirname, '..', 'QlikAppsAndLogicDictionaryDocs', 'CoheusLegacyConfigs', 'common-aliases-list.txt');
const commonAliasesContent = fs.readFileSync(commonAliasesPath, 'utf-8');
const commonAliases = commonAliasesContent
  .split('\n')
  .map(line => line.trim())
  .filter(line => line.length > 0);

console.log(`Loaded ${commonAliases.length} aliases from common-aliases-list.txt`);

// Read the TypeScript file and extract keys from DEFAULT_ENCOMPASS_FIELD_MAPPINGS
const tsFilePath = path.join(__dirname, '..', 'server', 'src', 'config', 'defaultEncompassFieldMappings.ts');
const tsContent = fs.readFileSync(tsFilePath, 'utf-8');

// Extract keys from DEFAULT_ENCOMPASS_FIELD_MAPPINGS object
// Look for pattern: "Key": "value" or 'Key': 'value'
const mappingKeys = [];
const mappingRegex = /^[\s]*["']([^"']+)["']:\s*["'][^"']+["'],?/gm;
let match;
while ((match = mappingRegex.exec(tsContent)) !== null) {
  mappingKeys.push(match[1]);
}

// Also try to find keys that might be on multiple lines or have different formatting
// Look for the actual object definition
const objectStart = tsContent.indexOf('export const DEFAULT_ENCOMPASS_FIELD_MAPPINGS: Record<string, string> = {');
const objectEnd = tsContent.lastIndexOf('};');
const objectContent = tsContent.substring(objectStart, objectEnd);

// Extract keys by matching the actual object pattern
// Look for: "Key": "value" or Key: "value" where value starts with "Fields. or "Loan.
const keyValueRegex = /(?:^|\n)\s*(?:["']([^"']+)["']|([A-Z][a-zA-Z0-9_]*))\s*:\s*["'](?:Fields\.|Loan\.)/g;
const extractedKeys = new Set();
let keyMatch;
while ((keyMatch = keyValueRegex.exec(objectContent)) !== null) {
  const key = keyMatch[1] || keyMatch[2]; // match[1] for quoted, match[2] for unquoted
  if (key) {
    extractedKeys.add(key);
  }
}

// Also handle multi-line keys where key and value are on separate lines
// Pattern: "Key":\n    "Fields.xxx"
const multilineKeyRegex = /(?:^|\n)\s*["']([^"']+)["']\s*:\s*\n\s*["'](?:Fields\.|Loan\.)/g;
let multilineMatch;
while ((multilineMatch = multilineKeyRegex.exec(objectContent)) !== null) {
  extractedKeys.add(multilineMatch[1]);
}

// Handle unquoted keys on separate lines: Key:\n    "Fields.xxx"
const multilineUnquotedRegex = /(?:^|\n)\s*([A-Z][a-zA-Z0-9_]*)\s*:\s*\n\s*["'](?:Fields\.|Loan\.)/g;
let unquotedMatch;
while ((unquotedMatch = multilineUnquotedRegex.exec(objectContent)) !== null) {
  extractedKeys.add(unquotedMatch[1]);
}

const defaultKeys = Array.from(extractedKeys).sort();

console.log(`Loaded ${defaultKeys.length} keys from DEFAULT_ENCOMPASS_FIELD_MAPPINGS`);

// Normalize HTML entities
const decodeHtmlEntities = (str) => {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
};

// Normalize for comparison (case-insensitive, trim whitespace, decode HTML entities)
const normalize = (str) => decodeHtmlEntities(str).toLowerCase().trim();

// Create normalized sets for comparison
const commonNormalized = new Map();
commonAliases.forEach(alias => {
  commonNormalized.set(normalize(alias), alias);
});

const defaultNormalized = new Map();
defaultKeys.forEach(key => {
  defaultNormalized.set(normalize(key), key);
});

// Find matches (exact case-sensitive matches)
const exactMatches = [];
const caseInsensitiveMatches = [];
const htmlEntityDifferences = [];
const missingFromDefaults = [];
const extraInDefaults = [];

// Check common aliases against defaults
for (const alias of commonAliases) {
  const normalized = normalize(alias);
  if (defaultNormalized.has(normalized)) {
    const defaultKey = defaultNormalized.get(normalized);
    if (alias === defaultKey) {
      exactMatches.push(alias);
    } else {
      // Check if it's just an HTML entity difference
      const decodedCommon = decodeHtmlEntities(alias);
      const decodedDefault = decodeHtmlEntities(defaultKey);
      if (decodedCommon.toLowerCase() === decodedDefault.toLowerCase()) {
        htmlEntityDifferences.push({
          common: alias,
          default: defaultKey,
          decoded: decodedCommon
        });
      } else {
        caseInsensitiveMatches.push({
          common: alias,
          default: defaultKey
        });
      }
    }
  } else {
    missingFromDefaults.push(alias);
  }
}

// Remove HTML entity differences from missing list (they're actually matches)
const htmlEntityCommonAliases = new Set(htmlEntityDifferences.map(d => d.common));
const filteredMissingFromDefaults = missingFromDefaults.filter(alias => !htmlEntityCommonAliases.has(alias));
missingFromDefaults.length = 0;
missingFromDefaults.push(...filteredMissingFromDefaults);

// Check defaults against common aliases
// First, collect all normalized common aliases (including HTML entity variants)
const allCommonNormalized = new Set();
commonAliases.forEach(alias => {
  allCommonNormalized.add(normalize(alias));
});

// Also collect HTML entity variants from defaults
const htmlEntityDefaultKeys = new Set(htmlEntityDifferences.map(d => d.default));

for (const key of defaultKeys) {
  // Skip if it's an HTML entity variant of a common alias
  if (htmlEntityDefaultKeys.has(key)) {
    continue;
  }
  
  const normalized = normalize(key);
  if (!allCommonNormalized.has(normalized)) {
    extraInDefaults.push(key);
  }
}

// Output results
console.log('\n' + '='.repeat(80));
console.log('COMPARISON RESULTS');
console.log('='.repeat(80));

console.log('\n1. ALIASES IN COMMON LIST MISSING FROM DEFAULTS (need to be added):');
console.log('-'.repeat(80));
if (missingFromDefaults.length === 0) {
  console.log('  None');
} else {
  missingFromDefaults.forEach((alias, idx) => {
    console.log(`  ${idx + 1}. ${alias}`);
  });
}
console.log(`\n  Total: ${missingFromDefaults.length}`);

console.log('\n2. ALIASES IN DEFAULTS NOT IN COMMON LIST (would be removed):');
console.log('-'.repeat(80));
if (extraInDefaults.length === 0) {
  console.log('  None');
} else {
  extraInDefaults.forEach((alias, idx) => {
    console.log(`  ${idx + 1}. ${alias}`);
  });
}
console.log(`\n  Total: ${extraInDefaults.length}`);

console.log('\n3. ALIASES THAT EXIST IN BOTH (will remain):');
console.log('-'.repeat(80));
console.log(`  Total exact matches: ${exactMatches.length}`);
if (exactMatches.length <= 20) {
  exactMatches.forEach((alias, idx) => {
    console.log(`  ${idx + 1}. ${alias}`);
  });
} else {
  exactMatches.slice(0, 10).forEach((alias, idx) => {
    console.log(`  ${idx + 1}. ${alias}`);
  });
  console.log(`  ... and ${exactMatches.length - 10} more`);
}

if (htmlEntityDifferences.length > 0) {
  console.log('\n4. HTML ENTITY ENCODING DIFFERENCES (same field, different encoding):');
  console.log('-'.repeat(80));
  htmlEntityDifferences.forEach((match, idx) => {
    console.log(`  ${idx + 1}. Common: "${match.common}"`);
    console.log(`     Default: "${match.default}"`);
    console.log(`     Decoded: "${match.decoded}"`);
  });
  console.log(`\n  Total: ${htmlEntityDifferences.length}`);
}

if (caseInsensitiveMatches.length > 0) {
  console.log('\n5. CASE/SPELLING DIFFERENCES (case-insensitive match but different exact spelling):');
  console.log('-'.repeat(80));
  caseInsensitiveMatches.forEach((match, idx) => {
    console.log(`  ${idx + 1}. Common: "${match.common}"`);
    console.log(`     Default: "${match.default}"`);
  });
  console.log(`\n  Total: ${caseInsensitiveMatches.length}`);
}

console.log('\n' + '='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log(`Common aliases list: ${commonAliases.length} aliases`);
console.log(`Default mappings: ${defaultKeys.length} keys`);
console.log(`Exact matches: ${exactMatches.length}`);
console.log(`HTML entity differences: ${htmlEntityDifferences.length}`);
console.log(`Case/spelling differences: ${caseInsensitiveMatches.length}`);
console.log(`Missing from defaults: ${missingFromDefaults.length}`);
console.log(`Extra in defaults: ${extraInDefaults.length}`);
