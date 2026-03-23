/**
 * Supabase Edge Function: create-checkout-session
 *
 * Creates a Stripe Checkout Session for a campaign contribution and returns
 * the hosted Checkout URL. All contribution details are embedded in the
 * session metadata so the stripe-webhook function can persist the contribution
 * row on payment completion — no pending row is created here.
 *
 * Runtime: Deno (Supabase Edge Runtime)
 * Called by: Angular frontend StripeService.redirectToCheckout()
 *
 * Auth: verify_jwt = false (configured in supabase/config.toml) — this is a
 * public endpoint; security is enforced by validating the campaign exists and
 * is active, plus Stripe's own payment flow.
 */

import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// Initialise clients once (module-level — reused across warm invocations)
// ---------------------------------------------------------------------------

const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
if (!stripeSecretKey) {
  throw new Error(
    'Missing STRIPE_SECRET_KEY environment variable. Set it before running this function.',
  );
}

const stripe = new Stripe(stripeSecretKey, {
  httpClient: Stripe.createFetchHttpClient(),
  apiVersion: '2025-03-31.basil',
});

/** Anon client — only used to read public campaign data. */
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')      ?? '',
  Deno.env.get('SUPABASE_ANON_KEY') ?? '',
);

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // ── CORS preflight ─────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (req.method !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: {
    campaignId:      string;
    amountPence:     number;
    contributorName: string;
    message:         string;
    isAnonymous:     boolean;
    successUrl:      string;
    cancelUrl:       string;
  };

  try {
    body = await req.json();
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const {
    campaignId,
    amountPence,
    contributorName,
    message,
    isAnonymous,
    successUrl,
    cancelUrl,
  } = body;

  // ── Validate inputs ────────────────────────────────────────────────────────
  if (!campaignId || typeof campaignId !== 'string') {
    return respond(400, { error: 'campaignId is required' });
  }
  if (typeof amountPence !== 'number' || amountPence < 100) {
    return respond(400, { error: 'amountPence must be at least 100 ($1.00)' });
  }
  if (!successUrl || !cancelUrl) {
    return respond(400, { error: 'successUrl and cancelUrl are required' });
  }

  // ── Validate campaign ──────────────────────────────────────────────────────
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id, title, is_active')
    .eq('id', campaignId)
    .single();

  if (campaignError || !campaign) {
    console.warn('[create-checkout-session] Campaign not found:', campaignId);
    return respond(404, { error: 'Campaign not found' });
  }

  if (!campaign.is_active) {
    return respond(400, { error: 'Campaign is no longer accepting contributions' });
  }

  // ── Create Stripe Checkout Session ─────────────────────────────────────────
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      // Force fixed USD pricing (disable Stripe local-currency conversion).
      adaptive_pricing: { enabled: false },
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Contribution to ${campaign.title}`,
            },
            unit_amount: amountPence,
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url:  cancelUrl,
      // Embed all contribution details so the webhook can persist the row
      // once Stripe confirms payment. Stripe metadata values must be strings.
      metadata: {
        campaign_id:      campaignId,
        contributor_name: (contributorName ?? '').slice(0, 255),
        message:          (message ?? '').slice(0, 500),
        is_anonymous:     isAnonymous ? 'true' : 'false',
        amount_pence:     String(amountPence),
      },
      // Mirror contribution metadata onto the PaymentIntent so we can recover
      // in payment_intent.succeeded if checkout.session.completed is delayed/missed.
      payment_intent_data: {
        metadata: {
          campaign_id:      campaignId,
          contributor_name: (contributorName ?? '').slice(0, 255),
          message:          (message ?? '').slice(0, 500),
          is_anonymous:     isAnonymous ? 'true' : 'false',
          amount_pence:     String(amountPence),
        },
      },
    });

    console.log(
      `[create-checkout-session] Created session ${session.id} ` +
      `for campaign ${campaignId}, amount ${amountPence} cents`
    );

    return respond(200, { url: session.url! }, true);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[create-checkout-session] Stripe error:', msg);
    return respond(500, { error: `Failed to create checkout session: ${msg}` });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  };
}

function respond(
  status: number,
  body: Record<string, unknown>,
  cors = false,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(cors ? corsHeaders() : {}),
    },
  });
}
