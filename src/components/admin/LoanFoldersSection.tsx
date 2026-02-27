import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { api } from '@/lib/api';
import { useAdminTenant } from '@/contexts/AdminTenantContext';
import { useToast } from '@/hooks/use-toast';
import { Folder, Loader2, RefreshCw, Save, AlertTriangle } from 'lucide-react';

interface LosConnection {
  id: string;
  name: string;
  los_type: string;
  encompass_selected_folders?: string[] | string;
}

interface FolderState {
  folders: Array<{ folderName: string }>;
  warning?: string;
  error?: string;
  selected: string[];
  loading: boolean;
  saving: boolean;
}

function parseSelectedFolders(raw: string[] | string | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function LoanFoldersSection() {
  const { selectedTenantId, currentTenantName } = useAdminTenant();
  const { toast } = useToast();
  const [connections, setConnections] = useState<LosConnection[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [folderStateByConnection, setFolderStateByConnection] = useState<Record<string, FolderState>>({});

  const encompassConnections = connections.filter((c) => c.los_type === 'encompass');

  const loadConnections = useCallback(async () => {
    if (!selectedTenantId) {
      setConnections([]);
      return;
    }
    setLoadingConnections(true);
    try {
      const res = await api.request<{ connections: LosConnection[] }>(
        `/api/los/connections?tenant_id=${selectedTenantId}`
      );
      setConnections(res.connections || []);
    } catch (err: any) {
      console.error('Error loading LOS connections:', err);
      toast({
        title: 'Error',
        description: err.message || 'Failed to load connections',
        variant: 'destructive',
      });
      setConnections([]);
    } finally {
      setLoadingConnections(false);
    }
  }, [selectedTenantId, toast]);

  const loadFoldersForConnection = useCallback(
    async (connectionId: string, initialSelected: string[] = []) => {
      if (!selectedTenantId) return;
      setFolderStateByConnection((prev) => ({
        ...prev,
        [connectionId]: {
          ...prev[connectionId],
          folders: prev[connectionId]?.folders ?? [],
          selected: prev[connectionId]?.selected ?? initialSelected,
          loading: true,
          warning: undefined,
          error: undefined,
        },
      }));
      try {
        const res = await api.request<{
          folders?: Array<{ folderName: string }>;
          warning?: string;
          error?: string;
        }>(`/api/encompass/folders/${connectionId}?tenant_id=${selectedTenantId}`);
        setFolderStateByConnection((prev) => {
          const current = prev[connectionId];
          const selected = current?.selected ?? initialSelected;
          return {
            ...prev,
            [connectionId]: {
              folders: res.folders || [],
              warning: res.warning,
              error: res.error,
              selected,
              loading: false,
              saving: current?.saving ?? false,
            },
          };
        });
      } catch (err: any) {
        setFolderStateByConnection((prev) => ({
          ...prev,
          [connectionId]: {
            ...prev[connectionId],
            folders: prev[connectionId]?.folders ?? [],
            selected: prev[connectionId]?.selected ?? initialSelected,
            error: err.message || 'Failed to load folders',
            loading: false,
            saving: false,
          },
        }));
      }
    },
    [selectedTenantId]
  );

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const encompassConnectionIds = encompassConnections.map((c) => c.id).sort().join(',');

  useEffect(() => {
    if (!selectedTenantId || loadingConnections || !encompassConnectionIds) {
      if (!selectedTenantId || !encompassConnectionIds) {
        setFolderStateByConnection({});
      }
      return;
    }
    const list = encompassConnections;
    list.forEach((c) => {
      const initialSelected = parseSelectedFolders(c.encompass_selected_folders);
      loadFoldersForConnection(c.id, initialSelected);
    });
  }, [selectedTenantId, loadingConnections, encompassConnectionIds, loadFoldersForConnection]);

  const setSelectedForConnection = (connectionId: string, selected: string[]) => {
    setFolderStateByConnection((prev) => ({
      ...prev,
      [connectionId]: {
        ...(prev[connectionId] ?? { folders: [], selected: [], loading: false, saving: false }),
        selected,
      },
    }));
  };

  const handleSave = async (connectionId: string) => {
    if (!selectedTenantId) return;
    const state = folderStateByConnection[connectionId];
    if (!state) return;
    setFolderStateByConnection((prev) => ({
      ...prev,
      [connectionId]: { ...prev[connectionId], saving: true },
    }));
    try {
      await api.request(`/api/los/connections/${connectionId}?tenant_id=${selectedTenantId}`, {
        method: 'PUT',
        body: JSON.stringify({ encompass_selected_folders: state.selected }),
      });
      toast({ title: 'Success', description: 'Folders saved successfully' });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to save folders',
        variant: 'destructive',
      });
    } finally {
      setFolderStateByConnection((prev) => ({
        ...prev,
        [connectionId]: { ...prev[connectionId], saving: false },
      }));
    }
  };

  if (!selectedTenantId) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="space-y-6"
      >
        <div className="flex items-center justify-between p-6 rounded-2xl bg-gradient-to-br from-orange-50 via-white to-amber-50 dark:from-slate-800/50 dark:to-slate-900/50 border border-orange-200/40 dark:border-slate-700/50 shadow-lg shadow-orange-500/10">
          <div>
            <h2 className="text-4xl font-thin text-slate-900 dark:text-white tracking-tight mb-2">
              Loan Folders
            </h2>
            <p className="text-base text-slate-600 dark:text-slate-400 font-extralight tracking-wide">
              Manage which Encompass folders to sync from
            </p>
          </div>
        </div>
        <Card>
          <CardContent className="py-8 text-center text-slate-500 dark:text-slate-400">
            Select a tenant from the header to manage loan folders.
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      <div className="flex items-center justify-between p-6 rounded-2xl bg-gradient-to-br from-orange-50 via-white to-amber-50 dark:from-slate-800/50 dark:to-slate-900/50 border border-orange-200/40 dark:border-slate-700/50 shadow-lg shadow-orange-500/10">
        <div>
          <h2 className="text-4xl font-thin text-slate-900 dark:text-white tracking-tight mb-2">
            Loan Folders
          </h2>
          <p className="text-base text-slate-600 dark:text-slate-400 font-extralight tracking-wide">
            Manage which Encompass folders to sync from for {currentTenantName || 'selected tenant'}
          </p>
        </div>
      </div>

      {loadingConnections ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      ) : encompassConnections.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-slate-500 dark:text-slate-400">
            No Encompass LOS connections found for this tenant. Add a connection in Connections &
            Integrations first.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {encompassConnections.map((connection) => {
            const state = folderStateByConnection[connection.id];
            return (
              <Card
                key={connection.id}
                className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50"
              >
                <CardHeader>
                  <CardTitle className="text-lg font-thin flex items-center gap-2">
                    <Folder className="h-5 w-5" />
                    {connection.name}
                  </CardTitle>
                  <CardDescription>
                    Select which Encompass folders to sync loans from. Selected: {state?.selected.length ?? 0}.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(state?.warning || state?.error) && (
                    <Alert variant={state.error ? 'destructive' : 'default'}>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>{state.error ? 'Error' : 'Warning'}</AlertTitle>
                      <AlertDescription>{state.error || state.warning}</AlertDescription>
                    </Alert>
                  )}

                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      Available folders from Encompass
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => loadFoldersForConnection(connection.id)}
                      disabled={state?.loading}
                    >
                      {state?.loading ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-2" />
                      )}
                      Refresh Folders
                    </Button>
                  </div>

                  {state?.loading && !state.folders.length ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                    </div>
                  ) : state?.folders && state.folders.length > 0 ? (
                    <div className="space-y-2 max-h-[300px] overflow-y-auto border rounded-md p-3">
                      {state.folders.map((folder) => (
                        <div key={folder.folderName} className="flex items-center space-x-2">
                          <Checkbox
                            id={`${connection.id}-${folder.folderName}`}
                            checked={state.selected.includes(folder.folderName)}
                            onCheckedChange={(checked) => {
                              const next = checked
                                ? [...state.selected, folder.folderName]
                                : state.selected.filter((f) => f !== folder.folderName);
                              setSelectedForConnection(connection.id, next);
                            }}
                          />
                          <Label
                            htmlFor={`${connection.id}-${folder.folderName}`}
                            className="text-sm font-normal cursor-pointer flex-1"
                          >
                            {folder.folderName}
                          </Label>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500 text-center py-6 border rounded-md">
                      {state?.loading
                        ? 'Loading folders...'
                        : 'No folders available. Click "Refresh Folders" to load from Encompass.'}
                    </div>
                  )}

                  {state && state.selected.length > 0 && (
                    <div className="text-xs text-slate-600 dark:text-slate-400 p-2 bg-slate-50 dark:bg-slate-800 rounded">
                      <strong>Selected ({state.selected.length}):</strong> {state.selected.join(', ')}
                    </div>
                  )}

                  <div className="flex justify-end pt-2">
                    <Button
                      onClick={() => handleSave(connection.id)}
                      disabled={state?.saving || !state}
                    >
                      {state?.saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      <Save className="mr-2 h-4 w-4" />
                      Save Folders
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
