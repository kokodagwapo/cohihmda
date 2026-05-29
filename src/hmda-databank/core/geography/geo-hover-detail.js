/** Hover card payload for Mapbox geography — metrics, income band, lenders, sources. */

import { formatMetricValue, getMetricValue, metricById } from './geo-map-metrics.js'
import { collectTopCensusTracts } from './geo-map-features.js'
import { dispositionSourceLabel, rankLendersForGeography } from './geo-map-lenders.js'
import { US_STATE_NAMES } from './geo-us-states.js'

export const GEO_DATA_SOURCES = [
  {
    id: 'hmda',
    label: 'CFPB HMDA',
    href: 'https://ffiec.cfpb.gov/data-browser/',
    note: 'Originated loans & volume (action taken = originated)',
  },
  {
    id: 'ffiec',
    label: 'FFIEC',
    href: 'https://www.ffiec.gov/',
    note: 'Institution registry & call reports (not loan-level on this card)',
  },
  {
    id: 'acs',
    label: 'Census ACS',
    href: 'https://www.census.gov/programs-surveys/acs',
    note: 'Area median household income proxy',
  },
  {
    id: 'gazetteer',
    label: 'Census Gazetteer',
    href: 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html',
    note: '2020 census tract internal point coordinates (GEOID)',
  },
  {
    id: 'fnma',
    label: 'Fannie Mae',
    href: 'https://singlefamily.fanniemae.com/',
    note: 'Agency conforming market context',
  },
  {
    id: 'fhlmc',
    label: 'Freddie Mac',
    href: 'https://sf.freddiemac.com/',
    note: 'Agency conforming market context',
  },
  {
    id: 'fed',
    label: 'Federal Reserve',
    href: 'https://www.federalreserve.gov/',
    note: 'Macro & mortgage market conditions',
  },
]

/** HUD-style income band vs state median (area ACS proxy). */
export function classifyIncomeBracket(medianIncome, stateMedian = 75000) {
  const med = Number(medianIncome)
  const base = Number(stateMedian) || 75000
  if (!Number.isFinite(med) || med <= 0) {
    return {
      band: '—',
      label: 'Income data unavailable',
      tone: 'slate',
      detail: 'ACS median not loaded for this area',
    }
  }
  const ratio = med / base
  if (ratio < 0.8) {
    return {
      band: 'LMI',
      label: 'Low-to-moderate income',
      tone: 'rose',
      detail: `${fmtK(med)} area median · ${fmtK(base)} state median`,
    }
  }
  if (ratio < 1.0) {
    return {
      band: 'Mod',
      label: 'Moderate income',
      tone: 'amber',
      detail: `${fmtK(med)} area median`,
    }
  }
  if (ratio < 1.25) {
    return {
      band: 'Median Income',
      label: 'Middle income',
      tone: 'sky',
      detail: `${fmtK(med)} area median`,
    }
  }
  return {
    band: 'Upper',
    label: 'Upper income',
    tone: 'emerald',
    detail: `${fmtK(med)} area median`,
  }
}

function fmtK(n) {
  const v = Number(n) || 0
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`
  return `$${v.toLocaleString()}`
}

function fmtUnits(n) {
  const v = Number(n) || 0
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 10e6 ? 0 : 1)}M units`
  if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 100e3 ? 0 : 1)}K units`
  return `${v.toLocaleString()} units`
}

/**
 * @deprecated Replaced by real HMDA applicant diversity score from the drilldown pipeline.
 * Kept as a no-op export so any lingering import references don't break at runtime.
 */
export function modeledDemographicsIndex() { return null }

export function geoFeatureKind(feature) {
  const lid = feature?.layer?.id || ''
  if (lid === 'geo-tracts-circle' || lid === 'geo-tracts-globe-dots') return 'tract'
  if (lid === 'geo-counties-fill') return 'county'
  if (lid === 'geo-state-pins-circle') return 'state'
  const p = feature?.properties || {}
  if (p.censusTract != null && String(p.censusTract).length > 0) return 'tract'
  if (p.fips != null && String(p.fips).length === 5 && !p.censusTract) return 'county'
  return 'state'
}

function dispositionDetailSuffix(p) {
  return dispositionSourceLabel(p.dispositionSource)
}

function dispositionFootnote(kind, p, lenderCtx) {
  const src = p.dispositionSource
  const stateCode = p.state || null
  if (src?.startsWith('hmda')) {
    if (kind === 'county' || kind === 'tract') {
      return 'Denial, withdrawn, and origination share use the HMDA LAR panel rate for this state (public action_taken counts). County and tract rows do not have separate disposition geography in the public drilldown file.'
    }
    const apps = stateCode ? lenderCtx?.dispositionByState?.[stateCode]?.totalApplications : null
    if (apps) {
      return `Rates from ${apps.toLocaleString()} panel LAR applications in this state (action_taken codes 1–8). Same source as lender declinations / fallout cards.`
    }
    if (src === 'hmda-panel-inherited') {
      const yr = lenderCtx?.dispositionYear
      return yr
        ? `Rates from the ${yr} HMDA LAR panel aggregate (action_taken codes 1–8). State-level breakdown is not in the lender extract yet.`
        : 'Rates from the national HMDA LAR panel aggregate (action_taken codes 1–8).'
    }
    const yr = lenderCtx?.dispositionYear
    if (yr) {
      return `Rates from aggregated ${yr} HMDA LAR action_taken counts on the loaded lender panel (CFPB public data).`
    }
    return 'Rates from aggregated HMDA LAR action_taken counts on the loaded lender panel (CFPB public data).'
  }
  return null
}

/**
 * @param {object} feature — Mapbox feature or synthetic { properties, layer }
 * @param {object} metric — from metricById
 * @param {object} lenderCtx — { lenders, panelYear, geoYear, stateRankCache, stateMedians }
 */
export function buildGeoHoverDetail(feature, metric, lenderCtx) {
  const p = feature?.properties || {}
  const kind = geoFeatureKind(feature)
  const stateCode = p.state || null
  const countyFips = kind === 'county' ? p.fips : p.countyFips
  const censusTract = kind === 'tract' ? p.censusTract : null
  const stateMedian = lenderCtx?.stateMedians?.[stateCode] ?? 75000

  const stateLabel = stateCode ? US_STATE_NAMES[stateCode] || stateCode : null

  const focus = lenderCtx?.mapLenderFocus
  const lenderFocusName = focus?.name ? String(focus.name).trim() : null
  const lenderFocusYear = focus?.year ?? lenderCtx?.panelYear ?? null
  const lenderInsightsReady = Boolean(focus?.insightsReady)
  const lenderInsightsLoading = Boolean(focus?.insightsLoading)
  const lenderFocusActive = Boolean(lenderFocusName)
  const lenderEst = Boolean(p.lenderEst || p.lenderFiltered)

  let geoTitle = stateLabel ? `${stateLabel} (${stateCode})` : p.state || 'Area'
  if (kind === 'tract') {
    const tractCode = p.censusTract || '—'
    geoTitle = tractCode.length > 6 ? `Tract …${tractCode.slice(-6)}` : `Tract ${tractCode}`
  }
  if (kind === 'county') geoTitle = p.name ? p.name : `County ${countyFips || ''}`

  let geoSubtitle =
    kind === 'tract'
      ? [stateCode, p.countyName || countyFips].filter(Boolean).join(' · ')
      : kind === 'county'
        ? [stateCode, countyFips ? `FIPS ${countyFips}` : null].filter(Boolean).join(' · ')
        : 'United States'

  let title = geoTitle
  let subtitle = geoSubtitle
  let subtitleIncludesYear = false

  if (lenderFocusActive) {
    const yearTag = lenderFocusYear ? `HMDA ${lenderFocusYear}` : null
    const unitTag = Number(focus?.totalOriginated) > 0 ? fmtUnits(focus.totalOriginated) : null
    subtitle = [lenderFocusName, geoSubtitle, yearTag, unitTag].filter(Boolean).join(' · ')
    subtitleIncludesYear = Boolean(yearTag)
  }

  const incomeBracket = classifyIncomeBracket(p.medianIncome, stateMedian)

  const lines = []
  const push = (rowKey, k, v, source) => lines.push({ rowKey, k, v, source })

  const units = p.units ?? p.loanUnits
  // Suppress market unit/volume values whenever lender is focused but breakdown is not
  // ready (covers both the loading phase AND failed/empty breakdown after load completes).
  const suppressMarketValues = lenderFocusActive && !lenderInsightsReady && !lenderEst
  if (!suppressMarketValues && units != null && Number(units) > 0) {
    const unitsLabel =
      lenderFocusActive && lenderEst && kind === 'tract'
        ? 'Est. originated (lender)'
        : lenderFocusActive
          ? 'Originated loans (lender)'
          : 'Originated loans'
    push('units', unitsLabel, `${Number(units).toLocaleString()}`, 'CFPB HMDA')
  }
  if (lenderFocusActive && !lenderInsightsReady && kind !== 'tract') {
    const msg = lenderInsightsLoading ? 'Loading state data…' : 'State data unavailable'
    push('units', 'Originated loans (lender)', msg, 'FFIEC')
  }
  if (lenderFocusActive && lenderEst && kind === 'tract' && p.lenderShare != null) {
    push(
      'lenderShare',
      'Est. state share',
      `${Number(p.lenderShare).toFixed(1)}% of market tract pattern`,
      'FFIEC state breakdown × HMDA',
    )
  }
  if (!suppressMarketValues && p.volume != null && Number(p.volume) > 0) {
    push('volume', 'Originated volume', formatMetricValue(metricById('volume'), p.volume), 'CFPB HMDA')
  }
  if (!suppressMarketValues && p.avgLoan != null && Number(p.avgLoan) > 0) {
    push('avgLoan', 'Avg loan size', formatMetricValue(metricById('avgLoan'), p.avgLoan), 'CFPB HMDA')
  }
  if (p.medianIncome != null && Number.isFinite(Number(p.medianIncome))) {
    push(
      'medianIncome',
      'Median HH income',
      formatMetricValue(metricById('medianIncome'), p.medianIncome),
      'Census ACS proxy',
    )
  }

  // Real applicant diversity metrics — only present after geo-drilldown rebuild with
  // derived_race / derived_ethnicity columns. State-level only (not county/tract).
  if (kind === 'state' && p.diversityScore != null && Number.isFinite(Number(p.diversityScore))) {
    push(
      'demographics',
      'Applicant diversity (HHI)',
      `${Number(p.diversityScore)}/100 · Simpson's index across race/ethnicity buckets`,
      'CFPB HMDA LAR applicants',
    )
  }
  if (kind === 'state' && p.minorityShare != null && Number.isFinite(Number(p.minorityShare))) {
    push(
      'minorityShare',
      'Minority applicant share',
      `${Number(p.minorityShare).toFixed(1)}% of known-race applicants`,
      'CFPB HMDA LAR — derived_race / derived_ethnicity',
    )
  }

  const dispSuffix = dispositionDetailSuffix(p)
  const hmdaOutcomeSource = dispSuffix || 'HMDA outcomes'
  if (p.denialRate != null && Number.isFinite(Number(p.denialRate))) {
    const val = formatMetricValue(metricById('denialRate'), p.denialRate)
    push('denialRate', 'Denial rate', dispSuffix ? `${val} · ${dispSuffix}` : val, hmdaOutcomeSource)
  }
  if (p.withdrawnRate != null && Number.isFinite(Number(p.withdrawnRate))) {
    const val = formatMetricValue(metricById('withdrawnRate'), p.withdrawnRate)
    push('withdrawnRate', 'Withdrawn rate', dispSuffix ? `${val} · ${dispSuffix}` : val, hmdaOutcomeSource)
  }
  if (p.pullthroughRate != null && Number.isFinite(Number(p.pullthroughRate))) {
    const val = formatMetricValue(metricById('pullthroughRate'), p.pullthroughRate)
    push(
      'pullthroughRate',
      'Origination share',
      dispSuffix ? `${val} · ${dispSuffix}` : val,
      hmdaOutcomeSource,
    )
  }
  if (p.incompleteRate != null && Number.isFinite(Number(p.incompleteRate))) {
    const val = formatMetricValue(metricById('denialRate'), p.incompleteRate)
    push(
      'incompleteRate',
      'Incomplete file rate',
      dispSuffix ? `${val} · ${dispSuffix}` : val,
      hmdaOutcomeSource,
    )
  }
  if (p.floodRisk != null && Number.isFinite(Number(p.floodRisk))) {
    push('floodRisk', 'Flood hazard', `${p.floodRisk}/100`, 'FEMA-style composite')
  }
  if (p.wildfireRisk != null && Number.isFinite(Number(p.wildfireRisk))) {
    push('wildfireRisk', 'Wildfire hazard', `${p.wildfireRisk}/100`, 'Modeled hazard')
  }
  if (p.compositeRisk != null && Number.isFinite(Number(p.compositeRisk))) {
    push('compositeRisk', 'Composite hazard', `${p.compositeRisk}/100`, 'Modeled index')
  }

  const geoDrilldownYear = lenderCtx?.geoYear || {}
  let topCensusTracts = []
  if (stateCode && (kind === 'state' || kind === 'county')) {
    topCensusTracts = collectTopCensusTracts(stateCode, geoDrilldownYear, {
      countyFips: kind === 'county' ? countyFips : null,
      limit: kind === 'county' ? 8 : 10,
      countyNames: lenderCtx?.countyNames || {},
    })
    if (topCensusTracts.length) {
      push(
        'tractCount',
        'Census tracts (HMDA)',
        kind === 'county'
          ? `${topCensusTracts.length} top tracts in county`
          : `${topCensusTracts.length} top tracts statewide`,
        'CFPB HMDA drilldown',
      )
    }
  }

  // When in lender-focus mode but stateBreakdown hasn't loaded yet, the feature
  // properties still contain market-wide values. Show the lender total instead of
  // a misleading market figure, and flag that state-level data is being fetched.
  let primaryRaw = getMetricValue(p, metric.id) ?? p.metricValue
  // While lender is selected but breakdown is not ready, substitute the lender's national
  // total as the hero value so the market state total is never shown as "the lender's".
  if (lenderFocusActive && !lenderInsightsReady && !lenderEst && metric.id === 'units') {
    primaryRaw = focus?.totalOriginated > 0 ? focus.totalOriginated : null
  }
  const primary = formatMetricValue(metric, primaryRaw)

  let topLenders = []
  if (stateCode && lenderCtx && !lenderFocusActive) {
    try {
      if (kind === 'state' && lenderCtx.stateRankCache?.[stateCode]) {
        topLenders = lenderCtx.stateRankCache[stateCode].slice(0, 5)
      } else if (lenderCtx.lenders?.length) {
        topLenders = rankLendersForGeography(
          lenderCtx.lenders,
          lenderCtx.panelYear,
          { state: stateCode, countyFips, censusTract, geoDrilldownYear: lenderCtx.geoYear },
          5,
        )
      }
    } catch (err) {
      console.warn('[geo-hover-detail] lender rank failed', err)
      topLenders = []
    }
  }

  const leadLender = topLenders[0] || null
  let tractAttribution = null
  let lenderTractNote = null
  if (lenderFocusActive) {
    if (kind === 'tract' && lenderEst) {
      lenderTractNote = `${lenderFocusName} · estimated originations at this tract marker`
      tractAttribution =
        'Tract counts scale market HMDA by this lender’s state originated share — not loan-level FFIEC tract data.'
    } else if (kind === 'state') {
      tractAttribution = `${lenderFocusName} · state originated counts from FFIEC Data Browser.`
    } else if (kind === 'county') {
      tractAttribution = `${lenderFocusName} · county view uses market HMDA; lender split is state-level FFIEC.`
    }
  } else if (kind === 'tract' && leadLender) {
    tractAttribution = `${leadLender.name} · estimated lead originator for this tract (HMDA state mix × tract share; not loan-level FFIEC).`
  } else if (kind === 'county' && leadLender) {
    tractAttribution = `Top lenders allocated from state HMDA breakdown; disposition rates use state panel LAR aggregates.`
  }

  const modelNote =
    dispositionFootnote(kind, p, lenderCtx) ||
    (lenderFocusActive && kind === 'tract' && lenderEst
      ? 'Tract markers are estimated from this lender’s state HMDA share × market tract pattern.'
      : kind === 'tract' && leadLender
        ? 'Tract lender ranks are estimated from state mix × tract share; not loan-level FFIEC attribution.'
        : null)

  return {
    title,
    subtitle,
    subtitleIncludesYear,
    lenderFocusName: lenderFocusActive ? lenderFocusName : null,
    lenderFocusYear: lenderFocusActive ? lenderFocusYear : null,
    lenderEst: lenderFocusActive ? lenderEst : false,
    lenderInsightsLoading: lenderFocusActive ? lenderInsightsLoading : false,
    lenderTractNote,
    geoTitle,
    geoSubtitle,
    lines,
    primaryLabel: metric.label,
    primaryValue: primary,
    primaryMetricId: metric.id,
    dataYear: lenderCtx?.panelYear ?? null,
    kind,
    stateCode,
    countyFips,
    censusTract,
    topLenders,
    topCensusTracts,
    leadLender,
    tractAttribution,
    incomeBracket,
    demographicsIndex: null,
    modelNote,
    geoLevelLabel: kind === 'tract' ? 'Census tract' : kind === 'county' ? 'County' : 'State',
    navigateLabel:
      kind === 'tract'
        ? 'View lenders for this tract'
        : kind === 'county'
          ? 'View lenders for this county'
          : 'View lenders for this state',
  }
}

/** Sum / weighted aggregate for visible tract markers (respects toolbar metric). */
export function aggregateFeaturesForMetric(features, metric) {
  const m = metricById(metric?.id || metric)
  const list = features || []
  if (!list.length) return null

  let totalUnits = 0
  let totalVolume = 0
  let weighted = 0
  let weightTotal = 0

  for (const f of list) {
    const p = f.properties || {}
    totalUnits += Number(p.units ?? p.loanUnits) || 0
    totalVolume += Number(p.volume) || 0
    const v = getMetricValue(p, m.id)
    if (v == null || !Number.isFinite(v)) continue
    if (m.format === 'percent' || m.format === 'score') {
      const w = Number(p.units ?? p.loanUnits) || 1
      weighted += v * w
      weightTotal += w
    }
  }

  if (m.field === 'units') return totalUnits > 0 ? totalUnits : null
  if (m.field === 'volume') return totalVolume > 0 ? totalVolume : null
  if (m.field === 'avgLoan') return totalUnits > 0 ? totalVolume / totalUnits : null
  if (m.format === 'percent' || m.format === 'score') {
    return weightTotal > 0 ? weighted / weightTotal : null
  }
  return null
}

/** Left inspector summary when the tract marker layer is toggled on (before hover/click). */
export function buildTractsLayerOverviewDetail(
  metric,
  {
    tractFeatureCount = 0,
    year,
    mapSelectedState,
    tractFeatures = [],
    mapLenderFocus = null,
  } = {},
) {
  const lenderReady = Boolean(mapLenderFocus?.insightsReady)
  const lenderLoading = Boolean(mapLenderFocus?.insightsLoading)
  const lenderFocused = Boolean(mapLenderFocus?.name)
  const lenderTotal =
    Number(mapLenderFocus?.totalOriginated) > 0
      ? Number(mapLenderFocus.totalOriginated)
      : null
  const lenderStates = Number(mapLenderFocus?.stateCount) || 0

  const scope = mapSelectedState
    ? `${US_STATE_NAMES[mapSelectedState] || mapSelectedState} (${mapSelectedState})`
    : lenderReady && lenderStates > 0
      ? `${lenderStates} active state${lenderStates === 1 ? '' : 's'}`
      : 'United States'
  const countLabel =
    tractFeatureCount > 0 ? tractFeatureCount.toLocaleString() : 'Loading…'

  let aggregateVal = aggregateFeaturesForMetric(tractFeatures, metric)
  if ((lenderReady || lenderFocused) && lenderTotal != null && metric?.field === 'units') {
    aggregateVal = lenderTotal
  }

  const primaryValue =
    aggregateVal != null ? formatMetricValue(metric, aggregateVal) : countLabel

  const title = lenderReady
    ? String(mapLenderFocus.name || 'Lender geography')
    : lenderFocused
      ? String(mapLenderFocus.name || 'Lender geography')
      : 'Census tract markers'
  const subtitle = lenderReady
    ? `${scope} · HMDA ${year || '—'} · FFIEC state breakdown`
    : lenderFocused
      ? `${scope} · HMDA ${year || '—'} · ${lenderLoading ? 'Loading state data…' : 'State data unavailable'}`
      : `${scope} · HMDA ${year || '—'} · ${metric?.label || 'Loan units'}`

  const lines = lenderReady
    ? [
        {
          rowKey: 'lenderTotal',
          k: 'Originated loans (lender)',
          v: lenderTotal != null ? lenderTotal.toLocaleString() : 'Loading…',
          source: 'FFIEC Data Browser',
        },
        {
          rowKey: 'lenderStates',
          k: 'Active states',
          v: lenderStates > 0 ? String(lenderStates) : 'Loading…',
          source: 'FFIEC state breakdown',
        },
        {
          rowKey: 'markers',
          k: 'Tract markers on map',
          v: countLabel,
          source: 'Census Gazetteer + HMDA pattern',
        },
        {
          rowKey: 'explore',
          k: 'Explore',
          v: 'State pins show FFIEC totals; tract dots are estimated from state share',
          source: 'Map inspector',
        },
      ]
    : lenderFocused
      ? [
          {
            rowKey: 'lenderTotal',
            k: 'Total originated (lender)',
            v: lenderTotal != null ? lenderTotal.toLocaleString() : '—',
            source: 'HMDA',
          },
          {
            rowKey: 'stateData',
            k: 'State-level breakdown',
            v: lenderLoading ? 'Loading from FFIEC…' : 'Not available for this year',
            source: lenderLoading ? 'FFIEC' : 'FFIEC Data Browser',
          },
          {
            rowKey: 'markers',
            k: 'Tract markers on map',
            v: countLabel,
            source: 'Census Gazetteer + HMDA pattern',
          },
        ]
      : [
        {
          rowKey: 'markers',
          k: 'Markers on map',
          v: countLabel,
          source: 'Census Gazetteer + HMDA',
        },
        {
          rowKey: 'metric',
          k: metric?.label || 'Selected metric',
          v: primaryValue,
          source: `HMDA ${year || '—'}`,
        },
        {
          rowKey: 'gazetteer',
          k: 'Point geography',
          v: 'U.S. Census Bureau 2020 internal points',
          source: 'Census Gazetteer',
        },
        {
          rowKey: 'explore',
          k: 'Explore',
          v: 'Hover or click a marker for tract detail',
          source: 'Map inspector',
        },
      ]

  return {
    title,
    subtitle,
    geoLevelLabel: lenderReady ? 'Lender map' : 'Tracts layer',
    kind: lenderReady ? 'state' : 'tract',
    featureKey: lenderReady ? `lender-layer:${mapLenderFocus.lei || mapLenderFocus.name}` : 'tract-layer:overview',
    stateCode: mapSelectedState || null,
    primaryLabel: lenderReady ? 'Originated loans (lender)' : metric?.label || 'Loan units',
    primaryValue,
    primaryMetricId: metric?.id || 'units',
    dataYear: year,
    lines,
    topLenders: [],
    topCensusTracts: [],
    lenderFocusName: (lenderReady || lenderFocused) ? mapLenderFocus.name : null,
    lenderFocusYear: (lenderReady || lenderFocused) ? mapLenderFocus.year ?? year : null,
    modelNote: lenderReady
      ? 'State pin sizes use FFIEC originated counts by state. Tract dots scale the market HMDA pattern by each state’s lender share — not loan-level tract attribution.'
      : 'Tract markers use Census Gazetteer coordinates. HMDA volumes come from geo-drilldown aggregates — not loan-level FFIEC attribution.',
    navigateLabel: 'View lenders for this area',
  }
}

/** Build docked inspector payload from a map feature + toolbar context. */
export function buildInspectorPayloadFromFeature(feature, layerId, metric, lenderCtx, { year } = {}) {
  const synthetic = { properties: feature.properties, layer: { id: layerId } }
  const detail = buildGeoHoverDetail(synthetic, metric, lenderCtx)
  let tractLng = null
  let tractLat = null
  if (
    (layerId === 'geo-tracts-circle' || layerId === 'geo-tracts-globe-dots') &&
    Array.isArray(feature.geometry?.coordinates)
  ) {
    ;[tractLng, tractLat] = feature.geometry.coordinates
  }
  const featureKey = `${detail.kind}:${detail.stateCode}:${detail.countyFips || ''}:${detail.censusTract || ''}`
  const yr = year ?? lenderCtx?.panelYear ?? null
  const subtitle =
    detail.subtitleIncludesYear || !yr
      ? detail.subtitle
      : [detail.subtitle, `HMDA ${yr}`].filter(Boolean).join(' · ')
  return {
    clientX: 0,
    clientY: 0,
    featureKey,
    tractLng,
    tractLat,
    dataYear: yr,
    ...detail,
    subtitle,
  }
}
