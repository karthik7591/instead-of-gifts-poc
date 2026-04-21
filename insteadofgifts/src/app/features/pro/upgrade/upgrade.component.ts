import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ProService } from '../../../core/services/pro.service';
import { ButtonComponent } from '../../../shared/components/button/button.component';

interface PlanFeature {
  label: string;
  included: boolean;
}

@Component({
  selector: 'app-upgrade',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent],
  templateUrl: './upgrade.component.html',
  styleUrl: './upgrade.component.scss',
})
export class UpgradeComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly campaignCredits = inject(ProService).campaignCredits;

  readonly freeFeatures: PlanFeature[] = [
    { label: 'Custom title', included: true },
    { label: 'Shareable link', included: true },
    { label: 'Contribution tracking', included: true },
    { label: 'Standard message for fund use', included: true },
    { label: 'Personalized message for fund use', included: false },
    { label: 'QR code', included: false },
    { label: 'Photo', included: false },
  ];

  readonly proFeatures: PlanFeature[] = [
    { label: 'Custom title', included: true },
    { label: 'Shareable link', included: true },
    { label: 'Contribution tracking', included: true },
    { label: 'Personalized message for fund use', included: true },
    { label: 'QR code', included: true },
    { label: 'Photo', included: true },
  ];

  async onContinueFree(): Promise<void> {
    await this.router.navigate(['/campaigns/new']);
  }

  async onUpgrade(): Promise<void> {
    const campaignId = this.route.snapshot.queryParamMap.get('campaignId');
    await this.router.navigate(['/pro/upgrade/payment'], {
      queryParams: campaignId ? { campaignId } : undefined,
    });
  }
}
