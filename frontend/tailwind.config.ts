import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    // ---------- 顶层覆盖：只能用令牌 ----------
    colors: {
      transparent: 'transparent', current: 'currentColor', inherit: 'inherit',
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
        'tint-hover': 'var(--accent-tint-hover)', 'tint-press': 'var(--accent-tint-press)',
      },
      disabled: 'var(--disabled-bg)',
      'track-off': 'var(--track-off)',
      success: { DEFAULT: 'var(--success)', soft: 'var(--success-soft)' },
      warning: { DEFAULT: 'var(--warning)', soft: 'var(--warning-soft)' },
      danger: { DEFAULT: 'var(--danger)', soft: 'var(--danger-soft)' },
      highlight: { bg: 'var(--highlight-bg)', ink: 'var(--highlight-ink)' },
    },
    boxShadow: {
      none: 'none',
      e1: 'var(--elevation-1)', e2: 'var(--elevation-2)',
      e3: 'var(--elevation-3)', e4: 'var(--elevation-4)',
      'top-edge': 'var(--elevation-top-edge)',
      'accent-rest': 'var(--shadow-accent-rest)',
      'accent-hover': 'var(--shadow-accent-hover)',
      'accent-press': 'var(--shadow-accent-press)',
      'inset-input': 'var(--shadow-inset-input)',
      'inset-track': 'var(--shadow-inset-track)',
      'focus-soft': 'var(--ring-focus-soft)',
    },
    borderRadius: {
      none: '0',
      xs: 'var(--radius-xs)', sm: 'var(--radius-sm)', md: 'var(--radius-md)',
      card: 'var(--radius)', pill: 'var(--radius-pill)',
    },
    fontSize: {
      xs: 'var(--text-xs)', sm: 'var(--text-sm)', label: 'var(--text-label)',
      ui: 'var(--text-ui)', base: 'var(--text-base)', lg: 'var(--text-lg)',
      xl: 'var(--text-xl)', '2xl': 'var(--text-2xl)', display: 'var(--text-display)',
    },
    // ---------- extend：保留默认尺寸刻度 ----------
    extend: {
      borderColor: { DEFAULT: 'var(--layer-line)' },
      // 不映射时，不带颜色的 ring 会退回 Tailwind 内置的 #3b82f6
      ringColor: { DEFAULT: 'var(--accent)' },
      ringOffsetColor: { DEFAULT: 'var(--surface)' },
      fontFamily: {
        display: 'var(--font-display)', body: 'var(--font-body)', mono: 'var(--font-mono)',
      },
      lineHeight: {
        body: 'var(--leading-body)', heading: 'var(--leading-heading)',
        display: 'var(--leading-display)',
      },
      letterSpacing: {
        eyebrow: 'var(--tracking-eyebrow)', meta: 'var(--tracking-meta)',
        'label-caps': 'var(--tracking-label-caps)',
      },
      transitionTimingFunction: { DEFAULT: 'var(--ease)' },
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
