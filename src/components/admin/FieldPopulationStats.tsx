import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';
import { Loader2, RefreshCw, Database, TrendingUp, TrendingDown, Bug } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface FieldPopulationStatsProps {
  tenantId: string | null;
  losConnectionId?: string | null;
}

interface FieldStat {
  columnName: string;
  dataType: string;
  populatedCount: number;
  populationRate: number;
}

interface FieldPopulationData {
  totalLoans: number;
  overallPopulationRate: number;
  fields: FieldStat[];
}

export function FieldPopulationStats({ tenantId, losConnectionId }: FieldPopulationStatsProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FieldPopulationData | null>(null);
  const [sortBy, setSortBy] = useState<'rate' | 'name'>('rate');
  const [filter, setFilter] = useState<'all' | 'populated' | 'empty'>('all');
  const [debugData, setDebugData] = useState<any>(null);
  const [loadingDebug, setLoadingDebug] = useState(false);

  const loadStats = async () => {
    if (!tenantId) return;

    setLoading(true);
    try {
      const stats = await api.request<FieldPopulationData>(
        `/api/los/field-population-stats?tenant_id=${tenantId}`
      );
      setData(stats);
    } catch (error: any) {
      console.error('Error loading field population stats:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to load field population statistics',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const [comparisonData, setComparisonData] = useState<any>(null);
  const [loadingComparison, setLoadingComparison] = useState(false);
  const [schemaDictData, setSchemaDictData] = useState<any>(null);
  const [loadingSchemaDict, setLoadingSchemaDict] = useState(false);

  const loadComparison = async () => {
    if (!tenantId) return;
    
    setLoadingComparison(true);
    try {
      const response = await api.request(`/api/los/transformation-comparison?tenant_id=${tenantId}`);
      setComparisonData(response);
    } catch (error: any) {
      console.error('Error loading transformation comparison:', error);
    } finally {
      setLoadingComparison(false);
    }
  };

  const loadSchemaDictComparison = async () => {
    if (!tenantId) return;
    
    setLoadingSchemaDict(true);
    try {
      const response = await api.request(`/api/los/schema-dictionary-comparison?tenant_id=${tenantId}`);
      setSchemaDictData(response);
    } catch (error: any) {
      console.error('Error loading schema-dictionary comparison:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to load schema-dictionary comparison',
        variant: 'destructive',
      });
    } finally {
      setLoadingSchemaDict(false);
    }
  };

  const loadDebugInfo = async () => {
    if (!tenantId || !losConnectionId) return;

    setLoadingDebug(true);
    try {
      const debug = await api.request(
        `/api/los/field-mapping-debug?tenant_id=${tenantId}&connection_id=${losConnectionId}`
      );
      setDebugData(debug);
    } catch (error: any) {
      console.error('Error loading debug info:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to load field mapping debug info',
        variant: 'destructive',
      });
    } finally {
      setLoadingDebug(false);
    }
  };

  useEffect(() => {
    if (tenantId) {
      loadStats();
    } else {
      setData(null);
    }
  }, [tenantId]);

  if (!tenantId) {
    return null;
  }

  const sortedFields = data?.fields
    ? [...data.fields].sort((a, b) => {
        if (sortBy === 'rate') {
          return b.populationRate - a.populationRate;
        } else {
          return a.columnName.localeCompare(b.columnName);
        }
      })
    : [];

  const filteredFields = sortedFields.filter((field) => {
    if (filter === 'populated') return field.populationRate > 0;
    if (filter === 'empty') return field.populationRate === 0;
    return true;
  });

  const getPopulationColor = (rate: number) => {
    if (rate >= 80) return 'text-green-600 dark:text-green-400';
    if (rate >= 50) return 'text-yellow-600 dark:text-yellow-400';
    if (rate > 0) return 'text-orange-600 dark:text-orange-400';
    return 'text-red-600 dark:text-red-400';
  };


  return (
    <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
              <Database className="h-5 w-5" />
              Field Population Statistics
            </CardTitle>
            <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
              Data completeness across all loan fields
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={loadSchemaDictComparison}
              disabled={loadingSchemaDict}
              className="text-xs"
            >
              <Database className={`h-3 w-3 mr-1 ${loadingSchemaDict ? 'animate-spin' : ''}`} />
              Dictionary Check
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={loadComparison}
              disabled={loadingComparison}
              className="text-xs"
            >
              <Database className={`h-3 w-3 mr-1 ${loadingComparison ? 'animate-spin' : ''}`} />
              Compare Schema
            </Button>
            {losConnectionId && (
              <Button
                size="sm"
                variant="outline"
                className="font-extralight"
                onClick={loadDebugInfo}
                disabled={loadingDebug}
              >
                <Bug className={`h-4 w-4 mr-2 ${loadingDebug ? 'animate-spin' : ''}`} />
                Debug Empty Fields
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="font-extralight"
              onClick={loadStats}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading && !data ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : !data || data.totalLoans === 0 ? (
          <div className="text-center py-8">
            <Database className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" strokeWidth={1.5} />
            <p className="text-sm text-slate-500 dark:text-slate-400 font-light">
              No loan data available
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Overall Statistics */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800/30">
                <div className="text-xs text-slate-500 dark:text-slate-400 font-light mb-1">
                  Total Loans
                </div>
                <div className="text-2xl font-thin text-slate-900 dark:text-white">
                  {data.totalLoans.toLocaleString()}
                </div>
              </div>
              <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800/30">
                <div className="text-xs text-slate-500 dark:text-slate-400 font-light mb-1">
                  Overall Population Rate
                </div>
                <div className="flex items-center gap-2">
                  <div className={`text-2xl font-thin ${getPopulationColor(data.overallPopulationRate)}`}>
                    {data.overallPopulationRate.toFixed(1)}%
                  </div>
                  {data.overallPopulationRate >= 50 ? (
                    <TrendingUp className="h-4 w-4 text-green-500" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-red-500" />
                  )}
                </div>
                <div className="mt-2">
                  <Progress 
                    value={data.overallPopulationRate} 
                    className="h-2"
                  />
                </div>
              </div>
            </div>

            {/* Filters and Sort */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400 font-light">Sort by:</span>
                <Button
                  size="sm"
                  variant={sortBy === 'rate' ? 'default' : 'outline'}
                  className="h-7 text-xs font-extralight"
                  onClick={() => setSortBy('rate')}
                >
                  Population Rate
                </Button>
                <Button
                  size="sm"
                  variant={sortBy === 'name' ? 'default' : 'outline'}
                  className="h-7 text-xs font-extralight"
                  onClick={() => setSortBy('name')}
                >
                  Field Name
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400 font-light">Filter:</span>
                <Button
                  size="sm"
                  variant={filter === 'all' ? 'default' : 'outline'}
                  className="h-7 text-xs font-extralight"
                  onClick={() => setFilter('all')}
                >
                  All
                </Button>
                <Button
                  size="sm"
                  variant={filter === 'populated' ? 'default' : 'outline'}
                  className="h-7 text-xs font-extralight"
                  onClick={() => setFilter('populated')}
                >
                  Populated
                </Button>
                <Button
                  size="sm"
                  variant={filter === 'empty' ? 'default' : 'outline'}
                  className="h-7 text-xs font-extralight"
                  onClick={() => setFilter('empty')}
                >
                  Empty
                </Button>
              </div>
            </div>

            {/* Field List */}
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 sticky top-0">
                    <tr>
                      <th className="text-left p-3 font-light text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                        Field Name
                      </th>
                      <th className="text-left p-3 font-light text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                        Type
                      </th>
                      <th className="text-right p-3 font-light text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                        Populated
                      </th>
                      <th className="text-right p-3 font-light text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                        Rate
                      </th>
                      <th className="w-48 p-3 font-light text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                        Progress
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFields.map((field) => (
                      <tr
                        key={field.columnName}
                        className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30"
                      >
                        <td className="p-3 font-mono text-xs text-slate-700 dark:text-slate-300">
                          {field.columnName}
                        </td>
                        <td className="p-3">
                          <Badge variant="outline" className="text-xs font-extralight border-slate-300 dark:border-slate-600">
                            {field.dataType}
                          </Badge>
                        </td>
                        <td className="p-3 text-right text-slate-600 dark:text-slate-400">
                          {field.populatedCount.toLocaleString()} / {data.totalLoans.toLocaleString()}
                        </td>
                        <td className={`p-3 text-right font-medium ${getPopulationColor(field.populationRate)}`}>
                          {field.populationRate.toFixed(1)}%
                        </td>
                        <td className="p-3">
                          <Progress 
                            value={field.populationRate} 
                            className="h-2"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Summary */}
            <div className="text-xs text-slate-500 dark:text-slate-400 font-light">
              Showing {filteredFields.length} of {data.fields.length} fields
              {filter !== 'all' && ` (filtered: ${filter})`}
            </div>

            {/* Schema vs Data Dictionary Comparison - Most Important! */}
            {schemaDictData && (
              <div className="mt-6 p-4 border border-purple-200 dark:border-purple-800 rounded-lg bg-purple-50 dark:bg-purple-900/20">
                <div className="flex items-center gap-2 mb-3">
                  <Database className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                  <h3 className="text-sm font-medium text-purple-900 dark:text-purple-100">
                    Database Schema vs Data Dictionary
                  </h3>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                  Shows which database columns have valid mappings in the data dictionary (CoheusDataDictionary.xml)
                </p>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-light">DB Columns</div>
                    <div className="text-lg font-thin text-slate-900 dark:text-white">
                      {schemaDictData.summary?.totalDatabaseColumns || 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-light">Valid Mappings</div>
                    <div className="text-lg font-thin text-green-600 dark:text-green-400">
                      {schemaDictData.summary?.validColumns || 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-light">Orphaned (No Mapping)</div>
                    <div className="text-lg font-thin text-red-600 dark:text-red-400">
                      {schemaDictData.summary?.orphanedColumns || 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-light">Dictionary Aliases</div>
                    <div className="text-lg font-thin text-slate-900 dark:text-white">
                      {schemaDictData.summary?.aliasesInDictionary || 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-light">Missing in DB</div>
                    <div className="text-lg font-thin text-yellow-600 dark:text-yellow-400">
                      {schemaDictData.summary?.missingColumnsInDb || 0}
                    </div>
                  </div>
                </div>
                
                {schemaDictData.orphanedColumns && schemaDictData.orphanedColumns.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs font-medium text-red-700 dark:text-red-300 mb-2">
                      🚫 Orphaned Columns - Will NEVER Populate ({schemaDictData.orphanedColumns.length}):
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                      These columns exist in the database but have no mapping in the data dictionary. They cannot be populated via Encompass sync.
                    </p>
                    <div className="max-h-48 overflow-y-auto border border-red-200 dark:border-red-800 rounded">
                      <table className="w-full text-xs">
                        <thead className="bg-red-100 dark:bg-red-900/30 sticky top-0">
                          <tr>
                            <th className="text-left p-2 font-medium">Column Name</th>
                            <th className="text-left p-2 font-medium">Type</th>
                          </tr>
                        </thead>
                        <tbody>
                          {schemaDictData.orphanedColumns.map((col: any, idx: number) => (
                            <tr key={idx} className="border-t border-red-100 dark:border-red-900/30">
                              <td className="p-2 font-mono text-slate-700 dark:text-slate-300">{col.column}</td>
                              <td className="p-2 text-slate-500 dark:text-slate-400">{col.type}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                
                {schemaDictData.missingColumns && schemaDictData.missingColumns.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs font-medium text-yellow-700 dark:text-yellow-300 mb-2">
                      ⚠️ Missing DB Columns - Data Dictionary Has Mapping ({schemaDictData.missingColumns.length}):
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                      These aliases exist in the data dictionary but have no corresponding column in the database.
                    </p>
                    <div className="max-h-48 overflow-y-auto border border-yellow-200 dark:border-yellow-800 rounded">
                      <table className="w-full text-xs">
                        <thead className="bg-yellow-100 dark:bg-yellow-900/30 sticky top-0">
                          <tr>
                            <th className="text-left p-2 font-medium">Alias</th>
                            <th className="text-left p-2 font-medium">Expected Column</th>
                          </tr>
                        </thead>
                        <tbody>
                          {schemaDictData.missingColumns.map((col: any, idx: number) => (
                            <tr key={idx} className="border-t border-yellow-100 dark:border-yellow-900/30">
                              <td className="p-2 text-slate-700 dark:text-slate-300">{col.alias}</td>
                              <td className="p-2 font-mono text-slate-500 dark:text-slate-400">{col.expectedColumn}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Transformation Comparison */}
            {comparisonData && (
              <div className="mt-6 p-4 border border-blue-200 dark:border-blue-800 rounded-lg bg-blue-50 dark:bg-blue-900/20">
                <div className="flex items-center gap-2 mb-3">
                  <Database className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <h3 className="text-sm font-medium text-blue-900 dark:text-blue-100">
                    Schema vs Transformed Loan Comparison
                  </h3>
                </div>
                
                {/* Check if no data available */}
                {comparisonData.error === 'no_loans' || (!comparisonData.summary && !comparisonData.transformedLoanKeys) ? (
                  <div className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center">
                    No loan data available. Sync some loans to see transformation comparison.
                  </div>
                ) : comparisonData.summary ? (
                  /* New format */
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                      <div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-light">Raw Data Keys</div>
                        <div className="text-lg font-thin text-slate-900 dark:text-white">
                          {comparisonData.summary.totalRawDataKeys || 0}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-light">DB Columns</div>
                        <div className="text-lg font-thin text-slate-900 dark:text-white">
                          {comparisonData.summary.databaseColumns || 0}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-light">Populated</div>
                        <div className="text-lg font-thin text-green-600 dark:text-green-400">
                          {comparisonData.summary.populatedColumns || 0}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-light">Empty</div>
                        <div className="text-lg font-thin text-yellow-600 dark:text-yellow-400">
                          {comparisonData.summary.emptyColumns || 0}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-light">Problem Mappings</div>
                        <div className="text-lg font-thin text-red-600 dark:text-red-400">
                          {comparisonData.summary.problemMappings || 0}
                        </div>
                      </div>
                    </div>
                    
                    {comparisonData.problemMappings && comparisonData.problemMappings.length > 0 && (
                      <div className="mt-4">
                        <div className="text-xs font-medium text-red-700 dark:text-red-300 mb-2">
                          ⚠️ Problem Mappings - Has Raw Data But Empty in DB ({comparisonData.problemMappings.length}):
                        </div>
                        <div className="max-h-64 overflow-y-auto border border-red-200 dark:border-red-800 rounded">
                          <table className="w-full text-xs">
                            <thead className="bg-red-100 dark:bg-red-900/30 sticky top-0">
                              <tr>
                                <th className="text-left p-2 font-medium">Alias</th>
                                <th className="text-left p-2 font-medium">Field ID</th>
                                <th className="text-left p-2 font-medium">Found As Key</th>
                                <th className="text-left p-2 font-medium">Column</th>
                                <th className="text-left p-2 font-medium">Raw Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {comparisonData.problemMappings.map((m: any, idx: number) => (
                                <tr key={idx} className="border-t border-red-100 dark:border-red-900/30">
                                  <td className="p-2 text-slate-700 dark:text-slate-300">{m.alias}</td>
                                  <td className="p-2 font-mono text-slate-500 dark:text-slate-400 text-[10px]">{m.fieldId}</td>
                                  <td className="p-2 font-mono text-green-600 dark:text-green-400 text-[10px]">{m.foundAsKey || '-'}</td>
                                  <td className="p-2 font-mono text-slate-500 dark:text-slate-400">{m.column}</td>
                                  <td className="p-2 font-mono text-blue-600 dark:text-blue-400 max-w-32 truncate" title={String(m.rawValue)}>
                                    {m.rawValue !== undefined ? String(m.rawValue).slice(0, 30) : '-'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    
                    {comparisonData.emptyColumns && comparisonData.emptyColumns.length > 0 && (
                      <div className="mt-4">
                        <div className="text-xs font-medium text-yellow-700 dark:text-yellow-300 mb-2">
                          Empty Columns in Sample Loan ({comparisonData.emptyColumns.length}):
                        </div>
                        <div className="text-xs font-mono text-slate-600 dark:text-slate-400">
                          {comparisonData.emptyColumns.slice(0, 30).join(', ')}
                          {comparisonData.emptyColumns.length > 30 && ` ... and ${comparisonData.emptyColumns.length - 30} more`}
                        </div>
                      </div>
                    )}
                    
                    {comparisonData.populatedColumns && comparisonData.populatedColumns.length > 0 && (
                      <div className="mt-4">
                        <div className="text-xs font-medium text-green-700 dark:text-green-300 mb-2">
                          ✓ Populated Columns ({comparisonData.populatedColumns.length}):
                        </div>
                        <div className="text-xs font-mono text-slate-600 dark:text-slate-400">
                          {comparisonData.populatedColumns.slice(0, 30).join(', ')}
                          {comparisonData.populatedColumns.length > 30 && ` ... and ${comparisonData.populatedColumns.length - 30} more`}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  /* Old format fallback */
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                      <div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-light">Transformed Keys</div>
                        <div className="text-lg font-thin text-slate-900 dark:text-white">
                          {comparisonData.transformedLoanKeys?.length || 0}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-light">Database Columns</div>
                        <div className="text-lg font-thin text-slate-900 dark:text-white">
                          {comparisonData.databaseColumns?.length || 0}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-light">Missing in DB</div>
                        <div className="text-lg font-thin text-red-600 dark:text-red-400">
                          {comparisonData.missingInDatabase?.length || 0}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-light">Empty Columns</div>
                        <div className="text-lg font-thin text-yellow-600 dark:text-yellow-400">
                          {comparisonData.missingInTransformed?.length || 0}
                        </div>
                      </div>
                    </div>
                    
                    {comparisonData.missingInDatabase && comparisonData.missingInDatabase.length > 0 && (
                      <div className="mt-4">
                        <div className="text-xs font-medium text-red-700 dark:text-red-300 mb-2">
                          ⚠️ Fields in Transformed Loan But Not in Database Schema ({comparisonData.missingInDatabase.length}):
                        </div>
                        <div className="text-xs font-mono text-slate-600 dark:text-slate-400">
                          {comparisonData.missingInDatabase.slice(0, 30).join(', ')}
                          {comparisonData.missingInDatabase.length > 30 && ` ... and ${comparisonData.missingInDatabase.length - 30} more`}
                        </div>
                      </div>
                    )}
                    
                    {comparisonData.missingInTransformed && comparisonData.missingInTransformed.length > 0 && (
                      <div className="mt-4">
                        <div className="text-xs font-medium text-yellow-700 dark:text-yellow-300 mb-2">
                          Database Columns With No Data ({comparisonData.missingInTransformed.length}):
                        </div>
                        <div className="text-xs font-mono text-slate-600 dark:text-slate-400">
                          {comparisonData.missingInTransformed.slice(0, 30).join(', ')}
                          {comparisonData.missingInTransformed.length > 30 && ` ... and ${comparisonData.missingInTransformed.length - 30} more`}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Debug Information */}
            {debugData && (
              <div className="mt-6 p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800/30">
                <div className="flex items-center gap-2 mb-3">
                  <Bug className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                  <h3 className="text-sm font-medium text-slate-900 dark:text-white">
                    Field Mapping Debug Analysis
                  </h3>
                </div>
                <div className={`grid gap-4 mb-4 ${debugData.summary.foundInSampleButNotMapped !== undefined ? 'grid-cols-2 md:grid-cols-5' : 'grid-cols-2 md:grid-cols-4'}`}>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-light">Total Mapped</div>
                    <div className="text-lg font-thin text-slate-900 dark:text-white">
                      {debugData.summary.totalMappedFields}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-light">Populated</div>
                    <div className="text-lg font-thin text-green-600 dark:text-green-400">
                      {debugData.summary.populatedFields}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-light">Empty (0%)</div>
                    <div className="text-lg font-thin text-red-600 dark:text-red-400">
                      {debugData.summary.emptyMappedFields}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-light">In Sample Loan</div>
                    <div className="text-lg font-thin text-slate-900 dark:text-white">
                      {debugData.summary.fieldsInSample}
                    </div>
                  </div>
                </div>
                
                {debugData.foundInSample && debugData.foundInSample.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs font-medium text-red-700 dark:text-red-300 mb-2">
                      ⚠️ CRITICAL: Fields Found in Sample But Not Being Mapped ({debugData.foundInSample.length}):
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                      These fields exist in the API response but aren't being populated. The enhanced mapping logic should fix these automatically.
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {debugData.foundInSample.slice(0, 30).map((field: any, idx: number) => (
                        <div key={idx} className="text-xs font-mono p-2 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-slate-600 dark:text-slate-400">{field.alias}</span>
                              <span className="text-slate-400 dark:text-slate-500 mx-2">→</span>
                              <span className="text-slate-700 dark:text-slate-300">{field.columnName}</span>
                            </div>
                            <div className="text-slate-500 dark:text-slate-400">
                              Found as: <span className="font-semibold">{field.foundAs}</span>
                            </div>
                          </div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Field ID: {field.fieldId}
                          </div>
                        </div>
                      ))}
                      {debugData.foundInSample.length > 30 && (
                        <div className="text-xs text-slate-500 dark:text-slate-400 italic">
                          ... and {debugData.foundInSample.length - 30} more
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
                {debugData.missingFromSample && debugData.missingFromSample.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Fields Not Found in Sample Loan Response ({debugData.missingFromSample.length}):
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {debugData.missingFromSample.slice(0, 20).map((field: any, idx: number) => (
                        <div key={idx} className="text-xs font-mono p-2 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-slate-600 dark:text-slate-400">{field.alias}</span>
                              <span className="text-slate-400 dark:text-slate-500 mx-2">→</span>
                              <span className="text-slate-700 dark:text-slate-300">{field.columnName}</span>
                            </div>
                            <div className="text-slate-500 dark:text-slate-400">
                              Field ID: {field.fieldId}
                            </div>
                          </div>
                          {field.foundVariations && field.foundVariations.length > 0 && (
                            <div className="mt-1 text-xs text-yellow-600 dark:text-yellow-400">
                              Similar fields found: {field.foundVariations.join(', ')}
                            </div>
                          )}
                        </div>
                      ))}
                      {debugData.missingFromSample.length > 20 && (
                        <div className="text-xs text-slate-500 dark:text-slate-400 italic">
                          ... and {debugData.missingFromSample.length - 20} more
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
