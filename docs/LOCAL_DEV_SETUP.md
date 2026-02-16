# Local Development Setup

This guide gets you up and running with Coheus on your local machine.

## Prerequisites

- **Node.js 18+** - [Download](https://nodejs.org/)
- **Docker Desktop** - [Download](https://www.docker.com/products/docker-desktop/)
- **Git** - [Download](https://git-scm.com/downloads)

## Quick Start

### 1. Clone and Install Dependencies

```bash
git clone <repository-url>
cd cohi

# Install frontend dependencies
npm install

# Install backend dependencies
cd server
npm install
cd ..
```

### 2. Set Up Environment Files

```bash
# Copy example environment files
cp .env.example .env
cp server/.env.example server/.env
```

Edit `server/.env` with your settings (the defaults work for local development).

### 3. Start PostgreSQL

```bash
# From project root
docker compose -f docker/dev/docker-compose.dev.yml up -d postgres
```

### 4. Initialize the Database

This is the key step that sets up all your databases, runs migrations, and creates test accounts.

**Option A: Using npm (recommended, cross-platform)**

```bash
cd server
npm run init:local
```

**Option B: Using PowerShell (Windows)**

```powershell
.\scripts\init-local-db.ps1
```

**Option C: Using Bash (Mac/Linux)**

```bash
./scripts/init-local-db.sh
```

### 5. Start the Application

```bash
# Terminal 1 - Backend
cd server
npm run dev

# Terminal 2 - Frontend (from project root)
npm run dev
```

The app will be available at:

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:3001

---

## Test Accounts

After running `npm run init:local`, you'll have these test accounts:

| Role         | Email              | Password   | Database             |
| ------------ | ------------------ | ---------- | -------------------- |
| Super Admin  | `superadmin`       | `super123` | coheus_management    |
| Tenant Admin | `admin@acme.local` | `admin123` | tenant_acme_mortgage |
| Loan Officer | `user@acme.local`  | `user123`  | tenant_acme_mortgage |

---

## Database Structure

Coheus uses a multi-tenant architecture with separate databases:

```
PostgreSQL
├── coheus_management    # Platform-level data (tenants, super admins)
├── tenant_acme_mortgage # Test tenant database
└── tenant_*             # Additional tenant databases (created via UI)
```

### Migrations

All migrations live in `server/migrations/`:

- `management/` - Platform-level schema
- `tenant/` - Per-tenant schema (applied to each tenant DB)

**Useful commands:**

```bash
cd server

# Check migration status
npm run migrate:status

# Run pending management migrations
npm run migrate

# Run migrations for all tenants
npm run migrate:all

# Create a new migration
npm run migrate:create -- add_new_feature
npm run migrate:create -- add_tenant_feature --tenant
```

---

## Resetting Your Database

If you need to start fresh:

```bash
cd server
npm run init:local -- --reset
```

Or manually:

```bash
# Stop containers and remove volumes
docker compose -f docker/dev/docker-compose.dev.yml down -v

# Restart and reinitialize
docker compose -f docker/dev/docker-compose.dev.yml up -d postgres
cd server && npm run init:local
```

---

## Troubleshooting

### "Cannot connect to PostgreSQL"

Make sure Docker is running and PostgreSQL container is healthy:

```bash
docker ps
docker compose -f docker/dev/docker-compose.dev.yml logs postgres
```

### "Database does not exist"

Run the initialization script:

```bash
cd server
npm run init:local
```

### "Table already exists" / Migration errors

Reset and reinitialize:

```bash
cd server
npm run init:local -- --reset
```

### Port conflicts

If ports 5432 (PostgreSQL), 3001 (backend), or 5173 (frontend) are in use:

- Check for other running containers: `docker ps`
- Check for other processes: `netstat -ano | findstr :5432` (Windows)

---

## Full Docker Setup (Alternative)

If you prefer to run everything in Docker:

```bash
# Start all services
docker compose -f docker/dev/docker-compose.dev.yml up -d

# Initialize database (run once)
docker compose -f docker/dev/docker-compose.dev.yml exec backend npm run init:local
```

Services:

- **Frontend:** http://localhost:8080
- **Backend:** http://localhost:3001
- **PostgreSQL:** localhost:5432
- **Redis:** localhost:6379

---

## Next Steps

- Review the [API Documentation](./API.md)
- Understand the [Database Schema](./DATABASE_SCHEMA.md)
- Learn about [Multi-Tenancy](./MULTI_TENANCY.md)
