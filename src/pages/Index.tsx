import { Navigation } from '@/components/layout/Navigation';
import { Footer } from '@/components/layout/Footer';
import {
  Activity,
  ArrowRight,
  Award,
  Brain,
  Filter,
  Newspaper,
  Play,
  Shield,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import AetherFlowHero from '@/components/ui/aether-flow-hero';
import { useNavigate } from 'react-router-dom';

const capabilities = [
  { id: '1', title: 'Daily Briefings', icon: Brain, gradient: 'from-blue-500 to-sky-600', description: 'AI-curated insights with analytical reasoning - so you know the Why.' },
  { id: '2', title: 'Pipeline & Forecast', icon: Filter, gradient: 'from-blue-500 to-sky-600', description: "Real-time visibility into strategic flow and predictive risk exposure." },
  { id: '3', title: 'Performance at a Glance', icon: Award, gradient: 'from-amber-500 to-orange-600', description: 'Institutional rankings and operational health in a single view.' },
  { id: '4', title: 'Market Context', icon: Newspaper, gradient: 'from-slate-500 to-gray-600', description: 'Curated industry and competitive framing for decisive leadership.' },
  { id: '5', title: 'Configurable Views', icon: Activity, gradient: 'from-emerald-500 to-teal-600', description: 'Your strategic priorities, unified. Architected for executive speed.' },
  { id: '6', title: 'Risk & Readiness', icon: Shield, gradient: 'from-rose-500 to-pink-600', description: 'Early signals and institutional readiness—protecting your P-and-L.' },
];

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="relative min-h-screen bg-white dark:bg-slate-950 selection:bg-blue-500/20">
      <Navigation />
      
      {/* Hero */}
      <section className="relative">
        <AetherFlowHero />
      </section>

      {/* Strategic Strip */}
      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.6 }}
        className="py-5 px-6 bg-slate-50/50 dark:bg-slate-900/30"
      >
        <p className="text-center text-xs font-medium tracking-[0.18em] text-slate-500 dark:text-slate-500 uppercase">
          For C-suite and institutional lending leaders
        </p>
      </motion.section>

      <div className="h-px bg-gradient-to-r from-transparent via-slate-300 dark:via-slate-700 to-transparent" />

      {/* Capabilities Grid */}
      <section id="capabilities" className="px-6 py-32 sm:py-40 scroll-mt-24">
        <div className="mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7 }}
            className="mb-20"
          >
            <p className="text-xs font-medium tracking-[0.2em] text-slate-500 uppercase mb-4">
              Institutional Framework
            </p>
            <h2 className="text-3xl sm:text-4xl font-extralight text-slate-900 dark:text-white tracking-tight">
              One view. Your absolute priorities.
            </h2>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {capabilities.map((cap, idx) => (
              <motion.div
                key={cap.id}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: idx * 0.07 }}
                whileHover={{ y: -4 }}
                className="group bg-white dark:bg-slate-950 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 hover:shadow-xl transition-all duration-500"
              >
                <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${cap.gradient} flex items-center justify-center mb-6 shadow-lg`}>
                  <cap.icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">{cap.title}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed font-light">{cap.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-32 sm:py-40 bg-slate-50/50 dark:bg-slate-900/20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-4xl sm:text-5xl font-extralight text-slate-900 dark:text-white tracking-tight mb-6">
            See your business clearly.
          </h2>
          <p className="text-base sm:text-lg text-slate-600 dark:text-slate-400 font-light mb-10 max-w-md mx-auto">
            Strategic intelligence for leaders who value clarity over complexity.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button
              size="lg"
              onClick={() => navigate('/insights')}
              className="group bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-8 py-6 rounded-xl shadow-xl transition-all duration-300"
            >
              Request Access
              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
            <Button
              variant="ghost"
              size="lg"
              onClick={() => window.dispatchEvent(new CustomEvent('start-cohi-demo'))}
              className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white px-8 py-6 rounded-xl transition-all duration-300"
            >
              <Play className="mr-2 h-4 w-4" />
              Watch Cohi Demo
            </Button>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default Index;
