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

  try {
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      return respond(500, { error: `Failed to load user profile: ${profileError.message}` });
    }

    let customerId = profile?.stripe_customer_id as string | undefined;
    customerId = await ensureStripeCustomer(stripe, supabase, user.id, user.email ?? null, customerId);

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
  } catch (error: unknown) {
    return respond(500, { error: formatStripeError(error, 'Failed to start Stripe checkout.') });
  }
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

async function ensureStripeCustomer(
  stripe: Stripe,
  supabase: ReturnType<typeof createClient>,
  userId: string,
  email: string | null,
  existingCustomerId?: string,
): Promise<string> {
  if (existingCustomerId) {
    try {
      const customer = await stripe.customers.retrieve(existingCustomerId);
      if (!('deleted' in customer) || !customer.deleted) {
        return existingCustomerId;
      }
    } catch (error: unknown) {
      if (!isMissingCustomerError(error)) {
        throw error;
      }
    }
  }

  const customer = await stripe.customers.create({
    email: email ?? undefined,
    metadata: { supabase_user_id: userId },
  });

  const { error: customerSaveError } = await supabase
    .from('user_profiles')
    .upsert({ id: userId, stripe_customer_id: customer.id });

  if (customerSaveError) {
    throw new Error(`Failed to store Stripe customer: ${customerSaveError.message}`);
  }

  return customer.id;
}

function isMissingCustomerError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const stripeError = error as { code?: string; message?: string };
  return stripeError.code === 'resource_missing'
    || stripeError.message?.includes('No such customer') === true;
}

function formatStripeError(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }

  return fallback;
}
