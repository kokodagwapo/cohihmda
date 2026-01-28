/**
 * Range Rules Tab
 * Manage guideline thresholds for field highlighting
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
  Ruler,
  AlertTriangle,
  AlertCircle,
  Info,
  Loader2
} from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useAdminTenant } from '@/contexts/AdminTenantContext';

interface RangeRulesTabProps {
  rules: any[];
  onRefresh: () => void;
}

const FIELD_ALIASES = [
  { value: 'ltv_ratio', label: 'LTV Ratio' },
  { value: 'cltv', label: 'CLTV' },
  { value: 'be_dti_ratio', label: 'DTI Ratio' },
  { value: 'fico_score', label: 'FICO Score' },
  { value: 'loan_amount', label: 'Loan Amount' },
  { value: 'interest_rate', label: 'Interest Rate' },
  { value: 'loan_term', label: 'Loan Term' },
  { value: 'appraised_value', label: 'Appraised Value' },
  { value: 'sales_price', label: 'Sales Price' },
];

const SEVERITY_OPTIONS = [
  { value: 'info', label: 'Info', icon: Info, color: 'text-blue-600' },
  { value: 'warning', label: 'Warning', icon: AlertTriangle, color: 'text-amber-600' },
  { value: 'critical', label: 'Critical', icon: AlertCircle, color: 'text-red-600' },
];

export function RangeRulesTab({ rules, onRefresh }: RangeRulesTabProps) {
  const { toast } = useToast();
  const { isTenantAdmin } = useAdminTenant();
  const [searchQuery, setSearchQuery] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    field_alias: '',
    rule_name: '',
    description: '',
    min_value: '',
    max_value: '',
    warning_min: '',
    warning_max: '',
    severity: 'warning',
    tooltip_text: '',
    violation_message: '',
    conditions: {} as Record<string, string>,
  });

  const filteredRules = rules.filter((rule) => {
    const matchesSearch = 
      rule.rule_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.field_alias?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  const handleOpenDialog = (rule?: any) => {
    if (rule) {
      setEditingRule(rule);
      setFormData({
        field_alias: rule.field_alias || '',
        rule_name: rule.rule_name || '',
        description: rule.description || '',
        min_value: rule.min_value?.toString() || '',
        max_value: rule.max_value?.toString() || '',
        warning_min: rule.warning_min?.toString() || '',
        warning_max: rule.warning_max?.toString() || '',
        severity: rule.severity || 'warning',
        tooltip_text: rule.tooltip_text || '',
        violation_message: rule.violation_message || '',
        conditions: rule.conditions || {},
      });
    } else {
      setEditingRule(null);
      setFormData({
        field_alias: '',
        rule_name: '',
        description: '',
        min_value: '',
        max_value: '',
        warning_min: '',
        warning_max: '',
        severity: 'warning',
        tooltip_text: '',
        violation_message: '',
        conditions: {},
      });
    }
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.field_alias || !formData.rule_name) {
      toast({
        title: 'Validation Error',
        description: 'Field and Rule Name are required',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...formData,
        min_value: formData.min_value ? parseFloat(formData.min_value) : null,
        max_value: formData.max_value ? parseFloat(formData.max_value) : null,
        warning_min: formData.warning_min ? parseFloat(formData.warning_min) : null,
        warning_max: formData.warning_max ? parseFloat(formData.warning_max) : null,
      };

      if (editingRule) {
        await api.request(`/api/tenant-config/range-rules/${editingRule.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        toast({ title: 'Success', description: 'Rule updated successfully' });
      } else {
        await api.request('/api/tenant-config/range-rules', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast({ title: 'Success', description: 'Rule created successfully' });
      }
      setIsDialogOpen(false);
      onRefresh();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save rule',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (ruleId: string) => {
    if (!confirm('Are you sure you want to delete this rule?')) return;

    try {
      await api.request(`/api/tenant-config/range-rules/${ruleId}`, {
        method: 'DELETE',
      });
      toast({ title: 'Success', description: 'Rule deleted successfully' });
      onRefresh();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete rule',
        variant: 'destructive',
      });
    }
  };

  const handleToggleActive = async (rule: any) => {
    try {
      await api.request(`/api/tenant-config/range-rules/${rule.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: !rule.is_active }),
      });
      onRefresh();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update rule',
        variant: 'destructive',
      });
    }
  };

  const getSeverityBadge = (severity: string) => {
    const option = SEVERITY_OPTIONS.find(o => o.value === severity);
    if (!option) return null;
    const Icon = option.icon;
    return (
      <Badge variant="outline" className={`${option.color} border-current`}>
        <Icon className="h-3 w-3 mr-1" />
        {option.label}
      </Badge>
    );
  };

  const formatRange = (min: number | null, max: number | null) => {
    if (min !== null && max !== null) return `${min} - ${max}`;
    if (min !== null) return `≥ ${min}`;
    if (max !== null) return `≤ ${max}`;
    return '-';
  };

  return (
    <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-thin text-slate-900 dark:text-white flex items-center gap-2">
              <Ruler className="h-5 w-5" />
              Range Rules
            </CardTitle>
            <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
              Define thresholds for guideline highlighting and alerts
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => handleOpenDialog()} className="font-light">
            <Plus className="h-4 w-4 mr-2" />
            Add Rule
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search rules..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 font-light"
          />
        </div>

        {/* Rules Table */}
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 dark:bg-slate-800/50">
                <TableHead className="font-medium">Rule Name</TableHead>
                <TableHead className="font-medium">Field</TableHead>
                <TableHead className="font-medium">Range</TableHead>
                <TableHead className="font-medium">Warning Zone</TableHead>
                <TableHead className="font-medium">Severity</TableHead>
                <TableHead className="font-medium">Conditions</TableHead>
                <TableHead className="font-medium text-center">Active</TableHead>
                <TableHead className="font-medium text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-slate-500">
                    {searchQuery ? 'No rules match your search' : 'No range rules configured yet'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredRules.map((rule) => (
                  <TableRow key={rule.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                    <TableCell className="font-medium">{rule.rule_name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-mono text-xs">
                        {FIELD_ALIASES.find(f => f.value === rule.field_alias)?.label || rule.field_alias}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {formatRange(rule.min_value, rule.max_value)}
                    </TableCell>
                    <TableCell className="font-mono text-sm text-amber-600">
                      {formatRange(rule.warning_min, rule.warning_max)}
                    </TableCell>
                    <TableCell>{getSeverityBadge(rule.severity)}</TableCell>
                    <TableCell>
                      {Object.keys(rule.conditions || {}).length > 0 ? (
                        <Badge variant="outline" className="text-xs">
                          {Object.keys(rule.conditions).length} condition(s)
                        </Badge>
                      ) : (
                        <span className="text-slate-400">All loans</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={rule.is_active}
                        onCheckedChange={() => handleToggleActive(rule)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenDialog(rule)}
                          className="h-8 w-8 p-0"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(rule.id)}
                          className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-thin">
              {editingRule ? 'Edit Range Rule' : 'Add Range Rule'}
            </DialogTitle>
            <DialogDescription className="font-light">
              Define thresholds for guideline highlighting
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="grid gap-2">
              <Label htmlFor="field_alias">Field *</Label>
              <Select 
                value={formData.field_alias} 
                onValueChange={(v) => setFormData({ ...formData, field_alias: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select field" />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_ALIASES.map((field) => (
                    <SelectItem key={field.value} value={field.value}>
                      {field.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="rule_name">Rule Name *</Label>
              <Input
                id="rule_name"
                value={formData.rule_name}
                onChange={(e) => setFormData({ ...formData, rule_name: e.target.value })}
                placeholder="e.g., FHA LTV Limits"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="min_value">Min Value</Label>
                <Input
                  id="min_value"
                  type="number"
                  value={formData.min_value}
                  onChange={(e) => setFormData({ ...formData, min_value: e.target.value })}
                  placeholder="Leave empty for no min"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="max_value">Max Value</Label>
                <Input
                  id="max_value"
                  type="number"
                  value={formData.max_value}
                  onChange={(e) => setFormData({ ...formData, max_value: e.target.value })}
                  placeholder="Leave empty for no max"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="warning_min">Warning Min (Yellow)</Label>
                <Input
                  id="warning_min"
                  type="number"
                  value={formData.warning_min}
                  onChange={(e) => setFormData({ ...formData, warning_min: e.target.value })}
                  placeholder="Optional"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="warning_max">Warning Max (Yellow)</Label>
                <Input
                  id="warning_max"
                  type="number"
                  value={formData.warning_max}
                  onChange={(e) => setFormData({ ...formData, warning_max: e.target.value })}
                  placeholder="Optional"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="severity">Severity</Label>
              <Select 
                value={formData.severity} 
                onValueChange={(v) => setFormData({ ...formData, severity: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex items-center gap-2">
                        <opt.icon className={`h-4 w-4 ${opt.color}`} />
                        {opt.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="tooltip_text">Tooltip Text</Label>
              <Textarea
                id="tooltip_text"
                value={formData.tooltip_text}
                onChange={(e) => setFormData({ ...formData, tooltip_text: e.target.value })}
                placeholder="Help text shown on hover"
                rows={2}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Internal description for this rule"
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
              {editingRule ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
