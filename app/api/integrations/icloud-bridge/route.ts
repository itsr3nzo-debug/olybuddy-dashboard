/**
 * iCloud Bridge — connect / disconnect.
 *
 * POST   /api/integrations/icloud-bridge
 *   Body: { bridgeUrl, hmacSecret }
 *   Probes the bridge (HMAC GET /health), encrypts the credential blob,
 *   upserts the integrations row, enqueues a push_integration_creds for
 *   the VPS watcher to materialise the local cred file.
 *
 * DELETE /api/integrations/icloud-bridge
 *   Marks the row disconnected. Watcher unlinks the cred file on next loop.
 *
 * Auth: dashboard session (owner or super_admin only).
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { encryptToken } from "@/lib/encryption";
import { probeBridge, validateBridgeUrl, validateHmacSecret } from "@/lib/integrations/icloud-bridge/probe";
import { ERROR_COPY } from "@/lib/integrations/icloud-bridge/errors";
import type { IcloudBridgeCredsBlob } from "@/lib/integrations/icloud-bridge/types";

function svc() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

async function getSession() {
  const cookieStore = await cookies();
  const s = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } },
  );
  const { data: { user } } = await s.auth.getUser();
  return {
    user,
    clientId: (user?.app_metadata?.client_id as string | undefined) ?? null,
    role: (user?.app_metadata?.role as string | undefined) ?? "owner",
  };
}

// ──────────────────────────────────────────────────────────────────────────
// GET — return current iCloud Bridge integration row (id, status, metadata)
// for this client. Does NOT return access_token_enc — that stays on the server.
// ──────────────────────────────────────────────────────────────────────────

export async function GET() {
  const { clientId } = await getSession();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = svc();
  const { data, error } = await supabase
    .from("integrations")
    .select("id, provider, status, account_email, account_name, last_synced_at, last_health_check_at, metadata, updated_at")
    .eq("client_id", clientId)
    .eq("provider", "icloud_bridge")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ integration: data ?? null });
}

// ──────────────────────────────────────────────────────────────────────────
// POST — connect bridge
// ──────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { user, clientId, role } = await getSession();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (role !== "owner" && role !== "super_admin") {
    return NextResponse.json(
      { error: "Only owners can connect integrations" },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const bridgeUrlRaw = typeof body.bridgeUrl === "string" ? body.bridgeUrl.trim() : "";
  const hmacSecret = typeof body.hmacSecret === "string" ? body.hmacSecret.trim() : "";
  const allowIcloudNotReady = body.allowIcloudNotReady === true;

  if (!bridgeUrlRaw || !hmacSecret) {
    return NextResponse.json(
      { error: "bridgeUrl and hmacSecret required" },
      { status: 400 },
    );
  }

  const v = validateBridgeUrl(bridgeUrlRaw);
  if (!v.ok) {
    return NextResponse.json(
      { error: v.reason, code: "INVALID_URL" },
      { status: 400 },
    );
  }
  if (!validateHmacSecret(hmacSecret)) {
    return NextResponse.json(
      { error: ERROR_COPY.INVALID_SECRET, code: "INVALID_SECRET" },
      { status: 400 },
    );
  }

  // Probe live before persisting. We block transport-level failures but allow
  // the customer to "connect anyway" through allowIcloudNotReady when the
  // bridge is up and the iCloud sync just hasn't settled yet — they can
  // probe again later from the status panel.
  const probe = await probeBridge(v.clean, hmacSecret);
  if (!probe.ok) {
    const transportFails = new Set(["BRIDGE_UNREACHABLE", "BAD_SIGNATURE", "TIMEOUT", "INVALID_URL", "INVALID_SECRET"]);
    if (transportFails.has(probe.code ?? "UNEXPECTED")) {
      return NextResponse.json(
        {
          error: ERROR_COPY[probe.code ?? "UNEXPECTED"],
          code: probe.code,
          health: probe.health,
        },
        { status: 400 },
      );
    }
    if (!allowIcloudNotReady) {
      return NextResponse.json(
        {
          error: ERROR_COPY[probe.code ?? "UNEXPECTED"],
          code: probe.code,
          health: probe.health,
          recoverable: true,
        },
        { status: 400 },
      );
    }
  }

  // Gate on vps_ready: if the customer's VPS isn't provisioned yet, the
  // watcher can't apply the cred and the dashboard will sit on "Applying"
  // indefinitely with no diagnostic. Better to fail loud right here.
  const supabase = svc();
  const { data: clientRow } = await supabase
    .from("clients")
    .select("vps_ready, subscription_status")
    .eq("id", clientId)
    .maybeSingle();

  if (!clientRow?.vps_ready) {
    return NextResponse.json(
      {
        error:
          "Your AI Employee VPS isn't provisioned yet. Connect iCloud after your AI Employee is fully set up — usually within a few minutes of completing onboarding.",
        code: "VPS_NOT_READY",
      },
      { status: 409 },
    );
  }

  // Encrypt + persist
  const blob: IcloudBridgeCredsBlob = { bridgeUrl: v.clean, hmacSecret };
  const encrypted = encryptToken(JSON.stringify(blob));

  const status = probe.ok ? "connected" : "degraded";
  const appleId = probe.health?.icloud?.apple_id ?? null;

  const { data: row, error } = await supabase
    .from("integrations")
    .upsert(
      {
        client_id: clientId,
        provider: "icloud_bridge",
        status,
        account_email: appleId,
        account_name: appleId ?? "iCloud Bridge",
        provider_user_id: appleId ?? "",
        access_token_enc: encrypted,
        refresh_token_enc: null,
        token_expires_at: null,
        scope: "drive,photos,notes,shortcuts",
        last_synced_at: new Date().toISOString(),
        last_health_check_at: new Date().toISOString(),
        health_failure_count: 0,
        metadata: {
          auth_mode: "compound_pat",
          bridge_url: v.clean,                  // visible (not secret)
          tailnet_hostname: new URL(v.clean).hostname,
          last_probe_status: probe.ok ? "connected" : (probe.code ?? "unknown"),
          icloud_signed_in: probe.health?.icloud?.signed_in ?? false,
          drive_dir_exists: probe.health?.icloud?.drive_dir_exists ?? false,
          bird_running: probe.health?.icloud?.bird_running ?? false,
          optimise_storage: probe.health?.icloud?.optimise_storage ?? false,
          warnings: probe.health?.warnings ?? [],
          connected_at: new Date().toISOString(),
          connected_by: user?.email ?? null,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id,provider" },
    )
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Audit + enqueue VPS push (best-effort; row already saved).
  try {
    await supabase.rpc("log_integration_event", {
      p_integration_id: row.id,
      p_client_id: clientId,
      p_provider: "icloud_bridge",
      p_event: "connected",
      p_payload: {
        bridge_url: v.clean,
        apple_id: appleId,
        probe_ok: probe.ok,
        probe_code: probe.code ?? null,
      },
      p_actor_user_id: user?.id ?? null,
    });

    await supabase.from("provisioning_queue").insert({
      client_id: clientId,
      action: "push_integration_creds",
      triggered_by: "dashboard:icloud_bridge:connect",
      meta: { provider: "icloud_bridge" },
    });
  } catch (e) {
    console.error("[icloud-bridge-connect] post-insert side effects failed:", e);
  }

  return NextResponse.json({
    ok: true,
    integration_id: row.id,
    status,
    apple_id: appleId,
    health: probe.health,
  });
}

// ──────────────────────────────────────────────────────────────────────────
// DELETE — disconnect bridge
// ──────────────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const { user, clientId, role } = await getSession();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (role !== "owner" && role !== "super_admin") {
    return NextResponse.json(
      { error: "Only owners can disconnect integrations" },
      { status: 403 },
    );
  }

  const supabase = svc();
  const { data: existing } = await supabase
    .from("integrations")
    .select("id")
    .eq("client_id", clientId)
    .eq("provider", "icloud_bridge")
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ ok: true, alreadyDisconnected: true });
  }

  // Soft-disconnect: flip status, clear cred. Watcher unlinks the file
  // when status != 'connected' on the next reconcile loop.
  const { error } = await supabase
    .from("integrations")
    .update({
      status: "disconnected",
      access_token_enc: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try {
    await supabase.rpc("log_integration_event", {
      p_integration_id: existing.id,
      p_client_id: clientId,
      p_provider: "icloud_bridge",
      p_event: "disconnected",
      p_payload: {},
      p_actor_user_id: user?.id ?? null,
    });
    await supabase.from("provisioning_queue").insert({
      client_id: clientId,
      action: "push_integration_creds",
      triggered_by: "dashboard:icloud_bridge:disconnect",
      meta: { provider: "icloud_bridge" },
    });
  } catch (e) {
    console.error("[icloud-bridge-disconnect] post-update side effects failed:", e);
  }

  return NextResponse.json({ ok: true });
}
