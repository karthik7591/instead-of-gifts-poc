import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';

@Component({
  selector: 'app-progress-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (showLabel()) {
      <div class="progress-bar__label">
        <span class="progress-bar__amount">
          {{ formattedCurrent() }}
          <span class="progress-bar__raised">raised</span>
        </span>
        <span
          class="progress-bar__percent"
          [class.progress-bar__percent--complete]="isComplete()"
        >{{ percent() }}%</span>
      </div>
    }

    <div
      class="progress-bar__track"
      role="progressbar"
      [attr.aria-valuenow]="percent()"
      aria-valuemin="0"
      aria-valuemax="100"
      [attr.aria-label]="'Progress: ' + percent() + '%'"
    >
      <div
        class="progress-bar__fill"
        [class.progress-bar__fill--complete]="isComplete()"
        [style.width.%]="percent()"
      ></div>
    </div>

    @if (showLabel() && target() > 0) {
      <p class="progress-bar__target">of {{ formattedTarget() }} goal</p>
    }
  `,
  styleUrl: './progress-bar.component.scss',
})
export class ProgressBarComponent {
  readonly current   = input.required<number>();
  readonly target    = input.required<number>();
  readonly showLabel = input<boolean>(true);
  /** ISO 4217 currency code, e.g. 'USD'. Set to empty string to show raw number. */
  readonly currency  = input<string>('USD');

  readonly percent = computed(() => {
    if (!this.target() || this.target() <= 0) return 0;
    return Math.min(100, Math.round((this.current() / this.target()) * 100));
  });

  readonly isComplete = computed(() => this.percent() >= 100);

  readonly formattedCurrent = computed(() => this.format(this.current()));
  readonly formattedTarget  = computed(() => this.format(this.target()));

  private format(pence: number): string {
    const amount = pence / 100;
    if (!this.currency()) return amount.toFixed(2);
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: this.currency(),
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `${this.currency()} ${amount.toFixed(2)}`;
    }
  }
}
