// Zips a pack as the Manager installed it, for a manual upload on the CurseForge website. The
// upload API (Manager, spoken-release.sh) refuses big files the website still takes: a 550 MB zip
// failed with HTTP 413 over the API and went through on the website.
//
//   node zip.mjs --lang <xxXX> <folder> [--changelog <notes.md>]
//
// Same zip as spoken-release.sh makes: stored, not compressed, the pack folder at the top.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.mjs";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const folder = args.find((a, i) => !a.startsWith("--") && !["--changelog", "--lang"].includes(args[i - 1]));
if (!folder || !opt("--lang")) throw new Error("usage: node zip.mjs --lang <xxXX> <folder> [--changelog <notes.md>]");
const cfg = loadConfig(opt("--lang"));

const toc = join(cfg.addonsDir, folder, `${folder}.toc`);
if (!existsSync(toc)) throw new Error(`${folder} is not installed in ${cfg.addonsDir}`);
const version = (readFileSync(toc, "utf8").match(/^## Version:[ \t]*(\S+)/m) ?? [])[1];
if (!version) throw new Error(`${folder}.toc has no ## Version`);

const out = `${cfg.workDir}/manual`;
mkdirSync(out, { recursive: true });
const zip = join(out, `${folder}-${version}.zip`);
if (existsSync(zip)) unlinkSync(zip);
// Windows' own bsdtar writes zips; on macOS and Linux, zip -0 stores without compressing.
const r = process.platform === "win32"
  ? spawnSync(join(process.env.SYSTEMROOT ?? "C:/Windows", "System32", "tar.exe"),
    ["-a", "-c", "-f", zip, "--exclude", ".DS_Store", "--options", "zip:compression=store", "-C", cfg.addonsDir, folder], { stdio: "inherit" })
  : spawnSync("zip", ["-0", "-r", "-q", zip, folder, "-x", "*.DS_Store"], { cwd: cfg.addonsDir, stdio: "inherit" });
if (r.status !== 0) process.exit(r.status ?? 1);

console.log(`Zip:          ${zip.replace(/\\/g, "/")}`);
console.log(`Size:         ${(statSync(zip).size / 1e6).toFixed(1)} MB`);
console.log(`Display name: ${folder} ${version}`);
const notes = opt("--changelog");
if (notes) console.log(`Changelog:\n\n${readFileSync(notes, "utf8")}`);
