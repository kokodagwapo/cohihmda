import { Card, CardContent } from '@/components/ui/card';
import type { RecommendedActionsProps } from '@/types/cohiResponsePlan';
import { CheckCircle2, ArrowRight } from 'lucide-react';

export function ActionsPanel({ props }: { props: RecommendedActionsProps }) {
  const { actions } = props;
  if (!actions?.length) return null;
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-foreground">Recommended next actions</h4>
      <ul className="space-y-3">
        {actions.map((action, i) => (
          <li key={i}>
            <Card className="border-border/60 bg-card">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-medium text-foreground">{action.title}</p>
                    {action.reason && (
                      <p className="text-xs text-muted-foreground">{action.reason}</p>
                    )}
                    {action.impact && (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium">Impact:</span> {action.impact}
                      </p>
                    )}
                    {action.nextStep && (
                      <p className="text-xs text-primary flex items-center gap-1 mt-1">
                        <ArrowRight className="h-3 w-3" />
                        {action.nextStep}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
