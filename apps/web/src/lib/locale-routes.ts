/**
 * The language in the URL, as next.config.ts redirects and rewrites.
 *
 * Every page lives under src/app/[lang]/, and a bare path is English: /quests is served by
 * /enUS/quests without the browser ever seeing the prefix. That keeps every address that
 * existed before languages did -- bookmarks, the addons' Report links, search results -- and
 * gives each page one canonical URL per language, so /enUS/quests is sent back to /quests
 * rather than being a second address for the same thing.
 *
 * CONFIG, NOT MIDDLEWARE. This was src/middleware.ts, and it looped in the standalone bundle:
 * a middleware rewrite carries an absolute URL, whose host there is `localhost` while the
 * server resolves routes against HOSTNAME (127.0.0.1 on the droplet). Next took the mismatch
 * for a rewrite to another server and proxied /enUS/quests back into itself, where it was
 * redirected to /quests -- and the redirect's Location named http://localhost too. `next
 * start` never showed it; the deploy's smoke test of the bundle did. Config rewrites and
 * redirects are relative paths, which have no host to disagree about, and cost nothing per
 * request.
 *
 * A POSITIVE LIST, VALIDATED BY THE LAYOUT. Only the top-level pages under src/app/[lang]/ are
 * rewritten; everything else -- the API, Next's assets, files, and any path with a language
 * prefix, including one created after the build -- passes through untouched. Whether a prefix
 * is a language, and switched on, is the layout's question (src/app/[lang]/layout.tsx, via
 * pageLang): /xxYY/quests reaches it and is answered 404.
 *
 * NOT A NEGATIVE LOOKAHEAD on the language's shape: Next matches before-files rewrites
 * case-insensitively whatever caseSensitiveRoutes says, so [a-z]{2}[A-Z]{2} would also match
 * "npcs" and leave it unrewritten.
 */
import { BASE_LANG } from "./lang";

export const localeRedirects = [
  { source: `/${BASE_LANG}`, destination: "/", permanent: true },
  { source: `/${BASE_LANG}/:path*`, destination: "/:path*", permanent: true },
];

/** The rewrites that serve a bare path as English, for the given top-level pages. */
export function localeRewrites(sections: string[]) {
  const pages = sections.join("|");
  return [
    { source: "/", destination: `/${BASE_LANG}` },
    { source: `/:section(${pages})`, destination: `/${BASE_LANG}/:section` },
    { source: `/:section(${pages})/:rest*`, destination: `/${BASE_LANG}/:section/:rest*` },
  ];
}
