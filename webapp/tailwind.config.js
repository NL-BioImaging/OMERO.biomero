/** @type {import('tailwindcss').Config} */
module.exports = {
  important: true,
  content: ["./src/**/*.{html,js}"],
  safelist: [
    'grid-cols-1', 'grid-cols-2', 'grid-cols-3', 'grid-cols-4', 'grid-cols-5',
    'grid-cols-6', 'grid-cols-7', 'grid-cols-8', 'grid-cols-9', 'grid-cols-10',
    'grid-cols-11', 'grid-cols-12', // Add all the grid classes you might need
  ],
  theme: {
    extend: {
      colors: {
        "bp-canvas": "var(--biomero-canvas)",
        "bp-surface": "var(--biomero-surface)",
        "bp-muted": "var(--biomero-muted)",
        "bp-border": "var(--biomero-border)",
        "bp-text": "var(--biomero-text)",
        "bp-highlight": "var(--biomero-highlight)",
      },
    },
  },
  plugins: [],
};
