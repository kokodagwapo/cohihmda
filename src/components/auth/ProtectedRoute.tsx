import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, UserRole } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: ReactNode;
  /**
   * Required roles to access this route.
   * If not specified, any authenticated user can access.
   * If multiple roles are specified, user must have at least one of them.
   */
  requiredRoles?: UserRole[];
  /**
   * If true, only super_admin can access this route
   */
  superAdminOnly?: boolean;
  /**
   * If true, only tenant_admin or super_admin can access
   */
  adminOnly?: boolean;
  /**
   * Custom redirect path when access is denied
   * Defaults to /login for unauthenticated, /unauthorized for wrong role
   */
  redirectTo?: string;
  /**
   * Custom loading component
   */
  loadingComponent?: ReactNode;
  /**
   * Custom unauthorized component (shown instead of redirect)
   */
  unauthorizedComponent?: ReactNode;
}

/**
 * Default loading spinner component
 */
function DefaultLoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-slate-600 dark:text-slate-300" />
        <p className="text-sm text-slate-600 dark:text-slate-400">Loading...</p>
      </div>
    </div>
  );
}

/**
 * Default unauthorized component
 */
function DefaultUnauthorized({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
      <div className="text-center max-w-md px-6">
        <div className="mb-6">
          <div className="h-16 w-16 mx-auto bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center">
            <svg className="h-8 w-8 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
        </div>
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-2">
          Access Denied
        </h2>
        <p className="text-slate-600 dark:text-slate-400 mb-6">
          {message}
        </p>
        <a 
          href="/" 
          className="inline-flex items-center px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors"
        >
          Return to Home
        </a>
      </div>
    </div>
  );
}

/**
 * ProtectedRoute - Comprehensive route protection with role-based access
 * 
 * Usage examples:
 * 
 * // Basic authentication required
 * <ProtectedRoute>
 *   <Dashboard />
 * </ProtectedRoute>
 * 
 * // Super admin only
 * <ProtectedRoute superAdminOnly>
 *   <SystemSettings />
 * </ProtectedRoute>
 * 
 * // Any admin (super_admin or tenant_admin)
 * <ProtectedRoute adminOnly>
 *   <AdminPanel />
 * </ProtectedRoute>
 * 
 * // Specific roles
 * <ProtectedRoute requiredRoles={['loan_officer', 'processor']}>
 *   <LoanProcessing />
 * </ProtectedRoute>
 */
export function ProtectedRoute({
  children,
  requiredRoles,
  superAdminOnly = false,
  adminOnly = false,
  redirectTo,
  loadingComponent,
  unauthorizedComponent,
}: ProtectedRouteProps) {
  const location = useLocation();
  const { isAuthenticated, isLoading, user, hasRole, isSuperAdmin, isAdmin } = useAuth();

  // Show loading state
  if (isLoading) {
    return <>{loadingComponent || <DefaultLoadingSpinner />}</>;
  }

  // Not authenticated - redirect to login
  if (!isAuthenticated) {
    const returnTo = location.pathname + location.search;
    const loginUrl = `/login?returnTo=${encodeURIComponent(returnTo)}`;
    return <Navigate to={redirectTo || loginUrl} replace />;
  }

  // Check super admin requirement
  if (superAdminOnly && !isSuperAdmin()) {
    if (unauthorizedComponent) {
      return <>{unauthorizedComponent}</>;
    }
    return <DefaultUnauthorized message="This page is only accessible to platform administrators." />;
  }

  // Check admin requirement
  if (adminOnly && !isAdmin()) {
    if (unauthorizedComponent) {
      return <>{unauthorizedComponent}</>;
    }
    return <DefaultUnauthorized message="This page is only accessible to administrators." />;
  }

  // Check specific role requirements
  if (requiredRoles && requiredRoles.length > 0 && !hasRole(requiredRoles)) {
    if (unauthorizedComponent) {
      return <>{unauthorizedComponent}</>;
    }
    return <DefaultUnauthorized message="You don't have permission to access this page." />;
  }

  // All checks passed - render children
  return <>{children}</>;
}

/**
 * Higher-order component version of ProtectedRoute
 * Useful for wrapping components declaratively
 */
export function withAuth<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  options?: Omit<ProtectedRouteProps, 'children'>
) {
  return function AuthenticatedComponent(props: P) {
    return (
      <ProtectedRoute {...options}>
        <WrappedComponent {...props} />
      </ProtectedRoute>
    );
  };
}

/**
 * Hook to check if current route access is allowed
 * Useful for conditional rendering within components
 */
export function useRouteAccess(options?: {
  requiredRoles?: UserRole[];
  superAdminOnly?: boolean;
  adminOnly?: boolean;
}): { isAllowed: boolean; isLoading: boolean; reason?: string } {
  const { isAuthenticated, isLoading, hasRole, isSuperAdmin, isAdmin } = useAuth();

  if (isLoading) {
    return { isAllowed: false, isLoading: true };
  }

  if (!isAuthenticated) {
    return { isAllowed: false, isLoading: false, reason: 'Not authenticated' };
  }

  if (options?.superAdminOnly && !isSuperAdmin()) {
    return { isAllowed: false, isLoading: false, reason: 'Super admin required' };
  }

  if (options?.adminOnly && !isAdmin()) {
    return { isAllowed: false, isLoading: false, reason: 'Admin required' };
  }

  if (options?.requiredRoles && options.requiredRoles.length > 0 && !hasRole(options.requiredRoles)) {
    return { isAllowed: false, isLoading: false, reason: 'Insufficient role' };
  }

  return { isAllowed: true, isLoading: false };
}

export default ProtectedRoute;
