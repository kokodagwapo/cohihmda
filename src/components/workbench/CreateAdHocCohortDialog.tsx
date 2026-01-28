import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useCohortStore } from '@/stores/cohortStore';
import { TopTieringSelectionItem, TopTieringActorType } from '@/stores/topTieringSelectionStore';
import { Checkbox } from '@/components/ui/checkbox';
import { formatCompactNumber } from '@/utils/formatting';

interface CreateAdHocCohortDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actorType: TopTieringActorType;
  availableItems: TopTieringSelectionItem[];
}

export function CreateAdHocCohortDialog({
  open,
  onOpenChange,
  actorType,
  availableItems,
}: CreateAdHocCohortDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const { addCohort } = useCohortStore();

  useEffect(() => {
    if (!open) {
      setName('');
      setDescription('');
      setSelectedIds(new Set());
      setSearchQuery('');
    }
  }, [open]);

  const filteredItems = availableItems.filter((item) =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleItem = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const handleSave = async () => {
    if (!name.trim() || selectedIds.size === 0) return;

    const selectedItems = availableItems.filter((item) => selectedIds.has(item.id));

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
          items: selectedItems,
          is_adhoc: true,
        }),
      });

      addCohort(res);
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to create cohort:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Create Ad-Hoc Cohort</DialogTitle>
          <DialogDescription>
            Manually select {actorType === 'branch' ? 'branches' : 'loan officers'} to create a custom cohort.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4 flex-1 min-h-0 flex flex-col">
          <div className="space-y-2">
            <Label htmlFor="adhoc-cohort-name">Name *</Label>
            <Input
              id="adhoc-cohort-name"
              placeholder="e.g., Custom Analysis Group"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="adhoc-cohort-description">Description</Label>
            <Textarea
              id="adhoc-cohort-description"
              placeholder="Optional description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={saving}
              rows={2}
            />
          </div>
          <div className="space-y-2 flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between">
              <Label>Select Items ({selectedIds.size} selected)</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-8 text-sm"
                  disabled={saving}
                />
              </div>
            </div>
            <div className="border rounded-lg overflow-auto flex-1 min-h-0">
              <div className="divide-y">
                {filteredItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                    onClick={() => toggleItem(item.id)}
                  >
                    <Checkbox
                      checked={selectedIds.has(item.id)}
                      onCheckedChange={() => toggleItem(item.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{item.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Revenue: {formatCompactNumber(item.revenue)} · Units: {item.units}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim() || selectedIds.size === 0}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Cohort ({selectedIds.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
