import { useState, useEffect, useRef } from 'react';
import { X, Mic, MicOff } from 'lucide-react';
import { ParticleBackground } from './ParticleBackground';
import { motion, AnimatePresence } from 'framer-motion';
import { AudioRecorder, encodeAudioForAPI, AudioQueue } from '@/utils/audioUtils';
import { useToast } from '@/hooks/use-toast';
import { ConsentBadge } from './ConsentBadge';

interface Message {
  role: 'Cam' | 'Applicant' | 'System';
  text: string;
  timestamp: Date;
  metadata?: {
    type?: string;
    agree?: boolean;
    at?: string;
  };
}

interface LunaModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LunaModal({ isOpen, onClose }: LunaModalProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [consentAt, setConsentAt] = useState<string | null>(null);
  const [showConsentBar, setShowConsentBar] = useState(false);
  const [hasPromptedConsent, setHasPromptedConsent] = useState(false);
  const [sessionStartTime, setSessionStartTime] = useState<number>(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioRecorderRef = useRef<AudioRecorder | null>(null);
  const audioQueueRef = useRef<AudioQueue | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      setSessionStartTime(Date.now());
      startConnection();
    } else {
      cleanup();
    }

    return () => cleanup();
  }, [isOpen]);

  // Timer for consent prompt (~60 seconds)
  useEffect(() => {
    if (!isListening || hasPromptedConsent || consentAt) return;
    
    const checkTimer = setInterval(() => {
      const elapsed = (Date.now() - sessionStartTime) / 1000;
      if (elapsed >= 60) {
        setShowConsentBar(true);
        setHasPromptedConsent(true);
        
        const consentPrompt = "Before we go further, do you agree to Coheus' Terms & Conditions and privacy policy? I'm a virtual loan application assistant, and with your okay I'll help move your application faster—with care. Shall we proceed?";
        
        setMessages(prev => [...prev, {
          role: 'Cam',
          text: consentPrompt,
          timestamp: new Date(),
          metadata: { type: 'consent_prompt' }
        }]);
        
        clearInterval(checkTimer);
      }
    }, 1000);

    return () => clearInterval(checkTimer);
  }, [isListening, hasPromptedConsent, consentAt, sessionStartTime]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentTranscript]);

  const startConnection = async () => {
    try {
      setIsConnecting(true);
      console.log('Starting Cam connection...');

      // Initialize audio context
      audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      audioQueueRef.current = new AudioQueue(audioContextRef.current);

      // Request microphone permission
      await navigator.mediaDevices.getUserMedia({ audio: true });

      // Connect to WebSocket via API Gateway
      const { api } = await import('@/lib/api');
      wsRef.current = api.createWebSocket('maylin-realtime'); // Note: Luna uses same as Maylin

      wsRef.current.onopen = () => {
        console.log('WebSocket connected');
        setIsConnecting(false);
        setIsListening(true);
        startAudioRecording();
        
        toast({
          title: 'Connected to Cam',
          description: 'Voice assistant is ready',
        });
      };

      wsRef.current.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        console.log('Received:', data.type);

        // Handle audio response
        if (data.type === 'response.audio.delta' && data.delta) {
          const binaryString = atob(data.delta);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          await audioQueueRef.current?.addToQueue(bytes);
        }

        // Handle transcription of user speech
        if (data.type === 'conversation.item.input_audio_transcription.completed') {
          setMessages(prev => [...prev, {
            role: 'Applicant',
            text: data.transcript,
            timestamp: new Date()
          }]);
        }

        // Handle Maylin's text response
        if (data.type === 'response.audio_transcript.delta') {
          setCurrentTranscript(prev => prev + data.delta);
        }

        if (data.type === 'response.audio_transcript.done') {
          if (currentTranscript) {
            setMessages(prev => [...prev, {
              role: 'Cam',
              text: currentTranscript,
              timestamp: new Date()
            }]);
            setCurrentTranscript('');
          }
        }

        // Handle errors
        if (data.type === 'error') {
          console.error('OpenAI error:', data);
          toast({
            title: 'Error',
            description: data.error?.message || 'An error occurred',
            variant: 'destructive',
          });
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        toast({
          title: 'Connection Error',
          description: 'Failed to connect to voice assistant',
          variant: 'destructive',
        });
        setIsConnecting(false);
      };

      wsRef.current.onclose = () => {
        console.log('WebSocket closed');
        setIsListening(false);
        setIsConnecting(false);
      };

    } catch (error) {
      console.error('Error starting connection:', error);
      toast({
        title: 'Error',
        description: 'Failed to initialize voice assistant',
        variant: 'destructive',
      });
      setIsConnecting(false);
    }
  };

  const startAudioRecording = async () => {
    try {
      audioRecorderRef.current = new AudioRecorder((audioData) => {
        if (wsRef.current?.readyState === WebSocket.OPEN && !isMuted) {
          const encoded = encodeAudioForAPI(audioData);
          wsRef.current.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: encoded
          }));
        }
      });

      await audioRecorderRef.current.start();
      console.log('Audio recording started');
    } catch (error) {
      console.error('Error starting audio recording:', error);
      toast({
        title: 'Microphone Error',
        description: 'Failed to access microphone',
        variant: 'destructive',
      });
    }
  };

  const toggleMute = () => {
    const newMutedState = !isMuted;
    setIsMuted(newMutedState);
    console.log('Mute toggled:', newMutedState ? 'MUTED' : 'UNMUTED');
    toast({
      title: newMutedState ? 'Microphone Muted' : 'Microphone Unmuted',
      description: newMutedState ? 'Maylin cannot hear you' : 'Maylin can hear you now',
    });
  };

  const handleConsent = (agree: boolean) => {
    const timestamp = new Date().toISOString();
    
    if (agree) {
      setConsentAt(timestamp);
      setShowConsentBar(false);
      
      setMessages(prev => [...prev, 
        {
          role: 'Applicant',
          text: 'Yes, I agree.',
          timestamp: new Date(),
          metadata: { type: 'consent_response', agree: true }
        },
        {
          role: 'System',
          text: 'Consent captured',
          timestamp: new Date(),
          metadata: { type: 'consent_captured', at: timestamp }
        },
        {
          role: 'Cam',
          text: "Great—thanks! I'll securely collect only what's needed and keep things moving.",
          timestamp: new Date()
        }
      ]);
      
      toast({
        title: 'Consent Captured',
        description: 'Your agreement has been logged and timestamped.',
      });
    } else {
      setShowConsentBar(false);
      
      setMessages(prev => [...prev,
        {
          role: 'Applicant',
          text: 'No, I do not agree.',
          timestamp: new Date(),
          metadata: { type: 'consent_response', agree: false }
        },
        {
          role: 'Cam',
          text: "No problem. I'll pause here and connect you to a loan specialist who can assist you directly.",
          timestamp: new Date()
        }
      ]);
      
      toast({
        title: 'Consent Declined',
        description: 'Connecting you to a loan specialist...',
        variant: 'destructive',
      });
      
      // TODO: Trigger human handoff
      setTimeout(() => onClose(), 3000);
    }
  };

  const cleanup = () => {
    console.log('Cleaning up Maylin connection...');
    audioRecorderRef.current?.stop();
    audioQueueRef.current?.clear();
    audioContextRef.current?.close();
    wsRef.current?.close();
    setMessages([]);
    setIsListening(false);
    setIsMuted(false);
    setCurrentTranscript('');
    setConsentAt(null);
    setShowConsentBar(false);
    setHasPromptedConsent(false);
    setSessionStartTime(0);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ backgroundColor: '#f8fafc' }}
      >
        <ParticleBackground speed={0.4} particleCount={80} />

        <button
          onClick={onClose}
          className="absolute top-8 right-8 z-50 p-3 rounded-full bg-white/90 backdrop-blur-sm hover:bg-red-50 hover:scale-110 transition-all duration-200 shadow-xl border border-gray-200"
          aria-label="Close"
        >
          <X className="w-6 h-6 text-gray-700 hover:text-red-600" />
        </button>

        <div className="relative z-10 flex flex-col items-center justify-center w-full h-full px-8 py-16">
          
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', duration: 0.6 }}
            className="relative mb-8"
          >
            <div 
              className={`w-32 h-32 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center shadow-2xl ${
                isListening && !isMuted ? 'animate-pulse' : ''
              }`}
              style={{
                boxShadow: '0 0 60px rgba(180, 220, 255, 0.6)',
              }}
            >
              {isListening && !isMuted && (
                <>
                  <div 
                    className="absolute inset-0 rounded-full border-4 border-blue-300 animate-ping"
                    style={{ animationDuration: '1.5s' }}
                  />
                  <div 
                    className="absolute inset-0 rounded-full border-2 border-blue-400 animate-ping"
                    style={{ animationDuration: '2s', animationDelay: '0.3s' }}
                  />
                </>
              )}
              
              <div className="text-4xl font-bold text-blue-600">L</div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-center mb-12 max-w-2xl"
          >
            <h2 className="text-2xl font-semibold text-gray-800 mb-2">
              Alethia
            </h2>
            <p className="text-gray-600">
              {isConnecting ? 'Connecting...' : isListening ? "Hi! I'm Cam. How can I help with your loan today?" : 'Ready to assist you'}
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5 }}
            className="mb-8"
          >
            <button
              onClick={toggleMute}
              disabled={isConnecting || !isListening}
              className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 ${
                isListening && !isMuted
                  ? "bg-blue-100 shadow-[0_0_25px_rgba(150,200,255,0.6)] scale-105"
                  : "bg-gray-100 shadow-inner scale-100"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? (
                <MicOff className="text-gray-400" size={36} />
              ) : (
                <Mic className={isListening ? "text-blue-600" : "text-gray-400"} size={36} />
              )}
            </button>
            
            <div className="text-center mt-3 text-sm text-gray-600">
              {isConnecting ? 'Connecting...' : isMuted ? 'Microphone Muted' : 'Listening...'}
            </div>
            
            <div className="flex justify-center">
              <ConsentBadge consentAt={consentAt} />
            </div>
          </motion.div>

          {/* Consent Bar */}
          {showConsentBar && !consentAt && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-8 w-full max-w-3xl p-4 rounded-xl border border-gray-200 bg-white/90 backdrop-blur-sm shadow-lg"
              role="dialog"
              aria-live="polite"
            >
              <div className="text-sm text-gray-800 mb-3">
                Before we go further, do you agree to Coheus'{' '}
                <button className="underline underline-offset-2 hover:text-blue-600">
                  Terms & Conditions
                </button>{' '}
                and privacy policy? I'm a <strong>virtual loan application assistant</strong>, and with your okay I'll help move your application <em>faster—with care</em>.
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleConsent(true)}
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 active:scale-[0.99] transition-all"
                >
                  Agree & Continue
                </button>
                <button
                  onClick={() => handleConsent(false)}
                  className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 active:scale-[0.99] transition-all"
                >
                  No, connect me to a specialist
                </button>
              </div>
            </motion.div>
          )}

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
            className="w-full max-w-3xl h-[45vh] flex flex-col bg-white rounded-2xl shadow-xl overflow-hidden"
            style={{
              backdropFilter: 'blur(10px)',
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
            }}
          >
            <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-white">
              <h3 className="text-lg font-semibold text-gray-800">
                Live Conversation
              </h3>
            </div>
            
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 scroll-smooth">
              {messages.length === 0 ? (
                <p className="text-gray-400 text-center py-8">
                  {isConnecting ? 'Connecting to Cam...' : 'Start speaking to begin the conversation...'}
                </p>
              ) : (
                messages.map((message, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3 }}
                    className="flex flex-col"
                  >
                    <div className="flex items-start gap-2">
                      <span 
                        className={`font-semibold ${
                          message.role === 'Cam' ? 'text-blue-600' : 
                          message.role === 'System' ? 'text-emerald-600' : 
                          'text-gray-600'
                        }`}
                      >
                        {message.role}:
                      </span>
                      <span className="text-gray-800 flex-1">
                        {message.text}
                        {message.metadata?.type === 'consent_captured' && (
                          <span className="ml-2 text-emerald-700">[consent ✓]</span>
                        )}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400 mt-1 ml-auto">
                      {message.timestamp.toLocaleTimeString()}
                    </span>
                  </motion.div>
                ))
              )}
              {currentTranscript && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-start gap-2 text-gray-500 italic"
                >
                  <span className="font-semibold text-blue-600">Cam:</span>
                  <span className="flex-1">{currentTranscript}...</span>
                </motion.div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
