# Data Flow Analysis - Channel Filtering Issue

## Data Loading Sequence

1. **ODAG Loan Data.qvs** (included file)
   - Loads data from QVD files: `$(vSource).$(vReadTableName).L2.qvd`
   - Creates/concatenates to table: `$(vWriteTableName)` (typically `Coheus_Input`)
   - **NO filtering on Channel** - loads all data from QVD

2. **ODAG LoanData.qvs** (Scripts folder)
   - Runs AFTER ODAG Loan Data.qvs
   - Filters `$(vWriteTableName)` based on `vConsolidatedChannels`
   - **THIS IS WHERE FILTERING HAPPENS**

## Current Issue

The Channel field list only shows 2 channels instead of 5, even after fixing the WHERE clause.

## Possible Causes

1. **QVD files only contain 2 channels** - Check if the source QVD files have all 5 channels
2. **Filtering happening before ODAG LoanData.qvs** - Check if any script runs between ODAG Loan Data.qvs and ODAG LoanData.qvs
3. **The IF statement isn't working** - Verify `vConsolidatedChannels` is actually set to 'All' when the script runs
4. **Data already filtered in QVD** - The L2 QVD files might be pre-filtered

## Debugging Steps

1. Add trace statements to verify `vConsolidatedChannels` value
2. Check record counts before and after filtering in ODAG LoanData.qvs
3. Verify QVD files contain all 5 channels
4. Check if any other scripts modify `Coheus_Input` between ODAG Loan Data.qvs and ODAG LoanData.qvs
