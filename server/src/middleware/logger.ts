/**
 * Request Logging Middleware
 * Logs HTTP requests for monitoring and debugging
 */

import morgan from 'morgan';
import { Request, Response } from 'express';

// Custom token for logging user ID if available
morgan.token('user-id', (req: Request) => {
  return (req as any).userId || '-';
});

morgan.token('tenant-id', (req: Request) => {
  return (req as any).tenantId || '-';
});

/**
 * Development logger - detailed output
 */
export const devLogger = morgan('dev');

/**
 * Production logger - concise format with user/tenant info
 */
export const prodLogger = morgan(
  ':remote-addr - :user-id [:tenant-id] ":method :url HTTP/:http-version" :status :res[content-length] - :response-time ms',
  {
    skip: (req: Request, res: Response) => {
      // Skip logging for health checks in production
      return req.path === '/health' && res.statusCode === 200;
    },
  }
);

/**
 * Error logger - logs only errors (4xx, 5xx)
 */
export const errorLogger = morgan(
  ':remote-addr - :user-id [:tenant-id] ":method :url" :status :res[content-length] - :response-time ms',
  {
    skip: (req: Request, res: Response) => res.statusCode < 400,
  }
);

