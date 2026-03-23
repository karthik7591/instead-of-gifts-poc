/**
 * Slug utilities for InsteadOfGifts campaign URLs.
 * Public URL shape: insteadofgifts.com/[slug]
 */

const MAX_SLUG_LENGTH = 60;

/**
 * Characters used when generating a random suffix.
 * Lowercase alphanumeric only — no ambiguous chars (0/O, 1/l).
 */
const SUFFIX_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

// ---------------------------------------------------------------------------
// Transliteration map — common accented / special characters → ASCII
// ---------------------------------------------------------------------------
const TRANSLITERATION: Record<string, string> = {
  à: 'a', á: 'a', â: 'a', ã: 'a', ä: 'a', å: 'a', æ: 'ae',
  ç: 'c',
  è: 'e', é: 'e', ê: 'e', ë: 'e',
  ì: 'i', í: 'i', î: 'i', ï: 'i',
  ð: 'd',
  ñ: 'n',
  ò: 'o', ó: 'o', ô: 'o', õ: 'o', ö: 'o', ø: 'o',
  ù: 'u', ú: 'u', û: 'u', ü: 'u',
  ý: 'y', ÿ: 'y',
  ß: 'ss',
  þ: 'th',
  '&': 'and',
  '@': 'at',
  '#': 'number',
  '%': 'percent',
  '+': 'plus',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Converts a campaign title into a URL-safe slug.
 *
 * Steps:
 *   1. Transliterate accented / special characters
 *   2. Lowercase
 *   3. Replace non-alphanumeric runs with a single hyphen
 *   4. Strip leading / trailing hyphens
 *   5. Truncate to MAX_SLUG_LENGTH, trimming at a word boundary where possible
 *
 * @example
 *   generateSlug("Alice's 30th Birthday 🎂!")  →  "alices-30th-birthday"
 *   generateSlug("Ångström & Müller")           →  "angstrom-and-muller"
 */
export function generateSlug(title: string): string {
  if (!title?.trim()) return '';

  const transliterated = title
    .split('')
    .map((ch) => TRANSLITERATION[ch.toLowerCase()] ?? ch)
    .join('');

  const lowered = transliterated.toLowerCase();

  // Remove characters that should vanish silently rather than become separators:
  // apostrophes, single/smart quotes, backticks — e.g. "Alice's" → "alices"
  const dequoted = lowered.replace(/['\u2018\u2019`]/g, '');

  // Keep only a-z, 0-9, spaces, hyphens
  const cleaned = dequoted.replace(/[^a-z0-9\s-]/g, ' ');

  // Collapse whitespace/hyphens into single hyphens
  const hyphenated = cleaned.trim().replace(/[\s-]+/g, '-');

  // Strip any residual leading/trailing hyphens
  const stripped = hyphenated.replace(/^-+|-+$/g, '');

  return truncateAtWordBoundary(stripped, MAX_SLUG_LENGTH);
}

/**
 * Appends a cryptographically random 4-character alphanumeric suffix.
 *
 * @example
 *   appendRandomSuffix("alice-birthday")  →  "alice-birthday-k7qm"
 */
export function appendRandomSuffix(slug: string, suffixLength = 4): string {
  const suffix = Array.from(
    { length: suffixLength },
    () => SUFFIX_CHARS[Math.floor(Math.random() * SUFFIX_CHARS.length)]
  ).join('');

  // Trim the base so that base + '-' + suffix never exceeds MAX_SLUG_LENGTH
  const maxBase = MAX_SLUG_LENGTH - suffixLength - 1;
  const base = truncateAtWordBoundary(slug, maxBase);

  return `${base}-${suffix}`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Truncates `slug` to `max` characters, preferring to cut at a hyphen
 * rather than mid-word. Falls back to a hard cut if no hyphen is found.
 */
function truncateAtWordBoundary(slug: string, max: number): string {
  if (slug.length <= max) return slug;

  const truncated = slug.slice(0, max);
  const lastHyphen = truncated.lastIndexOf('-');

  return lastHyphen > 0 ? truncated.slice(0, lastHyphen) : truncated;
}
