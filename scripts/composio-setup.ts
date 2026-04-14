import { Composio } from "@composio/core";

const composio = new Composio({
  apiKey: process.env.COMPOSIO_API_KEY!,
});

const TOOLKITS = [
  "gmail",
  "googlecalendar",
  "slack",
  "hubspot",
  "xero",
  "quickbooks",
  "calendly",
];

async function main() {
  console.log("Listing existing auth configs...");
  const existing = await composio.authConfigs.list();
  const existingSlugs = new Set(
    existing.items.map((c: any) => (c.toolkit?.slug || "").toLowerCase()),
  );
  console.log("Existing toolkits:", [...existingSlugs]);

  for (const slug of TOOLKITS) {
    if (existingSlugs.has(slug)) {
      console.log(`[skip] ${slug} — already configured`);
      continue;
    }
    try {
      const created = await composio.authConfigs.create(slug, {
        type: "use_composio_managed_auth",
        name: `${slug}-nexley`,
      });
      console.log(`[ok]   ${slug} → ${created.id}`);
    } catch (e: any) {
      console.log(`[err]  ${slug} → ${e?.message || e}`);
    }
  }

  console.log("\nFinal state:");
  const after = await composio.authConfigs.list();
  for (const cfg of after.items) {
    console.log(`  ${cfg.toolkit?.slug || "?"}: ${cfg.id}`);
  }
}

main().catch(console.error);
