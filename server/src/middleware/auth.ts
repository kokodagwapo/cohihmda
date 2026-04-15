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
  persona?: "tenant_admin" | "tenant_user" | "tenant_canvas_only_user";
  // AI Control Plane: presence of sub_type "ai_agent" marks the bearer as an
  // AI agent identity and activates the AI security guard / orchestrator path.
  sub_type?: string;
}

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
  userRole?: string;
  isSuperAdmin?: boolean;
  tenantId?: string;
  tenantSlug?: string;
  userPersona?: "tenant_admin" | "tenant_user" | "tenant_canvas_only_user";
  // AI Control Plane identity fields.
  // userSubType mirrors the raw sub_type JWT claim for downstream inspection.
  // isAiAgent is the resolved boolean shorthand used by aiSecurityGuard.
  // aiActionId is populated from X-AI-Action-Id and is the approval correlation
  // key that the guard and orchestrator use to look up pending_approval state.
  userSubType?: string;
  isAiAgent?: boolean;
  aiActionId?: string;
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
    req.userPersona = decoded.persona || "tenant_user";

    // AI Control Plane identity resolution.
    // sub_type is an optional JWT claim; its presence does not alter any
    // existing role/persona semantics — it only activates the AI control path.
    if (decoded.sub_type) {
      req.userSubType = decoded.sub_type;
      req.isAiAgent = decoded.sub_type === 'ai_agent';
    }

    // X-AI-Action-Id is the route-level approval correlation key.  It is read
    // here so the aiSecurityGuard and orchestrator can use it without re-parsing
    // headers, and so it travels with the authenticated identity context.
    const actionIdHeader = req.headers['x-ai-action-id'];
    if (typeof actionIdHeader === 'string' && actionIdHeader.length > 0) {
      req.aiActionId = actionIdHeader;
    }

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

