import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';
import { Loader2, RefreshCw, Database, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, XCircle, Search as SearchIcon } from 'lucide-react';
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

interface AnalysisReport {
  // From schema-dictionary comparison
  orphanedColumns: Array<{ column: string; type: string }>;
  missingColumns: Array<{ alias: string; expectedColumn: string }>;
  validMappings: number;
  totalDbColumns: number;
  // From transformation comparison
  problemMappings: Array<{ alias: string; fieldId: string; column: string; rawValue: any; foundAsKey?: string }>;
  emptyColumns: string[];
  populatedColumns: string[];
  // From debug
  foundInSampleNotMapped: Array<{ alias: string; columnName: string; fieldId: string; foundAs: string }>;
  missingFromSample: Array<{ alias: string; columnName: string; fieldId: string; foundVariations?: string[] }>;
}

export function FieldPopulationStats({ tenantId, losConnectionId }: FieldPopulationStatsProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FieldPopulationData | null>(null);
  const [sortBy, setSortBy] = useState<'rate' | 'name'>('rate');
  const [filter, setFilter] = useState<'all' | 'populated' | 'empty'>('all');

  // Unified analysis state
  const [analysisReport, setAnalysisReport] = useState<AnalysisReport | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState('');
  const [analysisProgress, setAnalysisProgress] = useState(0);

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

  const runAnalysis = async () => {
    if (!tenantId) return;

    setAnalyzing(true);
    setAnalysisReport(null);

    const report: AnalysisReport = {
      orphanedColumns: [],
      missingColumns: [],
      validMappings: 0,
      totalDbColumns: 0,
      problemMappings: [],
      emptyColumns: [],
      populatedColumns: [],
      foundInSampleNotMapped: [],
      missingFromSample: [],
    };

    try {
      // Step 1: Schema-dictionary comparison
      setAnalysisStep('Checking field mappings against data dictionary...');
      setAnalysisProgress(15);
      try {
        const schemaDict = await api.request(`/api/los/schema-dictionary-comparison?tenant_id=${tenantId}`);
        report.orphanedColumns = schemaDict.orphanedColumns || [];
        report.missingColumns = schemaDict.missingColumns || [];
        report.validMappings = schemaDict.summary?.validColumns || 0;
        report.totalDbColumns = schemaDict.summary?.totalDatabaseColumns || 0;
      } catch (e) {
        console.warn('Schema-dictionary comparison failed:', e);
      }

      // Step 2: Transformation comparison
      setAnalysisStep('Comparing raw data with database schema...');
      setAnalysisProgress(45);
      try {
        const comparison = await api.request(`/api/los/transformation-comparison?tenant_id=${tenantId}`);
        if (comparison.summary) {
          report.problemMappings = comparison.problemMappings || [];
          report.emptyColumns = comparison.emptyColumns || [];
          report.populatedColumns = comparison.populatedColumns || [];
        }
      } catch (e) {
        console.warn('Transformation comparison failed:', e);
      }

      // Step 3: Debug empty fields (only if connection available)
      if (losConnectionId) {
        setAnalysisStep('Debugging empty field mappings...');
        setAnalysisProgress(75);
        try {
          const debug = await api.request(
            `/api/los/field-mapping-debug?tenant_id=${tenantId}&connection_id=${losConnectionId}`
          );
          report.foundInSampleNotMapped = debug.foundInSample || [];
          report.missingFromSample = debug.missingFromSample || [];
        } catch (e) {
          console.warn('Field mapping debug failed:', e);
        }
      }

      setAnalysisProgress(100);
      setAnalysisStep('Analysis complete');
      setAnalysisReport(report);
    } catch (error: any) {
      toast({
        title: 'Analysis Failed',
        description: error.message || 'Failed to run field analysis',
        variant: 'destructive',
      });
    } finally {
      setAnalyzing(false);
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

  // Count issues for the report summary
  const totalIssues = analysisReport
    ? analysisReport.orphanedColumns.length +
      analysisReport.problemMappings.length +
      analysisReport.foundInSampleNotMapped.length
    : 0;

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
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={runAnalysis}
              disabled={analyzing || !data}
              className="font-extralight"
            >
              {analyzing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <SearchIcon className="h-4 w-4 mr-2" />
              )}
              {analyzing ? 'Analyzing...' : 'Run Analysis'}
            </Button>
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

            {/* Analysis Progress */}
            {analyzing && (
              <div className="p-4 border border-blue-200 dark:border-blue-800 rounded-lg bg-blue-50 dark:bg-blue-900/20">
                <div className="flex items-center gap-2 mb-2">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
                  <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                    {analysisStep}
                  </span>
                </div>
                <Progress value={analysisProgress} className="h-1.5" />
              </div>
            )}

            {/* Unified Analysis Report */}
            {analysisReport && (
              <div className="space-y-4">
                {/* Report Summary */}
                <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
                  <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    Analysis Report
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">Valid Mappings</div>
                      <div className="text-lg font-thin text-green-600 dark:text-green-400">
                        {analysisReport.validMappings}
                        <span className="text-xs text-slate-400 ml-1">/ {analysisReport.totalDbColumns}</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">Orphaned Columns</div>
                      <div className={`text-lg font-thin ${analysisReport.orphanedColumns.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                        {analysisReport.orphanedColumns.length}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">Problem Mappings</div>
                      <div className={`text-lg font-thin ${analysisReport.problemMappings.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                        {analysisReport.problemMappings.length}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">Unmapped Fields</div>
                      <div className={`text-lg font-thin ${analysisReport.foundInSampleNotMapped.length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
                        {analysisReport.foundInSampleNotMapped.length}
                      </div>
                    </div>
                  </div>

                  {totalIssues === 0 && (
                    <div className="mt-3 flex items-center gap-2 text-green-600 dark:text-green-400">
                      <CheckCircle2 className="h-4 w-4" />
                      <span className="text-sm">All field mappings look healthy.</span>
                    </div>
                  )}
                </div>

                {/* Mapping Issues */}
                {(analysisReport.orphanedColumns.length > 0 || analysisReport.problemMappings.length > 0) && (
                  <div className="p-4 border border-red-200 dark:border-red-800 rounded-lg bg-red-50 dark:bg-red-900/10">
                    <h3 className="text-sm font-medium text-red-900 dark:text-red-100 mb-3 flex items-center gap-2">
                      <XCircle className="h-4 w-4" />
                      Mapping Issues ({analysisReport.orphanedColumns.length + analysisReport.problemMappings.length})
                    </h3>

                    {analysisReport.orphanedColumns.length > 0 && (
                      <div className="mb-4">
                        <div className="text-xs font-medium text-red-700 dark:text-red-300 mb-2">
                          Orphaned columns -- no mapping in data dictionary, will never populate ({analysisReport.orphanedColumns.length}):
                        </div>
                        <div className="max-h-48 overflow-y-auto border border-red-200 dark:border-red-800 rounded bg-white dark:bg-slate-800/50">
                          <table className="w-full text-xs">
                            <thead className="bg-red-100 dark:bg-red-900/30 sticky top-0">
                              <tr>
                                <th className="text-left p-2 font-medium">Column Name</th>
                                <th className="text-left p-2 font-medium">Type</th>
                              </tr>
                            </thead>
                            <tbody>
                              {analysisReport.orphanedColumns.map((col, idx) => (
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

                    {analysisReport.problemMappings.length > 0 && (
                      <div>
                        <div className="text-xs font-medium text-red-700 dark:text-red-300 mb-2">
                          Has raw data but empty in database ({analysisReport.problemMappings.length}):
                        </div>
                        <div className="max-h-48 overflow-y-auto border border-red-200 dark:border-red-800 rounded bg-white dark:bg-slate-800/50">
                          <table className="w-full text-xs">
                            <thead className="bg-red-100 dark:bg-red-900/30 sticky top-0">
                              <tr>
                                <th className="text-left p-2 font-medium">Alias</th>
                                <th className="text-left p-2 font-medium">Column</th>
                                <th className="text-left p-2 font-medium">Raw Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {analysisReport.problemMappings.map((m, idx) => (
                                <tr key={idx} className="border-t border-red-100 dark:border-red-900/30">
                                  <td className="p-2 text-slate-700 dark:text-slate-300">{m.alias}</td>
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
                  </div>
                )}

                {/* Recommendations */}
                {(analysisReport.foundInSampleNotMapped.length > 0 || analysisReport.missingColumns.length > 0) && (
                  <div className="p-4 border border-amber-200 dark:border-amber-800 rounded-lg bg-amber-50 dark:bg-amber-900/10">
                    <h3 className="text-sm font-medium text-amber-900 dark:text-amber-100 mb-3 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      Recommendations
                    </h3>

                    {analysisReport.foundInSampleNotMapped.length > 0 && (
                      <div className="mb-4">
                        <div className="text-xs font-medium text-amber-700 dark:text-amber-300 mb-2">
                          Fields found in Encompass data but not being mapped ({analysisReport.foundInSampleNotMapped.length}):
                        </div>
                        <div className="max-h-48 overflow-y-auto space-y-1">
                          {analysisReport.foundInSampleNotMapped.slice(0, 20).map((field, idx) => (
                            <div key={idx} className="text-xs font-mono p-2 bg-white dark:bg-slate-800/50 rounded border border-amber-200 dark:border-amber-800">
                              <span className="text-slate-600 dark:text-slate-400">{field.alias}</span>
                              <span className="text-slate-400 dark:text-slate-500 mx-2">-&gt;</span>
                              <span className="text-slate-700 dark:text-slate-300">{field.columnName}</span>
                              <span className="text-slate-400 ml-2">(found as: {field.foundAs})</span>
                            </div>
                          ))}
                          {analysisReport.foundInSampleNotMapped.length > 20 && (
                            <div className="text-xs text-slate-500 dark:text-slate-400 italic">
                              ... and {analysisReport.foundInSampleNotMapped.length - 20} more
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {analysisReport.missingColumns.length > 0 && (
                      <div>
                        <div className="text-xs font-medium text-amber-700 dark:text-amber-300 mb-2">
                          Dictionary has mapping but no DB column ({analysisReport.missingColumns.length}):
                        </div>
                        <div className="max-h-48 overflow-y-auto border border-amber-200 dark:border-amber-800 rounded bg-white dark:bg-slate-800/50">
                          <table className="w-full text-xs">
                            <thead className="bg-amber-100 dark:bg-amber-900/30 sticky top-0">
                              <tr>
                                <th className="text-left p-2 font-medium">Alias</th>
                                <th className="text-left p-2 font-medium">Expected Column</th>
                              </tr>
                            </thead>
                            <tbody>
                              {analysisReport.missingColumns.map((col, idx) => (
                                <tr key={idx} className="border-t border-amber-100 dark:border-amber-900/30">
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
              </div>
            )}

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
          </div>
        )}
      </CardContent>
    </Card>
  );
}
