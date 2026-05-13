# Cohi — DR Test Procedures (Step-by-Step Runbook)

Executable, copy-paste-ready procedures for each DR drill. Environment-specific values are pre-filled from the live development environment. Update values when running against a different environment or after infrastructure changes.

**Parent document:** [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md) (pass criteria, cadence, result log)  
**Vendor summary:** [`DR_VENDOR_SUMMARY.md`](./DR_VENDOR_SUMMARY.md)

---

## Environment values

Update this section if running against a different environment.

```powershell
$prof   = "DevEnvPerms-339712788893"
$rg     = "us-east-2"
$acct   = "339712788893"

# Aurora
$sourceCluster  = "coheus-dev-management"
$testCluster    = "coheus-dev-management-drtest"
$testInstance   = "coheus-dev-management-drtest-1"
$subnetGroup    = "coheus-dev-aurora-management-dbsubnetgroup-gufluwcsv1mf"
$securityGroup  = "sg-04ebefe486e723332"
$kmsKey         = "arn:aws:kms:us-east-2:339712788893:key/81eaf21b-d7ef-4fc6-9902-76f37a28a2e7"

# ECS
$ecsCluster     = "coheus-dev-cluster"
$ecsService     = "coheus-dev-service"
$knownGoodTask  = "arn:aws:ecs:us-east-2:339712788893:task-definition/coheus-dev-backend:219"

# Frontend
$frontendBucket = "coheus-frontend-339712788893"
```

---

## Before you start (every drill)

1. Announce the test in the team channel: test name, expected duration, affected resources.
2. Confirm your AWS session is active:

```powershell
aws sts get-caller-identity --profile $prof
```

1. Confirm you are targeting the correct environment (dev, not prod).

---

## Procedure 1: Aurora Point-in-Time Recovery (PITR)

**What this proves:** The database can be restored to any point within the backup retention window.  
**Expected duration:** 30–45 minutes  
**Cost:** ~$0.20 for the temporary cluster

### Step 1.1 — Verify the source cluster and PITR window

```powershell
aws rds describe-db-clusters `
  --db-cluster-identifier $sourceCluster `
  --region $rg --profile $prof `
  --query "DBClusters[0].{Status:Status,BackupRetention:BackupRetentionPeriod,EarliestRestore:EarliestRestorableTime,LatestRestore:LatestRestorableTime,SubnetGroup:DBSubnetGroup,SGs:VpcSecurityGroups[*].VpcSecurityGroupId,KMS:KmsKeyId}"
```

**Check before proceeding:**

- Status is `available`
- `EarliestRestorableTime` is at least a few hours in the past
- `LatestRestorableTime` is within the last few minutes

Record the output. Screenshot or copy to your test log.

### Step 1.2 — Choose a restore target time

Pick a time 30 minutes ago (must be between EarliestRestore and LatestRestore):

```powershell
$target = (Get-Date).ToUniversalTime().AddMinutes(-30).ToString("yyyy-MM-ddTHH:mm:ssZ")
Write-Host "Restoring to: $target"
```

Record this timestamp in your test log.

### Step 1.3 — Restore the cluster

```powershell
aws rds restore-db-cluster-to-point-in-time `
  --source-db-cluster-identifier $sourceCluster `
  --db-cluster-identifier        $testCluster `
  --restore-to-time              $target `
  --db-subnet-group-name         $subnetGroup `
  --vpc-security-group-ids       $securityGroup `
  --kms-key-id                   $kmsKey `
  --region $rg --profile $prof
```

Do **not** add `--engine` here: AWS CLI v2 rejects it as ambiguous. The engine is inferred from the source cluster.

**Expected:** JSON response with `"Status": "creating"`. If you get an error about the cluster already existing, a previous test was not cleaned up -- delete it first (see Step 1.7).

### Step 1.4 — Add a serverless instance to the restored cluster

```powershell
aws rds create-db-instance `
  --db-cluster-identifier  $testCluster `
  --db-instance-identifier $testInstance `
  --db-instance-class      db.serverless `
  --engine                 aurora-postgresql `
  --region $rg --profile $prof
```

### Step 1.5 — Wait for the cluster and instance to become available

This takes 10–20 minutes. Run both waits:

```powershell
Write-Host "Waiting for cluster..." -ForegroundColor Yellow
aws rds wait db-cluster-available `
  --db-cluster-identifier $testCluster `
  --region $rg --profile $prof

Write-Host "Waiting for instance..." -ForegroundColor Yellow
aws rds wait db-instance-available `
  --db-instance-identifier $testInstance `
  --region $rg --profile $prof

Write-Host "Ready." -ForegroundColor Green
```

Record the time the cluster became available. This is part of your RTO measurement.

### Step 1.6 — Verify the restored data

Get the new cluster endpoint:

```powershell
aws rds describe-db-clusters `
  --db-cluster-identifier $testCluster `
  --region $rg --profile $prof `
  --query "DBClusters[0].Endpoint" --output text
```

Connect from inside the VPC using one of these methods:

**Option A — ECS exec into a running dev task:**

```powershell
# Find a running task
$taskArn = aws ecs list-tasks `
  --cluster $ecsCluster --service-name $ecsService `
  --region $rg --profile $prof `
  --query "taskArns[0]" --output text

# Get the container name
aws ecs describe-tasks `
  --cluster $ecsCluster --tasks $taskArn `
  --region $rg --profile $prof `
  --query "tasks[0].containers[*].name"

# Exec into it (replace <container-name> with the actual name)
aws ecs execute-command `
  --cluster $ecsCluster --task $taskArn `
  --container <container-name> `
  --interactive --command "/bin/sh" `
  --region $rg --profile $prof
```

Once inside the container shell, use **Node.js + `pg`** (installed in the backend image). The production image does **not** include `psql`.

```bash
# Replace <endpoint> with the cluster endpoint from above.
# Password: use the master user secret from Secrets Manager (same as primary admin secret pattern).
node -e "
const { Client } = require('pg');
const c = new Client({
  host: '<endpoint>',
  user: 'coheusadmin',
  password: process.env.PG_PASS || '<paste-from-secret>',
  database: 'coheus_management',
  ssl: { rejectUnauthorized: false }
});
c.connect()
  .then(() => c.query('SELECT count(*) AS cnt FROM tenants'))
  .then(r => { console.log('tenants:', r.rows); return c.query('SELECT max(created_at) AS latest FROM tenants'); })
  .then(r => { console.log('latest:', r.rows); return c.end(); })
  .catch(e => { console.error(e); try { c.end(); } catch (_) {} process.exit(1); });
"
```

**Option B — If ECS exec is not available**, use the AWS Console RDS Query Editor or any PostgreSQL client from a host that can reach the cluster security group.

**Password source:** Prefer exporting `PG_PASS` in the exec shell after reading the value from the Aurora master secret (same workflow as application DB access). Do not commit secrets.

**Verification checklist (all must pass):**

- [ ] Cluster reached `available` without errors
- [ ] Authenticated with the source cluster's master credentials
- [ ] Row count or max timestamp is consistent with the restore target time
- [ ] No data exists that was written after the restore target time

Record: pass/fail, the query results, and the total elapsed time from Step 1.3 to successful query.

### Step 1.7 — Tear down the test cluster (mandatory)

This stops billing. Do not skip this step.

```powershell
Write-Host "Deleting test instance..." -ForegroundColor Yellow
aws rds delete-db-instance `
  --db-instance-identifier $testInstance `
  --skip-final-snapshot `
  --region $rg --profile $prof

Write-Host "Waiting for instance deletion..." -ForegroundColor Yellow
aws rds wait db-instance-deleted `
  --db-instance-identifier $testInstance `
  --region $rg --profile $prof

Write-Host "Deleting test cluster..." -ForegroundColor Yellow
aws rds delete-db-cluster `
  --db-cluster-identifier $testCluster `
  --skip-final-snapshot `
  --region $rg --profile $prof

Write-Host "Cleanup complete." -ForegroundColor Green
```

Verify cleanup:

```powershell
aws rds describe-db-clusters `
  --db-cluster-identifier $testCluster `
  --region $rg --profile $prof 2>&1
```

**Expected:** An error saying the cluster was not found (this confirms deletion).

### Step 1.8 — Log the result

Fill in the result log in [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md) section 6:

| Date | Test | Operator | Duration | Outcome | RTO observed | Notes |
| ---- | ---- | -------- | -------- | ------- | ------------ | ----- |
| YYYY-MM-DD | Test 1 — Aurora PITR | Your name | XX min | Pass/Fail | XX min | |

---

## Procedure 2: ECS Deployment Rollback

**What this proves:** A bad deployment is automatically detected and rolled back by the ECS circuit-breaker without manual intervention.  
**Expected duration:** 10–15 minutes  
**Cost:** None

### Step 2.1 — Verify the service and circuit-breaker configuration

```powershell
aws ecs describe-services `
  --cluster $ecsCluster --services $ecsService `
  --region $rg --profile $prof `
  --query "services[0].{Status:status,Desired:desiredCount,Running:runningCount,TaskDef:taskDefinition,CircuitBreaker:deploymentConfiguration.deploymentCircuitBreaker}"
```

**Check before proceeding:**

- `CircuitBreaker.enable` is `true`
- `CircuitBreaker.rollback` is `true`
- `Running` count matches `Desired`

Record the current `TaskDef` ARN -- this is your known-good revision.

### Step 2.2 — Register a bad task definition

Export and modify the current task definition to break the health check (preferred over a bad image tag -- see note below):

```powershell
$inFile  = Join-Path $PWD "td-export.json"
$outFile = Join-Path $PWD "dr-bad-taskdef.json"

aws ecs describe-task-definition `
  --task-definition $knownGoodTask `
  --region $rg --profile $prof `
  --output json | Out-File -FilePath $inFile -Encoding utf8

python -c @"
import json, sys
d = json.load(open(r'$inFile', encoding='utf-8-sig'))
t = d['taskDefinition']
for k in ('taskDefinitionArn','revision','status','requiresAttributes',
          'compatibilities','registeredAt','registeredBy'):
    t.pop(k, None)
# Override the health check command so containers start but always fail health
t['containerDefinitions'][0]['healthCheck']['command'] = [
    'CMD-SHELL', 'exit 1'
]
json.dump(t, open(r'$outFile', 'w'), indent=2)
print('Wrote', r'$outFile')
"@
```

Register the bad revision:

```powershell
$badTaskDef = aws ecs register-task-definition `
  --cli-input-json "file://$outFile" `
  --region $rg --profile $prof `
  --query "taskDefinition.taskDefinitionArn" --output text

Write-Host "Bad task def: $badTaskDef"
```

**Why break the health check instead of the image tag?** The circuit breaker threshold for `desiredCount: 2` is **3 consecutive failures** (the minimum). With a non-existent image, each failure takes ~2 minutes (7 internal pull retries) so the threshold is not hit for ~6 minutes, and the rollback only completes after ~15-20 minutes. Breaking the health check lets the container *start* (Stage 1 passes), then fail health checks (Stage 2), which reaches the failure threshold faster and triggers a cleaner rollback.

### Step 2.3 — Deploy the bad task definition

```powershell
aws ecs update-service `
  --cluster $ecsCluster --service $ecsService `
  --task-definition $badTaskDef `
  --region $rg --profile $prof
```

**Record the time.** This is T0.

### Step 2.4 — Observe the automatic rollback

Watch the deployment. **Allow at least 20 minutes** -- do not manually intervene before the circuit breaker trips:

```powershell
$deadline = (Get-Date).AddMinutes(25)
while ((Get-Date) -lt $deadline) {
  Clear-Host
  Write-Host "$(Get-Date) — Watching ECS deployment (wait for rollout=FAILED then auto-rollback)..." -ForegroundColor Cyan
  aws ecs describe-services `
    --cluster $ecsCluster --services $ecsService `
    --region $rg --profile $prof `
    --query "services[0].{TaskDef:taskDefinition,Deploys:deployments[*].{Status:status,Rollout:rolloutState,Running:runningCount,Failed:failedTasks}}"
  $svcTd = aws ecs describe-services `
    --cluster $ecsCluster --services $ecsService `
    --region $rg --profile $prof `
    --query "services[0].taskDefinition" --output text
  if ($svcTd -match ':' + ($knownGoodTask -split ':')[-1] + '$') {
    Write-Host "`nAUTO-ROLLBACK COMPLETE — service back on known-good revision" -ForegroundColor Green
    break
  }
  Start-Sleep -Seconds 15
}
```

**What you should see:**

1. A new `PRIMARY` deployment appears with `rolloutState: IN_PROGRESS`
1. New tasks start but fail health checks (or fail to pull if using image-tag method)
1. `failedTasks` count increases toward the threshold (3 for `desiredCount: 2`)
1. Circuit-breaker trips: `rolloutState` changes to `FAILED`
1. ECS automatically creates a rollback deployment to the previous task definition
1. The known-good task definition returns as `PRIMARY` with `rolloutState: COMPLETED`

**Verification checklist (all must pass):**

- [ ] Bad deployment reached `rolloutState: FAILED`
- [ ] ECS automatically rolled back to the known-good task definition
- [ ] Old tasks remained `RUNNING` and healthy throughout (no full outage)
- [ ] Service is now running the known-good task definition

Record: the time the rollback completed and the total elapsed time.

### Step 2.5 — Clean up

Confirm the service is back on the correct revision:

```powershell
aws ecs describe-services `
  --cluster $ecsCluster --services $ecsService `
  --region $rg --profile $prof `
  --query "services[0].taskDefinition" --output text
```

Deregister the bad task definition:

```powershell
aws ecs deregister-task-definition `
  --task-definition $badTaskDef `
  --region $rg --profile $prof
```

Delete the local file:

```powershell
Remove-Item dr-test-taskdef.json
```

### Step 2.6 — Log the result

| Date | Test | Operator | Duration | Outcome | RTO observed | Notes |
| ---- | ---- | -------- | -------- | ------- | ------------ | ----- |
| YYYY-MM-DD | Test 2 — ECS rollback | Your name | XX min | Pass/Fail | XX min | |

---

## Procedure 3: Frontend Bucket Wipe and Rebuild

**What this proves:** The frontend can be fully rebuilt from CI/CD alone, with no manual file restoration.  
**Expected duration:** 10–20 minutes (mostly CI pipeline time)  
**Cost:** None

### Step 3.1 — Identify the dev frontend bucket and CloudFront distribution

```powershell
Write-Host "Frontend bucket:" -ForegroundColor Cyan
Write-Host $frontendBucket

# Find the dev CloudFront distribution
aws cloudfront list-distributions `
  --profile $prof `
  --query "DistributionList.Items[*].{Id:Id,Aliases:Aliases.Items[0],Origin:Origins.Items[0].DomainName}" `
  --output table
```

Identify the distribution that uses the dev frontend bucket as its origin. Record the distribution ID.

### Step 3.2 — Back up the bucket locally (safety net)

```powershell
$backupDir = ".\dr-test-frontend-backup"
aws s3 sync "s3://$frontendBucket/" $backupDir --profile $prof
Write-Host "Backup complete: $backupDir" -ForegroundColor Green
```

### Step 3.3 — Empty the bucket

```powershell
Write-Host "Emptying $frontendBucket..." -ForegroundColor Yellow
aws s3 rm "s3://$frontendBucket/" --recursive --profile $prof
```

**Record the time.** This is T0 (start of outage).

### Step 3.4 — Verify the site is down

Open the dev site URL in a browser (or use curl). You should see a 403 or a blank page.

```powershell
# If you have the CloudFront domain:
curl -sI "https://<cloudfront-domain>/"
```

### Step 3.5 — Rebuild via CI

Run the existing dev frontend deployment pipeline in Bitbucket. Do not manually upload from the backup directory -- the point of this drill is proving CI alone is sufficient.

**Wait for the pipeline to complete successfully.**

### Step 3.6 — Invalidate CloudFront cache

```powershell
$distId = "<distribution-id-from-step-3.1>"

aws cloudfront create-invalidation `
  --distribution-id $distId `
  --paths "/*" `
  --profile $prof
```

### Step 3.7 — Verify recovery

Open the dev site in a browser:

- [ ] Page renders correctly
- [ ] Login works
- [ ] A known recent feature is visible and functional

**Record the time.** This is T_recovered.

**RTO = T_recovered - T0** (the time from bucket wipe to site working).

### Step 3.8 — Clean up

Delete the local backup once the site is confirmed healthy:

```powershell
Remove-Item -Recurse -Force $backupDir
```

### Step 3.9 — Log the result

| Date | Test | Operator | Duration | Outcome | RTO observed | Notes |
| ---- | ---- | -------- | -------- | ------- | ------------ | ----- |
| YYYY-MM-DD | Test 3 — Frontend rebuild | Your name | XX min | Pass/Fail | XX min | |

---

## Procedure 4: AWS Backup Verification

**What this proves:** The AWS Backup vault and plan are actively protecting tagged resources.  
**Expected duration:** 5 minutes (verification only, not a restore)  
**Cost:** None

### Step 4.1 — Verify the backup vault exists

```powershell
aws backup list-backup-vaults `
  --profile $prof --region $rg `
  --query "BackupVaultList[?contains(BackupVaultName, 'cohi')].{Name:BackupVaultName,Created:CreationDate,RecoveryPoints:NumberOfRecoveryPoints}"
```

### Step 4.2 — Check for completed backup jobs

```powershell
aws backup list-backup-jobs `
  --by-state COMPLETED `
  --by-backup-vault-name coheus-prod-cohi-backup `
  --profile $prof --region $rg `
  --query "BackupJobs[*].{Resource:ResourceArn,Created:CreationDate,Completed:CompletionDate,Size:BackupSizeInBytes}" `
  --output table
```

**Verification checklist:**

- [ ] Backup vault exists and is accessible
- [ ] At least one backup job has `COMPLETED` status
- [ ] Protected resources include Aurora cluster(s)

If no jobs have completed yet and the stack was just deployed, check back after 48 hours (the first daily window needs to pass).

### Step 4.3 — Log the result

| Date | Test | Operator | Duration | Outcome | RTO observed | Notes |
| ---- | ---- | -------- | -------- | ------- | ------------ | ----- |
| YYYY-MM-DD | Test 4 — Backup verification | Your name | X min | Pass/Fail | N/A | |

---

## Post-drill: Recording results for vendor management

After completing all procedures:

1. **Update [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md) section 6** — add a row for each test with date, operator, duration, outcome, observed RTO, and any notes.

2. **Update [`DR_POLICY.md`](./DR_POLICY.md) section 6** — fill in the measured RTO/RPO values from the drills.

3. **Review the ratification checklist** in [`DR_POLICY.md`](./DR_POLICY.md) section 8 — check off any items that are now satisfied.

4. **Archive for vendor management** — the [`DR_VENDOR_SUMMARY.md`](./DR_VENDOR_SUMMARY.md) document references these test results. Once results are logged, that document is ready for distribution to vendor management, compliance auditors, or client due diligence requests.

---

## Safety reminders

1. **Never run against prod** without a written change request and a second operator present.
2. **Always complete cleanup steps** — test resources cost money and can interfere with future tests.
3. **If any test fails**, stop, capture screenshots and command output, and file a follow-up ticket before re-running.
4. **Run only one test at a time** in the same environment.
5. **Announce completion** in the team channel when all drills are done.

---

## Quick reference: all tests at a glance

| # | Test | Duration | Destructive? | Cleanup required? |
| - | ---- | -------- | ------------ | ----------------- |
| 1 | Aurora PITR | 30–45 min | No (creates temporary cluster) | Yes — delete test cluster |
| 2 | ECS rollback | 10–15 min | No (circuit-breaker auto-recovers) | Yes — deregister bad task def |
| 3 | Frontend rebuild | 10–20 min | Yes (empties dev bucket) | Yes — delete local backup |
| 4 | Backup verification | 5 min | No | No |
