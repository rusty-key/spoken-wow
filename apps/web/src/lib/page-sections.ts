import fs from "node:fs";
import path from "node:path";

/**
 * The top-level pages under src/app/[lang]/: every directory but private folders and dynamic
 * segments. A route group is not part of the address, so its pages are listed in its place;
 * skipping it would 404 every bare English address inside it.
 */
export function pageSections(dir = path.join(__dirname, "..", "app", "[lang]")): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !/^[_[@]/.test(entry.name))
    .flatMap((entry) => (entry.name.startsWith("(") ? pageSections(path.join(dir, entry.name)) : [entry.name]))
    .sort();
}
