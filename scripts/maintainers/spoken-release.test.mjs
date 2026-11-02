// Runs the script under the macOS system bash (3.2) where there is one, against a curl stand-in
// that logs each call and answers as CurseForge and GitHub do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "spoken-release.sh");
const BASH = existsSync("/bin/bash") ? "/bin/bash" : "bash";

// The zips are copied aside for the test to read, since the script removes its own.
const CURL = `#!/bin/bash
log="$STUB_DIR/calls"
output="" url="" metadata="" file=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) output="$2"; shift 2;;
    -w) shift 2;;
    -H) echo "header $2" >> "$log"; shift 2;;
    -X) shift 2;;
    -d) metadata="$2"; shift 2;;
    --form-string) metadata="\${2#metadata=}"; shift 2;;
    -F) file="\${2#file=@}"; shift 2;;
    -T) file="$2"; shift 2;;
    -*) shift;;
    *) url="$1"; shift;;
  esac
done
echo "url $url" >> "$log"
[ -z "$metadata" ] || printf 'json %s\\n' "$metadata" >> "$log"
[ -z "$file" ] || cp "$file" "$STUB_DIR/$(basename "$file")"
answer() { if [ -n "$output" ]; then printf '%s' "$2" > "$output"; printf '%s' "$1"; else printf '%s' "$2"; fi; }
case "$url" in
  */game/versions) answer 200 '[{"id":11,"gameVersionTypeID":1,"name":"1.15.9"},{"id":22,"gameVersionTypeID":2,"name":"2.5.6"},{"id":33,"gameVersionTypeID":3,"name":"1.60.1"}]';;
  */projects/999/upload-file) answer 413 'too large';;
  */upload-file) answer 200 '{"id":4242}';;
  */releases/tags/SpokenQuestsAudioHorde_ptBR/*) answer 200 '{"upload_url":"https://uploads.github.com/repos/o/r/releases/7/assets{?name,label}","assets":[{"name":"SpokenQuestsAudioHorde_ptBR-1.2.3.zip"}]}';;
  */releases/tags/*) answer 404 '{"message":"Not Found"}';;
  */repos/o/r/releases) answer 201 '{"author":{"id":1},"upload_url":"https://uploads.github.com/repos/o/r/releases/7/assets{?name,label}","assets":[]}';;
  *assets\\?name=*) answer 201 '{"id":1}';;
  *) answer 500 'unexpected';;
esac
`;

function setup(folders = ["SpokenQuestsAudioAlliance_ptBR", "SpokenQuestsAudioHorde_ptBR"]) {
  const dir = mkdtempSync(join(tmpdir(), "spoken-release-"));
  const addons = join(dir, "My AddOns");
  for (const folder of folders) {
    mkdirSync(join(addons, folder, "generated"), { recursive: true });
    writeFileSync(join(addons, folder, `${folder}.toc`), `## Title: |cffb48cffSpoken|r Portuguese ${folder}\r\n## Version: 1.2.3\r\n`);
    writeFileSync(join(addons, folder, "generated", "1.ogg"), "clip");
  }
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "curl"), CURL);
  chmodSync(join(bin, "curl"), 0o755);
  return { dir, addons, bin };
}

function run({ dir, addons, bin }, args = [], env = {}) {
  const result = spawnSync(BASH, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, STUB_DIR: dir, ADDONS_DIR: addons, SPOKEN_LANG: "ptBR", ...env },
  });
  const log = join(dir, "calls");
  return { ...result, calls: existsSync(log) ? readFileSync(log, "utf8") : "" };
}

test("a dry run names what it would send and sends nothing", () => {
  const s = setup();
  const r = run(s, ["--dry-run"], { CF_TOKEN: "secret-cf", CF_SpokenQuestsAudioAlliance_ptBR: "123", GH_TOKEN: "secret-gh", GH_REPO: "o/r" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.calls, "");
  assert.match(r.stdout, /==> 1\/7 SpokenQuestsAudioAlliance_ptBR/);
  assert.match(r.stdout, /would upload to project 123/);
  assert.match(r.stdout, /would release SpokenQuestsAudioHorde_ptBR\/v1\.2\.3 on o\/r/);
  assert.match(r.stdout, /SpokenPlacesAudio_ptBR: not installed/);
  assert.doesNotMatch(r.stdout + r.stderr, /secret/);
});

test("it stops without a language, a folder or a store", () => {
  const s = setup();
  assert.match(run(s, [], { SPOKEN_LANG: "", CF_TOKEN: "t" }).stderr, /no language/);
  assert.match(run(s, [], { ADDONS_DIR: "", CF_TOKEN: "t" }).stderr, /no AddOns folder/);
  assert.match(run(s, []).stderr, /no store/);
  assert.match(run(s, ["--store", "github"], { CF_TOKEN: "t" }).stderr, /GH_TOKEN is not set/);
});

test("the flag overrides the configured language", () => {
  const s = setup(["SpokenPlacesAudio_esMX"]);
  const r = run(s, ["--dry-run", "--lang", "esMX", "--section", "places"], { GH_TOKEN: "t", GH_REPO: "o/r" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /==> 1\/1 SpokenPlacesAudio_esMX/);
});

test("English's folders carry no language", () => {
  const s = setup(["SpokenPlacesAudio"]);
  const r = run(s, ["--dry-run", "--lang", "enUS", "--section", "places"], { GH_TOKEN: "t", GH_REPO: "o/r" });
  assert.match(r.stdout, /would release SpokenPlacesAudio\/v1\.2\.3/);
});

test("a config file fills in what the environment leaves unset, quotes and CRLF aside", () => {
  const s = setup();
  const config = join(s.dir, "my.env");
  writeFileSync(config, `# comment\r\nADDONS_DIR="${s.addons}"\r\nLANGUAGE=frFR\r\nGH_TOKEN=abc\r\nGH_REPO='o/r'\r\n`);
  const r = run(s, ["--dry-run", "--config", config, "--section", "bosses"], { ADDONS_DIR: undefined, SPOKEN_LANG: "ptBR" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /SpokenBossesAudio_ptBR/);
});

test("the old single folder is never a pack", () => {
  const s = setup(["SpokenQuestsAudio_ptBR"]);
  const r = run(s, ["--dry-run"], { GH_TOKEN: "t", GH_REPO: "o/r" });
  assert.doesNotMatch(r.stdout, /SpokenQuestsAudio_ptBR/);
});

test("a CurseForge upload names its clients, Spoken and the changelog, and the zip holds the folder", () => {
  const s = setup();
  const notes = join(s.dir, "notes.md");
  writeFileSync(notes, 'First "line"; with \\ and\n\ttab\n');
  const r = run(s, ["--store", "curseforge", "--changelog", notes], { CF_TOKEN: "secret-cf", CF_SpokenQuestsAudioAlliance_ptBR: "123" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.calls, /url https:\/\/wow\.curseforge\.com\/api\/projects\/123\/upload-file/);
  const metadata = JSON.parse(/^json (.*)$/m.exec(r.calls)[1]);
  assert.deepEqual(metadata.gameVersions, [11, 22, 33]);
  assert.equal(metadata.displayName, "SpokenQuestsAudioAlliance_ptBR 1.2.3");
  assert.equal(metadata.changelog, 'First "line"; with \\ and\n\ttab');
  assert.deepEqual(metadata.relations.projects, [{ slug: "spoken", type: "requiredDependency" }]);
  assert.match(r.stdout, /uploaded: 1/);
  assert.match(r.stdout, /SpokenQuestsAudioHorde_ptBR on CurseForge: no CF_SpokenQuestsAudioHorde_ptBR/);
  assert.doesNotMatch(r.stdout + r.stderr, /secret/);

  const listing = spawnSync("unzip", ["-Z1", join(s.dir, "SpokenQuestsAudioAlliance_ptBR-1.2.3.zip")], { encoding: "utf8" });
  assert.ok(listing.stdout.split("\n").includes("SpokenQuestsAudioAlliance_ptBR/generated/1.ogg"), listing.stdout);
});

// Windows' tar.exe is bsdtar, so this is the same command Git Bash runs there.
const bsdtar = /bsdtar/.test(spawnSync("tar", ["--version"], { encoding: "utf8" }).stdout ?? "");
test("with no zip, bsdtar makes the same zip", { skip: !bsdtar }, () => {
  const s = setup();
  const tools = join(s.dir, "tools");
  mkdirSync(tools);
  for (const tool of ["basename", "cat", "cp", "cut", "dirname", "du", "grep", "head", "mkdir", "mktemp", "rm", "sed", "tar", "tr"]) {
    const found = spawnSync("/bin/bash", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim();
    symlinkSync(found, join(tools, tool));
  }
  const r = run(s, ["--store", "curseforge", "--only", "SpokenQuestsAudioAlliance_ptBR"], { PATH: `${s.bin}:${tools}`, CF_TOKEN: "t", CF_SpokenQuestsAudioAlliance_ptBR: "123" });
  assert.equal(r.status, 0, r.stderr);
  const listing = spawnSync("unzip", ["-Z1", join(s.dir, "SpokenQuestsAudioAlliance_ptBR-1.2.3.zip")], { encoding: "utf8" });
  assert.ok(listing.stdout.split("\n").includes("SpokenQuestsAudioAlliance_ptBR/generated/1.ogg"), listing.stdout);
});

test("without a changelog the note is the pack's title and version", () => {
  const s = setup();
  const r = run(s, ["--store", "curseforge", "--only", "SpokenQuestsAudioAlliance_ptBR"], { CF_TOKEN: "t", CF_SpokenQuestsAudioAlliance_ptBR: "123" });
  const metadata = JSON.parse(/^json (.*)$/m.exec(r.calls)[1]);
  assert.equal(metadata.changelog, "Spoken Portuguese SpokenQuestsAudioAlliance_ptBR 1.2.3");
});

test("a pack CurseForge refuses does not stop the next, and the run fails", () => {
  const s = setup();
  const r = run(s, ["--store", "curseforge"], { CF_TOKEN: "t", CF_SpokenQuestsAudioAlliance_ptBR: "999", CF_SpokenQuestsAudioHorde_ptBR: "123" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /over CurseForge's upload limit/);
  assert.match(r.stdout, /uploaded: 1\n {2}SpokenQuestsAudioHorde_ptBR 1\.2\.3 on CurseForge: project 123, file 4242/);
  assert.match(r.stdout, /failed: 1\n {2}SpokenQuestsAudioAlliance_ptBR on CurseForge/);
});

test("GitHub gets a release per folder, and a zip already there is left alone", () => {
  const s = setup();
  const r = run(s, ["--store", "github"], { GH_TOKEN: "secret-gh", GH_REPO: "o/r" });
  assert.equal(r.status, 0, r.stderr);
  const created = JSON.parse(/^json (.*)$/m.exec(r.calls)[1]);
  assert.equal(created.tag_name, "SpokenQuestsAudioAlliance_ptBR/v1.2.3");
  assert.match(r.calls, /url https:\/\/uploads\.github\.com\/repos\/o\/r\/releases\/7\/assets\?name=SpokenQuestsAudioAlliance_ptBR-1\.2\.3\.zip/);
  assert.doesNotMatch(r.calls, /assets\?name=SpokenQuestsAudioHorde/);
  assert.match(r.stdout, /already there: https:\/\/github\.com\/o\/r\/releases\/tag\/SpokenQuestsAudioHorde_ptBR\/v1\.2\.3/);
  assert.doesNotMatch(r.stdout + r.stderr, /secret/);
});
