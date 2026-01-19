/**
 * Sentry Error Tracking Setup
 * Initialize Sentry for error monitoring and performance tracking
 */

// @ts-nocheck
import * as Sentry from '@sentry/node';
import { Request, Response, NextFunction } from 'express';

let sentryInitialized = false;

/**
 * Initialize Sentry if DSN is configured
 */
export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  
  if (!dsn) {
    console.log('ℹ️  Sentry DSN not configured, error tracking disabled');
    return;
  }

  try {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0, // 10% in prod, 100% in dev
      profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      integrations: (() => {
        const HttpIntegration = (Sentry as any).Integrations?.Http;
        return HttpIntegration ? [new HttpIntegration({ tracing: true })] : [];
      })(),
    });

    sentryInitialized = true;
    console.log('✅ Sentry initialized for error tracking');
  } catch (error) {
    console.warn('⚠️  Failed to initialize Sentry:', error);
  }
}

/**
 * Sentry request handler middleware
 * Must be added before other middleware
 */
export function sentryRequestHandler(req: Request, res: Response, next: NextFunction) {
  if (sentryInitialized && Sentry.Handlers) {
    return Sentry.Handlers.requestHandler()(req, res, next);
  }
  next();
}

/**
 * Sentry tracing handler middleware
 * Must be added before routes
 */
export function sentryTracingHandler(req: Request, res: Response, next: NextFunction) {
  if (sentryInitialized && Sentry.Handlers && Sentry.Handlers.tracingHandler) {
    const handler = Sentry.Handlers.tracingHandler();
    if (handler) {
      return handler(req, res, next);
    }
  }
  next();
}

/**
 * Sentry error handler middleware
 * Must be added after routes but before error handlers
 */
export function sentryErrorHandler(error: any, req: Request, res: Response, next: NextFunction) {
  if (sentryInitialized && Sentry.Handlers) {
    return Sentry.Handlers.errorHandler({
      shouldHandleError(error) {
        // Don't track 4xx errors (client errors)
        if (error.status && error.status >= 400 && error.status < 500) {
          return false;
        }
        return true;
      },
    })(error, req, res, next);
  }
  next(error);
}

