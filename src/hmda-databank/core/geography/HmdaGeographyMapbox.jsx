import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Map, { Layer, Marker, NavigationControl, ScaleControl, Source } from '@vis.gl/react-mapbox'
import mapboxgl from 'mapbox-gl'
import {
  ALargeSmall,
  ArrowRight,
  Home,
  Maximize2,
  Minimize2,
  Search,
  Waypoints,
} from 'lucide-react'
import 'mapbox-gl/dist/mapbox-gl.css'
import { publicAssetUrl } from '@hmda/utils/publicAssetUrl.js'
import {
  GEO_MAP_DEFAULT_METRIC,
  metricById,
  metricColorStops,
} from './geo-map-metrics.js'
import GeoMetricPicker from './GeoMetricPicker.jsx'
import {
  buildCountiesForState,
  buildStateMarkers,
  buildStatesWithMetrics,
  CENSUS_TRACT_GAZETTEER_SOURCE,
  getFeatureBounds,
  metricExtent,
  STATE_MEDIAN_INCOME,
} from './geo-map-features.js'
import {
  buildGeoStateDataForLender,
  lenderActiveStateCodes,
  sumLenderStateOriginated,
} from './geo-map-lender-filter.js'
import { useGeoTractLayer } from './useGeoTractLayer.js'
import { rankLendersForGeography } from './geo-map-lenders.js'
import { buildGeoHoverDetail, buildTractsLayerOverviewDetail, buildInspectorPayloadFromFeature } from './geo-hover-detail.js'
import GeoHoverCard from './GeoHoverCard.jsx'
import { clearMapboxToken, fetchMapboxTokenFromServer, isMapboxPublicToken, readMapboxToken } from './mapbox-token.js'
import { geoDebugLog, geoDebugLogLayout } from './geo-debug-log.js'
import MapboxTokenSetup from './MapboxTokenSetup.jsx'
import {
  GEO_MAP_MAX_ZOOM,
  GEO_MAP_MIN_ZOOM,
  MAPBOX_GEOGRAPHY_LIGHT_STYLE,
  MAPBOX_GEOGRAPHY_STREETS_STYLE,
  MAPBOX_GEOGRAPHY_SATELLITE_STYLE,
  isGeographyStreetsStyle,
  isGeographySatelliteStyle,
  overlayThemeFromBasemapStyle,
  GULF_OF_AMERICA_LABEL,
  resolveGeographyBasemapStyle,
  resolveMapboxPublicToken,
  isNearUsaGlobeDefaultView,
  USA_GLOBE_DEFAULT_VIEW,
  USA_GLOBE_INTRO_VIEW,
  playUsaGlobeIntroAnimation,
  USA_MAP_CAMERA,
  GEO_TRACT_OVERVIEW_ZOOM,
  GEO_TRACT_OVERVIEW_EASE_MS,
} from './mapbox-config.js'
import {
  geocodeAddress,
} from './geo-mapbox-geocode.js'
import { GEO_FLY_PRESETS, GEO_FLY_PRESET_LIST } from './geo-mapbox-fly-presets.js'
import { syncMapboxOverlays } from './geo-mapbox-overlays.js'
import { applyModernLightBasemapTint, modernLightGlobeFog } from './geo-map-basemap-tint.js'
import { bindGulfOfMexicoLabelSuppression } from './gulf-basemap-labels.js'
import { shouldShowGulfOfAmericaLabel } from './gulf-label-visibility.js'
import {
  bindGeographyFeatureInteractions,
  syncStateSelectionFeatureState,
  syncTractLayerOrder,
  isTractLayerId,
} from './geo-map-interactions.js'
import {
  geoDrilldownYearHasData,
  listGeoMapYearOptions,
  resolveGeoMapDisplayYear,
} from './geo-drilldown-year.js'
import { HMDA_DEFAULT_ANCHOR_YEAR } from '@hmda/services/hmdaApi.js'
import { buildDispositionByState, getPanelDisposition, resolveDispositionYear } from './geo-hmda-disposition.js'
import {
  countyFillOpacityExpr as buildCountyFillOpacityExpr,
  countyFillOpacityUnderTractsExpr as buildCountyFillOpacityUnderTractsExpr,
  stateFillOpacityExpr as buildStateFillOpacityExpr,
  stateFillOpacityUnderTractsExpr as buildStateFillOpacityUnderTractsExpr,
  INVISIBLE_FILL_OPACITY,
  stateLineWidthExpr as buildStateLineWidthExpr,
  tractConcentrationGlobeCirclePaint,
} from './geo-map-layer-paint.js'
import {
  ensureTractMarkerImages,
  ensureTractMarkerColorImage,
  TRACT_MARKER_ID,
  tractPointerSymbolLayout,
  tractPointerSymbolPaint,
} from './geo-tract-marker-image.js'

mapboxgl.accessToken = resolveMapboxPublicToken()

/** Reveal docked map inspector after idle, or immediately on first state hover. */
const GEO_INSPECTOR_REVEAL_MS = 15_000

const GEO_MAP_TEXT_SCALE_KEY = 'hmda.geoMapTextScale'

const GEO_TEXT_SCALE_CYCLE = ['default', 'large', 'xlarge']

const GEO_TEXT_SCALE_UI = {
  default: {
    aria: 'Increase map text size (currently standard)',
    title: 'Larger text for toolbar and map panel',
  },
  large: {
    aria: 'Increase map text size further (currently large)',
    title: 'Extra-large text for toolbar and map panel',
  },
  xlarge: {
    aria: 'Reset map text size to standard (currently extra large)',
    title: 'Return to standard text size',
  },
}

function readGeoMapTextScale() {
  try {
    const v = localStorage.getItem(GEO_MAP_TEXT_SCALE_KEY)
    if (GEO_TEXT_SCALE_CYCLE.includes(v)) return v
  } catch {
    /* ignore */
  }
  return 'default'
}

/** Fixed globe camera (reference hero); avoids fitBounds over-zooming past the design framing. */
function applyUsaGlobeDefaultView(map, { animate = true } = {}) {
  if (!map) return
  const v = USA_GLOBE_DEFAULT_VIEW
  const opts = {
    center: [v.longitude, v.latitude],
    zoom: v.zoom,
    pitch: v.pitch,
    bearing: v.bearing,
    essential: true,
  }
  if (animate && map.flyTo) {
    map.flyTo({ ...opts, duration: 1600, curve: 1.06, speed: 0.52, essential: true })
  } else if (map.easeTo) map.easeTo({ ...opts, duration: 1200 })
  else if (map.jumpTo) map.jumpTo(opts)
}

/** Ease to the first zoom level where national tract dots appear. */
function applyTractOverviewView(map, { animate = true } = {}) {
  if (!map?.getZoom) return
  const z = map.getZoom()
  if (z >= GEO_TRACT_OVERVIEW_ZOOM) return

  const c = map.getCenter?.()
  const opts = {
    center: c
      ? [c.lng, c.lat]
      : [USA_GLOBE_DEFAULT_VIEW.longitude, USA_GLOBE_DEFAULT_VIEW.latitude],
    zoom: GEO_TRACT_OVERVIEW_ZOOM,
    pitch: map.getPitch?.() ?? USA_GLOBE_DEFAULT_VIEW.pitch,
    bearing: map.getBearing?.() ?? USA_GLOBE_DEFAULT_VIEW.bearing,
    essential: true,
  }

  if (animate && map.easeTo) {
    map.easeTo({ ...opts, duration: GEO_TRACT_OVERVIEW_EASE_MS })
  } else if (map.jumpTo) {
    map.jumpTo(opts)
  }
}

function applyGeographyAtmosphere(map, opts = {}) {
  if (!map?.setFog) return
  const satelliteBasemap = Boolean(opts.satelliteBasemap)
  const detailView = Boolean(opts.detailView)
  const z = map?.getZoom?.() ?? 3
  try {
    if (satelliteBasemap && !detailView && z < 5.5) {
      map.setFog({
        range: [-1, 2],
        color: 'rgb(6, 10, 26)',
        'high-color': 'rgb(22, 44, 92)',
        'horizon-blend': 0.05,
        'space-color': 'rgb(2, 4, 14)',
        'star-intensity': 0.35,
      })
    } else if (!satelliteBasemap && !detailView && z < 5.5) {
      map.setFog(modernLightGlobeFog())
    } else {
      map.setFog(null)
    }
  } catch {
    /* ignore */
  }
}

/** Turn off globe fog when zoomed in or on sharp satellite detail views. */
function bindGeographyAtmosphereZoom(map, getOpts = () => ({})) {
  if (!map || map._hmdaAtmosphereZoomBound) return
  map._hmdaAtmosphereZoomBound = true
  const sync = () => applyGeographyAtmosphere(map, getOpts())
  map.on('zoom', sync)
  map.on('moveend', sync)
  sync()
}

function syncGeographyAtmosphere(map, opts = {}) {
  if (!map) return
  applyGeographyAtmosphere(map, opts)
}

/** Colorful basemap tints — skipped for satellite and native streets styles. */
function bindModernLightBasemapTint(map, shouldSkipTint = () => false) {
  if (!map || map._hmdaBasemapTintBound) return
  map._hmdaBasemapTintBound = true
  const sync = () => {
    if (shouldSkipTint()) return
    applyModernLightBasemapTint(map)
  }
  map.on('styledata', sync)
  sync()
}

/** Globe projection without terrain tiles — fast + modern 3D framing. */
function setupGeographyGlobe(map) {
  if (!map) return
  try {
    map.setMaxZoom?.(GEO_MAP_MAX_ZOOM)
    map.setMinZoom?.(GEO_MAP_MIN_ZOOM)
    map.setProjection?.({ name: 'globe' })
    map.setTerrain?.(null)
  } catch {
    /* ignore */
  }
}

export default function HmdaGeographyMapbox({
  geoDrilldownHmda,
  panelYear,
  drilldownYear,
  onDrilldownYearChange,
  geoStateData,
  lenders = [],
  geoMapMetric,
  onGeoMapMetricChange,
  mapSelectedState,
  onSelectState,
  onClearState,
  showCensusTracts = true,
  onToggleCensusTracts,
  onSetShowCensusTracts,
  fullscreen = true,
  toolbarActions = null,
  /** Increment (from parent) to clear map-local UI and return to USA framing. */
  resetUiNonce = 0,
  onNavigateToLenders = null,
  onGeoAreaSelect = null,
  /** When set, state choropleth + tract dots reflect this lender's originated loans (FFIEC). */
  mapLenderFocus = null,
  /** True while the per-lender stateBreakdown insights are being fetched from FFIEC. */
  mapLenderFocusInsightsLoading = false,
  /** Multi-lender focus list (searched + pinned) — each entry: { lei, name, year, insights, color }. */
  mapLenderFocusList = null,
  availableYears = null,
  onInitialMapReady = null,
  /** Unified lender / geography / address search (from MortgageLenderDashboard). */
  mapSearchQuery = null,
  onMapSearchQueryChange = null,
  showSearchSuggestions = false,
  onShowSearchSuggestions = null,
  searchSuggestions = null,
  onCommitSearch = null,
  suggestionToQueryValue = null,
  onClearSearch = null,
}) {
  const mapRef = useRef(null)
  const wrapRef = useRef(null)
  const mapShellRef = useRef(null)
  const layoutLogThrottleRef = useRef(0)
  const introAnimationDoneRef = useRef(false)
  const introPlayedRef = useRef(false)
  const tokenAuthRetryDoneRef = useRef(false)
  const [introAnimationDone, setIntroAnimationDone] = useState(false)
  const mapStyleFallbackDoneRef = useRef(false)
  const [mapStyleUrl, setMapStyleUrl] = useState(() => resolveGeographyBasemapStyle())
  const satelliteDefault = useMemo(() => isGeographySatelliteStyle(mapStyleUrl), [mapStyleUrl])
  const [accessToken, setAccessToken] = useState(() => {
    const local = readMapboxToken()
    return local.token || resolveMapboxPublicToken()
  })
  const [mapReady, setMapReady] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [hoverInfo, setHoverInfo] = useState(null)
  /** Last geography hover — keeps inspector content when pointer leaves the map. */
  const [inspectorSnapshot, setInspectorSnapshot] = useState(null)
  const [countyEnrichment, setCountyEnrichment] = useState(null)
  const [showCounties, setShowCounties] = useState(false)
  const [addressQuery, setAddressQuery] = useState('')
  const unifiedSearch = typeof onCommitSearch === 'function'
  const searchQuery = unifiedSearch ? (mapSearchQuery ?? '') : addressQuery
  const setSearchQuery = unifiedSearch ? onMapSearchQueryChange : setAddressQuery
  const suggestionList = unifiedSearch && Array.isArray(searchSuggestions) ? searchSuggestions : []
  const [geocodeBusy, setGeocodeBusy] = useState(false)
  const [geocodeHint, setGeocodeHint] = useState('')
  const [flyPresetId, setFlyPresetId] = useState('aerial')
  const [showBuildings, setShowBuildings] = useState(false)
  const [buildings3dHint, setBuildings3dHint] = useState('')
  const [tractsHint, setTractsHint] = useState('')
  const [gulfLabelVisible, setGulfLabelVisible] = useState(false)
  const [hoverPinned, setHoverPinned] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [countyFipsNames, setCountyFipsNames] = useState(null)
  const hoverPinnedRef = useRef(false)
  const showCensusTractsRef = useRef(showCensusTracts)
  const atmosphereOptsRef = useRef({ satelliteBasemap: false, detailView: false })
  const hoverDismissTimerRef = useRef(null)
  const hoverSuppressedKeyRef = useRef(null)
  const lastInspectorHitRef = useRef(null)
  const [isBrowserFullscreen, setIsBrowserFullscreen] = useState(false)
  const [mapTextScale, setMapTextScale] = useState(readGeoMapTextScale)
  const [mapZoom, setMapZoom] = useState(USA_GLOBE_INTRO_VIEW.zoom)
  const [mapBounds, setMapBounds] = useState(null)

  useEffect(() => {
    geoDebugLog('HmdaGeographyMapbox.jsx:mount', 'Map component mounted', { hasGeoData: Boolean(geoDrilldownHmda) }, 'C')
  }, [geoDrilldownHmda])

  const metric = metricById(geoMapMetric || GEO_MAP_DEFAULT_METRIC)
  const geoSliceYear = useMemo(
    () => resolveGeoMapDisplayYear(geoDrilldownHmda, drilldownYear, panelYear),
    [geoDrilldownHmda, drilldownYear, panelYear],
  )

  const drilldownYearOptions = useMemo(
    () => {
      const base = listGeoMapYearOptions(geoDrilldownHmda, HMDA_DEFAULT_ANCHOR_YEAR)
      const years = Array.isArray(availableYears) ? availableYears : []
      const merged = new Set(base)
      years.forEach((y) => {
        const v = String(y)
        if (/^\d{4}$/.test(v)) merged.add(v)
      })
      return [...merged].sort((a, b) => Number(b) - Number(a))
    },
    [geoDrilldownHmda, availableYears],
  )
  const geoYear = useMemo(
    () => geoDrilldownHmda?.[geoSliceYear] || {},
    [geoDrilldownHmda, geoSliceYear],
  )
  const year = geoSliceYear

  const basemapSatellite = satelliteDefault

  /** State/county choropleth by selected metric (volume, units, avg loan size). */
  const choroplethFillHidden = false

  const stateFillOpacityExpr = useMemo(
    () => (choroplethFillHidden ? INVISIBLE_FILL_OPACITY : buildStateFillOpacityExpr(basemapSatellite, metric.field)),
    [choroplethFillHidden, basemapSatellite, metric.field],
  )

  const countyFillOpacityExpr = useMemo(
    () => (choroplethFillHidden ? INVISIBLE_FILL_OPACITY : buildCountyFillOpacityExpr(basemapSatellite)),
    [choroplethFillHidden, basemapSatellite],
  )

  /** Colorful choropleth stays visible under census tract dots. */
  const stateFillOpacityLive = useMemo(() => {
    if (!showCensusTracts) return stateFillOpacityExpr
    if (choroplethFillHidden) return INVISIBLE_FILL_OPACITY
    return buildStateFillOpacityUnderTractsExpr(basemapSatellite, metric.field)
  }, [showCensusTracts, choroplethFillHidden, basemapSatellite, metric.field, stateFillOpacityExpr])

  const countyFillOpacityLive = useMemo(() => {
    if (!showCensusTracts) return countyFillOpacityExpr
    if (choroplethFillHidden) return INVISIBLE_FILL_OPACITY
    return buildCountyFillOpacityUnderTractsExpr(basemapSatellite)
  }, [showCensusTracts, choroplethFillHidden, basemapSatellite, countyFillOpacityExpr])

  const stateLineWidthExpr = useMemo(
    () => buildStateLineWidthExpr(mapSelectedState),
    [mapSelectedState],
  )

  const mapDetailView = showCensusTracts || mapZoom >= 5.5
  atmosphereOptsRef.current = { satelliteBasemap: basemapSatellite, detailView: mapDetailView }

  const stateLinePaint = useMemo(() => {
    if (basemapSatellite) {
      return {
        'line-color': [
          'case',
          ['boolean', ['feature-state', 'highlight'], false],
          '#a5b4fc',
          mapSelectedState
            ? ['case', ['==', ['get', 'state'], mapSelectedState], '#6366f1', 'rgba(255,255,255,0.72)']
            : 'rgba(255,255,255,0.62)',
        ],
        'line-width': stateLineWidthExpr,
        'line-opacity': 0.94,
      }
    }
    return {
      'line-color': mapSelectedState
        ? ['case', ['==', ['get', 'state'], mapSelectedState], '#0ea5e9', '#64748b']
        : '#94a3b8',
      'line-width': stateLineWidthExpr,
      'line-opacity': mapSelectedState ? 0.78 : 0.22,
    }
  }, [basemapSatellite, mapSelectedState, stateLineWidthExpr])

  const countyLinePaint = useMemo(
    () =>
      basemapSatellite
        ? { 'line-color': 'rgba(255,255,255,0.62)', 'line-width': 0.65, 'line-opacity': 0.9 }
        : { 'line-color': '#38bdf8', 'line-width': 0.7, 'line-opacity': 0.82 },
    [basemapSatellite],
  )

  useEffect(() => {
    if (!hoverInfo) return
    setInspectorSnapshot(hoverInfo)
  }, [hoverInfo])

  const geographyHover = hoverInfo ?? inspectorSnapshot
  const hoverStateCode = geographyHover?.stateCode ? geographyHover.stateCode : null
  const layerStateCode = mapSelectedState || hoverStateCode
  const countyStateCode = mapSelectedState || (showCounties ? hoverStateCode : null)
  const countiesLayerOn =
    Boolean(countyStateCode) &&
    (showCounties || Boolean(mapSelectedState) || mapZoom >= 5.4)

  useEffect(() => {
    if (resetUiNonce == null || resetUiNonce <= 0) return
    setShowCounties(false)
    setShowBuildings(false)
    setAddressQuery('')
    setGeocodeHint('')
    setFlyPresetId('aerial')
    setInspectorOpen(false)
    const map = mapRef.current?.getMap?.()
    if (map?.isStyleLoaded?.()) {
      try {
        map.stop()
      } catch {
        /* ignore */
      }
      if (showCensusTracts && !mapSelectedState) {
        applyTractOverviewView(map)
      } else {
        applyUsaGlobeDefaultView(map)
      }
    }
  }, [resetUiNonce, showCensusTracts, mapSelectedState])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const tokenT0 = performance.now()
      geoDebugLog('HmdaGeographyMapbox.jsx:token', 'Mapbox token resolve start', {}, 'C')
      const local = readMapboxToken()
      if (local.token) {
        mapboxgl.accessToken = local.token
        if (!cancelled) {
          setAccessToken(local.token)
          geoDebugLog(
            'HmdaGeographyMapbox.jsx:token',
            'Mapbox token resolve done',
            { ms: Math.round(performance.now() - tokenT0), source: 'local' },
            'C',
          )
        }
        return
      }
      const remote = await fetchMapboxTokenFromServer()
      if (cancelled) return
      if (remote.token) {
        mapboxgl.accessToken = remote.token
        setAccessToken(remote.token)
      }
      geoDebugLog(
        'HmdaGeographyMapbox.jsx:token',
        'Mapbox token resolve done',
        { ms: Math.round(performance.now() - tokenT0), source: remote.token ? 'remote' : 'none' },
        'C',
      )
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    mapStyleFallbackDoneRef.current = false
    setMapStyleUrl(resolveGeographyBasemapStyle())
  }, [accessToken])

  const overlayTheme = useMemo(() => overlayThemeFromBasemapStyle(mapStyleUrl), [mapStyleUrl])

  useEffect(() => {
    const needsCountyMetrics =
      showCensusTracts || Boolean(mapSelectedState) || mapZoom >= 4.8
    if (!needsCountyMetrics) return undefined

    let cancelled = false
    const metricsT0 = performance.now()
    geoDebugLog('HmdaGeographyMapbox.jsx:county-metrics', 'County metrics fetch start', { year }, 'E')
    ;(async () => {
      try {
        const r = await fetch(publicAssetUrl(`/data/geo-map/county-metrics-${year}.json`))
        if (!r.ok) throw new Error(`county-metrics-${year} ${r.status}`)
        const j = await r.json()
        if (!cancelled && j?.counties && Object.keys(j.counties).length > 0) {
          setCountyEnrichment(j)
          geoDebugLog(
            'HmdaGeographyMapbox.jsx:county-metrics',
            'County metrics fetch done',
            { ms: Math.round(performance.now() - metricsT0), year, countyCount: Object.keys(j.counties).length },
            'E',
          )
          return
        }
      } catch {
        /* optional enrichment for this filing year */
      }
      if (!cancelled) {
        setCountyEnrichment(null)
        geoDebugLog(
          'HmdaGeographyMapbox.jsx:county-metrics',
          'County metrics fetch done',
          { ms: Math.round(performance.now() - metricsT0), year, countyCount: 0 },
          'E',
        )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [year, showCensusTracts, mapSelectedState, mapZoom])

  /** Reset inspector when HMDA filing year changes so stale state/county stats are not shown. */
  useEffect(() => {
    setHoverInfo(null)
    setInspectorSnapshot(null)
    setHoverPinned(false)
    hoverPinnedRef.current = false
    hoverSuppressedKeyRef.current = null
    lastInspectorHitRef.current = null
  }, [geoSliceYear])

  useEffect(() => {
    const needsCountyData =
      showCensusTracts || Boolean(mapSelectedState) || mapZoom >= 4.8
    if (!needsCountyData) return undefined

    let cancelled = false
    fetch(publicAssetUrl('/data/county-fips-names.json'))
      .then((r) => (r.ok ? r.json() : {}))
      .then((j) => {
        if (!cancelled) setCountyFipsNames(j && typeof j === 'object' ? j : {})
      })
      .catch(() => {
        if (!cancelled) setCountyFipsNames({})
      })
    return () => {
      cancelled = true
    }
  }, [showCensusTracts, mapSelectedState, mapZoom])

  const dispositionYear = useMemo(
    () => resolveDispositionYear(lenders, panelYear),
    [lenders, panelYear],
  )

  const dispositionCtx = useMemo(
    () => ({
      byState: buildDispositionByState(lenders, dispositionYear),
      national: getPanelDisposition(lenders, dispositionYear),
      dispositionYear,
    }),
    [lenders, dispositionYear],
  )

  const lenderMapInsights = mapLenderFocus?.insights?.stateBreakdown?.length
    ? mapLenderFocus.insights
    : null

  const mapGeoStateRows = useMemo(() => {
    if (!lenderMapInsights) return geoStateData
    return buildGeoStateDataForLender(geoStateData, lenderMapInsights)
  }, [geoStateData, lenderMapInsights])

  const statesGeo = useMemo(
    () => buildStatesWithMetrics(mapGeoStateRows, countyEnrichment, dispositionCtx),
    [mapGeoStateRows, countyEnrichment, dispositionCtx],
  )

  const countiesGeo = useMemo(() => {
    if (!countyStateCode || !countiesLayerOn) return null
    return buildCountiesForState(
      countyStateCode,
      geoYear,
      countyEnrichment,
      countyFipsNames || {},
      dispositionCtx,
    )
  }, [countyStateCode, countiesLayerOn, geoYear, countyEnrichment, countyFipsNames, dispositionCtx])

  const tractsGeo = useGeoTractLayer({
    year,
    showCensusTracts,
    mapReady,
    mapZoom,
    mapBounds,
    layerStateCode,
    mapSelectedState,
    mapLenderFocus,
    mapLenderFocusList,
    geoYear,
    countyEnrichment,
    countyFipsNames,
  })

  const pinsGeo = useMemo(
    () => buildStateMarkers(mapGeoStateRows, lenderMapInsights ? 'loanUnits' : 'volume'),
    [mapGeoStateRows, lenderMapInsights],
  )

  const activeGeo = countiesGeo || statesGeo
  const { min, max } = useMemo(
    () => metricExtent(activeGeo, metric.id, metric.field),
    [activeGeo, metric.id, metric.field],
  )

  const tractFeatureCount = tractsGeo?.features?.length ?? 0

  const tractGlobeLayerOn = showCensusTracts && tractFeatureCount > 0 && mapZoom < 6
  const tractDetailLayerOn = showCensusTracts && tractFeatureCount > 0 && mapZoom >= 6.5

  const tractSymbolLayout = useMemo(
    () => ({
      visibility: tractDetailLayerOn ? 'visible' : 'none',
      ...tractPointerSymbolLayout(),
    }),
    [tractDetailLayerOn],
  )

  const tractSymbolPaint = useMemo(() => tractPointerSymbolPaint(), [])

  const tractGlobeCirclePaint = useMemo(() => tractConcentrationGlobeCirclePaint(), [])

  const showStateVolumePins =
    choroplethFillHidden &&
    introAnimationDone &&
    !mapSelectedState &&
    (!showCensusTracts || Boolean(lenderMapInsights))

  const fillColorExpr = useMemo(
    () => ['interpolate', ['linear'], ['get', metric.field], ...metricColorStops(metric.id, min, max)],
    [metric.field, metric.id, min, max],
  )

  const applyOverlaySync = useCallback(() => {
    const map = mapRef.current?.getMap?.()
    if (!map?.isStyleLoaded?.()) return false
    const buildingsOn = showBuildings && map.getZoom() >= 11
    try {
      const ok = syncMapboxOverlays(
        map,
        { buildings: buildingsOn, zip: false, shops: false, hospitals: false },
        { theme: overlayTheme },
      )
      if (showCensusTractsRef.current) syncTractLayerOrder(map)
      if (showBuildings) {
        setBuildings3dHint(
          ok === false
            ? '3D layer unavailable — zoom to city level (11+) on Mapbox Streets composite'
            : map.getZoom() < 11
              ? 'Zoom in (street level) to see extruded buildings'
              : '',
        )
      } else {
        setBuildings3dHint('')
      }
      return ok
    } catch {
      if (showBuildings) setBuildings3dHint('3D buildings could not load for this basemap')
      return false
    }
  }, [showBuildings, overlayTheme])

  useEffect(() => {
    if (!mapReady) return
    const map = mapRef.current?.getMap?.()
    if (!map) return
    const run = () => applyOverlaySync()
    if (map.isStyleLoaded?.()) run()
    else map.once('styledata', run)
    return () => {
      map.off('styledata', run)
    }
  }, [mapReady, showBuildings, applyOverlaySync])

  const flyToAddress = useCallback(async (queryOverride) => {
    const map = mapRef.current?.getMap?.()
    if (!map || !accessToken) return false
    const q = String(queryOverride ?? searchQuery ?? '').trim()
    if (!q) {
      setGeocodeHint('Enter a lender, place, or address')
      return false
    }
    setGeocodeBusy(true)
    setGeocodeHint('')
    try {
      const c = map.getCenter?.()
      const proximity =
        c && Number.isFinite(c.lng) && Number.isFinite(c.lat) ? [c.lng, c.lat] : undefined
      const hit = await geocodeAddress(q, accessToken, proximity ? { proximity } : {})
      if (!hit) {
        setGeocodeHint('No map location — try a fuller address')
        return false
      }
      setShowBuildings(true)
      const preset = GEO_FLY_PRESETS[flyPresetId] || GEO_FLY_PRESETS.aerial
      map.stop()
      try {
        syncMapboxOverlays(
          map,
          { buildings: true, zip: false, shops: false, hospitals: false },
          { theme: overlayTheme },
        )
      } catch {
        /* ignore */
      }
      map.flyTo({
        center: [hit.lng, hit.lat],
        zoom: preset.zoom,
        pitch: preset.pitch,
        bearing: preset.bearing,
        duration: preset.duration,
        curve: preset.curve,
        essential: true,
      })
      const name = hit.placeName
      setGeocodeHint(name.length > 52 ? `${name.slice(0, 49)}…` : name)
      return true
    } finally {
      setGeocodeBusy(false)
    }
  }, [searchQuery, accessToken, flyPresetId, overlayTheme])

  const submitMapSearch = useCallback(async () => {
    const q = String(searchQuery ?? '').trim()
    if (!q) {
      setGeocodeHint(unifiedSearch ? 'Enter a lender, county, city, or address' : 'Enter an address or place')
      return
    }
    if (unifiedSearch) {
      onCommitSearch(q)
      onShowSearchSuggestions?.(false)
      const looksLikeStreetAddress = /\d/.test(q) && /(,|\b(st|street|ave|avenue|road|rd|blvd|dr|drive|ln|lane|way|court|ct)\b)/i.test(q)
      const noStructuredMatch = suggestionList.length === 0
      if (looksLikeStreetAddress || noStructuredMatch) {
        await flyToAddress(q)
      }
      return
    }
    await flyToAddress(q)
  }, [searchQuery, unifiedSearch, onCommitSearch, onShowSearchSuggestions, suggestionList.length, flyToAddress])

  const syncGulfLabelVisibility = useCallback(() => {
    const map = mapRef.current?.getMap?.()
    setGulfLabelVisible(shouldShowGulfOfAmericaLabel(map))
  }, [])

  /** Map remounts when token/style key changes — clear ready so <Source> never mounts without MapContext. */
  useEffect(() => {
    setMapReady(false)
    setHoverInfo(null)
    setInspectorSnapshot(null)
  }, [accessToken, mapStyleUrl])

  useEffect(() => () => setMapReady(false), [])

  const onMapLoad = useCallback(
    (evt) => {
      const mapLoadT0 = performance.now()
      geoDebugLog('HmdaGeographyMapbox.jsx:map-load', 'Mapbox onLoad fired', {}, 'C')
      const map = evt.target
      setLoadError(null)
      setMapReady(true)
      onInitialMapReady?.()
      geoDebugLog(
        'HmdaGeographyMapbox.jsx:map-ready',
        'Map marked ready',
        { ms: Math.round(performance.now() - mapLoadT0) },
        'C',
      )
      setupGeographyGlobe(map)
      bindGeographyAtmosphereZoom(map, () => atmosphereOptsRef.current)
      applyGeographyAtmosphere(map, {
        satelliteBasemap: isGeographySatelliteStyle(mapStyleUrl),
        detailView: showCensusTractsRef.current,
      })
      bindModernLightBasemapTint(
        map,
        () => isGeographySatelliteStyle(mapStyleUrl) || isGeographyStreetsStyle(mapStyleUrl),
      )
      ensureTractMarkerImages(map)
      bindGulfOfMexicoLabelSuppression(map)
      if (introPlayedRef.current) {
        applyUsaGlobeDefaultView(map, { animate: false })
        introAnimationDoneRef.current = true
        setIntroAnimationDone(true)
        setMapZoom(USA_GLOBE_DEFAULT_VIEW.zoom)
      }
      const onIdle = () => {
        setupGeographyGlobe(map)
        applyGeographyAtmosphere(map, {
          satelliteBasemap: isGeographySatelliteStyle(mapStyleUrl),
          detailView: showCensusTractsRef.current,
        })
        ensureTractMarkerImages(map)
        map.resize()
        syncGulfLabelVisibility()
        if (
          !isGeographySatelliteStyle(mapStyleUrl) &&
          !isGeographyStreetsStyle(mapStyleUrl)
        ) {
          applyModernLightBasemapTint(map)
        }
        if (showCensusTractsRef.current) map.once('idle', () => syncTractLayerOrder(map))
      }
      map.once('idle', onIdle)
      requestAnimationFrame(() => {
        map.resize()
        syncGulfLabelVisibility()
      })
    },
    [syncGulfLabelVisibility, mapStyleUrl, onInitialMapReady],
  )

  useEffect(() => {
    if (!mapReady) return
    const map = mapRef.current?.getMap?.()
    if (!map) return

    const onViewChange = () => {
      syncGulfLabelVisibility()
      const z = map.getZoom()
      setMapZoom(z)
      syncGeographyAtmosphere(map, {
        satelliteBasemap: basemapSatellite,
        detailView: showCensusTractsRef.current || z >= 5.5,
      })
      const b = map.getBounds()
      setMapBounds({
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth(),
      })
    }
    syncGulfLabelVisibility()
    setMapZoom(map.getZoom())
    const b0 = map.getBounds()
    setMapBounds({
      west: b0.getWest(),
      south: b0.getSouth(),
      east: b0.getEast(),
      north: b0.getNorth(),
    })
    map.on('moveend', onViewChange)
    map.on('zoomend', onViewChange)
    return () => {
      map.off('moveend', onViewChange)
      map.off('zoomend', onViewChange)
    }
  }, [mapReady, syncGulfLabelVisibility, basemapSatellite])

  /** Cinematic fly-in from wide globe to national tract overview on first load. */
  useEffect(() => {
    if (!mapReady || introPlayedRef.current) return
    const map = mapRef.current?.getMap?.()
    if (!map) return
    introPlayedRef.current = true

    playUsaGlobeIntroAnimation(map, {
      onComplete: () => {
        introAnimationDoneRef.current = true
        setIntroAnimationDone(true)
        setMapZoom(USA_GLOBE_DEFAULT_VIEW.zoom)
        syncGeographyAtmosphere(map, atmosphereOptsRef.current)
      },
    })
  }, [mapReady])

  const onMapError = useCallback(async (evt) => {
    const msg = String(evt?.error?.message || evt?.error || evt || 'Map failed to load')
    // Transient satellite tile misses should not block the globe UI.
    if (/Failed to fetch.*mapbox\.(com|net)/i.test(msg)) return
    // Ignore known non-fatal style validation warnings from Mapbox GL internals
    const isStyleValidationWarning =
      /layout\.text-field.*zoom.*expression|zoom.*expression.*step.*interpolate|expression.*only.*atmosphere|feature-state.*not supported/i.test(
        msg,
      )
    if (isStyleValidationWarning) return
    const looksLikeStyleAuth =
      /401|403|unauthorized|forbidden/i.test(msg) ||
      /invalid\s+mapbox\s+access\s+token|invalid.*access\s+token|access\s+token.*invalid/i.test(msg) ||
      /not\s+authorized|failed\s+to\s+load.*style|styles?\s*\(/i.test(msg)
    const protectedBasemap =
      mapStyleUrl === MAPBOX_GEOGRAPHY_STREETS_STYLE ||
      mapStyleUrl === MAPBOX_GEOGRAPHY_LIGHT_STYLE ||
      mapStyleUrl === MAPBOX_GEOGRAPHY_SATELLITE_STYLE
    if (!mapStyleFallbackDoneRef.current && looksLikeStyleAuth && !protectedBasemap) {
      mapStyleFallbackDoneRef.current = true
      console.warn(
        '[HmdaGeographyMapbox] Custom Mapbox style was rejected; loading Mapbox streets-v12 basemap.',
        msg,
      )
      setLoadError(null)
      setMapReady(false)
      setMapStyleUrl(MAPBOX_GEOGRAPHY_STREETS_STYLE)
      return
    }
    if (looksLikeStyleAuth && protectedBasemap) {
      if (!tokenAuthRetryDoneRef.current) {
        tokenAuthRetryDoneRef.current = true
        const remote = await fetchMapboxTokenFromServer()
        if (remote.token && remote.token !== accessToken) {
          mapboxgl.accessToken = remote.token
          setLoadError(null)
          setMapReady(false)
          setAccessToken(remote.token)
          return
        }
      }
      try {
        const local = readMapboxToken()
        if (local.source === 'local' && local.token === accessToken) clearMapboxToken()
      } catch {
        /* localStorage optional */
      }
      mapboxgl.accessToken = ''
      setMapReady(false)
      setAccessToken('')
      setLoadError('401 Mapbox token rejected')
      return
    }
    console.error('[HmdaGeographyMapbox]', msg)
    setLoadError(msg)
  }, [accessToken, mapStyleUrl])

  useEffect(() => {
    if (!mapReady || mapSelectedState || !introAnimationDoneRef.current) return
    const map = mapRef.current?.getMap?.()
    if (map && !isNearUsaGlobeDefaultView(map)) applyUsaGlobeDefaultView(map)
  }, [mapReady, mapSelectedState])

  useEffect(() => {
    if (!mapReady || !mapSelectedState) return
    setShowCounties(true)
    const map = mapRef.current?.getMap?.()
    if (!map) return
    const stFeat = statesGeo?.features?.find((f) => f.properties?.state === mapSelectedState)
    const bounds = stFeat ? getFeatureBounds(stFeat) : null
    if (bounds) {
      map.fitBounds(bounds, {
        padding: { top: 100, bottom: 80, left: 48, right: 48 },
        duration: 850,
        maxZoom: 7.25,
        pitch: showBuildings ? Math.max(map.getPitch(), 42) : USA_MAP_CAMERA.pitch,
        bearing: USA_MAP_CAMERA.bearing,
        essential: true,
      })
    }
  }, [mapReady, mapSelectedState, statesGeo, showBuildings])

  useEffect(() => {
    if (!mapReady || !mapSelectedState) return
    const map = mapRef.current?.getMap?.()
    if (!map) return

    const syncZoomLayers = () => {
      const z = map.getZoom()
      if (z >= 5.6) setShowCounties(true)
    }

    syncZoomLayers()
    map.on('zoomend', syncZoomLayers)
    return () => map.off('zoomend', syncZoomLayers)
  }, [mapReady, mapSelectedState])

  const flyToSelectedState = useCallback(
    (maxZoom = 9.2, stateCode = mapSelectedState) => {
      const map = mapRef.current?.getMap?.()
      if (!map || !stateCode) return
      const stFeat = statesGeo?.features?.find((f) => f.properties?.state === stateCode)
      const bounds = stFeat ? getFeatureBounds(stFeat) : null
      if (bounds) {
        map.fitBounds(bounds, {
          padding: 56,
          duration: 850,
          maxZoom,
          essential: true,
        })
      }
    },
    [mapSelectedState, statesGeo],
  )

  const handleToggleCensusTracts = useCallback(() => {
    const next = !showCensusTracts
    if (onSetShowCensusTracts) onSetShowCensusTracts(next)
    else onToggleCensusTracts?.()

    if (next) {
      setInspectorOpen(true)
      setHoverInfo(null)
      const map = mapRef.current?.getMap?.()
      if (map && !mapSelectedState) {
        applyTractOverviewView(map)
      }
    }
  }, [showCensusTracts, onSetShowCensusTracts, onToggleCensusTracts, mapSelectedState])

  const lenderTractMode = Boolean(
    (Array.isArray(mapLenderFocusList) && mapLenderFocusList.length > 0) || mapLenderFocus?.lei,
  )

  /** When a lender is focused, ease to national tract overview so dots can render. */
  useEffect(() => {
    if (!mapReady || !showCensusTracts || !lenderTractMode || mapSelectedState) return
    const map = mapRef.current?.getMap?.()
    if (!map?.isStyleLoaded?.()) return
    applyTractOverviewView(map)
  }, [mapReady, showCensusTracts, lenderTractMode, mapSelectedState, mapLenderFocusList, mapLenderFocus?.lei])

  useEffect(() => {
    if (!showCensusTracts) {
      setTractsHint('')
      return
    }
    const lenderPending =
      Array.isArray(mapLenderFocusList) &&
      mapLenderFocusList.some((l) => l.lei && !l.insights?.stateBreakdown?.length)
    if (tractFeatureCount === 0) {
      if (lenderPending) {
        setTractsHint('Loading lender origination geography…')
        return
      }
      setTractsHint(
        mapZoom < 4.8 && !mapSelectedState && !lenderTractMode
          ? 'Zoom in or select a state for census tract markers'
          : lenderTractMode
            ? 'Lender tract markers loading or unavailable for this year.'
            : 'Tract markers unavailable for this view.',
      )
      return
    }
    if (mapZoom < 6) {
      setTractsHint(`${tractFeatureCount.toLocaleString()} tract markers on map — zoom in for pin detail`)
    } else {
      setTractsHint('')
    }
  }, [showCensusTracts, tractFeatureCount, mapZoom, mapSelectedState, lenderTractMode, mapLenderFocusList])

  useEffect(() => {
    showCensusTractsRef.current = showCensusTracts
    if (!mapReady) return
    const map = mapRef.current?.getMap?.()
    if (!map) return
    syncGeographyAtmosphere(map, atmosphereOptsRef.current)

    let cancelled = false
    const syncTracts = () => {
      if (cancelled) return
      if (showCensusTracts) syncTractLayerOrder(map)
      if (showCensusTracts && showBuildings) {
        setShowBuildings(false)
        try {
          syncMapboxOverlays(
            map,
            { buildings: false, zip: false, shops: false, hospitals: false },
            { theme: overlayTheme },
          )
        } catch {
          /* ignore */
        }
      }
    }

    syncTracts()
    map.once('idle', syncTracts)

    return () => {
      cancelled = true
      map.off('idle', syncTracts)
    }
  }, [
    mapReady,
    showCensusTracts,
    tractFeatureCount,
    tractsGeo,
    showBuildings,
    overlayTheme,
  ])

  useEffect(() => {
    if (!mapReady || !showCensusTracts || tractFeatureCount === 0) return
    const map = mapRef.current?.getMap?.()
    if (!map?.getLayer?.('geo-tracts-globe-dots') && !map?.getLayer?.('geo-tracts-circle')) return
    const lift = () => syncTractLayerOrder(map)
    lift()
    map.once('idle', lift)
    return () => map.off('idle', lift)
  }, [mapReady, showCensusTracts, tractFeatureCount, statesGeo, countiesGeo])

  // Manage geo-tracts source and layers imperatively — avoids @vis-gl/react-mapbox Source
  // hook crash (Invalid hook call) when the tracts source mounts after async centroid loading
  // in React 19, since deferred async setState triggers render outside the normal map-load cycle.
  useEffect(() => {
    if (!mapReady) return
    const map = mapRef.current?.getMap?.()
    if (!map) return
    const SRC = 'geo-tracts'
    const L_DOTS = 'geo-tracts-globe-dots'
    const L_SYM = 'geo-tracts-circle'
    const isMulti = Array.isArray(mapLenderFocusList) && mapLenderFocusList.length > 1
    const sync = () => {
      if (!map.style?._loaded) return
      if (!tractsGeo) {
        try { if (map.getLayer(L_SYM))  map.removeLayer(L_SYM)  } catch {}
        try { if (map.getLayer(L_DOTS)) map.removeLayer(L_DOTS) } catch {}
        try { if (map.getSource(SRC))   map.removeSource(SRC)   } catch {}
        return
      }
      if (!map.getSource(SRC)) {
        try { map.addSource(SRC, { type: 'geojson', data: tractsGeo, promoteId: 'tractId' }) } catch {}
      } else {
        try { map.getSource(SRC).setData(tractsGeo) } catch {}
      }

      // Globe overview dots: data-driven color per lender when in multi-lender mode
      const globePaint = isMulti
        ? {
            ...tractGlobeCirclePaint,
            'circle-color': ['coalesce', ['get', 'lenderColor'], '#f59e0b'],
          }
        : tractGlobeCirclePaint
      if (!map.getLayer(L_DOTS)) {
        try { map.addLayer({ id: L_DOTS, type: 'circle', source: SRC, layout: { visibility: tractGlobeLayerOn ? 'visible' : 'none' }, paint: globePaint }) } catch {}
      } else {
        try { map.setLayoutProperty(L_DOTS, 'visibility', tractGlobeLayerOn ? 'visible' : 'none') } catch {}
        if (isMulti) {
          try { map.setPaintProperty(L_DOTS, 'circle-color', ['coalesce', ['get', 'lenderColor'], '#f59e0b']) } catch {}
        }
      }

      // Detail pins: register per-color images for multi-lender, use data-driven icon-image
      const iconImageExpr = isMulti
        ? (() => {
            const colorToId = {}
            for (const lItem of mapLenderFocusList) {
              const id = ensureTractMarkerColorImage(map, lItem.color)
              colorToId[lItem.color] = id
            }
            // Build match expression: ['match', ['get', 'lenderColor'], color1, id1, color2, id2, ..., defaultId]
            const matchArgs = []
            for (const [color, id] of Object.entries(colorToId)) {
              matchArgs.push(color, id)
            }
            return ['match', ['get', 'lenderColor'], ...matchArgs, TRACT_MARKER_ID]
          })()
        : TRACT_MARKER_ID
      const symLayout = { ...tractSymbolLayout, 'icon-image': iconImageExpr }
      if (!map.getLayer(L_SYM)) {
        try { map.addLayer({ id: L_SYM, type: 'symbol', source: SRC, layout: symLayout, paint: tractSymbolPaint }) } catch {}
      } else {
        try { map.setLayoutProperty(L_SYM, 'visibility', tractDetailLayerOn ? 'visible' : 'none') } catch {}
        try { map.setLayoutProperty(L_SYM, 'icon-image', iconImageExpr) } catch {}
      }
      if (showCensusTractsRef.current) syncTractLayerOrder(map)
    }
    sync()
    // Re-sync only after a full style reload (style.load), not on every tile/source
    // styledata event — the old 'styledata' fired dozens of times per map interaction.
    map.on('style.load', sync)
    return () => { try { map.off('style.load', sync) } catch {} }
  }, [mapReady, tractsGeo, tractGlobeLayerOn, tractDetailLayerOn, tractGlobeCirclePaint, tractSymbolLayout, tractSymbolPaint, mapLenderFocusList])

  // Lazy rank cache — computes top-5 lenders for a state only on first hover access,
  // not upfront for all 51 states (was O(51 × lenders) on every lenders change).
  const _lazyRankStore   = useRef({})
  const _lazyRankKey     = useRef('')
  const _lazyRankLenders = useRef(lenders)
  _lazyRankLenders.current = lenders
  const newRankKey = `${geoSliceYear}:${lenders?.length ?? 0}`
  if (_lazyRankKey.current !== newRankKey) {
    _lazyRankStore.current = {}
    _lazyRankKey.current = newRankKey
  }
  const stateLenderRankCache = useMemo(
    () =>
      new Proxy(_lazyRankStore.current, {
        get(target, st) {
          if (typeof st !== 'string' || !st) return undefined
          if (!Object.prototype.hasOwnProperty.call(target, st)) {
            try {
              target[st] = rankLendersForGeography(
                _lazyRankLenders.current,
                geoSliceYear,
                { state: st, geoDrilldownYear: geoYear },
                5,
              )
            } catch {
              target[st] = []
            }
          }
          return target[st]
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [newRankKey],
  )

  const lenderHoverFocus = useMemo(() => {
    if (!mapLenderFocus?.name) return null
    const totalOriginated =
      (lenderMapInsights ? sumLenderStateOriginated(lenderMapInsights) : 0) ||
      Number(lenderMapInsights?.totalOriginated) ||
      Number(mapLenderFocus.originations) ||
      Number(mapLenderFocus.units) ||
      0
    return {
      name: mapLenderFocus.name,
      year: mapLenderFocus.year ?? panelYear,
      lei: mapLenderFocus.lei,
      insightsReady: Boolean(lenderMapInsights),
      insightsLoading: mapLenderFocusInsightsLoading,
      totalOriginated,
      stateCount: lenderMapInsights ? lenderActiveStateCodes(lenderMapInsights).length : 0,
    }
  }, [mapLenderFocus, lenderMapInsights, mapLenderFocusInsightsLoading, panelYear])

  const lenderHoverCtx = useMemo(
    () => ({
      lenders,
      panelYear,
      geoYear,
      countyNames: countyFipsNames || {},
      stateRankCache: stateLenderRankCache,
      stateMedians: STATE_MEDIAN_INCOME,
      dispositionByState: dispositionCtx.byState,
      dispositionYear: dispositionCtx.dispositionYear,
      mapLenderFocus: lenderHoverFocus,
    }),
    [
      lenders,
      panelYear,
      geoYear,
      countyFipsNames,
      stateLenderRankCache,
      dispositionCtx.byState,
      dispositionCtx.dispositionYear,
      lenderHoverFocus,
    ],
  )

  const buildTractsOverviewSnapshot = useCallback(
    () =>
      buildTractsLayerOverviewDetail(metric, {
        tractFeatureCount,
        year: geoSliceYear,
        mapSelectedState,
        tractFeatures: tractsGeo?.features || [],
        mapLenderFocus: lenderHoverFocus,
      }),
    [metric, tractFeatureCount, geoSliceYear, mapSelectedState, tractsGeo, lenderHoverFocus],
  )

  const buildInspectorPayload = useCallback(
    (feature, layerId) =>
      buildInspectorPayloadFromFeature(feature, layerId, metric, lenderHoverCtx, { year: geoSliceYear }),
    [metric, lenderHoverCtx, geoSliceYear],
  )

  const pushInspectorFromFeature = useCallback(
    (feature, layerId) => {
      lastInspectorHitRef.current = { feature, layerId }
      const payload = buildInspectorPayload(feature, layerId)
      hoverSuppressedKeyRef.current = null
      setInspectorOpen(true)
      setHoverInfo(payload)
      setInspectorSnapshot(payload)
    },
    [buildInspectorPayload],
  )

  /** Seed tract-layer overview or refresh metric/year without clobbering pinned geography. */
  useEffect(() => {
    if (!showCensusTracts) {
      setInspectorSnapshot((prev) =>
        prev?.featureKey === 'tract-layer:overview' ? null : prev,
      )
      return
    }
    setInspectorOpen(true)
    setInspectorSnapshot((prev) => {
      if (
        prev?.featureKey &&
        prev.featureKey !== 'tract-layer:overview' &&
        !String(prev.featureKey).startsWith('lender-layer:')
      ) {
        return prev
      }
      return buildTractsOverviewSnapshot()
    })
  }, [showCensusTracts, buildTractsOverviewSnapshot])

  /** Rebuild inspector when toolbar metric or HMDA year changes. */
  useEffect(() => {
    const hit = lastInspectorHitRef.current
    if (hit?.feature) {
      const payload = buildInspectorPayload(hit.feature, hit.layerId)
      setInspectorSnapshot(payload)
      setHoverInfo((prev) => (prev ? payload : prev))
      return
    }
    if (!showCensusTracts) return
    setInspectorSnapshot((prev) => {
      if (
        prev?.featureKey &&
        prev.featureKey !== 'tract-layer:overview' &&
        !String(prev.featureKey).startsWith('lender-layer:')
      ) {
        return prev
      }
      return buildTractsOverviewSnapshot()
    })
  }, [buildInspectorPayload, buildTractsOverviewSnapshot, showCensusTracts, metric, geoSliceYear])

  const returnToUsaGlobeView = useCallback(() => {
    onClearState?.()
    setShowCounties(false)
    onSetShowCensusTracts?.(false)
    const map = mapRef.current?.getMap?.()
    if (map) applyUsaGlobeDefaultView(map)
  }, [onClearState, onSetShowCensusTracts])

  useEffect(() => {
    const onResize = () => {
      try { mapRef.current?.getMap?.()?.resize() } catch { /* ignore during teardown */ }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [mapReady, accessToken])

  useEffect(() => {
    if (!mapReady) return
    const map = mapRef.current?.getMap?.()
    const shell = mapShellRef.current
    if (!map || !shell || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      // Resize the Mapbox GL canvas whenever the container dimensions change
      // (panel open/close, sidebar toggle, window resize, etc.)
      try { map.resize() } catch {}
    })
    ro.observe(shell)
    return () => ro.disconnect()
  }, [mapReady])

  /** Compass: when drilled in or off hero framing → full USA globe; else Mapbox resets bearing only. */
  useEffect(() => {
    if (!mapReady) return
    const map = mapRef.current?.getMap?.()
    const compassBtn = map?.getContainer?.()?.querySelector?.('.mapboxgl-ctrl-compass')
    if (!compassBtn) return

    const onCompass = (e) => {
      const needsHome = Boolean(mapSelectedState) || !isNearUsaGlobeDefaultView(map)
      if (needsHome) {
        e.preventDefault()
        e.stopImmediatePropagation()
        returnToUsaGlobeView()
      }
    }

    compassBtn.setAttribute('title', 'Return to USA globe view (or reset bearing)')
    compassBtn.addEventListener('click', onCompass, true)
    return () => compassBtn.removeEventListener('click', onCompass, true)
  }, [mapReady, mapSelectedState, returnToUsaGlobeView])

  const mousePointRef = useRef({ clientX: 0, clientY: 0 })
  const interactionHandlersRef = useRef({})

  useEffect(() => {
    hoverPinnedRef.current = hoverPinned
  }, [hoverPinned])

  const clearHoverSoon = useCallback(() => {
    if (hoverDismissTimerRef.current) clearTimeout(hoverDismissTimerRef.current)
    hoverDismissTimerRef.current = setTimeout(() => {
      if (!hoverPinnedRef.current) setHoverInfo(null)
    }, 280)
  }, [])

  const cancelHoverDismiss = useCallback(() => {
    if (hoverDismissTimerRef.current) {
      clearTimeout(hoverDismissTimerRef.current)
      hoverDismissTimerRef.current = null
    }
  }, [])

  const dismissHoverCard = useCallback((featureKey) => {
    cancelHoverDismiss()
    setHoverPinned(false)
    lastInspectorHitRef.current = null
    setInspectorOpen(false)
    const key = featureKey ?? hoverInfo?.featureKey ?? inspectorSnapshot?.featureKey
    if (key) hoverSuppressedKeyRef.current = key
    setHoverInfo(null)
    setInspectorSnapshot(
      showCensusTracts ? buildTractsOverviewSnapshot() : null,
    )
  }, [cancelHoverDismiss, hoverInfo?.featureKey, inspectorSnapshot?.featureKey, showCensusTracts, buildTractsOverviewSnapshot])

  const openInspectorPanel = useCallback(() => {
    setInspectorOpen(true)
  }, [])

  /** Show inspector after idle on standard maps; sooner on hero geography. */
  useEffect(() => {
    if (!mapReady) return
    const delay = fullscreen ? 500 : GEO_INSPECTOR_REVEAL_MS
    const t = window.setTimeout(() => setInspectorOpen(true), delay)
    return () => window.clearTimeout(t)
  }, [mapReady, fullscreen])

  const clearHoverSuppress = useCallback(() => {
    hoverSuppressedKeyRef.current = null
  }, [])

  const isHoverSuppressed = useCallback((featureKey) => {
    return Boolean(featureKey && hoverSuppressedKeyRef.current === featureKey)
  }, [])

  const handleFeatureClick = useCallback(
    (feature, layerId) => {
      const kind =
        layerId === 'geo-tracts-circle' || layerId === 'geo-tracts-globe-dots'
          ? 'tract'
          : layerId === 'geo-counties-fill'
            ? 'county'
            : layerId === 'geo-state-pins-circle'
              ? 'state'
              : 'state'
      const st = feature?.properties?.state
      if (st && kind === 'state') {
        if (st === mapSelectedState) {
          returnToUsaGlobeView()
          return
        }
        onSelectState?.(st)
        return
      }
      if (kind === 'county' || kind === 'tract') {
        if (st) onSelectState?.(st)
        const countyFips =
          kind === 'county'
            ? feature?.properties?.fips
            : feature?.properties?.countyFips
        const censusTract = kind === 'tract' ? feature?.properties?.censusTract : null
        onGeoAreaSelect?.({ state: st, countyFips, censusTract })
        setShowCounties(true)
        pushInspectorFromFeature(feature, layerId)
        if (kind === 'tract') {
          if (onSetShowCensusTracts) onSetShowCensusTracts(true)
          else if (!showCensusTracts) onToggleCensusTracts?.()
        }
        const map = mapRef.current?.getMap?.()
        if (map && kind === 'county' && feature.geometry) {
          const bounds = getFeatureBounds(feature)
          if (bounds) {
            map.fitBounds(bounds, {
              padding: 48,
              duration: 700,
              maxZoom: 10.5,
              essential: true,
            })
          }
        }
        if (map && kind === 'tract' && feature.geometry?.coordinates) {
          const [lng, lat] = feature.geometry.coordinates
          map.flyTo({ center: [lng, lat], zoom: 16, duration: 700, essential: true })
        }
      }
    },
    [
      onSelectState,
      mapSelectedState,
      returnToUsaGlobeView,
      showCensusTracts,
      onToggleCensusTracts,
      onSetShowCensusTracts,
      onGeoAreaSelect,
      pushInspectorFromFeature,
    ],
  )

  interactionHandlersRef.current = {
    handleFeatureClick,
    returnToUsaGlobeView,
    mapSelectedState,
    metric,
    lenderHoverCtx,
    dataYear: geoSliceYear,
    setHoverInfo,
    clearHoverSoon,
    cancelHoverDismiss,
    clearHoverSuppress,
    isHoverSuppressed,
    openInspectorPanel,
  }

  useEffect(() => {
    if (!mapReady) return
    const map = mapRef.current?.getMap?.()
    if (!map) return

    const onMouseMove = (e) => {
      const rect = wrapRef.current?.getBoundingClientRect?.()
      const mapRect = map.getContainer()?.getBoundingClientRect?.()
      if (rect) {
        mousePointRef.current = {
          clientX: rect.left + e.point.x,
          clientY: rect.top + e.point.y,
        }
      }
      const now = performance.now()
      if (now - layoutLogThrottleRef.current > 800) {
        layoutLogThrottleRef.current = now
        const oe = e.originalEvent
        const computed = mousePointRef.current
        const mapBased = mapRect
          ? { clientX: mapRect.left + e.point.x, clientY: mapRect.top + e.point.y }
          : null
        const dx =
          oe && computed ? Math.round(oe.clientX - computed.clientX) : null
        const dy =
          oe && computed ? Math.round(oe.clientY - computed.clientY) : null
      }
    }
    map.on('mousemove', onMouseMove)

    let teardown = () => {}
    const attach = () => {
      teardown()
      teardown = bindGeographyFeatureInteractions(map, {
        onHover: (feature, layerId) => {
          const h = interactionHandlersRef.current
          if (
            layerId === 'geo-states-fill' ||
            layerId === 'geo-state-pins-circle' ||
            isTractLayerId(layerId) ||
            layerId === 'geo-counties-fill'
          ) {
            h.openInspectorPanel?.()
          }
          h.cancelHoverDismiss?.()
          lastInspectorHitRef.current = { feature, layerId }
          const pt = mousePointRef.current
          const detail = buildGeoHoverDetail(
            { properties: feature.properties, layer: { id: layerId } },
            h.metric,
            h.lenderHoverCtx,
          )
          const featureKey = `${detail.kind}:${detail.stateCode}:${detail.countyFips || ''}:${detail.censusTract || ''}`
          if (h.isHoverSuppressed?.(featureKey)) return

          let tractLng = null
          let tractLat = null
          if (isTractLayerId(layerId) && Array.isArray(feature.geometry?.coordinates)) {
            ;[tractLng, tractLat] = feature.geometry.coordinates
          }

          h.setHoverInfo((prev) => {
            if (prev?.featureKey === featureKey) {
              if (prev.clientX === pt.clientX && prev.clientY === pt.clientY) return prev
              return { ...prev, clientX: pt.clientX, clientY: pt.clientY }
            }
            return {
              clientX: pt.clientX,
              clientY: pt.clientY,
              featureKey,
              tractLng,
              tractLat,
              dataYear: h.dataYear,
              subtitle:
                detail.subtitleIncludesYear || !h.dataYear
                  ? detail.subtitle
                  : [detail.subtitle, `HMDA ${h.dataYear}`].filter(Boolean).join(' · '),
              ...detail,
            }
          })
        },
        onHoverEnd: () => {
          interactionHandlersRef.current.clearHoverSuppress?.()
          interactionHandlersRef.current.clearHoverSoon?.()
        },
        onFeatureClick: (feature, layerId) =>
          interactionHandlersRef.current.handleFeatureClick(feature, layerId),
        onMapClickEmpty: () => {
          interactionHandlersRef.current.clearHoverSuppress?.()
          interactionHandlersRef.current.setHoverInfo(null)
          if (interactionHandlersRef.current.mapSelectedState) {
            interactionHandlersRef.current.returnToUsaGlobeView()
          }
        },
      })
      syncStateSelectionFeatureState(map, mapSelectedState)
    }

    const tryAttach = () => {
      if (!map.getLayer('geo-states-fill')) return false
      attach()
      if (showCensusTracts) syncTractLayerOrder(map)
      return true
    }

    let idleCleanup = () => {}
    if (!tryAttach()) {
      const onIdle = () => {
        if (tryAttach()) idleCleanup()
      }
      map.on('idle', onIdle)
      idleCleanup = () => map.off('idle', onIdle)
    }

    return () => {
      map.off('mousemove', onMouseMove)
      idleCleanup()
      teardown()
    }
  }, [mapReady, mapSelectedState, showCensusTracts, countiesGeo, tractsGeo, statesGeo, lenderMapInsights, pinsGeo])

  useEffect(() => {
    if (!mapReady) return
    const map = mapRef.current?.getMap?.()
    if (!map?.getLayer?.('geo-states-fill')) return
    syncStateSelectionFeatureState(map, mapSelectedState)
  }, [mapReady, mapSelectedState])

  const resizeMap = useCallback(() => {
    const map = mapRef.current?.getMap?.()
    try {
      map?.resize?.()
    } catch {
      /* ignore */
    }
  }, [])

  const syncBrowserFullscreenState = useCallback(() => {
    const el = wrapRef.current
    const native =
      document.fullscreenElement === el ||
      document.webkitFullscreenElement === el
    setIsBrowserFullscreen(native)
    requestAnimationFrame(resizeMap)
  }, [resizeMap])

  useEffect(() => {
    const onFsChange = () => syncBrowserFullscreenState()
    document.addEventListener('fullscreenchange', onFsChange)
    document.addEventListener('webkitfullscreenchange', onFsChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange)
      document.removeEventListener('webkitfullscreenchange', onFsChange)
    }
  }, [syncBrowserFullscreenState])

  useEffect(() => {
    if (!isBrowserFullscreen) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      const el = wrapRef.current
      const native =
        document.fullscreenElement === el ||
        document.webkitFullscreenElement === el
      if (!native) {
        setIsBrowserFullscreen(false)
        requestAnimationFrame(resizeMap)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isBrowserFullscreen, resizeMap])

  useEffect(() => {
    if (!isBrowserFullscreen) return
    const el = wrapRef.current
    const native =
      document.fullscreenElement === el ||
      document.webkitFullscreenElement === el
    if (native) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [isBrowserFullscreen])

  const toggleBrowserFullscreen = useCallback(async () => {
    const el = wrapRef.current
    if (!el) return

    const nativeActive =
      document.fullscreenElement === el ||
      document.webkitFullscreenElement === el

    if (nativeActive || isBrowserFullscreen) {
      if (document.fullscreenElement === el) {
        await document.exitFullscreen?.().catch(() => {})
      } else if (document.webkitFullscreenElement === el) {
        await document.webkitExitFullscreen?.().catch(() => {})
      }
      setIsBrowserFullscreen(false)
      requestAnimationFrame(resizeMap)
      return
    }

    try {
      if (el.requestFullscreen) {
        await el.requestFullscreen()
      } else if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen()
      } else {
        setIsBrowserFullscreen(true)
      }
    } catch {
      setIsBrowserFullscreen(true)
    }
    requestAnimationFrame(resizeMap)
  }, [isBrowserFullscreen, resizeMap])

  const onTokenSaved = useCallback((t) => {
    const trimmed = String(t || '').trim()
    if (!isMapboxPublicToken(trimmed)) return
    mapboxgl.accessToken = trimmed
    setAccessToken(trimmed)
    setLoadError(null)
    setMapReady(false)
  }, [])

  const cycleMapTextScale = useCallback(() => {
    setMapTextScale((prev) => {
      const idx = GEO_TEXT_SCALE_CYCLE.indexOf(prev)
      const next = GEO_TEXT_SCALE_CYCLE[(idx + 1) % GEO_TEXT_SCALE_CYCLE.length]
      try {
        localStorage.setItem(GEO_MAP_TEXT_SCALE_KEY, next)
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const mapTextScaleUi = GEO_TEXT_SCALE_UI[mapTextScale] || GEO_TEXT_SCALE_UI.default

  const searchSuggestionsOpen =
    unifiedSearch && showSearchSuggestions && suggestionList.length > 0

  const wrapClass = `hmda-geo-mapbox-wrap hmda-geo-mapbox-wrap--light hmda-geo-mapbox-wrap--usa${
    basemapSatellite
      ? ' hmda-geo-mapbox-wrap--basemap-satellite hmda-geo-mapbox-wrap--satellite'
      : ' hmda-geo-mapbox-wrap--basemap-light'
  }${fullscreen ? ' hmda-geo-mapbox-wrap--hero' : ''}${
    isBrowserFullscreen ? ' hmda-geo-mapbox-wrap--browser-fs' : ''
  }${mapTextScale === 'large' ? ' hmda-geo-mapbox-wrap--text-large' : ''}${
    mapTextScale === 'xlarge' ? ' hmda-geo-mapbox-wrap--text-xlarge' : ''
  }${searchSuggestionsOpen ? ' hmda-geo-mapbox-wrap--search-open' : ''}`

  if (!accessToken || !isMapboxPublicToken(accessToken)) {
    return (
      <div className={`${wrapClass} hmda-geo-mapbox-wrap--setup`}>
        <MapboxTokenSetup onTokenSaved={onTokenSaved} />
      </div>
    )
  }

  return (
    <div ref={wrapRef} className={wrapClass}>
      <div
        className={`hmda-geo-mapbox-toolbar hmda-geo-mapbox-toolbar--minimal hmda-geo-mapbox-toolbar--elevated${
          searchSuggestionsOpen ? ' hmda-geo-mapbox-toolbar--search-open' : ''
        }`}
      >
        <GeoMetricPicker value={metric.id} onChange={onGeoMapMetricChange} />

        {onDrilldownYearChange && drilldownYearOptions.length > 0 ? (
            <select
              className="hmda-geo-toolbar-search__select"
              value={
                drilldownYearOptions.includes(String(drilldownYear))
                  ? String(drilldownYear)
                  : String(geoSliceYear)
              }
              onChange={(e) => onDrilldownYearChange(e.target.value)}
              aria-label="HMDA data year"
              title={`HMDA map data · filing year ${drilldownYear || geoSliceYear}`}
              style={{ minWidth: 72 }}
            >
              {drilldownYearOptions.map((y) => (
                <option key={y} value={y}>
                  HMDA {y}
                </option>
              ))}
            </select>
          ) : null}

        <span className="hmda-geo-mapbox-toolbar__sep" aria-hidden />

        <div className="hmda-geo-mapbox-toolbar__cluster hmda-geo-mapbox-toolbar__cluster--search">
          <div className="hmda-geo-toolbar-search" role="search">
            <span className="hmda-geo-toolbar-icon-well hmda-geo-toolbar-icon-well--sky" aria-hidden>
              <Search size={15} strokeWidth={2} className="hmda-geo-toolbar-search__glyph" />
            </span>
            <div className="hmda-geo-toolbar-search__field-wrap">
              <input
                id="hmda-geo-address-search"
                type="search"
                className="hmda-geo-toolbar-search__input"
                placeholder={unifiedSearch ? 'Search lender, county, city, or address…' : 'Address or place…'}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery?.(e.target.value)
                  if (unifiedSearch) {
                    const t = e.target.value.trim()
                    onShowSearchSuggestions?.(/^\d+$/.test(t) || t.length >= 2)
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    submitMapSearch()
                  }
                  if (e.key === 'Escape') onShowSearchSuggestions?.(false)
                }}
                onFocus={() => {
                  if (!unifiedSearch) return
                  const t = String(searchQuery ?? '').trim()
                  if (/^\d+$/.test(t) || t.length >= 2) onShowSearchSuggestions?.(true)
                }}
                disabled={geocodeBusy}
                aria-label={unifiedSearch ? 'Search lenders, geographies, or addresses on the map' : 'Address or place to find on the map'}
                autoComplete={unifiedSearch ? 'off' : 'street-address'}
              />
              {unifiedSearch && searchQuery && onClearSearch ? (
                <button
                  type="button"
                  className="hmda-geo-toolbar-search__clear"
                  onClick={() => {
                    onClearSearch()
                    setGeocodeHint('')
                  }}
                  aria-label="Clear search"
                >
                  ×
                </button>
              ) : null}
              {unifiedSearch && showSearchSuggestions && suggestionList.length > 0 ? (
                <div className="hmda-geo-toolbar-search__suggestions" data-hmda-search-ui role="listbox">
                  {suggestionList.map((s, i) => (
                    <button
                      key={`${s.category}-${s.label}-${i}`}
                      type="button"
                      role="option"
                      className="hmda-geo-toolbar-search__suggestion"
                      onClick={() => {
                        const v = suggestionToQueryValue ? suggestionToQueryValue(s) : s.label
                        onCommitSearch?.(v)
                        onShowSearchSuggestions?.(false)
                      }}
                    >
                      <span className="hmda-geo-toolbar-search__suggestion-label">{s.label}</span>
                      <span className="hmda-geo-toolbar-search__suggestion-cat">{s.category}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <select
              className="hmda-geo-toolbar-search__select"
              value={flyPresetId}
              onChange={(e) => setFlyPresetId(e.target.value)}
              aria-label="Camera fly animation"
              disabled={geocodeBusy}
            >
              {GEO_FLY_PRESET_LIST.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="hmda-geo-toolbar-search__go"
              onClick={() => submitMapSearch()}
              disabled={geocodeBusy}
              aria-label={unifiedSearch ? 'Search or fly map to location' : 'Fly map to address'}
            >
              <span className="hmda-geo-toolbar-search__go-inner">
                Go
                <ArrowRight size={14} strokeWidth={2.25} aria-hidden className="hmda-geo-toolbar-search__go-icon" />
              </span>
            </button>
          </div>
          {geocodeHint ? (
            <span className="hmda-geo-toolbar-search__hint" title={geocodeHint}>
              {geocodeHint}
            </span>
          ) : null}
          {buildings3dHint ? (
            <span className="hmda-geo-toolbar-search__hint hmda-geo-toolbar-search__hint--3d" role="status">
              {buildings3dHint}
            </span>
          ) : null}
        </div>

        <span className="hmda-geo-mapbox-toolbar__sep" aria-hidden />

        <div className="hmda-geo-mapbox-toolbar__cluster hmda-geo-mapbox-toolbar__cluster--layers">
          <button
            type="button"
            className={`hmda-geo-mapbox-layer-toggle${showCensusTracts ? ' is-active' : ''}`}
            onClick={handleToggleCensusTracts}
            aria-pressed={showCensusTracts}
            title={
              mapLenderFocus?.name
                ? `Census tract markers (${CENSUS_TRACT_GAZETTEER_SOURCE.label} points) — estimated ${mapLenderFocus.name} originations (FFIEC state share × market tract pattern)`
                : `Census tract markers — ${CENSUS_TRACT_GAZETTEER_SOURCE.label} 2020 internal points; HMDA originated loan counts where available`
            }
          >
            <span className="hmda-geo-layer-toggle__well hmda-geo-layer-toggle__well--amber" aria-hidden>
              <Waypoints size={15} strokeWidth={2} className="hmda-geo-mapbox-layer-toggle__icon" />
            </span>
            <span className="hmda-geo-mapbox-layer-toggle__label">Tracts</span>
          </button>
          {tractsHint ? (
            <span className="hmda-geo-toolbar-search__hint hmda-geo-toolbar-search__hint--tracts" role="status">
              {tractsHint}
            </span>
          ) : null}
        </div>

        <span className="hmda-geo-mapbox-toolbar__sep" aria-hidden />

        <button
          type="button"
          className={`hmda-geo-mapbox-text-scale-btn${mapTextScale !== 'default' ? ' is-active' : ''}`}
          onClick={cycleMapTextScale}
          aria-label={mapTextScaleUi.aria}
          title={mapTextScaleUi.title}
          aria-pressed={mapTextScale !== 'default'}
        >
          <ALargeSmall size={17} strokeWidth={2.25} aria-hidden />
        </button>

        {toolbarActions ? (
          <>
            <span className="hmda-geo-mapbox-toolbar__sep" aria-hidden />
            <div className="hmda-geo-mapbox-toolbar__actions">{toolbarActions}</div>
          </>
        ) : null}

        {mapSelectedState && (
          <div className="hmda-geo-mapbox-toolbar__cluster hmda-geo-mapbox-toolbar__cluster--end">
            <button
              type="button"
              className="hmda-geo-mapbox-chip hmda-geo-mapbox-chip--stack"
              onClick={returnToUsaGlobeView}
              aria-label="National view — return to USA globe"
            >
              <span className="hmda-geo-layer-toggle__well hmda-geo-layer-toggle__well--slate hmda-geo-mapbox-chip__well" aria-hidden>
                <Home size={14} strokeWidth={2} />
              </span>
              <span className="hmda-geo-mapbox-chip__text">Home</span>
            </button>
          </div>
        )}
      </div>

      <div ref={mapShellRef} className="hmda-geo-mapbox-map hmda-geo-mapbox-map--fresh">
        {loadError && (
          <p className="hmda-geo-mapbox-map-notice" role="alert">
            {loadError.includes('403') || loadError.includes('401')
              ? 'Mapbox token or style was rejected. Use a public (pk.) token (MAPBOX_ACCESS_TOKEN or VITE_MAPBOX_ACCESS_TOKEN). Geography defaults to Mapbox streets-v12; override with VITE_MAPBOX_GEOGRAPHY_STYLE_URL only.'
              : loadError}
          </p>
        )}

        <div className="hmda-geo-mapbox-globe-layer">
        <Map
          key={`${accessToken}-${mapStyleUrl}`}
          ref={mapRef}
          mapLib={mapboxgl}
          mapboxAccessToken={accessToken}
          mapStyle={mapStyleUrl}
          projection="globe"
          initialViewState={USA_GLOBE_INTRO_VIEW}
          onLoad={onMapLoad}
          onError={onMapError}
          style={{ width: '100%', height: '100%' }}
          trackResize
          attributionControl={false}
          maxPitch={85}
          maxZoom={GEO_MAP_MAX_ZOOM}
          minZoom={GEO_MAP_MIN_ZOOM}
          dragRotate
          touchPitch
          reuseMaps
        >
          <NavigationControl position="top-right" showCompass visualizePitch />
          <ScaleControl position="bottom-right" />

          {mapReady && gulfLabelVisible ? (
            <Marker
              longitude={GULF_OF_AMERICA_LABEL.longitude}
              latitude={GULF_OF_AMERICA_LABEL.latitude}
              anchor="center"
              className="hmda-geo-gulf-label-marker hmda-geo-gulf-label-marker--visible"
            >
              <span className="hmda-geo-gulf-label">Gulf of America</span>
            </Marker>
          ) : null}

          {mapReady && statesGeo ? (
            <Source id="geo-states" type="geojson" data={statesGeo}>
              <Layer
                id="geo-states-fill"
                type="fill"
                layout={{ visibility: 'visible' }}
                paint={{
                  'fill-color': choroplethFillHidden ? '#000000' : fillColorExpr,
                  'fill-opacity': stateFillOpacityLive,
                }}
              />
              <Layer id="geo-states-line" type="line" paint={stateLinePaint} />
            </Source>
          ) : null}

          {mapReady && countiesGeo ? (
            <Source id="geo-counties" type="geojson" data={countiesGeo}>
              <Layer
                id="geo-counties-fill"
                type="fill"
                layout={{ visibility: 'visible' }}
                paint={{
                  'fill-color': choroplethFillHidden ? '#000000' : fillColorExpr,
                  'fill-opacity': countyFillOpacityLive,
                }}
              />
              <Layer id="geo-counties-line" type="line" paint={countyLinePaint} />
            </Source>
          ) : null}

          {mapReady && pinsGeo?.features?.length ? (
            <Source id="geo-state-pins" type="geojson" data={pinsGeo}>
              <Layer
                id="geo-state-pins-circle"
                type="circle"
                layout={{
                  visibility: showStateVolumePins ? 'visible' : 'none',
                }}
                paint={{
                  'circle-radius': ['interpolate', ['linear'], ['get', 'intensity'], 0, 5, 1, 22],
                  'circle-color': lenderMapInsights
                    ? '#059669'
                    : basemapSatellite
                      ? '#818cf8'
                      : '#0ea5e9',
                  'circle-opacity': 0.88,
                  'circle-stroke-width': 2.5,
                  'circle-stroke-color': '#ffffff',
                }}
              />
            </Source>
          ) : null}
        </Map>
        </div>

        {mapLenderFocus?.name ? (
          <div
            className="hmda-geo-mapbox-lender-banner"
            role="status"
            aria-live="polite"
            aria-label={`Lender map focus: ${mapLenderFocus.name}`}
          >
            {Array.isArray(mapLenderFocusList) && mapLenderFocusList.length > 1 ? (
              <>
                <span className="hmda-geo-mapbox-lender-banner__label">Compare</span>
                <span className="hmda-geo-mapbox-lender-banner__chips">
                  {mapLenderFocusList.map((l) => (
                    <span key={l.lei} className="hmda-geo-mapbox-lender-banner__chip">
                      <span
                        className="hmda-geo-mapbox-lender-banner__dot"
                        style={{ background: l.color || '#f59e0b' }}
                        aria-hidden
                      />
                      <span className="hmda-geo-mapbox-lender-banner__name">{l.name}</span>
                    </span>
                  ))}
                </span>
                <span className="hmda-geo-mapbox-lender-banner__year">
                  HMDA {mapLenderFocus.year || year}
                </span>
              </>
            ) : (
              <>
                <span
                  className="hmda-geo-mapbox-lender-banner__dot"
                  style={{
                    background: mapLenderFocusList?.[0]?.color || '#f59e0b',
                  }}
                  aria-hidden
                />
                <span className="hmda-geo-mapbox-lender-banner__label">Lender map</span>
                <span className="hmda-geo-mapbox-lender-banner__name">{mapLenderFocus.name}</span>
                <span className="hmda-geo-mapbox-lender-banner__year">
                  HMDA {mapLenderFocus.year || year} · originated (FFIEC)
                </span>
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className="hmda-geo-mapbox-map-controls" aria-label="Map display controls">
        <button
          type="button"
          className="hmda-geo-mapbox-fs-btn"
          onClick={toggleBrowserFullscreen}
          aria-pressed={isBrowserFullscreen}
          aria-label={isBrowserFullscreen ? 'Exit fullscreen map' : 'Enter fullscreen map'}
          title={isBrowserFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen map'}
        >
          {isBrowserFullscreen ? (
            <Minimize2 size={18} strokeWidth={2} aria-hidden />
          ) : (
            <Maximize2 size={18} strokeWidth={2} aria-hidden />
          )}
        </button>
      </div>

      {inspectorOpen ? (
        <GeoHoverCard
          hover={geographyHover}
          legend={{ metric, min, max, year, mapSelectedState }}
          onNavigateToLenders={onNavigateToLenders}
          onClose={dismissHoverCard}
          onMouseEnterCard={() => {
            cancelHoverDismiss()
            setHoverPinned(true)
          }}
          onMouseLeaveCard={() => {
            setHoverPinned(false)
          }}
        />
      ) : null}

    </div>
  )
}
