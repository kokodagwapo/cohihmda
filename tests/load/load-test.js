/**
 * k6 Load Test Script for Coheus API
 *
 * Install k6: https://k6.io/docs/getting-started/installation/
 * Run:        k6 run tests/load/load-test.js
 * Run w/ env: k6 run -e BASE_URL=https://cohi-dev-api.coheus1.com tests/load/load-test.js
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend } from "k6/metrics";

// Custom metrics
const errorRate = new Rate("errors");
const healthLatency = new Trend("health_latency");

// ============================================================================
// Configuration
// ============================================================================

const BASE_URL = __ENV.BASE_URL || "https://cohi-dev-api.coheus1.com";
const AUTH_TOKEN = __ENV.AUTH_TOKEN || ""; // Pass JWT for authenticated endpoints

export const options = {
  // Staged ramp-up/ramp-down
  stages: [
    { duration: "2m", target: 10 }, // ramp to 10 virtual users
    { duration: "5m", target: 10 }, // hold at 10
    { duration: "2m", target: 50 }, // ramp to 50
    { duration: "5m", target: 50 }, // hold at 50
    { duration: "2m", target: 100 }, // ramp to 100
    { duration: "5m", target: 100 }, // hold at 100
    { duration: "3m", target: 0 }, // ramp down
  ],

  // Performance thresholds
  thresholds: {
    http_req_duration: ["p(95)<2000"], // 95th percentile < 2 seconds
    http_req_failed: ["rate<0.05"], // error rate < 5%
    errors: ["rate<0.05"], // custom error rate < 5%
    health_latency: ["p(99)<500"], // health check p99 < 500ms
  },
};

// ============================================================================
// Helper: Authenticated request headers
// ============================================================================

function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (AUTH_TOKEN) {
    headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;
  }
  return headers;
}

// ============================================================================
// Default test function
// ============================================================================

export default function () {
  // --- Health check (unauthenticated) ---
  group("Health Check", () => {
    const res = http.get(`${BASE_URL}/health`);
    healthLatency.add(res.timings.duration);
    const ok = check(res, {
      "health: status 200": (r) => r.status === 200,
      "health: response time < 500ms": (r) => r.timings.duration < 500,
    });
    errorRate.add(!ok);
  });

  sleep(0.5);

  // --- Authenticated endpoints (only if token is provided) ---
  if (AUTH_TOKEN) {
    group("Dashboard API", () => {
      const res = http.get(`${BASE_URL}/api/dashboard/reports`, {
        headers: authHeaders(),
      });
      const ok = check(res, {
        "dashboard: status 200": (r) => r.status === 200,
        "dashboard: response time < 3s": (r) => r.timings.duration < 3000,
      });
      errorRate.add(!ok);
    });

    sleep(0.5);

    group("Scorecard API", () => {
      const res = http.get(`${BASE_URL}/api/scorecard/top-tiering`, {
        headers: authHeaders(),
      });
      const ok = check(res, {
        "scorecard: status 200 or 401": (r) =>
          r.status === 200 || r.status === 401,
        "scorecard: response time < 5s": (r) => r.timings.duration < 5000,
      });
      errorRate.add(!ok && res.status !== 401);
    });

    sleep(0.5);

    group("Cohi Chat API", () => {
      const payload = JSON.stringify({
        message: "What is the pull-through rate?",
      });
      const res = http.post(`${BASE_URL}/api/workbench/chat`, payload, {
        headers: authHeaders(),
      });
      const ok = check(res, {
        "chat: status 200 or 401": (r) =>
          r.status === 200 || r.status === 401,
        "chat: response time < 10s": (r) => r.timings.duration < 10000,
      });
      errorRate.add(!ok && res.status !== 401);
    });
  }

  sleep(1);
}

// ============================================================================
// Smoke test scenario (quick validation)
// ============================================================================

export function smoke() {
  const res = http.get(`${BASE_URL}/health`);
  check(res, {
    "smoke: status 200": (r) => r.status === 200,
  });
}
