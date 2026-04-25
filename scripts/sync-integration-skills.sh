#!/usr/bin/env bash
# sync-integration-skills.sh — keep ~/.claude/skills/{fergus,xero}.md in sync
# with the route catalog in app/api/agent/{fergus,xero}/.
#
# Hands off to the Python implementation for actual work — bash is only
# here so the hook in .claude/settings.json doesn't need to know whether
# python is at /usr/bin/python3 or /opt/homebrew/bin/python3.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$SCRIPT_DIR/sync-integration-skills.py" "$@"
