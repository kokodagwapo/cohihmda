# Database Migrations

This directory contains SQL migrations for the Coheus database schema.

## Quick Start for New Developers

**One-command setup** - Initialize your local database with all migrations and test data:

```bash
# 1. Start PostgreSQL (from project root)
docker compose -f docker/dev/docker-compose.dev.yml up -d postgres

# 2. Initialize database (from server folder)
cd server
npm install
npm run init:local
```

This creates:

- `coheus_management` database with all platform tables
- `tenant_acme_mortgage` test tenant database
- Test accounts:
  - Super Admin: `superadmin` / `super123`
  - Tenant Admin: `admin@acme.local` / `admin123`
  - Loan Officer: `user@acme.local` / `user123`

### Alternative: Platform-specific scripts

**Windows (PowerShell):**

```powershell
.\scripts\init-local-db.ps1
```

**Mac/Linux (Bash):**

```bash
./scripts/init-local-db.sh
```

---

## Directory Structure

```
migrations/
├── management/           # Migrations for coheus_management database
│   ├── 001_initial_schema.sql
│   ├── 002_provisioning_history.sql
│   └── ...
├── tenant/               # Migrations for tenant databases
│   ├── 001_core_tables.sql
│   ├── 002_loans_table.sql
│   ├── 003_los_connections.sql
│   ├── 004_rag_ai_settings.sql
│   ├── 005_tenant_configuration.sql
│   ├── 006_rbac_and_predictions.sql
│   └── ...
└── README.md
```

## Migration Naming Convention

Migrations must follow this naming pattern:

```
NNN_description.sql
```

Where:

- `NNN` is a 3-digit version number (001, 002, 003, etc.)
- `description` is a lowercase snake_case description
- Extension must be `.sql`

Examples:

- `001_initial_schema.sql`
- `002_add_user_preferences.sql`
- `003_fix_loan_indexes.sql`

## Running Migrations

### From the server directory:

```bash
# Run all pending management database migrations
npm run migrate

# Check migration status
npm run migrate:status

# Preview migrations without applying (dry run)
npm run migrate:dry-run

# Run migrations for a specific tenant
npm run migrate:tenant -- acme-mortgage

# Run migrations for all tenants
npm run migrate:all

# Create a new migration file
npm run migrate:create -- add_new_feature
npm run migrate:create -- add_tenant_feature --tenant
```

### From the deploy scripts directory:

```powershell
# Run migrations against AWS Aurora
.\06-run-migrations.ps1

# Dry run
.\06-run-migrations.ps1 -DryRun

# Run for all tenants
.\06-run-migrations.ps1 -AllTenants

# Create super admin
.\06-run-migrations.ps1 -CreateSuperAdmin
```

## How Migrations Work

1. **Tracking**: Applied migrations are recorded in a `schema_migrations` table:

   ```sql
   CREATE TABLE schema_migrations (
     id SERIAL PRIMARY KEY,
     version VARCHAR(10) NOT NULL UNIQUE,
     name VARCHAR(255) NOT NULL,
     checksum VARCHAR(32) NOT NULL,
     applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     execution_time_ms INTEGER NOT NULL DEFAULT 0
   );
   ```

2. **Ordering**: Migrations run in version order (001 → 002 → 003)

3. **Idempotency**: Each migration runs exactly once. The runner checks if a version has been applied before running.

4. **Checksum Verification**: If a migration file is modified after being applied, the runner will error. This prevents schema drift.

5. **Transactions**: Each migration runs in a transaction. If any statement fails, the entire migration is rolled back.

## Writing Migrations

### Best Practices

1. **Make migrations idempotent** where possible:

   ```sql
   CREATE TABLE IF NOT EXISTS ...
   CREATE INDEX IF NOT EXISTS ...
   ```

2. **Never modify applied migrations**. Create a new migration instead.

3. **Use descriptive names** that indicate what the migration does.

4. **Test migrations** in a development environment before production.

5. **Include comments** explaining the purpose of the migration.

### Migration Template

```sql
-- Migration: Description of what this migration does
-- Created: YYYY-MM-DD
-- Database: management | tenant
--
-- Detailed description of changes...

-- Create new table
CREATE TABLE IF NOT EXISTS new_table (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- columns...
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_new_table_... ON new_table(...);

-- Add trigger for updated_at
DROP TRIGGER IF EXISTS trigger_new_table_updated_at ON new_table;
CREATE TRIGGER trigger_new_table_updated_at
  BEFORE UPDATE ON new_table
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### Altering Existing Tables

When modifying existing tables, always check if the change is needed first:

```sql
-- Add column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'users'
    AND column_name = 'new_column'
  ) THEN
    ALTER TABLE users ADD COLUMN new_column TEXT;
  END IF;
END $$;
```

## Management vs Tenant Migrations

### Management Database (`coheus_management`)

- Single database for the entire platform
- Stores tenant registry, super admins, subscriptions
- Migrations in `migrations/management/`

### Tenant Databases (`tenant_*`)

- One database per tenant
- Stores tenant-specific data (users, loans, etc.)
- Migrations in `migrations/tenant/`
- Same migrations run on all tenant databases

## Deployment Workflow

### Production Deployment Order

1. **Deploy infrastructure** (Aurora, ECS, etc.)
2. **Run migrations via ECS Exec** (see below)
3. **Create super admin via ECS Exec**
4. **Deploy tenant provisioning** (optional)
5. **Provision tenants** (creates tenant DBs)
6. **Run tenant migrations via ECS Exec**

### Why ECS Exec (Not Local Scripts)?

The Aurora database is in a **private VPC subnet** - your local machine cannot connect directly. You must run migrations from within the VPC, which ECS containers have access to.

**Do NOT run migrations on container startup** - this causes race conditions with multiple containers, adds startup latency, and makes failure diagnosis harder.

### Running Migrations via ECS Exec

**Prerequisites:**

- ECS service deployed with `EnableExecuteCommand: true`
- AWS Session Manager plugin installed locally
- Task role has SSM permissions (included in CloudFormation)

**Step 1: Get the running task ARN**

```powershell
$taskArn = aws ecs list-tasks `
    --cluster coheus-dev-cluster `
    --service-name coheus-dev-service `
    --profile DevEnvPerms-339712788893 `
    --region us-east-2 `
    --query 'taskArns[0]' `
    --output text

echo $taskArn
```

**Step 2: Connect to the container**

```powershell
aws ecs execute-command `
    --cluster coheus-dev-cluster `
    --task $taskArn `
    --container coheus-backend `
    --interactive `
    --command "/bin/sh" `
    --profile DevEnvPerms-339712788893 `
    --region us-east-2
```

**Step 3: Run migrations inside the container**

```bash
# Check migration status
npm run migrate:status

# Run pending migrations
npm run migrate

# Run tenant migrations (after provisioning tenants)
npm run migrate:all
```

**Step 4: Create super admin (first time only)**

```bash
SEED_SUPER_ADMIN_EMAIL=admin@example.com \
SEED_SUPER_ADMIN_PASSWORD='SecurePassword123!' \
SEED_SUPER_ADMIN_NAME='Platform Admin' \
npm run seed:super-admin
```

### CI/CD Integration (Future)

For automated deployments, add a migration step to your GitHub Actions workflow that runs migrations via `aws ecs run-task` before deploying new container images.

## Troubleshooting

### "ETIMEDOUT" or "Connection refused" from local machine

**This is expected.** Aurora is in a private VPC - your local machine cannot connect.

**Solution:** Run migrations via ECS Exec (see "Running Migrations via ECS Exec" above).

### "Checksum mismatch" error

A migration file was modified after being applied. Options:

1. Restore the original file
2. Create a new migration to make the desired changes

### "Table already exists" error

The migration wasn't properly tracked. Check `schema_migrations` table.

### ECS Exec not working

**"Session Manager plugin not found"**
Install the AWS Session Manager plugin:

- Windows: `choco install session-manager-plugin` or download from AWS
- Mac: `brew install session-manager-plugin`

**"Unable to start command" or "TargetNotConnectedException"**

- Ensure ECS service has `EnableExecuteCommand: true`
- Ensure task role has SSM permissions
- Wait 1-2 minutes after deployment for agent to initialize
- Check task is in RUNNING state: `aws ecs describe-tasks --cluster <cluster> --tasks <task-arn>`

### Viewing migration status

```bash
npm run migrate:status
```

Or query directly:

```sql
SELECT version, name, applied_at, execution_time_ms
FROM schema_migrations
ORDER BY version;
```
