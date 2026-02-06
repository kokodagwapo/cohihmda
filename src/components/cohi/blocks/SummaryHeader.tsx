import type { HeaderSummaryProps } from '@/types/cohiResponsePlan';
import { Lightbulb, Target } from 'lucide-react';

export function SummaryHeader({ props }: { props: HeaderSummaryProps }) {
  const { whatIFound, whyItMatters } = props;
  return (
    <div className="rounded-lg border-0 bg-muted/10 dark:bg-muted/20 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <Target className="h-4 w-4 text-violet-500 dark:text-violet-400 shrink-0 mt-0.5" />
        <p className="text-xs text-foreground leading-snug">{whatIFound}</p>
      </div>
      {whyItMatters && (
        <div className="flex items-start gap-2">
          <Lightbulb className="h-4 w-4 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-foreground leading-snug">{whyItMatters}</p>
        </div>
      )}
    </div>
  );
}
