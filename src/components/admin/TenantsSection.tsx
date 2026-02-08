import { useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Search, Eye, Edit, Plus, Trash2, Copy, Loader2 } from 'lucide-react';
import type { Tenant } from '@/hooks/admin/useTenants';

interface TenantsSectionProps {
  tenants: Tenant[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onCreateTenant: (data: Partial<Tenant>) => Promise<void>;
  onUpdateTenant: (id: string, data: Partial<Tenant>) => Promise<void>;
  onDeleteTenant: (id: string) => Promise<void>;
  onDuplicateTenant?: (id: string, name: string, slug: string) => Promise<any>;
  duplicating?: boolean;
  onRefresh: () => Promise<void>;
}

export const TenantsSection = ({
  tenants,
  searchQuery,
  onSearchChange,
  onCreateTenant,
  onUpdateTenant,
  onDeleteTenant,
  onDuplicateTenant,
  duplicating = false,
  onRefresh,
}: TenantsSectionProps) => {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDuplicateDialogOpen, setIsDuplicateDialogOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [formData, setFormData] = useState({ name: '' });
  const [duplicateFormData, setDuplicateFormData] = useState({ name: '', slug: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredTenants = tenants.filter(tenant =>
    tenant.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreateClick = () => {
    setFormData({ name: '' });
    setIsCreateDialogOpen(true);
  };

  const handleEditClick = (tenant: Tenant) => {
    setSelectedTenant(tenant);
    setFormData({ name: tenant.name });
    setIsEditDialogOpen(true);
  };

  const handleDeleteClick = (tenant: Tenant) => {
    setSelectedTenant(tenant);
    setIsDeleteDialogOpen(true);
  };

  const handleDuplicateClick = (tenant: Tenant) => {
    setSelectedTenant(tenant);
    const defaultName = `${tenant.name} (Anonymized)`;
    const defaultSlug = defaultName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    setDuplicateFormData({ name: defaultName, slug: defaultSlug });
    setIsDuplicateDialogOpen(true);
  };

  const handleDuplicateNameChange = (name: string) => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    setDuplicateFormData({ name, slug });
  };

  const handleDuplicate = async () => {
    if (!selectedTenant || !duplicateFormData.name.trim() || !duplicateFormData.slug.trim()) return;
    if (!onDuplicateTenant) return;

    try {
      setIsSubmitting(true);
      await onDuplicateTenant(selectedTenant.id, duplicateFormData.name, duplicateFormData.slug);
      await onRefresh();
      setIsDuplicateDialogOpen(false);
      setSelectedTenant(null);
      setDuplicateFormData({ name: '', slug: '' });
    } catch (error) {
      console.error('Error duplicating tenant:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreate = async () => {
    if (!formData.name.trim()) return;
    
    try {
      setIsSubmitting(true);
      await onCreateTenant({ name: formData.name });
      await onRefresh(); // Explicitly refresh the list
      setIsCreateDialogOpen(false);
      setFormData({ name: '' });
    } catch (error) {
      console.error('Error creating tenant:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async () => {
    if (!selectedTenant || !formData.name.trim()) return;
    
    try {
      setIsSubmitting(true);
      await onUpdateTenant(selectedTenant.id, { name: formData.name });
      await onRefresh(); // Explicitly refresh the list
      setIsEditDialogOpen(false);
      setSelectedTenant(null);
      setFormData({ name: '' });
    } catch (error) {
      console.error('Error updating tenant:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedTenant) return;
    
    try {
      setIsSubmitting(true);
      await onDeleteTenant(selectedTenant.id);
      await onRefresh(); // Explicitly refresh the list
      setIsDeleteDialogOpen(false);
      setSelectedTenant(null);
    } catch (error) {
      console.error('Error deleting tenant:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <CardTitle className="text-xl font-thin text-slate-900 dark:text-white tracking-tight">
                Tenants
              </CardTitle>
              <CardDescription className="text-base text-slate-600 dark:text-slate-400 font-extralight">
                All registered tenant accounts
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search tenants..."
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  className="pl-9 w-64 text-base font-extralight"
                />
              </div>
              <Button
                onClick={handleCreateClick}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Tenant
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-200 dark:border-slate-700">
                  <TableHead className="text-base font-extralight text-slate-600 dark:text-slate-400">Name</TableHead>
                  <TableHead className="text-base font-extralight text-slate-600 dark:text-slate-400">Created</TableHead>
                  <TableHead className="text-base font-extralight text-slate-600 dark:text-slate-400">Status</TableHead>
                  <TableHead className="text-base font-extralight text-slate-600 dark:text-slate-400">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTenants.map((tenant) => (
                  <TableRow key={tenant.id} className="border-slate-100 dark:border-slate-700">
                    <TableCell className="font-extralight text-slate-900 dark:text-white">
                      {tenant.name}
                    </TableCell>
                    <TableCell className="text-base font-extralight text-slate-600 dark:text-slate-400">
                      {new Date(tenant.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="default" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0">
                        Active
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-8 w-8 p-0"
                          onClick={() => handleEditClick(tenant)}
                          title="Edit tenant"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        {onDuplicateTenant && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-8 w-8 p-0 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950"
                            onClick={() => handleDuplicateClick(tenant)}
                            title="Duplicate & Anonymize"
                            disabled={duplicating}
                          >
                            {duplicating && selectedTenant?.id === tenant.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                          onClick={() => handleDeleteClick(tenant)}
                          title="Delete tenant"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredTenants.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-base text-slate-500 dark:text-slate-400 font-extralight py-8">
                      {searchQuery ? 'No tenants found matching your search' : 'No tenants found'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Create Tenant Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Create New Tenant</DialogTitle>
            <DialogDescription>
              Add a new tenant to the system. Click create when you're done.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="tenant-name">Tenant Name</Label>
              <Input
                id="tenant-name"
                value={formData.name}
                onChange={(e) => setFormData({ name: e.target.value })}
                placeholder="Enter tenant name"
                className="text-base font-extralight"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={isSubmitting || !formData.name.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isSubmitting ? 'Creating...' : 'Create Tenant'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Tenant Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Tenant</DialogTitle>
            <DialogDescription>
              Update the tenant information. Click save when you're done.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-tenant-name">Tenant Name</Label>
              <Input
                id="edit-tenant-name"
                value={formData.name}
                onChange={(e) => setFormData({ name: e.target.value })}
                placeholder="Enter tenant name"
                className="text-base font-extralight"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsEditDialogOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={isSubmitting || !formData.name.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Tenant Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the tenant "{selectedTenant?.name}". 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isSubmitting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isSubmitting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Duplicate & Anonymize Dialog */}
      <Dialog open={isDuplicateDialogOpen} onOpenChange={setIsDuplicateDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Duplicate & Anonymize Tenant</DialogTitle>
            <DialogDescription>
              Create a copy of "{selectedTenant?.name}" with all configuration and loan data.
              Personnel names, branch numbers, and other identifying information will be replaced
              with anonymized pseudonyms.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="duplicate-tenant-name">New Tenant Name</Label>
              <Input
                id="duplicate-tenant-name"
                value={duplicateFormData.name}
                onChange={(e) => handleDuplicateNameChange(e.target.value)}
                placeholder="e.g. Acme Lending (Demo)"
                className="text-base font-extralight"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="duplicate-tenant-slug">Slug</Label>
              <Input
                id="duplicate-tenant-slug"
                value={duplicateFormData.slug}
                onChange={(e) => setDuplicateFormData(prev => ({ ...prev, slug: e.target.value }))}
                placeholder="e.g. acme-lending-demo"
                className="text-base font-extralight font-mono"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Lowercase letters, numbers, and hyphens only. Used for the database name.
              </p>
            </div>
            <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                This operation copies all loans, employees, and configuration from the source tenant.
                Personnel names, employee IDs, branches, and org IDs will be anonymized. 
                This may take a few minutes for large datasets.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDuplicateDialogOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDuplicate}
              disabled={isSubmitting || !duplicateFormData.name.trim() || !duplicateFormData.slug.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Duplicating...
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-2" />
                  Duplicate & Anonymize
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
};

