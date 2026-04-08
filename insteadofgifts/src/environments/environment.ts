import { publish } from "rxjs";

/** Supabase project API URL (Auth, REST, Realtime, Storage). Single source of truth. */
const supabaseProjectUrl = 'https://mmvabtwjneyrptdmtass.supabase.co';

export const environment = {
  production: false,
  supabase: {
    url: supabaseProjectUrl,
    anonKey: 'sb_publishable_pIR-Mu_88Rjd9oDo2QJdOw_x0FJjRR2',
  },
  stripe: {
    // publishableKey: 'pk_test_51TEB69C2K9QKQDaRNPJCKeBVKslg6bduyTI7eUCAWvdJhyHc9M45NZDkFsO70kbPIVoyPyQtyrG3u14D9PNWIAYH00uMp0jtpI',
    // publishableKey: 'pk_test_51TEyiSCLVeQmeNHJPVrUahDMwTQVitf6rhO0BFN0A5ECQ9pLmrMMW587Q2jSBuLyTyNW3VtoMgkDONVmhWBGaQoT00TGASlnZV',
    publishableKey: 'pk_test_51TEj2wKPfi0NJ0mnhOHkRLGQLjRJtHjZvngjgTBqBp7FPA4R1lS3TTDxc5CQDNp1UPQCDN64XKwQpCN4HX2L2GYa00KLEtoXPy', //developer@insteadofgifts.com
  },
  paypal: {
    clientId: 'AYloqzb9C8jsFWuL5B5WR8hXrIWHtImNXIEMziOtF1A--s6ksFBcjfbKVkHXI0IKdD7ET8g4xzuagToH',
    environment: 'sandbox',
  },
  /**
   * Edge Functions base URL. Use local Supabase CLI (`supabase start`) for dev,
   * or `${supabase.url}/functions/v1` to call functions on the hosted project.
   */
  // apiUrl: 'http://localhost:54321/functions/v1',
  apiUrl: `${supabaseProjectUrl.replace(/\/$/, '')}/functions/v1`,
};
