import React, { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type FunnelPeriod = 'wtd' | 'mtd' | 'qtr' | 'ytd';

/** Scales synthetic funnel / cohort numbers for the selected reporting window */
export const FUNNEL_PERIOD_SCALE: Record<FunnelPeriod, number> = {
  wtd: 0.22,
  mtd: 1,
  qtr: 2.65,
  ytd: 3.25,
};

type Ctx = {
  funnelPeriod: FunnelPeriod;
  setFunnelPeriod: (p: FunnelPeriod) => void;
};

const FunnelPeriodContext = createContext<Ctx | null>(null);

export function FunnelPeriodProvider({ children }: { children: ReactNode }) {
  const [funnelPeriod, setFunnelPeriodState] = useState<FunnelPeriod>('mtd');
  const setFunnelPeriod = useCallback((p: FunnelPeriod) => {
    setFunnelPeriodState(p);
  }, []);
  const value = useMemo(() => ({ funnelPeriod, setFunnelPeriod }), [funnelPeriod, setFunnelPeriod]);
  return <FunnelPeriodContext.Provider value={value}>{children}</FunnelPeriodContext.Provider>;
}

export function useFunnelPeriod(): Ctx {
  const ctx = useContext(FunnelPeriodContext);
  if (!ctx) {
    throw new Error('useFunnelPeriod must be used within FunnelPeriodProvider');
  }
  return ctx;
}
