# Cohi Architecture Overview

This document provides a high-level overview of the Cohi platform architecture, supporting both multi-tenant SaaS and self-hosted deployment modes.

> **Naming Convention:**
> - **Cohi** - The new executive intelligence platform (this product)
> - **Coheus** - The legacy Qlik Sense-based product

## Table of Contents

- [System Overview](#system-overview)
- [Deployment Modes](#deployment-modes)
- [Core Components](#core-components)
- [Technology Stack](#technology-stack)
- [Data Flow](#data-flow)
- [Security Architecture](#security-architecture)
- [Related Documentation](#related-documentation)

---

## System Overview

Cohi is an executive intelligence platform for mortgage lenders, providing real-time analytics, AI-powered insights, and performance dashboards. The platform is designed to operate in two distinct deployment modes from a single codebase:

1. **Multi-Tenant SaaS** - Hosted by Cohi, serving multiple lender organizations
2. **Self-Hosted** - Deployed in customer's own AWS account via AWS Marketplace

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             COHI PLATFORM                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────┐    ┌──────────────────────────────┐       │
│  │     Multi-Tenant SaaS        │    │      Self-Hosted             │       │
│  │                              │    │                              │       │
│  │  • Aurora Serverless v2      │    │  • Single RDS PostgreSQL     │       │
│  │  • Database-per-tenant       │    │  • Single database           │       │
│  │  • ECS Fargate (auto-scale)  │    │  • EC2 or ECS (fixed)        │       │
│  │  • CloudFront + WAF          │    │  • ALB + optional CDN        │       │
│  │  • Centralized management    │    │  • Customer-managed          │       │
│  │                              │    │                              │       │
│  └──────────────────────────────┘    └──────────────────────────────┘       │
│                                                                              │
│                    ┌─────────────────────────────┐                           │
│                    │     Single Codebase          │                           │
│                    │                              │                           │
│                    │  Runtime Configuration:     │                           │
│                    │  • DEPLOYMENT_MODE          │                           │
│                    │  • MULTI_TENANT_ENABLED     │                           │
│                    │                              │                           │
│                    └─────────────────────────────┘                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Deployment Modes

### Multi-Tenant SaaS Mode

The SaaS deployment serves multiple mortgage lender organizations from shared infrastructure while maintaining strict data isolation through database-per-tenant architecture.

**Key Characteristics:**
- Each tenant has their own database within Aurora Serverless v2 clusters
- Tenants are grouped into clusters (25-50 tenants per cluster) for cost efficiency
- Management database tracks tenant configurations and cluster assignments
- Auto-scaling compute layer handles variable workloads
- Centralized monitoring and management

**Configuration:**
```env
DEPLOYMENT_MODE=saas
MULTI_TENANT_ENABLED=true
MANAGEMENT_DB_HOST=management-cluster.xxx.us-east-1.rds.amazonaws.com
MANAGEMENT_DB_NAME=cohi_management
```

**Best For:**
- Lenders who prefer managed services
- Organizations without dedicated DevOps teams
- Rapid onboarding requirements

### Self-Hosted Mode

The self-hosted deployment runs entirely within the customer's AWS account, deployed via AWS Marketplace CloudFormation template.

**Key Characteristics:**
- Single PostgreSQL database (no multi-tenancy)
- Simplified infrastructure (EC2 or single ECS task)
- Customer owns all data and infrastructure
- Customer manages updates and maintenance

**Configuration:**
```env
DEPLOYMENT_MODE=self_hosted
MULTI_TENANT_ENABLED=false
DB_HOST=localhost
DB_NAME=cohi
```

**Best For:**
- Organizations with strict data residency requirements
- Companies with existing AWS infrastructure teams
- Enterprises requiring full control over their data

---

## Core Components

### Frontend (React/TypeScript)

| Component | Description |
|-----------|-------------|
| Dashboard | Executive intelligence dashboard with KPIs and visualizations |
| Insights | AI-powered analytics and recommendations |
| Admin Panel | System configuration and user management |
| Loans Page | Detailed loan data exploration |

**Key Technologies:**
- React 18 with TypeScript
- Vite for build tooling
- TailwindCSS for styling
- TanStack Query for data fetching
- React Router for navigation

### Backend (Node.js/Express)

| Service | Description |
|---------|-------------|
| Auth Service | JWT-based authentication with session tracking |
| Metrics Service | Pre-defined metrics catalog with SQL implementations |
| Analytics Service | Dashboard data aggregation and calculations |
| Tenant Manager | Database connection routing for multi-tenant mode |
| WebSocket Server | Real-time AI voice assistant (Cohi) |
| SSO Service | Qlik Bridge + Cognito SAML federation |

**Key Technologies:**
- Node.js 22 with Express
- PostgreSQL via `pg` library
- JWT for authentication
- WebSocket for real-time features
- OpenAI/Gemini for AI features

### Database Layer

| Database | Purpose | Mode |
|----------|---------|------|
| Management DB | Tenant registry, user mappings, cluster assignments | SaaS only |
| Tenant DBs | Loan data, analytics, tenant-specific configs | SaaS only |
| Default DB | Users, sessions, audit logs (shared) | Both |
| Single DB | All data in one database | Self-hosted only |

---

## Technology Stack

### Infrastructure

| Layer | Multi-Tenant SaaS | Self-Hosted |
|-------|-------------------|-------------|
| CDN | CloudFront + WAF | Optional CloudFront |
| Load Balancer | Application Load Balancer | Application Load Balancer |
| Compute | ECS Fargate (auto-scaling) | EC2 or ECS (fixed) |
| Database | Aurora Serverless v2 | RDS PostgreSQL |
| Cache | ElastiCache Redis | Optional Redis |
| Secrets | AWS Secrets Manager | AWS Secrets Manager |
| Storage | S3 (documents, backups) | S3 (documents, backups) |

### Application

| Component | Technology |
|-----------|------------|
| Frontend Framework | React 18 + TypeScript |
| Build Tool | Vite |
| UI Components | shadcn/ui + TailwindCSS |
| State Management | TanStack Query + React Context |
| Backend Runtime | Node.js 22 |
| API Framework | Express.js |
| Database ORM | Raw SQL via pg library |
| Authentication | JWT + bcrypt |
| AI Integration | OpenAI API, Google Gemini |

---

## Data Flow

### Request Flow (Multi-Tenant SaaS)

```
User Request
     │
     ▼
┌─────────────┐
│  CloudFront │ ─── Static assets from S3
│    + WAF    │
└──────┬──────┘
       │ /api/* requests
       ▼
┌─────────────┐
│     ALB     │
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌─────────────────┐
│ ECS Fargate │ ──► │ authenticateToken│ Validate JWT
│   Backend   │     └────────┬────────┘
└──────┬──────┘              │
       │                     ▼
       │         ┌───────────────────────┐
       │         │ attachTenantContext   │
       │         │                       │
       │         │ 1. Get user role      │
       │         │ 2. Lookup tenant      │
       │         │ 3. Get cluster endpoint│
       │         │ 4. Get connection pool │
       │         └───────────┬───────────┘
       │                     │
       ▼                     ▼
┌─────────────┐     ┌─────────────────┐
│ Management  │     │ Tenant Database  │
│  Database   │     │ (Aurora Cluster) │
└─────────────┘     └─────────────────┘
```

### Request Flow (Self-Hosted)

```
User Request
     │
     ▼
┌─────────────┐
│     ALB     │
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌─────────────────┐
│  EC2/ECS    │ ──► │ authenticateToken│ Validate JWT
│   Backend   │     └────────┬────────┘
└──────┬──────┘              │
       │                     │ (Tenant context bypassed)
       │                     │
       ▼                     ▼
┌────────────────────────────────────┐
│         Single PostgreSQL           │
│            Database                 │
└────────────────────────────────────┘
```

---

## Security Architecture

### Authentication Flow

1. User submits credentials to `/api/auth/signin`
2. Backend validates credentials against `users` table
3. JWT token generated with `userId` and `email` claims
4. Token stored in localStorage on frontend
5. Subsequent requests include `Authorization: Bearer <token>` header
6. `authenticateToken` middleware validates JWT on each request

### Authorization Layers

| Layer | Description |
|-------|-------------|
| Authentication | JWT token validation |
| RBAC | Role-based access control (super_admin, tenant_admin, user) |
| Tenant Isolation | Database-level isolation per tenant |
| Resource Permissions | Fine-grained resource/action permissions |

### Data Isolation (Multi-Tenant)

- **Database Level**: Each tenant has a separate PostgreSQL database
- **Connection Pooling**: Separate connection pools per tenant
- **Query Isolation**: All queries execute against tenant-specific database
- **No Cross-Tenant Access**: Middleware prevents cross-tenant data access

---

## Related Documentation

### Data Architecture

| Document | Description |
|----------|-------------|
| [Data Overview](../data/OVERVIEW.md) | High-level data architecture and principles |
| [Universal Connector](../data/UNIVERSAL_CONNECTOR.md) | LOS-agnostic integration layer |
| [Incremental Sync](../data/INCREMENTAL_SYNC.md) | How data syncs from LOS systems |
| [CSV Import Guide](../data/CSV_IMPORT.md) | Manual and scheduled file imports |
| [Data Quality Framework](../data/DATA_QUALITY.md) | Validation, monitoring, and remediation |

### LOS Integrations

| Document | Description |
|----------|-------------|
| [Encompass Integration](../data/integrations/ENCOMPASS_INTEGRATION.md) | ICE Mortgage Technology LOS (production) |
| [MeridianLink Integration](../data/integrations/MERIDIANLINK_INTEGRATION.md) | LendingQB, OpenClose (planned) |
| [Servicing Integration](../data/integrations/SERVICING_INTEGRATION.md) | Post-origination data (parking lot) |

### Architecture

| Document | Description |
|----------|-------------|
| [MULTI_TENANT.md](./MULTI_TENANT.md) | Multi-tenant SaaS architecture details |
| [SELF_HOSTED.md](./SELF_HOSTED.md) | Self-hosted deployment guide |
| [AURORA_CLUSTERS.md](./AURORA_CLUSTERS.md) | Aurora Serverless v2 cluster strategy |
| [ADMIN_PANEL.md](./ADMIN_PANEL.md) | Admin panel architecture and role-based access |
| [INTERNAL_ADMIN_REQUIREMENTS.md](./INTERNAL_ADMIN_REQUIREMENTS.md) | TVMA internal admin features |
| [CLIENT_ADMIN_REQUIREMENTS.md](./CLIENT_ADMIN_REQUIREMENTS.md) | Client tenant admin features |

### Security

| Document | Description |
|----------|-------------|
| [AUTH_REFACTOR.md](../security/AUTH_REFACTOR.md) | Authentication refactoring plan |
| [SSO_AUTHENTICATION.md](../security/SSO_AUTHENTICATION.md) | SSO strategy (Qlik Bridge + Cognito) |
| [ROW_LEVEL_SECURITY.md](../security/ROW_LEVEL_SECURITY.md) | Custom field-based access control |
| [STATE_MANAGEMENT.md](../security/STATE_MANAGEMENT.md) | Frontend state management |

### Deployment

| Document | Description |
|----------|-------------|
| [TERRAFORM_MODULES.md](../deployment/TERRAFORM_MODULES.md) | Infrastructure as Code specifications |
| [AWS_MARKETPLACE.md](../deployment/AWS_MARKETPLACE.md) | AWS Marketplace publishing guide |
| [BACKEND_ARCHITECTURE.md](../BACKEND_ARCHITECTURE.md) | Existing backend documentation |
