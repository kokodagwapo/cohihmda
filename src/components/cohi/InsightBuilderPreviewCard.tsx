/**
 * Meeting spec �5 � inline draft preview with Approve / Deny (COHI-406).
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";

export interface InsightBuilderDraft {
  title: string;
  prompt_text: string;
  schedule: "batch" | "on_demand";
  specifiers: Record<string, unknown>;
}

export interface InsightBuilderPreviewCardProps {
  draft: InsightBuilderDraft;
  onApprove: (draft: InsightBuilderDraft) => void;
  onDeny: () => void;
  disabled?: boolean;
}

type SpecifierRow = { id: string; key: string; value: string };

function specifiersToRows(specifiers: Record<string, unknown>): SpecifierRow[] {
  const entries = Object.entries(specifiers ?? {}).filter(
    ([k]) => k !== "_prompt_tag",
  );
  if (entries.length === 0) {
    return [{ id: "0", key: "", value: "" }];
  }
  return entries.map(([key, value], i) => ({
    id: String(i),
    key,
    value: value == null ? "" : String(value),
  }));
}

function rowsToSpecifiers(rows: SpecifierRow[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    const k = row.key.trim();
    if (!k) continue;
    const v = row.value.trim();
    if (v === "") {
      out[k] = "";
      continue;
    }
    if (v === "true") out[k] = true;
    else if (v === "false") out[k] = false;
    else if (!Number.isNaN(Number(v)) && v !== "") out[k] = Number(v);
    else out[k] = v;
  }
  return out;
}

export function InsightBuilderPreviewCard({
  draft: initialDraft,
  onApprove,
  onDeny,
  disabled,
}: InsightBuilderPreviewCardProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [specifierRows, setSpecifierRows] = useState<SpecifierRow[]>(() =>
    specifiersToRows(initialDraft.specifiers),
  );

  useEffect(() => {
    setDraft(initialDraft);
    setSpecifierRows(specifiersToRows(initialDraft.specifiers));
  }, [initialDraft]);

  const syncSpecifiers = (rows: SpecifierRow[]) => {
    setSpecifierRows(rows);
    setDraft((d) => ({ ...d, specifiers: rowsToSpecifiers(rows) }));
  };

  return (
    <div className="mx-4 mb-3 rounded-xl border border-violet-200/80 dark:border-violet-800/60 bg-violet-50/50 dark:bg-violet-950/30 p-4 space-y-3">
      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
        Review insight prompt draft
      </p>
      <div className="space-y-2">
        <div>
          <Label className="text-xs">Title</Label>
          <Input
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            className="h-8 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs">Prompt</Label>
          <Textarea
            value={draft.prompt_text}
            onChange={(e) =>
              setDraft((d) => ({ ...d, prompt_text: e.target.value }))
            }
            rows={4}
            className="text-sm"
          />
        </div>
        <div>
          <Label className="text-xs">Schedule</Label>
          <Select
            value={draft.schedule}
            onValueChange={(v) =>
              setDraft((d) => ({
                ...d,
                schedule: v === "on_demand" ? "on_demand" : "batch",
              }))
            }
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="batch">Batch</SelectItem>
              <SelectItem value="on_demand">On demand</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Specifiers (loan cohort filters)</Label>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-1.5">
            Optional column filters applied when this prompt runs (e.g. branch,
            loan_officer).
          </p>
          <div className="space-y-1.5">
            {specifierRows.map((row) => (
              <div key={row.id} className="flex gap-1.5 items-center">
                <Input
                  placeholder="Column"
                  value={row.key}
                  onChange={(e) => {
                    const next = specifierRows.map((r) =>
                      r.id === row.id ? { ...r, key: e.target.value } : r,
                    );
                    syncSpecifiers(next);
                  }}
                  className="h-8 text-xs flex-1"
                />
                <Input
                  placeholder="Value"
                  value={row.value}
                  onChange={(e) => {
                    const next = specifierRows.map((r) =>
                      r.id === row.id ? { ...r, value: e.target.value } : r,
                    );
                    syncSpecifiers(next);
                  }}
                  className="h-8 text-xs flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  disabled={disabled}
                  aria-label="Remove specifier"
                  onClick={() => {
                    const next = specifierRows.filter((r) => r.id !== row.id);
                    syncSpecifiers(
                      next.length ? next : [{ id: String(Date.now()), key: "", value: "" }],
                    );
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              disabled={disabled}
              onClick={() => {
                syncSpecifiers([
                  ...specifierRows,
                  { id: String(Date.now()), key: "", value: "" },
                ]);
              }}
            >
              <Plus className="h-3 w-3" />
              Add specifier
            </Button>
          </div>
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => onApprove({ ...draft, specifiers: rowsToSpecifiers(specifierRows) })}
          className="bg-emerald-600 hover:bg-emerald-700"
        >
          Approve
        </Button>
        <Button size="sm" variant="outline" disabled={disabled} onClick={onDeny}>
          Deny
        </Button>
      </div>
    </div>
  );
}
