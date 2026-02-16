# Duplicate Field Aliases Fix

## Problem Summary

The tenant loan schema had duplicate date field mappings that could cause data conflicts during Encompass sync:

1. **Duplicate aliases mapping to the same field ID** (redundant but harmless):

   - `'Started Date': 'Fields.Log.MS.Date.Started'` → `started_date`
   - `'Started': 'Fields.Log.MS.Date.Started'` → `started` → aliased to `started_date`
   - Both map to the same Encompass field, so redundant

2. **Different field IDs mapping to the same column** (DATA CONFLICT):
   - `'Funding Date': 'Fields.MS.FUN'` → `funding_date` ✅ (USED IN BACKEND)
   - `'Funding': 'Fields.Log.MS.Date.Funding'` → `funding` → aliased to `funding_date` ❌
   - These are **different Encompass fields** but both resolve to `funding_date`, causing overwrites

## What "Update Field Mappings" Means

"Update field mappings" refers to modifying the `defaultEncompassFieldMappings.ts` file to:

- Remove duplicate/redundant aliases
- Fix conflicts where different Encompass field IDs map to the same database column
- Ensure each Encompass field ID maps to a unique column name

## Changes Made

### 1. Removed Duplicate Aliases

**Removed from `defaultEncompassFieldMappings.ts`:**

- `'Started': 'Fields.Log.MS.Date.Started'` (use `'Started Date'` instead)
- `'Funding': 'Fields.Log.MS.Date.Funding'` (use `'Funding Date'` instead - different field!)

**Kept:**

- `'Processing': 'Fields.Log.MS.Date.Processing'` (maps to different field than `'Submitted To Processing Date'`)

### 2. Migration Script Created

Created `server/scripts/migrate-duplicate-field-aliases.ts` to:

- Check for existing field swaps using short aliases
- Migrate them to use full "Date" aliases
- Report conflicts that need manual review

## Backend Column Usage (Verified)

All backend code correctly uses columns with `_date` suffix:

- ✅ `funding_date` - Used in 50+ places (metrics, scorecards, routes)
- ✅ `started_date` - Used in 20+ places (loans started metrics, filtering)
- ✅ `processing_date` - Used in processor turn time calculations
- ✅ `submitted_to_processing_date` - Used in operations scorecard

**No references found to:** `funding`, `started`, or `processing` columns without suffix.

## Migration Steps

1. **Run the migration script** to check for existing field swaps:

   ```bash
   npx tsx server/scripts/migrate-duplicate-field-aliases.ts
   ```

2. **Review any conflicts** reported by the script

3. **Field mappings already updated** - duplicates removed from `defaultEncompassFieldMappings.ts`

## Impact

- ✅ **No breaking changes** - Backend only uses `_date` suffixed columns
- ✅ **Prevents data conflicts** - Different Encompass fields no longer overwrite each other
- ✅ **Cleaner mappings** - Removed redundant aliases
- ⚠️ **Field swaps may need migration** - If any exist using short aliases, they'll be migrated automatically

## Field ID Conflicts Resolved

| Short Alias | Full Alias     | Short Field ID               | Full Field ID                | Resolution           |
| ----------- | -------------- | ---------------------------- | ---------------------------- | -------------------- |
| `Started`   | `Started Date` | `Fields.Log.MS.Date.Started` | `Fields.Log.MS.Date.Started` | ✅ Removed duplicate |
| `Funding`   | `Funding Date` | `Fields.Log.MS.Date.Funding` | `Fields.MS.FUN`              | ✅ Removed conflict  |

## Notes

- `'Processing'` alias was **kept** because it maps to `Fields.Log.MS.Date.Processing`, which is different from `'Submitted To Processing Date'` (`Fields.Log.MS.Date.Send To Processing`)
- These map to different columns (`processing_date` vs `submitted_to_processing_date`), so no conflict
