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

- [ ] First backup job **COMPLETED** within 48h (AWS Backup console).

---

## Phase 2 — prerequisites

- [ ] Org SCP updated to allow Cohi workloads in `${SECONDARY_REGION}` (see [`DR_BACKLOG.md`](./DR_BACKLOG.md) story COHI-DR-005).

---

## Phase 2 — Aurora Global Database (prod management only)

- [ ] Deploy updated **prod management** Aurora stack in `${PRIMARY_REGION}` so `AWS::RDS::GlobalCluster` is created (see template condition: prod + management only).
- [ ] `aws rds describe-global-clusters --region ${PRIMARY_REGION} --profile ${PROF}` shows `coheus-prod-global` (or your `GlobalClusterIdentifier`).

---

## Phase 2 — secondary region stack (`us-east-1`)

**Template:** [`coheus_aurora_secondary_stack.yaml`](../infrastructure/cloudformation/coheus_aurora_secondary_stack.yaml)

### Steps

1. Note `GlobalClusterIdentifier` from the primary stack output or RDS console.
2. Deploy in **us-east-1**:

```bash
aws cloudformation create-stack \
  --stack-name coheus-prod-dr-secondary \
  --template-body file://infrastructure/cloudformation/coheus_aurora_secondary_stack.yaml \
  --parameters \
      ParameterKey=ProjectName,ParameterValue=coheus \
      ParameterKey=Environment,ParameterValue=prod \
      ParameterKey=GlobalClusterIdentifier,ParameterValue=coheus-prod-global \
      ParameterKey=PrimaryReplicationRoleArn,ParameterValue= \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1 --profile ${PROF}
```

**Step 3.** After the IAM role from Appendix A exists, **update** the secondary stack to set `PrimaryReplicationRoleArn` to that role ARN (adds the replica bucket policy). Use the same role ARN for `PodcastReplicationServiceRoleArn` on the primary ECS stack when enabling CRR.

- [ ] Secondary Aurora cluster **available**
- [ ] `PodcastReplicaBucketArn` output saved for Phase 2 CRR parameter on primary.

---

## Phase 2 — S3 podcast CRR (primary ECS stack)

1. Set parameter **`PodcastReplicationDestinationBucketArn`** to the replica bucket ARN from the secondary stack output.
2. Create the IAM role per **Appendix A** (same file). Set **`PodcastReplicationServiceRoleArn`** on the primary `coheus_ecs_fargate_stack` to that role ARN.
3. Update **`coheus_aurora_secondary_stack`** with **`PrimaryReplicationRoleArn`** set to the same role ARN (enables replica bucket policy).
4. `update-stack` on **prod** `coheus-*-backend` stack in `us-east-2`.

- [ ] S3 **Replication** metrics show objects delivered to the replica bucket (may take up to 15 minutes with S3 RTC).

---

## Phase 2 — CloudFront origin failover

**Template:** [`coheus_waf_cloudfront_stack.yaml`](../infrastructure/cloudformation/coheus_waf_cloudfront_stack.yaml) (deploy in **us-east-1**)

- [ ] Set `DRSecondaryBackendOriginDomain` to the **secondary** region ALB DNS name (or TLS hostname) once that ALB exists.
- [ ] `update-stack` on the WAF/CloudFront stack; verify **Origin groups** in the CloudFront console.

---

## Phase 2 — tabletop

- [ ] Run [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md) §8 and archive notes.

---

### Appendix A — IAM role for S3 podcast CRR (primary region)

Create this role **once** in the **primary** region (e.g. `us-east-2`) so its ARN can be passed as `PodcastReplicationServiceRoleArn` on `coheus_ecs_fargate_stack` **and** as `PrimaryReplicationRoleArn` on `coheus_aurora_secondary_stack` (replica bucket policy). Replace `${SOURCE_BUCKET}` and `${DEST_BUCKET_ARN}` before use.

**Trust policy:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "s3.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

**Permissions policy:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetReplicationConfiguration", "s3:ListBucket"],
      "Resource": "arn:aws:s3:::${SOURCE_BUCKET}"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObjectVersionForReplication", "s3:GetObjectVersionAcl", "s3:GetObjectVersionTagging"],
      "Resource": "arn:aws:s3:::${SOURCE_BUCKET}/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:ReplicateObject",
        "s3:ReplicateDelete",
        "s3:ReplicateTags",
        "s3:ObjectOwnerOverrideToBucketOwner"
      ],
      "Resource": "${DEST_BUCKET_ARN}/*"
    }
  ]
}
```

---

## Reference

- [`DR_ROLLOUT_PLAN.md`](./DR_ROLLOUT_PLAN.md) — costs and sequencing
- [`DR_BACKLOG.md`](./DR_BACKLOG.md) — Jira draft stories
