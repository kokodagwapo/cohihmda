import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { KpiCardsProps } from '@/types/cohiResponsePlan';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

function formatValue(value: number | string, format?: string): string {
  if (typeof value === 'string') return value;
  switch (format) {
    case 'currency':
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
    case 'percent':
      return `${Number(value).toFixed(1)}%`;
    case 'number':
    default:
      return new Intl.NumberFormat('en-US').format(value);
  }
}

export function KpiCardRow({ props }: { props: KpiCardsProps }) {
  const { cards } = props;
  if (!cards?.length) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {cards.map((card, i) => (
        <Card key={i} className="border-border/50 bg-card">
          <CardContent className="p-2.5">
            <p className="text-[10px] font-medium text-muted-foreground truncate">{card.label}</p>
            <p className="text-base font-semibold text-foreground mt-0.5">{formatValue(card.value, card.format)}</p>
            {(card.delta != null || card.trend) && (
              <div className="mt-1 flex items-center gap-1">
                {card.trend === 'up' && <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />}
                {card.trend === 'down' && <TrendingDown className="h-3.5 w-3.5 text-rose-500" />}
                {card.trend === 'neutral' && <Minus className="h-3.5 w-3.5 text-muted-foreground" />}
                {card.delta != null && (
                  <Badge variant={card.trend === 'down' ? 'destructive' : card.trend === 'up' ? 'default' : 'secondary'} className="text-[10px] px-1 py-0">
                    {card.delta > 0 ? '+' : ''}{card.delta}%
                  </Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
