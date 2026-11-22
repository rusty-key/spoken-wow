// A maintainer's folder for one language: config.json, the token header, batches.log, Discord
// files and release work. One place for every agent, so Claude and Codex read the same settings
// and Text API batch ids never split across two logs.
//
//   node .agents/skills/spoken-lang-daily/state.mjs <lang>   # prints the folder
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const slash = (p) => p.replace(/\\/g, "/");

export function stateDir(lang) {
  if (!/^[a-z]{2}[A-Z]{2}$/.test(lang ?? "")) throw new Error(`a language like deDE, not ${lang}`);
  const dir = slash(join(homedir(), ".config", "spoken", lang));
  const legacy = slash(join(homedir(), ".claude", "spoken", lang));
  if (!existsSync(dir) && existsSync(legacy)) {
    mkdirSync(dirname(dir), { recursive: true });
    renameSync(legacy, dir);
    // config.json names its token header and work folder by path, often inside the old folder.
    const file = `${dir}/config.json`;
    if (existsSync(file)) {
      const old = readFileSync(file, "utf8");
      const moved = old.replaceAll(`~/.claude/spoken/${lang}`, `~/.config/spoken/${lang}`).replaceAll(legacy, dir);
      if (moved !== old) writeFileSync(file, moved);
    }
    console.error(`moved ${legacy} to ${dir}`);
  }
  return dir;
}

// realpath: run through the .claude/skills symlink, argv[1] keeps the link path.
if (process.argv[1] && slash(fileURLToPath(import.meta.url)) === slash(realpathSync(process.argv[1]))) {
  console.log(stateDir(process.argv[2]));
}
