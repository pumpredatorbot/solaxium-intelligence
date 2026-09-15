import type { Config } from 'tailwindcss';

/**
 * SOLAXIUM INTELLIGENCE design tokens.
 *
 * Two colour systems live here and must not be confused:
 *
 *  - `chrome` neons (cyan/azure/violet/magenta) are for the INTERFACE: brand,
 *    glows, borders, the Core visualisation. They are deliberately bright and
 *    out of the readable lightness band.
 *  - `viz` steps are for DATA MARKS. They were chosen by running the palette
 *    validator against the panel surface (#0A0E1A) and are the only colours
 *    permitted to carry data identity. See docs/DESIGN.md.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // --- surfaces: blue-black, not neutral black -----------------------
        void: '#04050B',
        abyss: '#070A12',
        surface: '#0A0E1A',
        raised: '#0E1422',
        elevated: '#131A2B',
        line: '#171E2F',
        'line-strong': '#232C44',

        // --- text ----------------------------------------------------------
        ink: {
          DEFAULT: '#E6EAF4',
          muted: '#8B95AC',
          faint: '#59637A',
          ghost: '#3A4256',
        },

        // --- interface neons (never a data mark) ----------------------------
        cy: { DEFAULT: '#22E0F0', dim: '#12A8BC', deep: '#0B5F6E' },
        az: { DEFAULT: '#4C8DFF', dim: '#2F5FC4', deep: '#16305F' },
        vi: { DEFAULT: '#9A6BFF', dim: '#6B45C4', deep: '#331F63' },
        mg: { DEFAULT: '#F05BD0', dim: '#B33A99', deep: '#571A4A' },

        // --- validated data-mark steps (see docs/DESIGN.md) ------------------
        viz: {
          1: '#17A3B8', // cyan   — series 1 / single-series default
          2: '#C08428', // amber  — series 2 (validated vs series 1)
          good: '#1E9E74',
          warn: '#C08428',
          bad: '#CC4257',
        },

        // --- status (ships with a label, never colour alone) -----------------
        good: '#2FD69B',
        warn: '#E8A93A',
        bad: '#FF5C77',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        '3xs': ['0.625rem', { lineHeight: '0.875rem' }],
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      letterSpacing: { widest2: '0.2em', widest3: '0.3em' },
      boxShadow: {
        glow: '0 0 0 1px rgba(34,224,240,0.14), 0 0 22px -6px rgba(34,224,240,0.4)',
        'glow-vi': '0 0 0 1px rgba(154,107,255,0.16), 0 0 22px -6px rgba(154,107,255,0.45)',
        panel: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 12px 32px -18px rgba(0,0,0,0.9)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-in': {
          from: { opacity: '0', transform: 'translateY(-4px)' },
          to: { opacity: '1', transform: 'none' },
        },
        breathe: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.4' } },
        sweep: { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(300%)' } },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out both',
        'slide-in': 'slide-in 220ms cubic-bezier(0.2,0.8,0.2,1) both',
        breathe: 'breathe 2.4s ease-in-out infinite',
        sweep: 'sweep 2.6s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
