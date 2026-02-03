/**
 * Utility functions to transform loan data from the current project's format
 * to the format expected by LoanCardsContainer and related components
 */

export interface RiskSummary {
  risks: string[];
  positives: string[];
  overallRisk: string;
  predictedOutcome: 'originate' | 'withdraw' | 'deny' | 'at_risk';
  confidence: number;
}

export interface LoanCard {
  id: string;
  loan_number?: string | null;
  officer: string;
  amount: string;
  amountValue?: number;
  riskLevel: string;
  riskScore: number;
  reason: string;
  ficoScore: number | null;
  ltvRatio: number | null;
  dtiRatio: number | null;
  loanType?: string | null;
  // Milestone and time in motion
  currentMilestone?: string | null;
  activeDays?: number | null;
  // Rates and market
  interestRate?: number | null;
  marketRate?: number | null;
  marketChangeDelta?: number | null;
  // Pullthrough percentages
  loPullthroughPct?: number | null;
  uwPullthroughPct?: number | null;
  closerPullthroughPct?: number | null;
  processorPullthroughPct?: number | null;
  // Rule-based risk summary from backend
  riskSummary?: RiskSummary | null;
  // Persona/Actor fields
  underwriter?: string | null;
  closer?: string | null;
  processor?: string | null;
  accountExecutive?: string | null;
  // Composite signal bucket scores
  creditMetricsSignalStrength?: number | null;
  loanCharacteristicsSignalStrength?: number | null;
  timeInMotionSignalStrength?: number | null;
  mloAeFalloutProneSignalStrength?: number | null;
  interestLockVsMarketSignalStrength?: number | null;
  uwPullthroughSignalStrength?: number | null;
  closerPullthroughSignalStrength?: number | null;
  processorPullthroughSignalStrength?: number | null;
  // Individual signal buckets
  ficoScoreSignal?: number | null;
  ltvSignal?: number | null;
  dtiSignal?: number | null;
  loPullthroughSignal?: number | null;
  marketChangeDeltaSignal?: number | null;
}

export interface LoanOfficerData {
  name: string;
  activeLoans: number;
  pullThrough: string;
  volume: string;
  risk: 'Low' | 'Medium' | 'High';
}

function asNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[$,%]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function getMetricFromLoan(loan: any, keys: string[]): number | null {
  for (const k of keys) {
    const direct = asNumber(loan?.[k]);
    if (direct !== null) return direct;
  }
  const md = loan?.metadata;
  if (md && typeof md === 'object') {
    for (const k of keys) {
      const fromMd = asNumber((md as any)?.[k]);
      if (fromMd !== null) return fromMd;
    }
  }
  return null;
}

/**
 * Calculate risk level based on loan metrics
 */
export function calculateRiskLevel(
  ficoScore: number | null,
  ltvRatio: number | null,
  dtiRatio: number | null,
  status?: string
): { level: string; score: number; reason: string } {
  // Higher score = higher risk (0-100)
  let riskScore = 0;
  const reasons: Array<{ reason: string; weight: number }> = [];

  // FICO Score impact
  if (ficoScore !== null) {
    if (ficoScore < 620) {
      riskScore += 40;
      reasons.push({ reason: 'High-risk FICO (<620)', weight: 40 });
    } else if (ficoScore < 700) {
      riskScore += 20;
      reasons.push({ reason: 'FICO 620–699 needs monitoring', weight: 20 });
    } else if (ficoScore >= 750) {
      riskScore -= 10;
    }
  }

  // LTV Ratio impact
  if (ltvRatio !== null) {
    if (ltvRatio > 95) {
      riskScore += 35;
      reasons.push({ reason: 'Very high LTV (>95%)', weight: 35 });
    } else if (ltvRatio > 80) {
      riskScore += 15;
      reasons.push({ reason: 'Elevated LTV (80–95%)', weight: 15 });
    } else if (ltvRatio <= 70) {
      riskScore -= 5;
    }
  }

  // DTI Ratio impact
  if (dtiRatio !== null) {
    if (dtiRatio > 43) {
      riskScore += 30;
      reasons.push({ reason: 'High DTI (>43%)', weight: 30 });
    } else if (dtiRatio > 36) {
      riskScore += 15;
      reasons.push({ reason: 'DTI 36–43% approaching threshold', weight: 15 });
    } else if (dtiRatio <= 30) {
      riskScore -= 5;
    }
  }

  // Status impact
  if (status) {
    const statusLower = status.toLowerCase();
    if (statusLower.includes('withdrawn') || statusLower.includes('cancelled')) {
      riskScore += 50;
      reasons.push({ reason: 'Withdrawn/cancelled', weight: 50 });
    } else if (statusLower.includes('declined') || statusLower.includes('denied')) {
      riskScore += 60;
      reasons.push({ reason: 'Denied/declined', weight: 60 });
    } else if (statusLower.includes('approved') || statusLower.includes('cleared')) {
      riskScore -= 10;
    }
  }

  // Normalize risk score to 0-100
  riskScore = Math.max(0, Math.min(100, riskScore));

  // Determine risk level
  let level: string;
  if (riskScore >= 70) {
    level = 'Very High';
  } else if (riskScore >= 40) {
    level = 'Medium';
  } else {
    level = 'Low';
  }

  const reason = reasons.length > 0
    ? reasons
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 2)
        .map((r) => r.reason)
        .join('; ')
    : 'No major risk factors identified';

  return { level, score: riskScore, reason };
}

/**
 * Transform loan data from API format to LoanCard format
 */
export function transformLoanToCard(loan: any): LoanCard {
  const fico = getMetricFromLoan(loan, ['fico_score', 'ficoScore', 'fico']);
  const ltv = getMetricFromLoan(loan, ['ltv', 'ltvRatio', 'ltv_ratio']);
  const dti = getMetricFromLoan(loan, ['dti', 'dtiRatio', 'dti_ratio']);

  const { level, score, reason } = calculateRiskLevel(
    fico,
    ltv,
    dti,
    loan.status
  );

  const amount = loan.loan_amount ?? loan.amount ?? 0;
  const amountValue = typeof amount === 'string' 
    ? parseFloat(amount.replace(/[$,]/g, '')) 
    : amount;

  const formatAmount = (val: number): string => {
    if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `$${(val / 1000).toFixed(0)}K`;
    return `$${val.toFixed(0)}`;
  };

  // Get loan ID/GUID - prioritize loan_id from database (from CSV), then check metadata/raw_data for guid
  // The database stores loan_id from CSV upload, which should be the real GUID
  let metadata: any = {};
  let rawData: any = {};
  
  try {
    metadata = typeof loan.metadata === 'string' ? JSON.parse(loan.metadata) : (loan.metadata || {});
  } catch (e) {
    metadata = loan.metadata || {};
  }
  
  try {
    rawData = typeof loan.raw_data === 'string' ? JSON.parse(loan.raw_data) : (loan.raw_data || {});
  } catch (e) {
    rawData = loan.raw_data || {};
  }
  
  // Priority: loan_id (from DB/CSV - this is the real GUID from CSV) > guid (from metadata/raw_data) > id
  const loanId = loan.loan_id ?? 
                 loan.guid ?? 
                 metadata.guid ?? 
                 metadata.loan_id ??
                 rawData.guid ?? 
                 rawData.loan_id ??
                 loan.id ?? 
                 'UNKNOWN';

  // Human-readable loan number (for display) - differs from GUID
  const loanNumber = loan.loan_number ?? loan.loanNumber ?? metadata.loan_number ?? rawData.loan_number ?? null;
  
  // For display, use full loan_id if it's a real GUID (not auto-generated), otherwise truncate
  const isRealGuid = typeof loanId === 'string' && (
    loanId.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i) ||
    (loanId.length > 20 && !loanId.startsWith('AUTO-'))
  );
  
  // If it's a real GUID, show it fully (or at least more of it). If auto-generated, truncate to 8 chars
  const loanIdDisplay = isRealGuid 
    ? loanId.toUpperCase() // Show full GUID if it's a real one from CSV
    : (typeof loanId === 'string' && loanId.length > 8 
        ? loanId.substring(0, 8).toUpperCase() 
        : (typeof loanId === 'string' ? loanId.toUpperCase() : 'UNKNOWN'));
  
  // Get loan officer name for fallback
  const loanOfficerName = loan.loan_officer_name ?? loan.officer ?? loan.loName ?? 'Unassigned';
  
  // Get borrower name, but if it looks auto-generated (starts with "AUTO-" or is a GUID-like string), use loan ID instead
  // If borrower is Unknown or missing, use loan officer name instead
  const rawBorrower = loan.borrower_name ?? loan.borrower ?? 'Unknown';
  const isAutoGenerated = typeof rawBorrower === 'string' && (
    rawBorrower.startsWith('AUTO-') || 
    rawBorrower.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i) ||
    rawBorrower.match(/^[a-z0-9]{20,}$/i) // Long alphanumeric strings (likely GUIDs)
  );
  
  let borrower: string;
  if (isAutoGenerated) {
    borrower = loanIdDisplay;
  } else if (rawBorrower === 'Unknown' || !rawBorrower || rawBorrower.trim() === '') {
    // If no borrower name, use loan officer name (or loan ID if officer is also unassigned)
    borrower = loanOfficerName !== 'Unassigned' ? loanOfficerName : loanIdDisplay;
  } else {
    borrower = rawBorrower;
  }

  // Extract persona/actor fields from loan data, metadata, or raw_data
  // Check multiple field name variations based on LOS field library aliases
  const getPersonaField = (fieldName: string, aliases: string[]): string | null => {
    // Check direct field access first
    if (loan[fieldName]) return loan[fieldName];
    
    // Check metadata
    if (metadata[fieldName]) return metadata[fieldName];
    for (const alias of aliases) {
      if (metadata[alias]) return metadata[alias];
    }
    
    // Check raw_data
    if (rawData[fieldName]) return rawData[fieldName];
    for (const alias of aliases) {
      if (rawData[alias]) return rawData[alias];
    }
    
    return null;
  };

  const underwriter = getPersonaField('underwriter_name', [
    'underwriter', 'underwriterName', 'uw_name', 'uwName', 
    'assigned_underwriter', 'assignedUnderwriter'
  ]);
  
  const closer = getPersonaField('closer', [
    'closer_name', 'closerName', 'assigned_closer', 'assignedCloser'
  ]);
  
  const processor = getPersonaField('processor', [
    'processor_name', 'processorName', 'assigned_processor', 'assignedProcessor'
  ]);
  
  const accountExecutive = getPersonaField('account_executive', [
    'accountExecutive', 'ae', 'ae_name', 'aeName', 
    'sales_rep', 'salesRep', 'sales_rep_ae', 'salesRepAe'
  ]);

  return {
    id: String(loanId),
    loan_number: loanNumber,
    officer: loan.loan_officer_name ?? loan.officer ?? loan.loName ?? 'Unassigned',
    amount: formatAmount(amountValue),
    amountValue,
    riskLevel: level,
    riskScore: score,
    reason,
    ficoScore: fico,
    ltvRatio: ltv,
    dtiRatio: dti,
    underwriter: underwriter || null,
    closer: closer || null,
    processor: processor || null,
    accountExecutive: accountExecutive || null,
    // Signal bucket scores (if available from prediction data)
    creditMetricsSignalStrength: loan.creditMetricsSignalStrength ?? null,
    loanCharacteristicsSignalStrength: loan.loanCharacteristicsSignalStrength ?? null,
    timeInMotionSignalStrength: loan.timeInMotionSignalStrength ?? null,
    mloAeFalloutProneSignalStrength: loan.mloAeFalloutProneSignalStrength ?? null,
    interestLockVsMarketSignalStrength: loan.interestLockVsMarketSignalStrength ?? null,
    loanType: loan.loan_type ?? loan.loanType ?? null,
  };
}

/**
 * Aggregate loan data by loan officer
 */
export function aggregateLoanOfficers(loans: LoanCard[]): LoanOfficerData[] {
  const officerMap = new Map<string, {
    loans: LoanCard[];
    activeCount: number;
    totalVolume: number;
  }>();

  loans.forEach(loan => {
    const officer = loan.officer;
    if (!officer || officer === 'Unassigned') return;

    if (!officerMap.has(officer)) {
      officerMap.set(officer, {
        loans: [],
        activeCount: 0,
        totalVolume: 0
      });
    }

    const data = officerMap.get(officer)!;
    data.loans.push(loan);
    data.activeCount++;
    data.totalVolume += loan.amountValue ?? 0;
  });

  return Array.from(officerMap.entries())
    .map(([name, data]) => {
      const closedCount = data.loans.filter(l => l.riskLevel === 'Low').length;
      const pullThrough = data.activeCount > 0
        ? `${Math.round((closedCount / data.activeCount) * 100)}%`
        : '0%';

      const highRiskCount = data.loans.filter(l => l.riskLevel === 'Very High').length;
      const risk: 'Low' | 'Medium' | 'High' = highRiskCount > 3
        ? 'High'
        : highRiskCount > 1
          ? 'Medium'
          : 'Low';

      const formatVolume = (val: number): string => {
        if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
        if (val >= 1000) return `$${(val / 1000).toFixed(0)}K`;
        return `$${val.toFixed(0)}`;
      };

      return {
        name,
        activeLoans: data.activeCount,
        pullThrough,
        volume: formatVolume(data.totalVolume),
        risk
      };
    })
    .sort((a, b) => {
      const aVol = parseFloat(a.volume.replace(/[$,KM]/g, '')) * (a.volume.includes('M') ? 1000000 : 1000);
      const bVol = parseFloat(b.volume.replace(/[$,KM]/g, '')) * (b.volume.includes('M') ? 1000000 : 1000);
      return bVol - aVol;
    });
}
