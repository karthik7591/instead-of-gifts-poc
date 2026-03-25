/**
 * Supabase Edge Function: confirm-contribution
 *
 * Called by the Angular frontend immediately after Stripe redirects back to
 * the success URL with ?contributed=true&session_id={CHECKOUT_SESSION_ID}.
 *
 * Flow:
 *   1. Receive the Stripe Checkout Session ID from the frontend.
 *   2. Retrieve and verify the session from Stripe (payment_status must be 'paid').
 *   3. Upsert the contribution row in Supabase using the session metadata.
 *
 * This makes the DB update immediate rather than dependent on the async
 * stripe-webhook delivery. The operation is idempotent — if the webhook
 * already ran, the upsert is a no-op (ON CONFLICT stripe_pi_id DO UPDATE).
 *
 * Runtime: Deno (Supabase Edge Runtime)
 * Auth: verify_jwt = false — the Stripe session ID is the proof of payment;
 *       we verify it with the Stripe API before writing anything.
 */

import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';

// Allow calling this function without a valid Supabase JWT.
// We verify payment by retrieving the Stripe Checkout Session server-side.
export const config = { verify_jwt: false };

// ---------------------------------------------------------------------------
// Initialise clients once (module-level — reused across warm invocations)
// ---------------------------------------------------------------------------

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  httpClient: Stripe.createFetchHttpClient(),
  apiVersion: '2025-03-31.basil',
});

/** Service-role client bypasses RLS for the upsert. */
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')              ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
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
  let body: { sessionId: string };
  try {
    body = await req.json();
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { sessionId } = body;
  if (!sessionId || typeof sessionId !== 'string') {
    return respond(400, { error: 'sessionId is required' });
  }

  // ── Retrieve and verify the Checkout Session from Stripe ──────────────────
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[confirm-contribution] Stripe retrieve error:', msg);
    return respond(400, { error: `Invalid session: ${msg}` });
  }

  // Skip Pro subscription sessions — handled separately by stripe-webhook
  if (session.metadata?.['type'] === 'pro_subscription') {
    return respond(200, { skipped: true }, true);
  }

  if (session.payment_status !== 'paid') {
    console.warn(`[confirm-contribution] Session ${sessionId} not paid (${session.payment_status})`);
    return respond(400, { error: `Payment not completed (status: ${session.payment_status})` });
  }

  const piId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id;

  if (!piId) {
    return respond(400, { error: 'No payment_intent on session' });
  }

  // ── Extract contribution details from session metadata ────────────────────
  const meta = session.metadata ?? {};
  const campaignId = meta['campaign_id'];

  if (!campaignId) {
    console.warn(`[confirm-contribution] No campaign_id in metadata for session ${sessionId}`);
    return respond(400, { error: 'No campaign_id in session metadata' });
  }

  const amountPence     = parseInt(meta['amount_pence'] ?? '0', 10);
  const amountMajor     = amountPence / 100;
  const contributorName = meta['contributor_name'] || null;
  const message         = meta['message'] || null;
  const isAnonymous     = meta['is_anonymous'] === 'true';

  // ── Upsert the contribution row (idempotent) ──────────────────────────────
  const { error } = await supabase
    .from('contributions')
    .upsert(
      {
        campaign_id:      campaignId,
        amount:           amountMajor,
        contributor_name: contributorName,
        message,
        is_anonymous:     isAnonymous,
        stripe_pi_id:     piId,
        status:           'succeeded',
      },
      { onConflict: 'stripe_pi_id' },
    );

  if (error) {
    console.error('[confirm-contribution] Supabase upsert error:', error.message);
    return respond(500, { error: `Database error: ${error.message}` });
  }

  console.log(
    `[confirm-contribution] ✓ Contribution confirmed for campaign ${campaignId}, ` +
    `stripe_pi_id=${piId}, amount=${amountMajor}`,
  );

  return respond(200, { confirmed: true }, true);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
    'Access-Control-Max-Age': '86400',
  };
}

function respond(
  status: number,
  body: Record<string, unknown>,
  cors = true,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(cors ? corsHeaders() : {}),
    },
  });
}
