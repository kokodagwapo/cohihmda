/**
 * Create LOS Connection Dialog
 * Form for creating new LOS connections with Encompass-specific credential fields
 */

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

interface CreateLOSConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  losTypes: any;
  onCreate: (data: any) => Promise<any>; // Return created connection
  tenantId?: string; // Required for fetching folders
}

export function CreateLOSConnectionDialog({
  open,
  onOpenChange,
  losTypes,
  onCreate,
  tenantId,
}: CreateLOSConnectionDialogProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    los_type: 'encompass',
    name: '',
    connection_method: 'api',
    api_environment: 'production',
    // Encompass-specific fields
    encompass_instance_id: '',
    encompass_api_server: 'https://api.elliemae.com',
    encompass_extraction_method: 'partner',
    api_client_id: '',
    api_client_secret: '',
    encompass_sa_username: '',
    encompass_sa_password: '',
    encompass_selected_folders: [] as string[],
    // General fields
    sync_enabled: true,
    sync_frequency: 'daily', // Default to daily - controlled by super admin
  });

  const isEncompass = formData.los_type === 'encompass';
  const isPartnerFlow = formData.encompass_extraction_method === 'partner';
  const isRopcFlow = formData.encompass_extraction_method === 'ropc' || formData.encompass_extraction_method === 'api';
  
  const [availableFolders, setAvailableFolders] = useState<Array<{ folderName: string }>>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [connectionIdForFolders, setConnectionIdForFolders] = useState<string | null>(null);

  // Load folders function
  const loadFolders = async (connectionId?: string) => {
    const connId = connectionId || connectionIdForFolders;
    if (!connId || !tenantId) {
      return;
    }

    setLoadingFolders(true);
    try {
      const response = await api.request<{ folders: Array<{ folderName: string }> }>(
        `/api/encompass/folders/${connId}?tenant_id=${tenantId}`
      );
      setAvailableFolders(response.folders || []);
    } catch (error: any) {
      console.error('Error loading folders:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to load folders',
        variant: 'destructive',
      });
    } finally {
      setLoadingFolders(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const connectionData: any = {
        los_type: formData.los_type,
        name: formData.name,
        connection_method: formData.connection_method,
        api_environment: formData.api_environment,
        sync_enabled: formData.sync_enabled,
        sync_frequency: formData.sync_frequency,
      };

      // Add Encompass-specific fields
      if (isEncompass) {
        connectionData.encompass_instance_id = formData.encompass_instance_id;
        connectionData.encompass_api_server = formData.encompass_api_server;
        connectionData.encompass_extraction_method = formData.encompass_extraction_method;
        connectionData.api_client_id = formData.api_client_id;
        
        if (isPartnerFlow) {
          connectionData.api_client_secret = formData.api_client_secret;
          connectionData.encompass_sa_username = formData.encompass_sa_username;
        } else if (isRopcFlow) {
          connectionData.api_client_secret = formData.api_client_secret;
          connectionData.encompass_sa_username = formData.encompass_sa_username;
          connectionData.encompass_sa_password = formData.encompass_sa_password;
        }

        // Test credentials before saving (for Encompass)
        try {
          const testResult = await api.request('/api/los/connections/test-credentials', {
            method: 'POST',
            body: JSON.stringify({
              los_type: connectionData.los_type,
              encompass_instance_id: connectionData.encompass_instance_id,
              encompass_api_server: connectionData.encompass_api_server,
              encompass_extraction_method: connectionData.encompass_extraction_method,
              api_client_id: connectionData.api_client_id,
              api_client_secret: connectionData.api_client_secret,
              encompass_sa_username: connectionData.encompass_sa_username,
              encompass_sa_password: connectionData.encompass_sa_password,
            }),
          });

          if (!testResult.success) {
            throw new Error(testResult.message || 'Credential test failed');
          }
        } catch (testError: any) {
          toast({
            title: 'Credential Test Failed',
            description: testError.message || testError.details || 'Invalid credentials. Please check your credentials and try again.',
            variant: 'destructive',
          });
          setLoading(false);
          return;
        }
      }

      const createdConnection = await onCreate(connectionData);
      
      // If Encompass connection was created, fetch folders
      if (isEncompass && createdConnection?.id && tenantId) {
        setConnectionIdForFolders(createdConnection.id);
        // Load folders after a short delay to ensure connection is saved
        setTimeout(() => {
          loadFolders(createdConnection.id);
        }, 500);
        // Don't close dialog yet - let user select folders
      } else {
        onOpenChange(false);
        // Reset form for non-Encompass connections
        setFormData({
          los_type: 'encompass',
          name: '',
          connection_method: 'api',
          api_environment: 'production',
          encompass_instance_id: '',
          encompass_api_server: 'https://api.elliemae.com',
          encompass_extraction_method: 'partner',
          api_client_id: '',
          api_client_secret: '',
          encompass_sa_username: '',
          encompass_sa_password: '',
          encompass_selected_folders: [],
          sync_enabled: true,
          sync_frequency: 'daily',
        });
      }
    } catch (error: any) {
      // Error is handled by onCreate callback
      console.error('Error creating connection:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create LOS Connection</DialogTitle>
          <DialogDescription>
            Configure a new Loan Origination System connection
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-6 py-4">
            {/* Basic Information */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">Basic Information</h3>
              
                <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="los_type">LOS Type</Label>
                  <Select
                    value={formData.los_type}
                    onValueChange={(value) => setFormData({ ...formData, los_type: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select LOS type" />
                    </SelectTrigger>
                    <SelectContent className="z-[9999]" position="popper" sideOffset={4}>
                      {Object.entries(losTypes || {}).map(([key, config]: [string, any]) => (
                        <SelectItem key={key} value={key}>
                          {config.name || key}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="name">Connection Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Production Encompass"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="connection_method">Connection Method</Label>
                  <Select
                    value={formData.connection_method}
                    onValueChange={(value) => setFormData({ ...formData, connection_method: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select connection method" />
                    </SelectTrigger>
                    <SelectContent className="z-[9999]" position="popper" sideOffset={4}>
                      <SelectItem value="api">API</SelectItem>
                      <SelectItem value="csv_upload">CSV Upload</SelectItem>
                      <SelectItem value="database">Database</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="api_environment">Environment</Label>
                  <Select
                    value={formData.api_environment}
                    onValueChange={(value) => setFormData({ ...formData, api_environment: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select environment" />
                    </SelectTrigger>
                    <SelectContent className="z-[9999]" position="popper" sideOffset={4}>
                      <SelectItem value="production">Production</SelectItem>
                      <SelectItem value="sandbox">Sandbox</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Encompass-Specific Configuration */}
            {isEncompass && (
              <div className="space-y-4 border-t pt-4">
                <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">Encompass Configuration</h3>
                
                <div className="space-y-2">
                  <Label htmlFor="encompass_instance_id">Instance ID</Label>
                  <Input
                    id="encompass_instance_id"
                    value={formData.encompass_instance_id}
                    onChange={(e) => setFormData({ ...formData, encompass_instance_id: e.target.value })}
                    placeholder="e.g., BE123456 or TE123456"
                    required={isEncompass}
                  />
                  <p className="text-xs text-slate-500">
                    Your Encompass instance ID (starts with BE or TE)
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="encompass_api_server">API Server</Label>
                  <Input
                    id="encompass_api_server"
                    value={formData.encompass_api_server}
                    onChange={(e) => setFormData({ ...formData, encompass_api_server: e.target.value })}
                    placeholder="https://api.elliemae.com"
                  />
                  <p className="text-xs text-slate-500">
                    Encompass API server URL (default: https://api.elliemae.com, use https://concept.api.elliemae.com for test instances)
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="encompass_extraction_method">Extraction Method</Label>
                  <Select
                    value={formData.encompass_extraction_method}
                    onValueChange={(value) => setFormData({ ...formData, encompass_extraction_method: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select extraction method" />
                    </SelectTrigger>
                    <SelectContent className="z-[9999]" position="popper" sideOffset={4}>
                      <SelectItem value="partner">Partner Flow (Recommended)</SelectItem>
                      <SelectItem value="ropc">ROPC Flow</SelectItem>
                      <SelectItem value="api">API Flow</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500">
                    Partner Flow: Uses API Client ID and Secret (no SA credentials needed)
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="api_client_id">API Client ID</Label>
                    <Input
                      id="api_client_id"
                      type="text"
                      value={formData.api_client_id}
                      onChange={(e) => setFormData({ ...formData, api_client_id: e.target.value })}
                      placeholder="Your Encompass API Client ID"
                      required={isEncompass}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="api_client_secret">API Client Secret</Label>
                    <Input
                      id="api_client_secret"
                      type="password"
                      value={formData.api_client_secret}
                      onChange={(e) => setFormData({ ...formData, api_client_secret: e.target.value })}
                      placeholder="Your Encompass API Client Secret"
                      required={isEncompass}
                    />
                  </div>
                </div>

                {isPartnerFlow && (
                  <div className="space-y-2">
                    <Label htmlFor="encompass_sa_username_partner">API Username</Label>
                    <Input
                      id="encompass_sa_username_partner"
                      type="text"
                      value={formData.encompass_sa_username}
                      onChange={(e) => setFormData({ ...formData, encompass_sa_username: e.target.value })}
                      placeholder="Encompass API user login (e.g., apiuser)"
                    />
                    <p className="text-xs text-slate-500">
                      The Encompass user account associated with this partner integration. Used for user impersonation when accessing loan data.
                    </p>
                  </div>
                )}

                {/* ROPC/API Flow Fields */}
                {isRopcFlow && (
                  <div className="space-y-4 border-t pt-4">
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Service Account Credentials (Required for ROPC/API Flow)
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="encompass_sa_username">SA Username</Label>
                        <Input
                          id="encompass_sa_username"
                          type="text"
                          value={formData.encompass_sa_username}
                          onChange={(e) => setFormData({ ...formData, encompass_sa_username: e.target.value })}
                          placeholder="Service Account Username"
                          required={isRopcFlow}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="encompass_sa_password">SA Password</Label>
                        <Input
                          id="encompass_sa_password"
                          type="password"
                          value={formData.encompass_sa_password}
                          onChange={(e) => setFormData({ ...formData, encompass_sa_password: e.target.value })}
                          placeholder="Service Account Password"
                          required={isRopcFlow}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Folder Selection - Only show after connection is created/tested */}
                {connectionIdForFolders && (
                  <div className="space-y-4 border-t pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300">Loan Folders</h4>
                        <p className="text-xs text-slate-500 mt-1">
                          Select which Encompass folders to sync loans from
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => loadFolders()}
                        disabled={loadingFolders}
                      >
                        {loadingFolders ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Loading...
                          </>
                        ) : (
                          'Refresh Folders'
                        )}
                      </Button>
                    </div>

                    {availableFolders.length > 0 ? (
                      <div className="space-y-2 max-h-[200px] overflow-y-auto border rounded-md p-3">
                        {availableFolders.map((folder) => (
                          <div key={folder.folderName} className="flex items-center space-x-2">
                            <Checkbox
                              id={`folder-${folder.folderName}`}
                              checked={formData.encompass_selected_folders.includes(folder.folderName)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setFormData({
                                    ...formData,
                                    encompass_selected_folders: [...formData.encompass_selected_folders, folder.folderName],
                                  });
                                } else {
                                  setFormData({
                                    ...formData,
                                    encompass_selected_folders: formData.encompass_selected_folders.filter(
                                      (f) => f !== folder.folderName
                                    ),
                                  });
                                }
                              }}
                            />
                            <Label
                              htmlFor={`folder-${folder.folderName}`}
                              className="text-sm font-normal cursor-pointer"
                            >
                              {folder.folderName}
                            </Label>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-slate-500 text-center py-4">
                        {loadingFolders ? 'Loading folders...' : 'No folders available. Click "Refresh Folders" to load.'}
                      </div>
                    )}

                    {formData.encompass_selected_folders.length > 0 && (
                      <div className="text-xs text-slate-600 dark:text-slate-400">
                        Selected: {formData.encompass_selected_folders.join(', ')}
                      </div>
                    )}

                    <div className="flex justify-end gap-2 pt-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          // Update connection with selected folders
                          if (connectionIdForFolders && tenantId) {
                            api.request(`/api/los/connections/${connectionIdForFolders}?tenant_id=${tenantId}`, {
                              method: 'PUT',
                              body: JSON.stringify({
                                encompass_selected_folders: formData.encompass_selected_folders,
                              }),
                            }).then(() => {
                              toast({
                                title: 'Success',
                                description: 'Folders saved successfully',
                              });
                              onOpenChange(false);
                              // Reset form
                              setFormData({
                                los_type: 'encompass',
                                name: '',
                                connection_method: 'api',
                                api_environment: 'production',
                                encompass_instance_id: '',
                                encompass_api_server: 'https://api.elliemae.com',
                                encompass_extraction_method: 'partner',
                                api_client_id: '',
                                api_client_secret: '',
                                encompass_sa_username: '',
                                encompass_sa_password: '',
                                encompass_selected_folders: [],
                                sync_enabled: true,
                                sync_frequency: 'daily',
                              });
                              setConnectionIdForFolders(null);
                              setAvailableFolders([]);
                            });
                          }
                        }}
                      >
                        Save Folders & Close
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Sync Settings */}
            <div className="space-y-4 border-t pt-4">
              <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">Sync Settings</h3>
              
              <div className="space-y-2">
                <Label htmlFor="sync_frequency">Sync Frequency</Label>
                <Select
                  value={formData.sync_frequency}
                  onValueChange={(value) => setFormData({ ...formData, sync_frequency: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select sync frequency" />
                  </SelectTrigger>
                  <SelectContent className="z-[9999]" position="popper" sideOffset={4}>
                    <SelectItem value="realtime">Real-time</SelectItem>
                    <SelectItem value="hourly">Hourly</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Connection
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
