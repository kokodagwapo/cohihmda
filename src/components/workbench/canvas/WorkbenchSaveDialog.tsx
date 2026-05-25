import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export type WorkbenchSaveDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saveTitle: string;
  setSaveTitle: (title: string) => void;
  onConfirm: () => void;
  isSaving: boolean;
};

export function WorkbenchSaveDialog({
  open,
  onOpenChange,
  saveTitle,
  setSaveTitle,
  onConfirm,
  isSaving,
}: WorkbenchSaveDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Save className="h-5 w-5 text-slate-500" />
            Save canvas
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Title
            </label>
            <Input
              placeholder="Untitled canvas"
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              className="mt-2"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={onConfirm} disabled={isSaving}>
              {isSaving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
