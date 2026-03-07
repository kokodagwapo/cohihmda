import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Get JWT_SECRET lazily to allow dotenv to load first (exported for canvas_only route guard)
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return secret;
}

// JWT payload structure (matches what's signed in auth routes)
interface JwtTokenPayload {
  userId: string;
  email: string;
  role: string;
  isSuperAdmin: boolean;
  tenantId?: string;
  tenantSlug?: string;
  access_mode?: 'full' | 'canvas_only';
}

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
  userRole?: string;
  isSuperAdmin?: boolean;
  tenantId?: string;
  tenantSlug?: string;
  userAccessMode?: 'full' | 'canvas_only';
}

export function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as JwtTokenPayload;
    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    req.userRole = decoded.role;
    req.isSuperAdmin = decoded.isSuperAdmin;
    req.tenantId = decoded.tenantId;
    req.tenantSlug = decoded.tenantSlug;
    req.userAccessMode = decoded.access_mode || 'full';
    next();
  } catch (error: any) {
    // Authentication failures (expired/invalid/malformed token) should be 401
    if (
      error?.name === 'TokenExpiredError' ||
      error?.name === 'JsonWebTokenError' ||
      error?.name === 'NotBeforeError'
    ) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

