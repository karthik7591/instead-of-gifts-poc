alter table public.user_profiles
  add column if not exists paypal_subscription_id text,
  add column if not exists pro_payment_provider text;

comment on column public.user_profiles.paypal_subscription_id is
  'PayPal Billing Subscription ID for Pro plans.';

comment on column public.user_profiles.pro_payment_provider is
  'Provider currently backing Pro access, e.g. stripe or paypal.';
