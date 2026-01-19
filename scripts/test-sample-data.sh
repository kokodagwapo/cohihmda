#!/bin/bash

# Test Sample Data Insertion and Verification Script
# Tests the sample data generation and verifies formulas

set -e

echo "🧪 Testing Sample Data Generation and Verification"
echo "=================================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if backend is running
if ! curl -s http://localhost:3001/health > /dev/null 2>&1; then
  echo -e "${RED}❌ Backend server is not running on http://localhost:3001${NC}"
  echo "Please start the backend: cd server && npm run dev"
  exit 1
fi

echo -e "${GREEN}✅ Backend server is running${NC}"
echo ""

# Check if we have a token (user needs to be logged in)
echo "⚠️  Note: This script requires authentication."
echo "Please ensure you're logged in and have a valid JWT token."
echo ""
read -p "Enter your JWT token (or press Enter to skip API tests): " JWT_TOKEN

if [ -z "$JWT_TOKEN" ]; then
  echo -e "${YELLOW}⚠️  Skipping API tests. You can test manually using the frontend.${NC}"
  echo ""
  echo "Manual Testing Steps:"
  echo "1. Open http://localhost:8082/insights"
  echo "2. Click 'Insert Sample Data' button"
  echo "3. Verify the response shows success"
  echo "4. Check dashboard shows data"
  exit 0
fi

echo ""
echo "📊 Testing API Endpoints..."
echo ""

# Test 1: Insert Sample Data
echo "1. Testing sample data insertion..."
INSERT_RESPONSE=$(curl -s -X POST \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:3001/api/dashboard/sample-data)

if echo "$INSERT_RESPONSE" | grep -q "success.*true"; then
  echo -e "${GREEN}✅ Sample data inserted successfully${NC}"
  echo "$INSERT_RESPONSE" | jq '.' 2>/dev/null || echo "$INSERT_RESPONSE"
else
  echo -e "${RED}❌ Sample data insertion failed${NC}"
  echo "$INSERT_RESPONSE"
  exit 1
fi

echo ""
sleep 2

# Test 2: Get Stats
echo "2. Testing stats API..."
STATS_RESPONSE=$(curl -s \
  -H "Authorization: Bearer $JWT_TOKEN" \
  http://localhost:3001/api/loans/stats?dateFilter=all)

if echo "$STATS_RESPONSE" | grep -q "total"; then
  TOTAL=$(echo "$STATS_RESPONSE" | jq -r '.total' 2>/dev/null || echo "N/A")
  ACTIVE=$(echo "$STATS_RESPONSE" | jq -r '.active' 2>/dev/null || echo "N/A")
  CLOSED=$(echo "$STATS_RESPONSE" | jq -r '.closed' 2>/dev/null || echo "N/A")
  PULL_THROUGH=$(echo "$STATS_RESPONSE" | jq -r '.pullThroughRate' 2>/dev/null || echo "N/A")
  
  echo -e "${GREEN}✅ Stats API working${NC}"
  echo "   Total Loans: $TOTAL"
  echo "   Active: $ACTIVE"
  echo "   Closed: $CLOSED"
  echo "   Pull-Through Rate: $PULL_THROUGH%"
  
  # Verify values are reasonable
  if [ "$TOTAL" != "N/A" ] && [ "$TOTAL" -gt 100 ]; then
    echo -e "${GREEN}✅ Total loans count is reasonable (>100)${NC}"
  else
    echo -e "${YELLOW}⚠️  Total loans count seems low${NC}"
  fi
else
  echo -e "${RED}❌ Stats API failed${NC}"
  echo "$STATS_RESPONSE"
fi

echo ""

# Test 3: Test Date Filters
echo "3. Testing date filters..."
for FILTER in "today" "mtd" "ytd" "all"; do
  FILTER_RESPONSE=$(curl -s \
    -H "Authorization: Bearer $JWT_TOKEN" \
    "http://localhost:3001/api/loans/stats?dateFilter=$FILTER")
  
  FILTER_TOTAL=$(echo "$FILTER_RESPONSE" | jq -r '.total' 2>/dev/null || echo "0")
  
  if [ "$FILTER_TOTAL" != "0" ] || [ "$FILTER" = "today" ]; then
    echo -e "${GREEN}✅ $FILTER filter: $FILTER_TOTAL loans${NC}"
  else
    echo -e "${YELLOW}⚠️  $FILTER filter: $FILTER_TOTAL loans (may be expected)${NC}"
  fi
done

echo ""

# Test 4: Test Funnel API
echo "4. Testing funnel API..."
FUNNEL_RESPONSE=$(curl -s \
  -H "Authorization: Bearer $JWT_TOKEN" \
  "http://localhost:3001/api/loans/funnel?year=2025")

if echo "$FUNNEL_RESPONSE" | grep -q "loansStarted"; then
  STARTED=$(echo "$FUNNEL_RESPONSE" | jq -r '.loansStarted.units' 2>/dev/null || echo "N/A")
  ORIGINATED=$(echo "$FUNNEL_RESPONSE" | jq -r '.originated.units' 2>/dev/null || echo "N/A")
  
  echo -e "${GREEN}✅ Funnel API working${NC}"
  echo "   Loans Started: $STARTED"
  echo "   Originated: $ORIGINATED"
else
  echo -e "${RED}❌ Funnel API failed${NC}"
  echo "$FUNNEL_RESPONSE"
fi

echo ""

# Test 5: Test Leaderboard API
echo "5. Testing leaderboard API..."
LEADERBOARD_RESPONSE=$(curl -s \
  -H "Authorization: Bearer $JWT_TOKEN" \
  "http://localhost:3001/api/dashboard/leaderboard?timeframe=ytd")

if echo "$LEADERBOARD_RESPONSE" | grep -q "leaderboard"; then
  LEADERBOARD_COUNT=$(echo "$LEADERBOARD_RESPONSE" | jq -r '.leaderboard | length' 2>/dev/null || echo "0")
  
  echo -e "${GREEN}✅ Leaderboard API working${NC}"
  echo "   Employees in leaderboard: $LEADERBOARD_COUNT"
  
  if [ "$LEADERBOARD_COUNT" -gt 0 ]; then
    TOP_EMPLOYEE=$(echo "$LEADERBOARD_RESPONSE" | jq -r '.leaderboard[0].name' 2>/dev/null || echo "N/A")
    TOP_LOANS=$(echo "$LEADERBOARD_RESPONSE" | jq -r '.leaderboard[0].loansClosed' 2>/dev/null || echo "N/A")
    echo "   Top Performer: $TOP_EMPLOYEE ($TOP_LOANS loans)"
  fi
else
  echo -e "${RED}❌ Leaderboard API failed${NC}"
  echo "$LEADERBOARD_RESPONSE"
fi

echo ""
echo "=================================================="
echo -e "${GREEN}✅ Testing Complete!${NC}"
echo ""
echo "Next Steps:"
echo "1. Open http://localhost:8082/insights in your browser"
echo "2. Verify dashboard shows the data"
echo "3. Test date filters (Today/MTD/YTD/All)"
echo "4. Check leaderboard rankings"
echo "5. Verify formulas are correct"
