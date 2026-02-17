/**
 * Fallout / historical bucket risk types (BRD)
 * Status and bucket types used across historical aggregation, risk bands, and sequencer.
 */

export type FalloutStatusType = 'Denied' | 'Withdrawn' | 'ClosingLate';
export type ProjectedStatusType = 'Denied' | 'Withdrawn' | 'ClosingLate' | 'ProjectedToClose';
export type ProjectedCloseWindow = 'MTD' | 'NextMonth' | 'Rolling30' | 'Later';

export type MilestoneType = 'Lock' | 'CondAppr' | 'Appr' | 'CTC';
export type HumanRoleType = 'LO' | 'Processor' | 'Underwriter' | 'Closer';

export type RiskBandName = 'Low' | 'Medium' | 'High' | 'Critical';

/** Canonical bucket types for aggregation (BRD 1.4) */
export const BUCKET_TYPES = [
  'LoanType',
  'LoanPurpose',
  'Occupancy',
  'AverageFICO',
  'AverageLTV',
  'AverageDTI',
  'SelfEmployed',
  'DaysLoanActive',
  'DaysRemainingLockExpiration',
  'MarketRateVsLockedRate',
  'LoanOfficer',
  'Processor',
  'Underwriter',
  'Closer',
] as const;
export type BucketType = (typeof BUCKET_TYPES)[number];

export interface HistoricalBucketTotalRow {
  year: number;
  status_type: FalloutStatusType;
  bucket_type: string;
  bucket_value: string;
  loan_count: number;
  averages_json: Record<string, number>;
  calculated_at: Date;
}

export interface HistoricalBucketComboRow {
  year: number;
  status_type: FalloutStatusType;
  combo_key: string;
  dimensions_json: Record<string, string>;
  loan_count: number;
  rank: number;
  calculated_at: Date;
}

export interface RiskBandDefinitionRow {
  status_type: FalloutStatusType;
  bucket_type: string;
  band_name: RiskBandName;
  band_min: number | null;
  band_max: number | null;
  risk_score: number;
  derived_from_years: string | null;
  calculated_at: Date;
}

export interface TurnTimeBaselineRow {
  segment_key: string;
  milestone_type: MilestoneType;
  avg_days_to_fund: number;
  p50_days_to_fund: number | null;
  p75_days_to_fund: number | null;
  calculated_at: Date;
}

export interface HumanPatternStatsRow {
  role_type: HumanRoleType;
  role_id: string;
  status_type: FalloutStatusType;
  loan_count: number;
  rate: number;
  avg_days_to_fund: number | null;
  risk_multiplier: number;
  window_days: number | null;
  calculated_at: Date;
}

export interface LoanPredictionRow {
  loan_id: string;
  as_of_date: string;
  projected_status: ProjectedStatusType;
  confidence_score: number;
  reason_codes: Array<{ bucket_type: string; bucket_value: string; risk_score: number }>;
  projected_funding_date: string | null;
  projected_close_window: ProjectedCloseWindow | null;
  created_at: Date;
}

/** Normalized loan record for aggregation (with resolved status and bucket values) */
export interface NormalizedHistoricalLoan {
  loan_id: string;
  year: number;
  status_type: FalloutStatusType;
  buckets: Record<string, string>;
  /** For averages_json: fico, ltv, dti, days_active, etc. */
  numeric_values: Record<string, number>;
}

/** Segment for numeric outcome profiles (raw loan_type, loan_purpose, occupancy) */
export interface NumericProfileSegment {
  loan_type: string;
  loan_purpose: string;
  occupancy: string;
}

/** Blended feature stats (computed from yearly profiles, not persisted). Six zones: Zone1 P45–P55=6pts, Zone2 P40–P45 or P55–P60=5, Zone3 P30–P40 or P60–P70=4, Zone4 P20–P30 or P70–P80=3, Zone5 P10–P20 or P80–P90=2, Zone6 <P10 or >P90=1. */
export interface BlendedFeatureStats {
  blended_mean: number;
  blended_q1: number;
  blended_q3: number;
  blended_iqr: number;
  /** When set, zone scoring uses percentile bands; otherwise falls back to IQR. */
  blended_p10?: number;
  blended_p15?: number;
  blended_p20?: number;
  blended_p30?: number;
  blended_p35?: number;
  blended_p40?: number;
  blended_p45?: number;
  blended_p55?: number;
  blended_p60?: number;
  blended_p65?: number;
  blended_p70?: number;
  blended_p75?: number;
  blended_p80?: number;
  blended_p90?: number;
}

/** Status type for outcome profiles: Denied/Withdrawn/ClosingLate (fallout) + Originated (UI zones only). */
export type OutcomeProfileStatusType = FalloutStatusType | 'Originated';

/** Blended profile: status_type -> segmentKey (loan_type|loan_purpose|occupancy) -> feature_name -> stats */
export type BlendedProfileMap = Map<
  OutcomeProfileStatusType,
  Map<string, Map<string, BlendedFeatureStats>>
>;
