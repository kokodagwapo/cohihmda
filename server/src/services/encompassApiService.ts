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

    console.log(
      `[EncompassApiService] Initialized with API server: ${baseApiServer}`,
    );
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
          console.log(
            `[EncompassApiService] Using cached token for ${cacheKey}, expires in ${Math.round(
              (cachedToken.expires_at - now) / 1000,
            )}s`,
          );
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
      console.log(
        `[EncompassApiService] Cached token for ${cacheKey}, expires in ${expiresInSeconds}s`,
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
      console.log(
        `[EncompassApiService] Invalidated cached token for ${cacheKey}`,
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

    // Log to console
    console.log(
      `[ENCOMPASS_CONCURRENCY] lender=${losConnectionId || "unknown"} ` +
        `limit=${limit} remaining=${remaining} utilized=${utilized} ` +
        `utilization=${(utilizationRatio * 100).toFixed(1)}% ` +
        `threshold=${(this.MAX_CONCURRENCY_RATIO * 100).toFixed(1)}% ` +
        `exceeded=${metrics.exceeded_threshold}`,
    );

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
    console.log(
      `[EncompassApiService] getEncompassAccessToken called with forceRefresh=${forceRefresh}`,
    );

    const clientDetails = await getEncompassCredentials(
      tenantId,
      losConnectionId,
    );

    console.log(`[EncompassApiService] Client details:`, {
      instanceId: clientDetails.InstanceId,
      extractionMethod: clientDetails.ExtractionMethod,
      apiServer: clientDetails.ApiServer,
      hasApiClientId: !!clientDetails.ApiClientId,
      hasClientSecret: !!clientDetails.ClientSecret,
    });

    // Check cache first unless force refresh
    if (!forceRefresh) {
      const cachedToken = await this.getCachedToken(clientDetails);
      if (cachedToken) {
        console.log(`[EncompassApiService] Using cached token`);
        return cachedToken;
      }
      console.log(
        `[EncompassApiService] No valid cached token, fetching new token`,
      );
    } else {
      console.log(
        `[EncompassApiService] Skipping cache due to forceRefresh=true`,
      );
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

    console.log(`[EncompassApiService] Using token URL: ${tokenUrl}`);
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

      console.log("[EncompassApiService] ROPC/API credentials check:", {
        instanceId: InstanceId,
        saUsername: SAUsername ? `${SAUsername.substring(0, 3)}***` : "MISSING",
        effectiveSAUsername: effectiveSAUsername
          ? `${effectiveSAUsername.substring(0, 10)}***`
          : "MISSING",
        hasPassword: !!SAPassword,
        hasApiClientId: !!ApiClientId,
        hasClientSecret: !!ClientSecret,
      });

      const params = new URLSearchParams();
      params.append("grant_type", "password");
      params.append("username", effectiveSAUsername);
      params.append("password", SAPassword);
      params.append("client_id", ApiClientId);
      if (ClientSecret) params.append("client_secret", ClientSecret);

      const requestHeaders = {
        "Content-Type": "application/x-www-form-urlencoded",
      };
      console.log("[EncompassApiService] Fetching new ROPC/API Flow token");

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

    try {
      console.log(`[EncompassApiService] Executing API operation with token`);
      const response = await operation(accessToken);

      console.log(
        `[EncompassApiService] API operation successful, checking concurrency...`,
      );

      // Check concurrency headers and throttle if needed
      const concurrency = await this.checkConcurrencyAndThrottle(
        response,
        losConnectionId,
      );

      if (concurrency) {
        console.log(`[EncompassApiService] Concurrency metrics:`, {
          limit: concurrency.limit,
          remaining: concurrency.remaining,
          utilized: concurrency.utilized,
          utilization_ratio: concurrency.utilization_ratio,
          exceeded_threshold: concurrency.exceeded_threshold,
        });
      } else {
        console.log(`[EncompassApiService] No concurrency headers in response`);
      }

      return {
        data: response.data,
        concurrency: concurrency || undefined,
      };
    } catch (error: any) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        console.log(
          `[EncompassApiService] Received 401, invalidating token and retrying with fresh token`,
        );
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

        try {
          const retryResponse = await operation(accessToken);

          // Check concurrency on retry as well
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
    console.log(
      `[EncompassApiService] Fetching loans for connection: ${losConnectionId} using v1 pipeline`,
    );

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

    console.log(
      `[EncompassApiService] Using API server: ${apiServer} for pipeline call`,
    );

    // Build query parameters
    const params: any = {
      cursorType: "randomAccess", // Required for v1 pipeline
    };
    if (options.limit) {
      params.limit = options.limit;
      console.log(
        `[EncompassApiService] Using provided limit: ${options.limit}`,
      );
    } else {
      // No default limit - fetch all loans matching the criteria
      // The date filters (loanStartDate = 36 months ago) control the scope
      console.log(
        `[EncompassApiService] No limit provided - will fetch all matching loans`,
      );
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

    // Log the request body for debugging (detailed comparison with Qlik)
    console.log(`[EncompassApiService] ========== FILTER DEBUG ==========`);
    console.log(
      `[EncompassApiService] Request body (full):`,
      JSON.stringify(body, null, 2),
    );
    console.log(`[EncompassApiService] Request params:`, params);
    console.log(
      `[EncompassApiService] Filter terms count: ${filterTerms.length}`,
    );
    filterTerms.forEach((term, idx) => {
      console.log(
        `[EncompassApiService] Filter term ${idx + 1}:`,
        JSON.stringify(term, null, 2),
      );
    });
    console.log(`[EncompassApiService] Options summary:`, {
      modifiedFrom: options.modifiedFrom?.toISOString() || "none",
      loanStartDate: loanStartDate.toISOString(),
      loanStartDateField: loanStartDateField,
      folderName: options.folderName, // Deprecated
      folderNames: options.folderNames || [],
      fieldsCount: fieldGuids.length,
      dateRangeMonths: Math.round(
        (Date.now() - loanStartDate.getTime()) / (1000 * 60 * 60 * 24 * 30),
      ),
    });
    console.log(`[EncompassApiService] =================================`);

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

    do {
      pageNumber++;
      const pageParams: any = {
        limit: maxLoansPerRequest, // Always use 1000 as page size
      };

      // For first page, use cursorType. For subsequent pages, use both cursor AND start
      // Only add start if it's less than totalCount (to avoid API error)
      if (cursor) {
        pageParams.cursor = cursor;
        // Only add start parameter if it's less than totalCount
        if (totalCount === undefined || start < totalCount) {
          pageParams.start = start;
        } else {
          // If start exceeds totalCount, don't make the request
          console.log(
            `[EncompassApiService] Page ${pageNumber} - Start (${start}) exceeds totalCount (${totalCount}), stopping pagination`,
          );
          break;
        }
      } else {
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

        // Log response for debugging
        console.log(
          `[EncompassApiService] Page ${pageNumber} - Response status: ${response.status}`,
        );

        // Check for x-total-count header (case-insensitive)
        const totalCountHeader =
          response.headers["x-total-count"] ||
          response.headers["X-Total-Count"] ||
          response.headers["X-TOTAL-COUNT"];
        const cursorHeader =
          response.headers["x-cursor"] ||
          response.headers["X-Cursor"] ||
          response.headers["X-CURSOR"];

        console.log(
          `[EncompassApiService] Page ${pageNumber} - Response headers:`,
          {
            "x-total-count": totalCountHeader || "NOT FOUND",
            "x-cursor": cursorHeader || "NOT FOUND",
            "all-headers": Object.keys(response.headers).filter(
              (k) =>
                k.toLowerCase().includes("total") ||
                k.toLowerCase().includes("cursor"),
            ),
          },
        );

        // Get total count from first page
        if (pageNumber === 1 && totalCountHeader) {
          totalCount = parseInt(totalCountHeader, 10);
          if (!isNaN(totalCount)) {
            console.log(
              `[EncompassApiService] ✅ Total loans available (x-total-count): ${totalCount}`,
            );
          } else {
            console.warn(
              `[EncompassApiService] ⚠️ x-total-count header found but not a valid number: "${totalCountHeader}"`,
            );
          }
        } else if (pageNumber === 1) {
          console.warn(
            `[EncompassApiService] ⚠️ x-total-count header NOT FOUND in first page response`,
          );
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

      // Log sample GUIDs from this page for debugging
      if (pageLoans.length > 0) {
        const sampleGuids = pageLoans.slice(0, 3).map((loan) => {
          const guid =
            loan["Fields.GUID"] || loan["GUID"] || loan.loanGuid || loan.guid;
          return guid || "NO_GUID";
        });
        console.log(
          `[EncompassApiService] Page ${pageNumber} - Sample GUIDs:`,
          sampleGuids,
        );
      }

      const beforePushLength = allLoans.length;
      allLoans.push(...pageLoans);
      const afterPushLength = allLoans.length;

      console.log(
        `[EncompassApiService] Page ${pageNumber} - Fetched ${pageLoans.length} loans (${newUniqueGuids} new unique), pushed to array (${beforePushLength} -> ${afterPushLength}), unique GUIDs: ${uniqueLoanGuids.size}${totalCount ? ` / ${totalCount}` : ""}`,
      );

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

      console.log(
        `[EncompassApiService] Page ${pageNumber} - Cursor: ${cursor || "NONE"}, Start: ${start}, Loans this page: ${pageLoans.length}, Unique GUIDs: ${uniqueLoanGuids.size}${totalCount ? ` / ${totalCount}` : ""}, Will continue: ${shouldContinue}${isStuck ? " (STUCK - no new GUIDs)" : ""}`,
      );

      if (!shouldContinue) {
        const reason = !cursor
          ? "no cursor"
          : pageLoans.length === 0
            ? "empty page"
            : hasReachedLimit
              ? `reached limit (${totalLimit})`
              : hasFetchedAll
                ? "fetched all unique loans"
                : isStuck
                  ? "stuck - no new unique GUIDs"
                  : "unknown";
        console.log(
          `[EncompassApiService] Stopping pagination - Reason: ${reason}, total fetched: ${allLoans.length}, unique GUIDs: ${uniqueLoanGuids.size}${totalCount ? ` (expected: ${totalCount})` : ""}${totalLimit ? ` (limit: ${totalLimit})` : ""}`,
        );
        break;
      }
    } while (cursor);

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

    // Apply limit if specified (slice to exact limit after deduplication)
    if (totalLimit !== undefined && uniqueLoans.length > totalLimit) {
      console.log(
        `[EncompassApiService] Limiting results from ${uniqueLoans.length} to ${totalLimit} loans`,
      );
      uniqueLoans = uniqueLoans.slice(0, totalLimit);
    }

    // Log duplicate analysis
    const duplicates = Array.from(guidCounts.entries()).filter(
      ([_, count]) => count > 1,
    );
    if (duplicates.length > 0) {
      console.warn(
        `[EncompassApiService] Found ${duplicates.length} duplicate GUIDs (appearing ${duplicates.map(([guid, count]) => `${count}x`).join(", ")})`,
      );
      console.warn(
        `[EncompassApiService] Sample duplicate GUIDs:`,
        duplicates.slice(0, 5).map(([guid]) => guid),
      );
    }

    console.log(
      `[EncompassApiService] Completed pagination - Total loans fetched: ${allLoans.length}, Unique loans: ${uniqueLoans.length}${totalCount ? ` (expected: ${totalCount})` : ""}${totalLimit ? ` (limit: ${totalLimit})` : ""}`,
    );

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
