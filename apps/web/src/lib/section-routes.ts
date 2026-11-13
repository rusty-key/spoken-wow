/**
 * The addresses the places and readables sections had while they were keyed zones and books,
 * sent on to the new ones for good.
 *
 * FOREVER, NOT A TRANSITION. Released addons build {site}/[{lang}/]zones/r/... and
 * books/r/... Report links, players have them saved, and lore.rusty.one's redirects
 * (deploy/web/nginx-lore-redirect.conf) were cached as permanent by every browser that
 * followed one. Each rule keeps the language prefix and everything after the section, and
 * Next carries the query string across. 308 keeps an API call's method and body.
 */
import { CODES } from "./lang";

const RENAMED = { zones: "places", books: "readables" } as const;

/** The pages a section's key names, each also under a language prefix. */
const PAGES = ["", "/contributions", "/reports", "/reports/sort"];

/** A rule per prefix: an optional parameter left empty is not dropped from a destination. */
const PREFIXES = [
  ...PAGES.map((under) => ({ from: under, to: under })),
  ...PAGES.map((under) => ({ from: `/:lang(${CODES.join("|")})${under}`, to: `/:lang${under}` })),
  { from: "/api", to: "/api" },
];

export const sectionRedirects = Object.entries(RENAMED).flatMap(([from, to]) =>
  PREFIXES.map((prefix) => ({
    source: `${prefix.from}/${from}/:path*`,
    destination: `${prefix.to}/${to}/:path*`,
    permanent: true,
  })),
);
