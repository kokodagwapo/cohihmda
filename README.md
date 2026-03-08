# Cohi / Coheus

AI-powered loan origination system with voice AI, RAG (Retrieval-Augmented Generation), real-time cost tracking, and comprehensive SOC 2 Type II compliance features.

## 🚀 Features

- 🎤 **Voice AI Integration** - Real-time voice conversations with Gemini 2.0 Flash Live
- 📚 **RAG System** - Document ingestion, chunking, embedding, and vector search
- 💰 **Cost Tracking** - Real-time cost monitoring for AI services and AWS infrastructure
- 🔄 **Hybrid Deployment** - Support for cloud, on-premise, and hybrid sync
- 💳 **Subscription Management** - Stripe integration for SaaS billing
- 📊 **Dashboard** - Real-time analytics and cost visualization
- 🔒 **SOC 2 Compliance** - Role-based access control, audit logging, encryption, and security monitoring
- 📋 **AgilePlan Integration** - Task management and project tracking
- 🏦 **LOS Integration** - Loan Origination System connectivity

## 🏗️ Architecture

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Backend**: Express.js + TypeScript + PostgreSQL
- **AI Services**: OpenAI, Google Gemini, Cohere
- **Vector DB**: Pinecone (managed) or pgvector (self-hosted)
- **Deployment**: AWS (S3, CloudFront, Elastic Beanstalk, Lambda, API Gateway)
- **Infrastructure**: Docker, Docker Compose, AWS-ready
- **Multi-Tenant**: Row-level security with tenant isolation

## 📋 Prerequisites

- Node.js 18+
- Docker and Docker Compose (optional, for database)
- PostgreSQL 15+ (or use Docker)
- API keys for AI services (OpenAI, Gemini, etc.)
- AWS account (for production deployment)

## 🚀 Quick Start

### Development Setup

```bash
# Clone repository
git clone <repository-url>
cd Cohi

# Install dependencies
npm run install:all

# Configure environment
cp .env.example .env
cp server/.env.example server/.env
# Edit .env files with your API keys

# Start database
docker-compose up -d postgres

# Run database migrations (if needed)
cd server
npm run migrate

# Seed default users (creates admin and user accounts)
npm run seed:users
# Note: Credentials will be displayed and saved to .credentials/ folder

# Start backend (terminal 1)
npm run dev

# Start frontend (terminal 2, from project root)
cd ..
npm run dev
```

Visit `http://localhost:8084` to access the application.

**Default Development Credentials:**
The seed script creates two users with randomly generated passwords (saved in `.credentials/` folder):
- Admin user (role: admin) - Full system access
- Standard user (role: user) - Normal user access

**Custom Credentials:**
Set environment variables in `server/.env` to use specific credentials:
```bash
ADMIN_EMAIL=admin@yourcompany.com
ADMIN_PASSWORD=your-secure-password
USER_EMAIL=user@yourcompany.com
USER_PASSWORD=your-secure-password
```

### Production Deployment

See [README.DEPLOYMENT.md](./README.DEPLOYMENT.md) for detailed AWS deployment instructions.

## 📁 Project Structure

```
Cohi/
├── src/                    # Frontend React application
│   ├── components/         # React components
│   │   ├── admin/         # Admin panel components
│   │   ├── dashboard/     # Dashboard components
│   │   ├── aletheia/      # Voice AI components
│   │   └── ui/            # shadcn/ui components
│   ├── pages/              # Page components
│   ├── lib/                # Utilities and API client
│   └── services/           # Frontend services
├── server/                 # Backend Express application
│   ├── src/
│   │   ├── routes/         # API routes
│   │   ├── services/       # Business logic services
│   │   ├── middleware/     # Express middleware (auth, RBAC, logging)
│   │   └── config/         # Configuration
│   └── package.json
├── lambda/                 # AWS Lambda functions
│   ├── Cohi-briefing/  # Executive briefing generation
│   ├── gemini-live-voice/  # Gemini Live API proxy
│   ├── stripe-checkout/    # Stripe checkout sessions
│   └── shared/             # Shared utilities
├── supabase/
│   └── migrations/         # Database migrations
├── infrastructure/         # Infrastructure as Code
│   └── aws/               # AWS CloudFormation/CDK templates
├── docker/                 # Docker infrastructure
│   ├── dev/               # Development configuration
│   ├── prod/              # Production configuration
│   ├── aws/               # EC2 deployment scripts
│   └── scripts/           # Deployment scripts
├── scripts/                # Deployment and utility scripts
└── docs/                   # Documentation
```

## 🔌 API Endpoints

### Authentication
- `POST /api/auth/signup` - User registration
- `POST /api/auth/signin` - User login
- `GET /api/auth/me` - Get current user
- `POST /api/auth/logout` - Logout

### RAG (Retrieval-Augmented Generation)
- `GET /api/rag/settings` - Get RAG settings
- `PUT /api/rag/settings` - Update RAG settings
- `POST /api/rag/documents/upload` - Upload document for RAG
- `POST /api/rag/search` - Vector similarity search
- `GET /api/rag/documents` - List documents

### Costs
- `GET /api/costs/summary` - Get cost summary
- `GET /api/costs/daily` - Daily cost breakdown
- `GET /api/costs/by-category` - Costs by service category
- `POST /api/costs/aws/sync` - Sync AWS costs

### Loans
- `GET /api/loans` - List loans with filters
- `POST /api/loans` - Create loan
- `GET /api/loans/:id` - Get loan details
- `PUT /api/loans/:id` - Update loan
- `POST /api/loans/upload` - Upload CSV

### Dashboard
- `GET /api/dashboard/overview` - Dashboard overview
- `GET /api/dashboard/funnel` - Loan funnel data
- `GET /api/dashboard/insights` - Executive insights

### Admin
- `GET /api/admin/users` - List users (admin only)
- `PUT /api/admin/users/:id` - Update user (admin only)
- `GET /api/admin/audit-logs` - Audit logs (admin only)
- `GET /api/admin/costs` - Cost analytics (admin only)

### Subscriptions
- `GET /api/subscriptions/plans` - List subscription plans
- `POST /api/subscriptions/checkout` - Create checkout session
- `GET /api/subscriptions/current` - Get current subscription

## 🔐 Environment Variables

### Frontend (.env)
```env
VITE_API_URL=http://localhost:3001
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

### Backend (server/.env)
```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=Cohi
DB_USER=postgres
DB_PASSWORD=your_password

# JWT
JWT_SECRET=your_jwt_secret_min_32_chars

# AI Services
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
COHERE_API_KEY=...

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# AWS (for production)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

# Application
NODE_ENV=production
PORT=3001
FRONTEND_URL=http://localhost:8084
```

See `.env.example` files for complete configuration.

## 🧪 Development

```bash
# Backend development
cd server
npm run dev

# Frontend development
npm run dev

# Run migrations
cd server
npm run migrate

# Run linting
npm run lint

# Build for production
npm run build:all
```

## 🚢 Production Deployment

### Automatic Deployment (CI/CD)

The project includes **automatic AWS deployment** via GitHub Actions. When you push code to specific branches, it automatically deploys to AWS:

- **`dev` branch** → Deploys to dev/staging environment
- **`main` branch** → Deploys to production environment

The CI/CD pipeline automatically:
1. Builds the frontend and deploys to S3
2. Builds the backend and deploys to Elastic Beanstalk
3. Deploys Lambda functions using Serverless Framework

**Setup Required:**
1. Configure GitHub Secrets (see below)
2. Push to `dev` or `main` branch to trigger deployment
3. Or manually trigger via GitHub Actions UI

**Required GitHub Secrets:**
- `AWS_ACCESS_KEY_ID` - AWS access key
- `AWS_SECRET_ACCESS_KEY` - AWS secret key
- `S3_BUCKET_DEV` - S3 bucket for dev frontend
- `S3_BUCKET_PROD` - S3 bucket for production frontend
- `EB_APP_NAME_DEV` - Elastic Beanstalk app name for dev
- `EB_APP_NAME_PROD` - Elastic Beanstalk app name for production
- `EB_ENV_NAME_DEV` - Elastic Beanstalk environment name for dev
- `EB_ENV_NAME_PROD` - Elastic Beanstalk environment name for production
- `CLOUDFRONT_DISTRIBUTION_ID_DEV` - (optional) CloudFront distribution ID for dev
- `CLOUDFRONT_DISTRIBUTION_ID_PROD` - (optional) CloudFront distribution ID for production
- `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` - Database credentials for Lambda
- `SECURITY_GROUP_ID`, `SUBNET_ID_1`, `SUBNET_ID_2` - VPC configuration for Lambda

### Manual AWS Deployment

If you prefer manual deployment:

1. **Frontend (S3 + CloudFront)**
   ```bash
   ./scripts/deploy-frontend-s3.sh
   ```

2. **Backend (Elastic Beanstalk)**
   ```bash
   ./scripts/deploy-backend-with-cors-fix.sh
   ```

3. **Lambda Functions**
   ```bash
   cd lambda
   serverless deploy --stage prod
   ```

See [README.DEPLOYMENT.md](./README.DEPLOYMENT.md) for detailed instructions.

## 🔒 Security & Compliance

- **SOC 2 Type II Compliance**: Role-based access control, audit logging, encryption
- **Multi-Tenant Isolation**: Row-level security with tenant_id, tenant isolation middleware
- **RBAC**: Role-based permissions (admin, user)
- **Audit Logging**: All sensitive operations logged
- **Encryption**: AWS KMS for secrets, encrypted database connections
- **Session Management**: Secure JWT tokens with expiration
- **CORS**: Configured for production domains
- **Rate Limiting**: API rate limiting middleware
- **Credential Management**: Environment-variable based credentials, no hardcoded secrets

### User Credential Management

**Development:**
```bash
cd server
npm run seed:users  # Creates users with random passwords
```

**Production:**
```bash
# Set secure credentials via environment variables
export ADMIN_EMAIL=admin@company.com
export ADMIN_PASSWORD=$(openssl rand -base64 32)
export USER_EMAIL=user@company.com
export USER_PASSWORD=$(openssl rand -base64 32)

cd server
NODE_ENV=production npm run seed:users:prod
```

**Security Best Practices:**
- Never commit credentials to version control
- Use strong, randomly generated passwords in production
- Rotate credentials regularly
- Use AWS Secrets Manager or similar for production deployments
- The `.credentials/` folder is git-ignored and used only in development

## 📚 Documentation

- [Backend Architecture](./BACKEND_ARCHITECTURE.md)
- [Docker Infrastructure](./docker/README.md) - Complete Docker setup guide
- [AgilePlan Implementation](./AGILEPLAN_IMPLEMENTATION.md)
- [Database Setup](./AGILEPLAN_DATABASE_SETUP.md)
- [SaaS Setup](./SAAS_SETUP.md)
- [Migration Summary](./MIGRATION_SUMMARY.md)

## 🧩 Key Technologies

- **Frontend**: React, TypeScript, Vite, Tailwind CSS, shadcn/ui, Recharts
- **Backend**: Node.js, Express, TypeScript, PostgreSQL
- **AI**: OpenAI, Google Gemini, Cohere
- **Database**: PostgreSQL with pgvector extension
- **Vector DB**: Pinecone (cloud) or pgvector (self-hosted)
- **Authentication**: JWT tokens
- **Payments**: Stripe
- **Deployment**: AWS (S3, CloudFront, Elastic Beanstalk, Lambda)
- **Infrastructure**: Docker, Docker Compose

## 📝 License

[Your License Here]

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📞 Support

For issues or questions, please open an issue on GitHub.

---

**Built with ❤️ for the lending industry**
