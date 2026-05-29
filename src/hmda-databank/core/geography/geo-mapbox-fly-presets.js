/** Named camera paths for address fly-to (Mapbox `flyTo` — duration / pitch / curve). */
export const GEO_FLY_PRESETS = {
  aerial: {
    id: 'aerial',
    label: 'Aerial',
    duration: 4800,
    zoom: 19.2,
    pitch: 82,
    bearing: -32,
    curve: 1.42,
  },
  glide: {
    id: 'glide',
    label: 'Glide',
    duration: 3400,
    zoom: 16.4,
    pitch: 62,
    bearing: -24,
    curve: 1.22,
  },
  quick: {
    id: 'quick',
    label: 'Quick',
    duration: 1400,
    zoom: 15.2,
    pitch: 52,
    bearing: -18,
    curve: 1,
  },
  orbit: {
    id: 'orbit',
    label: 'Long orbit',
    duration: 6200,
    zoom: 18.5,
    pitch: 74,
    bearing: -48,
    curve: 1.38,
  },
}

export const GEO_FLY_PRESET_LIST = Object.values(GEO_FLY_PRESETS)
