import { NextRequest, NextResponse } from "next/server";
import {
  getAgentConfigByPhone,
  getOrCreateContact,
} from "@/lib/conversation";
import { getSupabase } from "@/lib/supabase";

// Save-only webhook: stores inbound SMS to Supabase for async processing.
// The Mac Mini sms-responder (Claude Code on Max plan) handles AI replies.

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    // Twilio sends form-encoded data for SMS
    const formData = await req.formData();
    const from = (formData.get("From") as string) || "";
    const to = (formData.get("To") as string) || "";
    const body = (formData.get("Body") as string) || "";
    const messageSid = (formData.get("MessageSid") as string) || "";

    console.log(
      `[sms-webhook] Message from ${from} to ${to}: "${body.substring(0, 50)}..."`
    );

    if (!body.trim()) {
      // Return empty TwiML for blank messages
      return new Response("<Response></Response>", {
        headers: { "Content-Type": "text/xml" },
      });
    }

    // Lookup which client owns this phone number
    const agentData = await getAgentConfigByPhone(to);
    if (!agentData) {
      console.log(`[sms-webhook] No agent_config found for ${to}`);
      return new Response("<Response></Response>", {
        headers: { "Content-Type": "text/xml" },
      });
    }

    const { client_id } = agentData;

    // Get or create the customer contact
    const contact = await getOrCreateContact(client_id, from);

    // Insert inbound message with pending_response status
    // Mac Mini sms-responder.sh polls for these and generates AI replies via Claude Code (Max plan)
    const supabase = getSupabase();
    await supabase.from("comms_log").insert({
      client_id,
      contact_id: contact.id,
      channel: "sms",
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
      `[sms-webhook] Saved in ${elapsed}ms — contact: ${contact.id}, awaiting Mac Mini response`
    );

    // Return empty TwiML — response comes async from Mac Mini
    return new Response("<Response></Response>", {
      headers: { "Content-Type": "text/xml" },
    });
  } catch (error) {
    console.error("[sms-webhook] Error:", error);
    // Always return valid TwiML so Twilio doesn't retry
    return new Response("<Response></Response>", {
      headers: { "Content-Type": "text/xml" },
    });
  }
}
