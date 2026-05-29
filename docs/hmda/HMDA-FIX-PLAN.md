# HMDA Fix Plan — Progress Tracker

> **Data refresh & admin sync:** see [DATA-REFRESH.md](./DATA-REFRESH.md) — all pipelines run inside cohi-hmda (no sibling repo required).

Historical performance/integration checklist below. Native UI lives in `src/hmda-databank/`; static data in `public/data/hmda/`.

## Dev loop (native integration)

```bash
npm run hmda:verify:integration   # file + script checks
npm run hmda:years-manifest        # fast manifest rescan
npm run hmda:refresh               # full FFIEC refresh (hours)
npm run hmda:lender-pages -- --year=2025
npm run hmda:products-summary
```

## Phase checklist

### Phase 0 — Unblock & baseline

- [x] Restore `useGeographyTabAnalytics.js`
- [ ] Baseline metrics recorded (fill in after manual profiling)

| Metric | Before | After |
|--------|--------|-------|
| Geography TTI (s) | | |
| Initial JSON payload (MB) | ~7.2 drilldown | |
| CA tract fetch timing | | |
| Lighthouse performance | | |
| React Profiler map commits (search while geo tab) | | |

### Phase 1 — Geography data & tract loading

- [x] C2 — State tract load gating + abort
- [x] H4 — Multi-lender cap fix
- [x] H3 — LRU tract cache
- [x] C1 — Slim map JSON (`geo-map-summary-{year}.json`)

### Phase 2 — React isolation

- [x] H1/H2 — Disposition snapshot + zoom/bounds decoupling
- [x] Remove legacy `censusTractMapDots` dead work
- [x] Map already wrapped in `React.memo`

### Phase 3 — Integration prep

- [x] `VITE_HMDA_DATA_PREFIX` in `publicAssetUrl.js`
- [x] Search vs Lenders: `/` → search hero; `/lenders` → forced grid
- [x] Coheus `HmdaData.tsx` lenders path → `lenders`
- [x] Self-contained refresh scripts in `scripts/hmda/`
- [x] Admin HMDA Data panel (status + manual sync)

## Route smoke (/hmda native)

| Route | Status |
|-------|--------|
| `/hmda` | |
| `/hmda/lenders` | |
| `/hmda/products` | |
| `/hmda/geography` | |

## Pass criteria

| Metric | Target | Met |
|--------|--------|-----|
| Geography TTI | ≥ 2× faster vs baseline | |
| CA tract fetch | Only after zoom gate | |
| Initial JSON | Map summary < 2 MB | |
| All 4 routes | No console errors | |
| Hook restored | Yes | ✓ |
| Self-contained refresh | No ../hmda at runtime | ✓ |
