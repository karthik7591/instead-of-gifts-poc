import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser, DatePipe, NgOptimizedImage } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { CampaignService } from '../../../core/services/campaign.service';
import {
  SupabaseService,
  CampaignTotals,
  ContributionDisplay,
} from '../../../core/services/supabase.service';
import { Campaign } from '../../../core/models/campaign.model';
import { ProgressBarComponent } from '../../../shared/components/progress-bar/progress-bar.component';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { QrCodeComponent } from '../../../shared/components/qr-code/qr-code.component';

@Component({
  selector: 'app-campaign-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ProgressBarComponent, ButtonComponent, DatePipe, QrCodeComponent, NgOptimizedImage],
  templateUrl: './campaign-view.component.html',
  styleUrl: './campaign-view.component.scss',
})
export class CampaignViewComponent implements OnInit {
  private readonly route        = inject(ActivatedRoute);
  private readonly router       = inject(Router);
  private readonly campaignSvc  = inject(CampaignService);
  private readonly supabaseSvc  = inject(SupabaseService);
  private readonly platformId   = inject(PLATFORM_ID);

  // ── State signals ──────────────────────────────────────────────────────────
  readonly campaign       = signal<Campaign | null>(null);
  readonly totals         = signal<CampaignTotals>({ total: 0, totalPence: 0, count: 0 });
  readonly contributions  = signal<ContributionDisplay[]>([]);
  readonly loading        = signal(true);
  readonly error          = signal<string | null>(null);
  readonly copySuccess    = signal(false);
  readonly showThankYou   = signal(false);

  private sortContributionsDesc(items: ContributionDisplay[]): ContributionDisplay[] {
    return [...items].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  readonly liveCampaign = computed<Campaign | null>(() => {
    const c = this.campaign();
    return c ? { ...c, amountCollected: this.totals().totalPence } : null;
  });

  readonly isClosed = computed(() => this.campaign()?.status === 'closed');

  readonly campaignUrl = computed(() => {
    if (!isPlatformBrowser(this.platformId)) return '';
    const c = this.campaign();
    return c ? `${window.location.origin}/campaigns/${c.slug}` : '';
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async ngOnInit(): Promise<void> {
    const slug = this.route.snapshot.paramMap.get('id') ?? '';

    // Show thank-you popup when Stripe redirects back after a successful payment.
    // Read session_id BEFORE stripping query params — it's the Stripe Checkout Session ID
    // injected by {CHECKOUT_SESSION_ID} in the success URL.
    const wasContributed = this.route.snapshot.queryParamMap.get('contributed') === 'true';
    const sessionId      = this.route.snapshot.queryParamMap.get('session_id') ?? null;
    if (wasContributed) {
      this.showThankYou.set(true);
      // this.router.navigate([], {
      //   relativeTo: this.route,
      //   queryParams: { contributed: null, session_id: null },
      //   queryParamsHandling: 'merge',
      //   replaceUrl: true,
      // });
    }

    try {
      const c = await this.campaignSvc.getCampaignBySlug(slug);
      if (!c) { this.error.set('Campaign not found.'); return; }

      // Parallel fetch of totals and recent contributions
      const [initial, contribs] = await Promise.all([
        this.supabaseSvc.getCampaignTotals(c.id),
        this.supabaseSvc.getContributions(c.id, 10),
      ]);

      this.campaign.set(c);
      this.totals.set(initial);
      this.contributions.set(this.sortContributionsDesc(contribs));

      // Post-payment: write the contribution row to Supabase and refresh the view.
      //
      // Primary path  — session_id present (Stripe injected it via {CHECKOUT_SESSION_ID}):
      //   Call confirm-contribution, which verifies the payment with Stripe and upserts
      //   the contributions row synchronously. Then re-fetch to show the updated totals.
      //
      // Fallback path — no session_id (old links, direct navigation):
      //   The async Stripe webhook will eventually write the row. Re-fetch after 3 s.
      if (wasContributed) {
        if (sessionId) {
          try {
            await this.supabaseSvc.confirmContribution(sessionId);
          } catch { /* webhook will handle it if the Edge Function fails */ }

          try {
            const [refreshedTotals, refreshedContribs] = await Promise.all([
              this.supabaseSvc.getCampaignTotals(c.id),
              this.supabaseSvc.getContributions(c.id, 10),
            ]);
            this.totals.set(refreshedTotals);
            this.contributions.set(this.sortContributionsDesc(refreshedContribs));
          } catch { /* silent */ }
        } else {
          setTimeout(async () => {
            try {
              const [refreshedTotals, refreshedContribs] = await Promise.all([
                this.supabaseSvc.getCampaignTotals(c.id),
                this.supabaseSvc.getContributions(c.id, 10),
              ]);
              this.totals.set(refreshedTotals);
              this.contributions.set(this.sortContributionsDesc(refreshedContribs));
            } catch { /* silent */ }
          }, 3000);
        }
      }
    } catch (e) {
      this.error.set('Failed to load campaign.');
      console.error(e);
    } finally {
      this.loading.set(false);
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  async copyLink(): Promise<void> {
    const url = this.campaignUrl();
    if (!url || !isPlatformBrowser(this.platformId)) return;
    try {
      await navigator.clipboard.writeText(url);
      this.copySuccess.set(true);
      setTimeout(() => this.copySuccess.set(false), 2500);
    } catch {
      // Fallback: select a temporary input
      const el = document.createElement('input');
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      this.copySuccess.set(true);
      setTimeout(() => this.copySuccess.set(false), 2500);
    }
  }

  dismissThankYou(): void {
    this.showThankYou.set(false);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  formatAmount(major: number, currency = 'USD'): string {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(major);
    } catch {
      return `${currency} ${major.toFixed(2)}`;
    }
  }

}
