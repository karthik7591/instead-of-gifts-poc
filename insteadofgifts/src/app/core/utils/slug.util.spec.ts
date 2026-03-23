import { generateSlug, appendRandomSuffix } from './slug.util';

describe('generateSlug', () => {
  it('lowercases and hyphenates a simple title', () => {
    expect(generateSlug('Alice Birthday Party')).toBe('alice-birthday-party');
  });

  it('strips punctuation and special characters', () => {
    expect(generateSlug("Alice's 30th Birthday!")).toBe('alices-30th-birthday');
  });

  it('transliterates accented characters', () => {
    expect(generateSlug('Ångström')).toBe('angstrom');
  });

  it('expands & to "and"', () => {
    expect(generateSlug('Salt & Pepper')).toBe('salt-and-pepper');
  });

  it('collapses multiple spaces and hyphens', () => {
    expect(generateSlug('hello   ---   world')).toBe('hello-world');
  });

  it('strips leading and trailing hyphens', () => {
    expect(generateSlug('  !!hello world!!  ')).toBe('hello-world');
  });

  it('returns empty string for blank input', () => {
    expect(generateSlug('')).toBe('');
    expect(generateSlug('   ')).toBe('');
  });

  it('truncates at 60 characters on a word boundary', () => {
    const long = 'word '.repeat(20).trim(); // 99 chars
    const slug = generateSlug(long);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBeFalse();
  });

  it('hard-truncates when no word boundary exists before 60 chars', () => {
    const noSpaces = 'a'.repeat(80);
    const slug = generateSlug(noSpaces);
    expect(slug.length).toBe(60);
  });

  it('ignores emoji and non-latin characters', () => {
    expect(generateSlug('🎂 Party Time 🎉')).toBe('party-time');
  });
});

describe('appendRandomSuffix', () => {
  it('appends a hyphen-separated 4-char suffix', () => {
    const result = appendRandomSuffix('alice-birthday');
    expect(result).toMatch(/^alice-birthday-[a-z2-9]{4}$/);
  });

  it('the result never exceeds 60 characters', () => {
    const long = 'a'.repeat(60);
    expect(appendRandomSuffix(long).length).toBeLessThanOrEqual(60);
  });

  it('generates different suffixes on repeated calls (probabilistic)', () => {
    const results = new Set(
      Array.from({ length: 20 }, () => appendRandomSuffix('test'))
    );
    expect(results.size).toBeGreaterThan(1);
  });
});
