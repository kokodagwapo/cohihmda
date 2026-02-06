import type { DataNotesProps } from '@/types/cohiResponsePlan';
import { Database, FileText } from 'lucide-react';

export function DataNotes({ props }: { props: DataNotesProps }) {
  const { sources, filtersApplied, caveats } = props;
  const hasSources = sources?.length > 0;
  const hasFilters = filtersApplied?.length > 0;
  const hasCaveats = caveats?.length > 0;
  if (!hasSources && !hasFilters && !hasCaveats) return null;
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Data notes</h4>
      {hasSources && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Sources</p>
          <ul className="space-y-1">
            {sources.map((s, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-foreground">
                {s.type === 'db' ? (
                  <Database className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <span>{s.name}</span>
                {s.id && <span className="text-muted-foreground text-xs">({s.id})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasFilters && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Filters applied</p>
          <ul className="list-disc list-inside text-sm text-foreground space-y-0.5">
            {filtersApplied.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      {hasCaveats && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Caveats</p>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-0.5">
            {caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
