/**
 * Slim layout for canvas_only users: only shared canvases, minimal nav, no insights/loans/admin.
 */
import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LayoutDashboard, LogOut, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { useTheme } from '@/components/theme-provider';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { WorkbenchCanvas } from '@/components/workbench/WorkbenchCanvas';
import { cn } from '@/lib/utils';

type CanvasItem = {
  id: string;
  title: string;
  permission?: 'owner' | 'editor' | 'viewer';
  visibility?: string;
  is_owner?: boolean;
};

export function CanvasOnlyLayout() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { canvasId: urlCanvasId } = useParams<{ canvasId?: string }>();
  const navigate = useNavigate();

  const [canvasList, setCanvasList] = useState<CanvasItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(urlCanvasId ?? null);

  const fetchCanvases = useCallback(async () => {
    try {
      const res = await api.request<{ canvases: CanvasItem[] }>('/api/workbench/canvases');
      setCanvasList(res?.canvases ?? []);
    } catch {
      setCanvasList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCanvases();
  }, [fetchCanvases]);

  // Redirect to first canvas if no id and we have canvases
  useEffect(() => {
    if (loading || canvasList.length === 0) return;
    if (!urlCanvasId && canvasList.length > 0 && !selectedId) {
      const first = canvasList[0];
      setSelectedId(first.id);
      navigate(`/my-dashboard/${first.id}`, { replace: true });
    } else if (urlCanvasId) {
      setSelectedId(urlCanvasId);
    }
  }, [loading, urlCanvasId, canvasList, selectedId, navigate]);

  const displayName = user?.full_name?.trim() || user?.email?.split('@')[0] || 'User';

  const activeCanvas = selectedId ? canvasList.find((c) => c.id === selectedId) : null;
  const canEdit = activeCanvas?.permission === 'owner' || activeCanvas?.permission === 'editor';

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-slate-50/90 via-white to-sky-50/40 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950/80">
      {/* Minimal top bar */}
      <header className="flex items-center justify-between h-14 px-4 border-b border-slate-200/70 dark:border-slate-700/50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-violet-600 flex items-center justify-center">
              <LayoutDashboard className="h-4 w-4 text-white" />
            </div>
            <span className="font-semibold text-slate-800 dark:text-slate-100 text-sm hidden sm:inline">
              Cohi Dashboards
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as 'light' | 'dark' | 'system')}>
                <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2 text-slate-700 dark:text-slate-300">
                <span className="truncate max-w-[120px]">{displayName}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => logout()}>
                <LogOut className="h-4 w-4 mr-2" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar: canvas list */}
        <aside className="w-56 border-r border-slate-200/70 dark:border-slate-700/50 bg-white/50 dark:bg-slate-900/50 flex flex-col shrink-0">
          <div className="p-2 border-b border-slate-200/70 dark:border-slate-700/50">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 px-2 py-1">Shared with you</p>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {loading ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 px-2">Loading…</p>
            ) : canvasList.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 px-2">No canvases shared with you yet.</p>
            ) : (
              <div className="space-y-0.5">
                {canvasList.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={cn(
                      'w-full text-left rounded-lg px-2.5 py-2 text-[13px] transition-colors',
                      selectedId === c.id
                        ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-800 dark:text-violet-200 font-medium'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/50'
                    )}
                    onClick={() => {
                      setSelectedId(c.id);
                      navigate(`/my-dashboard/${c.id}`);
                    }}
                  >
                    <span className="truncate block">{c.title || 'Untitled'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Main: single canvas */}
        <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
          {loading ? (
            <div className="flex items-center justify-center flex-1 text-slate-500">Loading…</div>
          ) : canvasList.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 text-center px-6">
              <p className="text-slate-600 dark:text-slate-400">No dashboards have been shared with you yet.</p>
              <p className="text-sm text-slate-500 dark:text-slate-500 mt-1">Contact your admin to get access.</p>
            </div>
          ) : selectedId ? (
            <WorkbenchCanvas
              key={selectedId}
              loadCanvasId={selectedId}
              onLoaded={() => {}}
              onSaved={() => fetchCanvases()}
              onDirtyChange={() => {}}
              isOwner={canEdit}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}
