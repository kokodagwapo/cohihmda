/**
 * Filter Builder Tab
 * Create and manage saved filters for data views
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
  Filter,
  Lock,
  Unlock,
  User,
  Users,
  Globe,
  Loader2
} from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useAdminTenant } from '@/contexts/AdminTenantContext';

interface FilterBuilderTabProps {
  filters: any[];
  onRefresh: () => void;
}

const SCOPE_OPTIONS = [
  { value: 'personal', label: 'Personal', icon: User, description: 'Only you can see this filter' },
  { value: 'team', label: 'Team', icon: Users, description: 'Visible to your team' },
  { value: 'organization', label: 'Organization', icon: Globe, description: 'Visible to everyone' },
];

const OPERATORS = [
  { value: 'eq', label: 'equals' },
  { value: 'ne', label: 'not equals' },
  { value: 'gt', label: 'greater than' },
  { value: 'gte', label: 'greater than or equal' },
  { value: 'lt', label: 'less than' },
  { value: 'lte', label: 'less than or equal' },
  { value: 'contains', label: 'contains' },
  { value: 'in', label: 'in list' },
];

const FILTER_FIELDS = [
  { value: 'loan_type', label: 'Loan Type', type: 'string' },
  { value: 'loan_purpose', label: 'Loan Purpose', type: 'string' },
  { value: 'current_loan_status', label: 'Loan Status', type: 'string' },
  { value: 'current_milestone', label: 'Milestone', type: 'string' },
  { value: 'loan_amount', label: 'Loan Amount', type: 'number' },
  { value: 'ltv_ratio', label: 'LTV Ratio', type: 'number' },
  { value: 'be_dti_ratio', label: 'DTI Ratio', type: 'number' },
  { value: 'fico_score', label: 'FICO Score', type: 'number' },
  { value: 'loan_officer', label: 'Loan Officer', type: 'string' },
  { value: 'processor', label: 'Processor', type: 'string' },
  { value: 'branch', label: 'Branch', type: 'string' },
  { value: 'channel', label: 'Channel', type: 'string' },
  { value: 'property_state', label: 'Property State', type: 'string' },
];

interface FilterCondition {
  field: string;
  operator: string;
  value: string;
}

export function FilterBuilderTab({ filters, onRefresh }: FilterBuilderTabProps) {
  const { toast } = useToast();
  const { isTenantAdmin } = useAdminTenant();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingFilter, setEditingFilter] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    scope: 'personal',
    conditions: [] as FilterCondition[],
  });

  const filteredFilters = filters.filter((filter) => {
    const matchesSearch = 
      filter.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      filter.description?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  const handleOpenDialog = (filter?: any) => {
    if (filter) {
      setEditingFilter(filter);
      // Parse filter_expression into conditions
      const conditions: FilterCondition[] = [];
      const expr = filter.filter_expression || {};
      if (expr.and) {
        for (const cond of expr.and) {
          conditions.push({
            field: cond.field || '',
            operator: cond.op || 'eq',
            value: cond.value?.toString() || '',
          });
        }
      }
      setFormData({
        name: filter.name || '',
        description: filter.description || '',
        scope: filter.scope || 'personal',
        conditions: conditions.length > 0 ? conditions : [{ field: '', operator: 'eq', value: '' }],
      });
    } else {
      setEditingFilter(null);
      setFormData({
        name: '',
        description: '',
        scope: 'personal',
        conditions: [{ field: '', operator: 'eq', value: '' }],
      });
    }
    setIsDialogOpen(true);
  };

  const handleAddCondition = () => {
    setFormData({
      ...formData,
      conditions: [...formData.conditions, { field: '', operator: 'eq', value: '' }],
    });
  };

  const handleRemoveCondition = (index: number) => {
    const newConditions = formData.conditions.filter((_, i) => i !== index);
    setFormData({ ...formData, conditions: newConditions.length > 0 ? newConditions : [{ field: '', operator: 'eq', value: '' }] });
  };

  const handleConditionChange = (index: number, key: keyof FilterCondition, value: string) => {
    const newConditions = [...formData.conditions];
    newConditions[index] = { ...newConditions[index], [key]: value };
    setFormData({ ...formData, conditions: newConditions });
  };

  const handleSave = async () => {
    if (!formData.name) {
      toast({
        title: 'Validation Error',
        description: 'Filter name is required',
        variant: 'destructive',
      });
      return;
    }

    // Build filter expression
    const validConditions = formData.conditions.filter(c => c.field && c.value);
    if (validConditions.length === 0) {
      toast({
        title: 'Validation Error',
        description: 'At least one filter condition is required',
        variant: 'destructive',
      });
      return;
    }

    const filterExpression = {
      and: validConditions.map(c => ({
        field: c.field,
        op: c.operator,
        value: c.value,
      })),
    };

    setSaving(true);
    try {
      const payload = {
        name: formData.name,
        description: formData.description,
        scope: formData.scope,
        filter_expression: filterExpression,
      };

      if (editingFilter) {
        await api.request(`/api/tenant-config/filters/${editingFilter.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        toast({ title: 'Success', description: 'Filter updated successfully' });
      } else {
        await api.request('/api/tenant-config/filters', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast({ title: 'Success', description: 'Filter created successfully' });
      }
      setIsDialogOpen(false);
      onRefresh();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save filter',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (filterId: string) => {
    if (!confirm('Are you sure you want to delete this filter?')) return;

    try {
      await api.request(`/api/tenant-config/filters/${filterId}`, {
        method: 'DELETE',
      });
      toast({ title: 'Success', description: 'Filter deleted successfully' });
      onRefresh();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete filter',
        variant: 'destructive',
      });
    }
  };

  const getScopeBadge = (scope: string) => {
    const option = SCOPE_OPTIONS.find(o => o.value === scope);
    if (!option) return null;
    const Icon = option.icon;
    return (
      <Badge variant="outline" className="font-light">
        <Icon className="h-3 w-3 mr-1" />
        {option.label}
      </Badge>
    );
  };

  const getConditionCount = (filter: any) => {
    const expr = filter.filter_expression || {};
    return expr.and?.length || 0;
  };

  return (
    <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-thin text-slate-900 dark:text-white flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Saved Filters
            </CardTitle>
            <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
              Create reusable filters for dashboards and reports
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => handleOpenDialog()} className="font-light">
            <Plus className="h-4 w-4 mr-2" />
            Add Filter
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search filters..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 font-light"
          />
        </div>

        {/* Filters Table */}
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 dark:bg-slate-800/50">
                <TableHead className="font-medium">Name</TableHead>
                <TableHead className="font-medium">Description</TableHead>
                <TableHead className="font-medium">Scope</TableHead>
                <TableHead className="font-medium">Conditions</TableHead>
                <TableHead className="font-medium text-center">Locked</TableHead>
                <TableHead className="font-medium text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredFilters.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                    {searchQuery ? 'No filters match your search' : 'No saved filters yet'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredFilters.map((filter) => (
                  <TableRow key={filter.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                    <TableCell className="font-medium">{filter.name}</TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400 max-w-xs truncate">
                      {filter.description || '-'}
                    </TableCell>
                    <TableCell>{getScopeBadge(filter.scope)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-light">
                        {getConditionCount(filter)} condition(s)
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {filter.is_locked ? (
                        <Lock className="h-4 w-4 mx-auto text-slate-400" />
                      ) : (
                        <Unlock className="h-4 w-4 mx-auto text-slate-300" />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenDialog(filter)}
                          className="h-8 w-8 p-0"
                          disabled={filter.is_locked && !isTenantAdmin}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(filter.id)}
                          className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
                          disabled={filter.is_locked && !isTenantAdmin}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      {/* Add/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-thin">
              {editingFilter ? 'Edit Filter' : 'Create Filter'}
            </DialogTitle>
            <DialogDescription className="font-light">
              Build a reusable filter for your data views
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Filter Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., High LTV FHA Loans"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="scope">Visibility Scope</Label>
                <Select 
                  value={formData.scope} 
                  onValueChange={(v) => setFormData({ ...formData, scope: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCOPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <div className="flex items-center gap-2">
                          <opt.icon className="h-4 w-4" />
                          {opt.label}
                        </div>
                      </SelectItem>
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
                placeholder="Describe what this filter does"
                rows={2}
              />
            </div>

            {/* Filter Conditions */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Filter Conditions</Label>
                <Button type="button" variant="outline" size="sm" onClick={handleAddCondition}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Condition
                </Button>
              </div>

              {formData.conditions.map((condition, index) => (
                <div key={index} className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-800/30 rounded-lg">
                  <Select 
                    value={condition.field} 
                    onValueChange={(v) => handleConditionChange(index, 'field', v)}
                  >
                    <SelectTrigger className="w-[160px]">
                      <SelectValue placeholder="Field" />
                    </SelectTrigger>
                    <SelectContent>
                      {FILTER_FIELDS.map((field) => (
                        <SelectItem key={field.value} value={field.value}>
                          {field.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select 
                    value={condition.operator} 
                    onValueChange={(v) => handleConditionChange(index, 'operator', v)}
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPERATORS.map((op) => (
                        <SelectItem key={op.value} value={op.value}>
                          {op.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Input
                    value={condition.value}
                    onChange={(e) => handleConditionChange(index, 'value', e.target.value)}
                    placeholder="Value"
                    className="flex-1"
                  />

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveCondition(index)}
                    className="h-8 w-8 p-0 text-slate-400 hover:text-red-600"
                    disabled={formData.conditions.length === 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}

              <p className="text-xs text-slate-500">
                All conditions are combined with AND logic
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} className="font-light">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} className="font-light">
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingFilter ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
