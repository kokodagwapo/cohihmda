import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useUsageTracking } from '@/hooks/useUsageTracking';
import { api } from '@/lib/api';

interface VoiceInterfaceProps {
  isCallActive: boolean;
  onCallStatusChange: (active: boolean) => void;
  onConversationUpdate: Dispatch<SetStateAction<any[]>>;
}

export function VoiceInterface({ isCallActive, onCallStatusChange, onConversationUpdate }: VoiceInterfaceProps) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const { toast } = useToast();
  const { trackUsage, checkLimit } = useUsageTracking();
  
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioProcessorRef = useRef<{ processor: ScriptProcessorNode; audioContext: AudioContext } | null>(null);
  const isConnectedRef = useRef<boolean>(false);

  // Initialize AudioContext
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
      }
      if (audioProcessorRef.current) {
        audioProcessorRef.current.processor.disconnect();
        audioProcessorRef.current.audioContext.close();
        audioProcessorRef.current = null;
      }
    };
  }, []);

  // Play PCM audio data
  const playPcmData = (base64: string) => {
    if (!audioCtxRef.current || isMuted) return;
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    try {
      setIsSpeaking(true);
      const binaryString = atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
      
      const int16Data = new Int16Array(bytes.buffer);
      const float32Data = new Float32Array(int16Data.length);
      for (let i = 0; i < int16Data.length; i++) {
        float32Data[i] = int16Data[i] / 32768.0;
      }
      
      const buffer = ctx.createBuffer(1, float32Data.length, 24000);
      buffer.getChannelData(0).set(float32Data);
      
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      
      const now = ctx.currentTime;
      const startTime = Math.max(now, nextStartTimeRef.current);
      source.start(startTime);
      
      nextStartTimeRef.current = startTime + buffer.duration;
      
      source.onended = () => {
        setIsSpeaking(false);
      };
    } catch (e) {
      console.error('Error decoding audio', e);
      setIsSpeaking(false);
    }
  };

  // Connect to WebSocket
  const connectToVoiceAPI = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      let ws: WebSocket;
      try {
        ws = api.createBackendWebSocket('/ws/aletheia');
      } catch (error: any) {
        toast({
          title: 'WebSocket Configuration Required',
          description: error.message || 'Backend URL not configured. Please set BACKEND_API_URL in localStorage.',
          variant: 'destructive',
        });
        console.error('WebSocket configuration error:', error);
        return;
      }

      ws.onopen = () => {
        setIsConnected(true);
        isConnectedRef.current = true;
        console.log('Connected to Ailethia voice via WebSocket');
        toast({ 
          title: 'Connected', 
          description: 'Voice connection established' 
        });
        
        // Start microphone now that we're connected
        if (!isListening) {
          startMicrophone();
        }
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

          console.log('Voice message received:', data);

          // Handle audio data from Gemini
          if (data.serverContent?.modelTurn?.parts) {
            for (const part of data.serverContent.modelTurn.parts) {
              // Play audio chunks - check multiple possible formats
              if (part.inlineData) {
                const mimeType = part.inlineData.mimeType || part.inlineData.mime_type;
                const audioData = part.inlineData.data;
                
                if (mimeType && (mimeType.startsWith('audio') || mimeType.includes('pcm')) && audioData) {
                  console.log('Playing audio chunk, mimeType:', mimeType, 'length:', audioData.length);
                  playPcmData(audioData);
                }
              }
              
              // Handle text responses for conversation display
              if (part.text) {
                onConversationUpdate(prev => [...prev, {
                  speaker: 'agent',
                  message: part.text,
                  timestamp: new Date()
                }]);
              }
            }
          }
          
          // Also check for direct audio in serverContent (alternative format)
          if (data.serverContent?.modelTurn?.inlineData?.data) {
            const mimeType = data.serverContent.modelTurn.inlineData.mimeType || data.serverContent.modelTurn.inlineData.mime_type;
            if (mimeType && (mimeType.startsWith('audio') || mimeType.includes('pcm'))) {
              console.log('Playing audio from direct inlineData');
              playPcmData(data.serverContent.modelTurn.inlineData.data);
            }
          }
        } catch (e) {
          console.error('Error parsing WebSocket message', e);
        }
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        isConnectedRef.current = false;
        setIsListening(false);
        console.log('Voice WebSocket disconnected', event.code, event.reason);
        if (event.code !== 1000) {
          toast({ 
            title: 'Connection Lost', 
            description: `Voice connection closed. Code: ${event.code}`,
            variant: 'destructive' 
          });
        }
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        toast({ 
          title: 'Connection Error', 
          description: 'Failed to connect to voice service',
          variant: 'destructive' 
        });
        setIsConnected(false);
        isConnectedRef.current = false;
      };

      wsRef.current = ws;
    } catch (e) {
      console.error('Connection error:', e);
      toast({
        title: 'Connection Failed',
        description: 'Failed to establish voice connection',
        variant: 'destructive'
      });
    }
  };

  // Start microphone capture - convert to PCM16 format for Gemini
  const startMicrophone = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        } 
      });
      
      mediaStreamRef.current = stream;
      setIsListening(true);

      // Use AudioContext to capture and convert to PCM16
      const audioContext = new AudioContext({ sampleRate: 24000 });
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      let silenceTimeout: NodeJS.Timeout | null = null;

      processor.onaudioprocess = (e) => {
        if (!isMuted && wsRef.current?.readyState === WebSocket.OPEN) {
          const inputData = e.inputBuffer.getChannelData(0);
          
          // Check if there's actual audio (not silence)
          const hasAudio = inputData.some(sample => Math.abs(sample) > 0.01);
          
          if (hasAudio) {
            // Clear any existing silence timeout
            if (silenceTimeout) {
              clearTimeout(silenceTimeout);
              silenceTimeout = null;
            }
            
            // Convert Float32 to PCM16
            const pcm16 = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
              const s = Math.max(-1, Math.min(1, inputData[i]));
              pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            
            // Convert to base64
            const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)));
            
            // Send audio data to WebSocket in Gemini format
            wsRef.current.send(JSON.stringify({
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
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({
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
      
      // Store processor for cleanup
      audioProcessorRef.current = { processor, audioContext };
    } catch (error: any) {
      console.error('Error accessing microphone:', error);
      toast({
        title: 'Microphone Error',
        description: error.message || 'Failed to access microphone. Please check permissions.',
        variant: 'destructive'
      });
      setIsListening(false);
    }
  };

  // Stop microphone
  const stopMicrophone = () => {
    if (audioProcessorRef.current) {
      audioProcessorRef.current.processor.disconnect();
      audioProcessorRef.current.audioContext.close();
      audioProcessorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    setIsListening(false);
  };

  const startCall = async () => {
    // Check usage limit before starting call
    const limitCheck = await checkLimit('calls_per_month');
    if (!limitCheck.allowed) {
      toast({
        title: 'Usage Limit Reached',
        description: `You've reached your monthly limit of ${limitCheck.limit} calls. Please upgrade your plan.`,
        variant: 'destructive',
      });
      return;
    }

    // Track usage
    await trackUsage('calls_per_month', 1);

    onCallStatusChange(true);
    onConversationUpdate([]);
    
    // Connect to WebSocket (microphone will start automatically when connected)
    connectToVoiceAPI();

    toast({
      title: 'Call started',
      description: 'Ailethia voice is ready',
    });
  };

  const endCall = () => {
    stopMicrophone();
    
    if (wsRef.current) {
      // Send turn_complete message
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          client_content: {
            turn_complete: true
          }
        }));
      }
      wsRef.current.close();
      wsRef.current = null;
    }
    
    onCallStatusChange(false);
    setIsSpeaking(false);
    setIsConnected(false);
    setIsListening(false);
    
    toast({
      title: 'Call ended',
      description: 'Session completed',
    });
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-6">
      <h2 className="text-2xl font-semibold">Voice Interface</h2>
      
      {/* Audio Visualizer */}
      <div className="relative w-48 h-48 flex items-center justify-center">
        <div
          className={`absolute inset-0 rounded-full bg-primary/20 transition-all duration-300 ${
            isSpeaking ? 'scale-110 animate-pulse' : 'scale-100'
          }`}
        />
        <div
          className={`absolute inset-4 rounded-full bg-primary/40 transition-all duration-300 ${
            isSpeaking ? 'scale-110 animate-pulse' : 'scale-100'
          }`}
          style={{ animationDelay: '0.1s' }}
        />
        <div
          className={`relative z-10 w-32 h-32 rounded-full bg-primary flex items-center justify-center transition-all duration-300 ${
            isSpeaking ? 'scale-110' : 'scale-100'
          }`}
        >
          {isCallActive ? (
            <MicOff className="w-16 h-16 text-white" />
          ) : (
            <Mic className="w-16 h-16 text-white" />
          )}
        </div>
      </div>

      {/* Status Text */}
      <div className="text-center space-y-2">
        <p className="text-lg font-medium">
          {isCallActive
            ? isSpeaking
              ? 'Ailethia is speaking...'
              : isListening
              ? 'Listening...'
              : isConnected
              ? 'Connected'
              : 'Connecting...'
            : 'Ready to start'}
        </p>
        <p className="text-sm text-muted-foreground">
          {isCallActive
            ? isConnected 
              ? 'Voice session active'
              : 'Establishing connection...'
            : 'Click to begin voice session'}
        </p>
        {isCallActive && (
          <div className="flex items-center justify-center gap-2 mt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsMuted(!isMuted)}
              className="h-8 w-8 p-0"
            >
              {isMuted ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </Button>
            <span className="text-xs text-muted-foreground">
              {isMuted ? 'Muted' : 'Audio on'}
            </span>
          </div>
        )}
      </div>

      {/* Control Button */}
      <Button
        size="lg"
        onClick={isCallActive ? endCall : startCall}
        variant={isCallActive ? 'destructive' : 'default'}
        className="w-full max-w-xs"
        disabled={isCallActive && !isConnected}
      >
        {isCallActive ? 'End Call' : 'Start Call'}
      </Button>
    </div>
  );
}
