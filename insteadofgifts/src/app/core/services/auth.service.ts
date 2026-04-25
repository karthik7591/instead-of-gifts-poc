import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { User } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { SupabaseService } from './supabase.service';
import { ToastService } from './toast.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase  = inject(SupabaseService);
  private readonly router    = inject(Router);
  private readonly toastSvc  = inject(ToastService);

  /**
   * Reactive signal mirroring the current Supabase user.
   * Null when signed out; populated immediately from localStorage on init.
   */
  readonly user = signal<User | null>(null);

  constructor() {
    // Bootstrap from any persisted session (Supabase restores from localStorage)
    this.supabase.client.auth.getSession().then(({ data }) => {
      this.user.set(data.session?.user ?? null);
    });

    // Keep the signal in sync with every subsequent auth event
    this.supabase.client.auth.onAuthStateChange((_event, session) => {
      this.user.set(session?.user ?? null);
    });
  }

  get isAuthenticated(): boolean {
    return this.user() !== null;
  }

  getUser(): User | null {
    return this.user();
  }

  private get authCallbackUrl(): string {
    const baseUrl = typeof window !== 'undefined'
      ? window.location.origin
      : environment.appUrl;

    return `${baseUrl}/auth/callback`;
  }

  async signInWithEmail(email: string, password: string): Promise<void> {
    const { error } = await this.supabase.client.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  }

  /**
   * Creates a new account. Returns `true` if the user was immediately signed in
   * (email confirmation disabled), `false` if a confirmation email was sent.
   */
  async signUpWithEmail(email: string, password: string): Promise<boolean> {
    const { data, error } = await this.supabase.client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: this.authCallbackUrl,
      },
    });
    if (error) throw error;
    return data.session !== null;
  }

  async signInWithGoogle(): Promise<void> {
    const { error } = await this.supabase.client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: this.authCallbackUrl },
    });
    if (error) {
      this.toastSvc.error('Google sign-in failed — please try again.');
      throw error;
    }
  }

  async signInWithApple(): Promise<void> {
    const { error } = await this.supabase.client.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: this.authCallbackUrl },
    });
    if (error) {
      this.toastSvc.error('Apple sign-in failed — please try again.');
      throw error;
    }
  }

  async resetPasswordForEmail(email: string): Promise<void> {
    const { error } = await this.supabase.client.auth.resetPasswordForEmail(
      email,
      { redirectTo: this.authCallbackUrl }
    );
    if (error) throw error;
  }

  async signOut(): Promise<void> {
    const { error } = await this.supabase.client.auth.signOut();
    if (error) {
      this.toastSvc.error('Sign-out failed — please try again.');
      throw error;
    }
    await this.router.navigate(['/login']);
  }
}
