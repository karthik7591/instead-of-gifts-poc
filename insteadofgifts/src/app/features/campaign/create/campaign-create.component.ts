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
import { Router, RouterLink } from '@angular/router';
import { Subject, takeUntil, debounceTime, distinctUntilChanged } from 'rxjs';
import { CampaignService } from '../../../core/services/campaign.service';
import { CampaignFundUse } from '../../../core/models/campaign.model';
import { ProService } from '../../../core/services/pro.service';
import { generateSlug } from '../../../core/utils/slug.util';
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

export interface CreateCampaignForm {
  title:         FormControl<string>;
  description:   FormControl<string>;
  fundUse:       FormControl<CampaignFundUse | null>;
  targetAmount:  FormControl<number | null>;
  deadline:      FormControl<string | null>;
  customMessage: FormControl<string>;
}

@Component({
  selector: 'app-campaign-create',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, ButtonComponent, ImageUploadComponent],
  templateUrl: './campaign-create.component.html',
  styleUrl:    './campaign-create.component.scss',
})
export class CampaignCreateComponent implements OnInit, OnDestroy {
  readonly defaultProCoverImageUrl =
    'https://images.unsplash.com/photo-1596419125026-0d4db48bc7de?q=80&w=1470&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D';

  private readonly fb          = inject(FormBuilder);
  private readonly router      = inject(Router);
  private readonly campaignSvc = inject(CampaignService);
  private readonly proSvc      = inject(ProService);

  // ── Signals ────────────────────────────────────────────────────────────────
  /** True when the signed-in user has an active Pro subscription. */
  readonly isPro       = this.proSvc.isPro;
  readonly slugPreview = signal('');
  readonly submitting  = signal(false);
  readonly submitError = signal<string | null>(null);

  /** Today's date in YYYY-MM-DD — used as the `min` attr on the date input. */
  readonly todayIso = new Date().toISOString().split('T')[0];

  // ── Cover image (compressed File emitted by ImageUploadComponent) ──────────
  /** Stores the compressed file ready for upload after campaign creation. */
  coverImageFile: File | null = null;

  // ── Form ───────────────────────────────────────────────────────────────────
  readonly form: FormGroup<CreateCampaignForm> = this.fb.group({
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

  ngOnInit(): void {
    // Debounced live slug preview as the user types the title.
    this.form.controls.title.valueChanges.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe((title) => {
      this.slugPreview.set(generateSlug(title));
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Image upload callback ──────────────────────────────────────────────────

  /** Called by ImageUploadComponent when a file has been compressed and is ready. */
  onCoverFileReady(file: File): void {
    this.coverImageFile = file;
  }

  /** Called if the user removes the cover image before submitting. */
  onCoverRemoved(): void {
    this.coverImageFile = null;
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  async onSubmit(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.submitting()) return;

    this.submitting.set(true);
    this.submitError.set(null);

    try {
      const { title, description, fundUse, targetAmount, deadline, customMessage } =
        this.form.getRawValue();

      await this.campaignSvc.createCampaign({
        title,
        description:        description || undefined,
        fundUse:            fundUse ?? null,
        targetAmountPence:  targetAmount != null ? targetAmount * 100 : null,
        deadline:           deadline || null,
        customMessage:      this.isPro() ? (customMessage || undefined) : undefined,
        coverImageFile:     this.isPro() ? this.coverImageFile : null,
      });

      // campaign.slug is available here if the route ever changes to /dashboard/:slug
      await this.router.navigate(['/dashboard']);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      this.submitError.set(message);
      this.submitting.set(false);
    }
  }

  // ── Template helpers ───────────────────────────────────────────────────────

  hasError(controlName: keyof CreateCampaignForm, error: string): boolean {
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

