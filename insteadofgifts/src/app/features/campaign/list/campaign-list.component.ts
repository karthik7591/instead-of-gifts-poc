import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Campaign } from '../../../core/models/campaign.model';
import { CampaignService } from '../../../core/services/campaign.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { CampaignCardComponent } from '../../../shared/components/campaign-card/campaign-card.component';

@Component({
  selector: 'app-campaign-list',
  standalone: true,
  imports: [CampaignCardComponent],
  templateUrl: './campaign-list.component.html',
  styleUrl: './campaign-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CampaignListComponent implements OnInit {
  private readonly campaignSvc = inject(CampaignService);
  private readonly supabaseSvc = inject(SupabaseService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly campaigns = signal<Campaign[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly activeCount = computed(() => this.campaigns().length);

  async ngOnInit(): Promise<void> {
    try {
      const campaigns = await this.campaignSvc.getActiveCampaigns();
      const totals = await Promise.all(
        campaigns.map((campaign) => this.supabaseSvc.getCampaignTotals(campaign.id))
      );

      this.campaigns.set(
        campaigns.map((campaign, index) => ({
          ...campaign,
          amountCollected: totals[index]?.totalPence ?? 0,
        }))
      );
    } catch (error) {
      console.error(error);
      this.error.set('Failed to load active campaigns.');
    } finally {
      this.loading.set(false);
    }
  }

  async onShare(campaign: Campaign): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const url = `${window.location.origin}/campaigns/${campaign.slug}`;
    const shareData: ShareData = {
      title: campaign.title,
      text: `Contribute to "${campaign.title}"`,
      url,
    };

    if ('share' in navigator && navigator.canShare?.(shareData)) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const el = document.createElement('input');
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
  }
}
