import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
  DestroyRef,
  PLATFORM_ID,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { isPlatformBrowser } from '@angular/common';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { startWith } from 'rxjs';

import { CampaignService } from '../../core/services/campaign.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { StripeService } from '../../core/services/stripe.service';
import { PayPalService } from '../../core/services/paypal.service';
import { PayPalSdkService, PayPalNamespace } from '../../core/services/paypal-sdk.service';
import { Campaign } from '../../core/models/campaign.model';
import { ButtonComponent } from '../../shared/components/button/button.component';

const PRESET_AMOUNTS = [5, 10, 25, 50] as const;
type PresetAmount = (typeof PRESET_AMOUNTS)[number];
type PaymentMethod = 'stripe' | 'paypal' | 'venmo';

interface ContributeForm {
  name:        FormControl<string>;
  message:     FormControl<string>;
  isAnonymous: FormControl<boolean>;
}

@Component({
  selector: 'app-contribute',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, ButtonComponent],
  templateUrl: './contribute.component.html',
  styleUrl: './contribute.component.scss',
})
export class ContributeComponent implements OnInit {
  private readonly route       = inject(ActivatedRoute);
  private readonly fb          = inject(FormBuilder);
  private readonly campaignSvc = inject(CampaignService);
  private readonly supabaseSvc = inject(SupabaseService);
  private readonly stripeSvc   = inject(StripeService);
  private readonly paypalSvc   = inject(PayPalService);
  private readonly paypalSdkSvc = inject(PayPalSdkService);
  private readonly destroyRef  = inject(DestroyRef);
  private readonly platformId  = inject(PLATFORM_ID);

  readonly presets = PRESET_AMOUNTS;

  readonly campaign  = signal<Campaign | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly loading   = signal(true);

  readonly selectedPreset  = signal<PresetAmount | 'custom'>(10);
  readonly customAmountRaw = signal('');

  readonly amountPence = computed(() => {
    if (this.selectedPreset() === 'custom') {
      const value = parseFloat(this.customAmountRaw());
      return isNaN(value) || value <= 0 ? 0 : Math.round(value * 100);
    }
    return (this.selectedPreset() as PresetAmount) * 100;
  });

  readonly amountValid   = computed(() => this.amountPence() >= 100);
  readonly amountTouched = signal(false);

  readonly organiserDirectPay = computed(
    () => this.campaign()?.stripeOnboardingComplete ?? false
  );

  readonly paying        = signal(false);
  readonly payError      = signal<string | null>(null);
  readonly paymentMethod = signal<PaymentMethod>('stripe');
  readonly wasCancelled  = signal(false);
  readonly venmoEligible = signal(false);
  readonly venmoLoading  = signal(false);
  readonly venmoRendered = signal(false);
  private venmoRenderToken = 0;

  readonly form: FormGroup<ContributeForm> = this.fb.group({
    name:        this.fb.nonNullable.control(''),
    message:     this.fb.nonNullable.control('', [Validators.maxLength(200)]),
    isAnonymous: this.fb.nonNullable.control(false),
  });

  async ngOnInit(): Promise<void> {
    this.form.controls.isAnonymous.valueChanges
      .pipe(startWith(this.form.controls.isAnonymous.value), takeUntilDestroyed(this.destroyRef))
      .subscribe((isAnonymous) => {
        const nameControl = this.form.controls.name;
        if (isAnonymous) {
          nameControl.disable({ emitEvent: false });
          nameControl.clearValidators();
          nameControl.setValue('', { emitEvent: false });
        } else {
          nameControl.enable({ emitEvent: false });
          nameControl.setValidators([Validators.required]);
        }
        nameControl.updateValueAndValidity({ emitEvent: false });
      });

    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    const cancelled = this.route.snapshot.queryParamMap.get('payment_cancelled');
    if (cancelled === 'true') this.wasCancelled.set(true);

    try {
      const campaign = await this.campaignSvc.getCampaignBySlug(slug);
      if (!campaign) {
        this.loadError.set('Campaign not found.');
        return;
      }
      if (campaign.status === 'closed') {
        this.loadError.set('This campaign has ended.');
        return;
      }
      this.campaign.set(campaign);
    } catch {
      this.loadError.set('Failed to load campaign. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  selectPreset(amount: PresetAmount): void {
    this.selectedPreset.set(amount);
    this.customAmountRaw.set('');
    this.amountTouched.set(false);
  }

  onCustomInput(event: Event): void {
    this.selectedPreset.set('custom');
    this.customAmountRaw.set((event.target as HTMLInputElement).value);
    this.amountTouched.set(true);
  }

  onCustomFocus(): void {
    this.selectedPreset.set('custom');
  }

  selectPaymentMethod(method: PaymentMethod): void {
    this.paymentMethod.set(method);
    this.payError.set(null);
    this.wasCancelled.set(false);
    if (method === 'venmo') {
      this.venmoRendered.set(false);
      setTimeout(() => void this.ensureVenmoButton());
    }
  }

  async onSubmit(): Promise<void> {
    this.amountTouched.set(true);
    this.form.markAllAsTouched();

    if (!this.amountValid() || this.form.invalid || this.paying()) return;

    const campaign = this.campaign();
    if (!campaign) return;

    this.paying.set(true);
    this.payError.set(null);
    this.wasCancelled.set(false);

    const { name, message, isAnonymous } = this.form.getRawValue();
    const contributorName = isAnonymous ? 'Anonymous' : name.trim();
    const origin = isPlatformBrowser(this.platformId) ? window.location.origin : '';
    const provider = this.paymentMethod();
    const successBaseUrl =
      `${origin}/campaigns/${campaign.slug}?contributed=true&provider=${provider}`;
    const cancelUrl =
      `${origin}/contribute/${campaign.slug}?payment_cancelled=true&provider=${provider}`;

    try {
      if (provider === 'venmo') {
        throw new Error('Use the Venmo button below to continue.');
      } else if (provider === 'paypal') {
        await this.paypalSvc.redirectToCheckout({
          campaignId: campaign.id,
          amountPence: this.amountPence(),
          contributorName,
          message: message.trim(),
          isAnonymous,
          successUrl: successBaseUrl,
          cancelUrl,
        });
      } else {
        await this.stripeSvc.redirectToCheckout({
          campaignId: campaign.id,
          amountPence: this.amountPence(),
          contributorName,
          message: message.trim(),
          isAnonymous,
          successUrl: `${successBaseUrl}&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl,
        });
      }
    } catch (err: unknown) {
      const messageText = err instanceof Error ? err.message : 'Payment could not be started.';
      this.payError.set(messageText);
      this.paying.set(false);
    }
  }

  retry(): void {
    this.payError.set(null);
    this.wasCancelled.set(false);
  }

  get messageLength(): number {
    return this.form.controls.message.value.length;
  }

  hasError(ctrl: keyof ContributeForm, err: string): boolean {
    const control = this.form.get(ctrl);
    return !!(control?.touched && control.hasError(err));
  }

  get paymentButtonLabel(): string {
    if (this.paymentMethod() === 'paypal') return 'Pay securely with PayPal';
    if (this.paymentMethod() === 'venmo') return 'Continue with Venmo';
    return 'Pay securely with Stripe';
  }

  async ensureVenmoButton(): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || this.venmoRendered() || this.venmoLoading()) return;

    this.venmoLoading.set(true);
    this.payError.set(null);
    const renderToken = ++this.venmoRenderToken;

    try {
      const paypal = await this.paypalSdkSvc.loadSdk();
      if (renderToken !== this.venmoRenderToken) return;

      const buttons = this.createVenmoButtons(paypal);
      this.venmoEligible.set(buttons.isEligible());

      if (!buttons.isEligible()) {
        this.venmoLoading.set(false);
        return;
      }

      const container = document.getElementById('venmo-button-container');
      if (!container) {
        this.venmoLoading.set(false);
        return;
      }

      container.innerHTML = '';
      await buttons.render(container);
      if (renderToken !== this.venmoRenderToken) return;
      this.venmoRendered.set(true);
    } catch (error: unknown) {
      this.payError.set(error instanceof Error ? error.message : 'Failed to load Venmo.');
    } finally {
      this.venmoLoading.set(false);
    }
  }

  private createVenmoButtons(paypal: PayPalNamespace) {
    return paypal.Buttons({
      fundingSource: paypal.FUNDING.VENMO,
      style: {
        layout: 'vertical',
        color: 'blue',
        shape: 'rect',
        label: 'pay',
      },
      createOrder: async () => {
        this.amountTouched.set(true);
        this.form.markAllAsTouched();
        this.payError.set(null);
        this.wasCancelled.set(false);

        if (!this.amountValid() || this.form.invalid) {
          throw new Error('Enter a valid amount and contributor details first.');
        }

        const campaign = this.campaign();
        if (!campaign) {
          throw new Error('Campaign not found.');
        }

        const { name, message, isAnonymous } = this.form.getRawValue();
        const contributorName = isAnonymous ? 'Anonymous' : name.trim();
        const origin = window.location.origin;
        const successUrl = `${origin}/campaigns/${campaign.slug}?contributed=true&provider=venmo`;
        const cancelUrl = `${origin}/contribute/${campaign.slug}?payment_cancelled=true&provider=venmo`;

        const response = await this.paypalSvc.createOrder({
          campaignId: campaign.id,
          amountPence: this.amountPence(),
          contributorName,
          message: message.trim(),
          isAnonymous,
          successUrl,
          cancelUrl,
        });

        if (!response?.orderId) {
          throw new Error('Venmo order ID missing from response.');
        }

        return response.orderId;
      },
      onApprove: async (data) => {
        const orderId = data.orderID;
        if (!orderId) {
          throw new Error('Venmo order ID missing after approval.');
        }

        const campaign = this.campaign();
        if (!campaign) {
          throw new Error('Campaign not found.');
        }

        await this.supabaseSvc.confirmPayPalContribution(orderId);
        window.location.href = `${window.location.origin}/campaigns/${campaign.slug}?contributed=true&provider=venmo&order_id=${encodeURIComponent(orderId)}`;
      },
      onCancel: () => {
        this.wasCancelled.set(true);
      },
      onError: (error) => {
        this.payError.set(error instanceof Error ? error.message : 'Venmo checkout failed.');
      },
    });
  }
}
