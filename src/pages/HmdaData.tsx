import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { Building2, Database, Map, Search } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DashboardLayout } from '@/components/dashboard/DashboardLayout'
import { useAuth } from '@/contexts/AuthContext'
import { useDashboardVisibility } from '@/hooks/useDashboardVisibility'
import { cn } from '@/lib/utils'
import type { ReportData } from '@/data/reportSimulations'
import HmdaDataBankPage, { type HmdaInitialTab } from '@hmda/HmdaDataBankPage'

type HmdaSection = 'search' | 'lenders' | 'products' | 'geography'

const SECTIONS: Array<{
  id: HmdaSection
  path: string
  label: string
  icon: typeof Building2
  initialTab: HmdaInitialTab
}> = [
  { id: 'search', path: 'search', label: 'HMDA Search', icon: Search, initialTab: null },
  { id: 'lenders', path: 'lenders', label: 'Lenders', icon: Building2, initialTab: 'lenders' },
  { id: 'products', path: 'products', label: 'Products', icon: Database, initialTab: 'products' },
  { id: 'geography', path: 'geography', label: 'Geography', icon: Map, initialTab: 'geography' },
]

function sectionFromPathname(pathname: string): HmdaSection {
  const tail = pathname.replace(/^\/hmda\/?/, '').split('/')[0]
  if (tail === 'lenders' || tail === 'products' || tail === 'geography') return tail
  return 'search'
}

/** Route outlet — one tab per nested /hmda/* path. */
export function HmdaDataBankOutlet() {
  const location = useLocation()
  const section = SECTIONS.find((s) => location.pathname.endsWith(`/${s.path}`)) ?? SECTIONS[0]
  return <HmdaDataBankPage key={section.id} initialTab={section.initialTab} />
}

const HmdaData = () => {
  const { user } = useAuth()
  const { dashboardVisibility, handleVisibilityChange } = useDashboardVisibility()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const activeSection = sectionFromPathname(location.pathname)

  const handleSectionChange = (next: HmdaSection) => {
    const target = SECTIONS.find((s) => s.id === next)
    if (target) navigate(`/hmda/${target.path}`)
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
      <div className="flex h-[calc(100vh-4rem)] flex-col bg-slate-50/80 dark:bg-slate-950">
        <header className="shrink-0 border-b border-white/35 bg-white/35 px-4 py-3 shadow-[0_10px_28px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-slate-700/35 dark:bg-slate-900/20 dark:shadow-[0_12px_34px_rgba(0,0,0,0.28)] sm:px-6">
          <Tabs value={activeSection} onValueChange={(v) => handleSectionChange(v as HmdaSection)}>
            <TabsList className="grid h-auto w-full max-w-2xl grid-cols-4 border border-white/45 bg-white/55 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] backdrop-blur-md dark:border-slate-700/45 dark:bg-slate-900/35">
              {SECTIONS.map(({ id, label, icon: Icon }) => (
                <TabsTrigger
                  key={id}
                  value={id}
                  className={cn(
                    'flex items-center justify-center gap-1.5 py-2 text-sm font-medium',
                    'data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm',
                    'dark:data-[state=active]:bg-slate-900 dark:data-[state=active]:text-emerald-400',
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span>{label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </header>

        <div className="relative min-h-0 flex-1 bg-white dark:bg-slate-950">
          <Outlet />
        </div>
      </div>
    </DashboardLayout>
  )
}

export default HmdaData
