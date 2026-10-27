// Tailwind v4 uses a PostCSS plugin (no separate Tailwind config file).
// All theme tokens live in `src/app/globals.css` under `@theme`, per
// the foundation design's two-layer indirection (Base16 source of truth
// → `@theme inline` aliases for shadcn semantic tokens).
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
