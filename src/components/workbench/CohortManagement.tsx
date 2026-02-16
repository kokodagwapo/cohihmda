import { useEffect, useState } from 'react';
import { Users, Trash2, Edit2, Loader2, CheckCircle2, X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconBadge } from '@/components/workbench/IconBadge';
import { useCohortStore, Cohort } from '@/stores/cohortStore';
import { api } from '@/lib/api';
import { useTopTieringSelectionStore } from '@/stores/topTieringSelectionStore';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CreateAdHocCohortDialog } from '@/components/workbench/CreateAdHocCohortDialog';
import { TopTieringSelectionItem } from '@/stores/topTieringSelectionStore';

// Available items will come from the TopTiering API data
const emptyItems: TopTieringSelectionItem[] = [];

export function CohortManagement() {
  const { cohorts, setCohorts, removeCohort, toggleCohortSelection, selectedCohortIds, loadCohort } = useCohortStore();
  const { setSelection, actorType } = useTopTieringSelectionStore();
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [adhocDialogOpen, setAdhocDialogOpen] = useState(false);

  useEffect(() => {
    loadCohorts();
  }, []);

  const loadCohorts = async () => {
    setLoading(true);
    try {
      const res = await api.request<{ cohorts: Cohort[] }>('/api/workbench/cohorts');
      setCohorts(res?.cohorts || []);
    } catch (error) {
      console.error('Failed to load cohorts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this cohort?')) return;
    try {
      await api.request(`/api/workbench/cohorts/${id}`, { method: 'DELETE' });
      removeCohort(id);
    } catch (error) {
      console.error('Failed to delete cohort:', error);
    }
  };

  const handleLoad = (cohort: Cohort) => {
    setSelection(cohort.actor_type, cohort.items);
    loadCohort(cohort);
  };

  const handleStartEdit = (cohort: Cohort) => {
    setEditingId(cohort.id);
    setEditName(cohort.name);
  };

  const handleSaveEdit = async (id: string) => {
    if (!editName.trim()) return;
    try {
      await api.request(`/api/workbench/cohorts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editName.trim() }),
      });
      const cohort = cohorts.find((c) => c.id === id);
      if (cohort) {
        useCohortStore.getState().updateCohort(id, { name: editName.trim() });
      }
      setEditingId(null);
      setEditName('');
    } catch (error) {
      console.error('Failed to update cohort:', error);
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  const isSelected = (id: string) => selectedCohortIds.has(id);

  return (
    <div className="p-3 border-t border-slate-200/70 dark:border-slate-700/50">
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="px-2 py-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
          <IconBadge icon={Users} variant="violet" size="sm" rounded="lg" />
          Cohorts
        </h3>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => setAdhocDialogOpen(true)}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          New
        </Button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : cohorts.length === 0 ? (
        <div className="mt-2 rounded-xl border border-dashed border-slate-200/80 dark:border-slate-700/80 bg-slate-50/60 dark:bg-slate-800/30 p-5 text-center">
          <IconBadge icon={Users} variant="slate" size="lg" rounded="xl" className="mx-auto mb-2.5" />
          <p className="text-xs font-medium text-slate-600 dark:text-slate-400">No cohorts yet</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-500 mt-0.5">Save selections to compare later</p>
        </div>
      ) : (
        <div className="mt-2 space-y-1.5">
          {cohorts.map((cohort) => (
            <div
              key={cohort.id}
              className={cn(
                'rounded-xl border p-2.5 transition-all duration-200',
                isSelected(cohort.id)
                  ? 'border-violet-300 dark:border-violet-700 bg-violet-50/50 dark:bg-violet-900/20'
                  : 'border-slate-200/80 dark:border-slate-700/80 bg-white/90 dark:bg-slate-800/50 hover:shadow-sm'
              )}
            >
              {editingId === cohort.id ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-7 text-xs flex-1"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveEdit(cohort.id);
                      if (e.key === 'Escape') handleCancelEdit();
                    }}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => handleSaveEdit(cohort.id)}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleCancelEdit}>
                    <X className="h-3.5 w-3.5 text-slate-400" />
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">{cohort.name}</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {cohort.items.length} {cohort.actor_type === 'branch' ? 'branches' : 'officers'}
                        {cohort.is_adhoc && ' · Ad-hoc'}
                      </p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                          <Edit2 className="h-3.5 w-3.5 text-slate-400" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem onClick={() => handleStartEdit(cohort)}>
                          <Edit2 className="h-3.5 w-3.5 mr-2" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleLoad(cohort)}>
                          <Users className="h-3.5 w-3.5 mr-2" />
                          Load
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => toggleCohortSelection(cohort.id)}
                          className={isSelected(cohort.id) ? 'bg-violet-50 dark:bg-violet-900/20' : ''}
                        >
                          <CheckCircle2 className={cn('h-3.5 w-3.5 mr-2', isSelected(cohort.id) ? 'text-violet-600' : 'text-slate-400')} />
                          {isSelected(cohort.id) ? 'Deselect' : 'Select'}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDelete(cohort.id)} className="text-rose-600 dark:text-rose-400">
                          <Trash2 className="h-3.5 w-3.5 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <CreateAdHocCohortDialog
        open={adhocDialogOpen}
        onOpenChange={setAdhocDialogOpen}
        actorType={actorType}
        availableItems={emptyItems}
      />
    </div>
  );
}
