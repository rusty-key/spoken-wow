import { Cinzel, Noto_Sans } from "next/font/google";

// The two faces the Spoken Manager window uses, so the page and the app read as one.
export const display = Cinzel({ subsets: ["latin"], weight: ["600", "700"], variable: "--bn-display" });
export const body = Noto_Sans({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--bn-body" });
