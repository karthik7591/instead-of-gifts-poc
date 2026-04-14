import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  httpClient: Stripe.createFetchHttpClient(),
  apiVersion: '2025-03-31.basil',
});

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

const CORS_HEADERS: HeadersInit = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  if (!STRIPE_SECRET_KEY) {
    return respond(500, { error: 'Stripe is not configured. Set STRIPE_SECRET_KEY in Supabase secrets.' });
  }

  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return respond(401, { error: 'Missing Authorization header' });
  }
  const jwt = authHeader.slice(7);
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !user) {
    return respond(401, { error: 'Invalid or expired token' });
  }

  let body: { sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }
  const sessionId = body.sessionId?.trim();
  if (!sessionId) {
    return respond(400, { error: 'sessionId is required' });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    console.log('[confirm-stripe-campaign-payment] Retrieved session', {
      sessionId,
      mode: session.mode,
      paymentStatus: session.payment_status,
      paymentIntent: typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? null,
      metaUserId: session.metadata?.['supabase_user_id'] ?? null,
      userId: user.id,
    });
    if (session.mode !== 'payment') {
      return respond(400, { error: 'Checkout session is not a one-time payment' });
    }
    if (session.payment_status !== 'paid') {
      return respond(409, { error: 'Payment is not completed yet' });
    }

    const metaUserId = session.metadata?.['supabase_user_id'];
    if (metaUserId && metaUserId !== user.id) {
      return respond(403, { error: 'Session does not belong to this user' });
    }

    const { data, error: grantError } = await supabase
      .rpc('grant_campaign_credit_if_unprocessed', {
        p_user_id: user.id,
        p_payment_provider: 'stripe',
        p_payment_reference: session.id,
        p_granted_credits: 1,
        p_pro_payment_provider: 'stripe',
        p_pro_since: new Date().toISOString(),
      })
      .single();

    if (grantError) {
      console.error('[confirm-stripe-campaign-payment] Failed to grant campaign credit', {
        sessionId,
        userId: user.id,
        message: grantError.message,
        code: grantError.code ?? null,
        details: grantError.details ?? null,
        hint: grantError.hint ?? null,
      });
      return respond(500, { error: `Failed to add campaign credit: ${grantError.message}` });
    }

    const grantResult = (data ?? null) as { applied?: boolean; campaign_pro_credits?: number } | null;
    const applied = grantResult?.applied ?? false;
    const campaignCredits = grantResult?.campaign_pro_credits ?? 0;

    console.log('[confirm-stripe-campaign-payment] Credit grant result', {
      sessionId,
      userId: user.id,
      applied,
      campaignCredits,
    });

    return respond(200, { ok: true, applied, campaignCredits });
  } catch (error: unknown) {
    const message = formatStripeError(error, 'Failed to confirm Stripe payment.');
    console.error('[confirm-stripe-campaign-payment] Unhandled error', {
      sessionId,
      userId: user.id,
      message,
    });
    return respond(500, { error: message });
  }
});

function respond(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function formatStripeError(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }

  return fallback;
}
