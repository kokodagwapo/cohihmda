# Authentication & Authorization Refactor Plan

This document outlines the plan to refactor Cohi authentication and authorization, addressing critical security issues and establishing a robust auth architecture.

> **Naming Convention:**
> - **Cohi** - The new executive intelligence platform (this product)
> - **Coheus** - The legacy Qlik Sense-based product

## Table of Contents

- [Current State Analysis](#current-state-analysis)
- [Critical Issues](#critical-issues)
- [Target Architecture](#target-architecture)
- [Implementation Plan](#implementation-plan)
- [Code Specifications](#code-specifications)
- [Migration Strategy](#migration-strategy)

---

## Current State Analysis

### Authentication Flow (Current)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CURRENT AUTH FLOW (PROBLEMATIC)                       │
└─────────────────────────────────────────────────────────────────────────────┘

1. App.tsx AutoAuthenticator
   │
   ├── Hardcoded auto-login: api.signIn('admin@ailethia.com', 'admin123')
   │                         ▲▲▲ CRITICAL SECURITY ISSUE ▲▲▲
   │
   └── Token stored in localStorage

2. Multiple Auth State Locations:
   ┌────────────────────────────────────────────────────────────────┐
   │ EditContext.tsx      │ isAuthenticated: boolean               │
   │ Navigation.tsx       │ apiAuthenticated: useState (local)     │
   │ Dashboard.tsx        │ isAuthenticated: useState (local)      │
   │ api.ts               │ token in localStorage                  │
   │ sessionStorage       │ 'dashboard_auth' key                   │
   └────────────────────────────────────────────────────────────────┘
   
   Problem: These states are NOT synchronized!

3. No Route Protection:
   │
   └── All routes (/admin, /insights, /loans) are publicly accessible
```

### Files Involved

| File | Auth-Related Code | Issues |
|------|-------------------|--------|
| `src/App.tsx` | AutoAuthenticator component | Hardcoded credentials |
| `src/contexts/EditContext.tsx` | isAuthenticated state | Mixes editing and auth |
| `src/components/layout/Navigation.tsx` | apiAuthenticated local state | Duplicate auth check |
| `src/pages/Dashboard.tsx` | isAuthenticated local state | Set to true by default |
| `src/pages/Login.tsx` | Login form | No integration with context |
| `src/lib/api.ts` | Token storage | Only storage, no state |
| `server/src/routes/auth.ts` | JWT generation | 7-day expiry, no refresh |
| `server/src/middleware/auth.ts` | Token validation | No session validation |

---

## Critical Issues

### Issue 1: Hardcoded Auto-Login (CRITICAL)

**Location:** `src/App.tsx:60-61`

```typescript
// SECURITY VULNERABILITY - Remove immediately
await api.signIn('admin@ailethia.com', 'admin123');
```

**Impact:** 
- Any user can access the application with admin privileges
- Credentials exposed in client-side JavaScript
- No authentication required to access protected routes

### Issue 2: Fragmented Auth State (HIGH)

Authentication state exists in 5+ locations with no synchronization:

```typescript
// EditContext.tsx
const [isAuthenticated, setIsAuthenticated] = useState(false);

// Navigation.tsx
const [apiAuthenticated, setApiAuthenticated] = useState(false);

// Dashboard.tsx  
const [isAuthenticated, setIsAuthenticated] = useState(true); // DEFAULT TRUE!

// api.ts
this.token = localStorage.getItem('auth_token');

// sessionStorage
sessionStorage.getItem('dashboard_auth');
```

**Impact:**
- Components show inconsistent auth state
- Logout doesn't clear all locations
- Race conditions on app startup

### Issue 3: No Route Protection (CRITICAL)

**Location:** `src/App.tsx:125-132`

```typescript
<Routes>
  <Route path="/insights" element={<Dashboard />} />
  <Route path="/loans" element={<Loans />} />
  <Route path="/admin" element={<Admin />} />  // No protection!
</Routes>
```

**Impact:**
- Anyone can access admin panel directly
- No role-based access control on routes
- Protected data accessible without authentication

### Issue 4: Long-Lived JWT Tokens (MEDIUM)

**Location:** `server/src/routes/auth.ts:523`

```typescript
const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
```

**Impact:**
- Stolen tokens valid for 7 days
- No refresh token mechanism
- No server-side token revocation

### Issue 5: Advisory Sessions (MEDIUM)

**Location:** `server/src/services/auditLogger.ts:174`

```typescript
} catch (error) {
  // Don't throw - session creation should never break the main flow
  return 'session-error';  // Returns dummy ID!
}
```

**Impact:**
- Session failures don't block login
- No server-side session enforcement
- Tokens can't be reliably invalidated

---

## Target Architecture

### Authentication Flow (Target)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        TARGET AUTH ARCHITECTURE                              │
└─────────────────────────────────────────────────────────────────────────────┘

                            ┌─────────────────┐
                            │   AuthContext   │
                            │                 │
                            │ • user          │
                            │ • isAuthenticated│
                            │ • isLoading     │
                            │ • role          │
                            │ • permissions   │
                            │ • tenantId      │
                            └────────┬────────┘
                                     │
           ┌─────────────────────────┼─────────────────────────┐
           │                         │                         │
    ┌──────▼──────┐          ┌──────▼──────┐          ┌──────▼──────┐
    │   Login     │          │ProtectedRoute│          │  useAuth   │
    │   Page      │          │  Wrapper     │          │   Hook     │
    └─────────────┘          └─────────────┘          └─────────────┘
           │                         │                         │
           │                         │                         │
    ┌──────▼──────────────────────────────────────────────────▼──────┐
    │                         API Client                              │
    │                                                                 │
    │  • Access token (15 min)     • Refresh token (7 days)          │
    │  • Auto-refresh on expiry    • Secure HttpOnly cookies         │
    │                                                                 │
    └─────────────────────────────────────────────────────────────────┘
```

### Key Components

1. **AuthContext** - Single source of truth for auth state
2. **AuthProvider** - Manages auth lifecycle (login, logout, refresh)
3. **ProtectedRoute** - Route wrapper with auth/role checks
4. **useAuth** - Hook for accessing auth state
5. **Token Refresh** - Automatic token refresh before expiry

---

## Implementation Plan

### Phase 1: Remove Security Vulnerabilities

| Task | Priority | Effort |
|------|----------|--------|
| Remove hardcoded credentials from App.tsx | CRITICAL | 30 min |
| Remove default `isAuthenticated = true` in Dashboard | CRITICAL | 15 min |
| Add basic route protection | CRITICAL | 1 hour |

### Phase 2: Create Auth Infrastructure

| Task | Priority | Effort |
|------|----------|--------|
| Create AuthContext and AuthProvider | HIGH | 2 hours |
| Create useAuth hook | HIGH | 30 min |
| Create ProtectedRoute component | HIGH | 1 hour |
| Integrate with existing Login page | HIGH | 1 hour |

### Phase 3: Refactor Existing Code

| Task | Priority | Effort |
|------|----------|--------|
| Remove auth from EditContext (rename to ContentContext) | MEDIUM | 1 hour |
| Remove local auth state from Navigation | MEDIUM | 30 min |
| Remove local auth state from Dashboard | MEDIUM | 30 min |
| Update all components to use useAuth | MEDIUM | 2 hours |

### Phase 4: Implement Token Refresh

| Task | Priority | Effort |
|------|----------|--------|
| Add refresh token endpoint to backend | MEDIUM | 2 hours |
| Implement auto-refresh in frontend | MEDIUM | 2 hours |
| Add token rotation for security | MEDIUM | 1 hour |

---

## Code Specifications

### AuthContext Interface

```typescript
// src/contexts/AuthContext.tsx

export interface User {
  id: string;
  email: string;
  fullName?: string;
  avatarUrl?: string;
  role: UserRole;
  tenantId?: string;
}

export type UserRole = 
  | 'super_admin' 
  | 'tenant_admin' 
  | 'admin' 
  | 'user' 
  | 'viewer' 
  | 'loan_officer' 
  | 'processor';

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  hasRole: (role: UserRole | UserRole[]) => boolean;
  hasPermission: (resource: string, action: string) => boolean;
}
```

### AuthProvider Implementation

```typescript
// src/contexts/AuthContext.tsx

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    error: null,
  });

  // Check for existing session on mount
  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem('auth_token');
      if (token) {
        try {
          const response = await api.getCurrentUser();
          setState({
            user: response.user,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });
        } catch (error) {
          // Token invalid, clear it
          api.clearToken();
          setState({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: null,
          });
        }
      } else {
        setState(prev => ({ ...prev, isLoading: false }));
      }
    };
    
    initAuth();
  }, []);

  // Auto-refresh token before expiry
  useEffect(() => {
    if (!state.isAuthenticated) return;
    
    const refreshInterval = setInterval(() => {
      refreshToken();
    }, 14 * 60 * 1000); // Refresh 1 minute before 15-min expiry
    
    return () => clearInterval(refreshInterval);
  }, [state.isAuthenticated]);

  const login = async (email: string, password: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    try {
      const response = await api.signIn(email, password);
      setState({
        user: response.user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (error: any) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error.message || 'Login failed',
      }));
      throw error;
    }
  };

  const logout = async () => {
    try {
      await api.signOut();
    } catch (error) {
      // Continue with logout even if API fails
    }
    api.clearToken();
    setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  };

  const hasRole = (role: UserRole | UserRole[]) => {
    if (!state.user) return false;
    const roles = Array.isArray(role) ? role : [role];
    return roles.includes(state.user.role);
  };

  const hasPermission = (resource: string, action: string) => {
    // Implement based on RBAC system
    if (!state.user) return false;
    if (state.user.role === 'super_admin') return true;
    // ... additional permission logic
    return false;
  };

  return (
    <AuthContext.Provider value={{
      ...state,
      login,
      logout,
      refreshToken,
      hasRole,
      hasPermission,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
```

### ProtectedRoute Component

```typescript
// src/components/auth/ProtectedRoute.tsx

interface ProtectedRouteProps {
  children: ReactNode;
  requiredRole?: UserRole | UserRole[];
  requiredPermission?: { resource: string; action: string };
  redirectTo?: string;
}

export function ProtectedRoute({
  children,
  requiredRole,
  requiredPermission,
  redirectTo = '/login',
}: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, hasRole, hasPermission } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!isAuthenticated) {
    // Redirect to login with return URL
    return <Navigate to={`${redirectTo}?returnTo=${location.pathname}`} replace />;
  }

  if (requiredRole && !hasRole(requiredRole)) {
    return <Navigate to="/unauthorized" replace />;
  }

  if (requiredPermission && !hasPermission(requiredPermission.resource, requiredPermission.action)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <>{children}</>;
}
```

### Updated App.tsx Routes

```typescript
// src/App.tsx

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
      <AuthProvider>  {/* NEW: Wrap app with AuthProvider */}
        <ContentProvider>  {/* RENAMED: from EditProvider */}
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <Router>
              <ScrollToTop />
              <Routes>
                {/* Public routes */}
                <Route path="/" element={<Index />} />
                <Route path="/login" element={<Login />} />
                
                {/* Protected routes */}
                <Route path="/insights" element={
                  <ProtectedRoute>
                    <Dashboard />
                  </ProtectedRoute>
                } />
                <Route path="/loans" element={
                  <ProtectedRoute>
                    <Loans />
                  </ProtectedRoute>
                } />
                
                {/* Admin routes - require admin role */}
                <Route path="/admin" element={
                  <ProtectedRoute requiredRole={['super_admin', 'tenant_admin', 'admin']}>
                    <Admin />
                  </ProtectedRoute>
                } />
                
                {/* Error routes */}
                <Route path="/unauthorized" element={<Unauthorized />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Router>
          </TooltipProvider>
        </ContentProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);
```

---

## Migration Strategy

### Step 1: Create New Auth Components (Non-Breaking)

Create new files without modifying existing code:
- `src/contexts/AuthContext.tsx`
- `src/components/auth/ProtectedRoute.tsx`
- `src/components/auth/LoadingSpinner.tsx`
- `src/pages/Unauthorized.tsx`

### Step 2: Remove Security Vulnerabilities

1. Delete AutoAuthenticator component from App.tsx
2. Remove hardcoded credentials
3. Remove `isAuthenticated = true` default in Dashboard.tsx

### Step 3: Integrate AuthProvider

1. Wrap App with AuthProvider
2. Update Login.tsx to use useAuth().login
3. Update Navigation.tsx to use useAuth() instead of local state

### Step 4: Add Route Protection

1. Wrap protected routes with ProtectedRoute
2. Test all routes require authentication
3. Verify role-based access for admin routes

### Step 5: Clean Up Legacy Code

1. Rename EditContext to ContentContext (remove auth concerns)
2. Remove local auth state from all components
3. Remove sessionStorage auth key usage
4. Update all components to use useAuth()

### Step 6: Implement Token Refresh (Backend)

1. Add `/api/auth/refresh` endpoint
2. Return new access token and rotate refresh token
3. Update frontend to auto-refresh

---

## Backend Changes Required

### New Endpoint: Token Refresh

```typescript
// server/src/routes/auth.ts

router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies?.refresh_token || req.body.refresh_token;
  
  if (!refreshToken) {
    return res.status(401).json({ error: 'Refresh token required' });
  }
  
  try {
    // Verify refresh token
    const decoded = jwt.verify(refreshToken, REFRESH_SECRET);
    
    // Check if session is still valid in database
    const session = await getSession(decoded.sessionId);
    if (!session || session.revoked) {
      return res.status(401).json({ error: 'Session revoked' });
    }
    
    // Generate new access token (15 min)
    const accessToken = jwt.sign(
      { userId: decoded.userId, email: decoded.email },
      JWT_SECRET,
      { expiresIn: '15m' }
    );
    
    // Rotate refresh token
    const newRefreshToken = jwt.sign(
      { userId: decoded.userId, sessionId: session.id },
      REFRESH_SECRET,
      { expiresIn: '7d' }
    );
    
    // Update session
    await updateSession(session.id, newRefreshToken);
    
    res.json({ accessToken, refreshToken: newRefreshToken });
  } catch (error) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
});
```

### Updated Sign In (Short-Lived Access Token)

```typescript
// server/src/routes/auth.ts

router.post('/signin', async (req, res) => {
  // ... validation ...
  
  // Generate short-lived access token (15 min)
  const accessToken = jwt.sign(
    { userId: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: '15m' }
  );
  
  // Generate refresh token (7 days)
  const sessionId = await createSession(user.id);
  const refreshToken = jwt.sign(
    { userId: user.id, sessionId },
    REFRESH_SECRET,
    { expiresIn: '7d' }
  );
  
  res.json({ 
    user: { id: user.id, email: user.email, role: user.role },
    accessToken,
    refreshToken 
  });
});
```

---

## Testing Checklist

- [ ] Remove hardcoded credentials - verify login required
- [ ] Navigate to /admin without auth - should redirect to /login
- [ ] Navigate to /insights without auth - should redirect to /login
- [ ] Login with valid credentials - should set auth state
- [ ] Logout - should clear all auth state and redirect
- [ ] Token expiry - should auto-refresh
- [ ] Invalid token - should redirect to login
- [ ] Role-based access - non-admin cannot access /admin
- [ ] Auth state persists across page refresh
- [ ] Multiple tabs share auth state

---

## Related Documentation

### Security
- [STATE_MANAGEMENT.md](./STATE_MANAGEMENT.md) - Frontend state consolidation
- [SSO_AUTHENTICATION.md](./SSO_AUTHENTICATION.md) - SSO strategy (Qlik Bridge + Cognito)
- [ROW_LEVEL_SECURITY.md](./ROW_LEVEL_SECURITY.md) - Custom field-based access control

### Architecture
- [OVERVIEW.md](../architecture/OVERVIEW.md) - System architecture
- [ADMIN_PANEL.md](../architecture/ADMIN_PANEL.md) - Admin panel architecture
- [INTERNAL_ADMIN_REQUIREMENTS.md](../architecture/INTERNAL_ADMIN_REQUIREMENTS.md) - TVMA admin features
- [CLIENT_ADMIN_REQUIREMENTS.md](../architecture/CLIENT_ADMIN_REQUIREMENTS.md) - Tenant admin features
