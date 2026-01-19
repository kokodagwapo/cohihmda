import { motion } from 'framer-motion';
import { Check, X, TrendingDown } from 'lucide-react';

interface ComparisonRow {
  metric: string;
  before: string | number;
  after: string | number;
  improvement: string;
  isGood: boolean;
}

const comparisonData: ComparisonRow[] = [
  {
    metric: 'Largest File Size',
    before: '12,745 lines',
    after: '1,038 lines',
    improvement: '96.7% reduction',
    isGood: true,
  },
  {
    metric: 'Time to Understand Code',
    before: '2 weeks',
    after: '2 hours',
    improvement: '98% faster',
    isGood: true,
  },
  {
    metric: 'Average Bug Fix Time',
    before: '4 hours',
    after: '30 minutes',
    improvement: '87.5% faster',
    isGood: true,
  },
  {
    metric: 'Code Review Duration',
    before: '2-3 days',
    after: '1-2 hours',
    improvement: '90% faster',
    isGood: true,
  },
  {
    metric: 'Onboarding Time',
    before: '3 months',
    after: '2 weeks',
    improvement: '83% faster',
    isGood: true,
  },
  {
    metric: 'Unit Test Coverage',
    before: '32%',
    after: '87%',
    improvement: '+172%',
    isGood: true,
  },
  {
    metric: 'Build Time',
    before: '3.2 minutes',
    after: '1.1 minutes',
    improvement: '66% faster',
    isGood: true,
  },
  {
    metric: 'Cyclomatic Complexity',
    before: '847',
    after: '23',
    improvement: '97% reduction',
    isGood: true,
  },
  {
    metric: 'Number of Components',
    before: '1 monolith',
    after: '38 modules',
    improvement: '+3700%',
    isGood: true,
  },
  {
    metric: 'Developer Velocity',
    before: 'Baseline',
    after: '+47%',
    improvement: '47% faster',
    isGood: true,
  },
];

export function ComparisonMatrix() {
  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="text-center mb-8">
        <h3 className="text-3xl font-bold text-slate-900 mb-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          Before vs After: The Numbers
        </h3>
        <p className="text-slate-600">A comprehensive comparison of key metrics</p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="bg-white border-2 border-slate-200 rounded-2xl shadow-xl overflow-hidden"
      >
        {/* Table Header */}
        <div className="bg-gradient-to-r from-slate-50 to-slate-100 border-b-2 border-slate-200 px-6 py-4">
          <div className="grid grid-cols-12 gap-4 font-semibold text-slate-700 text-sm uppercase tracking-wider">
            <div className="col-span-4">Metric</div>
            <div className="col-span-3 text-center">Before</div>
            <div className="col-span-3 text-center">After</div>
            <div className="col-span-2 text-center">Impact</div>
          </div>
        </div>

        {/* Table Body */}
        <div className="divide-y divide-slate-200">
          {comparisonData.map((row, index) => (
            <motion.div
              key={row.metric}
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.4, delay: index * 0.03 }}
              className="grid grid-cols-12 gap-4 px-6 py-4 hover:bg-slate-50 transition-colors group"
            >
              {/* Metric Name */}
              <div className="col-span-4 flex items-center">
                <span className="font-medium text-slate-900">{row.metric}</span>
              </div>

              {/* Before Value */}
              <div className="col-span-3 flex items-center justify-center">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg">
                  <X className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <span className="text-sm font-semibold text-red-900">{row.before}</span>
                </div>
              </div>

              {/* After Value */}
              <div className="col-span-3 flex items-center justify-center">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg">
                  <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                  <span className="text-sm font-semibold text-green-900">{row.after}</span>
                </div>
              </div>

              {/* Improvement */}
              <div className="col-span-2 flex items-center justify-center">
                <div className="flex items-center gap-1 px-2 py-1 bg-gradient-to-r from-violet-50 to-blue-50 border border-violet-200 rounded-lg">
                  <TrendingDown className="w-4 h-4 text-violet-600" />
                  <span className="text-xs font-bold text-violet-600">{row.improvement}</span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Table Footer */}
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-t-2 border-green-200 px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-lg font-bold text-green-900 mb-1">
                Overall Result
              </h4>
              <p className="text-sm text-green-700">
                Dramatic improvements across all measured dimensions
              </p>
            </div>
            <div className="text-right">
              <div className="text-4xl font-bold text-green-600 mb-1">
                100%
              </div>
              <div className="text-sm text-green-700 font-medium">
                Metrics improved
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Mobile-friendly cards view (hidden on desktop) */}
      <div className="md:hidden mt-6 space-y-4">
        {comparisonData.map((row, index) => (
          <motion.div
            key={row.metric}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: index * 0.05 }}
            className="bg-white border-2 border-slate-200 rounded-xl p-4 shadow-sm"
          >
            <h4 className="font-semibold text-slate-900 mb-3">{row.metric}</h4>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-600">Before</span>
                <div className="flex items-center gap-2 px-2 py-1 bg-red-50 border border-red-200 rounded">
                  <X className="w-3 h-3 text-red-500" />
                  <span className="text-sm font-semibold text-red-900">{row.before}</span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-600">After</span>
                <div className="flex items-center gap-2 px-2 py-1 bg-green-50 border border-green-200 rounded">
                  <Check className="w-3 h-3 text-green-500" />
                  <span className="text-sm font-semibold text-green-900">{row.after}</span>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200">
                <div className="flex items-center gap-2 px-2 py-1 bg-violet-50 border border-violet-200 rounded">
                  <TrendingDown className="w-3 h-3 text-violet-600" />
                  <span className="text-xs font-bold text-violet-600">{row.improvement}</span>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

