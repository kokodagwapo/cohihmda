/**
 * SES recipient identity verification (for sandbox).
 * When SES is in sandbox, it only delivers to verified recipient addresses.
 * This service requests verification and checks status so we can send the
 * verification email when creating a user, and optionally check before sending.
 */

import {
  SESClient,
  VerifyEmailIdentityCommand,
  GetIdentityVerificationAttributesCommand,
} from "@aws-sdk/client-ses";
import { logError, logInfo } from "./logger.js";

const region = () => process.env.AWS_SES_REGION || "us-east-1";

let client: SESClient | null = null;

function getClient(): SESClient {
  if (!client) {
    client = new SESClient({ region: region() });
  }
  return client;
}

/**
 * Request SES to send a verification email to this address.
 * The recipient must click the link in that email to become verified.
 * Safe to call if the identity is already verified or pending (SES is idempotent).
 * Does not throw; logs errors so user creation is not blocked.
 */
export async function requestEmailVerification(email: string): Promise<void> {
  try {
    await getClient().send(
      new VerifyEmailIdentityCommand({ EmailAddress: email }),
    );
    logInfo("[SES] Verification email requested", { email });
  } catch (err: unknown) {
    logError("[SES] Request verification failed", err as Error, { email });
    // Do not throw: we still want to create the user and send the Cognito invite.
    // In sandbox, the invite may not be delivered until they verify.
  }
}

/**
 * Returns true if the email is verified in SES (VerificationStatus === 'Success').
 * Useful for sandbox: e.g. only allow "resend invite" when verified.
 */
export async function isEmailVerifiedInSES(email: string): Promise<boolean> {
  try {
    const result = await getClient().send(
      new GetIdentityVerificationAttributesCommand({
        Identities: [email],
      }),
    );
    const attrs = result.VerificationAttributes?.[email];
    return attrs?.VerificationStatus === "Success";
  } catch (err: unknown) {
    logError("[SES] Get verification status failed", err as Error, { email });
    return false;
  }
}
