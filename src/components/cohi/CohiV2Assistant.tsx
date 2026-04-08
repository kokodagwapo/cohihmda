import { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOff, Mic, MicOff, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';

interface CohiV2AssistantProps {
  className?: string;
}

export function CohiV2Assistant({ className }: CohiV2AssistantProps) {
  const [isInCall, setIsInCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const { toast } = useToast();

  // Backend architecture knowledge base
  const backendArchitectureKnowledge = `
You are Cohi, a female-voiced AI assistant specializing in the Coheus v2 backend architecture. You have comprehensive knowledge of the entire backend system design and can answer questions from engineers about:

ARCHITECTURE OVERVIEW:
- Coheus v2 is built on Node.js 20+, PostgreSQL + Redis, AWS-native infrastructure
- Uses EC2 for stateful services (WebSocket connections, in-memory state)
- Supports persistent WebSocket connections for voice (Cohi requires 15+ minute conversation context)
- Real-time sync with multiple LOS systems
- Enterprise-grade compliance (SOC 2 Type II, HIPAA-ready)

LOS ADAPTER PATTERN:
- Universal canonical loan schema (CanonicalLoan interface)
- Abstract base class LOSConnector with methods: authenticate(), fetchLoans(), syncWebhook()
- Each LOS system (Encompass, Calyx, MeridianLink) gets an adapter
- Adapters transform LOS-specific formats to CanonicalLoan schema
- Adding a new LOS system takes less than a day to a week (depending on lender's 3rd party requirements)
- Data Sync Strategy: Real-time webhooks for urgent updates, daily full sync at 2 AM, hourly incremental sync

SECURITY:
- Three-layer encryption: At Rest (AES-256 via AWS KMS), In Transit (TLS 1.3, WSS), Key Management (AWS KMS)
- SOC 2 Type II controls: Access Control, Change Management, Monitoring, Incident Response
- HIPAA-ready: Encryption at rest/transit, access logging, audit trails, BAAs with vendors
- Field-level encryption for PII (SSN, DOB, account numbers)
- Zero Trust Network architecture

VENDOR CONNECTOR LAYER:
- Supports Credit Bureaus (Experian, Equifax, TransUnion), Title Services, Insurance, Appraisals, Compliance platforms
- Generic VendorConnector pattern with authenticate(), fetchData(), transform() methods
- Vendors build one integration (less than a day to a week) and reach 100+ Coheus lenders instantly
- API routes pattern: /api/vendors/ with category-specific endpoints

RAG & KNOWLEDGE BASE:
- Retrieval-Augmented Generation pipeline: Embed question → Semantic search (Pinecone) → Build context → Inject into prompt → Generate response
- Document processing: Upload → Extract (AWS Textract) → Normalize → Chunk (512-token chunks, 20% overlap) → Embed → Index (Pinecone)
- Guardrails: Source citation required, confidence scoring (0.75+ similarity), PII redaction (AWS Comprehend), fact-checking, user feedback

COMPUTE ARCHITECTURE:
- EC2 for stateful services (real-time API + WebSocket, persistent connections, in-memory state)
- Serverless for REST endpoints, scheduled sync jobs (Serverless + SQS), webhook handlers
- Production config: t3.medium (2 vCPU, 4GB RAM) minimum, Auto Scaling (Min 2, Max 5), ALB load balancer
- Cost-effective for 24/7 operations (~$4,000 annual for 2 reserved instances)

DEPLOYMENT MODELS:
- Option 1: SaaS (Coheus Hosted) - Single AWS account, multi-tenant, Teraverde manages infrastructure
- Option 2: Self-Hosted (Docker Compose) - Local control, includes PostgreSQL, Redis, Backend API, Frontend
- Option 3: Per-Vendor AWS Accounts - Complete data isolation, vendor has admin access, Teraverde maintains via Control Tower

ONBOARDING:
- 30 minutes to first insight: Account Setup (5 min) → LOS Configuration (8 min) → Instant Sync (5 min) → Vendor Activation (7 min) → Team Invites (5 min)
- Video training platform with quizzes (80% pass threshold)

BUILD TIMELINE:
- 6 weeks, 180 hours, 6 hours/day, 6 days/week
- Week 1: Foundation (AWS infrastructure, database schema, Prisma ORM)
- Week 2: Core Backend (Authentication, SSO, multi-tenant isolation, API Gateway)
- Week 3: LOS Connectors (Universal schema, Encompass/Calyx/MeridianLink connectors)
- Week 4: Vendors & Security (Vendor framework, encryption, SOC 2 controls)
- Week 5: RAG & AI (Document pipeline, embeddings, Pinecone, Cohi integration)
- Week 6: Launch Prep (Onboarding system, video training, documentation, testing)

ECONOMICS:
- Significant cost savings: Eliminates substantial upfront development costs and ongoing maintenance expenses
- Dramatically faster integration: Connect all vendors in days or weeks, not months
- No maintenance burden: Coheus handles all API updates, vendor changes, compatibility issues
- Access to new vendors instantly when added to Coheus
- Compliance included: SOC 2 Type II + HIPAA-ready out of the box
- Zero technical debt: No custom code to maintain

When answering questions, be specific, reference the architecture details, and help engineers understand implementation details, design decisions, and rationale.
`;

  // Audio playback queue - Convert PCM16 base64 to AudioBuffer
  const playPcmData = async (base64Data: string) => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext({ sampleRate: 24000 });
      }

      // Decode base64 to binary
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convert PCM16 bytes to Float32Array
      const pcm16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768.0;
      }

      // Create AudioBuffer
      const audioBuffer = audioCtxRef.current.createBuffer(1, float32.length, 24000);
      audioBuffer.copyToChannel(float32, 0);

      audioQueueRef.current.push(audioBuffer);
      processAudioQueue();
    } catch (error) {
      console.error('Error playing audio:', error);
    }
  };

  const processAudioQueue = async () => {
    if (!audioCtxRef.current || audioQueueRef.current.length === 0) return;

    const buffer = audioQueueRef.current.shift();
    if (!buffer) return;

    const source = audioCtxRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtxRef.current.destination);

    const currentTime = audioCtxRef.current.currentTime;
    const startTime = Math.max(currentTime, nextStartTimeRef.current);
    source.start(startTime);
    nextStartTimeRef.current = startTime + buffer.duration;

    source.onended = () => {
      if (audioQueueRef.current.length > 0) {
        processAudioQueue();
      }
    };
  };

  const startCall = async () => {
    if (isConnecting || isConnected) return;

    try {
      setIsConnecting(true);
      
      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // Connect to WebSocket with V2 context
      // Use getWebSocketUrl to get direct backend URL (bypasses CloudFront)
      const { getWebSocketUrl, getWebSocketProtocol } = await import('@/lib/api');
      let backendUrl: string;
      try {
        backendUrl = getWebSocketUrl();
      } catch (error: any) {
        setIsConnecting(false);
        toast({
          title: 'WebSocket Configuration Required',
          description: error.message || 'Backend URL not configured. Please set BACKEND_API_URL in localStorage or contact your administrator.',
          variant: 'destructive',
        });
        console.error('WebSocket URL configuration error:', error);
        return;
      }
      
      // Remove protocol from backend URL and use appropriate WebSocket protocol
      const urlWithoutProtocol = backendUrl.replace(/^https?:\/\//, '');
      const wsProtocol = getWebSocketProtocol(backendUrl);
      const token = api.getToken() || '';
      const wsUrl = `${wsProtocol}${urlWithoutProtocol}/ws/Cohi?token=${encodeURIComponent(token)}&context=v2`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('✅ WebSocket connected to backend');
        setIsConnected(true);
        setIsInCall(true);
        setIsConnecting(false);
        toast({
          title: 'Connected',
          description: 'Cohi is ready to answer your questions about the backend architecture',
        });
      };

      ws.onmessage = async (event) => {
        try {
          let data;
          if (event.data instanceof Blob) {
            data = JSON.parse(await event.data.text());
          } else if (typeof event.data === 'string') {
            data = JSON.parse(event.data);
          } else {
            data = event.data;
          }

          console.log('Received message from backend:', data);

          // Handle audio data from Gemini
          if (data.serverContent?.modelTurn?.parts) {
            for (const part of data.serverContent.modelTurn.parts) {
              if (part.inlineData?.mimeType?.startsWith('audio') || part.inlineData?.mime_type?.startsWith('audio')) {
                const audioData = part.inlineData.data || part.inlineData.data;
                if (audioData) {
                  await playPcmData(audioData);
                }
              }
            }
          }

          // Also check for serverContent directly
          if (data.serverContent?.modelTurn?.parts) {
            for (const part of data.serverContent.modelTurn.parts) {
              if (part.inlineData?.data) {
                const mimeType = part.inlineData.mimeType || part.inlineData.mime_type;
                if (mimeType?.includes('audio') || mimeType?.includes('pcm')) {
                  await playPcmData(part.inlineData.data);
                }
              }
            }
          }
        } catch (error) {
          console.error('Error handling message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        toast({
          title: 'Connection Error',
          description: 'Failed to connect to Cohi. Check console for details.',
          variant: 'destructive',
        });
        setIsConnecting(false);
        setIsConnected(false);
      };

      ws.onclose = () => {
        console.log('WebSocket closed');
        setIsConnected(false);
        setIsInCall(false);
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach(track => track.stop());
          mediaStreamRef.current = null;
        }
      };

      // Send audio chunks from microphone
      const audioContext = new AudioContext({ sampleRate: 24000 });
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      let silenceTimeout: NodeJS.Timeout | null = null;

      processor.onaudioprocess = (e) => {
        if (!isMuted && ws.readyState === WebSocket.OPEN) {
          const inputData = e.inputBuffer.getChannelData(0);
          
          // Check if there's actual audio (not just silence)
          const hasAudio = inputData.some(sample => Math.abs(sample) > 0.01);
          
          if (hasAudio) {
            // Clear any existing silence timeout
            if (silenceTimeout) {
              clearTimeout(silenceTimeout);
              silenceTimeout = null;
            }
            
            const pcm16 = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
              const s = Math.max(-1, Math.min(1, inputData[i]));
              pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            
            const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)));
            ws.send(JSON.stringify({
              client_content: {
                turns: [{
                  role: "user",
                  parts: [{
                    inline_data: {
                      mime_type: 'audio/pcm16',
                      data: base64
                    }
                  }]
                }],
                turn_complete: false
              }
            }));
          } else {
            // Detect silence - mark turn as complete after 1 second of silence
            if (!silenceTimeout) {
              silenceTimeout = setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({
                    client_content: {
                      turn_complete: true
                    }
                  }));
                }
                silenceTimeout = null;
              }, 1000);
            }
          }
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

    } catch (error) {
      console.error('Error starting call:', error);
      toast({
        title: 'Error',
        description: 'Failed to access microphone',
        variant: 'destructive',
      });
      setIsConnecting(false);
    }
  };

  const endCall = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }

    setIsInCall(false);
    setIsConnected(false);
    setIsMuted(false);
    audioQueueRef.current = [];
    nextStartTimeRef.current = 0;
  };

  useEffect(() => {
    return () => {
      endCall();
    };
  }, []);

  return (
    <div className={`fixed bottom-6 right-6 z-50 ${className}`}>
      <AnimatePresence>
        {isInCall ? (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            className="bg-white rounded-2xl shadow-2xl border border-gray-200 p-4 flex items-center gap-3"
          >
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-sm font-medium text-gray-700">Cohi</span>
            </div>
            
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsMuted(!isMuted)}
              className={`${isMuted ? 'bg-red-100 text-red-600 hover:bg-red-200' : ''}`}
            >
              {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
            
            <Button
              variant="ghost"
              size="icon"
              onClick={endCall}
              className="bg-red-100 text-red-600 hover:bg-red-200"
            >
              <PhoneOff className="h-4 w-4" />
            </Button>
          </motion.div>
        ) : (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
          >
            <Button
              onClick={startCall}
              disabled={isConnecting}
              className="bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white rounded-full shadow-lg h-14 w-14 p-0"
            >
              {isConnecting ? (
                <div className="animate-spin rounded-full h-6 w-6 border-2 border-white border-t-transparent" />
              ) : (
                <Phone className="h-6 w-6" />
              )}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
