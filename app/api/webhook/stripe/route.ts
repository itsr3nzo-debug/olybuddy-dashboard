import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyStripeSignature } from '@/lib/webhooks/stripe-signature';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

    // Dedup check — only treat as duplicate if the event has already been
    // successfully processed. If it exists but processed=false, the previous
    // attempt crashed partway through (e.g. Supabase update blipped after
    // Stripe sub was created), and Stripe is retrying to let us complete
    // the work. Returning "duplicate" here would leave the row orphaned —
    // sub exists in Stripe with no stripe_subscription_id in Supabase.
    const { data: existing, error: dedupErr } = await supabase
      .from('stripe_events')
      .select('id, processed')
      .eq('stripe_event_id', eventId)
      .maybeSingle();

    if (dedupErr) {
      console.error('Dedup check failed:', dedupErr);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    if (existing?.processed) {
      return NextResponse.json({ status: 'duplicate', eventId });
    }

    if (!existing) {
      // First time seeing this event — store it. UNIQUE(stripe_event_id)
      // handles the concurrent-insert race (second insert gets 23505).
      const { error: insertError } = await supabase.from('stripe_events').insert({
        stripe_event_id: eventId,
        event_type: eventType,
        payload: event,
      });

      if (insertError) {
        if (insertError.code === '23505') {
          // Another instance just inserted it — re-check processed status.
          const { data: raced } = await supabase
            .from('stripe_events')
            .select('processed')
            .eq('stripe_event_id', eventId)
            .maybeSingle();
          if (raced?.processed) {
            return NextResponse.json({ status: 'duplicate', eventId });
          }
          // Another instance holds the lock but hasn't finished yet. Let
          // Stripe retry rather than double-process.
          return NextResponse.json(
            { error: 'Event being processed — Stripe will retry' },
            { status: 409 }
          );
        }
        console.error('Failed to store stripe event:', insertError);
        return NextResponse.json({ error: 'Failed to store event' }, { status: 500 });
      }
    }
    // If we got here with existing.processed=false, we're retrying an
    // incomplete event — fall through to the handler switch.

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

            // Idempotency key derived from the checkout session ID. If this
            // webhook handler times out after Stripe created the sub but
            // before we responded, Stripe will retry the whole webhook. On
            // retry, the idempotency key makes Stripe return the EXISTING
            // subscription instead of creating a duplicate — so we can't
            // accidentally double-subscribe a customer.
            const idempotencyKey = `sub-create-${session.id}`;
            const sub = await stripe.subscriptions.create({
              customer: stripeCustomerId,
              items: [{ price: metadata.create_subscription_price }],
              trial_period_days: trialDays,
              default_payment_method: defaultPmId,
              trial_settings: {
                end_behavior: { missing_payment_method: 'cancel' },
              },
              metadata: { client_id: clientId, plan: metadata.plan, created_from: 'signup' },
            }, { idempotencyKey });
            subscriptionId = sub.id;
            trialEndsAt = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;
          } catch (subErr: any) {
            console.error('[stripe webhook] subscription creation failed:', subErr?.message);
            // Failsafe: still give the customer a 5-day access window so the
            // trial-expiry cron can eventually clean them up if ops don't fix
            // the Stripe sub manually. Without this, trial_ends_at stays null
            // and they'd be stuck in trial limbo forever.
            trialEndsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
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

          // CRITICAL: check if this client already has a VPS provisioned. The
          // provision-poller picks up any row with vps_status='pending' and
          // spins up a fresh Hetzner server — we must NOT do that for legacy
          // clients (joseph, chicken-curry, etc) who are just setting up
          // billing for an existing agent. Re-provisioning would orphan their
          // WhatsApp session, conversations, and VPS they're already paying for.
          const { data: existingClient } = await supabase
            .from('clients')
            .select('vps_status, vps_ip')
            .eq('id', clientId)
            .single();
          const alreadyHasVps =
            existingClient?.vps_status &&
            ['active', 'provisioned', 'running'].includes(existingClient.vps_status) &&
            existingClient?.vps_ip;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const clientUpdate: any = {
            subscription_status: 'trial',
            stripe_customer_id: stripeCustomerId,
            stripe_subscription_id: subscriptionId,
            trial_ends_at: trialEndsAt,
          };
          if (!alreadyHasVps) {
            // Fresh signup — trigger VPS provisioning via the launchd poller.
            clientUpdate.vps_status = 'pending';
          }
          // If they already have a VPS, leave vps_status alone so we don't
          // accidentally trigger a second provision.

          await supabase
            .from('clients')
            .update(clientUpdate)
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
                  <p>Your £19.99 onboarding fee has been received. Your AI Employee's dedicated server is being built right now — it'll be ready in about 15 minutes.</p>
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
        // Email nudge handled by /api/cron/trial-sequence (Day 3/4/5 emails).
        // OPS Telegram alert lets Kade make a proactive conversion-boost call.
        const sub = event.data.object;
        try {
          const { data: client } = await supabase
            .from('clients')
            .select('name, email')
            .eq('stripe_customer_id', sub.customer)
            .maybeSingle();
          const botToken = process.env.TELEGRAM_BOT_TOKEN;
          const chatId = process.env.TELEGRAM_CHAT_ID;
          if (botToken && chatId && client) {
            const trialEnd = sub.trial_end
              ? new Date(sub.trial_end * 1000).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
              : 'in 3 days';
            const msg = `⏰ Trial ending soon: ${client.name || 'customer'}\n` +
                        `Email: ${client.email || 'unknown'}\n` +
                        `£599/mo auto-bills on ${trialEnd}.\n` +
                        `Consider a quick "how's it going?" message — high-value conversion moment.`;
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, text: msg }),
            });
          }
        } catch { /* non-fatal */ }
        await supabase
          .from('stripe_events')
          .update({ processed: true, processed_at: new Date().toISOString() })
          .eq('stripe_event_id', eventId);
        break;
      }

      case 'invoice.paid': {
        // Fires on every successful invoice. Most are routine monthly renewals
        // that don't need an alert. But the FIRST charge (billing_reason =
        // subscription_create OR subscription_cycle post-trial) is a big
        // conversion moment — a trial just became a paying customer. Worth
        // knowing about in real time.
        const invoice = event.data.object;
        const billingReason = invoice.billing_reason;
        // Trial converting to paid → invoice is subscription_cycle (first real
        // billing cycle after trial_end). billing_reason='subscription_create'
        // only fires if there was NO trial. We check both to cover all paths.
        const isFirstPaidInvoice =
          billingReason === 'subscription_create' ||
          (billingReason === 'subscription_cycle' && invoice.amount_paid >= 50000);

        if (isFirstPaidInvoice) {
          try {
            const { data: client } = await supabase
              .from('clients')
              .select('id, name, email, referred_by_client_id')
              .eq('stripe_customer_id', invoice.customer)
              .maybeSingle();
            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            const chatId = process.env.TELEGRAM_CHAT_ID;
            if (botToken && chatId && client) {
              const amt = (invoice.amount_paid / 100).toFixed(2);
              const msg = `💷 Trial converted — first paid month: ${client.name}\n` +
                          `Email: ${client.email || 'unknown'}\n` +
                          `Amount: £${amt}\n` +
                          `This is a real paying customer now.`;
              await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: msg }),
              });
            }

            // Item #14 — referral credit. If this client was referred by
            // someone, the referrer earns £150 off their next invoice.
            // Idempotent (creditReferralForReferee checks existing status).
            if (client?.id && client.referred_by_client_id) {
              const { creditReferralForReferee } = await import('@/lib/referrals');
              const { getStripe: _getStripe } = await import('@/lib/stripe');
              const result = await creditReferralForReferee({
                refereeClientId: client.id,
                stripe: _getStripe(),
              });
              if (result.credited) {
                console.log('[stripe-webhook] Referral credited for referee', client.id);
              } else if (!result.ok) {
                console.warn('[stripe-webhook] Referral credit skipped:', result.reason);
              }
            }
          } catch (e) { console.error('[stripe-webhook] post-paid hooks failed:', e); }
        }

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
          // Exhaustive Stripe status mapping. Previously the default fell
          // through to 'active' which mis-labelled trialing subs AND any
          // incomplete/unpaid states. Now every known Stripe state maps
          // explicitly — unknown states stay put (no change) to avoid
          // clobbering a more accurate value set by checkout.session.completed.
          let status: string | null = null;
          switch (subscription.status) {
            case 'trialing':
              status = 'trial';
              break;
            case 'active':
              status = 'active';
              break;
            case 'canceled':
              status = 'cancelled';
              break;
            case 'past_due':
            case 'unpaid':
              status = 'paused';
              break;
            case 'incomplete':
            case 'incomplete_expired':
              // Card never succeeded — treat as cancelled
              status = 'cancelled';
              break;
            case 'paused':
              status = 'paused';
              break;
            default:
              // Unknown future Stripe status — don't overwrite Supabase
              status = null;
          }

          const trialEndIso = subscription.trial_end
            ? new Date(subscription.trial_end * 1000).toISOString()
            : null;

          if (status) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const update: any = { subscription_status: status };
            // Keep trial_ends_at fresh so our dashboard shows the right date
            // through Stripe-side changes (pause, resume, trial extension).
            if (trialEndIso) update.trial_ends_at = trialEndIso;

            await supabase
              .from('clients')
              .update(update)
              .eq('id', client.id);

            // Item #15 — if they came back to active/trial after a previous
            // cancellation, stop the winback drip. Idempotent — sets
            // reactivated_at on any pending winback rows for this client.
            if (status === 'active' || status === 'trial') {
              try {
                await supabase
                  .from('winback_sequence')
                  .update({ reactivated_at: new Date().toISOString() })
                  .eq('client_id', client.id)
                  .is('reactivated_at', null)
              } catch { /* non-fatal */ }
            }

            // Agent lifecycle: deactivate on cancel/pause, activate on
            // active/trial (customer is paying or in a paid-for trial).
            if (status === 'cancelled' || status === 'paused') {
              await supabase
                .from('agent_config')
                .update({ is_active: false, agent_status: 'offline' })
                .eq('client_id', client.id);
            } else if (status === 'active' || status === 'trial') {
              await supabase
                .from('agent_config')
                .update({ is_active: true, agent_status: 'online' })
                .eq('client_id', client.id);
            }

            // Item #15 — cancellation winback. Two parallel actions:
            //   (a) Light gets a P1 alert with whatever Stripe gave us as
            //       cancellation reason — he reaches out for a save-attempt
            //       within the period-end window.
            //   (b) Enrol in winback_sequence so the daily cron sends
            //       T+14/30/60 emails if the human chase doesn't pull
            //       them back.
            if (status === 'cancelled') {
              try {
                const { data: c } = await supabase
                  .from('clients')
                  .select('name, email, subscription_plan')
                  .eq('id', client.id)
                  .single();

                // Stripe puts the structured cancellation reason on the
                // subscription itself when collected via Customer Portal.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const cancelDetails = (subscription as any).cancellation_details;
                const reasonCode = cancelDetails?.reason || cancelDetails?.feedback;
                const reasonText = cancelDetails?.comment || null;

                // Enrol in winback drip.
                if (c?.email) {
                  await supabase.from('winback_sequence').insert({
                    client_id: client.id,
                    email: c.email,
                    cancellation_reason: reasonText || reasonCode || null,
                    meta: {
                      stripe_subscription_id: subscription.id,
                      cancel_details: cancelDetails || null,
                    },
                  }).then(() => {}, (e) => console.warn('[winback] enrol failed:', e));
                }

                // Route to Light for human-touch save-attempt.
                const { dispatchAgentAlert } = await import('@/lib/agent-alerts');
                await dispatchAgentAlert({
                  target: 'light',
                  priority: 'P1',
                  category: 'churn',
                  subject: `Subscription cancelled: ${c?.name || 'unknown'}`,
                  body: [
                    `Customer just cancelled their Nexley AI subscription.`,
                    ``,
                    `**Customer:** ${c?.name || client.id}`,
                    `**Email:** ${c?.email || 'unknown'}`,
                    `**Plan:** ${c?.subscription_plan || 'employee'}`,
                    `**Stripe reason:** ${reasonCode || 'not provided'}`,
                    reasonText ? `**Comment:** ${reasonText}` : '',
                    ``,
                    `Window for save-attempt: data retained 30 days, VPS deleted in 14 days by cleanup cron. Reach out within 24h.`,
                    ``,
                    `Auto-actions taken:`,
                    `- Enrolled in winback_sequence (T+14d/30d/60d emails)`,
                    `- Subscription status flipped to 'cancelled'`,
                    `- Agent deactivated`,
                  ].filter(Boolean).join('\n'),
                  source: 'stripe-webhook:subscription.deleted',
                  clientId: client.id,
                  meta: { reason: reasonCode, comment: reasonText, stripe_sub_id: subscription.id },
                });
              } catch (e) { console.error('[stripe-webhook] cancel hooks failed:', e); }
            }
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
          .select('id, name, email')
          .eq('stripe_customer_id', stripeCustomerId)
          .single();

        if (client) {
          await supabase
            .from('clients')
            .update({ subscription_status: 'paused' })
            .eq('id', client.id);

          // OPS Telegram alert — card just failed, customer needs to update
          // their payment method before Stripe's dunning cycle auto-cancels
          // them (default: 4 retries over 3 weeks, then cancel). Nudging
          // early keeps retention high.
          try {
            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            const chatId = process.env.TELEGRAM_CHAT_ID;
            if (botToken && chatId) {
              const amountPence = invoice.amount_due;
              const msg = `💳 Card declined for ${client.name || client.id}\n` +
                          `Email: ${client.email || 'unknown'}\n` +
                          `Amount: £${((amountPence || 0) / 100).toFixed(2)}\n` +
                          `Status now 'paused'. Stripe will retry automatically but consider reaching out — they should update the card at /settings/billing → Update payment method.`;
              await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: msg }),
              });
            }
          } catch { /* non-fatal */ }
        }

        await supabase
          .from('stripe_events')
          .update({ processed: true, processed_at: new Date().toISOString() })
          .eq('stripe_event_id', eventId);

        break;
      }

      // P1 #14 + round-2 fix: charge.refunded ONLY claws back referral
      // credit when the refund is for the £20 onboarding fee OR the
      // first £599 invoice (the one that triggered the credit). A month-5
      // partial refund on a routine subscription invoice should NOT
      // touch a long-since-issued referral credit.
      //
      // Detection chain:
      //   1. PaymentIntent.metadata.purpose === 'onboarding_fee'
      //      (set by /api/signup, fires for the £20 charge)
      //   2. Invoice.billing_reason === 'subscription_create' OR
      //      'subscription_cycle' AND it's the FIRST cycle invoice
      //      (we already detect this in invoice.paid above)
      //
      // Anything else is a routine refund — still process the
      // stripe_events row but don't touch referrals.
      case 'charge.refunded': {
        const charge = event.data.object as {
          id: string
          customer: string | null
          amount_refunded: number
          payment_intent: string | null
          invoice: string | null
          refunded: boolean
          metadata?: Record<string, string>
        }

        if (!charge.customer || !charge.refunded) {
          await supabase
            .from('stripe_events')
            .update({ processed: true, processed_at: new Date().toISOString() })
            .eq('stripe_event_id', eventId)
          break
        }

        // ─── Determine if this charge is referral-relevant ────────────
        let isReferralRelevant = false
        let detectionReason = 'unknown'

        try {
          const { getStripe: _getStripe } = await import('@/lib/stripe')
          const stripeApi = _getStripe()

          // (1) Check the underlying PaymentIntent for the onboarding-fee tag.
          if (charge.payment_intent) {
            try {
              const pi = await stripeApi.paymentIntents.retrieve(
                typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent
              )
              if (pi.metadata?.purpose === 'onboarding_fee') {
                isReferralRelevant = true
                detectionReason = 'onboarding_fee_refund'
              }
            } catch (e) {
              console.warn('[stripe-webhook] PI retrieve for refund check failed:', e)
            }
          }

          // (2) If not the onboarding fee, check the invoice. Only the
          // FIRST subscription cycle's invoice is referral-relevant.
          if (!isReferralRelevant && charge.invoice) {
            try {
              const inv = await stripeApi.invoices.retrieve(
                typeof charge.invoice === 'string' ? charge.invoice : charge.invoice
              )
              if (inv.billing_reason === 'subscription_create') {
                isReferralRelevant = true
                detectionReason = 'first_invoice_refund'
              } else if (inv.billing_reason === 'subscription_cycle') {
                // Cycle invoices: only the FIRST cycle invoice is
                // referral-relevant. We refine this below using the
                // referral's credited_at timestamp — if it's within
                // 35 days of the charge, we assume it's the cycle
                // that triggered the credit and claw back. Otherwise
                // it's a routine month-N refund that shouldn't touch
                // referrals. Actual refinement happens after we look
                // up the referral row below.
                detectionReason = 'cycle_invoice_pending_check'
                isReferralRelevant = true  // tentative; gated again later
              }
            } catch (e) {
              console.warn('[stripe-webhook] invoice retrieve for refund check failed:', e)
            }
          }
        } catch (e) {
          console.error('[stripe-webhook] refund-relevance check failed:', e)
        }

        if (!isReferralRelevant) {
          console.log('[stripe-webhook] charge.refunded ignored for referrals:', detectionReason, charge.id)
          await supabase
            .from('stripe_events')
            .update({ processed: true, processed_at: new Date().toISOString() })
            .eq('stripe_event_id', eventId)
          break
        }

        try {
          // Find the referee client by stripe_customer_id.
          const { data: referee } = await supabase
            .from('clients')
            .select('id, name, referred_by_client_id')
            .eq('stripe_customer_id', charge.customer)
            .maybeSingle()

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ref = referee as any
          if (ref?.id && ref?.referred_by_client_id) {
            // Find the referral row.
            const { data: referral } = await supabase
              .from('referrals')
              .select('id, status, credit_amount_pence, referrer_client_id, stripe_balance_txn_id, credited_at')
              .eq('referee_client_id', ref.id)
              .maybeSingle()

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const r = referral as any

            // Refinement for the cycle-invoice case: only claw back if
            // the referral was credited recently. Round-3 fix #8: window
            // is env-configurable for non-monthly billing plans (annual
            // would need 365+ days). Default = 35 days = 1 monthly cycle
            // + grace.
            const clawbackWindowDays = Math.max(
              1,
              parseInt(process.env.REFERRAL_CLAWBACK_WINDOW_DAYS || '35', 10)
            )
            const clawbackWindowMs = clawbackWindowDays * 24 * 60 * 60 * 1000
            if (
              r?.status === 'credited'
              && detectionReason === 'cycle_invoice_pending_check'
              && r.credited_at
              && (Date.now() - new Date(r.credited_at).getTime()) > clawbackWindowMs
            ) {
              console.log(`[stripe-webhook] cycle invoice refund > ${clawbackWindowDays}d after credit — skipping clawback`, r.id)
              await supabase
                .from('stripe_events')
                .update({ processed: true, processed_at: new Date().toISOString() })
                .eq('stripe_event_id', eventId)
              break
            }

            if (r?.status === 'credited') {
              // Find the referrer's stripe_customer_id.
              const { data: referrer } = await supabase
                .from('clients')
                .select('stripe_customer_id')
                .eq('id', r.referrer_client_id)
                .maybeSingle()
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const refr = referrer as any

              if (refr?.stripe_customer_id) {
                // Apply a POSITIVE balance txn equal to the credit we
                // gave them — net zero. Idempotency key per referral so
                // a webhook retry doesn't double-clawback.
                //
                // Round-3 fix #4: if the Stripe API call FAILS, do NOT
                // mark the referral 'reversed'. Previously we'd update
                // the row regardless, leaving us in a state where we
                // believe the credit was reversed but Stripe still has
                // a £150 negative balance the referrer can spend. Worse
                // than not trying. Instead: log to integration_signals
                // + dispatch a P1 agent_alert for human follow-up.
                const { getStripe: _getStripe } = await import('@/lib/stripe')
                let clawbackSucceeded = false
                let clawbackErrorMsg: string | null = null
                try {
                  await _getStripe().customers.createBalanceTransaction(
                    refr.stripe_customer_id,
                    {
                      amount: Math.abs(r.credit_amount_pence),
                      currency: 'gbp',
                      description: `Nexley AI referral credit reversed \u2014 referee refunded`,
                      metadata: {
                        referral_id: r.id,
                        referee_client_id: ref.id,
                        original_balance_txn: r.stripe_balance_txn_id || '',
                        refund_charge_id: charge.id,
                      },
                    },
                    { idempotencyKey: `referral-clawback-${r.id}` }
                  )
                  clawbackSucceeded = true
                } catch (e) {
                  clawbackErrorMsg = e instanceof Error ? e.message : 'unknown stripe error'
                  console.error('[stripe-webhook] referral clawback FAILED:', clawbackErrorMsg)
                }

                if (clawbackSucceeded) {
                  // Mark referral reversed only when we've actually
                  // succeeded at reversing the customer balance txn.
                  await supabase
                    .from('referrals')
                    .update({
                      status: 'reversed',
                      reversed_at: new Date().toISOString(),
                      stripe_refund_id: charge.id,
                    })
                    .eq('id', r.id)
                  console.log('[stripe-webhook] referral clawed back for', ref.id)
                } else {
                  // Surface the failure: P1 alert to Light + a signal
                  // row so the SLO dashboard can flag it. The referral
                  // stays 'credited' so a retry (manual or via another
                  // refund event) can re-attempt.
                  try {
                    await supabase.from('integration_signals').insert({
                      source: 'stripe',
                      kind: 'referral_clawback_failed',
                      external_id: r.id,
                      raw: {
                        referral_id: r.id,
                        referee_client_id: ref.id,
                        referrer_client_id: r.referrer_client_id,
                        refund_charge_id: charge.id,
                        amount_pence: r.credit_amount_pence,
                        error: clawbackErrorMsg,
                      },
                      occurred_at: new Date().toISOString(),
                    })
                  } catch { /* swallow — secondary failure shouldn't crash webhook */ }

                  try {
                    const { dispatchAgentAlert } = await import('@/lib/agent-alerts')
                    await dispatchAgentAlert({
                      target: 'light',
                      priority: 'P1',
                      category: 'referral_clawback_failed',
                      subject: `Referral clawback failed for ${ref.name || ref.id}`,
                      body: [
                        `A refund triggered an attempted clawback of a £${(r.credit_amount_pence / 100).toFixed(0)} referral credit, but the Stripe API call FAILED.`,
                        ``,
                        `**Referral:** ${r.id}`,
                        `**Referee:** ${ref.name || ref.id}`,
                        `**Charge:** ${charge.id}`,
                        `**Stripe error:** ${clawbackErrorMsg || 'unknown'}`,
                        ``,
                        `The referrer's customer balance is UNCHANGED — they still have the £${(r.credit_amount_pence / 100).toFixed(0)} credit. Investigate and either:`,
                        `1. Manually reverse the balance via Stripe dashboard, then UPDATE referrals SET status='reversed', reversed_at=NOW(), stripe_refund_id='${charge.id}' WHERE id='${r.id}', OR`,
                        `2. Let the referrer keep the credit (mark as goodwill).`,
                      ].join('\n'),
                      source: 'stripe-webhook:charge.refunded',
                      clientId: ref.id,
                      meta: { referral_id: r.id, error: clawbackErrorMsg },
                    })
                  } catch { /* swallow */ }
                }
              }
            }
          }
        } catch (e) {
          console.error('[stripe-webhook] charge.refunded handler error:', e)
        }

        await supabase
          .from('stripe_events')
          .update({ processed: true, processed_at: new Date().toISOString() })
          .eq('stripe_event_id', eventId)

        break
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
