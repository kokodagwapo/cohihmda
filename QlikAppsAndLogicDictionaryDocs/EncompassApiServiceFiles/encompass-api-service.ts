import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  GetCommandInput,
  PutCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";

// --- Interfaces moved/adapted from get-encompass-fields.ts ---
interface EncompassClientDetails {
  InstanceId: string;
  ApiClientId?: string;
  ClientSecret?: string;
  SAUsername?: string;
  SAPassword?: string;
  ExtractionMethod?: string;
}

export interface EncompassField {
  // Exporting for use in handler
  fieldID: string;
  description: string;
  fieldType: number;
  format?: string;
}

export interface EncompassCustomFieldFromApi {
  // Exporting for use in handler
  Id: string;
  Audit?: { Data?: string };
}

interface EncompassTokenResponse {
  token_type: string;
  access_token: string;
  expires_in?: number;
}

interface CachedToken {
  Token: string;
  ExpiresAt: number;
}

// --- End of moved interfaces ---

// This should match the interface in the handler or a shared types file
interface EncompassLoanFolderDTO {
  folderName: string;
  folderType?: string; // As per old .NET model
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

// Interface based on frontend/src/types/index.ts and old CoheusSetupToolMvc.Models.EncompassModels.User
// Also needs to align with the actual API response from /v1/company/users
export interface EncompassUser {
  userId: string; // Maps from 'id' in Encompass API response? Check API docs.
  userName: string; // Maps from 'userName'
  firstName?: string; // Maps from 'firstName'
  lastName?: string; // Maps from 'lastName'
  email?: string; // Maps from 'email'
  // Field used for filtering enabled users, based on old .NET code `UserIndicators.Contains("Enabled")`
  // Need to confirm the exact field name and structure from API docs. Assuming 'userIndicators' array for now.
  userIndicators?: string[];
}

// Interface for the raw user object from the Encompass API, before mapping
interface EncompassUserFromApi {
  id: string;
  userName: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  userIndicators?: string[]; // Assuming this structure
  // Add other fields from the API response if needed
}

export class EncompassApiService {
  private apiClient: AxiosInstance;
  private ddbDocClient: DynamoDBDocumentClient;
  private encompassApiBaseUrl: string;
  private DDB_TABLE_NAME_IMPLEMENTATIONS =
    process.env.IMPLEMENTATION_TABLE_NAME || "";
  private DDB_TABLE_NAME_TOKEN_CACHE =
    process.env.ENCOMPASS_TOKEN_CACHE_TABLE_NAME || "";
  private MAX_CONCURRENCY_RATIO = 0.2; // 20% threshold for ISV partners
  private CONCURRENCY_POLL_INTERVAL = 2000; // 2 seconds in milliseconds

  constructor() {
    this.encompassApiBaseUrl =
      process.env.ENCOMPASS_API_BASE_URL ||
      "https://api.elliemae.com/encompass";

    this.apiClient = axios.create({
      baseURL: this.encompassApiBaseUrl,
    });

    const endpointOverride: string | undefined = process.env.ENDPOINT_OVERRIDE;
    let ddbClient: DynamoDBClient;
    if (endpointOverride) {
      console.log(
        `[EncompassApiService] Using DynamoDB endpoint override: ${endpointOverride}`
      );
      ddbClient = new DynamoDBClient({
        endpoint: endpointOverride,
        region: "us-east-2", // Default local region
        credentials: {
          // Default local credentials
          accessKeyId: "LOCALDEVKEY123",
          secretAccessKey: "LOCALDEVSECRETABC",
        },
      });
    } else {
      ddbClient = new DynamoDBClient({});
    }
    this.ddbDocClient = DynamoDBDocumentClient.from(ddbClient);
  }

  private transformInstanceIdForUsername(instanceId: string): string {
    let s = instanceId.substring(1).replace(/^0+/, ""); // Substring(1) and TrimStart('0')
    if (s.length < 6) {
      s = s.padStart(6, "0");
    }
    return `BE${s}`;
  }

  private getCacheKey(clientDetails: EncompassClientDetails): string {
    // Use :: delimiter to match Qlik cache key format (changed from |)
    return `${clientDetails.InstanceId}::${clientDetails.ApiClientId || ""}::${
      clientDetails.SAUsername || ""
    }`;
  }

  private async getCachedToken(
    clientDetails: EncompassClientDetails
  ): Promise<string | null> {
    if (!this.DDB_TABLE_NAME_TOKEN_CACHE) {
      console.warn(
        "[EncompassApiService] Token cache table name not configured, skipping cache lookup"
      );
      return null;
    }

    const cacheKey = this.getCacheKey(clientDetails);
    try {
      const result = await this.ddbDocClient.send(
        new GetCommand({
          TableName: this.DDB_TABLE_NAME_TOKEN_CACHE,
          Key: { CacheKey: cacheKey },
        })
      );

      if (result.Item) {
        const cachedToken = result.Item as CachedToken;
        const now = Date.now();
        if (cachedToken.ExpiresAt > now) {
          console.log(
            `[EncompassApiService] Using cached token for ${cacheKey}, expires in ${
              Math.round((cachedToken.ExpiresAt - now) / 1000)
            }s`
          );
          return cachedToken.Token;
        } else {
          console.log(
            `[EncompassApiService] Cached token expired for ${cacheKey}`
          );
          await this.invalidateToken(clientDetails);
        }
      }
    } catch (error: any) {
      console.error(
        "[EncompassApiService] Error retrieving cached token:",
        error.message
      );
    }
    return null;
  }

  private async cacheToken(
    clientDetails: EncompassClientDetails,
    token: string,
    expiresInSeconds: number
  ): Promise<void> {
    if (!this.DDB_TABLE_NAME_TOKEN_CACHE) {
      console.warn(
        "[EncompassApiService] Token cache table name not configured, skipping cache storage"
      );
      return;
    }

    const cacheKey = this.getCacheKey(clientDetails);
    const now = Date.now();
    const expiresAt = now + expiresInSeconds * 1000 - 60000; // 60s safety buffer
    const ttl = Math.floor(expiresAt / 1000);

    try {
      await this.ddbDocClient.send(
        new PutCommand({
          TableName: this.DDB_TABLE_NAME_TOKEN_CACHE,
          Item: {
            CacheKey: cacheKey,
            Token: token,
            ExpiresAt: expiresAt,
            TTL: ttl,
          },
        })
      );
      console.log(
        `[EncompassApiService] Cached token for ${cacheKey}, expires in ${expiresInSeconds}s`
      );
    } catch (error: any) {
      console.error(
        "[EncompassApiService] Error caching token:",
        error.message
      );
    }
  }

  private async invalidateToken(
    clientDetails: EncompassClientDetails
  ): Promise<void> {
    if (!this.DDB_TABLE_NAME_TOKEN_CACHE) {
      return;
    }

    const cacheKey = this.getCacheKey(clientDetails);
    try {
      await this.ddbDocClient.send(
        new DeleteCommand({
          TableName: this.DDB_TABLE_NAME_TOKEN_CACHE,
          Key: { CacheKey: cacheKey },
        })
      );
      console.log(`[EncompassApiService] Invalidated cached token for ${cacheKey}`);
    } catch (error: any) {
      console.error(
        "[EncompassApiService] Error invalidating token:",
        error.message
      );
    }
  }

  private async logConcurrencyMetrics(
    metrics: ConcurrencyMetrics
  ): Promise<void> {
    if (!this.DDB_TABLE_NAME_TOKEN_CACHE) {
      return;
    }

    const timestamp = Date.now();
    const lenderId = metrics.lender_id || "SYSTEM";
    const ttl = Math.floor(timestamp / 1000) + 30 * 24 * 60 * 60; // 30 days TTL

    try {
      await this.ddbDocClient.send(
        new PutCommand({
          TableName: this.DDB_TABLE_NAME_TOKEN_CACHE,
          Item: {
            CacheKey: `CONCURRENCY#LENDER#${lenderId}#${timestamp}`,
            ...metrics,
            timestamp,
            TTL: ttl,
          },
        })
      );
    } catch (error: any) {
      console.error(
        "[EncompassApiService] Failed to log concurrency metrics:",
        error.message
      );
    }
  }

  private async checkConcurrencyAndThrottle(
    response: AxiosResponse,
    lenderId?: string
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
        `[EncompassApiService] Invalid concurrency headers: Limit=${limitStr}, Remaining=${remainingStr}`
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
      lender_id: lenderId,
    };

    // Log metrics to DynamoDB
    await this.logConcurrencyMetrics(metrics);

    // Log to CloudWatch
    console.log(
      `[ENCOMPASS_CONCURRENCY] lender=${lenderId || "unknown"} ` +
        `limit=${limit} remaining=${remaining} utilized=${utilized} ` +
        `utilization=${(utilizationRatio * 100).toFixed(1)}% ` +
        `threshold=${(this.MAX_CONCURRENCY_RATIO * 100).toFixed(1)}% ` +
        `exceeded=${metrics.exceeded_threshold}`
    );

    // Throttle if threshold exceeded
    if (metrics.exceeded_threshold) {
      const waitTime = this.CONCURRENCY_POLL_INTERVAL;
      console.warn(
        `[EncompassApiService] Concurrency utilization ${(
          utilizationRatio * 100
        ).toFixed(1)}% exceeds ISV partner threshold ${(
          this.MAX_CONCURRENCY_RATIO * 100
        ).toFixed(1)}%. Waiting ${waitTime}ms before next request...`
      );

      await new Promise((resolve) => setTimeout(resolve, waitTime));
      console.log(
        `[EncompassApiService] Resumed after ${waitTime}ms concurrency wait`
      );
    }

    return metrics;
  }

  private async getEncompassClientDetailsFromDb(
    losId: string
  ): Promise<EncompassClientDetails> {
    console.log(
      `[EncompassApiService] Fetching Encompass client details for LOS ID: ${losId} from table ${this.DDB_TABLE_NAME_IMPLEMENTATIONS}`
    );
    if (!this.DDB_TABLE_NAME_IMPLEMENTATIONS) {
      throw new Error(
        "IMPLEMENTATION_TABLE_NAME environment variable is not set."
      );
    }
    const params: GetCommandInput = {
      TableName: this.DDB_TABLE_NAME_IMPLEMENTATIONS,
      Key: { PartitionKey: "Implementation 1", RowKey: losId },
    };
    try {
      const data = await this.ddbDocClient.send(new GetCommand(params));
      if (!data.Item) {
        console.error(
          `[EncompassApiService] Encompass client details not found for LOS ID (RowKey): ${losId}. Full DDB response:`,
          data
        );
        throw new Error(
          `Encompass client details not found for LOS ID (RowKey): ${losId}`
        );
      }
      const item = data.Item;
      const clientDetails: EncompassClientDetails = {
        InstanceId: item.prod_inst_id || losId,
        ApiClientId: item.client_id,
        ClientSecret: item.oauth,
        SAUsername: item.sa_username_prod || item.prod_username,
        SAPassword: item.sa_password_prod || item.prod_password,
        ExtractionMethod: item.extraction_method,
      };
      console.log(
        "[EncompassApiService] Fetched client details:",
        JSON.stringify(clientDetails, null, 2)
      );
      return clientDetails;
    } catch (error) {
      console.error(
        "[EncompassApiService] Error fetching Encompass client details from DynamoDB:",
        error
      );
      throw error;
    }
  }

  private async getEncompassAccessToken(
    clientDetails: EncompassClientDetails,
    forceRefresh: boolean = false
  ): Promise<string> {
    console.log(`[EncompassApiService] getEncompassAccessToken called with forceRefresh=${forceRefresh}`);
    
    // Check cache first unless force refresh
    if (!forceRefresh) {
      const cachedToken = await this.getCachedToken(clientDetails);
      if (cachedToken) {
        return cachedToken;
      }
    } else {
      console.log(`[EncompassApiService] Skipping cache due to forceRefresh=true`);
    }

    const {
      InstanceId,
      ApiClientId,
      ClientSecret,
      SAUsername,
      SAPassword,
      ExtractionMethod,
    } = clientDetails;
    let effectiveSAUsername = SAUsername;
    const extractionMethodLower = ExtractionMethod?.toLowerCase();
    const tokenUrl = `https://api.elliemae.com/oauth2/v1/token`; // This is a fixed URL, not from this.encompassApiBaseUrl
    let instanceIdForToken = InstanceId;
    if (InstanceId && InstanceId.startsWith("30")) {
      instanceIdForToken = InstanceId.replace("30", "BE");
    }

    if (extractionMethodLower === "partner") {
      if (!ApiClientId || !ClientSecret)
        throw new Error("Partner flow requires ApiClientId and ClientSecret.");
      const requestBody = `grant_type=client_credentials&instance_id=${instanceIdForToken}&scope=lp`;
      const basicAuth = Buffer.from(`${ApiClientId}:${ClientSecret}`).toString(
        "base64"
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
          { headers: requestHeaders }
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
          error.response?.data || error.message
        );
        throw new Error(
          `Encompass partner token API error: ${error.response?.status} ${
            error.response?.data?.error_description || error.message
          }`
        );
      }
    } else if (
      extractionMethodLower === "ropc" ||
      extractionMethodLower === "api"
    ) {
      if (!ApiClientId || !SAUsername || !SAPassword)
        throw new Error(
          "ROPC/API flow requires ApiClientId, SAUsername, and SAPassword."
        );
      let effectiveSAUsername = SAUsername;
      if (InstanceId && !InstanceId.startsWith("TE")) {
        const transformedInstanceIdPart =
          this.transformInstanceIdForUsername(InstanceId);
        effectiveSAUsername = `${SAUsername}@encompass:${transformedInstanceIdPart}`; // Reverted to original logic
      } else if (InstanceId && InstanceId.startsWith("TE")) {
        effectiveSAUsername = `${SAUsername}@encompass:${InstanceId}`; // For test instances
      }

      const params = new URLSearchParams();
      params.append("grant_type", "password");
      params.append("username", effectiveSAUsername); // Use the potentially modified effectiveSAUsername
      params.append("password", SAPassword);
      params.append("client_id", ApiClientId);
      if (ClientSecret) params.append("client_secret", ClientSecret); // ClientSecret is optional for ROPC but might be needed by some setups

      const requestHeaders = {
        "Content-Type": "application/x-www-form-urlencoded",
      };
      console.log("[EncompassApiService] Fetching new ROPC/API Flow token");

      try {
        const response = await axios.post<EncompassTokenResponse>(
          tokenUrl,
          params.toString(), // Send as string
          { headers: requestHeaders }
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
          error.response?.data || error.message
        );
        throw new Error(
          `Encompass ROPC/API token API error: ${error.response?.status} ${
            error.response?.data?.error_description || error.message
          }`
        );
      }
    }
    throw new Error(
      `Unsupported Encompass auth method or missing credentials. Method: '${extractionMethodLower}'.`
    );
  }

  private async executeWithTokenRetry<T>(
    clientId: string,
    operation: (token: string) => Promise<AxiosResponse<T>>
  ): Promise<EncompassApiResponse<T>> {
    const clientDetails = await this.getEncompassClientDetailsFromDb(clientId);
    let accessToken = await this.getEncompassAccessToken(clientDetails);

    try {
      const response = await operation(accessToken);
      
      // Check concurrency headers and throttle if needed
      const concurrency = await this.checkConcurrencyAndThrottle(response, clientId);
      
      return {
        data: response.data,
        concurrency: concurrency || undefined,
      };
    } catch (error: any) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        console.log(
          `[EncompassApiService] Received 401, invalidating token and retrying with fresh token`
        );
        await this.invalidateToken(clientDetails);
        accessToken = await this.getEncompassAccessToken(clientDetails, true);
        
        try {
          const retryResponse = await operation(accessToken);
          
          // Check concurrency on retry as well
          const retryConcurrency = await this.checkConcurrencyAndThrottle(retryResponse, clientId);
          
          return {
            data: retryResponse.data,
            concurrency: retryConcurrency || undefined,
          };
        } catch (retryError: any) {
          console.error(
            `[EncompassApiService] Retry failed after token refresh:`,
            retryError.response?.data || retryError.message
          );
          throw retryError;
        }
      }
      throw error;
    }
  }

  public async getLoanFolders(
    clientId: string
  ): Promise<EncompassApiResponse<EncompassLoanFolder[]>> {
    console.log(
      `[EncompassApiService] Fetching loan folders for clientId: ${clientId}`
    );
    
    return this.executeWithTokenRetry<EncompassLoanFolderDTO[]>(clientId, async (accessToken) => {
      const requestConfig: AxiosRequestConfig = {
        headers: { Authorization: accessToken },
      };
      return await this.apiClient.get<EncompassLoanFolderDTO[]>(
        "/v3/loanFolders",
        requestConfig
      );
    }).then((response) => {
      const data = response.data;
      if (data && Array.isArray(data)) {
        return {
          data: data.map((folder) => ({
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

  public async getRdbFields(clientId: string): Promise<EncompassApiResponse<EncompassField[]>> {
    console.log(
      `[EncompassApiService] Fetching RDB fields for clientId: ${clientId}`
    );

    const clientDetails = await this.getEncompassClientDetailsFromDb(clientId);
    let instanceIdParam = clientDetails.InstanceId;
    if (instanceIdParam && instanceIdParam.startsWith("30")) {
      instanceIdParam = instanceIdParam.replace("30", "BE");
    }

    return this.executeWithTokenRetry<{ pipelineLoanReportFieldDefs: any[] }>(
      clientId,
      async (accessToken) => {
        const apiUrl = `/v1/loanPipeline/fieldDefinitions`; // Relative to baseURL
        return await this.apiClient.get<{
          pipelineLoanReportFieldDefs: any[];
        }>(apiUrl, {
          headers: { Authorization: accessToken },
          params: { instanceId: instanceIdParam },
        });
      }
    ).then((response) => {
      const data = response.data;
      if (data && data.pipelineLoanReportFieldDefs) {
        return {
          data: data.pipelineLoanReportFieldDefs
            .filter(
              (p: any) =>
                p.fieldID &&
                !p.fieldID.startsWith("97") &&
                !p.fieldID.startsWith("65")
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

  public async getCustomFields(
    clientId: string
  ): Promise<EncompassApiResponse<EncompassCustomFieldFromApi[]>> {
    console.log(
      `[EncompassApiService] Fetching Custom fields for clientId: ${clientId}`
    );

    const clientDetails = await this.getEncompassClientDetailsFromDb(clientId);
    let instanceIdParam = clientDetails.InstanceId;
    if (instanceIdParam && instanceIdParam.startsWith("30")) {
      instanceIdParam = instanceIdParam.replace("30", "BE");
    }

    return this.executeWithTokenRetry<any[]>(clientId, async (accessToken) => {
      const apiUrl = `/v1/settings/loan/customFields`; // Relative to baseURL
      return await this.apiClient.get<any[]>(apiUrl, {
        headers: { Authorization: accessToken },
        params: { instanceId: instanceIdParam },
      });
    }).then((response) => {
      return {
        data: response.data.map((cf: any) => ({
          Id: cf.id,
          Audit: cf.audit ? { Data: cf.audit.data } : undefined,
        })) || [],
        concurrency: response.concurrency,
      };
    });
  }

  public async getUsers(clientId: string): Promise<EncompassApiResponse<EncompassUser[]>> {
    console.log(
      `[EncompassApiService] Fetching users for clientId: ${clientId}`
    );

    return this.executeWithTokenRetry<EncompassUserFromApi[]>(
      clientId,
      async (accessToken) => {
        const requestConfig: AxiosRequestConfig = {
          headers: { Authorization: accessToken },
          params: { limit: 10000 }, // Fetch a large number as per old code
        };

        const apiUrl = `/v1/company/users`; // Relative to baseURL

        return await this.apiClient.get<EncompassUserFromApi[]>(
          apiUrl,
          requestConfig
        );
      }
    ).then((response) => {
      const data = response.data;
      if (data && Array.isArray(data)) {
        const enabledUsers = data.filter(
          (user) =>
            user.userIndicators && user.userIndicators.includes("Enabled")
        );

        return {
          data: enabledUsers.map((user) => ({
            userId: user.id, // Map 'id' from API to 'userId'
            userName: user.userName,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            // userIndicators are not part of the target EncompassUser interface for the frontend
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
}
