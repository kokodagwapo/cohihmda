import React, { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Ctx = {
  /** Filter string shared with Layout header search when Portfolio Map is active */
  listFilter: string;
  setListFilter: (q: string) => void;
};

const PortfolioMapSearchContext = createContext<Ctx | null>(null);

export function PortfolioMapSearchProvider({ children }: { children: ReactNode }) {
  const [listFilter, setListFilterState] = useState('');
  const setListFilter = useCallback((q: string) => {
    setListFilterState(q);
  }, []);
  const value = useMemo(() => ({ listFilter, setListFilter }), [listFilter, setListFilter]);
  return <PortfolioMapSearchContext.Provider value={value}>{children}</PortfolioMapSearchContext.Provider>;
}

export function usePortfolioMapSearch(): Ctx {
  const ctx = useContext(PortfolioMapSearchContext);
  if (!ctx) {
    throw new Error('usePortfolioMapSearch must be used within PortfolioMapSearchProvider');
  }
  return ctx;
}
