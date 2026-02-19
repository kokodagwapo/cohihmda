/**
 * Fallout services: historical rates, turn-time lookups, sequential scoring.
 * Numeric outcome profiles for similarity-based prediction.
 */

export { getHistoricalFalloutRates } from './historicalAggregationService.js';
export { getTurnTimeBaseline, getAvgApplicationToFundingDays } from './turnTimeProjectionService.js';
export { runFalloutSequencer } from './falloutSequencer.js';
export { runNumericOutcomeProfileDerivation } from './numericOutcomeProfileService.js';
export { runSegmentFalloutRates } from './segmentFalloutRateService.js';
export { getBlendedProfiles, getProfileForLoan } from './numericProfileBlendService.js';
export * from './falloutTypes.js';
