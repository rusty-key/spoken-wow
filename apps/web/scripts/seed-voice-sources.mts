/**
 * Give every voice slot, in every language under SRC, a 30-second source: its clips and its
 * fish.audio reference, written into this checkout's samples, references and database.
 *
 *   cd apps/web
 *   ADMIN_EMAIL=you@example.com npx tsx --conditions=react-server scripts/seed-voice-sources.mts
 *
 * Per <lang>/<race-gender>/<flavor>/ in SRC (default ~/code/own/seed-clips), or <lang>/<slot>/
 * for a slot with no flavor such as narrator-male: the clips in name order, 0.5 s apart,
 * until 30 s, replace the slot's clips; the reference is cut from all of
 * it and transcribed on ADMIN_EMAIL's stored fish.audio key (or FISH_API_KEY), and recorded
 * as ADMIN_EMAIL's. Through the app's own
 * storeSample and saveReference, so the stored names and the clipHash are the app's.
 *
 * Optional: LANGS=deDE,frFR  VOICES=dwarf-male-grim  CONCURRENCY=4
 * --conditions=react-server is what lets "server-only" be imported outside Next.
 *
 * scripts/voice/push-sources.sh then copies the result onto the droplet.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

// Before any app module reads process.env: DATABASE_URL, SPOKEN_SECRET_KEY and the paths.
process.loadEnvFile(".env.local");

const run = promisify(execFile);

const SRC = process.env.SRC ?? path.join(os.homedir(), "code/own/seed-clips");
const LANGS = process.env.LANGS?.split(",");
const VOICES = process.env.VOICES?.split(",");
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);
const TARGET = 30;
const GAP = 0.5;
const MIN_REFERENCE = 10;

const { closeDb, db } = await import("@/lib/db");
const { readApiKey } = await import("@/lib/api-key");
const { isLang, elevenLabsCode } = await import("@/lib/lang");
const { cloneName } = await import("@/lib/voices/clone-name");
const { transcribe } = await import("@/lib/voices/fish");
const { saveReference } = await import("@/lib/voices/references");
const { deleteSample, listSamples, samplePath, storeSample, voiceDir } = await import(
  "@/lib/voices/samples"
);
const { isVoiceSlot } = await import("@/lib/voices/slots");

const email = process.env.ADMIN_EMAIL;
if (!email) throw new Error("ADMIN_EMAIL is required: whose fish.audio key transcribes");
const { rows } = await db().query<{ id: string }>(`select "id" from "user" where "email" = $1`, [email]);
if (!rows[0]) throw new Error(`no user ${email}`);
const userId = rows[0].id;
// Or FISH_API_KEY, for a checkout whose database has no key stored for anyone.
const fishKey = process.env.FISH_API_KEY ?? (await readApiKey(userId, "fish"));
if (!fishKey) throw new Error(`${email} has no fish.audio key stored; set FISH_API_KEY`);

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "voice-sources-"));

async function dirs(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

async function duration(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file,
  ]);
  return Number(stdout.trim());
}

/** The clips in order, GAP apart, cut at TARGET; mono mp3. No gap after the last. */
async function concat(clips: string[], out: string) {
  const picked: string[] = [];
  let total = 0;
  for (const clip of clips) {
    if (total >= TARGET) break;
    picked.push(clip);
    total += (await duration(clip)) + GAP;
  }
  const chains = picked
    .map((_, i) => {
      const pad = i < picked.length - 1 ? `,apad=pad_dur=${GAP}` : "";
      return `[${i}:a]aresample=44100,aformat=channel_layouts=mono${pad}[a${i}]`;
    })
    .join(";");
  const labels = picked.map((_, i) => `[a${i}]`).join("");
  await run("ffmpeg", [
    "-v", "error", "-y",
    ...picked.flatMap((clip) => ["-i", clip]),
    "-filter_complex", `${chains};${labels}concat=n=${picked.length}:v=0:a=1,atrim=0:${TARGET}[out]`,
    "-map", "[out]", "-c:a", "libmp3lame", "-b:a", "128k", out,
  ]);
  return { length: await duration(out), used: picked.length };
}

type Job = { lang: string; voice: string; clips: string[] };

// Written for push-sources.sh: the clip directories this run replaced, relative to the
// samples root, so the droplet's copies of exactly those can be cleared before the push.
// Recorded once the clips are replaced, whether or not the reference then succeeds.
const seeded: string[] = [];

async function seed({ lang, voice, clips }: Job): Promise<string> {
  if (!isLang(lang)) throw new Error(`unknown language ${lang}`);
  if (!(await isVoiceSlot(voice))) throw new Error("not on the roster");
  const clone = cloneName(voice, lang);

  const out = path.join(tmp, lang, `${voice}-30s.mp3`);
  await fs.mkdir(path.dirname(out), { recursive: true });
  const { length, used } = await concat(clips, out);

  // Replace, not add: a clone reads every clip in the folder.
  for (const sample of await listSamples(clone)) await deleteSample(clone, sample.file);
  const stored = await storeSample(clone, path.basename(out), await fs.readFile(out));
  seeded.push(await voiceDir(clone));

  const summary = `${used}/${clips.length} clips, ${length.toFixed(1)} s`;
  if (length < MIN_REFERENCE) return `${summary}, clips only: too short for a reference`;
  await saveReference({
    voice,
    lang,
    sample: stored.file,
    sourcePath: await samplePath(clone, stored.file),
    startSec: 0,
    endSec: Math.min(TARGET, Math.floor(length * 10) / 10),
    userId,
    transcribe: (audio) => transcribe(audio, elevenLabsCode(lang), { apiKey: fishKey! }),
  });
  return `${summary}, clips + reference`;
}

async function clipsIn(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && !e.name.startsWith("."))
    .map((e) => path.join(dir, e.name))
    .sort();
}

const jobs: Job[] = [];
const wanted = (voice: string) => !VOICES || VOICES.includes(voice);
for (const lang of (await dirs(SRC)).filter((l) => !LANGS || LANGS.includes(l))) {
  for (const raceGender of await dirs(path.join(SRC, lang))) {
    const dir = path.join(SRC, lang, raceGender);
    // A slot with no flavor, like narrator-male, keeps its clips directly in its directory.
    // Checked against the roster here, so a directory of loose files that is no slot
    // (someone's staging) is passed over rather than failing the run.
    const loose = await clipsIn(dir);
    if (loose.length && wanted(raceGender) && (await isVoiceSlot(raceGender))) {
      jobs.push({ lang, voice: raceGender, clips: loose });
    }
    for (const flavor of await dirs(dir)) {
      const voice = `${raceGender}-${flavor}`;
      if (!wanted(voice)) continue;
      const clips = await clipsIn(path.join(dir, flavor));
      if (clips.length) jobs.push({ lang, voice, clips });
    }
  }
}

const failed: string[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const name = `${job.lang} ${job.voice}`;
      try {
        console.log(`${name}: ${await seed(job)}`);
      } catch (error) {
        failed.push(name);
        console.error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }),
);

const { VOICE_SAMPLES_DIR } = await import("@/lib/paths");
const manifest = path.join(VOICE_SAMPLES_DIR, ".seeded");
await fs.writeFile(
  manifest,
  seeded.map((dir) => path.relative(VOICE_SAMPLES_DIR, dir)).sort().join("\n") + "\n",
);
await fs.rm(tmp, { recursive: true, force: true });
await closeDb();

console.log(`\n${seeded.length} voices' clips replaced; list in ${manifest}`);
if (failed.length) {
  console.error(`${failed.length} failed: ${failed.join(", ")}`);
  process.exit(1);
}
