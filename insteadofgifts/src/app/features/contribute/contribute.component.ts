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
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { CampaignService } from '../../core/services/campaign.service';
import { StripeService } from '../../core/services/stripe.service';
import { Campaign } from '../../core/models/campaign.model';
import { ButtonComponent } from '../../shared/components/button/button.component';

/** Preset quick-select amounts in major currency units ($). */
const PRESET_AMOUNTS = [5, 10, 25, 50] as const;
type PresetAmount = (typeof PRESET_AMOUNTS)[number];

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
  private readonly stripeSvc   = inject(StripeService);
  private readonly platformId  = inject(PLATFORM_ID);

  // ── Preset amounts exposed to the template ────────────────────────────────
  readonly presets = PRESET_AMOUNTS;

  // ── Campaign state ────────────────────────────────────────────────────────
  readonly campaign    = signal<Campaign | null>(null);
  readonly loadError   = signal<string | null>(null);
  readonly loading     = signal(true);

  // ── Amount selection ──────────────────────────────────────────────────────
  readonly selectedPreset  = signal<PresetAmount | 'custom'>(10);
  readonly customAmountRaw = signal('');

  /** Effective amount in cents — drives all validation and the Stripe call. */
  readonly amountPence = computed(() => {
    if (this.selectedPreset() === 'custom') {
      const v = parseFloat(this.customAmountRaw());
      return isNaN(v) || v <= 0 ? 0 : Math.round(v * 100);
    }
    return (this.selectedPreset() as PresetAmount) * 100;
  });

  readonly amountValid   = computed(() => this.amountPence() >= 100);
  readonly amountTouched = signal(false);

  // ── Payment state ─────────────────────────────────────────────────────────
  readonly paying       = signal(false);
  readonly payError     = signal<string | null>(null);
  /** Set when Stripe redirects back with ?payment_cancelled=true. */
  readonly wasCancelled = signal(false);

  // ── Contributor form ──────────────────────────────────────────────────────
  readonly form: FormGroup<ContributeForm> = this.fb.group({
    name:        this.fb.nonNullable.control(''),
    message:     this.fb.nonNullable.control('', [Validators.maxLength(200)]),
    isAnonymous: this.fb.nonNullable.control(false),
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async ngOnInit(): Promise<void> {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';

    // Detect Stripe cancellation redirect
    const cancelled = this.route.snapshot.queryParamMap.get('payment_cancelled');
    if (cancelled === 'true') this.wasCancelled.set(true);

    try {
      const c = await this.campaignSvc.getCampaignBySlug(slug);
      if (!c) { this.loadError.set('Campaign not found.'); return; }
      if (c.status === 'closed') { this.loadError.set('This campaign has ended.'); return; }
      this.campaign.set(c);
    } catch {
      this.loadError.set('Failed to load campaign. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Amount selection ──────────────────────────────────────────────────────

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

  // ── Submit ────────────────────────────────────────────────────────────────

  async onSubmit(): Promise<void> {
    this.amountTouched.set(true);
    this.form.markAllAsTouched();

    if (!this.amountValid() || this.form.invalid || this.paying()) return;

    const c = this.campaign();
    if (!c) return;

    this.paying.set(true);
    this.payError.set(null);
    this.wasCancelled.set(false);

    const { name, message, isAnonymous } = this.form.getRawValue();
    const contributorName = isAnonymous ? 'Anonymous' : (name.trim() || 'Anonymous');

    const origin = isPlatformBrowser(this.platformId) ? window.location.origin : '';

    try {
      await this.stripeSvc.redirectToCheckout({
        campaignId:      c.id,
        amountPence:     this.amountPence(),
        contributorName,
        message:         message.trim(),
        isAnonymous,
        // {CHECKOUT_SESSION_ID} is replaced by Stripe with the real session ID on redirect.
        // campaign-view.component reads it and calls confirm-contribution to write the DB row.
        successUrl: `${origin}/campaigns/${c.slug}?contributed=true&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl:  `${origin}/contribute/${c.slug}?payment_cancelled=true`,
      });
      // If redirectToCheckout resolves without navigating away, the backend
      // failed to return a URL — treat as error.
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Payment could not be started.';
      this.payError.set(msg);
      this.paying.set(false);
    }
  }

  retry(): void {
    this.payError.set(null);
    this.wasCancelled.set(false);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  get messageLength(): number {
    return this.form.controls.message.value.length;
  }

  hasError(ctrl: keyof ContributeForm, err: string): boolean {
    const c = this.form.get(ctrl);
    return !!(c?.touched && c.hasError(err));
  }
}
