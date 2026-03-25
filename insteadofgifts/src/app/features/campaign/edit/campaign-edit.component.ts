import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  FormControl,
  Validators,
  ReactiveFormsModule,
  AbstractControl,
  ValidationErrors,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, takeUntil, debounceTime, distinctUntilChanged } from 'rxjs';
import { CampaignService } from '../../../core/services/campaign.service';
import { ProService } from '../../../core/services/pro.service';
import { ToastService } from '../../../core/services/toast.service';
import { Campaign, CampaignFundUse } from '../../../core/models/campaign.model';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { ImageUploadComponent } from '../../../shared/components/image-upload/image-upload.component';

/** Rejects values < 1 only when a value is present (allows null/empty). */
function positiveAmountValidator(control: AbstractControl): ValidationErrors | null {
  const v = control.value;
  if (v === null || v === '' || v === undefined) return null;
  return Number(v) >= 1 ? null : { positiveAmount: true };
}

/** Rejects past dates. */
function futureDateValidator(control: AbstractControl): ValidationErrors | null {
  if (!control.value) return null;
  const chosen = new Date(control.value);
  const today  = new Date(); today.setHours(0, 0, 0, 0);
  return chosen >= today ? null : { pastDate: true };
}

export interface EditCampaignForm {
  title:         FormControl<string>;
  description:   FormControl<string>;
  fundUse:       FormControl<CampaignFundUse | null>;
  targetAmount:  FormControl<number | null>;
  deadline:      FormControl<string | null>;
  customMessage: FormControl<string>;
}

@Component({
  selector: 'app-campaign-edit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, ButtonComponent, ImageUploadComponent],
  templateUrl: './campaign-edit.component.html',
  styleUrl:    './campaign-edit.component.scss',
})
export class CampaignEditComponent implements OnInit, OnDestroy {
  private readonly fb          = inject(FormBuilder);
  private readonly route       = inject(ActivatedRoute);
  private readonly router      = inject(Router);
  private readonly campaignSvc = inject(CampaignService);
  private readonly proSvc      = inject(ProService);
  private readonly toastSvc    = inject(ToastService);

  // ── Signals ────────────────────────────────────────────────────────────────
  readonly isPro       = this.proSvc.isPro;
  readonly loading     = signal(true);
  readonly loadError   = signal<string | null>(null);
  readonly submitting  = signal(false);
  readonly submitError = signal<string | null>(null);
  readonly campaign    = signal<Campaign | null>(null);

  /** Today's date in YYYY-MM-DD — used as the `min` attr on the date input. */
  readonly todayIso = new Date().toISOString().split('T')[0];

  // ── Form ───────────────────────────────────────────────────────────────────
  readonly form: FormGroup<EditCampaignForm> = this.fb.group({
    title: this.fb.nonNullable.control('', [
      Validators.required,
      Validators.maxLength(80),
    ]),
    description: this.fb.nonNullable.control('', [
      Validators.maxLength(500),
    ]),
    fundUse: this.fb.control<CampaignFundUse | null>(null),
    targetAmount: this.fb.control<number | null>(null, [
      positiveAmountValidator,
    ]),
    deadline: this.fb.control<string | null>(null, [
      futureDateValidator,
    ]),
    customMessage: this.fb.nonNullable.control('', [
      Validators.maxLength(1000),
    ]),
  });

  private readonly destroy$ = new Subject<void>();

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async ngOnInit(): Promise<void> {
    const slug = this.route.snapshot.paramMap.get('id') ?? '';

    try {
      const c = await this.campaignSvc.getCampaignBySlug(slug);
      if (!c) {
        this.loadError.set('Campaign not found.');
        return;
      }

      this.campaign.set(c);
      this.populateForm(c);
    } catch {
      this.loadError.set('Failed to load campaign.');
    } finally {
      this.loading.set(false);
    }

    // Re-validate deadline live as the user types (futureDateValidator needs current date)
    this.form.controls.deadline.valueChanges.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe(() => this.form.controls.deadline.updateValueAndValidity({ emitEvent: false }));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private populateForm(c: Campaign): void {
    this.form.patchValue({
      title:         c.title,
      description:   c.description ?? '',
      fundUse:       c.fundUse ?? null,
      // targetAmount stored in cents → convert to dollars for the form
      targetAmount:  c.targetAmount > 0 ? c.targetAmount / 100 : null,
      // endsAt is an ISO string; extract date part for the <input type="date">
      deadline:      c.endsAt ? c.endsAt.split('T')[0] : null,
      customMessage: c.customMessage ?? '',
    });
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  async onSubmit(): Promise<void> {
    this.form.markAllAsTouched();
    const c = this.campaign();
    if (this.form.invalid || this.submitting() || !c) return;

    this.submitting.set(true);
    this.submitError.set(null);

    try {
      const { title, description, fundUse, targetAmount, deadline, customMessage } =
        this.form.getRawValue();

      await this.campaignSvc.updateCampaign(c.id, {
        title,
        description:       description || undefined,
        fundUse:           fundUse ?? null,
        targetAmountPence: targetAmount != null ? targetAmount * 100 : null,
        deadline:          deadline || null,
        customMessage:     this.isPro() ? (customMessage || undefined) : undefined,
      });

      this.toastSvc.success('Campaign updated successfully.');
      await this.router.navigate(['/campaigns', c.slug]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      this.submitError.set(message);
      this.submitting.set(false);
    }
  }

  // ── Template helpers ───────────────────────────────────────────────────────

  hasError(controlName: keyof EditCampaignForm, error: string): boolean {
    const ctrl = this.form.get(controlName);
    return !!(ctrl?.touched && ctrl.hasError(error));
  }

  get descriptionLength(): number {
    return this.form.controls.description.value.length;
  }

  get customMessageLength(): number {
    return this.form.controls.customMessage.value.length;
  }
}
