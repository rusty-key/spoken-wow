import localFont from "next/font/local";

// The Spoken Manager's two faces, so the page and the app read as one. Latin subsets only, and the
// size-adjusted stand-in is off: it covers every glyph, so a Cyrillic or CJK fallback would never be tried.
export const display = localFont({
  src: "../../fonts/cinzel-latin.woff2",
  weight: "400 900",
  variable: "--bn-display",
  adjustFontFallback: false,
  fallback: ["Palatino Linotype", "Georgia", "Noto Serif"],
});
export const body = localFont({
  src: "../../fonts/noto-sans-latin.woff2",
  weight: "100 900",
  variable: "--bn-body",
  adjustFontFallback: false,
  fallback: ["Segoe UI", "Noto Sans", "Helvetica Neue", "Arial"],
});
