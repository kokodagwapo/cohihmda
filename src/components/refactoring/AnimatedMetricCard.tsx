import { useEffect, useRef, useState } from 'react';
import CountUp from 'react-countup';
import { motion, useInView } from 'framer-motion';
import { TrendingDown, TrendingUp, ArrowRight } from 'lucide-react';

interface AnimatedMetricCardProps {
  title: string;
  value: number;
  suffix?: string;
  prefix?: string;
  description?: string;
  trend?: 'up' | 'down';
  trendValue?: string;
  color?: string;
  delay?: number;
  decimals?: number;
}

export function AnimatedMetricCard({
  title,
  value,
  suffix = '',
  prefix = '',
  description,
  trend,
  trendValue,
  color = 'violet',
  delay = 0,
  decimals = 0,
}: AnimatedMetricCardProps) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });
  const [hasAnimated, setHasAnimated] = useState(false);

  useEffect(() => {
    if (isInView && !hasAnimated) {
      setHasAnimated(true);
    }
  }, [isInView, hasAnimated]);

  const colorClasses = {
    violet: {
      bg: 'from-violet-500/10 to-blue-500/10',
      border: 'border-violet-200',
      text: 'text-violet-600',
      glow: 'group-hover:shadow-violet-500/20',
    },
    blue: {
      bg: 'from-blue-500/10 to-cyan-500/10',
      border: 'border-blue-200',
      text: 'text-blue-600',
      glow: 'group-hover:shadow-blue-500/20',
    },
    green: {
      bg: 'from-green-500/10 to-emerald-500/10',
      border: 'border-green-200',
      text: 'text-green-600',
      glow: 'group-hover:shadow-green-500/20',
    },
    cyan: {
      bg: 'from-cyan-500/10 to-teal-500/10',
      border: 'border-cyan-200',
      text: 'text-cyan-600',
      glow: 'group-hover:shadow-cyan-500/20',
    },
  };

  const colors = colorClasses[color as keyof typeof colorClasses] || colorClasses.violet;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className="group relative"
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${colors.bg} rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
      <div className={`relative bg-white border ${colors.border} rounded-2xl p-6 shadow-sm hover:shadow-xl ${colors.glow} transition-all duration-300 transform hover:scale-[1.02]`}>
        <div className="flex flex-col space-y-3">
          <div className="flex items-start justify-between">
            <h4 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">
              {title}
            </h4>
            {trend && (
              <div className={`flex items-center gap-1 text-xs font-medium ${trend === 'down' ? 'text-green-600' : 'text-blue-600'}`}>
                {trend === 'down' ? <TrendingDown className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />}
                {trendValue}
              </div>
            )}
          </div>
          
          <div className={`text-4xl font-bold ${colors.text}`} style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            {hasAnimated ? (
              <>
                {prefix}
                <CountUp
                  start={0}
                  end={value}
                  duration={2}
                  decimals={decimals}
                  separator=","
                />
                {suffix}
              </>
            ) : (
              `${prefix}0${suffix}`
            )}
          </div>

          {description && (
            <p className="text-sm text-slate-500 flex items-center gap-1">
              <ArrowRight className="w-3 h-3" />
              {description}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

