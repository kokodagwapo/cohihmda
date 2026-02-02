/**
 * Platform Team Section
 * Management of Cohi internal team members (super_admin, platform_admin, support)
 * Only accessible to super_admin role
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
  Shield,
  Loader2,
  CheckCircle2,
  XCircle,
  Crown,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

interface PlatformUser {
  id: string;
  email: string;
  full_name?: string;
  role: string;
  is_active: boolean;
  last_login_at?: string;
  created_at: string;
}

// Role display names and colors for platform roles
const PLATFORM_ROLE_CONFIG: Record<string, { label: string; color: string; icon: typeof Shield }> = {
  super_admin: { label: 'Super Admin', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: Crown },
  platform_admin: { label: 'Platform Admin', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400', icon: Shield },
  support: { label: 'Support', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: Shield },
};

export function PlatformTeamSection() {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  
  // State
  const [platformUsers, setPlatformUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<PlatformUser | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    full_name: '',
    role: 'platform_admin',
  });

  useEffect(() => {
    loadPlatformUsers();
  }, []);

  const loadPlatformUsers = async () => {
    try {
      const response = await api.request('/api/admin/super-admins');
      const users = response.users.map((u: any) => ({
        id: u.id,
        email: u.email,
        full_name: u.full_name,
        role: u.role,
        is_active: u.is_active,
        last_login_at: u.last_login_at,
        created_at: u.created_at,
      }));
      setPlatformUsers(users);
    } catch (error: any) {
      console.error('Failed to load platform users:', error);
      toast({
        title: 'Error',
        description: 'Failed to load platform team members',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadPlatformUsers();
    setRefreshing(false);
  };

  const handleCreateUser = async () => {
    try {
      await api.request('/api/admin/super-admins', {
        method: 'POST',
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          full_name: formData.full_name,
          role: formData.role,
        }),
      });
      
      toast({
        title: 'Success',
        description: 'Platform team member created successfully',
      });
      
      setCreateDialogOpen(false);
      resetForm();
      loadPlatformUsers();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create team member',
        variant: 'destructive'
      });
    }
  };

  const handleUpdateUser = async () => {
    if (!selectedUser) return;
    
    try {
      await api.request(`/api/admin/super-admins/${selectedUser.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          full_name: formData.full_name,
          role: formData.role,
          is_active: selectedUser.is_active,
        }),
      });
      
      toast({
        title: 'Success',
        description: 'Team member updated successfully',
      });
      
      setEditDialogOpen(false);
      setSelectedUser(null);
      resetForm();
      loadPlatformUsers();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update team member',
        variant: 'destructive'
      });
    }
  };

  const openEditDialog = (user: PlatformUser) => {
    setSelectedUser(user);
    setFormData({
      email: user.email,
      password: '',
      full_name: user.full_name || '',
      role: user.role,
    });
    setEditDialogOpen(true);
  };

  const resetForm = () => {
    setFormData({
      email: '',
      password: '',
      full_name: '',
      role: 'platform_admin',
    });
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Filter users based on search
  const filteredUsers = platformUsers.filter(user => {
    const searchLower = searchQuery.toLowerCase();
    return (
      user.email.toLowerCase().includes(searchLower) ||
      (user.full_name?.toLowerCase().includes(searchLower))
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
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
      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Crown className="h-6 w-6 text-amber-500" />
              <div>
                <CardTitle className="text-xl font-thin text-slate-900 dark:text-white tracking-tight">
                  Platform Team
                </CardTitle>
                <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
                  Manage Cohi internal team members with platform-wide access
                </CardDescription>
              </div>
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
                Add Team Member
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Search and List */}
      <Card>
        <CardContent className="p-4">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search team members..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

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
              {filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-slate-500">
                    {searchQuery ? 'No team members match your search' : 'No platform team members found'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredUsers.map(user => {
                  const roleConfig = PLATFORM_ROLE_CONFIG[user.role] || PLATFORM_ROLE_CONFIG.platform_admin;
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
                          disabled={user.id === currentUser?.id}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Platform Team Member</DialogTitle>
            <DialogDescription>
              Create a new Cohi internal team member with platform-wide access
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                placeholder="team@cohi.io"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="full_name">Full Name</Label>
              <Input
                id="full_name"
                value={formData.full_name}
                onChange={(e) => setFormData(prev => ({ ...prev, full_name: e.target.value }))}
                placeholder="John Doe"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                placeholder="••••••••"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select
                value={formData.role}
                onValueChange={(value) => setFormData(prev => ({ ...prev, role: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" className="z-[9999]">
                  <SelectItem value="super_admin">Super Admin</SelectItem>
                  <SelectItem value="platform_admin">Platform Admin</SelectItem>
                  <SelectItem value="support">Support</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateUser}>
              Create Team Member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Team Member</DialogTitle>
            <DialogDescription>
              Update team member details
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={formData.email} disabled className="bg-slate-50" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_full_name">Full Name</Label>
              <Input
                id="edit_full_name"
                value={formData.full_name}
                onChange={(e) => setFormData(prev => ({ ...prev, full_name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_role">Role</Label>
              <Select
                value={formData.role}
                onValueChange={(value) => setFormData(prev => ({ ...prev, role: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" className="z-[9999]">
                  <SelectItem value="super_admin">Super Admin</SelectItem>
                  <SelectItem value="platform_admin">Platform Admin</SelectItem>
                  <SelectItem value="support">Support</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateUser}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

export default PlatformTeamSection;
