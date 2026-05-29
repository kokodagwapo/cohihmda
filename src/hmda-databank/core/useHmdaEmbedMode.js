import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

/** True when the HMDA app is embedded inside Cohi (iframe with ?embed=1). */
export function useHmdaEmbedMode() {
  const [searchParams] = useSearchParams()
  return useMemo(() => {
    const v = searchParams.get('embed')
    return v === '1' || v === 'true' || v === 'yes'
  }, [searchParams])
}
