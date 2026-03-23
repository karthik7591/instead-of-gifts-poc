import {
  Component,
  inject,
  signal,
  ChangeDetectionStrategy,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { environment } from '../../../../environments/environment';

interface PlanFeature {
  label:    string;
  free:     boolean | string;
  pro:      boolean | string;
  proNote?: string;
}

@Component({
  selector: 'app-upgrade',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ButtonComponent],
  templateUrl: './upgrade.component.html',
  styleUrl:    './upgrade.component.scss',
})
export class UpgradeComponent {
  private readonly supabase   = inject(SupabaseService);
  private readonly router     = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  readonly loading = signal(false);
  readonly error   = signal<string | null>(null);

  readonly features: PlanFeature[] = [
    { label: 'Gift campaigns',         free: 'Up to 3',   pro: 'Unlimited'  },
    { label: 'Contribution tracking',  free: true,        pro: true         },
    { label: 'Real-time updates',      free: true,        pro: true         },
    { label: 'Share link',             free: true,        pro: true         },
    { label: 'Cover photo upload',     free: false,       pro: true         },
    { label: 'Custom thank-you message', free: false,     pro: true         },
    { label: 'QR code on dashboard',   free: false,       pro: true         },
    { label: 'Campaign deadline',      free: false,       pro: true         },
    { label: 'Priority support',       free: false,       pro: true         },
  ];

  async onUpgrade(): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || this.loading()) return;

    this.loading.set(true);
    this.error.set(null);

    try {
      const { data: { session } } = await this.supabase.client.auth.getSession();
      if (!session) {
        await this.router.navigate(['/login']);
        return;
      }

      const origin     = window.location.origin;
      const successUrl = `${origin}/pro/upgrade/success`;
      const cancelUrl  = `${origin}/pro/upgrade`;

      const res = await fetch(`${environment.apiUrl}/stripe-subscription`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ successUrl, cancelUrl }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }

      const { url } = await res.json() as { url: string };
      window.location.href = url;

    } catch (err: unknown) {
      this.error.set(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      this.loading.set(false);
    }
  }
}
