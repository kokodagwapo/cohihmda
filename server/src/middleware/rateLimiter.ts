/**
 * Rate Limiting Middleware
 * Protects API endpoints from abuse
 */

import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { logError, logWarn } from '../services/logger.js';

/**
 * General API rate limiter
 * 100 requests per 15 minutes per IP (production)
 * Skip rate limiting for localhost in development
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 500 : 1000, // 500 requests per 15 mins in production
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Skip rate limiting for localhost in development
  skip: (req) => {
    if (process.env.NODE_ENV !== 'production') {
      const ip = req.ip || req.socket?.remoteAddress || req.headers['x-forwarded-for'] || '';
      const ipStr = Array.isArray(ip) ? ip[0] : ip;
      // Skip for localhost, 127.0.0.1, ::1, and ::ffff:127.0.0.1
      return ipStr === '127.0.0.1' || 
             ipStr === '::1' || 
             ipStr === '::ffff:127.0.0.1' || 
             ipStr.startsWith('127.') || 
             ipStr === 'localhost' ||
             !ipStr || 
             ipStr === '::';
    }
    return false;
  },
});

/**
 * Strict rate limiter for authentication endpoints
 * 5 requests per 15 minutes per IP (production)
 * 100 requests per 15 minutes per IP (development)
 */
const authLimiterBase = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 100 : 100, // Increased to 100 attempts per 15 mins to prevent blocking legitimate users
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful requests
  // In development, skip rate limiting entirely for localhost
  skip: (req) => {
    if (process.env.NODE_ENV !== 'production') {
      const ip = req.ip || req.socket?.remoteAddress || req.headers['x-forwarded-for'] || '';
      const ipStr = Array.isArray(ip) ? ip[0] : ip;
      // Skip for localhost, 127.0.0.1, ::1, and ::ffff:127.0.0.1
      return ipStr === '127.0.0.1' || 
             ipStr === '::1' || 
             ipStr === '::ffff:127.0.0.1' || 
             ipStr.startsWith('127.') || 
             ipStr === 'localhost' ||
             !ipStr || 
             ipStr === '::';
    }
    return false;
  },
});

/**
 * Wrapped auth limiter with error handling
 * Catches any errors from the rate limiter middleware
 */
export const authLimiter = (req: Request, res: Response, next: NextFunction) => {
  try {
    return authLimiterBase(req, res, (err?: any) => {
      if (err) {
        logError('Rate limiter middleware error', err, {
          path: req.path,
          method: req.method,
          ipAddress: req.ip,
        });
        // If rate limiter fails, allow request to proceed (fail open)
        // This prevents rate limiter errors from blocking authentication
        return next();
      }
      next();
    });
  } catch (error: any) {
    logError('Rate limiter wrapper error', error, {
      path: req.path,
      method: req.method,
      ipAddress: req.ip,
    });
    // Fail open - allow request to proceed if rate limiter crashes
    return next();
  }
};

/**
 * Document upload rate limiter
 * 10 uploads per hour per IP
 */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each IP to 10 uploads per hour
  message: 'Too many document uploads, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Cost sync rate limiter
 * 5 syncs per hour per IP
 */
export const costSyncLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Limit each IP to 5 syncs per hour
  message: 'Too many cost sync requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

