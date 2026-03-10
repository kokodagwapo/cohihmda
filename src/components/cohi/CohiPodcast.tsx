import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, Mic, MicOff, PhoneOff, Volume2, VolumeX, Loader2, Radio, Send } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';

interface CohiPodcastProps {
  className?: string;
}

type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'listening';
type PrefetchState = 'idle' | 'loading' | 'ready' | 'error';

interface PrefetchedBriefing {
  script: string;
  metrics: any;
}

function decodePCM16ToFloat32(base64Audio: string): Float32Array {
  const raw = atob(base64Audio);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  const pcm16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    float32[i] = pcm16[i] / 32768;
  }
  return float32;
}

export function CohiPodcast({ className }: CohiPodcastProps) {
  const [state, setState] = useState<PlaybackState>('idle');
  const [prefetchState, setPrefetchState] = useState<PrefetchState>('idle');
  const [prefetchedBriefing, setPrefetchedBriefing] = useState<PrefetchedBriefing | null>(null);
  const [transcript, setTranscript] = useState<string>('');
  const [isMuted, setIsMuted] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState<string>('');
  const [isRecording, setIsRecording] = useState(false);
  
  const isMutedRef = useRef(isMuted);
  const isPausedRef = useRef(false);
  const audioBufferRef = useRef<Float32Array[]>([]);
  const streamAbortRef = useRef<AbortController | null>(null);
  
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);
  
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const { toast } = useToast();

  const requestPodcastEndpoint = useCallback(async (endpoint: string, options: RequestInit = {}) => {
    const response = await api.fetchWithAuth(endpoint, options);
    if (!response.ok) {
      let errorMessage = 'Podcast request failed';
      try {
        const err = await response.json();
        errorMessage = err?.error || err?.message || errorMessage;
      } catch {
        errorMessage = `${errorMessage} (${response.status})`;
      }
      throw new Error(errorMessage);
    }
    return response;
  }, []);

  const prefetchBriefing = useCallback(async () => {
    if (prefetchState === 'loading' || prefetchState === 'ready') return;
    
    setPrefetchState('loading');
    try {
      const response = await requestPodcastEndpoint('/api/podcast/cohi/briefing');
      
      const data = await response.json();
      if (data.success && data.briefing) {
        setPrefetchedBriefing({
          script: data.briefing.script,
          metrics: data.briefing.metrics,
        });
        setPrefetchState('ready');
      } else {
        throw new Error('Invalid briefing response');
      }
    } catch (error) {
      console.error('Failed to prefetch briefing:', error);
      setPrefetchState('error');
    }
  }, [prefetchState, requestPodcastEndpoint]);

  useEffect(() => {
    prefetchBriefing();
  }, []);

  const initAudio = useCallback(async () => {
    if (audioCtxRef.current && workletRef.current) {
      if (audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume();
      }
      return;
    }
    
    try {
      const ctx = new AudioContext({ sampleRate: 24000 });
      await ctx.audioWorklet.addModule('/audio-playback-worklet.js');
      const worklet = new AudioWorkletNode(ctx, 'audio-playback-processor');
      worklet.connect(ctx.destination);
      
      worklet.port.onmessage = (e) => {
        if (e.data.type === 'ended') {
          setState((prev) => prev === 'playing' ? 'idle' : prev);
        }
      };
      
      audioCtxRef.current = ctx;
      workletRef.current = worklet;
      
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
    } catch (error) {
      console.error('Failed to initialize audio:', error);
      toast({
        title: 'Audio Error',
        description: 'Failed to initialize audio playback',
        variant: 'destructive',
      });
    }
  }, [toast]);

  const pushAudio = useCallback((base64Audio: string) => {
    if (!workletRef.current) return;
    const samples = decodePCM16ToFloat32(base64Audio);
    
    if (isPausedRef.current) {
      audioBufferRef.current.push(samples);
    } else {
      workletRef.current.port.postMessage({ type: 'audio', samples });
    }
  }, []);

  const signalComplete = useCallback(() => {
    workletRef.current?.port.postMessage({ type: 'streamComplete' });
  }, []);

  const clearAudio = useCallback(() => {
    workletRef.current?.port.postMessage({ type: 'clear' });
    audioBufferRef.current = [];
  }, []);

  const pausePlayback = useCallback(() => {
    if (audioCtxRef.current && audioCtxRef.current.state === 'running') {
      audioCtxRef.current.suspend();
      isPausedRef.current = true;
      setState('paused');
    }
  }, []);

  const resumePlayback = useCallback(() => {
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
      isPausedRef.current = false;
      setState('playing');
      
      if (workletRef.current && audioBufferRef.current.length > 0) {
        for (const samples of audioBufferRef.current) {
          workletRef.current.port.postMessage({ type: 'audio', samples });
        }
        audioBufferRef.current = [];
      }
    }
  }, []);

  const startBriefing = async () => {
    setState('loading');
    setTranscript('');
    isPausedRef.current = false;
    audioBufferRef.current = [];
    
    try {
      await initAudio();
      
      streamAbortRef.current = new AbortController();
      
      const response = await requestPodcastEndpoint('/api/podcast/cohi/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: streamAbortRef.current.signal,
      });

      setState('playing');
      
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          try {
            const event = JSON.parse(line.slice(6));

            switch (event.type) {
              case 'script':
                setTranscript(event.data);
                break;
              case 'audio':
                if (!isMutedRef.current) {
                  pushAudio(event.data);
                }
                break;
              case 'done':
                signalComplete();
                break;
              case 'error':
                throw new Error(event.error);
            }
          } catch (e) {
            if (!(e instanceof SyntaxError)) {
              console.error('Stream parse error:', e);
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return;
      }
      console.error('Error starting briefing:', error);
      toast({
        title: 'Briefing Error',
        description: error.message || 'Failed to start Cohi briefing',
        variant: 'destructive',
      });
      setState('idle');
    }
  };

  const stopPlayback = () => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
    clearAudio();
    isPausedRef.current = false;
    setState('idle');
    setIsRecording(false);
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });

      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
        await askQuestion(blob);
      };

      recorder.start(100);
      setIsRecording(true);
      setState('listening');
    } catch (error: any) {
      console.error('Recording error:', error);
      toast({
        title: 'Microphone Error',
        description: 'Could not access microphone',
        variant: 'destructive',
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const askQuestion = async (audioBlob?: Blob) => {
    setState('loading');
    isPausedRef.current = false;
    
    try {
      await initAudio();
      
      let body: any = {};
      
      if (audioBlob) {
        const reader = new FileReader();
        const base64Audio = await new Promise<string>((resolve) => {
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]);
          };
          reader.readAsDataURL(audioBlob);
        });
        body.audio = base64Audio;
      } else if (currentQuestion.trim()) {
        body.question = currentQuestion.trim();
      } else {
        setState('idle');
        return;
      }

      const response = await requestPodcastEndpoint('/api/podcast/cohi/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      setState('playing');
      setCurrentQuestion('');
      
      const streamReader = response.body?.getReader();
      if (!streamReader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let fullTranscript = '';

      while (true) {
        const { done, value } = await streamReader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          try {
            const event = JSON.parse(line.slice(6));

            switch (event.type) {
              case 'user_question':
                setTranscript(`You asked: "${event.data}"\n\nCohi: `);
                break;
              case 'transcript':
                fullTranscript += event.data;
                setTranscript((prev) => prev + event.data);
                break;
              case 'audio':
                if (!isMutedRef.current) {
                  pushAudio(event.data);
                }
                break;
              case 'done':
                signalComplete();
                break;
              case 'error':
                throw new Error(event.error);
            }
          } catch (e) {
            if (!(e instanceof SyntaxError)) {
              console.error('Stream parse error:', e);
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Error asking question:', error);
      toast({
        title: 'Question Error',
        description: error.message || 'Failed to process your question',
        variant: 'destructive',
      });
      setState('idle');
    }
  };

  useEffect(() => {
    return () => {
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
    };
  }, []);

  const getStatusText = () => {
    if (state === 'idle') {
      if (prefetchState === 'loading') return 'Preparing briefing...';
      if (prefetchState === 'ready') return 'Ready to brief';
      return 'Ready';
    }
    if (state === 'loading') return 'Connecting...';
    if (state === 'playing') return 'Speaking...';
    if (state === 'paused') return 'Paused';
    if (state === 'listening') return 'Listening...';
    return 'Ready';
  };

  const isActive = state === 'playing' || state === 'paused' || state === 'loading' || state === 'listening';
  const [showPanel, setShowPanel] = useState(false);

  return (
    <div className={`relative flex items-center gap-2 ${className || ''}`}>
      {/* Primary play/stop button */}
      <button
        onClick={() => {
          if (isActive) {
            stopPlayback();
          } else {
            startBriefing();
          }
        }}
        disabled={prefetchState === 'loading' && !isActive}
        className={`p-3 sm:p-2 rounded-xl sm:rounded-lg text-white transition-all active:scale-95 shadow-md ${
          isActive
            ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-500/20'
            : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-500/20'
        } ${state === 'loading' ? 'opacity-75 cursor-wait' : ''} disabled:opacity-50 disabled:cursor-not-allowed`}
        title={isActive ? 'Stop Briefing' : prefetchState === 'loading' ? 'Preparing...' : 'Listen to Briefing'}
      >
        {isActive ? (
          <Radio className="w-6 h-6 sm:w-5 sm:h-5 animate-pulse" />
        ) : state === 'loading' || prefetchState === 'loading' ? (
          <Loader2 className="w-6 h-6 sm:w-5 sm:h-5 animate-spin" />
        ) : (
          <Radio className="w-6 h-6 sm:w-5 sm:h-5" />
        )}
      </button>

      {/* In-call controls */}
      <AnimatePresence mode="wait">
        {isActive && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="flex items-center gap-2"
          >
            {state === 'playing' && (
              <button
                onClick={pausePlayback}
                className="p-3 sm:p-2 rounded-xl sm:rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition-all active:scale-95"
                title="Pause"
              >
                <Pause className="w-5 h-5 sm:w-4 sm:h-4" />
              </button>
            )}
            {state === 'paused' && (
              <button
                onClick={resumePlayback}
                className="p-3 sm:p-2 rounded-xl sm:rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-all active:scale-95"
                title="Resume"
              >
                <Play className="w-5 h-5 sm:w-4 sm:h-4" />
              </button>
            )}

            <button
              onClick={() => setIsMuted(!isMuted)}
              className={`p-3 sm:p-2 rounded-xl sm:rounded-lg transition-all active:scale-95 ${
                isMuted
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
              }`}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <VolumeX className="w-5 h-5 sm:w-4 sm:h-4" /> : <Volume2 className="w-5 h-5 sm:w-4 sm:h-4" />}
            </button>

            <button
              onClick={isRecording ? stopRecording : startRecording}
              className={`p-3 sm:p-2 rounded-xl sm:rounded-lg transition-all active:scale-95 ${
                isRecording
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white animate-pulse'
                  : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
              }`}
              title={isRecording ? 'Stop Recording' : 'Ask by Voice'}
            >
              {isRecording ? <Mic className="w-5 h-5 sm:w-4 sm:h-4" /> : <MicOff className="w-5 h-5 sm:w-4 sm:h-4" />}
            </button>

            <button
              onClick={stopPlayback}
              className="p-3 sm:p-2 rounded-xl sm:rounded-lg bg-rose-600 hover:bg-rose-700 text-white transition-all active:scale-95"
              title="End Briefing"
            >
              <PhoneOff className="w-5 h-5 sm:w-4 sm:h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* LIVE indicator */}
      {isActive && state !== 'loading' && (
        <div className="flex items-center gap-2 px-3 py-1.5 sm:px-2 sm:py-1 rounded-xl sm:rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200/50 dark:border-slate-700/50">
          <div className="w-2.5 h-2.5 sm:w-2 sm:h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
          <span className="text-[10px] sm:text-xs font-medium text-slate-600 dark:text-slate-400">
            {state === 'paused' ? 'PAUSED' : 'LIVE'}
          </span>
        </div>
      )}

      {/* Expandable transcript / question panel */}
      <AnimatePresence>
        {isActive && showPanel && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-full right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 p-3 z-50"
          >
            {transcript && (
              <div className="mb-3 max-h-40 overflow-y-auto text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 rounded-md p-2.5">
                {transcript}
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={currentQuestion}
                onChange={(e) => setCurrentQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && askQuestion()}
                placeholder="Ask a question..."
                className="flex-1 px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={() => askQuestion()}
                disabled={!currentQuestion.trim()}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toggle panel button when active */}
      {isActive && (
        <button
          onClick={() => setShowPanel(!showPanel)}
          className="p-3 sm:p-2 rounded-xl sm:rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-all active:scale-95"
          title="Show transcript & ask"
        >
          <Send className="w-5 h-5 sm:w-4 sm:h-4" />
        </button>
      )}
    </div>
  );
}

export default CohiPodcast;
