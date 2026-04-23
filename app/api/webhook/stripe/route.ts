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

    if (!webhookSecret) {
      console.error('STRIPE_WEBHOOK_SECRET not configured — rejecting request');
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
    }

    if (!stripeSignature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
    }

    if (!verifyStripeSignature(body, stripeSignature, webhookSecret)) {
      console.error('Stripe signature verification failed');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
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

    // Dedup check — skip if already processed.
    // Use maybeSingle() so 0 rows returns null (not an error).
    // A UNIQUE constraint on stripe_event_id is the hard guard against races.
    const { data: existing, error: dedupErr } = await supabase
      .from('stripe_events')
      .select('id')
      .eq('stripe_event_id', eventId)
      .maybeSingle();

    if (dedupErr) {
      console.error('Dedup check failed:', dedupErr);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    if (existing) {
      return NextResponse.json({ status: 'duplicate', eventId });
    }

    // Store the event — UNIQUE constraint on stripe_event_id handles concurrent
    // duplicate webhooks at the DB level (second insert fails, returns 409).
    const { error: insertError } = await supabase.from('stripe_events').insert({
      stripe_event_id: eventId,
      event_type: eventType,
      payload: event,
    });

    if (insertError) {
      // 23505 = unique_violation — another worker already processed this event
      if (insertError.code === '23505') {
        return NextResponse.json({ status: 'duplicate', eventId });
      }
      console.error('Failed to store stripe event:', insertError);
      return NextResponse.json({ error: 'Failed to store event' }, { status: 500 });
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
        const customerEmail = session.customer_details?.email || session.customer_email;
        const stripeCustomerId = session.customer;

        // SIGNUP COMPLETION: /api/signup Checkouts carry client_id + plan +
        // create_subscription_price. This means the customer just paid the £20
        // onboarding fee (mode=payment) and their card is saved (setup_future_usage).
        // Now we create the £599/mo subscription with a 5-day trial on the same
        // customer so Stripe auto-bills Day 6 unless they cancel.
        if (clientId && metadata.plan && metadata.create_subscription_price && stripeCustomerId) {
          let subscriptionId: string | null = null;
          let trialEndsAt: string | null = null;

          try {
            const { getStripe } = await import('@/lib/stripe');
            const stripe = getStripe();
            const trialDays = parseInt(metadata.subscription_trial_days || '5', 10);

            // Find the PaymentMethod we saved via setup_future_usage so the new
            // subscription can charge it off-session on Day 6.
            const paymentIntentId = typeof session.payment_intent === 'string'
              ? session.payment_intent
              : session.payment_intent?.id;
            let defaultPmId: string | undefined;
            if (paymentIntentId) {
              const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
              defaultPmId = typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method?.id;
            }

            const sub = await stripe.subscriptions.create({
              customer: stripeCustomerId,
              items: [{ price: metadata.create_subscription_price }],
              trial_period_days: trialDays,
              default_payment_method: defaultPmId,
              trial_settings: {
                end_behavior: { missing_payment_method: 'cancel' },
              },
              metadata: { client_id: clientId, plan: metadata.plan, created_from: 'signup' },
            });
            subscriptionId = sub.id;
            trialEndsAt = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;
          } catch (subErr: any) {
            console.error('[stripe webhook] subscription creation failed:', subErr?.message);
            // Telegram alert — a paying customer just lost their auto-renewal.
            try {
              const botToken = process.env.TELEGRAM_BOT_TOKEN;
              const chatId = process.env.TELEGRAM_CHAT_ID;
              if (botToken && chatId) {
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: chatId,
                    text: `⚠️ Subscription creation FAILED after £20 onboarding for ${metadata.business_name || clientId}.\nEmail: ${customerEmail}\nError: ${subErr?.message || 'unknown'}\nManual intervention needed — create the £599/mo sub in Stripe Dashboard.`,
                  }),
                });
              }
            } catch { /* nothing more to do */ }
          }

          // Update client row. subscription_status='trial' until Day 6 billing
          // clears and the customer.subscription.updated webhook flips it to 'active'.
          await supabase
            .from('clients')
            .update({
              subscription_status: 'trial',
              stripe_customer_id: stripeCustomerId,
              stripe_subscription_id: subscriptionId,
              trial_ends_at: trialEndsAt,
              vps_status: 'pending',
            })
            .eq('id', clientId);

          // Telegram notification to ops — a paying customer is waiting for VPS
          // provisioning. The launchd poller (com.nexley.provision-poller, every 30s)
          // will pick this up and run nexley-provision.sh within ~60s.
          try {
            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            const chatId = process.env.TELEGRAM_CHAT_ID;
            if (botToken && chatId) {
              const msg = `🎉 New paid signup: ${metadata.business_name || clientId}\n` +
                          `Paid £${((amountPence || 0) / 100).toFixed(2)} onboarding fee. 5-day trial started.\n` +
                          `Email: ${customerEmail}\n` +
                          `£599/mo auto-bills on: ${trialEndsAt ? new Date(trialEndsAt).toLocaleDateString('en-GB') : 'Day 6'}\n` +
                          `vps_status=pending — poller will provision within 60s.`;
              await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: msg }),
              });
            }
          } catch { /* telegram failure is non-fatal */ }

          // Welcome email — they already have an auth user from /api/signup,
          // they chose their own password, so just confirm payment + give login link.
          if (customerEmail) {
            try {
              const { sendSystemEmail } = await import('@/lib/email');
              const trialEndPretty = trialEndsAt
                ? new Date(trialEndsAt).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
                : 'in 5 days';
              await sendSystemEmail({
                to: customerEmail,
                subject: 'Payment confirmed — Your AI Employee is being built',
                html: `<p>Hi ${metadata.business_name || 'there'},</p>
                  <p>Your £20 onboarding fee has been received. Your AI Employee's dedicated server is being built right now — it'll be ready in about 15 minutes.</p>
                  <p><strong>Your 5-day trial ends ${trialEndPretty}.</strong> On that date, your card will be auto-billed £599 for your first month. You can cancel anytime before then from your dashboard.</p>
                  <p><a href="${process.env.NEXT_PUBLIC_SITE_URL!}/login" style="background:#2563EB;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Sign in to your dashboard</a></p>
                  <p>Forgot your password? <a href="${process.env.NEXT_PUBLIC_SITE_URL!}/forgot-password">Reset it here</a>.</p>
                  <p>— The Nexley AI Team</p>`,
              });
            } catch { /* email failure is non-fatal */ }
          }
        }

        // Update opportunity to closed_won (if this was a payment for a deal)
        if (opportunityId) {
          await supabase
            .from('opportunities')
            .update({ stage: 'won', closed_at: new Date().toISOString() })
            .eq('id', opportunityId);
        }

        // Log activity
        if (contactId && clientId) {
          await supabase.from('activities').insert({
            client_id: clientId,
            contact_id: contactId,
            opportunity_id: opportunityId,
            activity_type: 'payment',
            title: `Payment received: £${((amountPence || 0) / 100).toFixed(2)}`,
            performed_by: 'system',
            is_automated: true,
            metadata: { stripe_session_id: session.id, amount_pence: amountPence },
          });
        }

        await supabase
          .from('stripe_events')
          .update({ processed: true, processed_at: new Date().toISOString() })
          .eq('stripe_event_id', eventId);

        break;
      }

      case 'customer.subscription.trial_will_end': {
        // Fires 3 days before trial ends. Our 5-day trial → fires on Day 2.
        // Email nudge handled by /api/cron/trial-sequence (Day 3/4/5 emails),
        // so here we just log the event. Stripe auto-bills on trial end unless
        // the user cancels or payment method is missing.
        await supabase
          .from('stripe_events')
          .update({ processed: true, processed_at: new Date().toISOString() })
          .eq('stripe_event_id', eventId);
        break;
      }

      case 'invoice.paid': {
        // Fires on every successful invoice — most importantly the Day 6 £599
        // first charge. We don't need to do anything special here because the
        // customer.subscription.updated webhook will flip status to 'active'.
        // Just mark the event processed.
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

          // Deactivate agent when subscription is cancelled or paused
          if (status === 'cancelled' || status === 'paused') {
            await supabase
              .from('agent_config')
              .update({ is_active: false, agent_status: 'offline' })
              .eq('client_id', client.id);
          }
          // Reactivate on active
          if (status === 'active') {
            await supabase
              .from('agent_config')
              .update({ is_active: true, agent_status: 'online' })
              .eq('client_id', client.id);
          }
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
