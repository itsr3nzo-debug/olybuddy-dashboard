import { NextRequest } from "next/server";
import {
  getAgentConfigByPhone,
  getOrCreateContact,
} from "@/lib/conversation";
import { getSupabase } from "@/lib/supabase";

// Save-only webhook: stores inbound WhatsApp to Supabase for async processing.
// The Mac Mini responder (Claude Code on Max plan) handles AI replies.
// Identical pattern to SMS webhook — Twilio WhatsApp uses the same format.

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    // Twilio sends form-encoded data for WhatsApp (same format as SMS)
    const formData = await req.formData();
    // Strip "whatsapp:" prefix from phone numbers
    const from = ((formData.get("From") as string) || "").replace("whatsapp:", "");
    const to = ((formData.get("To") as string) || "").replace("whatsapp:", "");
    const body = (formData.get("Body") as string) || "";
    const messageSid = (formData.get("MessageSid") as string) || "";
    const profileName = (formData.get("ProfileName") as string) || "";

    console.log(
      `[whatsapp-webhook] Message from ${from} to ${to}: "${body.substring(0, 50)}..."`
    );

    if (!body.trim()) {
      return new Response("<Response></Response>", {
        headers: { "Content-Type": "text/xml" },
      });
    }

    // Lookup which client owns this phone number
    const agentData = await getAgentConfigByPhone(to);
    if (!agentData) {
      console.log(`[whatsapp-webhook] No agent_config found for ${to}`);
      return new Response("<Response></Response>", {
        headers: { "Content-Type": "text/xml" },
      });
    }

    const { client_id } = agentData;

    // Get or create the customer contact
    const contact = await getOrCreateContact(client_id, from, profileName || undefined);

    // Insert inbound message with pending_response status
    // Mac Mini responder polls for these and generates AI replies via Claude Code (Max plan)
    const supabase = getSupabase();
    await supabase.from("comms_log").insert({
      client_id,
      contact_id: contact.id,
      channel: "whatsapp",
      direction: "inbound",
      from_number: from,
      to_number: to,
      body,
      status: "pending_response",
      provider: "twilio",
      external_id: messageSid,
      sent_at: new Date().toISOString(),
    });

    const elapsed = Date.now() - startTime;
    console.log(
      `[whatsapp-webhook] Saved in ${elapsed}ms — contact: ${contact.id}, awaiting Mac Mini response`
    );

    // Return empty TwiML — response comes async from Mac Mini
    return new Response("<Response></Response>", {
      headers: { "Content-Type": "text/xml" },
    });
  } catch (error) {
    console.error("[whatsapp-webhook] Error:", error);
    return new Response("<Response></Response>", {
      headers: { "Content-Type": "text/xml" },
    });
  }
}
