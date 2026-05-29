import React, { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'

type HmdaAuthBridgeValue = {
  user: { email?: string; name?: string } | null
  isSignedIn: boolean
  isOrgAdmin: boolean
  maxComparePins: number
  serverChecked: boolean
  signOut: () => Promise<void>
  refreshAuth: () => Promise<void>
  startDemoSession: () => void
  signInWithPassword: () => Promise<{ ok: false; error: string }>
  registerAccount: () => Promise<{ ok: false; error: string }>
}

const HmdaAuthBridgeContext = createContext<HmdaAuthBridgeValue | null>(null)

/** Maps Coheus AuthContext → HMDA DataBank useHmdaAuth contract. */
export function HmdaAuthBridgeProvider({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()

  const value = useMemo<HmdaAuthBridgeValue>(() => {
    const signedIn = Boolean(user)
    return {
      user: signedIn
        ? {
            email: user?.email,
            name: user?.full_name || user?.email,
          }
        : null,
      isSignedIn: signedIn,
      isOrgAdmin: false,
      maxComparePins: signedIn ? 8 : 3,
      serverChecked: true,
      signOut: async () => {
        await logout()
      },
      refreshAuth: async () => {},
      startDemoSession: () => {},
      signInWithPassword: async () => ({ ok: false, error: 'Use Coheus sign-in' }),
      registerAccount: async () => ({ ok: false, error: 'Use Coheus sign-in' }),
    }
  }, [user, logout])

  return (
    <HmdaAuthBridgeContext.Provider value={value}>{children}</HmdaAuthBridgeContext.Provider>
  )
}

export function useHmdaAuth() {
  const ctx = useContext(HmdaAuthBridgeContext)
  if (!ctx) throw new Error('useHmdaAuth must be used within HmdaAuthBridgeProvider')
  return ctx
}

export const HmdaAuthProvider = HmdaAuthBridgeProvider
