import express, { type NextFunction, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { authenticateToken, getJwtSecret, type AuthRequest } from "../middleware/auth.js";
import {
  isCanvasOnlyRequestAllowed,
  requireAnyAdmin,
  requirePlatformStaff,
  requireRole,
} from "../middleware/rbac.js";
import { ROLE_MATRIX, type AccessPolicy, type HttpMethod } from "./roleMatrix.js";

type Handler = (req: Request, res: Response, next: NextFunction) => void;

function policyMiddleware(policy: AccessPolicy): Handler[] {
  switch (policy) {
    case "public":
      return [];
    case "auth":
      return [authenticateToken as Handler];
    case "platform_staff":
      return [authenticateToken as Handler, requirePlatformStaff() as Handler];
    case "platform_admin":
      return [
        authenticateToken as Handler,
        requireRole("super_admin", "platform_admin") as Handler,
      ];
    case "any_admin":
      return [authenticateToken as Handler, requireAnyAdmin() as Handler];
    case "tenant_admin_or_super":
      return [
        authenticateToken as Handler,
        requireRole("tenant_admin", "super_admin") as Handler,
      ];
    case "analytics_admin":
      return [
        authenticateToken as Handler,
        requireRole("super_admin", "platform_admin", "tenant_admin") as Handler,
      ];
    case "distributions_admin":
      return [
        authenticateToken as Handler,
        requireRole("tenant_admin", "super_admin", "platform_admin") as Handler,
      ];
    default:
      return [authenticateToken as Handler];
  }
}

function registerRoute(app: express.Express, method: HttpMethod, path: string, middleware: Handler[]) {
  const handler: Handler = (req, res) => {
    const authReq = req as AuthRequest;
    res.status(200).json({
      ok: true,
      path,
      method,
      role: authReq.userRole || null,
      persona: authReq.userPersona || "tenant_user",
    });
  };

  if (method === "GET") app.get(path, ...middleware, handler);
  if (method === "POST") app.post(path, ...middleware, handler);
  if (method === "PUT") app.put(path, ...middleware, handler);
  if (method === "DELETE") app.delete(path, ...middleware, handler);
}

export function createRoleHarnessApp(): express.Express {
  const app = express();
  app.use(express.json());

  // Mirror production canvas_only guard behavior.
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];
    if (!token) return next();
    try {
      const decoded = jwt.verify(token, getJwtSecret()) as { persona?: string };
      if (decoded.persona === "tenant_canvas_only_user") {
        const path = req.originalUrl || req.url || "";
        const method = (req.method || "GET").toUpperCase();
        if (!isCanvasOnlyRequestAllowed(path, method)) {
          return res.status(403).json({
            error: "Forbidden",
            message: "Canvas-only users cannot access this resource.",
          });
        }
      }
    } catch {
      // let auth middleware handle invalid tokens
    }
    return next();
  });

  for (const route of ROLE_MATRIX) {
    registerRoute(app, route.method, route.path, policyMiddleware(route.policy));
  }

  // Functional probes for critical route groups.
  app.post(
    "/api/workbench/canvases/__functional/update-any",
    authenticateToken,
    requireRole("super_admin", "platform_admin"),
    ((req: Request, res: Response) => res.status(200).json({ updated: true })) as Handler,
  );
  app.post(
    "/api/admin/release-notes/__functional/publish",
    authenticateToken,
    requireRole("super_admin", "platform_admin"),
    ((req: Request, res: Response) => res.status(200).json({ published: true })) as Handler,
  );
  app.post(
    "/api/distributions/__functional/send-now",
    authenticateToken,
    requireRole("tenant_admin", "super_admin", "platform_admin"),
    ((req: Request, res: Response) => res.status(200).json({ sent: true })) as Handler,
  );
  app.get(
    "/api/admin/__functional/platform-report",
    authenticateToken,
    requirePlatformStaff(),
    ((req: Request, res: Response) => res.status(200).json({ report: true })) as Handler,
  );

  return app;
}
