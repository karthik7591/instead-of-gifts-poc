import { Component, OnInit, inject, PLATFORM_ID } from '@angular/core';
import { Router } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';
import { SupabaseService } from '../../../core/services/supabase.service';

/**
 * Handles the OAuth and magic-link redirect from Supabase.
 *
 * Supabase's JS client automatically exchanges the code / token from the URL
 * when getSession() is called. This component just waits for that exchange and
 * redirects to /dashboard on success or /login on failure.
 */
@Component({
  selector: 'app-auth-callback',
  standalone: true,
  template: `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#EAF4DF;">
      <svg style="width:2.5rem;height:2.5rem;color:#95C476;animation:spin 1s linear infinite"
           xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-label="Loading…">
        <circle style="opacity:.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
        <path  style="opacity:.75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
      </svg>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    </div>
  `,
})
export class AuthCallbackComponent implements OnInit {
  private readonly supabase   = inject(SupabaseService);
  private readonly router     = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  async ngOnInit(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    // getSession() triggers the PKCE code exchange if a ?code= param is present
    const { data: { session } } = await this.supabase.client.auth.getSession();

    if (session) {
      await this.router.navigate(['/dashboard']);
      return;
    }

    // For implicit-flow tokens in the URL hash, listen for the state change
    const { data: { subscription } } = this.supabase.client.auth.onAuthStateChange(
      async (_event, session) => {
        subscription.unsubscribe();
        await this.router.navigate(session ? ['/dashboard'] : ['/login']);
      }
    );

    // Safety fallback — redirect to login if nothing fires within 5 s
    setTimeout(() => {
      subscription.unsubscribe();
      this.router.navigate(['/login']);
    }, 5000);
  }
}
