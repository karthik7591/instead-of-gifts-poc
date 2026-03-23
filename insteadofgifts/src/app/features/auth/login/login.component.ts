import {
  Component,
  inject,
  signal,
  ChangeDetectionStrategy,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
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
import { AuthService } from '../../../core/services/auth.service';

// ---------------------------------------------------------------------------
// Custom validator
// ---------------------------------------------------------------------------

/** Group-level validator: password and confirmPassword fields must match. */
function passwordsMatchValidator(group: AbstractControl): ValidationErrors | null {
  const pw  = group.get('password')?.value as string;
  const cpw = group.get('confirmPassword')?.value as string;
  return pw && cpw && pw !== cpw ? { passwordMismatch: true } : null;
}

// ---------------------------------------------------------------------------
// Form interfaces
// ---------------------------------------------------------------------------

interface LoginFormType {
  email:    FormControl<string>;
  password: FormControl<string>;
}

interface SignUpFormType {
  email:           FormControl<string>;
  password:        FormControl<string>;
  confirmPassword: FormControl<string>;
}

interface ForgotFormType {
  email: FormControl<string>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@Component({
  selector: 'app-login',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly auth       = inject(AuthService);
  private readonly router     = inject(Router);
  private readonly fb         = inject(FormBuilder);
  private readonly platformId = inject(PLATFORM_ID);

  // ── Panel mode ─────────────────────────────────────────────────────────────
  /** Toggles the left panel between the log-in form and the forgot-password form. */
  readonly leftMode = signal<'login' | 'forgot'>('login');

  // ── Password visibility toggles ────────────────────────────────────────────
  readonly showLoginPw   = signal(false);
  readonly showSignUpPw  = signal(false);
  readonly showConfirmPw = signal(false);

  // ── Loading / error state ──────────────────────────────────────────────────
  readonly loginLoading  = signal(false);
  readonly signUpLoading = signal(false);
  readonly resetLoading  = signal(false);
  /** 'google' or 'apple' while an OAuth redirect is in-flight. */
  readonly oauthLoading  = signal<'google' | 'apple' | null>(null);

  readonly loginError  = signal<string | null>(null);
  readonly signUpError = signal<string | null>(null);
  readonly resetError  = signal<string | null>(null);

  /** True after a password-reset email is sent successfully. */
  readonly resetSent = signal(false);
  /** True when signup needs email confirmation before the user can log in. */
  readonly signUpConfirmPending = signal(false);

  // ── Forms ──────────────────────────────────────────────────────────────────

  readonly loginForm: FormGroup<LoginFormType> = this.fb.group({
    email:    this.fb.nonNullable.control('', [Validators.required, Validators.email]),
    password: this.fb.nonNullable.control('', Validators.required),
  });

  readonly signUpForm: FormGroup<SignUpFormType> = this.fb.group(
    {
      email:           this.fb.nonNullable.control('', [Validators.required, Validators.email]),
      password:        this.fb.nonNullable.control('', [Validators.required, Validators.minLength(8)]),
      confirmPassword: this.fb.nonNullable.control('', Validators.required),
    },
    { validators: passwordsMatchValidator }
  );

  readonly forgotForm: FormGroup<ForgotFormType> = this.fb.group({
    email: this.fb.nonNullable.control('', [Validators.required, Validators.email]),
  });

  // ── Submit handlers ────────────────────────────────────────────────────────

  async onLogin(): Promise<void> {
    this.loginForm.markAllAsTouched();
    if (this.loginForm.invalid || this.loginLoading()) return;

    this.loginLoading.set(true);
    this.loginError.set(null);

    try {
      await this.auth.signInWithEmail(
        this.loginForm.controls.email.value,
        this.loginForm.controls.password.value,
      );
      await this.router.navigate(['/dashboard']);
    } catch (err: unknown) {
      this.loginError.set(this.friendly(err));
    } finally {
      this.loginLoading.set(false);
    }
  }

  async onSignUp(): Promise<void> {
    this.signUpForm.markAllAsTouched();
    if (this.signUpForm.invalid || this.signUpLoading()) return;

    this.signUpLoading.set(true);
    this.signUpError.set(null);

    try {
      const loggedIn = await this.auth.signUpWithEmail(
        this.signUpForm.controls.email.value,
        this.signUpForm.controls.password.value,
      );
      if (loggedIn) {
        await this.router.navigate(['/dashboard']);
      } else {
        this.signUpConfirmPending.set(true);
      }
    } catch (err: unknown) {
      this.signUpError.set(this.friendly(err));
    } finally {
      this.signUpLoading.set(false);
    }
  }

  async onResetPassword(): Promise<void> {
    this.forgotForm.markAllAsTouched();
    if (this.forgotForm.invalid || this.resetLoading()) return;

    this.resetLoading.set(true);
    this.resetError.set(null);

    try {
      await this.auth.resetPasswordForEmail(this.forgotForm.controls.email.value);
      this.resetSent.set(true);
    } catch (err: unknown) {
      this.resetError.set(this.friendly(err));
    } finally {
      this.resetLoading.set(false);
    }
  }

  async onLoginWithGoogle(): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || this.oauthLoading()) return;
    this.oauthLoading.set('google');
    this.signUpError.set(null);
    try {
      await this.auth.signInWithGoogle();
      // Browser navigates away — no further action needed
    } catch (err: unknown) {
      this.signUpError.set(this.friendly(err));
      this.oauthLoading.set(null);
    }
  }

  async onLoginWithApple(): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || this.oauthLoading()) return;
    this.oauthLoading.set('apple');
    this.signUpError.set(null);
    try {
      await this.auth.signInWithApple();
    } catch (err: unknown) {
      this.signUpError.set(this.friendly(err));
      this.oauthLoading.set(null);
    }
  }

  // ── View helpers ──────────────────────────────────────────────────────────

  hasError(form: FormGroup, ctrl: string, err: string): boolean {
    const c = form.get(ctrl);
    return !!(c?.touched && c.hasError(err));
  }

  hasGroupError(form: FormGroup, err: string): boolean {
    return !!(form.touched && form.hasError(err));
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private friendly(err: unknown): string {
    if (!(err instanceof Error)) return 'Something went wrong. Please try again.';
    const m = err.message.toLowerCase();
    if (m.includes('invalid login credentials') || m.includes('invalid credentials'))
      return 'Incorrect email or password.';
    if (m.includes('email not confirmed'))
      return 'Please verify your email before logging in.';
    if (m.includes('already registered') || m.includes('user already exists'))
      return 'An account with this email already exists. Try logging in.';
    if (m.includes('password should be at least'))
      return 'Password must be at least 8 characters.';
    if (m.includes('rate limit') || m.includes('too many'))
      return 'Too many attempts — please wait a moment and try again.';
    return err.message;
  }
}
