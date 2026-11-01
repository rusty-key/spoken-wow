import localFont from "next/font/local";

// The two faces the Spoken Manager window uses, so the page and the app read as one. Latin alone:
// the page is written in English.
export const display = localFont({ src: "../../fonts/cinzel-latin.woff2", weight: "400 900", variable: "--bn-display" });
export const body = localFont({ src: "../../fonts/noto-sans-latin.woff2", weight: "100 900", variable: "--bn-body" });
