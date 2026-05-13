#!/usr/bin/env bash
# =============================================================================
# DR Failover Orchestrator — single command to stand up the full DR stack
# =============================================================================
# Chains: snapshot restore → NAT enable → ECS backend deploy.
# Auto-resolves Aurora endpoint, image tag, JWT, Cognito, and cert from
# the primary stack + DR landing stack outputs.  Operator only needs to
# supply --environment and (optionally) --snapshot-id.
#
# Usage:
#   ./scripts/dr/dr-failover.sh --environment dev --profile DevEnvPerms-339712788893
#
#   # Override snapshot (default: latest Aurora recovery point in DR vault):
#   ./scripts/dr/dr-failover.sh --environment dev --snapshot-arn arn:aws:rds:...
#
#   # Skip DB restore (already restored):
#   ./scripts/dr/dr-failover.sh --environment dev --cluster-id coheus-dev-dr-restore --skip-restore
#
#   # Skip Cognito requirement (partial test without auth):
#   ./scripts/dr/dr-failover.sh --environment dev --skip-cognito
#
#   # Skip Confluence report:
#   ./scripts/dr/dr-failover.sh --environment dev --skip-report
#
# What it does:
#   1. Finds the latest Aurora snapshot in the DR backup vault (or uses --snapshot-arn/--snapshot-id)
#   2. Restores Aurora cluster + Serverless v2 instance in DR region
#   3. Reads DR landing stack outputs (VPC, subnets, KMS)
#   4. Enables NAT on DR landing stack (EnableCompute=true)
#   5. Reads primary backend stack params (image tag, Cognito, JWT, cert, etc.)
#   6. Deploys ECS Fargate stack in DR region with all params auto-filled
#   7. Runs ALB health check (5 retries over ~2 min)
#   8. Publishes DR test report to Confluence (page ID from DR_CONFLUENCE_PARENT_PAGE_ID)
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Install AWS CLI if missing (Bitbucket node:20 image doesn't include it)
# ---------------------------------------------------------------------------
if ! command -v aws &>/dev/null; then
  echo ">>> Installing AWS CLI..."
  apt-get update -qq
  apt-get install -y -qq unzip curl > /dev/null
  curl -sS "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
  unzip -qq /tmp/awscliv2.zip -d /tmp
  /tmp/aws/install --update
  rm -rf /tmp/awscliv2.zip /tmp/aws
  echo "    $(aws --version)"
fi

# ---------------------------------------------------------------------------
# Timing + report helpers
# ---------------------------------------------------------------------------
T_START=$(date +%s)
declare -A STEP_START STEP_END STEP_STATUS
STEP_ORDER=()

step_begin() { STEP_ORDER+=("$1"); STEP_START[$1]=$(date +%s); STEP_STATUS[$1]="running"; }
step_pass()  { STEP_END[$1]=$(date +%s); STEP_STATUS[$1]="PASS"; }
step_fail()  { STEP_END[$1]=$(date +%s); STEP_STATUS[$1]="FAIL"; }
step_skip()  { STEP_START[$1]=$(date +%s); STEP_END[$1]=$(date +%s); STEP_STATUS[$1]="SKIP"; STEP_ORDER+=("$1"); }
step_dur()   { echo $(( ${STEP_END[$1]:-$(date +%s)} - ${STEP_START[$1]} )); }

ENVIRONMENT=""
DR_REGION="${DR_REGION:-us-east-1}"
PRIMARY_REGION="${PRIMARY_REGION:-us-east-2}"
SNAPSHOT_ID=""
SNAPSHOT_ARN=""
CLUSTER_ID=""
SKIP_RESTORE=false
SKIP_COGNITO=false
SKIP_NAT=false
SKIP_REPORT=false
PROFILE_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --environment|-e) ENVIRONMENT="$2"; shift 2 ;;
    --dr-region)      DR_REGION="$2"; shift 2 ;;
    --primary-region) PRIMARY_REGION="$2"; shift 2 ;;
    --snapshot-id)    SNAPSHOT_ID="$2"; shift 2 ;;
    --snapshot-arn)   SNAPSHOT_ARN="$2"; shift 2 ;;
    --cluster-id)     CLUSTER_ID="$2"; shift 2 ;;
    --skip-restore)   SKIP_RESTORE=true; shift ;;
    --skip-cognito)   SKIP_COGNITO=true; shift ;;
    --skip-nat)       SKIP_NAT=true; shift ;;
    --skip-report)    SKIP_REPORT=true; shift ;;
    --profile)        PROFILE_ARGS=(--profile "$2"); shift 2 ;;
    -h|--help)        sed -n '2,34p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

[[ -n "$ENVIRONMENT" ]] || { echo "ERROR: --environment required (dev|staging|prod)"; exit 1; }

AWS=(aws "${PROFILE_ARGS[@]:-}")
DR_LANDING_STACK="coheus-${ENVIRONMENT}-aurora-secondary"
DR_BACKEND_STACK="coheus-${ENVIRONMENT}-dr-backend"
PRIMARY_STACK="coheus-${ENVIRONMENT}-backend"
DR_BACKUP_VAULT="coheus-${ENVIRONMENT}-cohi-dr-copy"
CLUSTER_ID="${CLUSTER_ID:-coheus-${ENVIRONMENT}-dr-restore}"
INSTANCE_ID="${CLUSTER_ID}-1"
TEMPLATE="infrastructure/cloudformation/coheus_ecs_fargate_stack.yaml"
LANDING_TEMPLATE="infrastructure/cloudformation/coheus_aurora_secondary_stack.yaml"

get_primary_param() {
  "${AWS[@]}" cloudformation describe-stacks \
    --stack-name "$PRIMARY_STACK" --region "$PRIMARY_REGION" \
    --query "Stacks[0].Parameters[?ParameterKey=='${1}'].ParameterValue | [0]" \
    --output text 2>/dev/null || echo ""
}

get_dr_output() {
  "${AWS[@]}" cloudformation describe-stacks \
    --stack-name "$DR_LANDING_STACK" --region "$DR_REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='${1}'].OutputValue | [0]" \
    --output text
}

echo "========================================="
echo "DR Failover Orchestrator"
echo "========================================="
echo "Environment:    ${ENVIRONMENT}"
echo "Primary region: ${PRIMARY_REGION}"
echo "DR region:      ${DR_REGION}"
echo "Primary stack:  ${PRIMARY_STACK}"
echo "DR landing:     ${DR_LANDING_STACK}"
echo "DR backend:     ${DR_BACKEND_STACK}"
echo ""

# =========================================================================
# Step 1: Restore Aurora (or skip if --skip-restore / --cluster-id exists)
# =========================================================================
if [[ "$SKIP_RESTORE" == "true" ]]; then
  step_skip "restore-aurora"
  echo ">>> Skipping DB restore (--skip-restore)"
  if ! "${AWS[@]}" rds describe-db-clusters --db-cluster-identifier "$CLUSTER_ID" --region "$DR_REGION" &>/dev/null; then
    echo "ERROR: --skip-restore but cluster $CLUSTER_ID not found in $DR_REGION"
    exit 1
  fi
else
  step_begin "restore-aurora"
  # Find snapshot if not provided
  if [[ -z "$SNAPSHOT_ID" && -z "$SNAPSHOT_ARN" ]]; then
    echo ">>> Finding latest Aurora recovery point in DR vault: ${DR_BACKUP_VAULT}"
    SNAPSHOT_ARN=$("${AWS[@]}" backup list-recovery-points-by-backup-vault \
      --backup-vault-name "$DR_BACKUP_VAULT" \
      --region "$DR_REGION" \
      --query "sort_by(RecoveryPoints[?ResourceType=='Aurora' && Status=='COMPLETED'], &CreationDate) | [-1].RecoveryPointArn" \
      --output text)
    if [[ -z "$SNAPSHOT_ARN" || "$SNAPSHOT_ARN" == "None" ]]; then
      echo "ERROR: No completed Aurora recovery points in vault $DR_BACKUP_VAULT"
      echo "       Run scripts/dr/start-on-demand-backup-and-copy.sh first, or supply --snapshot-arn."
      exit 1
    fi
    echo "    Using: $SNAPSHOT_ARN"
  fi

  # Check if cluster already exists (leftover from previous drill)
  if "${AWS[@]}" rds describe-db-clusters --db-cluster-identifier "$CLUSTER_ID" --region "$DR_REGION" &>/dev/null; then
    echo "WARNING: Cluster $CLUSTER_ID already exists. Use --skip-restore to reuse it, or delete it first."
    exit 1
  fi

  echo ">>> Restoring cluster ${CLUSTER_ID} in ${DR_REGION}..."
  SUBNET_GROUP="$(get_dr_output DRDbSubnetGroupName)"
  SG="$(get_dr_output DRClusterSecurityGroupId)"
  KMS="$(get_dr_output DRAuroraKmsKeyArn)"

  RESTORE_SRC=()
  if [[ -n "$SNAPSHOT_ARN" ]]; then
    RESTORE_SRC=(--snapshot-arn "$SNAPSHOT_ARN")
  else
    RESTORE_SRC=(--snapshot-identifier "$SNAPSHOT_ID")
  fi

  "${AWS[@]}" rds restore-db-cluster-from-snapshot \
    --region "$DR_REGION" \
    "${RESTORE_SRC[@]}" \
    --db-cluster-identifier "$CLUSTER_ID" \
    --engine aurora-postgresql \
    --engine-mode provisioned \
    --serverless-v2-scaling-configuration MinCapacity=0.5,MaxCapacity=4 \
    --db-subnet-group-name "$SUBNET_GROUP" \
    --vpc-security-group-ids "$SG" \
    --kms-key-id "$KMS" \
    --copy-tags-to-snapshot \
    --no-deletion-protection

  echo ">>> Waiting for cluster..."
  "${AWS[@]}" rds wait db-cluster-available \
    --db-cluster-identifier "$CLUSTER_ID" --region "$DR_REGION"

  echo ">>> Creating instance ${INSTANCE_ID}..."
  "${AWS[@]}" rds create-db-instance \
    --region "$DR_REGION" \
    --db-cluster-identifier "$CLUSTER_ID" \
    --db-instance-identifier "$INSTANCE_ID" \
    --db-instance-class db.serverless \
    --engine aurora-postgresql

  echo ">>> Waiting for instance..."
  "${AWS[@]}" rds wait db-instance-available \
    --db-instance-identifier "$INSTANCE_ID" --region "$DR_REGION"
  step_pass "restore-aurora"
fi

# Read restored cluster endpoint + master secret
DR_AURORA_ENDPOINT=$("${AWS[@]}" rds describe-db-clusters \
  --db-cluster-identifier "$CLUSTER_ID" --region "$DR_REGION" \
  --query 'DBClusters[0].Endpoint' --output text)

DR_AURORA_SECRET_ARN=$("${AWS[@]}" rds describe-db-clusters \
  --db-cluster-identifier "$CLUSTER_ID" --region "$DR_REGION" \
  --query 'DBClusters[0].MasterUserSecret.SecretArn' --output text 2>/dev/null || echo "")

if [[ -z "$DR_AURORA_SECRET_ARN" || "$DR_AURORA_SECRET_ARN" == "None" ]]; then
  # Snapshot restores from AWS Backup don't always carry MasterUserSecret; fall back to primary
  DR_AURORA_SECRET_ARN="$(get_primary_param AuroraSecretArn)"
  echo "    (No MasterUserSecret on restored cluster; using primary AuroraSecretArn: ${DR_AURORA_SECRET_ARN})"
fi

echo ">>> Aurora ready: ${DR_AURORA_ENDPOINT}"

# =========================================================================
# Step 2: Read DR landing stack outputs
# =========================================================================
step_begin "read-dr-outputs"
echo ""
echo ">>> Reading DR landing stack outputs..."
DR_VPC_ID="$(get_dr_output DRVpcId)"
DR_PUB1="$(get_dr_output DRPublicSubnet1Id)"
DR_PUB2="$(get_dr_output DRPublicSubnet2Id)"
DR_PRIV1="$(get_dr_output DRPrivateSubnet1Id)"
DR_PRIV2="$(get_dr_output DRPrivateSubnet2Id)"
DR_AURORA_KMS="$(get_dr_output DRAuroraKmsKeyArn)"

for v in DR_VPC_ID DR_PUB1 DR_PUB2 DR_PRIV1 DR_PRIV2 DR_AURORA_KMS; do
  val="${!v}"
  if [[ -z "$val" || "$val" == "None" ]]; then
    echo "ERROR: DR landing output $v is empty. Update the DR landing stack template first."
    exit 1
  fi
done
step_pass "read-dr-outputs"

# =========================================================================
# Step 3: Enable NAT
# =========================================================================
if [[ "$SKIP_NAT" != "true" ]]; then
  step_begin "enable-nat"
  echo ">>> Enabling NAT (EnableCompute=true) on ${DR_LANDING_STACK}..."
  "${AWS[@]}" cloudformation deploy \
    --stack-name "$DR_LANDING_STACK" \
    --template-file "$LANDING_TEMPLATE" \
    --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
    --region "$DR_REGION" \
    --no-fail-on-empty-changeset \
    --parameter-overrides EnableCompute=true
  step_pass "enable-nat"
else
  step_skip "enable-nat"
  echo ">>> Skipping NAT enable (--skip-nat)"
fi

# =========================================================================
# Step 4: Auto-resolve params from primary stack
# =========================================================================
step_begin "resolve-params"
echo ""
echo ">>> Reading primary stack params (${PRIMARY_STACK})..."

DR_IMAGE_TAG="${DR_IMAGE_TAG:-$(get_primary_param ContainerImageTag)}"
DR_JWT_SECRET="${DR_JWT_SECRET:-$(get_primary_param JwtSecret)}"
DR_CERTIFICATE_ARN="${DR_CERTIFICATE_ARN:-}"

# Auto-find wildcard cert in DR region if not set
if [[ -z "$DR_CERTIFICATE_ARN" ]]; then
  DR_CERTIFICATE_ARN=$("${AWS[@]}" acm list-certificates --region "$DR_REGION" \
    --query "CertificateSummaryList[?contains(DomainName, '*.coheus1.com') && Status=='ISSUED'].CertificateArn | [0]" \
    --output text 2>/dev/null || echo "")
  if [[ -z "$DR_CERTIFICATE_ARN" || "$DR_CERTIFICATE_ARN" == "None" ]]; then
    echo "ERROR: No *.coheus1.com cert found in $DR_REGION. Create one or set DR_CERTIFICATE_ARN."
    exit 1
  fi
  echo "    Auto-detected ACM cert: ${DR_CERTIFICATE_ARN}"
fi

# Cognito — use primary values (same pool, cross-region) or skip
if [[ "$SKIP_COGNITO" == "true" ]]; then
  echo ">>> --skip-cognito: using primary Cognito values (auth will NOT work cross-region, but /health will)"
fi
DR_COGNITO_USER_POOL_ID="${DR_COGNITO_USER_POOL_ID:-$(get_primary_param CognitoUserPoolId)}"
DR_COGNITO_CLIENT_ID="${DR_COGNITO_CLIENT_ID:-$(get_primary_param CognitoClientId)}"
DR_COGNITO_CLIENT_SECRET="${DR_COGNITO_CLIENT_SECRET:-$(get_primary_param CognitoClientSecret)}"
DR_COGNITO_DOMAIN="${DR_COGNITO_DOMAIN:-$(get_primary_param CognitoDomain)}"
DR_COGNITO_REGION="${DR_COGNITO_REGION:-${PRIMARY_REGION}}"
DR_FRONTEND_URL="${DR_FRONTEND_URL:-$(get_primary_param FrontendUrl)}"
COGNITO_PASSWORD_AUTH="${COGNITO_PASSWORD_AUTH:-$(get_primary_param CognitoPasswordAuth)}"

# OpenAI secret — try DR replica, fall back to primary
DR_OPENAI_SECRET_ARN="${DR_OPENAI_SECRET_ARN:-}"
if [[ -z "$DR_OPENAI_SECRET_ARN" ]]; then
  DR_OPENAI_SECRET_ARN=$("${AWS[@]}" secretsmanager describe-secret \
    --secret-id "coheus/coheus-openai-api-key-${ENVIRONMENT}" \
    --region "$DR_REGION" --query "ARN" --output text 2>/dev/null || echo "")
  if [[ -z "$DR_OPENAI_SECRET_ARN" || "$DR_OPENAI_SECRET_ARN" == "None" ]]; then
    DR_OPENAI_SECRET_ARN="$(get_primary_param OpenAIApiKeySecretArn)"
  fi
fi

echo "    Image tag:     ${DR_IMAGE_TAG}"
echo "    ACM cert:      ${DR_CERTIFICATE_ARN}"
echo "    Cognito pool:  ${DR_COGNITO_USER_POOL_ID}"
echo "    Cognito region:${DR_COGNITO_REGION}"
echo "    Frontend URL:  ${DR_FRONTEND_URL}"
step_pass "resolve-params"

# =========================================================================
# Step 5: Deploy ECS backend
# =========================================================================
echo ""
echo ">>> Building parameter overrides..."
TEMPLATE_KEYS=$("${AWS[@]}" cloudformation get-template-summary \
  --template-body "file://${TEMPLATE}" \
  --query 'Parameters[].ParameterKey' --output text)

is_optional_empty_ok() {
  case "$1" in
    OpenAIApiKeySecretArn|FredApiKey|AlertEmail|PodcastReplicationDestinationBucketArn|PodcastReplicationServiceRoleArn|CognitoRegion) return 0 ;;
    *) return 1 ;;
  esac
}

OVERRIDE_ARGS=()
while read -r KEY; do
  [[ -z "$KEY" ]] && continue
  VAL=""
  case "$KEY" in
    NetworkMode)           VAL="existing" ;;
    ExistingVPCId)         VAL="$DR_VPC_ID" ;;
    ExistingPublicSubnet1) VAL="$DR_PUB1" ;;
    ExistingPublicSubnet2) VAL="$DR_PUB2" ;;
    ExistingPrivateSubnet1) VAL="$DR_PRIV1" ;;
    ExistingPrivateSubnet2) VAL="$DR_PRIV2" ;;
    AuroraEndpoint)        VAL="$DR_AURORA_ENDPOINT" ;;
    AuroraSecretArn)       VAL="$DR_AURORA_SECRET_ARN" ;;
    AuroraKmsKeyArn)       VAL="$DR_AURORA_KMS" ;;
    ContainerImageTag)     VAL="$DR_IMAGE_TAG" ;;
    CertificateArn)        VAL="$DR_CERTIFICATE_ARN" ;;
    CognitoUserPoolId)     VAL="$DR_COGNITO_USER_POOL_ID" ;;
    CognitoClientId)       VAL="$DR_COGNITO_CLIENT_ID" ;;
    CognitoClientSecret)   VAL="$DR_COGNITO_CLIENT_SECRET" ;;
    CognitoDomain)         VAL="$DR_COGNITO_DOMAIN" ;;
    CognitoRegion)         VAL="$DR_COGNITO_REGION" ;;
    CognitoPasswordAuth)   VAL="$COGNITO_PASSWORD_AUTH" ;;
    FrontendUrl)           VAL="$DR_FRONTEND_URL" ;;
    JwtSecret)             VAL="$DR_JWT_SECRET" ;;
    OpenAIApiKeySecretArn) VAL="$DR_OPENAI_SECRET_ARN" ;;
    *)                     VAL="$(get_primary_param "$KEY")" ;;
  esac
  if [[ -z "$VAL" || "$VAL" == "None" ]]; then
    if is_optional_empty_ok "$KEY"; then continue; fi
    echo "ERROR: Missing value for parameter '$KEY'."
    exit 1
  fi
  OVERRIDE_ARGS+=("${KEY}=${VAL}")
done <<< "$(echo "$TEMPLATE_KEYS" | tr '\t' '\n')"

step_begin "deploy-ecs"
echo ">>> Deploying ${DR_BACKEND_STACK} in ${DR_REGION}..."
"${AWS[@]}" cloudformation deploy \
  --stack-name "$DR_BACKEND_STACK" \
  --template-file "$TEMPLATE" \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --region "$DR_REGION" \
  --no-fail-on-empty-changeset \
  --parameter-overrides "${OVERRIDE_ARGS[@]}"
step_pass "deploy-ecs"

ALB=$("${AWS[@]}" cloudformation describe-stacks \
  --stack-name "$DR_BACKEND_STACK" --region "$DR_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ALBDNSName'].OutputValue | [0]" \
  --output text 2>/dev/null || echo "")

# =========================================================================
# Step 6: Health check
# =========================================================================
step_begin "health-check"
HEALTH_RESULT="UNKNOWN"
if [[ -n "$ALB" && "$ALB" != "None" ]]; then
  echo ">>> Waiting 30s for ECS tasks to register with ALB..."
  sleep 30
  for attempt in 1 2 3 4 5; do
    HTTP_CODE=$(curl -sk -o /dev/null -w '%{http_code}' "https://${ALB}/health" 2>/dev/null || echo "000")
    echo "    Health check attempt $attempt: HTTP $HTTP_CODE"
    if [[ "$HTTP_CODE" == "200" ]]; then
      HEALTH_RESULT="PASS"
      break
    fi
    sleep 15
  done
  if [[ "$HEALTH_RESULT" != "PASS" ]]; then
    HEALTH_RESULT="FAIL (last HTTP $HTTP_CODE)"
    echo "WARNING: Health check did not return 200 after 5 attempts."
  fi
else
  HEALTH_RESULT="SKIP (no ALB DNS)"
fi
if [[ "$HEALTH_RESULT" == "PASS" ]]; then step_pass "health-check"; else step_fail "health-check"; fi

T_END=$(date +%s)
TOTAL_DURATION=$(( T_END - T_START ))

echo ""
echo "========================================="
echo "DR Failover Complete"
echo "========================================="
echo ""
echo "Aurora endpoint: ${DR_AURORA_ENDPOINT}"
echo "Aurora cluster:  ${CLUSTER_ID}"
echo "ALB DNS:         ${ALB:-<check CloudFormation outputs>}"
echo "Image tag:       ${DR_IMAGE_TAG}"
echo "Health check:    ${HEALTH_RESULT}"
echo "Total duration:  ${TOTAL_DURATION}s (~$(( TOTAL_DURATION / 60 ))m)"
echo ""
echo "Teardown when done:"
echo "  ./scripts/dr/teardown-dr-compute.sh --environment ${ENVIRONMENT} --delete-aurora-cluster ${CLUSTER_ID} ${PROFILE_ARGS[*]:+${PROFILE_ARGS[*]}}"
echo ""

# =========================================================================
# Step 7: Publish Confluence DR test report
# =========================================================================
publish_confluence_report() {
  local atlassian_token_secret_arn
  atlassian_token_secret_arn=$("${AWS[@]}" cloudformation describe-stacks \
    --stack-name "${PRIMARY_STACK}" --region "${PRIMARY_REGION}" \
    --query "Stacks[0].Outputs[?OutputKey=='QaAtlassianApiTokenSecretArn'].OutputValue | [0]" \
    --output text 2>/dev/null || echo "")

  if [[ -z "$atlassian_token_secret_arn" || "$atlassian_token_secret_arn" == "None" ]]; then
    echo "WARN: QaAtlassianApiTokenSecretArn not found — skipping Confluence report."
    return
  fi

  local api_token
  api_token=$("${AWS[@]}" secretsmanager get-secret-value \
    --secret-id "$atlassian_token_secret_arn" --region "${PRIMARY_REGION}" \
    --query SecretString --output text 2>/dev/null || echo "")

  if [[ -z "$api_token" || "$api_token" == "__SET_ATLASSIAN_API_TOKEN__" ]]; then
    echo "WARN: Atlassian API token not configured — skipping Confluence report."
    return
  fi

  local email="${ATLASSIAN_EMAIL:-}"
  local site="${ATLASSIAN_SITE_URL:-}"
  local parent_id="${DR_CONFLUENCE_PARENT_PAGE_ID:-1379270657}"

  if [[ -z "$email" || -z "$site" ]]; then
    echo "WARN: ATLASSIAN_EMAIL or ATLASSIAN_SITE_URL not set — skipping Confluence report."
    return
  fi

  # Ensure https:// prefix (ATLASSIAN_SITE_URL may be stored without protocol)
  [[ "$site" =~ ^https?:// ]] || site="https://${site}"
  site="${site%/}"

  local today
  today=$(date -u +%Y-%m-%d)
  local title="DR Failover Test — ${ENVIRONMENT} — ${today}"

  local step_rows=""
  for s in "${STEP_ORDER[@]}"; do
    local dur
    dur=$(step_dur "$s")
    step_rows+="| ${s} | ${STEP_STATUS[$s]} | ${dur}s |"$'\n'
  done

  local body
  body=$(cat <<MDEOF
## DR Failover Test Report

| Field | Value |
|-------|-------|
| **Date** | ${today} |
| **Environment** | ${ENVIRONMENT} |
| **Primary region** | ${PRIMARY_REGION} |
| **DR region** | ${DR_REGION} |
| **Snapshot** | ${SNAPSHOT_ARN:-${SNAPSHOT_ID:-auto}} |
| **Aurora cluster** | ${CLUSTER_ID} |
| **Aurora endpoint** | ${DR_AURORA_ENDPOINT} |
| **Image tag** | ${DR_IMAGE_TAG} |
| **ALB DNS** | ${ALB:-N/A} |
| **Health check** | ${HEALTH_RESULT} |
| **Total duration** | ${TOTAL_DURATION}s (~$(( TOTAL_DURATION / 60 ))m) |
| **Triggered by** | ${BITBUCKET_BUILD_NUMBER:-manual} (${BITBUCKET_BRANCH:-local}) |

## Step timing

| Step | Result | Duration |
|------|--------|----------|
${step_rows}

## Configuration

- Skip restore: ${SKIP_RESTORE}
- Skip Cognito: ${SKIP_COGNITO}
- Skip NAT: ${SKIP_NAT}
- DR landing stack: ${DR_LANDING_STACK}
- DR backend stack: ${DR_BACKEND_STACK}
- Primary stack: ${PRIMARY_STACK}
MDEOF
)

  local auth
  auth=$(printf '%s:%s' "$email" "$api_token" | base64 | tr -d '\n')

  local payload
  payload=$(jq -n \
    --arg spaceId "$(get_confluence_space_id "$site" "$auth" "$parent_id")" \
    --arg title "$title" \
    --arg parentId "$parent_id" \
    --arg body "$body" \
    '{
      spaceId: $spaceId,
      status: "current",
      title: $title,
      parentId: $parentId,
      body: { representation: "wiki", value: $body }
    }')

  echo ">>> Publishing DR test report to Confluence..."
  local response
  response=$(curl -s -w "\n%{http_code}" \
    -X POST "${site}/wiki/api/v2/pages" \
    -H "Authorization: Basic ${auth}" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null)

  local http_code
  http_code=$(echo "$response" | tail -1)
  local resp_body
  resp_body=$(echo "$response" | sed '$d')

  if [[ "$http_code" =~ ^2 ]]; then
    local page_url
    page_url=$(echo "$resp_body" | jq -r '._links.base + ._links.webui // "unknown"' 2>/dev/null || echo "")
    echo "    Confluence page created: ${page_url}"
  else
    echo "WARN: Confluence publish returned HTTP ${http_code} — report not created."
    echo "      Response: $(echo "$resp_body" | head -c 300)"
  fi
}

get_confluence_space_id() {
  local site="$1" auth="$2" page_id="$3"
  curl -s "${site}/wiki/api/v2/pages/${page_id}?body-format=none" \
    -H "Authorization: Basic ${auth}" \
    2>/dev/null | jq -r '.spaceId // empty' 2>/dev/null || echo ""
}

if [[ "$SKIP_REPORT" != "true" ]]; then
  publish_confluence_report || echo "WARN: Confluence report publish failed (non-fatal)."
else
  echo ">>> Skipping Confluence report (--skip-report)"
fi
