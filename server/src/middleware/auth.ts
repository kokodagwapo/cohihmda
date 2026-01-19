import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Get JWT_SECRET lazily to allow dotenv to load first
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
  throw new Error('JWT_SECRET environment variable is required');
  }
  return secret;
}

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
}

export function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as { userId: string; email: string };
    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid token' });
  }
}

