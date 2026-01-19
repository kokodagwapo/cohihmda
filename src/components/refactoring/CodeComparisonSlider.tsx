import { useState } from 'react';
import { motion } from 'framer-motion';
import { Code2, FileCode, Layers } from 'lucide-react';

interface CodeComparisonSliderProps {
  beforeTitle?: string;
  afterTitle?: string;
}

export function CodeComparisonSlider({
  beforeTitle = "Before: Monolithic",
  afterTitle = "After: Modular"
}: CodeComparisonSliderProps) {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percentage = (x / rect.width) * 100;
    setSliderPosition(percentage);
  };

  const handleMouseDown = () => setIsDragging(true);
  const handleMouseUp = () => setIsDragging(false);

  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="mb-6 text-center">
        <h3 className="text-2xl font-bold text-slate-900 mb-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          Code Transformation
        </h3>
        <p className="text-slate-600">Drag the slider to compare before and after</p>
      </div>

      <div
        className="relative w-full h-[500px] rounded-2xl overflow-hidden border-2 border-slate-200 shadow-xl cursor-col-resize select-none"
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Before (Left Side) */}
        <div className="absolute inset-0 bg-gradient-to-br from-red-50 to-orange-50">
          <div className="p-8 h-full overflow-hidden">
            <div className="flex items-center gap-2 mb-4">
              <FileCode className="w-5 h-5 text-red-600" />
              <h4 className="font-semibold text-red-900">{beforeTitle}</h4>
              <span className="ml-auto text-xs px-2 py-1 bg-red-100 text-red-700 rounded-full font-mono">
                12,745 lines
              </span>
            </div>
            <div className="bg-red-900/90 rounded-lg p-4 font-mono text-xs text-red-50 h-[calc(100%-3rem)] overflow-hidden">
              <div className="opacity-70">
                <div className="text-red-300">// Dashboard.tsx - A massive monolithic file</div>
                <div className="mt-2">
                  <span className="text-red-400">const</span> Dashboard = () =&gt; &#123;
                </div>
                <div className="ml-4 mt-1 text-red-200">
                  <div>// 11 embedded view components...</div>
                  <div>// 11 modal dialogs inline...</div>
                  <div>// 1,160 lines of dead code...</div>
                  <div>// 931 lines of mock data...</div>
                  <div>// Everything tangled together...</div>
                  <div className="mt-2 text-red-300">const [state1, setState1] = useState();</div>
                  <div className="text-red-300">const [state2, setState2] = useState();</div>
                  <div className="text-red-300">const [state3, setState3] = useState();</div>
                  <div className="text-red-300">// ... 50+ more state variables ...</div>
                  <div className="mt-2">
                    <span className="text-red-400">return</span> (
                  </div>
                  <div className="ml-4">
                    &lt;<span className="text-red-400">div</span>&gt;
                  </div>
                  <div className="ml-8 text-red-200">
                    &#123;/* Thousands of lines of JSX */&#125;
                  </div>
                  <div className="ml-8 text-red-200">
                    &#123;/* All logic mixed with UI */&#125;
                  </div>
                  <div className="ml-8 text-red-200">
                    &#123;/* Impossible to test */&#125;
                  </div>
                  <div className="ml-8 text-red-200">
                    &#123;/* Impossible to maintain */&#125;
                  </div>
                  <div className="ml-4">
                    &lt;/<span className="text-red-400">div</span>&gt;
                  </div>
                  <div>  );</div>
                </div>
                <div>&#125;;</div>
                <div className="mt-4 text-red-300">// ... continues for 12,000+ more lines ...</div>
              </div>
            </div>
          </div>
        </div>

        {/* After (Right Side) */}
        <motion.div
          className="absolute inset-0 bg-gradient-to-br from-green-50 to-emerald-50"
          style={{ clipPath: `inset(0 0 0 ${sliderPosition}%)` }}
        >
          <div className="p-8 h-full overflow-hidden">
            <div className="flex items-center gap-2 mb-4">
              <Layers className="w-5 h-5 text-green-600" />
              <h4 className="font-semibold text-green-900">{afterTitle}</h4>
              <span className="ml-auto text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full font-mono">
                1,038 lines
              </span>
            </div>
            <div className="bg-green-900/90 rounded-lg p-4 font-mono text-xs text-green-50 h-[calc(100%-3rem)] overflow-hidden">
              <div className="opacity-70">
                <div className="text-green-300">// Dashboard.tsx - Clean orchestrator</div>
                <div className="mt-2">
                  <span className="text-green-400">import</span> &#123; CompanyDetailView &#125; <span className="text-green-400">from</span> <span className="text-green-300">'./views/CompanyDetailView'</span>;
                </div>
                <div>
                  <span className="text-green-400">import</span> &#123; SalesView &#125; <span className="text-green-400">from</span> <span className="text-green-300">'./views/SalesView'</span>;
                </div>
                <div>
                  <span className="text-green-400">import</span> &#123; useDashboardData &#125; <span className="text-green-400">from</span> <span className="text-green-300">'@/hooks/dashboard'</span>;
                </div>
                <div className="mt-2">
                  <span className="text-green-400">const</span> Dashboard = () =&gt; &#123;
                </div>
                <div className="ml-4 mt-1 text-green-200">
                  <div className="text-green-300">// Clean separation of concerns</div>
                  <div className="text-green-300">const data = useDashboardData();</div>
                  <div className="mt-2">
                    <span className="text-green-400">return</span> (
                  </div>
                  <div className="ml-4">
                    &lt;<span className="text-green-400">DashboardLayout</span>&gt;
                  </div>
                  <div className="ml-8">
                    &lt;<span className="text-green-400">CompanyDetailView</span> data=&#123;data&#125; /&gt;
                  </div>
                  <div className="ml-8">
                    &lt;<span className="text-green-400">SalesView</span> data=&#123;data&#125; /&gt;
                  </div>
                  <div className="ml-8">
                    &lt;<span className="text-green-400">OpsView</span> data=&#123;data&#125; /&gt;
                  </div>
                  <div className="ml-4">
                    &lt;/<span className="text-green-400">DashboardLayout</span>&gt;
                  </div>
                  <div>  );</div>
                </div>
                <div>&#125;;</div>
                <div className="mt-4 text-green-300">// Each component is focused & testable</div>
                <div className="text-green-300">// Each hook manages specific logic</div>
                <div className="text-green-300">// Everything is maintainable</div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Slider Handle */}
        <div
          className="absolute top-0 bottom-0 w-1 bg-slate-400 cursor-col-resize z-10"
          style={{ left: `${sliderPosition}%` }}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full shadow-lg border-2 border-slate-400 flex items-center justify-center">
            <Code2 className="w-4 h-4 text-slate-600" />
          </div>
        </div>
      </div>

      {/* Stats Below */}
      <div className="mt-6 grid grid-cols-2 gap-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-red-600 mb-1">❌</div>
          <div className="text-sm font-semibold text-red-900">Cognitive Overload</div>
          <div className="text-xs text-red-600 mt-1">Impossible to understand</div>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-green-600 mb-1">✅</div>
          <div className="text-sm font-semibold text-green-900">Clear Structure</div>
          <div className="text-xs text-green-600 mt-1">Easy to understand & maintain</div>
        </div>
      </div>
    </div>
  );
}

