#!/usr/bin/env bash
# ============================================================================
# Mobile backend smoke test
# ============================================================================
# Hits every public mobile endpoint and verifies the basic contract.
# Run AFTER:
#   1. Migration applied (mcp__supabase__apply_migration done)
#   2. Vercel env vars set (UPSTASH_*, ONESIGNAL_*, SUPABASE_DB_WEBHOOK_SECRET, CRON_SECRET)
#   3. Deployed (vercel --prod or git push)
#
# Usage:
#   BASE_URL=https://nexley.vercel.app \
#   JWT=eyJhbGciOi... \
#   bash scripts/mobile-smoke-test.sh
#
# To get a JWT for an existing test user:
#   1. Sign in via dashboard browser session
#   2. Open DevTools → Application → Cookies → copy `sb-<project>-auth-token` cookie value
#   3. Decode the JSON → access_token field
#
# Or programmatically:
#   curl "https://${SUPABASE_PROJECT}.supabase.co/auth/v1/token?grant_type=password" \
#     -H "apikey: $SUPABASE_ANON_KEY" \
#     -H "Content-Type: application/json" \
#     -d '{"email":"test@example.com","password":"..."}'
# ============================================================================

set -uo pipefail

BASE_URL="${BASE_URL:-https://nexley.vercel.app}"
JWT="${JWT:-}"

if [[ -z "$JWT" ]]; then
  echo "Error: set JWT env var to a Supabase access_token before running"
  exit 1
fi

PASS=0
FAIL=0
SKIPPED=0

# ----- Helpers --------------------------------------------------------------

# expect_status URL EXPECTED_STATUS METHOD [BODY] [-H header...]
expect_status() {
  local url="$1"
  local expected="$2"
  local method="${3:-GET}"
  local body="${4:-}"
  shift 4 2>/dev/null || true

  local extra_headers=()
  while [[ $# -gt 0 ]]; do
    extra_headers+=("$1")
    shift
  done

  local args=(-s -o /dev/null -w "%{http_code}" -X "$method" "$url" \
    -H "Authorization: Bearer $JWT")
  if [[ -n "$body" ]]; then
    args+=(-H "Content-Type: application/json" -d "$body")
  fi
  for h in "${extra_headers[@]:-}"; do
    [[ -n "$h" ]] && args+=(-H "$h")
  done

  local got
  got=$(curl "${args[@]}" 2>/dev/null)

  if [[ "$got" == "$expected" ]]; then
    echo "  ✓ $method $url → $got"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $method $url → got $got, expected $expected"
    FAIL=$((FAIL + 1))
  fi
}

# expect_json URL JSON_PATH EXPECTED_VALUE
expect_json() {
  local url="$1"
  local jq_path="$2"
  local expected="$3"

  local got
  got=$(curl -s -X GET "$url" -H "Authorization: Bearer $JWT" 2>/dev/null | jq -r "$jq_path" 2>/dev/null)

  if [[ "$got" == "$expected" ]]; then
    echo "  ✓ $url $jq_path → $got"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $url $jq_path → got '$got', expected '$expected'"
    FAIL=$((FAIL + 1))
  fi
}

# ----- Probes ---------------------------------------------------------------

echo ""
echo "========================================"
echo "Nexley mobile backend smoke test"
echo "========================================"
echo "Base URL: $BASE_URL"
echo "Started:  $(date -u +%FT%TZ)"
echo ""

# 0. Health (no auth)
echo "[0] Health"
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/mobile/health")
echo "  Health endpoint: HTTP $HEALTH_STATUS"
HEALTH_BODY=$(curl -s "$BASE_URL/api/mobile/health" 2>/dev/null)
echo "  Body: $HEALTH_BODY" | head -c 400
echo ""

# 1. Auth-gated endpoints
echo ""
echo "[1] Authenticated GET endpoints (200 expected)"
expect_status "$BASE_URL/api/mobile/me" 200
expect_status "$BASE_URL/api/mobile/notifications/preferences" 200
expect_status "$BASE_URL/api/mobile/notifications" 200
expect_status "$BASE_URL/api/mobile/inbox" 200
expect_status "$BASE_URL/api/mobile/contacts" 200
expect_status "$BASE_URL/api/mobile/estimates" 200
expect_status "$BASE_URL/api/mobile/jobs" 200
expect_status "$BASE_URL/api/mobile/ai-employee" 200
expect_status "$BASE_URL/api/mobile/integrations" 200
expect_status "$BASE_URL/api/mobile/billing/subscription" 200

# 2. Unauthorized requests should 401
echo ""
echo "[2] No-auth requests (401 expected)"
curl -s -o /dev/null -w "  ✗ /me without auth → %{http_code} (want 401)\n" \
  "$BASE_URL/api/mobile/me" | grep -v "401" || echo "  ✓ /me without auth blocked"
curl -s -o /dev/null -w "  ✗ /chat/send without auth → %{http_code} (want 401)\n" \
  -X POST -H "Content-Type: application/json" -d '{"content":"x"}' \
  "$BASE_URL/api/mobile/chat/send" | grep -v "401" || echo "  ✓ /chat/send without auth blocked"

# 3. Validation errors
echo ""
echo "[3] Validation errors (400 expected)"
expect_status "$BASE_URL/api/mobile/onboarding/ai-consent" 400 POST '{}'
expect_status "$BASE_URL/api/mobile/push/enroll" 400 POST '{}'

# 4. AI consent flow
echo ""
echo "[4] AI consent flow"
expect_status "$BASE_URL/api/mobile/onboarding/ai-consent" 200 POST \
  '{"consented":true,"consent_version":"1.0"}'

# 5. Mark notification preferences
echo ""
echo "[5] Notification preferences PATCH"
expect_status "$BASE_URL/api/mobile/notifications/preferences" 200 PATCH \
  '{"daily_digest":true,"digest_local_hour":17}'

# 6. Chat send (creates a session + assistant placeholder)
echo ""
echo "[6] Chat send (creates conversation + user_message + assistant_placeholder)"
SEND_RESPONSE=$(curl -s -X POST "$BASE_URL/api/mobile/chat/send" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: smoke-$(date +%s)" \
  -d '{"content":"Smoke test — what time is it?"}' 2>/dev/null)
echo "  Response: $SEND_RESPONSE" | head -c 400
echo ""
CONVO_ID=$(echo "$SEND_RESPONSE" | jq -r '.conversation_id // empty' 2>/dev/null)
ASST_ID=$(echo "$SEND_RESPONSE" | jq -r '.assistant_message_id // empty' 2>/dev/null)

if [[ -n "$CONVO_ID" && -n "$ASST_ID" ]]; then
  echo "  ✓ conversation_id=$CONVO_ID, assistant_message_id=$ASST_ID"
  PASS=$((PASS + 1))
else
  echo "  ✗ Failed to create chat pair"
  FAIL=$((FAIL + 1))
fi

# 7. Idempotency replay (same key, same body — should return same result)
echo ""
echo "[7] Idempotency replay"
KEY="smoke-replay-$(date +%s)"
R1=$(curl -s -X POST "$BASE_URL/api/mobile/chat/send" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $KEY" \
  -d '{"content":"Replay test"}' 2>/dev/null | jq -r '.user_message_id // empty' 2>/dev/null)
sleep 1
R2=$(curl -s -X POST "$BASE_URL/api/mobile/chat/send" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $KEY" \
  -d '{"content":"Replay test"}' 2>/dev/null | jq -r '.user_message_id // empty' 2>/dev/null)
if [[ -n "$R1" && "$R1" == "$R2" ]]; then
  echo "  ✓ Idempotency working (got same message_id $R1 twice)"
  PASS=$((PASS + 1))
else
  echo "  ✗ Idempotency BROKEN: r1=$R1 r2=$R2"
  FAIL=$((FAIL + 1))
fi

# 8. Different body, same key — should 422
echo ""
echo "[8] Idempotency replay-with-different-body should 422"
expect_status "$BASE_URL/api/mobile/chat/send" 422 POST \
  '{"content":"DIFFERENT"}' "Idempotency-Key: $KEY"

# ----- Summary --------------------------------------------------------------

echo ""
echo "========================================"
echo "Pass: $PASS   Fail: $FAIL   Skipped: $SKIPPED"
echo "========================================"

[[ "$FAIL" -gt 0 ]] && exit 1
exit 0
