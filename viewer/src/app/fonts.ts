import localFont from "next/font/local";

// DM Sans — variable font, covers weights 300–700. Default UI / body sans.
//
// Variable-font idiom per Next.js docs: `src` is a string (not an array)
// and `weight` is a range at the top level. The array form is reserved
// for non-variable fonts with multiple discrete weight/style files.
// Mixing the two — array entry with a range like `"300 700"` — was
// tolerated by older Next versions but Next 15.5+ rejects it silently
// during AST processing, which cascades to a module-evaluation failure
// and drops every export in this file.
//
// `preload: true` (default): DM Sans is the body font, every route needs it.
export const dmSans = localFont({
  src: "../../public/fonts/dm-sans-variable.woff2",
  weight: "300 700",
  variable: "--font-dm-sans",
  display: "optional",
});

// JuliaMono — variable font, subsetted at deployment-image build time by
// `axiom/web/scripts/subset-julia-mono.sh` to a Lean-relevant character set
// (Basic Latin + Greek + math blocks; see `julia-mono-subset.txt`). Both
// subsetted outputs are committed so contributors do not need `pyftsubset`
// locally: `julia-mono-subset.woff2` is what this declaration serves to
// browsers, and `julia-mono-subset.woff` exists because Satori (the OG-image
// renderer) cannot read woff2 — the theorem and profile `opengraph-image.tsx`
// routes load it off disk directly, so it is NOT unreferenced despite not
// appearing in any localFont() call.
//
// `preload: true`: any route surfacing inline `<code>` or math needs this on
// first paint, and the subsetted file is small enough (~200 KB) that
// preloading does not bloat the critical path.
export const juliaMono = localFont({
  src: "../../public/fonts/julia-mono-subset.woff2",
  weight: "400",
  variable: "--font-julia-mono",
  display: "swap",
});

// PT Serif — the DEFAULT serif, backing `--font-serif` (the `font-serif`
// utility): what a surface gets unless it opts into `--font-brand-serif` below.
// In practice that is `/pricing` and `/roadmap`. Regular + 700 only.
//
// No ITALIC face: nothing in the app pairs `italic` with a serif utility (the
// only `italic` in `src/` is `font-sans italic`). An unreferenced face is not
// free — `public/` is folded wholesale into the runtime image — so it is
// neither declared nor kept. Re-add declaration and binary together if needed.
//
// `preload: false` DELIBERATELY. Preload is per-family and applies on every
// route importing this module, so it is spent on the face the product's front
// door renders — that is Libre Baskerville (see below), not this one. The two
// surfaces still on PT Serif are secondary, and its `adjustFontFallback`
// fallback measures within 0.3% of the real face (1173px vs 1176px on a fixed
// string at 40px), so a first-visit miss costs letterforms, not layout. If
// PT Serif ever returns to a high-traffic first-impression surface, this flag
// moves with it rather than being added alongside.
//
// `adjustFontFallback: "Times New Roman"` — a SERIF — because next/font's
// default is `Arial`, which would render serif headers in a sans face and
// resolves ahead of the `Georgia, serif` chain in globals.
export const ptSerif = localFont({
  src: [
    {
      path: "../../public/fonts/pt-serif-regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../public/fonts/pt-serif-700.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-pt-serif",
  display: "optional",
  adjustFontFallback: "Times New Roman",
  fallback: ["Georgia", "serif"],
  preload: false,
});

// Libre Baskerville (OFL) — the BRAND serif, backing `--font-brand-serif`, used
// by the landing page only (`src/components/landing/**`, 37 usages). PT Serif
// remains the default every other surface gets, so a page that has not been
// designed against this face cannot be restyled by it — the containment that
// was missing when the redesign first repointed `--font-serif` itself and
// silently reflowed `/pricing` and `/roadmap`.
//
// SIZE-ADJUST is the point of this declaration. Libre Baskerville was drawn for
// screen body text with wider spacing than the metal Baskerville, so at an
// identical `font-size` it sets ~15% wider than PT Serif — measured in real DOM
// layout, a fixed 66-char string at 40px is 1346px against PT Serif's 1173px
// (+14.7% at 400, +18.3% at 700). `size-adjust: 87.1%` (1173 ÷ 1346) scales the
// glyph outlines and metrics so the two occupy the same space at the same
// `font-size`. Verified after: regular measures 1178px against 1176px, 0.17%
// apart. Bold lands ~5% narrower than PT Serif's bold (1198 vs 1262) — the two
// families progress differently across weights and one scalar cannot match
// both; regular was optimised for, since that is where body copy lives.
//
// Done as ONE @font-face descriptor rather than by editing `text-*` classes
// across the 11 landing components: a single number cannot drift per element,
// it holds for copy added later, and it leaves the type scale in the markup
// meaning what it says. Retune this number — do not shrink individual classes —
// if the face is ever swapped again.
//
// `preload: true` + `display: "optional"` are a PAIR, and the pairing is the
// point. `optional` grants the face ~100ms and then never swaps, which is what
// eliminated the hero's header-reflow CLS (issue #1131). But with
// `preload: false` the face is only discovered after CSS parse and enters that
// window with the clock already spent, so a cold first visit reliably fell back
// — reproduced on the dev server, and reported in review as "the font isn't
// applied". Preloading starts the fetch immediately so `optional` SUCCEEDS
// rather than degrades; `optional` still guarantees no swap and no layout shift
// when it loses. This is the landing page: overwhelmingly first-time, cold-cache
// visitors, which is why the per-family preload is spent here.
//
// KNOWN LIMITATION: next/font computes `adjustFontFallback` from the font file's
// own metrics and is unaware of the `size-adjust` above, so this face's
// metric-matched fallback is matched to the UN-adjusted outline and renders
// ~15% wider than the real face. `optional` means no swap inside a page view
// (so no CLS) and `preload: true` means the real face almost always wins, but a
// visitor who loses that race gets wider line breaks than the baselines show.
export const libreBaskerville = localFont({
  src: [
    {
      path: "../../public/fonts/libre-baskerville-regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../public/fonts/libre-baskerville-600.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../../public/fonts/libre-baskerville-700.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  declarations: [{ prop: "size-adjust", value: "87.1%" }],
  variable: "--font-libre-baskerville",
  display: "optional",
  adjustFontFallback: "Times New Roman",
  fallback: ["Georgia", "serif"],
  preload: true,
});

// Commissioner — single weight (600) used exclusively for the "Coherence Labs"
// wordmark (footer, brand-mark contexts). Single-file non-variable; string
// form is cleanest.
//
// `preload: false`: brand-mark only, below the fold in the footer.
export const commissioner = localFont({
  src: "../../public/fonts/commissioner-600.woff2",
  weight: "600",
  variable: "--font-commissioner",
  display: "swap",
  preload: false,
});
