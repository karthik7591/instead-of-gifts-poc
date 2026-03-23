import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NgClass, NgOptimizedImage } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Campaign } from '../../../core/models/campaign.model';
import { CampaignTotals } from '../../../core/services/supabase.service';
import { ButtonComponent } from '../button/button.component';
import { ProgressBarComponent } from '../progress-bar/progress-bar.component';
import { QrCodeComponent } from '../qr-code/qr-code.component';

export type CampaignCardMode = 'public' | 'dashboard';

@Component({
  selector: 'app-campaign-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, RouterLink, ButtonComponent, ProgressBarComponent, QrCodeComponent, NgOptimizedImage],
  templateUrl: './campaign-card.component.html',
  styleUrl: './campaign-card.component.scss',
})
export class CampaignCardComponent {
  // ── Common inputs ──────────────────────────────────────────────────────────
  readonly campaign  = input.required<Campaign>();
  readonly mode      = input<CampaignCardMode>('public');

  // ── Public-mode inputs ─────────────────────────────────────────────────────
  readonly showImage = input<boolean>(true);

  // ── Dashboard-mode inputs ──────────────────────────────────────────────────
  /** Live totals for the campaign — drives stats row in dashboard mode. */
  readonly totals      = input<CampaignTotals | null>(null);
  /** Full campaign URL — passed to QrCodeComponent in dashboard mode. */
  readonly campaignUrl = input<string | null>(null);
  /** True briefly after the link is copied — shows "Copied!" feedback. */
  readonly copySuccess = input<boolean>(false);
  /** True while the close-campaign request is in flight. */
  readonly closing     = input<boolean>(false);

  // ── Outputs ────────────────────────────────────────────────────────────────
  /** Fired when the Share button is clicked (both modes). */
  readonly shared = output<Campaign>();
  /** Fired when Copy Link is clicked (dashboard mode). */
  readonly copyLink = output<Campaign>();
  /** Fired when Close Campaign is clicked (dashboard mode). */
  readonly closeCampaign = output<Campaign>();

  // ── Handlers ───────────────────────────────────────────────────────────────

  onShare(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.shared.emit(this.campaign());
  }

  onCopyLink(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.copyLink.emit(this.campaign());
  }

  onCloseCampaign(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.closeCampaign.emit(this.campaign());
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  formatCurrency(major: number, currency = 'USD'): string {
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
