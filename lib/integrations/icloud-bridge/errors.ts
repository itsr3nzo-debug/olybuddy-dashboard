import type { ProbeErrorCode } from "./types";

/**
 * Maps probe error codes to user-facing copy. Keep these short and actionable —
 * the customer reads them and decides whether to fix on their Mac or call support.
 */
export const ERROR_COPY: Record<ProbeErrorCode, string> = {
  BRIDGE_UNREACHABLE:
    "We can't reach the bridge. On the Mac, check that Tailscale is signed in (`tailscale status`) and the bridge service is running (`launchctl list | grep com.nexley.bridge`).",
  BAD_SIGNATURE:
    "The HMAC secret in this form doesn't match what's on the bridge. Re-run the install on the Mac with the same secret, or use the Generate button and re-install.",
  ICLOUD_NOT_SIGNED_IN:
    "The bridge is up but the Mac isn't signed into iCloud. On the Mac: System Settings → Apple Account → iCloud → iCloud Drive → On.",
  OPTIMISE_STORAGE_ON:
    "iCloud Drive is in 'Optimise Mac Storage' mode — files appear as placeholders. The installer disables this; if it's back on, run on the Mac: `defaults write com.apple.bird OptimizeStorage -bool false && killall bird`.",
  BIRD_NOT_RUNNING:
    "Apple's iCloud sync daemon (`bird`) isn't running. Common causes: low disk space (<5%), Files-and-Folders TCC denied for bun, or iCloud signed out and back in. Try `killall bird` then wait 30s; if that fails, restart the Mac.",
  INVALID_URL:
    "Bridge URL must look like http://your-mac.tailXXX.ts.net:7878 or http://100.x.y.z:7878 — no path or trailing slash.",
  INVALID_SECRET:
    "HMAC secret must be 32 bytes (64 hex characters). Use the Generate button to create a fresh one.",
  TIMEOUT:
    "The bridge took too long to respond. The Mac may be asleep or on a slow link. Wake it and try again.",
  UNEXPECTED:
    "Something unexpected went wrong. Check the bridge log on the Mac: `tail -50 ~/.nexley-bridge/bridge.err.log`.",
};
