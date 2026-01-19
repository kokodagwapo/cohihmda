import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Search, Edit, Trash2, Plus, Shield, Loader2, CheckCircle2, Clock } from 'lucide-react';

interface User {
  id: string;
  email: string;
  created_at: string;
  email_confirmed_at: string | null;
  full_name: string | null;
  tenant_id: string | null;
  tenant_name: string | null;
  role?: string;
}

interface Tenant {
  id: string;
  name: string;
}

interface UserManagementSectionProps {
  users: User[];
  tenants: Tenant[];
  onCreateUser: (userData: any) => Promise<void>;
  onUpdateUser: (userId: string, userData: any) => Promise<void>;
  onDeleteUser: (userId: string) => Promise<void>;
}

const roleOptions = [
  { value: 'super_admin', label: 'Super Admin', description: 'Full system access' },
  { value: 'tenant_admin', label: 'Tenant Admin', description: 'Full tenant access' },
  { value: 'loan_officer', label: 'Loan Officer', description: 'Manage loans & contacts' },
  { value: 'processor', label: 'Processor', description: 'Process loans' },
  { value: 'viewer', label: 'Viewer', description: 'Read-only access' },
  { value: 'user', label: 'User', description: 'Basic access' },
];

const getRoleBadgeColor = (role?: string) => {
  switch (role) {
    case 'super_admin':
      return 'bg-gradient-to-r from-red-500 to-rose-600 text-white shadow-md';
    case 'tenant_admin':
      return 'bg-gradient-to-r from-purple-500 to-violet-600 text-white shadow-md';
    case 'loan_officer':
      return 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-md';
    case 'processor':
      return 'bg-gradient-to-r from-cyan-500 to-teal-600 text-white shadow-md';
    case 'viewer':
      return 'bg-gradient-to-r from-slate-400 to-slate-500 text-white shadow-md';
    default:
      return 'bg-gradient-to-r from-gray-400 to-gray-500 text-white shadow-md';
  }
};

const getRoleLabel = (role?: string) => {
  const option = roleOptions.find(r => r.value === role);
  return option?.label || 'User';
};

export function UserManagementSection({
  users,
  tenants,
  onCreateUser,
  onUpdateUser,
  onDeleteUser,
}: UserManagementSectionProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [saving, setSaving] = useState(false);
  
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    full_name: '',
    tenant_id: '',
    role: 'user',
  });

  const filteredUsers = users.filter(user =>
    user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (user.full_name && user.full_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (user.role && user.role.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const handleCreate = async () => {
    try {
      setSaving(true);
      await onCreateUser(formData);
      setCreateDialogOpen(false);
      setFormData({ email: '', password: '', full_name: '', tenant_id: '', role: 'user' });
    } catch (error: any) {
      console.error('Error creating user:', error);
      alert(`Error creating user: ${error.message || 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!selectedUser) return;
    try {
      setSaving(true);
      await onUpdateUser(selectedUser.id, {
        email: formData.email,
        full_name: formData.full_name,
        tenant_id: formData.tenant_id || null,
        role: formData.role,
      });
      setEditDialogOpen(false);
      setSelectedUser(null);
      setFormData({ email: '', password: '', full_name: '', tenant_id: '', role: 'user' });
    } catch (error: any) {
      console.error('Error updating user:', error);
      alert(`Error updating user: ${error.message || 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedUser) return;
    try {
      setSaving(true);
      await onDeleteUser(selectedUser.id);
      setDeleteDialogOpen(false);
      setSelectedUser(null);
    } finally {
      setSaving(false);
    }
  };

  const openEditDialog = (user: User) => {
    setSelectedUser(user);
    setFormData({
      email: user.email,
      password: '',
      full_name: user.full_name || '',
      tenant_id: user.tenant_id || '',
      role: user.role || 'user',
    });
    setEditDialogOpen(true);
  };

  const openDeleteDialog = (user: User) => {
    setSelectedUser(user);
    setDeleteDialogOpen(true);
  };

  return (
    <>
      <Card className="border-blue-200/40 dark:border-slate-700/50 bg-white dark:bg-slate-800/70 backdrop-blur-sm shadow-[0_8px_24px_rgba(59,130,246,0.08)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.3)] hover:shadow-[0_12px_32px_rgba(59,130,246,0.15)] dark:hover:shadow-[0_12px_32px_rgba(0,0,0,0.4)] transition-all duration-300 rounded-xl">
        <CardHeader className="border-b border-blue-100/50 dark:border-slate-700/50 pb-6 bg-gradient-to-r from-blue-50/30 to-purple-50/30">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl font-extralight text-slate-900 dark:text-white tracking-tight mb-1.5">
                User Management
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light tracking-wide">
                Manage system users, roles, and permissions
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search users..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-64 text-base font-extralight"
                />
              </div>
              <Button
                onClick={() => setCreateDialogOpen(true)}
                className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-light shadow-lg hover:shadow-xl transition-all duration-300 rounded-xl"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create User
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-200 dark:border-slate-700">
                  <TableHead className="text-base font-extralight text-slate-600 dark:text-slate-400">User</TableHead>
                  <TableHead className="text-base font-extralight text-slate-600 dark:text-slate-400">Email</TableHead>
                  <TableHead className="text-base font-extralight text-slate-600 dark:text-slate-400">Role</TableHead>
                  <TableHead className="text-base font-extralight text-slate-600 dark:text-slate-400">Tenant</TableHead>
                  <TableHead className="text-base font-extralight text-slate-600 dark:text-slate-400">Status</TableHead>
                  <TableHead className="text-base font-extralight text-slate-600 dark:text-slate-400">Created</TableHead>
                  <TableHead className="text-base font-extralight text-slate-600 dark:text-slate-400">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user) => (
                  <TableRow key={user.id} className="border-blue-100/30 dark:border-slate-700 hover:bg-blue-50/40 dark:hover:bg-slate-700/20 transition-colors duration-200">
                    <TableCell className="font-extralight text-slate-900 dark:text-white">
                      {user.full_name || 'N/A'}
                    </TableCell>
                    <TableCell className="text-base font-extralight text-slate-600 dark:text-slate-400">
                      {user.email}
                    </TableCell>
                    <TableCell>
                      <Badge variant="default" className={`${getRoleBadgeColor(user.role)} border-0 font-medium px-3 py-1 rounded-full`}>
                        <Shield className="h-3 w-3 mr-1.5" />
                        {getRoleLabel(user.role)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-base font-extralight text-slate-600 dark:text-slate-400">
                      {user.tenant_name || <span className="text-slate-400 dark:text-slate-500 italic">No tenant</span>}
                    </TableCell>
                    <TableCell>
                      {user.email_confirmed_at ? (
                        <Badge variant="default" className="bg-gradient-to-r from-emerald-500 to-green-600 text-white border-0 shadow-sm font-medium">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Verified
                        </Badge>
                      ) : (
                        <Badge variant="default" className="bg-gradient-to-r from-amber-500 to-orange-600 text-white border-0 shadow-sm font-medium">
                          <Clock className="h-3 w-3 mr-1" />
                          Pending
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-base font-extralight text-slate-600 dark:text-slate-400">
                      {new Date(user.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 w-9 p-0 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/20 hover:text-blue-600 dark:hover:text-blue-400 transition-all duration-200"
                          onClick={() => openEditDialog(user)}
                        >
                          <Edit className="h-4 w-4" strokeWidth={2} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 w-9 p-0 rounded-lg text-red-500 hover:text-red-700 hover:bg-red-100 dark:hover:bg-red-900/20 transition-all duration-200"
                          onClick={() => openDeleteDialog(user)}
                        >
                          <Trash2 className="h-4 w-4" strokeWidth={2} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredUsers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-slate-500 dark:text-slate-400 font-light py-8">
                      {searchQuery ? 'No users found matching your search' : 'No users found'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Create User Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-[600px] rounded-2xl border-slate-200/60 dark:border-slate-700/50 bg-white dark:bg-slate-800 shadow-2xl">
          <DialogHeader className="space-y-4 pb-6 px-2">
            <DialogTitle className="text-3xl font-extralight tracking-tight text-slate-900 dark:text-white">Create New User</DialogTitle>
            <DialogDescription className="text-base text-slate-600 dark:text-slate-400 font-light leading-relaxed">
              Add a new user to the system with specific role and permissions
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-2 px-2 max-h-[60vh] overflow-y-auto">
            <div className="space-y-3">
              <Label htmlFor="create-email" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Email Address <span className="text-red-500">*</span>
              </Label>
              <Input
                id="create-email"
                type="email"
                placeholder="user@example.com"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="h-12 rounded-xl border-slate-300 dark:border-slate-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:focus:ring-blue-400/20 transition-all text-base px-4"
              />
            </div>
            <div className="space-y-3">
              <Label htmlFor="create-password" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Password <span className="text-red-500">*</span>
              </Label>
              <Input
                id="create-password"
                type="password"
                placeholder="••••••••"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className={`h-12 rounded-xl border-slate-300 dark:border-slate-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:focus:ring-blue-400/20 transition-all text-base px-4 ${
                  formData.password && formData.password.length < 6 ? 'border-red-500 dark:border-red-500' : ''
                }`}
              />
              <p className={`text-xs mt-1.5 ${
                formData.password && formData.password.length < 6 
                  ? 'text-red-500 dark:text-red-400' 
                  : 'text-slate-500 dark:text-slate-400'
              }`}>
                Minimum 6 characters {formData.password && formData.password.length < 6 ? `(${formData.password.length}/6)` : ''}
              </p>
            </div>
            <div className="space-y-3">
              <Label htmlFor="create-full-name" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Full Name
              </Label>
              <Input
                id="create-full-name"
                placeholder="John Doe"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                className="h-12 rounded-xl border-slate-300 dark:border-slate-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:focus:ring-blue-400/20 transition-all text-base px-4"
              />
            </div>
            <div className="space-y-3">
              <Label htmlFor="create-role" className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                <Shield className="h-4 w-4 text-blue-500" />
                User Role <span className="text-red-500">*</span>
              </Label>
              <Select value={formData.role} onValueChange={(value) => setFormData({ ...formData, role: value })}>
                <SelectTrigger id="create-role" className="h-12 rounded-xl border-slate-300 dark:border-slate-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {roleOptions.map((role) => (
                    <SelectItem key={role.value} value={role.value} className="rounded-lg my-1 py-3">
                      <div className="flex flex-col py-1">
                        <span className="font-medium text-slate-900 dark:text-white">{role.label}</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-light">{role.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">Determines user permissions and access level</p>
            </div>
            <div className="space-y-3">
              <Label htmlFor="create-tenant" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Tenant (Optional)
              </Label>
              <Select value={formData.tenant_id || "none"} onValueChange={(value) => setFormData({ ...formData, tenant_id: value === "none" ? "" : value })}>
                <SelectTrigger id="create-tenant" className="h-12 rounded-xl border-slate-300 dark:border-slate-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-base">
                  <SelectValue placeholder="No tenant" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="none" className="rounded-lg py-2.5">
                    <span className="text-slate-400 italic">No tenant</span>
                  </SelectItem>
                  {tenants.map((tenant) => (
                    <SelectItem key={tenant.id} value={tenant.id} className="rounded-lg my-1 py-2.5">
                      {tenant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">Leave empty for super admin users</p>
            </div>
          </div>
          <DialogFooter className="gap-3 pt-6 px-2 border-t border-slate-200 dark:border-slate-700 mt-2">
            <Button 
              variant="outline" 
              onClick={() => setCreateDialogOpen(false)} 
              disabled={saving}
              className="h-11 px-6 rounded-xl font-medium border-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleCreate} 
              disabled={saving || !formData.email || !formData.password || formData.password.length < 6}
              className="h-11 px-6 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-medium shadow-lg hover:shadow-xl transition-all duration-300 rounded-xl"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Create User
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-[600px] rounded-2xl border-slate-200/60 dark:border-slate-700/50 bg-white dark:bg-slate-800 shadow-2xl">
          <DialogHeader className="space-y-4 pb-6 px-2">
            <DialogTitle className="text-3xl font-extralight tracking-tight text-slate-900 dark:text-white">Edit User</DialogTitle>
            <DialogDescription className="text-base text-slate-600 dark:text-slate-400 font-light leading-relaxed">
              Update user information, role, and permissions
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-2 px-2 max-h-[60vh] overflow-y-auto">
            <div className="space-y-3">
              <Label htmlFor="edit-email" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Email Address
              </Label>
              <Input
                id="edit-email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="h-12 rounded-xl border-slate-300 dark:border-slate-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all text-base px-4"
              />
            </div>
            <div className="space-y-3">
              <Label htmlFor="edit-full-name" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Full Name
              </Label>
              <Input
                id="edit-full-name"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                className="h-12 rounded-xl border-slate-300 dark:border-slate-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all text-base px-4"
              />
            </div>
            <div className="space-y-3">
              <Label htmlFor="edit-role" className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                <Shield className="h-4 w-4 text-blue-500" />
                User Role
              </Label>
              <Select value={formData.role} onValueChange={(value) => setFormData({ ...formData, role: value })}>
                <SelectTrigger id="edit-role" className="h-12 rounded-xl border-slate-300 dark:border-slate-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {roleOptions.map((role) => (
                    <SelectItem key={role.value} value={role.value} className="rounded-lg my-1 py-3">
                      <div className="flex flex-col py-1">
                        <span className="font-medium text-slate-900 dark:text-white">{role.label}</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-light">{role.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-3">
              <Label htmlFor="edit-tenant" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Tenant
              </Label>
              <Select value={formData.tenant_id || "none"} onValueChange={(value) => setFormData({ ...formData, tenant_id: value === "none" ? "" : value })}>
                <SelectTrigger id="edit-tenant" className="h-12 rounded-xl border-slate-300 dark:border-slate-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-base">
                  <SelectValue placeholder="No tenant" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="none" className="rounded-lg py-2.5">
                    <span className="text-slate-400 italic">No tenant</span>
                  </SelectItem>
                  {tenants.map((tenant) => (
                    <SelectItem key={tenant.id} value={tenant.id} className="rounded-lg my-1 py-2.5">
                      {tenant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-3 pt-6 px-2 border-t border-slate-200 dark:border-slate-700 mt-2">
            <Button 
              variant="outline" 
              onClick={() => setEditDialogOpen(false)} 
              disabled={saving}
              className="h-11 px-6 rounded-xl font-medium border-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleEdit} 
              disabled={saving || !formData.email}
              className="h-11 px-6 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-medium shadow-lg hover:shadow-xl transition-all duration-300 rounded-xl"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[450px] rounded-2xl border-red-200/60 dark:border-red-700/50 bg-white/95 dark:bg-slate-800/95 backdrop-blur-xl shadow-2xl">
          <DialogHeader className="space-y-3 pb-2">
            <DialogTitle className="text-2xl font-light tracking-tight text-red-600 dark:text-red-400">Delete User</DialogTitle>
            <DialogDescription className="text-sm text-slate-600 dark:text-slate-400 font-light tracking-wide">
              Are you sure you want to delete this user? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {selectedUser && (
            <div className="py-4">
              <div className="bg-gradient-to-br from-red-50 to-rose-50/50 dark:from-red-900/20 dark:to-rose-900/10 border border-red-200/60 dark:border-red-700/50 rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-600 dark:text-slate-400 font-light min-w-[60px]">Email:</span>
                  <span className="font-extralight text-slate-900 dark:text-white">{selectedUser.email}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-600 dark:text-slate-400 font-light min-w-[60px]">Name:</span>
                  <span className="font-extralight text-slate-900 dark:text-white">{selectedUser.full_name || 'N/A'}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-600 dark:text-slate-400 font-light min-w-[60px]">Role:</span>
                  <Badge className={`${getRoleBadgeColor(selectedUser.role)} border-0 font-medium px-3 py-1 rounded-full`}>
                    <Shield className="h-3 w-3 mr-1.5" />
                    {getRoleLabel(selectedUser.role)}
                  </Badge>
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button 
              variant="outline" 
              onClick={() => setDeleteDialogOpen(false)} 
              disabled={saving}
              className="rounded-xl font-light"
            >
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleDelete} 
              disabled={saving}
              className="bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white font-light shadow-lg hover:shadow-xl transition-all duration-300 rounded-xl"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete User
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
