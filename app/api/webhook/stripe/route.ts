import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function verifyStripeSignature(payload: string, signature: string, secret: string): boolean {
  const elements = signature.split(',');
  const timestamp = elements.find(e => e.startsWith('t='))?.split('=')[1];
  const v1Sig = elements.find(e => e.startsWith('v1='))?.split('=')[1];

  if (!timestamp || !v1Sig) return false;

  // Reject if timestamp is older than 5 minutes (replay protection)
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp);
  if (age > 300) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(v1Sig), Buffer.from(expectedSig));
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  let eventType = 'unknown';

  try {
    const body = await req.text();

    // Verify Stripe signature (CRITICAL — prevents forged events)
    const stripeSignature = req.headers.get('stripe-signature');
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (webhookSecret && stripeSignature) {
      if (!verifyStripeSignature(body, stripeSignature, webhookSecret)) {
        console.error('Stripe signature verification failed');
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
    } else if (webhookSecret && !stripeSignature) {
      // Secret configured but no signature sent — reject
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
    }
    // If no webhook secret configured, allow (dev/testing mode) but log warning
    if (!webhookSecret) {
      console.warn('STRIPE_WEBHOOK_SECRET not set — accepting unverified webhook');
    }

    const event = JSON.parse(body);
    eventType = event.type;
    const eventId = event.id;

    // Log webhook receipt
    await supabase.from('webhook_log').insert({
      source: 'stripe',
      endpoint: '/api/webhook/stripe',
      payload_hash: eventId,
      payload_preview: JSON.stringify(event).substring(0, 500),
    });

    // Dedup check — skip if already processed
    const { data: existing } = await supabase
      .from('stripe_events')
      .select('id')
      .eq('stripe_event_id', eventId)
      .single();

    if (existing) {
      return NextResponse.json({ status: 'duplicate', eventId });
    }

    // Store the event
    const { error: insertError } = await supabase.from('stripe_events').insert({
      stripe_event_id: eventId,
      event_type: eventType,
      payload: event,
    });

    if (insertError) {
      console.error('Failed to store stripe event:', insertError);
    }

    // Process based on event type
    switch (eventType) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const metadata = session.metadata || {};
        const clientId = metadata.client_id;
        const contactId = metadata.contact_id;
        const opportunityId = metadata.opportunity_id;
        const amountPence = session.amount_total;

        // Update opportunity to closed_won
        if (opportunityId) {
          await supabase
            .from('opportunities')
            .update({
              stage: 'won',
              closed_at: new Date().toISOString(),
            })
            .eq('id', opportunityId);
        }

        // Log activity
        if (contactId) {
          await supabase.from('activities').insert({
            client_id: clientId,
            contact_id: contactId,
            opportunity_id: opportunityId,
            activity_type: 'payment',
            title: `Payment received: £${(amountPence / 100).toFixed(2)}`,
            description: `Stripe checkout completed. Session: ${session.id}`,
            performed_by: 'system',
            is_automated: true,
            metadata: {
              stripe_session_id: session.id,
              amount_pence: amountPence,
              customer_email: session.customer_details?.email,
            },
          });
        }

        // Mark event processed
        await supabase
          .from('stripe_events')
          .update({ processed: true, processed_at: new Date().toISOString() })
          .eq('stripe_event_id', eventId);

        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const stripeCustomerId = subscription.customer;

        // Find client by stripe_customer_id
        const { data: client } = await supabase
          .from('clients')
          .select('id')
          .eq('stripe_customer_id', stripeCustomerId)
          .single();

        if (client) {
          const status = subscription.status === 'active' ? 'active' :
                         subscription.status === 'canceled' ? 'cancelled' :
                         subscription.status === 'past_due' ? 'paused' : 'active';

          await supabase
            .from('clients')
            .update({ subscription_status: status })
            .eq('id', client.id);
        }

        await supabase
          .from('stripe_events')
          .update({ processed: true, processed_at: new Date().toISOString() })
          .eq('stripe_event_id', eventId);

        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const stripeCustomerId = invoice.customer;

        const { data: client } = await supabase
          .from('clients')
          .select('id')
          .eq('stripe_customer_id', stripeCustomerId)
          .single();

        if (client) {
          await supabase
            .from('clients')
            .update({ subscription_status: 'paused' })
            .eq('id', client.id);
        }

        await supabase
          .from('stripe_events')
          .update({ processed: true, processed_at: new Date().toISOString() })
          .eq('stripe_event_id', eventId);

        break;
      }
    }

    // Update webhook log with processing time
    const processingMs = Date.now() - startTime;
    await supabase
      .from('webhook_log')
      .update({ processing_ms: processingMs, status_code: 200 })
      .eq('payload_hash', eventId);

    return NextResponse.json({ received: true, type: eventType });
  } catch (error: any) {
    console.error('Stripe webhook error:', error);

    await supabase.from('webhook_log').insert({
      source: 'stripe',
      endpoint: '/api/webhook/stripe',
      status_code: 500,
      error_message: error.message,
      processing_ms: Date.now() - startTime,
    });

    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
