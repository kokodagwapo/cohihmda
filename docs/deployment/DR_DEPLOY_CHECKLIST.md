# DR rollout — deployment checklist

Use this checklist when applying changes from [`DR_ROLLOUT_PLAN.md`](./DR_ROLLOUT_PLAN.md). Replace `${PROF}` with your AWS CLI profile (e.g. `DevEnvPerms-339712788893`), `${PRIMARY_REGION}` with `us-east-2`, `${SECONDARY_REGION}` with `us-east-1`.

---

## Phase 0 — retention, KMS Retain, frontend versioning

**Templates:** [`coheus_aurora_cluster_stack.yaml`](../infrastructure/cloudformation/coheus_aurora_cluster_stack.yaml), [`coheus_ecs_fargate_stack.yaml`](../infrastructure/cloudformation/coheus_ecs_fargate_stack.yaml), [`coheus_frontend_cloud_front_s3_stack.yaml`](../infrastructure/cloudformation/coheus_frontend_cloud_front_s3_stack.yaml)

### Dev (us-east-2)

- [ ] `aws cloudformation validate-template --template-body file://infrastructure/cloudformation/coheus_aurora_cluster_stack.yaml --region us-east-2 --profile ${PROF}`
- [ ] `aws cloudformation validate-template --template-body file://infrastructure/cloudformation/coheus_ecs_fargate_stack.yaml --region us-east-2 --profile ${PROF}`
- [ ] `aws cloudformation validate-template --template-body file://infrastructure/cloudformation/coheus_frontend_cloud_front_s3_stack.yaml --region us-east-2 --profile ${PROF}`
- [ ] Update each **dev** stack with the same **parameters file** you used last time (only template changed). Example:

```bash
aws cloudformation update-stack \
  --stack-name coheus-dev-aurora-management \
  --template-body file://infrastructure/cloudformation/coheus_aurora_cluster_stack.yaml \
  --parameters file://path/to/dev-aurora-management-params.json \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-2 --profile ${PROF}
```

- [ ] Wait `stack-update-complete` for Aurora, ECS, and frontend stacks.

### Prod (us-east-2) — Sunday `04:00–05:00` UTC maintenance window

- [ ] Same `validate-template` commands as dev.
- [ ] Update **prod** Aurora management (and each prod tenant stack), **prod** ECS backend, **prod** frontend stack using saved prod parameter files.
- [ ] Confirm in RDS console: **Backup retention** shows **35 days** on prod clusters.
- [ ] Confirm S3 frontend bucket: **Versioning** enabled.

### Rollback

- Re-deploy previous template artifact from git tag; restore parameters unchanged.

---

## Phase 0 — baseline PITR drill (dev)

Follow [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md) §3. Record results in §6.

- [ ] Drill completed
- [ ] Temporary cluster deleted

---

## Phase 1 — second Aurora reader

- [ ] Update **dev** Aurora stack(s); verify **two** DB instances on the cluster in RDS console.
- [ ] Update **prod** Aurora stack(s) in maintenance window.
- [ ] Optional: run [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md) §3 again to confirm PITR still works.

---

## Phase 1 — `coheus_backup_stack`

**Template:** [`coheus_backup_stack.yaml`](../infrastructure/cloudformation/coheus_backup_stack.yaml)

```bash
aws cloudformation create-stack \
  --stack-name coheus-prod-backup \
  --template-body file://infrastructure/cloudformation/coheus_backup_stack.yaml \
  --parameters ParameterKey=ProjectName,ParameterValue=coheus \
               ParameterKey=Environment,ParameterValue=prod \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-2 --profile ${PROF}
```

Use `update-stack` after the first create. Dev variant: `coheus-dev-backup`, `Environment=dev`.

**Cross-region copy (cold DR):** Deploy the DR landing stack in `us-east-1` first (Phase 2 below) so vault `coheus-<env>-cohi-dr-copy` exists. The backup template defaults `EnableCrossRegionBackupCopy=true` and `DrCopyRegion=us-east-1`; set `EnableCrossRegionBackupCopy=false` only if the DR vault is not deployed yet.

- [ ] First backup job **COMPLETED** within 48h (AWS Backup console).
- [ ] After DR vault exists: confirm **Copy job** status for at least one daily backup (AWS Backup → **Copy jobs**).

---

## Phase 2 — prerequisites

- [ ] Org SCP updated to allow Cohi workloads in `${SECONDARY_REGION}` (see [`DR_BACKLOG.md`](./DR_BACKLOG.md) story COHI-DR-005).

---

## Phase 2 — DR landing zone + cross-region backup copies (preferred)

**Templates:** [`coheus_aurora_secondary_stack.yaml`](../infrastructure/cloudformation/coheus_aurora_secondary_stack.yaml), [`coheus_backup_stack.yaml`](../infrastructure/cloudformation/coheus_backup_stack.yaml)

The DR region stack is a **landing zone only** (VPC, DB subnet group, security group, KMS, **AWS Backup vault** for copy destination, optional S3 replica bucket). There is **no** always-on Aurora cluster in DR — restore is from snapshot/backup recovery points using [`scripts/dr/restore-from-snapshot.sh`](../../scripts/dr/restore-from-snapshot.sh).

### Migrating off Aurora Global Database (one-time)

If you previously ran a hot secondary attached to a global cluster, run [`scripts/dr/teardown-global-dr.sh`](../../scripts/dr/teardown-global-dr.sh) **after** `aws sso login`, then set **`EnableGlobalDatabaseParam=false`** on the primary Aurora management stack and deploy template updates. Order matters — see script header comments.

### Deploy DR landing stack (`us-east-1`)

```bash
aws cloudformation create-stack \
  --stack-name coheus-prod-aurora-secondary \
  --template-body file://infrastructure/cloudformation/coheus_aurora_secondary_stack.yaml \
  --parameters \
      ParameterKey=ProjectName,ParameterValue=coheus \
      ParameterKey=Environment,ParameterValue=prod \
      ParameterKey=PrimaryReplicationRoleArn,ParameterValue= \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --region us-east-1 --profile ${PROF}
```

**After** the IAM role from Appendix A exists, **update** the stack to set `PrimaryReplicationRoleArn` (replica bucket policy). Use the same role ARN for `PodcastReplicationServiceRoleArn` on the primary ECS stack when enabling CRR.

- [ ] Stack **CREATE_COMPLETE**; note outputs `DrBackupVaultArn`, `PodcastReplicaBucketArn`, `DRDbSubnetGroupName`, `DRClusterSecurityGroupId`, `DRAuroraKmsKeyArn`, **`DRPublicSubnet1Id` / `DRPublicSubnet2Id`**, **`DRPrivateSubnet1Id` / `DRPrivateSubnet2Id`**, `DRVpcId`.

### Update existing DR landing stack (public subnets + NAT toggle)

After pulling template updates, **update** the DR landing stack in `${SECONDARY_REGION}`. New resources (IGW, public subnets, routes) are **$0/month**. NAT is **off** by default (`EnableCompute=false`).

- [ ] `EnableCompute=false` (default): no NAT charges; Aurora restore-from-snapshot still works.
- [ ] For ECS / ALB drills only: set `EnableCompute=true` (via CloudFormation console or `aws cloudformation deploy --parameter-overrides EnableCompute=true`), then run [`scripts/dr/deploy-dr-backend.sh`](../../scripts/dr/deploy-dr-backend.sh). Tear down: [`scripts/dr/teardown-dr-compute.sh`](../../scripts/dr/teardown-dr-compute.sh).

### Enable cross-region copy on primary backup stack (`us-east-2`)

Update `coheus-<env>-backup` so daily rule `CopyActions` targets vault name `coheus-<env>-cohi-dr-copy` in `us-east-1` (template defaults). Deploy **after** the DR vault exists.

- [ ] At least one successful **copy job** to the DR vault within 48h of deploy.

---

## Phase 2 — optional legacy: Aurora Global Database

The CloudFormation template still supports **`EnableGlobalDatabaseParam=true`** for management clusters, but **cold snapshot DR is the documented default**. Do not enable Global Database unless there is an explicit architectural decision to pay for a hot secondary.

---

## Phase 2 — S3 podcast CRR — NOT REQUIRED

Podcast audio is **regenerable** from source data stored in Aurora. S3 cross-region replication is not needed for DR. The `PodcastReplicationDestinationBucketArn` and `PodcastReplicationServiceRoleArn` parameters on the ECS stack can remain empty.

---

## Phase 2 — CloudFront origin failover

**Template:** [`coheus_waf_cloudfront_stack.yaml`](../infrastructure/cloudformation/coheus_waf_cloudfront_stack.yaml) (deploy in **us-east-1**)

- [ ] Set `DRSecondaryBackendOriginDomain` to the **secondary** region ALB DNS name (or TLS hostname) once that ALB exists.
- [ ] `update-stack` on the WAF/CloudFront stack; verify **Origin groups** in the CloudFront console.

---

## Phase 2 — tabletop

- [ ] Run [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md) §8 and archive notes.

---

### Appendix A — S3 podcast CRR IAM role — NOT REQUIRED

S3 cross-region replication for the podcast audio bucket is **not needed** — podcast audio is generated from tenant data in Aurora and can be regenerated on demand after a restore. The IAM role, trust policy, and bucket policies described in the previous version of this appendix have been removed.

If a future non-regenerable S3 bucket (e.g. audit logs) requires CRR, re-introduce the IAM role and replication configuration at that time.

---

## Phase B — cold DR application layer (ECS in DR region)

Complete once Phase 2 landing + backup copies are stable. See also [`scripts/dr/README.md`](../../scripts/dr/README.md).

### B0 — ACM (us-east-1)

- [ ] Request **DNS-validated** ACM certificate for the hostname served by the DR ALB (same apex or a `dr.*` name per DNS plan). Note the certificate ARN → `DR_CERTIFICATE_ARN`.

### B1 — ECR replication

ECR replication is **account-level**. Configure once in the console (**ECR → Private registry → Replication**) or AWS CLI so images pushed in `${PRIMARY_REGION}` replicate to `${SECONDARY_REGION}` for repository prefix `coheus-` (adjust to match your repo names). Confirm the `DR_IMAGE_TAG` you deploy exists in the DR registry.

### B2 — SES (us-east-1) — do early (sandbox exit can take ~24h)

- [ ] Verify sending domain / DKIM in SES **in us-east-1**.
- [ ] Create configuration set matching the name expected by the ECS stack (`my-first-configuration-set`) **in us-east-1**, or plan a template override for DR.
- [ ] Request **production access** for SES in us-east-1 (required for bulk password-reset mail during a real failover).

### B3 — Cognito DR pool (us-east-1)

- [ ] Create standby user pool + app client + hosted UI domain in **us-east-1** (SAML for Entra ID + password auth as needed). Note IDs → `DR_COGNITO_*` deployment variables.
- [ ] Configure the pool to send mail via SES in us-east-1 (`DEVELOPER` / custom FROM).

### B4 — Secrets Manager replicas

- [ ] Replicate JWT signing secret and other shared API keys to `us-east-1` (see [`scripts/dr/setup-secret-replicas.sh`](../../scripts/dr/setup-secret-replicas.sh)).

### B5 — Bitbucket deployment variables (DR)

Per environment (e.g. **dev**), add variables used by custom pipelines (see header in [`bitbucket-pipelines.yml`](../../bitbucket-pipelines.yml)):

`DR_AWS_REGION`, `DR_ECR_REPOSITORY_URI`, `DR_CF_STACK_BACKEND`, `DR_S3_FRONTEND_BUCKET`, `DR_CERTIFICATE_ARN`, `DR_COGNITO_USER_POOL_ID`, `DR_COGNITO_CLIENT_ID`, `DR_COGNITO_CLIENT_SECRET`, `DR_COGNITO_DOMAIN`, optional `DR_COGNITO_REGION`, `DR_ECS_CLUSTER`, `DR_ECS_SERVICE`, and at failover time `DR_AURORA_ENDPOINT`, `DR_AURORA_SECRET_ARN`, `DR_JWT_SECRET`, `DR_FRONTEND_URL`, `DR_IMAGE_TAG`, `VITE_API_URL` (for DR frontend build).

### B6 — Scripts (smoke in dev)

- [ ] [`scripts/dr/deploy-dr-backend.sh`](../../scripts/dr/deploy-dr-backend.sh) — dry checklist: env vars + successful `/health` on DR ALB.
- [ ] [`scripts/dr/deploy-dr-frontend.sh`](../../scripts/dr/deploy-dr-frontend.sh) — sync to DR S3 + invalidation.
- [ ] [`scripts/dr/teardown-dr-compute.sh`](../../scripts/dr/teardown-dr-compute.sh) — removes DR ECS stack and sets `EnableCompute=false`.

---

## Reference

- [`DR_ROLLOUT_PLAN.md`](./DR_ROLLOUT_PLAN.md) — costs and sequencing
- [`DR_BACKLOG.md`](./DR_BACKLOG.md) — Jira draft stories
