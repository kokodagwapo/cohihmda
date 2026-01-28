/**
 * Cohi Schema Analysis Script
 * 
 * Analyzes the loans table schema from the TypeScript file and outputs:
 * - Total field count
 * - Fields grouped by category (based on code comments)
 * - Summary statistics
 * 
 * SOURCE OF TRUTH: server/src/config/tenantDatabaseSchema.ts
 *   The public.loans table definition contains 296 standard columns
 *   migrated from the legacy Qlik Coheus data dictionary.
 * 
 * This script parses the schema definition file. System columns
 * (id, created_at, updated_at, created_by, raw_data, metadata, embedding)
 * are included in the count but are not part of the loan data dictionary.
 * 
 * Usage: node scripts/count-schema-fields.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const schemaPath = path.join(__dirname, '../server/src/config/tenantDatabaseSchema.ts');
const content = fs.readFileSync(schemaPath, 'utf8');

// Extract the loans table CREATE statement
const loansMatch = content.match(/CREATE TABLE IF NOT EXISTS public\.loans \(([\s\S]*?)\)\s*`/);

if (!loansMatch) {
  console.log('Could not find loans table definition');
  process.exit(1);
}

const loansTable = loansMatch[1];
const lines = loansTable.split('\n');

const columns = [];
const categories = {};
let currentCategory = 'System';

for (const line of lines) {
  // Check for category comments
  const categoryMatch = line.match(/--\s*(.+)\s*fields?/i);
  if (categoryMatch) {
    currentCategory = categoryMatch[1].trim();
    if (!categories[currentCategory]) {
      categories[currentCategory] = [];
    }
  }
  
  // Match column definitions
  const colMatch = line.match(/^\s+(\w+)\s+(TEXT|INTEGER|DECIMAL|DATE|TIMESTAMPTZ|BOOLEAN|JSONB|UUID|vector)/);
  if (colMatch) {
    const colName = colMatch[1];
    const colType = colMatch[2];
    columns.push({ name: colName, type: colType, category: currentCategory });
    if (!categories[currentCategory]) {
      categories[currentCategory] = [];
    }
    categories[currentCategory].push(colName);
  }
}

console.log('='.repeat(60));
console.log('COHI LOANS TABLE SCHEMA ANALYSIS');
console.log('='.repeat(60));
console.log(`\nTotal columns: ${columns.length}`);
console.log('\n' + '-'.repeat(60));
console.log('COLUMNS BY CATEGORY:');
console.log('-'.repeat(60));

// Sort categories by count
const sortedCategories = Object.entries(categories)
  .sort((a, b) => b[1].length - a[1].length);

for (const [category, cols] of sortedCategories) {
  console.log(`\n### ${category} (${cols.length} fields)`);
  cols.forEach(col => console.log(`  - ${col}`));
}

console.log('\n' + '='.repeat(60));
console.log('SUMMARY BY CATEGORY:');
console.log('='.repeat(60));
for (const [category, cols] of sortedCategories) {
  console.log(`${category}: ${cols.length}`);
}
console.log('-'.repeat(60));
console.log(`TOTAL: ${columns.length} fields`);
