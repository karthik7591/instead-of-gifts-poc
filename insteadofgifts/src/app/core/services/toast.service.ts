import { Injectable, signal } from '@angular/core';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id:         string;
  type:       ToastType;
  message:    string;
  /** True while the slide-out CSS animation is playing — element removed after. */
  dismissing: boolean;
}

/** How long a toast stays visible before auto-dismiss begins. */
const DISPLAY_MS = 4000;
/** Must match the CSS exit-animation duration. */
const EXIT_ANIMATION_MS = 300;

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly _toasts = signal<Toast[]>([]);

  /** Read-only view of the active toast queue consumed by ToastContainerComponent. */
  readonly toasts = this._toasts.asReadonly();

  // ── Public API ────────────────────────────────────────────────────────────

  success(message: string): void { this.add('success', message); }
  error(message: string):   void { this.add('error',   message); }
  info(message: string):    void { this.add('info',    message); }
  warning(message: string): void { this.add('warning', message); }

  /**
   * Begins the dismiss sequence for a toast:
   * 1. Mark as `dismissing` → triggers CSS slide-out animation.
   * 2. After the animation finishes, remove it from the queue.
   */
  dismiss(id: string): void {
    this._toasts.update(ts =>
      ts.map(t => t.id === id ? { ...t, dismissing: true } : t)
    );
    setTimeout(
      () => this._toasts.update(ts => ts.filter(t => t.id !== id)),
      EXIT_ANIMATION_MS,
    );
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private add(type: ToastType, message: string): void {
    const id = crypto.randomUUID();
    this._toasts.update(ts => [...ts, { id, type, message, dismissing: false }]);
    setTimeout(() => this.dismiss(id), DISPLAY_MS);
  }
}
