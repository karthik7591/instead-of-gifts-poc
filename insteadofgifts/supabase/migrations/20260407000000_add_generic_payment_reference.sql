alter table public.contributions
  alter column stripe_pi_id drop not null;

alter table public.contributions
  add column if not exists payment_provider varchar,
  add column if not exists payment_reference varchar;

update public.contributions
set
  payment_provider = coalesce(payment_provider, 'stripe'),
  payment_reference = coalesce(payment_reference, stripe_pi_id)
where stripe_pi_id is not null;

create unique index if not exists idx_contributions_payment_provider_reference
  on public.contributions (payment_provider, payment_reference)
  where payment_provider is not null and payment_reference is not null;

comment on column public.contributions.payment_provider is
  'Payment processor used for the contribution, e.g. stripe or paypal.';

comment on column public.contributions.payment_reference is
  'Provider-specific unique payment reference, such as a Stripe PaymentIntent id or PayPal order id.';
