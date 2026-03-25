import {
  Component,
  input,
  computed,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NgClass } from '@angular/common';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'pro' | 'campaign';
export type ButtonSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass],
  template: `
    <button
      [type]="type()"
      [disabled]="disabled() || loading()"
      [ngClass]="classes()"
      [attr.aria-label]="ariaLabel() ?? null"
      [attr.aria-busy]="loading() ? 'true' : null"
      (click)="clicked.emit($event)"
    >
      <!-- Loading spinner -->
      @if (loading()) {
        <svg
          class="animate-spin shrink-0"
          [ngClass]="spinnerSize()"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            class="opacity-25"
            cx="12" cy="12" r="10"
            stroke="currentColor"
            stroke-width="4"
          />
          <path
            class="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
          />
        </svg>
      }

      <!-- Label -->
      <span class="inline-flex items-center gap-2" [class.opacity-0]="loading() && !hasIcon()">
        <ng-content />
      </span>
    </button>
  `,
  styles: [`
    :host { display: contents; }
  `],
})
export class ButtonComponent {
  readonly variant  = input<ButtonVariant>('primary');
  readonly size     = input<ButtonSize>('md');
  readonly loading  = input<boolean>(false);
  readonly disabled = input<boolean>(false);
  readonly type     = input<'button' | 'submit' | 'reset'>('button');
  readonly fullWidth  = input<boolean>(false);
  /**
   * Forwarded to the inner `<button>` as `aria-label`.
   * Use this for icon-only buttons or when the visible label needs supplementing
   * (e.g. "Close" → ariaLabel="Close campaign 'Alice's Birthday'").
   */
  readonly ariaLabel  = input<string | null>(null);

  readonly clicked = output<MouseEvent>();

  /** Not a real input — used to detect icon-only usage via projected content tricks.
   *  Kept simple: spinner always sits beside the label. */
  protected hasIcon = () => false;

  protected spinnerSize = computed(() => {
    const map: Record<ButtonSize, string> = {
      sm: 'w-3 h-3',
      md: 'w-4 h-4',
      lg: 'w-5 h-5',
    };
    return map[this.size()];
  });

  protected classes = computed(() => {
    const base = [
      'inline-flex items-center justify-center gap-2',
      'font-semibold rounded-md',
      'transition-all duration-200',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
      'disabled:cursor-not-allowed disabled:opacity-50',
      this.fullWidth() ? 'w-full' : '',
    ];

    const sizes: Record<ButtonSize, string> = {
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-5 py-2.5 text-base',
      lg: 'px-7 py-3.5 text-lg',
    };

    const variants: Record<ButtonVariant, string> = {
      primary: [
        'bg-brand-green text-white',
        'hover:bg-forest',
        'active:bg-sage-dark',
        'focus-visible:ring-brand-green',
        'shadow-card hover:shadow-hover',
      ].join(' '),

      secondary: [
        'bg-transparent text-forest',
        'border-2 border-forest',
        'hover:bg-pale-green',
        'active:bg-mint',
        'focus-visible:ring-forest',
      ].join(' '),

      ghost: [
        'bg-transparent text-text-muted',
        'hover:bg-pale-green hover:text-forest',
        'active:bg-mint',
        'focus-visible:ring-forest',
      ].join(' '),

      danger: [
        'bg-error text-white',
        'hover:bg-red-700',
        'active:bg-red-800',
        'focus-visible:ring-error',
        'shadow-card hover:shadow-hover',
      ].join(' '),

      pro: [
        'bg-pro text-white',
        'hover:bg-pro-dark',
        'active:opacity-90',
        'focus-visible:ring-pro',
        'shadow-card hover:shadow-hover',
      ].join(' '),

      campaign: [
        'bg-[#1f3a64] text-white',
        'hover:bg-[#1a3153]',
        'active:bg-[#152948]',
        'focus-visible:ring-[#1f3a64]',
        'shadow-card hover:shadow-hover',
      ].join(' '),
    };

    return [
      ...base,
      sizes[this.size()],
      variants[this.variant()],
    ].filter(Boolean).join(' ');
  });
}
