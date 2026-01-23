/**
 * Re-export auth hooks from AuthContext
 * This provides a convenient import path: import { useAuth } from '@/hooks/useAuth'
 */
export { useAuth, useRequireAuth } from '@/contexts/AuthContext';
export type { AuthUser, UserRole } from '@/contexts/AuthContext';
