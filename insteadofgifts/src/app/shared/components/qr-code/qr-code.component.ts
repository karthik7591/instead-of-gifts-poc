import {
  Component,
  effect,
  inject,
  input,
  viewChild,
  ElementRef,
  ChangeDetectionStrategy,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import * as QRCode from 'qrcode';

/**
 * QrCodeComponent
 *
 * Renders a QR code directly onto a <canvas> element using the `qrcode` library.
 *
 * - For Pro campaigns (`isPro = true`):  crisp QR + "Download QR" button.
 * - For Free campaigns (`isPro = false`): blurred/locked overlay with an
 *   "Upgrade to Pro" CTA so the organiser understands the feature exists.
 *
 * The canvas is always rendered so the blur effect has something to show.
 * All canvas work is guarded with `isPlatformBrowser` for SSR safety.
 */
@Component({
  selector: 'app-qr-code',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './qr-code.component.html',
  styleUrl:    './qr-code.component.scss',
})
export class QrCodeComponent {
  private readonly platformId = inject(PLATFORM_ID);

  // ── Inputs ─────────────────────────────────────────────────────────────────

  /** The URL (or any string) to encode in the QR. */
  readonly url      = input.required<string>();
  /** When false the QR is blurred and a Pro upgrade CTA is shown. */
  readonly isPro    = input<boolean>(false);
  /** Canvas pixel size (square). Default 200. */
  readonly size     = input<number>(200);
  /** Suggested filename (without extension) used when downloading. */
  readonly filename = input<string>('qr-code');
  /** When false the built-in Download QR button is hidden (caller provides its own). */
  readonly showDownload = input<boolean>(true);

  // ── Template ref ───────────────────────────────────────────────────────────

  readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('qrCanvas');

  // ── Reactive rendering ─────────────────────────────────────────────────────

  constructor() {
    /**
     * Re-render the QR whenever `url` or `size` changes.
     * The effect is also triggered once `canvasRef` resolves from undefined
     * to the actual element after view init.
     */
    effect(() => {
      const url    = this.url();
      const size   = this.size();
      const canvas = this.canvasRef()?.nativeElement;

      if (!url || !canvas || !isPlatformBrowser(this.platformId)) return;

      void QRCode.toCanvas(canvas, url, {
        width:  size,
        margin: 2,
        color: {
          // Brand green modules on white background as specified.
          // Using a slightly darker shade (#6BAF44) to improve scan reliability
          // while staying within the brand palette.
          dark:  '#4A7255',   // forest — strong contrast, scannable
          light: '#FFFFFF',
        },
      });
    });
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  /** Exports the current canvas as a PNG and triggers a browser download. */
  downloadQr(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;

    const link      = document.createElement('a');
    link.download   = `${this.filename()}.png`;
    link.href       = canvas.toDataURL('image/png');
    link.click();
  }
}
