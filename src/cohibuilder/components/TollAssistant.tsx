import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import {
  X,
  Mic,
  MicOff,
  Sparkles,
  BrainCircuit,
  MessageSquare,
  Send,
  Loader2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { buildCohiSystemInstruction } from '../lib/cohiAssistantContext';
import { useCohiBuilderPortfolio } from '../contexts/CohiBuilderPortfolioContext';

interface TollAssistantProps {
  isOpen: boolean;
  onClose: () => void;
}

type PanelTab = 'chat' | 'voice';

type ChatTurn = { role: 'user' | 'model'; text: string };

type TranscriptLine = { role: 'user' | 'model'; text: string };

const CHAT_MODEL = 'gemini-2.5-flash';

function getGeminiApiKey(): string | undefined {
  const k = import.meta.env.VITE_GEMINI_API_KEY;
  return typeof k === 'string' && k.trim().length > 0 ? k.trim() : undefined;
}

export default function TollAssistant({ isOpen, onClose }: TollAssistantProps) {
  const { allLoans, expiringDocs, riskFactors, respaApps } = useCohiBuilderPortfolio();
  const [panelTab, setPanelTab] = useState<PanelTab>('chat');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  const [chatMessages, setChatMessages] = useState<ChatTurn[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const [voiceTranscript, setVoiceTranscript] = useState<TranscriptLine[]>([]);

  const sessionRef = useRef<{ sendRealtimeInput: (input: object) => void; close: () => void } | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueue = useRef<Int16Array[]>([]);
  const isPlayingRef = useRef(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const systemInstruction = useMemo(
    () => buildCohiSystemInstruction({ allLoans, expiringDocs, riskFactors, respaApps }),
    [allLoans, expiringDocs, riskFactors, respaApps],
  );

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading, panelTab]);

  const sendChatMessage = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;

    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      setConfigError(
        'Add VITE_GEMINI_API_KEY to your .env file (see .env.example). Restart the dev server after saving.'
      );
      return;
    }

    const nextHistory: ChatTurn[] = [...chatMessages, { role: 'user', text }];
    setChatMessages(nextHistory);
    setChatInput('');
    setChatLoading(true);
    setChatError(null);
    setConfigError(null);

    try {
      const ai = new GoogleGenAI({ apiKey });
      const contents = nextHistory.map((m) => ({
        role: m.role,
        parts: [{ text: m.text }],
      }));

      const response = await ai.models.generateContent({
        model: CHAT_MODEL,
        contents,
        config: {
          systemInstruction,
          temperature: 0.65,
          maxOutputTokens: 2048,
        },
      });

      const reply = response.text?.trim() || 'No text returned from the model.';
      setChatMessages((prev) => [...prev, { role: 'model', text: reply }]);
    } catch (err) {
      console.error('Chat error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setChatError(msg);
      setChatMessages((prev) => prev.slice(0, -1));
      setChatInput(text);
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, chatLoading, chatMessages, systemInstruction]);

  const startSession = async () => {
    setConfigError(null);
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      setConfigError(
        'Add VITE_GEMINI_API_KEY to your .env file (see .env.example). Restart the dev server after saving.'
      );
      return;
    }
    setIsConnecting(true);
    setVoiceTranscript([]);
    try {
      const ai = new GoogleGenAI({ apiKey });

      const session = await ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            setIsConnecting(false);
            startMic();
          },
          onmessage: async (message: LiveServerMessage) => {
            const sc = message.serverContent;
            if (sc?.inputTranscription?.text && sc.inputTranscription.finished) {
              setVoiceTranscript((prev) => [
                ...prev.slice(-24),
                { role: 'user', text: sc.inputTranscription!.text! },
              ]);
            }
            if (sc?.outputTranscription?.text && sc.outputTranscription.finished) {
              setVoiceTranscript((prev) => [
                ...prev.slice(-24),
                { role: 'model', text: sc.outputTranscription!.text! },
              ]);
            }

            if (sc?.modelTurn?.parts?.[0]?.inlineData?.data) {
              const base64Audio = sc.modelTurn.parts[0].inlineData.data;
              const binaryString = atob(base64Audio);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              const pcmData = new Int16Array(bytes.buffer);
              audioQueue.current.push(pcmData);
              if (!isPlayingRef.current) playNextChunk();
            }

            if (sc?.interrupted) {
              audioQueue.current = [];
              setIsSpeaking(false);
            }
          },
          onclose: () => {
            stopMic();
            setIsConnected(false);
          },
          onerror: (err) => {
            console.error('Live API Error:', err);
            setIsConnecting(false);
          },
        },
      });

      sessionRef.current = session;
    } catch (err) {
      console.error('Failed to connect:', err);
      setIsConnecting(false);
      setConfigError(err instanceof Error ? err.message : 'Could not start voice session.');
    }
  };

  const startMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (isMuted) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7fff;
        }

        const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
        sessionRef.current?.sendRealtimeInput({
          audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' },
        });
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
    } catch (err) {
      console.error('Mic access denied:', err);
    }
  };

  const stopMic = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    processorRef.current?.disconnect();
    void audioContextRef.current?.close();
  };

  const playNextChunk = async () => {
    if (audioQueue.current.length === 0) {
      isPlayingRef.current = false;
      setIsSpeaking(false);
      return;
    }

    isPlayingRef.current = true;
    setIsSpeaking(true);
    const chunk = audioQueue.current.shift()!;

    const audioContext = new AudioContext({ sampleRate: 24000 });
    const buffer = audioContext.createBuffer(1, chunk.length, 24000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < chunk.length; i++) {
      channelData[i] = chunk[i] / 0x7fff;
    }

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.onended = () => {
      void audioContext.close();
      playNextChunk();
    };
    source.start();
  };

  const endVoiceSession = () => {
    sessionRef.current?.close();
    sessionRef.current = null;
    stopMic();
    setIsConnected(false);
    setIsConnecting(false);
  };

  const handleClose = () => {
    endVoiceSession();
    setConfigError(null);
    setChatError(null);
    onClose();
  };

  const panel = (
    <AnimatePresence>
      {isOpen && (
        <div
          className="pointer-events-none fixed inset-0 z-[99999] flex items-end justify-center px-4 pt-4 pb-[calc(1rem+3in)] sm:px-8 sm:pt-8 sm:pb-[calc(2rem+3in)]"
          role="presentation"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="pointer-events-auto w-full max-w-md sm:max-w-lg card-base overflow-hidden shadow-2xl shadow-slate-900/15 flex flex-col max-h-[min(88vh,720px)]"
          >
          {/* Header */}
          <div className="relative overflow-hidden border-b border-white/40 bg-white/35 backdrop-blur-xl shrink-0">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_10%,rgba(59,130,246,0.22),transparent_55%),radial-gradient(circle_at_90%_80%,rgba(34,211,238,0.18),transparent_55%)] pointer-events-none" />
            <div className="relative p-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center shadow-sm ring-1 ring-white/40 shrink-0">
                  <BrainCircuit size={22} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold tracking-tight text-slate-900 truncate">Ask Cohi</h3>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        isConnected
                          ? 'bg-emerald-50/70 text-emerald-700 border-emerald-200/60'
                          : isConnecting
                            ? 'bg-amber-50/70 text-amber-700 border-amber-200/60'
                            : 'bg-slate-50/70 text-slate-700 border-slate-200/60'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isConnected ? 'bg-emerald-500' : isConnecting ? 'bg-amber-500' : 'bg-slate-400'
                        }`}
                      />
                      {panelTab === 'voice'
                        ? isConnected
                          ? 'Voice live'
                          : isConnecting
                            ? 'Connecting…'
                            : 'Voice ready'
                        : 'Gemini chat'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 font-medium truncate">
                    Chat + agentic voice · same portfolio context
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="p-2.5 hover:bg-white/50 rounded-xl transition-colors text-slate-700 shrink-0"
                aria-label="Close assistant"
              >
                <X size={18} />
              </button>
            </div>

            {/* Tabs */}
            <div className="relative px-4 pb-3 flex gap-2">
              <button
                type="button"
                onClick={() => setPanelTab('chat')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  panelTab === 'chat'
                    ? 'bg-white/80 text-blue-700 shadow-sm border border-blue-200/60'
                    : 'bg-white/25 text-slate-600 border border-transparent hover:bg-white/40'
                }`}
              >
                <MessageSquare size={16} />
                Chat
              </button>
              <button
                type="button"
                onClick={() => setPanelTab('voice')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  panelTab === 'voice'
                    ? 'bg-white/80 text-indigo-700 shadow-sm border border-indigo-200/60'
                    : 'bg-white/25 text-slate-600 border border-transparent hover:bg-white/40'
                }`}
              >
                <Mic size={16} />
                Voice
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 min-h-0 flex flex-col bg-white/15 backdrop-blur-sm relative">
            {panelTab === 'chat' && (
              <div className="flex-1 min-h-0 flex flex-col">
                <div className="flex-1 min-h-[200px] max-h-[min(42vh,380px)] overflow-y-auto px-4 py-3 space-y-3">
                  {chatMessages.length === 0 && !chatLoading && (
                    <div className="text-left space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-white/55 border border-white/60 shadow-sm flex items-center justify-center text-blue-700 shrink-0">
                          <Sparkles size={20} />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Cohi Builder · builder-affiliated mortgage ops</p>
                          <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                            Capture, readiness over long build cycles, fallout during construction, locks, and docs—grounded in your current portfolio snapshot (demo).
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {[
                          'Summarize high-risk loans today',
                          'How does capture look vs. contracts in the demo data?',
                          'Any rate locks expiring this month?',
                        ].map((q) => (
                          <button
                            key={q}
                            type="button"
                            onClick={() => {
                              setChatInput(q);
                            }}
                            className="text-left text-xs font-medium px-3 py-2 rounded-xl bg-white/50 border border-white/60 text-slate-700 hover:bg-white/75 transition-colors"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {chatMessages.map((m, i) => (
                    <div
                      key={i}
                      className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                          m.role === 'user'
                            ? 'bg-blue-600 text-white rounded-br-md'
                            : 'bg-white/80 border border-slate-200/80 text-slate-800 rounded-bl-md shadow-sm'
                        }`}
                      >
                        <span className="block whitespace-pre-wrap">{m.text}</span>
                      </div>
                    </div>
                  ))}

                  {chatLoading && (
                    <div className="flex justify-start">
                      <div className="rounded-2xl rounded-bl-md px-4 py-3 bg-white/70 border border-slate-200/80 flex items-center gap-2 text-slate-500 text-sm">
                        <Loader2 size={16} className="animate-spin" />
                        Cohi is thinking…
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {(configError || chatError) && (
                  <div className="px-4 pb-2">
                    <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                      {configError || chatError}
                    </p>
                  </div>
                )}

                <div className="p-3 border-t border-white/40 bg-white/10 shrink-0">
                  <div className="flex gap-2">
                    <textarea
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void sendChatMessage();
                        }
                      }}
                      placeholder="Message Cohi…"
                      rows={2}
                      className="flex-1 resize-none rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400/40"
                    />
                    <button
                      type="button"
                      onClick={() => void sendChatMessage()}
                      disabled={chatLoading || !chatInput.trim()}
                      className="self-end p-3 rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                      aria-label="Send message"
                    >
                      {chatLoading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-2 text-center font-medium">
                    Enter to send · Shift+Enter for newline
                  </p>
                </div>
              </div>
            )}

            {panelTab === 'voice' && (
              <div className="flex-1 flex flex-col min-h-[260px] p-4 sm:p-5">
                {!isConnected && !isConnecting ? (
                  <div className="text-left space-y-4 flex-1 flex flex-col">
                    <div className="flex items-start gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-white/55 border border-white/60 shadow-sm flex items-center justify-center text-indigo-700 shrink-0">
                        <Mic size={22} />
                      </div>
                      <div>
                        <h4 className="text-base font-semibold text-slate-900">Live voice (Gemini)</h4>
                        <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                          Same builder–mortgage performance brief as chat (capture, construction-cycle readiness, risk). Transcripts appear when the model provides them.
                        </p>
                      </div>
                    </div>

                    {configError && (
                      <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                        {configError}
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={() => void startSession()}
                      className="w-full py-3.5 bg-indigo-600 text-white rounded-2xl text-sm font-semibold hover:bg-indigo-700 transition-all shadow-sm flex items-center justify-center gap-2 mt-auto"
                    >
                      <Mic size={18} />
                      Start voice session
                    </button>
                  </div>
                ) : isConnecting ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-4">
                    <div className="flex justify-center gap-1">
                      {[0, 1, 2].map((i) => (
                        <motion.div
                          key={i}
                          animate={{ height: [10, 28, 10] }}
                          transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.1 }}
                          className="w-1.5 bg-indigo-500 rounded-full"
                        />
                      ))}
                    </div>
                    <p className="text-sm text-slate-600 font-semibold">Connecting to Gemini Live…</p>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col gap-4 min-h-0">
                    <div className="flex items-center justify-center gap-1.5 h-20 shrink-0">
                      {Array.from({ length: 12 }).map((_, i) => (
                        <motion.div
                          key={i}
                          animate={{
                            height: isSpeaking ? [8, 8 + Math.random() * 36, 8] : [8, 12, 8],
                            opacity: isSpeaking ? 1 : 0.45,
                          }}
                          transition={{ repeat: Infinity, duration: 0.45, delay: i * 0.04 }}
                          className="w-1.5 bg-indigo-500 rounded-full"
                        />
                      ))}
                    </div>

                    <div className="flex-1 min-h-0 rounded-xl border border-white/50 bg-white/30 overflow-hidden flex flex-col">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-3 py-2 border-b border-white/40 shrink-0">
                        Live transcript
                      </p>
                      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 text-xs">
                        {voiceTranscript.length === 0 ? (
                          <p className="text-slate-500 italic py-2">Speak naturally—lines appear as turns complete.</p>
                        ) : (
                          voiceTranscript.map((line, idx) => (
                            <div
                              key={idx}
                              className={`rounded-lg px-2.5 py-1.5 ${
                                line.role === 'user'
                                  ? 'bg-blue-50/90 text-slate-800 ml-4'
                                  : 'bg-white/80 text-slate-800 mr-4 border border-slate-200/60'
                              }`}
                            >
                              <span className="font-bold text-[10px] uppercase text-slate-500 block mb-0.5">
                                {line.role === 'user' ? 'You' : 'Cohi'}
                              </span>
                              {line.text}
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-center gap-3 shrink-0">
                      <button
                        type="button"
                        onClick={() => setIsMuted(!isMuted)}
                        className={`p-3.5 rounded-xl transition-colors border ${
                          isMuted
                            ? 'bg-rose-50 text-rose-600 border-rose-200'
                            : 'bg-white/50 text-slate-700 border-white/60 hover:bg-white/70'
                        }`}
                        aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                      >
                        {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
                      </button>
                      <button
                        type="button"
                        onClick={endVoiceSession}
                        className="px-6 py-3.5 bg-rose-500 text-white rounded-xl font-semibold text-sm hover:bg-rose-600 transition-colors"
                      >
                        End voice
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="px-4 py-2.5 bg-white/15 backdrop-blur-sm border-t border-white/40 text-center shrink-0">
            <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">www.coheus.com</p>
          </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(panel, document.body);
}
