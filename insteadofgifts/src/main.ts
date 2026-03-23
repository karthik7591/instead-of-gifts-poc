import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { environment } from './environments/environment';

/** DNS + connection hints for the Supabase project host (from environment, not hardcoded in index.html). */
function addSupabaseResourceHints(): void {
  const raw = environment.supabase.url?.trim();
  if (!raw || raw === 'YOUR_SUPABASE_URL') return;
  let origin: string;
  try {
    origin = new URL(raw).origin;
  } catch {
    return;
  }
  const pre = document.createElement('link');
  pre.rel = 'preconnect';
  pre.href = origin;
  document.head.appendChild(pre);
  const dns = document.createElement('link');
  dns.rel = 'dns-prefetch';
  dns.href = origin;
  document.head.appendChild(dns);
}

addSupabaseResourceHints();

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
