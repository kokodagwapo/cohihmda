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
}

export interface EncompassCustomFieldFromApi {
  Id: string;
  Audit?: { Data?: string };
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

// Encompass User types from v1 API
// Note: The 'id' field IS the username/login ID in Encompass v1 API
export interface EncompassUserFromApi {
  id: string; // This is the login username (e.g., "jsmith")
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
  return {
    id: user.id,
    username: user.id, // In v1 API, id IS the username
    firstName: user.firstName,
    lastName: user.lastName,
    fullName:
      user.fullName ||
      (user.firstName && user.lastName
        ? `${user.firstName} ${user.lastName}`.trim()
        : user.firstName || user.lastName || user.id),
    email: user.email,
    phone: user.phone,
    cellPhone: user.cellPhone,
    jobTitle: user.jobTitle,
    isEnabled: user.userIndicators?.includes("Enabled") ?? false,
    userIndicators: user.userIndicators || [],
    personas: user.personas?.map((p) => p.entityName).filter(Boolean) as string[] || [],
    nmlsId: user.nmlsOriginatorID,
    orgId: user.organization?.entityId,
    orgName: user.organization?.entityName,
    lastLogin: user.lastLogin,
  };
}

export class EncompassApiService {
  private apiClient: AxiosInstance;
  private encompassApiBaseUrl: string;
  private tenantPool?: pg.Pool; // Tenant-specific database pool
  private MAX_CONCURRENCY_RATIO = 0.2; // 20% threshold for ISV partners
  private CONCURRENCY_POLL_INTERVAL = 2000; // 2 seconds in milliseconds

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
        `SELECT token, expires_at 
         FROM public.encompass_token_cache 
         WHERE cache_key = $1`,
        [cacheKey],
      );

      if (result.rows.length > 0) {
        const cachedToken = result.rows[0];
        const now = Date.now();
        if (cachedToken.expires_at > now) {
          return cachedToken.token;
        } else {
          console.log(
            `[EncompassApiService] Cached token expired for ${cacheKey}`,
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

    // Throttle if threshold exceeded
    if (metrics.exceeded_threshold) {
      const waitTime = this.CONCURRENCY_POLL_INTERVAL;
      console.warn(
        `[EncompassApiService] Concurrency utilization ${(
          utilizationRatio * 100
        ).toFixed(1)}% exceeds ISV partner threshold ${(
          this.MAX_CONCURRENCY_RATIO * 100
        ).toFixed(1)}%. Waiting ${waitTime}ms before next request...`,
      );

      await new Promise((resolve) => setTimeout(resolve, waitTime));
      console.log(
        `[EncompassApiService] Resumed after ${waitTime}ms concurrency wait`,
      );
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

    // Check cache first unless force refresh
    if (!forceRefresh) {
      const cachedToken = await this.getCachedToken(clientDetails);
      if (cachedToken) {
        return cachedToken;
      }
    }

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
      fields: ['Loan.LoanNumber'], // Minimal fields, we just need GUIDs
      sortOrder: [{ canonicalName: 'Loan.LastModified', order: 'desc' }],
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
        // Subsequent pages: no filter, just fields and sortOrder
        pageBodyJson = JSON.stringify({
          fields: ['Loan.LoanNumber'],
          sortOrder: [{ canonicalName: 'Loan.LastModified', order: 'desc' }],
        });
      } else {
        pageBodyJson = initialBodyJson;
      }
      
      try {
        // v1 pipeline expects Content-Type: text/plain with JSON string body
        const response = await apiClientForConnection.post<any>(
          '/v1/loanPipeline',
          pageBodyJson,
          {
            headers: { 
              Authorization: impersonationToken,
              'Content-Type': 'text/plain',
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

    const MAX_THROTTLE_RETRIES = 5;
    let throttleAttempt = 0;

    while (true) {
      try {
        const response = await operation(accessToken);

        // Check concurrency headers and throttle if needed
        const concurrency = await this.checkConcurrencyAndThrottle(
          response,
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
          const backoff = this.CONCURRENCY_POLL_INTERVAL * throttleAttempt;
          console.warn(
            `[EncompassApiService] Transient Encompass error (${status}), retry ${throttleAttempt}/${MAX_THROTTLE_RETRIES} in ${backoff}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }

        // Handle 401 (token expired) with token refresh
        if (status === 401) {
          console.warn(`[Sync] Token expired (401), refreshing...`);
          const clientDetails = await getEncompassCredentials(
            tenantId,
            losConnectionId,
          );
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

    const clientDetails = await getEncompassCredentials(
      tenantId,
      losConnectionId,
    );
    let instanceIdParam = clientDetails.InstanceId;
    if (instanceIdParam && instanceIdParam.startsWith("30")) {
      instanceIdParam = instanceIdParam.replace("30", "BE");
    }

    return this.executeWithTokenRetry<{ pipelineLoanReportFieldDefs: any[] }>(
      tenantId,
      losConnectionId,
      async (accessToken) => {
        const apiUrl = `/v1/loanPipeline/fieldDefinitions`;
        return await this.apiClient.get<{
          pipelineLoanReportFieldDefs: any[];
        }>(apiUrl, {
          headers: { Authorization: accessToken },
          params: { instanceId: instanceIdParam },
        });
      },
    ).then((response) => {
      const data = response.data;
      if (data && data.pipelineLoanReportFieldDefs) {
        return {
          data: data.pipelineLoanReportFieldDefs
            .filter(
              (p: any) =>
                p.fieldID &&
                !p.fieldID.startsWith("97") &&
                !p.fieldID.startsWith("65"),
            )
            .map((p: any) => ({
              fieldID: p.fieldID,
              description: p.description,
              fieldType: parseInt(p.fieldType, 10) || 0,
              format: p.format,
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
   * Get custom fields
   */
  public async getCustomFields(
    tenantId: string,
    losConnectionId: string,
  ): Promise<EncompassApiResponse<EncompassCustomFieldFromApi[]>> {
    console.log(
      `[EncompassApiService] Fetching Custom fields for connection: ${losConnectionId}`,
    );

    const clientDetails = await getEncompassCredentials(
      tenantId,
      losConnectionId,
    );
    let instanceIdParam = clientDetails.InstanceId;
    if (instanceIdParam && instanceIdParam.startsWith("30")) {
      instanceIdParam = instanceIdParam.replace("30", "BE");
    }

    return this.executeWithTokenRetry<any[]>(
      tenantId,
      losConnectionId,
      async (accessToken) => {
        const apiUrl = `/v1/settings/loan/customFields`;
        return await this.apiClient.get<any[]>(apiUrl, {
          headers: { Authorization: accessToken },
          params: { instanceId: instanceIdParam },
        });
      },
    ).then((response) => {
      return {
        data:
          response.data.map((cf: any) => ({
            Id: cf.id,
            Audit: cf.audit ? { Data: cf.audit.data } : undefined,
          })) || [],
        concurrency: response.concurrency,
      };
    });
  }

  /**
   * Get the full loan schema — every field ID with its JSON path, description, and type.
   * Endpoint: GET /v1/schema/loan
   */
  public async getLoanSchema(
    tenantId: string,
    losConnectionId: string,
  ): Promise<EncompassApiResponse<LoanSchemaField[]>> {
    console.log(
      `[EncompassApiService] Fetching loan schema for connection: ${losConnectionId}`,
    );

    return this.executeWithTokenRetry<any>(
      tenantId,
      losConnectionId,
      async (accessToken) => {
        return await this.apiClient.get<any>("/v1/schema/loan", {
          headers: { Authorization: accessToken },
        });
      },
    ).then((response) => {
      const raw = response.data;
      const fields: LoanSchemaField[] = [];

      // Debug: log the shape of the raw response
      console.log(
        `[EncompassApiService] Loan schema raw: type=${Array.isArray(raw) ? "array" : typeof raw}, ` +
        `keys=${raw && typeof raw === "object" ? Object.keys(raw).join(", ") : "N/A"}`
      );

      // Encompass v1 schema comes in format:
      //   { schema_version, entity_types: { "Loan": { properties: { ... } }, ... } }
      // Each property leaf may have: { type, description, format, fieldId, ... }
      // We walk the entire tree looking for leaves that have a "type" or "fieldId".
      const walkProperties = (obj: any, pathPrefix: string) => {
        if (!obj || typeof obj !== "object") return;
        for (const [key, val] of Object.entries(obj)) {
          if (!val || typeof val !== "object") continue;
          const entry = val as any;
          const currentPath = pathPrefix ? `${pathPrefix}.${key}` : key;

          // A leaf field definition typically has { type, description } or { fieldId }
          if (entry.type && typeof entry.type === "string" && !entry.properties && !entry.entity_types) {
            fields.push({
              fieldId: entry.fieldId || entry.id || "",
              jsonPath: currentPath,
              description: entry.description || "",
              type: entry.type || "string",
            });
          }

          // Recurse into nested properties
          if (entry.properties && typeof entry.properties === "object") {
            walkProperties(entry.properties, currentPath);
          }
          // Recurse into items (for array types)
          if (entry.items && typeof entry.items === "object") {
            if (entry.items.properties) {
              walkProperties(entry.items.properties, `${currentPath}.0`);
            } else {
              walkProperties(entry.items, `${currentPath}.0`);
            }
          }
          // Recurse into allOf/oneOf/anyOf
          for (const combo of ["allOf", "oneOf", "anyOf"]) {
            if (Array.isArray(entry[combo])) {
              for (const sub of entry[combo]) {
                if (sub.properties) walkProperties(sub.properties, currentPath);
              }
            }
          }
        }
      };

      if (Array.isArray(raw)) {
        for (const entry of raw) {
          if (entry.fieldId || entry.id) {
            fields.push({
              fieldId: entry.fieldId || entry.id,
              jsonPath: entry.jsonPath || entry.modelPath || "",
              description: entry.description || "",
              type: entry.type || entry.format || "string",
            });
          }
        }
      } else if (raw && typeof raw === "object") {
        // Handle { entity_types: { ... } } wrapper
        const entityTypes = raw.entity_types || raw.entityTypes || raw;
        if (entityTypes && typeof entityTypes === "object") {
          // Log entity type names for debugging
          const entityNames = Object.keys(entityTypes).slice(0, 20);
          console.log(`[EncompassApiService] Schema entity types: ${entityNames.join(", ")}`);

          for (const [entityName, entityDef] of Object.entries(entityTypes)) {
            if (!entityDef || typeof entityDef !== "object") continue;
            const ed = entityDef as any;

            // Log first entity structure for debugging
            if (fields.length === 0 && ed.properties) {
              const propKeys = Object.keys(ed.properties).slice(0, 10);
              const sampleProp = ed.properties[propKeys[0]];
              console.log(
                `[EncompassApiService] Schema entity "${entityName}": ${Object.keys(ed.properties).length} properties. Sample "${propKeys[0]}": ${JSON.stringify(sampleProp).substring(0, 300)}`
              );
            }

            if (ed.properties) {
              walkProperties(ed.properties, entityName === "Loan" ? "" : entityName);
            }
          }
        }
      }

      console.log(`[EncompassApiService] Loan schema: ${fields.length} fields parsed`);
      if (fields.length > 0) {
        const sample = fields.slice(0, 5).map(f => `${f.jsonPath}→${f.fieldId}(${f.type})`);
        console.log(`[EncompassApiService] Schema samples: ${sample.join("; ")}`);
      }
      return { data: fields, concurrency: response.concurrency };
    });
  }

  /**
   * Get schema for a specific field ID — returns the JSON path and metadata.
   * Endpoint: GET /v1/schema/loan/{fieldId}
   */
  public async getFieldSchema(
    tenantId: string,
    losConnectionId: string,
    fieldId: string,
  ): Promise<EncompassApiResponse<LoanSchemaField | null>> {
    return this.executeWithTokenRetry<any>(
      tenantId,
      losConnectionId,
      async (accessToken) => {
        return await this.apiClient.get<any>(`/v1/schema/loan/${encodeURIComponent(fieldId)}`, {
          headers: { Authorization: accessToken },
        });
      },
    ).then((response) => {
      const raw = response.data;
      if (raw && typeof raw === "object") {
        return {
          data: {
            fieldId: raw.fieldId || raw.id || fieldId,
            jsonPath: raw.jsonPath || raw.modelPath || "",
            description: raw.description || "",
            type: raw.type || raw.format || "string",
          },
          concurrency: response.concurrency,
        };
      }
      return { data: null, concurrency: response.concurrency };
    });
  }

  /**
   * Get a single loan by GUID — returns the full loan object with ALL fields.
   * Endpoint: GET /v1/loans/{loanGuid}
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
          `/v1/loans/${normalizedGuid}`,
          { headers: { Authorization: accessToken } },
        );
      },
    );
  }

  /**
   * Get loans using v1 pipeline endpoint (POST with JSON body containing filter, fields, sortOrder)
   * Response structure: { root: [{ loanGuid, fields: [{ fieldId, value }] }] }
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

    // Build query parameters
    const params: any = {
      cursorType: "randomAccess", // Required for v1 pipeline
    };
    if (options.limit) {
      params.limit = options.limit;
    }

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

    // Add modifiedFrom filter if provided
    if (options.modifiedFrom) {
      filterTerms.push({
        canonicalName: "Loan.LastModified",
        value: options.modifiedFrom.toISOString(),
        matchType: "greaterThanOrEquals",
        precision: "exact",
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

    // Build JSON body structure for v1 pipeline
    // NOTE: Qlik defaults to includeArchivedLoans: true (matching Encompass API default behavior)
    const body: any = {
      fields: fieldGuids, // Array of field GUIDs as strings
      sortOrder: [
        {
          canonicalName: "Loan.LastModified",
          order: "desc",
        },
      ],
      includeArchivedLoans: true, // Match Qlik's default (configurable in Qlik, defaults to true)
    };

    // Add filter if we have any filter terms
    if (filterTerms.length > 0) {
      body.filter = {
        operator: "and",
        terms: filterTerms,
      };
    }

    // Convert body to JSON string
    const bodyJson = JSON.stringify(body);

    // Log concise sync summary
    console.log(
      `[Sync] Pipeline request: ${fieldGuids.length} fields, modifiedFrom=${options.modifiedFrom?.toISOString() || "none"}, folders=${folderNames?.length || 0}, startDate=${loanStartDate.toISOString().split("T")[0]}`,
    );

    // NOTE: v1 pipeline endpoint does NOT use instanceId in query params
    // The instanceId is only used for token generation, not for pipeline calls
    // This matches the Qlik script which has no instanceId in the pipeline URL

    // Pagination: Fetch all pages using cursor and start parameter (like Qlik script)
    const allLoans: EncompassLoan[] = [];
    const uniqueLoanGuids = new Set<string>(); // Track unique GUIDs to detect when we've fetched all loans
    let cursor: string | undefined = undefined;
    let totalCount: number | undefined = undefined;
    let pageNumber = 0;
    let start = 0; // Start offset for pagination (increments by maxLoansPerRequest)
    const maxLoansPerRequest = 1000; // Always use 1000 as page size (API limit)
    const totalLimit = options.limit; // Total number of loans to fetch (if specified)

    const needsPagination = !totalLimit || totalLimit > maxLoansPerRequest;

    do {
      pageNumber++;
      const pageParams: any = {
        limit: needsPagination ? maxLoansPerRequest : totalLimit,
      };

      // Only request a cursor when we expect to paginate (limit > single page).
      // Unnecessary cursors accumulate server-side and cause 409 Conflict errors.
      if (cursor) {
        pageParams.cursor = cursor;
        if (totalCount === undefined || start < totalCount) {
          pageParams.start = start;
        } else {
          break;
        }
      } else if (needsPagination) {
        pageParams.cursorType = "randomAccess";
      }

      // Build request body - filter should only be included on first page
      // Subsequent pages only need fields, sortOrder, and includeArchivedLoans (no filter)
      let pageBodyJson: string;
      if (cursor) {
        // Subsequent pages: no filter, just fields and sortOrder
        const pageBody: any = {
          fields: fieldGuids,
          sortOrder: [
            {
              canonicalName: "Loan.LastModified",
              order: "desc",
            },
          ],
          includeArchivedLoans: true, // Match Qlik's default
        };
        pageBodyJson = JSON.stringify(pageBody);
      } else {
        // First page: include filter
        pageBodyJson = bodyJson;
      }

      const response = await this.executeWithTokenRetry<{
        root: Array<{
          loanGuid: string;
          fields: Array<{ [key: string]: any }>;
        }>;
      }>(tenantId, losConnectionId, async (accessToken) => {
        // Use the connection-specific API client with the correct base URL
        const response = await apiClientForConnection.post<{
          root: Array<{
            loanGuid: string;
            fields: Array<{ [key: string]: any }>;
          }>;
        }>("/v1/loanPipeline", pageBodyJson, {
          headers: {
            Authorization: accessToken,
            "Content-Type": "text/plain", // v1 pipeline expects text/plain with JSON string body
          },
          params: pageParams, // Contains limit, cursorType, and cursor (if present)
        });

        // Check for x-total-count header (case-insensitive)
        const totalCountHeader =
          response.headers["x-total-count"] ||
          response.headers["X-Total-Count"] ||
          response.headers["X-TOTAL-COUNT"];
        const cursorHeader =
          response.headers["x-cursor"] ||
          response.headers["X-Cursor"] ||
          response.headers["X-CURSOR"];

        // Get total count from first page (only expected with cursor-based queries)
        if (pageNumber === 1 && totalCountHeader) {
          totalCount = parseInt(totalCountHeader, 10);
          if (isNaN(totalCount)) {
            console.warn(
              `[Sync] Invalid x-total-count header: "${totalCountHeader}"`,
            );
          }
        } else if (pageNumber === 1 && needsPagination) {
          console.warn(`[Sync] x-total-count header not found in response`);
        }

        // Get cursor for next page (case-insensitive)
        cursor = cursorHeader as string | undefined;

        return response;
      });

      // Transform this page's loans
      const pageLoans = this.transformPipelineResponse(response);

      // Track unique GUIDs from this page
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

      // Stop pagination if:
      // 1. No cursor (API indicates no more pages)
      // 2. OR we got 0 loans (empty page)
      // 3. OR we've fetched all unique loans (uniqueLoanGuids.size >= totalCount)
      // 4. OR we got 0 new unique GUIDs (stuck in a loop - same loans repeating)
      // 5. OR we've reached the requested limit (totalLimit)
      const hasFetchedAll =
        totalCount !== undefined && uniqueLoanGuids.size >= totalCount;
      const hasReachedLimit =
        totalLimit !== undefined && uniqueLoanGuids.size >= totalLimit;
      const isStuck =
        cursor &&
        pageLoans.length > 0 &&
        newUniqueGuids === 0 &&
        uniqueLoanGuids.size < (totalCount || Infinity);
      const shouldContinue =
        cursor &&
        pageLoans.length > 0 &&
        !hasFetchedAll &&
        !hasReachedLimit &&
        !isStuck;

      // Increment start for next page ONLY if we're going to continue
      // Use the number of unique loans fetched so far as the start position
      // This ensures we don't exceed totalCount
      if (shouldContinue && cursor) {
        start = uniqueLoanGuids.size; // Use unique count as start position
        // But also ensure we don't exceed totalCount
        if (totalCount !== undefined && start >= totalCount) {
          console.log(
            `[EncompassApiService] Start position (${start}) would exceed totalCount (${totalCount}), stopping pagination`,
          );
          break;
        }
      }

      if (!shouldContinue) {
        break;
      }
    } while (cursor);

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

    return {
      data: uniqueLoans,
      concurrency: undefined, // Concurrency info not available from paginated responses
    };
  }

  /**
   * Get company users from Encompass v1 API
   * Endpoint: GET /encompass/v1/company/users
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

    return this.executeWithTokenRetry<EncompassUserFromApi[]>(
      tenantId,
      losConnectionId,
      async (accessToken) => {
        return await this.apiClient.get<EncompassUserFromApi[]>(
          "/v1/company/users",
          {
            headers: { Authorization: accessToken },
            params: { limit },
          },
        );
      },
    ).then((response) => {
      // Filter to enabled users only if requested
      let users = response.data;
      if (enabledOnly) {
        users = users.filter((user) =>
          user.userIndicators?.includes("Enabled"),
        );
      }

      // Map to standard format
      const mappedUsers = users.map(mapEncompassUser);

      console.log(
        `[EncompassApiService] Fetched ${response.data.length} users, ${mappedUsers.length} after filtering`,
      );

      return {
        data: mappedUsers,
        concurrency: response.concurrency,
      };
    });
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
          // Fields can be in format { fieldId: "value" } or { "Fields.123": "value" }
          Object.assign(loan, field);
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
