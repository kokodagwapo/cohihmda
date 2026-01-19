import { motion } from 'framer-motion';
import { CheckCircle2, Calendar, TrendingDown } from 'lucide-react';

interface Milestone {
  week: number;
  title: string;
  achievement: string;
  impact: string;
  linesRemoved: number;
}

const milestones: Milestone[] = [
  {
    week: 1,
    title: 'Modal Extraction',
    achievement: 'Extracted 11 modal components',
    impact: 'Removed 3,388 lines',
    linesRemoved: 3388,
  },
  {
    week: 2,
    title: 'View Components',
    achievement: 'Created dedicated view modules',
    impact: 'Removed 5,200 lines',
    linesRemoved: 5200,
  },
  {
    week: 3,
    title: 'Dead Code Cleanup',
    achievement: 'Removed unused features & code',
    impact: 'Removed 1,160 lines',
    linesRemoved: 1160,
  },
  {
    week: 4,
    title: 'Admin Panel Refactor',
    achievement: 'Modularized admin sections',
    impact: 'Removed 6,373 lines',
    linesRemoved: 6373,
  },
  {
    week: 5,
    title: 'Hook Extraction',
    achievement: 'Created 16 custom hooks',
    impact: 'Better separation of concerns',
    linesRemoved: 0,
  },
  {
    week: 6,
    title: 'Final Optimization',
    achievement: 'Consolidated & optimized',
    impact: 'Zero breaking changes',
    linesRemoved: 0,
  },
];

export function RefactoringTimeline() {
  const totalLinesRemoved = milestones.reduce((sum, m) => sum + m.linesRemoved, 0);

  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="text-center mb-12">
        <h3 className="text-3xl font-bold text-slate-900 mb-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          6-Week Transformation Journey
        </h3>
        <p className="text-slate-600">Systematic, incremental refactoring with zero downtime</p>
      </div>

      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gradient-to-b from-violet-500 via-blue-500 to-green-500" />

        {/* Timeline items */}
        <div className="space-y-8">
          {milestones.map((milestone, index) => (
            <motion.div
              key={milestone.week}
              initial={{ opacity: 0, x: -50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.6, delay: index * 0.1 }}
              className="relative pl-20"
            >
              {/* Timeline dot */}
              <motion.div
                initial={{ scale: 0 }}
                whileInView={{ scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: index * 0.1 + 0.2 }}
                className="absolute left-0 w-16 h-16 flex items-center justify-center"
              >
                <div className="relative">
                  <div className={`w-16 h-16 rounded-full bg-gradient-to-br ${
                    index < 2 ? 'from-violet-500 to-blue-500' :
                    index < 4 ? 'from-blue-500 to-cyan-500' :
                    'from-cyan-500 to-green-500'
                  } flex items-center justify-center shadow-lg`}>
                    <div className="text-white text-sm font-bold">
                      W{milestone.week}
                    </div>
                  </div>
                  <motion.div
                    initial={{ scale: 0 }}
                    whileInView={{ scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.3, delay: index * 0.1 + 0.4 }}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center"
                  >
                    <CheckCircle2 className="w-3 h-3 text-white" />
                  </motion.div>
                </div>
              </motion.div>

              {/* Content card */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 + 0.3 }}
                className="bg-white border-2 border-slate-200 rounded-xl p-6 shadow-md hover:shadow-xl transition-shadow group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h4 className="text-lg font-bold text-slate-900 mb-1">
                      {milestone.title}
                    </h4>
                    <p className="text-sm text-slate-600">
                      {milestone.achievement}
                    </p>
                  </div>
                  {milestone.linesRemoved > 0 && (
                    <div className="flex items-center gap-1 px-3 py-1 bg-green-50 border border-green-200 rounded-full">
                      <TrendingDown className="w-4 h-4 text-green-600" />
                      <span className="text-sm font-semibold text-green-600">
                        {milestone.linesRemoved.toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 text-sm">
                  <div className={`px-3 py-1 rounded-full font-medium ${
                    milestone.linesRemoved > 0
                      ? 'bg-violet-50 text-violet-700 border border-violet-200'
                      : 'bg-blue-50 text-blue-700 border border-blue-200'
                  }`}>
                    {milestone.impact}
                  </div>
                </div>

                {/* Progress bar */}
                {milestone.linesRemoved > 0 && (
                  <div className="mt-4">
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        whileInView={{ width: `${(milestone.linesRemoved / 7000) * 100}%` }}
                        viewport={{ once: true }}
                        transition={{ duration: 1, delay: index * 0.1 + 0.5 }}
                        className="h-full bg-gradient-to-r from-violet-500 to-blue-500 rounded-full"
                      />
                    </div>
                  </div>
                )}
              </motion.div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Summary Footer */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.8 }}
        className="mt-12 bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200 rounded-2xl p-8"
      >
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center shadow-lg">
              <CheckCircle2 className="w-8 h-8 text-white" />
            </div>
            <div>
              <h4 className="text-xl font-bold text-green-900 mb-1">
                Mission Accomplished
              </h4>
              <p className="text-sm text-green-700">
                6 weeks • Zero downtime • All tests passing
              </p>
            </div>
          </div>

          <div className="text-center md:text-right">
            <div className="text-4xl font-bold text-green-600 mb-1">
              {totalLinesRemoved.toLocaleString()}
            </div>
            <div className="text-sm text-green-700 font-medium">
              Total lines removed
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

