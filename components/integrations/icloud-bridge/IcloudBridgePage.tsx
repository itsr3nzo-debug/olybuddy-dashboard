"use client";

/**
 * iCloud Bridge — customer-facing setup wizard.
 *
 * Two install paths exposed:
 *  1. Concierge (recommended for non-technical customers): book a 30-min
 *     Zoom call, an engineer drives the install end-to-end.
 *  2. Self-serve (technical customers): generate a fresh HMAC secret,
 *     copy a curl|bash command, run it on the Mac, paste the bridge URL
 *     it prints back, click Connect.
 *
 * Both end at the same compound-PAT-style POST to /api/integrations/icloud-bridge.
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Info, AlertTriangle, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BannerShell } from "@/components/ui/banner";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface Integration {
  id: string;
  status: "connected" | "degraded" | "disconnected" | "pending";
  account_email: string | null;
  account_name: string | null;
  metadata: Record<string, unknown>;
}

type ProbeResponse =
  | { ok: true; health: HealthShape }
  | { ok: false; code: string; message: string; health?: HealthShape };

interface HealthShape {
  status?: string;
  bridge?: { up: boolean; version: string; port: number };
  icloud?: {
    signed_in: boolean;
    apple_id?: string;
    drive_dir_exists: boolean;
    bird_running: boolean;
    optimise_storage: boolean;
  };
  warnings?: string[];
}

const CONCIERGE_BOOKING_URL =
  process.env.NEXT_PUBLIC_NEXLEY_BOOKING_URL ||
  "mailto:setup@nexley.co.uk?subject=iCloud%20Bridge%20setup%20call";

export default function IcloudBridgePage() {
  const [loading, setLoading] = useState(true);
  const [existing, setExisting] = useState<Integration | null>(null);
  const [bridgeUrl, setBridgeUrl] = useState("");
  const [hmacSecret, setHmacSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [installKey, setInstallKey] = useState("");
  const [probeResult, setProbeResult] = useState<ProbeResponse | null>(null);
  const [probing, setProbing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [path, setPath] = useState<"choose" | "concierge" | "self-serve">("choose");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/integrations/icloud-bridge", {
        credentials: "same-origin",
      });
      if (res.ok) {
        const data = await res.json();
        setExisting(data.integration ?? null);
      }
    } catch (e) {
      console.warn("[icloud-bridge] fetch existing failed", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  function generateSecret() {
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    const hex = Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
    setHmacSecret(hex);
    setShowSecret(true);
    setProbeResult(null);
  }

  async function handleProbe() {
    if (!bridgeUrl || !hmacSecret) return;
    setProbing(true);
    setProbeResult(null);
    try {
      const res = await fetch("/api/integrations/icloud-bridge/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ bridgeUrl, hmacSecret }),
      });
      const body = (await res.json()) as ProbeResponse;
      setProbeResult(body);
    } catch (e) {
      setProbeResult({
        ok: false,
        code: "UNEXPECTED",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setProbing(false);
    }
  }

  async function handleSave(allowIcloudNotReady = false) {
    if (!bridgeUrl || !hmacSecret) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/integrations/icloud-bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ bridgeUrl, hmacSecret, allowIcloudNotReady }),
      });
      const body = await res.json();
      if (!res.ok) {
        setSaveError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setBridgeUrl("");
      setHmacSecret("");
      setProbeResult(null);
      setPath("choose");
      await refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect iCloud? Your AI Employee will lose access to iCloud Drive, Photos, Notes, and Shortcuts.")) return;
    setSaving(true);
    try {
      await fetch("/api/integrations/icloud-bridge", {
        method: "DELETE",
        credentials: "same-origin",
      });
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <Header />
        <Card><p className="text-sm text-muted-foreground">Loading…</p></Card>
      </div>
    );
  }

  if (existing && existing.status === "connected") {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <Header />
        <ConnectedStatusPanel
          row={existing}
          onDisconnect={handleDisconnect}
          onRefresh={refresh}
          saving={saving}
        />
      </div>
    );
  }

  if (existing && existing.status === "degraded") {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <Header />
        <BannerShell intent="warning" icon={AlertTriangle}>
          Your iCloud Bridge is connected but the last health check failed. The
          AI Employee may not be able to read iCloud right now. Use the buttons
          below to retry or reconnect.
        </BannerShell>
        <ConnectedStatusPanel
          row={existing}
          onDisconnect={handleDisconnect}
          onRefresh={refresh}
          saving={saving}
        />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <Header />

      {path === "choose" && (
        <>
          <BannerShell intent="info" icon={Info}>
            iCloud needs a Mac in your office (any Mac signed into your iCloud
            account). The bridge runs as a small background service — no monthly
            cloud cost, and your iCloud password never leaves the Mac.
          </BannerShell>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-medium">Book a setup call</h2>
                  <Badge label="Recommended" variant="brand" />
                </div>
                <p className="text-sm text-muted-foreground">
                  A Nexley engineer joins a 30-minute Zoom call, takes remote
                  control of your Mac, and installs the bridge end-to-end.
                </p>
                <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
                  <li>You watch — engineer drives the keyboard</li>
                  <li>Total time: ~30 min</li>
                  <li>Best if you're not comfortable in Terminal</li>
                </ul>
                <div className="flex gap-2 mt-2">
                  <a href={CONCIERGE_BOOKING_URL} target="_blank" rel="noopener noreferrer">
                    <Button>Book setup call</Button>
                  </a>
                  <Button variant="secondary" onClick={() => setPath("concierge")}>
                    More info
                  </Button>
                </div>
              </div>
            </Card>

            <Card>
              <div className="flex flex-col gap-3">
                <h2 className="text-lg font-medium">Install it yourself</h2>
                <p className="text-sm text-muted-foreground">
                  Best for technical customers. You'll generate a secret here,
                  run an installer on your Mac, paste the bridge URL back. About
                  10 macOS prompts (Tailscale, iCloud, file access).
                </p>
                <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
                  <li>You drive — no engineer call</li>
                  <li>Total time: ~15 min if you're comfortable in Terminal</li>
                  <li>Free</li>
                </ul>
                <div className="flex gap-2 mt-2">
                  <Button onClick={() => setPath("self-serve")}>Start self-serve install</Button>
                </div>
              </div>
            </Card>
          </div>

          <Card>
            <div className="flex flex-col gap-2 text-sm">
              <h3 className="font-medium">Don't have a Mac?</h3>
              <p className="text-muted-foreground">
                Email us and we'll explore options — most customers re-purpose any
                spare Mac that's signed into iCloud (it doesn't need to be new or fast).
              </p>
              <div>
                <a href="mailto:setup@nexley.co.uk?subject=iCloud%20Bridge%20%E2%80%94%20no%20Mac">
                  <Button variant="secondary">Email us</Button>
                </a>
              </div>
            </div>
          </Card>
        </>
      )}

      {path === "concierge" && (
        <ConcierageInfo onBack={() => setPath("choose")} bookingUrl={CONCIERGE_BOOKING_URL} />
      )}

      {path === "self-serve" && (
        <SelfServeWizard
          bridgeUrl={bridgeUrl}
          setBridgeUrl={setBridgeUrl}
          hmacSecret={hmacSecret}
          setHmacSecret={setHmacSecret}
          showSecret={showSecret}
          setShowSecret={setShowSecret}
          generateSecret={generateSecret}
          installKey={installKey}
          setInstallKey={setInstallKey}
          probeResult={probeResult}
          probing={probing}
          handleProbe={handleProbe}
          handleSave={handleSave}
          saving={saving}
          saveError={saveError}
          onBack={() => setPath("choose")}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
function Header() {
  return (
    <div>
      <Link href="/integrations" className="text-sm text-muted-foreground hover:text-foreground">
        ← All integrations
      </Link>
      <h1 className="text-2xl font-semibold mt-2">iCloud</h1>
      <p className="text-sm text-muted-foreground mt-1">
        Let your AI Employee read your iCloud Drive, Photos, Notes, and run Apple Shortcuts.
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
function ConnectedStatusPanel({
  row,
  onDisconnect,
  onRefresh,
  saving,
}: {
  row: Integration;
  onDisconnect: () => void;
  onRefresh: () => void;
  saving: boolean;
}) {
  const m = row.metadata as Record<string, unknown>;
  const bridgeUrl = (m?.bridge_url as string) ?? "—";
  const tailnetHostname = (m?.tailnet_hostname as string) ?? "—";
  const appleId = row.account_email ?? "—";
  const optimiseStorage = m?.optimise_storage === true;
  const driveExists = m?.drive_dir_exists === true;
  const birdRunning = m?.bird_running === true;

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
            <span className="font-medium">Connected</span>
            {row.status === "degraded" && <Badge label="Degraded" variant="warning" />}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onRefresh} disabled={saving}>
              Refresh
            </Button>
            <Button variant="destructive" onClick={onDisconnect} disabled={saving}>
              Disconnect
            </Button>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Apple ID</dt>
          <dd>{appleId}</dd>
          <dt className="text-muted-foreground">Bridge URL</dt>
          <dd className="font-mono text-xs">{bridgeUrl}</dd>
          <dt className="text-muted-foreground">Tailnet hostname</dt>
          <dd className="font-mono text-xs">{tailnetHostname}</dd>
          <dt className="text-muted-foreground">iCloud Drive</dt>
          <dd>{driveExists ? "✓ folder present" : "✗ not found"}</dd>
          <dt className="text-muted-foreground">bird (sync daemon)</dt>
          <dd>{birdRunning ? "✓ running" : "✗ stopped"}</dd>
          <dt className="text-muted-foreground">Optimise Mac Storage</dt>
          <dd>
            {optimiseStorage ? (
              <span className="text-amber-600 dark:text-amber-400">on (warning)</span>
            ) : (
              "off"
            )}
          </dd>
        </dl>
      </div>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
function ConcierageInfo({ onBack, bookingUrl }: { onBack: () => void; bookingUrl: string }) {
  return (
    <Card>
      <div className="flex flex-col gap-3">
        <Button variant="secondary" onClick={onBack} className="w-fit">← Back</Button>
        <h2 className="text-lg font-medium">What happens on the call</h2>
        <ol className="text-sm text-muted-foreground space-y-2 ml-4 list-decimal">
          <li>You join Zoom, share screen, and approve our remote-control request (~3 macOS prompts if you've never used Zoom screen-share before).</li>
          <li>We verify your Mac is signed into iCloud and iCloud Drive is enabled. If not, we'll walk you through it — your Apple ID password stays on your end (we use macOS's native sign-in, no credentials cross the wire).</li>
          <li>We install Tailscale + the bridge service. You click Allow on 1-2 macOS prompts.</li>
          <li>We grant the bridge access to read your iCloud Drive (one Files-and-Folders dialog).</li>
          <li>End-to-end test: send "list my iCloud Documents" to your AI Employee on WhatsApp; the agent replies with your real filenames.</li>
        </ol>
        <p className="text-sm text-muted-foreground">
          Setup fee may apply depending on your plan — we'll confirm pricing
          when you book.
        </p>
        <div className="flex gap-2">
          <a href={bookingUrl} target="_blank" rel="noopener noreferrer">
            <Button>Book setup call</Button>
          </a>
          <Button variant="secondary" onClick={onBack}>Back</Button>
        </div>
      </div>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
function SelfServeWizard({
  bridgeUrl,
  setBridgeUrl,
  hmacSecret,
  setHmacSecret,
  showSecret,
  setShowSecret,
  generateSecret,
  installKey,
  setInstallKey,
  probeResult,
  probing,
  handleProbe,
  handleSave,
  saving,
  saveError,
  onBack,
}: {
  bridgeUrl: string;
  setBridgeUrl: (v: string) => void;
  hmacSecret: string;
  setHmacSecret: (v: string) => void;
  showSecret: boolean;
  setShowSecret: (v: boolean) => void;
  generateSecret: () => void;
  installKey: string;
  setInstallKey: (v: string) => void;
  probeResult: ProbeResponse | null;
  probing: boolean;
  handleProbe: () => void;
  handleSave: (allowIcloudNotReady?: boolean) => void;
  saving: boolean;
  saveError: string | null;
  onBack: () => void;
}) {
  // The install command renders ONLY when both an HMAC secret AND the
  // emailed install key are present. Otherwise we'd surface a literal
  // placeholder string the customer would paste verbatim — DA-flagged as
  // a 100% fail-rate UX. Bash test confirmed `<...>` inside double-quotes
  // is a literal char (no redirection), but the string still propagates
  // to `tailscale up --authkey="<...>"` and Tailscale errors out cryptically.
  const installCommand =
    hmacSecret && installKey
      ? `cat > /tmp/nexley-secret.txt <<'EOF'
${hmacSecret}
EOF
chmod 600 /tmp/nexley-secret.txt
export NEXLEY_TS_AUTHKEY=${JSON.stringify(installKey)}
bash <(curl -fsSL https://nexley.co.uk/install/icloud-bridge.sh) self-serve --secret-file /tmp/nexley-secret.txt
rm -f /tmp/nexley-secret.txt`
      : null;

  function copyInstallCommand() {
    if (!installCommand) return;
    navigator.clipboard?.writeText(installCommand).catch(() => {});
  }

  const recoverable =
    probeResult &&
    !probeResult.ok &&
    (probeResult.code === "ICLOUD_NOT_SIGNED_IN" ||
      probeResult.code === "BIRD_NOT_RUNNING" ||
      probeResult.code === "OPTIMISE_STORAGE_ON");

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <Button variant="secondary" onClick={onBack} className="w-fit">← Back</Button>

        <BannerShell intent="warning" icon={AlertTriangle}>
          <strong>Self-serve still needs one email step.</strong> Until our automated
          Tailscale provisioning ships, you'll need to email setup@nexley.co.uk to
          receive a one-time install key — we typically respond within one business day.
          (Or book a setup call and skip this entirely.)
        </BannerShell>

        {/* Step 1 — generate secret */}
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">Step 1 — Generate a secret</h3>
          <p className="text-sm text-muted-foreground">
            We'll create a 32-byte HMAC secret. Your Mac uses this to authenticate
            with our servers. It's only shown once — keep it in your password manager
            if you want to re-install later.
          </p>
          <div className="flex gap-2 items-center">
            <Button onClick={generateSecret} variant={hmacSecret ? "secondary" : "default"}>
              {hmacSecret ? "Regenerate" : "Generate secret"}
            </Button>
            {hmacSecret && (
              <Button variant="secondary" onClick={() => setShowSecret(!showSecret)}>
                {showSecret ? "Hide" : "Show"}
              </Button>
            )}
          </div>
          {hmacSecret && (
            <div className="font-mono text-xs bg-muted/50 rounded p-2 break-all border border-border">
              {showSecret ? hmacSecret : hmacSecret.replace(/./g, "•")}
            </div>
          )}
        </div>

        {/* Step 2 — paste install key */}
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">Step 2 — Paste your install key</h3>
          <p className="text-sm text-muted-foreground">
            Email <a href="mailto:setup@nexley.co.uk?subject=iCloud%20Bridge%20install%20key" className="underline">setup@nexley.co.uk</a> with the subject{" "}
            <span className="font-mono">iCloud Bridge install key</span> and your account email.
            We'll reply with a one-time install key (valid 1 hour). Paste it here.
          </p>
          <Input
            value={installKey}
            onChange={(e) => setInstallKey(e.target.value)}
            placeholder="tskey-auth-..."
            className="font-mono text-sm"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">
            (We're working on automating this step. Until our Tailscale provisioning
            ships, the install key is issued manually.)
          </p>
        </div>

        {/* Step 3 — run installer */}
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">Step 3 — Run the installer on your Mac</h3>
          {!installCommand && (
            <BannerShell intent="info" icon={Info}>
              Generate a secret in Step 1 and paste your install key in Step 2 — the
              install command will appear here once both are filled in.
            </BannerShell>
          )}
          {installCommand && (
            <>
              <p className="text-sm text-muted-foreground">
                Open Terminal on the Mac that's signed into iCloud, paste this command,
                and press Enter. You'll see ~5 macOS prompts. The script prints a
                Bridge URL at the end — copy it to Step 4.
              </p>
              <div className="flex gap-2 mb-1">
                <Button variant="secondary" onClick={copyInstallCommand}>
                  Copy command
                </Button>
              </div>
              <pre className="font-mono text-xs bg-muted/50 rounded p-3 overflow-x-auto border border-border whitespace-pre-wrap">
{installCommand}
              </pre>
              <p className="text-xs text-muted-foreground">
                <strong>Note:</strong> read the script first if you want — it's at{" "}
                <a
                  href="/install/icloud-bridge.sh"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  /install/icloud-bridge.sh
                </a>
                . We never see your iCloud password — the bridge talks to iCloud through
                macOS's own sync system.
              </p>
            </>
          )}
        </div>

        {/* Step 4 — paste back */}
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">Step 4 — Paste the Bridge URL the script printed</h3>
          <Input
            value={bridgeUrl}
            onChange={(e) => setBridgeUrl(e.target.value)}
            placeholder="http://your-mac.tailXXXX.ts.net:7878"
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Format: <code>http://&lt;tailnet-hostname&gt;:7878</code> (the script prints this at the end).
          </p>
        </div>

        {/* Step 5 — probe + save */}
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">Step 5 — Test connection + save</h3>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="secondary"
              onClick={handleProbe}
              disabled={probing || !bridgeUrl || !hmacSecret}
            >
              {probing ? "Testing…" : "Test connection"}
            </Button>
            <Button
              onClick={() => handleSave(false)}
              disabled={saving || !probeResult?.ok}
            >
              {saving ? "Saving…" : "Save & connect"}
            </Button>
            {recoverable && (
              <Button
                variant="secondary"
                onClick={() => handleSave(true)}
                disabled={saving}
              >
                Save anyway (fix iCloud later)
              </Button>
            )}
          </div>

          {probeResult && (
            <div className="mt-2">
              {probeResult.ok ? (
                <BannerShell intent="success" icon={Info}>
                  <strong>Connected!</strong>
                  {probeResult.health?.icloud?.apple_id && (
                    <> Bridge is talking to <span className="font-mono">{probeResult.health.icloud.apple_id}</span>.</>
                  )}
                  {" "}Click <em>Save & connect</em> to finish.
                </BannerShell>
              ) : (
                <BannerShell intent="danger" icon={CircleAlert}>
                  <strong>{probeResult.code}:</strong> {probeResult.message}
                </BannerShell>
              )}
            </div>
          )}

          {saveError && (
            <BannerShell intent="danger" icon={CircleAlert}>{saveError}</BannerShell>
          )}
        </div>
      </div>
    </Card>
  );
}
