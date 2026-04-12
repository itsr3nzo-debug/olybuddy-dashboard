import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// CORS headers for the embeddable widget
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Widget-Key',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  try {
    const { message, visitor_name, visitor_email, visitor_phone, page_url, widget_key } = await req.json();

    if (!message || !widget_key) {
      return NextResponse.json({ error: 'Missing message or widget_key' }, { status: 400, headers: corsHeaders });
    }

    // Look up client by widget key (stored in agent_config)
    const { data: config, error: configError } = await supabase
      .from('agent_config')
      .select('client_id, business_name')
      .eq('booking_link', widget_key)
      .single();

    if (configError || !config) {
      return NextResponse.json({ error: 'Invalid widget key' }, { status: 401, headers: corsHeaders });
    }

    const clientId = config.client_id;

    // Get or create contact
    let contactId = null;
    if (visitor_phone || visitor_email) {
      const phone = visitor_phone?.replace(/[\s\-\(\)]/g, '') || null;

      if (phone) {
        const { data: existing } = await supabase
          .from('contacts')
          .select('id')
          .eq('client_id', clientId)
          .eq('phone', phone)
          .single();

        if (existing) {
          contactId = existing.id;
        } else {
          const { data: newContact } = await supabase
            .from('contacts')
            .insert({
              client_id: clientId,
              first_name: visitor_name || 'Website Visitor',
              phone: phone,
              email: visitor_email,
              source: 'website',
              pipeline_stage: 'new',
            })
            .select('id')
            .single();

          contactId = newContact?.id;
        }
      }
    }

    // Save message to comms_log with pending_response status
    await supabase.from('comms_log').insert({
      client_id: clientId,
      contact_id: contactId,
      channel: 'webchat',
      direction: 'inbound',
      body: message,
      status: 'pending_response',
      from_address: visitor_phone || visitor_email || 'anonymous',
      metadata: {
        visitor_name,
        visitor_email,
        visitor_phone,
        page_url,
        widget_key,
      },
      sent_at: new Date().toISOString(),
    });

    // Log activity
    if (contactId) {
      await supabase.from('activities').insert({
        client_id: clientId,
        contact_id: contactId,
        activity_type: 'webchat',
        title: `Website chat: "${message.substring(0, 50)}..."`,
        performed_by: 'system',
        is_automated: true,
      });
    }

    // Log webhook
    await supabase.from('webhook_log').insert({
      source: 'chat_widget',
      endpoint: '/api/webhook/chat',
      status_code: 200,
      payload_preview: JSON.stringify({ message: message.substring(0, 100), page_url }).substring(0, 500),
    });

    return NextResponse.json(
      {
        received: true,
        message: `Thanks for reaching out to ${config.business_name}! We'll get back to you shortly.`,
      },
      { headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('Chat widget error:', error);
    return NextResponse.json(
      { error: 'Failed to process message' },
      { status: 500, headers: corsHeaders }
    );
  }
}
