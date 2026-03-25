/**
 * Encompass API Service
 * Enhanced API client with PostgreSQL token caching and concurrency limit handling
 * Based on reference implementation: EncompassApiServiceFiles/encompass-api-service.ts
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import pg from "pg";
import {
  getEncompassCredentials,
  EncompassClientDetails,
} from "./encompassCredentialsService.js";

export interface EncompassField {
  fieldID: string;
  description: string;
  fieldType: number;
  format?: string;
  jsonPath?: string;
  contractPath?: string;
  dataType?: string;
  readOnly?: boolean;
  nullable?: boolean;
  category?: string;
  maxLength?: number;
  multiInstance?: boolean;
}

export interface EncompassCustomFieldFromApi {
  Id: string;
  Audit?: { Data?: string };
  Description?: string;
  Format?: string;
  jsonPath?: string;
  contractPath?: string;
  maxLength?: number;
  isCalculatedField?: boolean;
}

interface EncompassTokenResponse {
  token_type: string;
  access_token: string;
  expires_in?: number;
}

export interface EncompassLoanFolder {
  folderName: string;
}

export interface EncompassApiResponse<T> {
  data: T;
  concurrency?: ConcurrencyMetrics;
}

export interface ConcurrencyMetrics {
  limit: number;
  remaining: number;
  utilized: number;
  utilization_ratio: number;
  threshold: number;
  exceeded_threshold: boolean;
  lender_id?: string;
}

export interface EncompassLoan {
  [key: string]: any; // Dynamic structure based on requested fields
}

export interface LoanSchemaField {
  fieldId: string;
  jsonPath: string;
  description: string;
  type: string;
}

/** Single field value from V3 Field Reader API */
export interface FieldReaderValue {
  fieldId: string;
  value: string;
}

// Encompass User types from v1 API
// Note: The 'id' field IS the username/login ID in Encompass v1 API
export interface EncompassUserFromApi {
  id: string; // This is the login username (e.g., "jsmith")
  userId?: string;
  userName?: string;
  enabled?: boolean;
  firstName?: string;
  lastName?: string;
  middleName?: string;
  suffix?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  cellPhone?: string;
  fax?: string;
  jobTitle?: string;
  personalStatusOnline?: boolean;
  workingFolder?: string;
  userIndicators?: string[];
  organization?: {
    entityId?: string;
    entityType?: string;
    entityName?: string;
    entityUri?: string;
  };
  nmlsOriginatorID?: string;
  lastLogin?: string;
  encompassVersion?: string;
  subordinateLoanAccess?: string;
  peerLoanAccess?: string;
  personas?: Array<{
    entityId?: string;
    entityType?: string;
    entityName?: string;
  }>;
  licenses?: Array<{
    id?: string;
    state?: string;
  }>;
}

export interface EncompassUser {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  cellPhone?: string;
  jobTitle?: string;
  isEnabled: boolean;
  userIndicators: string[];
  personas: string[];
  nmlsId?: string;
  orgId?: string;
  orgName?: string;
  lastLogin?: string;
}

/**
 * Map API user response to standard EncompassUser format
 * Note: In Encompass v1 API, the 'id' field IS the username/login ID
 */
function mapEncompassUser(user: EncompassUserFromApi): EncompassUser {
  const resolvedId = user.id || user.userId || user.userName || "";
  const personaNames =
    user.personas?.map((p) => p.entityName).filter(Boolean) as string[] || [];
  const enabledFromIndicators = user.userIndicators?.includes("Enabled");
  const resolvedEnabled =
    typeof user.enabled === "boolean"
      ? user.enabled
      : enabledFromIndicators ?? true;

  return {
    id: resolvedId,
    username: user.userName || resolvedId,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName:
      user.fullName ||
      (user.firstName && user.lastName
        ? `${user.firstName} ${user.lastName}`.trim()
        : user.firstName || user.lastName || resolvedId),
    email: user.email,
    phone: user.phone,
    cellPhone: user.cellPhone,
    jobTitle: user.jobTitle,
    isEnabled: resolvedEnabled,
    userIndicators: user.userIndicators || [],
    personas: personaNames,
    nmlsId: user.nmlsOriginatorID,
    orgId: user.organization?.entityId,
    orgName: user.organization?.entityName,
    lastLogin: user.lastLogin,
  };
}

export class EncompassApiService {
  private static tokenRefreshLocks = new Map<string, Promise<string>>();
  private static concurrencyPermits = new Map<string, number>();
  private static concurrencyInFlight = new Map<string, number>();
  private static concurrencyWaitQueues = new Map<
    string,
    Array<() => void>
  >();
  private static lastThrottleLogAt = 0;

  private apiClient: AxiosInstance;
  private encompassApiBaseUrl: string;
  private tenantPool?: pg.Pool;
  private MAX_CONCURRENCY_RATIO = 0.2; // 20% — ICE ISV partner hard limit per docs
  private CONCURRENCY_POLL_INTERVAL = 2000; // 2 seconds — exponential backoff base

  constructor(tenantPool?: pg.Pool, apiServer?: string) {
    // Use provided API server or default to production
    const baseApiServer =
      apiServer ||
      process.env.ENCOMPASS_API_BASE_URL?.replace("/encompass", "") ||
      "https://api.elliemae.com";
    this.encompassApiBaseUrl = `${baseApiServer}/encompass`;

    this.apiClient = axios.create({
      baseURL: this.encompassApiBaseUrl,
    });

    this.tenantPool = tenantPool;

    
  }

  private transformInstanceIdForUsername(instanceId: string): string {
    let s = instanceId.substring(1).replace(/^0+/, "");
    if (s.length < 6) {
      s = s.padStart(6, "0");
    }
    return `BE${s}`;
  }

  private getCacheKey(clientDetails: EncompassClientDetails): string {
    return `${clientDetails.InstanceId}::${clientDetails.ApiClientId || ""}::${
      clientDetails.SAUsername || ""
    }`;
  }

  private getLimiterKey(tenantId: string, losConnectionId: string): string {
    return `${tenantId}:${losConnectionId}`;
  }

  private async acquireConcurrencyPermit(
    tenantId: string,
    losConnectionId: string,
  ): Promise<void> {
    const key = this.getLimiterKey(tenantId, losConnectionId);
    const permits = EncompassApiService.concurrencyPermits.get(key) ?? 1;
    const inFlight = EncompassApiService.concurrencyInFlight.get(key) ?? 0;
    if (inFlight < permits) {
      EncompassApiService.concurrencyInFlight.set(key, inFlight + 1);
      return;
    }

    await new Promise<void>((resolve) => {
      const queue = EncompassApiService.concurrencyWaitQueues.get(key) || [];
      queue.push(resolve);
      EncompassApiService.concurrencyWaitQueues.set(key, queue);
    });
    const current = EncompassApiService.concurrencyInFlight.get(key) ?? 0;
    EncompassApiService.concurrencyInFlight.set(key, current + 1);
  }

  private releaseConcurrencyPermit(tenantId: string, losConnectionId: string): void {
    const key = this.getLimiterKey(tenantId, losConnectionId);
    const inFlight = EncompassApiService.concurrencyInFlight.get(key) ?? 0;
    if (inFlight > 0) {
      EncompassApiService.concurrencyInFlight.set(key, inFlight - 1);
    }
    const queue = EncompassApiService.concurrencyWaitQueues.get(key) || [];
    const next = queue.shift();
    EncompassApiService.concurrencyWaitQueues.set(key, queue);
    if (next) next();
  }

  private updateConcurrencyPermits(
    tenantId: string,
    losConnectionId: string,
    limit: number,
  ): void {
    const key = this.getLimiterKey(tenantId, losConnectionId);
    const capped = Math.max(1, Math.floor(limit * this.MAX_CONCURRENCY_RATIO));
    EncompassApiService.concurrencyPermits.set(key, capped);
  }

  /**
   * Get cached token from PostgreSQL (tenant-specific database)
   */
  private async getCachedToken(
    clientDetails: EncompassClientDetails,
  ): Promise<string | null> {
    if (!this.tenantPool) {
      return null; // No tenant pool available
    }

    const cacheKey = this.getCacheKey(clientDetails);
    try {
      const result = await this.tenantPool.query(
        `SELECT token, expires_at, updated_at
         FROM public.encompass_token_cache 
         WHERE cache_key = $1`,
        [cacheKey],
      );

      if (result.rows.length > 0) {
        const cachedToken = result.rows[0];
        const now = Date.now();
        const lastUsedAt = cachedToken.updated_at
          ? new Date(cachedToken.updated_at).getTime()
          : 0;
        const withinKeepAliveWindow =
          now - lastUsedAt <= 15 * 60 * 1000; // ICE keepalive cadence
        if (cachedToken.expires_at > now && withinKeepAliveWindow) {
          return cachedToken.token;
        } else {
          console.log(
            `[EncompassApiService] Cached token expired or stale for ${cacheKey}`,
          );
          await this.invalidateToken(clientDetails);
        }
      }
    } catch (error: any) {
      console.error(
        "[EncompassApiService] Error retrieving cached token:",
        error.message,
      );
    }
    return null;
  }

  /**
   * Cache token in PostgreSQL (tenant-specific database)
   */
  private async cacheToken(
    clientDetails: EncompassClientDetails,
    token: string,
    expiresInSeconds: number,
  ): Promise<void> {
    if (!this.tenantPool) {
      return; // No tenant pool available
    }

    const cacheKey = this.getCacheKey(clientDetails);
    const now = Date.now();
    const expiresAt = now + expiresInSeconds * 1000 - 60000; // 60s safety buffer

    try {
      await this.tenantPool.query(
        `INSERT INTO public.encompass_token_cache (cache_key, token, expires_at, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (cache_key) 
         DO UPDATE SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at, updated_at = NOW()`,
        [cacheKey, token, expiresAt],
      );
      
    } catch (error: any) {
      console.error(
        "[EncompassApiService] Error caching token:",
        error.message,
      );
    }
  }

  private async touchTokenUsage(
    clientDetails: EncompassClientDetails,
  ): Promise<void> {
    if (!this.tenantPool) return;
    const cacheKey = this.getCacheKey(clientDetails);
    try {
      await this.tenantPool.query(
        `UPDATE public.encompass_token_cache
         SET updated_at = NOW()
         WHERE cache_key = $1`,
        [cacheKey],
      );
    } catch (error: any) {
      console.warn(
        "[EncompassApiService] Error touching token usage:",
        error.message,
      );
    }
  }

  /**
   * Invalidate token in PostgreSQL cache (tenant-specific database)
   */
  private async invalidateToken(
    clientDetails: EncompassClientDetails,
  ): Promise<void> {
    if (!this.tenantPool) {
      return; // No tenant pool available
    }

    const cacheKey = this.getCacheKey(clientDetails);
    try {
      await this.tenantPool.query(
        `DELETE FROM public.encompass_token_cache WHERE cache_key = $1`,
        [cacheKey],
      );
      
    } catch (error: any) {
      console.error(
        "[EncompassApiService] Error invalidating token:",
        error.message,
      );
    }
  }

  /**
   * Log concurrency metrics to PostgreSQL (tenant-specific database)
   */
  private async logConcurrencyMetrics(
    metrics: ConcurrencyMetrics,
    losConnectionId?: string,
  ): Promise<void> {
    if (!this.tenantPool) {
      return; // No tenant pool available
    }

    try {
      await this.tenantPool.query(
        `INSERT INTO public.encompass_concurrency_metrics 
         (los_connection_id, limit_value, remaining, utilized, utilization_ratio, exceeded_threshold, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          losConnectionId || null,
          metrics.limit,
          metrics.remaining,
          metrics.utilized,
          metrics.utilization_ratio,
          metrics.exceeded_threshold,
        ],
      );
    } catch (error: any) {
      console.error(
        "[EncompassApiService] Failed to log concurrency metrics:",
        error.message,
      );
    }
  }

  /**
   * Check concurrency headers and throttle if needed
   */
  private async checkConcurrencyAndThrottle(
    response: AxiosResponse,
    tenantId?: string,
    losConnectionId?: string,
  ): Promise<ConcurrencyMetrics | null> {
    const limitStr = response.headers["x-concurrency-limit-limit"];
    const remainingStr = response.headers["x-concurrency-limit-remaining"];

    if (!limitStr || !remainingStr) {
      return null;
    }

    let limit: number;
    let remaining: number;

    try {
      limit = parseInt(limitStr, 10);
      remaining = parseInt(remainingStr, 10);
    } catch (error) {
      console.warn(
        `[EncompassApiService] Invalid concurrency headers: Limit=${limitStr}, Remaining=${remainingStr}`,
      );
      return null;
    }

    if (limit <= 0) {
      return null;
    }

    const utilized = limit - remaining;
    const utilizationRatio = utilized / limit;

    const metrics: ConcurrencyMetrics = {
      limit,
      remaining,
      utilized,
      utilization_ratio: Math.round(utilizationRatio * 10000) / 10000,
      threshold: this.MAX_CONCURRENCY_RATIO,
      exceeded_threshold: utilizationRatio > this.MAX_CONCURRENCY_RATIO,
      lender_id: losConnectionId,
    };

    // Log metrics to PostgreSQL
    await this.logConcurrencyMetrics(metrics, losConnectionId);
    if (tenantId && losConnectionId) {
      this.updateConcurrencyPermits(tenantId, losConnectionId, limit);
    }

    if (metrics.exceeded_threshold) {
      const waitTime = this.CONCURRENCY_POLL_INTERVAL;
      const now = Date.now();
      if (now - EncompassApiService.lastThrottleLogAt > 10_000) {
        EncompassApiService.lastThrottleLogAt = now;
        console.warn(
          `[EncompassApiService] Concurrency ${utilized}/${limit} (${(
            utilizationRatio * 100
          ).toFixed(0)}%) exceeds ${(
            this.MAX_CONCURRENCY_RATIO * 100
          ).toFixed(0)}% threshold — throttling ${waitTime}ms`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    return metrics;
  }

  /**
   * Get Encompass access token (with caching)
   */
  private async getEncompassAccessToken(
    tenantId: string,
    losConnectionId: string,
    forceRefresh: boolean = false,
  ): Promise<string> {
    const clientDetails = await getEncompassCredentials(
      tenantId,
      losConnectionId,
    );
    const cacheKey = this.getCacheKey(clientDetails);

    // Check cache first unless force refresh
    if (!forceRefresh) {
      const cachedToken = await this.getCachedToken(clientDetails);
      if (cachedToken) {
        return cachedToken;
      }
    }

    const existingRefresh = EncompassApiService.tokenRefreshLocks.get(cacheKey);
    if (existingRefresh && !forceRefresh) {
      return existingRefresh;
    }

    const refreshPromise = this.fetchAndCacheEncompassAccessToken(clientDetails);
    EncompassApiService.tokenRefreshLocks.set(cacheKey, refreshPromise);
    try {
      return await refreshPromise;
    } finally {
      EncompassApiService.tokenRefreshLocks.delete(cacheKey);
    }
  }

  private async fetchAndCacheEncompassAccessToken(
    clientDetails: EncompassClientDetails,
  ): Promise<string> {
    const {
      InstanceId,
      ApiClientId,
      ClientSecret,
      SAUsername,
      SAPassword,
      ExtractionMethod,
      ApiServer,
    } = clientDetails;

    const extractionMethodLower = ExtractionMethod?.toLowerCase();
    // Use API server from connection, default to production
    const apiServerBase = ApiServer || "https://api.elliemae.com";
    const tokenUrl = `${apiServerBase}/oauth2/v1/token`;

    
    let instanceIdForToken = InstanceId;
    if (InstanceId && InstanceId.startsWith("30")) {
      instanceIdForToken = InstanceId.replace("30", "BE");
    }

    if (extractionMethodLower === "partner") {
      if (!ApiClientId || !ClientSecret)
        throw new Error("Partner flow requires ApiClientId and ClientSecret.");
      const requestBody = `grant_type=client_credentials&instance_id=${instanceIdForToken}&scope=lp`;
      const basicAuth = Buffer.from(`${ApiClientId}:${ClientSecret}`).toString(
        "base64",
      );
      const requestHeaders = {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      };
      console.log("[EncompassApiService] Fetching new Partner Flow token");
      try {
        const response = await axios.post<EncompassTokenResponse>(
          tokenUrl,
          requestBody,
          { headers: requestHeaders },
        );
        if (response.data && response.data.access_token) {
          const token = `${response.data.token_type} ${response.data.access_token}`;
          const expiresIn = response.data.expires_in || 3600;
          await this.cacheToken(clientDetails, token, expiresIn);
          return token;
        }
        throw new Error("Partner token: No access_token in response");
      } catch (error: any) {
        console.error(
          "[EncompassApiService] Error getting Encompass partner token:",
          error.response?.data || error.message,
        );
        throw new Error(
          `Encompass partner token API error: ${error.response?.status} ${
            error.response?.data?.error_description || error.message
          }`,
        );
      }
    } else if (
      extractionMethodLower === "ropc" ||
      extractionMethodLower === "api"
    ) {
      if (!ApiClientId || !SAUsername || !SAPassword) {
        console.error("[EncompassApiService] Missing ROPC/API credentials:", {
          hasApiClientId: !!ApiClientId,
          hasSAUsername: !!SAUsername,
          hasSAPassword: !!SAPassword,
          instanceId: InstanceId,
          extractionMethod: extractionMethodLower,
        });
        throw new Error(
          "ROPC/API flow requires ApiClientId, SAUsername, and SAPassword.",
        );
      }
      let effectiveSAUsername = SAUsername;
      if (InstanceId && !InstanceId.startsWith("TE")) {
        const transformedInstanceIdPart =
          this.transformInstanceIdForUsername(InstanceId);
        effectiveSAUsername = `${SAUsername}@encompass:${transformedInstanceIdPart}`;
      } else if (InstanceId && InstanceId.startsWith("TE")) {
        effectiveSAUsername = `${SAUsername}@encompass:${InstanceId}`;
      }

      

      const params = new URLSearchParams();
      params.append("grant_type", "password");
      params.append("username", effectiveSAUsername);
      params.append("password", SAPassword);
      params.append("client_id", ApiClientId);
      if (ClientSecret) params.append("client_secret", ClientSecret);

      const requestHeaders = {
        "Content-Type": "application/x-www-form-urlencoded",
      };
      

      try {
        const response = await axios.post<EncompassTokenResponse>(
          tokenUrl,
          params.toString(),
          { headers: requestHeaders },
        );
        if (response.data && response.data.access_token) {
          const token = `${response.data.token_type} ${response.data.access_token}`;
          const expiresIn = response.data.expires_in || 3600;
          await this.cacheToken(clientDetails, token, expiresIn);
          return token;
        }
        throw new Error("ROPC/API token: No access_token in response");
      } catch (error: any) {
        console.error(
          "[EncompassApiService] Error getting Encompass ROPC/API token:",
          error.response?.data || error.message,
        );
        throw new Error(
          `Encompass ROPC/API token API error: ${error.response?.status} ${
            error.response?.data?.error_description || error.message
          }`,
        );
      }
    }
    throw new Error(
      `Unsupported Encompass auth method or missing credentials. Method: '${extractionMethodLower}'.`,
    );
  }

  /**
   * Get an impersonation token to act as a specific user
   * This allows querying the API with that user's permissions
   * Requires the service account to have admin privileges
   * 
   * @param tenantId - Tenant ID
   * @param losConnectionId - LOS connection ID
   * @param subjectUserId - Encompass user ID to impersonate (e.g., "jmillerlo")
   * @returns Impersonation access token
   */
  public async getImpersonationToken(
    tenantId: string,
    losConnectionId: string,
    subjectUserId: string,
  ): Promise<string> {
    // First, get the actor (admin/service account) token
    const actorToken = await this.getEncompassAccessToken(tenantId, losConnectionId);
    
    // Extract just the token part (remove "Bearer " prefix if present)
    const actorTokenValue = actorToken.replace(/^Bearer\s+/i, '');
    
    // Get client details for the token exchange
    const clientDetails = await getEncompassCredentials(tenantId, losConnectionId);
    const { ApiClientId, ClientSecret, ApiServer } = clientDetails;
    
    if (!ApiClientId) {
      throw new Error('API Client ID is required for user impersonation');
    }
    
    const apiServerBase = ApiServer || 'https://api.elliemae.com';
    const tokenUrl = `${apiServerBase}/oauth2/v1/token`;
    
    console.log(`[EncompassApiService] Requesting impersonation token for user: ${subjectUserId}`);
    
    // Token exchange request for impersonation
    const params = new URLSearchParams();
    params.append('grant_type', 'urn:ietf:params:oauth:grant-type:token-exchange');
    params.append('actor_token_type', 'urn:ietf:params:oauth:token-type:access_token');
    params.append('subject_user_id', subjectUserId);
    params.append('actor_token', actorTokenValue);
    params.append('scope', 'lp');
    params.append('client_id', ApiClientId);
    if (ClientSecret) {
      params.append('client_secret', ClientSecret);
    }
    
    try {
      const response = await axios.post<{
        access_token: string;
        issued_token_type: string;
        token_type: string;
      }>(tokenUrl, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      
      if (response.data && response.data.access_token) {
        const impersonationToken = `${response.data.token_type} ${response.data.access_token}`;
        console.log(`[EncompassApiService] Successfully obtained impersonation token for user: ${subjectUserId}`);
        return impersonationToken;
      }
      
      throw new Error('No access_token in impersonation response');
    } catch (error: any) {
      console.error('[EncompassApiService] Error getting impersonation token:', 
        error.response?.data || error.message);
      throw new Error(
        `Encompass impersonation token error: ${error.response?.status} ${
          error.response?.data?.error_description || error.message
        }`
      );
    }
  }

  /**
   * Get loans accessible by a specific user using impersonation
   * This queries the Pipeline API with the user's permissions
   * Uses same pagination approach as getLoans() but with impersonation token
   * 
   * @param tenantId - Tenant ID
   * @param losConnectionId - LOS connection ID  
   * @param encompassUserId - Encompass user ID to get loans for
   * @returns Array of loan GUIDs the user can access
   */
  public async getUserAccessibleLoans(
    tenantId: string,
    losConnectionId: string,
    encompassUserId: string,
  ): Promise<{ loanGuids: string[]; totalCount: number }> {
    console.log(`[EncompassApiService] Fetching accessible loans for user: ${encompassUserId}`);
    
    // Get impersonation token for this user
    const impersonationToken = await this.getImpersonationToken(
      tenantId,
      losConnectionId,
      encompassUserId,
    );
    
    // Get client details to retrieve API server URL (same as getLoans does)
    const clientDetails = await getEncompassCredentials(tenantId, losConnectionId);
    const apiServer = clientDetails.ApiServer || "https://api.elliemae.com";
    
    // Create a new axios instance with the correct API server
    const apiClientForConnection = axios.create({
      baseURL: `${apiServer}/encompass`,
    });
    
    // Query Pipeline API with impersonation token using cursor-based pagination
    // This will only return loans the impersonated user can access
    const allLoanGuids: string[] = [];
    let cursor: string | undefined;
    let totalCount: number | undefined;
    let pageNumber = 0;
    let start = 0;
    const maxLoansPerRequest = 1000;
    
    // Build initial request body with filter (first page only)
    // Note: Pipeline API requires either 'filter' or 'loanGuids' attribute
    const initialRequestBody = {
      filter: {
        canonicalName: 'Loan.LoanFolder',
        matchType: 'isNotEmpty',
        value: '',
      },
      fields: ['Loan.LoanNumber'],
      sortOrder: [{ canonicalName: 'Loan.LastModified', order: 'descending' }],
    };
    const initialBodyJson = JSON.stringify(initialRequestBody);
    
    do {
      pageNumber++;
      const pageParams: any = {
        limit: maxLoansPerRequest,
      };
      
      // For first page, use cursorType. For subsequent pages, use both cursor AND start
      if (cursor) {
        pageParams.cursor = cursor;
        if (totalCount === undefined || start < totalCount) {
          pageParams.start = start;
        } else {
          console.log(`[EncompassApiService] User ${encompassUserId} - Start (${start}) exceeds totalCount (${totalCount}), stopping`);
          break;
        }
      } else {
        pageParams.cursorType = "randomAccess";
      }
      
      // Build request body - filter should only be included on first page
      let pageBodyJson: string;
      if (cursor) {
        pageBodyJson = JSON.stringify({
          fields: ['Loan.LoanNumber'],
          sortOrder: [{ canonicalName: 'Loan.LastModified', order: 'descending' }],
        });
      } else {
        pageBodyJson = initialBodyJson;
      }
      
      try {
        // v3 pipeline accepts JSON body
        const response = await apiClientForConnection.post<any>(
          '/v3/loanPipeline',
          JSON.parse(pageBodyJson),
          {
            headers: { 
              Authorization: impersonationToken,
              'Content-Type': 'application/json',
            },
            params: pageParams,
          },
        );
        
        // Get cursor and total count from response headers (case-insensitive)
        const cursorHeader = response.headers['x-cursor'] || response.headers['X-Cursor'] || response.headers['X-CURSOR'];
        const totalCountHeader = response.headers['x-total-count'] || response.headers['X-Total-Count'] || response.headers['X-TOTAL-COUNT'];
        
        if (pageNumber === 1) {
          cursor = cursorHeader as string | undefined;
          if (totalCountHeader) {
            totalCount = parseInt(totalCountHeader, 10);
            console.log(`[EncompassApiService] User ${encompassUserId} - Total loans: ${totalCount}, Cursor: ${cursor ? 'obtained' : 'none'}`);
          }
        }
        
        // Extract loan GUIDs from response
        const pageLoans = response.data || [];
        let pageGuidsAdded = 0;
        if (Array.isArray(pageLoans)) {
          for (const loan of pageLoans) {
            if (loan.loanGuid) {
              allLoanGuids.push(loan.loanGuid);
              pageGuidsAdded++;
            }
          }
        }
        
        console.log(`[EncompassApiService] User ${encompassUserId} - Page ${pageNumber}: ${pageGuidsAdded} loans, Total: ${allLoanGuids.length}/${totalCount || '?'}`);
        
        // Move to next page
        start += maxLoansPerRequest;
        
        // Stop conditions
        if (pageGuidsAdded < maxLoansPerRequest) {
          // Got fewer results than page size, we're done
          break;
        }
        if (totalCount !== undefined && allLoanGuids.length >= totalCount) {
          // Got all expected loans
          break;
        }
        if (!cursor) {
          // No cursor means no pagination possible
          break;
        }
        if (allLoanGuids.length >= 100000) {
          // Safety limit
          console.warn(`[EncompassApiService] User ${encompassUserId} - Safety limit reached (100k loans)`);
          break;
        }
        
      } catch (pageError: any) {
        console.error(`[EncompassApiService] User ${encompassUserId} - Pipeline error on page ${pageNumber}:`, {
          status: pageError.response?.status,
          data: pageError.response?.data,
          start,
          cursor: cursor || 'none',
        });
        // If first page fails, rethrow. Otherwise return what we have.
        if (pageNumber === 1) {
          throw pageError;
        }
        break;
      }
      
    } while (true);
    
    console.log(`[EncompassApiService] Completed: ${allLoanGuids.length} loans accessible by user: ${encompassUserId}`);
    
    return {
      loanGuids: allLoanGuids,
      totalCount: allLoanGuids.length,
    };
  }

  /**
   * Execute API operation with token retry logic
   */
  private async executeWithTokenRetry<T>(
    tenantId: string,
    losConnectionId: string,
    operation: (token: string) => Promise<AxiosResponse<T>>,
  ): Promise<EncompassApiResponse<T>> {
    let accessToken = await this.getEncompassAccessToken(
      tenantId,
      losConnectionId,
    );
    const clientDetails = await getEncompassCredentials(tenantId, losConnectionId);

    const MAX_THROTTLE_RETRIES = 5;
    let throttleAttempt = 0;

    while (true) {
      await this.acquireConcurrencyPermit(tenantId, losConnectionId);
      try {
        const response = await operation(accessToken);
        await this.touchTokenUsage(clientDetails);

        // Check concurrency headers and throttle if needed
        const concurrency = await this.checkConcurrencyAndThrottle(
          response,
          tenantId,
          losConnectionId,
        );

        return {
          data: response.data,
          concurrency: concurrency || undefined,
        };
      } catch (error: any) {
        const status = axios.isAxiosError(error)
          ? error.response?.status
          : undefined;

        // 429 = concurrency/rate limit exhausted (Too Many Requests)
        // 409 = pipeline or object state conflict from rapid queries (Conflict)
        // Both are transient and recoverable with back-off.
        if (
          (status === 429 || status === 409) &&
          throttleAttempt < MAX_THROTTLE_RETRIES
        ) {
          throttleAttempt++;
          const jitter = Math.floor(Math.random() * 500);
          const backoff = this.CONCURRENCY_POLL_INTERVAL * throttleAttempt + jitter;
          console.warn(
            `[EncompassApiService] Transient Encompass error (${status}), retry ${throttleAttempt}/${MAX_THROTTLE_RETRIES} in ${backoff}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }

        // Log non-retryable Encompass errors with response details
        if (axios.isAxiosError(error) && error.response && status !== 401) {
          console.error(
            `[EncompassApiService] Encompass API error ${status}:`,
            JSON.stringify(error.response.data ?? {}).slice(0, 500),
          );
        }

        // Handle 401 (token expired) with token refresh
        if (status === 401) {
          console.warn(`[Sync] Token expired (401), refreshing...`);
          await this.invalidateToken(clientDetails);
          accessToken = await this.getEncompassAccessToken(
            tenantId,
            losConnectionId,
            true,
          );
          throttleAttempt = 0;

          try {
            const retryResponse = await operation(accessToken);

            const retryConcurrency = await this.checkConcurrencyAndThrottle(
              retryResponse,
              tenantId,
              losConnectionId,
            );

            return {
              data: retryResponse.data,
              concurrency: retryConcurrency || undefined,
            };
          } catch (retryError: any) {
            console.error(
              `[EncompassApiService] Retry failed after token refresh:`,
              retryError.response?.data || retryError.message,
            );
            throw retryError;
          }
        }
        throw error;
      } finally {
        this.releaseConcurrencyPermit(tenantId, losConnectionId);
      }
    }
  }

  /**
   * Get loan folders
   */
  public async getLoanFolders(
    tenantId: string,
    losConnectionId: string,
  ): Promise<EncompassApiResponse<EncompassLoanFolder[]>> {
    console.log(
      `[EncompassApiService] Fetching loan folders for connection: ${losConnectionId}`,
    );

    return this.executeWithTokenRetry<EncompassLoanFolder[]>(
      tenantId,
      losConnectionId,
      async (accessToken) => {
        const requestConfig: AxiosRequestConfig = {
          headers: { Authorization: accessToken },
        };
        return await this.apiClient.get<EncompassLoanFolder[]>(
          "/v3/loanFolders",
          requestConfig,
        );
      },
    ).then((response) => {
      const data = response.data;
      if (data && Array.isArray(data)) {
        return {
          data: data.map((folder: any) => ({
            folderName: folder.folderName,
          })),
          concurrency: response.concurrency,
        };
      }
      return {
        data: [],
        concurrency: response.concurrency,
      };
    });
  }

  /**
   * Get RDB fields (field definitions)
   */
  public async getRdbFields(
    tenantId: string,
    losConnectionId: string,
  ): Promise<EncompassApiResponse<EncompassField[]>> {
    console.log(
      `[EncompassApiService] Fetching RDB fields for connection: ${losConnectionId}`,
    );

    const fields: EncompassField[] = [];
    let start = 0;
    const pageLimit = 500;
    let latestConcurrency: ConcurrencyMetrics | undefined;

    while (true) {
      const response = await this.executeWithTokenRetry<any>(
        tenantId,
        losConnectionId,
        async (accessToken) => {
          return await this.apiClient.get<any>("/v3/schemas/loan/standardFields", {
            headers: { Authorization: accessToken },
            params: { start, limit: pageLimit },
          });
        },
      );

      latestConcurrency = response.concurrency;
      const payload = response.data;
      const pageItems: any[] = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
          ? payload.items
          : Array.isArray(payload?.fields)
            ? payload.fields
            : [];

      if (pageItems.length === 0) break;

      for (const p of pageItems) {
        const fieldId = p.id || p.Id || p.fieldId || p.fieldID;
        if (!fieldId) continue;
        fields.push({
          fieldID: fieldId,
          description: p.description || p.Description || "",
          fieldType: 0,
          format: p.format || p.Format,
          jsonPath: p.jsonPath || p.JsonPath,
          contractPath: p.contractPath,
          dataType: p.dataType,
          readOnly: p.readOnly,
          nullable: p.nullable,
          category: p.category,
          maxLength: p.maxLength,
          multiInstance: p.multiInstance,
        });
      }

      if (pageItems.length < pageLimit) break;
      start += pageLimit;
    }

    return {
      data: fields
        .filter(
          (p) =>
            p.fieldID &&
            !p.fieldID.startsWith("97") &&
            !p.fieldID.startsWith("65"),
        ),
      concurrency: latestConcurrency,
    };
  }

  /**
   * Get custom fields
   */
  public async getCustomFields(
    tenantId: string,
    losConnectionId: string,
  ): Promise<EncompassApiResponse<EncompassCustomFieldFromApi[]>> {
    console.log(
      `[EncompassApiService] Fetching Custom fields for connection: ${losConnectionId}`,
    );

    const customFields: EncompassCustomFieldFromApi[] = [];
    let start = 0;
    const pageLimit = 100;
    let latestConcurrency: ConcurrencyMetrics | undefined;

    while (true) {
      const response = await this.executeWithTokenRetry<any>(
        tenantId,
        losConnectionId,
        async (accessToken) => {
          return await this.apiClient.get<any>("/v3/settings/loan/customFields", {
            headers: { Authorization: accessToken },
            params: { start, limit: pageLimit },
          });
        },
      );

      latestConcurrency = response.concurrency;
      const payload = response.data;
      const pageItems: any[] = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
          ? payload.items
          : Array.isArray(payload?.customFields)
            ? payload.customFields
            : [];
      if (pageItems.length === 0) break;

      customFields.push(
        ...pageItems.map((cf: any) => ({
          Id: cf.id || cf.Id,
          Audit: { Data: cf.description || cf.Description || cf.id || cf.Id },
          Description: cf.description || cf.Description,
          Format: cf.format || cf.Format,
          jsonPath: cf.jsonPath || cf.JsonPath,
          contractPath: cf.contractPath,
          maxLength: cf.maxLength,
          isCalculatedField: cf.isCalculatedField,
        })),
      );

      if (pageItems.length < pageLimit) break;
      start += pageLimit;
    }

    return {
      data: customFields,
      concurrency: latestConcurrency,
    };
  }

  /**
   * Get virtual field definitions (milestones, team members, documents, employment, etc.).
   * Used to build complete fieldId→jsonPath mappings for full-loan analysis bridging.
   * GET /v3/schemas/loan/virtualFields with pagination.
   * Capped at maxTotal (default 3000) to avoid OOM — the API can return 100k+ definitions.
   */
  public async getVirtualFields(
    tenantId: string,
    losConnectionId: string,
    options?: {
      virtualFieldTypes?: string[];
      start?: number;
      limit?: number;
      /** Stop after this many fields to avoid heap exhaustion (default 3000). */
      maxTotal?: number;
    }
  ): Promise<EncompassApiResponse<LoanSchemaField[]>> {
    console.log(
      `[EncompassApiService] Fetching virtual fields for connection: ${losConnectionId}`,
    );

    const fields: LoanSchemaField[] = [];
    let start = options?.start ?? 0;
    const pageLimit = Math.min(options?.limit ?? 200, 500);
    const maxTotal = options?.maxTotal ?? 3000;
    let latestConcurrency: ConcurrencyMetrics | undefined;

    const params: Record<string, string | number> = { start, limit: pageLimit };
    if (options?.virtualFieldTypes?.length) {
      params.virtualFieldTypes = options.virtualFieldTypes.join(",");
    }

    while (fields.length < maxTotal) {
      const response = await this.executeWithTokenRetry<any>(
        tenantId,
        losConnectionId,
        async (accessToken) => {
          return await this.apiClient.get<any>("/v3/schemas/loan/virtualFields", {
            headers: { Authorization: accessToken },
            params,
          });
        },
      );

      latestConcurrency = response.concurrency;
      const payload = response.data;
      const pageItems: any[] = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
          ? payload.items
          : Array.isArray(payload?.fields)
            ? payload.fields
            : [];

      if (pageItems.length === 0) break;

      for (const p of pageItems) {
        if (fields.length >= maxTotal) break;
        const fieldId = p.id ?? p.Id ?? p.fieldId ?? p.fieldID;
        if (!fieldId) continue;
        const jsonPath = p.jsonPath ?? p.JsonPath ?? "";
        fields.push({
          fieldId: String(fieldId),
          jsonPath,
          description: p.description ?? p.Description ?? "",
          type: p.dataType ?? p.format ?? p.Format ?? "string",
        });
      }

      if (pageItems.length < pageLimit) break;
      start += pageLimit;
      params.start = start;
    }

    console.log(
      `[EncompassApiService] Virtual fields: ${fields.length} definitions (capped at ${maxTotal})`,
    );
    return {
      data: fields,
      concurrency: latestConcurrency,
    };
  }

  /**
   * Get the canonical field names configured in the tenant's Reporting Database (RDB).
   * GET /v3/loanPipeline/canonicalFields — returns ONLY fields the Pipeline API can query,
   * i.e. those the admin has added to the RDB in Encompass settings.
   */
  public async getCanonicalFields(
    tenantId: string,
    losConnectionId: string,
  ): Promise<EncompassApiResponse<{ canonicalName: string; displayName: string; dataType?: string }[]>> {
    console.log(
      `[EncompassApiService] Fetching canonical (RDB) fields for connection: ${losConnectionId}`,
    );

    const response = await this.executeWithTokenRetry<any>(
      tenantId,
      losConnectionId,
      async (accessToken) => {
        return await this.apiClient.get<any>("/v3/loanPipeline/canonicalFields", {
          headers: { Authorization: accessToken },
        });
      },
    );

    const payload = response.data;
    const items: any[] = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.items)
        ? payload.items
        : [];

    const out: { canonicalName: string; displayName: string; dataType?: string }[] = [];
    for (const it of items) {
      const cname = it.canonicalName || it.name || it.criterionFieldName;
      const dname = it.displayName || it.description || cname;
      const dtype = it.dataType || it.fieldType;
      if (!cname) continue;
      out.push({ canonicalName: cname, displayName: dname, dataType: dtype });
    }

    console.log(
      `[EncompassApiService] Canonical fields: ${out.length} RDB entries`,
    );
    return { data: out, concurrency: response.concurrency };
  }

  /**
   * Get the full loan schema — every field ID with its JSON path, description, and type.
   * Includes v3 standard fields, custom fields, and virtual fields (milestones, team members, documents, employment, etc.).
   */
  public async getLoanSchema(
    tenantId: string,
    losConnectionId: string,
  ): Promise<EncompassApiResponse<LoanSchemaField[]>> {
    console.log(
      `[EncompassApiService] Fetching loan schema for connection: ${losConnectionId}`,
    );

    const fieldsResponse = await this.getRdbFields(tenantId, losConnectionId);
    const customFieldsResponse = await this.getCustomFields(tenantId, losConnectionId);
    let virtualFieldsResponse: { data: LoanSchemaField[]; concurrency?: ConcurrencyMetrics };
    try {
      virtualFieldsResponse = await this.getVirtualFields(tenantId, losConnectionId);
    } catch (err) {
      console.warn(
        `[EncompassApiService] Virtual fields fetch failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
      virtualFieldsResponse = { data: [], concurrency: undefined };
    }

    const fields: LoanSchemaField[] = fieldsResponse.data.map((f) => ({
      fieldId: f.fieldID,
      jsonPath: f.jsonPath || "",
      description: f.description || "",
      type: f.dataType || f.format || "string",
    }));
    for (const customField of customFieldsResponse.data) {
      fields.push({
        fieldId: customField.Id,
        jsonPath: customField.jsonPath || "",
        description: customField.Description || customField.Audit?.Data || "",
        type: customField.Format || "string",
      });
    }
    const seenIds = new Set(fields.map((f) => f.fieldId));
    for (const vf of virtualFieldsResponse.data) {
      if (vf.fieldId && !seenIds.has(vf.fieldId)) {
        seenIds.add(vf.fieldId);
        fields.push(vf);
      }
    }

    console.log(
      `[EncompassApiService] Loan schema: ${fields.length} fields (standard + custom + virtual)`,
    );
    return {
      data: fields,
      concurrency:
        fieldsResponse.concurrency ||
        customFieldsResponse.concurrency ||
        virtualFieldsResponse.concurrency,
    };
  }

  /**
   * Get schema for a specific field ID — returns the JSON path and metadata.
   * Implemented by looking up the v3 standard fields list.
   */
  public async getFieldSchema(
    tenantId: string,
    losConnectionId: string,
    fieldId: string,
  ): Promise<EncompassApiResponse<LoanSchemaField | null>> {
    const [fieldsResponse, customFieldsResponse] = await Promise.all([
      this.getRdbFields(tenantId, losConnectionId),
      this.getCustomFields(tenantId, losConnectionId),
    ]);
    const normalized = fieldId.startsWith("Fields.")
      ? fieldId.substring(7)
      : fieldId;
    const match = fieldsResponse.data.find((f) => {
      const candidate = f.fieldID.startsWith("Fields.")
        ? f.fieldID.substring(7)
        : f.fieldID;
      return candidate === normalized || f.fieldID === fieldId;
    });
    if (!match) {
      const customMatch = customFieldsResponse.data.find((f) => f.Id === fieldId);
      if (!customMatch) {
        return {
          data: null,
          concurrency: fieldsResponse.concurrency || customFieldsResponse.concurrency,
        };
      }
      return {
        data: {
          fieldId: customMatch.Id,
          jsonPath: customMatch.jsonPath || "",
          description: customMatch.Description || customMatch.Audit?.Data || "",
          type: customMatch.Format || "string",
        },
        concurrency: customFieldsResponse.concurrency || fieldsResponse.concurrency,
      };
    }
    return {
      data: {
        fieldId: match.fieldID,
        jsonPath: match.jsonPath || "",
        description: match.description || "",
        type: match.dataType || match.format || "string",
      },
      concurrency: fieldsResponse.concurrency,
    };
  }

  /**
   * Read specific field values from a loan by field ID (standard, custom, and virtual).
   * POST /v3/loans/{loanGuid}/fieldReader with invalidFieldBehavior=Include so invalid
   * field IDs return blank instead of failing the request.
   */
  public async readLoanFields(
    tenantId: string,
    losConnectionId: string,
    loanGuid: string,
    fieldIds: string[],
  ): Promise<EncompassApiResponse<FieldReaderValue[]>> {
    if (fieldIds.length === 0) {
      return { data: [] };
    }
    const normalizedGuid = loanGuid.replace(/[{}]/g, "");
    const response = await this.executeWithTokenRetry<any>(
      tenantId,
      losConnectionId,
      async (accessToken) => {
        return await this.apiClient.post<any>(
          `/v3/loans/${normalizedGuid}/fieldReader`,
          fieldIds,
          {
            headers: {
              Authorization: accessToken,
              "Content-Type": "application/json",
            },
            params: { invalidFieldBehavior: "Include" },
          },
        );
      },
    );
    const raw = response.data;
    const items: FieldReaderValue[] = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.fieldData)
        ? raw.fieldData
        : Array.isArray(raw?.loanFieldDataContract)
          ? raw.loanFieldDataContract
          : [];
    const data = items.map((item: any) => ({
      fieldId: String(item.fieldId ?? item.fieldID ?? item.id ?? ""),
      value: item.value != null ? String(item.value) : "",
    }));
    return { data, concurrency: response.concurrency };
  }

  /**
   * Get a single loan by GUID — returns the full loan object with ALL fields.
   * Endpoint: GET /v3/loans/{loanGuid}
   */
  public async getLoanById(
    tenantId: string,
    losConnectionId: string,
    loanGuid: string,
  ): Promise<EncompassApiResponse<Record<string, any>>> {
    return this.executeWithTokenRetry<Record<string, any>>(
      tenantId,
      losConnectionId,
      async (accessToken) => {
        const normalizedGuid = loanGuid.replace(/[{}]/g, "");
        return await this.apiClient.get<Record<string, any>>(
          `/v3/loans/${normalizedGuid}`,
          {
            headers: { Authorization: accessToken },
            params: { view: "entity" },
          },
        );
      },
    );
  }

  /**
   * Get loans using v3 pipeline endpoint (POST with JSON body containing filter, fields, sortOrder)
   */
  public async getLoans(
    tenantId: string,
    losConnectionId: string,
    options: {
      modifiedFrom?: Date;
      loanStartDate?: Date; // Date filter for Fields.Log.MS.Date.Started (defaults to 5 years ago)
      loanStartDateField?: string; // Field to use for loan start date filter (defaults to 'Fields.Log.MS.Date.Started')
      limit?: number;
      fields?: string[]; // Encompass field IDs (e.g., ['Fields.2', 'Fields.3'])
      folderName?: string; // Deprecated: use folderNames instead
      folderNames?: string[]; // Array of folder names to sync
      skipArchiveDetection?: boolean;
    } = {},
  ): Promise<EncompassApiResponse<EncompassLoan[]>> {
    // Get client details to retrieve API server URL
    const clientDetails = await getEncompassCredentials(
      tenantId,
      losConnectionId,
    );
    const apiServer = clientDetails.ApiServer || "https://api.elliemae.com";

    // Create a new axios instance with the correct API server for this connection
    const apiClientForConnection = axios.create({
      baseURL: `${apiServer}/encompass`,
    });

    // Build field GUIDs array - only numeric field IDs get "Fields." prefix
    // Canonical names (Loan.*, etc.) should NOT have "Fields." prefix
    // The v1 pipeline API expects fields in format: ["Loan.LoanNumber", "Loan.LoanAmount", "Fields.4000", etc.]
    let fieldGuids: string[] = [];
    if (options.fields && options.fields.length > 0) {
      fieldGuids = options.fields.map((field) => {
        // If field already has "Fields." prefix, keep it
        if (field.startsWith("Fields.")) {
          return field;
        }
        // Canonical names (Loan.*, etc.) should NOT have "Fields." prefix
        if (
          field.startsWith("Loan.") ||
          field.startsWith("Borrower.") ||
          field.startsWith("Property.") ||
          field.startsWith("CoBorrower.") ||
          field.startsWith("SubjectProperty.")
        ) {
          return field;
        }
        // For numeric field IDs or other field IDs, add "Fields." prefix
        // This handles both pure numbers (e.g., "364") and field paths (e.g., "QM.X23")
        return `Fields.${field}`;
      });
    }

    // Build filter terms array
    const filterTerms: any[] = [];

    if (options.modifiedFrom) {
      filterTerms.push({
        canonicalName: "Loan.LastModified",
        value: options.modifiedFrom.toISOString(),
        matchType: "greaterThanOrEquals",
      });
    }

    // Add loanStartDate filter if provided (second date filter to match Qlik's dual-filter approach)
    // Defaults to 36 months (3 years) ago to match Qlik's vLoanStartDate = MonthStart(Today(), -36)
    // MonthStart returns the first day of the month, so we set to first day of month 36 months ago
    const loanStartDate =
      options.loanStartDate ||
      (() => {
        const threeYearsAgo = new Date();
        threeYearsAgo.setMonth(threeYearsAgo.getMonth() - 36); // 36 months = 3 years (matching Qlik)
        threeYearsAgo.setDate(1); // Set to first day of month (MonthStart behavior)
        threeYearsAgo.setHours(0, 0, 0, 0); // Set to midnight
        return threeYearsAgo;
      })();
    const loanStartDateField =
      options.loanStartDateField || "Fields.Log.MS.Date.Started";

    // Always add the loan start date filter (matching Qlik's approach)
    // NOTE: Qlik does NOT include 'precision' for this filter (only for Loan.LastModified)
    filterTerms.push({
      canonicalName: loanStartDateField,
      value: loanStartDate.toISOString(),
      matchType: "greaterThanOrEquals",
      // No precision field - Qlik doesn't include it for Fields.Log.MS.Date.Started
    });

    // Add folder filter if provided (nested structure matching Qlik script)
    // Use folderNames if provided, otherwise fall back to folderName for backward compatibility
    const folderNames =
      options.folderNames ||
      (options.folderName ? [options.folderName] : undefined);
    if (folderNames && folderNames.length > 0) {
      // Folder filters must be nested in a term with operator, matching Qlik script format
      // Build array of folder terms (one per folder)
      const folderTerms = folderNames.map((folderName) => ({
        canonicalName: "Loan.LoanFolder",
        value: folderName,
        matchType: "exact" as const, // Qlik script uses "exact", not "equals"
        include: true, // Required for folder filters
      }));

      // Wrap folder terms in an operator term (use 'or' to match any folder)
      filterTerms.push({
        operator: "or",
        terms: folderTerms,
      });
    }

    // Build filter object (shared between archive-detection call and main call)
    let filter: any = undefined;
    if (filterTerms.length === 1) {
      filter = filterTerms[0];
    } else if (filterTerms.length > 1) {
      filter = { operator: "and", terms: filterTerms };
    }

    // =========================================================================
    // ARCHIVE DETECTION: Lightweight call with includeArchivedLoans:false to
    // collect non-archived GUIDs. We diff against the full call to tag archived.
    // =========================================================================
    const nonArchivedGuids = new Set<string>();
    if (!options.skipArchiveDetection) {
      try {
        const archiveDetectBody: any = {
          fields: ["Fields.GUID"],
          sortOrder: [{ canonicalName: "Loan.LastModified", order: "descending" }],
          includeArchivedLoans: false,
        };
        if (filter) archiveDetectBody.filter = filter;

        let adStart = 0;
        const adLimit = 5000;
        let adTotal: number | undefined;
        let adPage = 0;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          adPage++;
          const adResponse = await this.executeWithTokenRetry<any>(
            tenantId, losConnectionId, async (accessToken) => {
              const r = await apiClientForConnection.post<any>(
                "/v3/loanPipeline", archiveDetectBody,
                { headers: { Authorization: accessToken, "Content-Type": "application/json" }, params: { start: adStart, limit: adLimit } },
              );
              if (adPage === 1) {
                const tc = r.headers["x-total-count"] || r.headers["X-Total-Count"] || r.headers["X-TOTAL-COUNT"];
                if (tc) { const p = parseInt(tc, 10); if (!isNaN(p)) adTotal = p; }
              }
              return r;
            },
          );
          const adLoans = this.transformPipelineResponse(adResponse);
          for (const loan of adLoans) {
            const guid = loan["Fields.GUID"] || loan["GUID"] || loan.loanGuid || loan.guid;
            if (guid) nonArchivedGuids.add(guid.replace(/[{}]/g, "").toLowerCase());
          }
          adStart += adLoans.length;
          if (adLoans.length === 0) break;
          if (adTotal !== undefined && adStart >= adTotal) break;
        }
        console.log(`[Sync] Archive detection: ${nonArchivedGuids.size} non-archived GUIDs collected in ${adPage} page(s)`);
      } catch (err: any) {
        console.warn(`[Sync] Archive detection call failed (will default is_archived to false): ${err.message}`);
      }
    }

    // =========================================================================
    // MAIN CALL: Fetch all loans (including archived) with full fields
    // =========================================================================
    const body: any = {
      fields: fieldGuids,
      sortOrder: [
        {
          canonicalName: "Loan.LastModified",
          order: "descending",
        },
      ],
      includeArchivedLoans: true,
    };
    if (filter) body.filter = filter;

    const bodyJson = JSON.stringify(body);

    console.log(
      `[Sync] Pipeline request: ${fieldGuids.length} fields, modifiedFrom=${options.modifiedFrom?.toISOString() || "none"}, folders=${folderNames?.length || 0}, startDate=${loanStartDate.toISOString().split("T")[0]}`,
    );

    const allLoans: EncompassLoan[] = [];
    const uniqueLoanGuids = new Set<string>();
    let totalCount: number | undefined = undefined;
    let pageNumber = 0;
    let start = 0;
    const requestedLimit = 1000;
    const totalLimit = options.limit;
    const bodyObj = JSON.parse(bodyJson);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      pageNumber++;

      const pageLimit = totalLimit
        ? Math.min(requestedLimit, totalLimit - allLoans.length)
        : requestedLimit;
      if (pageLimit <= 0) break;

      const response = await this.executeWithTokenRetry<{
        root: Array<{
          loanGuid: string;
          fields: Array<{ [key: string]: any }>;
        }>;
      }>(tenantId, losConnectionId, async (accessToken) => {
        const response = await apiClientForConnection.post<{
          root: Array<{
            loanGuid: string;
            fields: Array<{ [key: string]: any }>;
          }>;
        }>("/v3/loanPipeline", bodyObj, {
          headers: {
            Authorization: accessToken,
            "Content-Type": "application/json",
          },
          params: { start, limit: pageLimit },
        });

        const totalCountHeader =
          response.headers["x-total-count"] ||
          response.headers["X-Total-Count"] ||
          response.headers["X-TOTAL-COUNT"];

        if (pageNumber === 1 && totalCountHeader) {
          const parsed = parseInt(totalCountHeader, 10);
          if (!isNaN(parsed)) totalCount = parsed;
        }

        return response;
      });

      const pageLoans = this.transformPipelineResponse(response);

      let newUniqueGuids = 0;
      for (const loan of pageLoans) {
        const guid =
          loan["Fields.GUID"] || loan["GUID"] || loan.loanGuid || loan.guid;
        if (guid) {
          const normalizedGuid = guid.replace(/[{}]/g, "").toLowerCase();
          if (!uniqueLoanGuids.has(normalizedGuid)) {
            uniqueLoanGuids.add(normalizedGuid);
            newUniqueGuids++;
          }
        }
      }

      allLoans.push(...pageLoans);

      const actualPageSize = pageLoans.length;

      console.log(
        `[Sync] Page ${pageNumber}: ${actualPageSize} loans (${newUniqueGuids} new unique), ` +
        `total fetched=${allLoans.length}, totalCount=${totalCount ?? "?"}, start=${start}`,
      );

      start += actualPageSize;

      // Stop when: empty page, we hit user's limit, or we've received everything.
      // Do NOT stop on "partial page" alone: API can return < limit mid-stream (e.g. 393 then more).
      // Only treat partial page as last when we've received totalCount (start >= totalCount) or we have no totalCount.
      // For full sync (no totalLimit), do NOT stop on totalCount — API may cap X-Total-Count at 10k.
      if (actualPageSize === 0) break;
      if (totalLimit !== undefined && allLoans.length >= totalLimit) break;
      if (
        totalLimit !== undefined &&
        totalCount !== undefined &&
        start >= totalCount
      )
        break;
      if (
        actualPageSize < pageLimit &&
        (totalCount === undefined || start >= totalCount)
      )
        break; // partial page and we've got all (or don't know total)
      // Safety: if page returned 0 new unique GUIDs, we're in a loop
      if (newUniqueGuids === 0 && actualPageSize > 0) {
        console.warn(
          `[Sync] Page ${pageNumber} returned ${actualPageSize} loans but 0 new unique GUIDs — stopping to avoid infinite loop`,
        );
        break;
      }
    }

    console.log(
      `[Sync] Fetched ${allLoans.length} loans in ${pageNumber} page(s)${totalCount ? ` (${totalCount} available)` : ""}`,
    );

    // Deduplicate loans by GUID to catch any API bugs
    const uniqueLoansMap = new Map<string, EncompassLoan>();
    const duplicateGuids: string[] = [];
    const guidCounts = new Map<string, number>();

    for (const loan of allLoans) {
      // Extract GUID from various possible locations
      const guid =
        loan["Fields.GUID"] || loan["GUID"] || loan.loanGuid || loan.guid;

      if (guid) {
        // Normalize GUID (remove curly braces if present)
        const normalizedGuid = guid.replace(/[{}]/g, "").toLowerCase();

        // Track counts
        guidCounts.set(
          normalizedGuid,
          (guidCounts.get(normalizedGuid) || 0) + 1,
        );

        if (uniqueLoansMap.has(normalizedGuid)) {
          duplicateGuids.push(guid);
          // Keep the first occurrence
          continue;
        }

        uniqueLoansMap.set(normalizedGuid, loan);
      } else {
        // If no GUID, use loan number as fallback
        const loanNumber =
          loan["Loan.LoanNumber"] || loan["Fields.364"] || loan.loanNumber;
        if (loanNumber) {
          const key = `loan_${loanNumber}`;
          guidCounts.set(key, (guidCounts.get(key) || 0) + 1);
          if (uniqueLoansMap.has(key)) {
            duplicateGuids.push(`loan_${loanNumber}`);
            continue;
          }
          uniqueLoansMap.set(key, loan);
        } else {
          // Last resort: add with timestamp (shouldn't happen)
          const key = `unknown_${Date.now()}_${Math.random()}`;
          uniqueLoansMap.set(key, loan);
        }
      }
    }

    let uniqueLoans = Array.from(uniqueLoansMap.values());

    if (duplicateGuids.length > 0) {
      console.warn(
        `[Sync] Removed ${duplicateGuids.length} duplicate loan(s) (${allLoans.length} -> ${uniqueLoans.length})`,
      );
    }

    // Apply limit if specified (slice to exact limit after deduplication)
    if (totalLimit !== undefined && uniqueLoans.length > totalLimit) {
      uniqueLoans = uniqueLoans.slice(0, totalLimit);
    }

    // Tag archived loans: any GUID in the full set but NOT in the non-archived set
    if (nonArchivedGuids.size > 0) {
      let archivedCount = 0;
      for (const loan of uniqueLoans) {
        const guid = loan["Fields.GUID"] || loan["GUID"] || loan.loanGuid || loan.guid;
        if (guid) {
          const normalizedGuid = guid.replace(/[{}]/g, "").toLowerCase();
          if (!nonArchivedGuids.has(normalizedGuid)) {
            loan._isArchived = true;
            archivedCount++;
          }
        }
      }
      console.log(
        `[Sync] Archive tagging: ${archivedCount} archived, ${uniqueLoans.length - archivedCount} non-archived out of ${uniqueLoans.length} total`,
      );
    }

    return {
      data: uniqueLoans,
      concurrency: undefined,
    };
  }

  /**
   * Get internal users from Encompass v3 API
   * Endpoint: GET /encompass/v3/users
   */
  public async getEncompassUsers(
    tenantId: string,
    losConnectionId: string,
    options?: { enabledOnly?: boolean; limit?: number },
  ): Promise<EncompassApiResponse<EncompassUser[]>> {
    const { enabledOnly = true, limit = 10000 } = options || {};

    console.log(
      `[EncompassApiService] Fetching Encompass users (enabledOnly: ${enabledOnly}, limit: ${limit})`,
    );

    const users: EncompassUserFromApi[] = [];
    let start = 0;
    const pageLimit = Math.min(250, limit);
    let latestConcurrency: ConcurrencyMetrics | undefined;

    while (users.length < limit) {
      const response = await this.executeWithTokenRetry<any>(
        tenantId,
        losConnectionId,
        async (accessToken) => {
          return await this.apiClient.get<any>("/v3/users", {
            headers: { Authorization: accessToken },
            params: {
              orgId: 0,
              isRecursive: true,
              entities: "all",
              start,
              limit: pageLimit,
            },
          });
        },
      );
      latestConcurrency = response.concurrency;
      const payload = response.data;
      const pageUsers: EncompassUserFromApi[] = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
          ? payload.items
          : Array.isArray(payload?.users)
            ? payload.users
            : [];
      if (pageUsers.length === 0) break;
      users.push(...pageUsers);
      if (pageUsers.length < pageLimit) break;
      start += pageLimit;
    }

    let filteredUsers = users;
    if (enabledOnly) {
      filteredUsers = users.filter((user) => {
        if (typeof user.enabled === "boolean") return user.enabled;
        return user.userIndicators?.includes("Enabled");
      });
    }

    const mappedUsers = filteredUsers.slice(0, limit).map(mapEncompassUser);
    console.log(
      `[EncompassApiService] Fetched ${users.length} users, ${mappedUsers.length} after filtering`,
    );
    return {
      data: mappedUsers,
      concurrency: latestConcurrency,
    };
  }

  /**
   * Fetch all loan GUIDs that currently exist in the given folders via the v3
   * Pipeline API. Uses the proven folder-filter approach (same as getLoans) but
   * requests only Fields.GUID to keep payloads minimal.
   *
   * Used by folder reconciliation to determine which loans *should* be in the DB.
   */
  public async getLoanGuidsByFolders(
    tenantId: string,
    losConnectionId: string,
    folderNames: string[],
    loanStartDate?: Date,
  ): Promise<Set<string>> {
    if (folderNames.length === 0) return new Set();

    const clientDetails = await getEncompassCredentials(tenantId, losConnectionId);
    const apiServer = clientDetails.ApiServer || "https://api.elliemae.com";
    const apiClientForConnection = axios.create({
      baseURL: `${apiServer}/encompass`,
    });

    // Build folder filter terms
    const folderTerms = folderNames.map((name) => ({
      canonicalName: "Loan.LoanFolder",
      value: name,
      matchType: "exact" as const,
      include: true,
    }));

    const filterTerms: any[] = [
      { operator: "or", terms: folderTerms },
    ];

    // Apply same loan start date filter as normal sync (defaults to 36 months ago)
    const startDate = loanStartDate ?? (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - 36);
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      return d;
    })();
    filterTerms.push({
      canonicalName: "Fields.Log.MS.Date.Started",
      value: startDate.toISOString(),
      matchType: "greaterThanOrEquals",
    });

    const body = {
      filter: { operator: "and", terms: filterTerms },
      fields: ["Fields.GUID"],
      sortOrder: [{ canonicalName: "Loan.LastModified", order: "descending" }],
      includeArchivedLoans: true,
    };

    const guids = new Set<string>();
    let pageNumber = 0;
    let start = 0;
    const pageLimit = 1000;

    while (true) {
      pageNumber++;
      const response = await this.executeWithTokenRetry<any>(
        tenantId,
        losConnectionId,
        async (accessToken) => {
          return await apiClientForConnection.post<any>(
            "/v3/loanPipeline",
            body,
            {
              headers: {
                Authorization: accessToken,
                "Content-Type": "application/json",
              },
              params: { start, limit: pageLimit },
            },
          );
        },
      );

      const pageLoans = this.transformPipelineResponse(response);

      for (const loan of pageLoans) {
        const rawGuid = loan["Fields.GUID"] || loan["GUID"] || loan.loanGuid || loan.guid;
        if (rawGuid) {
          guids.add(rawGuid.replace(/[{}]/g, "").toLowerCase());
        }
      }

      console.log(
        `[Reconcile] Folder GUID fetch page ${pageNumber}: ${pageLoans.length} loans, running total=${guids.size}`,
      );

      if (pageLoans.length === 0 || pageLoans.length < pageLimit) break;
      start += pageLoans.length;
    }

    return guids;
  }

  /**
   * Transform v1 pipeline response structure to flat loan objects
   */
  private transformPipelineResponse(response: any): EncompassLoan[] {
    const loans: EncompassLoan[] = [];

    // The response can be in different formats:
    // 1. { root: [{ loanGuid, fields: [...] }] } - nested structure
    // 2. Array-like object with numeric keys ['0', '1', '2', ...] - direct array
    // 3. Direct array

    let loanItems: any[] = [];

    // Check if response.data is an array-like object (has numeric keys)
    if (response.data && typeof response.data === "object") {
      // Check for root property first
      if (response.data.root && Array.isArray(response.data.root)) {
        loanItems = response.data.root;
      }
      // Check if it's an array-like object (has numeric string keys)
      else if (
        response.data["0"] !== undefined ||
        Array.isArray(response.data)
      ) {
        // Convert array-like object to array
        loanItems = Array.isArray(response.data)
          ? response.data
          : Object.keys(response.data)
              .filter((key) => /^\d+$/.test(key))
              .sort((a, b) => parseInt(a) - parseInt(b))
              .map((key) => response.data[key]);
      }
    }

    // Transform each loan item to flat object
    for (const loanItem of loanItems) {
      // Transform nested structure to flat object
      const loan: EncompassLoan = {
        loanGuid: loanItem.loanGuid || loanItem.guid || loanItem.loanNumber,
      };

      // Convert fields array to flat object
      if (loanItem.fields && Array.isArray(loanItem.fields)) {
        for (const field of loanItem.fields) {
          const fieldKey =
            field.canonicalName ?? field.fieldId ?? field.fieldID ?? field.id;
          const fieldValue = field.value;
          if (fieldKey != null && fieldKey !== "" && "value" in field) {
            loan[fieldKey] = fieldValue != null ? fieldValue : "";
          } else {
            // Key-value format: { "Fields.5016": "Y" }
            Object.assign(loan, field);
          }
        }
      } else if (loanItem.fields && typeof loanItem.fields === "object") {
        // Fields might be an object instead of array
        Object.assign(loan, loanItem.fields);
      } else {
        // Fields might be at the root level
        // Copy all properties except loanGuid/guid
        for (const [key, value] of Object.entries(loanItem)) {
          if (key !== "loanGuid" && key !== "guid" && key !== "fields") {
            loan[key] = value;
          }
        }
      }

      loans.push(loan);
    }

    return loans;
  }
}
