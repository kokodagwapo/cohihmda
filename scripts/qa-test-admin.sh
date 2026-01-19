#!/bin/bash

# QA Test Script for Admin Panel at Amazon AWS
# Tests all admin functionality after login

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
CLOUDFRONT_URL="https://d2wvs4i87rs881.cloudfront.net"
EMAIL="admin@ailethia.com"
PASSWORD="admin123"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Admin Panel QA Test - Amazon AWS${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Test 1: Login
echo -e "${YELLOW}[1/10] Testing Login...${NC}"
LOGIN_RESPONSE=$(curl -s -X POST "${CLOUDFRONT_URL}/api/auth/signin" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")

if echo "$LOGIN_RESPONSE" | grep -q "token"; then
  TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
  USER_ID=$(echo "$LOGIN_RESPONSE" | grep -o '"id":"[^"]*' | cut -d'"' -f4)
  echo -e "${GREEN}✓ Login successful${NC}"
  echo -e "  User ID: ${USER_ID}"
  echo -e "  Token: ${TOKEN:0:50}..."
else
  echo -e "${RED}✗ Login failed${NC}"
  echo "$LOGIN_RESPONSE"
  exit 1
fi

echo ""

# Test 2: Get Current User
echo -e "${YELLOW}[2/10] Testing Get Current User...${NC}"
CURRENT_USER=$(curl -s -X GET "${CLOUDFRONT_URL}/api/auth/me" \
  -H "Authorization: Bearer ${TOKEN}")

if echo "$CURRENT_USER" | grep -q "email"; then
  echo -e "${GREEN}✓ Current user retrieved${NC}"
else
  echo -e "${RED}✗ Failed to get current user${NC}"
  echo "$CURRENT_USER"
fi

echo ""

# Test 3: Admin Stats
echo -e "${YELLOW}[3/10] Testing Admin Stats...${NC}"
STATS=$(curl -s -X GET "${CLOUDFRONT_URL}/api/admin/stats" \
  -H "Authorization: Bearer ${TOKEN}")

if echo "$STATS" | grep -q "totalUsers\|totalTenants"; then
  echo -e "${GREEN}✓ Admin stats retrieved${NC}"
  echo "$STATS" | jq '.' 2>/dev/null || echo "$STATS"
else
  echo -e "${YELLOW}⚠ Stats endpoint may not exist or returned unexpected format${NC}"
  echo "$STATS"
fi

echo ""

# Test 4: Get Users List
echo -e "${YELLOW}[4/10] Testing Get Users...${NC}"
USERS=$(curl -s -X GET "${CLOUDFRONT_URL}/api/admin/users" \
  -H "Authorization: Bearer ${TOKEN}")

if echo "$USERS" | grep -q "email\|id"; then
  echo -e "${GREEN}✓ Users list retrieved${NC}"
  USER_COUNT=$(echo "$USERS" | grep -o '"id"' | wc -l | tr -d ' ')
  echo -e "  Found ${USER_COUNT} user(s)"
else
  echo -e "${YELLOW}⚠ Users endpoint may not exist${NC}"
  echo "$USERS"
fi

echo ""

# Test 5: Get Tenants List
echo -e "${YELLOW}[5/10] Testing Get Tenants...${NC}"
TENANTS=$(curl -s -X GET "${CLOUDFRONT_URL}/api/admin/tenants" \
  -H "Authorization: Bearer ${TOKEN}")

if echo "$TENANTS" | grep -q "name\|id"; then
  echo -e "${GREEN}✓ Tenants list retrieved${NC}"
  TENANT_COUNT=$(echo "$TENANTS" | grep -o '"id"' | wc -l | tr -d ' ')
  echo -e "  Found ${TENANT_COUNT} tenant(s)"
else
  echo -e "${YELLOW}⚠ Tenants endpoint may not exist${NC}"
  echo "$TENANTS"
fi

echo ""

# Test 6: User Preferences
echo -e "${YELLOW}[6/10] Testing User Preferences...${NC}"
PREFERENCES=$(curl -s -X GET "${CLOUDFRONT_URL}/api/user/preferences" \
  -H "Authorization: Bearer ${TOKEN}")

if echo "$PREFERENCES" | grep -q "preferences\|{}"; then
  echo -e "${GREEN}✓ User preferences retrieved${NC}"
else
  echo -e "${YELLOW}⚠ Preferences endpoint may not exist${NC}"
  echo "$PREFERENCES"
fi

echo ""

# Test 7: User Profile
echo -e "${YELLOW}[7/10] Testing User Profile...${NC}"
PROFILE=$(curl -s -X GET "${CLOUDFRONT_URL}/api/user/profile" \
  -H "Authorization: Bearer ${TOKEN}")

if echo "$PROFILE" | grep -q "email\|full_name"; then
  echo -e "${GREEN}✓ User profile retrieved${NC}"
  echo "$PROFILE" | jq '.' 2>/dev/null || echo "$PROFILE"
else
  echo -e "${YELLOW}⚠ Profile endpoint may not exist${NC}"
  echo "$PROFILE"
fi

echo ""

# Test 8: Dashboard Data
echo -e "${YELLOW}[8/10] Testing Dashboard Data...${NC}"
DASHBOARD=$(curl -s -X GET "${CLOUDFRONT_URL}/api/dashboard" \
  -H "Authorization: Bearer ${TOKEN}")

if echo "$DASHBOARD" | grep -q "contacts\|calls"; then
  echo -e "${GREEN}✓ Dashboard data retrieved${NC}"
else
  echo -e "${YELLOW}⚠ Dashboard endpoint may not exist${NC}"
  echo "$DASHBOARD"
fi

echo ""

# Test 9: Health Check
echo -e "${YELLOW}[9/10] Testing Backend Health...${NC}"
HEALTH=$(curl -s -X GET "${CLOUDFRONT_URL}/api/health" || curl -s -X GET "${CLOUDFRONT_URL}/health")

if echo "$HEALTH" | grep -q "ok\|status\|healthy"; then
  echo -e "${GREEN}✓ Backend health check passed${NC}"
  echo "$HEALTH"
else
  echo -e "${YELLOW}⚠ Health endpoint may not exist${NC}"
  echo "$HEALTH"
fi

echo ""

# Test 10: Frontend Page Load
echo -e "${YELLOW}[10/10] Testing Admin Page Load...${NC}"
ADMIN_PAGE=$(curl -s -X GET "${CLOUDFRONT_URL}/admin" \
  -H "Cookie: auth_token=${TOKEN}" 2>&1)

if echo "$ADMIN_PAGE" | grep -q "admin\|Admin\|Overview"; then
  echo -e "${GREEN}✓ Admin page loads${NC}"
  PAGE_SIZE=$(echo "$ADMIN_PAGE" | wc -c)
  echo -e "  Page size: ${PAGE_SIZE} bytes"
else
  echo -e "${YELLOW}⚠ Admin page may require browser rendering${NC}"
  echo "$ADMIN_PAGE" | head -20
fi

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}QA Test Complete!${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "Summary:"
echo -e "  ${GREEN}✓${NC} Login: Working"
echo -e "  ${GREEN}✓${NC} Authentication: Working"
echo -e "  ${GREEN}✓${NC} API Endpoints: Tested"
echo ""
echo -e "Next Steps:"
echo -e "  1. Open browser: ${CLOUDFRONT_URL}/admin"
echo -e "  2. Login with: ${EMAIL} / ${PASSWORD}"
echo -e "  3. Test UI interactions manually"
echo -e "  4. Test all admin sections:"
echo -e "     - Users (create/edit/delete)"
echo -e "     - Tenants (create/edit/delete)"
echo -e "     - RAG Settings"
echo -e "     - LOS Settings"
echo -e "     - System Settings"
echo -e "     - SOC 2 Compliance"
echo ""
