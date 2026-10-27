// Pre-paint theme script and the theme-orchestration constants it shares with
// the rest of the app. See the internal axiom-web-theme-foundation doc
// § Theme orchestration for the authoritative description.
//
// PRE_PAINT_THEME_SCRIPT is a string (not a function) because the root layout
// interpolates it directly into a nonced <script> tag via
// dangerouslySetInnerHTML. It runs synchronously in <head> before any module
// loads, so the script body cannot reference these exports and instead inlines
// the same literal values.

export const STORAGE_KEY_MODE = "axiom.theme.mode";
export const STORAGE_KEY_PALETTE = "axiom.theme.palette";

export const KNOWN_MODES = ["light", "dark", "system"] as const;
export const KNOWN_PALETTES = ["axiom"] as const;

export const DEFAULT_MODE = "system" as const;
export const DEFAULT_PALETTE = "axiom" as const;

// The script body is ES5-safe (var, function declarations) because it runs at
// HTML parse time, before any bundler transform reaches it. The constants are
// inlined as string literals: at script-execution time no module graph exists
// to import the exports above from.
//
// The template literal ships VERBATIM in every page's <head> — no minifier
// ever touches string contents — so the body carries no comments and minimal
// whitespace. Document the body here, in TS comments, never inside the string
// (comments in the string leak into the served HTML; they showed up in
// Google's crawled-page view).
//
// Body documentation, top to bottom:
//
// - Each localStorage read is guarded by safeGet — Safari private mode and
//   other storage-disabled environments throw on getItem; the per-read guard
//   ensures one key's failure doesn't suppress the other's value.
// - There is deliberately no outer try/catch wrapping the IIFE: an outer
//   catch would risk swallowing an exception in the attribute-stamping logic
//   and leave <html> unstamped, which is worse than a thrown error at the
//   script tag.
export const PRE_PAINT_THEME_SCRIPT: string = `(function(){
function safeGet(key){try{return localStorage.getItem(key);}catch(e){return null;}}
var KNOWN_MODES=["light","dark","system"];
var KNOWN_PALETTES=["axiom"];
var storedMode=safeGet("axiom.theme.mode");
var mode=KNOWN_MODES.indexOf(storedMode)>=0?storedMode:"system";
var storedPalette=safeGet("axiom.theme.palette");
var palette=KNOWN_PALETTES.indexOf(storedPalette)>=0?storedPalette:"axiom";
var resolved=mode==="system"?(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):mode;
var html=document.documentElement;
html.setAttribute("data-mode",resolved);
html.setAttribute("data-theme",palette);
html.style.colorScheme=resolved;
})();`;
