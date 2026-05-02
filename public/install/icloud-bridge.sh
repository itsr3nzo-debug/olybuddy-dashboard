#!/bin/bash
# Nexley iCloud Bridge — unified installer (self-serve + concierge).
#
# Self-serve mode (customer-driven via dashboard wizard):
#   curl -fsSL https://nexley.co.uk/install/icloud-bridge.sh | \
#     bash -s -- self-serve --secret-file /tmp/nexley-secret.txt
#
# Concierge mode (engineer-driven via screen-share):
#   NEXLEY_TS_AUTHKEY=tskey-... NEXLEY_HMAC_SECRET=$(openssl rand -hex 32) \
#     bash -s -- <client-slug>
#
# Required env (concierge) or args (self-serve):
#   NEXLEY_TS_AUTHKEY    — Tailscale auth-key, tag:client-bridge, 1h expiry
#                          For self-serve, customer emails setup@nexley.co.uk
#                          to get one (until Tailscale OAuth ships in dashboard).
#   NEXLEY_HMAC_SECRET   — concierge: openssl rand -hex 32
#                          self-serve: from --secret-file or --secret-stdin
#
# What the customer sees:
#   - 1 Tailscale GUI auth dialog (Continue) + 1 System Extension approval
#     (System Settings → Privacy & Security → Allow)
#   - 1 Bun quarantine override on Sequoia/Tahoe (sometimes; auto-stripped)
#   - 1 Files-and-Folders TCC dialog when --tcc-prefetch runs (Phase 4)
#
# What the customer DOES NOT see (we handle):
#   - Bun install via curl|bash
#   - launchd plist render + load
#   - HMAC secret atomic write to ~/.nexley-bridge/secret (chmod 600)
#   - bridge bind to tailnet IP only (refuses 0.0.0.0)
#
# DA-validated: fails fast on existing-tailnet membership unless
# NEXLEY_TS_FORCE_RESET=1 is explicitly set.

set -euo pipefail

MODE="${1:-}"
shift || true

# ─── Argument parsing ───────────────────────────────────────────────────────
SECRET_MODE=""
SECRET_ARG=""
CLIENT_SLUG=""

case "$MODE" in
    self-serve)
        # Parse --secret-file PATH | --secret-stdin
        while [ $# -gt 0 ]; do
            case "$1" in
                --secret-file) SECRET_MODE="--secret-file"; SECRET_ARG="${2:-}"; shift 2 ;;
                --secret-stdin) SECRET_MODE="--secret-stdin"; shift ;;
                *) echo "Unknown self-serve flag: $1" >&2; exit 1 ;;
            esac
        done
        if [ -z "$SECRET_MODE" ]; then
            cat >&2 <<EOF
❌ Self-serve install needs the HMAC secret you generated in the dashboard.

  Step 1: write it to a temp file:
    cat > /tmp/nexley-secret.txt <<'EOS'
    <paste-secret-here>
    EOS
    chmod 600 /tmp/nexley-secret.txt

  Step 2: re-run with --secret-file:
    curl -fsSL https://nexley.co.uk/install/icloud-bridge.sh | \\
      bash -s -- self-serve --secret-file /tmp/nexley-secret.txt
EOF
            exit 1
        fi
        # For self-serve, slug is "self-serve-{shortHash}" (we don't know the slug)
        CLIENT_SLUG="self-serve"
        ;;
    "")
        echo "❌ Usage: bash icloud-bridge.sh self-serve --secret-file <path>" >&2
        echo "         OR: bash icloud-bridge.sh <client-slug>   (concierge)" >&2
        exit 1
        ;;
    *)
        # Concierge mode: arg is the client slug. NEXLEY_HMAC_SECRET must be in env.
        CLIENT_SLUG="$MODE"
        if [ -z "${NEXLEY_HMAC_SECRET:-}" ] || [ ${#NEXLEY_HMAC_SECRET} -lt 32 ]; then
            echo "❌ Concierge mode needs NEXLEY_HMAC_SECRET in env (>=32 chars)." >&2
            exit 1
        fi
        ;;
esac

# Read secret if self-serve
HMAC_SECRET="${NEXLEY_HMAC_SECRET:-}"
if [ "$MODE" = "self-serve" ]; then
    case "$SECRET_MODE" in
        --secret-file)
            if [ ! -r "$SECRET_ARG" ]; then
                echo "❌ --secret-file path missing or unreadable: $SECRET_ARG" >&2
                exit 1
            fi
            HMAC_SECRET=$(tr -d '\r\n' < "$SECRET_ARG")
            ;;
        --secret-stdin)
            HMAC_SECRET=$(tr -d '\r\n')
            ;;
    esac
fi

if [ ${#HMAC_SECRET} -lt 32 ]; then
    echo "❌ HMAC secret must be at least 32 chars (got ${#HMAC_SECRET})." >&2
    exit 1
fi

# Tailscale auth-key check — informative error path for self-serve
if [ -z "${NEXLEY_TS_AUTHKEY:-}" ]; then
    cat >&2 <<EOF
❌ NEXLEY_TS_AUTHKEY not set in env.

This is the one piece we can't generate self-serve yet (we're working on it).

For now, email setup@nexley.co.uk with subject "iCloud Bridge install key for
<your-business-name>" — we'll email back a one-time install key within one
business hour. Then re-run with:

  NEXLEY_TS_AUTHKEY=<key-we-emailed> bash <(curl -fsSL https://nexley.co.uk/install/icloud-bridge.sh) ${MODE} ${SECRET_MODE} ${SECRET_ARG}

Or skip this entirely — book a 30-min setup call at the dashboard and an
engineer drives the install end-to-end. No Terminal needed on your side.
EOF
    exit 1
fi

INSTALL_DIR="$HOME/.nexley-bridge"
BRIDGE_PORT="${NEXLEY_BRIDGE_PORT:-7878}"
BRIDGE_BASE_URL="${NEXLEY_BRIDGE_BASE_URL:-https://nexley.co.uk/install/icloud-bridge}"

BUN_PATH="${BUN_PATH:-$HOME/.bun/bin/bun}"
[ -x "$BUN_PATH" ] || BUN_PATH="$(command -v bun || true)"

echo "════════════════════════════════════════════════════════════"
echo "  Nexley iCloud Bridge — installer ($MODE)"
echo "  Client: $CLIENT_SLUG"
echo "  Install dir: $INSTALL_DIR"
echo "  Bridge port: $BRIDGE_PORT"
echo "════════════════════════════════════════════════════════════"

# ─── Step 1: Bun ─────────────────────────────────────────────────────────────
if [ -z "$BUN_PATH" ] || [ ! -x "$BUN_PATH" ]; then
    echo "[1/9] Installing Bun…"
    if ! curl -fsSL https://bun.sh/install | bash; then
        cat >&2 <<'BUN_FAIL'
❌ Bun install via curl|bash failed.

Recovery options (try in order):
  1. brew install oven-sh/bun/bun
  2. Download from https://bun.sh/installer (engineer-driven .pkg)
  3. If managed Mac with software restrictions: ask us about the Mac mini SKU.
BUN_FAIL
        exit 1
    fi
    BUN_PATH="$HOME/.bun/bin/bun"
    [ -x "$BUN_PATH" ] || { echo "❌ Bun install completed but binary missing." >&2; exit 1; }
    xattr -d com.apple.quarantine "$BUN_PATH" 2>/dev/null || true
fi
echo "[1/9] ✓ Bun: $($BUN_PATH --version)"

# ─── Step 2: Tailscale ──────────────────────────────────────────────────────
TS_BIN=""
if command -v tailscale >/dev/null 2>&1; then
    TS_BIN="$(command -v tailscale)"
elif [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then
    TS_BIN="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
elif command -v brew >/dev/null 2>&1; then
    echo "[2/9] Installing Tailscale via Homebrew…"
    brew install --cask tailscale --no-quarantine 2>&1 | tail -5
    open -a Tailscale 2>/dev/null || true
    sleep 3
    TS_BIN="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
else
    cat >&2 <<EOF
[2/9] ❌ Tailscale not found AND Homebrew not installed.

  Install Tailscale manually: https://tailscale.com/download/macos
  Then re-run this script.
EOF
    exit 1
fi

# Symlink tailscale into PATH for this session
if ! command -v tailscale >/dev/null 2>&1; then
    export PATH="/Applications/Tailscale.app/Contents/MacOS:$PATH"
fi

# Pre-flight: detect existing tailnet membership (don't silently --reset)
TS_STATUS_OUT=$(tailscale status --json 2>/dev/null || echo "{}")
TS_BACKEND_STATE=$(echo "$TS_STATUS_OUT" | grep -oE '"BackendState":[[:space:]]*"[^"]+"' | head -1 | sed -E 's/.*:[[:space:]]*"([^"]+)".*/\1/')

if [ "$TS_BACKEND_STATE" = "Running" ]; then
    EXISTING_DNSNAME=$(echo "$TS_STATUS_OUT" | grep -oE '"DNSName":[[:space:]]*"[^"]+"' | head -1 | sed -E 's/.*:[[:space:]]*"([^"]+)".*/\1/' | sed 's/\.$//')
    EXISTING_LOGIN=$(echo "$TS_STATUS_OUT" | grep -oE '"LoginName":[[:space:]]*"[^"]+"' | head -1 | sed -E 's/.*:[[:space:]]*"([^"]+)".*/\1/')
    cat >&2 <<EXISTING_TS
⚠️  This Mac is ALREADY signed into a Tailscale tailnet:
       hostname: $EXISTING_DNSNAME
       login:    $EXISTING_LOGIN

If this is your personal/work tailnet, signing out and onto Nexley's tailnet
will break your existing connections. STOP and decide:

  - Keep your tailnet → cancel install, contact setup@nexley.co.uk
    so we can add the bridge to your tailnet via Tailscale ACL share.
  - Switch to Nexley's → re-run with NEXLEY_TS_FORCE_RESET=1

Aborting to protect your existing tailnet membership.
EXISTING_TS
    if [ "${NEXLEY_TS_FORCE_RESET:-0}" != "1" ]; then exit 1; fi
    echo "[2/9] NEXLEY_TS_FORCE_RESET=1 — proceeding with destructive --reset"
fi

if [ "$TS_BACKEND_STATE" != "Running" ]; then
    echo "[2/9] Bringing Tailscale up (Tailscale GUI auth dialog will appear — click Continue)…"
    if ! tailscale up --authkey="$NEXLEY_TS_AUTHKEY" --accept-routes=false 2>&1 | tail -3; then
        cat >&2 <<EOF
❌ tailscale up failed. Common causes:
   - auth-key already consumed (single-use)
   - tag:client-bridge not in tailnet ACL
   - System Extension approval was dismissed (System Settings → Privacy & Security)
EOF
        exit 1
    fi
fi

# Wait for tailnet IPv4 (up to 30s)
TAILNET_IP=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
    TAILNET_IP=$(tailscale ip -4 2>/dev/null | head -1 | tr -d '\n' || true)
    if echo "$TAILNET_IP" | grep -qE '^100\.[0-9]+\.[0-9]+\.[0-9]+$'; then break; fi
    sleep 3
done
if ! echo "$TAILNET_IP" | grep -qE '^100\.[0-9]+\.[0-9]+\.[0-9]+$'; then
    echo "❌ Tailscale didn't return a 100.x IPv4 within 30s." >&2
    tailscale status 2>&1 | head -5 >&2
    exit 1
fi

TAILNET_HOSTNAME=$(tailscale status --json 2>/dev/null | grep -oE '"DNSName":[[:space:]]*"[^"]+"' | head -1 | sed -E 's/.*:[[:space:]]*"([^"]+)".*/\1/' | sed 's/\.$//')
[ -n "$TAILNET_HOSTNAME" ] || { echo "❌ Could not extract tailnet hostname." >&2; exit 1; }
echo "[2/9] ✓ Tailnet: $TAILNET_HOSTNAME ($TAILNET_IP)"

# ─── Step 3: Force Optimise Mac Storage OFF (DA-required) ───────────────────
echo "[3/9] Forcing iCloud Drive Optimise Storage OFF…"
defaults write com.apple.bird OptimizeStorage -bool false 2>/dev/null || true
killall bird 2>/dev/null || true
echo "[3/9] ✓ Optimise Storage forced OFF"

# ─── Step 4: Stage bridge files ─────────────────────────────────────────────
echo "[4/9] Staging bridge files at $INSTALL_DIR…"
mkdir -p "$INSTALL_DIR"
chmod 700 "$INSTALL_DIR"
for f in server.ts package.json; do
    if [ ! -f "$INSTALL_DIR/$f" ]; then
        echo "        fetching $f from $BRIDGE_BASE_URL/$f"
        curl -fsSL "$BRIDGE_BASE_URL/$f" -o "$INSTALL_DIR/$f.tmp"
        mv -f "$INSTALL_DIR/$f.tmp" "$INSTALL_DIR/$f"
    fi
done
echo "[4/9] ✓ Files staged"

# ─── Step 5: Write secret atomically ────────────────────────────────────────
echo "[5/9] Writing HMAC secret…"
SECRET_TMP="$INSTALL_DIR/secret.tmp.$$"
printf '%s' "$HMAC_SECRET" > "$SECRET_TMP"
chmod 600 "$SECRET_TMP"
mv -f "$SECRET_TMP" "$INSTALL_DIR/secret"
SECRET_LAST4="${HMAC_SECRET: -4}"
unset HMAC_SECRET NEXLEY_HMAC_SECRET
echo "[5/9] ✓ Secret written (last-4: …$SECRET_LAST4)"

# ─── Step 6: Bun install ─────────────────────────────────────────────────────
echo "[6/9] Installing bun deps…"
cd "$INSTALL_DIR"
"$BUN_PATH" install --silent 2>&1 | tail -3
echo "[6/9] ✓ Bun deps installed"

# ─── Step 7: LaunchAgent ─────────────────────────────────────────────────────
echo "[7/9] Rendering launchd agent…"

cat > "$INSTALL_DIR/run.sh" <<EOF
#!/bin/bash
SECRET_FILE="$INSTALL_DIR/secret"
if [ ! -s "\$SECRET_FILE" ]; then
    echo "[bridge] FATAL: secret file missing or empty at \$SECRET_FILE" >&2
    sleep 60
    exit 1
fi
export NEXLEY_BRIDGE_SECRET_FILE="\$SECRET_FILE"
exec "$BUN_PATH" run "$INSTALL_DIR/server.ts"
EOF
chmod 755 "$INSTALL_DIR/run.sh"

PLIST_DST="$HOME/Library/LaunchAgents/com.nexley.bridge.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST_DST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.nexley.bridge</string>
    <key>ProgramArguments</key><array><string>$INSTALL_DIR/run.sh</string></array>
    <key>WorkingDirectory</key><string>$INSTALL_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key><string>$HOME</string>
        <key>NEXLEY_BRIDGE_PORT</key><string>$BRIDGE_PORT</string>
        <key>NEXLEY_BRIDGE_HOST</key><string>$TAILNET_IP</string>
        <key>NEXLEY_CLIENT_SLUG</key><string>$CLIENT_SLUG</string>
        <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
    <key>KeepAlive</key><true/>
    <key>RunAtLoad</key><true/>
    <key>ThrottleInterval</key><integer>10</integer>
    <key>StandardOutPath</key><string>$INSTALL_DIR/bridge.log</string>
    <key>StandardErrorPath</key><string>$INSTALL_DIR/bridge.err.log</string>
    <key>ProcessType</key><string>Background</string>
</dict>
</plist>
EOF
plutil -lint "$PLIST_DST" >/dev/null 2>&1 || { echo "❌ Generated plist invalid" >&2; exit 1; }
launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load "$PLIST_DST"
echo "[7/9] ✓ launchd agent loaded"

# ─── Step 8: TCC prefetch helper ────────────────────────────────────────────
echo "[8/9] Dropping tcc-prefetch.sh…"
cat > "$INSTALL_DIR/tcc-prefetch.sh" <<PREFETCH_EOF
#!/bin/bash
# Triggers macOS TCC consent dialogs for iCloud Drive (and optionally Photos/Notes).
set -euo pipefail
DO_DRIVE=1; DO_PHOTOS=0; DO_NOTES=0
for arg in "\$@"; do
    case "\$arg" in
        --drive) DO_DRIVE=1 ;;
        --photos) DO_PHOTOS=1 ;;
        --notes) DO_NOTES=1 ;;
        --all) DO_DRIVE=1; DO_PHOTOS=1; DO_NOTES=1 ;;
        *) echo "Unknown flag: \$arg" >&2; exit 1 ;;
    esac
done
BUN_PATH="$BUN_PATH"
ICLOUD="\$HOME/Library/Mobile Documents/com~apple~CloudDocs"

if [ "\$DO_DRIVE" = "1" ]; then
    echo "[prefetch] Reading 1 entry from iCloud Drive via bun (TCC grant attaches to bridge process)…"
    if [ ! -d "\$ICLOUD" ]; then
        echo "❌ iCloud Drive not present at \$ICLOUD"
        echo "   System Settings → Apple Account → iCloud → iCloud Drive → ON"
        exit 1
    fi
    ICLOUD_DIR="\$ICLOUD" "\$BUN_PATH" -e 'try { const fs=require("fs"); const e=fs.readdirSync(process.env.ICLOUD_DIR); console.log("read",e.length,"entries"); } catch(e) { console.error(e.message); process.exit(1); }' || \
        echo "[prefetch] Drive read failed — customer may have clicked Don't Allow."
fi

if [ "\$DO_PHOTOS" = "1" ]; then
    osascript <<'OSA' || true
tell application "Photos"
    activate
    delay 1
    count of media items
end tell
OSA
fi

if [ "\$DO_NOTES" = "1" ]; then
    osascript <<'OSA' || true
tell application "Notes"
    activate
    delay 1
    count of notes
end tell
OSA
fi

echo "[prefetch] Done."
PREFETCH_EOF
chmod 755 "$INSTALL_DIR/tcc-prefetch.sh"
echo "[8/9] ✓ tcc-prefetch.sh installed"

# ─── Step 9: Verify bridge healthy + status:connected ───────────────────────
echo "[9/9] Verifying bridge…"
HEALTH_BODY=""
HEALTH_OK=0
for _ in 1 2 3 4 5 6; do
    sleep 2
    if HEALTH_BODY=$(curl -fsS "http://$TAILNET_IP:$BRIDGE_PORT/health" 2>/dev/null); then
        HEALTH_OK=1; break
    fi
done
if [ "$HEALTH_OK" != "1" ]; then
    echo "❌ Bridge didn't respond on http://$TAILNET_IP:$BRIDGE_PORT/health within 12s" >&2
    tail -30 "$INSTALL_DIR/bridge.err.log" 2>/dev/null || true
    exit 1
fi

STATUS=$(echo "$HEALTH_BODY" | grep -oE '"status":[[:space:]]*"[^"]+"' | head -1 | sed -E 's/.*:[[:space:]]*"([^"]+)".*/\1/')
case "$STATUS" in
    connected)
        echo "[9/9] ✓ Bridge healthy: status=connected"
        ;;
    icloud_not_ready)
        echo "[9/9] ⚠ Bridge UP but iCloud not ready (status=$STATUS)" >&2
        echo "       This is OK if iCloud is still syncing — you can save in dashboard with 'Save anyway'." >&2
        echo "       Or sign Mac into iCloud first: System Settings → Apple Account → iCloud → iCloud Drive → ON" >&2
        ;;
    *)
        echo "[9/9] ⚠ Unexpected status: $STATUS" >&2
        echo "       Body: $HEALTH_BODY" >&2
        ;;
esac

# ─── Done ───────────────────────────────────────────────────────────────────
cat <<EOF

════════════════════════════════════════════════════════════
  ✅ Bridge installed
════════════════════════════════════════════════════════════

NEXT — Paste this into the dashboard form:

    Bridge URL:  http://$TAILNET_HOSTNAME:$BRIDGE_PORT

    (the HMAC secret is already in the dashboard — you generated it there)

THEN — Grant iCloud Drive access (1 macOS prompt):

    ~/.nexley-bridge/tcc-prefetch.sh --drive

THEN — Click "Test connection" then "Save & connect" in the dashboard.

LOGS:    tail -f $INSTALL_DIR/bridge.err.log
STOP:    launchctl unload $PLIST_DST
EOF
