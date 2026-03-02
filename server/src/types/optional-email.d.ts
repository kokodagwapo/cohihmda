/**
 * Type declarations for optional email provider packages.
 * These are dynamically imported at runtime when the provider is configured;
 * they may not be installed (optional dependencies).
 */
declare module "@sendgrid/mail" {
  const mail: {
    setApiKey(key: string): void;
    send(options: Record<string, unknown>): Promise<unknown>;
  };
  export = mail;
}

declare module "resend" {
  export class Resend {
    constructor(apiKey: string);
    emails: {
      send(options: Record<string, unknown>): Promise<unknown>;
    };
  }
}
