/** @type {import('tailwindcss').Config} */
module.exports = {
  // JIT is the default and only engine in Tailwind v3 — no flag needed.
  content: [
    './src/**/*.{html,ts}',
  ],
  theme: {
    extend: {
      // ── Brand colours ──────────────────────────────────────────────────────
      // Generates bg-*, text-*, border-*, ring-*, placeholder-* etc. for every
      // token, e.g. bg-brand-green, text-forest, border-mint.
      colors: {
        // Brand greens
        'sage-dark':   '#5E7A65',
        'forest':      '#4A7255',
        'brand-green': '#95C476',
        'mint':        '#C3DEA7',
        'pale-green':  '#EAF4DF',

        // Text
        'text-dark':   '#1E2D23',
        'text-mid':    '#3D5445',
        'text-muted':  '#6A8272',

        // UI
        'border-col':  '#CCCCCC',

        // Semantic
        'success':     '#4CAF50',
        'warning':     '#F4B942',
        'error':       '#E53935',
        'info':        '#2196F3',

        // Pro / upgrade tier
        'pro':         '#6B3FA0',
        'pro-dark':    '#4E2D78',
      },

      // ── Font families ───────────────────────────────────────────────────────
      fontFamily: {
        sans:  ['Inter', 'Arial', 'sans-serif'],
        serif: ['Lora', 'Georgia', 'serif'],
        mono:  ['JetBrains Mono', 'Fira Code', 'monospace'],
      },

      // ── Spacing scale ──────────────────────────────────────────────────────
      // Extends (not replaces) Tailwind's default scale.
      // Matches the --spacing-* CSS custom properties in _tokens.scss.
      spacing: {
        '1':  '0.25rem',   //  4px
        '2':  '0.5rem',    //  8px
        '3':  '0.75rem',   // 12px
        '4':  '1rem',      // 16px
        '5':  '1.25rem',   // 20px
        '6':  '1.5rem',    // 24px
        '7':  '1.75rem',   // 28px
        '8':  '2rem',      // 32px
        '9':  '2.25rem',   // 36px
        '10': '2.5rem',    // 40px
      },

      // ── Box shadows ─────────────────────────────────────────────────────────
      boxShadow: {
        'card':  '0 2px 8px rgba(94, 122, 101, 0.12)',
        'hover': '0 6px 16px rgba(94, 122, 101, 0.22)',
      },

      // ── Border radius ───────────────────────────────────────────────────────
      borderRadius: {
        'sm': '0.25rem',
        'md': '0.5rem',
        'lg': '0.75rem',
        'xl': '1rem',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
  ],
}

