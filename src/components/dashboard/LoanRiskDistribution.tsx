import React from 'react';

interface LoanRiskDistributionProps {
  ficoScore: number | null;
  ltvRatio: number | null;
  dtiRatio: number | null;
  isDarkMode?: boolean;
}

export const LoanRiskDistribution: React.FC<LoanRiskDistributionProps> = ({
  ficoScore,
  ltvRatio,
  dtiRatio,
  isDarkMode = false
}) => {
  const hasFico = ficoScore != null && ficoScore > 0;
  const hasLtv = ltvRatio != null && ltvRatio > 0;
  const hasDti = dtiRatio != null && dtiRatio > 0;
  
  if (!hasFico && !hasLtv && !hasDti) {
    return null;
  }

  const getFicoColor = (score: number) => {
    if (score < 640) return 'text-rose-500';
    if (score < 700) return 'text-amber-500';
    return 'text-emerald-500';
  };

  const getLtvColor = (ratio: number) => {
    if (ratio > 95) return 'text-rose-500';
    if (ratio > 80) return 'text-amber-500';
    return 'text-emerald-500';
  };

  const getDtiColor = (ratio: number) => {
    if (ratio > 50) return 'text-rose-500';
    if (ratio > 43) return 'text-amber-500';
    return 'text-emerald-500';
  };

  return (
    <div className={`mt-3 pt-3 border-t ${isDarkMode ? 'border-white/10' : 'border-slate-100'}`}>
      <div className="flex items-center gap-6">
        {hasFico && (
          <div className="text-center">
            <p className={`text-[9px] font-medium uppercase tracking-wide ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>FICO</p>
            <p className={`text-[14px] font-semibold tracking-tight ${getFicoColor(ficoScore!)}`}>{ficoScore}</p>
          </div>
        )}
        {hasLtv && (
          <div className="text-center">
            <p className={`text-[9px] font-medium uppercase tracking-wide ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>LTV</p>
            <p className={`text-[14px] font-semibold tracking-tight ${getLtvColor(ltvRatio!)}`}>{Math.round(Number(ltvRatio))}%</p>
          </div>
        )}
        {hasDti && (
          <div className="text-center">
            <p className={`text-[9px] font-medium uppercase tracking-wide ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>DTI</p>
            <p className={`text-[14px] font-semibold tracking-tight ${getDtiColor(dtiRatio!)}`}>{Math.round(Number(dtiRatio))}%</p>
          </div>
        )}
      </div>
    </div>
  );
};
