/** Mapbox paint expressions with feature-state highlight / selection (simple-interactions pattern). */

/** Invisible fill — keeps polygon hit-testing without washing out satellite imagery. */
export const INVISIBLE_FILL_OPACITY = 0.001

export function stateFillOpacityExpr(basemapSatellite, metricField) {
  const base = basemapSatellite
    ? ['case', ['>', ['get', metricField], 0], 0.4, 0.16]
    : ['case', ['>', ['get', metricField], 0], 0.6, 0.32]
  return [
    'case',
    ['boolean', ['feature-state', 'selected'], false],
    basemapSatellite ? 0.58 : 0.72,
    ['boolean', ['feature-state', 'highlight'], false],
    basemapSatellite ? 0.52 : 0.66,
    base,
  ]
}

export function countyFillOpacityExpr(basemapSatellite) {
  const base = basemapSatellite ? 0.48 : 0.64
  return [
    'case',
    ['boolean', ['feature-state', 'highlight'], false],
    basemapSatellite ? 0.6 : 0.74,
    base,
  ]
}

/** Semi-transparent choropleth when census tract dots are visible. */
export function stateFillOpacityUnderTractsExpr(basemapSatellite, metricField) {
  return [
    'case',
    ['boolean', ['feature-state', 'selected'], false],
    basemapSatellite ? 0.5 : 0.52,
    ['boolean', ['feature-state', 'highlight'], false],
    basemapSatellite ? 0.44 : 0.46,
    ['case', ['>', ['get', metricField], 0], basemapSatellite ? 0.38 : 0.4, basemapSatellite ? 0.2 : 0.24],
  ]
}

export function countyFillOpacityUnderTractsExpr(basemapSatellite) {
  return [
    'case',
    ['boolean', ['feature-state', 'highlight'], false],
    basemapSatellite ? 0.48 : 0.5,
    basemapSatellite ? 0.36 : 0.38,
  ]
}

export function stateLineWidthExpr(mapSelectedState) {
  return [
    'case',
    ['boolean', ['feature-state', 'selected'], false],
    3,
    ['boolean', ['feature-state', 'highlight'], false],
    2.4,
    mapSelectedState
      ? ['case', ['==', ['get', 'state'], mapSelectedState], 2.2, 1]
      : 1,
  ]
}

/** Fixed amber pointer — nationwide tract overview. */
export const TRACT_OVERVIEW_DOT_COLOR = '#f59e0b'

/** Fixed periwinkle pointer — county zoom (single hue, no gradient blob). */
export const TRACT_COUNTY_DOT_COLOR = '#7c9cf5'

/** Highlight ring for hovered tract pointer. */
export const TRACT_POINTER_HIGHLIGHT_COLOR = '#4338ca'

/**
 * Tract pointer radius — zoom-only, always tiny (never scales with loan units).
 */
export function tractPointerRadiusExpr() {
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    1, 1.15,
    4, 1.05,
    6, 0.95,
    8, 0.9,
    10, 0.85,
    12, 0.8,
    14, 0.75,
  ]
}

/** Globe overview dots — size and color reflect HMDA origination concentration. */
export function tractConcentrationGlobeCirclePaint() {
  return {
    'circle-radius': [
      'interpolate',
      ['linear'],
      ['zoom'],
      4,
      ['interpolate', ['linear'], ['coalesce', ['get', 'units'], 0], 0, 2.2, 20, 3.4, 80, 4.6, 250, 6],
      5.5,
      ['interpolate', ['linear'], ['coalesce', ['get', 'units'], 0], 0, 2.8, 20, 4.2, 80, 5.6, 250, 7.2],
    ],
    'circle-color': [
      'interpolate',
      ['linear'],
      ['coalesce', ['get', 'units'], 0],
      0,
      '#fde68a',
      25,
      '#fbbf24',
      100,
      '#f59e0b',
      300,
      '#ea580c',
    ],
    'circle-opacity': 0.9,
    'circle-stroke-width': 1,
    'circle-stroke-color': '#ffffff',
  }
}

/** Pick fixed pointer color by zoom. */
export function tractDotColorExprForZoom(zoom) {
  return zoom >= 6 ? TRACT_COUNTY_DOT_COLOR : TRACT_OVERVIEW_DOT_COLOR
}

/** Mapbox circle paint for census tract pointer dots. */
export function tractPointerCirclePaint(dotColor) {
  return {
    'circle-radius': [
      'case',
      ['boolean', ['feature-state', 'highlight'], false],
      ['+', tractPointerRadiusExpr(), 0.75],
      tractPointerRadiusExpr(),
    ],
    'circle-color': [
      'case',
      ['boolean', ['feature-state', 'highlight'], false],
      TRACT_POINTER_HIGHLIGHT_COLOR,
      dotColor,
    ],
    'circle-opacity': [
      'interpolate',
      ['linear'],
      ['zoom'],
      1, 0.55,
      6, 0.72,
      10, 0.88,
      14, 0.96,
    ],
    'circle-blur': 0,
    'circle-pitch-alignment': 'map',
    'circle-stroke-width': [
      'case',
      ['boolean', ['feature-state', 'highlight'], false],
      1,
      0.45,
    ],
    'circle-stroke-color': '#ffffff',
    'circle-stroke-opacity': 0.9,
  }
}
