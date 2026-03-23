import { IMAGE_LOADER, ImageLoaderConfig } from '@angular/common';
import { environment } from '../../../environments/environment';

const base = environment.supabase.url.replace(/\/$/, '');
const OBJECT_PREFIX = `${base}/storage/v1/object/public/`;

/**
 * Custom NgOptimizedImage loader for Supabase Storage.
 *
 * Keeps Supabase public object URLs unchanged. Some tenants do not have
 * Storage image transformation (`/render/image`) enabled and will return 403.
 *
 * Input:  https://….supabase.co/storage/v1/object/public/campaign-images/user/id/cover.jpg
 * Output: https://….supabase.co/storage/v1/object/public/campaign-images/user/id/cover.jpg
 */
function supabaseLoader(config: ImageLoaderConfig): string {
  const { src } = config;

  if (src.startsWith(OBJECT_PREFIX)) {
    return src;
  }

  // Pass-through for non-Supabase URLs (avatars, external images, etc.)
  return src;
}

export const supabaseImageLoader = {
  provide:  IMAGE_LOADER,
  useValue: supabaseLoader,
};
