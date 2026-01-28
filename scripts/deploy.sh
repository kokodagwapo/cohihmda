#!/bin/bash
# ============================================================================
# Cohi / COHEUS - Deployment Script
# ============================================================================
# This script handles deployment for both cloud and on-premise instances

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
ENV=${1:-production}
COMPOSE_FILE="docker-compose.prod.yml"

echo -e "${GREEN}🚀 Starting Cohi/Coheus Deployment${NC}"
echo -e "Environment: ${YELLOW}${ENV}${NC}"

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${RED}❌ Error: .env file not found${NC}"
    echo -e "Please copy .env.example to .env and configure it"
    exit 1
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Error: Docker is not running${NC}"
    exit 1
fi

# Check if Docker Compose is available
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ Error: docker-compose not found${NC}"
    exit 1
fi

# Build and start services
echo -e "${GREEN}📦 Building Docker images...${NC}"
docker-compose -f ${COMPOSE_FILE} build

echo -e "${GREEN}🔄 Starting services...${NC}"
docker-compose -f ${COMPOSE_FILE} up -d

# Wait for services to be healthy
echo -e "${GREEN}⏳ Waiting for services to be ready...${NC}"
sleep 10

# Check backend health
if curl -f http://localhost:3001/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Backend is healthy${NC}"
else
    echo -e "${YELLOW}⚠️  Backend health check failed (may still be starting)${NC}"
fi

# Check database connection
echo -e "${GREEN}🔍 Checking database connection...${NC}"
if docker-compose -f ${COMPOSE_FILE} exec -T postgres pg_isready -U postgres > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Database is ready${NC}"
else
    echo -e "${RED}❌ Database connection failed${NC}"
    exit 1
fi

# Run migrations (if needed)
echo -e "${GREEN}📊 Running database migrations...${NC}"
docker-compose -f ${COMPOSE_FILE} exec -T backend npm run migrate || echo -e "${YELLOW}⚠️  Migrations may have already run${NC}"

echo -e "${GREEN}✅ Deployment complete!${NC}"
echo -e ""
echo -e "Services:"
echo -e "  - Backend API: ${GREEN}http://localhost:3001${NC}"
echo -e "  - Database: ${GREEN}localhost:5432${NC}"
echo -e ""
echo -e "To view logs:"
echo -e "  ${YELLOW}docker-compose -f ${COMPOSE_FILE} logs -f${NC}"
echo -e ""
echo -e "To stop services:"
echo -e "  ${YELLOW}docker-compose -f ${COMPOSE_FILE} down${NC}"

