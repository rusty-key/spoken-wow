/**
 * pm2 config for Spoken. Lives in /srv/spoken/shared/ on the droplet, outside every
 * release, so it survives deploys and rollbacks.
 *
 * cwd points at the `current` symlink rather than a release directory: activate.sh swaps
 * the symlink and reloads, and pm2 re-resolves it because we pass --update-env.
 *
 * The app runs under whatever Node pm2 itself runs under, so keep node-version in
 * .github/workflows/deploy-web.yaml in sync with the droplet's.
 *
 * Copy to the droplet with `make web-deploy-scripts`.
 */
const fs = require("node:fs");

const SHARED = "/srv/spoken/shared";
const CURRENT = "/srv/spoken/current";

/**
 * Read shared/app.env, which holds the database URL and the secrets.
 *
 * This file is committed, so those values cannot live in it. app.env sits in shared/ next
 * to the audio store: mode 600, owned by `deploy`, and never touched by a deploy or a
 * rollback. See deploy/web/README.md for how to create it.
 */
function readSecrets() {
  const path = `${SHARED}/app.env`;
  if (!fs.existsSync(path)) {
    // pm2 evaluates this file on every reload, so a hard failure here would take the app
    // down rather than just refusing to start with a bad config.
    console.error(`ecosystem: ${path} is missing - the app will not reach its database`);
    return {};
  }

  return Object.fromEntries(
    fs
      .readFileSync(path, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const at = line.indexOf("=");
        // Values are taken verbatim apart from optional wrapping quotes: a password is
        // entitled to contain '#', '=' or a space.
        return [line.slice(0, at), line.slice(at + 1).replace(/^["']|["']$/g, "")];
      }),
  );
}

const secrets = readSecrets();

module.exports = {
  apps: [
    {
      name: "spoken",
      // Next.js standalone output. Two levels down, not at the top: next.config.ts traces
      // from the monorepo root, because pnpm hoists node_modules there and a narrower
      // tracing root leaves `next` out of the bundle entirely.
      script: "apps/web/server.js",
      cwd: CURRENT,

      // Cluster mode is what makes `pm2 reload` zero-downtime: workers are replaced one at
      // a time. The zones site could not do this -- it pinned one worker because its
      // batches lived in that process's memory -- and moving those onto the shared queue
      // is what freed it.
      instances: 2,
      exec_mode: "cluster",

      // loadCorpus() memoises 15 MB of parsed JSON per worker for the process lifetime,
      // measured at ~200 MB RSS, and the places catalogue adds ~1,353 derived entries beside
      // it. A safety net for a leak, not an expected limit.
      max_memory_restart: "600M",

      // The queue leader finishes its in-flight ElevenLabs calls before releasing the
      // advisory lock (see src/lib/generation/boot.ts), and NEXT_MANUAL_SIG_HANDLE below is
      // what lets it. pm2's default of 1600 ms is shorter than a single generation, so
      // without this every reload SIGKILLs mid-take and the handover degrades to waiting
      // out a five-minute lease.
      kill_timeout: 30_000,

      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOSTNAME: "127.0.0.1", // nginx is the only thing that should reach the app

        // Next installs its own SIGINT/SIGTERM handler that ends in process.exit(0). With
        // ours in boot.ts installed alongside it nothing coordinated the two, so whichever
        // finished first exited the process: a reload during a batch could exit while
        // generations were still in flight, which ElevenLabs bills for while nothing
        // commits and the next leader regenerates the same files and pays again. This tells
        // Next to stand aside so boot.ts alone owns shutdown. The cost is that Next no
        // longer closes the HTTP server first, so requests in flight at the moment of exit
        // are cut rather than drained -- the cheaper of the two losses, since nginx fronts
        // the app and a cut request can be retried, while a half-billed generation cannot
        // be un-bought.
        NEXT_MANUAL_SIG_HANDLE: "1",

        //--------------------------------------------------------------------------
        // Quests
        //--------------------------------------------------------------------------

        // The corpus ships inside each release and moves with a rollback.
        //
        // The hiccup scan's findings sit beside this file and paths.ts derives their
        // location from it, deliberately: an env var of their own would live here, and this
        // file only reaches the process through `make web-deploy-scripts` -- so a deploy
        // that shipped the findings would still not be able to find them.
        SPOKEN_QUESTS_CORPUS: `${CURRENT}/pipelines/quests/corpus/corpus.json.gz`,

        // Clips uploaded to build voice clones, shared for the same reason the audio is: a
        // cloned ElevenLabs voice cannot be exported, so these are the only way to remake
        // one. Without this, paths.ts resolves them relative to the release directory and
        // they land somewhere no Makefile target backs up.
        SPOKEN_QUESTS_VOICE_SAMPLES: `${SHARED}/voices`,

        // The window of a clip each slot is spoken from on fish.audio. Cut from the clips
        // above and cheap to cut again, but a take records the clip's hash, so losing the
        // file means a slot's next take no longer matches its history.
        SPOKEN_QUESTS_VOICE_REFERENCES: `${SHARED}/voice-references`,

        // The seed clips /voices seeds a clone's clips from, English's at the top and each
        // other language's under its code (lib/voices/seedClips.ts). Shared rather than in a
        // release because nothing builds them into one: they are pushed here from a workstation
        // with `make web-push-seed-clips`.
        SPOKEN_QUESTS_SEED_CLIPS: `${SHARED}/seed-clips`,

        // Every take of every quest line, the live one included: the only place quests
        // audio lives. Shared for the strongest version of the same reason: some of it
        // predates this project's ability to reproduce it, and a release directory is
        // deleted five deploys later.
        SPOKEN_QUESTS_AUDIO_HISTORY: `${SHARED}/audio-history/quests`,

        // Rendered pronunciation previews. Shared, and this one is load-bearing in a way
        // the others are not: unset, paths.ts resolves it to /srv/spoken/releases/audio-previews
        // -- INSIDE the directory prune.sh iterates, where it is treated as a release,
        // occupies one of the five keep slots, and is eventually rm -rf'd. Every file in it
        // is a preview someone paid credits for.
        SPOKEN_QUESTS_PREVIEWS: `${SHARED}/audio-previews`,

        // generation.json and pronunciation.json, which ship inside the release alongside
        // the corpus so a rollback restores the settings the rolled-back code expects.
        // Without this the app falls back to built-in defaults and, worse, applies no
        // pronunciation rules at all -- "Hm" is read aloud as the letters H and M.
        SPOKEN_QUESTS_VOICE_CONFIG: `${CURRENT}/pipelines/quests/voice`,

        //--------------------------------------------------------------------------
        // Places
        //--------------------------------------------------------------------------

        // Where the places pipeline resolves its own paths from. Its modules derive
        // everything from their own location, which is correct for a script and impossible
        // once webpack has compiled them -- import.meta.url is replaced at build time -- so
        // the deployed app is told instead. Points at the release: what it reads from here
        // is pronunciation.json and the area-name seed, both of which ship with the code
        // that expects them.
        SPOKEN_PLACES_ROOT: CURRENT,

        // Every places take, beside the quests ones and separate from them: the two sections
        // number versions independently and share no filenames.
        SPOKEN_PLACES_AUDIO_HISTORY: `${SHARED}/audio-history/places`,

        // The exported manifest. In shared/ rather than the release because the app writes
        // it -- the queue rebuilds it whenever a batch drains -- and a release directory is
        // deleted five deploys later.
        SPOKEN_PLACES_MANIFEST: `${SHARED}/manifest.json`,

        //--------------------------------------------------------------------------
        // Readables
        //--------------------------------------------------------------------------

        // Every readables take, beside the other two sections' and separate from them. Has to be
        // set: lib/readables/audio.ts falls back to a path inside the release, and a release
        // directory is deleted five deploys later.
        SPOKEN_READABLES_AUDIO_HISTORY: `${SHARED}/audio-history/readables`,

        //--------------------------------------------------------------------------
        // Bosses
        //--------------------------------------------------------------------------

        // Every boss story take, beside the other sections' and separate from them. Has to be
        // set: lib/takes/adapters.ts falls back to a path inside the release, and a release
        // directory is deleted five deploys later.
        SPOKEN_BOSSES_AUDIO_HISTORY: `${SHARED}/audio-history/bosses`,

        // DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, SPOKEN_SECRET_KEY and
        // ELEVENLABS_DICTIONARY_ID.
        ...secrets,

        // The app logs in as spoken_app, which row-level security binds, not as the owner, which
        // reads every team. Without APP_DATABASE_URL the app keeps the owner's and filters nothing.
        ...(secrets.APP_DATABASE_URL ? { DATABASE_URL: secrets.APP_DATABASE_URL } : {}),
      },
    },
  ],
};
