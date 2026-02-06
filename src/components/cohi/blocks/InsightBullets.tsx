import type { BulletInsightsProps } from '@/types/cohiResponsePlan';
import { CheckCircle2, AlertTriangle, Info, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

const iconMap = {
  success: CheckCircle2,
  warning: AlertTriangle,
  info: Info,
  neutral: Circle,
};

export function InsightBullets({ props }: { props: BulletInsightsProps }) {
  const { bullets } = props;
  if (!bullets?.length) return null;
  return (
    <ul className="space-y-1.5">
      {bullets.map((b, i) => {
        const Icon = iconMap[b.icon ?? 'neutral'];
        return (
          <li key={i} className="flex items-start gap-2">
            <Icon
              className={cn(
                'h-4 w-4 shrink-0 mt-0.5',
                b.icon === 'success' && 'text-emerald-500 dark:text-emerald-400',
                b.icon === 'warning' && 'text-amber-500 dark:text-amber-400',
                b.icon === 'info' && 'text-sky-500 dark:text-sky-400',
                (!b.icon || b.icon === 'neutral') && 'text-slate-400 dark:text-slate-500'
              )}
            />
            <span className="text-xs text-foreground leading-snug">{b.text}</span>
          </li>
        );
      })}
    </ul>
  );
}
