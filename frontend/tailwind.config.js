/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Plan 8 Phase 1 — admin-tunable brand palette mapped to CSS custom
        // properties injected by `frontend/src/context/BrandContext.tsx`.
        // New code reaches for `bg-brand-primary` / `text-brand-accent` etc.;
        // the value updates live whenever the admin saves a new color.
        brand: {
          primary:   'var(--brand-primary,   #6A3FF4)',
          secondary: 'var(--brand-secondary, #A855F7)',
          accent:    'var(--brand-accent,    #7B5AFF)',
        },
        // UniFlow brand palette — single source of truth for purple tokens.
        // Existing utility classes (bg-[#6A3FF4] etc.) keep working unchanged;
        // these aliases let new code reach for `bg-uniflow-500` instead.
        uniflow: {
          50:  '#F5F0FF',
          100: '#EBE0FF',
          200: '#D7C2FF',
          300: '#B89DFF',
          400: '#9B7AFF',
          500: '#7B5AFF', // light purple
          600: '#6A3FF4', // PRIMARY
          700: '#5A32D4', // hover/pressed
          800: '#4A28B0',
          900: '#3B1F8C',
          950: '#251058',
        },
        // Canvas backgrounds for each mode. BOTH point at the same CSS var
        // (`--canvas-bg`) which BrandContext writes per active theme — so
        // `bg-canvas-light` (no dark class) and `dark:bg-canvas-dark` resolve
        // to the live value the admin saved in Settings → Brand. The
        // light-vs-dark dispatch happens in BrandContext (it picks the
        // right theme's canvas color based on `isDarkMode`), not in
        // Tailwind, so we don't need two separate tokens here.
        canvas: {
          light: 'var(--canvas-bg, #FFFFFF)',
          dark:  'var(--canvas-bg, #0D0D0D)',
        },
      },
      boxShadow: {
        'glow-sm':  '0 0 12px rgba(106, 63, 244, 0.25)',
        'glow':     '0 0 24px rgba(106, 63, 244, 0.35)',
        'glow-lg':  '0 0 48px rgba(106, 63, 244, 0.45)',
        'glow-inner': 'inset 0 0 24px rgba(106, 63, 244, 0.15)',
      },
      backgroundImage: {
        'uniflow-gradient': 'linear-gradient(135deg, #7B5AFF 0%, #6A3FF4 50%, #5A2AD4 100%)',
        'uniflow-gradient-soft': 'linear-gradient(135deg, #B89DFF 0%, #9B7AFF 50%, #7B5AFF 100%)',
      },
    },
  },
  plugins: [],
};
