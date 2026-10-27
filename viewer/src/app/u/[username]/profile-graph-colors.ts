import {
  type Rgb255,
  resolveCssColor,
  rgbToCss,
} from "@/lib/resolve-css-color";
import type { ResolvedMode } from "@/lib/theme/apply-theme";
// Type-only: erased at compile time, so `sigma` never reaches the server bundle.
import type { GraphColors } from "./profile-graph";

// Pre-mount frame only: `resolvedMode` is the SSR-stable `"light"` placeholder
// until the ThemeProvider's post-hydration sync, so deriving swatches from tokens
// before then paints a wrong-theme frame. Concrete rgb/hex — sigma's WebGL parser
// accepts nothing else.
export const FALLBACK_COLORS: GraphColors = {
  axiom: "#ecc233",
  proof: "#45c3dd",
  projection: "#5fb66b",
  propositionOver: "#655af5", // Axiom purple (base0D) — over-determined proposition nodes
  faded: "#9aa0ad",
  edge: "rgba(67, 76, 94, 0.4)",
  edgeWidth: 0.5,
  edgeHighlight: "#81a1c1",
  edgeDroppable: "rgba(154, 160, 173, 0.4)",
  label: "#d8dee9",
  labelBg: "#2e3440",
  ring: "#bf616a", // base08 error accent (premise-of-False ring, #4)
};

// How far to push node-colour saturation toward full (0 = unchanged, 1 = full).
export const NODE_SAT_BOOST = 0.5;

/** Blend an sRGB triple's HSL saturation toward full by `t`, preserving hue and lightness; serialised as the `rgb(r, g, b)` form sigma's WebGL parser accepts. */
export function saturate(rgb: Rgb255, t: number): string {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return rgbToCss(rgb);
  const l = (max + min) / 2;
  const d = max - min;
  let s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h /= 6;
  s = s + (1 - s) * t;
  const hue2rgb = (p: number, q: number, tt: number): number => {
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const to255 = (v: number): number => Math.round(v * 255);
  return `rgb(${to255(hue2rgb(p, q, h + 1 / 3))}, ${to255(hue2rgb(p, q, h))}, ${to255(hue2rgb(p, q, h - 1 / 3))})`;
}

/** The graph palette for one resolved theme mode. Pure: same mode, same colours. */
export function graphColorsFor(mode: ResolvedMode): GraphColors {
  const token = (name: string): Rgb255 => resolveCssColor(name, mode);
  // The edge takes a different token per mode: base02 ≈ the background in light,
  // so it would be invisible there.
  const isLight = mode === "light";
  return {
    axiom: saturate(token("--base0A"), NODE_SAT_BOOST),
    proof: saturate(token("--base0C"), NODE_SAT_BOOST),
    projection: saturate(token("--base0B"), NODE_SAT_BOOST),
    propositionOver: saturate(token("--base0D"), NODE_SAT_BOOST),
    faded: rgbToCss(token("--base04")),
    edge: isLight
      ? rgbToCss(token("--base04"), 0.6)
      : rgbToCss(token("--base02"), 0.22),
    edgeWidth: isLight ? 1.2 : 0.5,
    edgeHighlight: rgbToCss(token("--base0D")),
    edgeDroppable: rgbToCss(token("--base04"), 0.4),
    label: rgbToCss(token("--base05")),
    // base00 against the base05 `label` is the page's own fg-on-bg contrast.
    labelBg: rgbToCss(token("--base00")),
    ring: rgbToCss(token("--base08")),
  };
}
