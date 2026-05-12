// Detect API URL - use environment variable or detect from current location
// Export this function so other components can use it
export const getApiUrl = (): string => {
  // If VITE_API_URL is explicitly set, use it (highest priority)
  if (
    import.meta.env.VITE_API_URL &&
    import.meta.env.VITE_API_URL.trim() !== ""
  ) {
    return import.meta.env.VITE_API_URL;
  }

  // In production (GitHub Pages, S3, Vercel, etc.), detect from current origin
  if (typeof window !== "undefined") {
    const origin = window.location.origin;
    const hostname = window.location.hostname;

    // For Vite dev server (development mode), use relative paths so Vite proxy handles it
    // This works for localhost, Replit, and other dev environments with Vite proxy
    if (import.meta.env.DEV) {
      console.log("Using Vite dev proxy for API requests");
      return ""; // Empty string = relative paths, Vite proxies /api/* to backend
    }

    // For CloudFront distributions
    if (hostname.includes("cloudfront.net")) {
      // Check localStorage for custom backend URL (can be set in admin)
      const customBackendUrl = localStorage.getItem("BACKEND_API_URL");
      if (customBackendUrl && customBackendUrl.trim() !== "") {
        console.log(
          "Using custom backend URL from localStorage:",
          customBackendUrl
        );
        return customBackendUrl;
      }
      // Use same origin - CloudFront proxies /api/* to backend
      console.log("Using CloudFront API proxy (same origin)");
      return ""; // Empty string = same origin as frontend
    }

    // For S3 website endpoints, use the configured backend URL
    if (hostname.includes("s3-website") || hostname.includes("amazonaws.com")) {
      console.warn("VITE_API_URL not set in build. Using default backend URL.");
      return "http://localhost:3001";
    }

    // For GitHub Pages (github.io), backend is typically on a different domain
    if (hostname.includes("github.io") || hostname.includes("github.com")) {
      console.warn(
        "Backend API URL not configured. Please set VITE_API_URL in GitHub Secrets."
      );
      return "";
    }

    // Check localStorage for custom backend URL (can be set in admin for any domain)
    const customBackendUrl = localStorage.getItem("BACKEND_API_URL");
    if (customBackendUrl && customBackendUrl.trim() !== "") {
      console.log(
        "Using custom backend URL from localStorage:",
        customBackendUrl
      );
      return customBackendUrl;
    }

    // For other production domains, assume backend is on same origin or /api
    return origin;
  }

  // Default to empty for relative paths
  return "";
};

/**
 * Convert HTTP/HTTPS URL to WebSocket protocol (ws/wss)
 * IMPORTANT: Browsers block ws:// connections from https:// pages for security.
 * If page is HTTPS, we MUST use wss:// (requires HTTPS listener on ALB).
 */
export const getWebSocketProtocol = (backendUrl: string): string => {
  // If backend URL is already https://, use wss://
  if (backendUrl.startsWith("https://")) {
    return "wss://";
  }

  // If page is loaded over HTTPS, we MUST use wss:// (browsers block ws:// from HTTPS pages)
  // Even if backend URL is http://, we try wss:// because:
  // 1. ALB might have HTTPS listener configured
  // 2. If it fails, we'll catch the error and provide helpful message
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    // Try wss:// even if backend URL is http://
    // The ALB might support HTTPS even if the URL is configured as HTTP
    return "wss://";
  }

  // If page is HTTP, use ws:// for http:// backend URLs
  if (backendUrl.startsWith("http://")) {
    return "ws://";
  }

  // Default to ws:// for local development
  return "ws://";
};

/**
 * Get WebSocket URL - always returns a direct backend URL (bypasses CloudFront)
 * CloudFront does not support WebSocket connections, so we must connect directly to the backend
 */
export const getWebSocketUrl = (): string => {
  // If VITE_WEBSOCKET_URL is explicitly set, use it (highest priority)
  if (
    import.meta.env.VITE_WEBSOCKET_URL &&
    import.meta.env.VITE_WEBSOCKET_URL.trim() !== ""
  ) {
    return import.meta.env.VITE_WEBSOCKET_URL;
  }

  // Check localStorage for direct backend URL (should be set to Elastic Beanstalk endpoint)
  if (typeof window !== "undefined") {
    const customBackendUrl = localStorage.getItem("BACKEND_API_URL");
    if (customBackendUrl && customBackendUrl.trim() !== "") {
      console.log(
        "Using direct backend URL for WebSocket from localStorage:",
        customBackendUrl
      );
      return customBackendUrl;
    }

    // For CloudFront, we MUST use the direct backend URL (not CloudFront)
    // CloudFront does not support WebSocket connections
    const hostname = window.location.hostname;
    if (hostname.includes("cloudfront.net")) {
      // Try to get from VITE_API_URL if it's set to a direct backend URL
      const apiUrl = import.meta.env.VITE_API_URL;
      if (
        apiUrl &&
        apiUrl.trim() !== "" &&
        !apiUrl.includes("cloudfront.net")
      ) {
        console.log("Using VITE_API_URL for WebSocket connection:", apiUrl);
        return apiUrl;
      }
      // If no direct backend URL is configured, throw an error with helpful message
      const errorMsg =
        "WebSocket connection requires direct backend URL. CloudFront does not support WebSocket connections.\n\n" +
        "To fix this:\n" +
        "1. Get your Elastic Beanstalk endpoint URL from AWS Console or CloudFormation outputs (BackendEndpoint)\n" +
        '2. Set it in localStorage: localStorage.setItem("BACKEND_API_URL", "http://your-eb-env.elasticbeanstalk.com")\n' +
        "3. Or set VITE_WEBSOCKET_URL environment variable during build\n\n" +
        'Example: localStorage.setItem("BACKEND_API_URL", "http://coheus-backend-dev-tenant-001.us-east-1.elasticbeanstalk.com")';
      console.error(errorMsg);
      // Throw error instead of returning placeholder to prevent mixed content issues
      throw new Error(
        "WebSocket backend URL not configured. Please set BACKEND_API_URL in localStorage or VITE_WEBSOCKET_URL environment variable."
      );
    }
  }

  // For other cases, use the regular API URL (which should be a direct backend URL)
  const apiUrl = getApiUrl();
  if (apiUrl && apiUrl.trim() !== "") {
    return apiUrl;
  }

  // Fallback to localhost for local development
  return "http://localhost:3001";
};

const API_URL = getApiUrl();

const PLATFORM_STAFF_ROLES = new Set(["super_admin", "platform_admin", "support"]);

export class ApiClient {
  private baseUrl: string;
  private token: string | null = null;
  private userRole: string | null = null;
  private requestCache: Map<string, { data: any; timestamp: number }> =
    new Map();
  private pendingRequests: Map<string, Promise<any>> = new Map();
  private readonly CACHE_TTL = 30000; // 30 seconds cache
  private refreshPromise: Promise<boolean> | null = null;
  private readonly AUTH_EVENT_EXPIRED = "cohi:auth-expired";
  private proactiveRefreshTimeout: ReturnType<typeof setTimeout> | null = null;
  private expiryLogoutTimeout: ReturnType<typeof setTimeout> | null = null;
  private lifecycleListenersRegistered = false;

  constructor(baseUrl: string = API_URL) {
    this.baseUrl = baseUrl;
    this.token = localStorage.getItem("auth_token");
    this.registerLifecycleListeners();
    this.scheduleTokenLifecycle();
  }

  setUserRole(role: string | null) {
    this.userRole = role;
  }

  hasToken(): boolean {
    return !!this.token;
  }

  getToken(): string | null {
    return this.token;
  }

  private getHealthUrl(): string {
    // When baseUrl is empty string, we're using same-origin (CloudFront proxy),
    // so health must go through /api/* behavior.
    return this.baseUrl ? `${this.baseUrl}/health` : "/api/health";
  }

  setToken(token: string) {
    this.token = token;
    localStorage.setItem("auth_token", token);
    this.scheduleTokenLifecycle();
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem("auth_token");
    this.clearLifecycleTimers();
    // Clear all cached data to prevent stale data after logout
    this.clearCache();
  }

  /**
   * Clear all cached requests and pending requests
   * Should be called on logout to prevent stale data
   */
  clearCache() {
    this.requestCache.clear();
    this.pendingRequests.clear();
    console.log("[API] Cache cleared");
  }

  /**
   * Invalidate cached GET responses whose key contains the given substring.
   * Useful after mutations that should bust a related GET cache.
   */
  invalidateCacheFor(endpointSubstring: string) {
    for (const key of this.requestCache.keys()) {
      if (key.includes(endpointSubstring)) {
        this.requestCache.delete(key);
      }
    }
    for (const key of this.pendingRequests.keys()) {
      if (key.includes(endpointSubstring)) {
        this.pendingRequests.delete(key);
      }
    }
  }

  /**
   * Attempt to refresh the auth token using the stored Cognito refresh token.
   * Returns true if refresh succeeded, false otherwise.
   * Deduplicates concurrent refresh attempts.
   */
  private async tryRefreshToken(): Promise<boolean> {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      const refreshToken = localStorage.getItem("refresh_token");
      if (!refreshToken) return false;

      try {
        const url = this.baseUrl
          ? `${this.baseUrl}/api/auth/refresh`
          : "/api/auth/refresh";

        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });

        if (!response.ok) return false;

        const data = await response.json();
        if (data.token) {
          this.setToken(data.token);
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private isTokenAuthFailure(status: number, errorData: any): boolean {
    if (status === 401) return true;
    if (status !== 403) return false;
    const message = String(errorData?.error || "").toLowerCase();
    return (
      message.includes("token") ||
      message.includes("expired") ||
      message.includes("unauthorized")
    );
  }

  private isAuthRecoveryEligible(endpoint: string): boolean {
    return !endpoint.includes("/auth/signin") && !endpoint.includes("/auth/refresh");
  }

  private forceLogoutAndRedirect() {
    this.clearToken();
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("cognito_access_token");
    localStorage.removeItem("impersonating_tenant");
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(this.AUTH_EVENT_EXPIRED));
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
    }
  }

  /**
   * Decode JWT exp claim from the current token.
   */
  private getTokenExpiryMs(): number | null {
    if (!this.token) return null;
    try {
      const payload = JSON.parse(atob(this.token.split(".")[1]));
      return typeof payload.exp === "number" ? payload.exp * 1000 : null;
    } catch {
      return null;
    }
  }

  private clearLifecycleTimers() {
    if (this.proactiveRefreshTimeout) {
      clearTimeout(this.proactiveRefreshTimeout);
      this.proactiveRefreshTimeout = null;
    }
    if (this.expiryLogoutTimeout) {
      clearTimeout(this.expiryLogoutTimeout);
      this.expiryLogoutTimeout = null;
    }
  }

  /**
   * Schedule proactive refresh and hard logout at token expiry.
   */
  private scheduleTokenLifecycle() {
    this.clearLifecycleTimers();
    const expiresAt = this.getTokenExpiryMs();
    if (!expiresAt) return;

    const logoutDelay = expiresAt - Date.now();
    if (logoutDelay <= 0) {
      this.forceLogoutAndRedirect();
      return;
    }

    this.expiryLogoutTimeout = setTimeout(() => {
      this.forceLogoutAndRedirect();
    }, logoutDelay);

    // Attempt refresh 5 minutes before expiry to keep active sessions alive.
    const refreshAt = expiresAt - 5 * 60 * 1000;
    const delay = refreshAt - Date.now();
    if (delay > 0) {
      this.proactiveRefreshTimeout = setTimeout(() => {
        this.tryRefreshToken().catch(() => {
          // No-op: auth failure path will clear and redirect on next request/expiry.
        });
      }, delay);
    }
  }

  private registerLifecycleListeners() {
    if (this.lifecycleListenersRegistered || typeof window === "undefined") return;

    const ensureTokenStillValid = () => {
      const expiresAt = this.getTokenExpiryMs();
      if (!expiresAt) return;
      if (Date.now() >= expiresAt) {
        this.forceLogoutAndRedirect();
      }
    };

    window.addEventListener("focus", ensureTokenStillValid);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        ensureTokenStillValid();
      }
    });
    window.addEventListener("storage", (event) => {
      if (event.key === "auth_token") {
        this.token = event.newValue;
        this.scheduleTokenLifecycle();
      }
    });

    this.lifecycleListenersRegistered = true;
  }

  // Get API Gateway URLs from environment
  getApiGatewayRestUrl(): string {
    return import.meta.env.VITE_API_GATEWAY_REST_URL || "";
  }

  getApiGatewayWebSocketUrl(): string {
    return import.meta.env.VITE_API_GATEWAY_WEBSOCKET_URL || "";
  }

  // Invoke Lambda function via API Gateway REST
  async invokeFunction<T>(functionName: string, body: any): Promise<T> {
    const apiGatewayUrl = this.getApiGatewayRestUrl();
    if (!apiGatewayUrl) {
      throw new Error(
        "API Gateway REST URL not configured. Set VITE_API_GATEWAY_REST_URL"
      );
    }

    return this.request<T>(`${apiGatewayUrl}/${functionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  // Create WebSocket connection to API Gateway
  createWebSocket(path: string): WebSocket {
    const apiGatewayWsUrl = this.getApiGatewayWebSocketUrl();
    if (!apiGatewayWsUrl) {
      throw new Error(
        "API Gateway WebSocket URL not configured. Set VITE_API_GATEWAY_WEBSOCKET_URL"
      );
    }

    const wsUrl = `${apiGatewayWsUrl}/${path}`;
    return new WebSocket(wsUrl);
  }

  async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retries = 0
  ): Promise<T> {
    // Defense-in-depth: strip tenant_id from requests for non-platform users
    let sanitizedEndpoint = endpoint;
    if (this.userRole && !PLATFORM_STAFF_ROLES.has(this.userRole)) {
      const url_ = new URL(endpoint, "http://placeholder");
      if (url_.searchParams.has("tenant_id")) {
        url_.searchParams.delete("tenant_id");
        sanitizedEndpoint = url_.pathname + url_.search;
      }
    }
    endpoint = sanitizedEndpoint;

    // If baseUrl is empty string (CloudFront same-origin), use endpoint directly
    // Otherwise, prepend baseUrl
    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    // Log request for debugging (only in development or when retrying)
    if (retries > 0 || import.meta.env.DEV) {
      console.log(
        `[API Request] ${
          options.method || "GET"
        } ${endpoint} -> ${url} (retry ${retries})`
      );
    }

    // Skip caching for non-GET requests or if cache-busting is requested
    const isGetRequest = !options.method || options.method === "GET";
    const skipCache =
      options.headers &&
      "Cache-Control" in options.headers &&
      (options.headers as any)["Cache-Control"] === "no-cache";
    const cacheKey = `${options.method || "GET"}:${url}`;

    // Check for pending request (deduplication)
    if (isGetRequest && !skipCache && this.pendingRequests.has(cacheKey)) {
      return this.pendingRequests.get(cacheKey)!;
    }

    // Check cache for GET requests
    if (isGetRequest && !skipCache) {
      const cached = this.requestCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return cached.data as T;
      }
    }

    // Create request promise for deduplication
    const requestPromise = this.executeRequest<T>(
      endpoint,
      url,
      options,
      retries,
      cacheKey,
      isGetRequest,
      skipCache
    );

    // Store pending request for deduplication
    if (isGetRequest && !skipCache) {
      this.pendingRequests.set(cacheKey, requestPromise);
    }

    return requestPromise;
  }

  async fetchWithAuth(
    endpoint: string,
    options: RequestInit = {},
    retries = 0
  ): Promise<Response> {
    // If baseUrl is empty string (CloudFront same-origin), use endpoint directly
    // Otherwise, prepend baseUrl
    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;
    const headers: HeadersInit = {
      ...options.headers,
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let errorData: any = {};
      try {
        const errorText = await response.clone().text();
        if (errorText?.trim()) {
          errorData = JSON.parse(errorText);
        }
      } catch {
        // Ignore parse errors - status-based auth handling is still valid.
      }

      const shouldRecover =
        this.isAuthRecoveryEligible(endpoint) &&
        this.isTokenAuthFailure(response.status, errorData);

      if (shouldRecover) {
        if (retries === 0) {
          const refreshed = await this.tryRefreshToken();
          if (refreshed) {
            return this.fetchWithAuth(endpoint, options, retries + 1);
          }
        }
        this.forceLogoutAndRedirect();
      }
    }

    return response;
  }

  private async executeRequest<T>(
    endpoint: string,
    url: string,
    options: RequestInit,
    retries: number,
    cacheKey: string,
    isGetRequest: boolean,
    skipCache: boolean
  ): Promise<T> {
    const headers: HeadersInit = {
      ...options.headers,
    };

    // Don't set Content-Type for FormData (let browser set it with boundary)
    if (!(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    } else {
    }

    // Request timeouts — async job endpoints return 202 in <1s,
    // so only file uploads and chat streams need extended timeouts.
    const isFileUpload = options.body instanceof FormData;
    const isImportEndpoint = endpoint.includes("/import/");
    const isInsightsGenerateEndpoint = endpoint.includes("/dashboard-insights/generate");
    const isSlowEndpoint =
      endpoint.includes("/loans/funnel") ||
      endpoint.includes("/dashboard/analytics") ||
      isInsightsGenerateEndpoint;
    const isChatEndpoint = endpoint.includes("/cohi-chat/");
    const timeoutMs =
      isFileUpload || isImportEndpoint
        ? 600000   // 10 minutes for file uploads/imports
        : isChatEndpoint
        ? 300000   // 5 minutes for AI chat (streaming)
      : isInsightsGenerateEndpoint
        ? 180000   // 3 minutes for insight generation (LLM + evidence shaping)
        : 60000;   // 60s default — async job endpoints return 202 immediately

    // Create abort controller for timeout (more compatible than AbortSignal.timeout)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Read response body once (can only be read once)
      const responseText = await response.text();

      if (!response.ok) {
        // Try to parse error response
        let errorData: any = { error: "Unknown error" };
        try {
          if (responseText && responseText.trim()) {
            errorData = JSON.parse(responseText);
          }
        } catch (e) {
          // If parsing fails, use status text or response text
          errorData = {
            error:
              responseText && responseText.trim()
                ? responseText.substring(0, 200)
                : response.statusText || `HTTP ${response.status}`,
          };
        }
        // For 503 errors, preserve the error message
        if (response.status === 503) {
          throw new Error(
            errorData.error ||
              "Service temporarily unavailable. Please try again."
          );
        }

        const shouldRecover =
          this.isAuthRecoveryEligible(endpoint) &&
          this.isTokenAuthFailure(response.status, errorData);

        // Attempt one token refresh on auth failures, then force logout.
        if (shouldRecover) {
          if (retries === 0) {
            const refreshed = await this.tryRefreshToken();
            if (refreshed) {
              return this.request<T>(endpoint, options, retries + 1);
            }
          }
          this.forceLogoutAndRedirect();
        }

        throw new Error(
          errorData.message
            ? `${errorData.error || "Request failed"}: ${errorData.message}`
            : errorData.error || "Request failed"
        );
      }

      // Handle empty responses for successful requests
      if (!responseText || !responseText.trim()) {
        // Empty response body
        if (response.status === 200 || response.status === 204) {
          return {} as T;
        }
        throw new Error(
          `Server returned empty response (status ${response.status}). This may indicate a server error.`
        );
      }

      // Parse JSON response
      let jsonData: T;
      try {
        jsonData = JSON.parse(responseText);
      } catch (parseError: any) {
        // If JSON parsing fails, provide helpful error message
        if (parseError.message?.includes("Unexpected end of JSON input")) {
          throw new Error(
            `Server returned empty or incomplete JSON response. This may indicate the server crashed or encountered an error while processing your request. Status: ${
              response.status
            }. Response preview: ${responseText.substring(0, 100)}`
          );
        }
        throw new Error(
          `Failed to parse server response as JSON: ${
            parseError.message
          }. Response preview: ${responseText.substring(0, 100)}`
        );
      }

      // Cache successful GET responses
      if (isGetRequest && !skipCache && response.ok) {
        this.requestCache.set(cacheKey, {
          data: jsonData,
          timestamp: Date.now(),
        });
      }

      // Remove from pending requests
      this.pendingRequests.delete(cacheKey);

      return jsonData;
    } catch (error: any) {
      // Remove from pending requests on error
      this.pendingRequests.delete(cacheKey);

      clearTimeout(timeoutId);

      // Handle abort/timeout errors
      if (error.name === "AbortError" || error.message?.includes("timeout")) {
        const timeoutDuration =
          timeoutMs % 60000 === 0
            ? `${timeoutMs / 60000} minute${timeoutMs / 60000 === 1 ? "" : "s"}`
            : `${Math.round(timeoutMs / 1000)} seconds`;
        // Only retry GET requests on timeout — POST/PUT/DELETE are not idempotent
        if (isGetRequest && retries < 1) {
          console.warn(
            `Request timeout for ${endpoint} after ${timeoutDuration}. Retrying... (attempt ${
              retries + 1
            }/1)`
          );
          await new Promise((resolve) => setTimeout(resolve, 2000));
          return this.executeRequest(
            endpoint,
            url,
            options,
            retries + 1,
            cacheKey,
            isGetRequest,
            skipCache
          );
        }
        // Provide more helpful error message for slow endpoints
        const baseUrlInfo = this.baseUrl || "CloudFront proxy";
        if (isChatEndpoint) {
          throw new Error(
            `Request timed out after ${timeoutDuration}. The AI is taking longer than expected to process your question. Please try again.`
          );
        }
        if (isSlowEndpoint) {
          throw new Error(
            `Request timed out after ${timeoutDuration}. This endpoint may be processing a large dataset. The backend may be slow or unavailable. Please try again in a moment.`
          );
        }
        console.error(
          `Request timed out after retries. Endpoint: ${endpoint}, Base URL: ${baseUrlInfo}, Timeout: ${timeoutDuration}`
        );
        throw new Error(
          `Request timed out after ${timeoutDuration}. The server at ${baseUrlInfo} may be slow or unavailable. Please check your connection and try again.`
        );
      }

      // Handle network errors with retry (only for GET — POST is not safe to retry)
      if (
        isGetRequest &&
        (error.message?.includes("Failed to fetch") ||
          error.message?.includes("NetworkError") ||
          error.name === "TypeError" ||
          error.code === "ECONNREFUSED") &&
        retries < 2
      ) {
        console.warn(
          `Connection error to ${url}. Retrying in 2 seconds... (attempt ${
            retries + 1
          }/2)`
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return this.executeRequest(
          endpoint,
          url,
          options,
          retries + 1,
          cacheKey,
          isGetRequest,
          skipCache
        );
      }

      // Re-throw with better error message for connection errors
      const isConnectionError =
        error.message?.includes("Failed to fetch") ||
        error.name === "TypeError" ||
        error.name === "AbortError" ||
        error.message?.includes("NetworkError") ||
        error.code === "ECONNREFUSED";

      // Check for CORS errors specifically
      // Note: "Failed to fetch" can be many things (CORS, network, timeout, etc.)
      // Only treat as CORS if explicitly mentioned or if we can verify via health check
      const isCorsError =
        error.message?.includes("CORS") ||
        error.message?.includes("Not allowed by CORS") ||
        error.message?.includes("blocked by CORS policy");

      if (isConnectionError) {
        // Only check health if we haven't already (to avoid infinite loops)
        if (endpoint !== "/health" && endpoint !== "/api/health") {
          try {
            const healthController = new AbortController();
            // Increased health check timeout to 5 seconds to account for slow responses
            const healthTimeout = setTimeout(
              () => healthController.abort(),
              5000
            );
            // Use /api/health for same-origin (CloudFront proxy), or baseUrl/health for direct backend
            const healthUrl = this.baseUrl
              ? `${this.baseUrl}/health`
              : "/api/health";
            console.log(`Checking backend health at: ${healthUrl}`);
            const healthCheck = await fetch(healthUrl, {
              signal: healthController.signal,
              method: "GET",
            });
            clearTimeout(healthTimeout);

            if (healthCheck.ok || healthCheck.status === 503) {
              // Server is running (503 means degraded but running)
              // If health check succeeds, the original error was NOT a CORS issue
              // It's likely an authentication error, rate limiting, or endpoint-specific issue
              throw new Error(
                `Unable to complete request to ${endpoint}. The server is running. Please check your authentication or try again.`
              );
            }
          } catch (healthError: any) {
            // Health check failed - server is not reachable
            // If health check also fails, then it might be a real connection/CORS issue
            if (
              healthError.name === "AbortError" ||
              healthError.name === "TypeError"
            ) {
              // Check if the error message explicitly mentions CORS
              if (
                healthError.message?.includes("CORS") ||
                healthError.message?.includes("blocked by CORS policy")
              ) {
                throw new Error(
                  `CORS Error: Unable to verify server connection. The backend may not be configured to allow requests from ${window.location.origin}. Please update the backend FRONTEND_URL environment variable.`
                );
              }
              const serverLocation = this.baseUrl || "the backend server";
              throw new Error(
                `Unable to connect to ${serverLocation}. The server did not respond. Please ensure the backend server is running.`
              );
            }
            // If health check threw a different error, re-throw the original error
            throw error;
          }
        }

        if (isCorsError) {
          const serverLocation =
            this.baseUrl || "the backend server (via CloudFront proxy)";
          throw new Error(
            `CORS Error: ${serverLocation} is not configured to allow requests from ${window.location.origin}. Please update the backend FRONTEND_URL environment variable to include this origin.`
          );
        }

        const serverLocation = this.baseUrl || "the backend server";
        throw new Error(
          `Unable to connect to ${serverLocation}. Please ensure the backend server is running.`
        );
      }

      throw error;
    }
  }

  // Auth methods
  async signUp(email: string, password: string, fullName?: string) {
    const data = await this.request<{ user: any; token: string }>(
      "/api/auth/signup",
      {
        method: "POST",
        body: JSON.stringify({ email, password, full_name: fullName }),
      }
    );
    this.setToken(data.token);
    return data;
  }

  async signIn(email: string, password: string) {
    // Pre-flight: Verify server is reachable before attempting login
    // This provides immediate feedback if server is down
    let serverReachable = false;
    let serverError: string | null = null;

    try {
      const healthController = new AbortController();
      const healthTimeout = setTimeout(() => healthController.abort(), 2000); // Fast check
      const healthResponse = await fetch(this.getHealthUrl(), {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: healthController.signal,
        cache: "no-cache",
      });
      clearTimeout(healthTimeout);
      serverReachable = healthResponse.ok || healthResponse.status === 503;
    } catch (healthError: any) {
      // Server not reachable
      serverReachable = false;
      if (healthError.name === "AbortError") {
        serverError =
          "Server did not respond. Please ensure the backend server is running on port 3001.";
      } else {
        serverError =
          "Unable to connect to server. Please ensure the backend server is running on port 3001.";
      }
    }

    if (!serverReachable) {
      throw new Error(
        serverError ||
          "Unable to connect to server. Please ensure the backend server is running on port 3001."
      );
    }

    try {
      const data = await this.request<{ user: any; token: string }>(
        "/api/auth/signin",
        {
          method: "POST",
          body: JSON.stringify({ email, password }),
        }
      );
      this.setToken(data.token);
      return data;
    } catch (error: any) {
      // Handle 503 Service Unavailable (database connection issues)
      if (
        error.message?.includes("503") ||
        error.message?.includes("Service temporarily unavailable") ||
        error.message?.includes("Database connection")
      ) {
        // Wait and retry once for transient database issues
        await new Promise((resolve) => setTimeout(resolve, 2000));
        try {
          const data = await this.request<{ user: any; token: string }>(
            "/api/auth/signin",
            {
              method: "POST",
              body: JSON.stringify({ email, password }),
            }
          );
          this.setToken(data.token);
          return data;
        } catch (retryError: any) {
          // If retry also fails, throw a user-friendly error
          if (
            retryError.message?.includes("503") ||
            retryError.message?.includes("Service temporarily unavailable")
          ) {
            throw new Error(
              "Service temporarily unavailable. The database connection is down. Please try again in a moment."
            );
          }
          throw new Error(
            "Unable to connect to server. Please check your connection and try again."
          );
        }
      }

      // Handle network errors with better detection
      const errorMsg = error.message?.toLowerCase() || "";
      if (
        errorMsg.includes("failed to fetch") ||
        errorMsg.includes("networkerror") ||
        errorMsg.includes("unable to connect") ||
        errorMsg.includes("econnrefused") ||
        error.name === "TypeError" ||
        error.name === "AbortError"
      ) {
        // Double-check server status
        try {
          const checkController = new AbortController();
          const checkTimeout = setTimeout(() => checkController.abort(), 2000);
          const checkResponse = await fetch(this.getHealthUrl(), {
            method: "GET",
            signal: checkController.signal,
          });
          clearTimeout(checkTimeout);

          if (checkResponse.ok || checkResponse.status === 503) {
            throw new Error(
              "Server is running but the request failed. Please try again."
            );
          }
        } catch (checkError) {
          // Server is not reachable
        }
        throw new Error(
          "Unable to connect to server. Please ensure the backend server is running on port 3001."
        );
      }

      // Re-throw other errors as-is (like invalid credentials)
      throw error;
    }
  }

  async getCurrentUser() {
    return this.request<{ user: any }>("/api/auth/me");
  }

  async signOut() {
    await this.request("/api/auth/signout", { method: "POST" });
    this.clearToken();
  }

  // Call sessions
  async getCallSessions(limit = 5) {
    return this.request<any[]>(`/api/calls?limit=${limit}`);
  }

  async getCallSession(id: string) {
    return this.request(`/api/calls/${id}`);
  }

  async createCallSession(contactId: string, tenantId?: string) {
    return this.request("/api/calls", {
      method: "POST",
      body: JSON.stringify({ contact_id: contactId, tenant_id: tenantId }),
    });
  }

  async updateCallSession(id: string, updates: any) {
    return this.request(`/api/calls/${id}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  }

  // News methods
  async getNews() {
    return this.request<{
      newsFeed: any[];
      lastUpdated: string;
      error?: string;
    }>("/api/news");
  }

  async getNewsInsights(article: {
    title: string;
    source: string;
    link: string;
    sourceSummary?: string;
  }) {
    return this.request<{
      insights: Array<{
        type: string;
        label: string;
        content: string;
        color: string;
      }>;
      clientDataSummary?: string;
      error?: string;
    }>("/api/news/insights", {
      method: "POST",
      body: JSON.stringify(article),
    });
  }

  async getNewsDetails(article: {
    title: string;
    source: string;
    link: string;
  }) {
    return this.request<{
      articleParagraphs: string[];
      fullArticleUrl: string;
      fetchedAt: string;
      error?: string;
    }>("/api/news/details", {
      method: "POST",
      body: JSON.stringify(article),
    });
  }

  async getDailyBriefNewsletterSubscription() {
    return this.request<{
      enabled: boolean;
      email: string;
    }>("/api/news/newsletter/subscription");
  }

  async updateDailyBriefNewsletterSubscription(payload: {
    enabled: boolean;
    email: string;
  }) {
    return this.request<{
      success: boolean;
      enabled: boolean;
      email: string;
    }>("/api/news/newsletter/subscription", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  async sendDailyBriefPreviewEmail(payload?: { email?: string }) {
    return this.request<{
      success: boolean;
      message: string;
      recipient: string;
    }>("/api/news/newsletter/send-preview", {
      method: "POST",
      body: JSON.stringify(payload || {}),
    });
  }

  // WebSocket connection helper (for Express backend WebSocket)
  // Always uses direct backend URL (bypasses CloudFront which doesn't support WebSocket)
  createBackendWebSocket(path: string): WebSocket {
    // Use getWebSocketUrl to get direct backend URL (not CloudFront)
    let backendUrl: string;
    try {
      backendUrl = getWebSocketUrl();
    } catch (error: any) {
      // Re-throw with more context
      throw new Error(`WebSocket connection failed: ${error.message}`);
    }
    // Remove protocol from backend URL and use appropriate WebSocket protocol
    const urlWithoutProtocol = backendUrl.replace(/^https?:\/\//, "");
    const wsProtocol = getWebSocketProtocol(backendUrl);
    const wsUrl = `${wsProtocol}${urlWithoutProtocol}${path}`;
    const storedToken = this.token || localStorage.getItem("auth_token");
    // In production, the backend rejects missing/placeholder tokens, so fail fast with a helpful message.
    if (!storedToken || storedToken.trim() === "") {
      if (import.meta.env.PROD) {
        throw new Error(
          "Authentication required: please sign in before starting a live voice session."
        );
      }
    }
    // Development fallback: allow connecting without auth (backend allows this in non-production)
    const token = storedToken || "test-token";

    // Add token as query parameter
    const separator = wsUrl.includes("?") ? "&" : "?";
    const fullWsUrl = `${wsUrl}${separator}token=${encodeURIComponent(token)}`;

    // Log WebSocket connection attempt for debugging
    const isHttpsPage =
      typeof window !== "undefined" && window.location.protocol === "https:";
    const backendIsHttp = backendUrl.startsWith("http://");

    if (isHttpsPage && backendIsHttp && wsProtocol === "wss://") {
      console.warn(
        "⚠️ Attempting wss:// connection to HTTP backend. If this fails, configure HTTPS listener on ALB."
      );
    }

    console.log("🔌 Creating WebSocket connection:", {
      url: fullWsUrl.replace(/token=[^&]+/, "token=***"), // Mask token in logs
      protocol: wsProtocol,
      backendUrl: backendUrl.replace(/^https?:\/\//, ""),
      backendProtocol: backendUrl.startsWith("https://") ? "https" : "http",
      path,
      hasToken: !!token && token !== "test-token",
      pageProtocol: isHttpsPage ? "https:" : "http:",
      note:
        isHttpsPage && backendIsHttp
          ? "Using wss:// from HTTPS page (ALB must have HTTPS listener configured)"
          : undefined,
    });

    // Try to create WebSocket - catch SecurityError if browser blocks ws:// from HTTPS page
    let ws: WebSocket;
    try {
      ws = new WebSocket(fullWsUrl);
    } catch (error: any) {
      // Catch SecurityError when browser blocks ws:// from HTTPS page
      if (
        error?.message?.includes("insecure") ||
        error?.message?.includes("SecurityError") ||
        error?.name === "SecurityError"
      ) {
        const errorMsg =
          "WebSocket connection blocked: HTTPS page requires secure WebSocket (wss://). " +
          "The Application Load Balancer needs an HTTPS listener configured with an SSL certificate. " +
          "See ALB_HTTPS_SETUP.md for instructions.";
        console.error("❌ WebSocket Security Error:", errorMsg);
        throw new Error(errorMsg);
      }
      // Re-throw other errors
      throw error;
    }

    // Add connection timeout handler
    const connectionTimeout = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        console.error("⏱️ WebSocket connection timeout after 10 seconds");
        ws.close();
      }
    }, 10000); // 10 second timeout

    ws.addEventListener("open", () => {
      clearTimeout(connectionTimeout);
      console.log("✅ WebSocket connection established");
    });

    ws.addEventListener("error", (error: any) => {
      clearTimeout(connectionTimeout);

      // Check if this is a mixed content security error
      const isSecurityError =
        error?.message?.includes("insecure") ||
        error?.message?.includes("SecurityError") ||
        error?.type === "security";

      if (
        isSecurityError ||
        (isHttpsPage &&
          wsProtocol === "wss://" &&
          backendUrl.startsWith("http://"))
      ) {
        const errorMsg =
          "WebSocket connection blocked: HTTPS page requires secure WebSocket (wss://). " +
          "The Application Load Balancer needs an HTTPS listener configured with an SSL certificate. " +
          "See ALB_HTTPS_SETUP.md for instructions.";

        console.error("❌ WebSocket Security Error:", {
          error: errorMsg,
          url: fullWsUrl.replace(/token=[^&]+/, "token=***"),
          backendUrl: backendUrl,
          pageProtocol: window.location.protocol,
          solution:
            "Configure HTTPS listener on ALB with SSL certificate from AWS Certificate Manager",
        });
        // IMPORTANT: don't throw from async event handlers (it becomes an unhandled exception and
        // cannot be caught by callers). Callers should handle ws.onerror / ws.onclose.
        try {
          ws.close();
        } catch {
          // ignore
        }
        return;
      }

      console.error("❌ WebSocket connection error:", {
        error,
        url: fullWsUrl.replace(/token=[^&]+/, "token=***"),
        readyState: ws.readyState,
        // Common error causes
        troubleshooting: [
          "Check if the backend URL is correct and accessible",
          "Verify the load balancer supports WebSocket (Application Load Balancer)",
          "Check security groups allow WebSocket connections",
          "Ensure the backend server is running and WebSocket server is active",
          "Check browser console for CORS or mixed content errors",
        ],
      });
    });

    ws.addEventListener("close", (event) => {
      clearTimeout(connectionTimeout);
      if (event.code !== 1000) {
        // 1000 = normal closure
        console.error("🔌 WebSocket closed unexpectedly:", {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
          // WebSocket close codes reference
          codeMeaning:
            {
              1006: "Abnormal closure (no close frame received)",
              1008: "Policy violation (e.g., authentication failed)",
              1011: "Internal server error",
              1002: "Protocol error",
              1003: "Unsupported data type",
            }[event.code] || "Unknown error code",
        });
      }
    });

    return ws;
  }

  // =========================================================================
  // Tracked Insights (Watchlist)
  // =========================================================================

  async trackInsight(data: {
    headline: string;
    understory?: string;
    /** Omitted for `dashboard_insights`; server derives from source row (plan §0). */
    metric_signature?: any;
    source_insight_id?: number;
    /** Research Lab durable artifact UUID (COHI-362). */
    research_artifact_id?: string;
    source_type?: string;
    tags?: string[];
    display_metadata?: Record<string, any>;
  }, tenantId?: string | null) {
    const tenantParam = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
    return this.request(`/api/insights/tracked${tenantParam}`, { method: "POST", body: JSON.stringify(data) });
  }

  /** Persist Research Lab SQL evidence for watchlist / Workbench (COHI-362). */
  async createResearchArtifact(
    data: {
      session_id: string;
      sql: string;
      keyFields: string[];
      title?: string;
      explanation?: string;
      headline_fingerprint?: string;
      viz_config?: Record<string, unknown>;
    },
    tenantId?: string | null
  ) {
    const tenantParam = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
    return this.request<{ id: string }>(`/api/research/artifacts${tenantParam}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getTrackedInsights(tenantId?: string | null) {
    const tenantParam = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
    return this.request(`/api/insights/tracked${tenantParam}`);
  }

  /** Platform staff only — runs evaluateTrackedInsights for the current tenant. */
  async runTrackedReevaluation(tenantId?: string | null) {
    const tenantParam = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
    return this.request<{ evaluated: number; errors: number }>(
      `/api/insights/tracked/reevaluate${tenantParam}`,
      { method: "POST" }
    );
  }

  async getTrackedInsightHistory(id: string, limit = 50, tenantId?: string | null) {
    const tenantParam = tenantId ? `&tenant_id=${encodeURIComponent(tenantId)}` : "";
    return this.request(`/api/insights/tracked/${id}/history?limit=${limit}${tenantParam}`);
  }

  async updateTrackedInsight(
    id: string,
    data: {
      /** `resolved` = paused (no auto-eval); `archived` = reference only */
      status?: "active" | "resolved" | "archived";
      alert_threshold?: any;
      tags?: string[];
    },
    tenantId?: string | null
  ) {
    const tenantParam = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
    return this.request(`/api/insights/tracked/${id}${tenantParam}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteTrackedInsight(id: string, tenantId?: string | null) {
    const tenantParam = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
    return this.request(`/api/insights/tracked/${id}${tenantParam}`, { method: "DELETE" });
  }

  // =========================================================================
  // Dashboard Insights (per-page insight cards)
  // =========================================================================

  async submitDashboardInsightFeedback(
    dashboardInsightId: number,
    rating: -1 | 1,
    tags?: string[],
    comment?: string,
    tenantId?: string | null
  ) {
    const tenantParam = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
    return this.request(`/api/dashboard-insights/${dashboardInsightId}/feedback${tenantParam}`, {
      method: "POST",
      body: JSON.stringify({
        rating,
        tags: tags || [],
        comment: comment || "",
      }),
    });
  }

  async getDashboardInsightFeedback(dashboardInsightId: number, tenantId?: string | null) {
    const tenantParam = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
    return this.request(`/api/dashboard-insights/${dashboardInsightId}/feedback${tenantParam}`);
  }

  async deleteDashboardInsight(dashboardInsightId: number, tenantId?: string | null) {
    const tenantParam = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
    return this.request(`/api/dashboard-insights/${dashboardInsightId}${tenantParam}`, { method: "DELETE" });
  }

  async createWorkbenchCanvasFromDashboardInsight(dashboardInsightId: number, tenantId?: string | null) {
    const sp = new URLSearchParams();
    if (tenantId) sp.set("tenant_id", tenantId);
    // Prevent any intermediary/proxy from reusing a stale POST response.
    sp.set("_ts", String(Date.now()));
    const qs = `?${sp.toString()}`;
    // Do not add Cache-Control/Pragma here: they trigger a CORS preflight that lists those
    // headers and must match the server's Access-Control-Allow-Headers (often they don't).
    // Unique _ts query is enough to avoid stale URL identity for proxies.
    const canvas = await this.request<{ id: string }>(`/api/workbench/canvases/from-dashboard-insight${qs}`, {
      method: "POST",
      body: JSON.stringify({ dashboardInsightId }),
    });
    this.invalidateCacheFor("/api/workbench/canvases");
    return canvas;
  }

  async transferWorkbenchCanvasOwnership(
    canvasId: string,
    newOwnerUserId: string,
    tenantId?: string | null,
  ) {
    const sp = new URLSearchParams();
    if (tenantId) sp.set("tenant_id", tenantId);
    const qs = sp.toString() ? `?${sp.toString()}` : "";
    const result = await this.request<{ success: boolean; user_id: string }>(
      `/api/workbench/canvases/${canvasId}/transfer-ownership${qs}`,
      {
        method: "POST",
        body: JSON.stringify({ new_owner_user_id: newOwnerUserId }),
      },
    );
    this.invalidateCacheFor("/api/workbench/canvases");
    return result;
  }

  async insightChat(
    insightContext: any,
    messages: Array<{ role: string; content: string }>,
    tenantId?: string | null
  ) {
    const tenantParam = tenantId ? `?tenant_id=${tenantId}` : "";
    return this.request<{ response: string }>(
      `/api/dashboard/insights/chat${tenantParam}`,
      {
        method: "POST",
        body: JSON.stringify({ insightContext, messages }),
      }
    );
  }

  async triggerAgentInsights(tenantId?: string | null, options?: { forceFresh?: boolean }) {
    const params = new URLSearchParams();
    if (tenantId) params.set("tenant_id", tenantId);
    if (options?.forceFresh) params.set("fresh", "true");
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request(`/api/dashboard/insights/generate-agent${qs}`, {
      method: "POST",
    });
  }

  private _myInsightsTq(tenantId?: string | null): string {
    return tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
  }

  async listMyInsightPrompts(tenantId?: string | null) {
    return this.request<{ prompts: Record<string, unknown>[] }>(
      `/api/dashboard/insights/my/prompts${this._myInsightsTq(tenantId)}`
    );
  }

  async createMyInsightPrompt(
    body: {
      title: string;
      prompt_text: string;
      specifiers?: Record<string, unknown>;
      schedule?: "batch" | "on_demand";
      enabled?: boolean;
    },
    tenantId?: string | null
  ) {
    return this.request<Record<string, unknown>>(`/api/dashboard/insights/my/prompts${this._myInsightsTq(tenantId)}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async updateMyInsightPrompt(
    id: string,
    body: Partial<{
      title: string;
      prompt_text: string;
      specifiers: Record<string, unknown>;
      schedule: "batch" | "on_demand";
      enabled: boolean;
    }>,
    tenantId?: string | null
  ) {
    return this.request<Record<string, unknown>>(
      `/api/dashboard/insights/my/prompts/${encodeURIComponent(id)}${this._myInsightsTq(tenantId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      }
    );
  }

  async deleteMyInsightPrompt(id: string, tenantId?: string | null) {
    return this.request<void>(
      `/api/dashboard/insights/my/prompts/${encodeURIComponent(id)}${this._myInsightsTq(tenantId)}`,
      { method: "DELETE" }
    );
  }

  async runMyInsightPrompt(id: string, tenantId?: string | null) {
    return this.request<{ jobId: string; status: string }>(
      `/api/dashboard/insights/my/prompts/${encodeURIComponent(id)}/run${this._myInsightsTq(tenantId)}`,
      { method: "POST" }
    );
  }

  // Report distributions
  private _distTq(tenantId?: string | null): string {
    return tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
  }
  private _distTqAmp(tenantId?: string | null): string {
    return tenantId ? `&tenant_id=${encodeURIComponent(tenantId)}` : "";
  }

  async getDistributionSchedules(params?: { limit?: number; offset?: number; is_active?: string; tenantId?: string | null }) {
    const sp = new URLSearchParams();
    if (params?.limit != null) sp.set("limit", String(params.limit));
    if (params?.offset != null) sp.set("offset", String(params.offset));
    if (params?.is_active != null) sp.set("is_active", params.is_active);
    if (params?.tenantId) sp.set("tenant_id", params.tenantId);
    const qs = sp.toString() ? `?${sp.toString()}` : "";
    return this.request<{ schedules: any[]; total: number; limit: number; offset: number }>(
      `/api/distributions${qs}`
    );
  }

  async getDistributionSchedule(id: string, tenantId?: string | null) {
    return this.request<any>(`/api/distributions/${id}${this._distTq(tenantId)}`);
  }

  async createDistributionSchedule(data: Record<string, unknown>, tenantId?: string | null) {
    return this.request<any>(`/api/distributions${this._distTq(tenantId)}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateDistributionSchedule(id: string, data: Record<string, unknown>, tenantId?: string | null) {
    return this.request<any>(`/api/distributions/${id}${this._distTq(tenantId)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteDistributionSchedule(id: string, tenantId?: string | null) {
    return this.request<void>(`/api/distributions/${id}${this._distTq(tenantId)}`, { method: "DELETE" });
  }

  async getDistributionHistory(id: string, limit = 20, tenantId?: string | null) {
    return this.request<{ history: any[] }>(`/api/distributions/${id}/history?limit=${limit}${this._distTqAmp(tenantId)}`);
  }

  async sendDistributionNow(id: string, tenantId?: string | null) {
    return this.request<any>(`/api/distributions/${id}/send-now${this._distTq(tenantId)}`, { method: "POST" });
  }

  /** Preview next N run timestamps (server-side; same logic as scheduler). */
  async previewDistributionSchedule(
    body: Record<string, unknown>,
    tenantId?: string | null,
  ) {
    return this.request<{ runs: string[] }>(
      `/api/distributions/preview-schedule${this._distTq(tenantId)}`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
  }

  async getDistributionRecipientLists(tenantId?: string | null) {
    return this.request<{ lists: any[] }>(`/api/distributions/recipient-lists${this._distTq(tenantId)}`);
  }

  async createDistributionRecipientList(data: Record<string, unknown>, tenantId?: string | null) {
    return this.request<any>(`/api/distributions/recipient-lists${this._distTq(tenantId)}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateDistributionRecipientList(id: string, data: Record<string, unknown>, tenantId?: string | null) {
    return this.request<any>(`/api/distributions/recipient-lists/${id}${this._distTq(tenantId)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteDistributionRecipientList(id: string, tenantId?: string | null) {
    return this.request<void>(`/api/distributions/recipient-lists/${id}${this._distTq(tenantId)}`, { method: "DELETE" });
  }

  // Fallout alert distribution
  private _falloutTq(tenantId?: string | null): string {
    return tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
  }

  async getFalloutAlertConfig(tenantId?: string | null) {
    return this.request<{ config: Record<string, unknown> }>(`/api/fallout-alerts/config${this._falloutTq(tenantId)}`);
  }

  async updateFalloutAlertConfig(
    data: {
      enabled?: boolean;
      min_risk_score?: number;
      frequency?: "realtime" | "daily_digest" | "weekly_digest";
      include_risk_levels?: string[];
      custom_message?: string | null;
      notify_managers?: boolean;
      target_encompass_user_ids?: string[];
      manager_user_ids?: string[];
    },
    tenantId?: string | null,
  ) {
    return this.request<{ config: Record<string, unknown> }>(`/api/fallout-alerts/config${this._falloutTq(tenantId)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async sendFalloutAlertsNow(
    tenantId?: string | null,
    payload?: {
      test_recipient_emails?: string[];
      send_manager_cards?: boolean;
      manager_card_branch_filters?: string[];
      manager_card_scope_to_target_los?: boolean;
    },
  ) {
    return this.request<{
      message: string;
      alertBatchId: string;
      recipientsCount: number;
      sentCount: number;
      failedRecipients: Array<{ email: string; error: string }>;
      skippedLoansCount: number;
      highRiskLoanCount: number;
      testRecipients: {
        attempted: number;
        sent: number;
        failed: Array<{ email: string; error: string }>;
      };
      managerNotifications: {
        attempted: number;
        sent: number;
        failed: Array<{ email: string; error: string }>;
      };
      managerCardNotifications: {
        attempted: number;
        sent: number;
        failed: Array<{ email: string; error: string }>;
        loanCount: number;
      };
    }>(`/api/fallout-alerts/send-now${this._falloutTq(tenantId)}`, {
      method: "POST",
      body: JSON.stringify(payload || {}),
    });
  }

  async getFalloutAlertResponses(limit = 50, tenantId?: string | null) {
    const tenantParam = tenantId ? `&tenant_id=${encodeURIComponent(tenantId)}` : "";
    return this.request<{ responses: any[] }>(
      `/api/fallout-alerts/responses?limit=${Math.max(1, Math.min(200, limit))}${tenantParam}`,
    );
  }

  async getFalloutAlertRecipientOptions(tenantId?: string | null) {
    return this.request<{
      loanOfficers: Array<{
        encompass_user_id: string;
        display_name: string;
        email: string;
        active_loan_count: number;
      }>;
      managers: Array<{ id: string; display_name: string; email: string; role: string }>;
      branches: string[];
    }>(`/api/fallout-alerts/recipient-options${this._falloutTq(tenantId)}`);
  }

  async getLoanFalloutStatuses(loanIds: string[], tenantId?: string | null) {
    if (!loanIds.length) return { statuses: [] };
    return this.request<{
      statuses: Array<{
        loan_id: string;
        recipient_email: string | null;
        encompass_user_id: string | null;
        sent_at: string;
        alert_batch_id: string;
        response: "acknowledged" | "working_on_it" | "need_help" | null;
        responded_at: string | null;
        loan_officer_name: string | null;
      }>;
    }>(`/api/fallout-alerts/loan-statuses${tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : ""}`, {
      method: "POST",
      body: JSON.stringify({ loan_ids: loanIds }),
    });
  }

  async resolveLoanLo(loanId: string, tenantId?: string | null) {
    return this.request<{
      found: boolean;
      loEmail: string | null;
      loName: string | null;
      redirectActive: boolean;
      redirectTo: string | null;
    }>(`/api/fallout-alerts/resolve-lo${this._falloutTq(tenantId)}`, {
      method: "POST",
      body: JSON.stringify({ loan_id: loanId }),
    });
  }

  async sendFalloutAlertSingle(loanId: string, tenantId?: string | null, additionalEmails?: string[], customMessage?: string) {
    return this.request<{
      sent: boolean;
      recipientEmail: string | null;
      message: string;
      devMode: boolean;
      devRedirectedTo?: string[];
      additionalSent?: number;
    }>(`/api/fallout-alerts/send-single${this._falloutTq(tenantId)}`, {
      method: "POST",
      body: JSON.stringify({ loan_id: loanId, additional_emails: additionalEmails, custom_message: customMessage }),
    });
  }

  async getFeedbackNotificationUsers() {
    return this.request<{
      users: Array<{ id: string; user_name: string; email: string }>;
    }>("/api/admin/platform-settings/feedback-notification-users");
  }

  async getFeedbackNotificationRecipients() {
    return this.request<{
      recipients: Array<{ id: string; user_name: string; email: string; created_by: string }>;
    }>("/api/admin/platform-settings/feedback-notification-recipients", {
      headers: {
        "Cache-Control": "no-cache",
      },
    });
  }

  async createFeedbackNotificationRecipient(payload: {
    source: "existing_user" | "new_user";
    user_id?: string;
    user_name?: string;
    email?: string;
  }) {
    const res = await this.request<{
      recipient: { id: string; user_name: string; email: string; created_by: string };
    }>("/api/admin/platform-settings/feedback-notification-recipients", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    this.invalidateCacheFor("/api/admin/platform-settings/feedback-notification-recipients");
    return res;
  }

  async deleteFeedbackNotificationRecipient(id: string) {
    const res = await this.request<{ ok: boolean }>(`/api/admin/platform-settings/feedback-notification-recipients/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    this.invalidateCacheFor("/api/admin/platform-settings/feedback-notification-recipients");
    return res;
  }

  // Feedback
  private _feedbackTq(tenantId?: string | null): string {
    return tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
  }

  async createFeedback(
    payload: {
      area:
        | "insights"
        | "dashboards"
        | "workbench"
        | "research_lab"
        | "communication_center"
        | "general_feedback";
      type: "feature_request" | "bug_issue" | "question";
      description: string;
      files?: File[];
    },
    tenantId?: string | null,
  ) {
    const hasFiles = Array.isArray(payload.files) && payload.files.length > 0;
    const body = hasFiles
      ? (() => {
          const formData = new FormData();
          formData.append("area", payload.area);
          formData.append("type", payload.type);
          formData.append("description", payload.description);
          for (const file of payload.files || []) {
            formData.append("files", file);
          }
          return formData;
        })()
      : JSON.stringify({ area: payload.area, type: payload.type, description: payload.description });
    const res = await this.request<{
      feedback: any;
      notificationSent: boolean;
      notificationFailures: Array<{ email: string; error: string }>;
    }>(`/api/feedback${this._feedbackTq(tenantId)}`, {
      method: "POST",
      body,
    });
    this.invalidateCacheFor("/api/feedback");
    return res;
  }

  async getFeedbackList(
    params?: {
      sortBy?: "created_at" | "status" | "area";
      sortDir?: "asc" | "desc";
      status?: "open" | "in_progress" | "resolved";
      area?:
        | "insights"
        | "dashboards"
        | "workbench"
        | "research_lab"
        | "communication_center"
        | "general_feedback";
      page?: number;
      limit?: number;
      tenantId?: string | null;
    },
  ) {
    const sp = new URLSearchParams();
    if (params?.sortBy) sp.set("sortBy", params.sortBy);
    if (params?.sortDir) sp.set("sortDir", params.sortDir);
    if (params?.status) sp.set("status", params.status);
    if (params?.area) sp.set("area", params.area);
    if (params?.page) sp.set("page", String(params.page));
    if (params?.limit) sp.set("limit", String(params.limit));
    if (params?.tenantId) sp.set("tenant_id", params.tenantId);
    const qs = sp.toString() ? `?${sp.toString()}` : "";
    return this.request<{ feedback: any[]; page: number; limit: number; total: number }>(`/api/feedback${qs}`);
  }

  async getFeedbackById(id: string, tenantId?: string | null) {
    return this.request<{ feedback: any }>(`/api/feedback/${encodeURIComponent(id)}${this._feedbackTq(tenantId)}`);
  }

  async updateFeedback(
    id: string,
    payload: { status?: "open" | "in_progress" | "resolved"; admin_notes?: string },
    tenantId?: string | null,
  ) {
    const res = await this.request<{ feedback: any }>(`/api/feedback/${encodeURIComponent(id)}${this._feedbackTq(tenantId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    this.invalidateCacheFor("/api/feedback");
    return res;
  }

  getFeedbackAttachmentDownloadUrl(feedbackId: string, attachmentId: string, tenantId?: string | null): string {
    return `/api/feedback/${encodeURIComponent(feedbackId)}/attachments/${encodeURIComponent(attachmentId)}/download${this._feedbackTq(tenantId)}`;
  }

  async downloadFeedbackAttachment(feedbackId: string, attachmentId: string, tenantId?: string | null): Promise<Blob> {
    const endpoint = this.getFeedbackAttachmentDownloadUrl(feedbackId, attachmentId, tenantId);
    const response = await this.fetchWithAuth(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/octet-stream",
      },
    });
    if (!response.ok) {
      let message = "Failed to download attachment";
      try {
        const raw = await response.text();
        if (raw?.trim()) {
          const parsed = JSON.parse(raw) as { error?: string };
          message = parsed.error || message;
        }
      } catch {
        // Keep fallback message
      }
      throw new Error(message);
    }
    return response.blob();
  }
}

export const api = new ApiClient();
