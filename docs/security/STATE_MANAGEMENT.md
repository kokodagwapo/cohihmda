# Frontend State Management Refactor

This document outlines the plan to consolidate and refactor frontend state management in Cohi, addressing the fragmented state issue and establishing clear patterns for different types of state.

> **Naming Convention:**
> - **Cohi** - The new executive intelligence platform (this product)
> - **Coheus** - The legacy Qlik Sense-based product

## Table of Contents

- [Current State Analysis](#current-state-analysis)
- [Problems Identified](#problems-identified)
- [Target Architecture](#target-architecture)
- [State Categories](#state-categories)
- [Implementation Plan](#implementation-plan)
- [Code Specifications](#code-specifications)
- [Migration Guide](#migration-guide)

---

## Current State Analysis

### State Locations (Current)

The Coheus frontend currently stores state in multiple locations without clear organization:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CURRENT STATE FRAGMENTATION                               │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ React Contexts                                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   EditContext.tsx                                                           │
│   ├── isEditMode: boolean          (editing state)                          │
│   ├── isAuthenticated: boolean     (WRONG LOCATION - auth state)            │
│   ├── editableContent: object      (dashboard customization)                │
│   └── isSaving, lastSaved          (save state)                             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ Component Local State                                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Navigation.tsx                                                            │
│   ├── apiAuthenticated: boolean    (DUPLICATE - auth state)                 │
│   └── userName: string             (SHOULD BE IN USER CONTEXT)              │
│                                                                              │
│   Dashboard.tsx                                                             │
│   ├── isAuthenticated: boolean     (DUPLICATE - set to TRUE!)               │
│   ├── selectedTenantId: string     (SHOULD BE IN TENANT CONTEXT)            │
│   ├── selectedChannel: string      (filter state - OK locally)              │
│   └── briefingContext: object      (data fetching state - OK)               │
│                                                                              │
│   Admin.tsx                                                                 │
│   └── selectedTenantId: string     (DUPLICATE - same as Dashboard)          │
│                                                                              │
│   Loans.tsx                                                                 │
│   └── selectedTenantId: string     (DUPLICATE - same as Dashboard)          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ Browser Storage                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   localStorage                                                              │
│   ├── auth_token                   (JWT - managed by api.ts)                │
│   ├── editable_dashboard_content   (dashboard customization)                │
│   ├── vite-ui-theme                (theme preference)                       │
│   └── user_preference_name         (Navigation.tsx)                         │
│                                                                              │
│   sessionStorage                                                            │
│   └── dashboard_auth               (DUPLICATE - redundant auth flag)        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ TanStack Query                                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   QueryClient cache                                                         │
│   ├── Server data (loans, metrics, etc.)                                    │
│   └── Automatic caching and invalidation                                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Files with State Issues

| File | State Issue | Impact |
|------|-------------|--------|
| `EditContext.tsx` | Mixes editing and auth concerns | Confusing, maintenance burden |
| `Navigation.tsx` | Duplicates auth check, stores user name | Inconsistent UI |
| `Dashboard.tsx` | `isAuthenticated = true` default | Security bypass |
| `Dashboard.tsx` | Local `selectedTenantId` | Not shared with other pages |
| `Admin.tsx` | Local `selectedTenantId` | Duplicated from Dashboard |
| `Loans.tsx` | Local `selectedTenantId` | Duplicated from Dashboard |
| `api.ts` | Token only, no reactive state | Components must poll |

---

## Problems Identified

### Problem 1: Authentication State Duplication

Authentication is checked/stored in 5+ places:

```typescript
// EditContext.tsx - One source
const [isAuthenticated, setIsAuthenticated] = useState(false);

// Navigation.tsx - Another source (polls API)
const [apiAuthenticated, setApiAuthenticated] = useState(false);

// Dashboard.tsx - Yet another source (defaults to TRUE!)
const [isAuthenticated, setIsAuthenticated] = useState(true);

// api.ts - Token storage (not reactive)
this.token = localStorage.getItem('auth_token');

// sessionStorage - Redundant flag
sessionStorage.getItem('dashboard_auth');
```

**Result**: Components show inconsistent authentication state.

### Problem 2: Tenant Selection Not Shared

Each page manages its own tenant selection:

```typescript
// Dashboard.tsx
const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);

// Admin.tsx  
const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);

// Loans.tsx
const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
```

**Result**: Selecting a tenant on Dashboard doesn't persist when navigating to Admin or Loans.

### Problem 3: User Info Scattered

User information is fetched and stored in multiple components:

```typescript
// Navigation.tsx - Fetches user, stores name
const [userName, setUserName] = useState<string | null>(null);
const checkAuth = async () => {
  const response = await api.getCurrentUser();
  setUserName(response.user?.full_name?.split(' ')[0]);
};

// Dashboard.tsx - Uses briefingContext for userName
const [briefingContext, setBriefingContext] = useState<{
  userName?: string;
} | null>(null);
```

**Result**: Multiple API calls for the same data, inconsistent user display.

### Problem 4: EditContext Misnamed

`EditContext` handles both editing AND authentication:

```typescript
interface EditContextType {
  // Editing concerns
  isEditMode: boolean;
  editableContent: EditableContent;
  updateContent: (key: string, value: string | number) => void;
  
  // Authentication concerns (SHOULD NOT BE HERE)
  isAuthenticated: boolean;
  setIsAuthenticated: (value: boolean) => void;
  logout: () => void;
}
```

**Result**: Confusing API, tight coupling between unrelated features.

---

## Target Architecture

### State Organization (Target)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        TARGET STATE ARCHITECTURE                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ Global State (React Contexts)                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   AuthContext        │ User authentication state                            │
│   ├── user           │ Current user object (id, email, role)                │
│   ├── isAuthenticated│ Boolean flag                                         │
│   ├── isLoading      │ Auth check in progress                               │
│   ├── login()        │ Login function                                       │
│   ├── logout()       │ Logout function                                      │
│   └── hasRole()      │ Role check helper                                    │
│                                                                              │
│   TenantContext      │ Multi-tenant selection (admin only)                  │
│   ├── selectedTenantId│ Currently selected tenant                           │
│   ├── tenants        │ List of available tenants                            │
│   ├── selectTenant() │ Change tenant                                        │
│   └── tenantInfo     │ Selected tenant details                              │
│                                                                              │
│   ContentContext     │ Dashboard customization (renamed from EditContext)   │
│   ├── isEditMode     │ Edit mode toggle                                     │
│   ├── editableContent│ Custom content                                       │
│   └── updateContent()│ Update function                                      │
│                                                                              │
│   ThemeContext       │ Theme preference (existing)                          │
│   └── theme          │ 'light' | 'dark' | 'system'                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ Server State (TanStack Query)                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   • Loan data        │ useQuery(['loans', tenantId, filters])               │
│   • Metrics          │ useQuery(['metrics', tenantId, dateRange])           │
│   • Dashboard stats  │ useQuery(['dashboardStats', tenantId])               │
│   • Leaderboard      │ useQuery(['leaderboard', tenantId, timeframe])       │
│   • Admin data       │ useQuery(['tenants']), useQuery(['users'])           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ Local State (Component useState)                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   • UI state         │ Modal open/closed, accordion expanded                │
│   • Form state       │ Input values (consider react-hook-form)              │
│   • Filter state     │ Local filters not needed elsewhere                   │
│   • Pagination       │ Page number, page size                               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ Persistent State (Browser Storage)                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   localStorage                                                              │
│   ├── auth_token     │ JWT token (managed by api.ts)                        │
│   ├── refresh_token  │ Refresh token (future)                               │
│   ├── theme          │ Theme preference                                     │
│   └── dashboard_content │ Dashboard customizations                          │
│                                                                              │
│   sessionStorage                                                            │
│   └── (none needed)  │ Remove dashboard_auth                                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Context Provider Hierarchy

```typescript
// src/App.tsx

<QueryClientProvider client={queryClient}>
  <ThemeProvider>
    <AuthProvider>           {/* NEW - Authentication */}
      <TenantProvider>       {/* NEW - Tenant selection */}
        <ContentProvider>    {/* RENAMED - from EditProvider */}
          <TooltipProvider>
            <Router>
              <Routes />
            </Router>
          </TooltipProvider>
        </ContentProvider>
      </TenantProvider>
    </AuthProvider>
  </ThemeProvider>
</QueryClientProvider>
```

---

## State Categories

### 1. Authentication State

**Location**: `AuthContext`
**Persistence**: localStorage (token only)
**Scope**: Global

| Property | Type | Description |
|----------|------|-------------|
| `user` | `User \| null` | Current user object |
| `isAuthenticated` | `boolean` | Is user logged in |
| `isLoading` | `boolean` | Auth check in progress |
| `error` | `string \| null` | Auth error message |

### 2. Tenant State

**Location**: `TenantContext`
**Persistence**: None (resets on page load)
**Scope**: Global (for admins)

| Property | Type | Description |
|----------|------|-------------|
| `selectedTenantId` | `string \| null` | Selected tenant ID |
| `tenants` | `Tenant[]` | Available tenants |
| `tenantInfo` | `Tenant \| null` | Selected tenant details |
| `isLoading` | `boolean` | Loading tenants |

### 3. Content State

**Location**: `ContentContext`
**Persistence**: localStorage
**Scope**: Global

| Property | Type | Description |
|----------|------|-------------|
| `isEditMode` | `boolean` | Dashboard edit mode |
| `editableContent` | `Record<string, any>` | Custom content |
| `isSaving` | `boolean` | Save in progress |
| `lastSaved` | `Date \| null` | Last save time |

### 4. Server State

**Location**: TanStack Query
**Persistence**: In-memory cache (configurable)
**Scope**: Per-query

All server data should be fetched via TanStack Query hooks:

```typescript
// Example: Fetch loans with tenant context
const { data: loans, isLoading } = useQuery({
  queryKey: ['loans', selectedTenantId, filters],
  queryFn: () => api.getLoans(selectedTenantId, filters),
  enabled: !!selectedTenantId,
});
```

### 5. UI State

**Location**: Component `useState`
**Persistence**: None
**Scope**: Component

Keep truly local state in components:

```typescript
// Good - UI state stays local
const [isModalOpen, setIsModalOpen] = useState(false);
const [expandedRow, setExpandedRow] = useState<string | null>(null);

// Bad - Should be in context
const [selectedTenantId, setSelectedTenantId] = useState(null); // Move to TenantContext
```

---

## Implementation Plan

### Phase 1: Create New Contexts

| Task | File | Description |
|------|------|-------------|
| Create AuthContext | `src/contexts/AuthContext.tsx` | See [AUTH_REFACTOR.md](./AUTH_REFACTOR.md) |
| Create TenantContext | `src/contexts/TenantContext.tsx` | Tenant selection |
| Create ContentContext | `src/contexts/ContentContext.tsx` | Rename from EditContext |

### Phase 2: Migrate Components

| Component | Changes |
|-----------|---------|
| `App.tsx` | Add new providers, update hierarchy |
| `Navigation.tsx` | Remove local auth state, use `useAuth()` |
| `Dashboard.tsx` | Remove local state, use contexts |
| `Admin.tsx` | Remove local tenant state, use `useTenant()` |
| `Loans.tsx` | Remove local tenant state, use `useTenant()` |
| `Login.tsx` | Use `useAuth().login()` |

### Phase 3: Clean Up

| Task | Description |
|------|-------------|
| Remove `EditContext` auth | Delete auth-related code |
| Remove `sessionStorage` auth | Delete `dashboard_auth` usage |
| Remove duplicate state | Clean up local state in components |
| Update custom hooks | Use contexts instead of local state |

---

## Code Specifications

### TenantContext

```typescript
// src/contexts/TenantContext.tsx

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { api } from '@/lib/api';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
}

interface TenantContextType {
  selectedTenantId: string | null;
  tenants: Tenant[];
  tenantInfo: Tenant | null;
  isLoading: boolean;
  error: string | null;
  selectTenant: (tenantId: string | null) => void;
  canSelectTenant: boolean;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, hasRole } = useAuth();
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only admins can select tenants
  const canSelectTenant = hasRole(['super_admin', 'tenant_admin', 'admin']);

  // Load available tenants for admins
  useEffect(() => {
    if (!isAuthenticated || !canSelectTenant) return;

    const loadTenants = async () => {
      setIsLoading(true);
      try {
        const response = await api.request<{ tenants: Tenant[] }>('/api/admin/tenants');
        setTenants(response.tenants);
        
        // Auto-select first tenant if none selected
        if (response.tenants.length > 0 && !selectedTenantId) {
          setSelectedTenantId(response.tenants[0].id);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    loadTenants();
  }, [isAuthenticated, canSelectTenant]);

  // Set user's default tenant for non-admins
  useEffect(() => {
    if (!isAuthenticated || canSelectTenant) return;
    
    if (user?.tenantId) {
      setSelectedTenantId(user.tenantId);
    }
  }, [isAuthenticated, user?.tenantId, canSelectTenant]);

  const selectTenant = (tenantId: string | null) => {
    if (!canSelectTenant && tenantId !== user?.tenantId) {
      console.warn('User cannot select different tenant');
      return;
    }
    setSelectedTenantId(tenantId);
  };

  const tenantInfo = tenants.find(t => t.id === selectedTenantId) || null;

  return (
    <TenantContext.Provider value={{
      selectedTenantId,
      tenants,
      tenantInfo,
      isLoading,
      error,
      selectTenant,
      canSelectTenant,
    }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error('useTenant must be used within TenantProvider');
  }
  return context;
}
```

### ContentContext (Renamed from EditContext)

```typescript
// src/contexts/ContentContext.tsx

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

interface EditableContent {
  [key: string]: string | number;
}

interface ContentContextType {
  isEditMode: boolean;
  setIsEditMode: (value: boolean) => void;
  editableContent: EditableContent;
  updateContent: (key: string, value: string | number) => void;
  isSaving: boolean;
  lastSaved: Date | null;
}

const ContentContext = createContext<ContentContextType | undefined>(undefined);

const STORAGE_KEY = 'dashboard_content';

export function ContentProvider({ children }: { children: ReactNode }) {
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [editableContent, setEditableContent] = useState<EditableContent>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  // Persist to localStorage
  useEffect(() => {
    if (Object.keys(editableContent).length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(editableContent));
      } catch (error) {
        console.warn('Failed to persist content:', error);
      }
    }
  }, [editableContent]);

  const updateContent = useCallback((key: string, value: string | number) => {
    setIsSaving(true);
    setEditableContent(prev => ({ ...prev, [key]: value }));
    setLastSaved(new Date());
    setIsSaving(false);
  }, []);

  return (
    <ContentContext.Provider value={{
      isEditMode,
      setIsEditMode,
      editableContent,
      updateContent,
      isSaving,
      lastSaved,
    }}>
      {children}
    </ContentContext.Provider>
  );
}

export function useContent() {
  const context = useContext(ContentContext);
  if (!context) {
    throw new Error('useContent must be used within ContentProvider');
  }
  return context;
}
```

### Updated Component Example

```typescript
// src/pages/Dashboard.tsx (refactored)

import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { useContent } from '@/contexts/ContentContext';

const Dashboard = () => {
  const { user, isAuthenticated } = useAuth();
  const { selectedTenantId, canSelectTenant } = useTenant();
  const { isEditMode, editableContent } = useContent();

  // Local UI state only
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);

  // Server state via TanStack Query
  const { data: dashboardData, isLoading } = useQuery({
    queryKey: ['dashboard', selectedTenantId, selectedChannel],
    queryFn: () => fetchDashboardData(selectedTenantId, selectedChannel),
    enabled: isAuthenticated && !!selectedTenantId,
  });

  // No more local auth state!
  // No more local tenant state!
  // No more polling for user info!

  return (
    <DashboardLayout>
      {canSelectTenant && <TenantSelector />}
      {/* ... */}
    </DashboardLayout>
  );
};
```

---

## Migration Guide

### Step 1: Create New Contexts

1. Create `src/contexts/AuthContext.tsx` (see [AUTH_REFACTOR.md](./AUTH_REFACTOR.md))
2. Create `src/contexts/TenantContext.tsx` (see above)
3. Create `src/contexts/ContentContext.tsx` (copy from EditContext, remove auth)

### Step 2: Update App.tsx

```typescript
// Before
<EditProvider>
  <Router>...</Router>
</EditProvider>

// After
<AuthProvider>
  <TenantProvider>
    <ContentProvider>
      <Router>...</Router>
    </ContentProvider>
  </TenantProvider>
</AuthProvider>
```

### Step 3: Update Components

For each component with local auth/tenant state:

```typescript
// Before
const [selectedTenantId, setSelectedTenantId] = useState(null);
const [isAuthenticated, setIsAuthenticated] = useState(true);

// After
const { selectedTenantId } = useTenant();
const { isAuthenticated } = useAuth();
```

### Step 4: Remove Old Code

1. Delete auth code from `EditContext.tsx`
2. Delete `sessionStorage` `dashboard_auth` usage
3. Delete local auth/tenant state from components
4. Delete duplicate `checkAuth` functions

### Step 5: Test

- [ ] Login redirects to protected route
- [ ] Logout clears all state
- [ ] Tenant selection persists across pages
- [ ] Edit mode works independently of auth
- [ ] Theme preference persists

---

## Related Documentation

### Security
- [AUTH_REFACTOR.md](./AUTH_REFACTOR.md) - Authentication architecture
- [SSO_AUTHENTICATION.md](./SSO_AUTHENTICATION.md) - SSO strategy (Qlik Bridge + Cognito)
- [ROW_LEVEL_SECURITY.md](./ROW_LEVEL_SECURITY.md) - Custom field-based access control

### Architecture
- [OVERVIEW.md](../architecture/OVERVIEW.md) - System architecture
- [ADMIN_PANEL.md](../architecture/ADMIN_PANEL.md) - Admin panel architecture
- [CLIENT_ADMIN_REQUIREMENTS.md](../architecture/CLIENT_ADMIN_REQUIREMENTS.md) - Tenant admin features
