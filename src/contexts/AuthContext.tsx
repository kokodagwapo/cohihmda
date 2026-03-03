import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { api } from '@/lib/api';
import { enforcePlatformOnly } from '@/stores/tenantStore';

/**
 * User role types
 * 
 * Super Admin roles (stored in management DB):
 * - super_admin: Cohi internal admin with full platform access
 * - platform_admin: Cohi staff with limited platform access
 * - support: Cohi support staff
 * 
 * Tenant roles (stored in tenant DBs):
 * - tenant_admin: Client admin with access to their organization's settings
 * - admin: Organization admin (legacy, same as tenant_admin)
 * - user: Regular user with standard access
 * - viewer: Read-only access
 * - loan_officer: Loan officer with specific permissions
 * - processor: Loan processor with specific permissions
 */
export type UserRole = 
  | 'super_admin' 
  | 'platform_admin' 
  | 'support'
  | 'tenant_admin' 
  | 'admin' 
  | 'user' 
  | 'viewer' 
  | 'loan_officer' 
  | 'processor';

/**
 * User object returned from the API
 */
export interface AuthUser {
  id: string;
  email: string;
  full_name?: string;
  role: UserRole;
  is_super_admin: boolean;
  tenant_id?: string | null;
  tenant_name?: string | null;
  tenant_slug?: string | null;
  is_active?: boolean;
  last_login_at?: string;
  created_at?: string;
  /** 'full' = normal platform; 'canvas_only' = only shared canvases (slim UI) */
  access_mode?: 'full' | 'canvas_only';
}

/**
 * Tenant info for login selection
 */
export interface TenantInfo {
  slug: string;
  name: string;
}

/**
 * Auth context state and methods
 */
interface AuthContextType {
  // State
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  
  // Available tenants (for login)
  tenants: TenantInfo[];
  
  // Actions
  login: (email: string, password: string, tenantSlug?: string) => Promise<void>;
  completeMfaLogin: (email: string, session: string, code: string, tenantSlug?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  clearError: () => void;
  loadTenants: () => Promise<void>;
  setAuthFromToken: (token: string, user: AuthUser) => void;
  
  // Role checks
  hasRole: (role: UserRole | UserRole[]) => boolean;
  isSuperAdmin: () => boolean;
  isPlatformStaff: () => boolean;
  isTenantAdmin: () => boolean;
  isAdmin: () => boolean;
  /** True when user only sees shared canvases (slim UI) */
  isCanvasOnly: () => boolean;
  
  // Impersonation (for super admins)
  impersonatingTenant: string | null;
  impersonateTenant: (tenantSlug: string) => void;
  stopImpersonating: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_TOKEN_KEY = 'auth_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const IMPERSONATION_KEY = 'impersonating_tenant';

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [impersonatingTenant, setImpersonatingTenant] = useState<string | null>(
    localStorage.getItem(IMPERSONATION_KEY)
  );

  // Check authentication status on mount
  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      
      if (!token) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await api.getCurrentUser();
        if (response.user) {
          setUser(response.user as AuthUser);
          api.setUserRole(response.user.role);
          enforcePlatformOnly(response.user.role, response.user.tenant_id);
        }
      } catch (err) {
        // Token is invalid or expired
        api.clearToken();
        localStorage.removeItem(AUTH_TOKEN_KEY);
        setUser(null);
        api.setUserRole(null);
        enforcePlatformOnly(undefined);
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, []);

  /**
   * Load available tenants for login dropdown
   */
  const loadTenants = useCallback(async () => {
    try {
      const response = await api.request<{ tenants: TenantInfo[] }>('/api/auth/tenants');
      setTenants(response.tenants || []);
    } catch (err) {
      console.warn('Failed to load tenants:', err);
      setTenants([]);
    }
  }, []);

  /**
   * Login with email and password.
   * If MFA is required, throws an error with { mfaRequired, session, email } attached
   * so the caller (Login page) can display the MFA challenge UI.
   */
  const login = useCallback(async (email: string, password: string, tenantSlug?: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await api.request<{
        user?: AuthUser;
        token?: string;
        refreshToken?: string;
        mfaRequired?: boolean;
        challengeName?: string;
        session?: string;
        email?: string;
        newPasswordRequired?: boolean;
      }>('/api/auth/signin', {
        method: 'POST',
        body: JSON.stringify({ email, password, tenantSlug }),
      });

      if (response.mfaRequired) {
        const mfaError = Object.assign(new Error('MFA_REQUIRED'), {
          mfaRequired: true,
          challengeName: response.challengeName,
          session: response.session,
          email: response.email || email,
        });
        throw mfaError;
      }

      if (response.newPasswordRequired) {
        const pwError = Object.assign(new Error('NEW_PASSWORD_REQUIRED'), {
          newPasswordRequired: true,
          session: response.session,
          email: response.email || email,
        });
        throw pwError;
      }

      if (response.token) {
        localStorage.setItem(AUTH_TOKEN_KEY, response.token);
        api.setToken(response.token);
      }
      if (response.refreshToken) {
        localStorage.setItem(REFRESH_TOKEN_KEY, response.refreshToken);
      }
      if ((response as any).cognitoAccessToken) {
        localStorage.setItem('cognito_access_token', (response as any).cognitoAccessToken);
      }
      
      if (response.user) {
        setUser(response.user);
        api.setUserRole(response.user.role || null);
        enforcePlatformOnly(response.user.role, response.user.tenant_id);
      }
    } catch (err: any) {
      if (err.mfaRequired || err.newPasswordRequired) {
        throw err;
      }
      const message = err.message || 'Login failed';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Complete login after MFA challenge verification
   */
  const completeMfaLogin = useCallback(async (email: string, session: string, code: string, tenantSlug?: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await api.request<{
        user: AuthUser;
        token: string;
        refreshToken?: string;
        cognitoAccessToken?: string;
      }>('/api/auth/mfa/verify', {
        method: 'POST',
        body: JSON.stringify({ email, session, code, tenantSlug }),
      });

      if (response.token) {
        localStorage.setItem(AUTH_TOKEN_KEY, response.token);
        api.setToken(response.token);
      }
      if (response.refreshToken) {
        localStorage.setItem(REFRESH_TOKEN_KEY, response.refreshToken);
      }
      if (response.cognitoAccessToken) {
        localStorage.setItem('cognito_access_token', response.cognitoAccessToken);
      }

      setUser(response.user);
      api.setUserRole(response.user?.role || null);
      enforcePlatformOnly(response.user?.role, response.user?.tenant_id);
    } catch (err: any) {
      const message = err.message || 'MFA verification failed';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Logout
   * Clears all auth state, tokens, and cached data
   */
  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      await api.signOut();
    } catch (err) {
      // Ignore errors during logout - we still want to clear local state
      console.warn('[Auth] Error during signout API call:', err);
    } finally {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      localStorage.removeItem(IMPERSONATION_KEY);
      localStorage.removeItem('cognito_access_token');
      
      // Clear API client state (token and cache)
      api.clearToken();
      api.setUserRole(null);
      
      // Clear React state
      setUser(null);
      setImpersonatingTenant(null);
      setTenants([]);
      setError(null);
      setIsLoading(false);
      
      console.log('[Auth] Logout complete - all state cleared');
    }
  }, []);

  /**
   * Refresh user data from server
   */
  const refreshUser = useCallback(async () => {
    try {
      const response = await api.getCurrentUser();
      if (response.user) {
        setUser(response.user as AuthUser);
        api.setUserRole(response.user.role);
      }
    } catch (err) {
      // If refresh fails, log out
      await logout();
    }
  }, [logout]);

  /**
   * Clear error state
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * Check if user has a specific role
   */
  const hasRole = useCallback((role: UserRole | UserRole[]): boolean => {
    if (!user) return false;
    const roles = Array.isArray(role) ? role : [role];
    return roles.includes(user.role);
  }, [user]);

  /**
   * Check if user is a super admin (Cohi internal)
   */
  const isSuperAdmin = useCallback((): boolean => {
    return user?.is_super_admin === true || user?.role === 'super_admin';
  }, [user]);

  /**
   * Check if user is Cohi platform staff
   */
  const isPlatformStaff = useCallback((): boolean => {
    return user?.is_super_admin === true || 
           user?.role === 'super_admin' || 
           user?.role === 'platform_admin' ||
           user?.role === 'support';
  }, [user]);

  /**
   * Check if user is a tenant admin
   */
  const isTenantAdmin = useCallback((): boolean => {
    return user?.role === 'tenant_admin' || user?.role === 'admin';
  }, [user]);

  /**
   * Check if user has any admin privileges
   */
  const isAdmin = useCallback((): boolean => {
    return isSuperAdmin() || isTenantAdmin();
  }, [isSuperAdmin, isTenantAdmin]);

  /**
   * Check if user is canvas-only (restricted to shared canvases, slim UI)
   */
  const isCanvasOnly = useCallback((): boolean => {
    return user?.access_mode === 'canvas_only';
  }, [user]);

  /**
   * Impersonate a tenant (super admin only)
   */
  const impersonateTenant = useCallback((tenantSlug: string) => {
    if (!isSuperAdmin()) {
      console.warn('Only super admins can impersonate tenants');
      return;
    }
    localStorage.setItem(IMPERSONATION_KEY, tenantSlug);
    setImpersonatingTenant(tenantSlug);
  }, [isSuperAdmin]);

  /**
   * Stop impersonating
   */
  const stopImpersonating = useCallback(() => {
    localStorage.removeItem(IMPERSONATION_KEY);
    setImpersonatingTenant(null);
  }, []);

  /**
   * Set auth state from token (used by SSO callback)
   */
  const setAuthFromToken = useCallback((token: string, userData: AuthUser) => {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    api.setToken(token);
    api.setUserRole(userData?.role || null);
    setUser(userData);
    setError(null);
    setIsLoading(false);
  }, []);

  const value: AuthContextType = {
    user,
    isAuthenticated: !!user,
    isLoading,
    error,
    tenants,
    login,
    completeMfaLogin,
    logout,
    refreshUser,
    clearError,
    loadTenants,
    setAuthFromToken,
    hasRole,
    isSuperAdmin,
    isPlatformStaff,
    isTenantAdmin,
    isAdmin,
    isCanvasOnly,
    impersonatingTenant,
    impersonateTenant,
    stopImpersonating,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Hook to access auth context
 */
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

/**
 * Hook that requires authentication
 * Throws if not authenticated
 */
export function useRequireAuth(): AuthContextType & { user: AuthUser } {
  const auth = useAuth();
  
  if (!auth.isAuthenticated || !auth.user) {
    throw new Error('User is not authenticated');
  }
  
  return auth as AuthContextType & { user: AuthUser };
}

export default AuthContext;
