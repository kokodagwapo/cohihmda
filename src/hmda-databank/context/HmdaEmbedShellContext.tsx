import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

type HmdaEmbedShellContextValue = {
  headerSearchHost: HTMLElement | null
  setHeaderSearchHost: (el: HTMLElement | null) => void
  embedHeaderVisible: boolean
  setEmbedHeaderVisible: (visible: boolean) => void
}

const HmdaEmbedShellContext = createContext<HmdaEmbedShellContextValue | null>(null)

export function HmdaEmbedShellProvider({ children }: { children: ReactNode }) {
  const [headerSearchHost, setHeaderSearchHost] = useState<HTMLElement | null>(null)
  const [embedHeaderVisible, setEmbedHeaderVisible] = useState(false)
  const value = useMemo(
    () => ({ headerSearchHost, setHeaderSearchHost, embedHeaderVisible, setEmbedHeaderVisible }),
    [headerSearchHost, embedHeaderVisible],
  )
  return <HmdaEmbedShellContext.Provider value={value}>{children}</HmdaEmbedShellContext.Provider>
}

export function useHmdaEmbedShell() {
  return useContext(HmdaEmbedShellContext)
}
