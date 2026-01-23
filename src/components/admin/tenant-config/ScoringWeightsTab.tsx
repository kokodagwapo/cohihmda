/**
 * Scoring Weights Tab
 * Manage TopTiering scorecard weights and loan complexity components
 */

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
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
  BarChart3, 
  Calculator,
  Save,
  RotateCcw,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus
} from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Progress } from '@/components/ui/progress';
import { useAdminTenant } from '@/contexts/AdminTenantContext';

interface ScoringWeightsTabProps {
  weights: Record<string, any[]>;
  complexityComponents: Record<string, any[]>;
  onRefresh: () => void;
}

const SCORECARD_METRICS = {
  sales: [
    { name: 'pull_through', label: 'Pull-Through %', description: 'Percentage of leads that convert to funded loans' },
    { name: 'revenue', label: 'Revenue', description: 'Revenue per loan' },
    { name: 'volume', label: 'Volume', description: 'Number of loans' },
    { name: 'turn_time', label: 'Turn Time', description: 'Days from application to close (inverse score)' },
  ],
  operations: [
    { name: 'turn_time', label: 'Turn Time', description: 'Processing efficiency (inverse score)' },
    { name: 'pull_through', label: 'Pull-Through %', description: 'Percentage of loans that fund' },
    { name: 'volume', label: 'Volume', description: 'Number of loans processed' },
  ],
};

const COMPLEXITY_COMPONENTS = [
  { name: 'loan_purpose', label: 'Loan Purpose', description: 'C-to-P, Purchase, Refi CO, etc.' },
  { name: 'loan_type', label: 'Loan Type', description: 'FHA, VA, Conventional' },
  { name: 'loan_amount', label: 'Loan Amount', description: 'Jumbo vs conforming' },
  { name: 'occupancy', label: 'Occupancy', description: 'Primary, Second Home, Investor' },
  { name: 'fico', label: 'FICO Score', description: 'Credit score ranges' },
  { name: 'ltv', label: 'LTV', description: 'Loan-to-value ratio' },
  { name: 'dti', label: 'DTI', description: 'Debt-to-income ratio' },
  { name: 'employment', label: 'Employment', description: 'Self-employed status' },
];

export function ScoringWeightsTab({ weights, complexityComponents, onRefresh }: ScoringWeightsTabProps) {
  const { toast } = useToast();
  const { isTenantAdmin } = useAdminTenant();
  const [activeTab, setActiveTab] = useState('sales');
  const [saving, setSaving] = useState(false);
  const [editedWeights, setEditedWeights] = useState<Record<string, Record<string, number>>>({});

  // Initialize edited weights from props
  const getWeightValue = (scorecardType: string, metricName: string): number => {
    if (editedWeights[scorecardType]?.[metricName] !== undefined) {
      return editedWeights[scorecardType][metricName];
    }
    const weightList = weights[scorecardType] || [];
    const weight = weightList.find((w: any) => w.metric_name === metricName);
    return weight?.weight ?? 0;
  };

  const handleWeightChange = (scorecardType: string, metricName: string, value: number) => {
    setEditedWeights(prev => ({
      ...prev,
      [scorecardType]: {
        ...(prev[scorecardType] || {}),
        [metricName]: value,
      },
    }));
  };

  const getTotalWeight = (scorecardType: string): number => {
    const metrics = SCORECARD_METRICS[scorecardType as keyof typeof SCORECARD_METRICS] || [];
    return metrics.reduce((sum, m) => sum + getWeightValue(scorecardType, m.name), 0);
  };

  const handleSaveWeights = async (scorecardType: string) => {
    const metrics = SCORECARD_METRICS[scorecardType as keyof typeof SCORECARD_METRICS] || [];
    const weightsToSave = metrics.map(m => ({
      metric_name: m.name,
      weight: getWeightValue(scorecardType, m.name),
      description: m.description,
    }));

    // Validate total = 1.0
    const total = weightsToSave.reduce((sum, w) => sum + w.weight, 0);
    if (Math.abs(total - 1.0) > 0.01) {
      toast({
        title: 'Validation Error',
        description: `Weights must sum to 100% (current: ${(total * 100).toFixed(0)}%)`,
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      await api.request(`/api/tenant-config/scoring-weights/${scorecardType}`, {
        method: 'PUT',
        body: JSON.stringify({ weights: weightsToSave }),
      });
      toast({ title: 'Success', description: 'Scoring weights saved successfully' });
      // Clear edited state for this scorecard
      setEditedWeights(prev => {
        const newState = { ...prev };
        delete newState[scorecardType];
        return newState;
      });
      onRefresh();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save weights',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleResetWeights = (scorecardType: string) => {
    setEditedWeights(prev => {
      const newState = { ...prev };
      delete newState[scorecardType];
      return newState;
    });
  };

  const hasChanges = (scorecardType: string): boolean => {
    return !!editedWeights[scorecardType] && Object.keys(editedWeights[scorecardType]).length > 0;
  };

  const renderScorecardWeights = (scorecardType: 'sales' | 'operations') => {
    const metrics = SCORECARD_METRICS[scorecardType];
    const total = getTotalWeight(scorecardType);
    const isValid = Math.abs(total - 1.0) <= 0.01;

    return (
      <div className="space-y-6">
        {/* Progress bar showing total */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="font-light text-slate-600 dark:text-slate-400">Total Weight</span>
            <span className={`font-medium ${isValid ? 'text-green-600' : 'text-red-600'}`}>
              {(total * 100).toFixed(0)}%
            </span>
          </div>
          <Progress value={total * 100} className={`h-2 ${!isValid && 'bg-red-100'}`} />
          {!isValid && (
            <p className="text-xs text-red-600">
              Weights must sum to 100%. Adjust values below.
            </p>
          )}
        </div>

        {/* Weight Sliders */}
        <div className="space-y-6">
          {metrics.map((metric) => {
            const value = getWeightValue(scorecardType, metric.name);
            return (
              <div key={metric.name} className="space-y-3">
                <div className="flex justify-between items-center">
                  <div>
                    <Label className="font-medium">{metric.label}</Label>
                    <p className="text-xs text-slate-500">{metric.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={(value * 100).toFixed(0)}
                      onChange={(e) => handleWeightChange(scorecardType, metric.name, parseFloat(e.target.value) / 100 || 0)}
                      className="w-20 text-right"
                      min={0}
                      max={100}
                    />
                    <span className="text-sm text-slate-500">%</span>
                  </div>
                </div>
                <Slider
                  value={[value * 100]}
                  onValueChange={([v]) => handleWeightChange(scorecardType, metric.name, v / 100)}
                  max={100}
                  step={5}
                  className="w-full"
                />
              </div>
            );
          })}
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button
            variant="outline"
            onClick={() => handleResetWeights(scorecardType)}
            disabled={!hasChanges(scorecardType)}
            className="font-light"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset
          </Button>
          <Button
            onClick={() => handleSaveWeights(scorecardType)}
            disabled={saving || !isValid}
            className="font-light"
          >
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Save className="h-4 w-4 mr-2" />
            Save Weights
          </Button>
        </div>
      </div>
    );
  };

  const renderComplexityComponents = () => {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Loan Complexity Score is calculated by summing weights from each component.
          Higher scores indicate more complex loans. Weights can be negative (e.g., excellent FICO reduces complexity).
        </p>

        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 dark:bg-slate-800/50">
                <TableHead className="font-medium">Component</TableHead>
                <TableHead className="font-medium">Condition</TableHead>
                <TableHead className="font-medium text-right">Weight</TableHead>
                <TableHead className="font-medium text-center">Impact</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {COMPLEXITY_COMPONENTS.map((component) => {
                const componentValues = complexityComponents[component.name] || [];
                return componentValues.map((value: any) => (
                  <TableRow key={`${component.name}-${value.condition_value}`}>
                    <TableCell className="font-medium">
                      {component.label}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">
                        {value.condition_value}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {value.weight > 0 ? '+' : ''}{(value.weight * 100).toFixed(0)}%
                    </TableCell>
                    <TableCell className="text-center">
                      {value.weight > 0 ? (
                        <TrendingUp className="h-4 w-4 mx-auto text-red-500" />
                      ) : value.weight < 0 ? (
                        <TrendingDown className="h-4 w-4 mx-auto text-green-500" />
                      ) : (
                        <Minus className="h-4 w-4 mx-auto text-slate-400" />
                      )}
                    </TableCell>
                  </TableRow>
                ));
              })}
            </TableBody>
          </Table>
        </div>

        <div className="p-4 bg-slate-50 dark:bg-slate-800/30 rounded-lg">
          <h4 className="font-medium mb-2">Score Interpretation</h4>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div className="text-center">
              <div className="text-2xl font-light text-green-600">&lt; 0.5</div>
              <div className="text-slate-500">Low Complexity</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-light text-amber-600">0.5 - 1.0</div>
              <div className="text-slate-500">Medium Complexity</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-light text-red-600">&gt; 1.0</div>
              <div className="text-slate-500">High Complexity</div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
      <CardHeader>
        <CardTitle className="text-lg font-thin text-slate-900 dark:text-white flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Scoring Weights
        </CardTitle>
        <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
          Configure TopTiering scorecard weights and loan complexity calculations
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3 mb-6">
            <TabsTrigger value="sales" className="font-light">
              <TrendingUp className="h-4 w-4 mr-2" />
              Sales Scorecard
            </TabsTrigger>
            <TabsTrigger value="operations" className="font-light">
              <Calculator className="h-4 w-4 mr-2" />
              Operations Scorecard
            </TabsTrigger>
            <TabsTrigger value="complexity" className="font-light">
              <BarChart3 className="h-4 w-4 mr-2" />
              Loan Complexity
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sales">
            {renderScorecardWeights('sales')}
          </TabsContent>

          <TabsContent value="operations">
            {renderScorecardWeights('operations')}
          </TabsContent>

          <TabsContent value="complexity">
            {renderComplexityComponents()}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
