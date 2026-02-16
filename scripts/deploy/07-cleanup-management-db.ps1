# ============================================================================
# Cleanup Management Database via ECS Exec
# ============================================================================
# Drops orphan tenant tables and legacy auth schema from coheus_management.
# These tables were incorrectly created by the legacy runMigrations() and
# are no longer referenced by any management-level code.
#
# Uses Node.js + pg inside the container (psql is not installed in the image).
# The cleanup JS is base64-encoded to avoid PowerShell/shell quoting issues.
#
# Prerequisites:
# - Backend deployed with ECS Exec enabled
# - Code changes from database schema cleanup already deployed
#
# Options:
# -DryRun       Preview what will be dropped without actually dropping
# -Prod         Run against prod (default is dev)
# ============================================================================

param(
    [switch]$DryRun,
    [switch]$Prod
)

# Load configuration
. "$PSScriptRoot/config.ps1"

if ($Prod) {
    $ENVIRONMENT = "prod"
    $STACK_BACKEND = "$PROJECT_NAME-prod-backend"
    Write-Status "*** PRODUCTION MODE ***" "Red"
    Write-Host ""
    $confirm = Read-Host "Are you sure you want to run cleanup on PRODUCTION? (type 'yes' to confirm)"
    if ($confirm -ne "yes") {
        Write-Status "Aborted." "Yellow"
        exit 0
    }
}

Write-Status "Management DB Cleanup (via ECS Exec) - Environment: $ENVIRONMENT" "Magenta"

# ============================================================================
# Get ECS Task Info
# ============================================================================
$ECS_CLUSTER = Get-StackOutput $STACK_BACKEND "ECSClusterName"
$ECS_SERVICE = Get-StackOutput $STACK_BACKEND "ECSServiceName"

if (-not $ECS_CLUSTER) {
    Write-Status "ERROR: Backend stack '$STACK_BACKEND' not found. Deploy backend first!" "Red"
    exit 1
}

Write-Status "Cluster: $ECS_CLUSTER"
Write-Status "Service: $ECS_SERVICE"

# ============================================================================
# Find Running Task
# ============================================================================
Write-Status "Finding running task..."

$TASK_ARN = aws ecs list-tasks `
    --cluster $ECS_CLUSTER `
    --service-name $ECS_SERVICE `
    --desired-status RUNNING `
    --profile $env:AWS_PROFILE `
    --region $env:AWS_REGION `
    --query 'taskArns[0]' `
    --output text

if (-not $TASK_ARN -or $TASK_ARN -eq "None") {
    Write-Status "ERROR: No running tasks found. Is the service running?" "Red"
    exit 1
}

$TASK_ID = $TASK_ARN.Split('/')[-1]
Write-Status "Task: $TASK_ID" "Green"

# ============================================================================
# Build the cleanup JS script (runs inside container with node + pg)
# ============================================================================
$CONTAINER_NAME = "coheus-backend"

$orphanTables = @(
    'call_sessions','contacts','documents','loans',
    'los_connections','los_sync_logs',
    'vendor_connections','vendor_sync_logs',
    'tenant_field_mappings','encompass_field_swaps',
    'encompass_token_cache','encompass_concurrency_metrics',
    'rag_settings','rag_document_sources','rag_documents',
    'user_sessions','failed_login_attempts',
    'data_access_logs','audit_logs',
    'profiles','users','tenants',
    'deployment_instances','aws_deployments','aws_billing_history'
)

$tablesJson = ($orphanTables | ForEach-Object { "`"$_`"" }) -join ','

if ($DryRun) {
    Write-Status "DRY RUN - checking which orphan tables exist..." "Yellow"

    $jsScript = @"
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: 'coheus_management',
  ssl: { rejectUnauthorized: false }
});
const orphans = [$tablesJson];
(async () => {
  try {
    const res = await pool.query(
      "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    const existing = res.rows.map(r => r.table_name);
    const toDelete = orphans.filter(t => existing.includes(t));
    const schemaRes = await pool.query(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'auth'"
    );
    console.log('\n=== DRY RUN - Tables that WOULD be dropped ===');
    if (toDelete.length === 0) {
      console.log('  (none found - already clean!)');
    } else {
      toDelete.forEach(t => console.log('  DROP TABLE public.' + t + ' CASCADE'));
    }
    if (schemaRes.rows.length > 0) {
      console.log('  DROP SCHEMA auth CASCADE');
    }
    console.log('\n=== All current public tables ===');
    existing.forEach(t => {
      const marker = orphans.includes(t) ? ' <-- WILL BE DROPPED' : '';
      console.log('  ' + t + marker);
    });
    console.log('\nTotal: ' + existing.length + ' tables, ' + toDelete.length + ' to drop');
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
"@
} else {
    Write-Status "Dropping orphan tables from coheus_management..." "Yellow"

    $jsScript = @"
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: 'coheus_management',
  ssl: { rejectUnauthorized: false }
});
const orphans = [$tablesJson];
(async () => {
  try {
    let dropped = 0;
    for (const t of orphans) {
      try {
        await pool.query('DROP TABLE IF EXISTS public.' + t + ' CASCADE');
        console.log('  Dropped: ' + t);
        dropped++;
      } catch (e) {
        console.error('  Error dropping ' + t + ': ' + e.message);
      }
    }
    try {
      await pool.query('DROP SCHEMA IF EXISTS auth CASCADE');
      console.log('  Dropped schema: auth');
    } catch (e) {
      console.error('  Error dropping auth schema: ' + e.message);
    }
    console.log('\n=== Remaining tables in public schema ===');
    const res = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    res.rows.forEach(r => console.log('  ' + r.table_name));
    console.log('\nDone! Dropped ' + dropped + ' tables. ' + res.rows.length + ' remain.');
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
"@
}

# Base64-encode to avoid all PowerShell/shell quoting issues
$jsBytes  = [System.Text.Encoding]::UTF8.GetBytes($jsScript)
$jsBase64 = [System.Convert]::ToBase64String($jsBytes)

Write-Status "Executing cleanup script inside ECS container..."
Write-Host ""

# Command: decode base64 JS to a temp file, then run with node
# No embedded quotes = no PowerShell/Win32 command-line parsing issues
$shellCmd = "/bin/sh -c 'echo $jsBase64 | base64 -d > /app/server/cleanup.cjs && node /app/server/cleanup.cjs && rm /app/server/cleanup.cjs'"

aws ecs execute-command `
    --cluster $ECS_CLUSTER `
    --task $TASK_ARN `
    --container $CONTAINER_NAME `
    --interactive `
    --command $shellCmd `
    --profile $env:AWS_PROFILE `
    --region $env:AWS_REGION

if ($LASTEXITCODE -ne 0) {
    Write-Status "Command may have failed. Check output above." "Yellow"
    exit 1
}

Write-Host ""
if ($DryRun) {
    Write-Status "Dry run complete. No changes were made." "Cyan"
    Write-Status "Run without -DryRun to apply changes." "Gray"
} else {
    Write-Status "Cleanup complete!" "Green"
}
