#!/usr/bin/env bash
# Item #12 — one-shot Vercel rollback to a previous green deploy.
#
# Use when: you push something to main, it deploys, and you realise it's
# broken (500s, white screen, billing flow regressed). Faster than reverting
# the commit + pushing + waiting for the build.
#
# Devil's-advocate fix P3 #12: previous version parsed `vercel ls` text
# output with awk, which broke whenever Vercel CLI changed its output
# format (~ once a year). Now we use `vercel ls --json` which has a
# stable shape and parse via jq.
#
# Usage:
#   bash scripts/rollback.sh                  # rollback to the previous READY deploy
#   bash scripts/rollback.sh dpl_xxx          # rollback to specific deployment URL/ID
#   bash scripts/rollback.sh --list           # show last 10 deploys
#   bash scripts/rollback.sh --check          # show current production deploy + exit
#
# Requirements:
#   - vercel CLI logged in (`vercel login`)
#   - jq installed (`brew install jq` / `apt install jq`)
#   - Run from the repo root
set -euo pipefail

cd "$(dirname "$0")/.."

ALIAS="nexley.vercel.app"

ensure_tools() {
  if ! command -v vercel >/dev/null 2>&1; then
    echo "vercel CLI not installed. Run: npm i -g vercel"
    exit 1
  fi
  if ! command -v jq >/dev/null 2>&1; then
    echo "jq not installed. Run: brew install jq (macOS) or apt-get install jq (Linux)"
    exit 1
  fi
  if ! vercel whoami >/dev/null 2>&1; then
    echo "Not logged in. Run: vercel login"
    exit 1
  fi
}

list_deploys_json() {
  # --json output is stable. Falls back to text if --json isn't supported
  # by the installed CLI (rare, only old versions).
  vercel ls --json --yes 2>/dev/null \
    || vercel list --json --yes 2>/dev/null
}

list_deploys_table() {
  list_deploys_json | jq -r '
    .deployments // .
    | (.[]? // .)
    | [(.url // "?"), (.state // .readyState // "?"), ((.createdAt // 0) / 1000 | strftime("%Y-%m-%dT%H:%MZ")), (.target // "preview")]
    | @tsv
  ' | column -t -s $'\t' | head -20
}

current_prod_json() {
  vercel inspect "$ALIAS" --json 2>/dev/null \
    || vercel inspect "https://$ALIAS" --json 2>/dev/null
}

print_current_prod() {
  local data
  data="$(current_prod_json || true)"
  if [ -z "$data" ]; then
    echo "Couldn't inspect $ALIAS. (Maybe alias not set yet?)"
    return
  fi
  echo "$data" | jq -r '"  url:       \(.url // "?")
  state:     \(.state // .readyState // "?")
  created:   \((.createdAt // 0) / 1000 | strftime("%Y-%m-%dT%H:%MZ"))
  target:    \(.target // "?")
  source:    \(.source // "?")"'
}

case "${1:-}" in
  --check)
    ensure_tools
    echo "Current production:"
    print_current_prod
    exit 0
    ;;
  --list)
    ensure_tools
    echo "Recent deploys (most recent first):"
    list_deploys_table
    echo
    echo "Re-run with: bash scripts/rollback.sh <deployment-url>"
    exit 0
    ;;
esac

ensure_tools

TARGET="${1:-}"

if [ -z "$TARGET" ]; then
  # No arg — auto-pick the second-most-recent READY deploy. Most-recent is
  # likely the broken deploy we're rolling away from.
  echo "Finding previous READY production deploy..."
  TARGET="$(list_deploys_json | jq -r '
    .deployments // .
    | map(select((.target == "production") and ((.state == "READY") or (.readyState == "READY"))))
    | sort_by(.createdAt) | reverse
    | .[1].url // empty
  ')"
  if [ -z "$TARGET" ]; then
    echo "ERROR: couldn't find a previous READY production deploy."
    echo "Use --list to pick manually."
    exit 1
  fi
  echo "  -> $TARGET"
fi

# Confirm
echo
echo "About to alias $ALIAS -> $TARGET"
read -p "Continue? (y/N) " ans
case "$ans" in
  y|Y|yes|YES) ;;
  *) echo "Aborted."; exit 1;;
esac

# Reassign alias
vercel alias set "$TARGET" "$ALIAS"

echo
echo "Done. Verifying..."
sleep 3
print_current_prod

# Tell Light the production deploy moved (item #11). Best-effort.
if [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  curl -sS -X POST "$SUPABASE_URL/rest/v1/agent_alerts" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    --data "$(jq -nc \
      --arg target "$TARGET" \
      --arg alias "$ALIAS" \
      '{
        target_agent: "light",
        priority: "P0",
        category: "deploy",
        subject: "Manual rollback executed by operator",
        body: ("Alias " + $alias + " now pointing at " + $target + ". Investigate what was wrong with the previous deploy and confirm with Renzo that this rollback is permanent (vs just buying time)."),
        source: "scripts/rollback.sh"
      }')" \
    >/dev/null || true
fi
