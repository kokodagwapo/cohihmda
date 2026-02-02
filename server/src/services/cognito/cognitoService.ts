/**
 * Cognito Service
 * Handles AWS Cognito integration for SSO authentication
 */

import { CognitoJwtVerifier } from "aws-jwt-verify";
import { logError, logInfo, logDebug } from "../logger.js";

// Cognito configuration from environment - read lazily to ensure dotenv has loaded
// These are functions to avoid reading env vars at module load time (ES modules import before dotenv runs)
const getCognitoUserPoolId = () => process.env.COGNITO_USER_POOL_ID || "";
const getCognitoClientId = () => process.env.COGNITO_CLIENT_ID || "";
const getCognitoRegion = () => process.env.COGNITO_REGION || "us-east-2";
const getCognitoDomain = () => process.env.COGNITO_DOMAIN || "";
const getCognitoClientSecret = () => process.env.COGNITO_CLIENT_SECRET || "";

// Token types
export interface CognitoIdToken {
  sub: string;
  email: string;
  email_verified: boolean;
  "cognito:username": string;
  "cognito:groups"?: string[];
  "custom:tenant_id"?: string;
  "custom:role"?: string;
  "custom:encompass_user_id"?: string;
  given_name?: string;
  family_name?: string;
  name?: string;
  identities?: Array<{
    userId: string;
    providerName: string;
    providerType: string;
  }>;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export interface CognitoAccessToken {
  sub: string;
  "cognito:groups"?: string[];
  token_use: "access";
  scope: string;
  auth_time: number;
  iat: number;
  exp: number;
  iss: string;
  client_id: string;
  username: string;
}

export interface CognitoTokens {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export interface CognitoUserInfo {
  sub: string;
  email: string;
  emailVerified: boolean;
  username: string;
  groups: string[];
  tenantId?: string;
  role?: string;
  encompassUserId?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  idpName?: string;
  idpUserId?: string;
}

// Lazy-loaded verifiers
let idTokenVerifier: any = null;
let accessTokenVerifier: any = null;

/**
 * Get or create ID token verifier
 */
function getIdTokenVerifier() {
  const userPoolId = getCognitoUserPoolId();
  const clientId = getCognitoClientId();
  
  if (!idTokenVerifier && userPoolId && clientId) {
    idTokenVerifier = CognitoJwtVerifier.create({
      userPoolId,
      tokenUse: "id",
      clientId,
    });
  }
  return idTokenVerifier;
}

/**
 * Get or create access token verifier
 */
function getAccessTokenVerifier() {
  const userPoolId = getCognitoUserPoolId();
  const clientId = getCognitoClientId();
  
  if (!accessTokenVerifier && userPoolId && clientId) {
    accessTokenVerifier = CognitoJwtVerifier.create({
      userPoolId,
      tokenUse: "access",
      clientId,
    });
  }
  return accessTokenVerifier;
}

/**
 * Verify and decode a Cognito ID token
 */
export async function verifyIdToken(token: string): Promise<CognitoIdToken> {
  const verifier = getIdTokenVerifier();
  if (!verifier) {
    throw new Error(
      "Cognito not configured - missing COGNITO_USER_POOL_ID or COGNITO_CLIENT_ID",
    );
  }

  try {
    const payload = await verifier.verify(token);
    logDebug("[Cognito] ID token verified", {
      sub: payload.sub,
      email: payload.email,
    });
    return payload as CognitoIdToken;
  } catch (error: any) {
    logError("[Cognito] ID token verification failed", error, {});
    throw new Error(`Invalid ID token: ${error.message}`);
  }
}

/**
 * Verify and decode a Cognito access token
 */
export async function verifyAccessToken(
  token: string,
): Promise<CognitoAccessToken> {
  const verifier = getAccessTokenVerifier();
  if (!verifier) {
    throw new Error(
      "Cognito not configured - missing COGNITO_USER_POOL_ID or COGNITO_CLIENT_ID",
    );
  }

  try {
    const payload = await verifier.verify(token);
    logDebug("[Cognito] Access token verified", {
      sub: payload.sub,
      username: payload.username,
    });
    return payload as CognitoAccessToken;
  } catch (error: any) {
    logError("[Cognito] Access token verification failed", error, {});
    throw new Error(`Invalid access token: ${error.message}`);
  }
}

/**
 * Extract user info from ID token
 */
export function extractUserInfo(idToken: CognitoIdToken): CognitoUserInfo {
  const identity = idToken.identities?.[0];

  return {
    sub: idToken.sub,
    email: idToken.email,
    emailVerified: idToken.email_verified,
    username: idToken["cognito:username"],
    groups: idToken["cognito:groups"] || [],
    tenantId: idToken["custom:tenant_id"],
    role: idToken["custom:role"],
    encompassUserId: idToken["custom:encompass_user_id"],
    firstName: idToken.given_name,
    lastName: idToken.family_name,
    fullName:
      idToken.name ||
      (idToken.given_name && idToken.family_name
        ? `${idToken.given_name} ${idToken.family_name}`
        : undefined),
    idpName: identity?.providerName,
    idpUserId: identity?.userId,
  };
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<CognitoTokens> {
  const domain = getCognitoDomain();
  const clientId = getCognitoClientId();
  
  if (!domain || !clientId) {
    throw new Error(
      "Cognito not configured - missing COGNITO_DOMAIN or COGNITO_CLIENT_ID",
    );
  }

  const clientSecret = getCognitoClientSecret();
  const tokenEndpoint = `https://${domain}/oauth2/token`;

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
  });

  // Add client secret if configured
  if (clientSecret) {
    params.append("client_secret", clientSecret);
  }

  try {
    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logError("[Cognito] Token exchange failed", new Error(errorBody), {
        status: response.status,
      });
      throw new Error(`Token exchange failed: ${response.status}`);
    }

    const tokens = (await response.json()) as CognitoTokens;
    logInfo("[Cognito] Token exchange successful");
    return tokens;
  } catch (error: any) {
    logError("[Cognito] Token exchange error", error, {});
    throw error;
  }
}

/**
 * Build Cognito authorization URL
 */
export function buildAuthorizationUrl(
  redirectUri: string,
  state: string,
  identityProvider?: string,
): string {
  const domain = getCognitoDomain();
  const clientId = getCognitoClientId();
  
  if (!domain || !clientId) {
    throw new Error(
      "Cognito not configured - missing COGNITO_DOMAIN or COGNITO_CLIENT_ID",
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: redirectUri,
    state,
  });

  // Add identity provider hint if specified (for direct IdP login)
  if (identityProvider) {
    params.append("identity_provider", identityProvider);
  }

  return `https://${domain}/oauth2/authorize?${params.toString()}`;
}

/**
 * Build Cognito logout URL
 */
export function buildLogoutUrl(redirectUri: string): string {
  const domain = getCognitoDomain();
  const clientId = getCognitoClientId();
  
  if (!domain || !clientId) {
    throw new Error(
      "Cognito not configured - missing COGNITO_DOMAIN or COGNITO_CLIENT_ID",
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    logout_uri: redirectUri,
  });

  return `https://${domain}/logout?${params.toString()}`;
}

/**
 * Refresh tokens using refresh token
 */
export async function refreshTokens(
  refreshToken: string,
): Promise<CognitoTokens> {
  const domain = getCognitoDomain();
  const clientId = getCognitoClientId();
  
  if (!domain || !clientId) {
    throw new Error(
      "Cognito not configured - missing COGNITO_DOMAIN or COGNITO_CLIENT_ID",
    );
  }

  const clientSecret = getCognitoClientSecret();
  const tokenEndpoint = `https://${domain}/oauth2/token`;

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: refreshToken,
  });

  if (clientSecret) {
    params.append("client_secret", clientSecret);
  }

  try {
    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logError("[Cognito] Token refresh failed", new Error(errorBody), {
        status: response.status,
      });
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const tokens = (await response.json()) as CognitoTokens;
    logInfo("[Cognito] Token refresh successful");
    return tokens;
  } catch (error: any) {
    logError("[Cognito] Token refresh error", error, {});
    throw error;
  }
}

/**
 * Check if Cognito is configured
 */
export function isCognitoConfigured(): boolean {
  const userPoolId = getCognitoUserPoolId();
  const clientId = getCognitoClientId();
  const domain = getCognitoDomain();
  return !!(userPoolId && clientId && domain);
}

/**
 * Get Cognito configuration (safe to expose)
 */
export function getCognitoConfig() {
  return {
    userPoolId: getCognitoUserPoolId(),
    clientId: getCognitoClientId(),
    region: getCognitoRegion(),
    domain: getCognitoDomain(),
    isConfigured: isCognitoConfigured(),
  };
}
