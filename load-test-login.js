import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ─── Custom Metrics ───────────────────────────────────────────────────────────
const loginFailRate = new Rate('login_failures');
const loginDuration = new Trend('login_duration', true);

// ─── Test Config ──────────────────────────────────────────────────────────────
export const options = {
  stages: [
    { duration: '15s', target: 10 },  // ramp up to 10 users
    { duration: '30s', target: 50 },  // ramp up to 50 users
    { duration: '30s', target: 50 },  // hold at 50 users
    { duration: '15s', target: 0 },   // ramp down
  ],
  thresholds: {
    http_req_duration:  ['p(95)<1000'],  // 95% requests < 1 sec
    http_req_failed:    ['rate<0.05'],   // error rate < 5%
    login_failures:     ['rate<0.05'],   // login failures < 5%
  },
};

// ─── Config ───────────────────────────────────────────────────────────────────
const BASE_URL = 'http://localhost:4000'; // 🔁 change to your server URL

// Test credentials — use a real user from your DB
const CREDENTIALS = {
  uid: 'Admin',  // 🔁 change this
  password: 'A2FL9egmbM',      // 🔁 change this
};

// ─── Main Test ────────────────────────────────────────────────────────────────
export default function () {
  const payload = JSON.stringify(CREDENTIALS);

  const params = {
    headers: { 'Content-Type': 'application/json' },
  };

  const res = http.post(`${BASE_URL}/auth/login`, payload, params);

  // Track custom duration
  loginDuration.add(res.timings.duration);

  // Checks
  const success = check(res, {
    'status is 200':          (r) => r.status === 200,
    'has access_token':       (r) => JSON.parse(r.body)?.access_token !== undefined,
    'response time < 1000ms': (r) => r.timings.duration < 1000,
  });

  loginFailRate.add(!success);

  sleep(1);
}
