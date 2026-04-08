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

  let body: { orderId?: string };
  try {
    body = await req.json();
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const orderId = body.orderId?.trim();
  if (!orderId) {
    return respond(400, { error: 'orderId is required' });
  }

  try {
    const accessToken = await getPayPalAccessToken();
    const order = await captureOrder(orderId, accessToken);
    const status = order.status as string | undefined;
    if (status !== 'COMPLETED') {
      return respond(400, { error: `PayPal order is not completed (status: ${status ?? 'unknown'})` });
    }

    const creditedUserId = getCreditedUserId(order);
    if (!creditedUserId || creditedUserId !== user.id) {
      return respond(403, { error: 'PayPal order does not belong to this user.' });
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
          pro_payment_provider: 'paypal',
          pro_since: new Date().toISOString(),
        },
        { onConflict: 'id' },
      );

    if (updateError) {
      return respond(500, { error: `Failed to add campaign credit: ${updateError.message}` });
    }

    return respond(200, { confirmed: true, orderId, campaignCredits: nextCredits });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return respond(500, { error: message });
  }
});

async function captureOrder(orderId: string, accessToken: string): Promise<Record<string, unknown>> {
  const captureResponse = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  const captureBody = await captureResponse.json();
  if (captureResponse.ok) {
    return captureBody as Record<string, unknown>;
  }

  const issue = getPayPalIssue(captureBody);
  if (issue === 'ORDER_ALREADY_CAPTURED') {
    const orderResponse = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const orderBody = await orderResponse.json();
    if (!orderResponse.ok) {
      throw new Error(formatPayPalError(orderBody, 'Failed to fetch captured PayPal order.'));
    }
    return orderBody as Record<string, unknown>;
  }

  throw new Error(formatPayPalError(captureBody, 'Failed to capture PayPal order.'));
}

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

function getCreditedUserId(order: Record<string, unknown>): string | null {
  const purchaseUnits = Array.isArray(order.purchase_units)
    ? order.purchase_units as Array<{ custom_id?: string }>
    : [];
  return purchaseUnits[0]?.custom_id?.trim() ?? null;
}

function getPayPalIssue(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const details = (payload as { details?: Array<{ issue?: string }> }).details;
  return details?.[0]?.issue ?? null;
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
