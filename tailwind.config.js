/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // token-backed (theme-adaptive via CSS variables)
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        surface2: 'var(--surface-2)',
        glass: 'var(--glass)',
        text: 'var(--text)',
        muted: 'var(--muted)',
        line: 'var(--line)',
        // brand accents — literal so /opacity modifiers work; mirror the CSS vars
        primary: { DEFAULT: '#8B5CFF', 2: '#A876FF' },
        cyan2: '#22D3EE',
        teal2: '#2DD4BF',
        gold: '#FFD466',
        emerald2: { DEFAULT: '#1FCB8B', ink: '#0A6B41' },
        danger: '#FF5C69',
        // literal (used by game boards / fixed gradients)
        navy: { DEFAULT: '#0F1E3D', 2: '#16264A' },
      },
      fontFamily: {
        sans: ['"Hind Siliguri"', '"Noto Sans Bengali"', 'system-ui', 'sans-serif'],
        display: ['"Sora"', '"Hind Siliguri"', 'system-ui', 'sans-serif'],
      },
      borderRadius: { card: '20px', sheet: '24px', pill: '999px' },
      boxShadow: {
        soft: '0 8px 30px -12px rgba(0,0,0,.45)',
        elevated: '0 20px 50px -18px rgba(0,0,0,.65)',
        glow: 'var(--glow)',
        'glow-cyan': 'var(--glow-cyan)',
        'glow-gold': 'var(--glow-gold)',
      },
      backgroundImage: {
        grad: 'var(--grad)',
        'grad-cyan': 'var(--grad-cyan)',
        'grad-gold': 'var(--grad-gold)',
        'grad-emerald': 'var(--grad-emerald)',
      },
      keyframes: {
        'slide-up': { '0%': { transform: 'translateY(12px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        'sheet-up': { '0%': { transform: 'translateY(100%)' }, '100%': { transform: 'translateY(0)' } },
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'dice-tumble': { '0%': { transform: 'rotate(0) scale(1)' }, '50%': { transform: 'rotate(180deg) scale(1.2)' }, '100%': { transform: 'rotate(360deg) scale(1)' } },
        'pulse-ring': { '0%,100%': { boxShadow: '0 0 0 0 rgba(31,203,139,.5)' }, '50%': { boxShadow: '0 0 0 8px rgba(31,203,139,0)' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        'bounce-fast': { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-5px)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'rise-in': { '0%': { transform: 'translateY(16px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
      },
      animation: {
        'slide-up': 'slide-up .35s cubic-bezier(.22,1,.36,1)',
        'sheet-up': 'sheet-up .3s cubic-bezier(.22,1,.36,1)',
        'fade-in': 'fade-in .25s ease-out',
        'dice-tumble': 'dice-tumble .5s ease-out',
        'pulse-ring': 'pulse-ring 1.2s ease-in-out infinite',
        float: 'float 4s ease-in-out infinite',
        'bounce-fast': 'bounce-fast .55s ease-in-out infinite',
        shimmer: 'shimmer 1.4s linear infinite',
        'rise-in': 'rise-in .5s cubic-bezier(.22,1,.36,1) both',
      },
    },
  },
  plugins: [],
}
