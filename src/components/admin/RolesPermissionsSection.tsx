import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { 
  Shield, 
  Plus, 
  Edit, 
  Trash2, 
  Copy, 
  Eye, 
  Search,
  Users,
  Filter,
  Layout,
  Lock,
  Unlock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronRight,
  Building,
  MapPin,
  UserCircle
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useAdminTenant } from '@/contexts/AdminTenantContext';

/**
 * Role type definition
 */
interface Role {
  id: string;
  name: string;
  description: string;
  is_system_role: boolean;
  is_default: boolean;
  tenant_id: string | null;
  created_at: string;
  updated_at: string;
  user_count?: number;
  permissions?: Permission[];
  field_filters?: FieldFilter[];
  section_access?: SectionAccess[];
}

/**
 * Permission definition
 */
interface Permission {
  resource: string;
  actions: {
    create: boolean;
    read: boolean;
    update: boolean;
    delete: boolean;
  };
}

/**
 * Field-based filter for RLS
 */
interface FieldFilter {
  id: string;
  field_name: string;
  operator: 'equals' | 'in' | 'starts_with' | 'contains';
  value: string | string[];
  is_dynamic: boolean; // If true, value is derived from user attribute
}

/**
 * Section access control
 */
interface SectionAccess {
  section_id: string;
  section_name: string;
  has_access: boolean;
}

// System roles that cannot be edited
const SYSTEM_ROLES = ['super_admin', 'tenant_admin'];

// Default sections available for access control
const DEFAULT_SECTIONS = [
  { id: 'insights', name: 'Insights Dashboard', description: 'Main analytics dashboard' },
  { id: 'loans', name: 'Loans', description: 'Loan data and details' },
  { id: 'leaderboard', name: 'Leaderboard', description: 'Performance rankings' },
  { id: 'funnel', name: 'Loan Funnel', description: 'Pipeline visualization' },
  { id: 'reports', name: 'Reports', description: 'Generated reports' },
  { id: 'data_quality', name: 'Data Quality', description: 'Data quality dashboard' },
];

// Default filter fields for RLS
const FILTER_FIELDS = [
  { name: 'branch_code', label: 'Branch', type: 'string', icon: Building },
  { name: 'loan_officer_email', label: 'Loan Officer (Email)', type: 'string', icon: UserCircle },
  { name: 'loan_officer_id', label: 'Loan Officer (ID)', type: 'string', icon: UserCircle },
  { name: 'region', label: 'Region', type: 'string', icon: MapPin },
  { name: 'channel', label: 'Channel', type: 'string', icon: Filter },
];

// Default resources for permission matrix
const RESOURCES = [
  { id: 'loans', name: 'Loans' },
  { id: 'users', name: 'Users' },
  { id: 'reports', name: 'Reports' },
  { id: 'settings', name: 'Settings' },
];

export function RolesPermissionsSection() {
  const { user } = useAuth();
  const { toast } = useToast();
  
  // Use admin tenant context
  const { selectedTenantId, isTenantAdmin, isPlatformAdmin } = useAdminTenant();
  
  // State
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  
  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [usersDialogOpen, setUsersDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state for create/edit
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    is_default: false,
    permissions: RESOURCES.map(r => ({
      resource: r.id,
      actions: { create: false, read: true, update: false, delete: false }
    })),
    field_filters: [] as FieldFilter[],
    section_access: DEFAULT_SECTIONS.map(s => ({
      section_id: s.id,
      section_name: s.name,
      has_access: true
    }))
  });

  // Load roles when tenant changes
  useEffect(() => {
    loadRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenantId]);

  const loadRoles = async () => {
    setLoading(true);
    try {
      // For now, use mock data - replace with API call
      // const response = await api.request(`/api/roles${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`);
      
      // Mock roles for development
      const mockRoles: Role[] = [
        {
          id: '1',
          name: 'Tenant Admin',
          description: 'Full administrative access to the organization',
          is_system_role: true,
          is_default: false,
          tenant_id: selectedTenantId || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          user_count: 2,
          permissions: RESOURCES.map(r => ({
            resource: r.id,
            actions: { create: true, read: true, update: true, delete: true }
          })),
          section_access: DEFAULT_SECTIONS.map(s => ({
            section_id: s.id,
            section_name: s.name,
            has_access: true
          }))
        },
        {
          id: '2',
          name: 'Loan Officer',
          description: 'Can view and manage their own loans',
          is_system_role: false,
          is_default: true,
          tenant_id: selectedTenantId || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          user_count: 15,
          permissions: [
            { resource: 'loans', actions: { create: false, read: true, update: false, delete: false } },
            { resource: 'users', actions: { create: false, read: false, update: false, delete: false } },
            { resource: 'reports', actions: { create: true, read: true, update: false, delete: false } },
            { resource: 'settings', actions: { create: false, read: false, update: false, delete: false } }
          ],
          field_filters: [
            {
              id: 'f1',
              field_name: 'loan_officer_email',
              operator: 'equals',
              value: '{{user.email}}',
              is_dynamic: true
            }
          ],
          section_access: [
            { section_id: 'insights', section_name: 'Insights Dashboard', has_access: true },
            { section_id: 'loans', section_name: 'Loans', has_access: true },
            { section_id: 'leaderboard', section_name: 'Leaderboard', has_access: true },
            { section_id: 'funnel', section_name: 'Loan Funnel', has_access: true },
            { section_id: 'reports', section_name: 'Reports', has_access: true },
            { section_id: 'data_quality', section_name: 'Data Quality', has_access: false }
          ]
        },
        {
          id: '3',
          name: 'Branch Manager',
          description: 'Can view all loans in their branch',
          is_system_role: false,
          is_default: false,
          tenant_id: selectedTenantId || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          user_count: 5,
          permissions: [
            { resource: 'loans', actions: { create: false, read: true, update: false, delete: false } },
            { resource: 'users', actions: { create: false, read: true, update: false, delete: false } },
            { resource: 'reports', actions: { create: true, read: true, update: true, delete: false } },
            { resource: 'settings', actions: { create: false, read: true, update: false, delete: false } }
          ],
          field_filters: [
            {
              id: 'f2',
              field_name: 'branch_code',
              operator: 'equals',
              value: '{{user.branch_code}}',
              is_dynamic: true
            }
          ],
          section_access: DEFAULT_SECTIONS.map(s => ({
            section_id: s.id,
            section_name: s.name,
            has_access: true
          }))
        },
        {
          id: '4',
          name: 'Viewer',
          description: 'Read-only access to all data',
          is_system_role: false,
          is_default: false,
          tenant_id: selectedTenantId || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          user_count: 8,
          permissions: RESOURCES.map(r => ({
            resource: r.id,
            actions: { create: false, read: true, update: false, delete: false }
          })),
          section_access: DEFAULT_SECTIONS.map(s => ({
            section_id: s.id,
            section_name: s.name,
            has_access: true
          }))
        }
      ];
      
      setRoles(mockRoles);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to load roles',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredRoles = roles.filter(role =>
    role.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    role.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      is_default: false,
      permissions: RESOURCES.map(r => ({
        resource: r.id,
        actions: { create: false, read: true, update: false, delete: false }
      })),
      field_filters: [],
      section_access: DEFAULT_SECTIONS.map(s => ({
        section_id: s.id,
        section_name: s.name,
        has_access: true
      }))
    });
  };

  const handleCreateRole = async () => {
    if (!formData.name.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Role name is required',
        variant: 'destructive'
      });
      return;
    }

    setSaving(true);
    try {
      // TODO: Replace with actual API call
      // await api.request('/api/roles', {
      //   method: 'POST',
      //   body: JSON.stringify({ ...formData, tenant_id: selectedTenantId })
      // });
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 500));
      
      toast({
        title: 'Success',
        description: `Role "${formData.name}" created successfully`
      });
      
      setCreateDialogOpen(false);
      resetForm();
      loadRoles();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create role',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleEditRole = (role: Role) => {
    setSelectedRole(role);
    setFormData({
      name: role.name,
      description: role.description,
      is_default: role.is_default,
      permissions: role.permissions || RESOURCES.map(r => ({
        resource: r.id,
        actions: { create: false, read: true, update: false, delete: false }
      })),
      field_filters: role.field_filters || [],
      section_access: role.section_access || DEFAULT_SECTIONS.map(s => ({
        section_id: s.id,
        section_name: s.name,
        has_access: true
      }))
    });
    setEditDialogOpen(true);
  };

  const handleUpdateRole = async () => {
    if (!selectedRole) return;

    setSaving(true);
    try {
      // TODO: Replace with actual API call
      await new Promise(resolve => setTimeout(resolve, 500));
      
      toast({
        title: 'Success',
        description: `Role "${formData.name}" updated successfully`
      });
      
      setEditDialogOpen(false);
      setSelectedRole(null);
      resetForm();
      loadRoles();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update role',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRole = async () => {
    if (!selectedRole) return;

    setSaving(true);
    try {
      // TODO: Replace with actual API call
      await new Promise(resolve => setTimeout(resolve, 500));
      
      toast({
        title: 'Success',
        description: `Role "${selectedRole.name}" deleted successfully`
      });
      
      setDeleteDialogOpen(false);
      setSelectedRole(null);
      loadRoles();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete role',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCloneRole = (role: Role) => {
    setFormData({
      name: `${role.name} (Copy)`,
      description: role.description,
      is_default: false,
      permissions: role.permissions || RESOURCES.map(r => ({
        resource: r.id,
        actions: { create: false, read: true, update: false, delete: false }
      })),
      field_filters: role.field_filters || [],
      section_access: role.section_access || DEFAULT_SECTIONS.map(s => ({
        section_id: s.id,
        section_name: s.name,
        has_access: true
      }))
    });
    setCreateDialogOpen(true);
  };

  const handlePreviewRole = (role: Role) => {
    setSelectedRole(role);
    setPreviewDialogOpen(true);
  };

  const handleViewUsers = (role: Role) => {
    setSelectedRole(role);
    setUsersDialogOpen(true);
  };

  const addFieldFilter = () => {
    setFormData(prev => ({
      ...prev,
      field_filters: [
        ...prev.field_filters,
        {
          id: `new-${Date.now()}`,
          field_name: '',
          operator: 'equals',
          value: '',
          is_dynamic: false
        }
      ]
    }));
  };

  const updateFieldFilter = (index: number, updates: Partial<FieldFilter>) => {
    setFormData(prev => ({
      ...prev,
      field_filters: prev.field_filters.map((f, i) =>
        i === index ? { ...f, ...updates } : f
      )
    }));
  };

  const removeFieldFilter = (index: number) => {
    setFormData(prev => ({
      ...prev,
      field_filters: prev.field_filters.filter((_, i) => i !== index)
    }));
  };

  const updatePermission = (resource: string, action: keyof Permission['actions'], value: boolean) => {
    setFormData(prev => ({
      ...prev,
      permissions: prev.permissions.map(p =>
        p.resource === resource
          ? { ...p, actions: { ...p.actions, [action]: value } }
          : p
      )
    }));
  };

  const updateSectionAccess = (sectionId: string, hasAccess: boolean) => {
    setFormData(prev => ({
      ...prev,
      section_access: prev.section_access.map(s =>
        s.section_id === sectionId ? { ...s, has_access: hasAccess } : s
      )
    }));
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
            Roles & Permissions
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Manage access control and field-based filtering for your organization
          </p>
        </div>
        <Button
          onClick={() => {
            resetForm();
            setCreateDialogOpen(true);
          }}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          Create Role
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Search roles..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Roles Grid */}
      <div className="grid gap-4">
        {filteredRoles.map(role => (
          <Card
            key={role.id}
            className="hover:shadow-md transition-shadow"
          >
            <CardContent className="p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className={`p-2 rounded-lg ${
                    role.is_system_role 
                      ? 'bg-gradient-to-br from-purple-100 to-violet-100 dark:from-purple-900/30 dark:to-violet-900/30'
                      : 'bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/30 dark:to-indigo-900/30'
                  }`}>
                    <Shield className={`h-5 w-5 ${
                      role.is_system_role 
                        ? 'text-purple-600 dark:text-purple-400'
                        : 'text-blue-600 dark:text-blue-400'
                    }`} />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-slate-900 dark:text-white">
                        {role.name}
                      </h3>
                      {role.is_system_role && (
                        <Badge variant="secondary" className="text-xs">
                          System
                        </Badge>
                      )}
                      {role.is_default && (
                        <Badge variant="outline" className="text-xs">
                          Default
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {role.description}
                    </p>
                    <div className="flex items-center gap-4 text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {role.user_count || 0} users
                      </span>
                      {role.field_filters && role.field_filters.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Filter className="h-3 w-3" />
                          {role.field_filters.length} filter{role.field_filters.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleViewUsers(role)}
                    className="text-slate-600 dark:text-slate-400"
                  >
                    <Users className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handlePreviewRole(role)}
                    className="text-slate-600 dark:text-slate-400"
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCloneRole(role)}
                    className="text-slate-600 dark:text-slate-400"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  {!role.is_system_role && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditRole(role)}
                        className="text-slate-600 dark:text-slate-400"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedRole(role);
                          setDeleteDialogOpen(true);
                        }}
                        className="text-rose-600 dark:text-rose-400 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {filteredRoles.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center">
              <Shield className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
              <p className="text-slate-500 dark:text-slate-400">
                {searchQuery ? 'No roles match your search' : 'No roles found'}
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Create/Edit Role Dialog */}
      <Dialog open={createDialogOpen || editDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setCreateDialogOpen(false);
          setEditDialogOpen(false);
          setSelectedRole(null);
          resetForm();
        }
      }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editDialogOpen ? 'Edit Role' : 'Create New Role'}
            </DialogTitle>
            <DialogDescription>
              Configure role permissions and data filters
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="basic" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="basic">Basic Info</TabsTrigger>
              <TabsTrigger value="permissions">Permissions</TabsTrigger>
              <TabsTrigger value="filters">Data Filters</TabsTrigger>
              <TabsTrigger value="sections">Sections</TabsTrigger>
            </TabsList>

            {/* Basic Info Tab */}
            <TabsContent value="basic" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="name">Role Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Regional Manager"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Brief description of this role"
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="is_default"
                  checked={formData.is_default}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_default: checked }))}
                />
                <Label htmlFor="is_default">Set as default role for new users</Label>
              </div>
            </TabsContent>

            {/* Permissions Tab */}
            <TabsContent value="permissions" className="space-y-4 mt-4">
              <div className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                Define what actions users with this role can perform on each resource.
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Resource</TableHead>
                    <TableHead className="text-center">Create</TableHead>
                    <TableHead className="text-center">Read</TableHead>
                    <TableHead className="text-center">Update</TableHead>
                    <TableHead className="text-center">Delete</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {RESOURCES.map(resource => {
                    const permission = formData.permissions.find(p => p.resource === resource.id);
                    return (
                      <TableRow key={resource.id}>
                        <TableCell className="font-medium">{resource.name}</TableCell>
                        {(['create', 'read', 'update', 'delete'] as const).map(action => (
                          <TableCell key={action} className="text-center">
                            <Checkbox
                              checked={permission?.actions[action] || false}
                              onCheckedChange={(checked) => 
                                updatePermission(resource.id, action, checked as boolean)
                              }
                            />
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TabsContent>

            {/* Data Filters Tab (RLS) */}
            <TabsContent value="filters" className="space-y-4 mt-4">
              <div className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                Define field-based filters to control which data users with this role can access.
                Dynamic values (e.g., {`{{user.email}}`}) are replaced with the user's attributes.
              </div>

              {formData.field_filters.map((filter, index) => (
                <Card key={filter.id} className="p-4">
                  <div className="grid gap-4 sm:grid-cols-4">
                    <div>
                      <Label>Field</Label>
                      <Select
                        value={filter.field_name}
                        onValueChange={(value) => updateFieldFilter(index, { field_name: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select field" />
                        </SelectTrigger>
                        <SelectContent>
                          {FILTER_FIELDS.map(field => (
                            <SelectItem key={field.name} value={field.name}>
                              {field.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Operator</Label>
                      <Select
                        value={filter.operator}
                        onValueChange={(value: any) => updateFieldFilter(index, { operator: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="equals">Equals</SelectItem>
                          <SelectItem value="in">In List</SelectItem>
                          <SelectItem value="starts_with">Starts With</SelectItem>
                          <SelectItem value="contains">Contains</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Value</Label>
                      <Input
                        value={typeof filter.value === 'string' ? filter.value : filter.value.join(', ')}
                        onChange={(e) => updateFieldFilter(index, { value: e.target.value })}
                        placeholder="Value or {{user.attribute}}"
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeFieldFilter(index)}
                        className="text-rose-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2">
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`dynamic-${index}`}
                        checked={filter.is_dynamic}
                        onCheckedChange={(checked) => updateFieldFilter(index, { is_dynamic: checked })}
                      />
                      <Label htmlFor={`dynamic-${index}`} className="text-sm">
                        Dynamic value (use user attributes)
                      </Label>
                    </div>
                  </div>
                </Card>
              ))}

              <Button
                variant="outline"
                onClick={addFieldFilter}
                className="w-full gap-2"
              >
                <Plus className="h-4 w-4" />
                Add Filter
              </Button>

              {formData.field_filters.length === 0 && (
                <p className="text-center text-sm text-slate-500 dark:text-slate-400 py-4">
                  No filters configured. Users with this role will see all data.
                </p>
              )}
            </TabsContent>

            {/* Sections Tab */}
            <TabsContent value="sections" className="space-y-4 mt-4">
              <div className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                Control which dashboard sections users with this role can access.
              </div>

              <div className="space-y-2">
                {formData.section_access.map(section => (
                  <div
                    key={section.section_id}
                    className="flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-700"
                  >
                    <div className="flex items-center gap-3">
                      <Layout className="h-4 w-4 text-slate-400" />
                      <span className="font-medium text-slate-900 dark:text-white">
                        {section.section_name}
                      </span>
                    </div>
                    <Switch
                      checked={section.has_access}
                      onCheckedChange={(checked) => updateSectionAccess(section.section_id, checked)}
                    />
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-6">
            <Button
              variant="outline"
              onClick={() => {
                setCreateDialogOpen(false);
                setEditDialogOpen(false);
                setSelectedRole(null);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={editDialogOpen ? handleUpdateRole : handleCreateRole}
              disabled={saving}
            >
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editDialogOpen ? 'Update Role' : 'Create Role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Role</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the role "{selectedRole?.name}"?
              This action cannot be undone. Users with this role will lose their permissions.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteRole}
              disabled={saving}
            >
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Role Preview: {selectedRole?.name}</DialogTitle>
            <DialogDescription>
              Effective permissions and filters for this role
            </DialogDescription>
          </DialogHeader>

          {selectedRole && (
            <div className="space-y-6">
              {/* Permissions Summary */}
              <div>
                <h4 className="text-sm font-medium mb-2">Permissions</h4>
                <div className="grid grid-cols-2 gap-2">
                  {selectedRole.permissions?.map(p => (
                    <div key={p.resource} className="flex items-center justify-between text-sm p-2 rounded bg-slate-50 dark:bg-slate-800">
                      <span className="font-medium">{p.resource}</span>
                      <div className="flex gap-1">
                        {p.actions.create && <Badge variant="secondary" className="text-xs">C</Badge>}
                        {p.actions.read && <Badge variant="secondary" className="text-xs">R</Badge>}
                        {p.actions.update && <Badge variant="secondary" className="text-xs">U</Badge>}
                        {p.actions.delete && <Badge variant="secondary" className="text-xs">D</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Field Filters Summary */}
              <div>
                <h4 className="text-sm font-medium mb-2">Data Filters (RLS)</h4>
                {selectedRole.field_filters && selectedRole.field_filters.length > 0 ? (
                  <div className="space-y-2">
                    {selectedRole.field_filters.map(filter => (
                      <div key={filter.id} className="flex items-center gap-2 text-sm p-2 rounded bg-slate-50 dark:bg-slate-800">
                        <Filter className="h-4 w-4 text-slate-400" />
                        <span>
                          <strong>{filter.field_name}</strong> {filter.operator} {
                            filter.is_dynamic ? (
                              <Badge variant="outline" className="text-xs">{filter.value}</Badge>
                            ) : (
                              <span className="text-slate-600 dark:text-slate-400">{filter.value}</span>
                            )
                          }
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No filters - full data access</p>
                )}
              </div>

              {/* Section Access Summary */}
              <div>
                <h4 className="text-sm font-medium mb-2">Section Access</h4>
                <div className="flex flex-wrap gap-2">
                  {selectedRole.section_access?.map(section => (
                    <Badge
                      key={section.section_id}
                      variant={section.has_access ? 'default' : 'secondary'}
                      className={section.has_access ? '' : 'opacity-50'}
                    >
                      {section.has_access ? <Unlock className="h-3 w-3 mr-1" /> : <Lock className="h-3 w-3 mr-1" />}
                      {section.section_name}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setPreviewDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Users Dialog */}
      <Dialog open={usersDialogOpen} onOpenChange={setUsersDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Users with Role: {selectedRole?.name}</DialogTitle>
            <DialogDescription>
              {selectedRole?.user_count || 0} user{selectedRole?.user_count !== 1 ? 's' : ''} assigned to this role
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            {/* This would be populated with actual user data from API */}
            <p className="text-center text-sm text-slate-500 dark:text-slate-400">
              User list will be loaded from the API
            </p>
          </div>

          <DialogFooter>
            <Button onClick={() => setUsersDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

export default RolesPermissionsSection;
