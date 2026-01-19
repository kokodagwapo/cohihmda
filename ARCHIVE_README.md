# Ailethia / Coheus - Production Archive

This archive contains a clean, production-ready version of the Ailethia application for software architect review.

## 📁 Archive Contents

### Source Code
- `src/` - Frontend React application (TypeScript/TSX)
- `server-src/` - Backend Express application (TypeScript)
- `lambda/` - AWS Lambda functions
- `public/` - Static assets and HTML pages

### Database
- `supabase/migrations/` - Complete database schema and migrations
  - All 21+ migration files
  - Multi-tenant schema
  - RBAC permissions
  - Full schema documentation

### Infrastructure
- `infrastructure/` - Infrastructure as Code (AWS CloudFormation, scripts)
- `scripts/` - Deployment and utility scripts

### Configuration
- `package.json` - Frontend dependencies
- `server-package.json` - Backend dependencies
- `tsconfig.json` - TypeScript configuration
- `vite.config.ts` - Vite build configuration
- `tailwind.config.ts` - Tailwind CSS configuration
- `.gitignore` - Git ignore patterns

### Documentation
- `README.md` - Main project documentation
- `BACKEND_ARCHITECTURE.md` - Backend architecture details
- `AGILEPLAN_IMPLEMENTATION.md` - AgilePlan feature documentation
- `AGILEPLAN_DATABASE_SETUP.md` - Database setup guide
- `MIGRATION_SUMMARY.md` - Database migration summary
- `SAAS_SETUP.md` - SaaS configuration guide
- `CODE_REVIEW_REPORT_JAN3_2026.md` - Comprehensive code review

## 🗄️ Database Schema

The complete database schema is included in `supabase/migrations/`. Key tables:

- `tenants` - Multi-tenant isolation
- `users` - User authentication and profiles
- `loans` - Loan origination data
- `contacts` - Contact management
- `documents` - Document storage metadata
- `permissions` - RBAC permissions
- `audit_logs` - SOC 2 compliance logging
- `subscriptions` - Stripe subscription management

## 🏗️ Architecture

### Frontend
- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS + shadcn/ui
- **State Management**: React Hooks + Context
- **Routing**: React Router v6

### Backend
- **Framework**: Express.js + TypeScript
- **Database**: PostgreSQL 15 (RDS)
- **Authentication**: JWT tokens
- **Authorization**: RBAC (Role-Based Access Control)
- **API**: RESTful + WebSocket

### Infrastructure
- **Frontend**: AWS S3 + CloudFront
- **Backend**: AWS Elastic Beanstalk
- **Database**: AWS RDS PostgreSQL
- **Functions**: AWS Lambda
- **CDN**: CloudFront

## 🔐 Security Features

- SOC 2 Type II compliance features
- RBAC with granular permissions
- JWT authentication with refresh tokens
- Audit logging for all sensitive operations
- AWS KMS encryption for secrets
- SQL injection prevention (parameterized queries)
- CORS properly configured
- Rate limiting middleware

## 📊 Code Statistics

- **Frontend**: 159 TypeScript/TSX files
- **Backend**: 47 TypeScript files
- **Lambda Functions**: 11 functions
- **Database Migrations**: 21+ files
- **Total Lines of Code**: ~85,000
- **TypeScript Coverage**: ~95%

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 15+
- Docker (optional)

### Setup
```bash
# Install dependencies
npm install
cd server && npm install && cd ..

# Configure environment
cp .env.example .env
cp server-env.example server/.env
# Edit .env files with your configuration

# Run database migrations
cd server
npm run migrate

# Start development servers
npm run dev:all
```

## 📝 Code Quality

- **Overall Score**: 85/100 (B+)
- **Type Safety**: 95/100
- **Security**: 92/100
- **Error Handling**: 90/100
- **Code Organization**: 85/100

## ⚠️ Excluded from Archive

The following are excluded for security and cleanliness:
- `.env` files (use `.env.example` as template)
- `node_modules/` (install via `npm install`)
- Deployment ZIP files
- Temporary documentation files
- Backup directories
- Build artifacts (`dist/`, `docs/`)
- Log files

## 📞 Contact

For questions about this archive, please refer to the documentation files included.

---

**Archive Created**: Sat Jan  3 14:25:51 EST 2026
**Version**: Production Ready
**Status**: Clean, Reviewed, Production-Ready
