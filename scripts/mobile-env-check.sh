#!/usr/bin/env bash
# ============================================================================
# Mobile backend env var checker
# ============================================================================
# Verifies all required env vars are set, both locally (.env.local) and via
# Vercel CLI (production env). Run BEFORE deploying.
#
#   bash scripts/mobile-env-check.sh
#   bash scripts/mobile-env-check.sh production    # also check Vercel prod env
# ============================================================================

set -uo pipefail

# Required for the mobile backend
REQUIRED=(
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
  ANTHROPIC_API_KEY
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  COMPOSIO_API_KEY
  CRON_SECRET
)

# New for mobile backend
NEW=(
  UPSTASH_REDIS_REST_URL
  UPSTASH_REDIS_REST_TOKEN
  ONESIGNAL_APP_ID
  ONESIGNAL_REST_API_KEY
  SUPABASE_DB_WEBHOOK_SECRET
)

MISSING_LOCAL=()
MISSING_VERCEL=()
PASS=0

check_local() {
  local key="$1"
  if [[ -f .env.local ]] && grep -q "^${key}=." .env.local; then
    echo "  ✓ $key (local)"
    PASS=$((PASS + 1))
  elif [[ -n "${!key:-}" ]]; then
    echo "  ✓ $key (process env)"
    PASS=$((PASS + 1))
  else
    MISSING_LOCAL+=("$key")
    echo "  ✗ $key MISSING locally"
  fi
}

check_vercel() {
  local key="$1"
  if vercel env ls production 2>/dev/null | grep -q "^[[:space:]]*${key}[[:space:]]"; then
    echo "  ✓ $key (Vercel prod)"
  else
    MISSING_VERCEL+=("$key")
    echo "  ✗ $key MISSING on Vercel prod"
  fi
}

echo ""
echo "========================================"
echo "Nexley mobile backend env check"
echo "========================================"
echo ""
echo "[1] Required env vars (local)"
for key in "${REQUIRED[@]}" "${NEW[@]}"; do
  check_local "$key"
done

if [[ "${1:-}" == "production" ]]; then
  echo ""
  echo "[2] Vercel production env vars"
  for key in "${REQUIRED[@]}" "${NEW[@]}"; do
    check_vercel "$key"
  done
fi

echo ""
echo "========================================"

if [[ "${#MISSING_LOCAL[@]}" -gt 0 ]]; then
  echo "Missing locally:"
  for k in "${MISSING_LOCAL[@]}"; do echo "  - $k"; done
  echo ""
  echo "Add to .env.local:"
  for k in "${MISSING_LOCAL[@]}"; do
    echo "  $k=<value>"
  done
fi

if [[ "${#MISSING_VERCEL[@]}" -gt 0 ]]; then
  echo "Missing on Vercel prod:"
  for k in "${MISSING_VERCEL[@]}"; do echo "  - $k"; done
  echo ""
  echo "Add via:"
  for k in "${MISSING_VERCEL[@]}"; do
    echo "  vercel env add $k production"
  done
fi

if [[ "${#MISSING_LOCAL[@]}" -eq 0 && "${#MISSING_VERCEL[@]}" -eq 0 ]]; then
  echo "All env vars present."
  exit 0
fi

exit 1
