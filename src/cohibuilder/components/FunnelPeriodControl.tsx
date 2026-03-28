import { useEffect, useState, useCallback } from 'react';
import { useFunnelPeriod } from '../contexts/FunnelPeriodContext';
import Tooltip from './Tooltip';

const PERIODS = ['wtd', 'mtd', 'qtr', 'ytd'] as const;

const PERIOD_TOOLTIPS: Record<(typeof PERIODS)[number], string> = {
  wtd: 'Week to date — scales funnel and KPIs to a short recent window so you can spot near-term movement.',
  mtd: 'Month to date — default window; headline numbers follow the current calendar month cohort.',
  qtr: 'Quarter to date — broader pipeline read, scaled to roughly one quarter of activity.',
  ytd: 'Year to date — widest window for year-level volume and trend context.',
};
const HINT_INTERVAL_MS = 2600;

/**
 * WTD / MTD / QTR / YTD pill control — shared header control for Capture Analysis;
 * drives funnel scaling and copy across the Executive Overview dashboard.
 */
export function FunnelPeriodControl({ className = '' }: { className?: string }) {
  const { funnelPeriod, setFunnelPeriod } = useFunnelPeriod();
  const [hintIndex, setHintIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (reduceMotion || paused) return;
    const id = window.setInterval(() => {
      setHintIndex((prev) => {
        const selIdx = PERIODS.indexOf(funnelPeriod);
        let next = (prev + 1) % PERIODS.length;
        for (let g = 0; g < PERIODS.length && next === selIdx; g++) {
          next = (next + 1) % PERIODS.length;
        }
        return next;
      });
    }, HINT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [reduceMotion, paused, funnelPeriod]);

  const handleBlurContainer = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (!next || !e.currentTarget.contains(next)) setPaused(false);
  }, []);

  return (
    <div
      role="group"
      aria-label="Funnel reporting period"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={handleBlurContainer}
      className={`inline-flex shrink-0 rounded-full border border-slate-200/70 bg-slate-100/55 p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] backdrop-blur-md dark:border-slate-600/50 dark:bg-slate-900/50 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ${className}`.trim()}
    >
      {PERIODS.map((p, idx) => {
        const selected = funnelPeriod === p;
        const hinted =
          !reduceMotion && !paused && !selected && hintIndex === idx;

        return (
          <Tooltip key={p} text={PERIOD_TOOLTIPS[p]}>
            <button
              type="button"
              onClick={() => setFunnelPeriod(p)}
              className={[
                'min-w-[2.25rem] rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums tracking-wide',
                'transition-[color,background-color,box-shadow,backdrop-filter] duration-500 ease-out',
                selected
                  ? [
                      'relative z-[1] font-semibold',
                      'text-slate-900',
                      'bg-white backdrop-blur-lg',
                      'border border-slate-300/90',
                      'shadow-[0_2px_12px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.9)]',
                      'ring-1 ring-slate-900/10',
                      'dark:bg-white/95 dark:text-slate-950',
                      'dark:border-slate-400/50',
                      'dark:shadow-[0_2px_14px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.85)]',
                      'dark:ring-white/25',
                    ].join(' ')
                  : hinted
                    ? [
                        'text-slate-900 dark:text-cyan-50',
                        'bg-cyan-900/[0.14] dark:bg-cyan-950/55',
                        'shadow-[inset_0_0_0_1px_rgba(8,145,178,0.35)]',
                        'dark:shadow-[inset_0_0_0_1px_rgba(34,211,238,0.22)]',
                      ].join(' ')
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
              ].join(' ')}
            >
              {p.toUpperCase()}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
