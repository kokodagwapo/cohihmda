# Servicing Data Integration

> **Status**: 🟢 Parking Lot (Future Capability)

This document outlines the vision and considerations for integrating servicing data into Cohi.

## Table of Contents

- [1. Overview](#1-overview)
- [2. Servicing Data Types](#2-servicing-data-types)
- [3. Potential Data Sources](#3-potential-data-sources)
- [4. Data Model Considerations](#4-data-model-considerations)
- [5. Use Cases](#5-use-cases)
- [6. Integration Patterns](#6-integration-patterns)
- [7. Future Roadmap](#7-future-roadmap)
- [8. Related Documentation](#8-related-documentation)

---

## 1. Overview

### Vision

Servicing data integration will extend Cohi's analytics beyond origination to cover the full loan lifecycle:

```
ORIGINATION (Current)           SERVICING (Future)
────────────────────           ──────────────────
Application                    First Payment
Lock                          Monthly Payments
Underwriting                  Escrow Analysis
Closing                       Delinquency
Funding                       Loss Mitigation
Sale to Investor              Payoff/Maturity
```

### Goals

1. **Full Lifecycle View**: Track loans from origination through payoff
2. **Performance Analytics**: Understand post-funding loan performance
3. **Portfolio Risk**: Monitor delinquency, default rates
4. **Revenue Attribution**: Connect origination decisions to long-term outcomes

### Non-Goals (Initially)

- Real-time servicing alerts
- Bidirectional updates to servicers
- Borrower portal integration

---

## 2. Servicing Data Types

### Core Servicing Data

| Data Type | Description | Analytics Use |
|-----------|-------------|---------------|
| **Payment History** | Monthly payment records | Payment patterns, delinquency trends |
| **Escrow Analysis** | Tax/insurance payments | Cash flow analysis |
| **Loan Status** | Current, delinquent, default | Portfolio health |
| **Payoff Information** | Payoff date, amount | Loan lifecycle completion |

### Performance Metrics

| Metric | Description | Formula |
|--------|-------------|---------|
| **30/60/90 Day Delinquency** | Loans past due | Count by days past due |
| **Default Rate** | Loans in default | Defaults / Total loans |
| **Prepayment Rate** | Early payoffs | Prepaid / Total loans |
| **Average Payment Age** | Time to first delinquency | Days from funding to first late |

### Sub-Servicer Data

| Data Type | Description |
|-----------|-------------|
| **Transfer Records** | When loans move between servicers |
| **Boarding Data** | Initial servicing setup |
| **Investor Reporting** | Remittance data |

---

## 3. Potential Data Sources

### Primary Servicing Systems

| System | Type | Market Position |
|--------|------|-----------------|
| **Black Knight MSP** | Enterprise servicing | Large servicers |
| **ICE Mortgage (Servicing)** | Integrated platform | ICE customers |
| **FICS (Loan Producer)** | Mid-market servicing | Regional servicers |
| **Sagent** | Modern servicing platform | Growing adoption |

### Data Delivery Methods

| Method | Pros | Cons |
|--------|------|------|
| **API Integration** | Real-time, structured | Complex setup per system |
| **File Feed (SFTP)** | Simple, standard | Batch only, format variations |
| **Data Warehouse** | Single source | Client must have warehouse |
| **Investor Reports** | Standard format | Limited to sold loans |

### Industry Standards

| Standard | Description |
|----------|-------------|
| **MISMO** | Mortgage Industry Standards Maintenance Org |
| **ULAD** | Uniform Loan Application Dataset |
| **Investor Reporting** | Fannie/Freddie formats |

---

## 4. Data Model Considerations

### Schema Extension Options

#### Option A: Extend Loans Table

```sql
-- Add servicing fields to existing loans table
ALTER TABLE loans ADD COLUMN servicing_status TEXT;
ALTER TABLE loans ADD COLUMN last_payment_date DATE;
ALTER TABLE loans ADD COLUMN next_payment_due DATE;
ALTER TABLE loans ADD COLUMN days_past_due INTEGER;
ALTER TABLE loans ADD COLUMN servicer_name TEXT;
```

**Pros**: Simple, single table
**Cons**: May bloat loans table, mixes origination and servicing

#### Option B: Separate Servicing Table

```sql
-- Separate servicing data linked by loan_id
CREATE TABLE loan_servicing (
  id UUID PRIMARY KEY,
  loan_id TEXT REFERENCES loans(loan_id),
  servicing_status TEXT,
  servicer_name TEXT,
  boarding_date DATE,
  current_balance DECIMAL(12,2),
  next_payment_due DATE,
  last_payment_date DATE,
  last_payment_amount DECIMAL(12,2),
  days_past_due INTEGER,
  -- ... more servicing fields
  updated_at TIMESTAMPTZ
);

CREATE TABLE loan_payment_history (
  id UUID PRIMARY KEY,
  loan_id TEXT REFERENCES loans(loan_id),
  payment_date DATE,
  payment_amount DECIMAL(12,2),
  principal DECIMAL(12,2),
  interest DECIMAL(12,2),
  escrow DECIMAL(12,2),
  payment_type TEXT, -- regular, prepayment, partial
  created_at TIMESTAMPTZ
);
```

**Pros**: Clean separation, flexible
**Cons**: More complex queries, joins required

#### Recommended: Hybrid Approach

- **Key servicing fields** on loans table (status, servicer, DPD)
- **Detailed history** in separate tables (payments, escrow)
- **Materialized views** for common analytics

---

## 5. Use Cases

### Post-Origination Performance

> "How do loans from Loan Officer X perform after funding?"

```sql
-- Conceptual query
SELECT 
  lo.loan_officer,
  COUNT(*) as total_loans,
  AVG(s.days_past_due) as avg_dpd,
  SUM(CASE WHEN s.days_past_due >= 30 THEN 1 ELSE 0 END) as delinquent_30_plus
FROM loans lo
JOIN loan_servicing s ON lo.loan_id = s.loan_id
WHERE lo.funding_date >= '2025-01-01'
GROUP BY lo.loan_officer
ORDER BY delinquent_30_plus DESC;
```

### Portfolio Health Dashboard

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Portfolio Performance                                     Jan 23, 2026 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Total Serviced Loans: 12,456          Total Balance: $4.2B             │
│                                                                          │
│  Delinquency Rates                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Current     │ █████████████████████████████████████████  94.2%  │   │
│  │ 30 Days     │ ███                                         3.1%  │   │
│  │ 60 Days     │ █                                           1.2%  │   │
│  │ 90+ Days    │ █                                           1.5%  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  Prepayment Rate: 8.3% (annualized)                                    │
│  Default Rate: 0.4% YTD                                                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Risk Correlation Analysis

> "Which origination characteristics predict delinquency?"

```sql
-- Conceptual query
SELECT 
  lo.loan_type,
  lo.fico_score_band,  -- e.g., 620-660, 660-700, etc.
  COUNT(*) as total,
  AVG(s.days_past_due) as avg_dpd,
  SUM(CASE WHEN s.servicing_status = 'Default' THEN 1 ELSE 0 END)::FLOAT / COUNT(*) as default_rate
FROM loans lo
JOIN loan_servicing s ON lo.loan_id = s.loan_id
GROUP BY lo.loan_type, lo.fico_score_band
ORDER BY default_rate DESC;
```

---

## 6. Integration Patterns

### Universal Connector Extension

Servicing data sources would follow the same Universal Connector pattern:

```typescript
// Conceptual ServicingConnector
class ServicingConnector extends BaseConnector {
  async extractServicingData(options: ExtractionOptions): Promise<ServicingRecord[]> {
    // Implementation specific to servicing system
  }
  
  async extractPaymentHistory(loanIds: string[]): Promise<PaymentRecord[]> {
    // Get payment history for specific loans
  }
}
```

### Data Matching

Matching servicing records to origination loans requires:

| Match Key | Reliability | Notes |
|-----------|-------------|-------|
| `loan_id` | High | If same ID used |
| `loan_number` | Medium | May differ between systems |
| `borrower_ssn` + `property_address` | High | Requires PII handling |
| `MIN` (Mortgage Identification Number) | High | Industry standard |

### Sync Frequency

| Data Type | Recommended Frequency |
|-----------|----------------------|
| Loan status | Daily |
| Payment history | Weekly |
| Delinquency data | Daily |
| Payoff data | Daily |

---

## 7. Future Roadmap

### Phase 1: Requirements Gathering

| Task | Status |
|------|--------|
| Identify target servicing systems | ⬜ Not started |
| Define key servicing metrics | ⬜ Not started |
| Design servicing data model | ⬜ Not started |
| Determine MVP data scope | ⬜ Not started |

### Phase 2: MVP Implementation

| Task | Status |
|------|--------|
| Implement ServicingConnector interface | ⬜ Not started |
| Build first servicer integration (TBD) | ⬜ Not started |
| Create servicing tables | ⬜ Not started |
| Add servicing dashboard widgets | ⬜ Not started |

### Phase 3: Full Rollout

| Task | Status |
|------|--------|
| Additional servicer integrations | ⬜ Not started |
| Payment history analytics | ⬜ Not started |
| Risk correlation models | ⬜ Not started |
| Portfolio performance reports | ⬜ Not started |

---

## 8. Related Documentation

- [Data Architecture Overview](../OVERVIEW.md)
- [Universal Connector](../UNIVERSAL_CONNECTOR.md)
- [Data Quality Framework](../DATA_QUALITY.md)
- [Multi-Tenant Architecture](../../architecture/MULTI_TENANT.md)
