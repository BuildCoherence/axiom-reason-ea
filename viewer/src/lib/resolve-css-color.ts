// Must stay free of `window` / `document` — the server and the WebGL island both
// resolve these colours, and a unit spec asserts the absence.

import { clampChroma, converter, parse } from "culori";

import type { ResolvedMode } from "./theme/apply-theme";

/** sRGB channels, 0–255 integers. */
export type Rgb255 = readonly [r: number, g: number, b: number];

/** Every per-mode custom property `globals.css` declares, named verbatim with the leading `--`. */
export const BASE16_TOKENS = [
  "--base00",
  "--base01",
  "--base02",
  "--base03",
  "--base04",
  "--base05",
  "--base06",
  "--base07",
  "--base08",
  "--base09",
  "--base0A",
  "--base0B",
  "--base0C",
  "--base0D",
  "--base0E",
  "--base0F",
  "--ring",
] as const;

export type Base16Token = (typeof BASE16_TOKENS)[number];

// A mirror of `globals.css`, pinned by `test/unit/resolve-css-color.spec.ts`:
// edit `globals.css` first, this table follows.
export const BASE16_TOKEN_VALUES: Readonly<
  Record<ResolvedMode, Readonly<Record<Base16Token, string>>>
> = {
  light: {
    "--base00": "oklch(0.99 0.005 280)",
    "--base01": "oklch(0.96 0.008 280)",
    "--base02": "oklch(0.9 0.01 280)",
    "--base03": "oklch(0.62 0.02 280)",
    "--base04": "oklch(0.45 0.02 280)",
    "--base05": "oklch(0.2 0.02 280)",
    "--base06": "oklch(0.14 0.02 280)",
    "--base07": "oklch(0.08 0.02 280)",
    "--base08": "oklch(0.55 0.22 25)",
    "--base09": "oklch(0.62 0.17 55)",
    "--base0A": "oklch(0.68 0.15 85)",
    "--base0B": "oklch(0.55 0.16 145)",
    "--base0C": "oklch(0.6 0.12 200)",
    "--base0D": "oklch(0.582 0.245 277)",
    "--base0E": "oklch(0.55 0.22 320)",
    "--base0F": "oklch(0.5 0.11 50)",
    "--ring": "oklch(0.582 0.245 277)",
  },
  dark: {
    "--base00": "oklch(0.15 0.015 280)",
    "--base01": "oklch(0.2 0.018 280)",
    "--base02": "oklch(0.3 0.02 280)",
    "--base03": "oklch(0.5 0.02 280)",
    "--base04": "oklch(0.7 0.015 280)",
    "--base05": "oklch(0.92 0.01 280)",
    "--base06": "oklch(0.96 0.008 280)",
    "--base07": "oklch(0.99 0.005 280)",
    "--base08": "oklch(0.72 0.18 25)",
    "--base09": "oklch(0.76 0.15 55)",
    "--base0A": "oklch(0.85 0.14 85)",
    "--base0B": "oklch(0.75 0.17 145)",
    "--base0C": "oklch(0.78 0.11 200)",
    "--base0D": "oklch(0.622 0.23 280)",
    "--base0E": "oklch(0.72 0.2 320)",
    "--base0F": "oklch(0.65 0.11 50)",
    "--ring": "oklch(0.622 0.23 280)",
  },
};

// base05 is legible against base00 in both modes, so an unknown token degrades
// to a visible colour rather than an invisible one or a throw in a render loop.
export const UNKNOWN_TOKEN_FALLBACK_TOKEN: Base16Token = "--base05";

const KNOWN_TOKENS: ReadonlySet<string> = new Set(BASE16_TOKENS);

const toRgb = converter("rgb");

const memo = new Map<string, Rgb255>();

function channel255(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value * 255)));
}

/** Parse any CSS colour to an sRGB triple, or null. Out-of-gamut `oklch()` is chroma-reduced per CSS Color 4; per-channel clipping is not equivalent and shifts hue on the saturated accents. */
export function parseCssColor(value: string): Rgb255 | null {
  const parsed = parse(value);
  if (!parsed) {
    return null;
  }
  const rgb = toRgb(clampChroma(parsed, "oklch", "rgb"));
  if (!rgb) {
    return null;
  }
  return [channel255(rgb.r), channel255(rgb.g), channel255(rgb.b)];
}

/** True iff `value` is a token this module can resolve. */
export function isBase16Token(value: string): value is Base16Token {
  return KNOWN_TOKENS.has(value);
}

/** Resolve a Base16 token to an sRGB triple; an unrecognised token falls back rather than throwing, because callers are render paths. */
export function resolveCssColor(token: string, mode: ResolvedMode): Rgb255 {
  const name = isBase16Token(token) ? token : UNKNOWN_TOKEN_FALLBACK_TOKEN;
  const key = `${mode}|${name}`;
  const cached = memo.get(key);
  if (cached) {
    return cached;
  }
  const resolved = parseCssColor(BASE16_TOKEN_VALUES[mode][name]);
  if (!resolved) {
    throw new Error(
      `resolve-css-color: BASE16_TOKEN_VALUES[${mode}][${name}] is not a CSS colour culori can parse`,
    );
  }
  memo.set(key, resolved);
  return resolved;
}

/** `#rrggbb`. */
export function rgbToHex([r, g, b]: Rgb255): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** `rgb(r, g, b)`, or `rgba(...)` when an alpha the token does not carry is supplied. */
export function rgbToCss([r, g, b]: Rgb255, alpha?: number): string {
  return alpha === undefined
    ? `rgb(${r}, ${g}, ${b})`
    : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Resolve a token straight to `#rrggbb`. */
export function resolveCssColorHex(token: string, mode: ResolvedMode): string {
  return rgbToHex(resolveCssColor(token, mode));
}
