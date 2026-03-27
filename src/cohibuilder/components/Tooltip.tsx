import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';

export type TooltipBubbleVariant = 'dark' | 'sky' | 'emerald' | 'amber' | 'rose';

interface TooltipProps {
  text: string;
  children: React.ReactNode;
  /** Pastel bubbles for KPI cards; default is a frosted light panel with dark text (inverts sensibly in dark mode). */
  variant?: TooltipBubbleVariant;
}

const VARIANT_STYLES: Record<
  TooltipBubbleVariant,
  { panel: string; title: string; body: string; arrowTop: string; arrowBottom: string }
> = {
  dark: {
    panel:
      'bg-white/[0.97] text-slate-900 border border-slate-200/[0.9] shadow-[0_20px_50px_-14px_rgba(15,23,42,0.22),0_0_0_1px_rgba(15,23,42,0.04)] backdrop-blur-xl backdrop-saturate-150 dark:bg-slate-950/[0.97] dark:text-slate-100 dark:border-slate-600/70 dark:shadow-[0_24px_56px_-12px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.06)]',
    title: 'text-slate-900 font-semibold tracking-tight dark:text-slate-50',
    body: 'text-slate-700 dark:text-slate-300',
    arrowTop: 'border-t-white/[0.97] dark:border-t-slate-950/[0.97]',
    arrowBottom: 'border-b-white/[0.97] dark:border-b-slate-950/[0.97]',
  },
  sky: {
    panel:
      'bg-sky-50/[0.98] text-slate-900 border border-sky-300/50 shadow-[0_16px_44px_-12px_rgba(12,74,110,0.18)] backdrop-blur-xl backdrop-saturate-150 dark:bg-sky-950/92 dark:text-slate-100 dark:border-sky-700/55 dark:shadow-black/35',
    title: 'text-slate-900 font-semibold tracking-tight dark:text-sky-50',
    body: 'text-slate-700 dark:text-sky-100/90',
    arrowTop: 'border-t-sky-50/[0.98] dark:border-t-sky-950/92',
    arrowBottom: 'border-b-sky-50/[0.98] dark:border-b-sky-950/92',
  },
  emerald: {
    panel:
      'bg-emerald-50/[0.98] text-slate-900 border border-emerald-300/45 shadow-[0_16px_44px_-12px_rgba(6,78,59,0.14)] backdrop-blur-xl backdrop-saturate-150 dark:bg-emerald-950/90 dark:text-emerald-50 dark:border-emerald-800/55 dark:shadow-black/35',
    title: 'text-slate-900 font-semibold tracking-tight dark:text-emerald-50',
    body: 'text-slate-700 dark:text-emerald-100/90',
    arrowTop: 'border-t-emerald-50/[0.98] dark:border-t-emerald-950/90',
    arrowBottom: 'border-b-emerald-50/[0.98] dark:border-b-emerald-950/90',
  },
  amber: {
    panel:
      'bg-amber-50/[0.98] text-slate-900 border border-amber-300/45 shadow-[0_16px_44px_-12px_rgba(120,53,15,0.12)] backdrop-blur-xl backdrop-saturate-150 dark:bg-amber-950/90 dark:text-amber-50 dark:border-amber-800/50 dark:shadow-black/35',
    title: 'text-slate-900 font-semibold tracking-tight dark:text-amber-50',
    body: 'text-slate-700 dark:text-amber-100/90',
    arrowTop: 'border-t-amber-50/[0.98] dark:border-t-amber-950/90',
    arrowBottom: 'border-b-amber-50/[0.98] dark:border-b-amber-950/90',
  },
  rose: {
    panel:
      'bg-rose-50/[0.98] text-slate-900 border border-rose-300/45 shadow-[0_16px_44px_-12px_rgba(136,19,55,0.12)] backdrop-blur-xl backdrop-saturate-150 dark:bg-rose-950/90 dark:text-rose-50 dark:border-rose-800/50 dark:shadow-black/35',
    title: 'text-slate-900 font-semibold tracking-tight dark:text-rose-50',
    body: 'text-slate-700 dark:text-rose-100/90',
    arrowTop: 'border-t-rose-50/[0.98] dark:border-t-rose-950/90',
    arrowBottom: 'border-b-rose-50/[0.98] dark:border-b-rose-950/90',
  },
};

function TooltipRichText({ text, variant }: { text: string; variant: TooltipBubbleVariant }) {
  const blocks = text
    .split(/\n\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const s = VARIANT_STYLES[variant];
  if (blocks.length === 0) return null;
  if (blocks.length === 1) {
    return <p className={`text-[13px] leading-relaxed font-medium ${s.body}`}>{blocks[0]}</p>;
  }
  const [title, ...rest] = blocks;
  return (
    <div className="space-y-2">
      <p className={`text-[13px] leading-snug tracking-tight ${s.title}`}>{title}</p>
      {rest.map((para, i) => (
        <p key={i} className={`text-[12px] leading-relaxed font-medium ${s.body}`}>
          {para}
        </p>
      ))}
    </div>
  );
}

export default function Tooltip({ text, children, variant = 'dark' }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const anchorRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; placement: 'top' | 'bottom' } | null>(null);
  const hideTimer = useRef<number | null>(null);

  const setAnchorRef = (node: HTMLElement | null) => {
    anchorRef.current = node;
  };

  const compose =
    <E,>(a?: (e: E) => void, b?: (e: E) => void) =>
    (e: E) => {
      a?.(e);
      b?.(e);
    };

  const computePos = () => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const rawCenterX = rect.left + rect.width / 2;
    const preferTop = rect.top > 120;

    const tooltipWidth = tooltipRef.current?.getBoundingClientRect().width ?? 300;
    const margin = 12;
    const minCenter = margin + tooltipWidth / 2;
    const maxCenter = window.innerWidth - margin - tooltipWidth / 2;
    const centerX = Math.max(minCenter, Math.min(maxCenter, rawCenterX));

    const gap = 12;
    const top = preferTop ? rect.top - gap : rect.bottom + gap;
    setPos({
      left: centerX,
      top,
      placement: preferTop ? 'top' : 'bottom',
    });
  };

  useEffect(() => {
    if (!isVisible) return;
    computePos();
    const onMove = () => computePos();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible]);

  const portalNode = useMemo(() => (typeof document === 'undefined' ? null : document.body), []);
  const vs = VARIANT_STYLES[variant];

  if (!React.isValidElement(children)) return <>{children}</>;

  const child = children as React.ReactElement<{
    onMouseEnter?: (e: React.MouseEvent) => void;
    onMouseLeave?: (e: React.MouseEvent) => void;
    onFocus?: (e: React.FocusEvent) => void;
    onBlur?: (e: React.FocusEvent) => void;
    ref?: unknown;
  }>;

  const wrapped = React.cloneElement(child, {
    ref: (node: HTMLElement | null) => {
      setAnchorRef(node);
      const originalRef: any = (child as any).ref;
      if (typeof originalRef === 'function') originalRef(node);
      else if (originalRef && typeof originalRef === 'object') originalRef.current = node;
    },
    onMouseEnter: compose(child.props.onMouseEnter, () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      setIsVisible(true);
      computePos();
    }),
    onMouseLeave: compose(child.props.onMouseLeave, () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setIsVisible(false), 80);
    }),
    onFocus: compose(child.props.onFocus, () => {
      setIsVisible(true);
      computePos();
    }),
    onBlur: compose(child.props.onBlur, () => setIsVisible(false)),
  });

  return (
    <>
      {wrapped}
      <AnimatePresence>
        {isVisible &&
          pos &&
          portalNode &&
          createPortal(
            <motion.div
              ref={tooltipRef}
              initial={{ opacity: 0, y: pos.placement === 'top' ? 4 : -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className={`fixed z-[var(--z-tooltip)] max-w-[min(22rem,calc(100vw-2rem))] min-w-[14rem] whitespace-normal rounded-[14px] px-4 py-3.5 pointer-events-none ${vs.panel}`}
              style={{
                left: pos.left,
                top: pos.top,
                transform: pos.placement === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
              }}
            >
              <TooltipRichText text={text} variant={variant} />
              {pos.placement === 'top' ? (
                <div
                  className={`absolute top-full left-1/2 -translate-x-1/2 border-[7px] border-transparent ${vs.arrowTop}`}
                  aria-hidden
                />
              ) : (
                <div
                  className={`absolute bottom-full left-1/2 -translate-x-1/2 border-[7px] border-transparent ${vs.arrowBottom}`}
                  aria-hidden
                />
              )}
            </motion.div>,
            portalNode,
          )}
      </AnimatePresence>
    </>
  );
}
