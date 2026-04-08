import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { CampaignFundUse } from '../../../core/models/campaign.model';
import { CampaignService } from '../../../core/services/campaign.service';
import { ProService } from '../../../core/services/pro.service';
import { generateSlug } from '../../../core/utils/slug.util';
import { ButtonComponent } from '../../../shared/components/button/button.component';

function positiveAmountValidator(control: AbstractControl): ValidationErrors | null {
  const value = control.value;
  if (value === null || value === '' || value === undefined) return null;
  return Number(value) >= 1 ? null : { positiveAmount: true };
}

function futureDateValidator(control: AbstractControl): ValidationErrors | null {
  if (!control.value) return null;
  const chosen = new Date(control.value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return chosen >= today ? null : { pastDate: true };
}

export interface CreateCampaignForm {
  title: FormControl<string>;
  description: FormControl<string>;
  fundUse: FormControl<CampaignFundUse | null>;
  targetAmount: FormControl<number | null>;
  deadline: FormControl<string | null>;
}

@Component({
  selector: 'app-campaign-create',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, ButtonComponent],
  templateUrl: './campaign-create.component.html',
  styleUrl: './campaign-create.component.scss',
})
export class CampaignCreateComponent implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly campaignSvc = inject(CampaignService);
  private readonly proSvc = inject(ProService);

  readonly slugPreview = signal('');
  readonly submitting = signal(false);
  readonly submitError = signal<string | null>(null);
  readonly todayIso = new Date().toISOString().split('T')[0];
  readonly canCreatePaidCampaign = this.proSvc.canCreatePaidCampaign;
  readonly campaignCredits = this.proSvc.campaignCredits;

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
  });

  private readonly destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.form.controls.title.valueChanges.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe((title) => {
      this.slugPreview.set(generateSlug(title));
    });

    void this.proSvc.loadProfile();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async onSubmit(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.submitting()) return;
    if (!this.canCreatePaidCampaign()) {
      this.submitError.set('Complete payment before creating a campaign.');
      return;
    }

    this.submitting.set(true);
    this.submitError.set(null);

    try {
      const { title, description, fundUse, targetAmount, deadline } = this.form.getRawValue();

      await this.campaignSvc.createCampaign({
        title,
        description: description || undefined,
        fundUse: fundUse ?? null,
        targetAmountPence: targetAmount != null ? targetAmount * 100 : null,
        deadline: deadline || null,
      });

      await this.proSvc.loadProfile();
      await this.router.navigate(['/dashboard']);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      this.submitError.set(message);
      this.submitting.set(false);
    }
  }

  hasError(controlName: keyof CreateCampaignForm, error: string): boolean {
    const ctrl = this.form.get(controlName);
    return !!(ctrl?.touched && ctrl.hasError(error));
  }

  get descriptionLength(): number {
    return this.form.controls.description.value.length;
  }
}
