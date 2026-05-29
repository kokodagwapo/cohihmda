# HMDA data refresh

cohi-hmda refreshes public HMDA static JSON entirely within this repo. No sibling `hmda` checkout is required at runtime.

## Data locations

| Path | Purpose |
|------|---------|
| `public/data/hmda/` | All runtime JSON (lenders, geo, manifest) |
| `data/hmda-mlar/` | Combined MLAR txt/zip for geography builds (gitignored) |
| `.cache/hmda/` | MLAR insights checkpoints |

Override combined MLAR folder with `HMDA_MLAR_DIR` and anchor year with `HMDA_ANCHOR_YEAR` in `.env`.

For static-JSON-only deployments (no HMDA warehouse DB), set `HMDA_DATA_SOURCE=static` in `.env`.

## Admin panel

**Admin → Infrastructure → HMDA Data**

- **Rebuild manifest only** — fast; rescans `public/data/hmda/` and updates `hmda-years-manifest.json`.
- **Refresh from FFIEC source** — full pipeline: lenders, paginated pages, product summaries, geo (if MLAR present), manifest.

Geography steps are **skipped** (with a warning) if `{year}_combined_mlar_header.txt` or `.zip` is not present in `data/hmda-mlar/`.

## Refresh pipeline order

1. Fetch per-institution MLAR insights (FFIEC HTTP)
2. Export enriched lender JSON for anchor year
3. Build paginated lender pages + lender manifest
4. Build product summaries (all years in master file)
5. Geo drilldown → county enrichment → map summary → tracts *(if combined MLAR present)*
6. Years manifest

## Combined MLAR download

1. Open [FFIEC modified-LAR data publication](https://ffiec.cfpb.gov/data-publication/modified-lar/) for the filing year.
2. Download the **combined** file for the year (header variant used by the geo builder).
3. Save as `data/hmda-mlar/2025_combined_mlar_header.zip` (or `.txt`).

## CLI

```bash
npm run hmda:years-manifest          # manifest only
npm run hmda:mlar-insights -- --year=2025 --resume
npm run hmda:export-enriched -- --year=2025
npm run hmda:lender-pages -- --year=2025
npm run hmda:products-summary
npm run hmda:geo -- 2025             # requires combined MLAR
npm run hmda:geo:enrich -- 2025     # county metrics (after geo drilldown)
npm run hmda:refresh                 # full pipeline
```

## Recommended schedule

- **Daily** — FFIEC year probe (automatic via status API when admins open the panel).
- **Weekly** (filing season) — MLAR insights refresh with `--resume`.
- **On event** — geo rebuild when combined MLAR is added or updated.
- **Not daily** — full MLAR fetch for all LEIs (hours-long job).

## Logs

Background admin jobs write logs under `server/.cache/hmda-admin/logs/{jobId}.log`.

## AWS production notes

Static HMDA JSON is baked into the **frontend S3/CloudFront** deploy and read by the **ECS API** from `public/data/hmda/` in the container image. Refresh jobs that write only to a single container filesystem do **not** automatically update CloudFront.

Before enabling automated refresh on AWS, plan a publish step:

1. **EFS** mounted at `public/data/hmda/` shared by API tasks, or
2. Refresh task uploads to **S3** (`data/hmda/*`) + **CloudFront invalidation**, or
3. **Scheduled CI** runs `npm run hmda:refresh` and redeploys frontend assets

## Automated refresh (future)

Not implemented yet. Recommended approach on AWS:

- **EventBridge Scheduler** → **ECS Fargate RunTask** for long jobs (`hmda:refresh`, filing season)
- Lighter jobs (manifest, FFIEC probe) on a separate schedule
- Admin UI presets to enable/disable schedules (planned)

Until then, use **Admin → HMDA Data → Manual sync** or run CLI on a build runner.
