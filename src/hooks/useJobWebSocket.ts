import { useEffect, useRef, useCallback } from "react";
import { getWebSocketUrl, getWebSocketProtocol } from "@/lib/api";

export type JobMessage = {
  type: "job:progress" | "job:complete" | "job:error";
  jobId: string;
  jobType?: string;
  progress?: number;
  message?: string;
  data?: any;
  error?: string;
};

type Listener = (msg: JobMessage) => void;

const listeners = new Map<string, Set<Listener>>();
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let refCount = 0;

function getWsUrl(): string {
  const token = localStorage.getItem("auth_token") || "test-token";
  try {
    const backendUrl = getWebSocketUrl();
    const urlWithoutProtocol = backendUrl.replace(/^https?:\/\//, "");
    const wsProtocol = getWebSocketProtocol(backendUrl);
    return `${wsProtocol}${urlWithoutProtocol}/ws/jobs?token=${encodeURIComponent(token)}`;
  } catch {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws/jobs?token=${encodeURIComponent(token)}`;
  }
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try {
    ws = new WebSocket(getWsUrl());
    ws.onmessage = (ev) => {
      try {
        const msg: JobMessage = JSON.parse(ev.data);
        const jobListeners = listeners.get(msg.jobId);
        if (jobListeners) {
          for (const fn of jobListeners) fn(msg);
        }
      } catch { /* ignore non-JSON */ }
    };
    ws.onclose = () => {
      ws = null;
      if (refCount > 0) {
        reconnectTimer = setTimeout(connect, 3000);
      }
    };
    ws.onerror = () => {
      ws?.close();
    };
  } catch { /* connection failure handled by onclose */ }
}

function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
}

export function subscribeToJob(jobId: string, listener: Listener): () => void {
  if (!listeners.has(jobId)) listeners.set(jobId, new Set());
  listeners.get(jobId)!.add(listener);
  refCount++;
  connect();
  return () => {
    const set = listeners.get(jobId);
    if (set) {
      set.delete(listener);
      if (set.size === 0) listeners.delete(jobId);
    }
    refCount--;
    if (refCount <= 0) {
      refCount = 0;
      disconnect();
    }
  };
}

export function useJobWebSocket() {
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const subscribe = useCallback(
    (jobId: string, listener: Listener) => subscribeToJob(jobId, listener),
    []
  );

  return { subscribe };
}
