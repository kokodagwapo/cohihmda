import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

interface CreatePlanDialogProps {
  onPlanCreated: () => void;
}

export const CreatePlanDialog = ({ onPlanCreated }: CreatePlanDialogProps) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  
  const [formData, setFormData] = useState({
    name: '',
    display_name: '',
    price_monthly: '',
    price_yearly: '',
    features: '{}',
    deployment_options: 'cloud',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Parse features JSON
      let features = {};
      try {
        features = JSON.parse(formData.features);
      } catch {
        throw new Error('Invalid JSON in features field');
      }

      // Parse deployment options
      const deployment_options = formData.deployment_options.split(',').map(s => s.trim());

      await api.request('/api/subscriptions/plans', {
        method: 'POST',
        body: JSON.stringify({
          name: formData.name,
          display_name: formData.display_name,
          price_monthly: parseFloat(formData.price_monthly),
          price_yearly: parseFloat(formData.price_yearly),
          features,
          deployment_options,
        }),
      });

      toast({
        title: 'Success',
        description: 'Custom plan created successfully',
      });

      setOpen(false);
      setFormData({
        name: '',
        display_name: '',
        price_monthly: '',
        price_yearly: '',
        features: '{}',
        deployment_options: 'cloud',
      });
      onPlanCreated();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create plan',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="font-extralight">
          <Plus className="h-4 w-4 mr-2" />
          Add Custom Plan
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pb-4">
          <DialogTitle>Create Custom Subscription Plan</DialogTitle>
          <DialogDescription>
            Add a new subscription plan with custom pricing and features
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 px-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Plan Name (Internal)</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., custom_enterprise"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="display_name">Display Name</Label>
                <Input
                  id="display_name"
                  value={formData.display_name}
                  onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                  placeholder="e.g., Custom Enterprise"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="price_monthly">Monthly Price ($)</Label>
                <Input
                  id="price_monthly"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.price_monthly}
                  onChange={(e) => setFormData({ ...formData, price_monthly: e.target.value })}
                  placeholder="99.00"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="price_yearly">Yearly Price ($)</Label>
                <Input
                  id="price_yearly"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.price_yearly}
                  onChange={(e) => setFormData({ ...formData, price_yearly: e.target.value })}
                  placeholder="990.00"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="deployment_options">Deployment Options (comma-separated)</Label>
              <Input
                id="deployment_options"
                value={formData.deployment_options}
                onChange={(e) => setFormData({ ...formData, deployment_options: e.target.value })}
                placeholder="cloud, on_premise, hybrid"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="features">Features (JSON)</Label>
              <Textarea
                id="features"
                value={formData.features}
                onChange={(e) => setFormData({ ...formData, features: e.target.value })}
                placeholder='{"max_users": 100, "max_loans": 10000, "support": "24/7"}'
                rows={6}
                className="font-mono text-xs"
              />
              <p className="text-xs text-slate-500">
                Example: {`{"max_users": 100, "max_loans": 10000, "support": "24/7", "custom_branding": true}`}
              </p>
            </div>
          </div>
          <DialogFooter className="pt-6 mt-2 border-t">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Plan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
