// take -> addons/SpokenReadablesAudio/Data/Sounds.lua, by hand.
//
// The work is in lib/lookup.mjs because the site runs it too, when the regeneration queue
// drains. This is the command that does it after a batch generated somewhere else.

import { loadEnv } from "../../lib/env.mjs";
import { buildLookup } from "./lib/lookup.mjs";

// The repo-root .env holds the shared credentials, this pipeline's .env whatever is its
// own; neither is read unless a command like this one asks for it, because lib/ is
// compiled into the site and its paths would be the build machine's.
await loadEnv("readables");

const lang = process.argv.find((arg) => arg.startsWith("--lang="))?.slice("--lang=".length) || "enUS";
const { clips, pages, path } = await buildLookup({ lang });
console.log(`${clips} clips${pages === null ? "" : `, ${pages} ${lang} pages indexed`} -> ${path}`);
// English's index is Books.lua, so its pack carries only pages English lacks, often none.
if (pages === 0 && lang !== "enUS") {
  console.warn(`warning: no ${lang} pages imported (make readables-import-locale LOCALE=${lang}), so a ${lang} client will find none`);
}
