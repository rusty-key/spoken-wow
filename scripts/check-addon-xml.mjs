// The comment rule the WoW client enforces by silently loading nothing.
//
// An XML comment may not contain a double hyphen. Every other comment in this repo is Lua, so
// writing Lua's own marker inside one of these is the natural mistake, and the punishment is
// out of all proportion: the document is invalid, the client loads NONE of the files it lists,
// and the error that reaches the player names a library nobody touched. This is what it looked
// like in practice, from one stray "--" in a comment beside a <Script> line:
//
//     Interface/AddOns/Spoken/Core.lua:8: Cannot find a library instance of "AceTimer-3.0"
//
// Deliberately narrow. This is not a schema check and not a parser: Blizzard's UI.xsd is not
// vendored here, and a real parser would be a dependency for one rule. It checks the rule that
// has actually bitten, plus that every comment is closed, and says so rather than pretending to
// validate more.
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

const files = globSync("addons/**/*.xml")
  .filter((path) => !path.includes("/Libs/"))
  .sort();

let bad = 0;

for (const file of files) {
  const text = readFileSync(file, "utf8");
  let at = 0;

  for (;;) {
    const open = text.indexOf("<!--", at);
    if (open === -1) break;

    const close = text.indexOf("-->", open + 4);
    const line = text.slice(0, open).split("\n").length;

    if (close === -1) {
      console.error(`${file}:${line}: comment is never closed`);
      bad += 1;
      break;
    }

    // The body between "<!--" and "-->" is what may not contain "--".
    const body = text.slice(open + 4, close);
    if (body.includes("--")) {
      const offset = body.indexOf("--");
      const where = line + body.slice(0, offset).split("\n").length - 1;
      console.error(
        `${where === line ? `${file}:${line}` : `${file}:${where}`}: ` +
          `XML comment contains "--", which makes the whole file invalid. ` +
          `The client will load none of the files it lists.`,
      );
      bad += 1;
    }

    at = close + 3;
  }
}

if (bad > 0) {
  console.error(`\n${bad} problem(s). The client would refuse these files without saying so.`);
  process.exit(1);
}

console.log(`addon xml: ${files.length} files, comments well-formed`);
