#!/bin/bash
# Docker Setup Script for Coheus
# Handles environment initialization, tenant setup, and service startup

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

# Default environment
ENV=${1:-dev}

# Validate environment
if [[ ! "$ENV" =~ ^(dev|prod)$ ]]; then
    echo -e "${RED}Error: Environment must be 'dev' or 'prod'${NC}"
    exit 1
fi

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Coheus Docker Setup - $ENV Environment${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check Docker installation
echo -e "${YELLOW}Checking Docker installation...${NC}"
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed${NC}"
    echo "Please install Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo -e "${RED}Error: Docker Compose is not installed${NC}"
    echo "Please install Docker Compose: https://docs.docker.com/compose/install/"
    exit 1
fi

echo -e "${GREEN}✓ Docker is installed${NC}"

# Determine compose command
if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
else
    COMPOSE_CMD="docker-compose"
fi

# Set environment-specific paths
ENV_DIR="$DOCKER_DIR/$ENV"
COMPOSE_FILE="$ENV_DIR/docker-compose.$ENV.yml"
ENV_EXAMPLE="$ENV_DIR/.env.example.$ENV"
ENV_FILE="$ENV_DIR/.env"

# Create .env file from example if it doesn't exist
if [ ! -f "$ENV_FILE" ]; then
    echo -e "${YELLOW}Creating .env file from template...${NC}"
    if [ -f "$ENV_EXAMPLE" ]; then
        cp "$ENV_EXAMPLE" "$ENV_FILE"
        echo -e "${GREEN}✓ Created $ENV_FILE${NC}"
        echo -e "${YELLOW}⚠ Please edit $ENV_FILE with your configuration${NC}"
    else
        echo -e "${RED}Error: Template file $ENV_EXAMPLE not found${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ .env file already exists${NC}"
fi

# Generate JWT secret if not set
if grep -q "CHANGE_ME\|dev-secret" "$ENV_FILE" 2>/dev/null; then
    echo -e "${YELLOW}Generating secure JWT secret...${NC}"
    JWT_SECRET=$(openssl rand -hex 32)
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s/JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" "$ENV_FILE"
    else
        # Linux
        sed -i "s/JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" "$ENV_FILE"
    fi
    echo -e "${GREEN}✓ Generated JWT secret${NC}"
fi

# Validate required environment variables
echo -e "${YELLOW}Validating environment variables...${NC}"
source "$ENV_FILE" 2>/dev/null || true

REQUIRED_VARS=("DB_PASSWORD" "JWT_SECRET")
MISSING_VARS=()

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ] || [[ "${!var}" == *"CHANGE_ME"* ]]; then
        MISSING_VARS+=("$var")
    fi
done

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo -e "${RED}Error: Missing or invalid required variables:${NC}"
    for var in "${MISSING_VARS[@]}"; do
        echo -e "${RED}  - $var${NC}"
    done
    echo -e "${YELLOW}Please update $ENV_FILE${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Environment variables validated${NC}"

# Create volumes directory
echo -e "${YELLOW}Initializing volumes...${NC}"
mkdir -p "$PROJECT_ROOT/docker/volumes/postgres"
mkdir -p "$PROJECT_ROOT/docker/volumes/redis"
mkdir -p "$PROJECT_ROOT/docker/prod/backups"
echo -e "${GREEN}✓ Volumes initialized${NC}"

# Start services
echo ""
echo -e "${YELLOW}Starting Docker services...${NC}"
cd "$PROJECT_ROOT"

# Pull images if needed
$COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" pull --ignore-pull-failures

# Build and start services
$COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build

echo ""
echo -e "${GREEN}✓ Services started${NC}"

# Wait for services to be healthy
echo -e "${YELLOW}Waiting for services to be healthy...${NC}"
sleep 5

# Check service health
MAX_WAIT=60
WAIT_COUNT=0
while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    if $COMPOSE_CMD -f "$COMPOSE_FILE" ps | grep -q "healthy\|Up"; then
        break
    fi
    sleep 2
    WAIT_COUNT=$((WAIT_COUNT + 2))
done

# Run database migrations if backend is ready
echo -e "${YELLOW}Running database migrations...${NC}"
sleep 10  # Give backend more time to start

if docker exec coheus-backend-$ENV npm run migrate 2>/dev/null; then
    echo -e "${GREEN}✓ Database migrations completed${NC}"
else
    echo -e "${YELLOW}⚠ Migrations may need to be run manually${NC}"
fi

# Display service status
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Service Status${NC}"
echo -e "${BLUE}========================================${NC}"
$COMPOSE_CMD -f "$COMPOSE_FILE" ps

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Service URLs${NC}"
echo -e "${BLUE}========================================${NC}"
if [ "$ENV" == "dev" ]; then
    echo -e "${GREEN}Frontend:${NC} http://localhost:8080"
    echo -e "${GREEN}Backend API:${NC} http://localhost:3001"
    echo -e "${GREEN}Backend Health:${NC} http://localhost:3001/health"
else
    echo -e "${GREEN}Frontend:${NC} http://localhost"
    echo -e "${GREEN}Backend API:${NC} http://localhost:3001"
    echo -e "${GREEN}Backend Health:${NC} http://localhost:3001/health"
fi
echo -e "${GREEN}PostgreSQL:${NC} localhost:5432"
echo -e "${GREEN}Redis:${NC} localhost:6379"

echo ""
echo -e "${GREEN}✓ Setup complete!${NC}"
echo ""
echo -e "${YELLOW}To view logs:${NC} cd $PROJECT_ROOT && $COMPOSE_CMD -f $COMPOSE_FILE logs -f"
echo -e "${YELLOW}To stop services:${NC} cd $PROJECT_ROOT && $COMPOSE_CMD -f $COMPOSE_FILE down"
echo ""
