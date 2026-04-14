export interface AppEnvironment {
  production: boolean;
  supabase: {
    url: string;
    anonKey: string;
  };
  stripe: {
    publishableKey: string;
  };
  paypal: {
    clientId: string;
    environment: 'sandbox' | 'production';
  };
  apiUrl: string;
}
