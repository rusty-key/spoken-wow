# Audio off the droplet: plan

Goal: the droplet keeps Postgres, the site and the queue, and stores no audio. Every take,
recording, sample and reference lives in Cloudflare R2, named by its sha256. Generation can
run on the author's own machine. This is what has to be true before authors other than us
can make packs here; opening the site to them (projects, quotas, publishing) is a later plan.

The droplet's real limit is disk. TTS runs at ElevenLabs and fish.audio on each author's own
key, and the droplet does a little ffmpeg (`stitch.ts`, `leadin.ts`). The 30 GB volume
already holds about 10 GB, and every author's language adds 0.3 to 1.5 GB of live takes
plus their history. R2 costs $0.015 per GB-month, $0.01 for Infrequent Access, with no
egress fees, so 300 GB is about $5 a month.

Four phases. Each ships on its own and leaves the site working. Phase 1 alone fixes the disk.

## Phase 1: a blob store, and every write goes to it

### Two buckets

| Bucket | Read by | Holds |
| --- | --- | --- |
| `spoken-archive` (new, private) | the site, scripts with R2 keys | `takes/<sha256>`, `recordings/<sha256>`, `samples/<sha256>`, `references/<sha256>`, `previews/<key>`, `staging/…` |
| `spoken-packs` (exists, public at spoken-packs.rusty.one) | players' Managers | `blobs/<sha256>`, `packs/…`, `index.json` |

Separate buckets because the two have different deletion rules. `scripts/manager/gc.mjs`
deletes every blob in `spoken-packs` that no kept manifest names. In a shared bucket that
would delete the archive. Publishing copies a live take into `spoken-packs` with R2's
server-side copy, so only shipped takes exist twice.

`spoken-archive` gets a bucket lock rule on `takes/` and `recordings/`, so no key can delete
them. Deletion of those two prefixes is not a feature. Check that R2 bucket locks cover a
prefix before relying on this. A lifecycle rule deletes `staging/` after a day.

### The interface

`apps/web/src/lib/blobs/` holds one `BlobStore`:

- `put(bytes, {prefix, contentType}) -> {sha256, bytes}`: idempotent, the key is the hash.
- `head(key)`, `get(key, range?)`, `copy(key, toBucket)`, `delete(key)` (samples, references
  and previews only).
- `signedGet(key, ttl)` and `signedPut(key, ttl)`.

Two implementations: `fsStore(root)` for development and the tests, and `r2Store(env)`, grown
from `scripts/manager/store.mjs` and moved to `pipelines/lib` so the site and the scripts
share it. The filesystem tests keep running against `fsStore`.

### Schema (additive)

- `take.sha256 text` and `recording.sha256 text`, nullable until the backfill fills them.
  `archiveFile` stays for rollback and is no longer written once the flip is done.
- `voice_sample (id, voice, lang, sha256, bytes, originalName, createdAt, createdBy, deletedAt)`.
  Listing samples stops using `readdir` and `fs.stat`.
- `fish_reference.sha256`: the clip's own hash. `clipHash` stays, since it also covers the
  transcript.

### Writes

- `commitTake` (`lib/takes/commit.ts:100`) measures the duration from the buffer, then
  `put`s, then inserts the row. That order already leaves an orphan blob and never a dangling
  row on a crash. Quests takes get `durationSec` for the first time, which phase 2 needs.
- `commitRecording`, `storeSample`, `mergeSamples`, `saveReference` and `renderPreview`
  switch to `put`. ffmpeg keeps working on temp files: download to tmp, run, `put` the
  result. That also fixes the non-atomic `EXDEV` copy in `merge.ts:284`.

### Reads

The audio routes answer `302` to a signed GET with a short TTL, five minutes for example.
R2 then serves the range requests, including Safari's `bytes=0-1` probe, and the droplet
stops streaming audio. That covers `api/{quests,zones,books}/audio`, `api/takes/audio`,
`api/recordings/audio`, and the reference and sample routes. Permission checks stay where
they are, before the redirect. The live-take routes keep `max-age=300` on the redirect
itself, and the signed URL is cacheable as immutable.

Check before building: that `<audio>` and the waveform components follow a cross-origin
redirect. This needs CORS on the bucket for `spoken.rusty.one`.

### Moving what is there

1. Dual write: the commit writes the disk and R2, and still reads from disk.
2. `one-off/<date>-archive-to-r2/`, run on the droplet: hash every archive file, `put` it,
   fill `sha256`. Recordings first, since they are the least replaceable. Resumable, and it
   records what it did.
3. Check: every row with an `archiveFile` has a `sha256` whose blob exists and has the
   same size.
4. Flip reads to R2. Stop writing to disk.
5. Snapshot the volume and keep it for a month, then detach it. `store.sh`, the volume
   marker check in `activate.sh`, and the symlinks go in the same PR.

The frozen `audio/`, `sounds/` and `books/` stores are not moved. They exist only for
rollback to releases older than the take table, and those releases can't run against the
new reads anyway.

### Scripts in the meantime

`scripts/audio/sounds.mjs`, `acted.mjs` and `pull-live.sh` fetch live takes from R2 by
sha256 instead of rsyncing from the droplet. Pack builds work as before, from any machine
with read keys. Phase 2 removes most of this.

## Phase 2: packs are manifests of blobs

Zones and books packs ship the take's bytes unchanged, so their manifest entries can name
the take's sha256 directly. Quests packs ship mono Vorbis (`ogg-q0-44k`,
`scripts/quests/package-audio.sh:74`), so they need a derived file per take.

- `take_encoding (takeSha, encode, sha256, bytes, durationSec)`: one row per take and
  pack format. Filled when a take is committed, so publishing never transcodes. The
  `audio-transcoded/` cache on the operator's machine goes away.
- Lua tables come from the database. Zones and books already do this. Quests'
  `sound_length_table.lua` reads `take_encoding.durationSec` instead of running mutagen
  over the files (`tts_cli/length_table.py`).
- `scripts/manager/publish.mjs` builds a pack from rows, not from `dist/<folder>`:
  - generate the small files (`.toc`, `Module.lua`, `generated/*.lua`, `Data/Sounds.lua`),
  - `copy` each audio blob from the archive into `spoken-packs/blobs/` unless it is
    already there,
  - sign and write the manifest and the index as today.
- Acted overlays get `take_encoding` rows too, so the Manager channel can carry them.
- CurseForge and GitHub zips are built in a GitHub Action from the same manifest: fetch
  the blobs, zip, upload. The packs stop depending on the one machine that pulled the audio.

Decision needed: does the Actions runner hold `SPOKEN_PACKS_SIGNING_KEY`? If not, signing
stays a manual step and only the zips move to CI.

## Phase 3: generation on the author's machine

What this moves off the droplet is less CPU than it looks. TTS already runs at the
providers. What it moves:

- **Database connections.** Each job holds two pool connections and an advisory lock for
  the whole provider call. `clampToPool` caps the queue at `(POOL_MAX - 6) / 2`.
- **Key custody.** Authors who choose it keep their key on their own machine only.
- **Throughput.** One leader process drains every author's queue today.

The droplet still prepares jobs and commits takes. Both are short.

### Who generates

Each author picks a mode per provider on `/profile`:

- **On the site**: as today. The key is sealed on the server and the leader runs the jobs.
- **On my computer**: the key stays in the Manager (Electron `safeStorage`). The server
  never sees it. The leader skips that author's lanes, and the author's Manager claims
  them.

Interactive one-line regeneration in this mode becomes a job at the front of the author's
queue. The page waits for it.

### The split

The server resolves everything that needs the database. The worker only speaks.

- **Claim** (`POST /api/worker/claim {providers, capacity}`): the server runs today's job
  up to the provider call: corpus, ignores, overrides, `raceTags`, pronunciation rules,
  `SHAPE`, segments, seed. It returns a payload:
  - `jobId`, `claimToken`, `leaseUntil`, `source`, `lang`, `file`, `provider`
  - `turns[]` of `{text, voiceSlot, cloneName}`, `dialogue`, `narratorVoice`
  - `seed`, `languageCode`, the ElevenLabs dictionary locator, or fish.audio's compiled
    lexicon rules and their version
  - fish.audio references: transcript, `clipHash`, and a signed GET for each clip
  - one signed PUT per output part, at `staging/<jobId>/<n>`

  `spokenHash`, `characters` and the lexicon version are stored on the job row at claim.
  The worker never sends them.
- **Generate**, in the Manager: resolve ElevenLabs voice ids from the author's own account
  by clone name, call the provider, PUT each raw part. No ffmpeg in the Manager.
- **Heartbeat** (`POST /api/worker/heartbeat`) renews the lease while a call runs.
- **Complete** (`POST /api/worker/complete {jobId, claimToken, parts, voiceIds, made,
  credits | costUsd, startedAt}`): the server checks the token, takes `withTakeLock`,
  fetches the parts, stitches and trims them (`stitchMp3`, `trimLeadIn`), measures the
  duration, `put`s the take, makes the quests encoding, and commits. This post-processing
  is seconds of ffmpeg per line, and it keeps the takes from every worker identical.
- **Fail** (`POST /api/worker/fail {jobId, claimToken, kind, message}`) feeds today's retry
  rules (`worker.ts:338-357`).

### Queue changes

- `regeneration_job.claimToken` and `claimedBy`. `finishJob`, `failJob` and `retryJob`
  require the token. This also fixes a bug that exists today: a job whose lease expired
  and was claimed again can be finished twice.
- A lease renewal function.
- `take.generatedAt`, set from the claim time. `dirty.ts` compares lexicon changes to it
  instead of `createdAt`. Otherwise a take generated before a lexicon change and committed
  after it reads as clean. The commit also refuses a `dictionaryVersion` that differs from
  the one issued at claim.
- Lanes gain a mode. The leader runs only the "on the site" lanes. The concurrency limit
  for a local lane is the Manager's: it can read the author's tier with its own key.

### Auth for the Manager

The Manager has no login today. Use the OAuth device flow: the Manager shows a code, the
author confirms it on the site, and the Manager gets a token scoped to the worker
endpoints. Check that the installed Better Auth (`^1.6.25`) ships the device authorization
and bearer plugins before building.

### Upload safety

A signed PUT cannot cap the size. A bad worker can write a large file to `staging/`, and the
lifecycle rule deletes it a day later. The commit refuses parts over a size limit, and
writes into `takes/` only bytes it has hashed itself. Nothing a worker uploads is served to
anyone before that.

## Phase 4: the browser as a worker (optional)

The same endpoints, from a tab on `/regenerate`. Two blockers to check first:

- Whether ElevenLabs and fish.audio accept cross-origin calls from a browser. ElevenLabs'
  docs advise against keys in client code. That advice is about shipping your key to
  other people, not about an author using their own, but it hints that CORS may be closed.
- A tab must stay open for the whole batch.

Skip this phase if the Manager covers the authors who want local generation.

## Rules that change

`AGENTS.md`, in the PR that flips reads:

- "The take archive (`audio-history/`) is the only audio and only the site writes it"
  becomes "the `spoken-archive` bucket is the only audio, and only the site writes
  `takes/` and `recordings/`".
- `.env.example` lists `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, the two
  bucket names and `SPOKEN_PACKS_SIGNING_KEY`. It lists none of them today.
- The `<section>-pull-history`, `-pull-live` and `-pull-recorded` targets read from R2.

## Decisions for the owner

1. Is the archive served through signed redirects (as above), or made public? Public is
   simpler and caches better, but makes unreleased and replaced takes downloadable.
2. Which mode is the default for a new author: on the site, or on my computer?
3. Does GitHub Actions hold the pack signing key (phase 2)?
4. Quests encoding at commit (as above), or at publish? At commit costs a transcode for
   takes that never ship. At publish brings back a build step.

## Not in this plan

Projects per author, a review step before a take goes live, quotas and abuse limits,
publishing community packs, and terms of service. Each needs phase 1, and the projects
work needs phase 3's lanes.
