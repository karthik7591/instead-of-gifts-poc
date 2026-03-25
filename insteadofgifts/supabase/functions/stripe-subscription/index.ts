/**
 * Supabase Edge Function: stripe-subscription
 *
 * Creates a Stripe Checkout Session in `subscription` mode for the
 * InsteadOfGifts Pro plan ($9.99 / month, USD).
 *
 * Called by the UpgradeComponent with the user's JWT in the Authorization header.
 *
 * POST body:
 *   { successUrl: string, cancelUrl: string }
 *
 * Response:
 *   { url: string }   — the Stripe Checkout hosted page URL
 *
 * Runtime: Deno (Supabase Edge Runtime)
 */

import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// Clients (module-level — reused across warm invocations)
// ---------------------------------------------------------------------------

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  httpClient: Stripe.createFetchHttpClient(),
  apiVersion: '2025-03-31.basil',
});

/** Service-role client — bypasses RLS to read/write user_profiles. */
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')              ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

const CORS_HEADERS: HeadersInit = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // Pre-flight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  // ── Authenticate via user JWT ────────────────────────────────────────────
  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return respond(401, { error: 'Missing Authorization header' });
  }
  const jwt = authHeader.slice(7);

  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !user) {
    return respond(401, { error: 'Invalid or expired token' });
  }

  // ── Parse body ───────────────────────────────────────────────────────────
  let body: { successUrl?: string; cancelUrl?: string };
  try {
    body = await req.json();
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { successUrl, cancelUrl } = body;
  if (!successUrl || !cancelUrl) {
    return respond(400, { error: 'successUrl and cancelUrl are required' });
  }
  const successUrlWithSession = buildSuccessUrl(successUrl);

  // ── Retrieve or create Stripe customer ───────────────────────────────────
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('stripe_customer_id, is_pro')
    .eq('id', user.id)
    .maybeSingle();

  // Guard: already Pro
  if (profile?.is_pro) {
    return respond(409, { error: 'User already has an active Pro subscription' });
  }

  let customerId = profile?.stripe_customer_id as string | undefined;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email:    user.email,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;

    // Persist the customer ID so future calls reuse it
    await supabase
      .from('user_profiles')
      .upsert({ id: user.id, stripe_customer_id: customerId });
  }

  // ── Create the Checkout Session ──────────────────────────────────────────
  const session = await stripe.checkout.sessions.create({
    customer:             customerId,
    mode:                 'subscription',
    payment_method_types: ['card'],
    // Force fixed USD pricing (disable Stripe local-currency conversion).
    adaptive_pricing:     { enabled: false },
    line_items: [
      {
        price_data: {
          currency:     'usd',
          product_data: {
            name:        'InsteadOfGifts Pro',
            description: 'Monthly Pro subscription — unlimited campaigns, custom messages, QR codes, and more.',
            images:      [],
          },
          unit_amount: 999,               // $9.99 in cents
          recurring:   { interval: 'month' },
        },
        quantity: 1,
      },
    ],
    metadata: {
      supabase_user_id: user.id,
      type:             'pro_subscription',
    },
    allow_promotion_codes: true,
    success_url:           successUrlWithSession,
    cancel_url:            cancelUrl,
  });

  console.log(
    `[stripe-subscription] Created checkout session ${session.id} ` +
    `for user ${user.id} (customer ${customerId})`
  );

  return respond(200, { url: session.url! });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function respond(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function buildSuccessUrl(successUrl: string): string {
  const separator = successUrl.includes('?') ? '&' : '?';
  return `${successUrl}${separator}session_id={CHECKOUT_SESSION_ID}`;
}
