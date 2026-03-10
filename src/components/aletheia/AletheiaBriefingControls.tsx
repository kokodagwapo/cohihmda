import { useState, useEffect, useRef, useCallback } from "react";
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

const AudioWaveIcon = ({ className = "w-6 h-6" }: { className?: string }) => {
  return (
    <div className={`flex items-center justify-center gap-[2px] ${className}`}>
      <div
        className="w-[3px] bg-current rounded-full animate-audio-wave"
        style={{ animationDelay: "0s", animationDuration: "0.5s" }}
      />
      <div
        className="w-[3px] bg-current rounded-full animate-audio-wave"
        style={{ animationDelay: "0.2s", animationDuration: "0.7s" }}
      />
      <div
        className="w-[3px] bg-current rounded-full animate-audio-wave"
        style={{ animationDelay: "0.35s", animationDuration: "0.55s" }}
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

const OUTPUT_SAMPLE_RATE = 24000;

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
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedTime, setBufferedTime] = useState(0);
  const [isStreamComplete, setIsStreamComplete] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const workletReadyRef = useRef<boolean>(false);
  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<any>(null);
  const isInCallRef = useRef<boolean>(false);
  const streamSampleRateRef = useRef<number>(OUTPUT_SAMPLE_RATE);
  const streamMimeTypeRef = useRef<string>("audio/pcm");
  const { toast } = useToast();

  const getTimeBasedGreeting = (): string => {
    try {
      const now = getNowInTimezone();
      const hour = now.getHours();
      if (hour >= 5 && hour < 12) return "Good morning";
      if (hour >= 12 && hour < 17) return "Good afternoon";
      return "Good evening";
    } catch {
      const hour = new Date().getHours();
      if (hour >= 5 && hour < 12) return "Good morning";
      if (hour >= 12 && hour < 17) return "Good afternoon";
      return "Good evening";
    }
  };

  useEffect(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (
        window.AudioContext || (window as any).webkitAudioContext
      )({ sampleRate: OUTPUT_SAMPLE_RATE });

      audioCtxRef.current.audioWorklet
        .addModule("/audio-playback-worklet.js")
        .then(() => {
          const worklet = new AudioWorkletNode(
            audioCtxRef.current!,
            "audio-playback-processor"
          );
          worklet.connect(audioCtxRef.current!.destination);
          workletRef.current = worklet;
          workletReadyRef.current = true;
          worklet.port.onmessage = (event) => {
            if (event.data?.type === "state") {
              setCurrentTime(event.data.currentTime || 0);
              setDuration(event.data.duration || 0);
              setBufferedTime(event.data.buffered || 0);
              if (event.data.streamComplete) {
                setIsStreamComplete(true);
              }
            } else if (event.data?.type === "ended") {
              setIsLoading(false);
              setIsConnected(false);
            }
          };
          worklet.port.postMessage({ type: "setSpeed", speed: 1.0 });
          console.log("[Aletheia] AudioWorklet ready");
        })
        .catch((e) => console.warn("[Aletheia] AudioWorklet load failed:", e));

      if (audioCtxRef.current.state === "suspended") {
        audioCtxRef.current.resume().catch(() => {});
      }
    }

    return () => {
      if (workletRef.current) {
        workletRef.current.port.onmessage = null;
        workletRef.current.disconnect();
        workletRef.current = null;
        workletReadyRef.current = false;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (workletRef.current) {
      workletRef.current.port.postMessage({ type: "setSpeed", speed: playbackSpeed });
    }
  }, [playbackSpeed]);

  const resampleToOutputRate = useCallback(
    (input: Float32Array, fromRate: number) => {
      if (!fromRate || fromRate === OUTPUT_SAMPLE_RATE) {
        return input;
      }
      const ratio = OUTPUT_SAMPLE_RATE / fromRate;
      const outputLength = Math.max(1, Math.floor(input.length * ratio));
      const output = new Float32Array(outputLength);
      for (let i = 0; i < outputLength; i++) {
        const srcPos = i / ratio;
        const i0 = Math.floor(srcPos);
        const i1 = Math.min(i0 + 1, input.length - 1);
        const frac = srcPos - i0;
        output[i] = input[i0] + (input[i1] - input[i0]) * frac;
      }
      return output;
    },
    []
  );

  const playPcmChunk = useCallback(
    (base64: string, sampleRate = OUTPUT_SAMPLE_RATE) => {
      if (!audioCtxRef.current || !workletReadyRef.current || !workletRef.current) {
        return;
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }

      try {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const alignedLength = bytes.length - (bytes.length % 2);
        if (alignedLength <= 0) return;

        const int16Data = new Int16Array(
          bytes.buffer,
          bytes.byteOffset,
          alignedLength / 2
        );
        const float32Data = new Float32Array(int16Data.length);
        for (let i = 0; i < int16Data.length; i++) {
          float32Data[i] = int16Data[i] / 32768.0;
        }

        const normalized = resampleToOutputRate(float32Data, sampleRate);
        workletRef.current.port.postMessage({
          type: "audio",
          samples: normalized,
        });
      } catch (e) {
        console.error("[Aletheia] Error decoding audio chunk", e);
      }
    },
    [resampleToOutputRate]
  );

  const consumeSSEStream = useCallback(
    async (response: Response, signal: AbortSignal) => {
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const eventBlock of events) {
          const line = eventBlock
            .split("\n")
            .find((entry) => entry.startsWith("data: "));
          if (!line) continue;

          try {
            const payload = JSON.parse(line.slice(6));
            switch (payload.type) {
              case "meta": {
                const mimeType = String(payload.mimeType || "audio/pcm");
                const sampleRate = Number(payload.sampleRate || OUTPUT_SAMPLE_RATE);
                streamMimeTypeRef.current = mimeType;
                streamSampleRateRef.current =
                  Number.isFinite(sampleRate) && sampleRate > 0
                    ? sampleRate
                    : OUTPUT_SAMPLE_RATE;

                if (!mimeType.startsWith("audio/pcm")) {
                  toast({
                    title: "Audio Format Warning",
                    description: `Expected PCM stream, received ${mimeType}.`,
                    variant: "destructive",
                  });
                }
                if (workletRef.current) {
                  workletRef.current.port.postMessage({
                    type: "meta",
                    sampleRate: streamSampleRateRef.current,
                  });
                }
                break;
              }
              case "audio":
                setIsLoading(false);
                setIsConnected(true);
                playPcmChunk(payload.data, streamSampleRateRef.current);
                break;
              case "script":
                console.log("[Aletheia] Script text:", payload.data);
                break;
              case "transcript":
                console.log("[Aletheia] Transcript text:", payload.data);
                break;
              case "done":
                setIsLoading(false);
                setIsStreamComplete(true);
                if (workletRef.current) {
                  workletRef.current.port.postMessage({ type: "streamComplete" });
                }
                break;
              case "error":
                console.error("[Aletheia] Server error:", payload.error);
                toast({
                  title: "Briefing Error",
                  description: payload.error,
                  variant: "destructive",
                });
                break;
            }
          } catch {
            // ignore malformed event block
          }
        }
      }
    },
    [playPcmChunk, toast]
  );

  const startBriefing = useCallback(async () => {
    setIsInCall(true);
    isInCallRef.current = true;
    setIsConnected(false);
    setIsLoading(true);
    setIsStreamComplete(false);
    setCurrentTime(0);
    setDuration(0);
    setBufferedTime(0);
    streamSampleRateRef.current = OUTPUT_SAMPLE_RATE;
    streamMimeTypeRef.current = "audio/pcm";

    if (audioCtxRef.current?.state === "suspended") {
      audioCtxRef.current.resume();
    }
    if (workletRef.current) {
      workletRef.current.port.postMessage({ type: "clear" });
      workletRef.current.port.postMessage({
        type: "setSpeed",
        speed: playbackSpeed,
      });
    }

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const greeting = getTimeBasedGreeting();
      const timezone = getActiveTimezone();

      const response = await api.fetchWithAuth(
        "/api/podcast/cohi/aletheia/stream",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            briefingContext: {
              ...briefingContext,
              greeting,
              timezone,
            },
          }),
          signal: abort.signal,
        }
      );

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      await consumeSSEStream(response, abort.signal);
    } catch (error: any) {
      if (error.name === "AbortError") return;
      console.error("[Aletheia] Briefing failed:", error);
      toast({
        title: "Briefing Failed",
        description: error.message || "Failed to start briefing",
        variant: "destructive",
      });
      isInCallRef.current = false;
      setIsInCall(false);
      setIsConnected(false);
      setIsLoading(false);
    }
  }, [briefingContext, consumeSSEStream, playbackSpeed, toast]);

  const stopBriefing = useCallback(() => {
    if (!isInCallRef.current && !isInCall) return;

    isInCallRef.current = false;
    setIsLoading(false);

    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }

    if (workletRef.current) {
      workletRef.current.port.postMessage({ type: "clear" });
    }
    if (audioCtxRef.current?.state === "running") {
      audioCtxRef.current.suspend().catch(() => {});
    }

    setIsInCall(false);
    setIsConnected(false);
    setIsListening(false);
    setIsStreamComplete(false);
    setCurrentTime(0);
    setDuration(0);
    setBufferedTime(0);

    toast({
      title: "Briefing Ended",
      description: "The session has been closed.",
      duration: 5000,
    });
  }, [isInCall, toast]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || !isInCallRef.current) return;

      setChatInput("");
      setIsLoading(true);
      setIsStreamComplete(false);
      setCurrentTime(0);
      setDuration(0);
      setBufferedTime(0);

      if (workletRef.current) {
        workletRef.current.port.postMessage({ type: "clear" });
        workletRef.current.port.postMessage({
          type: "setSpeed",
          speed: playbackSpeed,
        });
      }

      const abort = new AbortController();
      abortRef.current = abort;

      try {
        if (audioCtxRef.current?.state === "suspended") {
          audioCtxRef.current.resume();
        }

        const response = await api.fetchWithAuth(
          "/api/podcast/cohi/aletheia/ask",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: text }),
            signal: abort.signal,
          }
        );

        if (!response.ok) {
          throw new Error(`Server error: ${response.status}`);
        }

        await consumeSSEStream(response, abort.signal);
      } catch (error: any) {
        if (error.name === "AbortError") return;
        console.error("[Aletheia] Ask failed:", error);
        toast({
          title: "Question Failed",
          description: error.message || "Failed to process question",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    },
    [consumeSSEStream, playbackSpeed, toast]
  );

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
        if (transcript && event.results[0].isFinal) {
          sendMessage(transcript);
        }
      };
      recognitionRef.current.onerror = () => {
        setIsListening(false);
      };
      recognitionRef.current.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    if (workletRef.current) {
      workletRef.current.port.postMessage({ type: "setSpeed", speed });
    }
  };

  const handleSeekCommit = (value: number) => {
    if (!isStreamComplete || !workletRef.current) return;
    workletRef.current.port.postMessage({ type: "seek", timeSeconds: value });
  };

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      if (recognitionRef.current) recognitionRef.current.stop();
    };
  }, []);

  useEffect(() => {
    onChatToggle?.(showChat && isInCall);
  }, [isInCall, onChatToggle, showChat]);

  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <button
        onClick={() => {
          if (isInCallRef.current || isInCall) {
            stopBriefing();
          } else {
            startBriefing();
          }
        }}
        disabled={false}
        className={`p-3 sm:p-2 rounded-xl sm:rounded-lg text-white transition-all active:scale-95 shadow-md ${
          isInCall
            ? "bg-rose-600 hover:bg-rose-700 shadow-rose-500/20 animate-pulse-glow-rose"
            : "bg-blue-600 hover:bg-blue-700 shadow-blue-500/20 animate-pulse-glow"
        } ${isLoading ? "opacity-75 cursor-wait" : ""}`}
        title={
          isInCall
            ? "End Briefing"
            : isLoading
              ? "Connecting..."
              : "Start Briefing"
        }
      >
        {isInCall ? (
          <AudioWaveIcon className="w-6 h-6 sm:w-5 sm:h-5" />
        ) : isLoading ? (
          <Loader2 className="w-6 h-6 sm:w-5 sm:h-5 animate-spin" />
        ) : (
          <PlayCircle className="w-6 h-6 sm:w-5 sm:h-5" />
        )}
      </button>

      <AnimatePresence mode="wait">
        {isInCall && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="flex items-center gap-2"
          >
            <button
              onClick={toggleMic}
              className={`p-3 sm:p-2 rounded-xl sm:rounded-lg transition-all active:scale-95 ${
                isListening
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white animate-pulse"
                  : "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300"
              }`}
              title={isListening ? "Stop Voice Input" : "Start Voice Input"}
            >
              {isListening ? (
                <Mic className="w-5 h-5 sm:w-4 sm:h-4" />
              ) : (
                <MicOff className="w-5 h-5 sm:w-4 sm:h-4" />
              )}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {isInCall && (
        <div className="flex items-center gap-2 px-3 py-1.5 sm:px-2 sm:py-1 rounded-xl sm:rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200/50 dark:border-slate-700/50">
          <div
            className={`w-2.5 h-2.5 sm:w-2 sm:h-2 rounded-full ${isConnected ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-amber-500 animate-pulse"}`}
          />
          <span className="text-[10px] sm:text-xs font-medium text-slate-600 dark:text-slate-400">
            {isConnected ? "LIVE" : "SYNCING"}
          </span>
        </div>
      )}

      {isInCall && (
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-xl sm:rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200/50 dark:border-slate-700/50 min-w-[260px]">
          <select
            value={playbackSpeed}
            onChange={(e) => handleSpeedChange(Number(e.target.value))}
            className="text-xs rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-1.5 py-1"
            title="Playback speed"
          >
            <option value={0.75}>0.75x</option>
            <option value={1}>1.0x</option>
            <option value={1.25}>1.25x</option>
            <option value={1.5}>1.5x</option>
          </select>
          <input
            type="range"
            min={0}
            max={Math.max(duration, 0.01)}
            step={0.1}
            value={Math.min(currentTime, Math.max(duration, 0.01))}
            disabled={!isStreamComplete}
            onMouseDown={() => setIsSeeking(true)}
            onMouseUp={(e) => {
              const value = Number((e.target as HTMLInputElement).value);
              handleSeekCommit(value);
              setIsSeeking(false);
            }}
            onChange={(e) => {
              const value = Number(e.target.value);
              setCurrentTime(value);
              if (!isSeeking) {
                handleSeekCommit(value);
              }
            }}
            className="flex-1"
            title={
              isStreamComplete
                ? "Seek through completed audio"
                : "Seek enabled after generation completes"
            }
          />
          <span className="text-[10px] sm:text-xs text-slate-600 dark:text-slate-400 tabular-nums min-w-[78px] text-right">
            {Math.floor(currentTime)}s/{Math.floor(duration)}s
          </span>
        </div>
      )}

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
            <div className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
              {isStreamComplete
                ? `Playback complete. Buffered: ${Math.floor(bufferedTime)}s`
                : "Seek unlocks when generation completes."}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

