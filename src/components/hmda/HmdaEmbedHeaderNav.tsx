import { Building2, Database, Home, Map } from 'lucide-react'
import { cn } from '@/lib/utils'

export type HmdaEmbedSection = 'search' | 'lenders' | 'products' | 'geography'

const NAV_ITEMS: Array<{
  id: HmdaEmbedSection
  label: string
  icon: typeof Home
  wellClass: string
  activeClass: string
}> = [
  { id: 'search', label: 'Home', icon: Home, wellClass: 'hmda-embed-nav-well--home', activeClass: 'hmda-embed-nav-active--home' },
  { id: 'lenders', label: 'Lenders', icon: Building2, wellClass: 'hmda-embed-nav-well--lenders', activeClass: 'hmda-embed-nav-active--lenders' },
  { id: 'products', label: 'Products', icon: Database, wellClass: 'hmda-embed-nav-well--products', activeClass: 'hmda-embed-nav-active--products' },
  { id: 'geography', label: 'Geography', icon: Map, wellClass: 'hmda-embed-nav-well--geography', activeClass: 'hmda-embed-nav-active--geography' },
]

type Props = {
  activeSection: HmdaEmbedSection
  onSectionChange: (section: HmdaEmbedSection) => void
}

export function HmdaEmbedHeaderNav({ activeSection, onSectionChange }: Props) {
  return (
    <nav
      className="hmda-embed-shell-nav flex shrink-0 items-center gap-1"
      aria-label="HMDA DataBank sections"
    >
      {NAV_ITEMS.map(({ id, label, icon: Icon, wellClass, activeClass }) => {
        const active = activeSection === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSectionChange(id)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'tab-item inline-flex items-center gap-2 rounded-xl border-0 px-3 py-2 font-inherit transition-all',
              active
                ? cn('shadow-[0_1px_6px_rgba(15,23,42,0.06)]', activeClass)
                : 'bg-transparent text-slate-600 hover:bg-white/50 dark:text-slate-300 dark:hover:bg-slate-800/40',
            )}
          >
            <span
              className={cn(
                'hmda-tab-icon-well inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]',
                wellClass,
              )}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
            </span>
            <span className="hidden text-sm font-semibold tracking-tight sm:inline">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
