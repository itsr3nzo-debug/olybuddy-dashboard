/**
 * Creates the Xero custom-auth authConfig in Composio programmatically.
 *
 * Background: The Composio-managed-auth path (use_composio_managed_auth) which
 * scripts/composio-setup.ts uses for gmail/slack/calendar/etc DOES NOT work for
 * Xero — Composio doesn't offer a managed Xero app. Xero requires BYO OAuth
 * credentials, same shape as QuickBooks.
 *
 * This script registers the Xero toolkit in Composio with our XERO_CLIENT_ID
 * and XERO_CLIENT_SECRET from .env.local, then prints the resulting
 * auth_config_id (format: ac_xxx) so we can:
 *   1. Add COMPOSIO_AUTH_CONFIG_XERO=ac_xxx to .env.local
 *   2. Add xero entry to lib/composio-registry.json
 *
 * After those two changes, the dashboard's /api/oauth/xero connect button
 * automatically switches from Path B (direct OAuth) to Path A (Composio).
 *
 * Run: tsx scripts/composio-setup-xero.ts
 */
import { Composio } from "@composio/core";

const apiKey = process.env.COMPOSIO_API_KEY;
const clientId = process.env.XERO_CLIENT_ID;
const clientSecret = process.env.XERO_CLIENT_SECRET;

if (!apiKey) {
  console.error("ERROR: COMPOSIO_API_KEY missing from env");
  process.exit(1);
}
if (!clientId || !clientSecret) {
  console.error("ERROR: XERO_CLIENT_ID or XERO_CLIENT_SECRET missing from env");
  process.exit(1);
}

// Granular scopes — verified against developer.xero.com 2026-04-20.
// Composio's API expects comma-separated string.
const SCOPES = [
  "openid",
  "profile",
  "email",
  "accounting.contacts",
  "accounting.invoices",
  "accounting.payments",
  "accounting.banktransactions.read",
  "accounting.settings.read",
  "accounting.reports.aged.read",
  "accounting.reports.profitandloss.read",
  "accounting.reports.balancesheet.read",
  "accounting.reports.trialbalance.read",
  "accounting.reports.taxreports.read",
  "offline_access",
].join(",");

const composio = new Composio({ apiKey });

async function main() {
  console.log("Checking existing Xero authConfigs in Composio...");
  const existing = await composio.authConfigs.list();
  const xeroExisting = existing.items.filter(
    (c: any) => (c.toolkit?.slug || "").toLowerCase() === "xero"
  );
  if (xeroExisting.length > 0) {
    console.log("Existing Xero auth configs:");
    for (const c of xeroExisting) {
      console.log(`  ${c.id}  name=${c.name}  type=${(c as any).type ?? "?"}`);
    }
    console.log(
      "\nNote: not creating a new one. Either use an existing id above, or delete it in the Composio dashboard first."
    );
    return;
  }

  console.log("Creating new custom-auth Xero authConfig...");
  const created = await composio.authConfigs.create("XERO", {
    name: "xero-nexley",
    type: "use_custom_auth",
    authScheme: "OAUTH2",
    credentials: {
      client_id: clientId,
      client_secret: clientSecret,
      oauth_redirect_uri:
        "https://backend.composio.dev/api/v3.1/toolkits/auth/callback",
      scopes: SCOPES,
    },
  });

  console.log("\n✅ Created.");
  console.log(`auth_config_id: ${created.id}`);
  console.log("\nNext steps (automated below):");
  console.log("  1. Add COMPOSIO_AUTH_CONFIG_XERO=" + created.id + " to .env.local");
  console.log("  2. Add xero entry to lib/composio-registry.json");
  console.log("\nAlso make sure the Xero developer app has this Redirect URI:");
  console.log("  https://backend.composio.dev/api/v3.1/toolkits/auth/callback");
}

main().catch((e) => {
  console.error("FAILED:", e?.message || e);
  if (e?.response?.data) console.error("response:", JSON.stringify(e.response.data, null, 2));
  process.exit(1);
});
