import { createClient } from 'npm:@supabase/supabase-js@2';

const PAYPAL_CLIENT_ID = Deno.env.get('PAYPAL_CLIENT_ID') ?? 'paypal_dummy_client_id';
const PAYPAL_CLIENT_SECRET = Deno.env.get('PAYPAL_CLIENT_SECRET') ?? 'paypal_dummy_secret';
const PAYPAL_BASE_URL = (Deno.env.get('PAYPAL_BASE_URL') ?? 'https://api-m.sandbox.paypal.com').replace(/\/$/, '');

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_ANON_KEY') ?? '',
);

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (req.method !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  if (usingPlaceholderCredentials()) {
    return respond(500, {
      error: 'PayPal is configured with placeholder credentials. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET first.',
    });
  }

  let body: {
    campaignId: string;
    amountPence: number;
    contributorName: string;
    message: string;
    isAnonymous: boolean;
    successUrl: string;
    cancelUrl: string;
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

  if (!campaignId || typeof campaignId !== 'string') {
    return respond(400, { error: 'campaignId is required' });
  }
  if (typeof amountPence !== 'number' || amountPence < 100) {
    return respond(400, { error: 'amountPence must be at least 100 ($1.00)' });
  }
  if (!successUrl || !cancelUrl) {
    return respond(400, { error: 'successUrl and cancelUrl are required' });
  }

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id, title, is_active')
    .eq('id', campaignId)
    .single();

  if (campaignError || !campaign) {
    return respond(404, { error: 'Campaign not found' });
  }

  if (!campaign.is_active) {
    return respond(400, { error: 'Campaign is no longer accepting contributions' });
  }

  try {
    const accessToken = await getPayPalAccessToken();
    const amountValue = (amountPence / 100).toFixed(2);

    const paypalResponse = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            custom_id: campaignId,
            description: `Contribution to ${campaign.title}`.slice(0, 127),
            amount: {
              currency_code: 'USD',
              value: amountValue,
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
              return_url: successUrl,
              cancel_url: cancelUrl,
            },
          },
        },
      }),
    });

    const order = await paypalResponse.json();
    if (!paypalResponse.ok) {
      return respond(500, { error: formatPayPalError(order, 'Failed to create PayPal order.') });
    }

    const approvalUrl = Array.isArray(order.links)
      ? order.links.find((link: { rel?: string }) => link.rel === 'approve')?.href
      : null;

    if (!order.id || !approvalUrl) {
      return respond(500, { error: 'PayPal order response missing approval URL.' });
    }

    const { error: insertError } = await supabaseAdmin
      .from('contributions')
      .upsert(
        {
          campaign_id: campaignId,
          amount: amountPence / 100,
          contributor_name: contributorName || null,
          message: message || null,
          is_anonymous: isAnonymous,
          payment_provider: 'paypal',
          payment_reference: order.id,
          stripe_pi_id: null,
          status: 'pending',
        },
        { onConflict: 'payment_provider,payment_reference' },
      );

    if (insertError) {
      return respond(500, { error: `Failed to store PayPal contribution: ${insertError.message}` });
    }

    return respond(200, { orderId: order.id, approvalUrl }, true);
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

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
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
