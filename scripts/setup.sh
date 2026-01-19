#!/bin/bash
# ============================================================================
# AILETHIA / COHEUS - Initial Setup Script
# ============================================================================
# This script sets up the development environment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔧 Setting up Ailethia/Coheus Development Environment${NC}"
echo ""

# Check Node.js version
echo -e "${GREEN}📦 Checking Node.js version...${NC}"
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}❌ Node.js 18+ is required. Current version: $(node -v)${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Node.js $(node -v)${NC}"

# Check if .env files exist
echo -e "${GREEN}📝 Checking environment files...${NC}"
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  .env not found, creating from .env.example${NC}"
    cp .env.example .env
    echo -e "${YELLOW}⚠️  Please edit .env and add your API keys${NC}"
else
    echo -e "${GREEN}✅ .env exists${NC}"
fi

if [ ! -f server/.env ]; then
    echo -e "${YELLOW}⚠️  server/.env not found, creating from server/.env.example${NC}"
    cp server/.env.example server/.env
    echo -e "${YELLOW}⚠️  Please edit server/.env and add your API keys${NC}"
else
    echo -e "${GREEN}✅ server/.env exists${NC}"
fi

# Install frontend dependencies
echo -e "${GREEN}📦 Installing frontend dependencies...${NC}"
npm install

# Install backend dependencies
echo -e "${GREEN}📦 Installing backend dependencies...${NC}"
cd server
npm install
cd ..

# Check if Docker is available
if command -v docker &> /dev/null; then
    echo -e "${GREEN}🐳 Docker is available${NC}"
    
    # Check if Docker Compose is available
    if command -v docker-compose &> /dev/null; then
        echo -e "${GREEN}🐳 Docker Compose is available${NC}"
        echo -e "${YELLOW}💡 To start the database with Docker:${NC}"
        echo -e "   ${BLUE}docker-compose up -d postgres${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Docker not found. You'll need PostgreSQL running locally.${NC}"
fi

# Create necessary directories
echo -e "${GREEN}📁 Creating necessary directories...${NC}"
mkdir -p server/uploads/rag_documents
mkdir -p dist

# Make scripts executable
chmod +x scripts/*.sh 2>/dev/null || true

echo ""
echo -e "${GREEN}✅ Setup complete!${NC}"
echo ""
echo -e "Next steps:"
echo -e "  1. Edit ${YELLOW}.env${NC} and ${YELLOW}server/.env${NC} with your API keys"
echo -e "  2. Start the database: ${BLUE}docker-compose up -d postgres${NC}"
echo -e "  3. Start the backend: ${BLUE}cd server && npm run dev${NC}"
echo -e "  4. Start the frontend: ${BLUE}npm run dev${NC}"
echo ""

