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
    manifest.json         the zones manifest, rewritten on drain   on root
    audio/          -> the old quests store, frozen  ~3.1 GB  \
    sounds/         -> the old zones store, frozen   ~453 MB   |
    books/          -> the old books store, frozen             |
    audio-history/  -> every take: quests/ zones/ books/        > symlinks to
    voices/         -> clone clips                              |  /mnt/voice
    audio-previews/ -> rendered pronunciation previews          |
    downloads/      -> the complete sound pack, served off disk /
    seed-clips/           the clips clones are seeded from,      on root
                          en at the top, frFR/ etc. beside; `make web-push-seed-clips`

/mnt/voice/spoken/        a 30 GB block volume; `deploy/web/store.sh` sets it up
  .store                  marker: present only while the volume is mounted
  audio/ sounds/ books/ audio-history/{quests,zones,books}/ voices/ audio-previews/ downloads/
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
| `SPOKEN_ZONES_ROOT` | `current` | per release; the zones pipeline resolves its own paths from it |
| `SPOKEN_ZONES_AUDIO_HISTORY` | `shared/audio-history/zones` | shared |
| `SPOKEN_BOOKS_AUDIO_HISTORY` | `shared/audio-history/books` | shared; **must be set**, for the reason the quests one must |
| `SPOKEN_ZONES_MANIFEST` | `shared/manifest.json` | shared; the app rewrites it whenever a batch drains |

Five more come from `shared/app.env`, which `ecosystem.config.js` parses and merges into the
pm2 environment. They are secrets, and that file is the only place they exist:

| Env var | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://spoken:…@127.0.0.1:5432/spoken` | localhost only |
| `BETTER_AUTH_SECRET` | 32 random bytes | signs session cookies; rotating it signs everyone out |
| `BETTER_AUTH_URL` | `https://spoken.rusty.one` | **must match the public origin exactly** |
| `SPOKEN_SECRET_KEY` | 32 bytes, base64 | the master key stored ElevenLabs credentials are sealed under |
| `ELEVENLABS_DICTIONARY_ID` | an id from your ElevenLabs account | the pronunciation dictionary `/lexicon` updates in place. **Must not change**: unset, every save creates a new one |

**`SPOKEN_SECRET_KEY` cannot be rotated casually.** Every stored ElevenLabs credential is
sealed under it, and AES-GCM offers no way to re-seal a credential nothing can open. Change
it and every collaborator pastes their key again — recoverable, but they have to be told.

`app.env` may also set **`QUEUE_MAX_ACTIVE`**, which is not a secret: how many people's
regeneration queues drain at once. Default 3. Each queue runs at its own key's plan width,
and all of them together at most 12 jobs (the database pool's limit), so raising it spreads
those 12 thinner. Anything that is not a whole number of at least 1 is read as 3.

`app.env` may also set **`WORD_TIMES_ALIGNER`**, the command that times each new take (for
example `/srv/spoken/venv/bin/python /srv/spoken/pipelines/timings/align.py`). With it set, every
English take the generators return without word times is aligned against its text with WhisperX and the
result is stored on the take (`wordTimes`). Unset, takes are saved without times, as before. The
host needs `pip install -r pipelines/timings/requirements.txt`; on a CPU-only host each take waits
for the model to load, so a batch runs slower. A failed alignment never fails the take.

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
curl -fsS 'https://spoken.rusty.one/api/zones/search' | head -c 200
curl -sI -H 'Range: bytes=0-1' 'https://spoken.rusty.one/api/quests/audio/quests/5-accept.mp3' | head -1   # 206
curl -sI 'https://spoken.rusty.one/api/zones/audio/1411/zone.mp3' | head -1

# every address shape the two addons have ever emitted
curl -sI 'https://voiceover.rusty.one/r/quest/5/accept'      | grep -i location  # /quests/r/quest/5/accept
curl -sI 'https://lore.rusty.one/enUS/r/1411/razor-hill'     | grep -i location  # /zones/r/1411/razor-hill
curl -sI 'https://lore.rusty.one/r/1411/razor-hill'          | grep -i location  # the same
curl -sI 'https://lore.rusty.one/deDE/r/1411/razor-hill'     | grep -i location  # /deDE/zones/r/1411/razor-hill
curl -sI 'https://lore.rusty.one/?q=razor'                   | grep -i location  # /zones?q=razor
curl -sI 'https://voiceover.rusty.one/?q=thrall'             | grep -i location  # /quests?q=thrall
curl -sI 'https://spoken.rusty.one/downloads/SpokenQuestsAudioComplete-latest.zip' | grep -i location  # the meta addon's page
```

Then sign in and regenerate one line in each section with a key set on `/profile`.

`make quests-audio-status` and `make zones-audio-status` compare file counts and sizes
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
make zones-history-status
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
