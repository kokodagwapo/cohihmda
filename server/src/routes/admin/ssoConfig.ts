/**
 * SSO Configuration API
 * Allows tenant admins to self-configure their SSO settings
 * 
 * Flow:
 * 1. Tenant admin uploads IdP metadata (URL or XML)
 * 2. System parses metadata and extracts configuration
 * 3. System creates/updates Cognito federated IdP
 * 4. System stores configuration in tenant_identity_providers table
 * 5. System updates Cognito app client to allow the new IdP
 */

import { Router, Request, Response } from "express";
import crypto from "crypto";
import pg from "pg";
import {
  CognitoIdentityProviderClient,
  CreateIdentityProviderCommand,
  UpdateIdentityProviderCommand,
  DeleteIdentityProviderCommand,
  DescribeIdentityProviderCommand,
  UpdateUserPoolClientCommand,
  DescribeUserPoolClientCommand,
  ListIdentityProvidersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { pool as managementPool } from "../../config/managementDatabase.js";
import { tenantDbManager } from "../../config/tenantDatabaseManager.js";
import { authenticateToken, AuthRequest } from "../../middleware/auth.js";
import { logInfo, logError, logWarn } from "../../services/logger.js";
import { XMLParser } from "fast-xml-parser";
import https from "https";

// Helper to get management pool
function getManagementPool(): pg.Pool {
  if (!managementPool) {
    throw new Error("Management database pool not initialized");
  }
  return managementPool;
}

const router = Router();

// Cognito configuration — read lazily via functions to ensure dotenv has loaded
// (ES modules import before dotenv runs, so top-level const reads would get empty strings)
const getCognitoRegion = () => process.env.COGNITO_REGION || "us-east-2";
const getCognitoUserPoolId = () => process.env.COGNITO_USER_POOL_ID || "";
const getCognitoClientId = () => process.env.COGNITO_CLIENT_ID || "";

// Cognito client — initialized lazily
let _cognitoClient: CognitoIdentityProviderClient | null = null;
function getCognitoClient(): CognitoIdentityProviderClient {
  if (!_cognitoClient) {
    _cognitoClient = new CognitoIdentityProviderClient({
      region: getCognitoRegion(),
    });
  }
  return _cognitoClient;
}

// Supported provider types
type ProviderType = "saml" | "oidc" | "azure_ad" | "cyberark" | "okta" | "google";

interface SSOConfigInput {
  provider_type: ProviderType;
  email_domains: string[];
  
  // SAML configuration
  metadata_url?: string;
  metadata_xml?: string;
  
  // OIDC configuration  
  oidc_client_id?: string;
  oidc_client_secret?: string;
  oidc_issuer_url?: string;
  oidc_scopes?: string[];
  
  // Attribute mapping
  attribute_mapping?: {
    email?: string;
    first_name?: string;
    last_name?: string;
    full_name?: string;
  };
  
  is_enabled?: boolean;
}

interface ParsedSAMLMetadata {
  entityId: string;
  ssoUrl: string;
  sloUrl?: string;
  certificate: string;
}

/**
 * Fetch and parse SAML metadata from URL
 * Security: Only HTTPS URLs are allowed to prevent MITM attacks
 */
async function fetchMetadataFromUrl(url: string): Promise<string> {
  // Enforce HTTPS to prevent MITM attacks on metadata
  if (!url.startsWith("https://")) {
    throw new Error("Metadata URL must use HTTPS");
  }

  // Basic SSRF protection: block private/internal IP ranges
  const urlObj = new URL(url);
  const hostname = urlObj.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("172.") ||
    hostname === "169.254.169.254" || // AWS metadata endpoint
    hostname.endsWith(".internal")
  ) {
    throw new Error("Metadata URL must point to a public endpoint");
  }

  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Metadata fetch failed with status ${res.statusCode}`));
        return;
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Metadata fetch timed out (10s)"));
    });
  });
}

/**
 * Parse SAML metadata XML to extract configuration
 */
function parseSAMLMetadata(xml: string): ParsedSAMLMetadata {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
  });
  
  const parsed = parser.parse(xml);
  
  // Navigate the SAML metadata structure
  const entityDescriptor = parsed.EntityDescriptor || parsed["md:EntityDescriptor"];
  if (!entityDescriptor) {
    throw new Error("Invalid SAML metadata: EntityDescriptor not found");
  }
  
  const entityId = entityDescriptor["@_entityID"];
  
  // Find IDPSSODescriptor
  const idpDescriptor = entityDescriptor.IDPSSODescriptor || 
                         entityDescriptor["md:IDPSSODescriptor"];
  if (!idpDescriptor) {
    throw new Error("Invalid SAML metadata: IDPSSODescriptor not found");
  }
  
  // Extract SSO URL (HTTP-Redirect or HTTP-POST binding)
  let ssoUrl = "";
  const ssoServices = Array.isArray(idpDescriptor.SingleSignOnService) 
    ? idpDescriptor.SingleSignOnService 
    : [idpDescriptor.SingleSignOnService];
    
  for (const svc of ssoServices) {
    if (svc && svc["@_Binding"]?.includes("HTTP-Redirect")) {
      ssoUrl = svc["@_Location"];
      break;
    }
    if (svc && svc["@_Binding"]?.includes("HTTP-POST") && !ssoUrl) {
      ssoUrl = svc["@_Location"];
    }
  }
  
  // Extract SLO URL (optional)
  let sloUrl = "";
  const sloServices = idpDescriptor.SingleLogoutService;
  if (sloServices) {
    const sloArray = Array.isArray(sloServices) ? sloServices : [sloServices];
    for (const svc of sloArray) {
      if (svc && svc["@_Binding"]?.includes("HTTP-Redirect")) {
        sloUrl = svc["@_Location"];
        break;
      }
    }
  }
  
  // Extract certificate
  let certificate = "";
  const keyDescriptor = idpDescriptor.KeyDescriptor;
  if (keyDescriptor) {
    const keyArray = Array.isArray(keyDescriptor) ? keyDescriptor : [keyDescriptor];
    for (const key of keyArray) {
      if (key["@_use"] === "signing" || !key["@_use"]) {
        const keyInfo = key.KeyInfo || key["ds:KeyInfo"];
        const x509Data = keyInfo?.X509Data || keyInfo?.["ds:X509Data"];
        const cert = x509Data?.X509Certificate || x509Data?.["ds:X509Certificate"];
        if (cert) {
          certificate = typeof cert === "string" ? cert : cert["#text"] || "";
          break;
        }
      }
    }
  }
  
  if (!entityId || !ssoUrl || !certificate) {
    throw new Error("Invalid SAML metadata: missing required fields (entityId, ssoUrl, or certificate)");
  }
  
  return { entityId, ssoUrl, sloUrl, certificate };
}

/**
 * Generate a Cognito-safe IdP name from tenant info
 * Format: {slug}-{type}-{hash} to avoid collisions between similar slugs
 * 
 * Cognito IdP name constraints (regex: [^_\p{Z}][\p{L}\p{M}\p{S}\p{N}\p{P}][^_\p{Z}]+):
 *   - 3-32 characters
 *   - Cannot start or end with underscore or whitespace
 *   - No underscores allowed in positions 3+
 *   - Use dashes as separators instead
 */
function generateCognitoIdpName(tenantSlug: string, providerType: string): string {
  const sanitized = tenantSlug.replace(/[^a-zA-Z0-9]/g, "");
  const suffix = providerType === "oidc" ? "OIDC" : "SAML";
  const hash = crypto.createHash("md5").update(tenantSlug).digest("hex").substring(0, 4);
  // Reserve space for the suffix and hash so the name doesn't end with a dangling hyphen
  // Format: {slug}-{SAML|OIDC}-{hash}  e.g. "acmecorp-SAML-a1b2" (max 32 chars)
  const reservedLen = suffix.length + hash.length + 2; // 2 hyphens
  const slug = sanitized.substring(0, 32 - reservedLen);
  return `${slug}-${suffix}-${hash}`;
}

/**
 * Create or update Cognito federated IdP
 */
async function createOrUpdateCognitoIdp(
  tenantSlug: string,
  providerType: ProviderType,
  config: {
    metadata?: ParsedSAMLMetadata;
    metadataUrl?: string;
    metadataXml?: string;
    oidcConfig?: {
      clientId: string;
      clientSecret: string;
      issuerUrl: string;
      scopes?: string[];
    };
    attributeMapping?: Record<string, string>;
  }
): Promise<string> {
  const idpName = generateCognitoIdpName(tenantSlug, providerType);
  
  // Check if IdP already exists
  let exists = false;
  try {
    await getCognitoClient().send(new DescribeIdentityProviderCommand({
      UserPoolId: getCognitoUserPoolId(),
      ProviderName: idpName,
    }));
    exists = true;
  } catch (err: any) {
    if (err.name !== "ResourceNotFoundException") {
      throw err;
    }
  }
  
  // Build provider details based on type
  let providerDetails: Record<string, string> = {};
  let cognitoProviderType: "SAML" | "OIDC" = "SAML";
  
  if (providerType === "oidc" || providerType === "google") {
    cognitoProviderType = "OIDC";
    if (!config.oidcConfig) {
      throw new Error("OIDC configuration required");
    }
    providerDetails = {
      client_id: config.oidcConfig.clientId,
      client_secret: config.oidcConfig.clientSecret,
      oidc_issuer: config.oidcConfig.issuerUrl,
      attributes_request_method: "GET",
      authorize_scopes: config.oidcConfig.scopes?.join(" ") || "openid email profile",
    };
  } else {
    // SAML-based (saml, azure_ad, cyberark, okta)
    cognitoProviderType = "SAML";
    if (!config.metadata) {
      throw new Error("SAML metadata required");
    }
    // Pass the ORIGINAL metadata to Cognito so it gets authentic certificates.
    // Prefer MetadataURL (Cognito auto-refreshes on cert rotation), fall back to
    // the original XML, and only reconstruct as a last resort.
    if (config.metadataUrl) {
      providerDetails = {
        MetadataURL: config.metadataUrl,
        IDPSignout: config.metadata.sloUrl ? "true" : "false",
      };
      logInfo("[SSOConfig] Using MetadataURL for Cognito IdP", { url: config.metadataUrl });
    } else if (config.metadataXml) {
      providerDetails = {
        MetadataFile: config.metadataXml,
        IDPSignout: config.metadata.sloUrl ? "true" : "false",
      };
      logInfo("[SSOConfig] Using original MetadataFile for Cognito IdP", { length: config.metadataXml.length });
    } else {
      logWarn("[SSOConfig] No original metadata available, reconstructing XML");
      const metadataXml = `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${config.metadata.entityId}">
  <IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <KeyDescriptor use="signing">
      <KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#">
        <X509Data>
          <X509Certificate>${config.metadata.certificate}</X509Certificate>
        </X509Data>
      </KeyInfo>
    </KeyDescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${config.metadata.ssoUrl}"/>
    ${config.metadata.sloUrl ? `<SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${config.metadata.sloUrl}"/>` : ""}
  </IDPSSODescriptor>
</EntityDescriptor>`;
      providerDetails = {
        MetadataFile: metadataXml,
        IDPSignout: config.metadata.sloUrl ? "true" : "false",
      };
    }
  }
  
  // Default attribute mapping
  const attributeMapping: Record<string, string> = {
    email: config.attributeMapping?.email || 
           (cognitoProviderType === "OIDC" ? "email" : "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"),
  };
  
  if (config.attributeMapping?.first_name) {
    attributeMapping.given_name = config.attributeMapping.first_name;
  }
  if (config.attributeMapping?.last_name) {
    attributeMapping.family_name = config.attributeMapping.last_name;
  }
  if (config.attributeMapping?.full_name) {
    attributeMapping.name = config.attributeMapping.full_name;
  }
  
  if (exists) {
    // Update existing IdP
    await getCognitoClient().send(new UpdateIdentityProviderCommand({
      UserPoolId: getCognitoUserPoolId(),
      ProviderName: idpName,
      ProviderDetails: providerDetails,
      AttributeMapping: attributeMapping,
    }));
    logInfo("[SSOConfig] Updated Cognito IdP", { idpName, providerType });
  } else {
    // Create new IdP
    await getCognitoClient().send(new CreateIdentityProviderCommand({
      UserPoolId: getCognitoUserPoolId(),
      ProviderName: idpName,
      ProviderType: cognitoProviderType,
      ProviderDetails: providerDetails,
      AttributeMapping: attributeMapping,
    }));
    logInfo("[SSOConfig] Created Cognito IdP", { idpName, providerType });
  }
  
  // Update app client to include this IdP
  await addIdpToAppClient(idpName);
  
  return idpName;
}

/**
 * Add IdP to Cognito app client's supported identity providers
 */
async function addIdpToAppClient(idpName: string): Promise<void> {
  // Get current app client config
  const clientResponse = await getCognitoClient().send(new DescribeUserPoolClientCommand({
    UserPoolId: getCognitoUserPoolId(),
    ClientId: getCognitoClientId(),
  }));
  
  const client = clientResponse.UserPoolClient;
  if (!client) {
    throw new Error("App client not found");
  }
  
  // Add new IdP if not already present
  const currentProviders = client.SupportedIdentityProviders || ["COGNITO"];
  if (!currentProviders.includes(idpName)) {
    currentProviders.push(idpName);
    
    await getCognitoClient().send(new UpdateUserPoolClientCommand({
      UserPoolId: getCognitoUserPoolId(),
      ClientId: getCognitoClientId(),
      SupportedIdentityProviders: currentProviders,
      // Preserve other settings
      CallbackURLs: client.CallbackURLs,
      LogoutURLs: client.LogoutURLs,
      DefaultRedirectURI: client.DefaultRedirectURI,
      AllowedOAuthFlows: client.AllowedOAuthFlows,
      AllowedOAuthScopes: client.AllowedOAuthScopes,
      AllowedOAuthFlowsUserPoolClient: client.AllowedOAuthFlowsUserPoolClient,
      ExplicitAuthFlows: client.ExplicitAuthFlows,
    }));
    
    logInfo("[SSOConfig] Added IdP to app client", { idpName, totalProviders: currentProviders.length });
  }
}

/**
 * Remove IdP from Cognito
 */
async function deleteCognitoIdp(idpName: string): Promise<void> {
  try {
    // Remove from app client first
    const clientResponse = await getCognitoClient().send(new DescribeUserPoolClientCommand({
      UserPoolId: getCognitoUserPoolId(),
      ClientId: getCognitoClientId(),
    }));
    
    const client = clientResponse.UserPoolClient;
    if (client) {
      const providers = (client.SupportedIdentityProviders || []).filter(p => p !== idpName);
      
      await getCognitoClient().send(new UpdateUserPoolClientCommand({
        UserPoolId: getCognitoUserPoolId(),
        ClientId: getCognitoClientId(),
        SupportedIdentityProviders: providers,
        CallbackURLs: client.CallbackURLs,
        LogoutURLs: client.LogoutURLs,
        DefaultRedirectURI: client.DefaultRedirectURI,
        AllowedOAuthFlows: client.AllowedOAuthFlows,
        AllowedOAuthScopes: client.AllowedOAuthScopes,
        AllowedOAuthFlowsUserPoolClient: client.AllowedOAuthFlowsUserPoolClient,
        ExplicitAuthFlows: client.ExplicitAuthFlows,
      }));
    }
    
    // Delete the IdP
    await getCognitoClient().send(new DeleteIdentityProviderCommand({
      UserPoolId: getCognitoUserPoolId(),
      ProviderName: idpName,
    }));
    
    logInfo("[SSOConfig] Deleted Cognito IdP", { idpName });
  } catch (err: any) {
    if (err.name !== "ResourceNotFoundException") {
      throw err;
    }
  }
}

// ============================================================================
// API Routes
// ============================================================================

/**
 * GET /api/admin/sso/config
 * Get SSO configuration for current tenant
 */
router.get("/config", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userRole = req.userRole || "";
    
    // Only super/platform admins can override tenant_id via query param
    // Tenant admins always use their own tenant from the JWT
    const tenantId = ["super_admin", "platform_admin"].includes(userRole)
      ? (req.query.tenant_id as string || req.tenantId)
      : req.tenantId;
    
    // Authorization: super_admin can view any tenant, tenant_admin can only view their own
    if (!["super_admin", "platform_admin"].includes(userRole)) {
      if (userRole !== "tenant_admin") {
        return res.status(403).json({ error: "Unauthorized to view this tenant's SSO config" });
      }
    }
    
    const mgmtPool = getManagementPool();
    
    // Get tenant info
    const tenantResult = await mgmtPool.query(
      `SELECT id, slug, name, auth_config FROM coheus_tenants WHERE id = $1`,
      [tenantId]
    );
    
    if (tenantResult.rows.length === 0) {
      return res.status(404).json({ error: "Tenant not found" });
    }
    
    const tenant = tenantResult.rows[0];
    
    // Get SSO configuration
    const configResult = await mgmtPool.query(
      `SELECT * FROM tenant_identity_providers WHERE tenant_id = $1 ORDER BY is_primary DESC`,
      [tenantId]
    );
    
    // Generate SP information
    // When using Cognito as SAML broker, the SP values are Cognito's endpoints (same for all tenants)
    // The client's IdP (Entra, CyberArk, etc.) sends SAML assertions to Cognito, not to Cohi directly
    const cognitoDomain = process.env.COGNITO_DOMAIN || "";
    const cognitoUserPoolId = getCognitoUserPoolId();
    const spInfo = {
      entity_id: cognitoUserPoolId ? `urn:amazon:cognito:sp:${cognitoUserPoolId}` : "Not configured — Cognito User Pool ID required",
      acs_url: cognitoDomain ? `https://${cognitoDomain}/saml2/idpresponse` : "Not configured — Cognito Domain required",
      slo_url: cognitoDomain ? `https://${cognitoDomain}/saml2/logout` : "",
      note: "These values are the same for all tenants. Each tenant gets a unique IdP configuration within the shared Cognito User Pool.",
    };
    
    res.json({
      tenant_id: tenantId,
      tenant_slug: tenant.slug,
      tenant_name: tenant.name,
      auth_config: tenant.auth_config || { mode: "hybrid", allow_email_password: true },
      configurations: configResult.rows,
      sp_info: spInfo,
      cognito_configured: !!(getCognitoUserPoolId() && getCognitoClientId()),
    });
    
  } catch (error: any) {
    logError("[SSOConfig] Get config error", error, {});
    res.status(500).json({ error: "Failed to get SSO configuration" });
  }
});

/**
 * POST /api/admin/sso/config
 * Create or update SSO configuration for current tenant
 */
router.post("/config", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const input: SSOConfigInput = req.body;
    const userRole = req.userRole || "";
    
    logInfo("[SSOConfig] POST /config request received", { 
      providerType: input.provider_type,
      hasMetadataUrl: !!input.metadata_url,
      hasMetadataXml: !!input.metadata_xml,
      emailDomains: input.email_domains,
      userRole,
      userId: req.userId,
    });
    
    // Only super/platform admins can override tenant_id via query param
    const tenantId = ["super_admin", "platform_admin"].includes(userRole)
      ? (req.query.tenant_id as string || req.tenantId)
      : req.tenantId;
    
    // Authorization
    if (!["super_admin", "platform_admin"].includes(userRole)) {
      if (userRole !== "tenant_admin") {
        return res.status(403).json({ error: "Unauthorized to configure this tenant's SSO" });
      }
    }
    
    const mgmtPool = getManagementPool();
    
    // Get tenant info
    const tenantResult = await mgmtPool.query(
      `SELECT id, slug, name FROM coheus_tenants WHERE id = $1`,
      [tenantId]
    );
    
    if (tenantResult.rows.length === 0) {
      return res.status(404).json({ error: "Tenant not found" });
    }
    
    const tenant = tenantResult.rows[0];
    
    // Validate Cognito is configured before attempting IdP creation
    if (!getCognitoUserPoolId() || !getCognitoClientId()) {
      return res.status(503).json({ 
        error: "SSO is not available. Cognito User Pool is not configured.",
        details: "COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID environment variables must be set."
      });
    }
    
    // Validate email domains
    if (!input.email_domains || input.email_domains.length === 0) {
      return res.status(400).json({ error: "At least one email domain is required" });
    }
    
    // Check if any domain is already claimed by another tenant
    const domainCheck = await mgmtPool.query(
      `SELECT t.name, tip.email_domains 
       FROM tenant_identity_providers tip 
       JOIN coheus_tenants t ON t.id = tip.tenant_id
       WHERE tip.tenant_id != $1 
         AND tip.email_domains && $2::text[]`,
      [tenantId, input.email_domains]
    );
    
    if (domainCheck.rows.length > 0) {
      const claimed = domainCheck.rows[0];
      return res.status(400).json({ 
        error: `One or more email domains are already claimed by ${claimed.name}` 
      });
    }
    
    // Check for existing configuration for this tenant (any idp type — one config per tenant)
    const existingConfig = await mgmtPool.query(
      `SELECT id, cognito_idp_name, idp_type, config FROM tenant_identity_providers WHERE tenant_id = $1 ORDER BY is_primary DESC LIMIT 1`,
      [tenantId]
    );
    
    // Parse SAML metadata if provided
    let parsedMetadata: ParsedSAMLMetadata | undefined;
    let originalMetadataUrl: string | undefined;
    let originalMetadataXml: string | undefined;
    const isSamlType = input.provider_type !== "oidc" && input.provider_type !== "google";
    
    if (isSamlType) {
      if (input.metadata_url) {
        logInfo("[SSOConfig] Fetching metadata from URL", { url: input.metadata_url, tenantSlug: tenant.slug });
        try {
          originalMetadataUrl = input.metadata_url;
          const fetchedXml = await fetchMetadataFromUrl(input.metadata_url);
          originalMetadataXml = fetchedXml;
          logInfo("[SSOConfig] Metadata fetched successfully", { length: fetchedXml.length });
          parsedMetadata = parseSAMLMetadata(fetchedXml);
          logInfo("[SSOConfig] Metadata parsed", { entityId: parsedMetadata.entityId, ssoUrl: parsedMetadata.ssoUrl });
        } catch (fetchError: any) {
          logError("[SSOConfig] Metadata fetch/parse failed", fetchError, { url: input.metadata_url });
          return res.status(400).json({ 
            error: "Failed to fetch or parse SAML metadata",
            details: fetchError.message 
          });
        }
      } else if (input.metadata_xml) {
        try {
          originalMetadataXml = input.metadata_xml;
          parsedMetadata = parseSAMLMetadata(input.metadata_xml);
          logInfo("[SSOConfig] Metadata XML parsed", { entityId: parsedMetadata.entityId, ssoUrl: parsedMetadata.ssoUrl });
        } catch (parseError: any) {
          logError("[SSOConfig] Metadata XML parse failed", parseError, {});
          return res.status(400).json({ 
            error: "Failed to parse SAML metadata XML",
            details: parseError.message 
          });
        }
      } else if (existingConfig.rows.length === 0) {
        // Only require metadata for NEW configurations — existing ones can update without it
        return res.status(400).json({ error: "SAML metadata (URL or XML) is required for initial setup" });
      } else {
        logInfo("[SSOConfig] No new metadata provided — updating config without changing Cognito IdP", { tenantSlug: tenant.slug });
      }
    }
    
    // Create/update Cognito IdP (only if we have new metadata or OIDC config)
    let cognitoIdpName: string;
    
    if (parsedMetadata || (input.oidc_client_id && !isSamlType)) {
      // New metadata provided — create or update the Cognito IdP
      try {
        cognitoIdpName = await createOrUpdateCognitoIdp(tenant.slug, input.provider_type, {
          metadata: parsedMetadata,
          metadataUrl: originalMetadataUrl,
          metadataXml: originalMetadataXml,
          oidcConfig: input.oidc_client_id ? {
            clientId: input.oidc_client_id,
            clientSecret: input.oidc_client_secret || "",
            issuerUrl: input.oidc_issuer_url || "",
            scopes: input.oidc_scopes,
          } : undefined,
          attributeMapping: input.attribute_mapping,
        });
      } catch (cognitoError: any) {
        logError("[SSOConfig] Cognito IdP creation failed", cognitoError, { tenantSlug: tenant.slug });
        return res.status(500).json({ 
          error: "Failed to configure identity provider in Cognito",
          details: cognitoError.message 
        });
      }
    } else if (existingConfig.rows.length > 0 && existingConfig.rows[0].cognito_idp_name) {
      // No new metadata — reuse existing Cognito IdP name
      cognitoIdpName = existingConfig.rows[0].cognito_idp_name;
      logInfo("[SSOConfig] Reusing existing Cognito IdP", { cognitoIdpName });
    } else {
      return res.status(400).json({ error: "SAML metadata or OIDC configuration is required" });
    }
    
    // Build provider display name
    const providerNames: Record<string, string> = {
      saml: "SAML IdP",
      azure_ad: "Microsoft Entra ID",
      cyberark: "CyberArk Identity",
      okta: "Okta",
      oidc: "OIDC Provider",
      google: "Google Workspace",
    };
    const providerDisplayName = providerNames[input.provider_type] || input.provider_type;
    
    // Build config data — preserve existing IdP details if no new metadata was provided
    const existingConfigData = existingConfig.rows.length > 0 
      ? (typeof existingConfig.rows[0].config === 'string' 
          ? JSON.parse(existingConfig.rows[0].config) 
          : existingConfig.rows[0].config || {})
      : {};
    
    const configData = {
      idp_entity_id: parsedMetadata?.entityId || existingConfigData.idp_entity_id,
      idp_sso_url: parsedMetadata?.ssoUrl || existingConfigData.idp_sso_url,
      idp_slo_url: parsedMetadata?.sloUrl || existingConfigData.idp_slo_url,
      idp_certificate: parsedMetadata?.certificate ? "present" : existingConfigData.idp_certificate,
      oidc_client_id: input.oidc_client_id || existingConfigData.oidc_client_id,
      oidc_issuer_url: input.oidc_issuer_url || existingConfigData.oidc_issuer_url,
      attribute_mapping: input.attribute_mapping,
    };
    
    logInfo("[SSOConfig] Saving config to database", { 
      tenantSlug: tenant.slug, 
      providerType: input.provider_type,
      cognitoIdpName,
      isUpdate: existingConfig.rows.length > 0,
      emailDomains: input.email_domains,
    });
    
    let configId: string;
    
    if (existingConfig.rows.length > 0) {
      // Update existing
      const updateResult = await mgmtPool.query(
        `UPDATE tenant_identity_providers 
         SET cognito_idp_name = $1,
             email_domains = $2,
             idp_type = $3,
             config = $4,
             is_enabled = $5,
             provider_name = $6,
             updated_at = NOW()
         WHERE id = $7
         RETURNING id`,
        [
          cognitoIdpName,
          input.email_domains,
          input.provider_type,
          JSON.stringify(configData),
          input.is_enabled ?? true,
          providerDisplayName,
          existingConfig.rows[0].id
        ]
      );
      configId = updateResult.rows[0].id;
      logInfo("[SSOConfig] Updated SSO configuration", { tenantSlug: tenant.slug, configId });
    } else {
      // Insert new — always enabled on creation so SSO works immediately after setup
      const insertResult = await mgmtPool.query(
        `INSERT INTO tenant_identity_providers 
         (tenant_id, provider_type, provider_name, idp_type, cognito_idp_name, email_domains, config, is_enabled, is_primary, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, true, $8)
         RETURNING id`,
        [
          tenantId,
          "cognito_federated",
          providerDisplayName,
          input.provider_type,
          cognitoIdpName,
          input.email_domains,
          JSON.stringify(configData),
          req.userId
        ]
      );
      configId = insertResult.rows[0].id;
      logInfo("[SSOConfig] Created SSO configuration", { tenantSlug: tenant.slug, configId });
    }
    
    res.json({
      success: true,
      config_id: configId,
      cognito_idp_name: cognitoIdpName,
      message: "SSO configuration saved successfully. Users with the specified email domains can now sign in via SSO."
    });
    
  } catch (error: any) {
    logError("[SSOConfig] Save config error", error, { 
      message: error.message,
      code: error.code,
      stack: error.stack?.substring(0, 500),
    });
    console.error("[SSOConfig] Full error:", error);
    res.status(500).json({ error: error.message || "Failed to save SSO configuration" });
  }
});

/**
 * DELETE /api/admin/sso/config/:configId
 * Delete SSO configuration
 */
router.delete("/config/:configId", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { configId } = req.params;
    const userRole = req.userRole || "";
    
    const mgmtPool = getManagementPool();
    
    // Get the config
    const configResult = await mgmtPool.query(
      `SELECT tip.*, t.slug as tenant_slug
       FROM tenant_identity_providers tip
       JOIN coheus_tenants t ON t.id = tip.tenant_id
       WHERE tip.id = $1`,
      [configId]
    );
    
    if (configResult.rows.length === 0) {
      return res.status(404).json({ error: "Configuration not found" });
    }
    
    const config = configResult.rows[0];
    
    // Authorization
    if (!["super_admin", "platform_admin"].includes(userRole)) {
      if (userRole !== "tenant_admin" || req.tenantId !== config.tenant_id) {
        return res.status(403).json({ error: "Unauthorized to delete this SSO configuration" });
      }
    }
    
    // Delete from Cognito
    if (config.cognito_idp_name) {
      await deleteCognitoIdp(config.cognito_idp_name);
    }
    
    // Delete from database
    await mgmtPool.query(
      `DELETE FROM tenant_identity_providers WHERE id = $1`,
      [configId]
    );
    
    logInfo("[SSOConfig] Deleted SSO configuration", { configId, tenantSlug: config.tenant_slug });
    
    res.json({ success: true, message: "SSO configuration deleted" });
    
  } catch (error: any) {
    logError("[SSOConfig] Delete config error", error, {});
    res.status(500).json({ error: "Failed to delete SSO configuration" });
  }
});

/**
 * POST /api/admin/sso/test
 * Test SSO configuration (initiate test login)
 */
router.post("/test", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { config_id } = req.body;
    const userRole = req.userRole || "";
    
    const mgmtPool = getManagementPool();
    
    // Get the config
    const configResult = await mgmtPool.query(
      `SELECT tip.*, t.slug as tenant_slug
       FROM tenant_identity_providers tip
       JOIN coheus_tenants t ON t.id = tip.tenant_id
       WHERE tip.id = $1`,
      [config_id]
    );
    
    if (configResult.rows.length === 0) {
      return res.status(404).json({ error: "Configuration not found" });
    }
    
    const config = configResult.rows[0];
    
    // Authorization
    if (!["super_admin", "platform_admin"].includes(userRole)) {
      if (userRole !== "tenant_admin" || req.tenantId !== config.tenant_id) {
        return res.status(403).json({ error: "Unauthorized" });
      }
    }
    
    // Generate test URL
    const cognitoDomain = process.env.COGNITO_DOMAIN || "";
    const frontendUrl = process.env.FRONTEND_URL?.split(",")[0] || "https://cohi.coheus1.com";
    const callbackUrl = `${frontendUrl}/auth/sso/callback`;
    
    const testUrl = `https://${cognitoDomain}/oauth2/authorize?` +
      `identity_provider=${encodeURIComponent(config.cognito_idp_name)}` +
      `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
      `&response_type=code` +
      `&client_id=${getCognitoClientId()}` +
      `&scope=email+openid+profile` +
      `&state=sso_test_${config_id}`;
    
    res.json({
      test_url: testUrl,
      instructions: "Open this URL in a new browser window to test the SSO connection. After successful authentication, you'll be redirected back to Cohi."
    });
    
  } catch (error: any) {
    logError("[SSOConfig] Test error", error, {});
    res.status(500).json({ error: "Failed to generate test URL" });
  }
});

/**
 * GET /api/admin/sso/history
 * Get SSO login history for tenant
 */
router.get("/history", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userRole = req.userRole || "";
    const limit = parseInt(req.query.limit as string) || 50;
    
    // Only super/platform admins can override tenant_id via query param
    const tenantId = ["super_admin", "platform_admin"].includes(userRole)
      ? (req.query.tenant_id as string || req.tenantId)
      : req.tenantId;
    
    // Authorization
    if (!["super_admin", "platform_admin"].includes(userRole)) {
      if (userRole !== "tenant_admin") {
        return res.status(403).json({ error: "Unauthorized" });
      }
    }
    
    // SSO login history is stored in each tenant's database in sso_login_history table
    // (written by cognitoAuth.ts on each SSO login)
    try {
      const tenantPool = await tenantDbManager.getTenantPool(tenantId);
      const result = await tenantPool.query(
        `SELECT id, user_email, user_name, provider, cognito_idp_name, status, error_message, created_at
         FROM sso_login_history
         ORDER BY created_at DESC 
         LIMIT $1`,
        [limit]
      );
      res.json({ history: result.rows });
    } catch (dbError: any) {
      // Table may not exist yet if no SSO logins have occurred, or tenant DB not available
      if (dbError.message?.includes("does not exist") || dbError.code === "42P01") {
        logInfo("[SSOConfig] SSO history table not found — no SSO logins recorded yet", { tenantId });
        res.json({ history: [] });
      } else {
        throw dbError;
      }
    }
    
  } catch (error: any) {
    logError("[SSOConfig] Get history error", error, {});
    res.status(500).json({ error: "Failed to get SSO history" });
  }
});

/**
 * PUT /api/admin/sso/auth-mode
 * Update tenant authentication mode (hybrid, sso_only, password_only)
 */
router.put("/auth-mode", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { mode, allow_email_password } = req.body;
    const userRole = req.userRole || "";
    
    // Validate mode
    if (!["hybrid", "sso_only", "password_only"].includes(mode)) {
      return res.status(400).json({ error: "Invalid auth mode" });
    }
    
    // Only super/platform admins can override tenant_id via query param
    const tenantId = ["super_admin", "platform_admin"].includes(userRole)
      ? (req.query.tenant_id as string || req.tenantId)
      : req.tenantId;
    
    // Authorization
    if (!["super_admin", "platform_admin"].includes(userRole)) {
      if (userRole !== "tenant_admin") {
        return res.status(403).json({ error: "Unauthorized" });
      }
    }
    
    const mgmtPool = getManagementPool();
    
    await mgmtPool.query(
      `UPDATE coheus_tenants 
       SET auth_config = jsonb_build_object('mode', $1, 'allow_email_password', $2)
       WHERE id = $3`,
      [mode, allow_email_password ?? (mode !== "sso_only"), tenantId]
    );
    
    // Keep the provider's is_enabled in sync with the toggle:
    // enabling SSO (hybrid/sso_only) enables the provider; disabling (password_only) disables it
    const providerEnabled = mode !== "password_only";
    await mgmtPool.query(
      `UPDATE tenant_identity_providers SET is_enabled = $1, updated_at = NOW() WHERE tenant_id = $2`,
      [providerEnabled, tenantId]
    );
    
    logInfo("[SSOConfig] Updated auth mode", { tenantId, mode, providerEnabled });
    
    res.json({ success: true, message: `Authentication mode set to ${mode}` });
    
  } catch (error: any) {
    logError("[SSOConfig] Update auth mode error", error, {});
    res.status(500).json({ error: "Failed to update authentication mode" });
  }
});

export default router;
