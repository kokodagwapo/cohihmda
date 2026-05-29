import { useEffect, useMemo, useRef, useState } from 'react'
import { marketUnitsByStateFromGeoYear } from './geo-map-lender-filter.js'
import { buildTractLayerGeoJson, preloadTractAssets } from './geo-tract-pipeline.js'

const BOUNDS_DEBOUNCE_MS = 280

/**
 * Async tract GeoJSON for Mapbox — prebuilt per-state assets + worker filter.
 */
export function useGeoTractLayer({
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
}) {
  const [tractsGeo, setTractsGeo] = useState(null)
  const genRef = useRef(0)
  const debounceRef = useRef(null)
  const boundsRef = useRef(mapBounds)
  boundsRef.current = mapBounds
  const marketByState = useMemo(() => marketUnitsByStateFromGeoYear(geoYear), [geoYear])

  const hasFocusList = Array.isArray(mapLenderFocusList) && mapLenderFocusList.length > 0
  const multiLenderCompare = hasFocusList && mapLenderFocusList.length > 1
  const singleListFocus = hasFocusList && mapLenderFocusList.length === 1 ? mapLenderFocusList[0] : null

  const mapLenderInsights = multiLenderCompare
    ? null
    : (singleListFocus?.insights || mapLenderFocus?.insights || null)

  const lenderFocusPending = multiLenderCompare
    ? mapLenderFocusList.some((l) => l.lei && !l.insights?.stateBreakdown?.length)
    : Boolean(
        (singleListFocus?.lei || mapLenderFocus?.lei) &&
          !mapLenderInsights?.stateBreakdown?.length,
      )

  /** Lender-selected mode — load tract overlay in active states even at national zoom. */
  const lenderTractMode = Boolean(mapLenderFocus?.lei || hasFocusList)

  const resolvedFocusList = useMemo(() => {
    if (!multiLenderCompare) return null
    return mapLenderFocusList.map((l) => ({ ...l, marketByState }))
  }, [multiLenderCompare, mapLenderFocusList, marketByState])

  useEffect(() => {
    if (!year || !mapReady || !showCensusTracts) return
    preloadTractAssets(year, { includeNational: false })
  }, [year, mapReady, showCensusTracts])

  useEffect(() => {
    if (!showCensusTracts || !mapReady) {
      setTractsGeo(null)
      return undefined
    }
    if (!mapSelectedState && mapZoom < 4.8 && !lenderTractMode) {
      setTractsGeo(null)
      return undefined
    }

    const stateCode = mapSelectedState || (mapZoom >= 6.5 ? layerStateCode : null)
    const gen = ++genRef.current
    let cancelled = false

    const run = () => {
      const bounds = mapZoom >= 7 ? boundsRef.current : null
      const lenderFocus =
        !multiLenderCompare && mapLenderInsights?.stateBreakdown?.length
          ? { insights: mapLenderInsights, marketByState }
          : null

      buildTractLayerGeoJson({
        year,
        mapZoom,
        stateCode,
        bounds,
        lenderFocus,
        lenderFocusList: resolvedFocusList,
        lenderFocusPending,
        geoYear,
        countyEnrichment,
        countyNames: countyFipsNames,
      })
        .then((fc) => {
          if (cancelled || genRef.current !== gen) return
          setTractsGeo(fc?.features?.length ? fc : null)
        })
        .catch((err) => {
          console.warn('[HMDA] tract layer load failed:', err?.message || err)
          if (cancelled || genRef.current !== gen) return
          setTractsGeo(null)
        })
    }

    clearTimeout(debounceRef.current)
    if (mapZoom >= 7 && mapBounds) {
      debounceRef.current = setTimeout(run, BOUNDS_DEBOUNCE_MS)
    } else {
      run()
    }

    return () => { cancelled = true; clearTimeout(debounceRef.current) }
  }, [
    showCensusTracts,
    mapReady,
    year,
    mapZoom,
    mapBounds,
    layerStateCode,
    mapSelectedState,
    mapLenderInsights,
    lenderFocusPending,
    resolvedFocusList,
    multiLenderCompare,
    lenderTractMode,
    marketByState,
    geoYear,
    countyEnrichment,
    countyFipsNames,
  ])

  return tractsGeo
}
