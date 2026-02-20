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
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  ChangePasswordCommand,
  InitiateAuthCommand,
  type AuthenticationResultType,
  type ChallengeNameType,
} from "@aws-sdk/client-cognito-identity-provider";
import crypto from "crypto";
import { logError, logInfo, logDebug } from "../logger.js";

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

export function isCognitoAuthEnabled(): boolean {
  return !!(getCognitoUserPoolId() && getCognitoClientId());
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
): Promise<CognitoSignInResult> {
  const challengeResponses: Record<string, string> = {
    USERNAME: email,
    SOFTWARE_TOKEN_MFA_CODE: mfaCode,
  };

  const secretHash = computeSecretHash(email);
  if (secretHash) challengeResponses.SECRET_HASH = secretHash;

  try {
    const command = new AdminRespondToAuthChallengeCommand({
      UserPoolId: getCognitoUserPoolId(),
      ClientId: getCognitoClientId(),
      ChallengeName: "SOFTWARE_TOKEN_MFA",
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

export async function createUser(
  email: string,
  password: string,
  fullName?: string,
): Promise<CognitoCreateUserResult> {
  try {
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
      MessageAction: "SUPPRESS",
    });

    const createResponse = await getClient().send(createCommand);
    const cognitoSub = createResponse.User!.Attributes!.find(
      (a) => a.Name === "sub",
    )!.Value!;

    // Set permanent password immediately (skip force-change flow)
    const setPasswordCommand = new AdminSetUserPasswordCommand({
      UserPoolId: getCognitoUserPoolId(),
      Username: email,
      Password: password,
      Permanent: true,
    });
    await getClient().send(setPasswordCommand);

    logInfo("[CognitoAuth] User created", { email, cognitoSub });
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
): Promise<{ mfaEnabled: boolean; cognitoSub: string }> {
  try {
    const command = new AdminGetUserCommand({
      UserPoolId: getCognitoUserPoolId(),
      Username: username,
    });
    const response = await getClient().send(command);

    const sub =
      response.UserAttributes?.find((a) => a.Name === "sub")?.Value || "";
    const mfaEnabled = (response.UserMFASettingList || []).includes(
      "SOFTWARE_TOKEN_MFA",
    );

    return { mfaEnabled, cognitoSub: sub };
  } catch (error: any) {
    logError("[CognitoAuth] Get user failed", error, { username });
    throw mapCognitoError(error);
  }
}

// --- Password Reset ---

export async function forgotPassword(email: string): Promise<void> {
  try {
    const secretHash = computeSecretHash(email);

    const command = new ForgotPasswordCommand({
      ClientId: getCognitoClientId(),
      Username: email,
      ...(secretHash ? { SecretHash: secretHash } : {}),
    });
    await getClient().send(command);
    logInfo("[CognitoAuth] Password reset initiated", { email });
  } catch (error: any) {
    logDebug("[CognitoAuth] ForgotPassword result", {
      email,
      error: error.name,
    });
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
  } catch (error: any) {
    logError("[CognitoAuth] Confirm forgot password failed", error, { email });
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

export async function disableMfa(username: string): Promise<void> {
  try {
    const command = new AdminSetUserMFAPreferenceCommand({
      UserPoolId: getCognitoUserPoolId(),
      Username: username,
      SoftwareTokenMfaSettings: {
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
    default:
      return Object.assign(
        new Error(error.message || "Authentication service error"),
        { code: "AUTH_ERROR", statusCode: 500 },
      );
  }
}
