import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { ToastService, Toast } from '../../../core/services/toast.service';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './toast-container.component.html',
  styleUrl: './toast-container.component.scss',
})
export class ToastContainerComponent {
  protected readonly toastSvc = inject(ToastService);

  protected dismiss(id: string): void {
    this.toastSvc.dismiss(id);
  }

  /** Used by the template to coerce the type for aria-label. */
  protected typeLabel(type: Toast['type']): string {
    return ({ success: 'Success', error: 'Error', info: 'Info', warning: 'Warning' })[type];
  }
}
