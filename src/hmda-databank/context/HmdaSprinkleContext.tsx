import { createContext, useContext, type ReactNode } from 'react'

/** Native Coheus mount — no Sprinkle marketing shell. */
export const HmdaSprinkleContext = createContext(false)

export function useHmdaSprinkle() {
  return useContext(HmdaSprinkleContext)
}

export function HmdaSprinkleProvider({ children }: { children: ReactNode }) {
  return <HmdaSprinkleContext.Provider value={false}>{children}</HmdaSprinkleContext.Provider>
}
