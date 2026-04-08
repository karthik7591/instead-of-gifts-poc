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
import { Campaign, CampaignFundUse } from '../../../core/models/campaign.model';

const FUND_USE_DEFAULT_MESSAGES: Record<CampaignFundUse, string> = {
  educational:
    "In celebrating this milestone we're prioritizing future learning over physical gifts. Contributions toward education are deeply appreciated.",
  personal:
    "In celebrating this milestone, we're choosing to focus on growth and meaningful experiences rather than traditional gifts. Your support is truly appreciated.",
};
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

    // Show thank-you popup when a payment provider redirects back after success.
    const wasContributed = this.route.snapshot.queryParamMap.get('contributed') === 'true';
    const provider       = this.route.snapshot.queryParamMap.get('provider') ?? 'stripe';
    const sessionId      = this.route.snapshot.queryParamMap.get('session_id') ?? null;
    const paypalOrderId  = this.route.snapshot.queryParamMap.get('token')
      ?? this.route.snapshot.queryParamMap.get('order_id')
      ?? null;
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

      // Post-payment: confirm the provider-specific payment and refresh the view.
      if (wasContributed) {
        if ((provider === 'paypal' || provider === 'venmo') && paypalOrderId) {
          try {
            await this.supabaseSvc.confirmPayPalContribution(paypalOrderId);
          } catch { /* silent */ }

          try {
            const [refreshedTotals, refreshedContribs] = await Promise.all([
              this.supabaseSvc.getCampaignTotals(c.id),
              this.supabaseSvc.getContributions(c.id, 10),
            ]);
            this.totals.set(refreshedTotals);
            this.contributions.set(this.sortContributionsDesc(refreshedContribs));
          } catch { /* silent */ }
        } else if (sessionId) {
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

  fundUseDefaultMessage(fundUse: CampaignFundUse): string {
    return FUND_USE_DEFAULT_MESSAGES[fundUse];
  }

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
