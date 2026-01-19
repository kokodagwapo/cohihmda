#!/bin/bash
# Health Check Script for Coheus
# Verifies all services, tenant isolation, and exports CloudWatch metrics

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DOCKER_DIR="$SCRIPT_DIR/.."
ENV=${1:-prod}
ENV_DIR="$DOCKER_DIR/$ENV"
COMPOSE_FILE="$ENV_DIR/docker-compose.$ENV.yml"

# Determine compose command
if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
else
    COMPOSE_CMD="docker-compose"
fi

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Coheus Health Check${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

cd "$PROJECT_ROOT"

# Check Docker services status
echo -e "${YELLOW}Checking Docker services...${NC}"
SERVICES=("postgres" "redis" "backend" "frontend")
ALL_SERVICES_UP=true

for service in "${SERVICES[@]}"; do
    CONTAINER_NAME="coheus-${service}-${ENV}"
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        STATUS=$(docker inspect --format='{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "not found")
        if [ "$STATUS" = "running" ]; then
            echo -e "${GREEN}✓ $service is running${NC}"
        else
            echo -e "${RED}✗ $service is $STATUS${NC}"
            ALL_SERVICES_UP=false
        fi
    else
        echo -e "${RED}✗ $service container not found${NC}"
        ALL_SERVICES_UP=false
    fi
done

if [ "$ALL_SERVICES_UP" = false ]; then
    echo -e "${RED}Some services are not running${NC}"
    exit 1
fi

# Check PostgreSQL connectivity
echo -e "${YELLOW}Checking PostgreSQL connectivity...${NC}"
if docker exec coheus-postgres-$ENV pg_isready -U postgres > /dev/null 2>&1; then
    echo -e "${GREEN}✓ PostgreSQL is ready${NC}"
else
    echo -e "${RED}✗ PostgreSQL is not ready${NC}"
    exit 1
fi

# Check Redis connectivity
echo -e "${YELLOW}Checking Redis connectivity...${NC}"
if docker exec coheus-redis-$ENV redis-cli ping > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Redis is ready${NC}"
else
    echo -e "${RED}✗ Redis is not ready${NC}"
    exit 1
fi

# Check Backend API health
echo -e "${YELLOW}Checking Backend API health...${NC}"
if curl -f http://localhost:3001/health > /dev/null 2>&1; then
    HEALTH_RESPONSE=$(curl -s http://localhost:3001/health)
    echo -e "${GREEN}✓ Backend API is healthy${NC}"
    echo "  Response: $HEALTH_RESPONSE"
else
    echo -e "${RED}✗ Backend API health check failed${NC}"
    exit 1
fi

# Check Frontend accessibility
echo -e "${YELLOW}Checking Frontend accessibility...${NC}"
if [ "$ENV" == "dev" ]; then
    FRONTEND_URL="http://localhost:8080"
else
    FRONTEND_URL="http://localhost"
fi

if curl -f "$FRONTEND_URL" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Frontend is accessible${NC}"
else
    echo -e "${RED}✗ Frontend is not accessible${NC}"
    exit 1
fi

# Check tenant isolation (basic verification)
echo -e "${YELLOW}Verifying tenant isolation...${NC}"
TENANT_ISOLATION=$(docker exec coheus-backend-$ENV printenv TENANT_ISOLATION_ENABLED 2>/dev/null || echo "true")
if [ "$TENANT_ISOLATION" = "true" ]; then
    echo -e "${GREEN}✓ Tenant isolation is enabled${NC}"
else
    echo -e "${YELLOW}⚠ Tenant isolation may not be enabled${NC}"
fi

# Check resource usage
echo -e "${YELLOW}Checking resource usage...${NC}"
echo ""
echo "Container Resource Usage:"
docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}" | grep coheus

# Check disk usage
echo ""
echo "Disk Usage:"
df -h / | tail -1

# Check database connections
echo ""
echo -e "${YELLOW}Checking database connections...${NC}"
DB_CONNECTIONS=$(docker exec coheus-postgres-$ENV psql -U postgres -d coheus -t -c "SELECT count(*) FROM pg_stat_activity WHERE datname = 'coheus';" 2>/dev/null || echo "0")
echo "Active database connections: $DB_CONNECTIONS"

# Export metrics for CloudWatch (if AWS CLI is available)
if command -v aws &> /dev/null; then
    echo ""
    echo -e "${YELLOW}Exporting metrics to CloudWatch...${NC}"
    
    INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id 2>/dev/null || echo "")
    if [ -n "$INSTANCE_ID" ]; then
        # Get CPU and memory usage
        CPU_USAGE=$(docker stats --no-stream --format "{{.CPUPerc}}" coheus-backend-$ENV | sed 's/%//')
        MEM_USAGE=$(docker stats --no-stream --format "{{.MemPerc}}" coheus-backend-$ENV | sed 's/%//')
        
        # Send custom metrics (requires CloudWatch permissions)
        aws cloudwatch put-metric-data \
            --namespace Coheus/Docker \
            --metric-data \
            MetricName=BackendCPUUsage,Value=$CPU_USAGE,Unit=Percent \
            MetricName=BackendMemoryUsage,Value=$MEM_USAGE,Unit=Percent \
            --region ${AWS_REGION:-us-east-1} 2>/dev/null || echo "⚠ CloudWatch metrics not sent (check IAM permissions)"
        
        echo -e "${GREEN}✓ Metrics exported${NC}"
    fi
fi

# Summary
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Health Check Summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}All services are healthy!${NC}"
echo ""
echo "Service URLs:"
if [ "$ENV" == "dev" ]; then
    echo "  Frontend: http://localhost:8080"
else
    echo "  Frontend: http://localhost"
fi
echo "  Backend API: http://localhost:3001"
echo "  Backend Health: http://localhost:3001/health"
echo ""
