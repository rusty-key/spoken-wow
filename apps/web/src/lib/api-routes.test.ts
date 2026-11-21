/**
 * Every /api/… path the client asks for has a route behind it.
 *
 * Written after a real failure: the merge moved the zones routes under /api/places/, and
 * the explorer's Player kept requesting /api/audio/<file>.mp3. Nothing caught it. The
 * types could not -- a URL is a string -- and neither could a build, a typecheck or a lint.
 * The page rendered, every line reported its take, and clicking play did nothing at all,
 * because `audio.play()` on a 404 rejects and the handler that swallows the rejection is
 * there for the ordinary case of a play interrupted by the next one.
 *
 * So the check is here instead: read the literal paths out of the source, read the route
 * directories off disk, and insist that each of the first is served by one of the second.
 * A route that moves without its callers now fails a test rather than a click.
 *
 * It reads paths that are LITERAL up to their first interpolation, which is what makes it
 * both sound and cheap: `/api/places/audio/${file}.mp3` is checked as far as
 * /api/places/audio, and that prefix is the part a route move breaks.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..");
const API = join(SRC, "app", "api");

/** Every route.ts under app/api, as the URL path that reaches it. */
function routes(dir: string, prefix: string[] = []): string[][] {
  const found: string[][] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...routes(join(dir, entry.name), [...prefix, entry.name]));
    else if (entry.name === "route.ts") found.push(prefix);
  }
  return found;
}

function sources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sources(path));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(path);
  }
  return found;
}

/**
 * The literal head of every /api/ path in a file, in quotes or backticks.
 *
 * Comments are not excluded, deliberately: a comment naming a route that no longer exists
 * is wrong in its own right, and the files here cite routes by name constantly.
 */
function referenced(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/["'`](\/api\/[^"'`\s)]*)/g)) {
    // Cut at the first interpolation, query or hash: past that the path is not literal.
    const literal = match[1].split("${")[0].split("?")[0].split("#")[0];
    found.add(literal.replace(/\/+$/, ""));
  }
  return [...found];
}

/**
 * Does a route serve this path? A [slug] segment matches one segment, a [...path] matches
 * every remaining one -- and a path may stop short of a route it is a prefix of, since the
 * rest of it is usually the interpolation this cut off.
 */
function servedBy(path: string[], route: string[]): boolean {
  for (const [i, segment] of route.entries()) {
    if (segment.startsWith("[...")) return true;
    if (i >= path.length) return true;
    if (segment.startsWith("[")) continue;
    if (segment !== path[i]) return false;
  }
  return path.length <= route.length;
}

describe("the API paths the app references", () => {
  const known = routes(API);

  it("finds the routes and the callers at all", () => {
    // A guard on the test itself: a rename that empties either list would otherwise turn
    // this file into one that passes by having nothing to say.
    expect(known.length).toBeGreaterThan(20);
    expect(sources(SRC).length).toBeGreaterThan(50);
  });

  it.each(
    sources(SRC).flatMap((file) =>
      referenced(readFileSync(file, "utf8")).map((path) => ({
        file: file.slice(SRC.length + 1),
        path,
      })),
    ),
  )("$path, in $file, has a route", ({ path }) => {
    const segments = path.split("/").filter(Boolean).slice(1);
    expect(
      known.some((route) => servedBy(segments, route)),
      `${path} is not served by any route under app/api`,
    ).toBe(true);
  });
});

it("knows a missing route when it sees one", () => {
  // The bug this file exists for, as data: the path the Player used to build.
  expect(routes(API).some((route) => servedBy(["audio", "1411"], route))).toBe(false);
  expect(statSync(join(API, "places", "audio")).isDirectory()).toBe(true);
});
