import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Unified Meta webhook handler for Facebook Messenger + Instagram DMs.
 * Both channels deliver messages in the same format — differentiated by "object" field.
 *
 * Setup: In Meta App settings, point both Messenger and Instagram webhook URLs here.
 * Permissions needed: pages_messaging, instagram_manage_messages, pages_manage_metadata
 */

// GET — Meta webhook verification challenge
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

// POST — Inbound messages from Messenger and Instagram
export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    // Validate Meta webhook signature (X-Hub-Signature-256)
    const signature = req.headers.get('x-hub-signature-256');
    const metaAppSecret = process.env.META_APP_SECRET;

    let body: any;

    if (metaAppSecret) {
      if (!signature) {
        console.error('[meta-webhook] Missing X-Hub-Signature-256 header');
        return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
      }

      const rawBody = await req.text();
      const { createHmac } = await import('crypto');
      const expectedSignature = 'sha256=' + createHmac('sha256', metaAppSecret)
        .update(rawBody)
        .digest('hex');

      if (signature !== expectedSignature) {
        console.error('[meta-webhook] Invalid X-Hub-Signature-256');
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }

      // Parse the already-read body
      body = JSON.parse(rawBody);
    } else {
      console.error('[meta-webhook] META_APP_SECRET not configured — rejecting request');
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
    }

    const platform = body.object; // 'page' = Messenger, 'instagram' = Instagram DMs

    // Must return 200 within 20 seconds or Meta disables the webhook
    // Process asynchronously — acknowledge first
    const entries = body.entry || [];

    for (const entry of entries) {
      const messaging = entry.messaging || [];

      for (const event of messaging) {
        // Skip non-message events (deliveries, reads, etc.)
        if (!event.message || event.message.is_echo) continue;

        const senderId = String(event.sender?.id ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
        const recipientId = String(event.recipient?.id ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
        const messageText = event.message.text || '';
        const messageId = event.message.mid;
        const timestamp = event.timestamp;

        // Determine channel
        const channel = platform === 'instagram' ? 'instagram_dm' : 'facebook_messenger';

        // Look up which client owns this page/IG account
        // We store the Facebook Page ID or IG User ID in agent_config.metadata
        const { data: config } = await supabase
          .from('agent_config')
          .select('client_id, business_name')
          .or(`metadata->facebook_page_id.eq.${recipientId},metadata->instagram_user_id.eq.${recipientId}`)
          .single();

        if (!config) {
          console.warn(`No client found for ${platform} recipient ${recipientId}`);
          continue;
        }

        const clientId = config.client_id;

        // Get or create contact by platform-scoped ID
        let contactId = null;
        const { data: existingContact } = await supabase
          .from('contacts')
          .select('id')
          .eq('client_id', clientId)
          .eq('social_profiles->>meta_scoped_id', senderId)
          .single();

        if (existingContact) {
          contactId = existingContact.id;
        } else {
          // Try to get user profile from Meta
          let userName = 'Social Media User';
          try {
            const profileToken = process.env.META_PAGE_ACCESS_TOKEN;
            if (profileToken && platform === 'page') {
              const profileRes = await fetch(
                `https://graph.facebook.com/v21.0/${senderId}?fields=first_name,last_name&access_token=${profileToken}`
              );
              const profile = await profileRes.json();
              if (profile.first_name) {
                userName = `${profile.first_name} ${profile.last_name || ''}`.trim();
              }
            }
          } catch (e) {
            // Profile fetch failed — use default name
          }

          const nameParts = userName.split(' ');
          const { data: newContact } = await supabase
            .from('contacts')
            .insert({
              client_id: clientId,
              first_name: nameParts[0] || 'Social',
              last_name: nameParts.slice(1).join(' ') || 'User',
              source: 'website',  // Both FB and IG DMs originate from social media presence
              pipeline_stage: 'new',
              social_profiles: { meta_scoped_id: senderId, platform: channel },
            })
            .select('id')
            .single();

          contactId = newContact?.id;
        }

        // Save to comms_log with pending_response
        await supabase.from('comms_log').insert({
          client_id: clientId,
          contact_id: contactId,
          channel: channel,
          direction: 'inbound',
          body: messageText,
          status: 'pending_response',
          from_address: senderId,
          to_address: recipientId,
          external_id: messageId,
          metadata: {
            platform,
            sender_id: senderId,
            recipient_id: recipientId,
            timestamp,
            has_attachments: !!(event.message.attachments?.length),
          },
          sent_at: new Date(timestamp).toISOString(),
        });

        // Log activity
        if (contactId) {
          await supabase.from('activities').insert({
            client_id: clientId,
            contact_id: contactId,
            activity_type: 'webchat',  // Social DMs use webchat activity type
            title: `${channel === 'instagram_dm' ? 'Instagram' : 'Facebook'} DM: "${messageText.substring(0, 50)}"`,
            performed_by: 'system',
            is_automated: true,
          });
        }
      }
    }

    // Log webhook
    await supabase.from('webhook_log').insert({
      source: `meta_${platform}`,
      endpoint: '/api/webhook/meta',
      status_code: 200,
      processing_ms: Date.now() - startTime,
      payload_preview: JSON.stringify(body).substring(0, 500),
    });

    return NextResponse.json({ status: 'ok' });
  } catch (error: any) {
    console.error('Meta webhook error:', error);

    await supabase.from('webhook_log').insert({
      source: 'meta',
      endpoint: '/api/webhook/meta',
      status_code: 500,
      error_message: error.message,
      processing_ms: Date.now() - startTime,
    });

    // Must still return 200 to prevent Meta from disabling webhook
    return NextResponse.json({ status: 'error_logged' });
  }
}
