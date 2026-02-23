/**
 * Sentry Error Tracking Setup
 * Initialize Sentry for error monitoring and performance tracking.
 * Uses Sentry v8+ API: expressIntegration() and setupExpressErrorHandler().
 */

import * as Sentry from '@sentry/node';
import type { Express } from 'express';

let sentryInitialized = false;

/**
 * Initialize Sentry if DSN is configured.
 * Call this before any other app setup.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) {
    console.log('ℹ️  Sentry DSN not configured, error tracking disabled');
    return;
  }

  try {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      integrations: [Sentry.expressIntegration()],
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    });

    sentryInitialized = true;
    console.log('✅ Sentry initialized for error tracking');
  } catch (error) {
    console.warn('⚠️  Failed to initialize Sentry:', error);
  }
}

/**
 * Register the Sentry Express error handler. Call this after all routes are set up,
 * but before any other error-handling middleware.
 * Skips 4xx client errors (only 5xx and unhandled are sent to Sentry).
 */
export function setupSentryErrorHandler(app: Express): void {
  if (!sentryInitialized) {
    return;
  }

  Sentry.setupExpressErrorHandler(app, {
    shouldHandleError(error) {
      const status =
        error.status ?? error.statusCode ?? error.status_code;
      const code = status != null ? Number(status) : 500;
      // Don't track 4xx client errors
      if (code >= 400 && code < 500) {
        return false;
      }
      return true;
    },
  });
}
