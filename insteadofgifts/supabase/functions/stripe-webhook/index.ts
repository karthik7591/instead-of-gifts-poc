/**
 * Supabase Edge Function: stripe-webhook
 *
 * Receives POST events from Stripe, verifies the signature, and updates
 * the database in response to payment lifecycle events.
 *
 * Runtime: Deno (Supabase Edge Runtime)
 * Handles:
 *   - checkout.session.completed        → upsert contribution (one-off)
 *                                          OR activate Pro subscription
 *   - payment_intent.succeeded          → status = 'succeeded'  (fallback / direct PI flow)
 *   - payment_intent.payment_failed     → status = 'failed'
 *   - customer.subscription.deleted     → revoke Pro (is_pro = false)
 */

import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// Initialise clients once (module-level — reused across warm invocations)
// ---------------------------------------------------------------------------

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  // Edge Runtime uses the global fetch — tell Stripe not to look for Node's http
  httpClient: Stripe.createFetchHttpClient(),
  apiVersion: '2025-03-31.basil',
});

/** Service-role client bypasses RLS — used only for the status update. */
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')         ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // ── Method guard ──────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  // ── Signature verification ────────────────────────────────────────────────
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    console.warn('[stripe-webhook] Missing stripe-signature header');
    return respond(400, { error: 'Missing stripe-signature header' });
  }

  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
  if (!webhookSecret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set');
    return respond(500, { error: 'Webhook secret not configured' });
  }

  // Must read the raw body *before* any parsing — Stripe signs the raw bytes.
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    // constructEventAsync uses Web Crypto (available in Deno) instead of
    // Node's crypto module, which is not available in Edge Runtime.
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[stripe-webhook] Signature verification failed:', message);
    return respond(400, { error: `Webhook signature verification failed: ${message}` });
  }

  console.log(`[stripe-webhook] Received event: ${event.type} (${event.id})`);

  // ── Event dispatch ────────────────────────────────────────────────────────
  try {
    switch (event.type) {

      // Preferred path when using Stripe Checkout Sessions
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;

        // ── Pro subscription checkout ──────────────────────────────────────
        if (session.metadata?.['type'] === 'pro_subscription') {
          await activateProSubscription(session);
          break;
        }

        // ── One-off contribution checkout ─────────────────────────────────
        if (session.payment_status !== 'paid') {
          // e.g. bank transfer — payment not yet captured; ignore for now
          console.log(`[stripe-webhook] Session ${session.id} not yet paid (${session.payment_status}), skipping`);
          break;
        }

        const piId = typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id;

        if (!piId) {
          console.warn(`[stripe-webhook] No payment_intent on session ${session.id}`);
          break;
        }

        await upsertContributionFromSession(session, piId);
        break;
      }

      // Fallback: direct Payment Intent flow (or PI confirmation from Checkout)
      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const updated = await updateContribution(pi.id, 'succeeded', { amountReceived: pi.amount_received });
        if (!updated) {
          await upsertContributionFromPaymentIntent(pi);
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const reason = pi.last_payment_error?.message ?? 'unknown';
        console.warn(`[stripe-webhook] Payment failed for PI ${pi.id}: ${reason}`);
        await updateContribution(pi.id, 'failed');
        break;
      }

      // Pro subscription cancelled / expired — revoke Pro access
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        await revokeProSubscription(sub);
        break;
      }

      default:
        // Acknowledge all other events — do not return 4xx or Stripe will retry
        console.log(`[stripe-webhook] Unhandled event type: ${event.type} — acknowledged`);
    }

    return respond(200, { received: true, eventId: event.id });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[stripe-webhook] Error processing event ${event.id}:`, message);
    // Return 500 so Stripe knows to retry
    return respond(500, { error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

type ContributionStatus = 'succeeded' | 'failed';

/**
 * Activates Pro for the user identified in the checkout session metadata.
 * Sets `is_pro = true` and stores the subscription ID on `user_profiles`.
 */
async function activateProSubscription(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const userId = session.metadata?.['supabase_user_id'];
  if (!userId) {
    console.warn(`[stripe-webhook] No supabase_user_id in metadata for session ${session.id}`);
    return;
  }

  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id;

  console.log(`[stripe-webhook] Activating Pro for user ${userId} (subscription ${subscriptionId})`);

  const { error } = await supabase
    .from('user_profiles')
    .upsert(
      {
        id:                     userId,
        is_pro:                 true,
        stripe_subscription_id: subscriptionId ?? null,
        pro_payment_provider:   'stripe',
        pro_since:              new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

  if (error) {
    throw new Error(`Failed to activate Pro for user ${userId}: ${error.message}`);
  }

  console.log(`[stripe-webhook] ✓ Pro activated for user ${userId}`);
}

/**
 * Revokes Pro when a subscription is cancelled or expires.
 * Matches by stripe_subscription_id stored on user_profiles.
 */
async function revokeProSubscription(sub: Stripe.Subscription): Promise<void> {
  console.log(`[stripe-webhook] Revoking Pro for subscription ${sub.id}`);

  const { error } = await supabase
    .from('user_profiles')
    .update({ is_pro: false, stripe_subscription_id: null, pro_payment_provider: null })
    .eq('stripe_subscription_id', sub.id);

  if (error) {
    throw new Error(`Failed to revoke Pro for subscription ${sub.id}: ${error.message}`);
  }

  console.log(`[stripe-webhook] ✓ Pro revoked for subscription ${sub.id}`);
}

/**
 * Primary path for checkout.session.completed:
 * Reads contribution details from the Stripe session metadata (written by the
 * create-checkout-session Edge Function) and upserts a contributions row.
 *
 * Using upsert (ON CONFLICT stripe_pi_id DO UPDATE) makes the handler
 * idempotent — safe if Stripe re-delivers the same event.
 */
async function upsertContributionFromSession(
  session: Stripe.Checkout.Session,
  stripePiId: string,
): Promise<void> {
  const meta = session.metadata ?? {};
  const campaignId = meta['campaign_id'];

  if (!campaignId) {
    // Metadata absent — fall back to status-only update (direct PI flow or
    // legacy sessions created before metadata was added).
    console.warn(
      `[stripe-webhook] No campaign_id in metadata for session ${session.id}; ` +
      'falling back to status-update-by-pi-id'
    );
    await updateContribution(stripePiId, 'succeeded');
    return;
  }

  const amountPence    = parseInt(meta['amount_pence'] ?? '0', 10);
  const amountMajor    = amountPence / 100;
  const contributorName = meta['contributor_name'] || null;
  const message         = meta['message'] || null;
  const isAnonymous     = meta['is_anonymous'] === 'true';

  console.log(
    `[stripe-webhook] Upserting contribution stripe_pi_id=${stripePiId} ` +
    `campaign=${campaignId} amount=${amountMajor}`
  );

  const { data, error } = await supabase
    .from('contributions')
    .upsert(
      {
        campaign_id:      campaignId,
        amount:           amountMajor,
        contributor_name: contributorName,
        message,
        is_anonymous:     isAnonymous,
        payment_provider: 'stripe',
        payment_reference: stripePiId,
        stripe_pi_id:     stripePiId,
        status:           'succeeded',
      },
      { onConflict: 'payment_provider,payment_reference' }
    )
    .select('id, campaign_id, amount')
    .maybeSingle();

  if (error) {
    throw new Error(
      `Supabase upsert failed for stripe_pi_id=${stripePiId}: ${error.message}`
    );
  }

  console.log(
    `[stripe-webhook] ✓ Contribution ${data?.id} ` +
    `(campaign ${data?.campaign_id}, amount ${data?.amount}) upserted to 'succeeded'`
  );
}

/**
 * Secondary fallback path:
 * Creates/updates a contribution from PaymentIntent metadata when
 * checkout.session.completed did not create the row yet.
 */
async function upsertContributionFromPaymentIntent(
  pi: Stripe.PaymentIntent,
): Promise<void> {
  const meta = pi.metadata ?? {};
  const campaignId = meta['campaign_id'];
  if (!campaignId) {
    console.warn(`[stripe-webhook] No campaign_id in PI metadata for ${pi.id}; cannot upsert fallback contribution.`);
    return;
  }

  const amountPence = parseInt(meta['amount_pence'] ?? String(pi.amount_received ?? pi.amount ?? 0), 10);
  const amountMajor = amountPence / 100;
  const contributorName = meta['contributor_name'] || null;
  const message = meta['message'] || null;
  const isAnonymous = meta['is_anonymous'] === 'true';

  const { data, error } = await supabase
    .from('contributions')
    .upsert(
      {
        campaign_id: campaignId,
        amount: amountMajor,
        contributor_name: contributorName,
        message,
        is_anonymous: isAnonymous,
        payment_provider: 'stripe',
        payment_reference: pi.id,
        stripe_pi_id: pi.id,
        status: 'succeeded',
      },
      { onConflict: 'payment_provider,payment_reference' }
    )
    .select('id, campaign_id, amount')
    .maybeSingle();

  if (error) {
    throw new Error(
      `PI metadata upsert failed for stripe_pi_id=${pi.id}: ${error.message}`
    );
  }

  console.log(
    `[stripe-webhook] ✓ Fallback contribution ${data?.id} ` +
    `(campaign ${data?.campaign_id}, amount ${data?.amount}) upserted from PI metadata`
  );
}

/**
 * Updates the status of the contribution matched by `stripe_pi_id`.
 * Uses the service-role client so RLS is bypassed — this function runs
 * server-side only and is protected by Stripe signature verification.
 *
 * Treats "no matching row" as a no-op (logs a warning) rather than throwing,
 * because Stripe may send events for payment intents that were not yet
 * persisted (e.g. a race between the checkout-session creation and the
 * webhook delivery). Stripe will not retry a 200 response, so if the row
 * genuinely never arrives it will remain in its initial state.
 */
async function updateContribution(
  stripePiId: string,
  status: ContributionStatus,
  meta?: Record<string, unknown>,
): Promise<boolean> {
  console.log(`[stripe-webhook] Updating contribution stripe_pi_id=${stripePiId} → ${status}`, meta ?? '');

  const { data, error } = await supabase
    .from('contributions')
    .update({ status })
    .eq('stripe_pi_id', stripePiId)
    .select('id, campaign_id, amount')
    .maybeSingle();  // returns null (not an error) when no row matched

  if (error) {
    throw new Error(`Supabase update failed for stripe_pi_id=${stripePiId}: ${error.message}`);
  }

  if (!data) {
    // No matching row — log but do not throw; return 200 to suppress Stripe retries
    console.warn(`[stripe-webhook] No contribution found for stripe_pi_id=${stripePiId}. ` +
      'The backend may not have persisted the record yet.');
    return false;
  }

  console.log(`[stripe-webhook] ✓ Contribution ${data.id} (campaign ${data.campaign_id}, ` +
    `amount ${data.amount}) updated to '${status}'`);
  return true;
}

// ---------------------------------------------------------------------------
// Response helper
// ---------------------------------------------------------------------------

function respond(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
