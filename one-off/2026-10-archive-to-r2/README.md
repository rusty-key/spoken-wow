# 2026-10: the audio archive moves to R2

**Not run yet.** Run once, on the droplet, while the site runs with
`SPOKEN_ARCHIVE_STORE=dual`. Not to be run again. See `../README.md`.

## What changed

Every take, voice actor recording, clone clip and fish.audio reference used to be a file on
the droplet's 30 GB block volume, the only copy there was. Now each is an object in the
`spoken-archive` bucket, named by the SHA-256 of its bytes, and its row records the hash
(migration 0083). Takes are redirected to the bucket's public address; recordings, clone clips
and references stream through the site (`apps/web/src/lib/blobs/`).

New audio already goes to both places in `dual` mode. This copies what was there before.

## Steps

1. Create the `spoken-archive` bucket, make it public on its own domain, and add a bucket
   lock rule on `takes/` and `recordings/` so no key can delete them.
2. Install `oggenc` on the droplet (`apt install vorbis-tools`), so each quests take is
   encoded when it is committed rather than by the release (`deploy/web/README.md`).
3. Add to `shared/app.env`: `R2_ACCOUNT_ID`, `SPOKEN_ARCHIVE_ACCESS_KEY_ID`,
   `SPOKEN_ARCHIVE_SECRET_ACCESS_KEY` (a token for this bucket only), `SPOKEN_ARCHIVE_BUCKET`,
   `SPOKEN_ARCHIVE_URL`, and `SPOKEN_ARCHIVE_STORE=dual`. Reload.
   From here on, every new clip is in both places.
4. On the droplet:

   ```sh
   set -a; . /srv/spoken/shared/app.env; set +a
   export NODE_PATH=/srv/spoken/current/node_modules
   node backfill.mjs --dry-run   # read the missing list
   node backfill.mjs
   node backfill.mjs --verify
   ```

5. When `--verify` passes, set `SPOKEN_ARCHIVE_STORE=r2` and reload. Listen to a few takes,
   a recording, a clone clip and a reference on the site.
6. Snapshot the volume. Keep the snapshot for a month, then detach the volume and remove
   `deploy/web/store.sh`'s links for the audio directories.

Rolling back from step 5 is setting `dual` again: nothing on the volume was changed, and
every clip cut in `r2` mode is in the bucket, where `dual` does not look. So roll back only
within minutes of the switch, or copy those clips down first.

## What it does not move

- `audio/`, `sounds/` and `books/`, the frozen stores from before the take table. Only a
  rollback to a release older than 2026-09 reads them.
- `audio-previews/`, a cache of rendered pronunciation previews. It is rebuilt by spending
  credits, nothing refers to it, and checking it in a bucket would cost two requests per
  lexicon entry on every load of the lexicon page.
- `seed-clips/`, which `make web-push-seed-clips` copies from a checkout.
