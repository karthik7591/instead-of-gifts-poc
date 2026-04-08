import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import { Router } from '@angular/router';
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

  readonly campaignCredits = inject(ProService).campaignCredits;

  readonly features: PlanFeature[] = [
    { label: 'Create one campaign', included: true },
    { label: 'Cover photo upload', included: true },
    { label: 'Custom thank-you message', included: true },
    { label: 'QR code on dashboard', included: true },
    { label: 'Campaign deadline', included: true },
    { label: 'Priority support', included: true },
  ];

  async onUpgrade(): Promise<void> {
    await this.router.navigate(['/pro/upgrade/payment']);
  }
}
