# Coheus v2 Backend Architecture

> **Version:** 2.0  
> **Last Updated:** December 2024  
> **Audience:** Software Engineers, Product Owners, Technical Stakeholders  
> **Author:** Teraverde Architecture Team

---

## Executive Summary

Coheus v2 is an enterprise-grade integration platform designed for the mortgage lending industry. The platform provides:

- **Universal LOS Integration** — Single adapter pattern connecting Encompass, Calyx, MeridianLink, and more
- **Real-time Voice AI** — Aletheia executive assistant powered by Gemini/OpenAI
- **Multi-tenant Architecture** — Secure isolation for lenders and vendors
- **Enterprise Compliance** — SOC 2 Type II and HIPAA-ready infrastructure

---

## Deployment Models: Complete Data Sovereignty

Coheus v2 offers two deployment models that ensure **Teraverde never accesses or pays for lender data**. This architecture builds trust by guaranteeing complete data sovereignty while still enabling powerful integrations.

### Deployment Model Comparison

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              COHEUS v2 DEPLOYMENT OPTIONS                                        │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│   OPTION 1: ON-PREMISE / LOCAL HOSTED              OPTION 2: CLOUD PER-TENANT                   │
│   ════════════════════════════════════             ═══════════════════════════                  │
│                                                                                                  │
│   ┌─────────────────────────────────┐              ┌─────────────────────────────────┐          │
│   │     LENDER'S DATA CENTER        │              │     LENDER'S AWS ACCOUNT        │          │
│   │     (Physical Servers)          │              │     (Isolated Cloud Tenant)     │          │
│   │                                 │              │                                 │          │
│   │   ┌─────────────────────────┐   │              │   ┌─────────────────────────┐   │          │
│   │   │   Coheus v2 Backend     │   │              │   │   Coheus v2 Backend     │   │          │
│   │   │   (Docker Compose)      │   │              │   │   (EC2 / ECS)           │   │          │
│   │   └─────────────────────────┘   │              │   └─────────────────────────┘   │          │
│   │                                 │              │                                 │          │
│   │   ┌─────────────────────────┐   │              │   ┌─────────────────────────┐   │          │
│   │   │   PostgreSQL + Redis    │   │              │   │   RDS + ElastiCache     │   │          │
│   │   │   (Local Servers)       │   │              │   │   (Lender's Account)    │   │          │
│   │   └─────────────────────────┘   │              │   └─────────────────────────┘   │          │
│   │                                 │              │                                 │          │
│   │   ┌─────────────────────────┐   │              │   ┌─────────────────────────┐   │          │
│   │   │   Document Storage      │   │              │   │   S3 Buckets            │   │          │
│   │   │   (Local NAS/SAN)       │   │              │   │   (Lender's Account)    │   │          │
│   │   └─────────────────────────┘   │              │   └─────────────────────────┘   │          │
│   │                                 │              │                                 │          │
│   │   🔒 100% On-Premise            │              │   🔒 100% In Lender's Cloud     │          │
│   │   🔒 No External Data Transfer  │              │   🔒 Lender Pays AWS Directly   │          │
│   │   🔒 Air-Gapped Option Available│              │   🔒 Full AWS Console Access    │          │
│   │                                 │              │                                 │          │
│   └─────────────────────────────────┘              └─────────────────────────────────┘          │
│                                                                                                  │
│   ┌─────────────────────────────────────────────────────────────────────────────────────────┐   │
│   │                            TERAVERDE'S ROLE (BOTH OPTIONS)                               │   │
│   ├─────────────────────────────────────────────────────────────────────────────────────────┤   │
│   │                                                                                          │   │
│   │   ✅ Provides software licenses and updates                                              │   │
│   │   ✅ Offers technical support and maintenance                                            │   │
│   │   ✅ Delivers security patches and compliance updates                                    │   │
│   │                                                                                          │   │
│   │   ❌ Does NOT access lender's private data                                               │   │
│   │   ❌ Does NOT pay for lender's infrastructure                                            │   │
│   │   ❌ Does NOT store any lender data on Teraverde systems                                 │   │
│   │   ❌ Does NOT have credentials to lender databases                                       │   │
│   │                                                                                          │   │
│   └─────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Option 1: On-Premise / Local Hosted

**Deployment:** Coheus v2 runs entirely on the lender's physical servers within their data center.

| Aspect | Details |
|--------|---------|
| **Infrastructure** | Lender's own physical servers (bare metal or VMware) |
| **Data Storage** | Local PostgreSQL, Redis, and NAS/SAN storage |
| **Network** | Lender's private network, optional air-gap |
| **Deployment Method** | Docker Compose or Kubernetes |
| **Who Pays** | Lender pays for their own hardware and electricity |
| **Teraverde Access** | Zero access to data or infrastructure |
| **Updates** | Lender-controlled update schedule |
| **Best For** | Banks with strict data residency requirements, credit unions, government lenders |

```bash
# On-Premise Deployment
docker-compose up -d

# Includes:
├── coheus-backend     # Express.js API + WebSocket
├── coheus-frontend    # React SPA
├── postgres           # Database (local)
├── redis              # Cache (local)
└── nginx              # Reverse proxy with TLS
```

### Option 2: Cloud Per-Tenant (Lender's AWS Account)

**Deployment:** Coheus v2 runs in the lender's own AWS account, completely isolated from other lenders and Teraverde.

| Aspect | Details |
|--------|---------|
| **Infrastructure** | Lender's AWS account (provisioned via AWS Control Tower) |
| **Data Storage** | RDS PostgreSQL, ElastiCache Redis, S3 — all in lender's account |
| **Network** | Lender's VPC with full control over security groups |
| **Deployment Method** | CloudFormation / Terraform (provided by Teraverde) |
| **Who Pays** | Lender pays AWS directly for their resources |
| **Teraverde Access** | Zero access — no IAM roles, no cross-account access |
| **Updates** | Automated via CI/CD pipeline (lender-approved) |
| **Best For** | Lenders wanting cloud benefits with complete data isolation |

```yaml
# Lender's AWS Account Resources
VPC:
  - Private subnets for compute
  - Public subnets for ALB only
  
Compute:
  - EC2 Auto Scaling Group (t3.medium)
  - Application Load Balancer
  
Data:
  - RDS PostgreSQL (Multi-AZ)
  - ElastiCache Redis
  - S3 buckets (encrypted)
  
Security:
  - KMS keys (lender-owned)
  - WAF rules
  - CloudTrail logging
```

### Trust Architecture: Why Lenders Trust Coheus

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              TRUST ARCHITECTURE                                          │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│   ┌───────────────────────────────────────────────────────────────────────────────────┐ │
│   │                         LENDER'S TRUST GUARANTEES                                  │ │
│   ├───────────────────────────────────────────────────────────────────────────────────┤ │
│   │                                                                                    │ │
│   │   1. DATA SOVEREIGNTY                                                              │ │
│   │      • All data resides in lender's infrastructure (on-prem or their AWS)         │ │
│   │      • Teraverde has zero access to production data                               │ │
│   │      • No data ever transits through Teraverde systems                            │ │
│   │                                                                                    │ │
│   │   2. FINANCIAL SEPARATION                                                          │ │
│   │      • Lender pays for their own infrastructure directly                          │ │
│   │      • No cost pass-through that could expose usage patterns                      │ │
│   │      • Clear separation: software license vs. infrastructure                      │ │
│   │                                                                                    │ │
│   │   3. AUDIT INDEPENDENCE                                                            │ │
│   │      • Lender can audit all data access logs                                      │ │
│   │      • Lender controls all encryption keys                                        │ │
│   │      • Lender can verify no external data exfiltration                            │ │
│   │                                                                                    │ │
│   │   4. VENDOR INTEGRATION CONTROL                                                    │ │
│   │      • Lender explicitly approves each vendor connection                          │ │
│   │      • Trusted partners connect via Universal Connector API                       │ │
│   │      • Lender can revoke vendor access at any time                                │ │
│   │                                                                                    │ │
│   └───────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Trusted Partner Integration

Even with complete data sovereignty, lenders can **optionally allow trusted partners** to connect via the Universal Connector API:

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                          TRUSTED PARTNER INTEGRATION                                     │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│   LENDER'S INFRASTRUCTURE                                                                │
│   (On-Prem or Cloud Per-Tenant)                                                         │
│                                                                                          │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│   │                           COHEUS v2 PLATFORM                                     │   │
│   │                                                                                  │   │
│   │   ┌─────────────────────────────────────────────────────────────────────────┐   │   │
│   │   │                    UNIVERSAL CONNECTOR API                               │   │   │
│   │   │                    (Controlled by Lender)                                │   │   │
│   │   └──────────────────────────────┬──────────────────────────────────────────┘   │   │
│   │                                  │                                               │   │
│   │   ┌──────────────────────────────▼──────────────────────────────────────────┐   │   │
│   │   │                    PARTNER ACCESS CONTROL                                │   │   │
│   │   │                                                                          │   │   │
│   │   │   ✅ Approved Partners          ❌ Blocked Partners                      │   │   │
│   │   │   ─────────────────────         ────────────────────                     │   │   │
│   │   │   • Experian (Credit)           • Unapproved vendors                     │   │   │
│   │   │   • First American (Title)      • Competitors                            │   │   │
│   │   │   • CoreLogic (Appraisal)       • Blacklisted IPs                        │   │   │
│   │   │                                                                          │   │   │
│   │   │   Access Controls:                                                       │   │   │
│   │   │   • OAuth 2.0 client credentials per partner                            │   │   │
│   │   │   • IP whitelist per partner                                            │   │   │
│   │   │   • Rate limits per partner                                             │   │   │
│   │   │   • Data scope restrictions (which loans they can access)               │   │   │
│   │   │   • Audit logging of all partner API calls                              │   │   │
│   │   │                                                                          │   │   │
│   │   └──────────────────────────────────────────────────────────────────────────┘   │   │
│   │                                                                                  │   │
│   └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                          │
│   KEY: Lender controls ALL partner access. Teraverde provides the platform,             │
│         but lender decides who connects and what data they can access.                  │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Partner Onboarding Workflow

```typescript
// Lender Admin: Approve a new trusted partner
interface PartnerApproval {
  partnerId: string;
  partnerName: string;          // e.g., "Experian"
  partnerType: 'credit' | 'title' | 'insurance' | 'appraisal' | 'compliance';
  
  // Access Controls (set by lender)
  accessControls: {
    ipWhitelist: string[];      // ["203.0.113.0/24"]
    rateLimit: number;          // requests per minute
    dataScope: 'all' | 'subset';
    allowedLoanStatuses?: string[];  // ["processing", "underwriting"]
    allowedFields?: string[];   // ["borrowerName", "loanAmount"] - exclude PII
  };
  
  // Credentials (generated for partner)
  credentials: {
    clientId: string;
    clientSecret: string;       // Encrypted, rotated quarterly
    tokenEndpoint: string;
  };
  
  approvedBy: string;           // Lender admin user ID
  approvedAt: Date;
  expiresAt: Date;              // Annual renewal required
}
```

---

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    COHEUS v2 PLATFORM                                    │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│  ┌─────────────────┐     ┌─────────────────────────────────────────────────────────┐    │
│  │   CLIENTS       │     │                    AWS INFRASTRUCTURE                    │    │
│  ├─────────────────┤     ├─────────────────────────────────────────────────────────┤    │
│  │                 │     │                                                          │    │
│  │  React Frontend │────▶│  ┌─────────────────────────────────────────────────┐    │    │
│  │  (Vite + TS)    │     │  │              APPLICATION LOAD BALANCER           │    │    │
│  │  Port: 5174     │     │  │                    (HTTPS/WSS)                    │    │    │
│  │                 │     │  └──────────────┬──────────────────┬─────────────────┘    │    │
│  └─────────────────┘     │                 │                  │                      │    │
│                          │                 ▼                  ▼                      │    │
│                          │  ┌──────────────────────┐  ┌──────────────────────┐      │    │
│                          │  │   EC2 INSTANCE #1    │  │   EC2 INSTANCE #2    │      │    │
│                          │  │   (t3.medium)        │  │   (t3.medium)        │      │    │
│                          │  │                      │  │                      │      │    │
│                          │  │  ┌────────────────┐  │  │  ┌────────────────┐  │      │    │
│                          │  │  │ Express.js     │  │  │  │ Express.js     │  │      │    │
│                          │  │  │ API Server     │  │  │  │ API Server     │  │      │    │
│                          │  │  │ Port: 3001     │  │  │  │ Port: 3001     │  │      │    │
│                          │  │  └───────┬────────┘  │  │  └───────┬────────┘  │      │    │
│                          │  │          │           │  │          │           │      │    │
│                          │  │  ┌───────▼────────┐  │  │  ┌───────▼────────┐  │      │    │
│                          │  │  │ WebSocket      │  │  │  │ WebSocket      │  │      │    │
│                          │  │  │ Server (WSS)   │  │  │  │ Server (WSS)   │  │      │    │
│                          │  │  └────────────────┘  │  │  └────────────────┘  │      │    │
│                          │  └──────────────────────┘  └──────────────────────┘      │    │
│                          │                 │                  │                      │    │
│                          │                 ▼                  ▼                      │    │
│                          │  ┌─────────────────────────────────────────────────┐      │    │
│                          │  │                   DATA LAYER                     │      │    │
│                          │  ├─────────────────────┬───────────────────────────┤      │    │
│                          │  │   PostgreSQL (RDS)  │      Redis (ElastiCache)  │      │    │
│                          │  │   - auth.users      │      - Session cache      │      │    │
│                          │  │   - profiles        │      - LOS data cache     │      │    │
│                          │  │   - tenants         │      - Rate limiting      │      │    │
│                          │  │   - contacts        │                           │      │    │
│                          │  │   - call_sessions   │                           │      │    │
│                          │  │   - documents       │                           │      │    │
│                          │  └─────────────────────┴───────────────────────────┘      │    │
│                          │                                                           │    │
│                          └───────────────────────────────────────────────────────────┘    │
│                                                                                          │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                               EXTERNAL INTEGRATIONS                                      │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐    │
│  │   LOS SYSTEMS   │  │   AI SERVICES   │  │    VENDORS      │  │   STORAGE       │    │
│  ├─────────────────┤  ├─────────────────┤  ├─────────────────┤  ├─────────────────┤    │
│  │ • Encompass     │  │ • Gemini Live   │  │ • Credit Bureaus│  │ • S3 (Documents)│    │
│  │ • Calyx Point   │  │   (Voice AI)    │  │ • Title Services│  │ • KMS (Keys)    │    │
│  │ • MeridianLink  │  │ • OpenAI        │  │ • Insurance     │  │ • Pinecone      │    │
│  │ • Custom LOS    │  │   Realtime API  │  │ • Appraisals    │  │   (Vectors)     │    │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  └─────────────────┘    │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Universal Connector API Architecture

The Universal Connector API is the core integration layer that allows **third-party vendors** (credit bureaus, title companies, insurance providers, appraisers) to connect to **lenders** through Coheus v2 with a single integration.

### Universal Connector Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                           COHEUS v2 UNIVERSAL CONNECTOR API                                      │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│   THIRD-PARTY VENDORS                    COHEUS PLATFORM                         LENDERS        │
│   (Build Once, Reach All)                (Universal Hub)                    (Connect Once)      │
│                                                                                                  │
│   ┌─────────────────┐                ┌─────────────────────────┐          ┌─────────────────┐   │
│   │ CREDIT BUREAUS  │                │                         │          │   LENDER A      │   │
│   │ • Experian      │───┐            │   ┌─────────────────┐   │          │   (Encompass)   │   │
│   │ • Equifax       │   │            │   │   API GATEWAY   │   │      ┌──▶│                 │   │
│   │ • TransUnion    │   │            │   │  Rate Limiting  │   │      │   └─────────────────┘   │
│   └─────────────────┘   │            │   │  Auth (OAuth2)  │   │      │                         │
│                         │            │   │  Request Valid. │   │      │   ┌─────────────────┐   │
│   ┌─────────────────┐   │            │   └────────┬────────┘   │      │   │   LENDER B      │   │
│   │ TITLE SERVICES  │   │            │            │            │      ├──▶│   (Calyx)       │   │
│   │ • First American│───┤            │   ┌────────▼────────┐   │      │   │                 │   │
│   │ • Fidelity      │   │            │   │   UNIVERSAL     │   │      │   └─────────────────┘   │
│   │ • Stewart       │   │            │   │   CONNECTOR     │   │      │                         │
│   └─────────────────┘   │            │   │                 │   │      │   ┌─────────────────┐   │
│                         │            │   │ ┌─────────────┐ │   │      │   │   LENDER C      │   │
│   ┌─────────────────┐   │            │   │ │ Canonical   │ │   │      ├──▶│   (MeridianLink)│   │
│   │ INSURANCE       │───┼───────────▶│   │ │ Data Schema │ │───┼──────┤   │                 │   │
│   │ • Homeowners    │   │            │   │ └─────────────┘ │   │      │   └─────────────────┘   │
│   │ • Flood         │   │            │   │                 │   │      │                         │
│   │ • Title         │   │            │   │ ┌─────────────┐ │   │      │   ┌─────────────────┐   │
│   └─────────────────┘   │            │   │ │ Transform   │ │   │      │   │   LENDER D      │   │
│                         │            │   │ │ & Route     │ │   │      └──▶│   (Custom LOS)  │   │
│   ┌─────────────────┐   │            │   │ └─────────────┘ │   │          │                 │   │
│   │ APPRAISALS      │───┤            │   │                 │   │          └─────────────────┘   │
│   │ • AMC Platforms │   │            │   │ ┌─────────────┐ │   │                                │
│   │ • Appraisal Mgmt│   │            │   │ │ Audit Log   │ │   │                                │
│   └─────────────────┘   │            │   │ │ & Compliance│ │   │                                │
│                         │            │   │ └─────────────┘ │   │                                │
│   ┌─────────────────┐   │            │   └─────────────────┘   │                                │
│   │ COMPLIANCE      │───┘            │                         │                                │
│   │ • RESPA/TRID    │                └─────────────────────────┘                                │
│   │ • HMDA          │                                                                            │
│   └─────────────────┘                                                                            │
│                                                                                                  │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                     DATA FLOW                                                    │
│                                                                                                  │
│   VENDOR → Coheus API → Canonical Schema → LOS Adapter → LENDER                                 │
│   LENDER → LOS Adapter → Canonical Schema → Coheus API → VENDOR                                 │
│                                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Vendor Integration API Endpoints

| Category | Endpoint | Method | Description |
|----------|----------|--------|-------------|
| **Credit** | `/api/vendors/credit/pull-report` | POST | Request credit report |
| **Credit** | `/api/vendors/credit/scores/{borrowerId}` | GET | Get credit scores |
| **Title** | `/api/vendors/title/search` | POST | Initiate title search |
| **Title** | `/api/vendors/title/order-insurance` | POST | Order title insurance |
| **Insurance** | `/api/vendors/insurance/homeowners-quote` | POST | Get homeowners quote |
| **Insurance** | `/api/vendors/insurance/flood-quote` | POST | Get flood insurance quote |
| **Appraisal** | `/api/vendors/appraisal/order` | POST | Order appraisal |
| **Appraisal** | `/api/vendors/appraisal/status/{orderId}` | GET | Check appraisal status |
| **Compliance** | `/api/vendors/compliance/respa-check` | POST | Run RESPA compliance check |
| **Compliance** | `/api/vendors/compliance/trid-calculate` | POST | Calculate TRID disclosures |

### Vendor Connector Interface

```typescript
interface VendorConnector {
  // OAuth 2.0 or API key authentication
  authenticate(): Promise<VendorCredentials>;
  
  // Fetch data from vendor service
  fetchData(request: VendorRequest): Promise<VendorResponse>;
  
  // Transform vendor format to Coheus canonical schema
  transform(data: VendorResponse): CanonicalVendorData;
  
  // Handle webhook callbacks from vendor
  handleWebhook(event: WebhookEvent): Promise<void>;
}

// Example: Credit Bureau Connector
class ExperianConnector implements VendorConnector {
  async authenticate(): Promise<VendorCredentials> {
    // OAuth 2.0 client credentials flow
    return await this.oauth.getAccessToken();
  }

  async fetchData(borrower: BorrowerInfo): Promise<CreditReport> {
    return await this.client.post('/credit-report', {
      ssn: borrower.ssn,  // Encrypted in transit
      firstName: borrower.firstName,
      lastName: borrower.lastName
    });
  }

  transform(response: ExperianResponse): CanonicalCreditReport {
    return {
      creditScore: response.score,
      tradeLines: response.accounts.map(this.mapTradeLine),
      inquiries: response.inquiries,
      publicRecords: response.publicRecords
    };
  }
}
```

### Economics: Build Once, Reach All

| Traditional Integration | With Coheus Universal Connector |
|------------------------|--------------------------------|
| $20K-$75K per lender | One-time integration cost |
| 6-12 months per lender | Days to weeks total |
| 50+ custom integrations | 1 integration |
| $1M-$3.75M total cost | Fraction of the cost |
| Ongoing maintenance per lender | Zero maintenance burden |

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Frontend** | React 18 + TypeScript + Vite | SPA with real-time updates |
| **API Server** | Express.js (Node.js 20+) | REST API + WebSocket server |
| **Database** | PostgreSQL 15+ | Transactional data storage |
| **Cache** | Redis | Session cache, rate limiting |
| **Voice AI** | Gemini Live API / OpenAI Realtime | Real-time voice conversations |
| **Vector DB** | Pinecone | RAG semantic search |
| **Cloud** | AWS (EC2, RDS, S3, KMS) | Infrastructure |

---

## Backend Server Architecture

### Entry Point: `server/src/index.ts`

```typescript
// Core server initialization
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Middleware stack
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());

// Route registration
setupRoutes(app);      // REST API routes
setupWebSocket(wss);   // WebSocket handlers

server.listen(3001);
```

### Directory Structure

```
server/
├── src/
│   ├── index.ts              # Application entry point
│   ├── config/
│   │   └── database.ts       # PostgreSQL connection pool
│   ├── middleware/
│   │   └── auth.ts           # JWT authentication middleware
│   ├── routes/
│   │   ├── index.ts          # Route aggregator
│   │   ├── auth.ts           # Authentication endpoints
│   │   ├── calls.ts          # Call session management
│   │   ├── news.ts           # Industry news feed
│   │   └── voice.ts          # Voice session API
│   └── services/
│       └── websocket.ts      # WebSocket handler (Aletheia)
└── .env                      # Environment configuration
```

---

## API Routes

### Authentication (`/api/auth`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/signup` | Create new user account |
| `POST` | `/signin` | Authenticate and receive JWT |
| `GET` | `/me` | Get current user profile |
| `POST` | `/signout` | Invalidate session |

### Voice Sessions (`/api/voice`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sessions` | Create new voice session |
| `GET` | `/sessions` | List active sessions |
| `GET` | `/sessions/:id` | Get session details |
| `DELETE` | `/sessions/:id` | End voice session |
| `POST` | `/sessions/:id/activity` | Update activity timestamp |
| `GET` | `/config` | Get voice configuration |

### Health Check

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | System health status |

---

## WebSocket Architecture

### Connection Flow

```
┌──────────┐     ┌──────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Client  │────▶│ ALB (WSS)    │────▶│ Express/WS      │────▶│ Gemini/OpenAI   │
│ Browser  │     │ TLS 1.3      │     │ Server          │     │ Realtime API    │
└──────────┘     └──────────────┘     └─────────────────┘     └─────────────────┘
     │                                        │                        │
     │  1. Connect with JWT token             │                        │
     │────────────────────────────────────────▶                        │
     │                                        │                        │
     │  2. Validate token, establish session  │                        │
     │                                        │  3. Connect to AI API  │
     │                                        │───────────────────────▶│
     │                                        │                        │
     │  4. Bidirectional audio streaming      │                        │
     │◀───────────────────────────────────────▶◀───────────────────────▶
     │                                        │                        │
```

### WebSocket Endpoints

| Endpoint | AI Provider | Use Case |
|----------|-------------|----------|
| `/ws/aletheia` | Gemini Live | Executive voice assistant |
| `/ws/aletheia?context=v2` | Gemini Live | Backend architecture expert |
| `/ws/maylin` | OpenAI Realtime | Customer service agent |
| `/ws/luna` | OpenAI Realtime | Customer service agent |

### Message Protocol (Gemini)

**Client → Server (Audio Input):**
```json
{
  "client_content": {
    "turns": [{
      "role": "user",
      "parts": [{
        "inline_data": {
          "mime_type": "audio/pcm16",
          "data": "<base64_audio>"
        }
      }]
    }],
    "turn_complete": true
  }
}
```

**Server → Client (Audio Response):**
```json
{
  "serverContent": {
    "modelTurn": {
      "parts": [{
        "inlineData": {
          "mimeType": "audio/pcm;rate=24000",
          "data": "<base64_audio>"
        }
      }]
    }
  }
}
```

---

## Database Schema

### Entity Relationship Diagram

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   auth.users    │      │    profiles     │      │    tenants      │
├─────────────────┤      ├─────────────────┤      ├─────────────────┤
│ id (PK)         │◀────▶│ id (PK)         │      │ id (PK)         │
│ email           │      │ user_id (FK)    │      │ name            │
│ encrypted_pwd   │      │ full_name       │      │ created_at      │
│ email_confirmed │      │ avatar_url      │      │ updated_at      │
│ created_at      │      │ tenant_id (FK)  │─────▶│                 │
│ updated_at      │      │ created_at      │      │                 │
└─────────────────┘      └─────────────────┘      └────────┬────────┘
                                                           │
                         ┌─────────────────────────────────┼────────────────────┐
                         │                                 │                    │
                         ▼                                 ▼                    ▼
              ┌─────────────────┐            ┌─────────────────┐    ┌─────────────────┐
              │    contacts     │            │  call_sessions  │    │   documents     │
              ├─────────────────┤            ├─────────────────┤    ├─────────────────┤
              │ id (PK)         │◀──────────▶│ id (PK)         │◀──▶│ id (PK)         │
              │ tenant_id (FK)  │            │ tenant_id (FK)  │    │ tenant_id (FK)  │
              │ full_name       │            │ contact_id (FK) │    │ contact_id (FK) │
              │ email           │            │ started_at      │    │ call_session_id │
              │ phone           │            │ ended_at        │    │ file_name       │
              │ employer        │            │ duration_seconds│    │ file_path       │
              │ monthly_income  │            │ status          │    │ file_size       │
              │ loan_amount_req │            │ sentiment_score │    │ mime_type       │
              │ created_at      │            │ summary         │    │ document_type   │
              └─────────────────┘            └─────────────────┘    └─────────────────┘
```

---

## Security Architecture

### Authentication Flow

```
┌──────────┐     ┌──────────────┐     ┌─────────────────┐
│  Client  │     │   Backend    │     │   PostgreSQL    │
└────┬─────┘     └──────┬───────┘     └────────┬────────┘
     │                  │                      │
     │  POST /signin    │                      │
     │  {email, pwd}    │                      │
     │─────────────────▶│                      │
     │                  │  SELECT user         │
     │                  │─────────────────────▶│
     │                  │                      │
     │                  │  bcrypt.compare()    │
     │                  │◀─────────────────────│
     │                  │                      │
     │  JWT Token       │                      │
     │  (7 day expiry)  │                      │
     │◀─────────────────│                      │
     │                  │                      │
     │  Subsequent      │                      │
     │  requests with   │                      │
     │  Authorization:  │                      │
     │  Bearer <token>  │                      │
     │─────────────────▶│                      │
     │                  │                      │
```

### Encryption Layers

| Layer | Technology | Scope |
|-------|------------|-------|
| **At Rest** | AES-256 (AWS KMS) | Database, S3 storage |
| **In Transit** | TLS 1.3 | All HTTP/WebSocket traffic |
| **Field-Level** | AWS KMS | SSN, DOB, account numbers |
| **Key Management** | AWS KMS | Automatic rotation, versioning |

### Compliance Controls

| Standard | Controls Implemented |
|----------|---------------------|
| **SOC 2 Type II** | Access control, change management, monitoring, incident response |
| **HIPAA** | Encryption, access logging, audit trails, BAAs |

---

## Single Sign-On (SSO) Architecture

Coheus v2 supports enterprise SSO integration for seamless authentication across lender organizations.

### SSO Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              SSO AUTHENTICATION FLOW                                     │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│   ┌──────────┐      ┌──────────────┐      ┌─────────────────┐      ┌────────────────┐   │
│   │   User   │      │   Coheus     │      │  Identity       │      │   Lender's     │   │
│   │ Browser  │      │   Frontend   │      │  Provider (IdP) │      │   SAML/OIDC    │   │
│   └────┬─────┘      └──────┬───────┘      └────────┬────────┘      └───────┬────────┘   │
│        │                   │                       │                       │            │
│        │  1. Access App    │                       │                       │            │
│        │──────────────────▶│                       │                       │            │
│        │                   │                       │                       │            │
│        │  2. Redirect to   │                       │                       │            │
│        │     SSO Login     │                       │                       │            │
│        │◀──────────────────│                       │                       │            │
│        │                   │                       │                       │            │
│        │  3. SAML/OIDC Auth Request               │                       │            │
│        │─────────────────────────────────────────▶│                       │            │
│        │                   │                       │                       │            │
│        │                   │  4. Validate with    │                       │            │
│        │                   │     Lender's IdP     │                       │            │
│        │                   │                       │──────────────────────▶│            │
│        │                   │                       │                       │            │
│        │                   │                       │  5. User Credentials  │            │
│        │                   │                       │     (AD/LDAP/Okta)    │            │
│        │                   │                       │◀──────────────────────│            │
│        │                   │                       │                       │            │
│        │  6. SAML Assertion / OIDC Token          │                       │            │
│        │◀─────────────────────────────────────────│                       │            │
│        │                   │                       │                       │            │
│        │  7. Submit Token  │                       │                       │            │
│        │──────────────────▶│                       │                       │            │
│        │                   │                       │                       │            │
│        │                   │  8. Validate Token   │                       │            │
│        │                   │     & Create Session │                       │            │
│        │                   │                       │                       │            │
│        │  9. JWT Session   │                       │                       │            │
│        │     Token         │                       │                       │            │
│        │◀──────────────────│                       │                       │            │
│        │                   │                       │                       │            │
│        │  10. Access App   │                       │                       │            │
│        │      (Authorized) │                       │                       │            │
│        │──────────────────▶│                       │                       │            │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Supported Identity Providers

| Provider | Protocol | Features |
|----------|----------|----------|
| **Okta** | SAML 2.0 / OIDC | MFA, Adaptive Auth, User Provisioning |
| **Azure AD** | SAML 2.0 / OIDC | Microsoft 365 Integration, Conditional Access |
| **AWS IAM Identity Center** | SAML 2.0 | AWS Account Integration, Permission Sets |
| **Google Workspace** | OIDC | Google Apps Integration |
| **OneLogin** | SAML 2.0 | Directory Sync, Smart Hooks |
| **Custom SAML/OIDC** | SAML 2.0 / OIDC | Any compliant IdP |

### SSO Configuration

```typescript
// SSO Provider Configuration
interface SSOConfig {
  provider: 'okta' | 'azure_ad' | 'aws_iam' | 'google' | 'custom';
  
  // SAML Configuration
  saml?: {
    entryPoint: string;        // IdP SSO URL
    issuer: string;            // Service Provider Entity ID
    cert: string;              // IdP X.509 Certificate
    callbackUrl: string;       // ACS URL
    signatureAlgorithm: 'sha256' | 'sha512';
  };
  
  // OIDC Configuration
  oidc?: {
    clientId: string;
    clientSecret: string;      // Encrypted at rest
    issuer: string;
    authorizationUrl: string;
    tokenUrl: string;
    userInfoUrl: string;
    scopes: string[];          // ['openid', 'profile', 'email']
  };
  
  // Attribute Mapping
  attributeMapping: {
    userId: string;            // e.g., 'nameID' or 'sub'
    email: string;             // e.g., 'email'
    firstName: string;         // e.g., 'given_name'
    lastName: string;          // e.g., 'family_name'
    groups?: string;           // e.g., 'groups' for role mapping
  };
}
```

### Multi-Tenant SSO Isolation

```
┌─────────────────────────────────────────────────────────────────┐
│                    MULTI-TENANT SSO                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────┐    ┌─────────────────┐                    │
│   │   LENDER A      │    │   LENDER B      │                    │
│   │   (Okta SSO)    │    │   (Azure AD)    │                    │
│   └────────┬────────┘    └────────┬────────┘                    │
│            │                      │                              │
│            ▼                      ▼                              │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │              COHEUS SSO ROUTER                           │   │
│   │  • Tenant detection from subdomain/email domain          │   │
│   │  • Route to correct IdP based on tenant config           │   │
│   │  • Validate SAML/OIDC response per tenant                │   │
│   │  • Issue tenant-scoped JWT                               │   │
│   └─────────────────────────────────────────────────────────┘   │
│            │                      │                              │
│            ▼                      ▼                              │
│   ┌─────────────────┐    ┌─────────────────┐                    │
│   │  Tenant A Data  │    │  Tenant B Data  │   (Row-Level       │
│   │  (Isolated)     │    │  (Isolated)     │    Security)       │
│   └─────────────────┘    └─────────────────┘                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## LLM Data Protection & Privacy

Coheus v2 implements multiple layers of protection to ensure sensitive mortgage data **never leaks to LLM providers** or gets used for model training.

### Data Protection Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                        LLM DATA PROTECTION ARCHITECTURE                                  │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│   ┌───────────────┐                                                                      │
│   │  USER QUERY   │  "What's the DTI for loan #12345 with SSN 123-45-6789?"             │
│   └───────┬───────┘                                                                      │
│           │                                                                              │
│           ▼                                                                              │
│   ┌───────────────────────────────────────────────────────────────────────────────┐     │
│   │                         LAYER 1: PII DETECTION & REDACTION                     │     │
│   │  ┌─────────────────────────────────────────────────────────────────────────┐  │     │
│   │  │  AWS Comprehend PII Detection                                            │  │     │
│   │  │  • Detects: SSN, DOB, Account Numbers, Addresses, Phone, Email          │  │     │
│   │  │  • Confidence threshold: 0.85+                                           │  │     │
│   │  │  • Action: Replace with tokens [SSN_REDACTED], [ACCOUNT_REDACTED]        │  │     │
│   │  └─────────────────────────────────────────────────────────────────────────┘  │     │
│   └───────────────────────────────────────────────────────────────────────────────┘     │
│           │                                                                              │
│           ▼  Sanitized: "What's the DTI for loan #[LOAN_ID] with SSN [SSN_REDACTED]?"   │
│                                                                                          │
│   ┌───────────────────────────────────────────────────────────────────────────────┐     │
│   │                         LAYER 2: CONTEXT INJECTION                             │     │
│   │  ┌─────────────────────────────────────────────────────────────────────────┐  │     │
│   │  │  RAG Pipeline (Pinecone Vector Search)                                   │  │     │
│   │  │  • Fetch relevant context from internal knowledge base                   │  │     │
│   │  │  • Context is pre-sanitized (no PII in embeddings)                       │  │     │
│   │  │  • Inject sanitized context into prompt                                  │  │     │
│   │  └─────────────────────────────────────────────────────────────────────────┘  │     │
│   └───────────────────────────────────────────────────────────────────────────────┘     │
│           │                                                                              │
│           ▼                                                                              │
│   ┌───────────────────────────────────────────────────────────────────────────────┐     │
│   │                         LAYER 3: API-LEVEL PROTECTION                          │     │
│   │  ┌─────────────────────────────────────────────────────────────────────────┐  │     │
│   │  │  Gemini/OpenAI API Configuration                                         │  │     │
│   │  │  • Data NOT used for model training (enterprise agreements)              │  │     │
│   │  │  • Zero data retention policy enabled                                    │  │     │
│   │  │  • No logging of prompts/responses on provider side                      │  │     │
│   │  │  • SOC 2 Type II compliant API endpoints                                 │  │     │
│   │  └─────────────────────────────────────────────────────────────────────────┘  │     │
│   └───────────────────────────────────────────────────────────────────────────────┘     │
│           │                                                                              │
│           ▼                                                                              │
│   ┌───────────────────────────────────────────────────────────────────────────────┐     │
│   │                         LAYER 4: RESPONSE VALIDATION                           │     │
│   │  ┌─────────────────────────────────────────────────────────────────────────┐  │     │
│   │  │  Post-Response Scanning                                                   │  │     │
│   │  │  • Scan LLM response for any leaked PII                                  │  │     │
│   │  │  • Block response if PII detected in output                              │  │     │
│   │  │  • Re-inject actual values from secure database (if needed)              │  │     │
│   │  └─────────────────────────────────────────────────────────────────────────┘  │     │
│   └───────────────────────────────────────────────────────────────────────────────┘     │
│           │                                                                              │
│           ▼                                                                              │
│   ┌───────────────┐                                                                      │
│   │  SAFE OUTPUT  │  "The DTI for that loan is 43.5%, which is within guidelines."      │
│   └───────────────┘                                                                      │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### PII Categories Protected

| Category | Examples | Detection Method | Action |
|----------|----------|------------------|--------|
| **SSN** | 123-45-6789 | Regex + ML | Tokenize: `[SSN_REDACTED]` |
| **Account Numbers** | Bank accounts, loan numbers | Pattern matching | Tokenize: `[ACCOUNT_REDACTED]` |
| **DOB** | 01/15/1985 | Date pattern + context | Tokenize: `[DOB_REDACTED]` |
| **Phone** | (555) 123-4567 | Phone pattern | Tokenize: `[PHONE_REDACTED]` |
| **Email** | john@example.com | Email pattern | Tokenize: `[EMAIL_REDACTED]` |
| **Address** | 123 Main St, City, ST 12345 | NER (AWS Comprehend) | Tokenize: `[ADDRESS_REDACTED]` |
| **Financial Data** | Income, assets, debts | Context-aware ML | Aggregate only |

### LLM Provider Agreements

| Provider | Agreement | Data Retention | Training Opt-Out | Compliance |
|----------|-----------|----------------|------------------|------------|
| **Google Gemini** | Enterprise Agreement | 0 days | ✅ Confirmed | SOC 2, ISO 27001 |
| **OpenAI** | Enterprise Agreement | 0 days | ✅ Confirmed | SOC 2, GDPR |

### Implementation: PII Sanitization Pipeline

```typescript
class PIISanitizer {
  private comprehend: AWS.Comprehend;
  private tokenMap: Map<string, string> = new Map();
  
  async sanitize(text: string): Promise<SanitizedResult> {
    // Detect PII using AWS Comprehend
    const piiEntities = await this.comprehend.detectPiiEntities({
      Text: text,
      LanguageCode: 'en'
    }).promise();
    
    let sanitizedText = text;
    const tokens: PIIToken[] = [];
    
    for (const entity of piiEntities.Entities || []) {
      if (entity.Score && entity.Score >= 0.85) {
        const originalValue = text.substring(
          entity.BeginOffset!, 
          entity.EndOffset!
        );
        const token = this.generateToken(entity.Type!);
        
        // Store mapping for potential re-injection
        this.tokenMap.set(token, originalValue);
        tokens.push({ token, type: entity.Type!, offset: entity.BeginOffset! });
        
        // Replace PII with token
        sanitizedText = sanitizedText.replace(originalValue, token);
      }
    }
    
    return { sanitizedText, tokens, originalLength: text.length };
  }
  
  private generateToken(type: string): string {
    const id = crypto.randomBytes(4).toString('hex');
    return `[${type}_${id}]`;
  }
}

// Usage in LLM call
async function queryAletheia(userQuery: string): Promise<string> {
  const sanitizer = new PIISanitizer();
  
  // Step 1: Sanitize input
  const { sanitizedText } = await sanitizer.sanitize(userQuery);
  
  // Step 2: Send sanitized query to LLM
  const llmResponse = await gemini.generateContent(sanitizedText);
  
  // Step 3: Validate response has no PII leakage
  const responseCheck = await sanitizer.detectPII(llmResponse);
  if (responseCheck.hasPII) {
    throw new Error('PII detected in LLM response - blocked');
  }
  
  return llmResponse;
}
```

### Audit Trail for LLM Interactions

```typescript
interface LLMAuditLog {
  id: string;
  timestamp: Date;
  userId: string;
  tenantId: string;
  
  // What was sent (sanitized)
  sanitizedPrompt: string;
  piiTokensCount: number;
  piiTypesDetected: string[];
  
  // LLM interaction
  llmProvider: 'gemini' | 'openai';
  model: string;
  responseLength: number;
  
  // Validation results
  inputPIIBlocked: boolean;
  outputPIIBlocked: boolean;
  
  // Performance
  latencyMs: number;
}
```

### Zero-Knowledge Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    ZERO-KNOWLEDGE DATA FLOW                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   COHEUS PLATFORM                          LLM PROVIDER          │
│   (Full Data Access)                       (Zero PII Access)     │
│                                                                  │
│   ┌─────────────────┐                                            │
│   │ Loan Database   │                                            │
│   │ • SSN: encrypted│                                            │
│   │ • Income: $85K  │                                            │
│   │ • DTI: 43.5%    │                                            │
│   └────────┬────────┘                                            │
│            │                                                      │
│            ▼                                                      │
│   ┌─────────────────┐      Sanitized Query        ┌────────────┐ │
│   │ PII Sanitizer   │─────────────────────────────▶│  Gemini   │ │
│   │ (AWS Comprehend)│      "What's a good DTI?"   │  Live API  │ │
│   └────────┬────────┘◀─────────────────────────────│            │ │
│            │              Generic Response         └────────────┘ │
│            ▼              "DTI under 43% is ideal"               │
│   ┌─────────────────┐                                            │
│   │ Response        │  Final: "Your DTI of 43.5% is              │
│   │ Enrichment      │   slightly above the 43% guideline."       │
│   │ (Add context)   │                                            │
│   └─────────────────┘                                            │
│                                                                  │
│   KEY PRINCIPLE: LLM never sees actual PII values                │
│   LLM provides generic insights; Coheus adds specific context    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## LOS Adapter Pattern

### Class Hierarchy

```typescript
// Abstract base class
abstract class LOSConnector {
  protected tenantId: string;
  
  abstract authenticate(): Promise<void>;
  abstract fetchLoans(filters?: LoanFilters): Promise<CanonicalLoan[]>;
  abstract syncWebhook(event: WebhookEvent): Promise<void>;
  
  protected async encryptPII(loan: CanonicalLoan): Promise<void> {
    // Field-level encryption for sensitive data
  }
}

// Concrete implementations
class EncompassConnector extends LOSConnector { /* REST + OAuth */ }
class CalyxConnector extends LOSConnector { /* Database access */ }
class MeridianLinkConnector extends LOSConnector { /* API integration */ }
```

### Canonical Loan Schema

```typescript
interface CanonicalLoan {
  loanNumber: string;
  borrowerInfo: {
    firstName: string;
    lastName: string;
    ssn?: string;        // Encrypted
    email: string;
    dti?: number;
  };
  loanAmount: number;
  propertyValue: number;
  loanType: 'fha' | 'va' | 'conventional' | 'usda' | 'jumbo';
  stage: 'inquiry' | 'application' | 'processing' | 
         'underwriting' | 'approved' | 'clear-to-close' | 'funded';
  applicationDate: Date;
  expectedCloseDate?: Date;
  source: 'encompass' | 'calyx' | 'meridian';
  lastSynced: Date;
}
```

### Data Sync Strategy

| Sync Type | Frequency | Purpose |
|-----------|-----------|---------|
| **Webhooks** | Real-time | Urgent updates (status changes) |
| **Incremental** | Hourly | Catch missed webhooks |
| **Full Sync** | Daily (2 AM) | Reconciliation |

---

## Deployment Architecture

### Production Configuration

```yaml
# EC2 Auto Scaling Group
Instance Type: t3.medium (2 vCPU, 4GB RAM)
Min Instances: 2
Max Instances: 5
Health Check: /health (30s interval)
Deployment: Rolling (zero-downtime)

# Load Balancer
Type: Application Load Balancer (ALB)
Protocol: HTTPS (TLS 1.3)
WebSocket: Sticky sessions enabled

# Database
Type: RDS PostgreSQL 15
Instance: db.t3.medium
Multi-AZ: Enabled
Storage: 100GB gp3 (encrypted)
```

### Deployment Options

| Model | Description | Best For |
|-------|-------------|----------|
| **SaaS** | Multi-tenant, Teraverde-hosted | Most lenders |
| **Self-Hosted** | Docker Compose on-premises | Data residency requirements |
| **Per-Vendor** | Isolated AWS accounts | Large vendors requiring isolation |

---

## Environment Variables

```bash
# Server
PORT=3001
NODE_ENV=development|production
JWT_SECRET=<32+ char secret>

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=coheus
DB_USER=postgres
DB_PASSWORD=<password>

# AI Services
ALETHEIA_AI_PROVIDER=gemini|openai
GEMINI_API_KEY=<key>
OPENAI_API_KEY=<key>

# Frontend
FRONTEND_URL=http://localhost:5174
```

---

## Performance Characteristics

| Metric | Target | Current |
|--------|--------|---------|
| API Response Time | < 200ms | ~50ms (p50) |
| WebSocket Latency | < 100ms | ~30ms |
| Database Queries | < 50ms | ~10ms (p50) |
| Voice Round-trip | < 500ms | ~300ms |
| Concurrent Connections | 1000+ | Tested to 500 |

---

## Monitoring & Observability

### Health Endpoints

```bash
# Application health
GET /health
Response: { "status": "ok", "timestamp": "2024-12-11T..." }

# Database connectivity
Checked during startup via initDatabase()
```

### Logging

| Component | Output | Level |
|-----------|--------|-------|
| Express | stdout | info |
| WebSocket | stdout | debug |
| Database | stdout | error |

---

## Error Handling

### WebSocket Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| 1008 | Policy violation | No token / unauthorized |
| 1011 | Internal error | AI service connection failed |

### API Error Response Format

```json
{
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

---

## Development Setup

### Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Docker (optional)

### Quick Start

```bash
# Clone and install
git clone <repo>
cd agenticlo
npm run install:all

# Configure environment
cp .env.example .env
cp server/.env.example server/.env
# Edit .env files with your API keys

# Start database (Docker)
docker-compose up -d postgres

# Start development servers
npm run dev:all

# Access
# Frontend: http://localhost:5174
# Backend:  http://localhost:3001
# V2 Page:  http://localhost:5174/v2
```

---

## Contact

**Coheus v2 Backend Architecture**  
Internal Documentation | December 2025

© 2025 TVMA, Inc. trading as Teraverde®. All rights reserved.
