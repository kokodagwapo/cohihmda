import { Card, CardContent } from '@/components/ui/card';
import type { ForecastAndScenariosProps } from '@/types/cohiResponsePlan';
import { TrendingUp } from 'lucide-react';

export function ForecastAndScenarios({ props }: { props: ForecastAndScenariosProps }) {
  const { items, title } = props;
  if (!items?.length) return null;
  return (
    <div className="space-y-2">
      {title && <h4 className="text-sm font-semibold text-foreground">{title}</h4>}
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item, i) => (
          <Card key={i} className="border-border/60 bg-muted/20">
            <CardContent className="p-3 flex items-start gap-2">
              <TrendingUp className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground">{item.label}</p>
                {item.value != null && (
                  <p className="text-lg font-semibold text-foreground mt-0.5">{item.value}</p>
                )}
                {item.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
