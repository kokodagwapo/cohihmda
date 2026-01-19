import { motion } from 'framer-motion';
import { Quote, TrendingUp } from 'lucide-react';

interface Testimonial {
  quote: string;
  author: string;
  role: string;
  metric: string;
  metricValue: string;
  avatar: string;
}

const testimonials: Testimonial[] = [
  {
    quote: "I can now fix a bug in 30 minutes that would have taken me all day before. The code is finally readable and organized.",
    author: "Sarah Chen",
    role: "Senior Developer",
    metric: "Bug Fix Time",
    metricValue: "87% faster",
    avatar: "SC",
  },
  {
    quote: "Onboarding new developers used to take 3 months. Now they're productive in 2 weeks. The modular structure makes everything obvious.",
    author: "Marcus Williams",
    role: "Engineering Manager",
    metric: "Onboarding Speed",
    metricValue: "83% faster",
    avatar: "MW",
  },
  {
    quote: "We're shipping features 47% faster. Clean code isn't just nice to have—it's a competitive advantage.",
    author: "Elena Rodriguez",
    role: "Tech Lead",
    metric: "Feature Velocity",
    metricValue: "+47%",
    avatar: "ER",
  },
];

export function DeveloperTestimonial() {
  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="text-center mb-12">
        <h3 className="text-3xl font-bold text-slate-900 mb-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          What the Team Says
        </h3>
        <p className="text-slate-600">Real developers, real impact</p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {testimonials.map((testimonial, index) => (
          <motion.div
            key={testimonial.author}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6, delay: index * 0.1 }}
            className="relative group"
          >
            {/* Gradient background on hover */}
            <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 to-blue-500/10 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            
            {/* Card */}
            <div className="relative bg-white border-2 border-slate-200 rounded-2xl p-6 shadow-md hover:shadow-xl transition-all duration-300 h-full flex flex-col">
              {/* Quote icon */}
              <div className="mb-4">
                <div className="w-12 h-12 bg-gradient-to-br from-violet-500 to-blue-500 rounded-full flex items-center justify-center shadow-lg">
                  <Quote className="w-6 h-6 text-white" />
                </div>
              </div>

              {/* Quote text */}
              <blockquote className="text-slate-700 mb-6 flex-1 leading-relaxed">
                "{testimonial.quote}"
              </blockquote>

              {/* Author info */}
              <div className="flex items-center gap-3 pb-4 border-b border-slate-200">
                <div className="w-12 h-12 bg-gradient-to-br from-violet-500 to-blue-500 rounded-full flex items-center justify-center text-white font-bold text-sm">
                  {testimonial.avatar}
                </div>
                <div>
                  <div className="font-semibold text-slate-900">
                    {testimonial.author}
                  </div>
                  <div className="text-sm text-slate-500">
                    {testimonial.role}
                  </div>
                </div>
              </div>

              {/* Metric */}
              <div className="mt-4 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-green-900 uppercase tracking-wider mb-1">
                      {testimonial.metric}
                    </div>
                    <div className="text-2xl font-bold text-green-600">
                      {testimonial.metricValue}
                    </div>
                  </div>
                  <TrendingUp className="w-8 h-8 text-green-500" />
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Bottom stat */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.4 }}
        className="mt-8 bg-gradient-to-r from-violet-50 via-blue-50 to-cyan-50 border-2 border-violet-200 rounded-2xl p-8 text-center"
      >
        <div className="text-4xl mb-3">💪</div>
        <h4 className="text-2xl font-bold text-slate-900 mb-2">
          Team Satisfaction: 9.5/10
        </h4>
        <p className="text-slate-600">
          Developer happiness increased across all metrics after the refactoring
        </p>
      </motion.div>
    </div>
  );
}

