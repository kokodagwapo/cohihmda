# Cohi Data Documentation

This directory contains comprehensive documentation for Cohi's data architecture, including the Universal Connector, LOS integrations, and data quality framework.

## Quick Links

### Core Documentation

| Document | Description |
|----------|-------------|
| [Overview](./OVERVIEW.md) | High-level data architecture and principles |
| [Universal Connector](./UNIVERSAL_CONNECTOR.md) | LOS-agnostic integration layer |
| [Incremental Sync](./INCREMENTAL_SYNC.md) | How data syncs from LOS systems |
| [CSV Import](./CSV_IMPORT.md) | Manual and scheduled file imports |
| [Data Quality](./DATA_QUALITY.md) | Validation, monitoring, and remediation |

### LOS Integrations

| Document | Status | Description |
|----------|--------|-------------|
| [Encompass](./integrations/ENCOMPASS_INTEGRATION.md) | ✅ Production | ICE Mortgage Technology LOS |
| [MeridianLink](./integrations/MERIDIANLINK_INTEGRATION.md) | 🟡 Planned | LendingQB, OpenClose |
| [Servicing](./integrations/SERVICING_INTEGRATION.md) | 🟢 Parking Lot | Post-origination data |

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           DATA SOURCES                                   │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐            │
│  │ Encompass │  │MeridianLink│  │ CSV/SFTP  │  │ Servicing │            │
│  │    ✅     │  │    🟡     │  │    ✅     │  │    🟢     │            │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘            │
│        └──────────────┴──────────────┴──────────────┘                   │
│                              │                                           │
│                              ▼                                           │
│        ┌─────────────────────────────────────────────┐                  │
│        │           UNIVERSAL CONNECTOR               │                  │
│        │  • Auto-mapping engine                      │                  │
│        │  • Field transformation                     │                  │
│        │  • Data validation                          │                  │
│        └──────────────────────┬──────────────────────┘                  │
│                               │                                          │
│                               ▼                                          │
│        ┌─────────────────────────────────────────────┐                  │
│        │           COHI UNIFIED SCHEMA               │                  │
│        │  • 296 standardized columns (from legacy Coheus)│                  │
│        │  • Database-per-tenant isolation            │                  │
│        │  • Incremental sync tracking                │                  │
│        └─────────────────────────────────────────────┘                  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Key Concepts

### Unified Schema

All data sources map to a single canonical schema defined in the Cohi Data Dictionary. This ensures:
- Consistent analytics regardless of LOS
- Easy addition of new data sources
- Backward compatibility with Coheus (legacy Qlik)

### Incremental Sync

After initial load, Cohi only syncs changed/new records:
- Uses `last_modified_date` tracking
- Reduces API calls and transfer time
- Configurable sync frequency (hourly, daily, weekly)

### Auto-Mapping

For each new LOS, Cohi can automatically detect and map fields:
- Pre-built field dictionaries per LOS
- Semantic matching for unknown fields
- Admin review for uncertain mappings

### Data Quality

Real-time validation and monitoring:
- Rule-based validation (completeness, accuracy)
- AI-powered anomaly detection
- Client admin dashboard for issue resolution

## Related Documentation

- [Backend Architecture](../BACKEND_ARCHITECTURE.md)
- [Multi-Tenant Architecture](../architecture/MULTI_TENANT.md)
- [Client Admin Requirements](../architecture/CLIENT_ADMIN_REQUIREMENTS.md)
- [Self-Hosted Deployment](../architecture/SELF_HOSTED.md)

## Status Legend

| Icon | Meaning |
|------|---------|
| ✅ | Production - fully implemented |
| 🟡 | Planned - next in roadmap |
| 🟢 | Parking Lot - future consideration |
| ⬜ | Not started |
