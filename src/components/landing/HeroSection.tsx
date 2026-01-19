import { Button } from '@/components/ui/button';
import { ArrowRight, Sparkles, Check } from 'lucide-react';

export function HeroSection() {
  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center px-4 sm:px-6 md:px-8 text-center overflow-hidden bg-gradient-to-b from-white via-gray-50/50 to-white">
      {/* Subtle background pattern */}
      <div className="absolute inset-0 opacity-[0.03]">
        <div className="absolute inset-0" style={{
          backgroundImage: `radial-gradient(circle at 20% 50%, rgba(64, 123, 255, 0.4) 0%, transparent 50%),
                            radial-gradient(circle at 80% 80%, rgba(0, 191, 255, 0.3) 0%, transparent 50%),
                            radial-gradient(circle at 40% 20%, rgba(64, 123, 255, 0.2) 0%, transparent 50%)`,
        }} />
      </div>

      <div className="relative z-10 max-w-6xl space-y-10 mt-20 md:mt-24">
        <div className="inline-flex items-center gap-2 rounded-full border border-gray-200/80 bg-white/60 backdrop-blur-md px-4 py-2 text-sm text-gray-700 shadow-sm hover:shadow-md transition-shadow">
          <Sparkles className="h-4 w-4 text-[#407BFF]" />
          <span className="font-medium">Executive Intelligence Platform</span>
        </div>

        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-gray-900 leading-[1.1] px-2">
          The Executive Intelligence Platform for{' '}
          <span className="bg-gradient-to-r from-[#407BFF] to-[#00BFFF] bg-clip-text text-transparent">
            Lending Companies
          </span>
        </h1>

        <p className="mx-auto max-w-3xl text-lg sm:text-xl md:text-2xl text-gray-600 leading-relaxed px-2 font-normal">
          Real-time clarity. Predictive insights. TopTier performance.
          <br />
          <span className="text-gray-500">No complicated dashboards — just the truth leaders need.</span>
        </p>

        <div className="flex flex-col items-center justify-center gap-4 sm:flex-row w-full sm:w-auto px-4 pt-2">
          <Button 
            size="lg" 
            className="gap-2 w-full sm:w-auto h-14 px-8 text-base font-semibold bg-[#407BFF] hover:bg-[#3566CC] text-white shadow-xl shadow-[#407BFF]/25 hover:shadow-2xl hover:shadow-[#407BFF]/30 transition-all transform hover:scale-105" 
            onClick={() => {
              const demoSection = document.getElementById('demo');
              if (demoSection) {
                demoSection.scrollIntoView({ behavior: 'smooth' });
              }
            }}
          >
            Request a Demo
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button 
            size="lg" 
            variant="outline" 
            className="w-full sm:w-auto h-14 px-8 text-base font-semibold border-2 border-gray-200 hover:border-[#407BFF] hover:text-[#407BFF] bg-white hover:bg-gray-50 transition-all shadow-sm hover:shadow-md"
            onClick={() => {
              const aletheiaButton = document.querySelector('[data-aletheia-trigger]');
              if (aletheiaButton) {
                (aletheiaButton as HTMLElement).click();
              }
            }}
          >
            Talk to Ailethia
          </Button>
        </div>

        {/* Trust indicators */}
        <div className="pt-8 space-y-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Trusted by leading mortgage executives
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8 opacity-60">
            {['Fortune 500 Lenders', 'Regional Banks', 'Credit Unions', 'Mortgage Brokers'].map((item, idx) => (
              <div key={idx} className="flex items-center gap-2 text-sm text-gray-600">
                <Check className="h-4 w-4 text-[#407BFF]" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
