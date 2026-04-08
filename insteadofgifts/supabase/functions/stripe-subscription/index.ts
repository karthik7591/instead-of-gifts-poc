import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
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

  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return respond(401, { error: 'Missing Authorization header' });
  }
  const jwt = authHeader.slice(7);

  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !user) {
    return respond(401, { error: 'Invalid or expired token' });
  }

  let body: { successUrl?: string; cancelUrl?: string };
  try {
    body = await req.json();
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const successUrl = body.successUrl?.trim();
  const cancelUrl = body.cancelUrl?.trim();
  if (!successUrl || !cancelUrl) {
    return respond(400, { error: 'successUrl and cancelUrl are required' });
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .maybeSingle();

  let customerId = profile?.stripe_customer_id as string | undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;

    await supabase
      .from('user_profiles')
      .upsert({ id: user.id, stripe_customer_id: customerId });
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'payment',
    payment_method_types: ['card'],
    adaptive_pricing: { enabled: false },
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Campaign Creation Credit',
            description: 'One prepaid credit to create a Campaign Pro campaign.',
          },
          unit_amount: 999,
        },
        quantity: 1,
      },
    ],
    metadata: {
      supabase_user_id: user.id,
      type: 'campaign_creation_credit',
    },
    allow_promotion_codes: true,
    success_url: buildSuccessUrl(successUrl),
    cancel_url: cancelUrl,
  });

  return respond(200, { url: session.url! });
});

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
