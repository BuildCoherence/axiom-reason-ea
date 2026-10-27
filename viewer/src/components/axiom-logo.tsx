// Presentational Axiom brand mark — the purple squircle + linked-nodes glyph.
// Paths mirror the source mark at public/favicon.svg (the app favicon); kept
// inline here so the in-page logo is CSP-safe (no external request, no
// next/image SVG config) and stays crisp at any size. The mark carries its
// own fixed brand colours (Axiom purple #655af5 background + white glyph), so
// it reads correctly in both light and dark modes without theming.
//
// Decorative by default (`aria-hidden`): the accessible name comes from the
// surrounding link/label text ("AXIOM"). Size via `className` (e.g. h-9 w-9).

export function AxiomLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="41.585 38.614 499.276 499.276"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path
        fill="#655af5"
        fillRule="evenodd"
        d="M41.585 288.252c0-137.871 111.767-249.638 249.638-249.638a249.64 249.64 0 0 1 249.638 249.638c0 137.871-111.767 249.638-249.638 249.638S41.585 426.123 41.585 288.252"
      />
      <path
        stroke="#fff"
        strokeLinecap="butt"
        strokeLinejoin="round"
        strokeWidth="16"
        d="M95.367 288.252c0-66.274 53.726-120 120-120a120 120 0 0 1 120 120c0 66.274-53.725 120-120 120-66.274 0-120-53.726-120-120z"
      />
      <path
        stroke="#fff"
        strokeLinecap="butt"
        strokeLinejoin="round"
        strokeWidth="16"
        d="M247.079 288.252c0-66.274 53.726-120 120-120a120 120 0 0 1 120 120c0 66.274-53.726 120-120 120s-120-53.726-120-120z"
      />
      <path
        fill="#fff"
        fillRule="evenodd"
        stroke="#fff"
        strokeLinecap="butt"
        strokeLinejoin="round"
        strokeWidth="12"
        d="M135.944 288.252c0-10.602 8.594-19.197 19.196-19.197a19.197 19.197 0 0 1 19.197 19.197c0 10.602-8.594 19.197-19.197 19.197s-19.196-8.595-19.196-19.197z"
      />
      <path
        fill="#fff"
        fillRule="evenodd"
        stroke="#fff"
        strokeLinecap="butt"
        strokeLinejoin="round"
        strokeWidth="12"
        d="M272.026 288.252c0-10.602 8.595-19.197 19.197-19.197a19.197 19.197 0 0 1 19.197 19.197c0 10.602-8.595 19.197-19.197 19.197s-19.197-8.595-19.197-19.197z"
      />
      <path
        fill="#fff"
        fillRule="evenodd"
        stroke="#fff"
        strokeLinecap="butt"
        strokeLinejoin="round"
        strokeWidth="12"
        d="M408.109 288.252c0-10.602 8.595-19.197 19.197-19.197a19.197 19.197 0 0 1 19.197 19.197c0 10.602-8.595 19.197-19.197 19.197s-19.197-8.595-19.197-19.197z"
      />
      <path
        stroke="#fff"
        strokeLinecap="butt"
        strokeLinejoin="round"
        strokeWidth="16"
        d="M174.337 288.252h97.701"
      />
      <path
        stroke="#fff"
        strokeLinecap="butt"
        strokeLinejoin="round"
        strokeWidth="16"
        d="M310.42 288.252h97.7"
      />
    </svg>
  );
}
