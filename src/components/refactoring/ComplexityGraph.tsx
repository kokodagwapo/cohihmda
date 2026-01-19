import { motion } from 'framer-motion';
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend, ResponsiveContainer } from 'recharts';
import { Activity, TrendingDown } from 'lucide-react';

const data = [
  {
    metric: 'Readability',
    before: 2.1,
    after: 9.2,
    fullMark: 10,
  },
  {
    metric: 'Maintainability',
    before: 1.8,
    after: 9.5,
    fullMark: 10,
  },
  {
    metric: 'Testability',
    before: 3.2,
    after: 8.7,
    fullMark: 10,
  },
  {
    metric: 'Modularity',
    before: 1.5,
    after: 9.8,
    fullMark: 10,
  },
  {
    metric: 'Performance',
    before: 4.5,
    after: 9.1,
    fullMark: 10,
  },
];

export function ComplexityGraph() {
  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="text-center mb-8">
        <h3 className="text-3xl font-bold text-slate-900 mb-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          Code Quality Metrics
        </h3>
        <p className="text-slate-600">Quantified improvement across key dimensions</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        {/* Left Side - Radar Chart */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="bg-white border-2 border-slate-200 rounded-2xl p-8 shadow-lg"
        >
          <ResponsiveContainer width="100%" height={400}>
            <RadarChart data={data}>
              <PolarGrid stroke="#e2e8f0" />
              <PolarAngleAxis 
                dataKey="metric" 
                tick={{ fill: '#475569', fontSize: 12, fontWeight: 600 }}
              />
              <PolarRadiusAxis 
                angle={90} 
                domain={[0, 10]} 
                tick={{ fill: '#94a3b8', fontSize: 10 }}
              />
              <Radar
                name="Before Refactoring"
                dataKey="before"
                stroke="#ef4444"
                fill="#ef4444"
                fillOpacity={0.3}
                strokeWidth={2}
              />
              <Radar
                name="After Refactoring"
                dataKey="after"
                stroke="#10b981"
                fill="#10b981"
                fillOpacity={0.3}
                strokeWidth={2}
              />
              <Legend 
                wrapperStyle={{ paddingTop: '20px' }}
                iconType="circle"
              />
            </RadarChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Right Side - Detailed Metrics */}
        <div className="space-y-4">
          {data.map((item, index) => (
            <motion.div
              key={item.metric}
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: index * 0.1 }}
              className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-slate-900">{item.metric}</h4>
                <div className="flex items-center gap-1 text-sm text-green-600 font-semibold">
                  <TrendingDown className="w-4 h-4" />
                  +{((item.after - item.before) / item.before * 100).toFixed(0)}%
                </div>
              </div>
              
              <div className="space-y-2">
                {/* Before Bar */}
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
                    <span>Before</span>
                    <span className="font-semibold">{item.before}/10</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      whileInView={{ width: `${(item.before / 10) * 100}%` }}
                      viewport={{ once: true }}
                      transition={{ duration: 1, delay: index * 0.1 + 0.3 }}
                      className="h-full bg-gradient-to-r from-red-500 to-orange-500 rounded-full"
                    />
                  </div>
                </div>

                {/* After Bar */}
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
                    <span>After</span>
                    <span className="font-semibold text-green-600">{item.after}/10</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      whileInView={{ width: `${(item.after / 10) * 100}%` }}
                      viewport={{ once: true }}
                      transition={{ duration: 1, delay: index * 0.1 + 0.5 }}
                      className="h-full bg-gradient-to-r from-green-500 to-emerald-500 rounded-full"
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Bottom Stats - Complexity Reduction */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.3 }}
        className="mt-8 grid md:grid-cols-3 gap-6"
      >
        <div className="bg-gradient-to-br from-violet-50 to-blue-50 border-2 border-violet-200 rounded-xl p-6 text-center">
          <Activity className="w-8 h-8 text-violet-600 mx-auto mb-3" />
          <div className="text-3xl font-bold text-violet-600 mb-1">847 → 23</div>
          <div className="text-sm text-slate-600 font-medium">Cyclomatic Complexity</div>
          <div className="text-xs text-violet-600 font-semibold mt-1">97% reduction</div>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200 rounded-xl p-6 text-center">
          <div className="text-2xl mb-3">🎯</div>
          <div className="text-3xl font-bold text-green-600 mb-1">1 → 38</div>
          <div className="text-sm text-slate-600 font-medium">Modular Components</div>
          <div className="text-xs text-green-600 font-semibold mt-1">Clear separation</div>
        </div>

        <div className="bg-gradient-to-br from-cyan-50 to-blue-50 border-2 border-cyan-200 rounded-xl p-6 text-center">
          <div className="text-2xl mb-3">⚡</div>
          <div className="text-3xl font-bold text-cyan-600 mb-1">10x</div>
          <div className="text-sm text-slate-600 font-medium">Faster Testing</div>
          <div className="text-xs text-cyan-600 font-semibold mt-1">Unit testable modules</div>
        </div>
      </motion.div>
    </div>
  );
}

