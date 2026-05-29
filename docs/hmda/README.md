# HMDA integration (cohi-hmda)

Native HMDA DataBank lives entirely in this repo — no sibling `../hmda` checkout required at runtime.

## Documentation

| Doc | Purpose |
|-----|---------|
| [DATA-REFRESH.md](./DATA-REFRESH.md) | Refresh pipeline, MLAR folders, CLI, AWS notes |
| [HMDA-FIX-PLAN.md](./HMDA-FIX-PLAN.md) | Performance/integration checklist (historical) |

## Quick start (local)

```bash
npm run dev:all                    # frontend :5000 + backend :3001
npm run hmda:verify:integration    # assert scripts + native UI wired
```

Open **Admin → Infrastructure → HMDA Data** for status and manual sync.

Open **`/hmda`** for the DataBank UI.

## Key paths

| Path | Role |
|------|------|
| `src/hmda-databank/` | React UI (native integration) |
| `server/hmda/` | API routes + admin refresh |
| `public/data/hmda/` | Static JSON served to users |
| `scripts/hmda/` | Build & refresh pipeline |
| `data/hmda-mlar/` | Combined MLAR for geography (gitignored) |

## Environment

Root `.env` and `server/.env`:

- `VITE_HMDA_DATA_PREFIX=data/hmda/`
- `HMDA_DATA_SOURCE=static` — default; use warehouse DB only when populated
- `HMDA_MLAR_DIR` / `HMDA_ANCHOR_YEAR` — optional overrides
- `MAPBOX_ACCESS_TOKEN` / `VITE_MAPBOX_ACCESS_TOKEN` — maps

Refresh data with `npm run hmda:refresh` (Admin → HMDA Data panel).
