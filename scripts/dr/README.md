# DR scripts (cold snapshot + optional ECS in DR region)

| Script | Purpose |
| ------ | ------- |
| [`dr-failover.sh`](./dr-failover.sh) | **One-command orchestrator:** auto-finds latest DR snapshot, restores Aurora, enables NAT, reads all stack outputs, pulls params from primary, deploys ECS backend, runs health check, publishes Confluence test report. Minimal flags: `--environment dev --profile <p>`. Use `--skip-report` to skip Confluence. See `--help`. |
| [`restore-from-snapshot.sh`](./restore-from-snapshot.sh) | Restore Aurora in DR from snapshot / recovery point (uses DR landing stack outputs). Standalone; `dr-failover.sh` calls this logic internally. |
| [`teardown-global-dr.sh`](./teardown-global-dr.sh) | One-time teardown helper for legacy Aurora Global Database. |
| [`start-on-demand-backup-and-copy.sh`](./start-on-demand-backup-and-copy.sh) | Kick AWS Backup + cross-region copy for testing. |
| [`deploy-dr-backend.sh`](./deploy-dr-backend.sh) | Set `EnableCompute=true` on DR landing stack, then `cloudformation deploy` ECS backend in DR (merges parameters from primary stack). |
| [`deploy-dr-frontend.sh`](./deploy-dr-frontend.sh) | Build (or use existing `dist/`), `s3 sync` to DR bucket, CloudFront invalidation. |
| [`teardown-dr-compute.sh`](./teardown-dr-compute.sh) | Delete DR ECS stack, set `EnableCompute=false`, optional Aurora delete. |
| [`setup-secret-replicas.sh`](./setup-secret-replicas.sh) | Replicate selected Secrets Manager secrets into DR region. |

**Docs:** [`../docs/deployment/DR_DEPLOY_CHECKLIST.md`](../docs/deployment/DR_DEPLOY_CHECKLIST.md) Phase B, [`../docs/deployment/DR_TEST_PLAN.md`](../docs/deployment/DR_TEST_PLAN.md) §9.6.

**Bitbucket:** Custom pipelines `dr-failover-dev`, `dr-failover-prod`, `dr-deploy-backend-dev`, `dr-deploy-frontend-dev`, `dr-run-migrations-dev`, `dr-teardown-compute-dev`, and production variants — see repository [`bitbucket-pipelines.yml`](../../bitbucket-pipelines.yml).

**Confluence reporting:** `dr-failover.sh` publishes a structured test report as a child page under the DR parent page (default ID `1379270657`). Requires `ATLASSIAN_EMAIL`, `ATLASSIAN_SITE_URL` env vars; the API token is fetched from Secrets Manager via `QaAtlassianApiTokenSecretArn`.
