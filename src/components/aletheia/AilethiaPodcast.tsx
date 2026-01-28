import { useState, useEffect, useRef } from 'react';
import { Play, Mic, MicOff, Phone, PhoneOff, VolumeX, Volume2, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';

interface CohiPodcastProps {
  businessContext?: {
    revenue?: string;
    loans?: number;
    margin?: string;
    healthScore?: number;
    insights?: Array<{ message: string; type: string }>;
  };
  className?: string;
}

export function CohiPodcast({ businessContext, className }: CohiPodcastProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentScript, setCurrentScript] = useState<string>('');
  
  const audioCtxRef = useRef<AudioContext | null>(null);
  const recognitionRef = useRef<any>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const { toast } = useToast();

  // Initialize Audio Context
  useEffect(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    };
  }, []);

  // Start podcast narration
  const startPodcast = async () => {
    setIsLoading(true);
    setIsPlaying(true);
    setIsMuted(false);
    setIsListening(false);

    try {
      console.log('Generating Cohi briefing...');
      
      // Call Lambda function via API Gateway
      const data = await api.invokeFunction<{ script: string; generatedAt: string }>('Cohi-briefing', {
        businessContext,
        type: 'briefing'
      });

      if (!data?.script) {
        throw new Error('No script generated');
      }

      setCurrentScript(data.script);
      setIsConnected(true);
      setIsLoading(false);

      // Use Web Speech API for TTS
      await speakText(data.script);
      
    } catch (error: any) {
      console.error('Error starting podcast:', error);
      toast({
        title: 'Briefing Error',
        description: error.message || 'Failed to start Cohi briefing',
        variant: 'destructive',
      });
      setIsPlaying(false);
      setIsLoading(false);
    }
  };

  // Use Web Speech API for text-to-speech
  const speakText = async (text: string) => {
    if (!('speechSynthesis' in window)) {
      toast({
        title: 'Not Supported',
        description: 'Speech synthesis not available in this browser',
        variant: 'destructive',
      });
      return;
    }

    // Cancel any existing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utteranceRef.current = utterance;
    
    // Configure voice settings
    utterance.rate = 0.95; // Slightly slower for clarity
    utterance.pitch = 1.0;
    utterance.volume = isMuted ? 0 : 1;
    
    // Try to find a good female voice
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => 
      v.name.includes('Samantha') || 
      v.name.includes('Victoria') || 
      v.name.includes('Karen') ||
      v.name.includes('Google US English') ||
      (v.lang === 'en-US' && v.name.toLowerCase().includes('female'))
    ) || voices.find(v => v.lang.startsWith('en'));
    
    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    utterance.onend = () => {
      setIsPlaying(false);
      setIsConnected(false);
    };

    utterance.onerror = (event) => {
      console.error('Speech synthesis error:', event);
      setIsPlaying(false);
      setIsConnected(false);
      if (event.error !== 'canceled') {
        toast({
          title: 'Audio Error',
          description: 'Failed to play audio',
          variant: 'destructive',
        });
      }
    };

    window.speechSynthesis.speak(utterance);
  };

  // Stop podcast
  const stopPodcast = () => {
    setIsPlaying(false);
    setIsConnected(false);
    setIsListening(false);
    
    // Stop speech synthesis
    window.speechSynthesis.cancel();
    
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.suspend();
    }
    setCurrentScript('');
  };

  // Toggle mic (for visitor questions)
  const toggleMic = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast({
        title: 'Not Supported',
        description: 'Speech recognition not available',
      });
      return;
    }

    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      setIsListening(false);
    } else {
      const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = async (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (transcript && event.results[0].isFinal) {
          // Send question to backend for response
          await sendQuestion(transcript);
        }
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  // Send question to backend
  const sendQuestion = async (question: string) => {
    try {
      setIsLoading(true);
      
      const data = await api.invokeFunction<{ script: string; generatedAt: string }>('Cohi-briefing', {
        businessContext: {
          ...businessContext,
          question,
          previousContext: currentScript
        },
        type: 'question'
      });

      if (data?.script) {
        setCurrentScript(data.script);
        await speakText(data.script);
      }
    } catch (error: any) {
      console.error('Error sending question:', error);
      toast({
        title: 'Error',
        description: 'Failed to process your question',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Toggle mute
  const toggleMute = () => {
    setIsMuted(!isMuted);
    if (utteranceRef.current) {
      // Unfortunately can't change volume mid-speech, so we cancel and restart
      if (!isMuted) {
        window.speechSynthesis.pause();
      } else {
        window.speechSynthesis.resume();
      }
    }
  };

  // Cleanup
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
      window.speechSynthesis.cancel();
    };
  }, []);

  // Load voices when they become available
  useEffect(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
      };
    }
  }, []);

  return (
    <div className={className}>
      {/* Play Button - Blue rounded square with play icon */}
      {!isPlaying ? (
        <button
          onClick={startPodcast}
          className="relative w-16 h-16 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white transition-all active:scale-95 shadow-lg flex items-center justify-center group"
          title="Start Cohi Briefing"
        >
          {isLoading ? (
            <Loader2 className="w-6 h-6 animate-spin" />
          ) : (
            <Play className="w-8 h-8 ml-1" />
          )}
        </button>
      ) : (
        <div className="flex items-center gap-2">
          {/* Call Controls */}
          <AnimatePresence>
            <motion.div
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              className="flex items-center gap-2"
            >
              {/* Mic Button */}
              <button
                onClick={toggleMic}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95 ${
                  isListening
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300'
                }`}
                title={isListening ? 'Stop Listening' : 'Ask a Question'}
              >
                {isListening ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
              </button>

              {/* Mute Button */}
              <button
                onClick={toggleMute}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95 ${
                  isMuted
                    ? 'bg-amber-600 hover:bg-amber-700 text-white'
                    : 'bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300'
                }`}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>

              {/* Call Button */}
              <button
                onClick={toggleMic}
                className="w-12 h-12 rounded-full flex items-center justify-center bg-green-600 hover:bg-green-700 text-white transition-all active:scale-95"
                title="Ask Question"
              >
                <Phone className="w-5 h-5" />
              </button>

              {/* End Call Button */}
              <button
                onClick={stopPodcast}
                className="w-12 h-12 rounded-full flex items-center justify-center bg-red-600 hover:bg-red-700 text-white transition-all active:scale-95"
                title="End Briefing"
              >
                <PhoneOff className="w-5 h-5" />
              </button>
            </motion.div>
          </AnimatePresence>

          {/* Connection Status */}
          {isConnected && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs text-slate-600 dark:text-slate-400">Live</span>
            </div>
          )}
        </div>
      )}

      {/* Script Display (Optional - for debugging) */}
      {currentScript && process.env.NODE_ENV === 'development' && (
        <div className="mt-4 p-4 bg-slate-100 dark:bg-slate-800 rounded-lg text-sm text-slate-700 dark:text-slate-300 max-h-40 overflow-y-auto">
          {currentScript}
        </div>
      )}
    </div>
  );
}
