#!/bin/bash

# Coheus v2 - Local Development Startup Script
# This script starts the Docker backend and Vite frontend

set -e

echo "🚀 Starting Coheus v2 Local Development Environment"
echo "=================================================="
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo -e "${RED}❌ Docker is not running!${NC}"
  echo "   Please start Docker Desktop and try again."
  exit 1
fi

echo -e "${GREEN}✅ Docker is running${NC}"
echo ""

# Check if containers are already running
if docker ps | grep -q "coheus-backend"; then
  echo -e "${YELLOW}⚠️  Backend container is already running${NC}"
  echo "   Restarting..."
  docker-compose restart backend
else
  echo -e "${BLUE}🐳 Starting Docker containers...${NC}"
  docker-compose up -d
fi

echo ""
echo -e "${BLUE}⏳ Waiting for services to be ready...${NC}"
sleep 3

# Check backend health
echo ""
echo -e "${BLUE}🔍 Checking backend health...${NC}"
RETRIES=0
MAX_RETRIES=10
until curl -s http://localhost:3001/health > /dev/null 2>&1 || [ $RETRIES -eq $MAX_RETRIES ]; do
  RETRIES=$((RETRIES+1))
  echo "   Attempt $RETRIES/$MAX_RETRIES..."
  sleep 2
done

if [ $RETRIES -eq $MAX_RETRIES ]; then
  echo -e "${RED}❌ Backend failed to start${NC}"
  echo ""
  echo "Logs:"
  docker-compose logs --tail=20 backend
  exit 1
fi

HEALTH_RESPONSE=$(curl -s http://localhost:3001/health)
DB_STATUS=$(echo "$HEALTH_RESPONSE" | grep -o '"database":"[^"]*"' | cut -d'"' -f4)

if [ "$DB_STATUS" = "connected" ]; then
  echo -e "${GREEN}✅ Backend is healthy (Database: connected)${NC}"
else
  echo -e "${YELLOW}⚠️  Backend is running but database status: $DB_STATUS${NC}"
fi

echo ""
echo -e "${GREEN}✅ Docker services are ready!${NC}"
echo ""
echo "📊 Container Status:"
docker ps --filter "name=coheus" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${BLUE}🌐 Starting Frontend (Vite Dev Server)...${NC}"
echo ""
echo "   Frontend will be available at:"
echo -e "   ${GREEN}http://localhost:8084${NC}"
echo ""
echo "   Admin Login:"
echo -e "   ${GREEN}http://localhost:8084/login?returnTo=/admin${NC}"
echo ""
echo "   Credentials:"
echo -e "   Email:    ${YELLOW}admin@Cohi.com${NC}"
echo -e "   Password: ${YELLOW}admin123${NC}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop the frontend${NC}"
echo -e "${YELLOW}Run 'docker-compose down' to stop the backend${NC}"
echo ""

# Start Vite dev server
npm run dev
