# A team's own storage

Design 2026-11-17, built on the same day. Builds on [`PLAN.md`](PLAN.md) (the archive is a bucket)
and [`TEAMS.md`](TEAMS.md). A team bucket can only be switched on once production runs
`SPOKEN_ARCHIVE_STORE=r2`.

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
   no deletes) that we do not enforce. The site never deletes an archive object from a team's
   bucket; it removes only its own test object.
2. **A team's bucket is the record of the takes stored in it.** We keep no copy. A file the team
   removes is gone, and the line reads as unvoiced.
3. **Moving a team's takes copies them and never purges ours.** History already in our bucket stays
   there, at our cost; the saving comes from the takes the team rolls afterwards.
4. **A team's bucket replaces `spoken-archive`, never `spoken-packs`** (2026-11-17). Every
   language's live takes keep publishing to our channel, signed with our key, and players download
   them from there; a release copies each live clip out of the team's bucket into it. The channel
   holds only live clips, so this is the smaller cost and we accept it.

## For a team admin

`/admin/storage?lang=xx` connects a bucket: provider (R2, S3, B2, Wasabi, GCS with HMAC keys, MinIO
or any S3-compatible store), endpoint, region, bucket, an optional public address, and a key. The
key needs to read, write and look up objects; it never needs to delete. Saving tests the bucket,
and nothing goes to it until it passed and an admin switches it on. From then on the team's new
takes, recordings, clone clips, references and pack encodings go there. The page also moves what
is already in our archive into the bucket, or brings a bucket's objects back.

## Design

### One S3-compatible store

`s3Blobs` (`apps/web/src/lib/blobs/store.ts`) speaks S3's API with SigV4 through `aws4fetch`,
path-style or virtual-hosted, with presigned addresses. Our own bucket is `r2Blobs`, the R2 preset of
it. R2's 409 `ObjectLockedByBucketPolicy` answer to a PUT on a locked key counts as written.

### Data model

Migration 0114:

- `storage_backend`: `teamId`, provider, endpoint, region, bucket, path style, `publicUrl`
  (nullable), the access key id, the secret sealed, whether the provider honours `If-None-Match`,
  `writing` (at most one per team), `health`, `checkedAt`, `lastError`, `retiredAt`. Row-level
  security limits it to its team; site-wide reads act as every team.
- `archive_object`: `(prefix, sha256, backendId)`, with `pending` and `missingAt`. A row says a
  team's bucket holds the object. No row means our bucket, so every existing object keeps meaning
  what it means.

Migration 0115 adds `storage_move`, below.

Rows name the bucket that holds an object, rather than reads following the team's current bucket:
a switch would otherwise orphan every older object at once, and a move could not be done one
object at a time, resumed or undone. A copy adds a row and never moves one, and the hash is the
object's name, so a take, an encoding, a sample and a reference are found the same way.

### Resolving a store

`locate(key)` (`lib/blobs/where.ts`) picks a copy not known to be missing, one that has landed
before one waiting in quarantine, the newest first, and our bucket when there is no row or every
team copy is missing. A team bucket's store is built once per process and dropped on a
`spoken_storage_backend` notification. Every reader goes through it: `serveBlob`, `blobBytes`, the
take redirect and `/api/archive/`. A read that finds a team's copy gone marks it missing and tries
the next.

### Secrets

AES-256-GCM under `SPOKEN_STORAGE_KEY` (`lib/blobs/seal.ts`), bound to the backend's id. The secret
is write-only in the UI and never appears in an API answer. Losing the key loses every team's
secret, not their objects: each team enters its key again.

An endpoint or public address that resolves to a private, loopback, link-local or CGNAT address is
refused when saved and before every test (`lib/storage/host.ts`), so a team admin cannot point the
site at the droplet's neighbours. `SPOKEN_STORAGE_ALLOW_PRIVATE=1` lifts that for a local MinIO.

### Testing a backend

`lib/storage/probe.ts`, under `probe/<random>`:

- a write, and a second write that must not replace it; a bucket that lets it is not failed, the
  store looks before it writes from then on (`conditionalPut`);
- the size from a HEAD;
- a ranged GET with the whole size;
- a browser fetch by the public address, or by a signed one;
- a 404 for a key never written.

The probe object is deleted afterwards when the key allows it.

### Serving

Public takes redirect to the backend's `publicUrl`, or without one to a presigned GET that lasts an
hour; that redirect is cached privately for five minutes. Recordings, clone clips and references
keep streaming through the site; on AWS S3 that is the team's egress.

### Never paying for a take that cannot be kept

`keep()` and the pack encodings (`lib/blobs/keep.ts`) write to the bucket the owning language's team
sends new objects to. A PUT that fails there marks the bucket failing and parks the bytes under
`quarantine/` in ours, since the provider was already paid. Reads find them there. Once a minute the
queue leader's upkeep (`lib/storage/upkeep.ts`) lands them in the team's bucket and deletes our
copy; `quarantine/` is not `takes/` or `recordings/`. A landed object marks the bucket healthy.

While a team's bucket is failing, `queuePlan` refuses new batches, from the site and the generate
API, with a 409 that says what to do. Jobs already queued carry on, into the quarantine.

### Moving objects

`lib/storage/moves.ts`. A team admin starts a move from our bucket into theirs, from theirs back into
ours, or between two of theirs; one per team at a time, and only into a bucket that passed its test.
The upkeep advances each move a chunk a minute in key order from a cursor, so a restart carries on.
Every copy is checked against its hash. Nothing is deleted from the source (decision 3). Into a team
bucket a move adds the `archive_object` row; into ours it drops the source's row, so reads come
home. An object the source lost is counted and skipped; a target that refuses a write stops the
move with the reason.

### Missing files

Every 15 minutes the upkeep looks at a sample of team-bucket objects (`lib/storage/checks.ts`),
marks the deleted ones missing and unmarks any restored; a read that finds one gone marks it too.
The storage page counts them. A pointer build (`scripts/audio/sounds.mjs`) leaves out a live take
its team deleted, with a warning, rather than stopping the release; one missing from our bucket
still stops it (decision 2).

### Readers outside the site

GET or HEAD `/api/archive/<prefix>/<sha256>` redirects to whichever bucket holds the object, signed
for the method asked when the bucket is private. With `SPOKEN_ARCHIVE_URL` pointing at it, every
script that reads the archive by hash finds team buckets too: `fetch-blobs.mjs`,
`fetch-encodings.mjs`, the clip pointers and `publish.mjs`. Takes and encodings are anybody's; a
recording also needs `Authorization: Bearer <SPOKEN_ARCHIVE_TOKEN>`, which `fetch-blobs.mjs` sends
to the site alone and never on to the bucket it is redirected to.

The release job on the droplet gets `SPOKEN_ARCHIVE_URL=http://127.0.0.1:3010/api/archive/` from
`shared/release.env`, which overrides `app.env` for it and keeps the requests off nginx, and
`SPOKEN_ARCHIVE_TOKEN` from `app.env`. The `release-packs.yaml` workflow and a developer's
`make <section>-pull-live` set `SPOKEN_ARCHIVE_URL` to `https://spoken.quest/api/archive/` instead.

## Not planned: distributing from a team's bucket

Players could download a team's packs from its bucket instead: manifests would carry a base address
and each file's key, the Manager would follow them (it fetches `blobs/<sha>` from the channel today,
`manager/src/main/packs-sync.ts`), older Managers would need those packs kept out of their sight,
and the bucket would need a public address. Decision 4 leaves the channel as it is. A team that wants
full independence can list a community pack (migration 0106): a zip hosted anywhere, named by URL
and hash.
