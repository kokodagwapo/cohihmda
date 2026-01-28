import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useCohortStore } from '@/stores/cohortStore';
import { TopTieringSelectionItem, TopTieringActorType } from '@/stores/topTieringSelectionStore';

interface SaveCohortDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: TopTieringSelectionItem[];
  actorType: TopTieringActorType;
}

export function SaveCohortDialog({ open, onOpenChange, items, actorType }: SaveCohortDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const { addCohort } = useCohortStore();

  const handleSave = async () => {
    if (!name.trim() || items.length === 0) return;

    setSaving(true);
    try {
      const res = await api.request<{
        id: string;
        name: string;
        description?: string;
        actor_type: TopTieringActorType;
        items: TopTieringSelectionItem[];
        is_adhoc: boolean;
        created_at: string;
        updated_at: string;
      }>('/api/workbench/cohorts', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          actor_type: actorType,
          items,
          is_adhoc: false,
        }),
      });

      addCohort(res);
      setName('');
      setDescription('');
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to save cohort:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Save Selection as Cohort</DialogTitle>
          <DialogDescription>
            Save this selection of {items.length} {actorType === 'branch' ? 'branches' : 'loan officers'} for later comparison.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="cohort-name">Name *</Label>
            <Input
              id="cohort-name"
              placeholder="e.g., Top Performers Q4"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cohort-description">Description</Label>
            <Textarea
              id="cohort-description"
              placeholder="Optional description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={saving}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim() || items.length === 0}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Cohort
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
