import { Suspense, lazy, useEffect, Component, type ReactNode } from 'react'
import { HmdaAuthBridgeProvider } from '@hmda/context/HmdaAuthBridge'
import { HmdaSprinkleProvider } from '@hmda/context/HmdaSprinkleContext'
import '@hmda/hmda-databank.css'

export type HmdaInitialTab = 'lenders' | 'products' | 'geography' | null

function DashboardChunkError() {
  return (
    <div className="hmda-route-error">
      <div className="hmda-route-error-card">
        <h1 style={{ fontSize: '1.25rem', marginBottom: 12 }}>Could not load HMDA DataBank</h1>
        <p style={{ color: '#64748b', textAlign: 'center', maxWidth: 420 }}>
          The dashboard module failed to load. Refresh the page or check the browser console.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: 16,
            padding: '10px 20px',
            borderRadius: 10,
            border: 'none',
            cursor: 'pointer',
            background: '#0f172a',
            color: '#fff',
            fontWeight: 600,
          }}
        >
          Reload
        </button>
      </div>
    </div>
  )
}

function importDashboard(retriesLeft = 4, delayMs = 1200) {
  return import('@hmda/core/MortgageLenderDashboard.jsx').catch((err) => {
    const msg = String(err?.message || err)
    const retriable =
      retriesLeft > 0 &&
      (msg.includes('Failed to fetch dynamically imported module') ||
        msg.includes('Importing a module script failed'))
    if (!retriable) throw err
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        importDashboard(retriesLeft - 1, delayMs).then(resolve).catch(reject)
      }, delayMs)
    })
  })
}

const MortgageLenderDashboard = lazy(() =>
  importDashboard().catch((err) => {
    console.error('[HMDA] dashboard chunk failed', err)
    return { default: DashboardChunkError }
  }),
)

class HmdaErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null }

  static getDerivedStateFromError(err: Error) {
    return { err }
  }

  componentDidCatch(err: Error, info: { componentStack?: string }) {
    console.error('[HMDA]', err, info?.componentStack)
  }

  render() {
    if (this.state.err) return <DashboardChunkError />
    return this.props.children
  }
}

function SuspenseTracker({ initialTab, onReady }: { initialTab: HmdaInitialTab; onReady: () => void }) {
  useEffect(() => {
    onReady()
  }, [initialTab, onReady])
  return null
}

type Props = {
  initialTab: HmdaInitialTab
}

/** Native HMDA DataBank page — always embedded inside Coheus shell. */
export default function HmdaDataBankPage({ initialTab }: Props) {
  useEffect(() => {
    if (initialTab === 'geography') {
      import('@hmda/core/geography/preload-geography-assets.js')
        .then((m) => m.preloadGeographyAssets('2025'))
        .catch(() => {})
    }
  }, [initialTab])

  const handleChunkReady = () => {}

  return (
    <HmdaAuthBridgeProvider>
      <HmdaSprinkleProvider>
        <div className="hmda-databank-root" data-hmda-embed="1">
          <HmdaErrorBoundary>
            <Suspense
              fallback={
                <div
                  className="hmda-geo-skeleton hmda-geo-card-surface flex min-h-[320px] items-center justify-center text-sm text-muted-foreground"
                  aria-busy="true"
                >
                  Loading HMDA DataBank…
                </div>
              }
            >
              <SuspenseTracker initialTab={initialTab} onReady={handleChunkReady} />
              <MortgageLenderDashboard
                onHeroReady={() => {}}
                initialTab={initialTab}
                embedMode
              />
            </Suspense>
          </HmdaErrorBoundary>
        </div>
      </HmdaSprinkleProvider>
    </HmdaAuthBridgeProvider>
  )
}
