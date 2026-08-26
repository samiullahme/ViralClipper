// tailwind.config.js — Tailwind theme for ViralClipper.
// Dark-only palette: #0f0f0f background with purple #7C3AED accent.
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0f0f0f',        // app background
        panel: '#171717',      // cards / panels
        edge: '#27272a',       // borders
        accent: {
          DEFAULT: '#7C3AED',  // brand purple
          hover: '#6D28D9',
          soft: '#A78BFA',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
