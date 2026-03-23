/** Set to your Supabase project URL (Dashboard → Settings → API → Project URL). */
const supabaseProjectUrl = 'YOUR_SUPABASE_URL';

export const environment = {
  production: true,
  supabase: {
    url: supabaseProjectUrl,
    anonKey: 'YOUR_SUPABASE_ANON_KEY',
  },
  stripe: {
    publishableKey: 'YOUR_STRIPE_PUBLISHABLE_KEY',
  },
  /** Derived from the project URL so it never drifts out of sync. */
  apiUrl: `${supabaseProjectUrl.replace(/\/$/, '')}/functions/v1`,
};
