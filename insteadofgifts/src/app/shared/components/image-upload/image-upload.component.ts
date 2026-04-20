import {
  Component,
  OnDestroy,
  effect,
  inject,
  input,
  output,
  signal,
  computed,
  untracked,
  ChangeDetectionStrategy,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ImageCroppedEvent, ImageCropperComponent } from 'ngx-image-cropper';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ToastService } from '../../../core/services/toast.service';

/** Accepted MIME types and their canonical file extensions. */
const ACCEPTED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
};
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

type UploadStep = 'idle' | 'compressing' | 'uploading' | 'done' | 'error';

/**
 * ImageUploadComponent
 *
 * Self-contained image upload widget with:
 *  - Drag-and-drop + file-picker fallback
 *  - MIME type + size validation (JPG/PNG/WebP, max 5 MB)
 *  - Client-side compression via browser-image-compression (max 1 MB output)
 *  - Animated progress bar (0–80 % compression, 80–100 % upload)
 *  - Supabase Storage upload to `campaign-images/[userId]/[campaignId]/cover.[ext]`
 *  - Replaces existing image: deletes the old file from Storage first
 *  - Updates the campaign's `cover_image_url` column in the DB
 *
 * Modes
 * ─────
 * ① **Immediate upload** (when `campaignId` is provided):
 *   Compresses → uploads → updates DB → emits `uploaded` with the CDN URL.
 *
 * ② **File-ready** (no `campaignId`; for the create-campaign flow where the
 *   campaign ID doesn't exist yet):
 *   Compresses → shows preview → emits `fileReady` with the `File`.
 *   The caller stores the file and passes it to CampaignService after creation.
 */
@Component({
  selector: 'app-image-upload',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ImageCropperComponent],
  templateUrl: './image-upload.component.html',
  styleUrl:    './image-upload.component.scss',
})
export class ImageUploadComponent implements OnDestroy {
  private readonly supabase   = inject(SupabaseService);
  private readonly toastSvc   = inject(ToastService);
  private readonly platformId = inject(PLATFORM_ID);

  // ── Inputs ─────────────────────────────────────────────────────────────────

  /**
   * Existing CDN URL for the current cover image, if any.
   * Shown as the initial preview; the old file is deleted when replaced.
   */
  readonly existingUrl = input<string | null>(null);

  /**
   * Campaign ID. When provided the component uploads the image immediately
   * after compression and updates the campaign record.
   * Omit in the create-campaign flow (campaign doesn't exist yet).
   */
  readonly campaignId = input<string | null>(null);

  // ── Outputs ────────────────────────────────────────────────────────────────

  /** Emitted with the compressed `File` as soon as compression finishes. */
  readonly fileReady = output<File>();

  /** Emitted after a successful Supabase upload with the new CDN URL. */
  readonly uploaded  = output<string>();

  /** Emitted when the user removes the image (storage file also deleted). */
  readonly removed   = output<void>();

  // ── Internal state ─────────────────────────────────────────────────────────

  readonly previewUrl      = signal<string | null>(null);
  readonly isDragOver      = signal(false);
  readonly step            = signal<UploadStep>('idle');
  readonly compressionPct  = signal(0);
  readonly errorMessage    = signal<string | null>(null);

  // ── Cropper state ──────────────────────────────────────────────────────────

  readonly showCropper       = signal(false);
  readonly cropImageFile     = signal<File | null>(null);
  readonly croppedBlob       = signal<Blob | null>(null);

  /**
   * Combined progress percentage shown in the bar.
   * Compression occupies 0–80 %, the upload step occupies 80–100 %.
   */
  readonly progressPct = computed<number>(() => {
    switch (this.step()) {
      case 'compressing': return Math.round(this.compressionPct() * 0.8);
      case 'uploading':   return 88;   // held until done
      case 'done':        return 100;
      default:            return 0;
    }
  });

  readonly progressLabel = computed<string>(() => {
    switch (this.step()) {
      case 'compressing': return `Compressing… ${Math.round(this.compressionPct())}%`;
      case 'uploading':   return 'Uploading…';
      case 'done':        return 'Uploaded!';
      default:            return '';
    }
  });

  readonly isActive = computed(() =>
    this.step() === 'compressing' || this.step() === 'uploading'
  );

  constructor() {
    // Sync preview with the existingUrl input (only when no local blob is shown).
    effect(() => {
      const url = this.existingUrl();
      untracked(() => {
        if (!this.previewUrl()?.startsWith('blob:')) {
          this.previewUrl.set(url);
        }
      });
    }, { allowSignalWrites: true });
  }

  ngOnDestroy(): void {
    // Revoke any locally created object URL to avoid memory leaks.
    const url = this.previewUrl();
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
  }

  // ── Drag-and-drop handlers ─────────────────────────────────────────────────

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    // Only clear when leaving the drop zone itself, not a child element.
    const target = event.currentTarget as HTMLElement;
    if (!target.contains(event.relatedTarget as Node | null)) {
      this.isDragOver.set(false);
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
    const file = event.dataTransfer?.files[0];
    if (file) void this.processFile(file);
  }

  // ── File-picker handler ────────────────────────────────────────────────────

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file  = input.files?.[0];
    if (file) void this.processFile(file);
    // Reset value so selecting the same file again fires the event
    input.value = '';
  }

  // ── Remove handler ─────────────────────────────────────────────────────────

  async removeImage(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const current = this.previewUrl();

    // Revoke blob URL if present
    if (current?.startsWith('blob:')) URL.revokeObjectURL(current);

    // Delete from Storage if it's a persisted CDN URL
    if (current && !current.startsWith('blob:')) {
      await this.deleteStorageFile(current);

      // Clear cover_image_url in the DB if we have a campaignId
      const cid = this.campaignId();
      if (cid) {
        await this.supabase.client
          .from('campaigns')
          .update({ cover_image_url: null })
          .eq('id', cid);
      }
    }

    this.previewUrl.set(null);
    this.step.set('idle');
    this.errorMessage.set(null);
    this.removed.emit();
  }

  // ── Core processing pipeline ───────────────────────────────────────────────

  async processFile(file: File): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    this.errorMessage.set(null);

    // ── Validate MIME ──────────────────────────────────────────────────────
    if (!Object.keys(ACCEPTED_TYPES).includes(file.type)) {
      this.errorMessage.set('Only JPEG, PNG, and WebP images are supported.');
      return;
    }

    // ── Validate size ──────────────────────────────────────────────────────
    if (file.size > MAX_BYTES) {
      this.errorMessage.set(
        `Image must be under 5 MB (this file is ${(file.size / 1024 / 1024).toFixed(1)} MB).`
      );
      return;
    }

    // ── Open cropper modal ─────────────────────────────────────────────────
    this.cropImageFile.set(file);
    this.croppedBlob.set(null);
    this.showCropper.set(true);
  }

  // ── Cropper event handlers ─────────────────────────────────────────────────

  onImageCropped(event: ImageCroppedEvent): void {
    this.croppedBlob.set(event.blob ?? null);
  }

  async confirmCrop(): Promise<void> {
    const blob = this.croppedBlob();
    const original = this.cropImageFile();
    if (!blob || !original) return;

    this.showCropper.set(false);

    // Convert blob to File with the original name and type
    const croppedFile = new File([blob], original.name, { type: original.type });

    // ── Show preview immediately ───────────────────────────────────────────
    const prevBlob = this.previewUrl();
    if (prevBlob?.startsWith('blob:')) URL.revokeObjectURL(prevBlob);
    this.previewUrl.set(URL.createObjectURL(croppedFile));

    // ── Compress ───────────────────────────────────────────────────────────
    this.step.set('compressing');
    this.compressionPct.set(0);

    let compressed: File;
    try {
      const { default: imageCompression } = await import('browser-image-compression');

      compressed = await imageCompression(croppedFile, {
        maxSizeMB:        1,
        maxWidthOrHeight: 1920,
        useWebWorker:     true,
        fileType:         croppedFile.type as 'image/jpeg' | 'image/png' | 'image/webp',
        onProgress:       (pct) => this.compressionPct.set(pct),
      });
    } catch {
      this.step.set('error');
      this.errorMessage.set('Image compression failed. Please try a different file.');
      return;
    }

    // Emit the compressed file so the parent can use it in the create flow.
    this.fileReady.emit(compressed);

    // ── Upload immediately if campaignId is available ──────────────────────
    const cid = this.campaignId();
    if (cid) {
      await this.uploadFile(compressed, cid);
    } else {
      // Create flow — wait for the parent to call uploadAfterCreate()
      this.step.set('idle');
    }
  }

  cancelCrop(): void {
    this.showCropper.set(false);
    this.cropImageFile.set(null);
    this.croppedBlob.set(null);
  }

  /**
   * Uploads a (pre-compressed) file for a campaign that now has an ID.
   * Called internally after compression, or can be called by the parent
   * in the create flow once the campaign ID is known.
   */
  async uploadFile(file: File, campaignId: string): Promise<void> {
    this.step.set('uploading');

    try {
      const { data: { user } } = await this.supabase.client.auth.getUser();
      if (!user) throw new Error('Must be authenticated to upload images.');

      // Delete the old Storage file before replacing.
      const existing = this.existingUrl();
      if (existing && !existing.startsWith('blob:')) {
        await this.deleteStorageFile(existing);
      }

      const ext  = ACCEPTED_TYPES[file.type] ?? 'jpg';
      const path = `${user.id}/${campaignId}/cover.${ext}`;

      const { error: uploadErr } = await this.supabase.client.storage
        .from('campaign-images')
        .upload(path, file, { upsert: true, contentType: file.type, cacheControl: '31536000' });

      if (uploadErr) throw uploadErr;

      const { data } = this.supabase.client.storage
        .from('campaign-images')
        .getPublicUrl(path);

      const cdnUrl = data.publicUrl;

      // Persist the CDN URL on the campaign record.
      const { error: dbErr } = await this.supabase.client
        .from('campaigns')
        .update({ cover_image_url: cdnUrl })
        .eq('id', campaignId);

      if (dbErr) throw dbErr;

      // Update preview to the canonical CDN URL (replaces the blob URL).
      const prevBlob = this.previewUrl();
      if (prevBlob?.startsWith('blob:')) URL.revokeObjectURL(prevBlob);
      this.previewUrl.set(cdnUrl);

      this.step.set('done');
      this.uploaded.emit(cdnUrl);
      this.toastSvc.success('Cover image uploaded successfully.');

      // Briefly show "Uploaded!" then reset.
      setTimeout(() => {
        if (this.step() === 'done') this.step.set('idle');
      }, 2000);

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Upload failed. Please try again.';
      this.step.set('error');
      this.errorMessage.set(message);
      this.toastSvc.error(message);
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Extracts the storage path from a Supabase public CDN URL and removes
   * the file. Failures are swallowed — a missing file is not a fatal error.
   */
  private async deleteStorageFile(publicUrl: string): Promise<void> {
    const marker = '/campaign-images/';
    const idx    = publicUrl.indexOf(marker);
    if (idx === -1) return;

    const path = publicUrl.slice(idx + marker.length);
    await this.supabase.client.storage.from('campaign-images').remove([path]);
  }
}
