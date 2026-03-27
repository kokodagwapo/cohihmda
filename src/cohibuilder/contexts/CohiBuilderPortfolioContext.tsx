import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  loadBuilderImportRows,
  recordBuilderImportEvent,
  reconcileMergeBuilderImportRows,
  replaceBuilderImportRows,
  type ApplyImportMeta,
  type ApplyImportResult,
  type BuilderImportRow,
} from '../data/builderImportFields';
import {
  buildPortfolioBundleFromImportRows,
  defaultPortfolioBundle,
  emptyPortfolioBundle,
  type CohiPortfolioBundle,
} from '../data/portfolioFromBuilderImport';
import { tollBrotherBacklogImportRows } from '../data/tollBrotherBacklogSeed';

export type CohiBuilderPortfolioSource = 'mock' | 'import' | 'api';

/** When set, local refresh keeps an empty portfolio instead of re-seeding Toll backlog (no API / after reset). */
const PORTFOLIO_PREFER_EMPTY_KEY = 'cohi:builder-portfolio-prefer-empty';

type Ctx = CohiPortfolioBundle & {
  source: CohiBuilderPortfolioSource;
  importRowCount: number;
  refresh: () => Promise<void>;
  /** Replace or merge portfolio rows locally + on server when signed in. */
  applyImportRows: (rows: BuilderImportRow[], meta?: ApplyImportMeta) => Promise<ApplyImportResult>;
  /** Clear import rows locally and persist [] when authenticated. */
  clearImportedPortfolio: () => Promise<void>;
  /** Clear import and show an empty portfolio (zeros) until upload or restore. */
  resetPortfolioToZero: () => Promise<void>;
};

const CohiBuilderPortfolioContext = createContext<Ctx | null>(null);

type ApiPortfolioFetch = { rows: BuilderImportRow[] } | null;

/** When Postgres responded with `persisted`, empty `importRows` still wins over stale localStorage. */
async function fetchPortfolioFromApi(): Promise<ApiPortfolioFetch> {
  try {
    const r = await fetch('/api/cohibuilder/portfolio', { credentials: 'include' });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      importRows?: BuilderImportRow[];
      persisted?: boolean;
    };
    if (!Array.isArray(j.importRows)) return null;
    if (j.importRows.length > 0) return { rows: j.importRows };
    if (j.persisted === true) return { rows: [] };
  } catch {
    /* offline or proxy down */
  }
  return null;
}

async function persistPortfolioToApi(rows: BuilderImportRow[]): Promise<boolean> {
  try {
    const r = await fetch('/api/cohibuilder/portfolio', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ importRows: rows }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export function CohiBuilderPortfolioProvider({ children }: { children: React.ReactNode }) {
  const [bundle, setBundle] = useState<CohiPortfolioBundle>(() => defaultPortfolioBundle());
  const [source, setSource] = useState<CohiBuilderPortfolioSource>('import');
  const [importRowCount, setImportRowCount] = useState(() => tollBrotherBacklogImportRows.length);

  const refresh = useCallback(async () => {
    const api = await fetchPortfolioFromApi();
    if (api) {
      replaceBuilderImportRows(api.rows);
      if (api.rows.length > 0) {
        localStorage.removeItem(PORTFOLIO_PREFER_EMPTY_KEY);
        setBundle(buildPortfolioBundleFromImportRows(api.rows));
        setSource('api');
      } else {
        localStorage.setItem(PORTFOLIO_PREFER_EMPTY_KEY, '1');
        setBundle(emptyPortfolioBundle());
        setSource('mock');
      }
      setImportRowCount(api.rows.length);
      return;
    }
    const local = loadBuilderImportRows();
    if (local.length > 0) {
      localStorage.removeItem(PORTFOLIO_PREFER_EMPTY_KEY);
      setBundle(buildPortfolioBundleFromImportRows(local));
      setSource('import');
      setImportRowCount(local.length);
      return;
    }
    if (localStorage.getItem(PORTFOLIO_PREFER_EMPTY_KEY) === '1') {
      setBundle(emptyPortfolioBundle());
      setSource('mock');
      setImportRowCount(0);
      return;
    }
    replaceBuilderImportRows(tollBrotherBacklogImportRows);
    setBundle(buildPortfolioBundleFromImportRows(tollBrotherBacklogImportRows));
    setSource('import');
    setImportRowCount(tollBrotherBacklogImportRows.length);
  }, []);

  const applyImportRows = useCallback(async (rows: BuilderImportRow[], meta?: ApplyImportMeta) => {
    const mode = meta?.mode ?? 'replace';
    let finalRows = rows;
    let merge:
      | { added: number; skippedDuplicate: number; incomingCount: number; finalRowCount: number }
      | undefined;

    if (mode === 'merge_new' && rows.length > 0) {
      const existing = loadBuilderImportRows();
      const rec = reconcileMergeBuilderImportRows(existing, rows);
      finalRows = rec.merged;
      merge = {
        added: rec.added,
        skippedDuplicate: rec.skippedDuplicate,
        incomingCount: rows.length,
        finalRowCount: rec.merged.length,
      };
    }

    replaceBuilderImportRows(finalRows);
    if (finalRows.length > 0) {
      localStorage.removeItem(PORTFOLIO_PREFER_EMPTY_KEY);
      setBundle(buildPortfolioBundleFromImportRows(finalRows));
      setSource('import');
    } else {
      localStorage.setItem(PORTFOLIO_PREFER_EMPTY_KEY, '1');
      setBundle(emptyPortfolioBundle());
      setSource('mock');
    }
    setImportRowCount(finalRows.length);
    const saved = await persistPortfolioToApi(finalRows);
    if (saved) setSource(finalRows.length > 0 ? 'api' : 'mock');

    const defaultLabel =
      merge != null
        ? `Merge +${merge.added} new, ${merge.skippedDuplicate} duplicate(s) skipped (${merge.finalRowCount} rows)`
        : finalRows.length > 0
          ? 'Portfolio updated'
          : 'Portfolio cleared (empty)';

    recordBuilderImportEvent({
      rows: finalRows,
      fileName: meta?.fileName,
      sourceLabel: meta?.sourceLabel ?? defaultLabel,
      persistSnapshot: meta?.persistSnapshot,
    });
    return { saved, merge };
  }, []);

  const clearImportedPortfolio = useCallback(async () => {
    localStorage.removeItem(PORTFOLIO_PREFER_EMPTY_KEY);
    replaceBuilderImportRows(tollBrotherBacklogImportRows);
    setBundle(defaultPortfolioBundle());
    setSource('import');
    setImportRowCount(tollBrotherBacklogImportRows.length);
    await persistPortfolioToApi(tollBrotherBacklogImportRows);
    recordBuilderImportEvent({
      rows: tollBrotherBacklogImportRows,
      sourceLabel: 'Restore Data (seed portfolio)',
      persistSnapshot: false,
    });
  }, []);

  const resetPortfolioToZero = useCallback(async () => {
    localStorage.setItem(PORTFOLIO_PREFER_EMPTY_KEY, '1');
    replaceBuilderImportRows([]);
    setBundle(emptyPortfolioBundle());
    setSource('mock');
    setImportRowCount(0);
    await persistPortfolioToApi([]);
    recordBuilderImportEvent({
      rows: [],
      sourceLabel: 'Reset Data',
      persistSnapshot: false,
    });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<Ctx>(
    () => ({
      ...bundle,
      source,
      importRowCount,
      refresh,
      applyImportRows,
      clearImportedPortfolio,
      resetPortfolioToZero,
    }),
    [bundle, source, importRowCount, refresh, applyImportRows, clearImportedPortfolio, resetPortfolioToZero],
  );

  return (
    <CohiBuilderPortfolioContext.Provider value={value}>{children}</CohiBuilderPortfolioContext.Provider>
  );
}

export function useCohiBuilderPortfolio(): Ctx {
  const ctx = useContext(CohiBuilderPortfolioContext);
  if (!ctx) {
    const d = defaultPortfolioBundle();
    return {
      ...d,
      source: 'import',
      importRowCount: tollBrotherBacklogImportRows.length,
      refresh: async () => {},
      applyImportRows: async () => ({ saved: false }),
      clearImportedPortfolio: async () => {},
      resetPortfolioToZero: async () => {},
    };
  }
  return ctx;
}
