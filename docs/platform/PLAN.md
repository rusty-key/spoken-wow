# Audio off the droplet

Goal: the droplet keeps Postgres, the site and the queue, and stores no audio. Every take,
recording, clone clip and reference lives in Cloudflare R2, named by its sha256. Generation can
run on the author's own machine. This is what has to be true before authors other than us can
make packs here; opening the site to them (projects, quotas, publishing) is a later plan.

The droplet's real limit was disk. TTS runs at ElevenLabs and fish.audio on each author's own
key, and the droplet does a little ffmpeg. The 30 GB volume already held about 10 GB, and every
author's language adds 0.3 to 1.5 GB of live takes plus their history. R2 costs $0.015 per
GB-month ($0.01 for Infrequent Access) with no egress fees.

All four phases are built. What is left is setting up the bucket and running the backfill on
production (`one-off/2026-10-archive-to-r2/README.md`).

## Decisions

1. The archive bucket is public. Objects are named by their hash, so an address is only known
   to whoever was given it. Only shared takes are served from it directly; recordings, voice
   clips and references go through the site, because a bucket URL outlives a revoked grant.
2. Where an author's lines are generated is their choice, per provider, on `/profile`. No row
   means "on this site", which is how everybody generated before.
3. GitHub Actions holds the pack signing key (`.github/workflows/release-packs.yaml`).
4. Quests takes are encoded to the pack's Ogg when they are committed.

## Phase 1: the archive is a bucket

`SPOKEN_ARCHIVE_STORE` (`apps/web/src/lib/blobs/store.ts`) says where audio goes:

| Mode | Writes | Reads |
| --- | --- | --- |
| `disk` (default) | the volume | the volume |
| `dual` | the volume and the bucket | the volume |
| `r2` | the bucket | the bucket: take routes redirect to `SPOKEN_ARCHIVE_URL`, the rest stream |

Keys are `takes/`, `recordings/`, `encodings/`, `samples/` and `references/`, each followed by
the object's sha256. A row records the full hash once its object is in the bucket (migration
0085): `take.sha256`, `recording.sha256`, `fish_reference.sha256`, and the new `voice_sample`
table, which replaces listing a directory. A row without one is the backfill's, which is also
where a failed PUT in `dual` leaves it. Quests takes now record a duration too.

Moving what is there: `one-off/2026-10-archive-to-r2/backfill.mjs`, run on the droplet in
`dual` mode, then `--verify`, then `r2`. Pack builds fetch clips from the public bucket when
`SPOKEN_ARCHIVE_URL` is set (`scripts/audio/fetch-blobs.mjs`, called by `pull-live.sh`) and
rsync only rows without a hash.

Not moved, deliberately: pronunciation previews stay on the droplet's disk. They are a cache
rebuilt by spending credits, and the lexicon page checks every entry's preview on each load,
which in a bucket would be two requests per entry. The frozen pre-take stores and the seed clips
stay too.

## Phase 2: packs built anywhere

Two buckets, not one: `spoken-packs` keeps the channel and its garbage collector, which deletes
any blob no manifest names and would delete the archive in a shared bucket.

- Each quests take is encoded at commit (`apps/web/src/lib/takes/encode.ts`) with the build's
  own recipe (ffmpeg decodes, `oggenc -q 0` encodes), put at `encodings/<sha>`, and recorded in
  `take_encoding` (migration 0086) with its duration. Best effort: a droplet without `oggenc`
  commits the take and the build encodes it.
- `scripts/audio/fetch-encodings.mjs` lays those into `package-audio.sh`'s transcode cache, keyed
  by each master's md5, so a release downloads its encodes instead of making them.
- `.github/workflows/release-packs.yaml` runs a whole release on a runner: production's rows over
  ssh, the clips and encodings from the bucket, the existing build, then CurseForge, GitHub and
  the manager channel. A dry run builds and uploads nothing.

Different from the first plan: packs are still built by the existing scripts rather than written
as manifests that point at take blobs. The scripts already handle the faction split, the ignore
list, locale tables and zips, and what made them depend on one machine was where the audio was,
not how they worked.

## Phase 3: generation on the author's machine

The server records what each line would send, the author's machine sends it with a key the
server never sees, and the server replays the answers through the same code
(`apps/web/src/lib/generation/relay.ts`):

1. **Claim** (`/api/worker/claim`): the generator runs with a fetch that records each provider
   request and answers with silence, and a commit that stops the run. The requests, without any
   key, go to the worker; their fingerprints are stored on the job.
2. **Send**: the worker adds the key and sends each request, only as a POST to the speech
   endpoints of `api.elevenlabs.io` or `api.fish.audio`. It refuses anything else, and a
   refusal fails the line rather than giving it back.
3. **Answer** (`/api/worker/answer`): the generator runs again with a fetch that answers from the
   worker's responses, and the real commit. Trimming, stitching, measuring, pricing and the
   commit are the same code as on the site. A request with no recorded answer means the line
   changed since the claim; the job goes back to the queue.
4. **Hold** and **release**: a worker extends its lease while it sends, and gives a line back
   unanswered when it could not reach the provider at all.

Different from the first plan: the audio comes back in the answer, not through signed uploads
to a staging area. A line is well under a megabyte, and the server must read it anyway to trim,
measure and encode it.

Queue changes: every settlement is made against the claim's attempt, so a claim whose lease ran
out settles nothing. This also fixes a job being finished twice by the leader. The leader skips
lanes whose owner generates locally (`generation_mode`, migration 0087).

Workers authenticate with a token (`worker_token`), got by pairing: the Manager shows a code, the
author approves it on `/profile`, and the Manager collects the token once. Only its hash is
stored. Unpairing in the Manager revokes it on the site.

The Manager (`manager/src/main/generating.ts`) keeps the token and keys encrypted by the system
keychain and runs the loop while Settings > Generating is on. A single-line regenerate in local
mode queues the line for the Manager and says so.

## Phase 4: a browser tab as the worker

`/generate` runs the same protocol (`apps/web/src/lib/worker/protocol.ts`, which the Manager
bundles too) signed in instead of paired, with keys kept in the browser. The worker routes accept
a session only from the site's own origin with a JSON body.

Not verified: whether ElevenLabs and fish.audio answer a web page (CORS). Neither documents it,
and their APIs were not reachable from where this was built. If they refuse, each line is given
back to the queue and the page tells the author to use the Manager.

## Checks run

- Web: typecheck and the full suite against a migrated Postgres, and `next build`.
- Manager: typecheck, the full suite and the build.
- Scripts: `node --test` for `scripts/lib`, `scripts/audio` and `scripts/manager`; `make lint`.
- By hand, against a local build: pairing end to end, `/api/worker/me`, a cross-origin claim
  refused, and the profile and `/generate` pages.

Not run: anything against R2 or a real provider, the backfill on production data, and the
release workflow.

## Not in this plan

Projects per author, a review step before a take goes live, quotas and abuse limits, publishing
community packs, and terms of service.

The server cannot verify that a worker's answer came from the provider, so a stolen worker
token or a dishonest author can post any audio as a generated take. The review step above is
the mitigation.
