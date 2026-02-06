import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { AnomaliesAndRisksProps } from '@/types/cohiResponsePlan';
import { AlertTriangle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export function AnomaliesAndRisks({ props }: { props: AnomaliesAndRisksProps }) {
  const { items } = props;
  if (!items?.length) return null;
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-foreground">Anomalies & risks</h4>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i}>
            <Card className="border-border/60 bg-muted/20">
              <CardContent className="p-3 flex items-start gap-3">
                {item.severity === 'high' ? (
                  <AlertCircle className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{item.title}</p>
                  {item.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                  )}
                  {item.severity && (
                    <Badge
                      variant={item.severity === 'high' ? 'destructive' : 'secondary'}
                      className="mt-1.5 text-xs"
                    >
                      {item.severity}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
