import { AppEnvironment } from './environment.model';

/** Development environment. Point this at your dev Supabase/Stripe/PayPal setup. */
const supabaseProjectUrl = 'https://mmvabtwjneyrptdmtass.supabase.co';

export const environment: AppEnvironment = {
  production: false,
  appUrl: 'http://localhost:4200',
  supabase: {
    url: supabaseProjectUrl,
    anonKey: 'sb_publishable_pIR-Mu_88Rjd9oDo2QJdOw_x0FJjRR2',
  },
  stripe: {
    publishableKey: 'pk_test_51TEj2wKPfi0NJ0mnhOHkRLGQLjRJtHjZvngjgTBqBp7FPA4R1lS3TTDxc5CQDNp1UPQCDN64XKwQpCN4HX2L2GYa00KLEtoXPy', //developer@insteadofgifts.com
  },
  paypal: {
    clientId: 'AYloqzb9C8jsFWuL5B5WR8hXrIWHtImNXIEMziOtF1A--s6ksFBcjfbKVkHXI0IKdD7ET8g4xzuagToH',
    environment: 'sandbox',
  },
  /**
   * For local Edge Functions, switch this to `http://localhost:54321/functions/v1`.
   * Otherwise keep it aligned with the dev Supabase project above.
   */
  apiUrl: `${supabaseProjectUrl.replace(/\/$/, '')}/functions/v1`,
};
