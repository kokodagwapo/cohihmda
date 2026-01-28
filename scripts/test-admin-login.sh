#!/bin/bash
# ============================================================================
# Test Admin Login - Diagnose Login Issues
# ============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Use environment variable or require as argument
BACKEND_URL="${1:-${BACKEND_URL}}"
if [ -z "$BACKEND_URL" ]; then
    echo -e "${RED}❌ Error: BACKEND_URL is required${NC}"
    echo -e "   Usage: $0 <backend_url> [admin_email] [admin_password]"
    echo -e "   Or set: export BACKEND_URL=http://your-backend:3001"
    exit 1
fi
FRONTEND_URL="http://Cohi-frontend-1767135651.s3-website-us-east-1.amazonaws.com"
ADMIN_EMAIL="${2:-admin@Cohi.com}"
ADMIN_PASSWORD="${3:-admin123}"

echo -e "${GREEN}🔍 Testing Admin Login Configuration${NC}"
echo -e "Backend: ${YELLOW}${BACKEND_URL}${NC}"
echo -e "Frontend: ${YELLOW}${FRONTEND_URL}${NC}"
echo ""

# Test 1: Backend Health Check
echo -e "${BLUE}1. Testing backend health...${NC}"
HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" "${BACKEND_URL}/health" 2>&1 || echo -e "\n000")
HEALTH_CODE=$(echo "$HEALTH_RESPONSE" | tail -1)
HEALTH_BODY=$(echo "$HEALTH_RESPONSE" | head -n -1)

if [ "$HEALTH_CODE" = "200" ] || [ "$HEALTH_CODE" = "503" ]; then
    echo -e "${GREEN}✅ Backend is reachable (HTTP ${HEALTH_CODE})${NC}"
    echo "Response: $HEALTH_BODY"
else
    echo -e "${RED}❌ Backend is not reachable (HTTP ${HEALTH_CODE})${NC}"
    echo "Response: $HEALTH_BODY"
    echo ""
    echo -e "${YELLOW}⚠️  Backend server may be down or not accessible${NC}"
    exit 1
fi
echo ""

# Test 2: CORS Check
echo -e "${BLUE}2. Testing CORS configuration...${NC}"
CORS_RESPONSE=$(curl -s -X OPTIONS "${BACKEND_URL}/api/auth/signin" \
    -H "Origin: ${FRONTEND_URL}" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: content-type" \
    -w "\n%{http_code}" 2>&1 || echo -e "\n000")
CORS_CODE=$(echo "$CORS_RESPONSE" | tail -1)
CORS_HEADERS=$(curl -s -I -X OPTIONS "${BACKEND_URL}/api/auth/signin" \
    -H "Origin: ${FRONTEND_URL}" \
    -H "Access-Control-Request-Method: POST" 2>&1 | grep -i "access-control" || echo "No CORS headers")

if echo "$CORS_HEADERS" | grep -qi "access-control-allow-origin"; then
    echo -e "${GREEN}✅ CORS headers present${NC}"
    echo "$CORS_HEADERS"
else
    echo -e "${RED}❌ CORS headers missing or incorrect${NC}"
    echo "$CORS_HEADERS"
    echo ""
    echo -e "${YELLOW}⚠️  Backend needs FRONTEND_URL environment variable set${NC}"
    echo -e "   Add to backend .env: ${BLUE}FRONTEND_URL=${FRONTEND_URL}${NC}"
fi
echo ""

# Test 3: Login Endpoint Test
echo -e "${BLUE}3. Testing login endpoint...${NC}"
LOGIN_RESPONSE=$(curl -s -X POST "${BACKEND_URL}/api/auth/signin" \
    -H "Content-Type: application/json" \
    -H "Origin: ${FRONTEND_URL}" \
    -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
    -w "\n%{http_code}" 2>&1 || echo -e "\n000")
LOGIN_CODE=$(echo "$LOGIN_RESPONSE" | tail -1)
LOGIN_BODY=$(echo "$LOGIN_RESPONSE" | head -n -1)

if [ "$LOGIN_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Login successful!${NC}"
    echo "Response: $LOGIN_BODY"
elif [ "$LOGIN_CODE" = "401" ]; then
    echo -e "${RED}❌ Invalid credentials (HTTP 401)${NC}"
    echo "Response: $LOGIN_BODY"
    echo ""
    echo -e "${YELLOW}⚠️  Admin user may not exist. Create with:${NC}"
    echo -e "   ${BLUE}cd server && npm run create-admin${NC}"
elif [ "$LOGIN_CODE" = "503" ]; then
    echo -e "${RED}❌ Service unavailable (HTTP 503)${NC}"
    echo "Response: $LOGIN_BODY"
    echo ""
    echo -e "${YELLOW}⚠️  Database connection issue. Check backend logs.${NC}"
else
    echo -e "${RED}❌ Login failed (HTTP ${LOGIN_CODE})${NC}"
    echo "Response: $LOGIN_BODY"
fi
echo ""

# Summary
echo -e "${BLUE}📋 Summary:${NC}"
echo -e "Backend Health: $([ "$HEALTH_CODE" = "200" ] || [ "$HEALTH_CODE" = "503" ] && echo -e "${GREEN}✅ OK${NC}" || echo -e "${RED}❌ FAILED${NC}")"
echo -e "CORS Config: $(echo "$CORS_HEADERS" | grep -qi "access-control-allow-origin" && echo -e "${GREEN}✅ OK${NC}" || echo -e "${RED}❌ FAILED${NC}")"
echo -e "Login Test: $([ "$LOGIN_CODE" = "200" ] && echo -e "${GREEN}✅ OK${NC}" || echo -e "${RED}❌ FAILED${NC}")"
echo ""

if [ "$LOGIN_CODE" != "200" ]; then
    echo -e "${YELLOW}💡 Next Steps:${NC}"
    echo "1. Ensure backend is running and accessible"
    echo "2. Update backend FRONTEND_URL to include: ${FRONTEND_URL}"
    echo "3. Create admin user: cd server && npm run create-admin"
    echo "4. Restart backend after updating environment variables"
fi
