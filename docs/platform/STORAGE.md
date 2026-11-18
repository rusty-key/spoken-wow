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
5. **A team a person creates keeps its audio only in its own bucket** (2026-11-17), so we never
   charge for storage. Until it has one switched on it can generate, record and upload nothing.
   Teams that existed before, and the ones the system makes for a language with none, keep our
   archive. A site admin can change either on `/admin/teams`.

## For a team admin

`/admin/storage?lang=xx` connects a bucket: provider (R2, S3, B2, Wasabi, GCS with HMAC keys, MinIO
or any S3-compatible store), endpoint, region, bucket, an optional public address, and a key. The
key needs GetObject and PutObject (on Amazon S3 also ListBucket, without which a missing object
answers 403 rather than 404 and the test fails); it never needs to delete. Saving tests the bucket,
and nothing goes to it until it passed and an admin switches it on. From then on the team's new
takes, recordings, clone clips, references and pack encodings go there. The page also moves what
is already in our archive into the bucket, or brings a bucket's objects back unless the team keeps
its own storage.

With Cloudflare set up on the site, the page also offers **Connect Cloudflare**: the admin grants
access on Cloudflare, picks the account and the bucket's name, and the site does the rest (below).

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
- `archive_object`: `(prefix, sha256, backendId)`, with the bucket's `teamId`, `pending` and
  `missingAt`. A row says a team's bucket holds the object. No row means our bucket, so every
  existing object keeps meaning what it means.

Migration 0115 adds `storage_move`, below.

Rows name the bucket that holds an object, rather than reads following the team's current bucket:
a switch would otherwise orphan every older object at once, and a move could not be done one
object at a time, resumed or undone. A copy adds a row and never moves one, and the hash is the
object's name, so a take, an encoding, a sample and a reference are found the same way.

### Resolving a store

`locate(key, lang)` (`lib/blobs/where.ts`) picks a copy not known to be missing: the reading
language's team's own copy first, one that has landed before one waiting in quarantine, the newest
first, and our bucket when there is no row or every team copy is missing. Another team's copy is
still read, because a language handed over leaves its objects in the old team's bucket. So when two
teams kept the same bytes, one in our archive and one in its own bucket, both read the second.
Pack builds check every object's hash; the site does not. A team bucket's store is built once per process and dropped on a
`spoken_storage_backend` notification. Every reader goes through it: `serveBlob`, `blobBytes`, the
take redirect and `/api/archive/`. A read that finds a team's copy gone marks it missing and tries
the next.

### Secrets

AES-256-GCM under `SPOKEN_STORAGE_KEY` (`lib/blobs/seal.ts`), bound to the backend's id. The secret
is write-only in the UI and never appears in an API answer. Losing the key loses every team's
secret, not their objects: each team enters its key again.

An endpoint or public address that resolves to a private, loopback, link-local or CGNAT address is
refused when saved and before every test (`lib/storage/host.ts`), so a team admin cannot point the
site at the droplet's neighbours; with path style off, the bucket's own host under the endpoint is
checked too. No request to a bucket follows a redirect, and none waits more than two minutes for an
answer. What is not caught is a name that resolves elsewhere after the check (DNS rebinding); the
requests are signed S3 calls whose answers are shown only as a status line.
`SPOKEN_STORAGE_ALLOW_PRIVATE=1` lifts the address check for a local MinIO.

### Connecting Cloudflare

Added 2026-11-18. A one-click alternative to the form for R2, through Cloudflare's OAuth (open to any
developer since June 2026). `lib/storage/cloudflare.ts` and `/api/storage/cloudflare/`:

1. `start` sends the admin to `dash.cloudflare.com/oauth2/auth` with a state and a PKCE (S256)
   challenge. The state and the verifier the challenge was made from wait in the `spoken_cloudflare`
   cookie: sealed under `SPOKEN_STORAGE_KEY`, bound to the person, httpOnly, Lax, scoped to
   `/api/storage/cloudflare`, ten minutes.
2. `callback` checks the state and that the person still administers the language, exchanges the
   code (client secret and verifier), and keeps the access token in the same cookie for fifteen
   minutes at most. Every outcome redirects to the Storage page, a refusal in `?cloudflare_error=`.
   An answer without this connection's state leaves the cookie alone, since any page can link
   there. The Storage page asks for a waiting grant on every load, so a reload does not lose it.
3. The page lists the accounts the grant reaches and suggests `spoken-<lang>` as the bucket. POST
   creates the bucket unless the account has one by that name.
4. The key. `account-api-tokens.write` is optional on the consent screen (decided 2026-11-18): it
   lets its holder create a token with any permission in the account, so the admin may decline it,
   and the token answer's `scope` says whether they did.
   - Granted: the site creates an account-owned API token with `Workers R2 Storage Bucket Item
     Write` on that bucket alone. Its id is the access key id and the SHA-256 of its value the
     secret.
   - Declined: POST answers `needsKey` once the bucket exists, and the page shows how to make an
     R2 token on Cloudflare (Object Read & Write, that bucket only) with two fields for its access
     key id and secret. A second POST carries them.
5. The bucket is saved like one entered by hand and tested, again up to five times three seconds
   apart while a new key reaches R2. Then the grant is revoked and the cookie cleared. A refusal, or
   a bucket waiting for its key, keeps the grant, so the admin can carry on without going back to
   Cloudflare.

The site keeps no Cloudflare grant, only the bucket's key, so nothing else of the account is
reachable afterwards. R2 has no permission that writes without deleting, so the key can delete
objects in its bucket; a bucket lock on `takes/` and `recordings/` is the team's way to stop that.
The bucket has no public address; takes redirect to signed addresses until the team sets one. A
setup that fails after the key was made leaves that key in the account, named `Spoken: <bucket>`.

Why not something else: R2's S3 API takes only keys made from API tokens, and Cloudflare has no
cross-account role (AWS) or grant to our service account (GCS), so the industry's way to an R2
bucket is a pasted key. Keeping the OAuth grant and using Cloudflare's REST API instead would hold
a long-lived grant over all of the account's R2, with no presigned addresses.

Off unless `CLOUDFLARE_OAUTH_CLIENT_ID`, `CLOUDFLARE_OAUTH_CLIENT_SECRET` and
`CLOUDFLARE_OAUTH_SCOPES` are set, and `SPOKEN_STORAGE_KEY` is valid: it seals the cookie and the key. The client is registered in our Cloudflare account with the
redirect URI `https://spoken.quest/api/storage/cloudflare/callback`; until its visibility is public
(which needs `spoken.quest` verified by a TXT record, and cannot be undone) only members of our
account can use it. Cloudflare publishes its scopes only at `GET /client/v4/oauth/scopes`, so the
scopes are configured rather than written here. They are `account-settings.read`,
`workers-r2.read`, `workers-r2.write` and `account-api-tokens.write`, the last marked optional on
the client.

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
hour. A take version's redirect is cached for good only when it points at our own copy, which never
moves; one into a team's bucket is cached for five minutes, since a team can move, re-address or
delete its objects, and one into the quarantine not at all, since it is deleted once it lands. Recordings, clone clips and references
keep streaming through the site; on AWS S3 that is the team's egress.

### Never paying for a take that cannot be kept

`keep()` and the pack encodings (`lib/blobs/keep.ts`) write to the bucket the owning language's team
sends new objects to. A PUT that fails there marks the bucket failing and parks the bytes under
`quarantine/<bucket>/` in ours, since the provider was already paid. Reads find them there. Once a
minute the queue leader's upkeep (`lib/storage/upkeep.ts`) lands up to 20 of each bucket's in it
and deletes our copy, so one broken bucket's backlog holds up no other; `quarantine/` is not
`takes/` or `recordings/`. A landed object marks the bucket healthy. A copy is deleted too when the
same bytes then land directly, and none is made when the bucket already holds them.

While a team's bucket is failing, `queuePlan` refuses new batches, from the site and the generate
API, with a 409 that says what to do. Jobs already queued carry on, into the quarantine.

### Moving objects

`lib/storage/moves.ts`. A team admin starts a move from our bucket into theirs, from theirs back into
ours (unless the team keeps its own storage), or between two of theirs; one per team at a time, and only into a bucket that passed its test.
The upkeep advances each move a chunk a minute in key order from a cursor, so a restart carries on.
Every copy is checked against its hash. Nothing is deleted from the source (decision 3). Into a team
bucket a move adds the `archive_object` row; into ours it drops the source's row, so reads come
home. An object the source lost is counted and skipped; a target that refuses a write stops the
move with the reason.

### Teams that keep their own storage

`team."ownStorage"` (migration 0116) is set by `createTeam` and `foundTeam`, so every team a person
creates, from a request or the New team form, has it; existing teams and `adopt_lang`'s do not.
Such a team keeps no new audio on our volume or in our archive; what is already there stays
(decision 3) (`ownStorageRefusal`, `lib/blobs/keep.ts`):

- `keep()` and the pack encodings refuse with an `OwnStorageError` while it has no bucket switched
  on, or our archive is not in `r2` mode, before anything is written anywhere;
- `queuePlan` refuses its batches with a 409 (`storage-required`), and the worker fails a job
  already queued before the provider is paid;
- the recordings, clone sample and reference uploads refuse before reading the upload, or paying
  for the transcription;
- the Storage page offers no way back to our archive: it cannot switch new objects to ours, and no
  move goes into ours.

The one exception is the quarantine: a take its bucket refused after the provider was paid waits in
ours until it lands, and is deleted then.

### Missing files

Every 15 minutes the upkeep looks at a sample of team-bucket objects (`lib/storage/checks.ts`),
marks the deleted ones missing and unmarks any restored; a read that finds one gone marks it too.
The storage page counts them. A quests pointer build (`scripts/audio/sounds.mjs`) leaves out a live
take whose Ogg its team deleted (a 404), with a warning, rather than stopping the release (decision
2). Places, Readables and Bosses stop instead, naming the deleted clips, since their lookups name
every clip; any failure other than a 404, and a clip missing from our bucket, stops every build.

### Readers outside the site

GET or HEAD `/api/archive/<prefix>/<sha256>` redirects to whichever bucket holds the object, signed
for the method asked when the bucket is private. With `SPOKEN_ARCHIVE_URL` pointing at it, every
script that reads the archive by hash finds team buckets too: `fetch-blobs.mjs`,
`fetch-encodings.mjs`, the clip pointers and `publish.mjs`. Takes and encodings are anybody's; a
recording also needs `Authorization: Bearer <SPOKEN_ARCHIVE_TOKEN>`, which `fetch-blobs.mjs` sends
only to a site `/api/archive/` address over https or on the same machine, and never on to the
bucket it is redirected to. Releases pull takes only, so they need no token.

The release job on the droplet gets `SPOKEN_ARCHIVE_URL=http://127.0.0.1:3010/api/archive/` from
`shared/release.env`, which overrides `app.env` for it and keeps the requests off nginx. The
`release-packs.yaml` workflow and a developer's
`make <section>-pull-live` set `SPOKEN_ARCHIVE_URL` to `https://spoken.quest/api/archive/` instead.

## Not planned: distributing from a team's bucket

Players could download a team's packs from its bucket instead: manifests would carry a base address
and each file's key, the Manager would follow them (it fetches `blobs/<sha>` from the channel today,
`manager/src/main/packs-sync.ts`), older Managers would need those packs kept out of their sight,
and the bucket would need a public address. Decision 4 leaves the channel as it is. A team that wants
full independence can list a community pack (migration 0106): a zip hosted anywhere, named by URL
and hash.
