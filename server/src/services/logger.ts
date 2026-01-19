/**
 * Structured Logging Service
 * Replaces console.log with proper log levels and sanitization
 * Follows Cursor Rules: Never log secrets, passwords, tokens, or PII
 */

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface LogContext {
  userId?: string;
  tenantId?: string;
  requestId?: string;
  [key: string]: unknown;
}

/**
 * Sanitize data to remove secrets and PII before logging
 */
function sanitizeData(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(sanitizeData);
  }

  const sanitized: Record<string, unknown> = {};
  const sensitiveKeys = [
    'password',
    'secret',
    'token',
    'api_key',
    'apikey',
    'auth',
    'authorization',
    'ssn',
    'social_security',
    'credit_card',
    'card_number',
    'cvv',
    'pin',
    'jwt',
    'access_token',
    'refresh_token',
    'private_key',
    'privatekey',
  ];

  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = sensitiveKeys.some((sensitive) => lowerKey.includes(sensitive));

    if (isSensitive) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeData(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Format log message with context
 */
function formatMessage(level: LogLevel, message: string, context?: LogContext): string {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` ${JSON.stringify(sanitizeData(context))}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
}

/**
 * Log error messages
 */
export function logError(message: string, error?: Error | unknown, context?: LogContext): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;
  
  const fullContext: LogContext = {
    ...context,
    error: errorMessage,
    ...(errorStack && { stack: errorStack }),
  };

  console.error(formatMessage('error', message, fullContext));
}

/**
 * Log warning messages
 */
export function logWarn(message: string, context?: LogContext): void {
  console.warn(formatMessage('warn', message, context));
}

/**
 * Log informational messages
 */
export function logInfo(message: string, context?: LogContext): void {
  if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_INFO_LOGS === 'true') {
    console.log(formatMessage('info', message, context));
  }
}

/**
 * Log debug messages (only in development)
 */
export function logDebug(message: string, context?: LogContext): void {
  if (process.env.NODE_ENV === 'development' || process.env.ENABLE_DEBUG_LOGS === 'true') {
    console.debug(formatMessage('debug', message, context));
  }
}

/**
 * Create a logger instance with default context
 */
export function createLogger(defaultContext?: LogContext) {
  return {
    error: (message: string, error?: Error | unknown, context?: LogContext) =>
      logError(message, error, { ...defaultContext, ...context }),
    warn: (message: string, context?: LogContext) =>
      logWarn(message, { ...defaultContext, ...context }),
    info: (message: string, context?: LogContext) =>
      logInfo(message, { ...defaultContext, ...context }),
    debug: (message: string, context?: LogContext) =>
      logDebug(message, { ...defaultContext, ...context }),
  };
}

