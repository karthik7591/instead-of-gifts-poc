import { createClient } from 'npm:@supabase/supabase-js@2';

const PAYPAL_CLIENT_ID = Deno.env.get('PAYPAL_CLIENT_ID') ?? 'paypal_dummy_client_id';
const PAYPAL_CLIENT_SECRET = Deno.env.get('PAYPAL_CLIENT_SECRET') ?? 'paypal_dummy_secret';
const PAYPAL_BASE_URL = (Deno.env.get('PAYPAL_BASE_URL') ?? 'https://api-m.sandbox.paypal.com').replace(/\/$/, '');

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

  if (usingPlaceholderCredentials()) {
    return respond(500, {
      error: 'PayPal campaign checkout is configured with placeholder credentials. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET first.',
    });
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
    const accessToken = await getPayPalAccessToken();
    const orderResponse = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            custom_id: user.id,
            description: 'One prepaid credit to create a Campaign Pro campaign.',
            amount: {
              currency_code: 'USD',
              value: '9.99',
            },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: 'InsteadOfGifts',
              landing_page: 'LOGIN',
              user_action: 'PAY_NOW',
              shipping_preference: 'NO_SHIPPING',
              return_url: `${successUrl}${successUrl.includes('?') ? '&' : '?'}provider=paypal`,
              cancel_url: `${cancelUrl}${cancelUrl.includes('?') ? '&' : '?'}provider=paypal`,
            },
          },
        },
      }),
    });

    const order = await orderResponse.json();
    if (!orderResponse.ok) {
      return respond(500, { error: formatPayPalError(order, 'Failed to create PayPal checkout.') });
    }

    const approvalUrl = Array.isArray(order.links)
      ? order.links.find((link: { rel?: string }) => link.rel === 'approve')?.href
      : null;

    if (!order.id || !approvalUrl) {
      return respond(500, { error: 'PayPal order response missing approval URL.' });
    }

    return respond(200, { url: approvalUrl, orderId: order.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return respond(500, { error: message });
  }
});

async function getPayPalAccessToken(): Promise<string> {
  const auth = btoa(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`);
  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(formatPayPalError(data, 'Failed to authenticate with PayPal.'));
  }
  return data.access_token as string;
}

function usingPlaceholderCredentials(): boolean {
  return PAYPAL_CLIENT_ID === 'paypal_dummy_client_id'
    || PAYPAL_CLIENT_SECRET === 'paypal_dummy_secret';
}

function formatPayPalError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const errorPayload = payload as {
      message?: string;
      error_description?: string;
      details?: Array<{ issue?: string; description?: string }>;
    };
    const detail = errorPayload.details?.[0];
    return errorPayload.message
      || errorPayload.error_description
      || detail?.description
      || detail?.issue
      || fallback;
  }
  return fallback;
}

function respond(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
