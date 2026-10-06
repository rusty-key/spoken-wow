# CLAUDE.md: quests

The root `AGENTS.md` applies. This file covers only the quests section. `docs/quests/README.md`
is the detailed reference: check it before inferring behaviour from code, and update it when
behaviour changes.

## What it is

- `pipelines/quests/` (`tts_cli/`, `cli-main.py`): the Python pipeline. It builds the corpus
  and the addon's data modules and packs. It makes no audio; the site does.
- `apps/web/` quests section: browsing the corpus, regeneration, triage, reports.
- `addons/Spoken_Quests/`: a module of Spoken that ships inside `Spoken-<v>.zip`.
  Its commands are `/spokenquests`, `/spq` and `/spqread`.
- Sound packs `SpokenQuestsAudio{Alliance,Horde,Shared,Gossip}`, plus the `All` meta addon,
  which depends on those four and `spoken-player`. Language packs are
  `SpokenQuestsAudio_<lang>` (`LOCALE=xx`). Pack metadata, CurseForge and Wago ids live in
  `publishers/quests/audio-*.md` and are read by `scripts/lib/packs.mjs`.

## Commands

From `pipelines/quests/` with `.venv` active:

```sh
pip install -r requirements-dev.txt      # + requirements-extract.txt only for MySQL work
pytest                                   # or tests/test_build.py::test_name
python cli-main.py --help
```

From `apps/web/`, or `pnpm --filter @spoken/web <script>` at the root: `pnpm dev`,
`pnpm typecheck`, `pnpm test [file]`.

Web tests run against a real Postgres. `DATABASE_URL` comes from the environment, then the
root `.env`, then `apps/web/.env.local`. Migrate with `deploy/web/bin/migrate.sh "$PWD/apps/web"`
and seed with `python cli-main.py import-corpus`. `fileParallelism` is off because queue
claiming is global.

## Packs and releases

- `make quests-full-release VERSION=…` is the end-to-end pack release: sync, pull live takes,
  build, upload. `package-audio` refuses to run until local data matches the droplet's
  (`check-synced`), and `make quests-sync` is destructive.
- `pipelines/quests/tts_cli/factions.py` owns the four-way split, using the committed
  `corpus/factions.json`. Every pack carries the full lookup tables.
- A pack ships one audio format, `ogg-q0-44k`; `store.py:audio_extension` refuses a store
  holding two.
- The meta addon must never carry a `DataModule-Version` key. If it does, the player counts it
  as an installed pack and stops offering the real ones.
- `scripts/quests/release.sh` uploads what is already in `dist/` and never builds. Its targets
  are `spoken` (the bundle, to `spoken-player`), `player` (the retired SpokenQuests tombstone),
  the four packs and `audio-all`. A failing target does not stop the rest.
- Legacy 1.12/2.4.3/3.3.5 zips are built only from a `quests/vX` tag and published only on
  GitHub. Each carries Spoken and that client's vendored Ace3.
- Packs list every client in `## Interface:` (`tts_cli/build.py`). Forever rejects an Interface
  it does not list, so a new client's number must be added there.

## Architecture

**The corpus is Postgres `quest_line`.** `corpus/corpus.json.gz` is a committed export of it
(`make quests-export-corpus`). The Python CLI and the pack build read that file and never a
database. MySQL (vmangos) is touched only by the rare extract and import targets.

**Filenames come from `tts_cli/naming.py` alone.** `apps/web/src/lib/audio.ts` mirrors its
subfolder rule. The addon finds a sound through a generated lookup table, so a filename that
is off by one character plays silence.

**Voices are `race-gender-flavor`.** The roster is hand-kept in `apps/web/src/lib/voices/voices.ts`,
not derived from the corpus. It is also the whitelist that keeps a voice name safe as a path
segment, and `voices.test.ts` fails on a corpus voice it lacks.

**A job is a file, not a line.** Over a thousand files are shared by several NPCs, so
regenerating one changes every line that points at it. The queue is keyed on the file.

**The queue** lives in `apps/web/src/lib/generation/`. `leader.ts` elects one pm2 worker with
a Postgres advisory lock, and `queue.ts` is the only module that knows the column names. There
are two providers, ElevenLabs and fish.audio (`providers.ts`). `db.ts` explains why
`POOL_MAX` is 30.

**Reports never queue jobs.** `POST /api/reports` is the only unauthenticated write in the
app. A job spends credits, so a collaborator reads the report and queues the file by hand.

**Ignored lines** (`line_ignore`) are keyed on `lineId`, not on the file, because a dead line
can share a file with a live one. `make quests-export-ignores` writes `corpus/ignored.json`
for the pack build.

**Stage directions:** a capitalised `<…>` span is read by the narrator. A lowercase one is a
sound the NPC makes and becomes an ElevenLabs `[tag]`. `staleFiles` must apply the same
transforms in the same order, or every tagged take reads as outdated.

**Generation settings have two layers.** `voice/generation.json` and `voice/pronunciation.json`
are file defaults. The rows edited at `/voices` override them for the site. The lexicon exists
only in Postgres.
