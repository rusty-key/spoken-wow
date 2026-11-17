# A team's own storage

Design, 2026-11-17. Not yet planned or built. Builds on [`PLAN.md`](PLAN.md) (the archive is a
bucket) and [`TEAMS.md`](TEAMS.md), and assumes production runs `SPOKEN_ARCHIVE_STORE=r2`.

## Why

Self-serve teams ([#1086](https://github.com/rusty-key/spoken-wow/pull/1086) to
[#1089](https://github.com/rusty-key/spoken-wow/pull/1089)) let anyone voice a language here, and
every take they roll lands in our archive bucket for good. Most of the storage cost is the archive,
since it keeps every take ever made; the Manager channel keeps only live revisions. A team that
brings its own bucket stores its own takes.

## Decisions

Made by the user on 2026-11-17.

1. **A team's bucket is its own.** The rule that nothing deletes from `takes/` or `recordings/`
   binds our buckets only. For a team's bucket it is a recommendation (versioning or object lock,
   no deletes) that we do not enforce. The site itself never deletes from any bucket.
2. **A team's bucket is the record of the takes stored in it.** We keep no copy. A file the team
   removes is gone, and the line reads as unvoiced.
3. **Moving a team's takes copies them and never purges ours.** History already in our bucket stays
   there, at our cost; the saving comes from the takes the team rolls afterwards.
4. **The archive first, the channel later.** A team's packs keep publishing to our channel, signed
   with our key. Self-hosted channels stay later work, as in TEAMS.md.

## Design

### One S3-compatible store

`r2Blobs` (`apps/web/src/lib/blobs/store.ts`) becomes `s3Blobs({ endpoint, region, bucket,
pathStyle, publicUrl? })`, signed with SigV4 through `aws4fetch` as today. Presets cover R2, AWS S3,
Backblaze B2, Wasabi, MinIO and GCS through its HMAC keys. R2's 409 `ObjectLockedByBucketPolicy`
answer stays a quirk of its preset.

### Data model

Migration 0111:

- `storage_backend`: `teamId`, provider, endpoint, region, bucket, path style, `publicUrl`
  (nullable), the access key id, the secret sealed, whether the provider honours `If-None-Match`,
  `writing` (at most one per team), `health`, `checkedAt`, `lastError`, `retiredAt`. Row-level
  security limits it to its team; site-wide reads act as every team.
- `archive_object`: `(prefix, sha256, backendId)`, with `pending` and `missingAt`. A row says a
  team's bucket holds the object. No row means our bucket, so every existing object keeps meaning
  what it means.

Rows name the bucket that holds an object, rather than reads following the team's current bucket:
a switch would otherwise orphan every older object at once, and a move could not be done one
object at a time, resumed or undone. A copy adds a row and never moves one, and the hash is the
object's name, so a take, an encoding, a sample and a reference are found the same way.

### Resolving a store

`locate(key)` (`lib/blobs/where.ts`) picks a copy not known to be missing, one that has landed
before one waiting in quarantine, the newest first, and our bucket when there is no row or every
team copy is missing. A team bucket's store is built once per process and dropped on a
`spoken_storage_backend` notification. Every reader goes through it: `serveBlob`, `blobBytes` and
the take redirect.

### Secrets

AES-256-GCM under `SPOKEN_STORAGE_KEY`, held in `app.env` and given to the release job. The secret
is write-only in the UI and never appears in an API answer. The documented minimum is Get, Put and
Head on the bucket; nothing asks for Delete.

### Testing a backend

A backend cannot be switched on until a probe under `probe/<random>` passes:

- a PUT with `If-None-Match: *`, and a second one that answers 412;
- a ranged GET that answers 206 with a matching `Content-Range`;
- a HEAD that carries `Content-Length`;
- a 404 for a key that does not exist;
- with a `publicUrl`, a fetch of the probe from it.

A provider without conditional PUT falls back to HEAD then PUT, which is safe because a key is its
bytes' hash.

### Serving

Public takes redirect to the backend's `publicUrl`, or without one to a short-lived presigned GET,
so a private bucket works. Recordings, clone clips and references keep streaming through the site;
on AWS S3 that is the team's egress, and the setup page says so.

### Never paying for a take that cannot be kept

A batch, from the site or the generate API, checks its team's backend is healthy before it calls
ElevenLabs or fish.audio. A PUT that still fails after the provider was paid parks the bytes under
`quarantine/` in our bucket, and a job retries them into the team's. `quarantine/` is not `takes/`
or `recordings/`, so the job deletes each copy once it has landed.

### Moving takes

A job copies a team's objects to the target bucket, checks each hash, and adds the
`archive_object` row (or, into our bucket, drops the team's). It can stop and resume, and never deletes the source (decision 3). The
same job moves a team back to our bucket.

### Missing files

Periodic HEADs over a sample of rows, and any 404 on a read, mark the row missing. The team's
dashboard lists those lines, they read as unvoiced, and a release leaves them out rather than
failing. Nothing blocks the team beyond that (decision 2).

### Readers of the archive

- `scripts/manager/release-job.mjs` reads each clip through its row's backend before copying it to
  the channel.
- `make <section>-pull-live` and pack builds cannot rely on one `SPOKEN_ARCHIVE_URL`; the site
  hands them a URL per clip, presigned for a private bucket, through an API token.

## Later: a team's own channel

Signed manifests would gain a base URL for their files (each still checked by its hash), the
Manager in `manager/` would follow it behind a minimum-version gate, `publish.mjs` would write to the
team's store, and the channel's garbage collector would run per store, never against a bucket that
also holds an archive. Until then a fully independent team can list a community pack (migration
0106): a zip hosted anywhere, named by URL and hash.

## Plan

1. `s3Blobs`, the two tables and `locate`, every object in our bucket. Nothing visible changes.
2. `storage_backend`, the encryption, the probe and the team admin page.
3. Writing to a team's backend, serving with presigned URLs, and the check before spending.
4. The move job.
5. The release job and pull-live through the resolver, and the missing-file checks.
6. AGENTS.md: *Data only comes home from production* names our buckets and points here for a
   team's; TEAMS.md moves the archive out of *Teams' own infrastructure*;
   `deploy/web/README.md` gains `SPOKEN_STORAGE_KEY`.
