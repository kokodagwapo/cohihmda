import { useEffect, useRef, useState } from 'react';
import CountUp from 'react-countup';
import { motion, useInView } from 'framer-motion';
import { AlertTriangle, DollarSign, Clock, Zap, Shield } from 'lucide-react';

export function TechnicalDebtSavings() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });
  const [hasAnimated, setHasAnimated] = useState(false);

  useEffect(() => {
    if (isInView && !hasAnimated) {
      setHasAnimated(true);
    }
  }, [isInView, hasAnimated]);

  const estimatedDebtCost = 500000;
  const weeksToPayoff = 18;
  const actualWeeks = 6;
  const velocityIncrease = 47;

  return (
    <div ref={ref} className="w-full max-w-6xl mx-auto">
      <div className="text-center mb-8">
        <h3 className="text-3xl font-bold text-slate-900 mb-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          Technical Debt Avoided
        </h3>
        <p className="text-slate-600">The hidden cost of bad code—and how we prevented it</p>
      </div>

      {/* Main Hero Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="relative overflow-hidden bg-gradient-to-br from-red-600 via-orange-600 to-yellow-600 rounded-3xl p-12 shadow-2xl mb-8"
      >
        {/* Background pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
            backgroundSize: '40px 40px'
          }} />
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-6">
            <AlertTriangle className="w-8 h-8 text-white" />
            <h4 className="text-2xl font-bold text-white">
              Estimated Technical Debt Prevented
            </h4>
          </div>

          <div className="text-7xl font-bold text-white mb-4" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            {hasAnimated ? (
              <>
                $<CountUp start={0} end={estimatedDebtCost} duration={2.5} separator="," />
              </>
            ) : (
              '$0'
            )}
          </div>

          <p className="text-xl text-white/90 mb-8">
            Without this refactoring, technical debt would have grown to crisis levels within {weeksToPayoff} months
          </p>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20">
              <Clock className="w-6 h-6 text-white mb-2" />
              <div className="text-2xl font-bold text-white mb-1">
                {hasAnimated ? <CountUp start={0} end={weeksToPayoff} duration={2} /> : 0} months
              </div>
              <div className="text-sm text-white/80">Until forced rewrite</div>
            </div>

            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20">
              <Zap className="w-6 h-6 text-white mb-2" />
              <div className="text-2xl font-bold text-white mb-1">
                {hasAnimated ? <CountUp start={0} end={actualWeeks} duration={2} /> : 0} weeks
              </div>
              <div className="text-sm text-white/80">Actual time taken</div>
            </div>

            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20">
              <Shield className="w-6 h-6 text-white mb-2" />
              <div className="text-2xl font-bold text-white mb-1">
                {hasAnimated ? <CountUp start={0} end={velocityIncrease} duration={2} suffix="%" /> : '0%'}
              </div>
              <div className="text-sm text-white/80">Velocity increase</div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Breakdown Grid */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Cost Breakdown */}
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="bg-white border-2 border-slate-200 rounded-2xl p-6 shadow-lg"
        >
          <h4 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-red-600" />
            Cost Breakdown
          </h4>

          <div className="space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-200">
              <span className="text-slate-600">Developer productivity loss</span>
              <span className="font-bold text-slate-900">$250,000</span>
            </div>
            <div className="flex justify-between items-center pb-3 border-b border-slate-200">
              <span className="text-slate-600">Bug fixes & maintenance</span>
              <span className="font-bold text-slate-900">$150,000</span>
            </div>
            <div className="flex justify-between items-center pb-3 border-b border-slate-200">
              <span className="text-slate-600">Delayed feature delivery</span>
              <span className="font-bold text-slate-900">$75,000</span>
            </div>
            <div className="flex justify-between items-center pb-3 border-b border-slate-200">
              <span className="text-slate-600">Customer churn risk</span>
              <span className="font-bold text-slate-900">$25,000</span>
            </div>
            <div className="flex justify-between items-center pt-2">
              <span className="text-lg font-bold text-slate-900">Total Debt Avoided</span>
              <span className="text-2xl font-bold text-red-600">$500,000</span>
            </div>
          </div>
        </motion.div>

        {/* Alternative Scenarios */}
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="bg-white border-2 border-slate-200 rounded-2xl p-6 shadow-lg"
        >
          <h4 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-600" />
            Without Refactoring
          </h4>

          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="font-semibold text-red-900 mb-2">😰 Crisis Mode</div>
              <div className="text-sm text-red-700">
                • Features take 3x longer to develop
                <br />• Bug count increases exponentially
                <br />• Developer turnover increases
                <br />• Customers complain about instability
              </div>
            </div>

            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <div className="font-semibold text-orange-900 mb-2">🔧 Forced Rewrite</div>
              <div className="text-sm text-orange-700">
                • 6-12 months to rebuild from scratch
                <br />• $500K+ in development costs
                <br />• High risk of introducing new bugs
                <br />• Features halted during rewrite
              </div>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="font-semibold text-green-900 mb-2">✅ Our Approach</div>
              <div className="text-sm text-green-700">
                • Incremental improvement over 6 weeks
                <br />• Zero downtime, zero breaking changes
                <br />• Continuous feature delivery
                <br />• Future-proof architecture
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Bottom Message */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.4 }}
        className="mt-8 bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200 rounded-2xl p-8 text-center"
      >
        <div className="text-3xl mb-4">💰</div>
        <h4 className="text-2xl font-bold text-green-900 mb-3">
          The ROI of Code Quality
        </h4>
        <p className="text-lg text-slate-700 max-w-3xl mx-auto">
          Investing 6 weeks in refactoring prevented 18 months of technical debt accumulation. 
          This isn't just about cleaner code—it's about <strong>sustainable business growth</strong>.
        </p>
      </motion.div>
    </div>
  );
}

