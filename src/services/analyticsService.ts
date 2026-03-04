/**
 * Frontend analytics service: session, event buffer, batched flush, and tracking helpers.
 * Does not start listeners; AnalyticsContext wires page view, click, time-on-page, form.
 */

import { api, getApiUrl } from "@/lib/api";

const SESSION_STORAGE_KEY = "cohi_analytics_session_id";
const FLUSH_INTERVAL_MS = 5000;
const FLUSH_BATCH_SIZE = 20;
const MAX_ELEMENT_TEXT_LENGTH = 200;

export interface AnalyticsIdentity {
  userId: string;
  tenantId: string;
}

export interface AnalyticsEventBase {
  sessionId: string;
  userId: string;
  tenantId: string;
  eventType: string;
  eventName?: string | null;
  pageUrl?: string | null;
  pagePath?: string | null;
  referrerPath?: string | null;
  elementTag?: string | null;
  elementId?: string | null;
  elementText?: string | null;
  elementSelector?: string | null;
  clickX?: number | null;
  clickY?: number | null;
  viewportWidth?: number | null;
  viewportHeight?: number | null;
  metadata?: Record<string, unknown> | null;
  durationMs?: number | null;
  createdAt?: string | null;
}

let identity: AnalyticsIdentity | null = null;
let buffer: AnalyticsEventBase[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let lastPagePath: string | null = null;
let pageEnteredAt: number = 0;

function getSessionId(): string {
  let sid = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(SESSION_STORAGE_KEY) : null;
  if (!sid) {
    sid = `s_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(SESSION_STORAGE_KEY, sid);
    }
  }
  return sid;
}

function getViewport(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 0, height: 0 };
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

/**
 * Build a short CSS selector path for an element (for heatmaps). Stops at body.
 */
function getElementSelector(el: Element | null): string | null {
  if (!el || el === document.body) return null;
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.body && parts.length < 5) {
    if (current.id) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break;
    }
    let selector = current.tagName.toLowerCase();
    if (current.classList.length) {
      selector += "." + Array.from(current.classList).slice(0, 2).map((c) => CSS.escape(c)).join(".");
    }
    parts.unshift(selector);
    current = current.parentElement;
  }
  return parts.length ? parts.join(" > ") : null;
}

/**
 * Truncate and sanitize text content (no PII).
 */
function truncateText(text: string | null | undefined): string | null {
  if (text == null) return null;
  const t = String(text).replace(/\s+/g, " ").trim().slice(0, MAX_ELEMENT_TEXT_LENGTH);
  return t || null;
}

export function initAnalytics(id: AnalyticsIdentity): void {
  identity = id;
  startFlushInterval();
  setupBeforeUnload();
}

export function setIdentity(id: AnalyticsIdentity): void {
  identity = id;
}

export function getIdentity(): AnalyticsIdentity | null {
  return identity;
}

export function getSessionIdPublic(): string {
  return getSessionId();
}

function baseEvent(): Partial<AnalyticsEventBase> {
  const vp = getViewport();
  return {
    sessionId: getSessionId(),
    userId: identity?.userId ?? "",
    tenantId: identity?.tenantId ?? "",
    viewportWidth: vp.width,
    viewportHeight: vp.height,
    createdAt: new Date().toISOString(),
  };
}

export function pushEvent(event: AnalyticsEventBase): void {
  if (!identity) return;
  buffer.push(event);
  if (buffer.length >= FLUSH_BATCH_SIZE) {
    flush();
  }
}

export function trackPageView(pagePath: string, pageUrl: string, referrerPath?: string | null): void {
  lastPagePath = pagePath;
  pageEnteredAt = Date.now();
  pushEvent({
    ...baseEvent(),
    eventType: "page_view",
    eventName: "page_view",
    pagePath,
    pageUrl,
    referrerPath: referrerPath ?? document.referrer ? new URL(document.referrer).pathname : null,
  } as AnalyticsEventBase);
}

export function trackPageLeave(pagePath: string, durationMs: number): void {
  pushEvent({
    ...baseEvent(),
    eventType: "page_leave",
    eventName: "page_leave",
    pagePath,
    pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
    durationMs,
  } as AnalyticsEventBase);
}

export function trackClick(
  element: Element,
  pagePath: string,
  pageUrl: string,
  clientX?: number,
  clientY?: number
): void {
  const tag = element.tagName?.toLowerCase() ?? null;
  const id = element.id ? String(element.id) : null;
  const dataTrack = element.getAttribute?.("data-track");
  const eventName = dataTrack ?? (tag ? `click_${tag}` : "click");
  let text: string | null = null;
  if (element.textContent) text = truncateText(element.textContent);
  const vp = getViewport();
  pushEvent({
    ...baseEvent(),
    eventType: "click",
    eventName,
    pagePath,
    pageUrl,
    elementTag: tag,
    elementId: id,
    elementText: text,
    elementSelector: getElementSelector(element),
    clickX: clientX ?? null,
    clickY: clientY ?? null,
    viewportWidth: vp.width,
    viewportHeight: vp.height,
  } as AnalyticsEventBase);
}

export function trackFormInteraction(
  kind: "focus" | "blur" | "submit",
  fieldNameOrFormId: string,
  pagePath: string,
  pageUrl: string
): void {
  pushEvent({
    ...baseEvent(),
    eventType: "form_interaction",
    eventName: `form_${kind}_${fieldNameOrFormId}`,
    pagePath,
    pageUrl,
    metadata: { kind, field: fieldNameOrFormId },
  } as AnalyticsEventBase);
}

export function trackEvent(name: string, metadata?: Record<string, unknown>): void {
  const pagePath = typeof window !== "undefined" ? window.location.pathname : "";
  const pageUrl = typeof window !== "undefined" ? window.location.href : "";
  pushEvent({
    ...baseEvent(),
    eventType: "custom",
    eventName: name,
    pagePath,
    pageUrl,
    metadata: metadata ?? undefined,
  } as AnalyticsEventBase);
}

function sendBatch(events: AnalyticsEventBase[]): void {
  const body = JSON.stringify({ events });
  if (typeof fetch === "undefined") return;
  api
    .fetchWithAuth("/api/analytics/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    })
    .then((res) => {
      if (!res.ok) console.warn("[Analytics] flush failed", res.status);
    })
    .catch((err) => console.warn("[Analytics] flush error", err));
}

export function flush(): void {
  if (buffer.length === 0) return;
  const toSend = buffer.slice();
  buffer = [];
  sendBatch(toSend);
}

function startFlushInterval(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flush();
  }, FLUSH_INTERVAL_MS);
}

export function stopFlushInterval(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

function setupBeforeUnload(): void {
  if (typeof window === "undefined") return;
  const onUnload = () => {
    if (lastPagePath && pageEnteredAt) {
      trackPageLeave(lastPagePath, Date.now() - pageEnteredAt);
    }
    stopFlushInterval();
    if (buffer.length > 0) {
      const base = getApiUrl();
      const fullUrl = base ? `${base}/api/analytics/events` : "/api/analytics/events";
      const token = api.getToken();
      const body = JSON.stringify({ events: buffer });
      buffer = [];
      fetch(fullUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  };
  window.addEventListener("beforeunload", onUnload);
  window.addEventListener("pagehide", onUnload);
}

export function getLastPagePath(): string | null {
  return lastPagePath;
}

export function getPageEnteredAt(): number {
  return pageEnteredAt;
}

export function shouldTrackElement(el: Element): boolean {
  if (el.closest("[data-no-track]")) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === "input" && (el as HTMLInputElement).type === "password") return false;
  if (tag === "button" && (el as HTMLButtonElement).type === "submit") return true;
  return true;
}
