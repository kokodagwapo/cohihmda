/**
 * Cognito Auth Service
 * Wraps AWS Cognito Admin APIs for email/password authentication, MFA, and user management.
 * Separates concerns from the existing cognitoService.ts which handles SSO/OAuth flows.
 */

import {
  CognitoIdentityProviderClient,
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminSetUserPasswordCommand,
  AdminSetUserMFAPreferenceCommand,
  AdminGetUserCommand,
  AdminResetUserPasswordCommand,
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  ChangePasswordCommand,
  InitiateAuthCommand,
  DescribeUserPoolCommand,
  GetUserPoolMfaConfigCommand,
  type AuthenticationResultType,
  type ChallengeNameType,
} from "@aws-sdk/client-cognito-identity-provider";
import crypto from "crypto";
import { logError, logInfo, logDebug, logWarn } from "../logger.js";

const getCognitoUserPoolId = () => process.env.COGNITO_USER_POOL_ID || "";
const getCognitoClientId = () => process.env.COGNITO_CLIENT_ID || "";
const getCognitoClientSecret = () => process.env.COGNITO_CLIENT_SECRET || "";
const getCognitoRegion = () => process.env.COGNITO_REGION || "us-east-2";

let client: CognitoIdentityProviderClient | null = null;

function getClient(): CognitoIdentityProviderClient {
  if (!client) {
    client = new CognitoIdentityProviderClient({
      region: getCognitoRegion(),
    });
  }
  return client;
}

function computeSecretHash(username: string): string | undefined {
  const clientSecret = getCognitoClientSecret();
  if (!clientSecret) return undefined;

  return crypto
    .createHmac("sha256", clientSecret)
    .update(username + getCognitoClientId())
    .digest("base64");
}

/**
 * Whether Cognito should handle email/password authentication (signin, MFA, password reset).
 * Requires COGNITO_PASSWORD_AUTH=true in addition to the pool/client being configured.
 * This is separate from SSO which uses the OAuth flows in cognitoService.ts.
 */
export function isCognitoAuthEnabled(): boolean {
  return !!(
    getCognitoUserPoolId() &&
    getCognitoClientId() &&
    process.env.COGNITO_PASSWORD_AUTH === "true"
  );
}

function getEnabledMfasFromDescribeUserPool(userPool: unknown): string[] {
  if (!userPool || typeof userPool !== "object") return [];
  const poolObj = userPool as Record<string, unknown>;

  const directEnabled = poolObj.EnabledMfas;
  if (Array.isArray(directEnabled)) {
    return directEnabled.filter((v): v is string => typeof v === "string");
  }

  const mfaCfg = poolObj.UserPoolMfaConfiguration;
  if (mfaCfg && typeof mfaCfg === "object") {
    const nestedEnabled = (mfaCfg as Record<string, unknown>).EnabledMfas;
    if (Array.isArray(nestedEnabled)) {
      return nestedEnabled.filter((v): v is string => typeof v === "string");
    }
  }

  return [];
}

export async function assertMfaConfigurationReady(): Promise<void> {
  if (!isCognitoAuthEnabled()) return;

  let mfaConfiguration = "OFF";
  let hasTotp = false;
  let hasEmailOtp = false;
  let enabledMfas: string[] = [];

  // Preferred source: dedicated MFA config API (returns software/email MFA config directly).
  try {
    const mfaConfig = await getClient().send(
      new GetUserPoolMfaConfigCommand({
        UserPoolId: getCognitoUserPoolId(),
      }),
    );

    mfaConfiguration = mfaConfig.MfaConfiguration || "OFF";
    hasTotp = !!mfaConfig.SoftwareTokenMfaConfiguration?.Enabled;
    hasEmailOtp = !!(
      mfaConfig.EmailMfaConfiguration?.Message &&
      mfaConfig.EmailMfaConfiguration?.Subject
    );
    if (hasTotp) enabledMfas.push("SOFTWARE_TOKEN_MFA");
    if (hasEmailOtp) enabledMfas.push("EMAIL_OTP");
  } catch {
    // Backward compatibility fallback for older permissions/deployments.
    const response = await getClient().send(
      new DescribeUserPoolCommand({
        UserPoolId: getCognitoUserPoolId(),
      }),
    );
    const userPool = response.UserPool;
    mfaConfiguration = userPool?.MfaConfiguration || "OFF";
    enabledMfas = getEnabledMfasFromDescribeUserPool(userPool);
    hasTotp = enabledMfas.includes("SOFTWARE_TOKEN_MFA");
    hasEmailOtp = enabledMfas.includes("EMAIL_OTP");
  }

  if (mfaConfiguration === "OFF") {
    throw new Error(
      "Cognito MFA is OFF. Enable MFA (OPTIONAL/ON) and EMAIL_OTP + SOFTWARE_TOKEN_MFA factors.",
    );
  }

  if (!hasTotp || !hasEmailOtp) {
    throw new Error(
      `Cognito MFA factors are incomplete. Found: [${enabledMfas.join(", ")}]. Required: EMAIL_OTP and SOFTWARE_TOKEN_MFA.`,
    );
  }
}

// --- Result types ---

export interface CognitoSignInResult {
  authenticated: boolean;
  challengeName?: string;
  session?: string;
  cognitoSub?: string;
  accessToken?: string;
  idToken?: string;
  refreshToken?: string;
}

export type MfaMethod = "totp" | "email" | null;

export interface CognitoCreateUserResult {
  cognitoSub: string;
  username: string;
}

// --- Authentication ---

export async function signIn(
  email: string,
  password: string,
): Promise<CognitoSignInResult> {
  const authParams: Record<string, string> = {
    USERNAME: email,
    PASSWORD: password,
  };

  const secretHash = computeSecretHash(email);
  if (secretHash) authParams.SECRET_HASH = secretHash;

  try {
    const command = new AdminInitiateAuthCommand({
      UserPoolId: getCognitoUserPoolId(),
      ClientId: getCognitoClientId(),
      AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
      AuthParameters: authParams,
    });

    const response = await getClient().send(command);

    if (response.ChallengeName) {
      logDebug("[CognitoAuth] Auth challenge returned", {
        challenge: response.ChallengeName,
      });
      return {
        authenticated: false,
        challengeName: response.ChallengeName,
        session: response.Session,
      };
    }

    const result = response.AuthenticationResult!;
    const sub = extractSubFromIdToken(result.IdToken!);

    logInfo("[CognitoAuth] Sign in successful", { email });
    return {
      authenticated: true,
      cognitoSub: sub,
      accessToken: result.AccessToken,
      idToken: result.IdToken,
      refreshToken: result.RefreshToken,
    };
  } catch (error: any) {
    logError("[CognitoAuth] Sign in failed", error, { email });
    throw mapCognitoError(error);
  }
}

export async function respondToMfaChallenge(
  email: string,
  session: string,
  mfaCode: string,
  challengeName: "SOFTWARE_TOKEN_MFA" | "EMAIL_OTP" | "SMS_MFA" = "SOFTWARE_TOKEN_MFA",
): Promise<CognitoSignInResult> {
  const challengeResponses: Record<string, string> = { USERNAME: email };
  if (challengeName === "SOFTWARE_TOKEN_MFA") {
    challengeResponses.SOFTWARE_TOKEN_MFA_CODE = mfaCode;
  } else if (challengeName === "EMAIL_OTP") {
    challengeResponses.EMAIL_OTP_CODE = mfaCode;
  } else if (challengeName === "SMS_MFA") {
    challengeResponses.SMS_MFA_CODE = mfaCode;
  }

  const secretHash = computeSecretHash(email);
  if (secretHash) challengeResponses.SECRET_HASH = secretHash;

  try {
    const command = new AdminRespondToAuthChallengeCommand({
      UserPoolId: getCognitoUserPoolId(),
      ClientId: getCognitoClientId(),
      ChallengeName: challengeName,
      Session: session,
      ChallengeResponses: challengeResponses,
    });

    const response = await getClient().send(command);

    if (response.ChallengeName) {
      return {
        authenticated: false,
        challengeName: response.ChallengeName,
        session: response.Session,
      };
    }

    const result = response.AuthenticationResult!;
    const sub = extractSubFromIdToken(result.IdToken!);

    logInfo("[CognitoAuth] MFA challenge completed", { email });
    return {
      authenticated: true,
      cognitoSub: sub,
      accessToken: result.AccessToken,
      idToken: result.IdToken,
      refreshToken: result.RefreshToken,
    };
  } catch (error: any) {
    logError("[CognitoAuth] MFA challenge failed", error, { email });
    throw mapCognitoError(error);
  }
}

export async function respondToNewPasswordChallenge(
  email: string,
  session: string,
  newPassword: string,
): Promise<CognitoSignInResult> {
  const challengeResponses: Record<string, string> = {
    USERNAME: email,
    NEW_PASSWORD: newPassword,
  };

  const secretHash = computeSecretHash(email);
  if (secretHash) challengeResponses.SECRET_HASH = secretHash;

  try {
    const command = new AdminRespondToAuthChallengeCommand({
      UserPoolId: getCognitoUserPoolId(),
      ClientId: getCognitoClientId(),
      ChallengeName: "NEW_PASSWORD_REQUIRED",
      Session: session,
      ChallengeResponses: challengeResponses,
    });

    const response = await getClient().send(command);
    const result = response.AuthenticationResult!;
    const sub = extractSubFromIdToken(result.IdToken!);

    return {
      authenticated: true,
      cognitoSub: sub,
      accessToken: result.AccessToken,
      idToken: result.IdToken,
      refreshToken: result.RefreshToken,
    };
  } catch (error: any) {
    logError("[CognitoAuth] New password challenge failed", error, { email });
    throw mapCognitoError(error);
  }
}

// --- User Management ---

/**
 * Create a user in Cognito.
 * When sendInvite=true (default), Cognito emails the user a temporary password; password arg is ignored.
 * On first login, Cognito returns NEW_PASSWORD_REQUIRED challenge.
 * When sendInvite=false, password is required and set as permanent (no forced change, no email).
 */
export async function createUser(
  email: string,
  password?: string,
  fullName?: string,
  sendInvite: boolean = true,
): Promise<CognitoCreateUserResult> {
  try {
    if (!sendInvite && (password == null || password === "")) {
      throw new Error("Password is required when not sending an invite");
    }
    const userAttributes = [
      { Name: "email", Value: email },
      { Name: "email_verified", Value: "true" },
    ];
    if (fullName) {
      userAttributes.push({ Name: "name", Value: fullName });
    }

    const createCommand = new AdminCreateUserCommand({
      UserPoolId: getCognitoUserPoolId(),
      Username: email,
      UserAttributes: userAttributes,
      // When sending invite, Cognito emails a temp password.
      // When not sending invite, we suppress the email and set password manually below.
      ...(sendInvite
        ? { DesiredDeliveryMediums: ["EMAIL"] }
        : { MessageAction: "SUPPRESS" }),
    });

    const createResponse = await getClient().send(createCommand);
    const cognitoSub = createResponse.User!.Attributes!.find(
      (a) => a.Name === "sub",
    )!.Value!;

    if (!sendInvite && password) {
      const setPasswordCommand = new AdminSetUserPasswordCommand({
        UserPoolId: getCognitoUserPoolId(),
        Username: email,
        Password: password,
        Permanent: true,
      });
      await getClient().send(setPasswordCommand);
    }

    logInfo("[CognitoAuth] User created", {
      email,
      cognitoSub,
      invited: sendInvite,
    });
    return { cognitoSub, username: email };
  } catch (error: any) {
    logError("[CognitoAuth] Create user failed", error, { email });
    throw mapCognitoError(error);
  }
}

export async function deleteUser(username: string): Promise<void> {
  try {
    const command = new AdminDeleteUserCommand({
      UserPoolId: getCognitoUserPoolId(),
      Username: username,
    });
    await getClient().send(command);
    logInfo("[CognitoAuth] User deleted from Cognito", { username });
  } catch (error: any) {
    logError("[CognitoAuth] Delete user failed", error, { username });
    throw mapCognitoError(error);
  }
}

export async function getUser(
  username: string,
): Promise<{ mfaEnabled: boolean; cognitoSub: string; mfaMethod: MfaMethod | null }> {
  try {
    const command = new AdminGetUserCommand({
      UserPoolId: getCognitoUserPoolId(),
      Username: username,
    });
    const response = await getClient().send(command);

    const sub =
      response.UserAttributes?.find((a) => a.Name === "sub")?.Value || "";
    const mfaSettings = response.UserMFASettingList || [];
    const hasTotp = mfaSettings.includes("SOFTWARE_TOKEN_MFA");
    const hasEmailOtp = mfaSettings.includes("EMAIL_OTP");
    const mfaEnabled = hasTotp || hasEmailOtp;
    const preferred = response.PreferredMfaSetting || "";
    const mfaMethod: MfaMethod =
      preferred === "EMAIL_OTP"
        ? "email"
        : preferred === "SOFTWARE_TOKEN_MFA"
          ? "totp"
          : hasEmailOtp
            ? "email"
            : hasTotp
              ? "totp"
              : null;

    return { mfaEnabled, cognitoSub: sub, mfaMethod };
  } catch (error: any) {
    logError("[CognitoAuth] Get user failed", error, { username });
    throw mapCognitoError(error);
  }
}

// --- Password Reset ---

export async function forgotPassword(email: string): Promise<{ sent: boolean; reason?: string }> {
  try {
    const secretHash = computeSecretHash(email);

    const command = new ForgotPasswordCommand({
      ClientId: getCognitoClientId(),
      Username: email,
      ...(secretHash ? { SecretHash: secretHash } : {}),
    });
    await getClient().send(command);
    logInfo("[CognitoAuth] Password reset initiated", { email });
    return { sent: true };
  } catch (error: any) {
    logError("[CognitoAuth] ForgotPassword failed", error, {
      email,
      errorName: error.name,
      errorMessage: error.message,
    });

    if (error.name === "NotAuthorizedException") {
      return { sent: false, reason: "not_authorized" };
    }
    if (error.name === "UserNotFoundException") {
      return { sent: false, reason: "user_not_found" };
    }
    if (error.name === "LimitExceededException") {
      return { sent: false, reason: "rate_limited" };
    }
    if (error.name === "InvalidParameterException") {
      return { sent: false, reason: "invalid_user_state" };
    }
    return { sent: false, reason: "unknown" };
  }
}

export async function confirmForgotPassword(
  email: string,
  confirmationCode: string,
  newPassword: string,
): Promise<void> {
  try {
    const secretHash = computeSecretHash(email);

    const command = new ConfirmForgotPasswordCommand({
      ClientId: getCognitoClientId(),
      Username: email,
      ConfirmationCode: confirmationCode,
      Password: newPassword,
      ...(secretHash ? { SecretHash: secretHash } : {}),
    });
    await getClient().send(command);
    logInfo("[CognitoAuth] Password reset confirmed", { email });

    // ConfirmForgotPassword clears MFA preferences. Re-enable email MFA so
    // the user isn't blocked by the app's MFA enforcement check on next login.
    try {
      const userInfo = await getUser(email);
      if (!userInfo.mfaEnabled) {
        await enableEmailMfa(email);
        logInfo("[CognitoAuth] Re-enabled email MFA after password reset", { email });
      }
    } catch (mfaError: any) {
      logWarn("[CognitoAuth] Failed to restore MFA after password reset — user may need to re-enroll", {
        email,
        error: mfaError.message,
      });
    }
  } catch (error: any) {
    logError("[CognitoAuth] Confirm forgot password failed", error, { email });
    throw mapCognitoError(error);
  }
}

/**
 * Admin-initiated password reset. Tries AdminResetUserPasswordCommand first.
 * If that fails because Cognito doesn't recognise the user's email as a verified
 * recovery contact (happens for users created before AutoVerifiedAttributes was
 * configured), falls back to deleting and recreating the Cognito user which
 * sends a fresh invitation email and properly registers the verified contact.
 *
 * Returns `newCognitoSub` when the user was recreated so the caller can update
 * the tenant database.
 */
export async function adminResetUserPassword(
  email: string,
  fullName?: string,
): Promise<{ sent: boolean; reason?: string; newCognitoSub?: string }> {
  try {
    const command = new AdminResetUserPasswordCommand({
      UserPoolId: getCognitoUserPoolId(),
      Username: email,
    });
    await getClient().send(command);
    logInfo("[CognitoAuth] Admin-initiated password reset sent", { email });
    return { sent: true };
  } catch (error: any) {
    logError("[CognitoAuth] Admin password reset failed", error, {
      email,
      errorName: error.name,
      errorMessage: error.message,
    });

    if (error.name === "AccessDeniedException") {
      return { sent: false, reason: "access_denied" };
    }
    if (error.name === "LimitExceededException") {
      return { sent: false, reason: "rate_limited" };
    }

    const needsRecreate =
      (error.name === "InvalidParameterException" &&
        error.message?.includes("no registered/verified email")) ||
      (error.name === "NotAuthorizedException" &&
        error.message?.includes("password recovery mechanism"));

    if (needsRecreate) {
      logInfo("[CognitoAuth] Falling back to user recreate for password reset", { email });
      try {
        await deleteUser(email).catch(() => {});
        const result = await createUser(email, undefined, fullName, true);
        logInfo("[CognitoAuth] User recreated for password reset, invitation sent", {
          email,
          newCognitoSub: result.cognitoSub,
        });
        return { sent: true, newCognitoSub: result.cognitoSub };
      } catch (recreateError: any) {
        logError("[CognitoAuth] User recreate fallback failed", recreateError, { email });
        return { sent: false, reason: "recreate_failed" };
      }
    }

    if (error.name === "NotAuthorizedException") {
      return { sent: false, reason: "not_authorized" };
    }
    if (error.name === "UserNotFoundException") {
      return { sent: false, reason: "user_not_found" };
    }
    if (error.name === "InvalidParameterException") {
      return { sent: false, reason: "invalid_user_state" };
    }
    return { sent: false, reason: "unknown" };
  }
}

export async function adminSetUserPassword(
  email: string,
  password: string,
  permanent: boolean = true,
): Promise<void> {
  try {
    const command = new AdminSetUserPasswordCommand({
      UserPoolId: getCognitoUserPoolId(),
      Username: email,
      Password: password,
      Permanent: permanent,
    });
    await getClient().send(command);
    logInfo("[CognitoAuth] Admin set user password", { email, permanent });
  } catch (error: any) {
    logError("[CognitoAuth] Admin set user password failed", error, { email });
    throw mapCognitoError(error);
  }
}

export async function changePassword(
  accessToken: string,
  previousPassword: string,
  proposedPassword: string,
): Promise<void> {
  try {
    const command = new ChangePasswordCommand({
      AccessToken: accessToken,
      PreviousPassword: previousPassword,
      ProposedPassword: proposedPassword,
    });
    await getClient().send(command);
    logInfo("[CognitoAuth] Password changed");
  } catch (error: any) {
    logError("[CognitoAuth] Change password failed", error, {});
    throw mapCognitoError(error);
  }
}

// --- MFA ---

export async function setupMfa(
  accessToken: string,
): Promise<{ secretCode: string }> {
  try {
    const command = new AssociateSoftwareTokenCommand({
      AccessToken: accessToken,
    });
    const response = await getClient().send(command);
    logDebug("[CognitoAuth] MFA setup initiated");
    return { secretCode: response.SecretCode! };
  } catch (error: any) {
    logError("[CognitoAuth] MFA setup failed", error, {});
    throw mapCognitoError(error);
  }
}

export async function verifyMfaSetup(
  accessToken: string,
  userCode: string,
  friendlyDeviceName?: string,
): Promise<void> {
  try {
    const verifyCommand = new VerifySoftwareTokenCommand({
      AccessToken: accessToken,
      UserCode: userCode,
      FriendlyDeviceName: friendlyDeviceName || "Authenticator",
    });
    await getClient().send(verifyCommand);

    // Decode the access token to get the username for the admin command
    const payload = JSON.parse(
      Buffer.from(accessToken.split(".")[1], "base64").toString(),
    );
    const username = payload.username || payload.sub;

    const preferenceCommand = new AdminSetUserMFAPreferenceCommand({
      UserPoolId: getCognitoUserPoolId(),
      Username: username,
      SoftwareTokenMfaSettings: {
        Enabled: true,
        PreferredMfa: true,
      },
    });
    await getClient().send(preferenceCommand);

    logInfo("[CognitoAuth] MFA setup verified and enabled", { username });
  } catch (error: any) {
    logError("[CognitoAuth] MFA verify failed", error, {});
    throw mapCognitoError(error);
  }
}

export async function enableEmailMfa(username: string): Promise<void> {
  try {
    const command = new AdminSetUserMFAPreferenceCommand({
      UserPoolId: getCognitoUserPoolId(),
      Username: username,
      SoftwareTokenMfaSettings: {
        Enabled: false,
        PreferredMfa: false,
      },
      EmailMfaSettings: {
        Enabled: true,
        PreferredMfa: true,
      },
    });
    await getClient().send(command);
    logInfo("[CognitoAuth] Email MFA enabled", { username });
  } catch (error: unknown) {
    logError("[CognitoAuth] Enable email MFA failed", error, { username });
    throw mapCognitoError(error);
  }
}

function getUsernameFromAccessToken(accessToken: string): string {
  const payloadPart = accessToken.split(".")[1];
  if (!payloadPart) return "";

  const payload = JSON.parse(
    Buffer.from(payloadPart, "base64url").toString(),
  ) as { username?: string; sub?: string; [key: string]: unknown };

  const cognitoUsername = payload["cognito:username"];
  return (
    payload.username ||
    (typeof cognitoUsername === "string" ? cognitoUsername : "") ||
    payload.sub ||
    ""
  );
}

export async function enableEmailMfaWithAccessToken(accessToken: string): Promise<void> {
  const username = getUsernameFromAccessToken(accessToken);
  if (!username) {
    throw Object.assign(new Error("Unable to resolve user from access token"), {
      code: "AUTH_ERROR",
      statusCode: 400,
    });
  }
  await enableEmailMfa(username);
}

export async function setPreferredMfaMethod(
  username: string,
  method: "totp" | "email",
): Promise<void> {
  if (method === "email") {
    await enableEmailMfa(username);
    return;
  }

  const command = new AdminSetUserMFAPreferenceCommand({
    UserPoolId: getCognitoUserPoolId(),
    Username: username,
    SoftwareTokenMfaSettings: {
      Enabled: true,
      PreferredMfa: true,
    },
    EmailMfaSettings: {
      Enabled: false,
      PreferredMfa: false,
    },
  });
  await getClient().send(command);
  logInfo("[CognitoAuth] Preferred MFA set to TOTP", { username });
}

export async function disableMfa(username: string): Promise<void> {
  try {
    const command = new AdminSetUserMFAPreferenceCommand({
      UserPoolId: getCognitoUserPoolId(),
      Username: username,
      SoftwareTokenMfaSettings: {
        Enabled: false,
        PreferredMfa: false,
      },
      EmailMfaSettings: {
        Enabled: false,
        PreferredMfa: false,
      },
    });
    await getClient().send(command);
    logInfo("[CognitoAuth] MFA disabled", { username });
  } catch (error: any) {
    logError("[CognitoAuth] Disable MFA failed", error, { username });
    throw mapCognitoError(error);
  }
}

// --- Token Refresh ---

export async function refreshTokens(refreshToken: string): Promise<{
  accessToken: string;
  idToken: string;
  cognitoSub: string;
}> {
  try {
    const authParams: Record<string, string> = {
      REFRESH_TOKEN: refreshToken,
    };

    // For refresh, SECRET_HASH uses the sub or username stored in the refresh token
    // We can't compute it without knowing the username, so we skip it for refresh
    // unless we store the username alongside the refresh token
    const command = new InitiateAuthCommand({
      ClientId: getCognitoClientId(),
      AuthFlow: "REFRESH_TOKEN_AUTH",
      AuthParameters: authParams,
    });

    const response = await getClient().send(command);
    const result = response.AuthenticationResult!;
    const sub = extractSubFromIdToken(result.IdToken!);

    logDebug("[CognitoAuth] Token refresh successful");
    return {
      accessToken: result.AccessToken!,
      idToken: result.IdToken!,
      cognitoSub: sub,
    };
  } catch (error: any) {
    logError("[CognitoAuth] Token refresh failed", error, {});
    throw mapCognitoError(error);
  }
}

// --- Helpers ---

function extractSubFromIdToken(idToken: string): string {
  try {
    const payload = JSON.parse(
      Buffer.from(idToken.split(".")[1], "base64").toString(),
    );
    return payload.sub;
  } catch {
    return "";
  }
}

function mapCognitoError(error: any): Error {
  const name = error.name || error.__type || "";

  switch (name) {
    case "NotAuthorizedException":
      return Object.assign(new Error("Invalid email or password"), {
        code: "INVALID_CREDENTIALS",
        statusCode: 401,
      });
    case "UserNotFoundException":
      return Object.assign(new Error("Invalid email or password"), {
        code: "INVALID_CREDENTIALS",
        statusCode: 401,
      });
    case "UserNotConfirmedException":
      return Object.assign(
        new Error("Please verify your email before signing in"),
        { code: "USER_NOT_CONFIRMED", statusCode: 403 },
      );
    case "PasswordResetRequiredException":
      return Object.assign(new Error("Password reset required"), {
        code: "PASSWORD_RESET_REQUIRED",
        statusCode: 403,
      });
    case "TooManyRequestsException":
      return Object.assign(
        new Error("Too many attempts. Please try again later."),
        { code: "RATE_LIMITED", statusCode: 429 },
      );
    case "LimitExceededException":
      return Object.assign(
        new Error("Too many attempts. Please try again later."),
        { code: "RATE_LIMITED", statusCode: 429 },
      );
    case "InvalidPasswordException":
      return Object.assign(
        new Error(
          "Password does not meet requirements: minimum 10 characters with uppercase, lowercase, numbers, and symbols",
        ),
        { code: "INVALID_PASSWORD", statusCode: 400 },
      );
    case "UsernameExistsException":
      return Object.assign(new Error("A user with this email already exists"), {
        code: "USER_EXISTS",
        statusCode: 409,
      });
    case "CodeMismatchException":
      return Object.assign(new Error("Invalid verification code"), {
        code: "CODE_MISMATCH",
        statusCode: 400,
      });
    case "ExpiredCodeException":
      return Object.assign(
        new Error("Verification code has expired. Please request a new one."),
        { code: "CODE_EXPIRED", statusCode: 400 },
      );
    case "EnableSoftwareTokenMFAException":
      return Object.assign(new Error("Invalid MFA code. Please try again."), {
        code: "MFA_CODE_INVALID",
        statusCode: 400,
      });
    case "MFAMethodNotFoundException":
      return Object.assign(new Error("MFA method is not available for this user"), {
        code: "MFA_METHOD_NOT_AVAILABLE",
        statusCode: 400,
      });
    case "InvalidParameterException":
      return Object.assign(
        new Error(
          "Requested MFA method is not enabled in this Cognito user pool/app client.",
        ),
        { code: "MFA_METHOD_NOT_CONFIGURED", statusCode: 400 },
      );
    default:
      return Object.assign(
        new Error(error.message || "Authentication service error"),
        { code: "AUTH_ERROR", statusCode: 500 },
      );
  }
}
