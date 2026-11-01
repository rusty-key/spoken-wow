# Deploying Spoken

One site, three sections, on one droplet. nginx in front, pm2 supervising, GitHub Actions
deploying on every push to `master` that touches `apps/web/`, `pipelines/`,
`addons/Spoken_Places/Data/` or `deploy/web/`.

It replaced two separate deployments, whose names are now redirect vhosts pointing here —
see `nginx-voiceover-redirect.conf` and `nginx-lore-redirect.conf`, which exist so that
every address the addons have ever emitted still resolves.

```
/srv/spoken/
  releases/<utc>-<sha>/   one per deploy; prune.sh keeps five
  current -> releases/…   the symlink activate.sh swaps, atomically
  bin/                    activate, migrate, rollback, prune
  shared/                 everything the app writes, and nothing a release owns
    app.env               secrets, mode 600                    on root
    ecosystem.config.js   pm2's config, `make web-deploy-scripts`  on root
    manifest.json         the places manifest, rewritten on drain  on root
    audio/          -> the old quests store, frozen  ~3.1 GB  \
    sounds/         -> the old zones store, frozen   ~453 MB   |
    books/          -> the old books store, frozen             |
    audio-history/  -> every take: quests/ places/ readables/  > symlinks to
    voices/         -> clone clips                              |  /mnt/voice
    audio-previews/ -> rendered pronunciation previews          |
    downloads/      -> the complete sound pack, served off disk /
    seed-clips/           the clips clones are seeded from,      on root
                          en at the top, frFR/ etc. beside; `make web-push-seed-clips`

/mnt/voice/spoken/        a 30 GB block volume; `deploy/web/store.sh` sets it up
  .store                  marker: present only while the volume is mounted
  audio/ sounds/ books/ audio-history/{quests,places,readables}/ voices/ audio-previews/ downloads/
```

**`audio-history/` is the only audio.** Every take is one file there, written once by the
site and never changed; which take is live is a flag on its row, and a sound pack is built
by copying the live takes out of it (`scripts/audio/sounds.mjs`). `audio/`, `sounds/` and
`books/` are the stores each section used to overwrite with its live take. Nothing reads or
writes them since the take table became the record
(`one-off/2026-09-converge-takes/`, which hard-linked their live clips into the archive);
they stay only so a rollback to a release from before that still has its audio, and a
cleanup may remove them later.

Each section's archive also holds `recorded/<lang>/`: what voice actors uploaded
(migration 0062), kept exactly as uploaded beside the generated takes and never a version
of them. It is the least replaceable audio there is, since a session cannot be cut again
for a few credits.

Everything under `shared/` is there for one reason: a release directory is deleted five
deploys later, and every one of those is either irreplaceable or was paid for.

## The audio volume

The stores total ~10 GB against a 33 GB root filesystem, which leaves no room to grow. So
the bytes live on `/mnt/voice`, a block volume that can be resized without touching the
droplet.

`shared/<store>` reaches it through a symlink, so that name still means what it meant:
`ecosystem.config.js` builds every path variable from it, each section's `pull-history`
rsyncs out of it, nginx aliases `/downloads/` at it. One path to reason about,
and the disk it sits on is an implementation detail.

```bash
ssh "root@$SPOKEN_HOST"
  bash store.sh          # make web-store prints it; idempotent
```

It refuses to link a directory that holds files, and it refuses to run at all when
`/mnt/voice` is not a mount point — because `/etc/fstab` mounts it `nofail`, so a droplet
that reboots without the volume comes up happily with `/mnt/voice` an ordinary empty
directory on root. The `.store` marker exists for the same reason from the other side:
`bin/activate.sh` will not deploy without it, which turns a missing volume into a deploy
that stops rather than a site that answers 404 for every line.

`manifest.json` is deliberately **not** on the volume. It is written write-temp-then-rename,
and a rename over a symlink replaces the symlink with a real file. It is 384 KB and the
`take` table rebuilds it.

## Runtime configuration

The app reads its data through environment variables, all set in `shared/ecosystem.config.js`.
They are prefixed by section, and the prefix is not cosmetic — a variable named for a tree it
no longer lives in is one somebody sets on the wrong box.

| Env var | Points at | Lives |
|---|---|---|
| `SPOKEN_QUESTS_CORPUS` | `current/pipelines/quests/corpus/corpus.json.gz` | per release |
| `SPOKEN_QUESTS_VOICE_CONFIG` | `current/pipelines/quests/voice` | per release |
| `SPOKEN_QUESTS_AUDIO_HISTORY` | `shared/audio-history/quests` | shared; **must be set**, or the archive of every take — including audio nothing can reproduce — lands in a release |
| `SPOKEN_QUESTS_VOICE_SAMPLES` | `shared/voices` | shared; **must be set**, or clone clips land where nothing backs them up |
| `SPOKEN_QUESTS_VOICE_REFERENCES` | `shared/voice-references` | shared; **must be set**, or fish.audio references are cut into a release and lost on the next deploy |
| `SPOKEN_QUESTS_SEED_CLIPS` | `shared/seed-clips` | shared; unset, it points inside a release, which has none, and **Seed from clips** finds nothing |
| `SPOKEN_QUESTS_PREVIEWS` | `shared/audio-previews` | shared; **must be set**, or previews land inside `releases/`, where `prune.sh` counts them as a release and eventually deletes them |
| `SPOKEN_PLACES_ROOT` | `current` | per release; the places pipeline resolves its own paths from it |
| `SPOKEN_PLACES_AUDIO_HISTORY` | `shared/audio-history/places` | shared |
| `SPOKEN_READABLES_AUDIO_HISTORY` | `shared/audio-history/readables` | shared; **must be set**, for the reason the quests one must |
| `SPOKEN_BOSSES_AUDIO_HISTORY` | `shared/audio-history/bosses` | shared; **must be set**, for the reason the quests one must |
| `SPOKEN_PLACES_MANIFEST` | `shared/manifest.json` | shared; the app rewrites it whenever a batch drains |

Six more come from `shared/app.env`, which `ecosystem.config.js` parses and merges into the
pm2 environment. They are secrets, and that file is the only place they exist:

| Env var | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://spoken:…@127.0.0.1:5432/spoken` | localhost only. The owner: `migrate.sh`, backups and scripts use it |
| `APP_DATABASE_URL` | `postgres://spoken_app:…@127.0.0.1:5432/spoken` | what the app logs in as; `ecosystem.config.js` hands it to the app as its `DATABASE_URL`. Row-level security binds it, so a query that misses its team reads nothing. Unset, the app uses the owner's |
| `BETTER_AUTH_SECRET` | 32 random bytes | signs session cookies; rotating it signs everyone out |
| `BETTER_AUTH_URL` | `https://spoken.rusty.one` | **must match the public origin exactly** |
| `SPOKEN_SECRET_KEY` | 32 bytes, base64 | the master key stored ElevenLabs credentials are sealed under |
| `ELEVENLABS_DICTIONARY_ID` | an id from your ElevenLabs account | the pronunciation dictionary `/lexicon` updates in place. **Must not change**: unset, every save creates a new one |

**`SPOKEN_SECRET_KEY` cannot be rotated casually.** Every stored ElevenLabs credential is
sealed under it, and AES-GCM offers no way to re-seal a credential nothing can open. Change
it and every collaborator pastes their key again — recoverable, but they have to be told.

**The audio archive's bucket** comes from `app.env` too, once it is set up
(`one-off/2026-10-archive-to-r2/`): `R2_ACCOUNT_ID`, `SPOKEN_ARCHIVE_ACCESS_KEY_ID` and
`SPOKEN_ARCHIVE_SECRET_ACCESS_KEY` (a token scoped to the archive bucket alone, never the packs
channel's), `SPOKEN_ARCHIVE_BUCKET`, `SPOKEN_ARCHIVE_URL` (its public address) and
`SPOKEN_ARCHIVE_STORE`. That last one is `disk` until the bucket exists, `dual` while the
backfill runs, and `r2` after: then takes redirect to the bucket, recordings, clone clips and
references stream through the site, and the volume is no longer read or written.

Before `SPOKEN_ARCHIVE_STORE` becomes `dual`, install **`oggenc`** beside ffmpeg
(`apt install vorbis-tools`): with the bucket in use every quests take is encoded to its
pack's Ogg when it is committed (`apps/web/src/lib/takes/encode.ts`). Without it the take
still commits, but the release workflow (`.github/workflows/release-packs.yaml`) must encode
every take instead.

`app.env` may also set **`QUEUE_MAX_ACTIVE`**, which is not a secret: how many people's
regeneration queues drain at once. Default 3. Each queue runs at its own key's plan width,
and all of them together at most 12 jobs (the database pool's limit), so raising it spreads
those 12 thinner. Anything that is not a whole number of at least 1 is read as 3.

**There is no `ELEVENLABS_API_KEY`.** Every request that reaches ElevenLabs is spent from the
signed-in user's own account, using a key they set on `/profile`, sealed under
`SPOKEN_SECRET_KEY`. A route asked to spend without one answers `428 no_api_key`. The Python
CLI still reads the repo root's `.env`, because it is run by one person on their own machine.

`BETTER_AUTH_URL` is the one worth double-checking. Better Auth validates the `Origin` header
of every state-changing request against it, so a stale value does not fail at boot — the site
loads fine and every sign-in, registration and role change returns `403 Invalid origin`.

```bash
cat > /srv/spoken/shared/app.env <<EOF
DATABASE_URL=postgres://spoken:$PGPW@127.0.0.1:5432/spoken
APP_DATABASE_URL=postgres://spoken_app:$APPPW@127.0.0.1:5432/spoken
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
BETTER_AUTH_URL=https://spoken.rusty.one
SPOKEN_SECRET_KEY=$(openssl rand -base64 32)   # once, and never again: see above
ELEVENLABS_DICTIONARY_ID=<the dictionary id from your ElevenLabs account>
EOF
chown deploy:deploy /srv/spoken/shared/app.env
chmod 600 /srv/spoken/shared/app.env
```

## Standing it up

`deploy/web/bootstrap.sh`, run on the droplet as root, makes the tree and the database and
prints what is left. Then, from a workstation, `make web-deploy-scripts`.

Reach a staged instance over an ssh tunnel rather than opening a port:

```bash
ssh -L 3002:127.0.0.1:3002 "$SPOKEN_DROPLET"     # then http://127.0.0.1:3002
```

### Checking it

```bash
curl -fsS 'https://spoken.rusty.one/api/quests/search?q=thrall&filter=npc' | grep Thrall
curl -fsS 'https://spoken.rusty.one/api/places/search' | head -c 200
curl -sI -H 'Range: bytes=0-1' 'https://spoken.rusty.one/api/quests/audio/quests/5-accept.mp3' | head -1   # 206
curl -sI 'https://spoken.rusty.one/api/places/audio/1411/zone.mp3' | head -1

# every address shape the two addons have ever emitted
curl -sI 'https://voiceover.rusty.one/r/quest/5/accept'      | grep -i location  # /quests/r/quest/5/accept
curl -sI 'https://lore.rusty.one/enUS/r/1411/razor-hill'     | grep -i location  # /places/r/1411/razor-hill
curl -sI 'https://lore.rusty.one/r/1411/razor-hill'          | grep -i location  # the same
curl -sI 'https://lore.rusty.one/deDE/r/1411/razor-hill'     | grep -i location  # /deDE/places/r/1411/razor-hill
curl -sI 'https://lore.rusty.one/?q=razor'                   | grep -i location  # /places?q=razor
curl -sI 'https://voiceover.rusty.one/?q=thrall'             | grep -i location  # /quests?q=thrall
curl -sI 'https://spoken.rusty.one/downloads/SpokenQuestsAudioComplete-latest.zip' | grep -i location  # the meta addon's page
```

Then sign in and regenerate one line in each section with a key set on `/profile`.

`make quests-audio-status` and `make places-audio-status` compare file counts and sizes
between the workstation and the droplet.

## GitHub credentials, step by step

Four secrets, and the workflows read nothing else about the droplet. Run all of it locally.

**1 — Generate a deploy-only SSH key.** No passphrase; Actions cannot type one.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_spoken_deploy -C "gha-spoken-deploy" -N ""
```

**2 — Authorize it on the droplet**, for the `deploy` user only:

```bash
ssh-copy-id -i ~/.ssh/id_spoken_deploy.pub "deploy@$SPOKEN_HOST"
ssh -i ~/.ssh/id_spoken_deploy "deploy@$SPOKEN_HOST" 'echo ok'    # must print: ok
```

**3 — Capture the host key**, so CI verifies the server rather than blindly trusting it:

```bash
ssh-keyscan -H "$SPOKEN_HOST" > /tmp/known_hosts
```

**4 — Set the secrets** (from the repo root, with `gh` authenticated):

```bash
gh secret set DO_SSH_KEY     < ~/.ssh/id_spoken_deploy
gh secret set DO_KNOWN_HOSTS < /tmp/known_hosts
gh secret set DO_HOST        --body "$SPOKEN_HOST"
gh secret set DO_USER        --body "deploy"
```

Through the UI instead: **Settings → Secrets and variables → Actions → New repository
secret**. For `DO_SSH_KEY` paste the **private** key including the
`-----BEGIN OPENSSH PRIVATE KEY-----` and `-----END …-----` lines *and the trailing
newline* — a missing trailing newline is the usual cause of `Load key: error in libcrypto`.

**5 — Verify and clean up:**

```bash
gh secret list        # DO_HOST, DO_KNOWN_HOSTS, DO_SSH_KEY, DO_USER
rm /tmp/known_hosts
```

**6 — Create the `production` environment.** The workflow declares
`environment: production`, so create it under **Settings → Environments**. This also gives a
deployment history and the option of a required-reviewer gate later without touching the
workflow.

The private key never leaves your machine except into GitHub's secret store, and authorizes
exactly one unprivileged user on one host. Revoking it is one line out of
`/home/deploy/.ssh/authorized_keys`.

A workstation sets the same facts as shell environment variables — `SPOKEN_DROPLET`,
`SPOKEN_HOST` and optionally `SPOKEN_DEPLOY_KEY`. See `make/droplet.mk`; nothing in the repo
names the host.

## What a deploy does

1. Typecheck, unit tests, migrations against a throwaway Postgres, build. A red build never
   reaches the droplet.
2. Assemble `standalone` + `.next/static` + `corpus.json.gz` + `migrations/` into a release
   directory.
3. **Boot that exact artifact in CI** and hit `/api/search`, the stylesheet, and a real
   sign-up. This catches a broken bundle before it can replace a working release.
4. `rsync` it to `releases/<utc-stamp>-<sha>/`.
5. `activate.sh` — `migrate.sh`, then the atomic symlink swap, then
   `pm2 startOrReload --update-env`.
6. Smoke check on the droplet; **on failure it rolls back automatically** and fails the job.
7. `prune.sh 5`.

### About step 5

Migrations run **before** the swap, so a migration that fails aborts the deploy with the
previous release still live and serving. Each file in `migrations/` is applied once, inside
a transaction that also records its name in `schema_migration`; there is no half-applied
state to clean up.

The asymmetry worth holding in your head: **a rollback moves code, never schema.** Nothing
un-applies a migration. So migrations have to stay additive — a release must be able to run
against the schema of the release *after* it, or rolling back one version breaks the site in
a way `rollback.sh` cannot fix. Adding a nullable column is fine; renaming or dropping one
needs two deploys.

### Teams, deploy 1

The release that ships `0087_team.sql` and the three `0088_team_scope_*.sql` files seeds one
team per group of languages the same people maintain, and writes each per-team row's team
on it. It is additive: the release before it keeps working on the new schema. Before
merging, from a workstation:

1. **Preview the grouping** and confirm it with the people in it:

   ```bash
   psql "$PROD_DATABASE_URL" -f deploy/web/bin/team-grouping.sql
   ```

   After the deploy, teams are edited, not seeded again. A team's slug is its languages'
   codes joined by `-`, and the slug check stops at 41 characters, so a group of nine or more
   languages aborts 0087 and with it the deploy (the previous release keeps serving). Change
   the grants that put them together first.

2. **Check the languages the rows name.** One that is not a well-formed code (`deDE`)
   aborts 0087, as `team_language` refuses it; one nobody maintains joins the english team.
   Both should be expected:

   ```sql
   select "lang", string_agg("tbl", ' ' order by "tbl") as "tables",
          case when "lang" !~ '^[a-z]{2}[A-Z]{2}$' then 'malformed: aborts 0087'
               else 'no maintainers: joins english' end as "outcome"
     from (
       select 'language' as "tbl", "code" as "lang" from "language"
       union select 'take', "lang" from "take" union select 'recording', "lang" from "recording"
       union select 'take_ack', "lang" from "take_ack" union select 'voice_clone', "lang" from "voice_clone"
       union select 'fish_reference', "lang" from "fish_reference"
       union select 'generation_setting_locale', "lang" from "generation_setting_locale"
       union select 'pronunciation_lexicon_locale', "lang" from "pronunciation_lexicon_locale"
       union select 'lexicon_change', "lang" from "lexicon_change"
       union select 'line_ignore', "lang" from "line_ignore" union select 'line_flag', "lang" from "line_flag"
       union select 'line_issue', "lang" from "line_issue" union select 'report', "lang" from "report"
       union select 'regeneration_batch', "lang" from "regeneration_batch"
       union select 'regeneration_job', "lang" from "regeneration_job"
       union select 'regeneration_pause', "lang" from "regeneration_pause"
       union select 'activity', "lang" from "activity"
       union select 'voice_sample', nullif(split_part("clone", '@', 2), '') from "voice_sample"
     ) l
    where "lang" is not null and "lang" <> 'enUS'
      and ("lang" !~ '^[a-z]{2}[A-Z]{2}$'
           or not exists (select 1 from "language_grant" g
                           where g."lang" = l."lang"
                             and g."capability" in ('edit', 'regenerate', 'configure', 'ignore', 'admin')))
    group by "lang"
    order by "lang";
   ```

3. **Pause the queue** from the queue panel, and resume it once the deploy is green. The
   backfill holds a row lock on every take until it commits, so a take the queue commits
   meanwhile waits for it.

4. **Merge and let the deploy run.** Expect short locks, one transaction per file. On a copy
   of the development database (240k takes, 122k activity rows): the columns, 0.1 s, under
   ACCESS EXCLUSIVE, but only a catalog change -- it does wait for any long query on those
   tables to finish, and holds every query behind it meanwhile; the backfill, 15 s, row locks
   only, so reads go on and a write to a row being filled waits; the keys, 1 s, which hold
   writes, not reads, while the indexes build.

### Teams, deploy 2: row-level security

Migration `0090_team_rls.sql` turns on row-level security for every per-team table, and the
app moves to a role of its own, `spoken_app`, which the policies bind. The owner, `spoken`,
keeps reading every team: the migrations, backups, pack builds and pipelines connect as it.
The release also ships `0089_team_contract.sql`, which drops the old keys deploy 1's code
names in its `on conflict` clauses.

`DATABASE_ROLE` is the other half, for workstations and CI: it makes the pool act as a role
on whatever `DATABASE_URL` logs in as (`-c role=…`, `apps/web/src/lib/db.ts`). The tests set it
to `spoken_app`, since a local superuser bypasses every policy. Production does not set it;
it logs in as `spoken_app` instead.

**There is no rolling back across this deploy; fix forward.** Deploy 1's code cannot write
against 0089's schema: the keys its `on conflict` clauses name are gone, and its hand-rolled
transactions write activity with no team. `deploy-web.yaml` rolls back on its own when the
smoke check fails, so for this deploy watch the run, and if it rolls back, deploy this
release again (Actions, *Deploy web*, *Run workflow*) or a fix on top of it, rather than leave
deploy 1's code serving.

In order:

1. **Before merging, check the languages the rows name**, from a workstation. 0089 gives a
   language nobody owns to the english team, and aborts, as `team_language` refuses it, on
   one that is not a well-formed code. `team_scoped_lang` (0087) is the set 0089 reads, so this
   lists exactly what it will act on. Both should be expected:

   ```sql
   select "lang",
          case when "lang" !~ '^[a-z]{2}[A-Z]{2}$' then 'malformed: aborts 0089'
               else 'no team: joins english' end as "outcome"
     from "team_scoped_lang"
    where team_of_lang("lang") is null or "lang" !~ '^[a-z]{2}[A-Z]{2}$'
    order by "lang";
   ```

2. **Before merging**, on the droplet as `postgres`, give the owner its bypass and make the
   app's role. 0090 refuses to run until the first is done, and cannot make the second
   itself, as `spoken` lacks CREATEROLE:

   ```bash
   sudo -u postgres psql -c "alter role spoken bypassrls"
   sudo -u postgres psql -c "create role spoken_app nologin"
   ```

3. **Pause the queue** from the queue panel. Between `migrate.sh` applying 0089 and the
   symlink swap, deploy 1's code is still serving against keys that are gone, and every
   write naming one fails; a queue that keeps committing takes fails each one, paid for.
   The window is seconds. An edit made in it fails visibly and can be repeated.

4. **Merge and let the deploy run**, and watch it (above). Until step 6 the app still logs
   in as the owner, which works and filters nothing.

5. **Give the role a login and a password.** The password is set at `\password`'s prompt, so
   it never reaches a command line, the process list or psql's history:

   ```bash
   APPPW=$(openssl rand -base64 24 | tr -d '/+=')
   echo "$APPPW"                       # to paste at the prompt, twice
   sudo -u postgres psql -c "alter role spoken_app login"
   sudo -u postgres psql               # then: \password spoken_app, and \q
   echo "APP_DATABASE_URL=postgres://spoken_app:$APPPW@127.0.0.1:5432/spoken" \
     >> /srv/spoken/shared/app.env
   ```

6. **Restart the app as the new role.** First, from a workstation, `make web-deploy-scripts`:
   `shared/ecosystem.config.js` is what reads `APP_DATABASE_URL`, and a deploy does not copy
   it. Then on the droplet, check the new login works before the app depends on it, and
   reload:

   ```bash
   psql "$(grep ^APP_DATABASE_URL /srv/spoken/shared/app.env | cut -d= -f2-)" -c 'select 1'
   pm2 startOrReload /srv/spoken/shared/ecosystem.config.js --update-env
   ```

   Resume the queue, and check a language's explorer, `/voices` and the activity page show
   what they showed before.

Backing out of step 6 alone is possible: remove `APP_DATABASE_URL` and reload, and the app is
the owner again. The policies stay; the owner bypasses them. The code stays deploy 2's.

### Teams, members

The release that ships `0091_team_member.sql` adds `team_member` (the audio capabilities, per
member and language), copies the audio grants into it, and moves every language the english
team holds, except enUS, to a team of its own. It makes `x@rusty.one` admin of each of those
teams. It is additive: `language_grant` keeps its audio grants, so the release before it keeps
working on the new schema.

1. **Preview what 0091 will split**, from a workstation. Each language listed becomes a team:

   ```bash
   psql "$PROD_DATABASE_URL" -c "select tl.lang from team_language tl join team t on t.id = tl.\"teamId\" where t.slug = 'english' and tl.lang <> 'enUS' and tl.privileged order by tl.lang"
   ```

2. **Check the site owner exists.** The admin grants are made for the user with this email; if
   there is none, the teams are still made, with no admin:

   ```bash
   psql "$PROD_DATABASE_URL" -c "select id from \"user\" where email = 'x@rusty.one'"
   ```

3. **Pause the queue** from the queue panel, and don't change grants until the deploy is done:
   the old release writes audio grants only to `language_grant`, so one given or removed after
   0091 has copied them is missing from `team_member`, or still in it. Then wait until no job is
   running in any language from step 1. A running job would commit its take under the old team after the move, so 0091
   aborts, and with it the deploy (the previous release keeps serving), if one is. Migrations
   run at the Activate step while the old release still serves, so the queue has to be paused
   before merging. Check, and repeat until it returns no rows:

   ```bash
   psql "$PROD_DATABASE_URL" -c "select id, lang, \"leaseUntil\", \"leaseUntil\" < now() as expired from regeneration_job where state = 'running' order by lang, id"
   ```

   A row whose lease has expired never finishes on its own: its worker is gone, and a paused
   language reclaims nothing, so it stays running until the pause is lifted. Put such rows
   back in the queue, where the claim would have put them, and check again:

   ```bash
   psql "$PROD_DATABASE_URL" -c "update regeneration_job set state = 'pending', \"leaseUntil\" = null where state = 'running' and \"leaseUntil\" < now()"
   ```

4. **Merge and let the deploy run.** 0091 is one transaction of about 180k row updates on the
   development database's data (12 s on a workstation; expect several times that on the 1 vCPU
   droplet). While it runs, creating `team_member`'s foreign key holds SHARE ROW EXCLUSIVE on
   `user` until the commit, so sign-ups and anything else writing `user` wait for it, and the
   pending jobs of the moved languages stay locked. Reads go on. Resume the queue once the
   deploy is green.

   If 0091 aborts, the previous release keeps serving and nothing of 0091 is left. Drain the
   queue as in step 3, then deploy again (Actions, *Deploy web*, *Run workflow*).

5. **Check `/enUS/admin/teams`.** English should hold only enUS, and each language from step 1
   should be a team of its own.

6. **Look for strays**, a minute or more after the deploy is green. Until the old release's
   workers stop, they map languages from a memo up to 60 s old and hear no move, so a row they
   wrote during the migration or just after it can sit under english for a moved language.
   The script reports a count per table and changes nothing:

   ```bash
   psql "$PROD_DATABASE_URL" -f deploy/web/bin/team-strays.sql
   ```

   If the total is not 0, pause the queue and run it again with `-v repair=on`, which
   re-teams each stray row to its language's team:

   ```bash
   psql "$PROD_DATABASE_URL" -v repair=on -f deploy/web/bin/team-strays.sql
   ```

**Rolling back to the previous release is safe**: 0091 only adds, and the old code still reads
the audio grants left in `language_grant`. One caveat: grants changed on the new release are
written to `team_member` and are not visible to the old code, which reads only `language_grant`.
Repeat them there by hand, or accept that they revert.

**Going forward again after a rollback** needs the opposite: audio grants given or taken away
on the old release went to `language_grant` only, and this release reads `team_member`, so a
regenerate taken away there comes back. Mirror those changes into `team_member` (per language,
on `team_of_lang(lang)`) before deploying this release again.

### Teams, text maintainers

The release that ships `0092_text_maintainers.sql`, `0093_report_queue.sql` and
`0094_override_original.sql` splits the text maintainer from the team's `edit`. 0092 gives every
`edit` holder both and appoints every team admin, so nobody loses anything, and deletes the audio
rows from `language_grant`, which the current release no longer reads. All three keep the current
release working on the new schema.

1. **Don't change grants during the deploy.** `edit` given on the old release lands only in
   `language_grant`, so afterwards it would mean `text` alone. One taken away there would leave
   the team's `edit` behind.

2. **After the deploy, check** that `/[lang]/admin` shows the same people with `text maintainer`
   added, and that one language's report page lists the same open reports. Both should look as
   before: nobody holds one capability without the other yet, so there are no queue labels.
   The deploy log's notices give each step's row count.

3. **From now on only a site owner appoints text maintainers.** A team admin's `edit` no longer
   reaches original text or contributions, and a new team admin has no `text` until appointed.

**After a rollback, run this at once.** The previous release ignores `report.queue` and
`line_override."originalHash"`, and files reports with the audio team by default, but it also reads
the `edit` rows 0092 added to `team_member` and cannot delete them: taking `edit` away from someone
there removes only the `language_grant` row, so they keep it, and the Users page shows `edit` twice.
Deleting those rows puts it back as it was. It also loses any team-only `edit` given on this release:

```bash
psql "$PROD_DATABASE_URL" -c "delete from team_member where capability = 'edit'"
```

**Going forward again after a rollback** needs them back, since 0092 will not run twice. Before
deploying this release again:

```bash
psql "$PROD_DATABASE_URL" -c "select grant_text_maintainers()"
```

### Overrides in every language

Migration 0095 adds `lang` to `line_override` and to its primary key. The previous release's save
names the old key, so for the seconds between migrating and the symlink swap saving an override
fails. Nothing else does.

**After a rollback, run this at once**, or English overrides cannot be saved. The other languages'
overrides stay in the table and come back on the next deploy. The previous release does not read
them, unless the English team also holds that language: it reads every row its team can see, so
such a row would replace English's text for that file. Delete those first.

```bash
psql "$PROD_DATABASE_URL" -c 'alter table line_override add constraint line_override_team_file unique ("teamId", "file")'
```

It fails if one team holds overrides on the same file in two languages. Delete the ones you can
spare first. Before deploying again:

```bash
psql "$PROD_DATABASE_URL" -c 'alter table line_override drop constraint line_override_team_file'
```

### Promoting the first admin

There is deliberately no bootstrap path through the UI. Register normally, then, on the
droplet:

```bash
ssh "$SPOKEN_DROPLET"
psql "$(grep ^DATABASE_URL /srv/spoken/shared/app.env | cut -d= -f2-)" \
  -c "UPDATE \"user\" SET role = 'admin' WHERE email = 'you@example.com'"
```

`user` is quoted because it is a reserved word — that is Better Auth's default table name.
Every role after this one is handed out from `/admin`, which will not let an admin demote
themselves.

## The Release button

`/admin/release?lang=xx` lets a team admin start the `release-packs.yaml` workflow in
Manager-only mode and follow it by step. The site only dispatches and reads; GitHub Actions
builds, signs and publishes. One release runs at a time, site-wide.

1. Create a **fine-grained** GitHub token for this repository only, with the repository
   permission **Actions: Read and write** (`actions: write`) and nothing else.
2. Add to `/srv/spoken/shared/app.env`:

   ```
   SPOKEN_RELEASE_GITHUB_TOKEN=<the token>
   SPOKEN_RELEASE_GITHUB_REPO=<owner>/<repo>
   ```

   `SPOKEN_RELEASE_GITHUB_REF` is optional and defaults to `master`: the branch the workflow is
   dispatched on. Unset token or repo, a press fails at once and the run is marked failed.
   `SPOKEN_RELEASE_CHANNEL` is optional too. Unset means the `production` environment; a checkout
   testing the button sets `staging`.
3. Restart so pm2 reads the file:

   ```bash
   pm2 startOrReload /srv/spoken/shared/ecosystem.config.js --update-env
   ```

**The GitHub environment holds the run's secrets.** The workflow reads them from the environment its
`channel` input names, and fails in its first steps if one is missing. `production` and `staging` each
need `DO_SSH_KEY`, `DO_KNOWN_HOSTS` (with an entry for `DO_HOST`), `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET` and `SPOKEN_PACKS_SIGNING_KEY`, their R2 token scoped to their own
bucket. `DO_USER` and `DO_HOST` are repository secrets. A manual CurseForge upload also needs
`CURSEFORGE_TOKEN` in `production`.

**A publish that would empty a pack is refused.** A pack losing more than 5 files and more than 5% of
them stops the run, since that is what a short sync or pull looks like. If the loss is meant, dispatch
the workflow by hand with `allow_removals`.

**Deploy and the workflow go together.** The workflow file on the default branch must already
have the `manager_only` and `release_id` inputs, or GitHub rejects the dispatch and every press
fails. They arrive in the same merge as the site; do not set the token before it is deployed.
Migration `0095_release_run.sql` arrives with that deploy (`activate.sh` runs it).

**A stuck run** needs no `make` target: if GitHub has not started a run 15 minutes after the
press, the page fails it itself ("GitHub never started it") and frees the lock. A run that
GitHub reports as finished is settled the next time anyone opens the page. If every check gets an
error, as with an expired token, the lock holds for 9 hours and the only sign is in the server log,
so replace the token rather than waiting.

**The first real release.** Pick a small language and a small section, press Release, watch the
run's step on the page and the run itself through its link, then check the Manager lists the new
rev for that pack. Nothing else should have changed: one release publishes only the folders that
build produced.

## Downloads

nginx aliases `/downloads/` straight at `shared/downloads/`, so a file there never passes
through the app; `make quests-downloads-status` lists it. The complete quests pack it used to
hold is retired, and its address redirects to the meta addon's page (`nginx-spoken.conf`).
Once that redirect is live, delete `SpokenQuestsAudioComplete-*.zip` from the directory.

## Day to day

```bash
make web-releases                  # list, marking the live one
make web-rollback                  # one release older
make web-rollback RELEASE=20260727-2143-a1b2c3d
make quests-history-status         # archive parity between local and droplet
make places-history-status
make web-logs                      # pm2 logs spoken
```

Rollback walks strictly backwards in time, so running it repeatedly keeps stepping to older
releases instead of bouncing between the newest two.

Both sections are in every release — a change to the shared queue, the shared roster or the
shared report table is a change to both, and shipping them apart would leave a window where
one had it and the other did not.

## The regeneration queue

Mass regeneration is a queue in Postgres (`regeneration_batch`, `regeneration_job`), drained
inside the app processes rather than by a separate service. A session-scoped advisory lock
picks one process to lead, and only that one claims jobs. A process joins leader contention
the first time one of the `/api/regenerate/queue` routes is called on it — not on boot, but
lazily.

**Two things worth knowing:**

- **`kill_timeout` is load-bearing.** The leader finishes its in-flight ElevenLabs calls
  before releasing the lock, so a `pm2 reload` hands the queue over rather than running two
  drains at once. Lowering it back towards pm2's 1600 ms default reintroduces SIGKILL
  mid-take, and a killed leader's jobs then wait out a five-minute lease.
- **Anything with the database URL is a potential contender.** A one-off `next start` pointed
  at production Postgres becomes one as soon as anything calls a queue route on it — which for
  a `next start` someone is poking at is likely to be the explorer page's own poll. The
  advisory lock is what makes this safe — one leader, whichever it is — but nothing confines
  the queue to the droplet except custody of the database URL.

To see what it is doing without the UI:

```sql
select "state", count(*) from "regeneration_job" group by "state";
select * from "regeneration_batch" order by "createdAt" desc limit 5;
```

To stop it, use `POST /api/regenerate/queue/stop`, which the Stop button calls: it cancels
pending jobs, leaves in-flight ones to finish and be billed, and stamps the batch so the
panel can explain why it stopped.

If the app is not answering, break glass with:

```sql
update "regeneration_job" set "state" = 'cancelled', "finishedAt" = now()
 where "state" = 'pending';
```

This cancels pending jobs but does not stamp the batch with a reason, so the UI will show a
stopped queue with no explanation — and running jobs are unaffected, because their characters
are already billed at ElevenLabs. The full behaviour of `cancelPending()` in
`apps/web/src/lib/generation/queue.ts` is the authority; keep it in sync with changes there.

### Why the queue starts lazily

The queue is started by `ensureQueueRunning()` from `apps/web/src/lib/generation/boot.ts`,
called by the `/api/regenerate/queue` routes, rather than from a Next `instrumentation.ts`
hook.

`instrumentation.ts` is the natural home and was the original design. It does not work here:
Next compiles that file for the edge runtime as well as node, whether or not the app has any
edge code, and the `NEXT_RUNTIME` guard stops the code running there but not being bundled.
Webpack then has to resolve the whole server graph — `pg`'s optional native binding, `fs`,
`path`, `stream`, and our own `history.ts` reaching `node:crypto` — for a runtime that never
executes it, and `next dev` answers 500. No `next.config.ts` setting fixes it; the problem is
that the compile happens at all. `next build` is unaffected, because it only produces an edge
compile when the app really contains edge code.

**The cost:** a batch interrupted by a deploy does not resume on boot. It resumes when
something calls a queue route — in practice when an admin opens the explorer, since the page
polls the queue every fifteen seconds for anyone who can regenerate. On a quiet evening an
interrupted batch waits.

## Gotchas worth knowing

- **Audio only ever comes home.** Takes are cut on the droplet, through the site, and nowhere
  else, so every sync of audio runs droplet to laptop (`make <section>-pull-history`) and
  none of them deletes anything.
- **`audio-history/` is the one directory whose loss is permanent.** Some of it is audio that
  predates this project's ability to reproduce it — the same failure that left this project
  with voices it could not remake. `make <section>-pull-history` it somewhere safe.
- **`cp -a`, never `cp -r`, when assembling a release.** pnpm's `node_modules/next` is a
  symlink into `.pnpm/`; a dereferencing copy (which is what BSD `cp -r` does) detaches it
  from its siblings and the bundle dies at boot with
  `Cannot find module 'styled-jsx/package.json'`.
- **The droplet is the only copy of the audio, not a backup.** Keep the real backup
  wherever it is today.
- **`pm2 save` runs on every activate**, which is what lets pm2's systemd unit resurrect the
  app after a reboot. Nothing is saved until the first successful deploy.
