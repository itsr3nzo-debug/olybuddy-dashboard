import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "";

interface ProvisionRequest {
  businessName: string;
  industry: string;
  services: Array<{ name: string; description?: string; price_from?: string }>;
  hours: Record<string, { open: string; close: string }>;
  phone: string; // Client's personal phone (for notifications)
  escalationPhone?: string;
  planTier: "starter" | "pro" | "enterprise";
  greetingMessage?: string;
  businessDescription?: string;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function POST(req: NextRequest) {
  // Verify admin API key
  const apiKey = req.headers.get("x-admin-key");
  if (!apiKey || apiKey !== ADMIN_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body: ProvisionRequest = await req.json();
    const supabase = getSupabase();
    const slug = slugify(body.businessName);

    // Step 1: Create client row
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .insert({
        name: body.businessName,
        slug,
        phone: body.phone,
        industry: body.industry,
        subscription_status: "trial",
        subscription_plan: body.planTier,
      })
      .select("id")
      .single();

    if (clientError || !client) {
      console.error("[provision] Client creation failed:", clientError);
      return NextResponse.json(
        { error: "Client creation failed", details: clientError },
        { status: 500 }
      );
    }

    // Step 2: Create agent_config row
    const { error: configError } = await supabase.from("agent_config").insert({
      client_id: client.id,
      business_name: body.businessName,
      business_description: body.businessDescription || null,
      services: body.services,
      hours: body.hours,
      escalation_phone: body.escalationPhone || body.phone,
      greeting_message:
        body.greetingMessage ||
        `Hi! Thanks for contacting ${body.businessName}. How can we help you today?`,
      // Phone number will be set when Twilio number is provisioned
      twilio_phone: null,
    });

    if (configError) {
      console.error("[provision] Agent config creation failed:", configError);
      return NextResponse.json(
        { error: "Agent config creation failed", details: configError },
        { status: 500 }
      );
    }

    console.log(
      `[provision] Client "${body.businessName}" created: ${client.id}`
    );

    return NextResponse.json({
      success: true,
      clientId: client.id,
      slug,
      message: `Client "${body.businessName}" provisioned. Assign a Twilio number to agent_config.twilio_phone to activate WhatsApp/SMS.`,
    });
  } catch (error) {
    console.error("[provision] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
