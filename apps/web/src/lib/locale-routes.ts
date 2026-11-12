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
 * MATCHED BY SHAPE, VALIDATED BY THE LAYOUT. Languages come from the database and can be
 * created after the build, so a prefix is recognised by what it looks like (LANG_SHAPE; it
 * needs caseSensitiveRoutes in next.config.ts), not by a list. Whether it is a language, and
 * switched on, is the layout's question (src/app/[lang]/layout.tsx, via pageLang): /xxYY/quests
 * passes through here untouched and the layout answers 404.
 */
import { BASE_LANG } from "./lang";

/** What a language code looks like: two lowercase letters, two uppercase (enUS). */
export const LANG_SHAPE = "[a-z]{2}[A-Z]{2}";

/**
 * What is never a page: the API, which takes its language as ?lang= (lib/lang.ts withLang);
 * Next's own assets; /downloads, which nginx serves from disk; anything shaped like a
 * language prefix; and a file -- /logo.png, /icons/... -- which a rewrite would send to /enUS/logo.png and a 404.
 */
const BARE_PAGE = `(?!(?:api|_next|downloads|${LANG_SHAPE})(?:/|$))(?!.*\\.).+`;

export const localeRedirects = [
  { source: `/${BASE_LANG}`, destination: "/", permanent: true },
  { source: `/${BASE_LANG}/:path*`, destination: "/:path*", permanent: true },
];

export const localeRewrites = [
  { source: "/", destination: `/${BASE_LANG}` },
  { source: `/:path(${BARE_PAGE})`, destination: `/${BASE_LANG}/:path` },
];
