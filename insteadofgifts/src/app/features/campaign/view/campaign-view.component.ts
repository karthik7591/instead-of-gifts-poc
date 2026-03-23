import {
  Component,
  OnInit,
  OnDestroy,
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
export class CampaignViewComponent implements OnInit, OnDestroy {
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

  private unsubscribe?: () => void;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async ngOnInit(): Promise<void> {
    const slug = this.route.snapshot.paramMap.get('id') ?? '';

    // Show thank-you banner when Stripe redirects back after a successful payment,
    // then strip the query param so a page refresh doesn't re-show it.
    const wasContributed = this.route.snapshot.queryParamMap.get('contributed') === 'true';
    if (wasContributed) {
      this.showThankYou.set(true);
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { contributed: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
      setTimeout(() => this.showThankYou.set(false), 6000);
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
      this.contributions.set(contribs);

      // Post-payment race condition: Stripe redirects before the webhook fires,
      // so the initial fetch may have captured stale totals. Re-fetch after 3s
      // (enough time for the webhook to write the contribution row) and again
      // at 8s as a safety net for slow webhook delivery.
      if (wasContributed) {
        for (const delay of [3000, 8000]) {
          setTimeout(async () => {
            try {
              const [refreshedTotals, refreshedContribs] = await Promise.all([
                this.supabaseSvc.getCampaignTotals(c.id),
                this.supabaseSvc.getContributions(c.id, 10),
              ]);
              this.totals.set(refreshedTotals);
              this.contributions.set(refreshedContribs);
            } catch { /* silent — realtime will catch it if the webhook fires later */ }
          }, delay);
        }
      }

      // Realtime: only subscribe to live updates for active campaigns
      if (c.status !== 'closed') {
        this.unsubscribe = this.supabaseSvc.subscribeToContributions(
          c.id,
          (payload) => {
            const incoming = Number(payload.new.amount);

            // Update running totals
            this.totals.update((prev) => ({
              total:      prev.total + incoming,
              totalPence: Math.round((prev.total + incoming) * 100),
              count:      prev.count + 1,
            }));

            // Prepend to visible list if not anonymous
            if (!payload.new.is_anonymous) {
              const newEntry: ContributionDisplay = {
                id:              payload.new.id,
                contributorName: payload.new.contributor_name,
                amount:          incoming,
                message:         payload.new.message,
                createdAt:       payload.new.created_at,
              };
              this.contributions.update((prev) => [newEntry, ...prev].slice(0, 10));
            }
          }
        );
      }
    } catch (e) {
      this.error.set('Failed to load campaign.');
      console.error(e);
    } finally {
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
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
