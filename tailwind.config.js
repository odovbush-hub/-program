/** Tailwind CSS: кольори беруться з CSS-змінних (src/input.css) */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  content: ['./index.html', './js/*.js'],
  theme: {
    extend: {
      colors: {
        page: v('page'),
        card: v('card'),
        ink: v('ink'),
        muted: v('muted'),
        line: v('line'),
        subtle: v('subtle'),
        primary: { DEFAULT: v('primary'), soft: v('primary-soft'), ink: v('primary-ink') },
        success: { DEFAULT: v('success'), soft: v('success-soft'), ink: v('success-ink') },
        danger:  { DEFAULT: v('danger'),  soft: v('danger-soft'),  ink: v('danger-ink') },
        reward:  { DEFAULT: v('reward'),  soft: v('reward-soft'),  ink: v('reward-ink') },
      },
      fontFamily: {
        sans: ['Manrope', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
