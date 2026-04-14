## Architecture Overview

`insteadofgifts` is an Angular 19 single-page app backed by Supabase:

- Frontend (Angular): routing + UI pages implemented as standalone components.
- Backend (Supabase):
  - Postgres tables/views with RLS policies.
  - Supabase Storage bucket for campaign cover photos.
  - Supabase Edge Functions for Stripe/PayPal checkout, confirmation, and Stripe Connect.

The core product is: organisers create campaigns, contributors donate via Stripe, and the app persists outcomes to Postgres.

## Repository Layout

- `src/` (frontend)
  - `src/app/app.routes.ts`: top-level routing and route-guard wiring.
  - `src/app/core/`: singleton services (Supabase/Auth/Campaign/Pro/Stripe) plus HTTP interceptor and guards.
  - `src/app/features/`: page-level components (home, campaign CRUD, contribute, dashboard, pro upgrade).
  - `src/styles.scss`: Tailwind setup + global accessibility styles.
- `supabase/` (backend)
  - `supabase/functions/*/index.ts`: Edge Functions.
  - `supabase/migrations/*.sql`: Postgres schema, views, RLS policies, and realtime configuration.
  - `supabase/config.toml`: Edge Function verify_jwt configuration for local dev.

## Frontend Architecture (Angular)

### Routing

Routing is configured in `src/app/app.routes.ts`:

- Main layout routes (nav/footer placeholder in `src/app/layouts/main-layout/*`):
  - `/` -> `src/app/features/home/home.component`
  - `/campaigns` -> campaign routes:
    - `/campaigns/new`
    - `/campaigns/:id` (view)
    - `/campaigns/:id/edit` (edit)
  - `/dashboard` (protected by `authGuard`)
  - `/pro/upgrade` (Pro upgrade flow)
- Minimal layout route:
  - `/contribute/:slug` -> `ContributeComponent`
- Auth routes:
  - `/login` (protected by `unauthGuard`)
  - `/auth/callback` -> `AuthCallbackComponent`

Route protection:

- `src/app/core/guards/auth.guard.ts`: blocks unauthenticated users from dashboard and campaign CRUD.
- `src/app/core/guards/unauth.guard.ts`: blocks authenticated users from the login page.
- `src/app/core/guards/pro.guard.ts`: blocks access to Pro-only features if `ProService.isPro` is false.

### Singleton Services and Responsibilities

All app data access is centralized in `src/app/core/services/*`:

- `SupabaseService` (`src/app/core/services/supabase.service.ts`)
  - Owns the Supabase client (`createClient(environment.supabase.url, environment.supabase.anonKey)`).
  - Reads campaign totals and recent contributions.
  - Calls the Edge Function `confirm-contribution` to persist contributions immediately after checkout success redirect.
- `AuthService` (`src/app/core/services/auth.service.ts`)
  - Wraps Supabase Auth sign-in/sign-up/sign-out.
  - Exposes `user` as a reactive signal.
- `CampaignService` (`src/app/core/services/campaign.service.ts`)
  - Campaign CRUD operations against the `campaigns` table.
  - Uploads cover images to the `campaign-images` Storage bucket via Supabase Storage.
  - Enforces slug uniqueness (client-side retry + DB existence checks).
  - Converts between frontend “pence/cents” amounts and DB “major currency units”.
- `ProService` (`src/app/core/services/pro.service.ts`)
  - Maintains `isPro` based on `user_profiles.is_pro`.
  - Re-loads profile on auth state changes and after upgrades.
- `StripeService` (`src/app/core/services/stripe.service.ts`)
  - Creates Stripe Checkout sessions indirectly by calling Edge Function endpoints through `HttpClient`.
  - Currently used for the one-off donation flow via `create-checkout-session`.
- `ToastService` and `httpErrorInterceptor`
  - Toasts for user-friendly error messages.
  - `src/app/core/interceptors/http-error.interceptor.ts` maps HTTP status codes to messages for Angular `HttpClient` calls.

### Key Frontend Flows

1. Create Campaign (organiser)
   - Route: `/campaigns/new`
   - UI: `CampaignCreateComponent`
   - Backend writes:
     - `CampaignService.createCampaign()` inserts into `public.campaigns`.
     - If a cover image is provided and user is Pro, the image is uploaded to `storage.objects` in bucket `campaign-images`, then `campaigns.cover_image_url` is updated.

2. Contribute (public donation)
   - Route: `/contribute/:slug`
   - UI: `ContributeComponent`
   - Backend calls:
     - `StripeService.redirectToCheckout()` calls Edge Function `create-checkout-session`.
     - Stripe hosts the payment page.
   - Post-success persistence:
     - Route: back to `/campaigns/:id` with `?contributed=true&session_id={CHECKOUT_SESSION_ID}`.
     - `CampaignViewComponent` calls `SupabaseService.confirmContribution(sessionId)`.
     - `confirm-contribution` verifies the Stripe session and upserts `public.contributions`.

3. Campaign credit purchase
   - Route: `/pro/upgrade`
   - UI: `UpgradeComponent`
   - Backend calls:
     - Invokes Edge Function `stripe-campaign-payment` to create a one-time Stripe Checkout session.
   - Post-success activation:
     - Route: `/pro/upgrade/success` (shows UI and immediately invokes `confirm-stripe-campaign-payment` with `session_id`).
     - `ProService` then reloads `user_profiles.campaign_pro_credits`.

## Backend Architecture (Supabase)

### Database Schema

Migrations define three main tables/views:

- `public.campaigns` (from `supabase/migrations/20240001000000_create_campaigns_and_contributions.sql` and updated later)
  - Organiser-created campaigns.
  - Includes:
    - `is_active` (public availability flag)
    - `is_pro` (controls feature availability)
    - `slug` (public URL identifier)
    - `target_amount` and `deadline`
    - `cover_image_url`, `custom_message`, and `fund_use` (added in `20260326000100_add_fund_use_to_campaigns.sql`)

- `public.contributions`
  - Donation rows recorded after Stripe payment.
  - Key fields:
    - `campaign_id` FK
    - `amount` (decimal, major currency units)
    - `stripe_pi_id` (unique PaymentIntent ID)
    - `status` (enum-like values: `pending`, `succeeded`, `failed`)
    - `is_anonymous` and `contributor_name` (name is masked publicly when anonymous)

- `public.user_profiles`
  - Supabase “profile” extension for subscription state.
  - Key fields:
    - `is_pro`
    - `stripe_customer_id`, `stripe_subscription_id`
    - `pro_since`
    - `campaign_pro_credits`

Public data is exposed via a view:

- `public.contributions_public` (from `20240001000001_rls_policies_and_storage.sql`)
  - Redacts `contributor_name` when `is_anonymous` is true.
  - Frontend queries the view (`SupabaseService` uses `from('contributions_public')`).

### Storage

- Bucket: `campaign-images` created by `20240001000001_rls_policies_and_storage.sql`
- Public read:
  - Anyone can download objects from this bucket (`storage_campaign_images_select_public`).
- Authenticated write:
  - Uploads are restricted so users can only write inside:
    - `campaign-images/<auth.uid()>/<filename>`

### Row-Level Security (RLS)

RLS policies enforce the security invariants:

- Campaigns
  - Public can select only active campaigns (`is_active = true`).
  - Owners can also read their inactive campaigns and can insert/update/delete only their own rows (`created_by = auth.uid()`).
- Contributions
  - Public can select succeeded contributions on active campaigns (and contributor name masking is applied via `contributions_public` view).
  - The backend updates contributions via the service-role key, bypassing RLS.
- user_profiles
  - Users can read their own profile row.
  - Users cannot self-edit `is_pro` (and other pro-affecting fields).
  - Edge Functions perform upserts using the service-role key.

### Edge Functions (Stripe + Supabase)

Edge Functions live in `supabase/functions/*/index.ts`.

1. `create-checkout-session`
   - Caller: Angular `StripeService` via `POST {environment.apiUrl}/create-checkout-session`
   - Config: `supabase/config.toml` sets `verify_jwt = false`.
   - Responsibilities:
     - Validate `campaigns` exists and `is_active = true`.
     - Create Stripe Checkout Session (mode `payment`) for a donation.
     - Embed contribution data in Stripe `metadata` (campaign_id, contributor_name, message, is_anonymous, amount_pence).
   - Returns: `{ url: session.url }` for the frontend to redirect to.

2. `confirm-contribution`
   - Caller: Angular `CampaignViewComponent` after redirect success.
   - Config: `verify_jwt = false` (payment proof comes from Stripe session verification).
   - Responsibilities:
     - Retrieve Checkout Session from Stripe.
     - Require `payment_status === 'paid'`.
     - Upsert `public.contributions` using session metadata.
     - Idempotency: upserts are keyed by `stripe_pi_id` (unique).

3. `stripe-webhook`
   - Caller: Stripe (server-to-server) with `stripe-signature` verification.
   - Responsibilities:
     - Handle `checkout.session.completed`:
       - If metadata represents a campaign credit payment: update `user_profiles` credits/payment fields.
       - Otherwise: upsert donation contributions after `payment_status === 'paid'`.
     - Handle `payment_intent.succeeded` / `payment_intent.payment_failed` to update contributions status.
     - Handle other Stripe events needed by the active payment flows.

4. `stripe-campaign-payment`
   - Caller: Angular `UpgradePaymentComponent`.
   - Responsibilities:
     - Authenticate the user (the function validates JWT internally).
     - Create or reuse the Stripe customer (`user_profiles.stripe_customer_id`).
     - Create a one-time Stripe Checkout session (mode `payment`) for one campaign credit.
     - Returns `{ url }` for the frontend to redirect.

5. `confirm-stripe-campaign-payment`
   - Caller: Angular `UpgradeSuccessComponent` after redirect success.
   - Responsibilities:
     - Authenticate the user (JWT).
     - Retrieve the Checkout Session by `session_id`.
     - Require `payment_status === 'paid'`.
     - Upsert `user_profiles` to add campaign credits and store payment metadata.

### Realtime Note

- Migration `20250325000000_enable_realtime_contributions.sql` and `20250325120000_contributions_select_pending_for_realtime_rls.sql` enable realtime subscriptions for `public.contributions`.
- Current Angular code does not appear to consume realtime changes (it currently fetches totals and contributions directly on page load, and relies on Edge Functions for immediate post-checkout persistence).

## Configuration and Local Development (High Level)

- Frontend config:
  - `src/environments/environment.ts` provides Supabase URL/anon key and Stripe publishable key.
  - `src/app/app.config.ts` wires router, HTTP interceptor, and the Supabase image loader.
- Supabase config:
  - `supabase/config.toml` controls Edge Function `verify_jwt` and supports local `supabase start`.
- Typical local workflow (from `insteadofgifts/package.json`):
  - Frontend: `npm run start` (or `ng serve`)
  - Supabase: `npm run supabase:start`

