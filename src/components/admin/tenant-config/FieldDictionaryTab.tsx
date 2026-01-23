/**
 * Field Dictionary Tab
 * Manage custom LOS fields and field mappings
 */

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
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
import { Textarea } from '@/components/ui/textarea';
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  Database,
  Eye,
  EyeOff,
  Loader2
} from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useAdminTenant } from '@/contexts/AdminTenantContext';

interface FieldDictionaryTabProps {
  fields: any[];
  onRefresh: () => void;
}

const DATA_TYPES = [
  { value: 'string', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'boolean', label: 'Yes/No' },
  { value: 'currency', label: 'Currency' },
  { value: 'percentage', label: 'Percentage' },
];

const CATEGORIES = [
  'Borrower',
  'Property',
  'Loan Terms',
  'Financial',
  'Dates',
  'Status',
  'Personnel',
  'Organization',
  'Custom',
];

export function FieldDictionaryTab({ fields, onRefresh }: FieldDictionaryTabProps) {
  const { toast } = useToast();
  const { isTenantAdmin } = useAdminTenant();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    los_field_id: '',
    los_field_name: '',
    display_name: '',
    data_type: 'string',
    category: '',
    description: '',
    is_enabled: true,
  });

  const filteredFields = fields.filter((field) => {
    const matchesSearch = 
      field.display_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      field.los_field_id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      field.coheus_alias?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || field.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handleOpenDialog = (field?: any) => {
    if (field) {
      setEditingField(field);
      setFormData({
        los_field_id: field.los_field_id || '',
        los_field_name: field.los_field_name || '',
        display_name: field.display_name || '',
        data_type: field.data_type || 'string',
        category: field.category || '',
        description: field.description || '',
        is_enabled: field.is_enabled ?? true,
      });
    } else {
      setEditingField(null);
      setFormData({
        los_field_id: '',
        los_field_name: '',
        display_name: '',
        data_type: 'string',
        category: '',
        description: '',
        is_enabled: true,
      });
    }
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.los_field_id || !formData.display_name) {
      toast({
        title: 'Validation Error',
        description: 'LOS Field ID and Display Name are required',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      if (editingField) {
        await api.request(`/api/tenant-config/fields/${editingField.id}`, {
          method: 'PUT',
          body: JSON.stringify(formData),
        });
        toast({ title: 'Success', description: 'Field updated successfully' });
      } else {
        await api.request('/api/tenant-config/fields', {
          method: 'POST',
          body: JSON.stringify(formData),
        });
        toast({ title: 'Success', description: 'Field created successfully' });
      }
      setIsDialogOpen(false);
      onRefresh();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save field',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (fieldId: string) => {
    if (!confirm('Are you sure you want to delete this field?')) return;

    try {
      await api.request(`/api/tenant-config/fields/${fieldId}`, {
        method: 'DELETE',
      });
      toast({ title: 'Success', description: 'Field deleted successfully' });
      onRefresh();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete field',
        variant: 'destructive',
      });
    }
  };

  const handleToggleEnabled = async (field: any) => {
    try {
      await api.request(`/api/tenant-config/fields/${field.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_enabled: !field.is_enabled }),
      });
      onRefresh();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update field',
        variant: 'destructive',
      });
    }
  };

  const categories = ['all', ...new Set(fields.map(f => f.category).filter(Boolean))];

  return (
    <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-thin text-slate-900 dark:text-white flex items-center gap-2">
              <Database className="h-5 w-5" />
              Field Dictionary
            </CardTitle>
            <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
              Manage custom LOS fields and configure field visibility
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => handleOpenDialog()} className="font-light">
            <Plus className="h-4 w-4 mr-2" />
            Add Field
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="flex gap-4 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search fields..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 font-light"
            />
          </div>
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="w-[180px] font-light">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Fields Table */}
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 dark:bg-slate-800/50">
                <TableHead className="font-medium">Display Name</TableHead>
                <TableHead className="font-medium">LOS Field ID</TableHead>
                <TableHead className="font-medium">Coheus Alias</TableHead>
                <TableHead className="font-medium">Type</TableHead>
                <TableHead className="font-medium">Category</TableHead>
                <TableHead className="font-medium text-center">Enabled</TableHead>
                <TableHead className="font-medium text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredFields.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-slate-500">
                    {searchQuery || selectedCategory !== 'all' 
                      ? 'No fields match your search' 
                      : 'No custom fields configured yet'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredFields.map((field) => (
                  <TableRow key={field.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                    <TableCell className="font-medium">{field.display_name}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-400">
                      {field.los_field_id}
                    </TableCell>
                    <TableCell>
                      {field.coheus_alias ? (
                        <Badge variant="outline" className="font-mono text-xs">
                          {field.coheus_alias}
                        </Badge>
                      ) : (
                        <span className="text-slate-400">Custom</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-light">
                        {DATA_TYPES.find(t => t.value === field.data_type)?.label || field.data_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">
                      {field.category || '-'}
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={field.is_enabled}
                        onCheckedChange={() => handleToggleEnabled(field)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenDialog(field)}
                          className="h-8 w-8 p-0"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        {field.is_custom && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(field.id)}
                            className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="mt-4 text-sm text-slate-500">
          Showing {filteredFields.length} of {fields.length} fields
        </div>
      </CardContent>

      {/* Add/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-thin">
              {editingField ? 'Edit Field' : 'Add Custom Field'}
            </DialogTitle>
            <DialogDescription className="font-light">
              {editingField 
                ? 'Update the field configuration' 
                : 'Add a new custom LOS field to the dictionary'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="los_field_id">LOS Field ID *</Label>
              <Input
                id="los_field_id"
                value={formData.los_field_id}
                onChange={(e) => setFormData({ ...formData, los_field_id: e.target.value })}
                placeholder="e.g., Fields.CX.CUSTOMFIELD1"
                disabled={!!editingField}
                className="font-mono"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="display_name">Display Name *</Label>
              <Input
                id="display_name"
                value={formData.display_name}
                onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                placeholder="e.g., Custom Loan Priority"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="data_type">Data Type</Label>
                <Select 
                  value={formData.data_type} 
                  onValueChange={(v) => setFormData({ ...formData, data_type: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DATA_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="category">Category</Label>
                <Select 
                  value={formData.category || 'none'} 
                  onValueChange={(v) => setFormData({ ...formData, category: v === 'none' ? '' : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Category</SelectItem>
                    {CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Optional description for this field"
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} className="font-light">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} className="font-light">
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingField ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
