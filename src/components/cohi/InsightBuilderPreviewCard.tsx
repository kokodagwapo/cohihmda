/**
 * Insight builder inline draft preview (meeting spec §5 / COHI-406).
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  MyInsightPromptDraftForm,
  type MyInsightPromptDraft,
} from "@/components/dashboard/MyInsightPromptDraftForm";

export type InsightBuilderDraft = MyInsightPromptDraft;

export interface InsightBuilderPreviewCardProps {
  draft: InsightBuilderDraft;
  onApprove: (draft: InsightBuilderDraft) => void;
  onRequestChanges: (draft: InsightBuilderDraft) => void;
  disabled?: boolean;
  /** After approve — static summary, no action buttons. */
  readOnly?: boolean;
  tenantId?: string | null;
}

export function InsightBuilderPreviewCard({
  draft: initialDraft,
  onApprove,
  onRequestChanges,
  disabled,
  readOnly,
  tenantId,
}: InsightBuilderPreviewCardProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [isApproving, setIsApproving] = useState(false);

  useEffect(() => {
    setDraft(initialDraft);
  }, [initialDraft]);

  useEffect(() => {
    if (readOnly) setIsApproving(false);
  }, [readOnly]);

  const outerCn =
    "mx-4 mb-3 rounded-xl border border-violet-200/80 dark:border-violet-800/60 bg-violet-50/50 dark:bg-violet-950/30 p-4 space-y-3";

  return (
    <section className={outerCn}>
      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
        {readOnly ? "Saved insight prompt" : "Review insight prompt draft"}
      </p>
      <MyInsightPromptDraftForm
        value={draft}
        onChange={setDraft}
        tenantId={tenantId}
        disabled={disabled}
        readOnly={readOnly}
      />
      {!readOnly ? (
        <div className="flex gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            disabled={disabled || isApproving}
            onClick={() => {
              if (isApproving || disabled) return;
              setIsApproving(true);
              onApprove(draft);
            }}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {isApproving ? "Saving…" : "Approve"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || isApproving}
            onClick={() => onRequestChanges(draft)}
          >
            Request changes
          </Button>
        </div>
      ) : null}
    </section>
  );
}
