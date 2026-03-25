import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';

import { CampaignService } from '../../core/services/campaign.service';
import {
  SupabaseService,
  CampaignTotals,
  ContributionDisplay,
} from '../../core/services/supabase.service';
import { AuthService } from '../../core/services/auth.service';
import { ProService } from '../../core/services/pro.service';
import { Campaign } from '../../core/models/campaign.model';
import { ButtonComponent } from '../../shared/components/button/button.component';
import { SkeletonLoaderComponent } from '../../shared/components/skeleton-loader/skeleton-loader.component';
import { QrCodeComponent } from '../../shared/components/qr-code/qr-code.component';

export interface DashboardRow {
  campaign:         Campaign;
  totals:           CampaignTotals;
  campaignUrl:      string;
  copySuccess:      boolean;
  closing:          boolean;
  deleting:         boolean;
  imageUploadOpen:  boolean;
}

interface DashboardActivity {
  id: string;
  campaignId: string;
  campaignTitle: string;
  contributorName: string;
  amount: number; // major currency units
  currency: string;
  createdAt: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ButtonComponent, SkeletonLoaderComponent, QrCodeComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  private readonly campaignSvc = inject(CampaignService);
  private readonly supabaseSvc = inject(SupabaseService);
  private readonly authSvc     = inject(AuthService);
  private readonly proSvc      = inject(ProService);
  private readonly platformId  = inject(PLATFORM_ID);

  /** Expose to template for the upgrade banner. */
  readonly isPro = this.proSvc.isPro;

  // ── State ──────────────────────────────────────────────────────────────────
  readonly rows    = signal<DashboardRow[]>([]);
  readonly loading = signal(true);
  readonly error   = signal<string | null>(null);
  readonly signingOut = signal(false);
  readonly recentActivity = signal<DashboardActivity[]>([]);
  readonly baseHost = signal('insteadofgifts.com');

  readonly greetingName = computed(() => {
    const name = this.rows()[0]?.campaign.organiserName?.trim();
    if (!name) return 'there';
    return name.split(' ')[0];
  });

  // ── Summary stats (live — recomputes whenever any totals change) ───────────
  readonly summaryStats = computed(() => {
    const rows = this.rows();
    return {
      totalCampaigns:     rows.length,
      activeCampaigns:    rows.filter(r => r.campaign.status !== 'closed').length,
      totalRaisedPence:   rows.reduce((sum, r) => sum + r.totals.totalPence, 0),
      totalContributions: rows.reduce((sum, r) => sum + r.totals.count,      0),
      currency:           'USD',
    };
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async ngOnInit(): Promise<void> {
    try {
      const campaigns = await this.campaignSvc.getOwnCampaigns();

      // Parallel fetch of live totals
      const totalsArr = await Promise.all(
        campaigns.map((c) => this.supabaseSvc.getCampaignTotals(c.id))
      );

      const origin = isPlatformBrowser(this.platformId) ? window.location.origin : '';

      this.rows.set(
        campaigns.map((c, i) => ({
          campaign:        c,
          totals:          totalsArr[i],
          campaignUrl:     origin ? `${origin}/campaigns/${c.slug}` : '',
          copySuccess:     false,
          closing:         false,
          deleting:        false,
          imageUploadOpen: false,
        }))
      );

      // Fetch recent non-anonymous contributions for dashboard activity.
      const recentByCampaign = await Promise.all(
        campaigns.map(async (c) => {
          try {
            const items = await this.supabaseSvc.getContributions(c.id, 5);
            return { campaign: c, items };
          } catch {
            return { campaign: c, items: [] as ContributionDisplay[] };
          }
        })
      );

      const activity = recentByCampaign
        .flatMap(({ campaign, items }) =>
          items.map((item) => ({
            id: item.id,
            campaignId: campaign.id,
            campaignTitle: campaign.title,
            contributorName: item.contributorName ?? 'Someone',
            amount: item.amount,
            currency: campaign.currency || 'USD',
            createdAt: item.createdAt,
          }))
        )
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, 8);
      this.recentActivity.set(activity);

      if (isPlatformBrowser(this.platformId)) {
        this.baseHost.set(window.location.host.replace(/^www\./, ''));
      }
    } catch (e) {
      this.error.set('Failed to load your campaigns.');
      console.error(e);
    } finally {
      this.loading.set(false);
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  async onCopyLink(campaign: Campaign): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const url = `${window.location.origin}/campaigns/${campaign.slug}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API not available — use legacy execCommand fallback
      const el = document.createElement('input');
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }

    this.updateRow(campaign.id, { copySuccess: true });
    setTimeout(() => this.updateRow(campaign.id, { copySuccess: false }), 2500);
  }

  downloadQrForCampaign(slug: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const canvas = document.querySelector<HTMLCanvasElement>(`#qr-${slug} canvas`);
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `${slug}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  async onShare(campaign: Campaign): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const url = `${window.location.origin}/campaigns/${campaign.slug}`;
    const shareData: ShareData = {
      title: campaign.title,
      text:  `Contribute to "${campaign.title}"`,
      url,
    };

    // Web Share API (mobile / supported browsers)
    if ('share' in navigator && navigator.canShare?.(shareData)) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        // User dismissed the share sheet — no further action needed
        return;
      }
    }

    // Fallback: copy to clipboard and show "Copied!" feedback
    await this.onCopyLink(campaign);
  }

  toggleImageUpload(campaignId: string): void {
    this.rows.update((prev) =>
      prev.map((row) =>
        row.campaign.id === campaignId
          ? { ...row, imageUploadOpen: !row.imageUploadOpen }
          : row
      )
    );
  }

  onCoverImageUploaded(campaignId: string, cdnUrl: string): void {
    this.rows.update((prev) =>
      prev.map((row) =>
        row.campaign.id === campaignId
          ? { ...row, campaign: { ...row.campaign, coverImageUrl: cdnUrl }, imageUploadOpen: false }
          : row
      )
    );
  }

  onCoverImageRemoved(campaignId: string): void {
    this.rows.update((prev) =>
      prev.map((row) =>
        row.campaign.id === campaignId
          ? { ...row, campaign: { ...row.campaign, coverImageUrl: undefined }, imageUploadOpen: false }
          : row
      )
    );
  }

  async onCloseCampaign(campaign: Campaign): Promise<void> {
    this.updateRow(campaign.id, { closing: true });
    try {
      await this.campaignSvc.closeCampaign(campaign.id);
      // Optimistically mark the campaign as closed in the local signal
      this.rows.update((prev) =>
        prev.map((row) => {
          if (row.campaign.id !== campaign.id) return row;
          return {
            ...row,
            campaign: { ...row.campaign, status: 'closed' as const },
            closing:  false,
          };
        })
      );
    } catch (e) {
      console.error('Failed to close campaign', e);
      this.updateRow(campaign.id, { closing: false });
    }
  }

  async onDeleteCampaign(campaign: Campaign): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const confirmed = window.confirm(
      `Delete "${campaign.title}" permanently? This cannot be undone.`
    );
    if (!confirmed) return;

    this.updateRow(campaign.id, { deleting: true });
    try {
      await this.campaignSvc.deleteCampaign(campaign.id);
      this.rows.update((prev) => prev.filter((row) => row.campaign.id !== campaign.id));
      this.recentActivity.update((prev) =>
        prev.filter((item) => item.campaignId !== campaign.id)
      );
    } catch (e) {
      console.error('Failed to delete campaign', e);
      this.updateRow(campaign.id, { deleting: false });
    }
  }

  async onLogout(): Promise<void> {
    if (this.signingOut()) return;
    this.signingOut.set(true);
    try {
      await this.authSvc.signOut();
    } finally {
      this.signingOut.set(false);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  formatCurrency(pence: number, currency = 'USD'): string {
    try {
      return new Intl.NumberFormat(undefined, {
        style:                 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(pence / 100);
    } catch {
      return `${currency} ${(pence / 100).toFixed(2)}`;
    }
  }

  formatMajorCurrency(amount: number, currency = 'USD'): string {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `${currency} ${amount.toFixed(2)}`;
    }
  }

  formatRelativeTime(isoDate: string): string {
    const timestamp = Date.parse(isoDate);
    if (Number.isNaN(timestamp)) return '';
    const diffMs = Date.now() - timestamp;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }

  private updateRow(id: string, patch: Partial<DashboardRow>): void {
    this.rows.update((prev) =>
      prev.map((row) =>
        row.campaign.id === id ? { ...row, ...patch } : row
      )
    );
  }

}
