import { Navigate, useLocation } from 'react-router-dom'

import { useState } from 'react'

import { DashboardLayout } from '@/components/dashboard/DashboardLayout'

import { useAuth } from '@/contexts/AuthContext'

import { useDashboardVisibility } from '@/hooks/useDashboardVisibility'

import type { ReportData } from '@/data/reportSimulations'

import { HmdaEmbedShellProvider, useHmdaEmbedShell } from '@hmda/context/HmdaEmbedShellContext'

import HmdaDataBankPage, { type HmdaInitialTab } from '@hmda/HmdaDataBankPage'

import '@hmda/hmda-databank.css'

import '@/components/hmda/hmda-embed-shell.css'

function sectionInitialTab(pathname: string): HmdaInitialTab {
  const tail = pathname.replace(/^\/hmda\/?/, '').split('/')[0]
  if (tail === 'lenders') return 'lenders'
  if (tail === 'products') return 'products'
  if (tail === 'geography') return 'geography'
  return null
}

function HmdaShellHeader() {
  const shell = useHmdaEmbedShell()
  const headerVisible = shell?.embedHeaderVisible ?? false

  return (
    <header
      className={`hmda-embed-shell-header shrink-0${headerVisible ? '' : ' hmda-embed-shell-header--hidden'}`}
      aria-hidden={!headerVisible}
    >
      <div
        ref={shell?.setHeaderSearchHost}
        className="hmda-embed-header-search-host min-h-[46px] w-full"
        aria-label="HMDA navigation and filters"
      />
    </header>
  )
}

function HmdaDataBody() {
  const location = useLocation()
  const initialTab = sectionInitialTab(location.pathname)

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-slate-50/80 dark:bg-slate-950">
      <HmdaShellHeader />

      <div className="relative min-h-0 flex-1 bg-white dark:bg-slate-950">
        <HmdaDataBankPage initialTab={initialTab} />
      </div>
    </div>
  )
}

const HmdaData = () => {
  const location = useLocation()
  const { user } = useAuth()
  const { dashboardVisibility, handleVisibilityChange } = useDashboardVisibility()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  if (location.pathname === '/hmda' || location.pathname === '/hmda/') {
    return <Navigate to="/hmda/search" replace />
  }

  return (
    <DashboardLayout
      enableChat={false}
      isAuthenticated={!!user}
      mobileMenuOpen={mobileMenuOpen}
      onMobileMenuToggle={() => setMobileMenuOpen((prev) => !prev)}
      dashboardVisibility={dashboardVisibility}
      onVisibilityChange={handleVisibilityChange}
      onReportClick={(_report: ReportData) => {}}
    >
      <HmdaEmbedShellProvider>
        <HmdaDataBody />
      </HmdaEmbedShellProvider>
    </DashboardLayout>
  )
}

export default HmdaData
