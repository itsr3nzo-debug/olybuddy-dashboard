// Conversation context manager — load/save multi-turn chat history from Supabase comms_log
// Thread management: group by (client_id, contact_phone). Reset after timeout.

import { getSupabase } from "./supabase";

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface Contact {
  id: string;
  client_id: string;
  first_name: string | null;
  phone: string | null;
}

// Normalise UK phone number to +44 format
function normalisePhone(phone: string): string {
  if (!phone) return "";
  let cleaned = phone.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = "+44" + cleaned.substring(1);
  }
  if (!cleaned.startsWith("+") && cleaned.length >= 10) {
    cleaned = "+44" + cleaned;
  }
  return cleaned;
}

// Get or create a contact for this customer
export async function getOrCreateContact(
  clientId: string,
  phone: string,
  name?: string
): Promise<Contact> {
  const supabase = getSupabase();
  const normPhone = normalisePhone(phone);

  // Try to find existing contact
  const { data: existing } = await supabase
    .from("contacts")
    .select("id, client_id, first_name, phone")
    .eq("client_id", clientId)
    .eq("phone", normPhone)
    .single();

  if (existing) {
    // Update name if we have a new one and existing is null
    if (name && !existing.first_name) {
      await supabase
        .from("contacts")
        .update({ first_name: name, last_contacted: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      await supabase
        .from("contacts")
        .update({ last_contacted: new Date().toISOString() })
        .eq("id", existing.id);
    }
    return existing;
  }

  // Create new contact
  const { data: newContact, error } = await supabase
    .from("contacts")
    .insert({
      client_id: clientId,
      phone: normPhone,
      first_name: name || null,
      source: "whatsapp",
      pipeline_stage: "new",
      tags: ["ai-handled"],
      last_contacted: new Date().toISOString(),
    })
    .select("id, client_id, first_name, phone")
    .single();

  if (error || !newContact) {
    console.error("[conversation] Failed to create contact:", error);
    throw new Error("Contact creation failed");
  }

  return newContact;
}

// Load conversation history from comms_log
export async function getConversationHistory(
  clientId: string,
  contactPhone: string,
  channel: "whatsapp" | "sms",
  limit: number = 10,
  timeoutMinutes: number = 30
): Promise<ConversationMessage[]> {
  const supabase = getSupabase();
  const normPhone = normalisePhone(contactPhone);

  // Get contact ID first
  const { data: contact } = await supabase
    .from("contacts")
    .select("id")
    .eq("client_id", clientId)
    .eq("phone", normPhone)
    .single();

  if (!contact) return [];

  // Calculate timeout cutoff
  const cutoff = new Date(
    Date.now() - timeoutMinutes * 60 * 1000
  ).toISOString();

  // Load recent messages within the conversation timeout window
  const { data: messages, error } = await supabase
    .from("comms_log")
    .select("direction, body, sent_at")
    .eq("client_id", clientId)
    .eq("contact_id", contact.id)
    .eq("channel", channel)
    .gte("sent_at", cutoff)
    .order("sent_at", { ascending: true })
    .limit(limit);

  if (error || !messages) return [];

  return messages.map((m) => ({
    role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const),
    content: m.body || "",
    timestamp: m.sent_at,
  }));
}

// Format conversation history for Claude API
export function formatForClaude(
  messages: ConversationMessage[]
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

// Log a message to comms_log
export async function logMessage(
  clientId: string,
  contactId: string,
  channel: "whatsapp" | "sms",
  direction: "inbound" | "outbound",
  body: string,
  externalId?: string
): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase.from("comms_log").insert({
    client_id: clientId,
    contact_id: contactId,
    channel,
    direction,
    body,
    status: direction === "outbound" ? "sent" : "delivered",
    provider: "twilio",
    external_id: externalId || null,
    sent_at: new Date().toISOString(),
  });

  if (error) {
    console.error("[conversation] Failed to log message:", error);
  }
}

// Lookup agent_config by phone number (for webhook routing)
export async function getAgentConfigByPhone(
  phone: string
): Promise<{
  client_id: string;
  config: Record<string, unknown>;
} | null> {
  const supabase = getSupabase();
  const normPhone = normalisePhone(phone);

  const { data, error } = await supabase
    .from("agent_config")
    .select("*, client_id")
    .eq("twilio_phone", normPhone)
    .single();

  if (error || !data) {
    // Also try without +44 prefix (in case stored as 07xxx)
    const alt = normPhone.replace("+44", "0");
    const { data: altData } = await supabase
      .from("agent_config")
      .select("*, client_id")
      .eq("twilio_phone", alt)
      .single();

    if (!altData) return null;
    return { client_id: altData.client_id, config: altData };
  }

  return { client_id: data.client_id, config: data };
}
