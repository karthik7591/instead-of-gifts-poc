import { Component, input, ChangeDetectionStrategy } from '@angular/core';

/**
 * Shimmer skeleton that matches the dashboard campaign-card (horizontal) shape.
 * Render `count` copies while data is loading.
 */
@Component({
  selector: 'app-skeleton-loader',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (_ of items(); track $index) {
      <div class="skeleton-card" aria-hidden="true">
        <div class="skeleton-card__body">
          <div class="skeleton-card__main">
            <div class="skeleton skeleton--badge"></div>
            <div class="skeleton skeleton--title"></div>
            <div class="skeleton skeleton--slug"></div>
            <div class="skeleton skeleton--stats"></div>
            <div class="skeleton-actions">
              <div class="skeleton skeleton--btn"></div>
              <div class="skeleton skeleton--btn"></div>
              <div class="skeleton skeleton--btn"></div>
            </div>
          </div>
          <div class="skeleton skeleton--qr"></div>
        </div>
      </div>
    }
  `,
  styleUrl: './skeleton-loader.component.scss',
})
export class SkeletonLoaderComponent {
  readonly count = input<number>(3);

  protected items(): number[] {
    return Array.from({ length: this.count() });
  }
}
