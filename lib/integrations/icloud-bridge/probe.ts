/**
 * Server-side probe of an iCloud Bridge: HMAC-sign GET /health, parse the
 * response, and translate transport / sync state into a ProbeErrorCode the
 * dashboard renders for the user.
 *
 * Network policy: ALLOW http (Tailscale provides transport encryption) for
 * tailnet IPs and *.ts.net hostnames. Refuse to probe arbitrary internet
 * URLs — this is a customer's home Mac, not a public service.
 */

import { bridgeSign } from "./sign";
import type { IcloudBridgeHealth, ProbeResult } from "./types";

const PROBE_TIMEOUT_MS = 8_000;
// Tailscale CGNAT range is 100.64.0.0/10 — second octet 64-127 only.
// The wider 100.0.0.0/8 includes carrier-CGN ranges (100.0.x, 100.4.x,
// 100.128+, etc.) which aren't tailnet and would let a malicious tenant
// trick the dashboard into probing arbitrary internal infrastructure.
const TAILNET_IP_RE = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/;

export function validateBridgeUrl(url: string): { ok: true; clean: string } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "Not a valid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "URL must start with http:// or https://" };
  }
  if (parsed.search || parsed.hash) {
    return { ok: false, reason: "URL must not contain query string or fragment" };
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  if (path !== "") {
    return { ok: false, reason: "URL must be host:port only — no path" };
  }
  // Allow only tailnet IPs (100.x.y.z) or *.ts.net hostnames.
  const host = parsed.hostname;
  const isTailnetIp = TAILNET_IP_RE.test(host);
  const isTailnetDns = /\.ts\.net$/i.test(host);
  if (!isTailnetIp && !isTailnetDns) {
    return {
      ok: false,
      reason:
        "Bridge URL must be on Tailscale — either a 100.x.y.z IP or a *.ts.net hostname. Public internet hosts aren't allowed.",
    };
  }
  return { ok: true, clean: `${parsed.protocol}//${parsed.host}` };
}

export function validateHmacSecret(secret: string): boolean {
  return /^[0-9a-f]{64}$/i.test(secret.trim());
}

/**
 * HMAC-signed GET /health. Returns parsed body on 200, error code otherwise.
 * Never throws — every failure mode maps to a ProbeErrorCode.
 */
export async function probeBridge(bridgeUrl: string, hmacSecret: string): Promise<ProbeResult> {
  const v = validateBridgeUrl(bridgeUrl);
  if (!v.ok) return { ok: false, code: "INVALID_URL", message: v.reason };
  if (!validateHmacSecret(hmacSecret)) {
    return { ok: false, code: "INVALID_SECRET", message: "Secret must be 64 hex characters" };
  }

  // ─── 1. Probe a SIGNED-ONLY endpoint to verify the HMAC secret. ────────
  // /health is intentionally two-tier (unsigned returns minimal state, signed
  // returns full incl. apple_id). If we only hit /health, a wrong secret
  // returns 200 + minimal body — silently passes our probe. So we probe
  // /files?path=/ first: any sig mismatch returns 401 unambiguously.
  // ───────────────────────────────────────────────────────────────────────
  const filesUrl = `${v.clean}/files?path=%2F`;
  const filesSig = bridgeSign(hmacSecret, "GET", filesUrl, "");

  let filesRes: Response;
  try {
    filesRes = await fetch(filesUrl, {
      method: "GET",
      headers: { "X-Nexley-Signature": filesSig },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("aborted") || msg.includes("timeout")) {
      return { ok: false, code: "TIMEOUT", message: msg };
    }
    return { ok: false, code: "BRIDGE_UNREACHABLE", message: msg };
  }

  if (filesRes.status === 401) return { ok: false, code: "BAD_SIGNATURE" };

  // 404/4xx/5xx on /files is a real failure — bridge up but iCloud Drive
  // not present (likely not signed in OR drive folder not yet created).
  // Don't bail yet — fall through to /health to surface the specific cause.

  // ─── 2. Probe signed /health for richer state (apple_id, warnings, etc.) ──
  const healthUrl = `${v.clean}/health`;
  const healthSig = bridgeSign(hmacSecret, "GET", healthUrl, "");

  let healthRes: Response;
  try {
    healthRes = await fetch(healthUrl, {
      method: "GET",
      headers: { "X-Nexley-Signature": healthSig },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("aborted") || msg.includes("timeout")) {
      return { ok: false, code: "TIMEOUT", message: msg };
    }
    return { ok: false, code: "BRIDGE_UNREACHABLE", message: msg };
  }
  if (!healthRes.ok) {
    return {
      ok: false,
      code: "UNEXPECTED",
      message: `Bridge /health returned HTTP ${healthRes.status}`,
    };
  }

  let body: IcloudBridgeHealth;
  try {
    body = (await healthRes.json()) as IcloudBridgeHealth;
  } catch {
    return { ok: false, code: "UNEXPECTED", message: "Bridge response not JSON" };
  }

  // Sanity check: the SIGNED /health response includes apple_id when iCloud is
  // signed in. If signed_in=true but apple_id is missing, our /health request
  // wasn't actually authenticated (bridge bug or signature divergence).
  if (body.icloud?.signed_in === true && !body.icloud.apple_id) {
    return {
      ok: false,
      code: "BAD_SIGNATURE",
      message: "Bridge accepted /files but /health didn't return apple_id — signature path divergence",
      health: body,
    };
  }

  // Surface specific iCloud sync issues over the umbrella "icloud_not_ready"
  if (body.icloud) {
    if (body.icloud.signed_in === false) {
      return { ok: false, code: "ICLOUD_NOT_SIGNED_IN", health: body };
    }
    if (body.icloud.optimise_storage === true) {
      return { ok: false, code: "OPTIMISE_STORAGE_ON", health: body };
    }
    if (body.icloud.bird_running === false) {
      return { ok: false, code: "BIRD_NOT_RUNNING", health: body };
    }
  }

  // /files might have failed even though /health says everything's fine
  // (e.g. iCloud Drive folder doesn't exist yet, but signed in). Surface that.
  if (!filesRes.ok) {
    return {
      ok: false,
      code: "ICLOUD_NOT_SIGNED_IN",
      health: body,
      message: `Bridge auth OK but /files failed (HTTP ${filesRes.status}) — iCloud Drive may not be ready.`,
    };
  }

  return { ok: true, health: body };
}
