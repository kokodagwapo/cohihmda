import { useState, useEffect } from 'react';
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
  Crown,
  Eye
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useAdminTenant } from '@/contexts/AdminTenantContext';

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
  super_admin: { label: 'Super Admin', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: Crown },
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
  const [superAdmins, setSuperAdmins] = useState<UserDisplay[]>([]);
  const [tenantUsers, setTenantUsers] = useState<UserDisplay[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Filters - for tenant admins, always use 'all' since they can only see their own tenant's users anyway
  // The API already restricts them to their tenant, so no need to filter client-side
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTenant, setSelectedTenant] = useState<string>('all');
  
  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserDisplay | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    full_name: '',
    role: 'user',
    tenant_slug: '',
    is_super_admin: false,
  });

  // Load data on mount and when tenant context changes
  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTenantAdmin, selectedTenantId]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (isPlatformAdmin) {
        // Platform admins can see all users
        await Promise.all([
          loadSuperAdmins(),
          loadTenants(),
        ]);
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

  const loadSuperAdmins = async () => {
    if (!isPlatformAdmin) return; // Only platform admins can see super admins
    
    try {
      const response = await api.request('/api/admin/super-admins');
      const users = response.users.map((u: any) => ({
        ...u,
        is_super_admin: true,
      }));
      setSuperAdmins(users);
    } catch (error: any) {
      console.error('Failed to load super admins:', error);
      setSuperAdmins([]);
    }
  };
  
  const loadTenantUsersOnly = async () => {
    // For tenant admins, load only their tenant's users using the correct endpoint
    const tenantId = selectedTenantId || currentUser?.tenant_id;
    
    if (!tenantId) {
      console.error('No tenant ID available for tenant admin');
      setTenantUsers([]);
      return;
    }
    
    try {
      // Use the tenant-specific users endpoint
      const response = await api.request(`/api/admin/tenants/${tenantId}/users`);
      setTenantUsers(response.users || []);
      
      // Set the tenant info from response or from current user
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

  const loadTenants = async () => {
    try {
      // Load all data in one call
      const response = await api.request('/api/admin/all-users');
      
      setTenants(response.tenants || []);
      
      // Super admins are already loaded separately, but we can update if needed
      if (response.superAdmins) {
        setSuperAdmins(response.superAdmins.map((u: any) => ({ ...u, is_super_admin: true })));
      }
      
      // Tenant users come with tenant info attached
      setTenantUsers(response.tenantUsers || []);
    } catch (error: any) {
      console.error('Failed to load tenants and users:', error);
      // Fallback: try to load tenants separately
      try {
        const tenantsResponse = await api.request('/api/admin/tenants');
        setTenants(tenantsResponse.tenants || []);
        setTenantUsers([]);
      } catch (fallbackError) {
        setTenants([]);
        setTenantUsers([]);
      }
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

  // Filter users
  const filteredTenantUsers = tenantUsers.filter(user => {
    if (selectedTenant !== 'all' && user.tenant_slug !== selectedTenant) return false;
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

      {/* Stats - Shown differently for platform admins vs tenant admins */}
      <div className={`grid gap-4 ${isPlatformAdmin ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
        {isPlatformAdmin && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                  <Crown className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Super Admins</p>
                  <p className="text-2xl font-semibold">{superAdmins.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
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

      {/* Tabs - Platform admins see both, tenant admins only see tenant users */}
      <Tabs defaultValue={isPlatformAdmin ? "super-admins" : "tenant-users"} className="w-full">
        <TabsList className={`grid w-full ${isPlatformAdmin ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {isPlatformAdmin && (
            <TabsTrigger value="super-admins">
              <Crown className="h-4 w-4 mr-2" />
              Cohi Admins ({superAdmins.length})
            </TabsTrigger>
          )}
          <TabsTrigger value="tenant-users">
            <Users className="h-4 w-4 mr-2" />
            {isTenantAdmin ? `Organization Users (${tenantUsers.length})` : `Tenant Users (${tenantUsers.length})`}
          </TabsTrigger>
        </TabsList>

        {/* Super Admins Tab - Only for platform admins */}
        {isPlatformAdmin && (
          <TabsContent value="super-admins" className="space-y-4 mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Cohi Platform Admins</CardTitle>
                <CardDescription>
                  Internal team members with platform-wide access
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last Login</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {superAdmins.map(user => {
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
                          <Badge className={roleConfig.color}>
                            {roleConfig.label}
                          </Badge>
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
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(user)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Tenant Users Tab */}
        <TabsContent value="tenant-users" className="space-y-4 mt-6">
          {/* Filters */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search users..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                {/* Tenant filter - only shown for platform admins */}
                {isPlatformAdmin && (
                  <Select value={selectedTenant} onValueChange={setSelectedTenant}>
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="Filter by tenant" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Tenants</SelectItem>
                      {tenants.map(tenant => (
                        <SelectItem key={tenant.slug} value={tenant.slug}>
                          {tenant.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                          onClick={() => openEditDialog(user)}
                        >
                            <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                            onClick={() => handleToggleActive(user)}
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
                      <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                        {searchQuery || selectedTenant !== 'all'
                          ? 'No users match your filters'
                          : 'No tenant users found'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
        </CardContent>
      </Card>
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
    </motion.div>
  );
}

export default UserManagementSection;
