import fs from "node:fs";
import path from "node:path";

/**
 * The top-level pages, read from src/app/[lang]/: a directory is a page unless it is a private
 * folder or a dynamic segment. A route group adds nothing to the address, so its pages count as
 * top-level; skipping it would drop every Backstage page from localeRewrites, and their bare
 * English addresses would 404. next.config.ts hands the list to localeRewrites.
 */
export function pageSections(dir = path.join(__dirname, "..", "app", "[lang]")): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !/^[_[@]/.test(entry.name))
    .flatMap((entry) => (entry.name.startsWith("(") ? pageSections(path.join(dir, entry.name)) : [entry.name]))
    .sort();
}
