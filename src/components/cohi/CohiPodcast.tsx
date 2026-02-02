import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, Mic, MicOff, Phone, PhoneOff, Volume2, VolumeX, Loader2, Radio, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';

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

  const prefetchBriefing = useCallback(async () => {
    if (prefetchState === 'loading' || prefetchState === 'ready') return;
    
    setPrefetchState('loading');
    try {
      const response = await fetch('/api/podcast/cohi/briefing');
      if (!response.ok) throw new Error('Failed to prefetch briefing');
      
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
  }, [prefetchState]);

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
      
      const response = await fetch('/api/podcast/cohi/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: streamAbortRef.current.signal,
      });

      if (!response.ok) throw new Error('Failed to start briefing');

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

      const response = await fetch('/api/podcast/cohi/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) throw new Error('Failed to process question');

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

  return (
    <div className={`relative ${className || ''}`}>
      <motion.div
        className="bg-gradient-to-br from-blue-900/90 to-indigo-900/90 rounded-2xl p-6 shadow-xl border border-blue-700/30 backdrop-blur-sm"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="relative">
            <div className={`w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center ${state === 'playing' ? 'animate-pulse' : ''}`}>
              <Radio className="w-6 h-6 text-white" />
            </div>
            <AnimatePresence>
              {state === 'playing' && (
                <motion.div
                  className="absolute -inset-1 rounded-full border-2 border-blue-400"
                  initial={{ scale: 1, opacity: 1 }}
                  animate={{ scale: 1.3, opacity: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
              )}
            </AnimatePresence>
            {prefetchState === 'ready' && state === 'idle' && (
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center">
                <CheckCircle className="w-3 h-3 text-white" />
              </div>
            )}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Cohi Daily Briefing</h3>
            <p className="text-sm text-blue-200 flex items-center gap-1">
              {prefetchState === 'loading' && state === 'idle' && (
                <Loader2 className="w-3 h-3 animate-spin" />
              )}
              {getStatusText()}
            </p>
          </div>
        </div>

        {transcript && (
          <motion.div
            className="mb-4 p-4 bg-black/20 rounded-lg max-h-48 overflow-y-auto"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
          >
            <p className="text-sm text-blue-100 whitespace-pre-wrap">{transcript}</p>
          </motion.div>
        )}

        <div className="flex items-center gap-3">
          {state === 'idle' ? (
            <button
              onClick={startBriefing}
              disabled={prefetchState === 'loading'}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium"
            >
              {prefetchState === 'loading' ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Preparing...
                </>
              ) : (
                <>
                  <Play className="w-5 h-5" />
                  Start Briefing
                </>
              )}
            </button>
          ) : state === 'loading' ? (
            <button
              disabled
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600/50 text-white rounded-lg font-medium cursor-not-allowed"
            >
              <Loader2 className="w-5 h-5 animate-spin" />
              Connecting...
            </button>
          ) : state === 'paused' ? (
            <>
              <button
                onClick={resumePlayback}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors font-medium"
              >
                <Play className="w-5 h-5" />
                Resume
              </button>
              <button
                onClick={stopPlayback}
                className="px-4 py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
                title="End Call"
              >
                <PhoneOff className="w-5 h-5" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={pausePlayback}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg transition-colors font-medium"
              >
                <Pause className="w-5 h-5" />
                Pause
              </button>
              <button
                onClick={stopPlayback}
                className="px-4 py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
                title="End Call"
              >
                <PhoneOff className="w-5 h-5" />
              </button>
            </>
          )}

          <button
            onClick={() => setIsMuted(!isMuted)}
            className={`p-3 rounded-lg transition-colors ${isMuted ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-700 hover:bg-blue-600'} text-white`}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>

          {(state === 'playing' || state === 'paused') && (
            <button
              onClick={isRecording ? stopRecording : startRecording}
              className={`p-3 rounded-lg transition-colors ${isRecording ? 'bg-red-600 hover:bg-red-500 animate-pulse' : 'bg-green-600 hover:bg-green-500'} text-white`}
              title={isRecording ? 'Stop Recording' : 'Ask Question'}
            >
              {isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
          )}
        </div>

        {(state === 'playing' || state === 'paused') && (
          <div className="mt-4 flex items-center gap-2">
            <input
              type="text"
              value={currentQuestion}
              onChange={(e) => setCurrentQuestion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && askQuestion()}
              placeholder="Type a question..."
              className="flex-1 px-4 py-2 bg-black/20 border border-blue-600/30 rounded-lg text-white placeholder-blue-300/50 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => askQuestion()}
              disabled={!currentQuestion.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              Ask
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

export default CohiPodcast;
