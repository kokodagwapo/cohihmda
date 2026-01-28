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

// Mock data for available items (in production, this would come from an API)
const mockBranches: TopTieringSelectionItem[] = [
  { id: '2001', name: 'Branch 2001', tier: 'top', revenue: 5000000, units: 800, volume: 5000000, revenueBPS: 320, revenuePerLoan: 6250 },
  { id: '2002', name: 'Branch 2002', tier: 'top', revenue: 2750000, units: 200, volume: 2750000, revenueBPS: 300, revenuePerLoan: 13750 },
  { id: '2101', name: 'Branch 2101', tier: 'second', revenue: 1000000, units: 150, volume: 1000000, revenueBPS: 280, revenuePerLoan: 6667 },
  { id: '2201', name: 'Branch 2201', tier: 'second', revenue: 900000, units: 100, volume: 900000, revenueBPS: 250, revenuePerLoan: 9000 },
  { id: '2301', name: 'Branch 2301', tier: 'bottom', revenue: 500000, units: 50, volume: 500000, revenueBPS: 220, revenuePerLoan: 10000 },
  { id: '1000', name: 'Branch 1000', tier: 'bottom', revenue: 400000, units: 40, volume: 400000, revenueBPS: 200, revenuePerLoan: 10000 },
  { id: '2005', name: 'Branch 2005', tier: 'bottom', revenue: 350000, units: 35, volume: 350000, revenueBPS: 190, revenuePerLoan: 10000 },
  { id: '2205', name: 'Branch 2205', tier: 'bottom', revenue: 280000, units: 30, volume: 280000, revenueBPS: 180, revenuePerLoan: 9333 },
];

const mockLoanOfficers: TopTieringSelectionItem[] = [
  { id: 'lo-1', name: 'Stanley', tier: 'top', revenue: 850000, units: 142, volume: 850000, revenueBPS: 320, revenuePerLoan: 5986 },
  { id: 'lo-2', name: 'Alicia M', tier: 'top', revenue: 750000, units: 125, volume: 750000, revenueBPS: 310, revenuePerLoan: 6000 },
  { id: 'lo-3', name: 'Craig J', tier: 'top', revenue: 700000, units: 117, volume: 700000, revenueBPS: 305, revenuePerLoan: 5983 },
  { id: 'lo-4', name: 'Vance', tier: 'top', revenue: 680000, units: 113, volume: 680000, revenueBPS: 300, revenuePerLoan: 6018 },
  { id: 'lo-5', name: 'James', tier: 'top', revenue: 670000, units: 112, volume: 670000, revenueBPS: 295, revenuePerLoan: 5973 },
  { id: 'lo-6', name: 'Aaron', tier: 'top', revenue: 650000, units: 108, volume: 650000, revenueBPS: 290, revenuePerLoan: 6019 },
  { id: 'lo-7', name: 'Stephe', tier: 'top', revenue: 640000, units: 107, volume: 640000, revenueBPS: 285, revenuePerLoan: 5981 },
  { id: 'lo-8', name: 'Sharon', tier: 'top', revenue: 620000, units: 103, volume: 620000, revenueBPS: 280, revenuePerLoan: 6019 },
  { id: 'lo-9', name: 'Sean C', tier: 'top', revenue: 460000, units: 77, volume: 460000, revenueBPS: 275, revenuePerLoan: 5974 },
  { id: 'lo-10', name: 'Matthe', tier: 'second', revenue: 350000, units: 64, volume: 350000, revenueBPS: 250, revenuePerLoan: 5469 },
  { id: 'lo-11', name: 'Paul Fr', tier: 'second', revenue: 330000, units: 60, volume: 330000, revenueBPS: 245, revenuePerLoan: 5500 },
  { id: 'lo-12', name: 'Cari An', tier: 'second', revenue: 320000, units: 58, volume: 320000, revenueBPS: 240, revenuePerLoan: 5517 },
  { id: 'lo-13', name: 'Jay Bry', tier: 'second', revenue: 310000, units: 56, volume: 310000, revenueBPS: 235, revenuePerLoan: 5536 },
  { id: 'lo-14', name: 'Joanne', tier: 'second', revenue: 300000, units: 55, volume: 300000, revenueBPS: 230, revenuePerLoan: 5455 },
  { id: 'lo-15', name: 'Charles', tier: 'second', revenue: 290000, units: 53, volume: 290000, revenueBPS: 225, revenuePerLoan: 5472 },
  { id: 'lo-16', name: 'Frank E', tier: 'second', revenue: 280000, units: 51, volume: 280000, revenueBPS: 220, revenuePerLoan: 5490 },
  { id: 'lo-17', name: 'Chad M', tier: 'second', revenue: 270000, units: 49, volume: 270000, revenueBPS: 215, revenuePerLoan: 5510 },
  { id: 'lo-18', name: 'Samuel', tier: 'second', revenue: 260000, units: 47, volume: 260000, revenueBPS: 210, revenuePerLoan: 5532 },
  { id: 'lo-19', name: 'Laura J', tier: 'second', revenue: 250000, units: 45, volume: 250000, revenueBPS: 205, revenuePerLoan: 5556 },
  { id: 'lo-20', name: 'David', tier: 'second', revenue: 240000, units: 44, volume: 240000, revenueBPS: 200, revenuePerLoan: 5455 },
  { id: 'lo-21', name: 'Brad H', tier: 'second', revenue: 230000, units: 42, volume: 230000, revenueBPS: 195, revenuePerLoan: 5476 },
];

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
        availableItems={actorType === 'branch' ? mockBranches : mockLoanOfficers}
      />
    </div>
  );
}
