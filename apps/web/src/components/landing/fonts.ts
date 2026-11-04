import localFont from "next/font/local";

// The two faces the Spoken Manager window uses, so the page and the app read as one. Latin
// subsets alone: Cyrillic, Vietnamese, Korean and Chinese draw in the fallback. The fallbacks are
// named here, and the size-adjusted stand-in is off, because that stand-in covers every glyph and
// would end the search before a serif (or a CJK face) was tried.
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
