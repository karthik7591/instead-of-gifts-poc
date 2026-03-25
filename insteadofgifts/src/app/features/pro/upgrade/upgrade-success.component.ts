import {
  Component,
  OnInit,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ProService } from '../../../core/services/pro.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ButtonComponent } from '../../../shared/components/button/button.component';

/**
 * Shown after Stripe redirects the user back on a successful subscription.
 * Refreshes the Pro status so the app reflects the upgrade immediately.
 */
@Component({
  selector: 'app-upgrade-success',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ButtonComponent],
  template: `
    <div class="success-page">
      <div class="success-card">
        @if (loading()) {
          <svg class="success-spinner" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-label="Loading…">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path  class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
          </svg>
          <p class="success-card__hint">Activating your Pro account…</p>
        } @else {
          <div class="success-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          </div>
          <h1 class="success-card__heading">Welcome to Pro!</h1>
          <p class="success-card__body">
            Your subscription is active. Enjoy unlimited campaigns, cover photos,
            custom messages, QR codes, and more.
          </p>
          <app-button variant="pro" size="md" [routerLink]="['/dashboard']">
            Go to dashboard
          </app-button>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .success-page {
      min-height: 100vh;
      background: var(--color-pale-green, #EAF4DF);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem 1rem;
    }
    .success-card {
      background: #fff;
      border: 1px solid #C8DAC2;
      border-radius: 20px;
      box-shadow: 0 8px 32px rgba(74,114,85,.12);
      padding: 3rem 2.5rem;
      max-width: 420px;
      width: 100%;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.25rem;
    }
    .success-spinner {
      width: 2.5rem;
      height: 2.5rem;
      animation: spin 1s linear infinite;
      color: var(--color-brand-green, #95C476);
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .success-icon {
      width: 4rem;
      height: 4rem;
      border-radius: 50%;
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #16a34a;
      svg { width: 2rem; height: 2rem; }
    }
    .success-card__heading {
      font-size: 1.5rem;
      font-weight: 800;
      color: var(--color-text-dark, #1E2D23);
    }
    .success-card__body {
      font-size: 0.9375rem;
      color: var(--color-text-muted, #6A8272);
      line-height: 1.6;
    }
    .success-card__hint {
      font-size: 0.9375rem;
      color: var(--color-text-muted, #6A8272);
    }
  `],
})
export class UpgradeSuccessComponent implements OnInit {
  private readonly proSvc = inject(ProService);
  private readonly supabase = inject(SupabaseService);
  private readonly route = inject(ActivatedRoute);

  readonly loading = signal(true);

  async ngOnInit(): Promise<void> {
    const sessionId = this.route.snapshot.queryParamMap.get('session_id');
    if (sessionId) {
      // Deterministic post-checkout activation in case webhook delivery is delayed.
      await this.supabase.client.functions.invoke('confirm-subscription', {
        body: { sessionId },
      });
    }

    // Poll briefly to pick up the latest profile state.
    let retries = 3;
    while (retries-- > 0) {
      await this.proSvc.loadProfile();
      if (this.proSvc.isPro()) break;
      await new Promise<void>((r) => setTimeout(r, 1500));
    }
    this.loading.set(false);
  }
}
