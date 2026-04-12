import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { generateResponse } from "@/lib/claude";
import { sendSms } from "@/lib/twilio";

// Vercel Cron or pg_cron calls this at 8pm daily
// Generates a summary for each active client and sends via SMS/WhatsApp

export async function GET(req: NextRequest) {
  // Verify cron secret (Vercel Cron sends this header)
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  // Get all active clients
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name, phone")
    .in("subscription_status", ["active", "trial"]);

  if (!clients || clients.length === 0) {
    return NextResponse.json({ success: true, message: "No active clients" });
  }

  const results = [];

  for (const client of clients) {
    try {
      // Count today's calls
      const { count: callCount } = await supabase
        .from("call_logs")
        .select("id", { count: "exact", head: true })
        .eq("client_id", client.id)
        .gte("created_at", todayISO);

      // Count today's messages
      const { count: msgCount } = await supabase
        .from("comms_log")
        .select("id", { count: "exact", head: true })
        .eq("client_id", client.id)
        .gte("sent_at", todayISO);

      // Count today's opportunities
      const { count: oppCount } = await supabase
        .from("opportunities")
        .select("id", { count: "exact", head: true })
        .eq("client_id", client.id)
        .gte("created_at", todayISO);

      // Generate summary if there's activity
      const calls = callCount || 0;
      const messages = msgCount || 0;
      const bookings = oppCount || 0;

      if (calls + messages + bookings === 0) {
        results.push({ client: client.name, status: "no activity" });
        continue;
      }

      const summary = `Daily update from your AI Employee:\n\nCalls handled: ${calls}\nMessages responded: ${messages}\nNew leads: ${bookings}\n\nYour AI saved you approximately £${calls * 15 + messages * 5} today.`;

      // Send via SMS to client's personal phone
      if (client.phone) {
        await sendSms(client.phone, summary, client.id);
      }

      results.push({
        client: client.name,
        status: "sent",
        calls,
        messages,
        bookings,
      });
    } catch (err) {
      console.error(`[daily-summary] Error for ${client.name}:`, err);
      results.push({ client: client.name, status: "error" });
    }
  }

  return NextResponse.json({ success: true, results });
}
