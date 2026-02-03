import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Play, 
  Pause,
  MousePointer2, 
  Sparkles, 
  Volume2, 
  VolumeX,
  SkipForward, 
  X,
  FastForward, 
  CheckCircle2,
  Clock,
  Zap,
  LayoutGrid,
  MessageSquare,
  TrendingUp,
  DollarSign,
  Home,
  BarChart3,
  ShieldCheck,
  Mic,
  MicOff,
  Search,
  ArrowRightLeft,
  Layout
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate, useLocation } from 'react-router-dom';

interface DemoStep {
  id: string;
  path: string;
  target?: string;
  message: string;
  action?: () => void;
  scroll?: boolean;
}

const DEMO_STEPS: DemoStep[] = [
  {
    id: 'landing',
    path: '/',
    message: "Hey there! I'm Cohi, your dedicated institutional executive analyst. Think of me as the brain of your operation. We've built Coheus to give you absolute institutional clarity, moving beyond static dashboards into real-time strategic intelligence. Ready to see the cockpit?",
    scroll: true
  },
  {
    id: 'insights',
    path: '/insights',
    message: "Welcome to your Strategic Command Center. This is where your morning starts—immediate, unfiltered visibility into your global pipeline health and revenue trajectories. It's institutional intelligence at the speed of thought.",
  },
  {
    id: 'loan-funnel',
    path: '/loan-funnel',
    message: "Let's get granular with the Loan Funnel. We don't just track lost volume; we identify the exact patterns in your fallout so we can recover margin leakage before it impacts your bottom line.",
  },
  {
    id: 'toptiering',
    path: '/performance/toptiering-comparison',
    message: "In TopTiering, we benchmark your absolute best branches and officers. I'm surfacing exactly where conversion is slipping and where your execution is widening your competitive moat.",
  },
  {
    id: 'workbench',
    path: '/my-dashboard',
    message: "And finally, the Workbench—your personal strategic canvas. Pin any metric or model to architect the perfect view for your leadership style. It's fully dynamic and proportionately scaled for absolute clarity.",
  },
  {
    id: 'closing',
    path: '/insights',
    message: "That's the quick tour! I'm ready to be your force multiplier. If you have any questions, just tap the mic and ask. Let's get to work.",
  }
];

function FloatingElements() {
  const elements = useMemo(() => [
    { Icon: DollarSign, color: 'text-emerald-500/20', size: 80 },
    { Icon: TrendingUp, color: 'text-blue-500/20', size: 60 },
    { Icon: Home, color: 'text-indigo-500/20', size: 70 },
    { Icon: BarChart3, color: 'text-violet-500/20', size: 90 },
    { Icon: ShieldCheck, color: 'text-rose-500/20', size: 55 },
    { Icon: Sparkles, color: 'text-amber-500/20', size: 45 },
    { Icon: Zap, color: 'text-yellow-500/15', size: 65 },
    { Icon: LayoutGrid, color: 'text-sky-500/15', size: 75 },
    { Icon: MessageSquare, color: 'text-blue-400/15', size: 50 },
    { Icon: Search, color: 'text-blue-300/10', size: 40 },
    { Icon: ArrowRightLeft, color: 'text-indigo-300/10', size: 50 },
    { Icon: Layout, color: 'text-slate-400/10', size: 60 },
  ], []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
      {Array.from({ length: 25 }).map((_, i) => {
        const { Icon, color, size } = elements[i % elements.length];
        return (
          <motion.div
            key={i}
            initial={{ 
              left: `${(i * 13) % 100}%`, 
              top: '110%', 
              opacity: 0,
              scale: 0.5 + (i % 5) * 0.1
            }}
            animate={{ 
              top: '-10%', 
              opacity: [0, 1, 1, 0],
              x: [0, (i % 2 === 0 ? 50 : -50), 0],
              rotate: [0, 180, 360]
            }}
            transition={{ 
              duration: 20 + (i % 15), 
              repeat: Infinity, 
              delay: i * 1.2, 
              ease: "linear" 
            }}
            className={`absolute ${color} blur-[0.5px]`}
          >
            <Icon size={size + (i % 30)} strokeWidth={0.5} />
          </motion.div>
        );
      })}
      <motion.div 
        animate={{ 
          scale: [1, 1.15, 1], 
          opacity: [0.05, 0.12, 0.05],
          rotate: [0, 10, 0]
        }}
        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[100vw] h-[100vw] bg-gradient-to-tr from-blue-500/10 via-indigo-500/5 to-purple-500/10 rounded-full blur-[150px] -z-10"
      />
    </div>
  );
}

export function CohiDemoExperience() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isUserMicMuted, setIsUserMicMuted] = useState(true);
  const [isSimulationActive, setIsSimulationActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [cursorPos, setCursorPos] = useState({ x: '50%', y: '50%' });
  const [isNavigating, setIsNavigating] = useState(false);
  const [showHighlight, setShowHighlight] = useState(false);
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);
  const [isCohiThinking, setIsCohiThinking] = useState(false);
  const [lastUserQuestion, setLastUserQuestion] = useState<string | null>(null);
  
  const navigate = useNavigate();
  const location = useLocation();
  const stepTimerRef = useRef<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopDemo = useCallback(() => {
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentStepIndex(0);
    setShowHighlight(false);
    setIsUserMicMuted(true);
    if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    document.body.style.cursor = 'auto';
  }, []);

  // Hero "Watch Cohi Demo" button (Index.tsx) dispatches this; start same demo as fixed "STRATEGIC TOUR COHI DEMO 2.0" button
  useEffect(() => {
    const handler = () => setIsPlaying(true);
    window.addEventListener('start-cohi-demo', handler);
    return () => window.removeEventListener('start-cohi-demo', handler);
  }, []);

  const handleUserQuestion = useCallback(async (question: string) => {
    setIsCohiThinking(true);
    setLastUserQuestion(question);
    
    setTimeout(async () => {
      const responses = [
        "That's a sharp question. If you look at the fallout patterns in the West Coast, we’re seeing a 12% lift in pull-through when we use the new pricing tiers.",
        "Analytical perspective? We’re benchmarked about 40 basis points ahead of the peer group right now. Our competitive moat is widening.",
        "Exactly. Our model indicates that margin compression will stabilize by Q3 if we maintain this lock-to-fund velocity.",
      ];
      const reply = responses[Math.floor(Math.random() * responses.length)];
      setIsCohiThinking(false);
      speak(reply);
    }, 2000);
  }, []);

  const advanceStep = useCallback(() => {
    if (isPaused) return;
    if (currentStepIndex < DEMO_STEPS.length - 1) {
      // Pause for exactly 1.5 seconds before next step
      setTimeout(() => {
        setCurrentStepIndex(prev => prev + 1);
      }, 1500);
    } else {
      setTimeout(stopDemo, 1500);
    }
  }, [currentStepIndex, stopDemo]);

  const speak = useCallback(async (text: string) => {
    if (isPaused) return;
    if (isMuted) {
      stepTimerRef.current = setTimeout(advanceStep, text.length * 65);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
    }

    try {
      const response = await fetch('/api/podcast/demo/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          text: text.replace(/Cohi/g, 'Cohee'), 
          voice: 'onyx' 
        }),
      });

      if (!response.ok) throw new Error('TTS failed');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      
      audio.onended = () => {
        advanceStep();
      };

      audio.play();
    } catch (err) {
      console.error('Cohi voice error:', err);
      advanceStep();
    }
  }, [isMuted, advanceStep]);

  const updateCursorPosition = useCallback(() => {
    const currentStep = DEMO_STEPS[currentStepIndex];
    if (!currentStep.target) {
      setCursorPos({ x: '50%', y: '50%' });
      setShowHighlight(false);
      return;
    }

    const element = document.querySelector(currentStep.target) as HTMLElement;
    if (element) {
      const rect = element.getBoundingClientRect();
      setCursorPos({ 
        x: `${rect.left + rect.width / 2}px`, 
        y: `${rect.top + rect.height / 2}px` 
      });
      setHighlightRect(rect);
      setShowHighlight(true);
      
      if (currentStep.scroll) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      setShowHighlight(false);
    }
  }, [currentStepIndex]);

  useEffect(() => {
    if (!isPlaying || isPaused) return;

    const currentStep = DEMO_STEPS[currentStepIndex];
    if (location.pathname !== currentStep.path) {
      setIsNavigating(true);
      navigate(currentStep.path);
      setTimeout(() => {
        setIsNavigating(false);
        updateCursorPosition();
      }, 1000);
      return;
    }

    updateCursorPosition();
    speak(currentStep.message);

    return () => {
      if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
    };
  }, [isPlaying, currentStepIndex, location.pathname, navigate, stopDemo, updateCursorPosition, speak]);

  const togglePause = useCallback(() => {
    const nextPaused = !isPaused;
    setIsPaused(nextPaused);
    if (nextPaused) {
      if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
      if (audioRef.current) audioRef.current.pause();
    } else {
      speak(DEMO_STEPS[currentStepIndex].message);
    }
  }, [isPaused, currentStepIndex, speak]);

  // Fixed "COHI DEMO 2.0" button hidden for now; demo can still be started via Index "Watch Cohi Demo" (start-cohi-demo event)
  if (!isPlaying) {
    return null;
  }

  const currentStep = DEMO_STEPS[currentStepIndex];

  return (
    <div className="fixed inset-0 z-[10000] pointer-events-none">
      <FloatingElements />
      <AnimatePresence>
        {isNavigating && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-white/80 dark:bg-slate-950/80 backdrop-blur-2xl flex items-center justify-center">
            <div className="flex flex-col items-center gap-6">
              <motion.div animate={{ scale: [1, 1.2, 1], rotate: [0, 10, -10, 0] }} transition={{ duration: 1.5, repeat: Infinity }} className="w-24 h-24 rounded-[2rem] bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-2xl">
                <Zap className="w-12 h-12 text-white fill-current" />
              </motion.div>
              <p className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600 uppercase tracking-tighter">
                Synchronizing Strategy...
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div animate={{ x: cursorPos.x, y: cursorPos.y, scale: showHighlight ? 1.4 : 1 }} transition={{ type: 'spring', damping: 25, stiffness: 150 }} className="absolute w-12 h-12 -ml-6 -mt-6 z-[10001] flex items-center justify-center">
        <MousePointer2 className="w-10 h-10 text-blue-500 fill-blue-500 drop-shadow-[0_4px_12px_rgba(59,130,246,0.5)]" />
      </motion.div>

      <AnimatePresence>
        {showHighlight && highlightRect && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ 
              opacity: 1, 
              scale: 1.02,
              boxShadow: [
                "0 0 0 0px rgba(59,130,246,0)",
                "0 0 0 20px rgba(59,130,246,0.1)",
                "0 0 40px rgba(59,130,246,0.2)",
                "0 0 0 0px rgba(59,130,246,0)"
              ]
            }}
            exit={{ opacity: 0 }}
            transition={{ boxShadow: { repeat: Infinity, duration: 2 } }}
            className="absolute border-2 border-blue-400/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.6)] backdrop-contrast-125 z-[9999] rounded-2xl"
            style={{ left: highlightRect.left - 12, top: highlightRect.top - 12, width: highlightRect.width + 24, height: highlightRect.height + 24 }}
          />
        )}
      </AnimatePresence>

      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-full max-w-2xl px-6 pointer-events-auto">
        <motion.div layout className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-slate-800 flex items-start gap-5">
          <div className="relative shrink-0">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg">
              <Sparkles className={`w-8 h-8 text-white ${isCohiThinking ? 'animate-spin' : 'animate-pulse'}`} />
            </div>
          </div>
          <div className="flex-1 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900 dark:text-white">Cohi</span>
                <span className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 px-2 py-0 text-[10px] uppercase font-black rounded-md">EXECUTIVE ANALYST</span>
              </div>
              <div className="flex items-center gap-2">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 rounded-full text-slate-400 hover:text-blue-500"
                  onClick={togglePause}
                  title={isPaused ? "Resume demo" : "Pause demo"}
                >
                  {isPaused ? <Play className="w-4 h-4 fill-current" /> : <Pause className="w-4 h-4 fill-current" />}
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className={`h-8 w-8 rounded-full transition-colors ${!isUserMicMuted ? 'text-red-500 bg-red-50' : 'text-slate-400'}`}
                  onClick={() => {
                    const next = !isUserMicMuted;
                    setIsUserMicMuted(next);
                    if (!next) {
                      handleUserQuestion("How are our West Coast margins tracking against the peer group?");
                    }
                  }}
                  title={isUserMicMuted ? "Unmute to ask a question" : "Mute microphone"}
                >
                  {isUserMicMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 animate-pulse" />}
                </Button>
                <Button variant="ghost" size="icon" onClick={stopDemo} className="h-7 w-7 rounded-full text-slate-400"><X className="w-4 h-4" /></Button>
              </div>
            </div>
            
            {isCohiThinking ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">User Question</div>
                  <div className="h-px flex-1 bg-slate-100 dark:bg-slate-800" />
                  <div className="flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-blue-500 animate-pulse" />
                    <span className="text-[10px] font-bold text-blue-500 uppercase tracking-tighter">Gemini Agentic</span>
                  </div>
                </div>
                <p className="text-sm italic text-slate-500">"{lastUserQuestion}"</p>
                <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />
                <p className="text-lg font-medium text-blue-600 dark:text-blue-400 animate-pulse">Analyzing real-time institutional benchmarks...</p>
              </div>
            ) : (
              <p className="text-lg font-light leading-relaxed text-slate-800 dark:text-slate-100">{currentStep.message}</p>
            )}

            <div className="flex gap-1.5 h-1.5 mt-4">
              {DEMO_STEPS.map((_, idx) => (
                <div key={idx} className="flex-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  {idx === currentStepIndex && <motion.div initial={{ width: 0 }} animate={{ width: "100%" }} transition={{ duration: currentStep.message.length * 0.07, ease: "linear" }} className="h-full bg-gradient-to-r from-blue-500 to-indigo-500" />}
                  {idx < currentStepIndex && <div className="h-full w-full bg-blue-600" />}
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
