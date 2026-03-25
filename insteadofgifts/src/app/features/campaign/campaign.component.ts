import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { CampaignService } from '../../core/services/campaign.service';
import {
  SupabaseService,
  ContributionWithCampaign,
} from '../../core/services/supabase.service';
import { Campaign } from '../../core/models/campaign.model';
import { ButtonComponent } from '../../shared/components/button/button.component';

/** Contribution row enriched with resolved campaign metadata. */
interface ActivityItem extends ContributionWithCampaign {
  campaignTitle: string;
  campaignSlug: string;
}

@Component({
  selector: 'app-campaign',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ButtonComponent],
  templateUrl: './campaign.component.html',
  styleUrl: './campaign.component.scss',
})
export class CampaignComponent implements OnInit {
  private readonly campaignSvc = inject(CampaignService);
  private readonly supabaseSvc = inject(SupabaseService);

  // ── Raw state ──────────────────────────────────────────────────────────────
  readonly campaigns           = signal<Campaign[]>([]);
  readonly items               = signal<ActivityItem[]>([]);
  readonly selectedCampaignId  = signal<string | null>(null);
  readonly loading             = signal(true);
  readonly error               = signal<string | null>(null);

  // ── Derived ────────────────────────────────────────────────────────────────

  /** Items visible in the list — the selected campaign filter or all. */
  readonly filtered = computed(() => {
    const id = this.selectedCampaignId();
    return id ? this.items().filter((i) => i.campaignId === id) : this.items();
  });

  /** Summary stats always reflect the full dataset regardless of filter. */
  readonly stats = computed(() => {
    const all = this.items();
    return {
      totalRaised:      all.reduce((sum, i) => sum + i.amount, 0),
      count:            all.length,
      activeCampaigns:  this.campaigns().filter((c) => c.status !== 'closed').length,
    };
  });

  /** Title of the currently-selected campaign, or null when "All" is active. */
  readonly selectedCampaignTitle = computed(() => {
    const id = this.selectedCampaignId();
    if (!id) return null;
    return this.campaigns().find((c) => c.id === id)?.title ?? null;
  });

  /** Contribution count per campaign — used on filter chips. */
  readonly countByCampaign = computed(() => {
    const map = new Map<string, number>();
    for (const item of this.items()) {
      map.set(item.campaignId, (map.get(item.campaignId) ?? 0) + 1);
    }
    return map;
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async ngOnInit(): Promise<void> {
    try {
      const campaigns = await this.campaignSvc.getOwnCampaigns();
      this.campaigns.set(campaigns);

      if (campaigns.length) {
        const raw = await this.supabaseSvc.getContributionsForCampaigns(
          campaigns.map((c) => c.id),
        );

        // Build a lookup map for O(1) campaign resolution
        const campaignMap = new Map(campaigns.map((c) => [c.id, c]));

        this.items.set(
          raw
            .filter((r) => campaignMap.has(r.campaignId))
            .map((r) => ({
              ...r,
              campaignTitle: campaignMap.get(r.campaignId)!.title,
              campaignSlug:  campaignMap.get(r.campaignId)!.slug,
            })),
        );
      }
    } catch {
      this.error.set('Failed to load activity. Please refresh the page.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  selectCampaign(id: string | null): void {
    this.selectedCampaignId.set(id);
  }

  // ── Template helpers ───────────────────────────────────────────────────────

  avatarLetter(name: string | null): string {
    return name ? name.charAt(0).toUpperCase() : '?';
  }

  formatAmount(major: number, currency = 'USD'): string {
    try {
      return new Intl.NumberFormat('en-US', {
        style:                 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(major);
    } catch {
      return `$${major.toFixed(2)}`;
    }
  }

  formatRelativeTime(iso: string): string {
    const diff = Date.now() - Date.parse(iso);
    if (isNaN(diff)) return '';
    const mins = Math.floor(diff / 60_000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7)  return `${days}d ago`;
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  }
}
