-- =============================================================================
-- Migration: user_profiles
-- Stores per-user metadata including Pro subscription status and Stripe IDs.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id                     uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_pro                 boolean     NOT NULL DEFAULT false,
  stripe_customer_id     text,
  stripe_subscription_id text,
  pro_since              timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- ── Auto-provision a profile row whenever a new user signs up ──────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id)
  VALUES (new.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own profile"
  ON public.user_profiles FOR SELECT
  USING (auth.uid() = id);

-- Users cannot update is_pro themselves — only the service-role webhook can.
-- They CAN update other innocuous columns if we add them later.
CREATE POLICY "Service role can do anything"
  ON public.user_profiles FOR ALL
  USING    (current_setting('role') = 'service_role')
  WITH CHECK (current_setting('role') = 'service_role');
