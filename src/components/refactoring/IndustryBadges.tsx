import { motion } from 'framer-motion';
import { Shield, Award, CheckCircle2, Star } from 'lucide-react';

interface Badge {
  title: string;
  description: string;
  icon: typeof Shield;
  color: string;
  bgColor: string;
  borderColor: string;
}

const badges: Badge[] = [
  {
    title: 'Code Quality Excellence',
    description: 'Exceeds industry standards for maintainability',
    icon: Star,
    color: 'text-yellow-600',
    bgColor: 'from-yellow-50 to-orange-50',
    borderColor: 'border-yellow-200',
  },
  {
    title: 'Best Practice Architecture',
    description: 'Follows microservices & modular patterns',
    icon: Shield,
    color: 'text-blue-600',
    bgColor: 'from-blue-50 to-cyan-50',
    borderColor: 'border-blue-200',
  },
  {
    title: 'Clean Code Certified',
    description: 'Adheres to SOLID principles',
    icon: CheckCircle2,
    color: 'text-green-600',
    bgColor: 'from-green-50 to-emerald-50',
    borderColor: 'border-green-200',
  },
  {
    title: 'Production Ready',
    description: 'Battle-tested with zero downtime',
    icon: Award,
    color: 'text-violet-600',
    bgColor: 'from-violet-50 to-purple-50',
    borderColor: 'border-violet-200',
  },
];

export function IndustryBadges() {
  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="text-center mb-8">
        <h3 className="text-3xl font-bold text-slate-900 mb-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          Industry Recognition
        </h3>
        <p className="text-slate-600">Code quality that meets professional standards</p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {badges.map((badge, index) => {
          const Icon = badge.icon;
          return (
            <motion.div
              key={badge.title}
              initial={{ opacity: 0, y: 30, rotate: -5 }}
              whileInView={{ opacity: 1, y: 0, rotate: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              whileHover={{ scale: 1.05, rotate: 2 }}
              className="group relative"
            >
              {/* Glow effect on hover */}
              <div className={`absolute inset-0 bg-gradient-to-br ${badge.bgColor} rounded-2xl opacity-0 group-hover:opacity-50 blur-xl transition-opacity duration-300`} />
              
              {/* Badge card */}
              <div className={`relative bg-gradient-to-br ${badge.bgColor} border-2 ${badge.borderColor} rounded-2xl p-6 shadow-lg hover:shadow-xl transition-all duration-300 h-full flex flex-col items-center text-center`}>
                {/* Icon */}
                <div className={`w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-md mb-4 group-hover:scale-110 transition-transform duration-300`}>
                  <Icon className={`w-8 h-8 ${badge.color}`} />
                </div>

                {/* Title */}
                <h4 className="text-lg font-bold text-slate-900 mb-2">
                  {badge.title}
                </h4>

                {/* Description */}
                <p className="text-sm text-slate-600 leading-relaxed">
                  {badge.description}
                </p>

                {/* Verified badge */}
                <div className="mt-4 pt-4 border-t border-slate-200 w-full">
                  <div className="flex items-center justify-center gap-1 text-xs font-semibold text-slate-700">
                    <CheckCircle2 className="w-3 h-3 text-green-500" />
                    Verified
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Standards Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.4 }}
        className="bg-white border-2 border-slate-200 rounded-2xl p-8 shadow-lg"
      >
        <div className="text-center mb-8">
          <h4 className="text-2xl font-bold text-slate-900 mb-2">
            Meets Industry Standards
          </h4>
          <p className="text-slate-600">
            Our refactoring aligns with best practices from leading tech companies
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center hover:shadow-md transition-shadow">
            <div className="text-3xl mb-3">🏆</div>
            <h5 className="font-bold text-slate-900 mb-2">Google Standards</h5>
            <p className="text-sm text-slate-600">
              Follows Google's Code Review guidelines for modularity and testing
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center hover:shadow-md transition-shadow">
            <div className="text-3xl mb-3">☁️</div>
            <h5 className="font-bold text-slate-900 mb-2">AWS Well-Architected</h5>
            <p className="text-sm text-slate-600">
              Implements operational excellence and performance efficiency pillars
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center hover:shadow-md transition-shadow">
            <div className="text-3xl mb-3">📚</div>
            <h5 className="font-bold text-slate-900 mb-2">Clean Code Principles</h5>
            <p className="text-sm text-slate-600">
              Adheres to Robert C. Martin's clean code and SOLID principles
            </p>
          </div>
        </div>
      </motion.div>

      {/* Bottom Quote */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.6 }}
        className="mt-8 bg-gradient-to-r from-violet-50 to-blue-50 border-2 border-violet-200 rounded-2xl p-8 text-center"
      >
        <div className="text-4xl mb-4">🌟</div>
        <p className="text-lg text-slate-700 font-medium mb-2">
          "Code quality isn't just about making things work—it's about making them work <strong className="text-violet-600">sustainably</strong> for years to come."
        </p>
        <p className="text-sm text-violet-600 font-semibold">
          This refactoring sets the foundation for long-term success
        </p>
      </motion.div>
    </div>
  );
}

