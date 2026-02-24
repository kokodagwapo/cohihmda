import { useState, useEffect, useRef } from "react";
import {
  PlayCircle,
  Mic,
  MicOff,
  MessageSquare,
  Loader2,
  Send,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getActiveTimezone, getNowInTimezone } from "@/utils/timezone";
import { api } from "@/lib/api";

// Animated Audio Wave Icon Component
const AudioWaveIcon = ({ className = "w-6 h-6" }: { className?: string }) => {
  return (
    <div className={`flex items-center justify-center gap-[2px] ${className}`}>
      <div
        className="w-[3px] bg-current rounded-full animate-audio-wave"
        style={{
          animationDelay: "0s",
          animationDuration: "0.5s",
        }}
      />
      <div
        className="w-[3px] bg-current rounded-full animate-audio-wave"
        style={{
          animationDelay: "0.2s",
          animationDuration: "0.7s",
        }}
      />
      <div
        className="w-[3px] bg-current rounded-full animate-audio-wave"
        style={{
          animationDelay: "0.35s",
          animationDuration: "0.55s",
        }}
      />
    </div>
  );
};

export interface AletheiaBriefingControlsProps {
  briefingContext?: {
    dialogues?: Array<{ message: string; type: string; priority: string }>;
    funnelStory?: {
      conversionRates: any;
      falloutData: any;
      lostRevenue: any;
    };
    userName?: string;
  };
  onChatToggle?: (show: boolean) => void;
  showChat?: boolean;
}

export function AletheiaBriefingControls({
  briefingContext,
  onChatToggle,
  showChat = false,
}: AletheiaBriefingControlsProps) {
  const [isInCall, setIsInCall] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const recognitionRef = useRef<any>(null);
  const isInCallRef = useRef<boolean>(false);
  const activeAudioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const { toast } = useToast();

  // Get time-based greeting based on user's timezone
  const getTimeBasedGreeting = (): string => {
    try {
      const timezone = getActiveTimezone();
      const now = getNowInTimezone();
      const hour = now.getHours();

      if (hour >= 5 && hour < 12) {
        return "Good morning";
      } else if (hour >= 12 && hour < 17) {
        return "Good afternoon";
      } else if (hour >= 17 && hour < 22) {
        return "Good evening";
      } else {
        return "Good evening"; // Late night/early morning (22:00-04:59)
      }
    } catch (e) {
      console.warn("Error getting time-based greeting:", e);
      // Fallback to time-based greeting using local time
      const hour = new Date().getHours();
      if (hour >= 5 && hour < 12) {
        return "Good morning";
      } else if (hour >= 12 && hour < 17) {
        return "Good afternoon";
      } else {
        return "Good evening";
      }
    }
  };

  // Initialize Audio Context - Pre-warm on mount for faster response
  useEffect(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (
        window.AudioContext || (window as any).webkitAudioContext
      )({ sampleRate: 24000 });
      // Pre-warm audio context by resuming it immediately
      if (audioCtxRef.current.state === "suspended") {
        audioCtxRef.current.resume().catch(() => {
          // Ignore errors - will resume on user interaction
        });
      }
    }
    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    };
  }, []);

  const connectToLiveAPI = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      // If already connected, send briefing request immediately
      if (isConnected) {
        sendBriefingRequest();
      }
      return;
    }

    try {
      // Connect to Aletheia via backend WebSocket
      let ws: WebSocket;
      try {
        ws = api.createBackendWebSocket("/ws/aletheia");
      } catch (error: any) {
        toast({
          title: "WebSocket Configuration Required",
          description:
            error.message ||
            "Backend URL not configured. Please set BACKEND_API_URL in localStorage.",
          variant: "destructive",
        });
        console.error("WebSocket configuration error:", error);
        return;
      }

      ws.onopen = () => {
        console.log("WebSocket connected to Aletheia backend");
        // Backend handles setup automatically
        // We'll mark as connected and send briefing request immediately
        setIsConnected(true);
        // Pre-resume audio context for faster playback
        if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
          audioCtxRef.current.resume();
        }
        // Send briefing request immediately after connection
        setTimeout(() => sendBriefingRequest(), 100);
      };

      ws.onmessage = async (event) => {
        try {
          let data;
          if (event.data instanceof Blob) {
            data = JSON.parse(await event.data.text());
          } else if (typeof event.data === "string") {
            data = JSON.parse(event.data);
          } else {
            data = event.data;
          }

          // Handle errors from backend
          if (data.error) {
            console.error("Aletheia API error:", data.error);
            toast({
              title: "API Error",
              description:
                data.error?.message || data.message || "An error occurred",
              variant: "destructive",
            });
            return;
          }

          // --- OpenAI Realtime API events ---
          if (data.type) {
            switch (data.type) {
              case "response.audio.delta":
                if (data.delta) {
                  setIsLoading(false);
                  playPcmData(data.delta);
                }
                break;
              case "response.audio_transcript.delta":
                // Optionally log transcript text as it streams
                break;
              case "response.done":
                console.log("OpenAI response complete");
                break;
              case "error":
                console.error("OpenAI Realtime error:", data.error);
                toast({
                  title: "API Error",
                  description: data.error?.message || "OpenAI Realtime error",
                  variant: "destructive",
                });
                break;
              case "session.created":
              case "session.updated":
              case "response.created":
              case "response.output_item.added":
              case "conversation.item.created":
              case "response.content_part.added":
              case "response.audio_transcript.done":
              case "response.content_part.done":
              case "response.output_item.done":
              case "rate_limits.updated":
                // Known informational events — no action needed
                break;
              default:
                console.log("Aletheia event:", data.type);
            }
            return;
          }

          // --- Gemini server content (fallback for Gemini provider) ---
          const serverContent = data.serverContent || data.server_content;
          if (serverContent) {
            const modelTurn =
              serverContent.modelTurn || serverContent.model_turn;
            if (modelTurn) {
              const parts = modelTurn.parts || [];
              for (const part of parts) {
                const inlineData = part.inlineData || part.inline_data;
                if (inlineData) {
                  const mimeType = inlineData.mimeType || inlineData.mime_type;
                  if (mimeType?.startsWith("audio/pcm")) {
                    setIsLoading(false);
                    playPcmData(inlineData.data);
                  }
                }
                // Skip thought/reasoning text — not shown to user
              }
            }

            const turnComplete =
              serverContent.turnComplete || serverContent.turn_complete;
            if (turnComplete) {
              setIsLoading(false);
              console.log("Aletheia turn complete");
            }
          }
        } catch (e) {
          console.error("Error parsing WS message", e);
        }
      };

      ws.onclose = (event) => {
        // Only auto-stop if we're still in call and it wasn't a normal close
        if (isInCall && event.code !== 1000) {
          // User-initiated close (code 1000) won't trigger this
          stopBriefing();
        }
        // Only show error toast for unexpected closures (not user-initiated)
        if (event.code !== 1000 && event.code !== 1001 && isInCall) {
          toast({
            title: "Connection Lost",
            description: "Briefing connection closed unexpectedly",
            variant: "destructive",
          });
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket Error", error);
        toast({
          title: "Connection Error",
          description:
            "Unable to connect to Aletheia. Please ensure the backend server is running.",
          variant: "destructive",
        });
      };

      wsRef.current = ws;
    } catch (e) {
      console.error("Connection error:", e);
      toast({
        title: "Connection Failed",
        description: "Failed to establish connection.",
        variant: "destructive",
      });
    }
  };

  const sendBriefingRequest = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error("WebSocket not ready for briefing request");
      return;
    }

    const dialoguesText =
      briefingContext?.dialogues
        ?.map((d, idx) => `${idx + 1}. ${d.message}`)
        .join("\n") || "No specific insights available.";

    const funnelText = briefingContext?.funnelStory
      ? `
Loan Funnel Analysis:
- Overall Conversion Rate: ${briefingContext.funnelStory.conversionRates?.overall || "N/A"}%
- Pull-Through Rate: ${briefingContext.funnelStory.conversionRates?.pullThrough || "N/A"}%
- Total Fallout: ${briefingContext.funnelStory.falloutData?.total || "N/A"}
- Lost Revenue Opportunity: ${briefingContext.funnelStory.lostRevenue?.total || "N/A"}
    `
      : "";

    const greeting = getTimeBasedGreeting();
    const timezone = getActiveTimezone();

    const briefingPrompt = `Provide a unique, high-value executive briefing in a podcast-style format. 

CRITICAL: 
- Do not include any stage directions, music descriptions, or bracketed text. Start immediately with your spoken greeting and insights.
- GREETING: Begin your briefing with "${greeting}" followed by the executive's name if provided. This greeting is based on the user's timezone (${timezone}).
- Pronounce financial figures properly in full words. For example, speak "$179M" as "one hundred and seventy-nine million dollars". Never use abbreviations like "em" or "kay". Accuracy and professional delivery of financial data are essential.
- RANDOMIZE YOUR OPENING AND STRUCTURE: Do not repeat previous briefing styles. Vary your tone, greeting, and how you present the data to keep it fresh and engaging.
- TERMINOLOGY: For your internal business insights, use the phrase "here's the latest" instead of "the headlines". Reserve the word "headlines" exclusively for the industry news section.
- INCLUDE INDUSTRY NEWS: Incorporate a relevant current event or trend from the mortgage and lending industry (e.g., Fed rate decisions, market inventory shifts, regulatory changes). Refer to this as "Today's Industry Headlines".
- PROVIDE INTELLIGENT INSIGHTS: Relate the industry news directly to the Coheus business data provided below. How does the macro environment impact these specific figures?

First, cover these key insights (introduced as "here's the latest"):
${dialoguesText}

${
  funnelText
    ? `Then transition to the Loan Funnel analysis:
${funnelText}`
    : ""
}

${briefingContext?.userName ? `Address the executive as ${briefingContext.userName} at the beginning, right after the "${greeting}" greeting.` : `Start with "${greeting}" as your opening greeting.`}

Use executive terminology and be candid and direct. After the briefing, be ready for follow-up questions. Briefing ID: ${Date.now()}`;

    console.log(
      "Sending briefing request:",
      briefingPrompt.substring(0, 100) + "...",
    );

    try {
      // Send message in Gemini format (backend will handle both OpenAI and Gemini)
      const message = {
        client_content: {
          turns: [
            {
              role: "user",
              parts: [{ text: briefingPrompt }],
            },
          ],
          turn_complete: true,
        },
      };

      wsRef.current.send(JSON.stringify(message));
      console.log("Briefing request sent successfully");
    } catch (error) {
      console.error("Error sending briefing request:", error);
      toast({
        title: "Send Failed",
        description: "Failed to send briefing request",
        variant: "destructive",
      });
    }
  };

  const playPcmData = (base64: string) => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    // Resume audio context immediately if suspended
    if (ctx.state === "suspended") {
      ctx
        .resume()
        .catch((e) => console.warn("Audio context resume failed:", e));
    }

    try {
      // Optimize base64 decoding - use native atob which is faster
      const binaryString = atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);

      // Optimize conversion - use TypedArray views for better performance
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

      // Track active audio source
      activeAudioSourcesRef.current.add(source);

      // Remove from tracking when done playing
      source.onended = () => {
        activeAudioSourcesRef.current.delete(source);
      };

      // Start playback immediately - reduce scheduling delay
      const now = ctx.currentTime;
      const startTime = Math.max(now, nextStartTimeRef.current);
      source.start(startTime);

      nextStartTimeRef.current = startTime + buffer.duration;
    } catch (e) {
      console.error("Error decoding audio", e);
    }
  };

  const startBriefing = () => {
    setIsInCall(true);
    isInCallRef.current = true;
    setIsConnected(false);
    setIsLoading(true);

    // Pre-resume audio context immediately for faster response
    if (audioCtxRef.current) {
      if (audioCtxRef.current.state === "suspended") {
        audioCtxRef.current.resume();
      }
      // Pre-warm audio context by creating a silent buffer
      try {
        const buffer = audioCtxRef.current.createBuffer(1, 1, 24000);
        const source = audioCtxRef.current.createBufferSource();
        source.buffer = buffer;
        source.connect(audioCtxRef.current.destination);
        source.start(0);
        source.stop(0.001);
      } catch (e) {
        // Ignore errors in pre-warming
      }
    }
    nextStartTimeRef.current = 0; // Reset timing

    connectToLiveAPI();
  };

  const stopBriefing = () => {
    // Prevent multiple calls to stopBriefing
    if (!isInCall) return;

    isInCallRef.current = false;
    setIsLoading(false);

    // 1. Stop Speech Recognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.warn("Error stopping recognition:", e);
      }
      recognitionRef.current = null;
    }

    // 2. Close WebSocket gracefully
    if (wsRef.current) {
      // Prevent onclose handler from showing toast
      wsRef.current.onclose = null;
      try {
        if (
          wsRef.current.readyState === WebSocket.OPEN ||
          wsRef.current.readyState === WebSocket.CONNECTING
        ) {
          wsRef.current.close(1000, "User ended call");
        }
      } catch (e) {
        console.warn("Error closing WebSocket:", e);
      }
      wsRef.current = null;
    }

    // 3. Stop and Clear Audio
    // Stop all active audio sources
    activeAudioSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch (e) {
        console.warn("Error stopping audio source:", e);
      }
    });
    activeAudioSourcesRef.current.clear();

    if (audioCtxRef.current) {
      try {
        if (audioCtxRef.current.state === "running") {
          audioCtxRef.current.suspend();
        }
      } catch (e) {
        console.warn("Error suspending audio context:", e);
      }
    }
    nextStartTimeRef.current = 0; // Reset timing buffer

    // 4. Reset UI State
    setIsInCall(false);
    setIsConnected(false);
    setIsListening(false);

    toast({
      title: "Briefing Ended",
      description: "The session has been closed.",
      duration: 5000, // Auto-close after 5 seconds
    });
  };

  const toggleMic = () => {
    if (
      !("webkitSpeechRecognition" in window) &&
      !("SpeechRecognition" in window)
    ) {
      toast({
        title: "Not Supported",
        description: "Speech recognition not available",
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
      const SpeechRecognition =
        (window as any).webkitSpeechRecognition ||
        (window as any).SpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = "en-US";

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (transcript && wsRef.current?.readyState === WebSocket.OPEN) {
          sendMessage(transcript);
        }
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error("Speech recognition error:", event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const sendMessage = async (text: string) => {
    if (!text.trim()) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      toast({
        title: "Not Connected",
        description: "Please start briefing first",
      });
      return;
    }

    setChatInput("");
    setIsLoading(true);

    try {
      // Send simple text object that backend will convert to either OpenAI or Gemini format
      wsRef.current.send(
        JSON.stringify({
          text: text,
        }),
      );
    } catch (error) {
      console.error("Error sending message:", error);
      toast({
        title: "Send Failed",
        description: "Failed to send message",
        variant: "destructive",
      });
    }

    setTimeout(() => setIsLoading(false), 1000);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  return (
    <div className="flex items-center gap-2 sm:gap-3">
      {/* Start/Stop Briefing Button - Single button that toggles */}

      {/* Chat Panel */}
      <AnimatePresence>
        {showChat && isInCall && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="fixed sm:absolute top-16 sm:top-full right-2 sm:right-0 mt-2 w-[calc(100vw-1rem)] sm:w-80 max-w-sm bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 p-3 z-50"
          >
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-semibold text-slate-900 dark:text-white">
                Chat with Cohi
              </span>
            </div>
            <div className="flex gap-2">
              <Input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage(chatInput);
                  }
                }}
                placeholder="Ask a question..."
                className="flex-1 text-sm"
                disabled={isLoading}
              />
              <Button
                onClick={() => sendMessage(chatInput)}
                size="sm"
                disabled={isLoading || !chatInput.trim()}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
