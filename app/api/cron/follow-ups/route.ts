import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { generateResponse } from "@/lib/claude";
import { sendSms } from "@/lib/twilio";
import { logMessage } from "@/lib/conversation";

// Vercel Cron or pg_cron calls this every 6 hours
// Checks for stale contacts and sends automated follow-ups

export async function GET(req: NextRequest) {
  // Verify cron secret — fail closed when not configured
  const cronSecret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (cronSecret !== process.env.CRON_SECRET || !process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();

  // Find contacts not contacted in 48+ hours, still in early pipeline stages
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const { data: staleContacts } = await supabase
    .from("contacts")
    .select(
      "id, client_id, first_name, phone, company, pipeline_stage, last_contacted"
    )
    .in("pipeline_stage", ["new", "contacted"])
    .lt("last_contacted", cutoff)
    .not("phone", "is", null)
    .limit(20); // Process max 20 per run

  if (!staleContacts || staleContacts.length === 0) {
    return NextResponse.json({
      success: true,
      message: "No stale contacts to follow up",
    });
  }

  const results = [];

  for (const contact of staleContacts) {
    try {
      // Get the client's agent config for context
      const { data: agentConfig } = await supabase
        .from("agent_config")
        .select("business_name, services")
        .eq("client_id", contact.client_id)
        .single();

      if (!agentConfig) continue;

      const name = contact.first_name || "there";
      const business = agentConfig.business_name;

      // Generate a short, personalised follow-up
      const result = await generateResponse(
        `You are following up with a lead on behalf of ${business}. Keep it under 140 characters. Be casual and friendly. Don't be pushy.`,
        [
          {
            role: "user",
            content: `Generate a brief follow-up text for ${name} who enquired about ${business} services but hasn't responded in 2 days. Just the message text, nothing else.`,
          },
        ],
        { model: "haiku", maxTokens: 100 }
      );

      // Send the follow-up via SMS
      if (contact.phone) {
        const smsResult = await sendSms(contact.phone, result.response, contact.client_id);

        // Log to comms_log
        await logMessage(
          contact.client_id,
          contact.id,
          "sms",
          "outbound",
          result.response,
          smsResult.messageId || undefined
        );

        // Update pipeline stage
        await supabase
          .from("contacts")
          .update({
            pipeline_stage: "contacted",
            last_contacted: new Date().toISOString(),
          })
          .eq("id", contact.id);

        results.push({
          contact: name,
          phone: contact.phone,
          status: "followed up",
        });
      }
    } catch (err) {
      console.error(`[follow-ups] Error for contact ${contact.id}:`, err);
      results.push({ contact: contact.id, status: "error" });
    }
  }

  return NextResponse.json({ success: true, followedUp: results.length, results });
}
