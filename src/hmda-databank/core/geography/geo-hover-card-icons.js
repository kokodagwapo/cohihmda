import {
  Banknote,
  Building2,
  CircleDot,
  Droplets,
  FileWarning,
  Flame,
  Grid2x2,
  Hash,
  Map,
  MapPin,
  PieChart,
  Scale,
  ShieldAlert,
  ShieldX,
  Undo2,
  Users,
  Wallet,
} from 'lucide-react'

export const GEO_KIND_ICON = {
  state: { Icon: MapPin, tone: 'indigo' },
  county: { Icon: Map, tone: 'emerald' },
  tract: { Icon: Grid2x2, tone: 'orange' },
}

export const METRIC_ROW_ICON = {
  volume: { Icon: Banknote, tone: 'indigo' },
  units: { Icon: Hash, tone: 'sky' },
  avgLoan: { Icon: Scale, tone: 'violet' },
  medianIncome: { Icon: Wallet, tone: 'cyan' },
  denialRate: { Icon: ShieldX, tone: 'rose' },
  withdrawnRate: { Icon: Undo2, tone: 'amber' },
  pullthroughRate: { Icon: PieChart, tone: 'emerald' },
  incompleteRate: { Icon: FileWarning, tone: 'amber' },
  demographics: { Icon: Users, tone: 'violet' },
  tractCount: { Icon: Grid2x2, tone: 'orange' },
  floodRisk: { Icon: Droplets, tone: 'blue' },
  wildfireRisk: { Icon: Flame, tone: 'orange' },
  compositeRisk: { Icon: ShieldAlert, tone: 'slate' },
}

export const LENDERS_SECTION_ICON = { Icon: Building2, tone: 'indigo' }

export const TRACTS_SECTION_ICON = { Icon: Grid2x2, tone: 'orange' }

const INCOME_TONE_ICON = {
  rose: { Icon: Wallet, tone: 'rose' },
  amber: { Icon: Wallet, tone: 'amber' },
  sky: { Icon: Wallet, tone: 'sky' },
  emerald: { Icon: Wallet, tone: 'emerald' },
  slate: { Icon: Wallet, tone: 'slate' },
}

export function geoKindIcon(kind) {
  return GEO_KIND_ICON[kind] || GEO_KIND_ICON.state
}

export function statRowIcon(rowKey) {
  return METRIC_ROW_ICON[rowKey] || { Icon: CircleDot, tone: 'slate' }
}

export function primaryMetricIcon(metricId) {
  return METRIC_ROW_ICON[metricId] || { Icon: Hash, tone: 'sky' }
}

export function incomeBracketIcon(tone) {
  return INCOME_TONE_ICON[tone] || INCOME_TONE_ICON.slate
}
