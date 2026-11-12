import fs from "node:fs";
import path from "node:path";

/**
 * The top-level pages, read from src/app/[lang]/: a directory is a page unless it is a route
 * group, a private folder or a dynamic segment. next.config.ts hands them to localeRewrites.
 */
export function pageSections(dir = path.join(__dirname, "..", "app", "[lang]")): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !/^[(_[@]/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}
