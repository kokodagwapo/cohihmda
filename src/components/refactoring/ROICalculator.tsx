import { useState } from 'react';
import { motion } from 'framer-motion';
import { Slider } from '@/components/ui/slider';
import { DollarSign, Clock, Users, TrendingUp } from 'lucide-react';

export function ROICalculator() {
  const [teamSize, setTeamSize] = useState(5);
  const [hourlyRate, setHourlyRate] = useState(75);

  // Calculate time savings based on refactoring impact
  const weeklyHoursSaved = teamSize * 8; // Each developer saves ~8 hours/week
  const annualHoursSaved = weeklyHoursSaved * 50; // 50 working weeks
  const annualSavings = annualHoursSaved * hourlyRate;

  // Development velocity improvements
  const bugFixTimeBefore = 4; // hours
  const bugFixTimeAfter = 0.5; // hours
  const onboardingTimeBefore = 12; // weeks
  const onboardingTimeAfter = 2; // weeks

  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="text-center mb-8">
        <h3 className="text-3xl font-bold text-slate-900 mb-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          ROI Calculator
        </h3>
        <p className="text-slate-600">See how code quality impacts your bottom line</p>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        {/* Left Side - Inputs */}
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="bg-white border-2 border-slate-200 rounded-2xl p-8 shadow-lg"
        >
          <h4 className="text-lg font-semibold text-slate-900 mb-6 flex items-center gap-2">
            <Users className="w-5 h-5 text-violet-600" />
            Your Team Parameters
          </h4>

          <div className="space-y-6">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-2 block">
                Team Size: <span className="text-violet-600 font-bold">{teamSize}</span> developers
              </label>
              <Slider
                value={[teamSize]}
                onValueChange={(value) => setTeamSize(value[0])}
                min={1}
                max={20}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-slate-500 mt-1">
                <span>1</span>
                <span>20</span>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700 mb-2 block">
                Average Hourly Rate: <span className="text-violet-600 font-bold">${hourlyRate}</span>
              </label>
              <Slider
                value={[hourlyRate]}
                onValueChange={(value) => setHourlyRate(value[0])}
                min={50}
                max={200}
                step={5}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-slate-500 mt-1">
                <span>$50</span>
                <span>$200</span>
              </div>
            </div>
          </div>

          <div className="mt-8 p-4 bg-violet-50 border border-violet-200 rounded-lg">
            <div className="text-xs text-violet-600 font-semibold uppercase tracking-wider mb-1">
              Calculation Basis
            </div>
            <div className="text-sm text-slate-600">
              Based on industry averages: 8 hours saved per developer per week through improved code maintainability
            </div>
          </div>
        </motion.div>

        {/* Right Side - Results */}
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="space-y-4"
        >
          {/* Annual Savings - Hero Metric */}
          <div className="bg-gradient-to-br from-violet-500 to-blue-600 rounded-2xl p-8 shadow-xl text-white">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="w-6 h-6" />
              <span className="text-sm font-semibold uppercase tracking-wider opacity-90">
                Annual Savings
              </span>
            </div>
            <div className="text-5xl font-bold mb-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
              ${annualSavings.toLocaleString()}
            </div>
            <div className="text-sm opacity-90">
              {annualHoursSaved.toLocaleString()} hours saved annually
            </div>
          </div>

          {/* Time Improvements */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white border-2 border-green-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-green-600" />
                <span className="text-xs font-semibold text-green-900 uppercase">Bug Fix Time</span>
              </div>
              <div className="text-2xl font-bold text-green-600 mb-1">
                {bugFixTimeAfter}h
              </div>
              <div className="text-xs text-slate-500 line-through">
                was {bugFixTimeBefore}h
              </div>
              <div className="mt-2 text-xs font-semibold text-green-600">
                87.5% faster
              </div>
            </div>

            <div className="bg-white border-2 border-blue-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-semibold text-blue-900 uppercase">Onboarding</span>
              </div>
              <div className="text-2xl font-bold text-blue-600 mb-1">
                {onboardingTimeAfter}w
              </div>
              <div className="text-xs text-slate-500 line-through">
                was {onboardingTimeBefore}w
              </div>
              <div className="mt-2 text-xs font-semibold text-blue-600">
                83% faster
              </div>
            </div>
          </div>

          {/* Velocity Improvement */}
          <div className="bg-gradient-to-r from-cyan-50 to-blue-50 border-2 border-cyan-200 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-5 h-5 text-cyan-600" />
              <span className="text-sm font-semibold text-cyan-900 uppercase tracking-wider">
                Development Velocity
              </span>
            </div>
            <div className="text-3xl font-bold text-cyan-600 mb-1">
              +47%
            </div>
            <div className="text-sm text-slate-600">
              Faster feature delivery with clean, modular code
            </div>
          </div>
        </motion.div>
      </div>

      {/* Bottom Stats */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="mt-8 bg-slate-50 border border-slate-200 rounded-2xl p-6"
      >
        <div className="grid md:grid-cols-3 gap-6">
          <div className="text-center">
            <div className="text-3xl font-bold text-slate-900 mb-1">
              {(weeklyHoursSaved * 4).toLocaleString()}
            </div>
            <div className="text-sm text-slate-600">Hours saved monthly</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-slate-900 mb-1">
              ${(annualSavings / 12).toLocaleString()}
            </div>
            <div className="text-sm text-slate-600">Monthly cost reduction</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-slate-900 mb-1">
              {teamSize * 2}
            </div>
            <div className="text-sm text-slate-600">Features delivered per quarter</div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

