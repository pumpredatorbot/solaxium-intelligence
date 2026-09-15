import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: '#050505',
        surface: '#0A0A0A',
        raised: '#101010',
        line: '#1A1A1A',
        'line-strong': '#242424',
        ink: {
          DEFAULT: '#E8EAE9',
          muted: '#8A8F8C',
          faint: '#575C59',
        },
        sol: {
          DEFAULT: '#14F195',
          dim: '#0FB673',
          deep: '#067A4C',
          wash: 'rgba(20, 241, 149, 0.08)',
        },
        warn: '#E0B341',
        danger: '#E05B4A',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      letterSpacing: {
        widest2: '0.22em',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(2px)' },
          to: { opacity: '1', transform: 'none' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
      },
      animation: {
        'fade-in': 'fade-in 220ms ease-out both',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
