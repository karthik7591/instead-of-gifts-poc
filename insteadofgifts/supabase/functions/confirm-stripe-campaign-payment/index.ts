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

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('campaign_pro_credits')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      return respond(500, { error: `Failed to load user profile: ${profileError.message}` });
    }

    const nextCredits = (profile?.campaign_pro_credits ?? 0) + 1;
    const { error: updateError } = await supabase
      .from('user_profiles')
      .upsert(
        {
          id: user.id,
          campaign_pro_credits: nextCredits,
          pro_payment_provider: 'stripe',
          pro_since: new Date().toISOString(),
        },
        { onConflict: 'id' },
      );

    if (updateError) {
      return respond(500, { error: `Failed to add campaign credit: ${updateError.message}` });
    }

    return respond(200, { ok: true, campaignCredits: nextCredits });
  } catch (error: unknown) {
    return respond(500, { error: formatStripeError(error, 'Failed to confirm Stripe payment.') });
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
