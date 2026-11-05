import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: { DEFAULT: 'var(--surface)', sunk: 'var(--surface-sunk)' },
        line: { DEFAULT: 'var(--layer-line)', input: 'var(--line-input)' },
        ink: {
          DEFAULT: 'var(--ink)', soft: 'var(--ink-soft)',
          muted: 'var(--ink-muted)', faint: 'var(--ink-faint)',
        },
        accent: {
          DEFAULT: 'var(--accent)', deep: 'var(--accent-deep)',
          soft: 'var(--accent-soft)', 'soft-ink': 'var(--accent-soft-ink)',
          on: 'var(--on-accent)',
        },
        success: { DEFAULT: 'var(--success)', soft: 'var(--success-soft)' },
        warning: { DEFAULT: 'var(--warning)', soft: 'var(--warning-soft)' },
        danger: { DEFAULT: 'var(--danger)', soft: 'var(--danger-soft)' },
        highlight: { bg: 'var(--highlight-bg)', ink: 'var(--highlight-ink)' },
      },
      boxShadow: {
        e1: 'var(--elevation-1)', e2: 'var(--elevation-2)',
        e3: 'var(--elevation-3)', e4: 'var(--elevation-4)',
        'accent-rest': 'var(--shadow-accent-rest)',
        'accent-hover': 'var(--shadow-accent-hover)',
        'accent-press': 'var(--shadow-accent-press)',
        'inset-input': 'var(--shadow-inset-input)',
      },
      borderRadius: {
        xs: 'var(--radius-xs)', sm: 'var(--radius-sm)', md: 'var(--radius-md)',
        card: 'var(--radius)', pill: 'var(--radius-pill)',
      },
      fontFamily: {
        display: 'var(--font-display)', body: 'var(--font-body)', mono: 'var(--font-mono)',
      },
      fontSize: {
        xs: 'var(--text-xs)', sm: 'var(--text-sm)', label: 'var(--text-label)',
        ui: 'var(--text-ui)', base: 'var(--text-base)', lg: 'var(--text-lg)',
        xl: 'var(--text-xl)', '2xl': 'var(--text-2xl)', display: 'var(--text-display)',
      },
      spacing: {
        1: 'var(--space-1)', 2: 'var(--space-2)', 3: 'var(--space-3)', 4: 'var(--space-4)',
        5: 'var(--space-5)', 6: 'var(--space-6)', 7: 'var(--space-7)', 8: 'var(--space-8)',
        12: 'var(--space-12)', 16: 'var(--space-16)', 20: 'var(--space-20)',
      },
      maxWidth: {
        container: 'var(--container)', command: 'var(--w-command)',
        pipeline: 'var(--w-pipeline)', workbench: 'var(--w-workbench)',
        measure: 'var(--measure)', lead: 'var(--measure-lead)',
      },
      zIndex: {
        sticky: 'var(--z-sticky)', header: 'var(--z-header)', drawer: 'var(--z-drawer)',
        modal: 'var(--z-modal)', toast: 'var(--z-toast)',
      },
      transitionDuration: { fast: 'var(--duration-fast)', base: 'var(--duration-base)' },
      screens: { sm: '760px', md: '900px', lg: '1024px', xl: '1440px' },
    },
  },
  plugins: [],
} satisfies Config
