import { Gauge } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { RangeAnalysis } from "./types";

const RANGE_CONFIG = {
  fico: { label: "FICO Score", min: 300, max: 850, unit: "" },
  ltv: { label: "LTV Ratio", min: 0, max: 100, unit: "%" },
  dti: { label: "DTI Ratio", min: 0, max: 100, unit: "%" },
  interestRate: { label: "Interest Rate", min: 0, max: 15, unit: "%" },
} as const;

type RangeKey = keyof typeof RANGE_CONFIG;

interface RangeCardProps {
  rangeKey: RangeKey;
  data: {
    inRange: number;
    outOfRange: number;
    distribution: { range: string; count: number }[];
  };
}

function RangeCard({ rangeKey, data }: RangeCardProps) {
  const config = RANGE_CONFIG[rangeKey];
  const total = data.inRange + data.outOfRange;
  const outPct = total > 0 ? ((data.outOfRange / total) * 100).toFixed(1) : "0.0";

  return (
    <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700">
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-medium text-slate-900 dark:text-white">{config.label}</h4>
        <Badge variant="outline">
          {config.min}{config.unit} – {config.max}{config.unit}
        </Badge>
      </div>

      <div className="flex items-center gap-6 mb-4">
        <div>
          <div className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
            {data.inRange.toLocaleString()}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">In Range</div>
        </div>
        <div>
          <div className="text-2xl font-semibold text-rose-600 dark:text-rose-400">
            {data.outOfRange.toLocaleString()}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">Out of Range</div>
          {data.outOfRange > 0 && (
            <div className="text-xs text-rose-500 mt-0.5">{outPct}% of total</div>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        {data.distribution.map((d) => {
          const isOutOfRange =
            d.range === "Out of Range" || d.range === "Over 100%" || d.range === "Over 15%";
          return (
            <div key={d.range} className="flex items-center justify-between text-sm">
              <span className="text-slate-600 dark:text-slate-400">{d.range}</span>
              <span
                className={
                  isOutOfRange
                    ? "text-rose-600 dark:text-rose-400 font-medium"
                    : "text-slate-700 dark:text-slate-300"
                }
              >
                {d.count.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface RangesViewProps {
  rangeAnalysis: RangeAnalysis | null;
}

export function RangesView({ rangeAnalysis }: RangesViewProps) {
  const hasData =
    rangeAnalysis &&
    (rangeAnalysis.fico || rangeAnalysis.ltv || rangeAnalysis.dti || rangeAnalysis.interestRate);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Gauge className="h-5 w-5 text-blue-500" />
            Range Analysis
          </CardTitle>
          <CardDescription>
            Loan stratification by key metrics — identifies out-of-range values
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!hasData ? (
            <div className="py-8 text-center text-sm text-slate-500">
              No range analysis data available. The required columns (fico_score, ltv_ratio,
              dti_ratio, interest_rate) may not exist in your loan data.
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {rangeAnalysis?.fico && <RangeCard rangeKey="fico" data={rangeAnalysis.fico} />}
              {rangeAnalysis?.ltv && <RangeCard rangeKey="ltv" data={rangeAnalysis.ltv} />}
              {rangeAnalysis?.dti && <RangeCard rangeKey="dti" data={rangeAnalysis.dti} />}
              {rangeAnalysis?.interestRate && (
                <RangeCard rangeKey="interestRate" data={rangeAnalysis.interestRate} />
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Alert>
        <Gauge className="h-4 w-4" />
        <AlertDescription>
          Range boundaries are based on industry standards. Out-of-range values may indicate
          data entry errors or require manual verification.
        </AlertDescription>
      </Alert>
    </div>
  );
}
