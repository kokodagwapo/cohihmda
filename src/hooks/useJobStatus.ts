import { useState, useEffect, useRef, useCallback } from "react";
import { subscribeToJob, type JobMessage } from "./useJobWebSocket";
import { api } from "@/lib/api";

export interface JobStatus {
  status: "idle" | "processing" | "complete" | "failed";
  progress: number;
  message?: string;
  result?: any;
  error?: string;
}

const POLL_INTERVAL_MS = 3000;

export function useJobStatus(jobId: string | null) {
  const [state, setState] = useState<JobStatus>({
    status: "idle",
    progress: 0,
  });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsConnected = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!jobId) {
      setState({ status: "idle", progress: 0 });
      return;
    }

    setState({ status: "processing", progress: 0, message: "Starting..." });

    const fetchResult = async () => {
      try {
        const data = await api.request(`/api/jobs/${jobId}`);
        setState({ status: "complete", progress: 100, result: data.data });
      } catch {
        setState({ status: "complete", progress: 100 });
      }
    };

    const handleMessage = (msg: JobMessage) => {
      wsConnected.current = true;
      stopPolling();

      if (msg.type === "job:progress") {
        setState({
          status: "processing",
          progress: msg.progress ?? 0,
          message: msg.message,
        });
      } else if (msg.type === "job:complete") {
        if (msg.data !== undefined) {
          setState({ status: "complete", progress: 100, result: msg.data });
        } else {
          fetchResult();
        }
      } else if (msg.type === "job:error") {
        setState({
          status: "failed",
          progress: 0,
          error: msg.error,
        });
      }
    };

    const unsubscribe = subscribeToJob(jobId, handleMessage);

    // REST polling fallback — starts after a short delay to give WS a chance
    const startPolling = () => {
      if (pollRef.current) return;
      pollRef.current = setInterval(async () => {
        if (wsConnected.current) {
          stopPolling();
          return;
        }
        try {
          const data = await api.request(`/api/jobs/${jobId}`);
          if (data.status === "complete") {
            setState({ status: "complete", progress: 100, result: data.data });
            stopPolling();
          } else if (data.status === "failed") {
            setState({ status: "failed", progress: 0, error: data.error });
            stopPolling();
          } else {
            setState({
              status: "processing",
              progress: data.progress ?? 0,
              message: data.message,
            });
          }
        } catch {
          // polling error — will retry on next interval
        }
      }, POLL_INTERVAL_MS);
    };

    const pollDelay = setTimeout(() => {
      if (!wsConnected.current) startPolling();
    }, 2000);

    return () => {
      unsubscribe();
      stopPolling();
      clearTimeout(pollDelay);
    };
  }, [jobId, stopPolling]);

  const reset = useCallback(() => {
    setState({ status: "idle", progress: 0 });
    stopPolling();
  }, [stopPolling]);

  return { ...state, reset };
}
