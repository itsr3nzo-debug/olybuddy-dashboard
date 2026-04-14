import { Composio } from "@composio/core";

const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY! });

async function main() {
  const userId = "test-client-" + Date.now();
  const authConfigId = process.env.COMPOSIO_AUTH_CONFIG_GMAIL!;
  const callbackUrl = "http://localhost:3100/api/oauth/gmail/callback";

  console.log(`Initiating Gmail connection for user: ${userId}`);
  const conn = await composio.connectedAccounts.initiate(userId, authConfigId, { callbackUrl });
  console.log("Connection id:", conn.id);
  console.log("Status:     ", conn.status);
  console.log("Redirect URL:", conn.redirectUrl);
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
