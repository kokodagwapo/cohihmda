import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { 
  Users,
  UserPlus,
  Search,
  RefreshCw,
  Edit2,
  Trash2,
  Shield,
  Building2,
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  Link2,
  Settings2,
  Database,
  Clock,
  AlertCircle,
  Unlink
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useAdminTenant } from '@/contexts/AdminTenantContext';
import { EncompassUserBrowserSection } from './EncompassUserBrowserSection';

/**
 * User type for display
 */
interface UserDisplay {
  id: string;
  email: string;
  full_name?: string;
  role: string;
  is_active: boolean;
  last_login_at?: string;
  created_at: string;
  // For tenant users
  tenant_id?: string;
  tenant_name?: string;
  tenant_slug?: string;
  // For super admins
  is_super_admin?: boolean;
  // Encompass integration
  encompass_user_id?: string;
  los_connection_id?: string;
  loan_access_mode?: 'encompass_sync' | 'full_access' | 'no_access' | 'manual';
  loan_access_synced_at?: string;
}

/**
 * Tenant type
 */
interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  database_name: string;
  created_at: string;
}

// Role display names and colors
const ROLE_CONFIG: Record<string, { label: string; color: string; icon: typeof Shield }> = {
  super_admin: { label: 'Super Admin', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: Shield },
  platform_admin: { label: 'Platform Admin', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400', icon: Shield },
  support: { label: 'Support', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: Shield },
  tenant_admin: { label: 'Tenant Admin', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', icon: Building2 },
  admin: { label: 'Admin', color: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400', icon: Shield },
  user: { label: 'User', color: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300', icon: Users },
  viewer: { label: 'Viewer', color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400', icon: Eye },
  loan_officer: { label: 'Loan Officer', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400', icon: Users },
  processor: { label: 'Processor', color: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400', icon: Users },
};

export function UserManagementSection() {
  const { user: currentUser, isSuperAdmin } = useAuth();
  const { toast } = useToast();
  
  // Use admin tenant context for tenant awareness
  const { selectedTenantId, isTenantAdmin, isPlatformAdmin, currentTenantName } = useAdminTenant();
  
  // State
  const [tenantUsers, setTenantUsers] = useState<UserDisplay[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Encompass users state
  const [losConnections, setLosConnections] = useState<Array<{ id: string; name: string; connection_type: string }>>([]);
  const [selectedLosConnectionId, setSelectedLosConnectionId] = useState<string>('');
  
  // Search filter
  const [searchQuery, setSearchQuery] = useState('');
  
  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [loanAccessDialogOpen, setLoanAccessDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserDisplay | null>(null);
  
  // Loan access sync state
  const [syncingLoanAccess, setSyncingLoanAccess] = useState(false);
  const [updatingLoanAccessMode, setUpdatingLoanAccessMode] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    full_name: '',
    role: 'user',
    tenant_slug: '',
    is_super_admin: false,
  });

  // Load LOS connections for Encompass user sync
  const loadLosConnections = useCallback(async () => {
    const tenantId = selectedTenantId || currentUser?.tenant_id;
    if (!tenantId) return;
    
    try {
      // Use the LOS connections endpoint with tenant_id query parameter
      const response = await api.request(`/api/los/connections?tenant_id=${tenantId}`);
      const allConnections = response.connections || response || [];
      const connections = allConnections
        .filter((conn: any) => conn.los_type === 'encompass' && conn.is_active)
        .map((conn: any) => ({
          id: conn.id,
          name: conn.name,
          connection_type: conn.los_type,
        }));
      setLosConnections(connections);
      
      // Auto-select first connection if none selected
      if (connections.length > 0 && !selectedLosConnectionId) {
        setSelectedLosConnectionId(connections[0].id);
      }
    } catch (error) {
      console.error('Failed to load LOS connections:', error);
      setLosConnections([]);
    }
  }, [selectedTenantId, currentUser?.tenant_id, selectedLosConnectionId]);

  // Load data on mount and when tenant context changes
  useEffect(() => {
    loadData();
    loadLosConnections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTenantAdmin, selectedTenantId]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (isPlatformAdmin) {
        // Platform admins: if a tenant is selected, load only that tenant's users
        if (selectedTenantId) {
          await loadTenantUsersOnly();
        } else {
          // No tenant selected - load all tenants but no users until one is selected
          await loadTenantsOnly();
        }
      } else if (isTenantAdmin) {
        // Tenant admins only see their own tenant's users
        await loadTenantUsersOnly();
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to load user data',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const loadTenantUsersOnly = async () => {
    // Load users for a specific tenant
    const tenantId = selectedTenantId || currentUser?.tenant_id;
    
    if (!tenantId) {
      console.error('No tenant ID available');
      setTenantUsers([]);
      return;
    }
    
    try {
      // Use the tenant-specific users endpoint
      const response = await api.request(`/api/admin/tenants/${tenantId}/users`);
      
      // Add tenant info to each user for display
      const usersWithTenant = (response.users || []).map((user: UserDisplay) => ({
        ...user,
        tenant_id: response.tenant?.id || tenantId,
        tenant_name: response.tenant?.name || 'Unknown',
        tenant_slug: response.tenant?.slug || tenantId,
      }));
      
      setTenantUsers(usersWithTenant);
      
      // For platform admins, keep the existing tenants list; for tenant admins, set their tenant
      if (!isPlatformAdmin) {
        if (response.tenant) {
          setTenants([{
            id: response.tenant.id,
            name: response.tenant.name,
            slug: response.tenant.slug || response.tenant.id,
            status: 'active',
            database_name: '',
            created_at: '',
          }]);
        } else if (currentUser?.tenant_id && currentUser?.tenant_name) {
          setTenants([{
            id: currentUser.tenant_id,
            name: currentUser.tenant_name,
            slug: currentUser.tenant_id,
            status: 'active',
            database_name: '',
            created_at: '',
          }]);
        }
      }
    } catch (error: any) {
      console.error('Failed to load tenant users:', error);
      toast({
        title: 'Error',
        description: 'Failed to load users. Please try again.',
        variant: 'destructive',
      });
      setTenantUsers([]);
    }
  };

  const loadTenantsOnly = async () => {
    try {
      // Load only tenants list (for the filter dropdown)
      const tenantsResponse = await api.request('/api/admin/tenants');
      setTenants(tenantsResponse.tenants || []);
      setTenantUsers([]); // No users until a tenant is selected
    } catch (error: any) {
      console.error('Failed to load tenants:', error);
      setTenants([]);
      setTenantUsers([]);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadData();
      toast({
        title: 'Refreshed',
        description: 'User data updated'
      });
    } finally {
      setRefreshing(false);
    }
  };

  const handleCreateUser = async () => {
    try {
      // Tenant admins can only create tenant users (never super admins)
      if (formData.is_super_admin && !isPlatformAdmin) {
        toast({ title: 'Error', description: 'You do not have permission to create super admins', variant: 'destructive' });
        return;
      }
      
      if (formData.is_super_admin) {
        // Create super admin in management database (platform admins only)
        await api.request('/api/admin/super-admins', {
          method: 'POST',
          body: JSON.stringify({
            email: formData.email,
            password: formData.password,
            full_name: formData.full_name,
            role: formData.role || 'platform_admin',
          }),
        });
      } else {
        // Determine tenant ID:
        // - For tenant admins: use their own tenant ID
        // - For platform admins: use selected tenant from form
        let tenantId: string | null = null;
        
        if (isTenantAdmin) {
          // Tenant admins always create users in their own tenant
          tenantId = selectedTenantId || currentUser?.tenant_id || null;
        } else if (formData.tenant_slug) {
          // Platform admins select tenant from dropdown
          const tenant = tenants.find(t => t.slug === formData.tenant_slug);
          tenantId = tenant?.id || null;
        }
        
        if (!tenantId) {
          toast({ title: 'Error', description: 'Please select a tenant', variant: 'destructive' });
          return;
        }
        
        // Create user in tenant database
        await api.request(`/api/admin/tenants/${tenantId}/users`, {
          method: 'POST',
          body: JSON.stringify({
            email: formData.email,
            password: formData.password,
            full_name: formData.full_name,
            role: formData.role || 'user',
          }),
        });
      }
      
      toast({
        title: 'User Created',
        description: `User ${formData.email} has been created successfully`
      });
      setCreateDialogOpen(false);
      resetForm();
      await loadData();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create user',
        variant: 'destructive'
      });
    }
  };

  const handleEditUser = async () => {
    if (!selectedUser) return;
    
    try {
      const updateData: any = {};
      if (formData.email !== selectedUser.email) updateData.email = formData.email;
      if (formData.full_name !== selectedUser.full_name) updateData.full_name = formData.full_name;
      if (formData.role !== selectedUser.role) updateData.role = formData.role;
      if (formData.password) updateData.password = formData.password;
      
      if (selectedUser.is_super_admin) {
        // Update super admin
        await api.request(`/api/admin/super-admins/${selectedUser.id}`, {
          method: 'PUT',
          body: JSON.stringify(updateData),
        });
      } else {
        // Update tenant user
        await api.request(`/api/admin/tenants/${selectedUser.tenant_id}/users/${selectedUser.id}`, {
          method: 'PUT',
          body: JSON.stringify(updateData),
        });
      }
      
      toast({
        title: 'User Updated',
        description: `User ${selectedUser.email} has been updated`
      });
      setEditDialogOpen(false);
      setSelectedUser(null);
      await loadData();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update user',
        variant: 'destructive'
      });
    }
  };

  const handleDeleteUser = async (user: UserDisplay) => {
    if (!confirm(`Are you sure you want to delete ${user.email}?`)) return;
    
    try {
      if (user.is_super_admin) {
        await api.request(`/api/admin/super-admins/${user.id}`, { method: 'DELETE' });
      } else {
        await api.request(`/api/admin/tenants/${user.tenant_id}/users/${user.id}`, { method: 'DELETE' });
      }
      
      toast({
        title: 'User Deleted',
        description: `User ${user.email} has been deleted`
      });
      await loadData();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete user',
        variant: 'destructive'
      });
    }
  };

  const handleToggleActive = async (user: UserDisplay) => {
    try {
      const newStatus = !user.is_active;
      
      if (user.is_super_admin) {
        await api.request(`/api/admin/super-admins/${user.id}`, {
          method: 'PUT',
          body: JSON.stringify({ is_active: newStatus }),
        });
      } else {
        await api.request(`/api/admin/tenants/${user.tenant_id}/users/${user.id}`, {
          method: 'PUT',
          body: JSON.stringify({ is_active: newStatus }),
        });
      }
      
      toast({
        title: newStatus ? 'User Activated' : 'User Deactivated',
        description: `User ${user.email} has been ${newStatus ? 'activated' : 'deactivated'}`
      });
      await loadData();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update user status',
        variant: 'destructive'
      });
    }
  };

  const resetForm = () => {
    setFormData({
      email: '',
      password: '',
      full_name: '',
      role: 'user',
      tenant_slug: '',
      is_super_admin: false,
    });
  };

  const openEditDialog = (user: UserDisplay) => {
    setSelectedUser(user);
    setFormData({
      email: user.email,
      password: '',
      full_name: user.full_name || '',
      role: user.role,
      tenant_slug: user.tenant_slug || '',
      is_super_admin: user.is_super_admin || false,
    });
    setEditDialogOpen(true);
  };

  const openLoanAccessDialog = (user: UserDisplay) => {
    setSelectedUser(user);
    setLoanAccessDialogOpen(true);
  };

  const handleSyncLoanAccess = async () => {
    if (!selectedUser) return;
    
    // Get tenant context - use selected tenant for platform admins, or user's tenant
    const tenantId = selectedTenantId || selectedUser.tenant_id || currentUser?.tenant_id;
    if (!tenantId) {
      toast({
        title: 'Error',
        description: 'No tenant context available. Please select a tenant.',
        variant: 'destructive',
      });
      return;
    }
    
    setSyncingLoanAccess(true);
    try {
      const response = await api.request(`/api/admin/users/${selectedUser.id}/sync-loan-access`, {
        method: 'POST',
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      
      toast({
        title: 'Loan Access Synced',
        description: `Synced ${response.loansAccessible} accessible loans for ${selectedUser.full_name || selectedUser.email}`,
      });
      
      // Refresh user data
      await loadData();
      setLoanAccessDialogOpen(false);
    } catch (error: any) {
      toast({
        title: 'Sync Failed',
        description: error.message || 'Failed to sync loan access from Encompass',
        variant: 'destructive',
      });
    } finally {
      setSyncingLoanAccess(false);
    }
  };

  const handleUpdateLoanAccessMode = async (mode: 'encompass_sync' | 'full_access' | 'no_access' | 'manual') => {
    if (!selectedUser) return;
    
    // Get tenant context
    const tenantId = selectedTenantId || selectedUser.tenant_id || currentUser?.tenant_id;
    if (!tenantId) {
      toast({
        title: 'Error',
        description: 'No tenant context available',
        variant: 'destructive',
      });
      return;
    }
    
    setUpdatingLoanAccessMode(true);
    try {
      await api.request(`/api/admin/tenants/${tenantId}/users/${selectedUser.id}`, {
        method: 'PUT',
        body: JSON.stringify({ loan_access_mode: mode }),
      });
      
      toast({
        title: 'Loan Access Mode Updated',
        description: `Updated to "${mode}" for ${selectedUser.full_name || selectedUser.email}`,
      });
      
      // Update local state
      setSelectedUser({ ...selectedUser, loan_access_mode: mode });
      await loadData();
    } catch (error: any) {
      toast({
        title: 'Update Failed',
        description: error.message || 'Failed to update loan access mode',
        variant: 'destructive',
      });
    } finally {
      setUpdatingLoanAccessMode(false);
    }
  };

  // Filter users by search query
  const filteredTenantUsers = tenantUsers.filter(user => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        user.email.toLowerCase().includes(query) ||
        user.full_name?.toLowerCase().includes(query) ||
        user.tenant_name?.toLowerCase().includes(query)
      );
    }
    return true;
  });

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-center h-64"
      >
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
          <h2 className="text-2xl font-light text-slate-900 dark:text-white">
                User Management
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Manage platform users and tenant users
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => setCreateDialogOpen(true)}
          >
            <UserPlus className="h-4 w-4 mr-2" />
            Add User
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className={`grid gap-4 ${isPlatformAdmin ? 'md:grid-cols-2' : 'md:grid-cols-2'}`}>
        {isPlatformAdmin && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                  <Building2 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Tenants</p>
                  <p className="text-2xl font-semibold">{tenants.length}</p>
                </div>
            </div>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                <Users className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-sm text-slate-500">{isTenantAdmin ? 'Organization Users' : 'Tenant Users'}</p>
                <p className="text-2xl font-semibold">{tenantUsers.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        {isTenantAdmin && currentTenantName && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                  <Building2 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Organization</p>
                  <p className="text-lg font-medium">{currentTenantName}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Tabs for tenant user management */}
      <Tabs defaultValue="tenant-users" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="tenant-users">
            <Users className="h-4 w-4 mr-2" />
            Cohi Users ({tenantUsers.length})
          </TabsTrigger>
          <TabsTrigger value="encompass-users">
            <Link2 className="h-4 w-4 mr-2" />
            Encompass Directory
          </TabsTrigger>
        </TabsList>

        {/* Cohi Users Tab - Users with accounts on the platform */}
        <TabsContent value="tenant-users" className="space-y-4 mt-6">
          {/* Platform admin without tenant selected - show prompt */}
          {isPlatformAdmin && !selectedTenantId ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Building2 className="h-12 w-12 mx-auto mb-4 text-slate-300 dark:text-slate-600" />
                <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">
                  Select a Tenant
                </h3>
                <p className="text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                  Use the tenant selector in the header to choose which organization's users to manage.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Filters */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row gap-4 items-center">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                      <Input
                        placeholder="Search users..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                    {/* Show current tenant for platform admins */}
                    {isPlatformAdmin && currentTenantName && (
                      <Badge variant="outline" className="text-blue-600 border-blue-200 dark:text-blue-400 dark:border-blue-800">
                        <Building2 className="h-3 w-3 mr-1" />
                        {currentTenantName}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Users Table */}
              <Card>
            <CardContent className="p-0">
            <Table>
              <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Tenant</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Encompass</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                  {filteredTenantUsers.map(user => {
                    const roleConfig = ROLE_CONFIG[user.role] || ROLE_CONFIG.user;
                    return (
                      <TableRow key={user.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{user.full_name || user.email}</p>
                            <p className="text-sm text-slate-500">{user.email}</p>
                          </div>
                    </TableCell>
                    <TableCell>
                          <Badge variant="outline">
                            <Building2 className="h-3 w-3 mr-1" />
                            {user.tenant_name}
                      </Badge>
                    </TableCell>
                        <TableCell>
                          <Badge className={roleConfig.color}>
                            {roleConfig.label}
                          </Badge>
                    </TableCell>
                    <TableCell>
                          {user.encompass_user_id ? (
                            <Badge variant="outline" className="text-blue-600 border-blue-200 dark:text-blue-400 dark:border-blue-800">
                              <Link2 className="h-3 w-3 mr-1" />
                              {user.encompass_user_id}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-slate-400 border-slate-200 dark:text-slate-500 dark:border-slate-700">
                              <Unlink className="h-3 w-3 mr-1" />
                              Not Linked
                            </Badge>
                          )}
                    </TableCell>
                    <TableCell>
                          {user.is_active ? (
                            <Badge variant="outline" className="text-emerald-600 border-emerald-200">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                              Active
                        </Badge>
                      ) : (
                            <Badge variant="outline" className="text-slate-500 border-slate-200">
                              <XCircle className="h-3 w-3 mr-1" />
                              Inactive
                        </Badge>
                      )}
                    </TableCell>
                        <TableCell className="text-sm text-slate-500">
                          {formatDate(user.last_login_at)}
                    </TableCell>
                        <TableCell className="text-right space-x-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openLoanAccessDialog(user)}
                          title="Loan Access Settings"
                        >
                            <Settings2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditDialog(user)}
                          title="Edit User"
                        >
                            <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                            onClick={() => handleToggleActive(user)}
                          title={user.is_active ? 'Deactivate User' : 'Activate User'}
                          >
                            {user.is_active ? (
                              <XCircle className="h-4 w-4 text-slate-500" />
                            ) : (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            )}
                        </Button>
                    </TableCell>
                  </TableRow>
                    );
                  })}
                  {filteredTenantUsers.length === 0 && (
                  <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-slate-500">
                        {searchQuery
                          ? 'No users match your search'
                          : 'No users found'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
        </CardContent>
      </Card>
            </>
          )}
        </TabsContent>

        {/* Encompass Users Tab */}
        <TabsContent value="encompass-users" className="space-y-4 mt-6">
          {losConnections.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Link2 className="h-12 w-12 mx-auto mb-4 text-slate-300 dark:text-slate-600" />
                <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">
                  No Encompass Connection Found
                </h3>
                <p className="text-slate-500 dark:text-slate-400 mb-4 max-w-md mx-auto">
                  To sync users from Encompass, you need to set up an LOS connection first. 
                  Go to <strong>Connections & Integrations</strong> to configure your Encompass connection.
                </p>
                <Button variant="outline" onClick={() => loadLosConnections()}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh Connections
                </Button>
              </CardContent>
            </Card>
          ) : (
            <EncompassUserBrowserSection
              losConnections={losConnections}
              selectedConnectionId={selectedLosConnectionId}
              onConnectionChange={setSelectedLosConnectionId}
            />
          )}
        </TabsContent>
      </Tabs>

      {/* Create User Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create User</DialogTitle>
            <DialogDescription>
              {isTenantAdmin 
                ? `Add a new user to ${currentTenantName || 'your organization'}`
                : 'Add a new user to the platform'
              }
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* User Type selector - only visible to platform admins */}
            {isPlatformAdmin && (
              <div className="space-y-2">
                <Label>User Type</Label>
                <Select
                  value={formData.is_super_admin ? 'super_admin' : 'tenant'}
                  onValueChange={(v) => setFormData({ 
                    ...formData, 
                    is_super_admin: v === 'super_admin',
                    role: v === 'super_admin' ? 'super_admin' : 'user'
                  })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="super_admin">Cohi Admin (Super Admin)</SelectItem>
                    <SelectItem value="tenant">Tenant User</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Tenant selector - only for platform admins creating tenant users */}
            {isPlatformAdmin && !formData.is_super_admin && (
              <div className="space-y-2">
                <Label>Tenant</Label>
                <Select
                  value={formData.tenant_slug}
                  onValueChange={(v) => setFormData({ ...formData, tenant_slug: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select tenant" />
                  </SelectTrigger>
                  <SelectContent>
                    {tenants.map(tenant => (
                      <SelectItem key={tenant.slug} value={tenant.slug}>
                        {tenant.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="user@example.com"
              />
            </div>

            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                placeholder="John Doe"
              />
            </div>

            <div className="space-y-2">
              <Label>Password</Label>
              <Input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="••••••••"
              />
            </div>

            {/* Role selector - different options for platform admins vs tenant admins */}
            {!formData.is_super_admin && (
              <div className="space-y-2">
                <Label>Role</Label>
                <Select
                  value={formData.role}
                  onValueChange={(v) => setFormData({ ...formData, role: v })}
                >
                  <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                  <SelectContent>
                    {/* Tenant admins can create other tenant admins for their org */}
                    <SelectItem value="tenant_admin">Tenant Admin</SelectItem>
                    <SelectItem value="loan_officer">Loan Officer</SelectItem>
                    <SelectItem value="processor">Processor</SelectItem>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateUser}>
                  Create User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update user information
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                disabled
              />
            </div>

            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>New Password (leave blank to keep current)</Label>
              <Input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="••••••••"
              />
            </div>

            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={formData.role}
                onValueChange={(v) => setFormData({ ...formData, role: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {formData.is_super_admin ? (
                    <>
                      <SelectItem value="super_admin">Super Admin</SelectItem>
                      <SelectItem value="platform_admin">Platform Admin</SelectItem>
                      <SelectItem value="support">Support</SelectItem>
                    </>
                  ) : (
                    <>
                      <SelectItem value="tenant_admin">Tenant Admin</SelectItem>
                      <SelectItem value="loan_officer">Loan Officer</SelectItem>
                      <SelectItem value="processor">Processor</SelectItem>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="viewer">Viewer</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditUser}>
                  Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Loan Access Settings Dialog */}
      <Dialog open={loanAccessDialogOpen} onOpenChange={setLoanAccessDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Loan Access Settings</DialogTitle>
            <DialogDescription>
              Configure how {selectedUser?.full_name || selectedUser?.email} accesses loan data
            </DialogDescription>
          </DialogHeader>

          {selectedUser && (
            <div className="space-y-6">
              {/* Encompass Link Status */}
              <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Link2 className="h-4 w-4" />
                  Encompass Link
                </h4>
                {selectedUser.encompass_user_id ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-600 dark:text-slate-400">Encompass User ID</span>
                      <Badge variant="outline" className="text-blue-600 border-blue-200 dark:text-blue-400">
                        {selectedUser.encompass_user_id}
                      </Badge>
                    </div>
                    {selectedUser.loan_access_synced_at && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600 dark:text-slate-400">Last Synced</span>
                        <span className="text-sm">{formatDate(selectedUser.loan_access_synced_at)}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                    <AlertCircle className="h-4 w-4" />
                    <span className="text-sm">
                      Not linked to Encompass. Invite from Encompass Directory to link.
                    </span>
                  </div>
                )}
              </div>

              {/* Loan Access Mode */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  Loan Data Access Mode
                </h4>
                <div className="space-y-2">
                  {[
                    { value: 'encompass_sync', label: 'Encompass Sync', desc: 'Access only loans they can see in Encompass', requiresLink: true },
                    { value: 'full_access', label: 'Full Access', desc: 'Access all loans (for admins)', requiresLink: false },
                    { value: 'no_access', label: 'No Access', desc: 'Cannot view individual loans', requiresLink: false },
                    { value: 'manual', label: 'Manual', desc: 'Manually configured loan access', requiresLink: false },
                  ].map((option) => {
                    const isSelected = selectedUser.loan_access_mode === option.value;
                    const isDisabled = option.requiresLink && !selectedUser.encompass_user_id;
                    return (
                      <div
                        key={option.value}
                        onClick={() => !isDisabled && !isSelected && handleUpdateLoanAccessMode(option.value as any)}
                        className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                            : isDisabled
                            ? 'border-slate-200 dark:border-slate-700 opacity-50 cursor-not-allowed'
                            : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className={`font-medium ${isSelected ? 'text-blue-700 dark:text-blue-300' : ''}`}>
                              {option.label}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {option.desc}
                            </p>
                          </div>
                          {isSelected && (
                            <CheckCircle2 className="h-5 w-5 text-blue-500" />
                          )}
                        </div>
                        {isDisabled && (
                          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                            Requires Encompass link
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
                {updatingLoanAccessMode && (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Updating...
                  </div>
                )}
              </div>

              {/* Sync Button */}
              {selectedUser.encompass_user_id && selectedUser.loan_access_mode === 'encompass_sync' && (
                <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                  <Button
                    onClick={handleSyncLoanAccess}
                    disabled={syncingLoanAccess}
                    className="w-full"
                  >
                    {syncingLoanAccess ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Syncing Loan Access...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Sync Loan Access from Encompass
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 text-center">
                    This queries Encompass with the user's permissions to determine which loans they can access.
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setLoanAccessDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

export default UserManagementSection;
