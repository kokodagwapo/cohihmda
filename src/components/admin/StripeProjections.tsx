import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, TrendingUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';

interface Projection {
  customers: number;
  [key: string]: any;
}

interface ProjectionsData {
  projections: Projection[];
  plans: Array<{ id: string; name: string; display_name: string }>;
}

export const StripeProjections = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ProjectionsData | null>(null);
  const [viewMode, setViewMode] = useState<'monthly' | 'annual'>('monthly');
  const { toast } = useToast();

  const loadProjections = async () => {
    setLoading(true);
    try {
      const response = await api.request<ProjectionsData>('/api/subscriptions/projections');
      setData(response);
    } catch (error: any) {
      console.error('Error loading projections:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to load revenue projections',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjections();
  }, []);

  if (loading) {
    return (
      <Card className="border-slate-200 dark:border-slate-700">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.projections.length === 0) {
    return (
      <Card className="border-slate-200 dark:border-slate-700">
        <CardContent className="text-center py-12">
          <TrendingUp className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
          <p className="text-sm text-slate-500 dark:text-slate-400">No projection data available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-violet-500" />
            <div>
              <CardTitle className="text-lg font-thin text-slate-900 dark:text-white">
                Revenue Projections
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light mt-1">
                Projected {viewMode === 'monthly' ? 'monthly' : 'annual'} revenue at different customer scales
              </CardDescription>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant={viewMode === 'monthly' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('monthly')}
              className="font-extralight"
            >
              Monthly
            </Button>
            <Button
              variant={viewMode === 'annual' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('annual')}
              className="font-extralight"
            >
              Annual
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-medium">Customers</TableHead>
                {data.plans.map(plan => (
                  <TableHead key={plan.id} className="font-medium text-right">
                    {plan.display_name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.projections.map((projection) => (
                <TableRow key={projection.customers}>
                  <TableCell className="font-medium">{projection.customers}</TableCell>
                  {data.plans.map(plan => {
                    const planData = projection[plan.name];
                    const revenue = viewMode === 'monthly' 
                      ? planData?.monthly_formatted 
                      : planData?.yearly_formatted;
                    return (
                      <TableCell key={plan.id} className="text-right">
                        {revenue || '$0.00'}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-800/30 rounded-lg border border-slate-200 dark:border-slate-700">
          <p className="text-xs text-slate-500 dark:text-slate-400 font-light">
            💡 <strong>Note:</strong> Projections automatically update when plan pricing changes. 
            Values shown are {viewMode === 'monthly' ? 'monthly recurring revenue (MRR)' : 'annual recurring revenue (ARR)'} estimates.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
