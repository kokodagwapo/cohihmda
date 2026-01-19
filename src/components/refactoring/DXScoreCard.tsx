import { motion } from 'framer-motion';
import { Star, TrendingUp } from 'lucide-react';

interface Metric {
  name: string;
  before: number;
  after: number;
  outOf: number;
}

const metrics: Metric[] = [
  { name: 'Code Readability', before: 2.1, after: 9.2, outOf: 10 },
  { name: 'Maintainability Index', before: 1.8, after: 9.5, outOf: 10 },
  { name: 'Test Coverage', before: 3.2, after: 8.7, outOf: 10 },
  { name: 'Build Performance', before: 4.5, after: 9.1, outOf: 10 },
  { name: 'Documentation Quality', before: 2.8, after: 8.9, outOf: 10 },
  { name: 'Developer Velocity', before: 3.5, after: 9.3, outOf: 10 },
];

export function DXScoreCard() {
  const averageBefore = metrics.reduce((sum, m) => sum + m.before, 0) / metrics.length;
  const averageAfter = metrics.reduce((sum, m) => sum + m.after, 0) / metrics.length;
  const improvement = ((averageAfter - averageBefore) / averageBefore * 100).toFixed(0);

  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="text-center mb-8">
        <h3 className="text-3xl font-bold text-slate-900 mb-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          Developer Experience Scorecard
        </h3>
        <p className="text-slate-600">Measuring what matters: the developer experience</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-8 mb-8">
        {/* Overall Score - Before */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="bg-gradient-to-br from-red-500 to-orange-500 rounded-2xl p-8 text-white shadow-xl"
        >
          <div className="text-sm font-semibold uppercase tracking-wider opacity-90 mb-3">
            Before Refactoring
          </div>
          <div className="text-6xl font-bold mb-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            {averageBefore.toFixed(1)}
          </div>
          <div className="text-sm opacity-90">out of 10</div>
          <div className="mt-4 flex gap-1">
            {[...Array(10)].map((_, i) => (
              <Star
                key={i}
                className={`w-4 h-4 ${i < Math.floor(averageBefore) ? 'fill-white text-white' : 'text-white/30'}`}
              />
            ))}
          </div>
        </motion.div>

        {/* Improvement Arrow */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="flex flex-col items-center justify-center bg-white border-2 border-slate-200 rounded-2xl p-8"
        >
          <TrendingUp className="w-16 h-16 text-green-500 mb-4" />
          <div className="text-5xl font-bold text-green-600 mb-2">
            +{improvement}%
          </div>
          <div className="text-sm text-slate-600 font-medium">
            Overall Improvement
          </div>
        </motion.div>

        {/* Overall Score - After */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="bg-gradient-to-br from-green-500 to-emerald-500 rounded-2xl p-8 text-white shadow-xl"
        >
          <div className="text-sm font-semibold uppercase tracking-wider opacity-90 mb-3">
            After Refactoring
          </div>
          <div className="text-6xl font-bold mb-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            {averageAfter.toFixed(1)}
          </div>
          <div className="text-sm opacity-90">out of 10</div>
          <div className="mt-4 flex gap-1">
            {[...Array(10)].map((_, i) => (
              <Star
                key={i}
                className={`w-4 h-4 ${i < Math.floor(averageAfter) ? 'fill-white text-white' : 'text-white/30'}`}
              />
            ))}
          </div>
        </motion.div>
      </div>

      {/* Individual Metrics */}
      <div className="space-y-4">
        {metrics.map((metric, index) => (
          <motion.div
            key={metric.name}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.5, delay: index * 0.05 }}
            className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-lg font-semibold text-slate-900">{metric.name}</h4>
              <div className="text-sm font-semibold text-green-600">
                +{(((metric.after - metric.before) / metric.before) * 100).toFixed(0)}%
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Before */}
              <div>
                <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
                  <span className="font-medium">Before</span>
                  <span className="font-bold text-red-600">{metric.before}/{metric.outOf}</span>
                </div>
                <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    whileInView={{ width: `${(metric.before / metric.outOf) * 100}%` }}
                    viewport={{ once: true }}
                    transition={{ duration: 1, delay: index * 0.05 + 0.2 }}
                    className="h-full bg-gradient-to-r from-red-500 to-orange-500 rounded-full"
                  />
                </div>
              </div>

              {/* After */}
              <div>
                <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
                  <span className="font-medium">After</span>
                  <span className="font-bold text-green-600">{metric.after}/{metric.outOf}</span>
                </div>
                <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    whileInView={{ width: `${(metric.after / metric.outOf) * 100}%` }}
                    viewport={{ once: true }}
                    transition={{ duration: 1, delay: index * 0.05 + 0.4 }}
                    className="h-full bg-gradient-to-r from-green-500 to-emerald-500 rounded-full"
                  />
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Bottom Quote */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.5 }}
        className="mt-8 bg-gradient-to-r from-violet-50 to-blue-50 border-2 border-violet-200 rounded-2xl p-8 text-center"
      >
        <div className="text-4xl mb-4">💎</div>
        <p className="text-lg text-slate-700 font-medium italic mb-2">
          "The best code is code that's easy to delete, easy to change, and easy to understand."
        </p>
        <p className="text-sm text-violet-600 font-semibold">
          This refactoring achieved all three.
        </p>
      </motion.div>
    </div>
  );
}

