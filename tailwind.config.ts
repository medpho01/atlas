import type { Config } from 'tailwindcss';

const cssVar = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      colors: {
        // INK — drives all neutral text/bg/border. Inverts in dark mode (ink-900 = strong text, ink-50 = page bg, in both modes).
        ink: {
          50: cssVar('--ink-50'),
          100: cssVar('--ink-100'),
          150: cssVar('--ink-150'),
          200: cssVar('--ink-200'),
          300: cssVar('--ink-300'),
          400: cssVar('--ink-400'),
          500: cssVar('--ink-500'),
          600: cssVar('--ink-600'),
          700: cssVar('--ink-700'),
          800: cssVar('--ink-800'),
          900: cssVar('--ink-900'),
        },
        // Surface — explicit card / form-control background (replaces bg-white for theme-aware components).
        surface: cssVar('--surface'),
        'surface-elevated': cssVar('--surface-elevated'),
        // Brand — fixed. Brand-50 + brand-100 are theme-aware soft tints (since light blue looks wrong on dark).
        brand: {
          50: cssVar('--brand-50'),
          100: cssVar('--brand-100'),
          200: '#bdd2fd',
          400: '#5b8def',
          500: '#3367e8',
          600: '#1f4ed6',
          700: '#1d40af',
          800: '#1e3a8a',
          900: '#1e3573',
        },
        // Semantic tints (50/100 adapt for dark; 500+ stay fixed for visibility on any bg)
        success: {
          50: cssVar('--success-50'),
          100: cssVar('--success-100'),
          500: '#16a34a',
          600: '#15803d',
          700: '#22c55e',
        },
        warn: {
          50: cssVar('--warn-50'),
          100: cssVar('--warn-100'),
          500: '#d97706',
          600: '#f59e0b',
        },
        danger: {
          50: cssVar('--danger-50'),
          100: cssVar('--danger-100'),
          500: '#dc2626',
          600: '#ef4444',
        },
        // Legacy aliases
        'health-green': '#16a34a',
        'health-amber': '#d97706',
        'health-red': '#dc2626',
        'health-grey': '#94a3b8',
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06)',
        'card-lg': '0 4px 12px -2px rgb(0 0 0 / 0.06), 0 2px 4px -2px rgb(0 0 0 / 0.04)',
        pop: '0 8px 24px -6px rgb(0 0 0 / 0.12), 0 2px 8px -2px rgb(0 0 0 / 0.06)',
      },
      borderRadius: {
        DEFAULT: '6px',
        lg: '8px',
        xl: '12px',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 240ms ease-out',
        'slide-up': 'slide-up 280ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
