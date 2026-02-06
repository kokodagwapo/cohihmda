/**
 * My Dashboard Legacy Page
 * Custom dashboard with user-saved visualizations
 * Accessible at /my-dashboard-legacy
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  RefreshCw,
  Trash2,
  Settings,
  Grid,
  LayoutGrid,
  MessageSquare,
  ChevronLeft,
  Loader2,
  Edit2,
  Pin,
  PinOff,
  Clock,
  MoreVertical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useTenantStore } from '@/stores/tenantStore';
import { useSavedVisualizations, SavedVisualization } from '@/hooks/useSavedVisualizations';
import { DynamicVisualization, VisualizationConfig } from '@/components/visualizations/DynamicVisualization';
import { DataChatPanel } from '@/components/dashboard/DataChatPanel';

// ============================================================================
// Types
// ============================================================================

interface EditDialogState {
  isOpen: boolean;
  visualization: SavedVisualization | null;
}

// ============================================================================
// Main Component
// ============================================================================

export default function MyDashboardLegacy() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { selectedTenantId } = useTenantStore();

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [gridSize, setGridSize] = useState<'small' | 'medium' | 'large'>('medium');
  const [editDialog, setEditDialog] = useState<EditDialogState>({ isOpen: false, visualization: null });
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const {
    visualizations,
    isLoading,
    error,
    loadVisualizations,
    updateVisualization,
    deleteVisualization,
    refreshVisualization,
  } = useSavedVisualizations({
    tenantId: user?.tenant_id,
    autoLoad: true,
  });

  /**
   * Get grid column class based on size
   */
  const getGridClass = () => {
    switch (gridSize) {
      case 'small':
        return 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4';
      case 'large':
        return 'grid-cols-1 md:grid-cols-2';
      default:
        return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
    }
  };

  /**
   * Open edit dialog
   */
  const handleOpenEdit = (viz: SavedVisualization) => {
    setEditTitle(viz.title);
    setEditDescription(viz.description || '');
    setEditDialog({ isOpen: true, visualization: viz });
  };

  /**
   * Save edit
   */
  const handleSaveEdit = async () => {
    if (!editDialog.visualization) return;
    
    try {
      await updateVisualization(editDialog.visualization.id, {
        title: editTitle,
        description: editDescription,
      });
      toast({ title: 'Saved', description: 'Visualization updated successfully.' });
      setEditDialog({ isOpen: false, visualization: null });
    } catch (err: any) {
      toast({ 
        title: 'Error', 
        description: err.message || 'Failed to update visualization',
        variant: 'destructive',
      });
    }
  };

  /**
   * Toggle pin
   */
  const handleTogglePin = async (viz: SavedVisualization) => {
    try {
      await updateVisualization(viz.id, { isPinned: !viz.isPinned });
    } catch (err: any) {
      toast({ 
        title: 'Error', 
        description: err.message || 'Failed to update visualization',
        variant: 'destructive',
      });
    }
  };

  /**
   * Delete visualization
   */
  const handleDelete = async (id: string) => {
    try {
      await deleteVisualization(id);
      toast({ title: 'Deleted', description: 'Visualization removed from dashboard.' });
      setDeleteConfirm(null);
    } catch (err: any) {
      toast({ 
        title: 'Error', 
        description: err.message || 'Failed to delete visualization',
        variant: 'destructive',
      });
    }
  };

  /**
   * Refresh visualization
   */
  const handleRefresh = async (id: string) => {
    setRefreshingId(id);
    try {
      await refreshVisualization(id);
      toast({ title: 'Refreshed', description: 'Data updated successfully.' });
    } catch (err: any) {
      toast({ 
        title: 'Error', 
        description: err.message || 'Failed to refresh visualization',
        variant: 'destructive',
      });
    } finally {
      setRefreshingId(null);
    }
  };

  // Sort visualizations: pinned first, then by position
  const sortedVisualizations = [...visualizations].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return a.position - b.position;
  });

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-40">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/insights')}
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <div>
                <h1 className="text-xl font-semibold text-slate-900 dark:text-white">
                  Saved Visualizations
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {visualizations.length} saved visualization{visualizations.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {/* Grid Size Toggle */}
              <div className="flex items-center gap-1 border border-slate-200 dark:border-slate-700 rounded-lg p-1">
                <Button
                  variant={gridSize === 'small' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setGridSize('small')}
                >
                  <Grid className="w-4 h-4" />
                </Button>
                <Button
                  variant={gridSize === 'medium' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setGridSize('medium')}
                >
                  <LayoutGrid className="w-4 h-4" />
                </Button>
                <Button
                  variant={gridSize === 'large' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setGridSize('large')}
                >
                  <Settings className="w-4 h-4" />
                </Button>
              </div>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadVisualizations()}
                disabled={isLoading}
              >
                <RefreshCw className={cn("w-4 h-4 mr-2", isLoading && "animate-spin")} />
                Refresh
              </Button>
              
              <Button
                onClick={() => setIsChatOpen(true)}
                size="sm"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Visualization
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-6">
        {isLoading && visualizations.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <p className="text-red-500 mb-4">{error}</p>
            <Button onClick={() => loadVisualizations()}>Try Again</Button>
          </div>
        ) : visualizations.length === 0 ? (
          <div className="text-center py-20">
            <MessageSquare className="w-16 h-16 mx-auto mb-4 text-slate-300 dark:text-slate-600" />
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
              No visualizations yet
            </h2>
            <p className="text-slate-500 dark:text-slate-400 mb-6 max-w-md mx-auto">
              Use the Data Chat to explore your loan data and save visualizations to your custom dashboard.
            </p>
            <Button onClick={() => setIsChatOpen(true)}>
              <MessageSquare className="w-4 h-4 mr-2" />
              Open Data Chat
            </Button>
          </div>
        ) : (
          <div className={cn("grid gap-4", getGridClass())}>
            {sortedVisualizations.map((viz) => (
              <VisualizationCard
                key={viz.id}
                visualization={viz}
                isRefreshing={refreshingId === viz.id}
                onEdit={() => handleOpenEdit(viz)}
                onDelete={() => setDeleteConfirm(viz.id)}
                onRefresh={() => handleRefresh(viz.id)}
                onTogglePin={() => handleTogglePin(viz)}
                compact={gridSize === 'small'}
              />
            ))}
          </div>
        )}
      </div>

      {/* Chat Panel */}
      <DataChatPanel
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        tenantId={selectedTenantId ?? user?.tenant_id ?? undefined}
      />

      {/* Edit Dialog */}
      <Dialog 
        open={editDialog.isOpen} 
        onOpenChange={(open) => !open && setEditDialog({ isOpen: false, visualization: null })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Visualization</DialogTitle>
            <DialogDescription>
              Update the title and description for this visualization.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-title">Title</Label>
              <Input
                id="edit-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog({ isOpen: false, visualization: null })}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={!editTitle.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog 
        open={!!deleteConfirm} 
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Visualization</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this visualization? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// Visualization Card Component
// ============================================================================

interface VisualizationCardProps {
  visualization: SavedVisualization;
  isRefreshing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  onTogglePin: () => void;
  compact?: boolean;
}

const VisualizationCard: React.FC<VisualizationCardProps> = ({
  visualization,
  isRefreshing,
  onEdit,
  onDelete,
  onRefresh,
  onTogglePin,
  compact,
}) => {
  // Build config with data snapshot if available
  const config: VisualizationConfig = {
    ...visualization.visualizationConfig,
    data: visualization.dataSnapshot || visualization.visualizationConfig.data,
  };

  return (
    <Card className={cn(
      "overflow-hidden group",
      visualization.isPinned && "ring-2 ring-blue-500 ring-offset-2"
    )}>
      {/* Card Header with Actions */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
        <div className="flex items-center gap-2 min-w-0">
          {visualization.isPinned && (
            <Pin className="w-3 h-3 text-blue-500 shrink-0" />
          )}
          <span className="font-medium text-sm text-slate-900 dark:text-white truncate">
            {visualization.title}
          </span>
        </div>
        
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={cn("w-3 h-3", isRefreshing && "animate-spin")} />
          </Button>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <MoreVertical className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Edit2 className="w-4 h-4 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onTogglePin}>
                {visualization.isPinned ? (
                  <>
                    <PinOff className="w-4 h-4 mr-2" />
                    Unpin
                  </>
                ) : (
                  <>
                    <Pin className="w-4 h-4 mr-2" />
                    Pin to top
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onDelete} className="text-red-600">
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      
      {/* Visualization */}
      <CardContent className="p-0">
        <DynamicVisualization
          config={config}
          height={compact ? 200 : 280}
          showTitle={false}
          compact={compact}
        />
      </CardContent>
      
      {/* Footer with metadata */}
      {visualization.description && (
        <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
          <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
            {visualization.description}
          </p>
        </div>
      )}
    </Card>
  );
};
