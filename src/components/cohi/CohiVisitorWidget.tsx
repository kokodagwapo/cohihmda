import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, Mic, MicOff, Send, Volume2, VolumeX, Loader2, X, MessageSquare, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface CohiVisitorWidgetProps {
  className?: string;
  prefetchedBriefing?: { script: string; metrics: any } | null;
  prefetchState?: 'idle' | 'loading' | 'ready' | 'error';
}

type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'listening';

interface Message {
  role: 'user' | 'assistant';
  content: string;
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

export function CohiVisitorWidget({ className, prefetchedBriefing, prefetchState = 'idle' }: CohiVisitorWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [state, setState] = useState<PlaybackState>('idle');
  const [transcript, setTranscript] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [hasPlayedBriefing, setHasPlayedBriefing] = useState(false);

  const isMutedRef = useRef(isMuted);
  const isPausedRef = useRef(false);
  const audioBufferRef = useRef<Float32Array[]>([]);
  const streamAbortRef = useRef<AbortController | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
    }
  }, []);

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

  const playBriefing = useCallback(async () => {
    if (!prefetchedBriefing?.script) return;

    await initAudio();
    setState('loading');
    setTranscript('');
    setHasPlayedBriefing(true);
    
    setMessages(prev => [...prev, { role: 'assistant', content: prefetchedBriefing.script }]);

    try {
      const controller = new AbortController();
      streamAbortRef.current = controller;

      const response = await fetch('/api/podcast/cohi/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: prefetchedBriefing.script }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error('Stream failed');

      setState('playing');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader');

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
            if (event.type === 'audio' && event.data && !isMutedRef.current) {
              pushAudio(event.data);
            } else if (event.type === 'transcript' && event.data) {
              setTranscript(prev => prev + event.data);
            } else if (event.type === 'done') {
              signalComplete();
            }
          } catch (e) {}
        }
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Briefing stream error:', error);
        setState('idle');
      }
    }
  }, [prefetchedBriefing, initAudio, pushAudio, signalComplete]);

  const sendTextQuestion = useCallback(async (question: string) => {
    if (!question.trim()) return;

    await initAudio();
    setState('loading');
    setTranscript('');
    
    setMessages(prev => [...prev, { role: 'user', content: question }]);
    setInputValue('');

    try {
      const controller = new AbortController();
      streamAbortRef.current = controller;

      const response = await fetch('/api/podcast/cohi/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error('Ask failed');

      setState('playing');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let buffer = '';
      let fullTranscript = '';

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
            if (event.type === 'audio' && event.data && !isMutedRef.current) {
              pushAudio(event.data);
            } else if (event.type === 'transcript' && event.data) {
              fullTranscript += event.data;
              setTranscript(prev => prev + event.data);
            } else if (event.type === 'done') {
              signalComplete();
              if (event.transcript) {
                fullTranscript = event.transcript;
              }
            }
          } catch (e) {}
        }
      }

      if (fullTranscript) {
        setMessages(prev => [...prev, { role: 'assistant', content: fullTranscript }]);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Ask error:', error);
        setState('idle');
      }
    }
  }, [initAudio, pushAudio, signalComplete]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const arrayBuffer = await blob.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
        
        await initAudio();
        setState('loading');
        setTranscript('');

        try {
          const controller = new AbortController();
          streamAbortRef.current = controller;

          const response = await fetch('/api/podcast/cohi/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audio: base64 }),
            signal: controller.signal,
          });

          if (!response.ok) throw new Error('Voice ask failed');

          setState('playing');
          const reader = response.body?.getReader();
          if (!reader) throw new Error('No reader');

          const decoder = new TextDecoder();
          let buffer = '';
          let fullTranscript = '';
          let userQuestion = '';

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
                if (event.type === 'user_question') {
                  userQuestion = event.data;
                  setMessages(prev => [...prev, { role: 'user', content: userQuestion }]);
                } else if (event.type === 'audio' && event.data && !isMutedRef.current) {
                  pushAudio(event.data);
                } else if (event.type === 'transcript' && event.data) {
                  fullTranscript += event.data;
                  setTranscript(prev => prev + event.data);
                } else if (event.type === 'done') {
                  signalComplete();
                  if (event.transcript) fullTranscript = event.transcript;
                }
              } catch (e) {}
            }
          }

          if (fullTranscript) {
            setMessages(prev => [...prev, { role: 'assistant', content: fullTranscript }]);
          }
        } catch (error: any) {
          if (error.name !== 'AbortError') {
            console.error('Voice ask error:', error);
            setState('idle');
          }
        }
      };
      
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (error) {
      console.error('Failed to start recording:', error);
    }
  }, [initAudio, pushAudio, signalComplete]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, [isRecording]);

  const togglePause = useCallback(() => {
    if (state === 'playing') {
      audioCtxRef.current?.suspend();
      isPausedRef.current = true;
      setState('paused');
    } else if (state === 'paused') {
      audioCtxRef.current?.resume();
      isPausedRef.current = false;
      audioBufferRef.current.forEach(samples => {
        workletRef.current?.port.postMessage({ type: 'audio', samples });
      });
      audioBufferRef.current = [];
      setState('playing');
    }
  }, [state]);

  const handleStop = useCallback(() => {
    streamAbortRef.current?.abort();
    clearAudio();
    setState('idle');
    setTranscript('');
  }, [clearAudio]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendTextQuestion(inputValue);
    }
  };

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className={`fixed bottom-[90px] right-6 w-96 max-w-[calc(100vw-48px)] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden z-50 ${className}`}
          >
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-white font-semibold text-sm">Cohi</h3>
                  <p className="text-white/80 text-xs">AI Executive Assistant</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {prefetchState === 'ready' && !hasPlayedBriefing && (
                  <span className="text-xs bg-emerald-500 text-white px-2 py-0.5 rounded-full">Ready</span>
                )}
                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className="p-1.5 hover:bg-white/20 rounded-full transition-colors"
                >
                  {isMuted ? <VolumeX className="w-4 h-4 text-white" /> : <Volume2 className="w-4 h-4 text-white" />}
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 hover:bg-white/20 rounded-full transition-colors"
                >
                  <X className="w-4 h-4 text-white" />
                </button>
              </div>
            </div>

            <div className="h-80 overflow-y-auto p-4 space-y-4 bg-slate-50">
              {messages.length === 0 && prefetchState === 'ready' && !hasPlayedBriefing ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                    <Sparkles className="w-8 h-8 text-white" />
                  </div>
                  <p className="text-slate-600 text-sm mb-4">Your executive briefing is ready.</p>
                  <Button
                    onClick={playBriefing}
                    disabled={state === 'loading'}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {state === 'loading' ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4 mr-2" />
                    )}
                    Play Briefing
                  </Button>
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                    <MessageSquare className="w-8 h-8 text-white" />
                  </div>
                  <p className="text-slate-600 text-sm">Ask Cohi about mortgage metrics, pipeline performance, or market insights.</p>
                </div>
              ) : (
                messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white rounded-br-md'
                        : 'bg-white text-slate-800 border border-slate-200 rounded-bl-md shadow-sm'
                    }`}>
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                ))
              )}

              {state === 'playing' && transcript && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl px-4 py-2.5 bg-white text-slate-800 border border-blue-200 rounded-bl-md shadow-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="flex gap-0.5">
                        <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                        <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
                        <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
                      </div>
                      <span className="text-xs text-blue-600">Speaking...</span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{transcript}</p>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-3 bg-white border-t border-slate-200">
              {state === 'playing' || state === 'paused' ? (
                <div className="flex items-center justify-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={togglePause}
                    className="flex-1"
                  >
                    {state === 'paused' ? (
                      <>
                        <Play className="w-4 h-4 mr-2" />
                        Resume
                      </>
                    ) : (
                      <>
                        <Pause className="w-4 h-4 mr-2" />
                        Pause
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleStop}
                    className="flex-1"
                  >
                    Stop
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask Cohi anything..."
                    disabled={state === 'loading' || isRecording}
                    className="flex-1"
                  />
                  <Button
                    size="icon"
                    variant={isRecording ? 'destructive' : 'outline'}
                    onClick={isRecording ? stopRecording : startRecording}
                    disabled={state === 'loading'}
                    title={isRecording ? 'Stop recording' : 'Start voice input'}
                  >
                    {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </Button>
                  <Button
                    size="icon"
                    onClick={() => sendTextQuestion(inputValue)}
                    disabled={state === 'loading' || !inputValue.trim()}
                  >
                    {state === 'loading' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-[18px] right-6 w-14 h-14 rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg flex items-center justify-center z-50 ${
          prefetchState === 'ready' && !hasPlayedBriefing ? 'ring-4 ring-emerald-400 ring-opacity-50' : ''
        }`}
      >
        {isOpen ? (
          <X className="w-6 h-6" />
        ) : (
          <div className="relative">
            <Sparkles className="w-6 h-6" />
            {prefetchState === 'ready' && !hasPlayedBriefing && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full animate-pulse" />
            )}
          </div>
        )}
      </motion.button>
    </>
  );
}

export default CohiVisitorWidget;
